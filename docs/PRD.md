# PRD — staging and camera

> **Status: authoritative for this repo.** Where this document and the original
> brief disagree, this document wins. The original PRD is not kept in the
> repository; everything an implementer needs to get right about *views* is
> recorded here.

---

## Amendment log

### A1 — Two views, and which way the model faces

**Was:** the camera had six states, the primary one called `AUDIENCE`, seated at
`z = -1.2` — the *near* end of the runway — looking down it.

**Problem:** the model walks along **+Z** and faces **+Z**. A camera at the near
end therefore sees the walk **from behind**. The product showed the back of a
model walking away, for the entire Phase 3.

This survived a full round of checks because every existing invariant tested the
wrist, the feet, the head or the walk cycle. **Nothing tested which way the camera
was looking.** "The model is animated correctly" and "the model is presented
correctly" are different claims.

**Now:** two composed views, both seats in the audience, both looking at the
model's front or side as it comes toward and past the camera:

| State | Seat | Shows |
|---|---|---|
| `FRONT` | front row, far end of the runway, on the centreline | the model walking **toward** the lens, head-on |
| `SPECTATOR` | front row, one side of the ramp, mid-late runway | the model **passing in profile**, first-person from a seat |

`AUDIENCE` is renamed `FRONT` rather than kept, because the name is what caused
the confusion: a seat at the start of a runway is not "the audience view", it is
the view of the model's back.

---

## Direction of travel — read this before touching the camera

This is the single fact the rest of the document depends on.

| Fact | Value | How it is established |
|---|---|---|
| The model travels along | **+Z** | `FigureRig.apply(pose, travel)` puts `travel` on +Z |
| The model faces | **+Z** | toe sits 0.128 m ahead of the ankle in bind pose |
| The runway runs | z = 0 → 14 m | `RUNWAY.length` |
| The model stops and turns at | z = 13.2 m | `RUNWAY.markZ` |

Therefore:

- A camera with **z < 0** sees the model's **back**. Do not call this the front.
- A camera with **z > 14** on the centreline sees the model's **front**.
- A camera with **|x| > 1.6** sees the model in **profile**.

If you add a camera state, state which of those three it is on the same line as
the seat.

---

## The view contract

### 1. There are exactly two composed views

`FRONT` and `SPECTATOR`. They are first in `CAMERA_STATE_ORDER`, so the default
view and the first thing a user cycles to are both composed views. Everything else
(`TRACK`, `MODEL`, `INSPECT`, `MACRO`, `ARCHIVE`) is a state hanging off one of
them.

### 1a. The whole figure must stay in shot, at every point on the walk

A view that crops the garment is not a view. This is measured against the real
GLBs at six points along the walk, and it is arithmetic, so it is asserted rather
than eyeballed:

- **`FRONT`, `SPECTATOR`, `TRACK`, `MODEL` hold the figure at 0…13.2 m`** — 24
  checks, no vertex outside the frame at any sample.

Two bugs lived here, and both are the kind that a screenshot hides:

1. **Aim height.** A seated camera at 1.18 m aiming at a chest 1.17 m up is aiming
   almost level with the lens. As the model walks toward it the figure grows
   *downward* out of the bottom of the frame — measured, the feet left the frame
   entirely from about 11 m out, and by the mark a third of the figure was gone.
   The seated cameras now aim at 55% of the figure's height.

2. **Where "the model" is.** Every following target was anchored to the rig root.
   The root carries a bind offset that places the body on the floor, so its origin
   sits well below the ground and partway back down the runway. Adding that to the
   aim put the target most of a metre high. `FigureRig.footPosition()` now derives
   the figure's actual ground position from its ankles, and that is what the camera
   aims at.

Framing at the mark, for reference — these are the numbers the lenses were chosen
against:

| State | Distance | Share of frame height |
|---|---|---|
| `FRONT` | 3.7 m | 71% |
| `SPECTATOR` | 4.8 m | 45% |
| `TRACK` | 3.2 m | 81% |
| `MODEL` | 3.7 m | 78% |

A long lens does not read as intimate here, it reads as a crop. `MODEL` was 24°
and overflowed the frame outright; the front-row lenses now sit at 33–36°.

### 2. Both are seats, not cameras on a dolly

Every camera position is a fixed place someone could be sitting in. This is
product principle 02: **the user is a spectator, not a game character.**

- Position **must not** follow the model. Only `INSPECT` and `MACRO` may travel,
  because the brief gives exactly those two a camera that "moves toward" the
  garment.
- Target **does** follow, for all of them. A spectator's eyes track an
  approaching model; a spectator who stares at the far wall while someone walks
  up to them is not watching.

Position and target carry **separate** flags for exactly this reason. Collapsing
them into one flag was a previous bug: it made `MODEL` ride along with the walk,
which is the precise thing that state forbids.

### 3. Eye level is seated

`RUNWAY.seatedEyeHeight` = 1.18 m. Standing height reads as a floating drone.

### 4. The two views must be genuinely different

Not two seats on the same axis. `SPECTATOR` is lateral to the ramp so the model
passes in profile — the view that actually shows how a garment moves, which a
head-on shot cannot. A check asserts the two seats are more than 3 m apart.

### 5. Blends between seats must clear the catwalk

Camera transitions are straight lines between seats. A chord that crosses the
runway puts the camera on the catwalk, which is the drone move principle 02
rules out. `SPECTATOR`'s Z is chosen so its chord to `FRONT` clears without an
exemption — if you move either seat, a check will fail.

`ARCHIVE` is exempt: it is the pull-back that leaves the room behind, not a seat.

---

## The states

| State | Seat | Position follows | Target follows | FOV | Purpose |
|---|---|---|---|---|---|
| `FRONT` | front row, far end, centreline | no | yes | 32° | **Primary view.** The walk, head-on. |
| `SPECTATOR` | front row, right side, z = 10.8 | no | yes | 42° | **Second view.** The model passing in profile. |
| `TRACK` | front row, one seat over | no | yes | 28° | Subtle focus tracking from a neighbouring seat. |
| `MODEL` | same seat as `FRONT` | no | yes | 24° | Longer lens as the model reaches the mark. Shares `FRONT`'s seat **by rule** — a different seat means the camera moves. |
| `INSPECT` | near the garment | **yes** | yes | 30° | Torso, close enough to read construction. |
| `MACRO` | very near the garment | **yes** | yes | 22° | Extreme material close-up. |
| `ARCHIVE` | behind the near end, elevated | no | no | 38° | Leaving the 3D room behind. |

---

## Verification

`npm run stage:check` encodes this contract. It is not a description of the
current state; it is the thing that fails when the views regress.

The load-bearing checks:

- **`FRONT looks back up the runway, so the model walks toward the lens`** —
  seat Z beyond the runway end, view direction Z negative. This is the direct
  guard on the original bug.
- **`FRONT is on the centreline`** — so the model is square to the lens.
- **`SPECTATOR is seated to one side of the ramp`** — X beyond the runway
  half-width.
- **`SPECTATOR is in the seating, alongside the runway rather than off its end`**
  — Z within the runway span.
- **`both views sit at seated eye level`**
- **`neither of the two views translates with the model`**
- **`the two views are genuinely different seats`**
- **`no seated-to-seated blend passes over the catwalk`**
- **`FRONT/SPECTATOR/TRACK/MODEL hold the figure at N m`** — framing, above

### Inspecting a view

```
npm run anim:view -- male walk --view=FRONT --travel=8
```

Renders what a camera state actually frames: builds the real `CameraPose`, runs
the pose through the same world-axis code the app uses, and projects through a
perspective camera at the pose's own FOV. `--travel` places the model at a chosen
point on the ramp. Offline rather than screenshotted because the dev tab cannot
reliably keep `visibilityState: 'visible'`, and without it the render loop never
produces a frame to capture.

`npm run anim:arms` is the companion for the body rather than the camera.

If you change a seat, run this suite before you believe the change.

---

## Also amended

### A2 — Arms pivot at the humerus head, not the acromion

Not a view change, but it was the same class of error: something structurally
correct on paper (a rigid arm chain rotated from the shoulder) that was wrong
about which joint is the shoulder.

`shoulder01` is the **acromion**, on the outer end of the clavicle. `upperarm01`
is the **humerus head**. They are 8.6 cm apart on the male figure and 7.5 cm on
the female, and that gap *is* the shoulder. Rotating the arm chain from the
acromion swung the deltoid down and inward with the arm, costing a third of the
shoulder's breadth and leaving the arms reading as though they grew out of the
neck. The chain now starts at `upperarm01`; `clavicle` and `shoulder01` stay at
bind.

`npm run anim:check` asserts the shoulder girdle does not move.