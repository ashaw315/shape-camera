# Flat-Illustration Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/renderer.js` with a flat-illustration renderer (bilateral smooth → median-cut quantize → palette transform → contour-line edges → nearest-neighbor upscale) that hits 60fps on mid-range mobile.

**Architecture:** Four pure typed-array functions plus an orchestrator inside `src/renderer.js`. Module-scope buffers preallocated and resized only when source dimensions change. Output composited into a source-sized `OffscreenCanvas` then drawn to the visible canvas with `imageSmoothingEnabled = false`.

**Tech Stack:** Vanilla JS, Vite 6, Canvas 2D, `Uint8Array` / `Uint8ClampedArray`. No new dependencies. No test framework (use throwaway `scratch.html` with `console.assert`).

**Spec:** `docs/superpowers/specs/2026-05-12-flat-illustration-renderer-design.md`

**Repo state notes the implementer must accept:**
- This directory is not a git repo. The "Commit" steps below assume `git init` has been run; if not, treat them as "save the file and move on" checkpoints. Do NOT run `git init` without asking the user.
- There is no test framework. The "test" steps use a temporary `scratch.html` page with `console.assert`. Delete it before declaring the work done.
- Camera-using pages need https or localhost. `npm run dev` on localhost is fine; LAN IP testing requires HTTPS and is out of scope.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/renderer.js` | Rewrite | The new pipeline: 4 pure functions + `render()` orchestrator |
| `src/main.js` | Modify | Drop `shapeMode` state and wiring; pass new `opts`; update HUD |
| `index.html` | Modify | Remove `#shape-modes` div |
| `scratch.html` | Create (temp) | Pure-function correctness harness; DELETED at end of plan |
| `docs/superpowers/specs/2026-05-12-flat-illustration-renderer-design.md` | Read-only | Source of truth |

---

## Task 1: Scaffold new renderer.js skeleton with stub functions

**Files:**
- Modify: `src/renderer.js` (full rewrite)

- [ ] **Step 1: Replace `src/renderer.js` contents with the skeleton below**

This task only defines the module shape. Every function returns a placeholder so `main.js` can keep importing `render`. We fill them in later tasks.

