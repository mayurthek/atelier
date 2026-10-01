'use client';

import { Suspense, lazy } from 'react';
import params from '@/lib/scene/figure-params.json';
import { RUNWAY_WALK, type WalkSettings } from '@/lib/anim/walk';
import { Hud } from '@/lib/scene/Hud';
import { useShowStore } from '@/lib/scene/store';

/**
 * The runway.
 *
 * `Stage` is lazy-loaded because it pulls in three.js and drei — a substantial
 * chunk that the landing page should not pay for. Walking in is a deliberate
 * transition, and it keeps the first paint instant.
 */
const Stage = lazy(() =>
	import('@/lib/scene/Stage').then((m) => ({ default: m.Stage })),
);

type FigureId = 'male' | 'female';
type ParamsFile = {
	figures: Record<
		FigureId,
		{ restArmAngleDeg: number; armAbductionDeg: number; height: number } | undefined
	>;
};

/**
 * Per-figure walk settings.
 *
 * Both angles come from the pipeline's measurements rather than being assumed:
 *
 * - `restArmAngle` is the figure's bind-pose arm angle. They ship in a T-pose and
 *   each differs slightly.
 * - `armAbductionDeg` is solved per figure so the hands clear the hips. A
 *   vertically dropped arm hangs from a shoulder joint that sits on the body
 *   surface, so it passes through the torso and the hand disappears. The female
 *   needs a larger angle than the male — narrower shoulders, wider ribcage.
 */
export function settingsFor(figure: FigureId): WalkSettings {
	const file = params as ParamsFile;
	const measured = file.figures?.[figure];
	return {
		...RUNWAY_WALK,
		restArmAngle: typeof measured?.restArmAngleDeg === 'number' ? measured.restArmAngleDeg : 88.86,
		armAbduction: typeof measured?.armAbductionDeg === 'number' ? measured.armAbductionDeg : 10,
	};
}

export default function ShowroomPage(): React.ReactElement {
	const figure = useShowStore((s) => s.figure);
	// Stable identity per figure, so React does not rebuild the director on
	// every unrelated store change.
	const settings = settingsFor(figure);

	return (
		<main
			style={{
				position: 'relative',
				width: '100vw',
				height: '100vh',
				background: 'var(--surface-primary)',
			}}
		>
			<Suspense
				fallback={
					<div
						style={{ position: 'absolute', inset: 0, background: 'var(--surface-primary)' }}
					/>
				}
			>
				<Stage settings={settings} />
			</Suspense>
			<Hud />
		</main>
	);
}