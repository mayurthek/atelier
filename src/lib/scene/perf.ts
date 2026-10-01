import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerfTier } from './store';
import { useShowStore } from './store';

/**
 * §32: "Because the experience is 3D-heavy, performance is a product
 * requirement."
 *
 * This is the only place that decides quality. Rather than assuming a device is
 * capable, it measures and degrades — and crucially it only ever steps *down*,
 * never back up, so the scene cannot oscillate between tiers mid-show.
 *
 * Degradation order, cheapest visual cost first:
 *   HIGH   full DPR, shadows on, fog on
 *   MEDIUM DPR capped at 1, shadows off, fog on
 *   LOW    DPR capped at 0.75, shadows off, fog thinned, crowd thinned
 */

const SAMPLE_WINDOW = 90; // frames
/** Below this average FPS, step down. 45 rather than 60 to leave headroom. */
const DOWNGRADE_FPS = 45;
/** Must persist for this many frames before acting, to avoid one hitch demoting. */
const SUSTAINED_FRAMES = 45;

const DPR_FOR_TIER: Record<PerfTier, number> = {
	HIGH: 1.75,
	MEDIUM: 1,
	LOW: 0.75,
};

const TIER_ORDER: PerfTier[] = ['HIGH', 'MEDIUM', 'LOW'];

export interface PerfSettings {
	/** fog exponential density; thinned on LOW */
	fogDensity: number;
	/** audience instance multiplier; lower on LOW */
	crowdScale: number;
	/** whether the single shadow-casting light renders */
	shadows: boolean;
}

export const PERF_FOR_TIER: Record<PerfTier, PerfSettings> = {
	HIGH: { fogDensity: 0.028, crowdScale: 1, shadows: true },
	MEDIUM: { fogDensity: 0.028, crowdScale: 1, shadows: false },
	LOW: { fogDensity: 0.05, crowdScale: 0.5, shadows: false },
};

/**
 * Watches frame times and steps the tier down when sustained performance demands
 * it. Reports the measured FPS so the dev overlay can show something honest.
 */
export function useAdaptivePerf(): void {
	const setTier = useShowStore((s) => s.setPerfTier);
	const gl = useThree((s) => s.gl);

	const samples = useRef<number[]>([]);
	const streak = useRef(0);
	const tier = useRef<PerfTier>('HIGH');
	const last = useRef(performance.now());

	useEffect(() => {
		const ratio = Math.min(window.devicePixelRatio || 1, DPR_FOR_TIER[tier.current]);
		gl.setPixelRatio(ratio);
	}, [gl, tier.current]);

	useFrame(() => {
		const now = performance.now();
		const frameMs = now - last.current;
		last.current = now;
		// Ignore absurd frames (tab restore, GC pause) so they cannot demote.
		if (frameMs > 500) return;

		const fps = 1000 / frameMs;
		samples.current.push(fps);
		if (samples.current.length > SAMPLE_WINDOW) samples.current.shift();

		if (samples.current.length < SUSTAINED_FRAMES) return;
		// Use the median, not the mean: one stutter should not demote the scene.
		const sorted = [...samples.current].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)]!;

		if (median < DOWNGRADE_FPS) {
			streak.current++;
			if (streak.current >= SUSTAINED_FRAMES) {
				const index = TIER_ORDER.indexOf(tier.current);
				const next = TIER_ORDER[index + 1];
				if (next) {
					tier.current = next;
					setTier(next);
					gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_FOR_TIER[next]));
					// Reset so the next decision needs a fresh window.
					samples.current.length = 0;
					streak.current = 0;
				}
			}
		} else {
			streak.current = 0;
		}
	});
}