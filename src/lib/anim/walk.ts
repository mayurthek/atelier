import { Euler, Quaternion, Vector3 } from 'three';
import { ARM_BONES, ARM_CHAIN_L, ARM_CHAIN_R, LEG_BONES, SPINE_BONES, type PoseDeltas } from './frames';

/**
 * Procedural runway walk.
 *
 * The source GLBs contain no animation clips, so the gait is authored here as
 * curves over a normalised phase. Every angle is a world-axis rotation applied
 * on top of bind pose (see FigureRig.apply), which is what lets one curve drive
 * both figures despite their differing bind quaternions.
 *
 * Coordinate frame: Y up, +Z forward (the figures face +Z), +X to the figure's
 * left. Confirmed from metrics — toes sit at greater Z than the ankle.
 */

export interface WalkSettings {
	/** peak hip flexion in degrees, forward */
	hipFlex: number;
	/** peak hip extension in degrees, backward */
	hipExtend: number;
	/** peak knee flexion in degrees during swing */
	kneeFlex: number;
	/** knee bend present during stance, degrees */
	kneeStance: number;
	/** peak ankle dorsiflexion in degrees */
	ankleFlex: number;
	/** peak ankle plantarflexion (push off) in degrees */
	anklePoint: number;
	/** arm swing amplitude in degrees about X */
	armSwing: number;
	/** elbow bend in degrees */
	elbowBend: number;
	/** pelvis rotation about Y in degrees */
	pelvisTwist: number;
	/** pelvis lateral shift in metres */
	pelvisShift: number;
	/** counter-rotation of the ribcage about Y in degrees */
	chestCounter: number;
	/** vertical bob amplitude in metres */
	bob: number;
	/** fraction of the way the arms travel down from bind pose, 0..1 */
	armLower: number;
	/**
	 * Angle between the upper arm and straight-down, in bind pose, as measured
	 * per figure. ~89 for a T-pose, ~45 for an A-pose. Dropping the arms by
	 * exactly this much lands them at the figure's sides.
	 */
	restArmAngle: number;
	/**
	 * Outward angle, in degrees, at which the arms leave the body.
	 *
	 * Zero drops the arms to exactly vertical, which buries them in the torso —
	 * the shoulder joint sits at x≈0.10 m while the waist is 0.31 m wide, so a
	 * vertical arm passes straight through the body and the hand disappears into
	 * the hip. The angle is solved per figure by the asset pipeline, because it
	 * depends on proportions that differ between them.
	 */
	armAbduction: number;
	/** forward lean in degrees */
	lean: number;
}

export const RUNWAY_WALK: WalkSettings = {
	hipFlex: 24,
	hipExtend: 14,
	kneeFlex: 52,
	kneeStance: 8,
	ankleFlex: 14,
	anklePoint: 18,
	armSwing: 11,
	elbowBend: 14,
	pelvisTwist: 5,
	pelvisShift: 0.018,
	chestCounter: 4,
	bob: 0.022,
	armLower: 1,
	restArmAngle: 88.86,
	// Overridden per figure by the pipeline; this is the male figure's value.
	armAbduction: 8.5,
	lean: 3,
};

/**
 * A posed frame: per-bone world-axis rotation deltas, plus a root translation
 * offset. Translation travels separately because a delta map cannot carry it,
 * and the bob has to be in the same units as the walk to stay in sync.
 */
export interface Pose {
	readonly deltas: PoseDeltas;
	/** translation of the figure's root, in metres, world space */
	readonly rootOffset: Vector3;
}

const DEG = Math.PI / 180;

/** Fraction of the cycle each leg spends on the ground. Above 0.5 reads as an unhurried runway walk. */
const DUTY = 0.62;

const _euler = new Euler();
const _q = new Quaternion();

function pitchX(deg: number): Quaternion {
	_q.setFromEuler(_euler.set(deg * DEG, 0, 0));
	return _q.clone();
}
function yawY(deg: number): Quaternion {
	_q.setFromEuler(_euler.set(0, deg * DEG, 0));
	return _q.clone();
}
function rollZ(deg: number): Quaternion {
	_q.setFromEuler(_euler.set(0, 0, deg * DEG));
	return _q.clone();
}

