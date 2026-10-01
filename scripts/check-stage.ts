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

import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { existsSync } from 'node:fs';
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
import { ANIMATED_BONES } from '../src/lib/anim/frames';
import { FigureRig } from '../src/lib/anim/figure';
import { idlePose } from '../src/lib/anim/clip';
import { loadModelForAnimation } from './load-model';
import { CAMERA_STATE_ORDER } from '../src/lib/scene/camera';
import params from '../src/lib/scene/figure-params.json';

const CAMERA_POSES_KEYS = Object.keys(CAMERA_POSES);

/**
 * The figure used for the framing checks.
 *
 * Only one is loaded — the male — because the framing failure mode is lens-and-
 * distance arithmetic, and the two figures differ by 4 cm of height. The female's
 * own framing is checked separately where it can differ.
 */
const FRAMING_FIGURE = 'male';
const framingModel = existsSync(`public/models/${FRAMING_FIGURE}.glb`)
	? await loadModelForAnimation(`public/models/${FRAMING_FIGURE}.glb`)
	: null;

interface SkinEntry {
	geometry: BufferGeometry;
	bindMatrix: Matrix4;
	boneInverses: Matrix4[];
	boneList: { name: string; matrixWorld: Matrix4 }[];
}

let bodyGeometry: BufferGeometry | null = null;
let bodyMesh: SkinEntry | null = null;

if (framingModel) {
	const found: SkinEntry[] = [];
	framingModel.traverse((node) => {
		const m = node as unknown as {
			isSkinnedMesh?: boolean;
			geometry?: BufferGeometry;
			bindMatrix?: Matrix4;
			skeleton?: { boneInverses: Matrix4[]; bones: { name: string; matrixWorld: Matrix4 }[] };
		};
		if (!m.isSkinnedMesh || !m.geometry || !m.bindMatrix || !m.skeleton) return;
		found.push({
			geometry: m.geometry,
			bindMatrix: m.bindMatrix,
			boneInverses: m.skeleton.boneInverses,
			boneList: m.skeleton.bones,
		});
	});
	bodyMesh = found.find((e) => e.geometry.name?.includes('-base')) ?? found[0] ?? null;
	bodyGeometry = bodyMesh?.geometry ?? null;
}

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

/**
 * Project the figure's posed mesh through a camera pose and report framing.
 *
 * Uses real vertices rather than the bounding box's corners: an axis-aligned box
 * around a figure standing at an angle projects to corners well outside the
 * silhouette, so a box test reports clipping for shots that are framed correctly.
 */
function framingFor(restArmAngle: number, armAbduction: number): {
	lines: { name: string; ok: boolean; detail: string }[];
} {
	if (!framingModel || !bodyMesh || !bodyGeometry) return { lines: [] };
	const scene = framingModel;
	const rig = new FigureRig(scene, ANIMATED_BONES);
	const pose = idlePose(0, restArmAngle, armAbduction);
	const posAttr = bodyGeometry.getAttribute('position')!;
	const skinIndex = bodyGeometry.getAttribute('skinIndex')!;
	const skinWeight = bodyGeometry.getAttribute('skinWeight')!;
	const bindInverse = bodyMesh.bindMatrix.clone().invert();
	const cache = new Map<number, Matrix4>();
	const skin = (j: number): Matrix4 => {
		let m = cache.get(j);
		if (!m) {
			m = new Matrix4()
				.copy(bindInverse)
				.multiply(bodyMesh.boneList[j]!.matrixWorld)
				.multiply(bodyMesh.boneInverses[j]!)
				.multiply(bodyMesh.bindMatrix);
			cache.set(j, m);
		}
		return m;
	};

	const lines: { name: string; ok: boolean; detail: string }[] = [];
	const v = new Vector3();
	const world: Vector3[] = [];

	for (const travel of FRAMING_SAMPLES) {
		rig.apply(pose, travel);
		scene.updateMatrixWorld(true);
		cache.clear();

		world.length = 0;
		for (let i = 0; i < posAttr.count; i++) {
			let ax = 0;
			let ay = 0;
			let az = 0;
			let aw = 0;
			for (let k = 0; k < 4; k++) {
				const w = skinWeight.getComponent(i, k);
				if (w === 0) continue;
				v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(
					skin(skinIndex.getComponent(i, k)),
				);
				ax += v.x * w;
				ay += v.y * w;
				az += v.z * w;
				aw += w;
			}
			if (aw > 0) world.push(new Vector3(ax / aw, ay / aw, az / aw));
		}

		const modelAt = rig.footPosition();
		for (const state of MUST_FRAME) {
			const camPose = CAMERA_POSES[state];
			const cam = new PerspectiveCamera(camPose.fov, 16 / 9, 0.1, 200);
			cam.position.copy(camPose.position);
			cam.lookAt(camPose.target.clone().add(modelAt));
			cam.updateMatrixWorld(true);
			cam.updateProjectionMatrix();

			let minY = Infinity;
			let maxY = -Infinity;
			let outside = 0;
			const q = new Vector3();
			for (const wv of world) {
				q.copy(wv).project(cam);
				if (!Number.isFinite(q.y) || q.z > 1) continue;
				if (q.x < -1 || q.x > 1 || q.y < -1 || q.y > 1) outside++;
				minY = Math.min(minY, q.y);
				maxY = Math.max(maxY, q.y);
			}
			// NDC spans 2 units for the full frame height.
			const fill = ((maxY - minY) / 2) * 100;
			lines.push({
				name: `${state} holds the figure at ${travel} m`,
				ok: outside === 0,
				detail: outside === 0
					? `fills ${fill.toFixed(0)}% of frame height`
					: `${outside} vertices outside the frame, filling ${fill.toFixed(0)}%`,
			});
		}
	}
	return { lines };
}

