/**
 * Shared rig vocabulary for the runtime animation layer.
 *
 * The pipeline keeps its own copy of the Genesis contract in
 * `scripts/lib/rig.ts` (it runs before the app exists and hardcodes 163 names
 * as a verification contract). This file mirrors the small subset the runtime
 * needs. Kept separate deliberately: build-time strictness vs runtime payload.
 */

/** Body regions a garment generator wraps geometry around. */
export type BodyRegionName = 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

export const BODY_REGION_NAMES: readonly BodyRegionName[] = ['torso', 'armL', 'armR', 'legL', 'legR'];

/** Which figure a set of metrics belongs to. */
export type FigureId = 'male' | 'female';

/** One cross-section through a body region, measured along that region's axis. */
export interface RegionSlice {
	/** distance along the region axis from its origin, in metres */
	t: number;
	minA: number;
	maxA: number;
	minB: number;
	maxB: number;
	width: number;
	depth: number;
}

export interface FigureMetrics {
	source: string;
	bounds: { min: [number, number, number]; max: [number, number, number] };
	crownY: number;
	soleY: number;
	height: number;
	regions: Record<BodyRegionName, RegionSlice[]>;
	axes: Record<BodyRegionName, { origin: [number, number, number]; dir: [number, number, number] }>;
	landmarks: Record<string, [number, number, number]>;
	segments: {
		upperArm: number;
		forearm: number;
		shoulderToWrist: number;
		thigh: number;
		shin: number;
		foot: number;
		spine: number;
		neck: number;
		shoulderWidth: number;
		hipWidth: number;
	};
	restArmAngleDeg: number;
	maxAsymmetry: number;
	restPoseQuaternions: Record<string, [number, number, number, number]>;
}

export type FigureMetricsMap = Record<FigureId, FigureMetrics>;