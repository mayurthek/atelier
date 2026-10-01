/**
 * Arm and shoulder alignment inspector.
 *
 *   npm run anim:arms              male, idle pose
 *   npm run anim:arms -- female walk
 *
 * Renders the posed figure from the front, rasterising the *skinned mesh* rather
 * than the skeleton, and tinting arm-dominated vertices separately from the
 * torso. This is the diagnostic for the failure where the arms read as detached
 * from or sunk into the body — with the arm tinted against the torso, a gap at
 * the shoulder or a forearm lost inside the hip is immediately obvious.
 *
 * Rasterised offline rather than screenshotted: the dev tab cannot reliably be
 * kept visible, and reading pixels back through the browser is a much slower loop
 * than this problem deserves.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Matrix4, Vector4 } from 'three';
import type { BufferGeometry } from 'three';
import { ANIMATED_BONES } from '../src/lib/anim/frames';
import { FigureRig } from '../src/lib/anim/figure';
import { walkPose, RUNWAY_WALK } from '../src/lib/anim/walk';
import { idlePose } from '../src/lib/anim/clip';
import { loadModelForAnimation } from './load-model.js';
import params from '../src/lib/scene/figure-params.json';

const OUT_DIR = 'preview';

/** Vertices dominated by one of these joints count as "arm" and get tinted. */
const ARM_BONE_RE = /upperarm|lowerarm|wrist|shoulder01|clavicle|finger|metacarpal/i;

interface Point {
	x: number;
	y: number;
	arm: boolean;
}

interface Panel {
	title: string;
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	cols: number;
	rows: number;
}

const PANELS: Panel[] = [
	{ title: 'full figure, front', minX: -0.42, maxX: 0.42, minY: 0, maxY: 1.72, cols: 150, rows: 400 },
	{ title: 'shoulder + upper arm', minX: -0.4, maxX: 0.4, minY: 1.0, maxY: 1.5, cols: 200, rows: 150 },
	{ title: 'hip + hand clearance', minX: -0.4, maxX: 0.4, minY: 0.62, maxY: 1.02, cols: 200, rows: 130 },
];

const PANEL_W = 200;
const PANEL_H = 400;
const GAP = 24;
const HEADER = 44;
const MARGIN = 20;

function inTriangle(px: number, py: number, a: Point, b: Point, c: Point): boolean {
	const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
	if (Math.abs(d) < 1e-14) return false;
	const l1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / d;
	const l2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / d;
	const l3 = 1 - l1 - l2;
	// A little slack, so edges are not eaten by floating-point rounding.
	return l1 >= -0.03 && l2 >= -0.03 && l3 >= -0.03;
}

/** Rasterise triangles into a grid, optionally only those touching an arm vertex. */
function rasterise(points: Point[], indices: ArrayLike<number>, panel: Panel, armOnly: boolean): Uint8Array {
	const grid = new Uint8Array(panel.cols * panel.rows);
	const sx = panel.cols / (panel.maxX - panel.minX);
	const sy = panel.rows / (panel.maxY - panel.minY);
	const toCol = (x: number): number => (x - panel.minX) * sx;
	const toRow = (y: number): number => (y - panel.minY) * sy;

	for (let t = 0; t < indices.length; t += 3) {
		const a = points[indices[t]!]!;
		const b = points[indices[t + 1]!]!;
		const c = points[indices[t + 2]!]!;
		if (armOnly && !(a.arm || b.arm || c.arm)) continue;

		const gx0 = Math.max(0, Math.floor(Math.min(toCol(a.x), toCol(b.x), toCol(c.x))));
		const gx1 = Math.min(panel.cols - 1, Math.ceil(Math.max(toCol(a.x), toCol(b.x), toCol(c.x))));
		const gy0 = Math.max(0, Math.floor(Math.min(toRow(a.y), toRow(b.y), toRow(c.y))));
		const gy1 = Math.min(panel.rows - 1, Math.ceil(Math.max(toRow(a.y), toRow(b.y), toRow(c.y))));
		if (gx1 < gx0 || gy1 < gy0) continue;

		for (let gy = gy0; gy <= gy1; gy++) {
			const py = panel.minY + ((gy + 0.5) / panel.rows) * (panel.maxY - panel.minY);
			for (let gx = gx0; gx <= gx1; gx++) {
				const px = panel.minX + ((gx + 0.5) / panel.cols) * (panel.maxX - panel.minX);
				if (grid[gy * panel.cols + gx]) continue;
				if (inTriangle(px, py, a, b, c)) grid[gy * panel.cols + gx] = 1;
			}
		}
	}
	return grid;
}