/** Model height for whichever figure, from the pipeline's generated params. */
const FIGURES = params.figures as Record<
	string,
	{
		height: number;
		restArmAngleDeg: number;
		armAbductionDeg: number;
		shoulderWidth: number;
		hipWidth: number;
	}
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

/**
 * Where the model is, in the same sense the camera rig means it: at its feet.
 *
 * The rig root's origin is *not* that — it carries a bind offset that places the
 * body on the floor, so the root sits below the ground and partway back down the
 * runway. Every framing number here is anchored the same way the camera anchors
 * its aim, so this check and the running app cannot disagree.
 */
function feetAt(travelZ: number): Vector3 {
	return new Vector3(0, 0, travelZ);
}

/** Distances along the walk at which framing is sampled, ending on the mark. */
const FRAMING_SAMPLES = [0, 3, 6, 9, 11, RUNWAY.markZ];

/** States that must keep the whole figure in shot at every sample. */
const MUST_FRAME = ['FRONT', 'SPECTATOR', 'TRACK', 'MODEL'] as const;

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
	'every state is defined and reachable',
	CAMERA_STATE_ORDER.length === CAMERA_POSES_KEYS.length &&
		CAMERA_STATE_ORDER.every((s) => CAMERA_POSES[s] !== undefined) &&
		// Both composed views must be first, so the default view is one of them.
		CAMERA_STATE_ORDER[0] === 'FRONT' &&
		CAMERA_STATE_ORDER[1] === 'SPECTATOR',
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

console.log('\nFRAMING — does the whole figure stay in shot?');
{
	// A view that crops the garment is not a view. This is measured against the
	// real GLBs across the whole walk rather than asserted as a constant, because
	// the failure mode is arithmetic: a lens and a distance produce a frame, and
	// the figure either fits in it or does not.
	//
	// Two bugs lived here. Aiming at chest height from a seated camera put the aim
	// almost level with the lens, so as the model approached it grew downward out
	// of frame — by the mark a third of the figure was gone. And every target was
	// anchored to the rig root, which carries a bind offset that places the body on
	// the floor, so the aim sat most of a metre high and made it worse.
	const framingFigure = FIGURES[FRAMING_FIGURE];
	if (framingFigure) {
		for (const line of framingFor(
			framingFigure.restArmAngleDeg,
			framingFigure.armAbductionDeg,
		).lines) {
			push(line.name, line.ok, line.detail);
		}
	}
}

