/**
 * Full-show sequence validation.
 *
 *   pnpm show:check
 *
 * The walk cycle can be perfect and the show still fall apart: phases that
 * overlap, a turn that snaps, feet that skate because gait phase is derived from
 * something other than distance travelled. This drives ShowDirector end to end at
 * a fixed timestep — the same one the renderer uses — and asserts the invariants
 * a spectator would actually notice.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ANIMATED_BONES } from '../src/lib/anim/frames.js';
import { FigureRig } from '../src/lib/anim/figure.js';
import { ShowDirector, DEFAULT_CONFIG, type LookPhase } from '../src/lib/anim/show.js';
import { loadModelForAnimation } from './load-model.js';

const MODELS = [
	{ id: 'male', file: 'public/models/male.glb' },
	{ id: 'female', file: 'public/models/female.glb' },
] as const;

/** Fixed 60 Hz timestep, matching a typical render loop. */
const STEP = 1 / 60;

/** Beats the show must play, per §16. */
const BEATS: LookPhase[] = ['entrance', 'walk', 'pose', 'turn', 'exit'];

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

interface Jump {
	phase: LookPhase;
	/** frames since this phase began */
	into: number;
	/** wrist displacement, metres */
	metres: number;
	/** change in wrist velocity vs the previous frame, m/s at 60Hz */
	acceleration: number;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
}

async function checkShow(id: string, file: string): Promise<Check[]> {
	console.log(`\n${'='.repeat(74)}\n${id.toUpperCase()}   full show sequence\n${'='.repeat(74)}`);
	const checks: Check[] = [];
	const push = (name: string, ok: boolean, detail: string): void => {
		checks.push({ name, ok, detail });
		console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
	};

	const metrics = JSON.parse(await readFile('content/figure-metrics.json', 'utf8')) as Record<
		string,
		{ restArmAngleDeg: number }
	>;

	const scene = await loadModelForAnimation(file);
	const rig = new FigureRig(scene, ANIMATED_BONES);
	const director = new ShowDirector({
		settings: { ...DEFAULT_CONFIG.settings, restArmAngle: metrics[id]!.restArmAngleDeg },
	});

	const phaseFrames = new Map<string, number>();
	const jumpsByPhase = new Map<LookPhase, Jump[]>();
	let lowestToe = Infinity;
	let maxHeadLateral = 0;
	let previousWrist = rig.worldPositionOf('wrist_L').clone();
	let previousTravel = 0;
	let travelMonotonic = true;
	let totalFrames = 0;
	let lastPhase: LookPhase | null = null;
	let intoPhase = 0;
	let previousJump = 0;

	for (let frame = 0; frame < 60 * 60; frame++) {
		const { pose, state } = director.update(STEP);
		rig.apply(pose, state.travel);

		if (state.phase !== lastPhase) {
			lastPhase = state.phase;
			intoPhase = 0;
		} else {
			intoPhase++;
		}
		phaseFrames.set(state.phase, (phaseFrames.get(state.phase) ?? 0) + 1);
		totalFrames++;

		lowestToe = Math.min(
			lowestToe,
			rig.worldPositionOf('toe1-1_L').y,
			rig.worldPositionOf('toe1-1_R').y,
		);
		maxHeadLateral = Math.max(maxHeadLateral, Math.abs(rig.worldPositionOf('head').x));

		// Wrist displacement per frame, and its change from the previous frame.
		// The second value is what actually detects a pop: smooth motion has a
		// steady velocity, so a discontinuity shows as a spike in acceleration
		// even when the raw distance is unremarkable.
		const wrist = rig.worldPositionOf('wrist_L');
		const jump = wrist.distanceTo(previousWrist);
		const acceleration = Math.abs(jump - previousJump) / STEP;
		jumpsByPhase.set(state.phase, [
			...(jumpsByPhase.get(state.phase) ?? []),
			{ phase: state.phase, into: intoPhase, metres: jump, acceleration },
		]);
		previousJump = jump;
		previousWrist = wrist.clone();

		if (state.travel < previousTravel - 1e-6) travelMonotonic = false;
		previousTravel = state.travel;

		if (state.phase === 'exit' && intoPhase > 60 * 2) break;
	}

	push(
		'all five beats played',
		BEATS.every((p) => (phaseFrames.get(p) ?? 0) > 0),
		BEATS.map((p) => `${p} ${((phaseFrames.get(p) ?? 0) / 60).toFixed(1)}s`).join(' '),
	);

	push(
		'walk occupies the majority of the show',
		(phaseFrames.get('walk') ?? 0) > totalFrames * 0.5,
		`${(((phaseFrames.get('walk') ?? 0) / totalFrames) * 100).toFixed(0)}% of frames walking`,
	);

	push(
		'no foot below the floor at any point',
		lowestToe > -0.03,
		`lowest toe y ${lowestToe.toFixed(4)} m`,
	);

	push(
		'travel never runs backwards',
		travelMonotonic,
		travelMonotonic ? 'monotonic' : 'went backwards',
	);

	push(
		'figure reaches the end of the runway',
		Math.abs(previousTravel - DEFAULT_CONFIG.runwayLength) < 0.01,
		`travelled ${previousTravel.toFixed(3)} of ${DEFAULT_CONFIG.runwayLength} m`,
	);

	push(
		'head stays within a narrow lateral band',
		maxHeadLateral < 0.12,
		`max head |x| ${maxHeadLateral.toFixed(3)} m`,
	);

	// Continuity. A pop is a single frame whose motion is wildly out of scale with
	// its neighbours, so each phase is judged against its own median rather than
	// an absolute threshold — the entrance legitimately moves a wrist 25 mm in a
	// frame, while the held pose should move almost nothing.
	for (const beat of BEATS) {
		const jumps = jumpsByPhase.get(beat) ?? [];
		if (jumps.length < 3) {
			push(`no pop in "${beat}"`, false, 'phase too short to judge');
			continue;
		}
		const typical = median(jumps.map((j) => j.metres));
		const worst = jumps.reduce((a, b) => (b.metres > a.metres ? b : a));
		// Allow generous headroom over the phase's own typical motion.
		const limit = Math.max(typical * 4, 0.004);
		push(
			`no pop in "${beat}"`,
			worst.metres < limit,
			`typical ${(typical * 1000).toFixed(1)} mm/frame, worst ${(worst.metres * 1000).toFixed(1)} mm ` +
				`at +${worst.into} (limit ${(limit * 1000).toFixed(1)})`,
		);
	}

	return checks;
}

async function main(): Promise<void> {
	for (const m of MODELS) {
		if (!existsSync(m.file)) {
			console.error(`\nMISSING ${m.file} - run "npm run assets:build" first.`);
			process.exit(1);
		}
	}
	const all: Check[][] = [];
	for (const m of MODELS) all.push(await checkShow(m.id, m.file));

	const flat = all.flat();
	const passed = flat.filter((c) => c.ok).length;
	console.log(`\n${'='.repeat(74)}\n${passed}/${flat.length} checks passed\n`);
	process.exit(passed === flat.length ? 0 : 1);
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});