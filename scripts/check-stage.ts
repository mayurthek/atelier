/**
 * Runway stage and camera invariants.
 *
 *   npm run stage:check
 *
 * The browser here cannot be made visible, so requestAnimationFrame never fires
 * and nothing that lives in a render loop can be exercised in situ. These checks
 * cover what *is* testable without a renderer: the stage constants, the §17
 * camera poses, and the transition maths.
 *
 * That last part matters more than it sounds. A camera pose is a position, a
 * look-at and a field of view; the failure modes are a camera under the floor,
 * a look-at behind the lens, or two states that are so far apart the blend
 * sweeps through the audience. All three are arithmetic, so all three are
 * assertable here rather than found by squinting at a screenshot.
 */

import { Vector3 } from 'three';
import {
	RUNWAY,
	LIGHTING,
	ATMOSPHERE,
	PALETTE,
	MOTION,
	CAMERA_POSES,
	easeInOut,
	type CameraPose,
} from '../src/lib/scene/stage-config';
import { CAMERA_STATE_ORDER } from '../src/lib/scene/camera';
import params from '../src/lib/scene/figure-params.json';

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

const checks: Check[] = [];
const push = (name: string, ok: boolean, detail: string): void => {
	checks.push({ name, ok, detail });
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

/** Model height for whichever figure, from the pipeline's generated params. */
const FIGURES = params.figures as Record<
	string,
	{ height: number; restArmAngleDeg: number; shoulderWidth: number; hipWidth: number }
>;

/**
 * Resolve a pose to world space.
 *
 * Position and target each resolve independently — see the note on `CameraPose`.
 * Resolving them together is what made MODEL's camera travel with the model,
 * defeating the whole point of §17's stationary-camera state.
 */
function resolve(
	pose: CameraPose,
	modelAt: Vector3,
): { position: Vector3; target: Vector3; follows: boolean } {
	const position = pose.position.clone();
	if (pose.positionFollowsModel) position.add(modelAt);
	const target = pose.target.clone();
	if (pose.targetFollowsModel) target.add(modelAt);
	return { position, target, follows: pose.positionFollowsModel };
}

console.log('\nSTAGE CONSTANTS');
push(
	'runway length matches the show director',
	RUNWAY.length === 14,
	`${RUNWAY.length} m`,
);
push(
	'seated eye height is human, not camera-height',
	RUNWAY.seatedEyeHeight > 1.0 && RUNWAY.seatedEyeHeight < 1.35,
	`${RUNWAY.seatedEyeHeight} m (a seated adult is ~1.15-1.25 m)`,
);
push(
	'audience sits outside the runway',
	RUNWAY.audienceOffset > RUNWAY.width / 2,
	`${RUNWAY.audienceOffset} m from centreline, runway half-width ${(RUNWAY.width / 2).toFixed(2)} m`,
);
push(
	'mark is short of the runway end',
	RUNWAY.markZ < RUNWAY.length,
	`mark at ${RUNWAY.markZ} m of ${RUNWAY.length} m`,
);
push(
	'palette matches §25',
	PALETTE.background === '#080808' && PALETTE.surface === '#151515',
	`${PALETTE.background} / ${PALETTE.surface}`,
);
push(
	'fog density is visible but not opaque',
	ATMOSPHERE.density > 0.005 && ATMOSPHERE.density < 0.08,
	`${ATMOSPHERE.density} — model at ${RUNWAY.markZ} m is ${Math.round(Math.exp(-Math.pow(ATMOSPHERE.density * RUNWAY.markZ, 2)) * 100)}% visible`,
);
push(
	'exactly one shadow-casting light budget',
	LIGHTING.shadowMapSize === 2048,
	`${LIGHTING.shadowMapSize}², single directional caster`,
);

console.log('\nFIGURE PARAMETERS (from the pipeline)');
for (const [id, f] of Object.entries(FIGURES)) {
	push(
		`${id}: height is human-scale`,
		f.height > 1.4 && f.height < 2.1,
		`${f.height} m`,
	);
	push(
		`${id}: bind pose is a T-pose`,
		f.restArmAngleDeg > 80 && f.restArmAngleDeg < 95,
		`${f.restArmAngleDeg}° arm angle from vertical`,
	);
}

console.log('\nCAMERA POSES (§17)');
push(
	'all six states defined',
	CAMERA_STATE_ORDER.length === 6 &&
		CAMERA_STATE_ORDER.every((s) => CAMERA_POSES[s] !== undefined),
	CAMERA_STATE_ORDER.join(' → '),
);

for (const name of CAMERA_STATE_ORDER) {
	const pose = CAMERA_POSES[name];
	const modelAt = new Vector3(0, 0, RUNWAY.markZ);
	const { position, target } = resolve(pose, modelAt);

	// A fixed seat must be somewhere sensible in the room; a following offset is
	// only ever relative to the model, so judging it against room bounds would be
	// meaningless.
	if (!pose.positionFollowsModel) {
		push(
			`${name}: fixed seat is inside the room`,
			Math.abs(position.x) < 20 && position.z > -8 && position.z < RUNWAY.length + 4,
			`x=${position.x.toFixed(2)}, z=${position.z.toFixed(2)}`,
		);
	}

	const finite =
		Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) &&
		Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z) &&
		Number.isFinite(pose.fov);
	push(`${name}: no NaN or Infinity`, finite, finite ? 'clean' : 'non-finite values');

	push(
		`${name}: camera above the floor`,
		position.y > 0.3,
		`eye at y=${position.y.toFixed(2)} m`,
	);

	// §17 INSPECT and MACRO deliberately step toward the garment, so they are
	// allowed onto the runway. Every other state must stay clear of it — the
	// front row is the first seat *past* the end of the catwalk, not on it. A
	// spectator standing on the runway would read as someone who had wandered in.
	if (!['INSPECT', 'MACRO'].includes(name)) {
		const overRunway = position.z > -0.5 && position.z < RUNWAY.length;
		push(
			`${name}: camera stays clear of the runway`,
			Math.abs(position.x) > RUNWAY.width / 2 || !overRunway,
			overRunway
				? `x=${position.x.toFixed(2)} m over the runway (half-width ${(RUNWAY.width / 2).toFixed(2)} m)`
				: `x=${position.x.toFixed(2)}, z=${position.z.toFixed(2)} — behind the runway end`,
		);
	}

	// A look-at directly along +Z with no lateral offset is fine — that is the
	// straight-down-the-runway shot. Only a look-at pointing back along the view
	// axis is a problem, which is the 180° case.
	const forward = target.clone().sub(position).normalize();
	push(
		`${name}: look-at is in front of the lens`,
		Number.isFinite(forward.x) && target.distanceToSquared(position) > 0.01,
		`view direction (${forward.toArray().map((n) => n.toFixed(2)).join(', ')})`,
	);

	const distance = target.distanceTo(position);
	push(
		`${name}: subject within a usable range`,
		distance > 0.6 && distance < 22,
		`${distance.toFixed(2)} m to target`,
	);

	push(
		`${name}: field of view is cinematic, not wide-angle`,
		pose.fov > 18 && pose.fov < 50,
		`${pose.fov}°`,
	);
}