async function main(): Promise<void> {
	const which = process.argv[2] === 'female' ? 'female' : 'male';
	const poseName = process.argv[3] === 'walk' ? 'walk' : 'idle';
	const file = `public/models/${which}.glb`;
	if (!existsSync(file)) {
		console.error(`Missing ${file} — run "npm run assets:build" first.`);
		process.exit(1);
	}

	const figParams = params.figures as Record<string, { restArmAngleDeg: number; armAbductionDeg: number }>;
	// `--abduction=N` overrides the pipeline value, for tuning against the render.
	const override = process.argv.find((a) => a.startsWith('--abduction='));
	const settings = {
		...RUNWAY_WALK,
		restArmAngle: figParams[which]!.restArmAngleDeg,
		armAbduction: override
			? Number.parseFloat(override.split('=')[1] ?? '0')
			: figParams[which]!.armAbductionDeg,
	};

	const scene = await loadModelForAnimation(file);
	const rig = new FigureRig(scene, ANIMATED_BONES);

	rig.apply(
		poseName === 'walk' ? walkPose(0.25, settings) : idlePose(0, settings.restArmAngle, settings.armAbduction),
		0,
	);

	// GPU-equivalent skinning, so the silhouette matches what renders.
//
// Computed from bone world matrices rather than reading `skeleton.boneMatrices`:
// the standard formula is
//
//     skinned = bindInverse * boneWorld[j] * boneInverse[j] * bind * v
//
// which only needs the matrices `FigureRig.apply` already refreshes.
	scene.updateMatrixWorld(true);

	interface Entry {
		geometry: BufferGeometry;
		bindMatrix: Matrix4;
		boneInverses: Matrix4[];
		boneList: { name: string; matrixWorld: Matrix4 }[];
	}
	const entries: Entry[] = [];
	scene.traverse((node) => {
		const m = node as unknown as {
			isSkinnedMesh?: boolean;
			geometry?: BufferGeometry;
			bindMatrix?: Matrix4;
			skeleton?: { boneInverses: Matrix4[]; bones: { name: string; matrixWorld: Matrix4 }[] };
		};
		if (!m.isSkinnedMesh || !m.geometry || !m.bindMatrix || !m.skeleton) return;
		entries.push({
			geometry: m.geometry,
			bindMatrix: m.bindMatrix,
			boneInverses: m.skeleton.boneInverses,
			boneList: m.skeleton.bones,
		});
	});

	// The body is the `-base` mesh; the eyebrow and hair are separate.
	const target = entries.find((e) => e.geometry.name?.includes('-base')) ?? entries[0];
	if (!target) {
		console.error('no skinned mesh found');
		process.exit(1);
	}

	const { bindMatrix, boneInverses, boneList } = target;
	const geometry = target.geometry;
	const bindInverse = bindMatrix.clone().invert();

	const armSlots = new Set<number>();
	boneList.forEach((b, i) => {
		if (ARM_BONE_RE.test(b.name)) armSlots.add(i);
	});

	/** skinMatrix for a joint, in the same order the GPU would apply. */
	const skinCache = new Map<number, Matrix4>();
	function skinMatrix(j: number): Matrix4 {
		let m = skinCache.get(j);
		if (!m) {
			const bone = boneList[j]!;
			m = new Matrix4()
				.copy(bindInverse)
				.multiply(bone.matrixWorld)
				.multiply(boneInverses[j]!)
				.multiply(bindMatrix);
			skinCache.set(j, m);
		}
		return m;
	}

	const pos = geometry.getAttribute('position');
	const joints = geometry.getAttribute('skinIndex');
	const weights = geometry.getAttribute('skinWeight');
	const index = geometry.getIndex();
	if (!pos || !joints || !weights || !index) {
		console.error('mesh lacks position / skinIndex / skinWeight / index');
		process.exit(1);
	}

	
	const points: Point[] = [];
	const v4 = new Vector4();
	const acc = new Vector4();

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		acc.set(0, 0, 0, 0);
		let dominant = -1;
		let dominantWeight = -1;

		for (let k = 0; k < 4; k++) {
			const w = weights.getComponent(i, k);
			if (w === 0) continue;
			const j = joints.getComponent(i, k);
			if (w > dominantWeight) {
				dominantWeight = w;
				dominant = j;
			}
			v4.set(x, y, z, 1).applyMatrix4(skinMatrix(j));
			acc.x += v4.x * w;
			acc.y += v4.y * w;
			acc.z += v4.z * w;
			acc.w += v4.w * w;
		}
		if (acc.w !== 0) acc.multiplyScalar(1 / acc.w);
		points.push({ x: acc.x, y: acc.y, arm: armSlots.has(dominant) });
	}

	await mkdir(OUT_DIR, { recursive: true });

	const totalW = MARGIN * 2 + PANEL_W * PANELS.length + GAP * (PANELS.length - 1);
	const totalH = HEADER + PANEL_H + MARGIN * 2;
	const svg: string[] = [];
	svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" font-family="monospace">`);
	svg.push(`<rect width="${totalW}" height="${totalH}" fill="#0a0a0a"/>`);

	PANELS.forEach((panel, pi) => {
		const ox = MARGIN + pi * (PANEL_W + GAP);
		const oy = HEADER;
		// Scale the panel's grid to the fixed frame size.
		const sx = PANEL_W / panel.cols;
		const sy = PANEL_H / panel.rows;

		svg.push(
			`<text x="${ox}" y="${HEADER - 18}" fill="#9a9a9a" font-size="11">${panel.title}</text>`,
			`<text x="${ox}" y="${HEADER - 5}" fill="#5a5a5a" font-size="9">${panel.minY.toFixed(2)}–${panel.maxY.toFixed(2)} m</text>`,
			`<rect x="${ox}" y="${oy}" width="${PANEL_W}" height="${PANEL_H}" fill="#0e0e12" stroke="#24242a"/>`,
		);

		// 10 cm reference lines.
		for (let y = Math.ceil(panel.minY * 10) / 10; y < panel.maxY; y += 0.1) {
			const row = ((y - panel.minY) / (panel.maxY - panel.minY)) * PANEL_H;
			svg.push(
				`<line x1="${ox}" y1="${(oy + PANEL_H - row).toFixed(1)}" x2="${ox + PANEL_W}" y2="${(oy + PANEL_H - row).toFixed(1)}" stroke="#ffffff" stroke-opacity="0.06"/>`,
			);
		}

		const bodyGrid = rasterise(points, index.array, panel, false);
		const armGrid = rasterise(points, index.array, panel, true);

		let path = '';
		for (let gy = 0; gy < panel.rows; gy++) {
			for (let gx = 0; gx < panel.cols; gx++) {
				const i = gy * panel.cols + gx;
				if (!bodyGrid[i]) continue;
				const x = (ox + gx * sx).toFixed(1);
				const y = (oy + PANEL_H - (gy + 1) * sy).toFixed(1);
				path += `M${x} ${y}h${sx.toFixed(2)}v${sy.toFixed(2)}h-${sx.toFixed(2)}z`;
			}
		}
		svg.push(`<path d="${path}" fill="#55555e"/>`);

		let armPath = '';
		for (let gy = 0; gy < panel.rows; gy++) {
			for (let gx = 0; gx < panel.cols; gx++) {
				const i = gy * panel.cols + gx;
				if (!armGrid[i]) continue;
				const x = (ox + gx * sx).toFixed(1);
				const y = (oy + PANEL_H - (gy + 1) * sy).toFixed(1);
				armPath += `M${x} ${y}h${sx.toFixed(2)}v${sy.toFixed(2)}h-${sx.toFixed(2)}z`;
			}
		}
		svg.push(`<path d="${armPath}" fill="#e0a83a"/>`);
	});

	svg.push(
		`<text x="${MARGIN}" y="${totalH - MARGIN + 4}" fill="#6a6a6a" font-size="10">` +
			`${which} · pose: ${poseName} · restArm ${settings.restArmAngle.toFixed(1)}° · abduction ${settings.armAbduction.toFixed(1)}° · ` +
			`grey = torso, amber = arm, white lines = 10 cm</text>`,
	);
	svg.push('</svg>');

	const outPath = `${OUT_DIR}/arms-${which}-${poseName}.svg`;
	await writeFile(outPath, `${svg.join('\n')}\n`);
	console.log(`wrote ${outPath}`);
	console.log(
		`${which} · pose ${poseName} · restArm ${settings.restArmAngle.toFixed(2)}° · abduction ${settings.armAbduction.toFixed(2)}° · ${points.length} verts`,
	);

	// ASCII dump of the shoulder region. The SVG is the deliverable, but reading
	// a silhouette as text is how the misalignment was actually diagnosed.
	if (process.argv.includes('--ascii')) {
		const panel: Panel = {
			title: 'ascii',
			minX: -0.4,
			maxX: 0.4,
			minY: 0.72,
			maxY: 1.5,
			cols: 78,
			rows: 34,
		};
		const body = rasterise(points, index.array, panel, false);
		const arm = rasterise(points, index.array, panel, true);
		console.log('\nshoulder + arm, front view   (o = arm over torso, # = torso only)');
		console.log(`y from ${panel.minY.toFixed(2)} m (feet side) to ${panel.maxY.toFixed(2)} m\n`);
		for (let gy = panel.rows - 1; gy >= 0; gy--) {
			let row = '';
			for (let gx = 0; gx < panel.cols; gx++) {
				const i = gy * panel.cols + gx;
				row += !body[i] ? ' ' : arm[i] ? 'o' : '#';
			}
			const y = panel.minY + ((gy + 0.5) / panel.rows) * (panel.maxY - panel.minY);
			console.log(`${y.toFixed(2)} |${row}|`);
		}
	}
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});