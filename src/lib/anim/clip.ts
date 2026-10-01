import { Quaternion, Vector3 } from 'three';
import {
	ARM_BONES,
	ARM_CHAIN_L as ARM_CHAIN_L_ALL,
	ARM_CHAIN_R as ARM_CHAIN_R_ALL,
	LEG_BONES,
	SPINE_BONES,
	type PoseDeltas,
} from './frames.js';
import type { Pose } from './walk.js';

/**
 * Idle, turn and pose states for the runway.
 *
 * §16 lists five beats per look — entrance, walk, pause, turn, exit — and only
 * the walk is cyclic. These are the static or near-static poses that bracket it.
 * All are authored the same way as the walk: world-axis deltas over bind pose.
 */

const DEG = Math.PI / 180;

/** Neutral standing pose. Weight settles onto one hip, the classic contrapposto. */
export function idlePose(elapsed = 0, restArmAngle = 88.86, weightShift = 0.012): Pose {
	const breath = Math.sin(elapsed * 0.9) * 0.5 + 0.5;
	const sway = Math.sin(elapsed * 0.55);

	const deltas = new Map<string, Quaternion>();
	const set = (bone: string, q: Quaternion): void => {
		deltas.set(bone, q);
	};

	// Pelvis tilts toward the weight-bearing side; shoulders counter-tilt.
	set('spine01', axisAngle(0, 0, 1, -2.2).multiply(axisAngle(1, 0, 0, -1.2)));
	set('spine03', axisAngle(0, 0, 1, 1.4));
	set('spine04', axisAngle(0, 1, 0, sway * 1.6));
	// Chest rises and falls with the breath.
	set('spine05', axisAngle(1, 0, 0, breath * 1.1));
	set('neck01', axisAngle(1, 0, 0, -breath * 0.8));
	// The head stills the torso — counter-rotation, as in a real standing figure.
	set('head', axisAngle(0, 0, 1, -1.0).multiply(axisAngle(1, 0, 0, 2.0 - breath * 0.6)));

	// Arms hang at the sides. `restArmAngle` is the drop magnitude that takes them
	// there from bind pose, so idle and the walk agree and blending between them
	// does not move the wrists.
	for (const bone of ARM_CHAIN_L_ALL) set(bone, axisAngle(0, 0, 1, -restArmAngle));
	for (const bone of ARM_CHAIN_R_ALL) set(bone, axisAngle(0, 0, 1, restArmAngle));
	set(ARM_BONES.forearmL, axisAngle(0, 0, 1, -restArmAngle).multiply(axisAngle(1, 0, 0, -16)));
	set(ARM_BONES.forearmR, axisAngle(0, 0, 1, restArmAngle).multiply(axisAngle(1, 0, 0, -16)));

	// Weight on the left leg, right knee soft.
	set(LEG_BONES.hipR, axisAngle(1, 0, 0, 3));
	set(LEG_BONES.kneeR, axisAngle(1, 0, 0, -6));

	for (const bone of SPINE_BONES) if (!deltas.has(bone)) set(bone, new Quaternion());

	return { deltas, rootOffset: new Vector3(weightShift, breath * 0.004, 0) };
}

/**
 * The pose at the end of the runway: the model stops and turns.
 *
 * `progress` 0..1 rotates through roughly 120 degrees so the figure presents
 * itself to the audience, which is the beat the pause in §16 is describing.
 */
