/**
 * Shape Camera renderer — v3 curated-palette mapping.
 *
 * Pipeline per frame:
 *   1. paint source ImageData onto a source-sized work canvas
 *   2. drawImage that canvas onto a TINY canvas (with smoothing on — this IS the flatten)
 *   3. read tiny ImageData, map every pixel to nearest palette color (RGB euclidean)
 *   4. apply colorMode transform (normal / bw / invert) per tiny pixel
 *   5. (optional) detect edges on the tiny mapped image into edgeCanvas
 *   6. drawImage tinyCanvas onto output (smoothing on, 'medium' quality)
 *   7. if edges enabled: drawImage edgeCanvas onto output (smoothing off, crisp)
 *
 * Exported: render(ctx, sourceData, sw, sh, outW, outH, opts) -> { colors }
 * Exported: PALETTES (the curated preset palettes, keyed by name)
 */

// ── curated palettes ──
export const PALETTES = {
  bold: [
    [220, 50, 80],
    [240, 140, 50],
    [250, 210, 70],
    [50, 180, 100],
    [40, 190, 190],
    [60, 100, 200],
    [140, 80, 180],
    [230, 160, 180],
    [245, 240, 230],
    [25, 25, 35],
  ],
  warm: [
    [200, 80, 60],
    [230, 150, 70],
    [240, 210, 160],
    [140, 90, 60],
    [80, 120, 80],
    [180, 160, 130],
    [60, 50, 45],
    [245, 235, 220],
    [200, 130, 130],
    [100, 80, 100],
  ],
  cool: [
    [40, 70, 140],
    [70, 140, 200],
    [150, 200, 220],
    [50, 160, 160],
    [200, 80, 100],
    [240, 200, 100],
    [80, 80, 90],
    [200, 200, 210],
    [245, 245, 240],
    [30, 30, 40],
  ],
  pop: [
    [255, 50, 80],
    [255, 200, 0],
    [0, 180, 255],
    [255, 100, 200],
    [0, 200, 100],
    [255, 140, 0],
    [180, 0, 255],
    [255, 255, 255],
    [0, 0, 0],
    [255, 180, 180],
  ],
};

// ── module-scope reusable canvases ──
let srcCanvas = null, srcCtx = null;     // sw × sh — receives putImageData(sourceData)
let tinyCanvas = null, tinyCtx = null;   // tinyW × tinyH — downscaled + palette-mapped
let edgeCanvas = null, edgeCtx = null;   // tinyW × tinyH — edges with transparent bg
let srcW = 0, srcH = 0;
let tinyW = 0, tinyH = 0;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function ensureSrcCanvas(sw, sh) {
  if (srcCanvas && srcW === sw && srcH === sh) return;
  srcW = sw; srcH = sh;
  srcCanvas = makeCanvas(sw, sh);
  srcCtx = srcCanvas.getContext('2d');
}

function ensureTinyCanvases(tw, th) {
  if (tinyCanvas && tinyW === tw && tinyH === th) return;
  tinyW = tw; tinyH = th;
  tinyCanvas = makeCanvas(tw, th);
  tinyCtx = tinyCanvas.getContext('2d', { willReadFrequently: true });
  edgeCanvas = makeCanvas(tw, th);
  edgeCtx = edgeCanvas.getContext('2d');
}

export function render(ctx, sourceData, sw, sh, outW, outH, opts) {
  const { simplification, palette, colorMode, showEdges } = opts;

  // Step 1 — paint source onto a sw×sh canvas so we can drawImage-scale it.
  ensureSrcCanvas(sw, sh);
  srcCtx.putImageData(sourceData, 0, 0);

  // Step 1b — derive tiny dimensions from simplification.
  const tinyScale = 0.5 + (0.15 - 0.5) * simplification;  // 0.5..0.15
  const tw = Math.max(2, Math.round(sw * tinyScale));
  const th = Math.max(2, Math.round(sh * tinyScale));
  ensureTinyCanvases(tw, th);

  // Step 2 — downscale to tiny with smoothing on. This IS the flatten step.
  tinyCtx.imageSmoothingEnabled = true;
  tinyCtx.clearRect(0, 0, tw, th);
  tinyCtx.drawImage(srcCanvas, 0, 0, tw, th);

  // Step 3 — read tiny pixels, map each to nearest palette color, apply colorMode in place.
  const img = tinyCtx.getImageData(0, 0, tw, th);
  const px = img.data;
  const n = tw * th;
  const pal = palette;          // [[r,g,b], ...]
  const palN = pal.length;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];

    // Nearest palette entry.
    let bestI = 0, bestD = Infinity;
    for (let p = 0; p < palN; p++) {
      const c = pal[p];
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestI = p; }
    }
    let pr = pal[bestI][0], pg = pal[bestI][1], pb = pal[bestI][2];

    // Color mode.
    if (colorMode === 'bw') {
      const y = (pr * 0.299 + pg * 0.587 + pb * 0.114) | 0;
      pr = pg = pb = y;
    } else if (colorMode === 'invert') {
      pr = 255 - pr; pg = 255 - pg; pb = 255 - pb;
    }
    px[o] = pr; px[o + 1] = pg; px[o + 2] = pb; px[o + 3] = 255;
  }
  tinyCtx.putImageData(img, 0, 0);

  // Step 5 — optional: build the edge overlay on the tiny mapped image.
  // 4-neighbor inequality on mapped RGB triples.
  if (showEdges) {
    const edgeImg = edgeCtx.createImageData(tw, th);
    const ep = edgeImg.data;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = y * tw + x;
        const o = i * 4;
        const r = px[o], g = px[o + 1], b = px[o + 2];
        let isEdge = false;
        if (x > 0)        { const no = (i - 1) * 4;  if (px[no] !== r || px[no+1] !== g || px[no+2] !== b) isEdge = true; }
        if (!isEdge && x < tw - 1) { const no = (i + 1) * 4;  if (px[no] !== r || px[no+1] !== g || px[no+2] !== b) isEdge = true; }
        if (!isEdge && y > 0)      { const no = (i - tw) * 4; if (px[no] !== r || px[no+1] !== g || px[no+2] !== b) isEdge = true; }
        if (!isEdge && y < th - 1) { const no = (i + tw) * 4; if (px[no] !== r || px[no+1] !== g || px[no+2] !== b) isEdge = true; }
        if (isEdge) {
          ep[o] = 15; ep[o + 1] = 15; ep[o + 2] = 15; ep[o + 3] = 255;
        } else {
          ep[o + 3] = 0;  // transparent (R/G/B already 0)
        }
      }
    }
    edgeCtx.putImageData(edgeImg, 0, 0);
  }

  // Step 6 — upscale color regions onto output with smoothing.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(tinyCanvas, 0, 0, outW, outH);

  // Step 7 — overlay edges crisp (only if enabled).
  if (showEdges) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(edgeCanvas, 0, 0, outW, outH);
  }

  return { colors: palN };
}
