import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Headless GLB loader for the animation checks.
 *
 * GLTFLoader decodes textures through browser APIs that do not exist under Node
 * and throws `self is not defined`. The walk check only needs geometry and the
 * skeleton, so `self` is shimmed and image decoding is stubbed to a blank
 * bitmap. Loading the real GLB rather than a stripped copy matters: the check
 * exists to validate the rig that actually ships.
 */
function installBrowserShims(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	if (globals['self'] === undefined) globals['self'] = globals;

	// GLTFLoader reaches for createImageBitmap when it is available.
	if (typeof globals['createImageBitmap'] !== 'function') {
		globals['createImageBitmap'] = async () => ({
			width: 1,
			height: 1,
			close: () => {},
		});
	}
}

export async function loadModelForAnimation(file: string): Promise<Object3D> {
	installBrowserShims();

	const buffer = await readFile(resolve(file));
	const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

	return new Promise<Object3D>((resolveScene, reject) => {
		new GLTFLoader().parse(
			data,
			'',
			(gltf) => {
				gltf.scene.updateMatrixWorld(true);
				resolveScene(gltf.scene);
			},
			(error) => reject(error instanceof Error ? error : new Error(String(error))),
		);
	});
}