```js
/**
 * Shape Camera renderer — flat-illustration effect.
 *
 * Pipeline per frame:
 *   bilateral smooth -> median-cut quantize -> palette transform -> edges -> composite
 *
 * Exported: render(ctx, sourceData, sw, sh, outW, outH, opts) -> { levels }
 */

// ── module-scope reusable buffers ──
let bufSW = 0, bufSH = 0;
let smoothBuf = null;          // Uint8ClampedArray, sw*sh*4
let indices = null;            // Uint8Array, sw*sh
let edgeMask = null;           // Uint8Array, sw*sh
let outBuf = null;             // Uint8ClampedArray, sw*sh*4
let workCanvas = null;         // OffscreenCanvas | HTMLCanvasElement
let workCtx = null;

function ensureBuffers(sw, sh) {
  if (sw === bufSW && sh === bufSH) return;
  bufSW = sw; bufSH = sh;
  const n = sw * sh;
  smoothBuf = new Uint8ClampedArray(n * 4);
  indices = new Uint8Array(n);
  edgeMask = new Uint8Array(n);
  outBuf = new Uint8ClampedArray(n * 4);
  if (typeof OffscreenCanvas !== 'undefined') {
    workCanvas = new OffscreenCanvas(sw, sh);
  } else {
    workCanvas = document.createElement('canvas');
    workCanvas.width = sw; workCanvas.height = sh;
  }
  workCtx = workCanvas.getContext('2d');
}

// ── pure pipeline functions (stubs filled in later tasks) ──

export function bilateralSmooth(src, sw, sh, radius, sigmaColor, dst) {
  // Task 2 fills this in. For now, copy src to dst so the pipeline is wired.
  dst.set(src);
  return dst;
}

export function medianCutQuantize(rgba, sw, sh, k, indicesOut) {
  // Task 3 fills this in. Placeholder: one-entry palette = mean color, all indices 0.
  let r = 0, g = 0, b = 0;
  const n = sw * sh;
  for (let i = 0; i < n; i++) {
    r += rgba[i * 4];
    g += rgba[i * 4 + 1];
    b += rgba[i * 4 + 2];
  }
  const palette = new Uint8Array(k * 3);
  palette[0] = Math.round(r / n);
  palette[1] = Math.round(g / n);
  palette[2] = Math.round(b / n);
  indicesOut.fill(0);
  return { palette, usedK: 1 };
}

export function transformPalette(palette, usedK, satMul, colorMode) {
  // Task 4 fills this in. For now, pass-through.
  return palette;
}

export function detectEdges(idx, sw, sh, thickness, mask) {
  // Task 5 fills this in. Placeholder: no edges.
  mask.fill(0);
  return mask;
}

// ── orchestrator ──

export function render(ctx, sourceData, sw, sh, outW, outH, opts) {
  const { simplification, colorMode } = opts;
  ensureBuffers(sw, sh);

  const paletteSize = Math.round(16 + (5 - 16) * simplification);   // 16..5
  const bilateralRadius = 1 + simplification * 1;                    // 1..2
  const sigmaColor = 20 + simplification * 20;                       // 20..40
  const edgeThickness = Math.round(1 + simplification * 2);          // 1..3

  bilateralSmooth(sourceData.data, sw, sh, bilateralRadius, sigmaColor, smoothBuf);

  const q = medianCutQuantize(smoothBuf, sw, sh, paletteSize, indices);
  const palette = transformPalette(q.palette, q.usedK, 1.4, colorMode);

  detectEdges(indices, sw, sh, edgeThickness, edgeMask);

  // composite
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    if (edgeMask[i]) {
      outBuf[o] = 10; outBuf[o + 1] = 10; outBuf[o + 2] = 10; outBuf[o + 3] = 255;
    } else {
      const p = indices[i] * 3;
      outBuf[o] = palette[p];
      outBuf[o + 1] = palette[p + 1];
      outBuf[o + 2] = palette[p + 2];
      outBuf[o + 3] = 255;
    }
  }

  const img = new ImageData(outBuf, sw, sh);
  workCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(workCanvas, 0, 0, outW, outH);

  return { levels: q.usedK };
}
```

- [ ] **Step 2: Update `src/main.js` to call the new signature**

Open `src/main.js`. Find the section labeled `// ── SHAPE MODE ──` (around line 106) and the render-loop section (around line 200). Apply these edits:

a. Delete the `shapeMode` state line (line 30):

```js
let shapeMode = 'squares';
```

b. Delete the entire `// ── SHAPE MODE ──` block (the `setShape` function and the `mode-btn` event wiring loop). Lines roughly 106–122.

c. In the render loop, replace the cellSize-and-render section. Find:

```js
  // cell size: 3px (fine) → 60px (chunky) in source-canvas space
  const minCell = 3;
  const maxCell = 60;
  const cellSize = Math.round(minCell + inputX * (maxCell - minCell));

  // render
  const { cols, rows } = render(
    ctx, sourceData, SW, SH,
    output.width, output.height,
    { cellSize, shapeMode, colorMode },
  );

  gridLabel.textContent = `${cols}×${rows}`;
```

Replace with:

```js
  // render
  const { levels } = render(
    ctx, sourceData, SW, SH,
    output.width, output.height,
    { simplification: inputX, colorMode },
  );

  gridLabel.textContent = `${levels} colors`;
```

- [ ] **Step 3: Update `index.html` to remove shape-mode buttons**

Open `index.html`. Find the `<div id="shape-modes">...</div>` block (lines 50–53). Delete the entire div, including its two button children. Leave the parent `#bottom-bar` div in place — it should now contain only the `#color-modes` div.

- [ ] **Step 4: Run dev server and verify the pipeline is wired**

Run: `npm run dev`

Open the localhost URL Vite prints. Click "Enable Camera." Expected: the screen fills with **one flat color** (the average of the camera frame), updating in real time. The HUD shows `1 colors`. Color-mode buttons still work (the single color changes per mode after later tasks; right now `transformPalette` is pass-through so they have no effect). No JS errors in the console.

If the screen is white/black or you see errors, the wiring is wrong — fix before continuing.

- [ ] **Step 5: Save / commit**

