# Assets

## Source figures

Both figures are humanoid base characters, exported from Blender (Khronos glTF
I/O v3.3.36) and supplied as `.glb`:

| Source | Shipped as | Height |
|---|---|---|
| `assets-src/male_raw.glb` | `public/models/male.glb` | 1.632 m |
| `assets-src/female_raw.glb` | `public/models/female.glb` | 1.673 m |

### Licensing

`assets-src/` is **gitignored**. Only the converted output in `public/models/`
is committed.

The raw files are not redistributable, so confirm the terms of wherever these
were obtained before publishing anything. If they came from a bundle that
grants use rights but not redistribution rights, shipping the converted GLB is
the correct call; shipping the source is not. If in doubt, keep both out of a
public repo and substitute a differently-licensed figure — the pipeline is
asset-agnostic as long as the rig matches the contract below.

## Why these two work

The single most valuable property is that **both share an identical 163-joint
hierarchy — same bone names, same order**. Every animation clip authored
against one figure is valid on the other, so male and female collections cost
almost nothing extra.

The second is cost: the body is only ~27k triangles. That leaves a generous
vertex budget for procedural garments without threatening the frame rate.

## Pipeline

```bash
npm run assets:build     # assets-src/ -> public/models/ + content/figure-metrics.json
npm run assets:check     # inspect any GLB, default the two shipped models
```

`assets-src/`, `content/figure-metrics.json` and `preview/` are gitignored — the
pipeline regenerates them, and the source models are not ours to redistribute. A
fresh clone has the two optimised GLBs, but needs `assets-src/` populated locally
before the pipeline can re-run.

Order matters inside the pipeline: measurement runs **before** any topology
optimisation, because `dedup` and `quantize` change vertex identity and would
invalidate the body profile.

### What it does

1. **Verify** the rig against the contract in `scripts/lib/rig.ts`
2. **Measure** landmarks and per-region cross-sections
3. **Strip** meshes that are dead weight or the wrong period
4. **Prune + dedup** — deliberately *no* weld (see below)
5. **Compress** textures to JPEG q90, 4:4:4, capped at 2048
6. **Write**, then re-verify what actually landed on disk

### Stripped, and why

| Stripped | Cost | Reason |
|---|---|---|
| `*-casualsuit02/01` | 4.1k tris, 2.2 MB map | Contemporary silhouette, wrong period. Procedural garments replace it. |
| `*-shoes02` | 3.1k tris, 1.2 MB map | Same. |
| `*-teeth_base` | 7.1k tris, 1.7 MB map | Interior geometry behind closed lips. Never visible at runway distance or during inspection. |
| `*-tongue01` | 0.4k tris, 0.6 MB map | Same. |
| `*-low_poly` | 0.2k tris | A 96-vertex proxy carried over from the source scene. Too coarse to render, intent unknown. |

Kept: `*-base` (body), `*-eyebrow001`, and hair (`*-short04` / `*-braid01`).

Result: **13.63 MB → 1.78 MB** and **14.59 MB → 1.86 MB**, both 87% smaller.

### Why not `weld()`

On a skinned mesh, welding merges vertices that share a position but carry
different joint weights. It quietly tears the deformation at the seam. Not worth
the bytes.

### Why JPEG and not KTX2

KTX2 needs `toktx` from KTX-Software, which is not installed. Base-colour maps
compress to roughly a tenth of their PNG size at JPEG q90 with 4:4:4 chroma
(preserving small dark details like eyebrows and lashes) and stay inside core
glTF 2.0, so no extension is required. Normal and ORM maps are excluded and
stay lossless PNG — JPEG ringing in a normal map reads as lighting noise.

If KTX2 becomes worth it, `compressTextures()` is the single place to change.

## Two traps in these files

Both are encoded in `scripts/lib/measure.ts` with comments, because each one
silently produces plausible-looking wrong numbers rather than an error.

**1. A 0.1 scale on the wrapper node.** The meshes sit under a node scaled to
0.1, which the skin's inverse bind matrices cancel. Reading raw `POSITION`
values reports a figure roughly 1/6 of its real height. Measurement reproduces
the glTF formula exactly:

```
rendered = SUM_i  w_i * (jointWorld_i * IBM_i) * v
```

Note there is deliberately **no** extra `nodeWorld` multiply — the IBM already
encodes the inverse of `(meshNodeWorld * jointWorld_bind)`, so applying it again
double-counts the scale.

**2. T-pose arms.** Both figures are in a T-pose, so a single horizontal profile
is useless: at shoulder height it measures the arms and reports a 1.72 m
"waist". Two corrections are applied:

- vertices are assigned to a body region by their **dominant weighted joint**,
  which separates torso from limbs
- each region is sliced along **its own axis** — world Y for torso and legs,
  shoulder-to-wrist for arms, since a horizontal arm cannot be profiled by
  height at all

Both are asserted in `verifyRig()`, so a regression fails the build rather than
quietly corrupting the garment fit in Phase 4.

## `content/figure-metrics.json`

Consumed by the Phase 4 garment generator. Per figure:

- `landmarks` — 28 named bone positions in bind pose
- `restPoseQuaternions` — all 163, so the animation layer can blend from rest
- `regions` — cross-sections per body region (`torso`, `armL/R`, `legL/R`)
- `axes` — the axis each region was sliced along
- `segments` — derived limb lengths
- `restArmAngleDeg` — ~89°, confirming T-pose
- `height`, `crownY`, `soleY`, `bounds`, `maxAsymmetry`

Measured values for the male figure:

```
height 1.632 m   shoulders 0.198 m   hips 0.204 m   thigh 0.399 m
restArm 88.86°   maxAsymmetry 0.1 mm
```

## No animations

The source files contain **no animation clips**. Phase 2 authors the walk cycle
procedurally by driving `Bone.quaternion` directly across the 38 bones in
`ANIMATED_BONES`. The 65 facial bones (indices 64–122) hold their bind
transform — the face stays neutral, which is what a runway wants anyway.

## Bone contract

`RIG_JOINTS` in `scripts/lib/rig.ts` hardcodes all 163 names in order. If a
future asset has a different rig, `verifyRig()` fails and names the first
offending bone rather than shipping a figure that animates in half its limbs.