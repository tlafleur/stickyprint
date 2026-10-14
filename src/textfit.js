// Text layout for a note's content box, measured with jsPDF so that the
// on-screen preview and the PDF break lines at the same places.
//
// `doc` is any jsPDF instance created with unit 'pt'. Its font state is
// changed by these functions.

export const FONTS = {
  helvetica: { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif', ascent: 0.718, descent: 0.207 },
  times: { label: 'Times', css: '"Times New Roman", Times, serif', ascent: 0.683, descent: 0.217 },
  courier: { label: 'Courier', css: '"Courier New", Courier, monospace', ascent: 0.629, descent: 0.157 },
};

export const LINE_HEIGHT = 1.15;
export const MIN_SIZE = 4;
export const MAX_SIZE = 300;

export function fontStyle(bold, italic) {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

function wrap(doc, text, size, maxWidth) {
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, maxWidth);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, doc.getTextWidth(line));
  return { lines, widest, height: lines.length * size * LINE_HEIGHT };
}

function fitsAt(doc, text, size, box) {
  const r = wrap(doc, text, size, box.w);
  // splitTextToSize can leave a single word wider than the box; that doesn't fit.
  return r.height <= box.h + 1e-6 && r.widest <= box.w + 1e-6;
}

// Largest font size (to 0.5 pt) at which the wrapped text fits the box.
export function autoFitSize(doc, text, box) {
  if (!text.trim() || box.w <= 0 || box.h <= 0) return MIN_SIZE;
  let lo = MIN_SIZE;
  let hi = Math.min(MAX_SIZE, box.h / LINE_HEIGHT);
  if (hi <= lo) return MIN_SIZE;
  if (!fitsAt(doc, text, lo, box)) return MIN_SIZE;
  if (fitsAt(doc, text, hi, box)) return Math.floor(hi * 2) / 2;
  // Invariant: fits at lo, doesn't fit at hi.
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (fitsAt(doc, text, mid, box)) lo = mid;
    else hi = mid;
  }
  let size = Math.floor(lo * 2) / 2;
  // Fitting isn't strictly monotonic at line-break boundaries; step down if needed.
  while (size > MIN_SIZE && !fitsAt(doc, text, size, box)) size -= 0.5;
  return Math.max(MIN_SIZE, size);
}

// Lays out text in a box. Returns the font size, whether it fits, and lines
// with anchor positions (x is the left, center or right anchor depending on
// `align`; y is the alphabetic baseline).
export function layoutText(doc, spec, box) {
  const fontKey = FONTS[spec.font] ? spec.font : 'helvetica';
  const metrics = FONTS[fontKey];
  const style = fontStyle(spec.bold, spec.italic);
  doc.setFont(fontKey, style);

  const text = spec.text || '';
  const manual = Number(spec.manualSize) > 0 ? Number(spec.manualSize) : 0;
  const size = manual || autoFitSize(doc, text, box);
  const { lines, widest, height } = wrap(doc, text, size, box.w);
  const fits = height <= box.h + 1e-6 && widest <= box.w + 1e-6;

  const lineH = size * LINE_HEIGHT;
  let top = box.y;
  if (spec.valign === 'middle') top = box.y + (box.h - height) / 2;
  else if (spec.valign === 'bottom') top = box.y + box.h - height;

  let x = box.x;
  if (spec.align === 'center') x = box.x + box.w / 2;
  else if (spec.align === 'right') x = box.x + box.w;

  const halfLeading = (lineH - (metrics.ascent + metrics.descent) * size) / 2;
  const placed = text.trim()
    ? lines.map((line, i) => ({ text: line, x, y: top + i * lineH + halfLeading + metrics.ascent * size }))
    : [];

  return {
    font: fontKey,
    style,
    size,
    align: spec.align === 'center' || spec.align === 'right' ? spec.align : 'left',
    lines: placed,
    fits,
    auto: !manual,
  };
}
