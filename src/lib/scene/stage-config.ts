import { Vector3 } from 'three';

/**
 * Runway geometry and staging.
 *
 * All dimensions in metres, matching the measured figures (~1.63 m tall). The
 * runway is 14 m to match `DEFAULT_CONFIG.runwayLength` in the show director, so
 * the model reaches the mark exactly as its walk ends.
 */

export const RUNWAY = {
	length: 14,
	width: 3.2,
	/** how far the audience sits from the runway centreline, per side */
	audienceOffset: 4.4,
	/** rows of seated silhouettes */
	rows: 5,
	/** seats per row, per side */
	perRow: 14,
	/** camera height — seated eye level, per §17 AUDIENCE */
	seatedEyeHeight: 1.18,
	/** where the audience camera sits, at the near end */
	audienceZ: -1.2,
	/** Z at which the model stops and turns */
	markZ: 13.2,
} as const;

/** §25 palette. Charcoal environment, warm white type, one restrained accent. */
export const PALETTE = {
	background: '#080808',
	surface: '#151515',
	warmWhite: '#e8e2d4',
	paper: '#d9d2c2',
	accent: '#c9a227',
} as const;

/**
 * Lighting rig from §12: stage lighting with a single shadow-casting key.
 *
 * Levels were set by sampling the rendered framebuffer, not by eye. The first
 * pass had the runway floor reading brighter than the figure — a mirror-like
 * material under a 2.6-intensity key blew the catwalk out at ~230/255 and
 * inverted the read: the brightest thing on screen was the floor, not the
 * garment. A runway is a dark room with one thing lit in it, so the floor is now
 * deliberately matte and the key is dialled back.
 */
export const LIGHTING = {
	/** key light, the only shadow caster */
	key: { position: new Vector3(3.2, 6.4, 4.5), intensity: 1.45, colour: '#fff4e0' },
	/** cool fill from the opposite side, stops the shadow side going black */
	fill: { position: new Vector3(-4.5, 3.8, 6.0), intensity: 0.32, colour: '#8fa6c4' },
	/** back rim, separates the figure from the dark stage */
	rim: { position: new Vector3(0, 3.4, 15.5), intensity: 0.9, colour: '#e6ddc8' },
	ambient: 0.09,
	/** one shadow-casting light only — §32 performance */
	shadowMapSize: 2048,
} as const;

/** Atmospheric haze from §12. Fog also hides the far end of the runway. */
export const ATMOSPHERE = {
	colour: '#0a0a0c',
	/** exponential density; tuned so the far mark is visible but hazy */
	density: 0.028,
} as const;

/**
 * A camera pose from §17.
 *
 * Position and target each decide independently whether they are a fixed seat in
 * the room or an offset from the model. They cannot be one flag, because the
 * states split three ways:
 *
 * - AUDIENCE   fixed seat, fixed target. Sits and watches the model come to it.
 * - MODEL      *same* fixed seat, but a following target — §17 says "camera
 *              remains stationary while the model approaches", so only the aim
 *              tracks. Collapsing these into one flag made MODEL's position track
 *              too, which is precisely the spectator violation §17 forbids.
 * - TRACK      fixed seat with a slight drift, following target. The camera stays
 *              put; the gaze follows.
 * - INSPECT    following position *and* target — this one does travel.
 * - MACRO      following position and target.
 * - ARCHIVE    fixed position, fixed target. Leaving the room behind.
 */
export interface CameraPose {
	/** camera position, in world space or relative to the model */
	position: Vector3;
	/** look-at point, in world space or relative to the model */
	target: Vector3;
	/** whether `position` is an offset from the model rather than a fixed seat */
	positionFollowsModel: boolean;
	/** whether `target` is an offset from the model rather than a fixed point */
	targetFollowsModel: boolean;
	/** vertical field of view in degrees */
	fov: number;
}

