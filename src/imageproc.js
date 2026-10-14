// Black-and-white image processing for a mono laser printer.
// The pixel functions are pure and work on plain arrays so they can be tested
// without a browser. `renderNoteImage` is the browser entry point.

export const IMAGE_DPI = 300;

// Placement of a source image (sw × sh) inside a box (bw × bh).
// 'fit' = contain (whole image visible), 'fill' = cover (cropped to the box).
export function placeImage(sw, sh, bw, bh, mode) {
  const scale = mode === 'fill' ? Math.max(bw / sw, bh / sh) : Math.min(bw / sw, bh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// RGBA bytes → grayscale (0–255 floats) with brightness and contrast applied.
// brightness and contrast range from -100 to 100; 0 leaves the image unchanged.
export function toGray(rgba, brightness = 0, contrast = 0) {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  const b = brightness * 2.55;
  const c = contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const bl = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    // Composite over white so transparent areas print as paper.
    let y = (0.299 * r + 0.587 * g + 0.114 * bl) * a + 255 * (1 - a);
    y = factor * (y + b - 128) + 128;
    out[i] = clamp255(y);
  }
  return out;
}

export function threshold(gray, level = 128) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] >= level ? 255 : 0;
  return out;
}

// Floyd–Steinberg error diffusion to pure black and white.
export function ditherFloydSteinberg(gray, width, height) {
  const buf = Float32Array.from(gray);
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const v = old >= 128 ? 255 : 0;
      out[i] = v;
      const err = old - v;
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16;
        buf[i + width] += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1] += err / 16;
      }
    }
  }
  return out;
}

// Applies the selected mode. Returns one gray byte per pixel.
export function processPixels(rgba, width, height, opts) {
  const gray = toGray(rgba, opts.brightness || 0, opts.contrast || 0);
  if (opts.mode === 'threshold') return threshold(gray, opts.threshold ?? 128);
  if (opts.mode === 'dither') return ditherFloydSteinberg(gray, width, height);
  return Uint8ClampedArray.from(gray, (v) => Math.round(v));
}

export function grayToRGBA(gray, target) {
  for (let i = 0; i < gray.length; i++) {
    target[i * 4] = target[i * 4 + 1] = target[i * 4 + 2] = gray[i];
    target[i * 4 + 3] = 255;
  }
  return target;
}

// Browser only. Draws `img` into a canvas sized to the content box at 300 DPI,
// applies the processing, and returns the canvas.
export function renderNoteImage(img, boxWPt, boxHPt, opts) {
  const w = Math.max(1, Math.round((boxWPt / 72) * IMAGE_DPI));
  const h = Math.max(1, Math.round((boxHPt / 72) * IMAGE_DPI));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const r = placeImage(sw, sh, w, h, opts.fit);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const data = ctx.getImageData(0, 0, w, h);
  const gray = processPixels(data.data, w, h, opts);
  grayToRGBA(gray, data.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
}
