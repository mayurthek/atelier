import { Object3D, Quaternion } from 'three';
import type { BodyRegionName } from './rig-types';

/**
 * Bind-pose frame for one bone.
 *
 * Animation in ATELIER is expressed as *world-axis rotations relative to the
 * bind pose*, never as raw local euler angles. That indirection is what makes
 * procedural gait portable across both figures: their bind quaternions differ
 * (the legs carry large Y rotations), so a local-space walk authored for one
 * would point the other's shins sideways. Working in world axes means the same
 * curve produces the same world-space swing on any rig.
 */
export interface BoneFrame {
	readonly name: string;
	/** bind-pose local rotation */
	readonly restLocal: Quaternion;
	/** bind-pose world rotation of this bone's parent, or identity for a root */
	readonly parentRestWorld: Quaternion;
	/** bind-pose world rotation of this bone */
	readonly restWorld: Quaternion;
}

/**
 * Bind-pose frames for the bones the animation layer drives.
 *
 * Capture happens once, before any pose is applied. Applying a delta is then
 * pure quaternion arithmetic with no scene traversal, which keeps the animation
 * layer testable headlessly.
 */
export class RigFrames {
	private readonly frames = new Map<string, BoneFrame>();

	private constructor(frames: Map<string, BoneFrame>) {
		this.frames = frames;
	}

	/**
	 * Capture frames for `boneNames` by walking `root`'s live hierarchy.
	 *
	 * `root` must already have had `updateMatrixWorld(true)` called so world
	 * matrices reflect bind pose.
	 */
	static capture(root: Object3D, boneNames: readonly string[]): RigFrames {
		const wanted = new Set(boneNames);
		const byName = new Map<string, Object3D>();
		root.traverse((node) => {
			if (node.name && wanted.has(node.name) && !byName.has(node.name)) byName.set(node.name, node);
		});

		const frames = new Map<string, BoneFrame>();
		for (const [name, bone] of byName) {
			const parentWorld = new Quaternion();
			if (bone.parent) bone.parent.getWorldQuaternion(parentWorld);
			frames.set(name, {
				name,
				restLocal: bone.quaternion.clone(),
				parentRestWorld: parentWorld,
				restWorld: bone.getWorldQuaternion(new Quaternion()),
			});
		}

		if (frames.size !== wanted.size) {
			const missing = [...wanted].filter((n) => !frames.has(n));
			throw new Error(`rig is missing ${frames.size === 0 ? 'all' : missing.length} bone(s): ${missing.slice(0, 6).join(', ')}`);
		}
		return new RigFrames(frames);
	}

	frame(name: string): BoneFrame {
		const frame = this.frames.get(name);
		if (!frame) throw new Error(`no bind frame captured for "${name}"`);
		return frame;
	}

	has(name: string): boolean {
		return this.frames.has(name);
	}

	/** Every bone that was captured, in capture order. */
	names(): string[] {
		return [...this.frames.keys()];
	}

	/**
	 * Convert a world-axis rotation delta into the bone's local rotation.
	 *
	 * three.js composes a bone's actual world rotation as
	 * `parentActualWorld * boneLocal`. We want that to equal
	 * `delta * restWorld`. Solving for boneLocal:
	 *
	 *     boneLocal = parentRestWorld^-1 * delta * restWorld
	 *
	 * Note `parentRestWorld` rather than the parent's *current* world rotation.
	 * Using the current one would make every bone override its ancestors'
	 * rotation and flatten the chain. The parent's live rotation still applies
	 * through normal three.js hierarchy composition, which is exactly what we
	 * want — rotating the hip should carry the knee with it.
	 */
	localFor(name: string, delta: Quaternion): Quaternion {
		const { parentRestWorld, restWorld } = this.frame(name);
		return parentRestWorld.clone().invert().multiply(delta).multiply(restWorld);
	}
}

/** Per-bone world-axis deltas, keyed by bone name. */
export type PoseDeltas = ReadonlyMap<string, Quaternion>;

/**
 * Blend two delta sets. Used to cross-fade walk <-> idle <-> pose without a
 * pop, which matters because §26 asks for deliberate rather than snappy motion.
 */
