# Flat-Illustration Renderer — Design

**Date:** 2026-05-12
**Status:** Approved, ready for implementation plan
**Scope:** Replace `src/renderer.js` with a renderer that produces a flat-color illustration effect (bilateral smoothing → median-cut quantization → saturation boost → bold contour lines), per `SHAPE-CAMERA-SPEC.md`.

## Goals

Produce a real-time camera effect that looks like a flat gouache illustration (Michael Craig-Martin reference): large contiguous regions of saturated solid color separated by uniform bold dark contour lines. Replace, not augment, the current squares/lines abstraction. Hold 60fps on a mid-range mobile device at the existing source-canvas resolution (~170×300).

## Non-goals

- Test framework introduction. The repo has none today; adding one is unrelated scope.
- Touching `camera.js`, `capture.js`, the freeze-on-hold model, `inputX` input plumbing, the start-screen flow, or the save button.
- WebGL or shader-based implementation. Pure 2D canvas + typed arrays.
- Palette caching across frames. Recompute every frame; revisit only if profiling forces it.

## Decisions (resolved during brainstorming)

| Question | Decision |
|---|---|
| Relationship to current renderer | **Replace entirely.** Remove Squares/Lines buttons. |
| Quantization method | **Median cut.** |
| Palette cadence | **Every frame.** Profile first; cache only if forced. |
| What `simplification` controls | **Color count + smoothing + edge thickness, linked.** One axis. |
| Output style | **Edge-to-edge flat regions + black contour lines.** No grid, no gaps. |
| Color modes | **Transform applied after quantization, on the K-entry palette.** |
| Success bar | **Aesthetic + 60fps mobile.** Both required. |
| Pipeline structure | **Option A: Smooth → Quantize → Boost → Edges → Composite.** |

## Architecture

### File changes

- `src/renderer.js` — rewritten. Same exported function name `render` with the same signature, so `main.js` keeps the same call site shape.
- `src/main.js` — remove `shapeMode` state, `setShape` function, `#shape-modes` button wiring, `cellSize` math (no longer meaningful). Pass new `opts`.
- `index.html` — remove the `#shape-modes` div containing Squares/Lines buttons.
- `src/style.css` — leave alone. Orphaned `.mode-btn` rules are harmless; removing them is out of scope.

### New `opts` shape passed to `render()`

```js
{
  simplification: 0..1,             // renamed from cellSize-driver; same number as before
  colorMode: 'normal' | 'bw' | 'invert',
}
```

`cellSize` and `shapeMode` are removed.

### Return value

`{ levels: number }` — the active palette size (e.g. 8). HUD switches from `cols×rows` to `${levels} colors`.

### Internal decomposition inside `renderer.js`

Four pure functions, typed-array in / typed-array out, plus the orchestrator. No shared mutable state; module-scope buffers are preallocated and reused.

- `bilateralSmooth(srcRGBA, sw, sh, radius, sigmaColor) → smoothedRGBA`
- `medianCutQuantize(rgba, sw, sh, k) → { palette: Uint8Array, indices: Uint8Array }`
- `transformPalette(palette, satMul, colorMode) → palette` (saturation boost + color mode, in place; runs K times, not N)
- `detectEdges(indices, sw, sh, thickness) → edgeMask: Uint8Array`
- `render(ctx, sourceData, sw, sh, outW, outH, opts)` — orchestrator + composite

### Reusable buffers

Module-scope `Uint8Array` and `Uint8ClampedArray` references for `smoothBuf`, `indices`, `edgeMask`, `outBuf`, plus a `workCanvas` (`OffscreenCanvas` or a hidden `<canvas>`) sized to source. All reallocated only when source dimensions change.

## Frame pipeline

### Derived per-frame parameters from `simplification`

- `paletteSize = round(lerp(16, 5, simplification))`
- `bilateralRadius = lerp(1, 2, simplification)` (kernel `(2r+1)²` → 3×3 at left, 5×5 at right)
- `sigmaColor = lerp(20, 40, simplification)` (RGB distance threshold)
- `edgeThickness = round(lerp(1, 3, simplification))` (pixels of dilation on edge mask)

### Step 1 — Bilateral smoothing

For each pixel, walk the `(2r+1)²` neighborhood. Accept a neighbor into a uniform-weight average iff its squared RGB distance to the center pixel is below `sigmaColor²`. (Cheaper-than-full bilateral: box spatial kernel, hard color threshold instead of Gaussians. Visually equivalent at these kernel sizes.) Out-of-bounds neighbor coords are clamped to the source rect.

### Step 2 — Median cut quantization

Downsample for palette building: collect every other pixel in x and y into a working list of ~`(sw·sh)/4` RGB triples. Repeatedly split the bucket with the largest range along its longest axis until `paletteSize` buckets exist. Each bucket's mean color is one palette entry. Stop splitting early if every bucket has zero range (degenerate all-same-color frame).

