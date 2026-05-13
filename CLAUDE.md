# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (camera APIs require https or localhost; getUserMedia will not work over LAN IP without https).
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the built output.

There are no tests, linter, or typechecker configured.

## Architecture

Vanilla JS + Vite single-page app. No framework, no bundled state — everything is module-scoped variables in `src/main.js`. The whole app is a `requestAnimationFrame` loop processing camera frames.

### Frame pipeline

Three canvases work together (declared in `index.html`):
1. `#video` (hidden) — raw `MediaStream` from `getUserMedia`.
2. `#source` (hidden, `willReadFrequently: true`) — downscaled working canvas at ~40–50% of viewport size. Camera frames are drawn here, then `getImageData` reads pixels back for the renderer.
3. `#output` — fullscreen visible canvas at viewport resolution; receives the rendered result.

The loop in `main.js` runs every frame: `camera.drawFrame(sctx)` → `sctx.getImageData()` → `render(ctx, sourceData, ...)`. Source resolution is deliberately low (~170×300 on mobile) because pixel sampling cost dominates; do not bypass this.

### Freeze-on-hold behavior

Touching/clicking sets `isTouching = true` and the loop reuses the cached `frozenData` ImageData instead of reading a new frame — so the geometry continues animating against the user's X position but the underlying photo is frozen. Releasing clears `frozenData`. Don't break this: the cached ImageData must come from `sctx.getImageData()` at the moment of touch-start, not earlier.

### Renderer contract

`src/renderer.js` exports `render(ctx, sourceData, sw, sh, outW, outH, opts)` and returns `{ cols, rows }` for the HUD. Current implementation renders abstract geometry (squares sized by brightness, or gradient-angled lines) sampled per grid cell — `sampleBlock()` averages a block of source pixels into one color. `opts.cellSize` is computed from `inputX` (mouse/touch X position, 0–1) — left = fine grid, right = chunky.

`opts.colorMode` is `'normal' | 'bw' | 'invert'`, applied via `COLOR_TRANSFORMS` after sampling. `opts.shapeMode` is `'squares' | 'lines'`.

### Input model (don't break)

- X position (mouse/touch) → `inputX` → `cellSize`. This is the only continuous control.
- Hold (mousedown/touchstart) → freeze the source frame.
- UI buttons must `stopPropagation` on `touchstart`/`touchend`/`click` because the document-level handlers would otherwise treat a button tap as a freeze gesture. Any new UI control needs the same three handlers.

### Mobile specifics

`isMobile` is detected by `'ontouchstart' in window`. It controls source-canvas scale (0.4 vs 0.5), default camera facing (`environment` vs `user`), and capture resolution. The front camera is mirrored in `camera.drawFrame()` via `ctx.scale(-1, 1)`.

## SHAPE-CAMERA-SPEC.md

`SHAPE-CAMERA-SPEC.md` describes a **different, aspirational renderer** — a flat-color illustration effect with color quantization, bilateral filtering, and bold contour lines. **This is not what `src/renderer.js` currently does** (it does grid-based shape abstraction). Treat the spec as a design brief for a future replacement renderer, not a description of current behavior. The spec's "Don't Change" section (camera, capture, interaction model, UI wiring) still applies.