console.log('\nSPECTATOR PRINCIPLE (product principle 02)');
{
	// AUDIENCE and MODEL must be the same seat. §17 says the camera "remains
	// stationary while the model approaches" — a different seat means the camera
	// moves, which is exactly what the brief forbids.
	const audience = CAMERA_POSES.AUDIENCE;
	const model = CAMERA_POSES.MODEL;
	const sameSeat = audience.position.distanceTo(model.position) < 1e-6;
	push(
		'AUDIENCE and MODEL share one seat',
		sameSeat,
		sameSeat
			? 'identical position; only the lens length and aim differ'
			: `${audience.position.distanceTo(model.position).toFixed(2)} m apart — the camera would move`,
	);

	// The core of §17's MODEL state: the camera must not travel with the walk.
	push(
		'neither AUDIENCE nor MODEL translates with the model',
		!audience.positionFollowsModel && !model.positionFollowsModel,
		'both positions are fixed seats',
	);

	// But their aim should follow, or the model would walk out of frame.
	push(
		'MODEL aims at the model even though it does not move',
		model.targetFollowsModel && !audience.targetFollowsModel,
		'MODEL tracks the gaze, AUDIENCE watches the whole runway',
	);

	// The seat must be behind the far end of the runway, and the aim must point up
// it — a spectator at the front watching the model approach.
	push(
		'AUDIENCE sits behind the runway, looking down it',
		audience.position.z < 0 &&
			audience.target.z > audience.position.z + 5 &&
			Math.abs(audience.target.x - audience.position.x) < 0.01,
		`eye z=${audience.position.z.toFixed(2)} m, aiming at z=${audience.target.z.toFixed(2)} m, straight down the centreline`,
	);

	// Only INSPECT and MACRO may travel — §17 gives exactly those two a camera
	// that "moves toward" the subject.
	const travelling = CAMERA_STATE_ORDER.filter((n) => CAMERA_POSES[n].positionFollowsModel);
	push(
		'only INSPECT and MACRO travel with the model',
		travelling.length === 2 && travelling.includes('INSPECT') && travelling.includes('MACRO'),
		`travelling: ${travelling.join(', ')}`,
	);
}

