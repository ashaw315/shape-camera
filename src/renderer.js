/**
 * Shape renderer — samples source pixels, renders geometric abstraction.
 *
 * Modes: 'squares', 'lines'
 * Color modes: 'normal', 'bw', 'invert'
 */

const COLOR_TRANSFORMS = {
  normal: (r, g, b) => [r, g, b],
  bw: (r, g, b) => {
    const l = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    return [l, l, l];
  },
  invert: (r, g, b) => [255 - r, 255 - g, 255 - b],
};

/**
 * Average color of a rectangular block in pixel data.
 * Returns [r, g, b, brightness] where brightness is 0–1.
 */
function sampleBlock(pixels, sx, sy, bw, bh, stride) {
  let r = 0, g = 0, b = 0, count = 0;

  // sample every other pixel for speed on large blocks
  const step = bw * bh > 200 ? 2 : 1;

  for (let dy = 0; dy < bh; dy += step) {
    for (let dx = 0; dx < bw; dx += step) {
      const i = ((sy + dy) * stride + (sx + dx)) * 4;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      count++;
    }
  }

  if (count === 0) return [0, 0, 0, 0];

  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);
  const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

  return [r, g, b, brightness];
}

/**
 * Render the abstracted frame.
 *
 * @param {CanvasRenderingContext2D} ctx    — output canvas context
 * @param {ImageData} sourceData           — pixel data from source canvas
 * @param {number} sw                      — source width
 * @param {number} sh                      — source height
 * @param {number} outW                    — output canvas width
 * @param {number} outH                    — output canvas height
 * @param {object} opts
 * @param {number} opts.cellSize           — grid cell size in source pixels
 * @param {string} opts.shapeMode          — 'squares' | 'lines'
 * @param {string} opts.colorMode          — 'normal' | 'bw' | 'invert'
 */
export function render(ctx, sourceData, sw, sh, outW, outH, opts) {
  const { cellSize, shapeMode, colorMode } = opts;
  const pixels = sourceData.data;
  const transform = COLOR_TRANSFORMS[colorMode] || COLOR_TRANSFORMS.normal;

  const cols = Math.ceil(sw / cellSize);
  const rows = Math.ceil(sh / cellSize);

  const scaleX = outW / sw;
  const scaleY = outH / sh;

  // background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, outW, outH);

  // gap proportional to cell size — tighter at small sizes, more visible at large
  const cellW = cellSize * scaleX;
  const cellH = cellSize * scaleY;
  const gap = Math.max(0.5, Math.min(cellW, cellH) * 0.1);

  if (shapeMode === 'squares') {
    renderSquares(ctx, pixels, sw, sh, cols, rows, cellSize, scaleX, scaleY, cellW, cellH, gap, transform);
  } else if (shapeMode === 'lines') {
    renderLines(ctx, pixels, sw, sh, cols, rows, cellSize, scaleX, scaleY, cellW, cellH, gap, transform);
  }

  return { cols, rows };
}

/**
 * Squares — size proportional to brightness.
 * Bright areas → larger squares. Dark → smaller (more background showing).
 */
function renderSquares(ctx, pixels, sw, sh, cols, rows, cellSize, scaleX, scaleY, cellW, cellH, gap, transform) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * cellSize;
      const sy = row * cellSize;
      const bw = Math.min(cellSize, sw - sx);
      const bh = Math.min(cellSize, sh - sy);

      const [r, g, b, brightness] = sampleBlock(pixels, sx, sy, bw, bh, sw);
      const [tr, tg, tb] = transform(r, g, b);

      const cx = sx * scaleX + cellW / 2;
      const cy = sy * scaleY + cellH / 2;

      // scale: dark cells are small, bright cells fill the cell
      const sizeFactor = 0.15 + brightness * 0.85;
      const drawW = (cellW - gap) * sizeFactor;
      const drawH = (cellH - gap) * sizeFactor;

      ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
      ctx.fillRect(cx - drawW / 2, cy - drawH / 2, drawW, drawH);
    }
  }
}

/**
 * Lines — angle derived from local brightness gradient.
 * Length proportional to brightness. Stroke width proportional to cell size.
 */
function renderLines(ctx, pixels, sw, sh, cols, rows, cellSize, scaleX, scaleY, cellW, cellH, gap, transform) {
  const lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.14);
  ctx.lineCap = 'round';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * cellSize;
      const sy = row * cellSize;
      const bw = Math.min(cellSize, sw - sx);
      const bh = Math.min(cellSize, sh - sy);

      const [r, g, b, brightness] = sampleBlock(pixels, sx, sy, bw, bh, sw);

      if (brightness < 0.04) continue; // skip near-black cells

      const [tr, tg, tb] = transform(r, g, b);

      const cx = sx * scaleX + cellW / 2;
      const cy = sy * scaleY + cellH / 2;

      // angle: sample neighbors to get gradient direction
      const angle = getGradientAngle(pixels, sx, sy, cellSize, sw, sh, brightness);

      const len = (Math.min(cellW, cellH) - gap) * (0.15 + brightness * 0.85);

      ctx.strokeStyle = `rgb(${tr},${tg},${tb})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(
        cx - Math.cos(angle) * len / 2,
        cy - Math.sin(angle) * len / 2,
      );
      ctx.lineTo(
        cx + Math.cos(angle) * len / 2,
        cy + Math.sin(angle) * len / 2,
      );
      ctx.stroke();
    }
  }
}

/**
 * Compute a gradient-based angle for a cell by comparing brightness
 * of neighboring cells. Falls back to brightness-mapped angle.
 */
function getGradientAngle(pixels, sx, sy, cellSize, sw, sh, brightness) {
  // sample brightness of neighbors
  const sample = (ox, oy) => {
    const nx = sx + ox * cellSize;
    const ny = sy + oy * cellSize;
    if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) return brightness;
    const i = (ny * sw + nx) * 4;
    return (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
  };

  const gx = sample(1, 0) - sample(-1, 0);
  const gy = sample(0, 1) - sample(0, -1);

  // if gradient is negligible, use brightness as angle
  if (Math.abs(gx) + Math.abs(gy) < 0.02) {
    return brightness * Math.PI;
  }

  // perpendicular to gradient = along the edge
  return Math.atan2(gy, gx) + Math.PI / 2;
}