export function turnPose(progress: number, restArmAngle = 88.86): Pose {
	const t = Math.max(0, Math.min(1, progress));
	const eased = ease(t);
	const yaw = eased * 120;

	const deltas = new Map<string, Quaternion>();
	const set = (bone: string, q: Quaternion): void => {
		deltas.set(bone, q);
	};

	// Pivot from the hips, with the chest leading slightly.
	set('spine01', axisAngle(0, 1, 0, yaw * 0.35));
	set('spine03', axisAngle(0, 1, 0, yaw * 0.3));
	set('spine04', axisAngle(0, 1, 0, yaw * 0.25));
	// Head settles last, looking out at the audience.
	set('head', axisAngle(0, 1, 0, yaw * 0.2));

	// Arms ease slightly away from the body as the turn opens up, so the gesture
	// reads rather than hanging inert.
	const open = eased * 8;
	const drop = restArmAngle - open;
	for (const bone of ARM_CHAIN_L_ALL) set(bone, axisAngle(0, 0, 1, -drop));
	for (const bone of ARM_CHAIN_R_ALL) set(bone, axisAngle(0, 0, 1, drop));
	set(ARM_BONES.forearmL, axisAngle(0, 0, 1, -drop).multiply(axisAngle(1, 0, 0, -20)));
	set(ARM_BONES.forearmR, axisAngle(0, 0, 1, drop).multiply(axisAngle(1, 0, 0, -20)));

	// Weight shifts onto the inside leg through the turn.
	set(LEG_BONES.hipL, axisAngle(1, 0, 0, -4));
	set(LEG_BONES.kneeL, axisAngle(1, 0, 0, -8));
	set(LEG_BONES.hipR, axisAngle(1, 0, 0, 2));

	for (const bone of SPINE_BONES) if (!deltas.has(bone)) set(bone, new Quaternion());

	// A slight settle downward as the figure comes to rest.
	return { deltas, rootOffset: new Vector3(0, -eased * 0.012, 0) };
}

/**
 * The entrance beat at the top of the runway.
 *
 * `restArmAngle` is a rotation *magnitude*: the figure's arms sit out at that
 * angle in bind pose, so rotating the whole chain by it brings them to the sides.
 * Anchoring `progress = 0` to zero therefore starts exactly at bind pose, which
 * is what stops the model snapping from a T-pose on the show's first frame.
 */
export function entrancePose(progress: number, restArmAngle = 88.86): Pose {
	const t = Math.max(0, Math.min(1, progress));
	const deltas = new Map<string, Quaternion>();
	const set = (bone: string, q: Quaternion): void => {
		deltas.set(bone, q);
	};

	// Arms sweep from bind (0) down to the sides (restArmAngle).
	const drop = ease(t) * restArmAngle;
	for (const bone of ARM_CHAIN_L_ALL) set(bone, axisAngle(0, 0, 1, -drop));
	for (const bone of ARM_CHAIN_R_ALL) set(bone, axisAngle(0, 0, 1, drop));
	const bend = -(6 + 12 * ease(t));
	set(ARM_BONES.forearmL, axisAngle(0, 0, 1, -drop).multiply(axisAngle(1, 0, 0, bend)));
	set(ARM_BONES.forearmR, axisAngle(0, 0, 1, drop).multiply(axisAngle(1, 0, 0, bend)));

	set('spine01', axisAngle(1, 0, 0, -2));
	set('head', axisAngle(1, 0, 0, 3));

	for (const bone of SPINE_BONES) if (!deltas.has(bone)) set(bone, new Quaternion());
	return { deltas, rootOffset: new Vector3() };
}

function ease(t: number): number {
	const c = Math.max(0, Math.min(1, t));
	return c * c * (3 - 2 * c);
}

/** Cross-fade between two poses. `t` of 0 returns `a`, 1 returns `b`. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
	const k = Math.max(0, Math.min(1, t));
	if (k <= 0) return a;
	if (k >= 1) return b;

	const deltas = new Map<string, Quaternion>();
	const names = new Set<string>([...a.deltas.keys(), ...b.deltas.keys()]);
	for (const name of names) {
		const qa = a.deltas.get(name);
		const qb = b.deltas.get(name);
		if (qa && qb) deltas.set(name, qa.clone().slerp(qb, k));
		else if (qb) deltas.set(name, new Quaternion().slerp(qb, k));
		else if (qa) deltas.set(name, qa.clone().slerp(new Quaternion(), k));
	}

	return {
		deltas,
		rootOffset: a.rootOffset.clone().lerp(b.rootOffset, k),
	};
}

/** Axis-angle quaternion helper, in degrees, for readability at the call sites. */
function axisAngle(x: number, y: number, z: number, degrees: number): Quaternion {
	const half = (degrees * DEG) / 2;
	const s = Math.sin(half);
	return new Quaternion(x * s, y * s, z * s, Math.cos(half));
}

export type { PoseDeltas };