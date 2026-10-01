'use client';

import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import type { Group } from 'three';
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from 'three';
import { Runway } from './Runway';
import { Figure, preloadFigures } from './Figure';
import { CameraRig } from './camera';
import { useAdaptivePerf, PERF_FOR_TIER } from './perf';
import { bindShowKeys, useShowStore } from './store';
import { ATMOSPHERE, PALETTE, RUNWAY } from './stage-config';
import type { WalkSettings } from '@/lib/anim/walk';

/**
 * The runway scene.
 *
 * Three concerns in one Canvas, deliberately: the environment, the camera rig and
 * the model all need to share the same frame and the same clock, and splitting
 * them across canvases would mean three render loops fighting over the GPU for
 * a scene that will never be that complex.
 */

export function Stage({ settings }: { settings: WalkSettings }): React.ReactElement {
	const modelRef = useRef<Group>(null);
	const perfTier = useShowStore((s) => s.perfTier);
	const ready = useShowStore((s) => s.ready);
	const perf = PERF_FOR_TIER[perfTier];

	useEffect(() => {
		preloadFigures();
		return bindShowKeys();
	}, []);

	return (
		<>
			<Canvas
				dpr={[1, 1.75]}
				shadows={perf.shadows}
				// Restrained tone mapping. ACES crushes blacks slightly, which suits
				// a dark stage; Reinhard would wash the highlights out.
				flat
				gl={{
					antialias: true,
					powerPreference: 'high-performance',
					alpha: false,
				}}
				onCreated={({ gl, scene }) => {
					gl.toneMapping = ACESFilmicToneMapping;
					gl.toneMappingExposure = 1.05;
					gl.outputColorSpace = SRGBColorSpace;
					if (perf.shadows) gl.shadowMap.type = PCFSoftShadowMap;
					scene.background = null;
				}}
				camera={{ fov: 32, near: 0.1, far: 120, position: [0, RUNWAY.seatedEyeHeight, RUNWAY.audienceZ] }}
			>
				<PerfGovernor />
				<Runway>
					{/* §32: environment renders before the model, so the stage is
					    visible while the 1.8 MB figure is still streaming. */}
					<Suspense fallback={null}>
						<Figure modelRef={modelRef} settings={settings} />
					</Suspense>
				</Runway>
				<CameraRig modelRef={modelRef} />
				<AdaptiveDpr />
				<Preload all />
			</Canvas>
			{!ready && <LoadingVeil />}
		</>
	);
}

function PerfGovernor(): React.ReactElement {
	useAdaptivePerf();
	const tier = useShowStore((s) => s.perfTier);
	const gl = useThree((s) => s.gl);
	const scene = useThree((s) => s.scene);
	const perf = PERF_FOR_TIER[tier];

	// Fog and shadows are cheap to toggle but the camera must be told, so this
	// lives where the renderer is available.
	useEffect(() => {
		if (scene.fog) {
			// fogExp2's density is the second constructor arg.
			(scene.fog as { density: number }).density = perf.fogDensity;
		}
		gl.shadowMap.enabled = perf.shadows;
		gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'LOW' ? 0.75 : tier === 'MEDIUM' ? 1 : 1.75));
	}, [tier, scene, gl, perf.fogDensity, perf.shadows]);

	return <></>;
}

/**
 * §26 asks for slow fades rather than a spinner. A single line of text on the
 * palette background, which is what the landing page will be doing anyway.
 */
function LoadingVeil(): React.ReactElement {
	return (
		<div
			aria-live="polite"
			style={{
				position: 'absolute',
				inset: 0,
				display: 'grid',
				placeItems: 'center',
				background: PALETTE.background,
				color: PALETTE.warmWhite,
				fontFamily: 'var(--font-grotesk, system-ui, sans-serif)',
				fontSize: '0.7rem',
				letterSpacing: '0.34em',
				textTransform: 'uppercase',
				pointerEvents: 'none',
				transition: 'opacity 600ms ease',
				zIndex: 10,
			}}
		>
			Preparing the show
		</div>
	);
}

export const _atmosphere = ATMOSPHERE;