```bash
# if the repo has been git init'd:
git add src/renderer.js src/main.js index.html
git commit -m "feat(renderer): scaffold flat-illustration pipeline with stubs"
# if not, skip — file save is the checkpoint
```

---

## Task 2: Implement bilateral smoothing

**Files:**
- Modify: `src/renderer.js` (replace stub of `bilateralSmooth`)
- Test: `scratch.html` (new, temporary)

- [ ] **Step 1: Create `scratch.html` with the smoothing test**

Create `scratch.html` at the project root:

```html
<!DOCTYPE html>
<html><body>
<h1>scratch — open the console</h1>
<script type="module">
import { bilateralSmooth, medianCutQuantize, detectEdges } from '/src/renderer.js';

// ── bilateralSmooth: 2-region image, sharp boundary, no bleed ──
{
  const sw = 8, sh = 1;
  const src = new Uint8ClampedArray(sw * sh * 4);
  // left 4 pixels red, right 4 pixels blue
  for (let i = 0; i < 4; i++) { src[i*4] = 255; src[i*4+3] = 255; }
  for (let i = 4; i < 8; i++) { src[i*4+2] = 255; src[i*4+3] = 255; }
  const dst = new Uint8ClampedArray(sw * sh * 4);
  bilateralSmooth(src, sw, sh, 1, 30, dst);

  // pixel 3 (last red) should still be red, pixel 4 (first blue) should still be blue.
  console.assert(dst[3*4] > 200 && dst[3*4+2] < 30, 'bilateral: red region bled', dst.slice(12,16));
  console.assert(dst[4*4+2] > 200 && dst[4*4] < 30, 'bilateral: blue region bled', dst.slice(16,20));
  console.log('bilateral: pass');
}
</script>
</body></html>
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npm run dev`. Open `http://localhost:5173/scratch.html`. Console expected: assertion failures (because the stub `bilateralSmooth` just copies src to dst — which actually *passes* this particular test). If both pass, the test is too weak. Strengthen by adding:

```js
// also check that a noisy pixel within a region IS smoothed away
{
  const sw = 5, sh = 1;
  const src = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < 5; i++) { src[i*4] = 200; src[i*4+3] = 255; } // all dark red
  src[2*4] = 200; src[2*4+1] = 200; src[2*4+2] = 200; // noisy middle pixel = bright gray
  const dst = new Uint8ClampedArray(sw * sh * 4);
  bilateralSmooth(src, sw, sh, 1, 80, dst);
  // middle should now be closer to red (neighbors dragged it down on G/B channels)
  console.assert(dst[2*4+1] < 150, 'bilateral: noisy pixel not smoothed', dst.slice(8,12));
  console.log('bilateral noisy: pass');
}
```

The stub (which copies src to dst) leaves the noisy pixel untouched, so this assertion fails. Now we have a failing test.

- [ ] **Step 3: Implement `bilateralSmooth` in `src/renderer.js`**

Replace the stub with:

```js
export function bilateralSmooth(src, sw, sh, radius, sigmaColor, dst) {
  const r = Math.max(1, Math.round(radius));
  const sigSq = sigmaColor * sigmaColor;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const ci = (y * sw + x) * 4;
      const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
      let sr = 0, sg = 0, sb = 0, count = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(sh - 1, y + r);
      const x0 = Math.max(0, x - r), x1 = Math.min(sw - 1, x + r);
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const ni = (ny * sw + nx) * 4;
          const dr = src[ni] - cr, dg = src[ni + 1] - cg, db = src[ni + 2] - cb;
          if (dr * dr + dg * dg + db * db <= sigSq) {
            sr += src[ni]; sg += src[ni + 1]; sb += src[ni + 2];
            count++;
          }
        }
      }
      dst[ci] = (sr / count) | 0;
      dst[ci + 1] = (sg / count) | 0;
      dst[ci + 2] = (sb / count) | 0;
      dst[ci + 3] = 255;
    }
  }
  return dst;
}
```

- [ ] **Step 4: Reload `scratch.html`, verify both bilateral tests pass**

Browser refresh. Console expected:
```
bilateral: pass
bilateral noisy: pass
```

- [ ] **Step 5: Run the app, verify visual sanity**

