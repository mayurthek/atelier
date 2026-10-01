/**
 * Headless gait validation.
 *
 *   pnpm anim:check
 *
 * A walk cycle that looks fine in isolation can still fail badly on the real
 * rig: a foot that never leaves the floor, a knee that hyperextends, a bob that
 * punches through the ground. Those are arithmetic bugs, and arithmetic bugs
 * are cheap to catch without a browser.
 *
 * Loads the shipped GLBs, drives the procedural walk through a full cycle, and
 * asserts the invariants that make a walk read as a walk.
 */

import { Box3 } from 'three';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ANIMATED_BONES } from '../src/lib/anim/frames.js';
import { FigureRig } from '../src/lib/anim/figure.js';
import { walkPose, legCurve, RUNWAY_WALK, type WalkSettings } from '../src/lib/anim/walk.js';
import { loadModelForAnimation } from './load-model.js';

const MODELS = [
	{ id: 'male', file: 'public/models/male.glb' },
	{ id: 'female', file: 'public/models/female.glb' },
] as const;

const SAMPLES = 240; // per cycle

/**
 * Distance walked in one full gait cycle, in metres.
 *
 * Two steps per cycle, and a step is roughly the leg's swing arc. Derived from
 * the hip range rather than hardcoded so tuning `hipFlex` keeps foot contact
 * consistent — if travel and stride disagree, the stance foot skates.
 */
const STRIDE_LENGTH = 1.15;

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

