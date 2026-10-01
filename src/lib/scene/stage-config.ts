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
	/**
	 * Z of the front row, beyond the far end of the catwalk.
	 *
	 * The model walks along **+Z**, so a seat at the *start* of the runway shows its
	 * back. The front row has to be at the far end, looking back up the ramp, or
	 * the walk is presented from behind.
	 */
	frontRowZ: 16.8,
	/** Z at which the model stops and turns */
	markZ: 13.2,
	/**
	 * The side seat: a front-row chair on the right-hand side of the ramp.
	 *
	 * First-person, from the row, not a floating camera — the user is a spectator
	 * in a seat watching someone walk past.
	 *
	 * `z` is late in the runway on purpose. Blends are straight lines between
	 * seats, and a side seat near the middle produced a chord that cut the near
	 * corner of the catwalk — the camera gliding over the runway edge, which is
	 * exactly the drone move product principle 02 rules out. From here the chord
	 * to the front row clears the runway without needing an exemption, and the
	 * spectator still sees the whole approach before the model passes close by.
	 */
	spectatorX: 4.2,
	spectatorZ: 10.8,
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
 * - FRONT / TRACK / MODEL / SPECTATOR
 *              fixed seat, following aim. The camera does not move; the gaze does.
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

/**
 * Where the seated cameras aim, as a fraction of the figure's own height.
 *
 * Not chest height. A seated camera at 1.18 m aiming at a chest 1.17 m up is
 * aiming almost horizontally, so as the model walks toward it the figure grows
 * downward out of the bottom of the frame — measured, the feet left the frame
 * entirely from about 11 m out, and by the mark a third of the figure was gone.
 * The framing was cropping the garment, which is the one thing this product
 * cannot afford to do.
 *
 * 0.55 keeps the whole figure in shot at every point on the walk, from 17 m to
 * the mark at 3.7 m, and still leaves headroom.
 */
const MODEL_MID = MODEL_HEIGHT * 0.55;

/**
 * The two views the product is composed around, plus the §17 states that hang off
 * them. Every camera position here is a **seat** — a fixed place in the room that
 * someone could be sitting in. The camera never travels with the model except for
 * INSPECT and MACRO, which §17 explicitly gives a dolly.
 *
 * Which way is "front" matters more than it sounds. The model walks along **+Z**
 * and faces +Z, so a camera at the near end of the ramp sees its back. A view
 * named for the audience that sits at the *start* of the runway therefore shows
 * the walk from behind, which is not a front view at all. The front row is at the
 * *far* end, looking back up the ramp.
 */
export const CAMERA_POSES = {
	/**
	 * FRONT — the primary view. Seated in the front row at the far end of the
	 * runway, the model walking toward the lens: the shot the walk is composed for.
	 *
	 * Position is a fixed seat. The *aim* follows, because a spectator's eyes track
	 * an approaching model — the camera does not move, but it does not stare at the
	 * far wall either.
	 */
	FRONT: {
		position: new Vector3(0, RUNWAY.seatedEyeHeight, RUNWAY.frontRowZ),
		target: new Vector3(0, MODEL_MID, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		// 36°, chosen against measured framing rather than by taste: at 32° the
		// figure filled 80% of frame height at the mark, which is a portrait
		// crop with the garment pressed against the edges. This keeps the whole
		// figure in shot at every point on the walk, and still fills 71% at the
		// mark — a runway full-length shot, not a close-up.
		fov: 36,
	},
	/**
	 * SPECTATOR — first-person from a seat on one side of the ramp.
	 *
	 * The user is *in* the audience: chairs either side of the catwalk, model
	 * walking down it and past. So this seat is lateral to the runway rather than
	 * on its axis, which makes the model pass in profile — the view that actually
	 * shows how a garment moves, and that a head-on shot cannot.
	 *
	 * A wider lens than the front seats, because the model crosses the frame
	 * laterally here rather than walking into it. At 42° it holds the figure at
	 * roughly half the frame height for the whole approach, which is what a person
	 * 4 m back with someone crossing in front of them actually sees.
	 */
	SPECTATOR: {
		position: new Vector3(RUNWAY.spectatorX, RUNWAY.seatedEyeHeight, RUNWAY.spectatorZ),
		target: new Vector3(0, MODEL_MID, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		fov: 42,
	},
	/**
	 * TRACK — "Subtle focus tracking." A neighbouring seat in the front row, still
	 * and still seated, with only the gaze following. Reads as a spectator watching
	 * with their eyes rather than a tripod panning.
	 */
	TRACK: {
		position: new Vector3(0.42, RUNWAY.seatedEyeHeight + 0.05, RUNWAY.frontRowZ - 0.5),
		target: new Vector3(0, MODEL_MID, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		// Matched to FRONT's framing, not tighter. A longer lens here cropped the
		// figure to 116% of frame height at the mark — a close-up of a torso,
		// which is what MODEL and INSPECT are for.
		fov: 36,
	},
	/**
	 * MODEL — §17: "Camera remains stationary while the model approaches."
	 *
	 * Same seat as FRONT, with a longer lens. The position flag matters here: if it
	 * followed the model the camera would track the walk, which is exactly what
	 * this state forbids.
	 */
	MODEL: {
		position: new Vector3(0, RUNWAY.seatedEyeHeight, RUNWAY.frontRowZ),
		target: new Vector3(0, MODEL_MID, 0),
		positionFollowsModel: false,
		targetFollowsModel: true,
		// Only *slightly* longer than FRONT. This state is used at the mark, where
		// the model is 3.7 m from the lens: at 24° the figure overflowed the frame
		// entirely, and it still clipped at 30°. 33° keeps the whole figure in shot
		// while remaining the tighter of the two front-row lenses — the compression
		// that flatters a runway shot.
		fov: 33,
	},
	/**
	 * INSPECT — §17: "Camera moves toward the garment." The first state where the
	 * camera genuinely travels. Framed on the torso, close enough to read
	 * construction, but still outside the figure so the silhouette stays intact.
	 */
	INSPECT: {
		position: new Vector3(1.15, 1.35, 2.1),
		target: new Vector3(0, MODEL_MID, 0),
		positionFollowsModel: true,
		targetFollowsModel: true,
		fov: 30,
	},
	/** MACRO — §17: "Extreme garment/material close-up." */
	MACRO: {
		position: new Vector3(0.42, 1.28, 0.85),
		target: new Vector3(0, MODEL_MID, 0),
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