import type { Document } from '@gltf-transform/core';
import { RIG_JOINTS, RIG_JOINT_COUNT, ANIMATED_BONES, KEEP_MESH_PATTERNS, BODY_REGION_NAMES } from './rig.js';
import type { FigureMetrics } from './measure.js';

export interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

export interface RigReport {
	checks: Check[];
	ok: boolean;
}

const MAX_ASYMMETRY = 0.002; // 2 mm
const MIN_BODY_HEIGHT = 1.2; // metres — below this something is badly wrong

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Fail loudly rather than producing a figure that animates in half its limbs.
 * Every assertion here maps to a phase-2 failure that would otherwise be
 * debugged blind at 6:30 with no error message.
 */
export function verifyRig(
	document: Document,
	metrics: FigureMetrics,
	phase: 'pre' | 'post' = 'pre',
): RigReport {
	const checks: Check[] = [];
	const root = document.getRoot();
	const push = (name: string, ok: boolean, detail: string): void => {
		checks.push({ name, ok, detail });
	};

	// --- skeleton shape -----------------------------------------------------
	const skins = root.listSkins();
	push('single skin', skins.length === 1, `found ${skins.length}`);

	const skin = skins[0];
	if (!skin) return { checks, ok: false };

	const joints = skin.listJoints();
	const names = joints.map((j) => j.getName());
	push(
		`joint count == ${RIG_JOINT_COUNT}`,
		names.length === RIG_JOINT_COUNT,
		`found ${names.length}`,
	);

	// Exact positional diff, so a mismatch names the offending bone.
	const expected = RIG_JOINTS as readonly string[];
	let firstMismatch = 'none';
	let mismatches = 0;
	for (let i = 0; i < Math.max(names.length, expected.length); i++) {
		if (names[i] !== expected[i]) {
			mismatches++;
			if (firstMismatch === 'none') firstMismatch = `index ${i}: got "${names[i] ?? '—'}" want "${expected[i] ?? '—'}"`;
		}
	}
	push('bone names + order match contract', mismatches === 0, mismatches === 0 ? '163/163' : `${mismatches} mismatch(es), first ${firstMismatch}`);

	// --- every animated bone must exist ------------------------------------
	const nameSet = new Set(names);
	const missingAnim = ANIMATED_BONES.filter((b) => !nameSet.has(b));
	push(
		'all animated bones present',
		missingAnim.length === 0,
		missingAnim.length === 0 ? `${ANIMATED_BONES.length} bones` : `missing: ${missingAnim.join(', ')}`,
	);

	// --- bind matrices ------------------------------------------------------
	const ibm = skin.getInverseBindMatrices();
	push(
		'inverse bind matrices present',
		ibm != null && ibm.getCount() === names.length,
		ibm == null ? 'missing' : `${ibm.getCount()} entries for ${names.length} joints`,
	);

	// --- the body mesh must be skinned -------------------------------------
	const baseMesh = root.listMeshes().find((m) => /-base$/i.test(m.getName()));
	push('body mesh found', baseMesh != null, baseMesh?.getName() ?? 'no *-base mesh');
	if (baseMesh) {
		const owner = root.listNodes().find((n) => n.getMesh() === baseMesh);
		push('body mesh has a node', owner != null, owner?.getName() ?? 'detached');
		const skinnedNodes = root.listNodes().filter((n) => n.getSkin() != null);
		push(
			'body node bound to skin',
			skinnedNodes.some((n) => n.getMesh() === baseMesh),
			`${skinnedNodes.length} skinned nodes`,
		);
	}

	// --- geometry sanity ----------------------------------------------------
	let triangles = 0;
	let morphTargets = 0;
	for (const mesh of root.listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			if (!pos) continue;
			const idx = prim.getIndices();
			triangles += idx ? idx.getCount() / 3 : Math.max(0, pos.getCount() - 2);
			morphTargets += prim.listTargets().length;
		}
	}
	push(
		'triangle count in range',
		triangles > 20000 && triangles < 400000,
		`${triangles.toLocaleString()} tris`,
	);
	push(
		'no morph targets',
		morphTargets === 0,
		morphTargets === 0 ? 'none (face stays neutral)' : `${morphTargets} found`,
	);

	// --- measurements -------------------------------------------------------
	push(
		'height plausible',
		metrics.height > MIN_BODY_HEIGHT && metrics.height < 2.4,
		`${metrics.height} m`,
	);
	push(
		'left/right symmetric',
		metrics.maxAsymmetry < MAX_ASYMMETRY,
		`max mirror error ${metrics.maxAsymmetry} m`,
	);
	push(
		'landmark set resolved',
		Object.keys(metrics.landmarks).length >= 24,
		`${Object.keys(metrics.landmarks).length} landmarks`,
	);
	push(
		'body regions extracted',
		metrics.regions.torso.length >= 8 &&
			metrics.regions.armL.length >= 6 &&
			metrics.regions.legL.length >= 8,
		BODY_REGION_NAMES.map((r) => `${r} ${metrics.regions[r].length}`).join(' | '),
	);

	// A T-posed arm crossing the torso slice is the failure mode this catches:
	// the torso would report ~1.7 m of width instead of a human chest.
	const widestTorso = metrics.regions.torso.reduce((w, s) => Math.max(w, s.width), 0);
	push(
		'torso slices free of arm contamination',
		widestTorso < 0.7,
		`widest torso slice ${round(widestTorso)} m (expect < 0.7)`,
	);

	// An arm profiled along shoulder->wrist must be an arm-sized cross-section.
	// If it measured by height instead, this would collapse to one slice.
	const widestArm = metrics.regions.armL.reduce((w, s) => Math.max(w, s.depth, s.width), 0);
	push(
		'arm slices measured along limb axis',
		widestArm > 0.03 && widestArm < 0.35,
		`widest arm section ${round(widestArm)} m (expect 0.03-0.35)`,
	);

	const armLength = metrics.regions.armL.at(-1)!.t - metrics.regions.armL[0]!.t;
	push(
		'arm section span matches arm length',
		armLength > 0.3 && armLength < 0.8,
		`profiled ${round(armLength)} m vs shoulder-to-wrist ${metrics.segments.shoulderToWrist} m`,
	);
	push(
		'rest arm angle sensible',
		metrics.restArmAngleDeg > 20 && metrics.restArmAngleDeg < 120,
		`${metrics.restArmAngleDeg}° from vertical`,
	);

	// --- expected mesh set --------------------------------------------------
	// Only meaningful after stripping; the raw file legitimately contains the
	// casual suit, shoes, teeth and tongue.
	if (phase === 'post') {
		const kept = root.listMeshes().map((m) => m.getName());
		const unexpected = kept.filter((n) => !KEEP_MESH_PATTERNS.some((p) => p.test(n)));
		push(
			'mesh set as expected',
			unexpected.length === 0 && kept.length > 0,
			unexpected.length === 0 ? `${kept.length}: ${kept.join(', ')}` : `unexpected: ${unexpected.join(', ')}`,
		);
	}

	const ok = checks.every((c) => c.ok);
	return { checks, ok };
}

export function formatReport(label: string, report: RigReport): string {
	const lines = [`\n${label}`, '-'.repeat(label.length + 8)];
	for (const c of report.checks) {
		lines.push(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} ${c.detail}`);
	}
	lines.push('');
	lines.push(`  ${report.ok ? 'OK' : 'FAILED'} — ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks passed`);
	return lines.join('\n');
}