const MODEL_HEIGHT = 1.63;
/** roughly chest height on the figure */
const MODEL_CHEST = MODEL_HEIGHT * 0.72;

export const CAMERA_POSES = {
	/**
	 * AUDIENCE — §17: "Stationary, human eye level." A person sitting at the end
	 * of the runway. It does not move for the walk; the model comes to it. This
	 * is the state that enforces product principle 02.
	 *
	 * Position is on the centreline but *behind* the runway end (z < 0), so it is
	 * not standing on the catwalk — it is in the front row.
	 */
	AUDIENCE: {
		position: new Vector3(0, RUNWAY.seatedEyeHeight, RUNWAY.audienceZ),
		target: new Vector3(0, MODEL_CHEST, RUNWAY.markZ * 0.6),
		positionFollowsModel: false,
		targetFollowsModel: false,
		fov: 32,
	},
	/**
	 * TRACK — "Subtle focus tracking." The camera stays seated and only the gaze
	 * follows the model, which reads as a spectator watching with their eyes
	 * rather than a tripod panning.
	 */
	TRACK: {
		position: new Vector3(0.35, RUNWAY.seatedEyeHeight + 0.06, RUNWAY.audienceZ),
		target: new Vector3(0, MODEL_CHEST, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		fov: 30,
	},
	/**
	 * MODEL — §17: "Camera remains stationary while the model approaches."
	 *
	 * Same seat as AUDIENCE, with a following target and a longer lens. The
	 * position flag matters here: if it followed the model the camera would track
	 * the walk, which is exactly what this state forbids.
	 */
	MODEL: {
		position: new Vector3(0, RUNWAY.seatedEyeHeight, RUNWAY.audienceZ),
		target: new Vector3(0, MODEL_CHEST, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		fov: 26,
	},
	/**
	 * INSPECT — §17: "Camera moves toward the garment." The first state where the
	 * camera genuinely travels. Framed on the torso, close enough to read
	 * construction, but still outside the figure so the silhouette stays intact.
	 */
	INSPECT: {
		position: new Vector3(1.15, 1.35, 2.1),
		target: new Vector3(0, MODEL_CHEST, 0),
		positionFollowsModel: true,
		targetFollowsModel: true,
		fov: 30,
	},
	/** MACRO — §17: "Extreme garment/material close-up." */
	MACRO: {
		position: new Vector3(0.42, 1.28, 0.85),
		target: new Vector3(0, MODEL_CHEST, 0),
		positionFollowsModel: true,
		targetFollowsModel: true,
		fov: 22,
	},
	/**
	 * ARCHIVE — §17: "Transition from 3D space into archival material." Pulls
	 * back and up, so the 3D scene reads as an exhibit being left behind.
	 */
	ARCHIVE: {
		position: new Vector3(-1.8, 2.4, -2.6),
		target: new Vector3(0, MODEL_HEIGHT * 0.5, 4),
		positionFollowsModel: false,
		targetFollowsModel: false,
		fov: 38,
	},
} as const satisfies Record<string, CameraPose>;

export type CameraPoseName = keyof typeof CAMERA_POSES;

/**
 * §26 motion: slow, cinematic, physical. Shared easing so every transition in
 * the product feels like it belongs to the same hand.
 */
export const MOTION = {
	/** seconds for a camera state change — slow enough to feel deliberate */
	cameraTransition: 1.6,
	/** seconds for the INSPECT dolly, which travels furthest */
	inspectTransition: 2.1,
	/** focus pull when the model reaches the mark */
	focusPull: 0.9,
	/** UI fade */
	fade: 0.45,
} as const;

export function easeInOut(t: number): number {
	const c = Math.max(0, Math.min(1, t));
	return c * c * (3 - 2 * c);
}

/** Frame-rate independent smoothing. `lambda` is roughly "how fast", per second. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
	return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function dampVector(current: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
	return current.lerp(target, 1 - Math.exp(-lambda * dt));
}