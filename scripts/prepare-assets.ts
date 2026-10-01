/**
 * ATELIER — Phase 1 asset pipeline.
 *
 * Converts the raw source figures in assets-src/ into web-ready models in
 * public/models/, and emits measurements for the garment generator.
 *
 *   npm run assets:build
 *
 * Order matters:
 *   read -> verify -> measure -> strip -> prune/dedup -> compress maps
 *        -> write -> verify -> metrics
 *
 * Measurement must happen before any topology optimisation, because dedup and
 * quantize change vertex identity and would invalidate the body profile.
 *
 * Outputs:
 *   public/models/*.glb               committed, web-ready
 *   content/figure-metrics.json       gitignored, used by the checks and Phase 4
 *   src/lib/scene/figure-params.json  committed; the handful of values the app
 *                                     needs at build time. Kept separate from
 *                                     the full metrics so the client bundle
 *                                     never carries the 62 KB body profile.
 */

import { NodeIO, type Document, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { STRIP_MESH_PATTERNS } from './lib/rig.js';
import { measureFigure, type FigureMetrics } from './lib/measure.js';
import { verifyRig, formatReport } from './lib/verify.js';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'assets-src');
const OUT_DIR = path.join(ROOT, 'public', 'models');
const CONTENT_DIR = path.join(ROOT, 'content');

/** Raw maps are 2048px; keeping 2048 preserves the face read during inspection. */
const MAX_TEXTURE_SIZE = 2048;
const JPEG_QUALITY = 90;
const SIZE_BUDGET = 4 * 1024 * 1024;

interface FigureSpec {
	id: 'male' | 'female';
	source: string;
	output: string;
	label: string;
}

const FIGURES: FigureSpec[] = [
	{ id: 'male', source: 'male_raw.glb', output: 'male.glb', label: 'ASIAN MAN' },
	{ id: 'female', source: 'female_raw.glb', output: 'female.glb', label: 'AFRICA WOMAN' },
];