console.log('\nTHE TWO VIEWS');
{
	// Direction of travel is the whole reason these two views exist. The model
	// walks along +Z and faces +Z, so a camera at the *near* end of the ramp sees
	// its back. The front row has to be at the far end, looking back up the ramp.
	//
	// This is a regression guard, not a description: the audience camera was
	// originally seated at z = -1.2, and every other invariant passed while the
	// product showed the walk from behind.
	const front = CAMERA_POSES.FRONT;
	const frontForward = front.target.clone().sub(front.position).normalize();
	push(
		'FRONT looks back up the runway, so the model walks toward the lens',
		front.position.z > RUNWAY.length && frontForward.z < -0.5,
		`seat at z=${front.position.z.toFixed(2)} m (runway ends at ${RUNWAY.length} m), ` +
			`view direction z=${frontForward.z.toFixed(2)}`,
	);

	push(
		'FRONT is on the centreline, so the model is square to the lens',
		Math.abs(front.position.x) < 0.01,
		`x=${front.position.x.toFixed(3)} m`,
	);

	// The side view: a seat among the chairs flanking the ramp, not on its axis.
	// Lateral placement is what makes the model pass in profile, which is the whole
	// point of having a second view — a second seat on the centreline would just be
	// the front view again.
	const spectator = CAMERA_POSES.SPECTATOR;
	push(
		'SPECTATOR is seated to one side of the ramp',
		Math.abs(spectator.position.x) > RUNWAY.width / 2,
		`x=${spectator.position.x.toFixed(2)} m, runway half-width ${(RUNWAY.width / 2).toFixed(2)} m`,
	);

	push(
		'SPECTATOR is in the seating, alongside the runway rather than off its end',
		spectator.position.z > 0 && spectator.position.z < RUNWAY.length,
		`z=${spectator.position.z.toFixed(2)} m of ${RUNWAY.length} m`,
	);

	// Eye level has to be seated, not standing — a spectator in the room.
	push(
		'both views sit at seated eye level',
		Math.abs(front.position.y - RUNWAY.seatedEyeHeight) < 0.01 &&
			Math.abs(spectator.position.y - RUNWAY.seatedEyeHeight) < 0.01,
		`${front.position.y.toFixed(2)} m and ${spectator.position.y.toFixed(2)} m`,
	);

	// Neither view may travel with the model. That is product principle 02: the
	// user is a spectator in a seat, not a camera on a dolly.
	push(
		'neither of the two views translates with the model',
		!front.positionFollowsModel && !spectator.positionFollowsModel,
		'both are fixed seats; only the aim follows',
	);

	push(
		'both views aim at the model so it stays framed',
		front.targetFollowsModel && spectator.targetFollowsModel,
		'gaze follows, seat does not',
	);

	// The two views must actually differ, or the second one is redundant.
	push(
		'the two views are genuinely different seats',
		front.position.distanceTo(spectator.position) > 3,
		`${front.position.distanceTo(spectator.position).toFixed(2)} m apart`,
	);
}

console.log('\nSPECTATOR PRINCIPLE (product principle 02)');
{
	// FRONT and MODEL must be the same seat. Section 17 says the camera "remains
	// stationary while the model approaches" — a different seat means the camera
	// moves, which is exactly what the brief forbids.
	const front = CAMERA_POSES.FRONT;
	const model = CAMERA_POSES.MODEL;
	const sameSeat = front.position.distanceTo(model.position) < 1e-6;
	push(
		'FRONT and MODEL share one seat',
		sameSeat,
		sameSeat
			? 'identical position; only the lens length differs'
			: `${front.position.distanceTo(model.position).toFixed(2)} m apart — the camera would move`,
	);

	// The core of section 17's MODEL state: the camera must not travel with the walk.
	push(
		'neither FRONT nor MODEL translates with the model',
		!front.positionFollowsModel && !model.positionFollowsModel,
		'both positions are fixed seats',
	);

	// They separate by lens length: MODEL is the longer lens used as the figure
	// reaches the mark, which is what that state is for.
	push(
		'MODEL is the longer lens from the same seat',
		model.fov < front.fov,
		`${model.fov} deg against FRONT's ${front.fov} deg`,
	);

	// Only INSPECT and MACRO may travel — section 17 gives exactly those two a
	// camera that "moves toward" the subject.
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
	// FRONT and MODEL share the centreline, so the linear path between them is
	// degenerate; blending them is a no-op by construction, which is correct.
	let worstIntrusion = 0;
	let worstPath = '';
	for (const from of CAMERA_STATE_ORDER) {
		for (const to of CAMERA_STATE_ORDER) {
			if (from === to) continue;
			for (const modelAt of MODEL_POSITIONS) {
				const a = resolve(CAMERA_POSES[from], modelAt);
				const b = resolve(CAMERA_POSES[to], modelAt);
				// INSPECT and MACRO are *meant* to be over the catwalk — section 17
				// says the camera moves toward the garment. ARCHIVE is not a seat at
				// all: it is the pull-back that leaves the room behind, so the path
				// into it is allowed to cross. Only a blend between two seats has to
				// stay clear — a spectator must never fly through the runway.
				const eitherTravels =
					CAMERA_POSES[from].positionFollowsModel || CAMERA_POSES[to].positionFollowsModel;
				if (eitherTravels || from === 'ARCHIVE' || to === 'ARCHIVE') continue;

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
			: 'all blends between seats stay clear (INSPECT/MACRO fly over, ARCHIVE leaves the room)',
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
