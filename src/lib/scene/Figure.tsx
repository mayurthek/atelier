'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Group } from 'three';
import type { GLTF } from 'three-stdlib';
import { FigureRig } from '@/lib/anim/figure';
import { ANIMATED_BONES } from '@/lib/anim/frames';
import { ShowDirector, DEFAULT_CONFIG } from '@/lib/anim/show';
import type { WalkSettings } from '@/lib/anim/walk';
import { modelFeet, useShowStore } from './store';

/**
 * The model on the runway.
 *
 * This is the join between the framework-free animation layer and React: the
 * `FigureRig` and `ShowDirector` do the work, and this component only feeds them
 * a delta and pushes the pose onto the loaded skeleton.
 *
 * §32 requires progressive loading — environment first, then model — which is
 * why the geometry sits behind its own Suspense boundary.
 */

const MODEL_URLS = {
	male: '/models/male.glb',
	female: '/models/female.glb',
} as const;

export function Figure({
	settings,
}: {
	/** Per-figure walk settings, including the measured bind-pose arm angle. */
	settings: WalkSettings;
}): React.ReactElement {
	const figure = useShowStore((s) => s.figure);
	const playing = useShowStore((s) => s.playing);
	const lookIndex = useShowStore((s) => s.lookIndex);

	const gltf = useGLTF(MODEL_URLS[figure]) as GLTF;

	// One rig per figure. Keyed on the scene so switching figures cannot reuse a
	// rig still bound to the previous skeleton.
	const rig = useMemo(() => new FigureRig(gltf.scene, ANIMATED_BONES), [gltf.scene]);
	const director = useMemo(
		() => new ShowDirector({ settings, runwayLength: 13.2 }),
		[settings],
	);

	// A new look replays the approach from the entrance rather than jumping the
	// model to the mark.
	const lastLook = useRef(lookIndex);
	useEffect(() => {
		if (lastLook.current !== lookIndex) {
			lastLook.current = lookIndex;
			director.reset();
		}
	}, [lookIndex, director]);

	useEffect(() => {
		useShowStore.getState().setReady(true);
		return () => useShowStore.getState().setReady(false);
	}, []);

	useFrame((_, delta) => {
		const store = useShowStore.getState();

		if (playing) {
			const { pose, state } = director.update(delta);
			rig.apply(pose, state.travel);
			store.setProgress(state.travel, state.gaitPhase);
			if (state.phase !== store.phase) store.setPhase(state.phase);
		} else {
			// Paused: hold position and travel, but keep breathing so the figure
			// reads as alive rather than frozen.
			const { pose, state } = director.update(0);
			rig.apply(pose, state.travel);
		}

		// Publish where the model is for the camera rig to aim at. Written after
		// the pose is applied, and read in the same frame's camera pass.
		modelFeet.copy(rig.footPosition());
	});

	// No wrapping group with a ref: the camera used to read this group's world
	// position to know where the model was, and that origin sits below the floor
	// because the rig root carries a bind offset. The figure now publishes its own
	// foot position instead (see `modelFeet`).
	return <primitive object={gltf.scene} />;
}

/** Preload both figures so switching looks does not stall (§32). */
export function preloadFigures(): void {
	useGLTF.preload(MODEL_URLS.male);
	useGLTF.preload(MODEL_URLS.female);
}