function smoothstep(t: number): number {
	const c = Math.max(0, Math.min(1, t));
	return c * c * (3 - 2 * c);
}

export interface LegCurve {
	/** degrees, positive = thigh swings forward */
	hip: number;
	/** degrees, positive = knee bends (heel toward butt) */
	knee: number;
	/** degrees, positive = toe up */
	ankle: number;
}

/**
 * One leg's cycle over `legPhase` in 0..1.
 *
 * 0..DUTY is stance (foot planted, body travels over it); DUTY..1 is swing.
 */
export function legCurve(legPhase: number, settings: WalkSettings, stride = 1): LegCurve {
	const p = ((legPhase % 1) + 1) % 1;
	const s = settings;

	if (p < DUTY) {
		const t = p / DUTY;
		// Hip sweeps from flexed at contact to extended at toe-off.
		const hip = (s.hipFlex + (s.hipExtend - s.hipFlex) * smoothstep(t)) * stride;
		// A little knee bend throughout stance; deepest just after heel strike.
		const knee = s.kneeStance * (0.4 + 0.6 * Math.sin(Math.PI * t));
		// Ankle rolls from dorsiflex at contact to plantarflex at push-off.
		const ankle = (s.ankleFlex * (1 - t) - s.anklePoint * t) * stride;
		return { hip, knee, ankle };
	}

	const t = (p - DUTY) / (1 - DUTY);
	const hip = (s.hipExtend + (s.hipFlex - s.hipExtend) * smoothstep(t)) * stride;
	// Flexion peaks around 40% through swing as the heel swings through.
	const knee = s.kneeFlex * Math.sin(Math.PI * Math.pow(t, 0.72));
	const ankle =
		s.ankleFlex * Math.sin(Math.PI * t) - s.anklePoint * (1 - smoothstep(Math.min(1, t * 2.2)));
	return { hip, knee, ankle };
}

const LEG_L = { hip: LEG_BONES.hipL, knee: LEG_BONES.kneeL, ankle: LEG_BONES.ankleL, toe: LEG_BONES.toeL };
const LEG_R = { hip: LEG_BONES.hipR, knee: LEG_BONES.kneeR, ankle: LEG_BONES.ankleR, toe: LEG_BONES.toeR };

/** Build one frame of the walk at `phase` (0..1 through a full cycle). */
export function walkPose(
	phase: number,
	settings: WalkSettings = RUNWAY_WALK,
	stride = 1,
	armLowerOverride?: number,
): Pose {
	const armLower = armLowerOverride ?? settings.armLower;
	const deltas = new Map<string, Quaternion>();
	const set = (bone: string, q: Quaternion): void => {
		deltas.set(bone, q);
	};

	const left = legCurve(phase, settings, stride);
	const right = legCurve(phase + 0.5, settings, stride);

	applyLeg(set, LEG_L, left);
	applyLeg(set, LEG_R, right);

	// Two bobs per cycle, one per footfall, at the lowest point of each step.
	//
	// The root sits at y≈-1.34 in bind pose and the toe bones hang ~0.03 above the
	// sole. A bob of -22 mm therefore leaves the female toe 4 mm *below* the floor
	// (she is 41 mm taller than the male, so she has further to fall). Lift the
	// root by half the bob amplitude to centre the oscillation on zero, which
	// keeps the walk neutral instead of sinking into the runway.
	const bobY = (0.5 - Math.abs(Math.sin(phase * 2 * Math.PI))) * settings.bob * stride;
	const bobX = Math.sin(phase * 2 * Math.PI) * settings.pelvisShift * stride;

	// Pelvis leads the legs slightly; the ribcage counter-rotates. Without this
	// the figure reads as a rigid mannequin walking rather than a body. The
	// counter-twist is a ratio so tuning `pelvisTwist` cannot invert it.
	const pelvisYaw = Math.sin(phase * 2 * Math.PI) * settings.pelvisTwist;
	const counterRatio = settings.pelvisTwist === 0 ? 0 : settings.chestCounter / settings.pelvisTwist;
	set('spine01', yawY(pelvisYaw).multiply(pitchX(-settings.lean * 0.4)));
	set('spine03', yawY(-pelvisYaw * counterRatio));
	set('spine04', yawY(-pelvisYaw * counterRatio * 0.6));
	set('head', pitchX(settings.lean * 0.5 - Math.sin(phase * 4 * Math.PI) * 1.5));

	applyArms(set, phase, settings, armLower);

	for (const bone of SPINE_BONES) {
		if (!deltas.has(bone)) set(bone, new Quaternion());
	}

	return { deltas, rootOffset: new Vector3(bobX, bobY, 0) };
}

