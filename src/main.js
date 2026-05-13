/**
 * Shape Camera — main entry point.
 *
 * Orchestrates camera, renderer, input, and UI.
 */

import * as camera from './camera.js';
import { render, PALETTES } from './renderer.js';
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
let currentPalette = 'bold';
let bwOn = false;
let invertOn = false;
let edgesOn = false;

const isMobile = 'ontouchstart' in window;

// source canvas resolution
let SW, SH;

// ── SIZING ──
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  output.width = w;
  output.height = h;

  const scale = isMobile ? 0.55 : 0.7;
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

// ── PALETTE + MODIFIER WIRING ──

function setPalette(name) {
  if (!(name in PALETTES)) return;
  currentPalette = name;
  document.querySelectorAll('.palette-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.palette === name);
  });
}

function setToggle(name, on) {
  if (name === 'bw') {
    bwOn = on;
    if (on) invertOn = false; // bw and invert are mutually exclusive
  } else if (name === 'invert') {
    invertOn = on;
    if (on) bwOn = false;
  } else if (name === 'edges') {
    edgesOn = on;
  }
  document.querySelectorAll('.modifier-btn').forEach(b => {
    const mod = b.dataset.modifier;
    const active = (mod === 'bw' && bwOn) || (mod === 'invert' && invertOn) || (mod === 'edges' && edgesOn);
    b.classList.toggle('active', active);
  });
}

function cycleColor() {
  // keyboard shortcut: cycle normal -> bw -> invert -> normal
  if (!bwOn && !invertOn) setToggle('bw', true);
  else if (bwOn) { setToggle('bw', false); setToggle('invert', true); }
  else { setToggle('invert', false); }
}

document.querySelectorAll('.palette-btn').forEach(btn => {
  const stop = e => e.stopPropagation();
  btn.addEventListener('touchstart', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setPalette(btn.dataset.palette);
  });
});

document.querySelectorAll('.modifier-btn').forEach(btn => {
  const stop = e => e.stopPropagation();
  btn.addEventListener('touchstart', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const mod = btn.dataset.modifier;
    if (mod === 'bw') setToggle('bw', !bwOn);
    else if (mod === 'invert') setToggle('invert', !invertOn);
    else if (mod === 'edges') setToggle('edges', !edgesOn);
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

  // derive colorMode from toggles (invert beats bw beats normal)
  const colorMode = invertOn ? 'invert' : (bwOn ? 'bw' : 'normal');

  // render
  const { colors } = render(
    ctx, sourceData, SW, SH,
    output.width, output.height,
    {
      simplification: inputX,
      palette: PALETTES[currentPalette],
      colorMode,
      showEdges: edgesOn,
    },
  );

  gridLabel.textContent = `${colors} colors`;
}
