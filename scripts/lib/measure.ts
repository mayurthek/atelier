import { Matrix4, Quaternion, Vector3, Vector4 } from 'three';
import type { Document, Node, Root } from '@gltf-transform/core';
import {
	LANDMARK_BONES,
	BODY_REGION_NAMES,
	JOINT_TO_REGION,
	type BodyRegionName,
} from './rig.js';

export type Vec3 = [number, number, number];

/**
 * A cross-section through one body region, measured perpendicular to that
 * region's own axis.
 *
 * Each slice has a local frame: `t` runs along the limb, `a` and `b` span the
 * perpendicular plane. Torso and legs use world Y as their axis so `t` is just
 * height; arms are measured along shoulder-to-wrist instead, because a T-posed
 * arm is horizontal and would otherwise collapse into a single height band.
 */
export interface RegionSlice {
	/** distance along the region axis, from its origin, in metres */
	t: number;
	/** extents in the region's first perpendicular axis */
	minA: number;
	maxA: number;
	/** extents in the region's second perpendicular axis */
	minB: number;
	maxB: number;
	/** maxA - minA */
	width: number;
	/** maxB - minB */
	depth: number;
}

export interface FigureMetrics {
	/** source filename, for traceability */
	source: string;
	/** world-space AABB of the body mesh in bind pose */
	bounds: { min: Vec3; max: Vec3 };
	/** Y of the crown, and of the sole. height = crownY - soleY */
	crownY: number;
	soleY: number;
	height: number;
	/**
	 * Cross-sections per body region. The garment generator wraps a shell
	 * around `torso` for bodices and coats, and around `armL`/`armR`/`legL`/
	 * `legR` for sleeves and trousers.
	 */
	regions: Record<BodyRegionName, RegionSlice[]>;
	/** the axis each region was sliced along, for the garment generator */
	axes: Record<BodyRegionName, { origin: Vec3; dir: Vec3 }>;
	/** named landmark positions in bind pose */
	landmarks: Record<string, Vec3>;
	/** derived segment lengths in metres, at source scale */
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
	/**
	 * Angle of the arm away from straight-down, in degrees, measured in bind
	 * pose. ~90 means a T-pose, ~45 an A-pose. Both the walk cycle's arm swing
	 * and a garment's shoulder fit need this number rather than an assumption.
	 */
	restArmAngleDeg: number;
	/**
	 * Minimum outward angle, in degrees, at which the forearm and hand clear the
	 * torso. The walk uses this so the arms hang beside the body instead of
	 * through it.
	 */
	armAbductionDeg: number;
	/**
	 * Largest left/right discrepancy across the clavicles, shoulders, wrists and
	 * hips, in metres. A healthy rig is under a millimetre; anything larger
	 * means the mesh or skeleton is corrupt.
	 */
	maxAsymmetry: number;
	/** bind-pose joint quaternions, so the animation layer can blend from rest */
	restPoseQuaternions: Record<string, [number, number, number, number]>;
}

const TORSO_SLICES = 20;
const LIMB_SLICES = 12;