/**
 * Write one leg's joints into `deltas`.
 *
 * Joint names are passed explicitly because the left and right curves are
 * evaluated at different phases and must not collide on the same keys.
 *
 * Both sides share one sign convention: knees flex a single way, so mirroring
 * them would invert the joint.
 */
function applyLeg(
	set: (bone: string, q: Quaternion) => void,
	joints: { hip: string; knee: string; ankle: string; toe: string },
	curve: LegCurve,
): void {
	set(joints.hip, pitchX(curve.hip));
	set(joints.knee, pitchX(-curve.knee));
	set(joints.ankle, pitchX(-curve.ankle));
	// Toes extend through push-off.
	set(joints.toe, pitchX(Math.max(0, -curve.ankle) * 0.5));
}

/**
 * Drop the arms out of bind pose and add a counter-swing.
 *
 * Two things make this harder than it looks.
 *
 * Sign: a rotation about +Z carries +X toward +Y. The figure's left arm
 * occupies +X, so dropping it needs a NEGATIVE roll and the right arm mirrors.
 * Getting this backwards sends the left arm up over the head.
 *
 * Chain: the arm is SIX joints from shoulder to wrist, each with its own
 * bind rotation relative to its parent. Rotating only `upperarm01` swings one
 * segment and leaves the forearm pointing outward — that build left the wrist at
 * x=0.42, still nearly horizontal. Rotating every joint in the chain by the same
 * angle treats the arm as a rigid unit pivoting at the shoulder, which is what
 * dropping a T-pose arm actually is.
 *
 * Abduction: dropping by exactly `restArmAngle` puts the arm dead vertical from
 * a shoulder joint that sits *on* the body surface, so the forearm and hand end
 * up inside the torso — the hand vanishes into the hip. Subtracting the
 * abduction angle swings the arm outboard until it hangs clear.
 */
function applyArms(
	set: (bone: string, q: Quaternion) => void,
	phase: number,
	settings: WalkSettings,
	armLower: number,
): void {
	const drop = Math.max(0, armLower * (settings.restArmAngle - settings.armAbduction));
	// Arms counter-swing against the same-side leg; mirrored so the pair opposes.
	const swingLeft = Math.sin(phase * 2 * Math.PI) * settings.armSwing;
	const swingRight = -swingLeft;

	for (const bone of ARM_CHAIN_L) set(bone, rollZ(-drop).multiply(pitchX(swingLeft)));
	for (const bone of ARM_CHAIN_R) set(bone, rollZ(drop).multiply(pitchX(swingRight)));

	// Elbow bend rides on top of the drop, applied at the elbow only, so the
	// forearm angles forward while the upper arm keeps the wrist under the shoulder.
	const bendLeft = -(settings.elbowBend + Math.max(0, swingLeft) * 0.5);
	const bendRight = -(settings.elbowBend + Math.max(0, swingRight) * 0.5);
	set(ARM_BONES.forearmL, rollZ(-drop).multiply(pitchX(bendLeft)));
	set(ARM_BONES.forearmR, rollZ(drop).multiply(pitchX(bendRight)));
}