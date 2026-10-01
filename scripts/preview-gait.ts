/**
 * Gait preview — writes a contact sheet of the walk as SVG frames.
 *
 *   npm run anim:preview
 *
 * Prose invariants catch errors but not ugliness. This renders the skeleton's
 * stick figure at intervals through a cycle so the gait can be judged by eye
 * before it ever reaches a browser: stride symmetry, arm swing, knee timing,
 * foot plant.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Object3D, Vector3 } from 'three';
import { ANIMATED_BONES } from '../src/lib/anim/frames.js';
import { FigureRig } from '../src/lib/anim/figure.js';
import { walkPose, RUNWAY_WALK, type WalkSettings } from '../src/lib/anim/walk.js';
import { loadModelForAnimation } from './load-model.js';

const OUT_DIR = 'preview';
const COLS = 6;
const ROWS = 3;
const FRAMES = COLS * ROWS;

/** Bones worth drawing. Everything else adds noise. */
const DRAW_BONES = [
	'head', 'neck01', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01',
	'clavicle_L', 'shoulder01_L', 'upperarm01_L', 'lowerarm01_L', 'wrist_L',
	'clavicle_R', 'shoulder01_R', 'upperarm01_R', 'lowerarm01_R', 'wrist_R',
	'upperleg01_L', 'lowerleg01_L', 'foot_L', 'toe1-1_L',
	'upperleg01_R', 'lowerleg01_R', 'foot_R', 'toe1-1_R',
];

const CELL = 230;
const MARGIN = 30;
const W = COLS * CELL;
const H = ROWS * CELL;

async function main(): Promise<void> {
	const which = process.argv[2] === 'female' ? 'female' : 'male';
	const file = `public/models/${which}.glb`;
	if (!existsSync(file)) {
		console.error(`Missing ${file} — run "npm run assets:build" first.`);
		process.exit(1);
	}

	const metrics = JSON.parse(await readFile('content/figure-metrics.json', 'utf8')) as Record<
		string,
		{ restArmAngleDeg: number; height: number }
	>;
	const settings: WalkSettings = { ...RUNWAY_WALK, restArmAngle: metrics[which]!.restArmAngleDeg };

	const scene = await loadModelForAnimation(file);
	const rig = new FigureRig(scene, ANIMATED_BONES);

	// Fit the projection from the rig's own measurements.
	//
	// The first version centred on the drawn bones, which in bind pose have the
	// arms out at ±0.67 m — so the offset was x≈0 but the scale came from a
	// min/max spanning the full arm span while only height was used, and every
	// coordinate came out multiplied by `scale` twice. The result was drawn a
	// few thousand pixels off-canvas.
	const scale = (CELL - MARGIN * 2) / metrics[which]!.height;
		const floorY = 0; // the sole sits at y=0 in world space

	/** Project a world point into a cell's pixel space. */
	const project = (v: Vector3, ox: number, oy: number): [number, number] => [
		ox + CELL / 2 + v.x * scale,
		oy + CELL - MARGIN - (v.y - floorY) * scale,
	];

	await mkdir(OUT_DIR, { recursive: true });

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="monospace">`,
		`<rect width="${W}" height="${H}" fill="#080808"/>`,
	);

	for (let i = 0; i < FRAMES; i++) {
		const phase = i / FRAMES;
		const pose = walkPose(phase, settings);
		// Freeze the figure in place; the point is the pose, not the travel.
		rig.apply(pose, 0);

		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const ox = col * CELL;
		const oy = row * CELL;

		const at = (bone: string): [number, number] => project(rig.worldPositionOf(bone), ox, oy);

		// Ground line and frame label.
		parts.push(
			`<line x1="${ox + 8}" y1="${oy + CELL - MARGIN}" x2="${ox + CELL - 8}" y2="${oy + CELL - MARGIN}" stroke="#2a2a2a"/>`,
			`<text x="${ox + 10}" y="${oy + 16}" fill="#666" font-size="10">phase ${phase.toFixed(2)}</text>`,
		);

		// Skeleton.
		for (const bone of DRAW_BONES) {
			const parent = (scene as Object3D).getObjectByName(bone)?.parent;
			if (!parent || !parent.name) continue;
			if (!DRAW_BONES.includes(parent.name)) continue;
			const [x1, y1] = at(parent.name);
			const [x2, y2] = at(bone);
			const isLeg = /leg|foot|toe/.test(bone);
			parts.push(
				`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
					`stroke="${isLeg ? '#c9a227' : '#7d9cc0'}" stroke-width="${isLeg ? 2.4 : 1.6}" stroke-linecap="round"/>`,
			);
		}

		// Foot markers make heel strike and toe-off readable.
		for (const [foot, tone] of [
			['toe1-1_L', '#e05c5c'],
			['toe1-1_R', '#5ce07f'],
		] as const) {
			const [x, y] = at(foot);
			parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${tone}"/>`);
		}

		// Head.
		const [hx, hy] = at('head');
		parts.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="7" fill="none" stroke="#e8e2d4" stroke-width="1.6"/>`);
	}

	parts.push('</svg>');

	const outPath = path.join(OUT_DIR, `gait-${which}.svg`);
	await writeFile(outPath, `${parts.join('\n')}\n`);

	console.log(`wrote ${outPath}`);
	console.log(
		`figure height ${metrics[which]!.height.toFixed(3)} m, ` +
			`rest arm ${settings.restArmAngle.toFixed(2)} deg, ` +
			`${FRAMES} frames across one gait cycle`,
	);
	console.log('torso/arms blue, legs amber; red dot = left toe, green dot = right toe');
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});