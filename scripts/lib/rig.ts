/**
 * Humanoid rig contract.
 *
 * Our two source figures — ASIAN MAN and AFRICA WOMAN — were exported from
 * Blender and share an identical 163-joint hierarchy: same names, same order.
 * That is the single most valuable property of these assets, because it means
 * every animation clip authored against one figure is valid on the other.
 *
 * This file hardcodes the contract deliberately. If a future asset arrives with
 * different bones, `verifyRig()` must fail loudly rather than silently
 * producing a figure that animates in half its limbs.
 */

/** All 163 joint names, in skin.joints order. Verified against male_raw.glb. */
export const RIG_JOINTS = [
	'root',
	'spine05', 'spine04', 'spine03', 'spine02', 'breast_L', 'breast_R', 'spine01',
	'clavicle_L', 'shoulder01_L', 'upperarm01_L', 'upperarm02_L', 'lowerarm01_L', 'lowerarm02_L', 'wrist_L',
	'finger1-1_L', 'finger1-2_L', 'finger1-3_L', 'metacarpal1_L',
	'finger2-1_L', 'finger2-2_L', 'finger2-3_L', 'metacarpal2_L',
	'finger3-1_L', 'finger3-2_L', 'finger3-3_L', 'metacarpal3_L',
	'finger4-1_L', 'finger4-2_L', 'finger4-3_L', 'metacarpal4_L',
	'finger5-1_L', 'finger5-2_L', 'finger5-3_L',
	'clavicle_R', 'shoulder01_R', 'upperarm01_R', 'upperarm02_R', 'lowerarm01_R', 'lowerarm02_R', 'wrist_R',
	'finger1-1_R', 'finger1-2_R', 'finger1-3_R', 'metacarpal1_R',
	'finger2-1_R', 'finger2-2_R', 'finger2-3_R', 'metacarpal2_R',
	'finger3-1_R', 'finger3-2_R', 'finger3-3_R', 'metacarpal3_R',
	'finger4-1_R', 'finger4-2_R', 'finger4-3_R', 'metacarpal4_R',
	'finger5-1_R', 'finger5-2_R', 'finger5-3_R',
	'neck01', 'neck02', 'neck03', 'head',
	// 65 facial bones, indices 64..122 — present for skinning, never animated here.
	'jaw', 'special04',
	'oris02', 'oris01', 'oris06_L', 'oris07_L', 'oris06_R', 'oris07_R',
	'tongue00', 'tongue01', 'tongue02', 'tongue03', 'tongue04', 'tongue07_L', 'tongue07_R', 'tongue06_L', 'tongue06_R', 'tongue05_L', 'tongue05_R',
	'levator02_L', 'levator03_L', 'levator04_L', 'levator05_L',
	'levator02_R', 'levator03_R', 'levator04_R', 'levator05_R',
	'special01', 'oris04_L', 'oris03_L', 'oris04_R', 'oris03_R', 'oris06', 'oris05', 'special03',
	'levator06_L', 'levator06_R', 'special06_L', 'special05_L',
	'eye_L', 'orbicularis03_L', 'orbicularis04_L', 'special06_R', 'special05_R',
	'eye_R', 'orbicularis03_R', 'orbicularis04_R',
	'temporalis01_L', 'oculi02_L', 'oculi01_L', 'temporalis01_R', 'oculi02_R', 'oculi01_R',
	'temporalis02_L', 'risorius02_L', 'risorius03_L', 'temporalis02_R', 'risorius02_R', 'risorius03_R',
	'pelvis_L',
	'upperleg01_L', 'upperleg02_L', 'lowerleg01_L', 'lowerleg02_L', 'foot_L',
	'toe1-1_L', 'toe1-2_L',
	'toe2-1_L', 'toe2-2_L', 'toe2-3_L',
	'toe3-1_L', 'toe3-2_L', 'toe3-3_L',
	'toe4-1_L', 'toe4-2_L', 'toe4-3_L',
	'toe5-1_L', 'toe5-2_L', 'toe5-3_L',
	'pelvis_R',
	'upperleg01_R', 'upperleg02_R', 'lowerleg01_R', 'lowerleg02_R', 'foot_R',
	'toe1-1_R', 'toe1-2_R',
	'toe2-1_R', 'toe2-2_R', 'toe2-3_R',
	'toe3-1_R', 'toe3-2_R', 'toe3-3_R',
	'toe4-1_R', 'toe4-2_R', 'toe4-3_R',
	'toe5-1_R', 'toe5-2_R', 'toe5-3_R',
] as const;

export const RIG_JOINT_COUNT = RIG_JOINTS.length; // 163

export type Side = 'L' | 'R';

/**
 * The bones the procedural animation system drives.
 * Everything else holds its bind transform — the face stays neutral, which is
 * what we want on a runway anyway.
 */