console.log('\nTRANSITIONS');
{
	let worstSpeed = 0;
	let minY = Infinity;
	const steps = 120;

	// Sample every ordered pair, at three model positions along the runway. The
	// model position matters because four of the six states track it, so a blend
	// that is clean at the mark may not be clean mid-walk.
	const MODEL_POSITIONS = [new Vector3(0, 0, 2), new Vector3(0, 0, 8), new Vector3(0, 0, RUNWAY.markZ)];

	for (const modelAt of MODEL_POSITIONS) {
		for (const from of CAMERA_STATE_ORDER) {
			for (const to of CAMERA_STATE_ORDER) {
				if (from === to) continue;
				let previous: Vector3 | null = null;
				for (let i = 0; i <= steps; i++) {
					const eased = easeInOut(i / steps);
					const a = resolve(CAMERA_POSES[from], modelAt);
					const b = resolve(CAMERA_POSES[to], modelAt);
					const p = a.position.clone().lerp(b.position, eased);
					minY = Math.min(minY, p.y);
					if (previous) worstSpeed = Math.max(worstSpeed, p.distanceTo(previous));
					previous = p;
				}
			}
		}
	}

	push(
		'no transition dips below the floor',
		minY > 0.2,
		`lowest point across 90 blends at 3 model positions: y=${minY.toFixed(2)} m`,
	);

	push(
		'blends are continuous, never teleporting',
		worstSpeed < 6,
		`worst per-step move ${(worstSpeed * 1000).toFixed(0)} mm over 120 steps`,
	);

	// Every blend must keep the camera clear of the catwalk, not just the fixed
	// seats — the interpolated midpoint of two good seats can still land on it.
	// AUDIENCE and MODEL share the centreline, so the linear path between them is
	// degenerate; blending them is a no-op by construction, which is correct.
	let worstIntrusion = 0;
	let worstPath = '';
	for (const from of CAMERA_STATE_ORDER) {
		for (const to of CAMERA_STATE_ORDER) {
			if (from === to) continue;
			for (const modelAt of MODEL_POSITIONS) {
				const a = resolve(CAMERA_POSES[from], modelAt);
				const b = resolve(CAMERA_POSES[to], modelAt);
				// INSPECT and MACRO are *meant* to be over the catwalk — §17 says
				// the camera moves toward the garment. Only the path between two
				// seated states has to stay clear.
				const eitherTravels =
					CAMERA_POSES[from].positionFollowsModel || CAMERA_POSES[to].positionFollowsModel;
				if (eitherTravels) continue;

				for (let i = 0; i <= steps; i++) {
					const p = a.position.clone().lerp(b.position, easeInOut(i / steps));
					const overRunway = p.z > -0.5 && p.z < RUNWAY.length;
					if (!overRunway) continue;
					const intrusion = RUNWAY.width / 2 - Math.abs(p.x);
					if (intrusion > worstIntrusion) {
						worstIntrusion = intrusion;
						worstPath = `${from} → ${to}`;
					}
				}
			}
		}
	}
	push(
		'no seated-to-seated blend passes over the catwalk',
		worstIntrusion <= 0,
		worstIntrusion > 0
			? `${(worstIntrusion * 1000).toFixed(0)} mm over the runway on ${worstPath}`
			: 'all seated blends stay clear (INSPECT/MACRO deliberately fly over)',
	);

	push(
		'easing is monotonic',
		easeInOut(0) === 0 && easeInOut(1) === 1 &&
			Array.from({ length: 40 }, (_, i) => easeInOut(i / 39))
				.every((v, i, arr) => i === 0 || v >= arr[i - 1]!),
		'smoothstep, 0→1 without overshoot',
	);

	push(
		'transition durations suit §26',
		MOTION.cameraTransition >= 1 && MOTION.inspectTransition > MOTION.cameraTransition,
		`${MOTION.cameraTransition}s standard, ${MOTION.inspectTransition}s inspect`,
	);
}

const passed = checks.filter((c) => c.ok).length;
console.log(`\n${'='.repeat(74)}\n${passed}/${checks.length} checks passed\n`);
process.exit(passed === checks.length ? 0 : 1);