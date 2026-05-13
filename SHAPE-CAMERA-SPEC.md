# Shape Camera — Renderer Improvements

## Project
Vanilla JS + Vite camera instrument at `./shape-camera/`.  
Camera feed → real-time flat-color illustration effect → fullscreen canvas.

## Current State
The renderer (`src/renderer.js`) uses box blur + channel posterization to flatten the camera feed. It works but produces results that look like a **blurry posterized photo**, not the **clean flat-color illustration** we're targeting.

## Target Aesthetic
Think Michael Craig-Martin or the flat gouache illustration style:
- **Large contiguous regions of FLAT solid color** — no gradients, no noise, no texture within a region
- **Bold dark contour lines** between color regions — confident, uniform weight, like a painting with black outlines
- **Saturated, punchy colors** — not washed out or muddy. Colors should feel intentional, not averaged
- **Clean sharp edges** between regions — no blur bleed or soft transitions
- Objects should be **recognizable but simplified** to their essential flat forms

## What Needs to Change

### 1. Better color quantization
The current approach (posterize each RGB channel independently to N levels) produces too many muddy intermediate colors. Replace with one of:
- **Median cut** or **k-means color quantization** — reduce to a LIMITED palette (8-16 colors depending on simplification level) where each color is an actual color from the scene, not a channel-rounded artifact
- Or at minimum: posterize in **HSL space** instead of RGB, and snap saturation UP (never let it get muddy)

### 2. Edge-preserving smoothing
The current box blur smears edges, making boundaries soft. Replace with:
- **Bilateral filter approximation**: smooth pixels that are similar in color, but DON'T smooth across color boundaries. This preserves hard edges while merging similar-colored areas.
- Implementation: for each pixel, only average neighbors whose color distance is below a threshold. This is more expensive than box blur but critical for the flat-region look.
- Or: run the posterization FIRST, then do a **mode filter** (each pixel takes the most common color in its neighborhood) — this cleans up isolated pixels and expands regions without blurring edges.

### 3. Edge rendering
Current edge detection is too subtle. Needs:
- **Thicker, bolder lines** — 2-3px at source resolution (which upscales to ~5-8px on screen)
- **Uniform dark color** — near-black, consistent opacity
- **Run edge detection on the POSTERIZED image**, not the original — this gives clean contour lines between flat regions rather than noisy edges from photo detail
- Consider a small **dilation** pass on edge pixels to thicken them

### 4. Color saturation boost
After quantization, boost saturation:
- Convert to HSL, multiply saturation by 1.3-1.5, clamp
- Optionally snap lightness to fewer levels (light/medium/dark) for even flatter regions

### 5. Simplification parameter
`inputX` (0-1) controls simplification. Map it to:
- **Left (0)**: more colors (16), less smoothing, thinner edges — closer to photo but still flat
- **Right (1)**: fewer colors (5-6), heavy smoothing, bold edges — maximum illustration effect

## Architecture
- `src/renderer.js` — the main file to modify. Exports `render(ctx, sourceData, sw, sh, outW, outH, opts)`
- `opts.simplification` — 0-1 float from mouse/touch X position  
- `opts.colorMode` — 'normal' | 'bw' | 'invert'
- `opts.showEdges` — boolean, toggles contour lines
- Returns `{ levels, ... }` info object for the HUD
- Source canvas is ~35-45% of screen resolution. Must run at 60fps on mobile.
- Reusable work canvases via `getWorkCanvas()` / `getEdgeCanvas()` pattern (avoid GC)

## Performance Constraints
This runs in a `requestAnimationFrame` loop processing every camera frame. On mobile the source canvas is ~170×300px. Full k-means is too expensive per frame — consider:
- Running quantization on a further-downscaled version and mapping back
- Using a fast approximation (median cut is O(n log n) and practical)
- Caching the palette for a few frames and only recomputing every 5-10 frames
- The bilateral filter can be approximated with a small kernel (5×5)

## Files to Read First
- `src/renderer.js` — current implementation
- `src/main.js` — how the renderer is called
- `src/camera.js` — camera frame pipeline

## Don't Change
- Project structure, build setup, HTML, CSS, other modules
- The camera.js and capture.js modules work fine
- The interaction model (X = simplification, hold = freeze)
- The UI controls and their wiring in main.js