export function blendDeltas(a: PoseDeltas, b: PoseDeltas, t: number): PoseDeltas {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const out = new Map<string, Quaternion>();
	const names = new Set<string>([...a.keys(), ...b.keys()]);
	for (const name of names) {
		const qa = a.get(name);
		const qb = b.get(name);
		if (qa && qb) out.set(name, qa.clone().slerp(qb, t));
		else if (qb) out.set(name, qb.clone().slerp(IDENTITY, 1 - t));
		else if (qa) out.set(name, qa.clone().slerp(IDENTITY, t));
	}
	return out;
}

const IDENTITY = new Quaternion();

/** Bones driven by the walk cycle, grouped for readability. */
export const LEG_BONES = {
	hipL: 'upperleg01_L',
	kneeL: 'lowerleg01_L',
	ankleL: 'foot_L',
	toeL: 'toe1-1_L',
	hipR: 'upperleg01_R',
	kneeR: 'lowerleg01_R',
	ankleR: 'foot_R',
	toeR: 'toe1-1_R',
} as const satisfies Record<string, string>;

export const ARM_BONES = {
	clavicleL: 'clavicle_L',
	shoulderL: 'shoulder01_L',
	upperArmL: 'upperarm01_L',
	upperArmMidL: 'upperarm02_L',
	forearmL: 'lowerarm01_L',
	forearmMidL: 'lowerarm02_L',
	wristL: 'wrist_L',
	clavicleR: 'clavicle_R',
	shoulderR: 'shoulder01_R',
	upperArmR: 'upperarm01_R',
	upperArmMidR: 'upperarm02_R',
	forearmR: 'lowerarm01_R',
	forearmMidR: 'lowerarm02_R',
	wristR: 'wrist_R',
} as const satisfies Record<string, string>;

/**
 * Joints from humerus head to wrist, per side.
 *
 * The chain has six joints between clavicle and wrist, not two. Lowering the arms
 * requires rotating *every* joint in the chain by the same amount: each joint's
 * bind rotation is relative to its parent, so rotating one joint swings only that
 * segment and leaves the forearm pointing outward. Rotating the whole chain
 * uniformly treats the arm as a rigid unit, which is what a T-pose to arms-down
 * change actually is.
 *
 * The chain deliberately starts at `upperarm01` — the humerus head — and not at
 * `shoulder01`, which is the acromion on the outer end of the clavicle. Those two
 * joints are 8.6 cm apart on the male figure and 7.5 cm on the female, and that
 * gap is the whole shoulder. Pivoting at the acromion swings the deltoid down and
 * inward with the arm, costing roughly 53% of the shoulder's breadth and leaving
 * the arms reading as though they grew out of the neck. Pivoting at the humerus
 * head leaves `clavicle` and `shoulder01` at bind, so the deltoid stays draped
 * over the shoulder while the arm swings down from it — which is also where a
 * humerus head actually sits, lateral to the acromion.
 */
export const ARM_CHAIN_L: readonly string[] = [
	ARM_BONES.upperArmL,
	ARM_BONES.upperArmMidL,
	ARM_BONES.forearmL,
	ARM_BONES.forearmMidL,
	ARM_BONES.wristL,
];

export const ARM_CHAIN_R: readonly string[] = [
	ARM_BONES.upperArmR,
	ARM_BONES.upperArmMidR,
	ARM_BONES.forearmR,
	ARM_BONES.forearmMidR,
	ARM_BONES.wristR,
];

export const SPINE_BONES = [
	'spine01', 'spine02', 'spine03', 'spine04', 'spine05',
	'neck01', 'neck02', 'neck03', 'head',
] as const satisfies readonly string[];

/**
 * Everything the animation layer may touch, capture is by name.
 *
 * `root` is included because it carries the vertical bob and the distance
 * walked along the runway — both of which are translations, so it needs a
 * captured frame to reset cleanly between poses.
 */
export const ANIMATED_BONES: readonly string[] = [
	'root',
	...SPINE_BONES,
	...Object.values(LEG_BONES),
	...Object.values(ARM_BONES),
];

export type { BodyRegionName };