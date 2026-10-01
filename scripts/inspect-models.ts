/**
 * Inspect a GLB and print everything the pipeline cares about.
 *
 *   pnpm assets:check                       # both shipped models
 *   pnpm assets:check assets-src/male_raw.glb
 *
 * Useful when a figure loads but animates wrong: it prints bone world
 * positions, which is usually enough to tell a rig-space problem from a
 * geometry problem.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_TARGETS = ['public/models/male.glb', 'public/models/female.glb'];

function human(bytes: number): string {
	return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function worldMatrices(root: import('@gltf-transform/core').Root): Map<string, Matrix4> {
	const out = new Map<string, Matrix4>();
	const visit = (node: import('@gltf-transform/core').Node, parent: Matrix4): void => {
		const world = parent.clone().multiply(
			new Matrix4().compose(
				new Vector3().fromArray(node.getTranslation()),
				new Quaternion().fromArray(node.getRotation()),
				new Vector3().fromArray(node.getScale()),
			),
		);
		const name = node.getName();
		if (name && !out.has(name)) out.set(name, world);
		for (const child of node.listChildren()) visit(child, world);
	};
	for (const scene of root.listScenes()) {
		for (const child of scene.listChildren()) visit(child, new Matrix4());
	}
	return out;
}

async function inspect(file: string): Promise<void> {
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const bytes = (await readFile(file)).byteLength;
	const document = await io.read(file);
	const root = document.getRoot();

	console.log(`\n${'='.repeat(74)}\n${path.relative(process.cwd(), file)}   ${human(bytes)}\n${'='.repeat(74)}`);

	// -- nodes / meshes ------------------------------------------------------
	let triangles = 0;
	console.log('MESHES');
	for (const mesh of root.listMeshes()) {
		let meshTris = 0;
		let verts = 0;
		const attrs = new Set<string>();
		let mapNote = '';
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			if (!pos) continue;
			for (const semantic of prim.listSemantics()) attrs.add(semantic);
			const idx = prim.getIndices();
			meshTris += idx ? idx.getCount() / 3 : Math.max(0, pos.getCount() - 2);
			verts += pos.getCount();
			const texture = prim.getMaterial()?.getBaseColorTexture();
			if (texture) {
				mapNote = `${texture.getMimeType()} ${human(texture.getImage()?.byteLength ?? 0)}`;
			}
		}
		triangles += meshTris;
		console.log(
			`   ${mesh.getName().padEnd(26)} ${String(meshTris).padStart(7)} tris  ` +
				`${String(verts).padStart(7)} verts  ${mapNote || [...attrs].join('/')}`,
		);
	}
	console.log(`   ${'TOTAL'.padEnd(26)} ${String(triangles).padStart(7)} tris`);

	// -- skin ----------------------------------------------------------------
	console.log('\nSKIN');
	const skins = root.listSkins();
	if (skins.length === 0) console.log('   none');
	for (const skin of skins) {
		const joints = skin.listJoints();
		const ibm = skin.getInverseBindMatrices();
		console.log(`   joints ${joints.length}   inverseBindMatrices ${ibm ? ibm.getCount() : 'none'}`);
		const world = worldMatrices(root);
		const probe = ['head', 'neck01', 'spine05', 'spine01', 'shoulder01_L', 'wrist_L', 'pelvis_L', 'upperleg01_L', 'foot_L', 'toe1-1_L'];
		console.log('   world positions (metres, glTF Y-up):');
		for (const name of probe) {
			const m = world.get(name);
			if (!m) {
				console.log(`      ${name.padEnd(14)} MISSING`);
				continue;
			}
			const p = new Vector3().setFromMatrixPosition(m);
			console.log(
				`      ${name.padEnd(14)} x=${p.x.toFixed(4).padStart(9)}  y=${p.y.toFixed(4).padStart(9)}  z=${p.z.toFixed(4).padStart(9)}`,
			);
		}
	}

	// -- animations ----------------------------------------------------------
	const anims = root.listAnimations();
	console.log(`\nANIMATIONS  ${anims.length === 0 ? 'none (procedural only)' : anims.map((a) => a.getName()).join(', ')}`);

	const used = new Set<string>();
	for (const mesh of root.listMeshes()) {
		for (const extension of mesh.listExtensions()) used.add(extension.extensionName);
		for (const prim of mesh.listPrimitives()) {
			for (const extension of prim.listExtensions()) used.add(extension.extensionName);
			const material = prim.getMaterial();
			if (material) for (const extension of material.listExtensions()) used.add(extension.extensionName);
		}
	}
	console.log(`EXTENSIONS   ${used.size === 0 ? 'none' : [...used].join(', ')}`);
}

const targets = process.argv.slice(2);
const files = targets.length > 0 ? targets : DEFAULT_TARGETS;

let missing = 0;
for (const f of files) {
	if (!existsSync(f)) {
		console.error(`\nMISSING ${f}`);
		missing++;
		continue;
	}
	await inspect(f);
}
process.exit(missing > 0 ? 1 : 0);