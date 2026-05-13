/**
 * Camera management — init, toggle front/back, draw to source canvas.
 */

const video = document.getElementById('video');
const isMobile = 'ontouchstart' in window;

let currentStream = null;
let facingMode = isMobile ? 'environment' : 'user';
let ready = false;

/**
 * Start or restart the camera with the current facingMode.
 */
export async function init() {
  // stop existing stream
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
  }

  const constraints = {
    video: {
      width: { ideal: isMobile ? 480 : 640 },
      height: { ideal: isMobile ? 640 : 480 },
      facingMode: { ideal: facingMode },
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  currentStream = stream;

  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      video.play()
        .then(() => { ready = true; resolve(); })
        .catch(reject);
    };
  });
}

/**
 * Toggle between front and back camera. Returns the new facing mode.
 */
export async function flip() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  await init();
  return facingMode;
}

/**
 * Draw the current video frame onto a canvas context, cropped to fill.
 * Mirrors the image when using the front camera.
 */
export function drawFrame(ctx, w, h) {
  if (!ready || video.videoWidth === 0) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const canvasAspect = w / h;
  const videoAspect = vw / vh;

  let sx, sy, sw, sh;
  if (videoAspect > canvasAspect) {
    sh = vh; sw = vh * canvasAspect;
    sx = (vw - sw) / 2; sy = 0;
  } else {
    sw = vw; sh = vw / canvasAspect;
    sx = 0; sy = (vh - sh) / 2;
  }

  const shouldMirror = facingMode === 'user';

  if (shouldMirror) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, -w, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  }
}

export function isReady() {
  return ready;
}
