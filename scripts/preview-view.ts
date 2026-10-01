/**
 * Render what a camera state actually sees.
 *
 *   npm run anim:arms -- male idle --view=FRONT
 *
 * The silhouette inspector answers "does the arm clear the body". This answers the
 * harder question: **which way is the camera facing relative to the model** —
 * front, three-quarter, or the back of a model walking away.
 *
 * It builds the real `CameraPose` from `stage-config`, runs the model's bind
 * transform through the same world-axis pose code the app uses, and projects
 * through a perspective matrix built from the pose's own FOV. What comes out is
 * what that camera state frames, to scale.
 *
 * Offline rather than screenshotted: the dev tab does not reliably keep
 * `visibilityState: 'visible'`, and without it `requestAnimationFrame` never
 * fires, so the render loop never produces a frame to capture.
 */

import { Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { ANIMATED_BONES } from '../src/lib/anim/frames';
import { FigureRig } from '../src/lib/anim/figure';
import { walkPose, RUNWAY_WALK } from '../src/lib/anim/walk';
import { idlePose } from '../src/lib/anim/clip';
import { loadModelForAnimation } from './load-model';
import params from '../src/lib/scene/figure-params.json';
import { CAMERA_POSES, type CameraPose } from '../src/lib/scene/stage-config';

const COLS = 120;
const ROWS = 44;

/**
 * Height of the character cell, as a multiple of its width.
 *
 * Terminal cells are about twice as tall as they are wide, so a square-pixel
 * projection squashes the figure to a third of its height and it reads as a
 * smudge. Lining the rows out at this ratio restores the figure's proportions.
 */
const CELL_ASPECT = 2.0;

interface Entry {
	geometry: BufferGeometry;
	bindMatrix: Matrix4;
	boneInverses: Matrix4[];
	boneList: { name: string; matrixWorld: Matrix4 }[];
}

function inTriangle(px: number, py: number, a: Vertex, b: Vertex, c: Vertex): boolean {
	const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
	if (Math.abs(d) < 1e-14) return false;
	const l1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / d;
	const l2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / d;
	const l3 = 1 - l1 - l2;
	return l1 >= -0.03 && l2 >= -0.03 && l3 >= -0.03;
}

interface Vertex {
	x: number;
	y: number;
	depth: number;
}

async function main(): Promise<void> {
	const which = process.argv[2] === 'female' ? 'female' : 'male';
	const poseName = process.argv[3] === 'walk' ? 'walk' : 'idle';
	const viewArg = process.argv.find((a) => a.startsWith('--view='));
	const view = viewArg ? viewArg.split('=')[1]! : 'FRONT';
	const pose = (CAMERA_POSES as Record<string, CameraPose | undefined>)[view];
	if (!pose) {
		console.error(
			`Unknown view "${view}". Known: ${Object.keys(CAMERA_POSES).join(', ')}`,
		);
		process.exit(1);
	}

	const figParams = params.figures as Record<
		string,
		{ restArmAngleDeg: number; armAbductionDeg: number }
	>;
	const settings = {
		...RUNWAY_WALK,
		restArmAngle: figParams[which]!.restArmAngleDeg,
		armAbduction: figParams[which]!.armAbductionDeg,
	};

	const scene = await loadModelForAnimation(`public/models/${which}.glb`);
	const rig = new FigureRig(scene, ANIMATED_BONES);
	// `travel` is a distance in metres along the runway, so this is the model at
	// a chosen point on the catwalk rather than always at the entrance. The
	// distance a face reads at depends entirely on it.
	const travelArg = process.argv.find((a) => a.startsWith('--travel='));
	const travel = travelArg ? Number.parseFloat(travelArg.split('=')[1] ?? '0') : 6;
	rig.apply(
		poseName === 'walk'
			? walkPose(0.3, settings)
			: idlePose(0, settings.restArmAngle, settings.armAbduction),
		travel,
	);

	// `rig.apply` writes bone locals; the world matrices the skinning formula needs
	// are only current after this. Without it every bone sits at identity and the
	// whole figure collapses toward the origin.
	scene.updateMatrixWorld(true);

	const entries: Entry[] = [];
	scene.traverse((node) => {
		const m = node as unknown as {
			isSkinnedMesh?: boolean;
			geometry?: BufferGeometry;
			bindMatrix?: Matrix4;
			skeleton?: { boneInverses: Matrix4[]; bones: { name: string; matrixWorld: Matrix4 }[] };
		};
		if (m.isSkinnedMesh && m.geometry && m.bindMatrix && m.skeleton) {
			entries.push({
				geometry: m.geometry,
				bindMatrix: m.bindMatrix,
				boneInverses: m.skeleton.boneInverses,
				boneList: m.skeleton.bones,
			});
		}
	});
	const found = entries.find((e) => e.geometry.name?.includes('-base')) ?? entries[0];
	if (!found) {
		console.error('no skinned mesh found');
		process.exit(1);
	}
	const target: Entry = found;

	const pos = target.geometry.getAttribute('position')!;
	const joints = target.geometry.getAttribute('skinIndex')!;
	const weights = target.geometry.getAttribute('skinWeight')!;
	const index = target.geometry.getIndex()!;

	const bindInverse = target.bindMatrix.clone().invert();
	const cache = new Map<number, Matrix4>();
	function skinMatrix(j: number): Matrix4 {
		let m = cache.get(j);
		if (!m) {
			m = new Matrix4()
				.copy(bindInverse)
				.multiply(target.boneList[j]!.matrixWorld)
				.multiply(target.boneInverses[j]!)
				.multiply(target.bindMatrix);
			cache.set(j, m);
		}
		return m;
	}

	// World-space skinned vertices.
	const world: Vector4[] = [];
	const v4 = new Vector4();
	const acc = new Vector4();
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		acc.set(0, 0, 0, 0);
		for (let k = 0; k < 4; k++) {
			const w = weights.getComponent(i, k);
			if (w === 0) continue;
			v4.set(x, y, z, 1).applyMatrix4(skinMatrix(joints.getComponent(i, k)));
			acc.x += v4.x * w;
			acc.y += v4.y * w;
			acc.z += v4.z * w;
			acc.w += v4.w * w;
		}
		if (acc.w !== 0) acc.multiplyScalar(1 / acc.w);
		world.push(acc.clone());
	}

	// Resolve the pose into world space exactly as the camera rig does: fixed
	// seats stay put, following offsets are added to the model position.
	// The rig root's origin is *not* the figure's feet — it carries a bind offset
	// that places the body on the floor. Anchoring the aim to it put the target
	// most of a metre too high and tipped the camera upward until the feet left
	// the frame. Measured from the posed mesh's own lowest point instead.
	const modelPos = new Vector3();
	{
		const lowest = new Vector3(Infinity, Infinity, Infinity);
		for (const w of world) lowest.min(new Vector3(w.x, w.y, w.z));
		modelPos.set(0, lowest.y, travel);
	}
	console.log(
		`  model feet at z=${travel.toFixed(2)} m, y=${modelPos.y.toFixed(2)} m ` +
			`after ${travel} m of travel`,
	);
	const camPos = pose.position.clone();
	const camTarget = pose.target.clone();
	if (pose.positionFollowsModel || pose.targetFollowsModel) {
		const m = new Vector3(modelPos.x, modelPos.y, modelPos.z);
		if (pose.positionFollowsModel) camPos.add(m);
		if (pose.targetFollowsModel) camTarget.add(m);
	}

	// A real PerspectiveCamera, driven by the pose's own FOV, rather than a
	// hand-built view-projection. Hand-rolling the perspective divide is exactly
	// the kind of thing that is subtly wrong in a way that renders as "nothing
	// projected" — the camera class gets handed-eye conventions right.
	const camera = new PerspectiveCamera(pose.fov, (COLS / ROWS) * CELL_ASPECT, 0.1, 200);
	camera.position.copy(camPos);
	camera.lookAt(camTarget);
	camera.updateMatrixWorld(true);
	camera.updateProjectionMatrix();

	// Project into normalised device coordinates, then into the character grid.
	const projected: Vertex[] = [];
	// `project` does the perspective divide and yields NDC (-1..1, y up). Depth
	// comes separately from the camera's own view space, because NDC z is not
	// linear and sorting on it produces visible triangle-order artefacts.
	const toView = new Vector3();
	const worldV = new Vector3();
	for (const w of world) {
		worldV.set(w.x, w.y, w.z);
		toView.copy(worldV).applyMatrix4(camera.matrixWorldInverse);
		if (toView.z > -camera.near) {
			projected.push({ x: NaN, y: NaN, depth: NaN });
			continue;
		}
		const p = worldV.clone().project(camera);
		// NDC -1..1 -> grid 0..1, with row 0 at the top of the image.
		projected.push({ x: (p.x + 1) * 0.5, y: (p.y + 1) * 0.5, depth: -toView.z });
	}

	const valid = projected.filter((p) => Number.isFinite(p.x));
	if (valid.length === 0) {
		console.error('nothing projected — camera is not looking at the model');
		process.exit(1);
	}
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of valid) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}

	// Rasterise, painter's order back to front so nearer surfaces win.
	const grid = new Float64Array(COLS * ROWS).fill(Infinity);
	const tris: { a: Vertex; b: Vertex; c: Vertex; depth: number }[] = [];
	for (let t = 0; t < index.array.length; t += 3) {
		const a = projected[index.array[t]!]!;
		const b = projected[index.array[t + 1]!]!;
		const c = projected[index.array[t + 2]!]!;
		if (!Number.isFinite(a.x) || !Number.isFinite(b.x) || !Number.isFinite(c.x)) continue;
		tris.push({ a, b, c, depth: (a.depth + b.depth + c.depth) / 3 });
	}
	tris.sort((p, q) => q.depth - p.depth);

	for (const tri of tris) {
		const gx0 = Math.max(0, Math.floor(Math.min(tri.a.x, tri.b.x, tri.c.x) * COLS));
		const gx1 = Math.min(COLS - 1, Math.ceil(Math.max(tri.a.x, tri.b.x, tri.c.x) * COLS));
		const gy0 = Math.max(0, Math.floor(Math.min(tri.a.y, tri.b.y, tri.c.y) * ROWS));
		const gy1 = Math.min(ROWS - 1, Math.ceil(Math.max(tri.a.y, tri.b.y, tri.c.y) * ROWS));
		for (let gy = gy0; gy <= gy1; gy++) {
			for (let gx = gx0; gx <= gx1; gx++) {
				const px = (gx + 0.5) / COLS;
				const py = (gy + 0.5) / ROWS;
				if ((grid[gy * COLS + gx] ?? Infinity) <= tri.depth) continue;
				if (inTriangle(px, py, tri.a, tri.b, tri.c)) grid[gy * COLS + gx] = tri.depth;
			}
		}
	}

	// Shading: nearer surfaces brighter, so the form reads.
	let nearest = Infinity;
	let farthest = -Infinity;
	for (const d of grid) {
		if (d === Infinity) continue;
		nearest = Math.min(nearest, d);
		farthest = Math.max(farthest, d);
	}
	const span = Math.max(0.001, farthest - nearest);
	const ramp = ' .:-=+*#%@';

	console.log(`\n${view}  ·  ${which}  ·  ${poseName}`);
	console.log(
		`seat (${camPos.x.toFixed(2)}, ${camPos.y.toFixed(2)}, ${camPos.z.toFixed(2)})  ` +
			`aim (${camTarget.x.toFixed(2)}, ${camTarget.y.toFixed(2)}, ${camTarget.z.toFixed(2)})  ` +
			`fov ${pose.fov}°`,
	);
	const dir = camTarget.clone().sub(camPos).normalize();
	console.log(
		`view direction (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})  ·  ` +
			`figure spans x ${(minX * COLS).toFixed(0)}–${(maxX * COLS).toFixed(0)}, ` +
			`y ${(minY * ROWS).toFixed(0)}–${(maxY * ROWS).toFixed(0)} of ${COLS}x${ROWS}`,
	);
	console.log('');
	for (let gy = ROWS - 1; gy >= 0; gy--) {
		let row = '';
		for (let gx = 0; gx < COLS; gx++) {
			const d = grid[gy * COLS + gx] ?? Infinity;
			row += d === Infinity ? ' ' : ramp[9 - Math.round(((farthest - d) / span) * 8)];
		}
		console.log(row);
	}

	// Which way is the camera looking relative to the model's facing (+Z)?
	// Negative view-Z means the camera looks back up the runway, so a model
	// walking +Z comes toward the lens.
	console.log(
		`\n  view Z ${dir.z < -0.3 ? 'NEGATIVE — camera looks back up the runway, model walks TOWARD the lens (front view)' : dir.z > 0.3 ? 'POSITIVE — camera looks down the runway, model walks AWAY (this is a rear view)' : 'lateral — camera is beside the ramp, model passes in profile'}`,
	);
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});
