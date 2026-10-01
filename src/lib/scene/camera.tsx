import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { Camera } from 'three';
import { modelFeet, useShowStore, type CameraState } from './store';
import { CAMERA_POSES, MOTION, easeInOut, type CameraPose } from './stage-config';

/**
 * Camera rig for §17.
 *
 * The product principle that matters here: **the user is a spectator, not a game
 * character.** There is no orbit control, no fly-through, no user-driven panning
 * in runway mode. The camera sits in a seat and behaves like a person in it.
 *
 * Every state change blends between two named poses on a shared easing curve, so
 * no interaction can produce an abrupt cut — which is what §26 means by motion
 * having meaning.
 */

/** A pose resolved to world space, for the model's current position. */
interface Resolved {
	position: Vector3;
	target: Vector3;
	fov: number;
}

interface RigState {
	/**
	 * World-space pose the camera is leaving from, captured at the instant of the
	 * state change while it was mid-blend. Resolving `from` from a pose name
	 * instead would snap whenever a transition was interrupted.
	 */
	from: Resolved;
	/** Named pose being blended towards. */
	to: CameraPose;
	/** 0..1 through the current transition. */
	t: number;
	/** Seconds this transition should take. */
	duration: number;
}

function makeResolved(fov: number): Resolved {
	return { position: new Vector3(), target: new Vector3(), fov };
}

// Scratch, allocated once — this runs every frame.
const sOut = new Vector3();
const sDir = new Vector3();

/**
 * Expand a pose into world space.
 *
 * Position and target resolve independently. MODEL in particular must keep a
 * fixed position while following the model with its aim — collapsing the two into
 * a single flag makes the camera travel with the walk, which §17 explicitly
 * forbids for that state.
 */
function resolveInto(pose: CameraPose, out: Resolved): Resolved {
	out.position.copy(pose.position);
	out.target.copy(pose.target);
	if (pose.positionFollowsModel || pose.targetFollowsModel) {
		// The model's *feet*, not its group origin. The rig root carries a bind
		// offset that places the body on the floor, so the group origin sits well
		// below the ground and partway back down the runway. Adding that to the aim
		// put the target most of a metre high and tipped the camera upward until
		// the figure's feet left the bottom of the frame.
		if (pose.positionFollowsModel) out.position.add(modelFeet);
		if (pose.targetFollowsModel) out.target.add(modelFeet);
	}
	out.fov = pose.fov;
	return out;
}

/** Point 12 m along the camera's view direction — a good stand-in for its target. */
function currentLookAt(camera: Camera, out: Vector3): Vector3 {
	camera.getWorldDirection(sDir);
	return out.copy(sDir).multiplyScalar(-12).add(camera.position);
}

export function CameraRig(): React.ReactElement {
	const { camera } = useThree();
	const cameraState = useShowStore((s) => s.cameraState);
	const phase = useShowStore((s) => s.phase);

	const rig = useRef<RigState>({
		from: makeResolved(CAMERA_POSES.FRONT.fov),
		to: CAMERA_POSES.FRONT,
		t: 1,
		duration: MOTION.cameraTransition,
	});
	const fov = useRef(CAMERA_POSES.FRONT.fov);
	const scratch = useRef<Resolved>(makeResolved(32));

	useEffect(() => {
		const next = CAMERA_POSES[cameraState] ?? CAMERA_POSES.FRONT;
		const s = rig.current;

		// Freeze where the camera actually is right now, mid-blend or not.
		s.from.position.copy(camera.position);
		currentLookAt(camera, s.from.target);
		s.from.fov = fov.current;

		s.to = next;
		s.t = 0;
		// INSPECT travels furthest, so it gets the longest move.
		s.duration = cameraState === 'INSPECT' ? MOTION.inspectTransition : MOTION.cameraTransition;
	}, [cameraState]);

	useFrame((_, delta) => {
		const s = rig.current;
		const dt = Math.min(delta, 0.1);

		if (s.t < 1) s.t = Math.min(1, s.t + dt / s.duration);
		const eased = easeInOut(s.t);

		// `from` is already world space and frozen; `to` follows the model.
		sOut.lerpVectors(s.from.position, resolveInto(s.to, scratch.current).position, eased);
		camera.position.copy(sOut);

		sOut.lerpVectors(s.from.target, scratch.current.target, eased);
		camera.lookAt(sOut);

		// A longer lens compresses the runway and flatters the figure — the
		// editorial look §12 asks for. Layered on the pose's own FOV.
		const targetFov = s.from.fov + (scratch.current.fov - s.from.fov) * eased;
		fov.current += (targetFov - fov.current) * (1 - Math.exp(-2.4 * dt));

		if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov.current) > 0.001) {
			camera.fov = fov.current;
			camera.updateProjectionMatrix();
		}
	});

	// §17's MODEL state is the tighter seat used as the figure nears the mark.
	// Driven from the show phase rather than a timer so it cannot drift out of
	// step with the walk.
	useEffect(() => {
		if (phase === 'turn' || phase === 'exit') {
			useShowStore.getState().setCameraState('MODEL');
		}
	}, [phase]);

	return <></>;
}

/**
 * The states, in cycling order. The first two are the two composed views —
 * FRONT is the head-on walk, SPECTATOR is the seat on the side of the ramp — and
 * the rest are the §17 states that hang off them.
 */
export const CAMERA_STATE_ORDER: CameraState[] = [
	'FRONT',
	'SPECTATOR',
	'TRACK',
	'MODEL',
	'INSPECT',
	'MACRO',
	'ARCHIVE',
];