Reload `http://localhost:5173`. Expected: still a single flat color (median cut is still stubbed). The flat color may have shifted slightly (it's now the mean of the smoothed image, not the raw image). No errors, no perf regression visible.

- [ ] **Step 6: Save / commit**

```bash
git add src/renderer.js scratch.html
git commit -m "feat(renderer): bilateral smoothing with color-threshold kernel"
```

---

## Task 3: Implement median-cut quantization

**Files:**
- Modify: `src/renderer.js` (replace stub of `medianCutQuantize`)
- Modify: `scratch.html` (add quantization test)

- [ ] **Step 1: Add the quantization test to `scratch.html`**

Append inside the `<script>` block:

```js
// ── medianCutQuantize: 3 distinct color regions, k=4 ──
{
  const sw = 12, sh = 1;
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  const regions = [[255,0,0],[0,255,0],[0,0,255]];
  for (let i = 0; i < 12; i++) {
    const c = regions[Math.floor(i/4)];
    rgba[i*4] = c[0]; rgba[i*4+1] = c[1]; rgba[i*4+2] = c[2]; rgba[i*4+3] = 255;
  }
  const indices = new Uint8Array(sw * sh);
  const { palette, usedK } = medianCutQuantize(rgba, sw, sh, 4, indices);
  console.assert(usedK >= 3, 'quantize: usedK should be >=3', usedK);

  // each region's pixels should share an index
  const r0 = indices[0], r1 = indices[4], r2 = indices[8];
  console.assert(indices[1] === r0 && indices[2] === r0 && indices[3] === r0, 'quantize: region 0 fractured');
  console.assert(indices[5] === r1 && indices[6] === r1 && indices[7] === r1, 'quantize: region 1 fractured');
  console.assert(indices[9] === r2 && indices[10] === r2 && indices[11] === r2, 'quantize: region 2 fractured');
  console.assert(r0 !== r1 && r1 !== r2 && r0 !== r2, 'quantize: regions share an index');
  console.log('quantize: pass');
}
```

- [ ] **Step 2: Reload, verify the test FAILS**

The stub returns `usedK: 1` and all-zero indices, so the first three asserts fail. Confirmed failing test.

- [ ] **Step 3: Implement `medianCutQuantize`**

Replace the stub with:

```js
export function medianCutQuantize(rgba, sw, sh, k, indicesOut) {
  // Build sample list — every other pixel in x and y (4x downsample).
  const sampleStride = 2;
  const samples = [];
  for (let y = 0; y < sh; y += sampleStride) {
    for (let x = 0; x < sw; x += sampleStride) {
      const i = (y * sw + x) * 4;
      samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
  }

  // Each bucket = { points: [...], ranges: [rR,rG,rB] }
  function bucketStats(points) {
    let rmin=255,rmax=0, gmin=255,gmax=0, bmin=255,bmax=0;
    for (const p of points) {
      if (p[0]<rmin) rmin=p[0]; if (p[0]>rmax) rmax=p[0];
      if (p[1]<gmin) gmin=p[1]; if (p[1]>gmax) gmax=p[1];
      if (p[2]<bmin) bmin=p[2]; if (p[2]>bmax) bmax=p[2];
    }
    return [rmax-rmin, gmax-gmin, bmax-bmin];
  }

  let buckets = [{ points: samples, ranges: bucketStats(samples) }];
  while (buckets.length < k) {
    // pick bucket with largest single-channel range
    let bi = -1, best = -1;
    for (let i = 0; i < buckets.length; i++) {
      const r = Math.max(...buckets[i].ranges);
      if (r > best) { best = r; bi = i; }
    }
    if (best <= 0) break; // degenerate: nothing left to split
    const b = buckets[bi];
    const axis = b.ranges.indexOf(Math.max(...b.ranges));
    b.points.sort((p, q) => p[axis] - q[axis]);
    const mid = b.points.length >> 1;
    const left = b.points.slice(0, mid);
    const right = b.points.slice(mid);
    if (left.length === 0 || right.length === 0) break;
    buckets.splice(bi, 1,
      { points: left, ranges: bucketStats(left) },
      { points: right, ranges: bucketStats(right) },
    );
  }

  // Palette = mean of each bucket
  const usedK = buckets.length;
  const palette = new Uint8Array(k * 3);
  for (let i = 0; i < usedK; i++) {
    let sr=0, sg=0, sb=0;
    for (const p of buckets[i].points) { sr+=p[0]; sg+=p[1]; sb+=p[2]; }
    const n = buckets[i].points.length;
    palette[i*3] = (sr/n)|0;
    palette[i*3+1] = (sg/n)|0;
    palette[i*3+2] = (sb/n)|0;
  }

  // Assign every full-res pixel its nearest palette index
  const n = sw * sh;
  for (let i = 0; i < n; i++) {
    const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2];
    let bestI = 0, bestD = Infinity;
    for (let p = 0; p < usedK; p++) {
      const dr = r - palette[p*3], dg = g - palette[p*3+1], db = b - palette[p*3+2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestD) { bestD = d; bestI = p; }
    }
    indicesOut[i] = bestI;
  }

  return { palette, usedK };
}
```

- [ ] **Step 4: Reload `scratch.html`, verify quantize test passes**

Console expected: `quantize: pass`. Earlier `bilateral` asserts still pass.

- [ ] **Step 5: Run the app**

Reload `http://localhost:5173`. Expected: the screen now shows **multiple flat color regions** (not one). HUD shows e.g. `8 colors`. Move the mouse left/right — color count should change roughly from 16 down to 5. No edges yet (still a stub). Colors look unsaturated — that's expected, saturation boost is in the next task.

- [ ] **Step 6: Save / commit**

```bash
git add src/renderer.js scratch.html
git commit -m "feat(renderer): median-cut color quantization"
```

---

## Task 4: Implement palette transform (saturation boost + color mode)

**Files:**
- Modify: `src/renderer.js` (replace stub of `transformPalette`, add HSL helpers)

- [ ] **Step 1: Add HSL conversion helpers above `transformPalette`**

In `src/renderer.js`, add these helpers before the `transformPalette` export:

```js
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = (l * 255) | 0; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h;
  const t = [hk + 1/3, hk, hk - 1/3].map(x => x < 0 ? x + 1 : x > 1 ? x - 1 : x);
  const ch = t.map(x => {
    if (x < 1/6) return p + (q - p) * 6 * x;
    if (x < 1/2) return q;
    if (x < 2/3) return p + (q - p) * (2/3 - x) * 6;
    return p;
  });
  return [(ch[0]*255)|0, (ch[1]*255)|0, (ch[2]*255)|0];
}
```

- [ ] **Step 2: Replace `transformPalette` stub**

```js
export function transformPalette(palette, usedK, satMul, colorMode) {
  for (let i = 0; i < usedK; i++) {
    const p = i * 3;
    let r = palette[p], g = palette[p+1], b = palette[p+2];

    // saturation boost in HSL
    const [h, s, l] = rgbToHsl(r, g, b);
    const s2 = Math.min(1, s * satMul);
    [r, g, b] = hslToRgb(h, s2, l);

    // color mode transform
    if (colorMode === 'bw') {
      const y = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
      r = g = b = y;
    } else if (colorMode === 'invert') {
      r = 255 - r; g = 255 - g; b = 255 - b;
    }
    palette[p] = r; palette[p+1] = g; palette[p+2] = b;
  }
  return palette;
}
```

- [ ] **Step 3: Run the app, verify saturation + color modes**

Reload `http://localhost:5173`. Expected:
- Colors are visibly **more saturated** than at end of Task 3 (reds redder, greens greener).
- Click **B&W**: regions become grayscale (still flat, still distinct levels). Click **Invert**: inverted colors. Click **Color**: back to saturated normal.
- Move slider through full range, each color mode still works.

No console errors.

- [ ] **Step 4: Save / commit**

```bash
git add src/renderer.js
git commit -m "feat(renderer): palette saturation boost and color-mode transforms"
```

---

## Task 5: Implement edge detection + dilation

**Files:**
- Modify: `src/renderer.js` (replace stub of `detectEdges`)
- Modify: `scratch.html` (add edge test)

- [ ] **Step 1: Add the edges test to `scratch.html`**

Append inside the `<script>` block:

```js
// ── detectEdges: 2-region indexed map, edge mask = boundary pixels ──
{
  const sw = 4, sh = 1;
  const idx = new Uint8Array([0, 0, 1, 1]);
  const mask = new Uint8Array(sw * sh);
  detectEdges(idx, sw, sh, 1, mask);
  // pixels 1 and 2 are the boundary (each has a 4-neighbor with a different index).
  console.assert(mask[0] === 0, 'edge: 0 should not be edge', mask[0]);
  console.assert(mask[1] === 1, 'edge: 1 should be edge', mask[1]);
  console.assert(mask[2] === 1, 'edge: 2 should be edge', mask[2]);
  console.assert(mask[3] === 0, 'edge: 3 should not be edge', mask[3]);

  // dilation: thickness 2 should expand the mask outward
  const mask2 = new Uint8Array(sw * sh);
  detectEdges(idx, sw, sh, 2, mask2);
  console.assert(mask2[0] === 1, 'edge dilate: 0 should be edge with thickness 2');
  console.assert(mask2[3] === 1, 'edge dilate: 3 should be edge with thickness 2');
  console.log('edges: pass');
}
```

- [ ] **Step 2: Reload `scratch.html`, verify the test FAILS**

The stub `mask.fill(0)`, so all `mask[1]/mask[2]` asserts fail. Confirmed failing.

- [ ] **Step 3: Implement `detectEdges`**

Replace the stub with:

```js
export function detectEdges(idx, sw, sh, thickness, mask) {
  mask.fill(0);
  // pass 1: 4-neighbor boundary detection
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      const v = idx[i];
      if (x > 0 && idx[i - 1] !== v) { mask[i] = 1; continue; }
      if (x < sw - 1 && idx[i + 1] !== v) { mask[i] = 1; continue; }
      if (y > 0 && idx[i - sw] !== v) { mask[i] = 1; continue; }
      if (y < sh - 1 && idx[i + sw] !== v) { mask[i] = 1; continue; }
    }
  }
  // pass 2..thickness: dilate. Use a scratch copy so we don't see-our-own-writes.
  if (thickness > 1) {
    const tmp = new Uint8Array(sw * sh);
    for (let pass = 1; pass < thickness; pass++) {
      tmp.set(mask);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const i = y * sw + x;
          if (tmp[i]) continue;
          if (x > 0 && tmp[i - 1]) { mask[i] = 1; continue; }
          if (x < sw - 1 && tmp[i + 1]) { mask[i] = 1; continue; }
          if (y > 0 && tmp[i - sw]) { mask[i] = 1; continue; }
          if (y < sh - 1 && tmp[i + sw]) { mask[i] = 1; continue; }
        }
      }
    }
  }
  return mask;
}
```

Note: the dilation `tmp` allocation is per-frame, but at thickness ≤ 3 it's at most 2 allocations of `sw*sh` bytes (~50KB each on mobile). If profiling shows this hurts, promote `tmp` to a module-scope buffer.

- [ ] **Step 4: Reload `scratch.html`, verify edges test passes**

Console expected: `edges: pass` (in addition to bilateral + quantize passes).

- [ ] **Step 5: Run the app — this is the first time the full effect is visible**

Reload `http://localhost:5173`. Expected:
- Flat color regions separated by **black contour lines**.
- Slider all the way left: ~16 colors, thin lines.
- Slider all the way right: ~5 colors, bold lines.
- Hold to freeze — the underlying image freezes but slider still changes the effect.
- All three color modes still work.

This is the v1 visual target. Take a moment to compare against `SHAPE-CAMERA-SPEC.md`'s target aesthetic section.

- [ ] **Step 6: Save / commit**

```bash
git add src/renderer.js scratch.html
git commit -m "feat(renderer): contour-line edge detection with dilation"
```

---

## Task 6: Visual checklist on the running app

**Files:** none modified. This task is verification only — DO NOT skip even if everything looked fine in Task 5. Each subitem is its own check.

- [ ] **Step 1: High-contrast scene**

Hand against a plain wall, or a dark object against a light background. Expected: clean flat regions, bold black contour follows the silhouette. No noisy speckle within regions.

- [ ] **Step 2: Noisy scene**

Foliage, patterned fabric, or a cluttered surface. Slide `simplification` end to end.
- Left: should still pick out the main forms but show finer detail.
- Right: aggressive simplification, only the dominant shapes remain.

If at the right end the image looks like noise rather than flat blocks, the bilateral filter isn't doing enough — note it as a tuning issue, not a blocker.

- [ ] **Step 3: Slider sweep**

Slowly drag the mouse left to right. Expected: smooth visual transition. Some palette flips are unavoidable (every frame is a fresh median cut), but the overall image should not strobe. If it strobes badly, document as a known issue for follow-up.

- [ ] **Step 4: Color modes**

For each mode (normal / bw / invert): regions stay flat, contour lines stay near-black. The lines do NOT invert in invert mode (they're written after the palette transform with a fixed `rgb(10,10,10)`). Confirm this matches intent — per spec, contour lines are uniform.

- [ ] **Step 5: Freeze-on-hold**

Hold a mouse-down or touch. The geometry should freeze (same underlying photo) but the slider should still change palette size and edge thickness against the frozen photo. Release: live again.

- [ ] **Step 6: Mark which checks passed**

Note in the PR/handoff which of the five checks pass cleanly and which have caveats. Visual checks failing is not necessarily blocking — the spec's "Aesthetic" success bar is qualitative. Numeric perf check (next task) is the harder gate.

---

## Task 7: Performance verification

**Files:** none modified.

- [ ] **Step 1: Desktop perf trace**

Open Chrome DevTools → Performance tab. Hit record, point camera at a moving scene (wave a hand), record ~5 seconds, stop.

In the flame chart, look at frame times in the "Frames" track. Expected: every frame ≤ 16ms. Allowed: occasional spikes when something else on the system steals CPU. Not allowed: consistent > 16ms frames or any > 30ms frame.

If consistent slow frames: open the bottom-up panel, sort by self-time. The expected hot function is `bilateralSmooth` (the cost model predicts it dominates). If it's something else, that's the bug.

- [ ] **Step 2: Mobile-throttled desktop trace**

DevTools → Performance → CPU throttling: **4x slowdown**. Record again, 5 seconds.

Expected: every frame ≤ 20ms (relaxed budget for the throttle). If frames exceed 30ms consistently, this is the trigger to drop to Option B (mode-filter fallback from the spec). See Task 8.

- [ ] **Step 3: Real device check (only if available)**

If a mid-range Android phone is available and you can get HTTPS on the LAN (self-signed cert or tunneling tool), test there. If not, document "mobile perf unverified on device" in the PR — that's per spec.

- [ ] **Step 4: Record results**

Note in the handoff: desktop perf result, throttled perf result, device perf result (or "not tested").

---

## Task 8 (CONDITIONAL): Fall back to mode-filter if mobile perf fails

**Only execute this task if Task 7 shows the mobile perf bar (≤ 20ms at 4× throttle) is not met.**

**Files:**
- Modify: `src/renderer.js`

- [ ] **Step 1: Add a mode-filter function**

Add after `bilateralSmooth`:

```js
export function modeFilter(idx, sw, sh, radius, dst) {
  const r = Math.max(1, Math.round(radius));
  const counts = new Uint16Array(256); // palette indices fit in a byte
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      counts.fill(0);
      const y0 = Math.max(0, y - r), y1 = Math.min(sh - 1, y + r);
      const x0 = Math.max(0, x - r), x1 = Math.min(sw - 1, x + r);
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          counts[idx[ny * sw + nx]]++;
        }
      }
      let bestI = 0, bestC = 0;
      for (let i = 0; i < 256; i++) if (counts[i] > bestC) { bestC = counts[i]; bestI = i; }
      dst[y * sw + x] = bestI;
    }
  }
  return dst;
}
```

- [ ] **Step 2: Update `render()` to use mode-filter instead of bilateral**

In `render()`, replace:

```js
  bilateralSmooth(sourceData.data, sw, sh, bilateralRadius, sigmaColor, smoothBuf);
  const q = medianCutQuantize(smoothBuf, sw, sh, paletteSize);
  indices.set(q.indices);
```

with:

```js
  // Option B fallback: skip bilateral, quantize directly, mode-filter the indices.
  const q = medianCutQuantize(sourceData.data, sw, sh, paletteSize);
  const tmpIdx = q.indices;
  const modeRadius = 1 + (simplification > 0.5 ? 1 : 0); // 1 or 2
  modeFilter(tmpIdx, sw, sh, modeRadius, indices);
```

- [ ] **Step 3: Re-run perf trace from Task 7**

Expected: ≤ 20ms frames at 4× throttle. If still failing, the bottleneck is no longer Step 1 — open a follow-up issue rather than continuing to chip away in this plan.

- [ ] **Step 4: Re-run visual checklist (Task 6)**

The look will be slightly different. The spec accepts this trade as a perf fallback.

- [ ] **Step 5: Commit**

```bash
git add src/renderer.js
git commit -m "perf(renderer): swap bilateral for mode-filter to meet mobile budget"
```

---

## Task 9: Clean up

**Files:**
- Delete: `scratch.html`
- (Optionally) `src/renderer.js` — remove now-unused exports

- [ ] **Step 1: Delete `scratch.html`**

```bash
rm scratch.html
```

- [ ] **Step 2: If Task 8 was NOT executed, remove the unused exports from renderer.js**

The pure functions are currently `export`ed so `scratch.html` could import them. Now they don't need to be. Change `export function bilateralSmooth` → `function bilateralSmooth`, same for `medianCutQuantize`, `transformPalette`, `detectEdges`. Leave `export function render` exported. Same for `modeFilter` if Task 8 ran — keep its export off too.

- [ ] **Step 3: Final visual check**

`npm run dev`, click through normal / bw / invert, full slider sweep, freeze. Expected: everything from Task 6 still works.

- [ ] **Step 4: Update CLAUDE.md if needed**

Open `CLAUDE.md`. It currently says:

> SHAPE-CAMERA-SPEC.md describes a different, aspirational renderer — a flat-color illustration effect ... This is not what `src/renderer.js` currently does (it does grid-based shape abstraction). Treat the spec as a design brief for a future replacement renderer, not a description of current behavior.

That paragraph is now stale — the new renderer matches the spec. Edit it to reflect the new reality: the spec describes the renderer that is now implemented; the current renderer's pipeline (bilateral → median-cut → palette transform → edges → composite) is documented in this design doc.

Also update the "Renderer contract" section: opts is now `{ simplification, colorMode }`, return is `{ levels }`, shape modes are gone. HUD shows `${levels} colors`. The "Input model (don't break)" section's first bullet should change from "X position → inputX → cellSize" to "X position → inputX → simplification."

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(renderer): remove scratch harness and update docs"
```

---

## Self-Review Notes

Spec coverage check:

| Spec section | Plan task |
|---|---|
| Better color quantization (median cut) | Task 3 |
| Edge-preserving smoothing (bilateral) | Task 2 |
| Edge rendering on quantized image, dilation | Task 5 |
| Color saturation boost | Task 4 |
| Simplification parameter mapping | Task 1 (parameter derivation) |
| Architecture (render signature, levels return, opts) | Task 1 |
| Performance constraints (60fps mobile, fallback) | Tasks 7 + 8 |
| Don't change camera/capture/interaction model | Enforced by only touching renderer.js + 2 small main.js edits + 1 HTML edit |

Type consistency check:
- `bilateralSmooth(src, sw, sh, radius, sigmaColor, dst)` — used consistently in Task 1 stub and Task 2 implementation.
- `medianCutQuantize(rgba, sw, sh, k) → { palette, indices, usedK }` — Task 1 stub returns `usedK: 1`, Task 3 implementation returns full `usedK`, render() reads `q.usedK` for the HUD. Consistent.
- `transformPalette(palette, usedK, satMul, colorMode)` — same signature in Task 1 stub and Task 4 implementation.
- `detectEdges(idx, sw, sh, thickness, mask)` — same signature in Task 1 stub, Task 5 implementation, and Task 5 dilation test.
- `render()` `opts: { simplification, colorMode }`, return `{ levels }` — used consistently in Task 1 main.js edit and renderer orchestrator.

Placeholder scan: no TBDs, no "implement later," all code steps have full code blocks, all test steps have full assertion code, all commands are exact.
