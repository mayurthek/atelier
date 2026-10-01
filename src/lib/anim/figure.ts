import { Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { RigFrames, type PoseDeltas } from './frames.js';
import type { Pose } from './walk.js';

/**
 * Applies procedural poses to a Genesis figure.
 *
 * The subtle part is ordering. three.js composes a bone's world transform as
 * `parentWorld * local`, so to land a bone at a desired *world* rotation the
 * parent's **current** world rotation must be known — not its bind-pose one.
 * Bones must therefore be processed parent-before-child, refreshing matrices as
 * it goes.
 *
 * An earlier version used `parentRestWorld` and processed bones in arbitrary
 * map order. Both are wrong in the same direction: the parent override cancels
 * the ancestor chain, so every bone becomes independent of its parent and the
 * figure folds in on itself — hips rotating a full turn below the waist. The
 * gait looked plausible as joint curves but was 2.4 m of head bob.
 */
export class FigureRig {
	private readonly bindFrames: RigFrames;
	/** Animated bones, ordered parent-before-child. */
	private readonly ordered: Object3D[] = [];
	private readonly byName = new Map<string, Object3D>();
	private readonly _parentWorld = new Quaternion();
	private readonly _local = new Quaternion();
	private readonly _offset = new Vector3();
	private readonly _travel = new Vector3();
	/**
	 * Transform that converts a world-space offset into the root's parent space.
	 *
	 * Two traps here, both hit during this build:
	 *
	 * 1. Scale. The wrapper node carries a 0.1 scale, which the skin's inverse
	 *    bind matrices cancel for vertices but which still scales any
	 *    translation set on `root`. A 22 mm bob arrived as 2.2 mm and read as
	 *    zero.
	 * 2. Rotation. That same wrapper node has a -90 degree X rotation, and the
	 *    root carries the matching +90 to cancel it for rotation. So local +Z is
	 *    world -Y at the root. Assigning `travelZ` to `position.z` drove the
	 *    figure 1.15 m *down* — a walk along the runway became a fall.
	 *
	 * Solving for parent space explicitly, rather than assigning an axis, keeps
	 * travel on +Z regardless of how the source file was exported.
	 */
	private readonly worldToParent = new Matrix3();
	/** Root's bind-pose position, which is NOT zero — it places the rig on the origin. */
	private rootBindPosition = new Vector3();

	constructor(scene: Object3D, animatedBones: readonly string[]) {
		const wanted = new Set(animatedBones);
		scene.updateMatrixWorld(true);
		this.bindFrames = RigFrames.capture(scene, animatedBones);

		let rootNode: Object3D | undefined;
		scene.traverse((node) => {
			if (!rootNode && node.name === 'root') rootNode = node;
		});
		if (rootNode) {
			// Genesis roots sit at roughly (0, -1.34, -8.5) to place the figure on
			// the origin. Zeroing it instead of offsetting from it throws the whole
			// body 8.5 m back down the runway.
			this.rootBindPosition.copy(rootNode.position);

			const parent = rootNode.parent;
			if (parent) {
				parent.updateWorldMatrix(true, false);
				// Invert the parent's world matrix, keep only its linear part, so a
				// world-space offset can be pushed back into parent space.
				const inverse = new Matrix4().copy(parent.matrixWorld).invert();
				this.worldToParent.setFromMatrix4(inverse);
			}
		}

		// traverse() is depth-first, so a parent is always visited before its
		// children — exactly the order needed.
		scene.traverse((node) => {
			if (wanted.has(node.name) && !this.byName.has(node.name)) {
				this.byName.set(node.name, node);
				this.ordered.push(node);
			}
		});
	}

	/** Bind-pose frames, for callers that need a joint's rest orientation. */
	frames(): RigFrames {
		return this.bindFrames;
	}

	/** Reset every animated bone to bind pose and clear any root translation. */
	reset(): void {
		for (const bone of this.ordered) {
			bone.quaternion.copy(this.bindFrames.frame(bone.name).restLocal);
		}
		const root = this.byName.get('root');
		if (root) root.position.copy(this.rootBindPosition);
	}

	/**
	 * Pose the figure.
	 *
	 * Bones absent from `pose.deltas` return to bind pose, so callers can pass a
	 * partial pose and still get a clean result rather than leftover motion from
	 * the previous frame.
	 *
	 * @param travelZ distance walked along +Z, in metres
	 */
	apply(pose: Pose, travelZ = 0): void {
		for (const bone of this.ordered) {
			const frame = this.bindFrames.frame(bone.name);
			const delta = pose.deltas.get(bone.name);
			if (!delta) {
				bone.quaternion.copy(frame.restLocal);
				bone.updateMatrixWorld(true);
				continue;
			}

			if (bone.parent) {
				bone.parent.getWorldQuaternion(this._parentWorld);
			} else {
				this._parentWorld.identity();
			}

			// world = parentWorld * local, and we want world = delta * restWorld.
			this._local.copy(this._parentWorld).invert().multiply(delta).multiply(frame.restWorld);

			bone.quaternion.copy(this._local);
			bone.updateMatrixWorld(true);
		}

		const root = this.byName.get('root');
		if (root) {
			// Desired world-space displacement, then converted into parent space.
			this._offset
				.copy(pose.rootOffset)
				.add(this._travel.set(0, 0, travelZ))
				.applyMatrix3(this.worldToParent);
			root.position
				.copy(this.rootBindPosition)
				.add(this._offset);
			root.updateMatrixWorld(true);
		}
	}

	/** World position of a named bone. */
	worldPositionOf(name: string, into = new Vector3()): Vector3 {
		const bone = this.byName.get(name);
		if (!bone) throw new Error(`"${name}" is not an animated bone`);
		return bone.getWorldPosition(into);
	}

	/** Reset every animated bone and then apply `pose`. Convenience for loops. */
	applyDelta(deltas: PoseDeltas, travelZ = 0): void {
		this.apply({ deltas, rootOffset: new Vector3() }, travelZ);
	}
}