Assign full-resolution pixels their nearest palette index by linear scan over the ≤16 entries.

### Step 3 — Palette transform (saturation + color mode)

Convert each palette entry RGB→HSL, multiply S by 1.4 clamp to 1.0, convert back. Then apply `COLOR_TRANSFORMS[colorMode]` to each entry: identity for `normal`, luminance-to-gray for `bw`, channel inversion for `invert`. Done in place on the K-entry palette — cost is independent of resolution.

### Step 4 — Edge detection on the index map

For each pixel: edge iff any of its 4-neighbors has a different palette index. Skip 8-connectivity (negligible visual win at this resolution, 2× cost). If `edgeThickness > 1`, dilate `edgeThickness - 1` times (any-neighbor-is-edge → edge).

### Step 5 — Composite

For each pixel:
- `edgeMask[i] == 1` → write `rgb(10,10,10)` (near-black contour)
- else → write palette[indices[i]] (already transformed)

Write `outBuf` to the source-sized `workCanvas`. Then upscale to the output canvas:

```js
ctx.imageSmoothingEnabled = false;
ctx.drawImage(workCanvas, 0, 0, outW, outH);
```

Nearest-neighbor upscaling preserves the crisp contour lines and flat-region edges.

## Error handling

`render()` runs in a hot loop with trusted inputs from `camera.drawFrame`. No try/catch, no input validation. Bad inputs (zero-size source, NaN simplification) indicate bugs elsewhere and should crash loudly. Camera permission failure is handled at start-screen time, unchanged.

## Edge cases

- `paletteSize == 1`: median cut returns one bucket = mean color, edge mask all zeros, output is a single flat color. No special case.
- All-same-color frame: median cut terminates early when all remaining buckets have zero range.
- Source resize: buffers reallocated at the top of `render()` when `sw*sh` differs from cached size. One-time, not steady-state cost.

## Performance bounds

Per-frame budget: 16.6ms at 60fps; realistic JS canvas budget on mid-range mobile is 8–10ms.

Cost model at mobile source (170×300 = 51k pixels), worst case at `simplification = 1`:

| Step | Work | Approx ops |
|---|---|---|
| Bilateral 5×5 | 51k × 25 neighbors × ~5 FLOPs | ~6M |
| Median cut build | ~12.75k samples × log₂(16) split passes | ~50k |
| Index assignment | 51k × 16 palette entries | ~800k dot products |
| Edge + dilation | 51k × ~8 lookups | ~400k |
| Composite | 51k writes | 51k |

Bilateral dominates. **Fallback plan if mobile profiling forces it:** swap Step 1 for a mode-filter pass on indices (Option B from brainstorming). Same orchestrator, one function swap, no other changes.

## Testing

This project has no test framework configured. Adding one is out of scope. Testing plan is two-track:

### Pure-function correctness — temporary scratch harness

Throwaway `scratch.html` loads `renderer.js` and runs each pure function on small synthetic inputs with `console.assert`:

1. **Median cut**: on an 8×8 image with 3 distinct color regions and `paletteSize=4`, assert 3 of 4 palette entries are within color-distance 5 of the original region colors.
2. **Bilateral smoothing**: on a 2-region image with a sharp boundary, assert pixels adjacent to the boundary keep their region's color (no bleed).
3. **Edge detection**: on a 2-region indexed image, assert the edge mask equals the set of pixels with at least one 4-neighbor in the other region.

Delete `scratch.html` before declaring the work done. Not committed.

### Visual correctness — running app

`npm run dev`, then walk this checklist:

1. High-contrast scene (hand against wall): clean flat regions, bold black contour.
2. Noisy scene (foliage, fabric pattern): aggressive simplification at high `simplification`, more detail at low.
3. Slide `simplification` end-to-end: smooth transition, no flicker on palette changes.
4. Each color mode (normal / bw / invert): transform applied to flat regions, contour lines unchanged near-black.
5. Freeze-on-hold: geometry stays still as `simplification` changes, since underlying `ImageData` is cached.

### Performance check

- Desktop Chrome DevTools Performance recording, 5s: no long frames > 16ms.
- Chrome mobile emulation, 4× CPU throttle: no long frames > 20ms.
- Real mid-range Android device if available. Requires HTTPS for `getUserMedia` over LAN — flagged as a known constraint, not solved here.

### Done criterion

Pure-function checks pass AND visual checks pass AND desktop perf check passes. Mobile perf verified if a device is available; if not, status documented in the PR.

## Out of scope (explicitly)

- Palette caching across frames
- WebGL implementation
- Reintroducing Squares/Lines as an alternate mode
- HTTPS setup for LAN mobile testing
- Removing orphaned `.mode-btn` CSS rules
- Test framework adoption
