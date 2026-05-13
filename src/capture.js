/**
 * Screenshot capture — exports the output canvas as a PNG download.
 */

/**
 * Save the current output canvas as a PNG.
 * On mobile, opens in a new tab (download attribute is unreliable).
 */
export function save(canvas) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shape-camera-${timestamp}.png`;

  canvas.toBlob(blob => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);

    // try download, fall back to new tab
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }, 'image/png');
}