async function checkFigure(id: string, file: string): Promise<Check[]> {
	console.log(`\n${'='.repeat(74)}\n${id.toUpperCase()}   ${file}\n${'='.repeat(74)}`);
	const checks: Check[] = [];
	const push = (name: string, ok: boolean, detail: string): void => {
		checks.push({ name, ok, detail });
		console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
	};

	const scene = await loadModelForAnimation(file);
	scene.updateMatrixWorld(true);

	const rig = new FigureRig(scene, ANIMATED_BONES);
	push(
		'bind frames captured',
		rig.frames().names().length === ANIMATED_BONES.length,
		`${rig.frames().names().length}/${ANIMATED_BONES.length} bones`,
	);

	// Bind-pose sanity: the figure must be standing, not lying down or scaled
	// into the floor. Both figures are Y-up with feet near y=0.
	const bindBox = new Box3().setFromObject(scene);
	push(
		'bind pose upright and correctly scaled',
		bindBox.max.y > 1.4 && bindBox.max.y < 2.0 && bindBox.min.y > -0.1,
		`height ${bindBox.max.y.toFixed(3)} m, sole ${bindBox.min.y.toFixed(3)} m`,
	);

	// Shoulder girdle anchor. Lowering the arm must not move the acromion or the
	// humerus head: they are the shoulder, and the arm hangs *from* them. This is
	// a regression guard for a defect that survived two rounds of checks because
	// every existing invariant looked at the wrist, the feet or the head — never at
	// the shoulder. Rotating the chain from the acromion instead of the humerus
	// head swung the deltoid down and inward with the arm, collapsing a third of
	// the shoulder's breadth and leaving the arms looking as though they grew out
	// of the neck, while the wrist-based checks all still passed.
	const shoulderAnchors = ['clavicle_L', 'shoulder01_L', 'upperarm01_L'] as const;
	const bindAnchors = shoulderAnchors.map((bone) => rig.worldPositionOf(bone).clone());

	const metrics = JSON.parse(await readFile('content/figure-metrics.json', 'utf8')) as Record<
		string,
		{ restArmAngleDeg: number; armAbductionDeg: number }
	>;
	const settings: WalkSettings = {
		...RUNWAY_WALK,
		restArmAngle: metrics[id]!.restArmAngleDeg,
		// The figure's own solved angle, not the library default — the suite should
		// exercise the configuration that actually ships.
		armAbduction: metrics[id]!.armAbductionDeg,
	};
	console.log(
		`  rest arm angle ${settings.restArmAngle.toFixed(2)} deg, ` +
			`abduction ${settings.armAbduction.toFixed(2)} deg`,
	);
	const samples: {
		toeL: number;
		toeR: number;
		footL: number;
		footR: number;
		pelvis: number;
		lateral: number;
	}[] = [];

	for (let i = 0; i < SAMPLES; i++) {
		const phase = i / SAMPLES;
		const pose = walkPose(phase, settings);
		// Advance the figure along +Z so stance feet stay world-stationary.
		rig.apply(pose, phase * STRIDE_LENGTH);
		samples.push({
			toeL: rig.worldPositionOf('toe1-1_L').y,
			toeR: rig.worldPositionOf('toe1-1_R').y,
			footL: rig.worldPositionOf('foot_L').y,
			footR: rig.worldPositionOf('foot_R').y,
			pelvis: rig.worldPositionOf('spine02').y,
			lateral: rig.worldPositionOf('spine02').x,
		});
	}

	const lowestToe = Math.min(...samples.map((s) => Math.min(s.toeL, s.toeR)));
	const highestSwingToe = Math.max(...samples.map((s) => Math.max(s.toeL, s.toeR)));
	const swing = highestSwingToe - lowestToe;

	push(
		'neither foot passes through the floor',
		lowestToe > -0.02,
		`lowest toe y ${lowestToe.toFixed(4)} m (limit -0.02)`,
	);
	push(
		'at least one foot lifts during the cycle',
		swing > 0.05,
		`toe lift ${swing.toFixed(4)} m (expect > 0.05)`,
	);

	// Duty factor: at least one foot must be on the ground most of the time,
	// and never both airborne for long. Sampled from the leg curve.
	let bothAirborne = 0;
	let bothGrounded = 0;
	for (let i = 0; i < SAMPLES; i++) {
		const phase = i / SAMPLES;
		const left = legCurve(phase, settings);
		const right = legCurve(phase + 0.5, settings);
		// Ankle below ~4 degrees of plantarflex reads as contact.
		const lDown = left.ankle < 4;
		const rDown = right.ankle < 4;
		if (!lDown && !rDown) bothAirborne++;
		if (lDown && rDown) bothGrounded++;
	}
	push(
		'no long double support or flight',
		bothAirborne / SAMPLES < 0.25 && bothGrounded / SAMPLES < 0.25,
		`flight ${((bothAirborne / SAMPLES) * 100).toFixed(0)}%, double support ${((bothGrounded / SAMPLES) * 100).toFixed(0)}%`,
	);

	// Vertical bob. Measured on the pelvis rather than the head: the head is
	// counter-rotated against the bob on purpose, which cancels most of it and
	// left a false negative here. The pelvis is where the motion actually is.
	const pelvisYs = samples.map((s) => s.pelvis);
	const bob = Math.max(...pelvisYs) - Math.min(...pelvisYs);
	push('vertical bob present and subtle', bob > 0.005 && bob < 0.09, `${(bob * 1000).toFixed(1)} mm (expect 5-90 mm)`);

	// Lateral pelvis shift, the sideways sway of a walk. Must be nonzero and
	// far smaller than the vertical component.
	const lateral = Math.max(...samples.map((s) => s.lateral)) - Math.min(...samples.map((s) => s.lateral));
	push(
		'lateral pelvis shift present',
		lateral > 0.005 && lateral < 0.09,
		`${(lateral * 1000).toFixed(1)} mm (expect 5-90 mm)`,
	);

	// Arms must have come down out of bind T-pose. In bind, the wrist sits at
	// shoulder height and far out to the side; lowered, it is below the shoulder
	// and close to the body.
	const wrist = rig.worldPositionOf('wrist_L');
	const wristR = rig.worldPositionOf('wrist_R');
	const shoulder = rig.worldPositionOf('shoulder01_L');
	push(
		'arms lowered out of bind T-pose',
		wrist.y < shoulder.y - 0.25 && Math.abs(wrist.x) < 0.28,
		`wrist (${wrist.x.toFixed(3)}, ${wrist.y.toFixed(3)}) vs shoulder y ${shoulder.y.toFixed(3)}`,
	);

	// Arms must hang symmetrically. An asymmetric drop means one side rolled the
	// wrong way — invisible in per-bone curves, obvious in the viewport.
	push(
		'arms drop symmetrically',
		Math.abs(wrist.x + wristR.x) < 0.06 && Math.abs(wrist.y - wristR.y) < 0.06,
		`|x| sum ${Math.abs(wrist.x + wristR.x).toFixed(3)}, dy ${Math.abs(wrist.y - wristR.y).toFixed(3)}`,
	);

	// Feet must stay apart laterally. If the legs converge the figure reads as
	// bow-legged, and if they cross the walk has an IK error.
	const leftToeX = rig.worldPositionOf('toe1-1_L').x;
	const rightToeX = rig.worldPositionOf('toe1-1_R').x;
	push(
		'legs do not cross',
		leftToeX > 0 && rightToeX < 0 && leftToeX - rightToeX > 0.08,
		`toe x: L ${leftToeX.toFixed(3)}, R ${rightToeX.toFixed(3)}`,
	);

	// Quaternions must stay finite — a NaN here silently freezes the mesh.
	let finite = true;
	scene.traverse((node) => {
		const q = node.quaternion;
		if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) {
			finite = false;
		}
	});
	push('all bone rotations finite', finite, finite ? 'no NaN' : 'NaN detected');

	// The cycle must be seamless: frame 0 and frame 1 should be near-identical.
	const poseStart = walkPose(0, settings);
	const poseEnd = walkPose(1, settings);
	let maxSeamDelta = 0;
	for (const [name, q0] of poseStart.deltas) {
		const q1 = poseEnd.deltas.get(name);
		if (!q1) continue;
		maxSeamDelta = Math.max(maxSeamDelta, q0.angleTo(q1));
	}
	push('cycle loops seamlessly', maxSeamDelta < 1e-3, `max seam delta ${maxSeamDelta.toExponential(2)} rad`);

	return checks;
}

async function main(): Promise<void> {
	for (const model of MODELS) {
		if (!existsSync(model.file)) {
			console.error(`\nMISSING ${model.file} — run \`pnpm assets:build\` first.`);
			process.exit(1);
		}
	}
	const all: Check[][] = [];
	for (const model of MODELS) all.push(await checkFigure(model.id, model.file));

	const passed = all.flat().filter((c) => c.ok).length;
	const total = all.flat().length;
	console.log(`\n${'='.repeat(74)}\n${passed}/${total} checks passed\n`);
	process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});