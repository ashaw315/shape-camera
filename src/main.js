/**
 * Shape Camera — main entry point.
 *
 * Orchestrates camera, renderer, input, and UI.
 */

import * as camera from './camera.js';
import { render } from './renderer.js';
import { save } from './capture.js';

// ── DOM ──
const output = document.getElementById('output');
const ctx = output.getContext('2d');
const sourceCanvas = document.getElementById('source');
const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true });

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('btn-start');
const ui = document.getElementById('ui');
const gridLabel = document.getElementById('grid-label');
const freezeBadge = document.getElementById('freeze-badge');
const btnFlip = document.getElementById('btn-flip');
const btnSave = document.getElementById('btn-save');

// ── STATE ──
let running = false;
let inputX = 0.5;
let isTouching = false;
let frozenData = null;
let colorMode = 'normal';

const isMobile = 'ontouchstart' in window;

// source canvas resolution
let SW, SH;

// ── SIZING ──
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  output.width = w;
  output.height = h;

  const scale = isMobile ? 0.5 : 0.65;
  SW = Math.floor(w * scale);
  SH = Math.floor(h * scale);
  sourceCanvas.width = SW;
  sourceCanvas.height = SH;
}

window.addEventListener('resize', resize);
resize();

// ── INPUT ──

// Touch
document.addEventListener('touchstart', e => {
  if (!running) return;
  // ignore touches on UI buttons (they have stopPropagation)
  e.preventDefault();
  isTouching = true;
  freezeBadge.classList.remove('hidden');
  inputX = e.touches[0].clientX / window.innerWidth;
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!running) return;
  e.preventDefault();
  inputX = e.touches[0].clientX / window.innerWidth;
}, { passive: false });

document.addEventListener('touchend', () => {
  isTouching = false;
  frozenData = null;
  freezeBadge.classList.add('hidden');
});

// Mouse
document.addEventListener('mousemove', e => {
  inputX = e.clientX / window.innerWidth;
});

document.addEventListener('mousedown', () => {
  if (!running) return;
  isTouching = true;
  freezeBadge.classList.remove('hidden');
});

document.addEventListener('mouseup', () => {
  isTouching = false;
  frozenData = null;
  freezeBadge.classList.add('hidden');
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'c') cycleColor();
  if (e.key === 'f') flipCamera();
  if (e.key === 's' && !e.metaKey && !e.ctrlKey) saveScreenshot();
});

// ── COLOR MODE ──
const colorModes = ['normal', 'bw', 'invert'];

function setColor(mode) {
  colorMode = mode;
  document.querySelectorAll('.color-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.color === mode);
  });
}

function cycleColor() {
  const idx = colorModes.indexOf(colorMode);
  setColor(colorModes[(idx + 1) % colorModes.length]);
}

document.querySelectorAll('.color-btn').forEach(btn => {
  const stop = e => e.stopPropagation();
  btn.addEventListener('touchstart', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setColor(btn.dataset.color);
  });
});

// ── CAMERA FLIP ──
async function flipCamera() {
  try {
    await camera.flip();
  } catch (err) {
    console.error('Flip failed:', err);
  }
}

btnFlip.addEventListener('touchstart', e => e.stopPropagation());
btnFlip.addEventListener('touchend', e => e.stopPropagation());
btnFlip.addEventListener('click', e => {
  e.stopPropagation();
  flipCamera();
});

// ── SAVE ──
function saveScreenshot() {
  save(output);
  btnSave.classList.add('flash');
  setTimeout(() => btnSave.classList.remove('flash'), 300);
}

btnSave.addEventListener('touchstart', e => e.stopPropagation());
btnSave.addEventListener('touchend', e => e.stopPropagation());
btnSave.addEventListener('click', e => {
  e.stopPropagation();
  saveScreenshot();
});

// ── START ──
startBtn.addEventListener('click', async () => {
  startBtn.textContent = 'Requesting...';

  try {
    await camera.init();
    startScreen.classList.add('hidden');
    ui.classList.remove('hidden');
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

// ── RENDER LOOP ──
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  // draw camera to source canvas
  camera.drawFrame(sctx, SW, SH);

  // get or reuse frozen pixel data
  let sourceData;
  if (isTouching) {
    if (!frozenData) {
      frozenData = sctx.getImageData(0, 0, SW, SH);
    }
    sourceData = frozenData;
  } else {
    sourceData = sctx.getImageData(0, 0, SW, SH);
  }

  // render
  const { levels } = render(
    ctx, sourceData, SW, SH,
    output.width, output.height,
    { simplification: inputX, colorMode },
  );

  gridLabel.textContent = `${levels} colors`;
}