function round(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function localMatrix(node: Node): Matrix4 {
	// gltf-transform returns plain tuples ([x,y,z]), not THREE objects, so they
	// must be converted explicitly before composing.
	return new Matrix4().compose(
		new Vector3().fromArray(node.getTranslation()),
		new Quaternion().fromArray(node.getRotation()),
		new Vector3().fromArray(node.getScale()),
	);
}

/**
 * Build nodeName -> world matrix by composing every node up to the scene root.
 *
 * This is the skeleton's rest pose in scene space. Inverse bind matrices are
 * deliberately not applied: at bind pose the skinned mesh and the raw node
 * hierarchy coincide, which is exactly the frame we want to measure in.
 *
 * Accepts a glTF Root (walked via its scenes) or a bare Node as the graph root.
 */
export function computeWorldMatrices(root: Root): Map<string, Matrix4> {
	const out = new Map<string, Matrix4>();
	const visit = (node: Node, parent: Matrix4): void => {
		const world = parent.clone().multiply(localMatrix(node));
		const name = node.getName();
		if (name && !out.has(name)) out.set(name, world);
		for (const child of node.listChildren()) visit(child, world);
	};
	for (const scene of root.listScenes()) {
		for (const child of scene.listChildren()) visit(child, new Matrix4());
	}
	return out;
}

function positionOf(m: Matrix4): Vec3 {
	const p = new Vector3().setFromMatrixPosition(m);
	return [round(p.x), round(p.y), round(p.z)];
}

function dist(a: Vec3, b: Vec3): number {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	const dz = a[2] - b[2];
	return round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

interface RegionFrame {
	origin: Vector3;
	dir: Vector3;
	a: Vector3;
	b: Vector3;
}

/**
 * Per-region measurement frames.
 *
 * Torso and legs are vertical, so world Y is their axis. Arms run shoulder to
 * wrist — necessary because both figures are in a T-pose, where a horizontal
 * arm occupies a single height band and cannot be profiled by height at all.
 */
function buildFrames(landmarks: Record<string, Vec3>): Record<BodyRegionName, RegionFrame> {
	const vertical: RegionFrame = {
		origin: new Vector3(0, 0, 0),
		dir: new Vector3(0, 1, 0),
		a: new Vector3(1, 0, 0),
		b: new Vector3(0, 0, 1),
	};

	const armFrame = (side: 'L' | 'R'): RegionFrame => {
		const shoulder = landmarks[`shoulder01_${side}`];
		const wrist = landmarks[`wrist_${side}`];
		const origin = shoulder ? new Vector3(...shoulder) : new Vector3();
		const dir = wrist ? new Vector3(...wrist).sub(origin).normalize() : new Vector3(1, 0, 0);
		if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
		// Pick a stable perpendicular. Prefer world Z (front-back) so the
		// cross-section reads as thickness/width rather than an arbitrary pair.
		const seed = Math.abs(dir.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
		const a = new Vector3().crossVectors(dir, seed).normalize();
		const b = new Vector3().crossVectors(dir, a).normalize();
		return { origin, dir, a, b };
	};

	return {
		torso: vertical,
		armL: armFrame('L'),
		armR: armFrame('R'),
		legL: vertical,
		legR: vertical,
	};
}

/**
 * Cross-sections of the body mesh, split by body region.
 *
 * This is the measurement the garment generator consumes: it lofts a shell
 * around these slices, so silhouette follows the real body rather than generic
 * anthropometry — which matters because the two figures genuinely differ.
 *
 * Regions are assigned by each vertex's dominant weighted joint. Without that
 * split, the T-posed arms contaminate every slice above the hip.
 */
function buildRegions(
	document: Document,
	frames: Record<BodyRegionName, RegionFrame>,
): { regions: Record<BodyRegionName, RegionSlice[]>; min: Vector3; max: Vector3 } {
	const root = document.getRoot();
	const mesh = root.listMeshes().find((m) => /-base$/i.test(m.getName()));
	if (!mesh) throw new Error('body mesh not found for profile extraction');
	const node = root.listNodes().find((n) => n.getMesh() === mesh);
	if (!node) throw new Error(`body mesh "${mesh.getName()}" has no node`);

	/**
	 * Iterate vertices in true rendered bind-pose world space, yielding the
	 * dominant joint's region alongside each position.
	 *
	 * The mesh cannot be measured from its raw POSITION values: these figures
	 * carry a 0.1 scale on their wrapper node which the skin's inverse bind
	 * matrices already cancel, and the bones sit at a different scale and
	 * offset from the raw mesh. Reading positions directly reports a figure
	 * roughly 1/6 the intended size.
	 *
	 * This reproduces the glTF skinning formula exactly:
	 *
	 *     rendered = SUM_i  w_i * (jointWorld_i * IBM_i) * v
	 *
	 * Note there is deliberately no extra nodeWorld multiply. IBM is authored
	 * as the inverse of (meshNodeWorld * jointWorld_bind), so the mesh node's
	 * transform is already accounted for — applying it again double-counts the
	 * 0.1 scale and collapses the figure.
	 */
	const skin = root.listSkins()[0];
	if (!skin) throw new Error('body mesh has no skin');
	const ibmAccessor = skin.getInverseBindMatrices();
	if (!ibmAccessor) throw new Error('skin has no inverse bind matrices');
	const ibmArray = ibmAccessor.getArray();
	if (!ibmArray) throw new Error('inverse bind matrices have no data');

	const worldByName = computeWorldMatrices(root);
	const jointList = skin.listJoints();
	const skinMatrices: Matrix4[] = jointList.map((joint, i) => {
		const jointWorld = worldByName.get(joint.getName());
		if (!jointWorld) throw new Error(`joint "${joint.getName()}" missing from scene graph`);
		return jointWorld.clone().multiply(new Matrix4().fromArray(ibmArray, i * 16));
	});

	const jointRegion = jointList.map((joint) => JOINT_TO_REGION.get(joint.getName()) ?? null);

	const min = new Vector3(Infinity, Infinity, Infinity);
	const max = new Vector3(-Infinity, -Infinity, -Infinity);
	const p = new Vector3();
	const v4 = new Vector4();
	const acc = new Vector4();

	type Sample = { p: Vector3; region: BodyRegionName | null };
	const samples: Sample[] = [];

	for (const primitive of mesh.listPrimitives()) {
		const pos = primitive.getAttribute('POSITION');
		if (!pos) continue;
		const positionArray = pos.getArray();
		if (!positionArray) continue;

		const jointArray = primitive.getAttribute('JOINTS_0')?.getArray();
		const weightArray = primitive.getAttribute('WEIGHTS_0')?.getArray();
		const posSize = pos.getElementSize();
		const vertexCount = pos.getCount();

		for (let i = 0; i < vertexCount; i++) {
			const x = positionArray[i * posSize]!;
			const y = positionArray[i * posSize + 1]!;
			const z = positionArray[i * posSize + 2]!;
			let dominant = -1;
			let dominantWeight = -1;

			if (jointArray && weightArray) {
				acc.set(0, 0, 0, 0);
				for (let k = 0; k < 4; k++) {
					const weight = weightArray[i * 4 + k] ?? 0;
					if (weight === 0) continue;
					const index = jointArray[i * 4 + k]!;
					if (weight > dominantWeight) {
						dominantWeight = weight;
						dominant = index;
					}
					const m = skinMatrices[index];
					if (!m) continue;
					v4.set(x, y, z, 1).applyMatrix4(m);
					acc.x += v4.x * weight;
					acc.y += v4.y * weight;
					acc.z += v4.z * weight;
					acc.w += v4.w * weight;
				}
				if (acc.w !== 0) acc.multiplyScalar(1 / acc.w);
				p.set(acc.x, acc.y, acc.z);
			} else {
				p.set(x, y, z);
			}

			min.min(p);
			max.max(p);
			samples.push({ p: p.clone(), region: dominant >= 0 ? (jointRegion[dominant] ?? null) : null });
		}
	}

	const sliceCount: Record<BodyRegionName, number> = {
		torso: TORSO_SLICES,
		armL: LIMB_SLICES,
		armR: LIMB_SLICES,
		legL: LIMB_SLICES,
		legR: LIMB_SLICES,
	};

	const regions = {} as Record<BodyRegionName, RegionSlice[]>;
	const offset = new Vector3();

	for (const name of BODY_REGION_NAMES) {
		const frame = frames[name];
		const bins = sliceCount[name];

		// Pass 1: extent along the region axis.
		let tMin = Infinity;
		let tMax = -Infinity;
		for (const s of samples) {
			if (s.region !== name) continue;
			offset.copy(s.p).sub(frame.origin);
			const t = offset.dot(frame.dir);
			if (t < tMin) tMin = t;
			if (t > tMax) tMax = t;
		}
		if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) {
			regions[name] = [];
			continue;
		}
		const tSpan = Math.max(1e-6, tMax - tMin);
		const binOf = (t: number): number =>
			Math.max(0, Math.min(bins - 1, Math.floor(((t - tMin) / tSpan) * bins)));

		interface Band {
			minA: number;
			maxA: number;
			minB: number;
			maxB: number;
			count: number;
		}
		const table = new Map<number, Band>();

		// Pass 2: perpendicular extents per band.
		for (const s of samples) {
			if (s.region !== name) continue;
			offset.copy(s.p).sub(frame.origin);
			const t = offset.dot(frame.dir);
			const av = offset.dot(frame.a);
			const bv = offset.dot(frame.b);
			const bin = binOf(t);
			let band = table.get(bin);
			if (!band) {
				band = { minA: Infinity, maxA: -Infinity, minB: Infinity, maxB: -Infinity, count: 0 };
				table.set(bin, band);
			}
			if (av < band.minA) band.minA = av;
			if (av > band.maxA) band.maxA = av;
			if (bv < band.minB) band.minB = bv;
			if (bv > band.maxB) band.maxB = bv;
			band.count++;
		}

		const slices: RegionSlice[] = [];
		for (const [bin, band] of [...table.entries()].sort((x, y) => x[0] - y[0])) {
			if (band.count === 0) continue;
			slices.push({
				t: round(tMin + ((bin + 0.5) / bins) * tSpan),
				minA: round(band.minA),
				maxA: round(band.maxA),
				minB: round(band.minB),
				maxB: round(band.maxB),
				width: round(band.maxA - band.minA),
				depth: round(band.maxB - band.minB),
			});
		}
		regions[name] = slices;
	}

	return { regions, min, max };
}

export function measureFigure(document: Document, source: string): FigureMetrics {
	const root = document.getRoot();
	const skin = root.listSkins()[0];
	if (!skin) throw new Error(`${source}: no skin`);

	const world = computeWorldMatrices(root);

	const landmarks: Record<string, Vec3> = {};
	for (const name of LANDMARK_BONES) {
		const m = world.get(name);
		if (m) landmarks[name] = positionOf(m);
	}

	const restPoseQuaternions: Record<string, [number, number, number, number]> = {};
	for (const joint of skin.listJoints()) {
		const q = new Quaternion().fromArray(joint.getRotation());
		restPoseQuaternions[joint.getName()] = [round(q.x), round(q.y), round(q.z), round(q.w)];
	}

	const frames = buildFrames(landmarks);
	const { regions, min, max } = buildRegions(document, frames);

	const seg = (a: string, b: string): number => {
		const pa = landmarks[a];
		const pb = landmarks[b];
		return pa && pb ? dist(pa, pb) : 0;
	};

	let restArmAngleDeg = 0;
	const sh = landmarks['shoulder01_L'];
	const wr = landmarks['wrist_L'];
	if (sh && wr) {
		const horiz = Math.hypot(wr[0] - sh[0], wr[2] - sh[2]);
		const vert = Math.abs(wr[1] - sh[1]);
		restArmAngleDeg = round((Math.atan2(horiz, vert) * 180) / Math.PI);
	}

	/**
 * Minimum arm abduction for the hand to clear the body.
 *
 * The shoulder joint sits at roughly x=0.10 m, but the torso is up to 0.31 m
 * wide at the waist. An arm dropped to *exactly* vertical therefore hangs
 * straight through the body: measured on the shipped figures, the elbow landed
 * 5.6 cm inside the male torso and 7.2 cm inside the female's, so the forearm and
 * hand vanished into the silhouette and only the shoulder read.
 *
 * Real arms hang slightly outboard for exactly this reason. The angle is solved
 * rather than dialled in by hand, because it depends on proportions that differ
 * between the figures — the female has narrower shoulders and a wider ribcage,
 * so she needs a larger angle than the male.
 *
 * Only the region *below the elbow* constrains the angle. The upper arm touching
 * the ribcage at the armpit is anatomy, not a bug; forcing clearance there would
 * demand a 40 degree splay.
 */
function solveArmAbduction(
	regions: Record<BodyRegionName, RegionSlice[]>,
	landmarks: Record<string, Vec3>,
	upperArmLength: number,
): number {
	/**
	 * Clearance wanted between the hand and the body, in metres. Generous: a
	 * hand tucked against the hip reads as a mitten in the body's own silhouette.
	 */
	const HAND_MARGIN = 0.045;
	/**
	 * Clearance wanted at the elbow. Much smaller on purpose — the upper arm
	 * resting against the ribcage is anatomy, and demanding a hand-sized gap
	 * there produces a chicken-wing. Enough that the elbow reads as its own form
	 * rather than dissolving into the torso.
	 */
	const ELBOW_MARGIN = 0.02;

	const shoulder = landmarks['shoulder01_L'];
	if (!shoulder || !(upperArmLength > 0)) return 8;
	const [shoulderX, shoulderY] = shoulder;
	const originX = Math.abs(shoulderX);

	// Torso half-width at a given height, or 0 below the measured range.
	const halfWidthAt = (t: number): number => {
		let best = 0;
		for (const slice of regions.torso) {
			if (Math.abs(slice.t - t) < 0.06) best = Math.max(best, slice.width / 2);
		}
		return best;
	};

	// A point at distance d along the arm sits at x = originX + d*sin(a) and
	// y = shoulderY - d*cos(a), so clearing a slice at height t needs
	// tan(a) > (halfWidth + margin - originX) / (shoulderY - t).
	//
	// The elbow's own height depends on the angle, so both constraints are
	// re-evaluated each pass until they settle.
	let tan = 0;
	for (let pass = 0; pass < 4; pass++) {
		const angle = Math.atan(tan);
		const elbowY = shoulderY - upperArmLength * Math.cos(angle);
		const elbowX = originX + upperArmLength * Math.sin(angle);

		// Elbow clears its own height.
		const elbowNeed = halfWidthAt(elbowY) + ELBOW_MARGIN - elbowX;
		if (elbowNeed > 0) {
			// Widening the elbow means widening every point below it, so fold the
			// shortfall into tan via the elbow's own leverage arm.
			tan += elbowNeed / Math.max(0.05, upperArmLength);
		}

		// Forearm and hand clear everything below the elbow.
		for (const slice of regions.torso) {
			if (slice.t > elbowY || slice.t < 0.2) continue;
			const need = slice.width / 2 + HAND_MARGIN - originX;
			const drop = shoulderY - slice.t;
			if (drop <= 1e-3) continue;
			tan = Math.max(tan, need / drop);
		}
	}

	const degrees = (Math.atan(Math.max(0, tan)) * 180) / Math.PI;
	// Clamped: below 4 the arm grazes the hip, above 22 it reads as a puppet.
	return Math.round(Math.min(22, Math.max(4, degrees)) * 100) / 100;
}

// Left/right rig symmetry. Only X is mirrored across the body; Y and Z should
// match between sides. Limbs legitimately sit off-centre, so the test is
// whether each pair is symmetric *about* the axis, not whether either joint
// sits on it.
	const MIRRORED = [
		['clavicle_L', 'clavicle_R'],
		['shoulder01_L', 'shoulder01_R'],
		['wrist_L', 'wrist_R'],
		['upperleg01_L', 'upperleg01_R'],
		['foot_L', 'foot_R'],
	] as const;
	let maxAsymmetry = 0;
	for (const [l, r] of MIRRORED) {
		const pl = landmarks[l];
		const pr = landmarks[r];
		if (!pl || !pr) continue;
		maxAsymmetry = Math.max(
			maxAsymmetry,
			Math.abs(pl[0] + pr[0]),
			Math.abs(pl[1] - pr[1]),
			Math.abs(pl[2] - pr[2]),
		);
	}

	return {
		source,
		bounds: {
			min: [round(min.x), round(min.y), round(min.z)],
			max: [round(max.x), round(max.y), round(max.z)],
		},
		crownY: round(max.y),
		soleY: round(min.y),
		height: round(max.y - min.y),
		regions,
		axes: Object.fromEntries(
			BODY_REGION_NAMES.map((name) => [
				name,
				{
					origin: [round(frames[name].origin.x), round(frames[name].origin.y), round(frames[name].origin.z)],
					dir: [round(frames[name].dir.x), round(frames[name].dir.y), round(frames[name].dir.z)],
				},
			]),
		) as Record<BodyRegionName, { origin: Vec3; dir: Vec3 }>,
		landmarks,
		segments: {
			upperArm: seg('shoulder01_L', 'lowerarm01_L'),
			forearm: seg('lowerarm01_L', 'wrist_L'),
			shoulderToWrist: seg('shoulder01_L', 'wrist_L'),
			thigh: seg('upperleg01_L', 'lowerleg01_L'),
			shin: seg('lowerleg01_L', 'foot_L'),
			foot: seg('foot_L', 'toe1-1_L'),
			spine: seg('spine01', 'spine05'),
			neck: seg('spine05', 'neck01'),
			shoulderWidth: dist(landmarks['shoulder01_L']!, landmarks['shoulder01_R']!),
			hipWidth: dist(landmarks['upperleg01_L']!, landmarks['upperleg01_R']!),
		},
		restArmAngleDeg,
		armAbductionDeg: solveArmAbduction(
			regions,
			landmarks,
			seg('shoulder01_L', 'lowerarm01_L'),
		),
		maxAsymmetry: round(maxAsymmetry),
		restPoseQuaternions,
	};
}