export const ANIMATED_BONES = [
	'root',
	'spine01', 'spine02', 'spine03', 'spine04', 'spine05',
	'neck01', 'neck02', 'neck03', 'head',
	'clavicle_L', 'shoulder01_L', 'upperarm01_L', 'upperarm02_L', 'lowerarm01_L', 'lowerarm02_L', 'wrist_L',
	'clavicle_R', 'shoulder01_R', 'upperarm01_R', 'upperarm02_R', 'lowerarm01_R', 'lowerarm02_R', 'wrist_R',
	'pelvis_L', 'upperleg01_L', 'upperleg02_L', 'lowerleg01_L', 'lowerleg02_L', 'foot_L', 'toe1-1_L',
	'pelvis_R', 'upperleg01_R', 'upperleg02_R', 'lowerleg01_R', 'lowerleg02_R', 'foot_R', 'toe1-1_R',
] as const satisfies readonly string[];

/**
 * Bones sampled to derive figure metrics (see measure.ts). These become the
 * measurements the garment generator wraps geometry around, which is why they
 * are read in bind pose rather than hardcoded to anthropometric constants —
 * the two figures genuinely differ.
 */
export const LANDMARK_BONES = [
	'head', 'neck03', 'neck01',
	'spine01', 'spine02', 'spine03', 'spine04', 'spine05',
	'clavicle_L', 'clavicle_R',
	'shoulder01_L', 'shoulder01_R',
	'upperarm01_L', 'upperarm01_R',
	// `upperarm02` is the true elbow joint; `lowerarm01` is already the forearm.
	// The arm-abduction solver needs the elbow, not the forearm, to place it.
	'upperarm02_L', 'upperarm02_R',
	'lowerarm01_L', 'lowerarm01_R',
	'wrist_L', 'wrist_R',
	'pelvis_L', 'pelvis_R',
	'upperleg01_L', 'upperleg01_R',
	'lowerleg01_L', 'lowerleg01_R',
	'foot_L', 'foot_R',
	'toe1-1_L', 'toe1-1_R',
] as const satisfies readonly string[];

/** Symmetric pairs, for measurements that need left/right comparison. */
export const SYMMETRIC_PAIRS = [
	['clavicle_L', 'clavicle_R'],
	['shoulder01_L', 'shoulder01_R'],
	['wrist_L', 'wrist_R'],
	['pelvis_L', 'pelvis_R'],
	['upperleg01_L', 'upperleg01_R'],
	['foot_L', 'foot_R'],
] as const;

/**
 * Body regions, keyed by joint name.
 *
 * These figures are authored in a T-pose, so a single horizontal profile across
 * the whole mesh is useless: at shoulder height it measures the arms, not the
 * torso, and reports a 1.72 m "waist". Assigning each vertex to a region by its
 * dominant weighted joint separates the shapes a garment actually has to wrap.
 *
 * Fingers, toes, the pelvis caps and the face map to no region — nothing is
 * ever fitted to them.
 */
export const BODY_REGIONS = {
	/** ribcage, abdomen and neck base — bodices, dresses, coats, shirts */
	torso: [
		'spine01', 'spine02', 'spine03', 'spine04', 'spine05', 'breast_L', 'breast_R',
		'neck01', 'neck02', 'neck03',
	],
	armL: [
		'clavicle_L', 'shoulder01_L', 'upperarm01_L', 'upperarm02_L',
		'lowerarm01_L', 'lowerarm02_L', 'wrist_L',
	],
	armR: [
		'clavicle_R', 'shoulder01_R', 'upperarm01_R', 'upperarm02_R',
		'lowerarm01_R', 'lowerarm02_R', 'wrist_R',
	],
	legL: ['pelvis_L', 'upperleg01_L', 'upperleg02_L', 'lowerleg01_L', 'lowerleg02_L', 'foot_L'],
	legR: ['pelvis_R', 'upperleg01_R', 'upperleg02_R', 'lowerleg01_R', 'lowerleg02_R', 'foot_R'],
} as const satisfies Record<string, readonly string[]>;

export type BodyRegionName = keyof typeof BODY_REGIONS;

export const BODY_REGION_NAMES = Object.keys(BODY_REGIONS) as BodyRegionName[];

/** joint name -> region name. Finger, toe and facial bones intentionally absent. */
export const JOINT_TO_REGION: ReadonlyMap<string, BodyRegionName> = new Map(
	BODY_REGION_NAMES.flatMap((region) => BODY_REGIONS[region].map((bone) => [bone, region] as const)),
);

/**
 * Mesh nodes removed from the shipped asset.
 *
 * - casual suit / shoes: contemporary silhouette, wrong period. Procedural
 *   garments replace them, so these are dead weight (~4k tris, 3.4 MB of maps).
 * - teeth / tongue: interior geometry behind closed lips. ~4.7k tris, never
 *   visible at runway distance or during garment inspection.
 * - low_poly: a 96-vert proxy carried over from the source scene. Far too
 *   coarse to render and its intent is unknown.
 *
 * Verified post-strip that the mouth still reads closed.
 */
export const STRIP_MESH_PATTERNS = [
	/casualsuit/i,
	/shoes02/i,
	/teeth/i,
	/tongue/i,
	/low_poly/i,
] as const;

/**
 * Meshes that must survive. The body is the figure; the rest is head detail.
 * `low_poly` is a 96-vert proxy for something in the original scene and is
 * dropped — too coarse to use, and its purpose is unknown.
 */
export const KEEP_MESH_PATTERNS = [/-base$/i, /eyebrow/i, /eye/i, /short04/i, /braid01/i] as const;