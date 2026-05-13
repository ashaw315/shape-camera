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
