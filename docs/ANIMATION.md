# Animation

The source GLBs contain **no animation clips**, so every pose in ATELIER is
generated in code. This document records the architecture and the traps, because
each one cost real debugging time and none of them produce an error — they
produce a figure that looks subtly wrong.

## Commands

```bash
npm run anim:check     # 24 gait invariants across both figures
npm run show:check     # 22 full-show sequence invariants
npm run preview        # SVG contact sheet of the walk, both figures
npm run check          # typecheck + both suites
```

## Architecture

```
frames.ts   bind-pose capture; world-axis deltas → local rotations
walk.ts     gait curves, arm drop, pelvis, spine. Returns a Pose per frame
clip.ts     idle / turn / entrance poses, and pose blending
figure.ts   applies a Pose to a live skeleton
show.ts     ShowDirector: owns the clock and the five beats of §16
```

### Why world-axis deltas

Poses are authored as rotations in **world space, relative to bind pose**, never
as raw local euler angles. The two figures' bind quaternions differ substantially
— their leg bones carry large Y rotations — so a walk authored in local space for
one would point the other's shins sideways. In world axes the same curve produces
the same swing on any rig.

`FigureRig.apply` converts a delta to a local rotation by solving

```
world = parentWorld * local        (three.js composition)
world = delta * restWorld          (what we want)

  =>  local = parentWorld^-1 * delta * restWorld
```

Bones are processed **parent-before-child**, refreshing matrices as it goes. Both
details matter, and getting them wrong was the single largest bug in this phase.

## The five traps

### 1. Parent world rotation, not bind pose

The first version used `parentRestWorld` and iterated bones in arbitrary map
order. Both mistakes push the same way: each bone overrides its ancestors'
rotation, so every joint becomes independent of its parent and the figure folds in
on itself — hips rotating a full turn below the waist. The joint curves looked
plausible in isolation; the head bobbed 2.4 m.

### 2. Six joints per arm, not two

The Genesis arm runs shoulder → `upperarm01` → `upperarm02` → `lowerarm01` →
`lowerarm02` → wrist. Rotating only the upper arm swings one segment and leaves
the forearm pointing outward: the wrist stayed at x=0.42, still nearly
horizontal. **Every** joint in the chain must be rotated by the same angle, which
treats the arm as a rigid unit pivoting at the shoulder — which is what lowering a
T-pose arm actually is. `ARM_CHAIN_L`/`ARM_CHAIN_R` exist for this.

### 3. Sign of the arm drop

A rotation about +Z carries +X toward +Y. The figure's left arm is at +X, so
dropping it needs a **negative** roll; the right arm mirrors. Reversed, the left
arm goes up over the head while the right drops.

The magnitude comes from each figure's measured `restArmAngleDeg` (88.86° male,
88.32° female), not an assumed 90 — that would be an A-pose assumption, and both
figures ship in a T-pose.

### 4. Root translation lives in a scaled, rotated parent space

The wrapper node `asian_man` carries a **0.1 scale** and a **−90° X rotation**.
The inverse bind matrices cancel both for *vertices*, but not for translations
assigned to `root`. Two consequences:

- scale: a 22 mm bob arrived as 2.2 mm and read as literally zero
- rotation: local +Z is world −Y at the root, so assigning `travelZ` to
  `position.z` drove the figure 1.15 m *down* — walking the runway became falling

`FigureRig` solves this by inverting the parent's world matrix once at
construction and pushing world-space offsets back through it, rather than
assigning an axis. It also offsets from the root's **non-zero bind position**
(≈ `0, −1.34, −8.51`), since zeroing it throws the body 8.5 m down the runway.

### 5. Vertical bob must be centred

The root sits low in bind pose, so a bob applied downward pushes the toes through
the floor — by 4 mm on the female, who is 41 mm taller than the male. The bob is
centred on zero (`0.5 − |sin|`) so the walk stays neutral instead of sinking.

## Verification

Both suites load the **real shipped GLBs** and drive them at a fixed 60 Hz
timestep. `anim:check` asserts gait invariants; `show:check` asserts sequence
invariants.

Two measurement notes worth keeping:

- **Bob is measured on `spine02`, not the head.** The head counter-rotates
  against the bob by design, which cancels most of it. Measuring the head gave a
  false negative.
- **Pops are judged per phase against that phase's own median**, not an absolute
  threshold. The entrance legitimately sweeps a wrist 25 mm per frame; the held
  pose should move almost nothing. An absolute limit has to be loose enough for
  the entrance and then misses real discontinuities.

## Current gait

| Parameter | Value | Note |
|---|---|---|
| Duty factor | 0.62 | long stance, unhurried |
| Hip flex / extend | 24° / 14° | |
| Knee flex (swing) | 52° | peaks ~40% through swing |
| Ankle flex / point | 14° / 18° | |
| Arm swing | 11° | counter to same-side leg |
| Pelvis twist / chest counter | 5° / 4° | |
| Vertical bob | 22 mm | centred |
| Lateral shift | 18 mm | |
| Stride | 1.15 m per cycle | two steps per cycle |
| Runway | 14 m at 0.85 m/s | ~16.5 s walking |

## Phase timings (§16)

| Beat | Duration | Notes |
|---|---|---|
| entrance | 1.1 s | arms drop from bind pose |
| walk | ~16.5 s | derived from runway length and speed |
| pose | 1.4 s | settles into contrapposto |
| turn | 1.6 s | 120° pivot at the hips, chest leading |
| exit | 1.2 s | returns to neutral, then holds |

`exit` is terminal — it holds rather than rolling back into itself, which would
snap the figure from the idle pose to the turn pose once per cycle.

## Not yet built

Garments attach to these bones in Phase 5. Nothing in this layer knows about
clothing, which keeps the walk independently testable.