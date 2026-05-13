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
let indicesScratch = null;     // Uint8Array, sw*sh — used by modeFilter for read-from copy
let edgeMask = null;           // Uint8Array, sw*sh
let edgeScratch = null;        // Uint8Array, sw*sh — used by morphClose for the dilated state
let outBuf = null;             // Uint8ClampedArray, sw*sh*4
let workCanvas = null;         // OffscreenCanvas | HTMLCanvasElement
let workCtx = null;

function ensureBuffers(sw, sh) {
  if (sw === bufSW && sh === bufSH) return;
  bufSW = sw; bufSH = sh;
  const n = sw * sh;
  smoothBuf = new Uint8ClampedArray(n * 4);
  indices = new Uint8Array(n);
  indicesScratch = new Uint8Array(n);
  edgeMask = new Uint8Array(n);
  edgeScratch = new Uint8Array(n);
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

function modeFilter(indices, sw, sh, scratch) {
  scratch.set(indices);
  const counts = new Uint8Array(16);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      counts.fill(0);
      let bestI = scratch[y * sw + x];
      let bestC = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy < 0 ? 0 : (y + dy >= sh ? sh - 1 : y + dy);
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx < 0 ? 0 : (x + dx >= sw ? sw - 1 : x + dx);
          const v = scratch[ny * sw + nx];
          const c = ++counts[v];
          if (c > bestC) { bestC = c; bestI = v; }
        }
      }
      indices[y * sw + x] = bestI;
    }
  }
}

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

export function transformPalette(palette, usedK, satMul, colorMode) {
  for (let i = 0; i < usedK; i++) {
    const p = i * 3;
    let r = palette[p], g = palette[p+1], b = palette[p+2];

    // saturation boost in HSL
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l >= 0.08 && l <= 0.92) {
      // boost saturation, enforce minimum floor
      let s2 = Math.min(1, s * satMul);
      if (s2 < 0.2) s2 = 0.2;
      [r, g, b] = hslToRgb(h, s2, l);
    }
    // else: leave r/g/b unchanged (near-black or near-white)

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

export function detectEdges(idx, sw, sh, mask) {
  mask.fill(0);
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
  return mask;
}

function suppressLowContrastEdges(mask, idx, palette, sw, sh, minDist) {
  const minDistSq = minDist * minDist;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!mask[i]) continue;
      const v = idx[i];
      const cp = v * 3;
      const cr = palette[cp], cg = palette[cp + 1], cb = palette[cp + 2];

      // Find the smallest palette-distance among differing 4-neighbors.
      let minSq = Infinity;
      if (x > 0)         { const nv = idx[i - 1];  if (nv !== v) { const np = nv*3; const dr = palette[np]-cr, dg = palette[np+1]-cg, db = palette[np+2]-cb; const d = dr*dr+dg*dg+db*db; if (d < minSq) minSq = d; } }
      if (x < sw - 1)    { const nv = idx[i + 1];  if (nv !== v) { const np = nv*3; const dr = palette[np]-cr, dg = palette[np+1]-cg, db = palette[np+2]-cb; const d = dr*dr+dg*dg+db*db; if (d < minSq) minSq = d; } }
      if (y > 0)         { const nv = idx[i - sw]; if (nv !== v) { const np = nv*3; const dr = palette[np]-cr, dg = palette[np+1]-cg, db = palette[np+2]-cb; const d = dr*dr+dg*dg+db*db; if (d < minSq) minSq = d; } }
      if (y < sh - 1)    { const nv = idx[i + sw]; if (nv !== v) { const np = nv*3; const dr = palette[np]-cr, dg = palette[np+1]-cg, db = palette[np+2]-cb; const d = dr*dr+dg*dg+db*db; if (d < minSq) minSq = d; } }

      if (minSq < minDistSq) mask[i] = 0;
    }
  }
}

function morphClose(mask, sw, sh, dilated) {
  // Dilate: any 4-neighbor is edge → I am edge.
  // Write into dilated; read from mask.
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (mask[i]) { dilated[i] = 1; continue; }
      if ((x > 0 && mask[i - 1]) || (x < sw - 1 && mask[i + 1]) ||
          (y > 0 && mask[i - sw]) || (y < sh - 1 && mask[i + sw])) {
        dilated[i] = 1;
      } else {
        dilated[i] = 0;
      }
    }
  }
  // Erode: a pixel stays edge only if ALL its 4-neighbors are also edges in `dilated`.
  // Edge of the image: a missing neighbor is treated as non-edge (conservative — erodes the rim).
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!dilated[i]) { mask[i] = 0; continue; }
      if ((x > 0 && !dilated[i - 1]) || (x < sw - 1 && !dilated[i + 1]) ||
          (y > 0 && !dilated[i - sw]) || (y < sh - 1 && !dilated[i + sw]) ||
          x === 0 || x === sw - 1 || y === 0 || y === sh - 1) {
        mask[i] = 0;
      } else {
        mask[i] = 1;
      }
    }
  }
}

function dilateEdges(mask, sw, sh, thickness, scratch) {
  if (thickness <= 1) return mask;
  for (let pass = 1; pass < thickness; pass++) {
    scratch.set(mask);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        if (scratch[i]) continue;
        if (x > 0 && scratch[i - 1]) { mask[i] = 1; continue; }
        if (x < sw - 1 && scratch[i + 1]) { mask[i] = 1; continue; }
        if (y > 0 && scratch[i - sw]) { mask[i] = 1; continue; }
        if (y < sh - 1 && scratch[i + sw]) { mask[i] = 1; continue; }
      }
    }
  }
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
  const minEdgeContrast = 30 + simplification * 20;                  // 30..50

  // 1. bilateral smooth
  bilateralSmooth(sourceData.data, sw, sh, bilateralRadius, sigmaColor, smoothBuf);

  // 2. median-cut quantize
  const q = medianCutQuantize(smoothBuf, sw, sh, paletteSize, indices);

  // 3. mode-filter cleanup on indices
  modeFilter(indices, sw, sh, indicesScratch);

  // 4. palette transform (saturation boost + color mode)
  const palette = transformPalette(q.palette, q.usedK, 1.9, colorMode);

  // 5. edge detection (boundary only)
  detectEdges(indices, sw, sh, edgeMask);

  // 6. palette-distance edge suppression
  suppressLowContrastEdges(edgeMask, indices, palette, sw, sh, minEdgeContrast);

  // 7. morphological close
  morphClose(edgeMask, sw, sh, edgeScratch);

  // 8. edge dilation for thickness
  dilateEdges(edgeMask, sw, sh, edgeThickness, edgeScratch);

  // 9. composite
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
