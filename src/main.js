/**
 * Shape Camera v4 — stamp instrument.
 *
 * Layout (portrait, mobile only):
 *   composition canvas (top 55%)  — persistent illustration
 *   viewfinder canvas  (mid 35%)  — live palette-mapped feed
 *   controls bar       (bot 10%)  — palette presets + undo + clear
 *
 * Tap the viewfinder to stamp a circular fragment of the current palette-mapped
 * frame onto the composition.
 */

import * as camera from './camera.js';
import { renderViewfinder, PALETTES } from './renderer.js';
import { save } from './capture.js';

// ── DOM ──
const composition = document.getElementById('composition');
const cctx = composition.getContext('2d');
const viewfinder = document.getElementById('viewfinder');
const vctx = viewfinder.getContext('2d');
const sourceCanvas = document.getElementById('source');
const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true });

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('btn-start');
const ui = document.getElementById('ui');
const btnSave = document.getElementById('btn-save');
const btnUndo = document.getElementById('btn-undo');
const btnClear = document.getElementById('btn-clear');

// ── STATE ──
let running = false;
let currentPalette = 'bold';
const undoStack = [];
const UNDO_LIMIT = 20;
let clearPrimed = false;        // first tap arms; second tap within window clears
let clearArmTimer = null;

// per-frame source-canvas resolution
let SW, SH;

// per-frame viewfinder rect (in CSS pixels / canvas pixels — they match because
// each canvas's width/height = its rendered size in our layout)
let vfX, vfY, vfW, vfH;
let compW, compH;

const CREAM = 'rgb(245, 240, 230)';

// ── LAYOUT ──
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Composition: top 55%
  compW = w;
  compH = Math.floor(h * 0.55);
  composition.width = compW;
  composition.height = compH;
  composition.style.width = compW + 'px';
  composition.style.height = compH + 'px';

  // Viewfinder: 35% below composition
  vfX = 0;
  vfY = compH;
  vfW = w;
  vfH = Math.floor(h * 0.35);
  viewfinder.width = vfW;
  viewfinder.height = vfH;
  viewfinder.style.width = vfW + 'px';
  viewfinder.style.height = vfH + 'px';

  // Source canvas (hidden) — matches viewfinder aspect, ~55% scale per the camera frame
  SW = Math.floor(vfW * 0.55);
  SH = Math.floor(vfH * 0.55);
  sourceCanvas.width = SW;
  sourceCanvas.height = SH;

  // Re-fill composition cream (clears it on resize — accept; rotating during use is rare)
  fillCream();
}

function fillCream() {
  cctx.fillStyle = CREAM;
  cctx.fillRect(0, 0, compW, compH);
}

window.addEventListener('resize', layout);
layout();

// ── PALETTE SWITCHING ──
function setPalette(name) {
  if (!(name in PALETTES)) return;
  currentPalette = name;
  document.querySelectorAll('.palette-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.palette === name);
  });
}

document.querySelectorAll('.palette-btn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.stopPropagation();
    e.preventDefault();
    setPalette(btn.dataset.palette);
  }, { passive: false });
});

// ── UNDO ──
function pushUndo() {
  // snapshot composition before mutation
  const snap = cctx.getImageData(0, 0, compW, compH);
  undoStack.push(snap);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  cctx.putImageData(snap, 0, 0);
}

btnUndo.addEventListener('touchstart', e => {
  e.stopPropagation();
  e.preventDefault();
  undo();
}, { passive: false });

// ── CLEAR (double-tap to confirm) ──
function clearComposition() {
  fillCream();
  undoStack.length = 0;
}

function disarmClear() {
  clearPrimed = false;
  btnClear.classList.remove('armed');
  if (clearArmTimer) {
    clearTimeout(clearArmTimer);
    clearArmTimer = null;
  }
}

btnClear.addEventListener('touchstart', e => {
  e.stopPropagation();
  e.preventDefault();
  if (clearPrimed) {
    clearComposition();
    disarmClear();
  } else {
    clearPrimed = true;
    btnClear.classList.add('armed');
    clearArmTimer = setTimeout(disarmClear, 2000);  // 2s window to confirm
  }
}, { passive: false });

// ── SAVE ──
function saveScreenshot() {
  save(composition);
  btnSave.classList.add('flash');
  setTimeout(() => btnSave.classList.remove('flash'), 300);
}

btnSave.addEventListener('touchstart', e => {
  e.stopPropagation();
  e.preventDefault();
  saveScreenshot();
}, { passive: false });

// ── TAP TO STAMP ──
// Listen only on the viewfinder element so taps on controls don't trigger stamps.
viewfinder.addEventListener('touchstart', e => {
  if (!running) return;
  e.preventDefault();
  const t = e.touches[0];
  const rect = viewfinder.getBoundingClientRect();
  const vx = t.clientX - rect.left;
  const vy = t.clientY - rect.top;
  stampAt(vx, vy);
}, { passive: false });

function stampAt(vx, vy) {
  // viewfinder is the most recent palette-mapped tinyCanvas, upscaled. We re-draw a
  // circular slice from the viewfinder canvas onto the composition. The composition
  // and viewfinder share the camera frame's content (same scene), so we map the
  // tap position from viewfinder-space to composition-space.
  const cx = (vx / vfW) * compW;
  const cy = (vy / vfH) * compH;
  const radius = Math.round(Math.min(vfW, vfH) * 0.17);  // ~17% of viewfinder min dim

  // Map radius to composition-space: same ratio as the canvas size.
  const compRadius = radius * (compW / vfW);

  // Snapshot before mutation so undo restores cleanly.
  pushUndo();

  cctx.save();
  cctx.beginPath();
  cctx.arc(cx, cy, compRadius, 0, Math.PI * 2);
  cctx.clip();

  // The viewfinder canvas already holds the palette-mapped image. Draw a region of it
  // centered on the tap, scaled into the composition's circle.
  // srcRect on viewfinder: (vx - radius, vy - radius, 2*radius, 2*radius)
  // dstRect on composition: same circle, but scaled by compW/vfW.
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(
    viewfinder,
    vx - radius, vy - radius, 2 * radius, 2 * radius,
    cx - compRadius, cy - compRadius, 2 * compRadius, 2 * compRadius,
  );

  // Subtle border to show stamp boundaries.
  cctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  cctx.lineWidth = 1;
  cctx.beginPath();
  cctx.arc(cx, cy, compRadius, 0, Math.PI * 2);
  cctx.stroke();

  cctx.restore();
}

// ── START ──
startBtn.addEventListener('click', async () => {
  startBtn.textContent = 'Requesting...';
  try {
    await camera.init();
    startScreen.classList.add('hidden');
    ui.classList.remove('hidden');
    fillCream();   // ensure composition starts cream after layout settles
    running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error('Camera init failed:', err);
    startBtn.textContent = 'Camera Denied';
    startBtn.classList.add('error');
    setTimeout(() => {
      startBtn.textContent = 'Enable Camera';
      startBtn.classList.remove('error');
    }, 2500);
  }
});

// ── VIEWFINDER LOOP ──
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  camera.drawFrame(sctx, SW, SH);
  const sourceData = sctx.getImageData(0, 0, SW, SH);

  renderViewfinder(vctx, sourceData, SW, SH, 0, 0, vfW, vfH, PALETTES[currentPalette]);
}
