import { FigureRig } from './figure';
import { walkPose, RUNWAY_WALK, type Pose, type WalkSettings } from './walk';
import { idlePose, turnPose, entrancePose, blendPose } from './clip';

/**
 * The show director.
 *
 * §16 specifies five beats per look: entrance, walk, pause/pose, turn, exit.
 * This drives them and owns the clock, so the camera and UI read from one
 * authoritative state rather than each keeping their own idea of where the model
 * is — which is what §16 asks for when it warns animation must stay synchronised
 * with camera, lighting and UI.
 */

export type LookPhase = 'entrance' | 'walk' | 'pose' | 'turn' | 'exit';

export interface DirectorState {
	phase: LookPhase;
	/** 0..1 through the current phase */
	progress: number;
	/** seconds since the show started */
	elapsed: number;
	/** distance walked along the runway, in metres */
	travel: number;
	/** gait phase, 0..1 */
	gaitPhase: number;
	/** true while the model is moving rather than held */
	moving: boolean;
}

export interface DirectorConfig {
	/** runway length in metres */
	runwayLength: number;
	/** walking speed in metres per second */
	speed: number;
	/** seconds spent in the entrance beat */
	entranceDuration: number;
	/** seconds spent paused at the end of the runway */
	poseDuration: number;
	/** seconds spent turning */
	turnDuration: number;
	/** seconds spent walking off */
	exitDuration: number;
	settings: WalkSettings;
}

export const DEFAULT_CONFIG: DirectorConfig = {
	runwayLength: 14,
	speed: 0.85,
	entranceDuration: 1.1,
	poseDuration: 1.4,
	turnDuration: 1.6,
	exitDuration: 1.2,
	settings: RUNWAY_WALK,
};

/** One full walk cycle covers this much ground. Two steps per cycle. */
const STRIDE = 1.15;

export class ShowDirector {
	private elapsed = 0;
	private travel = 0;
	private phase: LookPhase = 'entrance';
	private phaseStart = 0;
	private readonly config: DirectorConfig;
	private lastPose: Pose;

	constructor(config: Partial<DirectorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.lastPose = entrancePose(0, this.config.settings.restArmAngle);
	}

	state(): DirectorState {
		return {
			phase: this.phase,
			progress: this.phaseProgress(),
			elapsed: this.elapsed,
			travel: this.travel,
			gaitPhase: this.gaitPhase(),
			moving: this.phase === 'walk' || this.phase === 'entrance' || this.phase === 'exit',
		};
	}

	/**
	 * Advance the clock and return the pose for this frame.
	 *
	 * `delta` is in seconds. A paused show still advances `elapsed` so idle
	 * breathing continues — §26 wants the figure alive even when stationary.
	 */
	update(delta: number): { pose: Pose; state: DirectorState } {
		const dt = Math.min(Math.max(delta, 0), 0.1); // clamp after a tab stall
		this.elapsed += dt;

		const pose = this.composePose();
		this.lastPose = pose;

		// Advance the phase clock, rolling into the next beat when it elapses.
		if (this.phase === 'walk') {
			this.travel += this.config.speed * dt;
			if (this.travel >= this.config.runwayLength) {
				this.travel = this.config.runwayLength;
				this.enter('pose');
			}
		} else {
			const next = this.next();
			// `exit` is terminal: there is no beat after it, so it holds rather
			// than rolling back into itself.
			if (next && this.elapsed - this.phaseStart >= this.durationOf(this.phase)) this.enter(next);
		}

		return { pose, state: this.state() };
	}

	/** Pose the rig directly, for scrubbing or a paused director. */
	pose(): Pose {
		return this.lastPose;
	}

	reset(): void {
		this.elapsed = 0;
		this.travel = 0;
		this.phase = 'entrance';
		this.phaseStart = 0;
		this.lastPose = entrancePose(0, this.config.settings.restArmAngle);
	}

	/** Jump straight to a phase, used when a user scrubs the timeline. */
	seek(phase: LookPhase): void {
		this.enter(phase);
	}

	private enter(phase: LookPhase): void {
		this.phase = phase;
		this.phaseStart = this.elapsed;
	}

	/** The beat after the current one, or null once the show is over. */
	private next(): LookPhase | null {
		switch (this.phase) {
			case 'entrance':
				return 'walk';
			case 'pose':
				return 'turn';
			case 'turn':
				return 'exit';
			default:
				return null;
		}
	}

	private durationOf(phase: LookPhase): number {
		switch (phase) {
			case 'entrance':
				return this.config.entranceDuration;
			case 'pose':
				return this.config.poseDuration;
			case 'turn':
				return this.config.turnDuration;
			case 'exit':
				return this.config.exitDuration;
			case 'walk':
				return Infinity;
		}
	}

	private phaseProgress(): number {
		if (this.phase === 'walk') {
			return Math.min(1, this.travel / this.config.runwayLength);
		}
		const d = this.durationOf(this.phase);
		if (!Number.isFinite(d) || d <= 0) return 1;
		return Math.min(1, (this.elapsed - this.phaseStart) / d);
	}

	/** Gait phase derived from distance travelled, so feet cannot skate. */
	private gaitPhase(): number {
		return (this.travel / STRIDE) % 1;
	}

	private composePose(): Pose {
		const t = this.phaseProgress();
		const restArmAngle = this.config.settings.restArmAngle;
		// Every pose in the show must drop the arms to the same abducted angle as
		// the walk. Omitting it here is what put the arms inside the body on the
		// held pose at the end of every look.
		const armAbduction = this.config.settings.armAbduction;
		switch (this.phase) {
			case 'entrance':
				// Arms come down from bind pose, then hand over to the walk.
				return blendPose(
					entrancePose(t, restArmAngle, armAbduction),
					walkPose(this.gaitPhase(), this.config.settings),
					ease(Math.max(0, t * 2 - 1)),
				);
			case 'walk':
				return walkPose(this.gaitPhase(), this.config.settings);
			case 'pose':
				// Settle from the walk into the held pose.
				return blendPose(
					walkPose(this.gaitPhase(), this.config.settings),
					idlePose(this.elapsed, restArmAngle, armAbduction),
					ease(Math.min(1, t * 2)),
				);
			case 'turn':
				// Cross-fade out of the held pose. Without this the turn's first frame
				// differs from the pose it inherits — the ribcage roll and the idle
				// weight shift both vanish at once, snapping the wrist ~16 mm.
				return blendPose(
					idlePose(this.elapsed, restArmAngle, armAbduction),
					turnPose(t, restArmAngle, armAbduction),
					ease(t),
				);
			case 'exit':
				// Return to neutral and hold.
				return blendPose(
					turnPose(1, restArmAngle, armAbduction),
					idlePose(this.elapsed, restArmAngle, armAbduction),
					ease(t),
				);
		}
	}
}

function ease(t: number): number {
	const c = Math.max(0, Math.min(1, t));
	return c * c * (3 - 2 * c);
}

export { FigureRig };
export type { Pose, WalkSettings };