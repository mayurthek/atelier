# ATELIER

*Experience fashion history from the front row.*

An immersive digital fashion archive. Historical runway documentation is
reconstructed as a 3D show: you sit in the audience, watch reconstructed models
walk a runway in archival garments, and trace each garment back to the original
photography.

A hackathon MVP built around one collection — Martin Margiela, SS 1997 — with a
procedural garment pipeline and a procedurally animated walk cycle.

## Status

| Phase | | State |
|---|---|---|
| 1 | Asset pipeline | Done — 18/18 rig checks, 13.6 MB → 1.78 MB |
| 2 | Procedural animation | Done — 46/46 checks across both figures |
| 3 | Runway stage & camera | Not started |
| 4 | Garment generator | Not started |
| 5 | Inspection & THEN/NOW | Not started |
| 6 | Lookbook, archive, polish | Not started |

## Quick start

```bash
npm install
npm run check       # typecheck + gait and show invariants
npm run preview     # SVG contact sheet of the walk, both figures
```

The two optimised GLBs are committed, so the app can render them. Re-running the
asset pipeline additionally needs the raw Daz figures in `assets-src/` — see
[docs/ASSETS.md](docs/ASSETS.md), which also covers licensing.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run check` | typecheck + all invariant suites |
| `npm run assets:build` | convert `assets-src/` → `public/models/`, emit metrics |
| `npm run assets:check` | inspect any GLB's rig, meshes and textures |
| `npm run anim:check` | 24 gait invariants, both figures |
| `npm run show:check` | 22 full-show sequence invariants |
| `npm run preview` | gait contact sheets |

## How it works

### Assets

Two Daz 3D Genesis figures with an identical 163-joint rig, converted to web-ready
GLBs. They share bone names *and order*, which is the property that matters: one
animation system drives both, so male and female collections cost almost nothing
extra. The pipeline verifies the rig, strips dead weight, compresses textures, and
measures per-region body cross-sections for the garment generator.

→ [docs/ASSETS.md](docs/ASSETS.md)

### Animation

The source GLBs ship **no animation clips**, so the entire gait is generated as
curves over a normalised phase — entrance, walk, pose, turn, exit. Poses are
authored as world-axis rotations relative to bind pose rather than local euler
angles, which is what lets a single curve drive both rigs.

Every invariant is asserted against the real GLBs at a fixed 60 Hz timestep. The
walk cycles are numerically sound — no foot skating, no floor penetration, no
pose discontinuity — but the feel is tuned by eye in the viewport, and
`RUNWAY_WALK` in `src/lib/anim/walk.ts` is the single object to adjust.

→ [docs/ANIMATION.md](docs/ANIMATION.md)

## Layout

```
assets-src/            raw Daz figures (local only, gitignored)
content/               generated figure metrics
public/models/         optimised GLBs, committed
scripts/               asset pipeline + invariant suites + previews
  lib/                 rig contract, measurement, verification
src/lib/anim/          animation layer
  frames.ts            bind-pose capture, world-axis → local math
  walk.ts              gait curves
  clip.ts              idle / turn / entrance poses
  figure.ts            applies a pose to a skeleton
  show.ts              ShowDirector, owns the clock
docs/                  asset and animation notes
```

## Principles

From the product requirements, and the constraints this implementation follows:

1. **Fashion is the interface** — UI never overpowers the garments.
2. **The user is a spectator** — no free-fly camera; the rig stays seated.
3. **Archive before decoration** — every reconstruction carries provenance.
4. **Motion has meaning** — every transition is spatial or narrative.
5. **Reconstruction, not imitation** — garments are real geometry, never a
   photograph mapped onto a body.
6. **Fewer perfect looks beat dozens of mediocre ones.**

## Licence

Code and documentation in this repository are yours. The committed GLBs are
converted outputs of Daz Genesis base figures; see
[docs/ASSETS.md](docs/ASSETS.md#licensing) for the terms that apply before
redistribution.