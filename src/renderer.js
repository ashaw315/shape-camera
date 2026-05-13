/**
 * Shape Camera v4 — viewfinder renderer.
 *
 * Per frame:
 *   1. paint source ImageData onto a sw×sh canvas (so we can drawImage-scale it)
 *   2. downscale to a small working canvas with smoothing on
 *   3. 2-pass 5×5 box blur on the tiny ImageData to merge noise
 *   4. nearest-palette mapping per pixel
 *   5. drawImage tiny canvas onto the target rect with imageSmoothingQuality='high'
 *
 * Exports:
 *   - PALETTES — the four curated palettes (bold/warm/cool/pop)
 *   - renderViewfinder(ctx, sourceData, sw, sh, outX, outY, outW, outH, palette)
 */

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

// ── module-scope reusable resources ──
let srcCanvas = null, srcCtx = null;     // sw × sh — receives putImageData(sourceData)
let tinyCanvas = null, tinyCtx = null;   // ~120 × ~160 — working canvas for blur + map
let blurBuf = null;                      // Uint8ClampedArray scratch for 2-pass blur
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

function ensureTinyCanvas(tw, th) {
  if (tinyCanvas && tinyW === tw && tinyH === th) return;
  tinyW = tw; tinyH = th;
  tinyCanvas = makeCanvas(tw, th);
  tinyCtx = tinyCanvas.getContext('2d', { willReadFrequently: true });
  blurBuf = new Uint8ClampedArray(tw * th * 4);
}

function boxBlur5x5(pixels, scratch, tw, th, passes) {
  // 5x5 average, edge-clamped, ping-pongs between pixels and scratch.
  let src = pixels, dst = scratch;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < th; y++) {
      const y0 = y > 1 ? y - 2 : 0;
      const y1 = y < th - 2 ? y + 2 : th - 1;
      for (let x = 0; x < tw; x++) {
        const x0 = x > 1 ? x - 2 : 0;
        const x1 = x < tw - 2 ? x + 2 : tw - 1;
        let sr = 0, sg = 0, sb = 0;
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const i = (ny * tw + nx) * 4;
            sr += src[i]; sg += src[i+1]; sb += src[i+2];
          }
        }
        const count = (y1 - y0 + 1) * (x1 - x0 + 1);
        const o = (y * tw + x) * 4;
        dst[o]     = (sr / count) | 0;
        dst[o + 1] = (sg / count) | 0;
        dst[o + 2] = (sb / count) | 0;
        dst[o + 3] = 255;
      }
    }
    const tmp = src; src = dst; dst = tmp;
  }
  // For even pass counts, result already in `pixels` (the caller's buffer); for odd,
  // copy back.
  if (src !== pixels) pixels.set(src);
}

export function renderViewfinder(ctx, sourceData, sw, sh, outX, outY, outW, outH, palette) {
  ensureSrcCanvas(sw, sh);
  srcCtx.putImageData(sourceData, 0, 0);

  // ~40% of viewfinder width per spec, clamped to a minimum so the buffer is sane.
  const tw = Math.max(32, Math.round(outW * 0.4));
  const th = Math.max(32, Math.round(outH * 0.4));
  ensureTinyCanvas(tw, th);

  tinyCtx.imageSmoothingEnabled = true;
  tinyCtx.drawImage(srcCanvas, 0, 0, tw, th);

  const img = tinyCtx.getImageData(0, 0, tw, th);
  const px = img.data;
  const n = tw * th;

  boxBlur5x5(px, blurBuf, tw, th, 2);

  // Nearest-palette mapping (RGB euclidean).
  const palN = palette.length;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    let bestI = 0, bestD = Infinity;
    for (let p = 0; p < palN; p++) {
      const c = palette[p];
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestI = p; }
    }
    const c = palette[bestI];
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }

  tinyCtx.putImageData(img, 0, 0);

  // Upscale onto the target rect with high-quality smoothing.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tinyCanvas, outX, outY, outW, outH);

  return tinyCanvas;
}