function human(bytes: number): string {
	return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Re-encode every texture at a known quality and cap.
 *
 * The source maps are 2048px PNGs at 0.6-4 MB each and are 89% of file size.
 * Base colour goes to JPEG 90 with 4:4:4 chroma (no colour bleeding on the
 * small dark details like eyebrows and lashes), which stays inside core
 * glTF 2.0 so no extension is required. Normal and ORM maps stay lossless PNG,
 * because JPEG ringing in a normal map reads as lighting noise.
 */
async function compressTextures(document: Document, maxSize: number, quality: number): Promise<void> {
	const textures = document.getRoot().listTextures();
	await Promise.all(
		textures.map(async (texture: Texture) => {
			const image = texture.getImage();
			if (!image) return;

			// A texture used as a normal/ORM map must not be re-encoded lossily.
			const lossyOk = !isDataTexture(document, texture);

			const pipeline = sharp(image).resize(maxSize, maxSize, {
				fit: 'inside',
				withoutEnlargement: true,
			});

			const buffer = lossyOk
				? await pipeline
						.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
						.toBuffer()
				: await pipeline.png({ compressionLevel: 9 }).toBuffer();

			texture.setImage(new Uint8Array(buffer));
			texture.setMimeType(lossyOk ? 'image/jpeg' : 'image/png');
		}),
	);
}

/** True when this texture is sampled by a normal or metallicRoughness slot. */
function isDataTexture(document: Document, texture: Texture): boolean {
	return document
		.getRoot()
		.listMaterials()
		.some(
			(material) =>
				material.getNormalTexture() === texture ||
				material.getMetallicRoughnessTexture() === texture ||
				material.getOcclusionTexture() === texture,
		);
}

async function processFigure(spec: FigureSpec, io: NodeIO): Promise<FigureMetrics> {
	const srcPath = path.join(SRC_DIR, spec.source);
	const outPath = path.join(OUT_DIR, spec.output);

	console.log(`\n${'='.repeat(74)}\n${spec.label}   ${spec.source} -> ${spec.output}\n${'='.repeat(74)}`);

	// -- read ----------------------------------------------------------------
	const document = await io.read(srcPath);
	const rawBytes = (await stat(srcPath)).size;
	const root = document.getRoot();

	// -- verify + measure, before any mutation --------------------------------
	const metrics = measureFigure(document, spec.source);
	const pre = verifyRig(document, metrics);
	console.log(formatReport('PRE  rig verification', pre));
	console.log(
		`  height ${metrics.height}m | shoulders ${metrics.segments.shoulderWidth}m | ` +
			`hips ${metrics.segments.hipWidth}m | thigh ${metrics.segments.thigh}m | ` +
			`restArm ${metrics.restArmAngleDeg}deg | slices ${Object.entries(metrics.regions)
				.map(([r, s]) => `${r}:${s.length}`)
				.join(' ')}`,
	);

	// -- strip ---------------------------------------------------------------
	const removed: string[] = [];
	for (const node of root.listNodes()) {
		const mesh = node.getMesh();
		if (mesh && STRIP_MESH_PATTERNS.some((p) => p.test(mesh.getName()))) {
			removed.push(mesh.getName());
			node.dispose();
		}
	}
	console.log(`  stripped: ${removed.length ? removed.join(', ') : 'nothing matched'}`);

	// -- prune + dedup -------------------------------------------------------
	// NOTE: deliberately no weld(). On a skinned mesh, welding merges vertices
	// with identical positions but different joint weights, which silently
	// tears the deformation at the seam. Not worth the bytes.
	await document.transform(prune({ keepAttributes: false }), dedup());

	// -- textures ------------------------------------------------------------
	const before = root.listTextures().length;
	await compressTextures(document, MAX_TEXTURE_SIZE, JPEG_QUALITY);

	// -- write ---------------------------------------------------------------
	const written = await io.writeBinary(document);
	await writeFile(outPath, written);

	// -- verify what actually landed on disk ----------------------------------
	const roundTrip = await io.read(outPath);
	const post = verifyRig(roundTrip, metrics, 'post');
	console.log(formatReport('POST verification of written file', post));

	const saved = (100 * (1 - written.byteLength / rawBytes)).toFixed(0);
	const budget = written.byteLength <= SIZE_BUDGET ? 'within budget' : 'OVER 4 MB BUDGET';
	console.log(
		`  ${human(rawBytes)} -> ${human(written.byteLength)} (-${saved}%) | ` +
			`${before} textures | ${budget}`,
	);
	console.log(`  kept meshes: ${roundTrip.getRoot().listMeshes().map((m) => m.getName()).join(', ')}`);

	const ok = pre.ok && post.ok;
	if (!ok) throw new Error(`${spec.label}: verification failed`);
	return metrics;
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	await mkdir(CONTENT_DIR, { recursive: true });

	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

	for (const spec of FIGURES) {
		if (!existsSync(path.join(SRC_DIR, spec.source))) {
			console.error(`\nMISSING ${path.join(SRC_DIR, spec.source)}`);
			console.error('Place the raw source GLB there. See docs/ASSETS.md.\n');
			process.exit(1);
		}
	}

	const metrics: Record<string, FigureMetrics> = {};
	for (const spec of FIGURES) {
		metrics[spec.id] = await processFigure(spec, io);
	}

	const metricsPath = path.join(CONTENT_DIR, 'figure-metrics.json');
	await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);

	// The app needs only a few of these numbers, and the full profile is 62 KB —
	// far too much to pull into a client bundle for two angles and a height.
	const params = Object.fromEntries(
		FIGURES.map((spec) => {
			const m = metrics[spec.id]!;
			return [
				spec.id,
				{
					height: m.height,
					crownY: m.crownY,
					soleY: m.soleY,
					restArmAngleDeg: m.restArmAngleDeg,
				armAbductionDeg: m.armAbductionDeg,
					shoulderWidth: m.segments.shoulderWidth,
					hipWidth: m.segments.hipWidth,
				},
			];
		}),
	);
	const paramsPath = path.join(ROOT, 'src', 'lib', 'scene', 'figure-params.json');
	await writeFile(
		paramsPath,
		`${JSON.stringify(
			{
				// Documented so the next reader knows why this file exists and why it
				// is so much smaller than figure-metrics.json.
				_generatedBy: 'npm run assets:build - do not edit by hand',
				figures: params,
			},
			null,
			2,
		)}\n`,
	);

	console.log(`\nwrote ${path.relative(ROOT, metricsPath)}`);
	console.log(`wrote ${path.relative(ROOT, paramsPath)}`);
	for (const spec of FIGURES) {
		console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, spec.output))}`);
	}
	console.log('\nall checks passed\n');
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}\n`);
	process.exit(1);
});