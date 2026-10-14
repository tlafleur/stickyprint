// Pure layout math: settings in, page size and note rectangles (in points) out.
// Both PDFs and the on-screen preview are drawn from this output, so any
// consistent printer offset affects both passes equally.
//
// Coordinate system: origin at the top-left corner of the page, x to the right,
// y downward, units in PDF points. The top edge of the page is the edge that
// enters the printer first.

import { toPt } from './units.js';

// Paper presets are defined in their native unit.
export const PAPER_PRESETS = {
  letter: { label: 'Letter (8.5 × 11 in)', width: 8.5, height: 11, unit: 'in' },
  a4: { label: 'A4 (210 × 297 mm)', width: 210, height: 297, unit: 'mm' },
};

// Note presets in inches, width × height before rotation.
export const NOTE_PRESETS = {
  '3x3': { label: '3 × 3 in', width: 3, height: 3, unit: 'in' },
  '3x5': { label: '3 × 5 in', width: 3, height: 5, unit: 'in' },
  '1.5x2': { label: '1.5 × 2 in', width: 1.5, height: 2, unit: 'in' },
  '4x6': { label: '4 × 6 in', width: 4, height: 6, unit: 'in' },
};

const EPS = 1e-6;

function presetSizePt(presets, key, custom, unit) {
  const p = presets[key];
  if (p) return { w: toPt(p.width, p.unit), h: toPt(p.height, p.unit) };
  return { w: toPt(custom.width, unit), h: toPt(custom.height, unit) };
}

// Resolves presets, rotation and units into plain point values.
export function resolveDimensions(settings) {
  const unit = settings.units;
  const paper = presetSizePt(PAPER_PRESETS, settings.paper.preset, settings.paper, unit);
  let note = presetSizePt(NOTE_PRESETS, settings.note.preset, settings.note, unit);
  if (settings.note.rotate) note = { w: note.h, h: note.w };
  return {
    pageW: paper.w,
    pageH: paper.h,
    noteW: note.w,
    noteH: note.h,
    gap: toPt(settings.gap, unit),
    margin: toPt(settings.margin, unit),
    inset: toPt(settings.inset, unit),
    // Reserved for printer offset calibration; shifts every note equally.
    offsetX: toPt(settings.offsetX || 0, unit),
    offsetY: toPt(settings.offsetY || 0, unit),
  };
}

function fitCount(available, size, gap) {
  if (size <= 0 || available < size - EPS) return 0;
  return Math.floor((available + gap) / (size + gap) + EPS);
}

// Computes the grid from point values. Exported separately so tests can
// exercise the math without going through presets.
export function computeGrid(d) {
  const warnings = [];
  const printable = {
    x: d.margin,
    y: d.margin,
    w: d.pageW - 2 * d.margin,
    h: d.pageH - 2 * d.margin,
  };

  const valid =
    d.pageW > 0 && d.pageH > 0 && d.noteW > 0 && d.noteH > 0 && d.gap >= 0 && d.margin >= 0;
  const cols = valid ? fitCount(printable.w, d.noteW, d.gap) : 0;
  const rows = valid ? fitCount(printable.h, d.noteH, d.gap) : 0;
  if (!valid) warnings.push('Check the sizes: they must be positive numbers.');
  else if (cols === 0 || rows === 0) warnings.push('The note does not fit inside the printable area.');

  const gridW = cols > 0 ? cols * d.noteW + (cols - 1) * d.gap : 0;
  const gridH = rows > 0 ? rows * d.noteH + (rows - 1) * d.gap : 0;
  // Centered on the page (equal to centering in the printable area, since the
  // margin is the same on every side).
  const grid = {
    x: (d.pageW - gridW) / 2 + d.offsetX,
    y: (d.pageH - gridH) / 2 + d.offsetY,
    w: gridW,
    h: gridH,
  };

  const contentW = d.noteW - 2 * d.inset;
  const contentH = d.noteH - 2 * d.inset;
  if (cols > 0 && rows > 0 && (contentW <= 0 || contentH <= 0)) {
    warnings.push('The safe inset is larger than the note, so there is no room for content.');
  }

  const notes = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = grid.x + col * (d.noteW + d.gap);
      const y = grid.y + row * (d.noteH + d.gap);
      notes.push({
        index: notes.length,
        row,
        col,
        x,
        y,
        w: d.noteW,
        h: d.noteH,
        content: {
          x: x + d.inset,
          y: y + d.inset,
          w: Math.max(0, contentW),
          h: Math.max(0, contentH),
        },
      });
    }
  }

  return {
    pageW: d.pageW,
    pageH: d.pageH,
    printable,
    grid,
    cols,
    rows,
    count: notes.length,
    notes,
    noteW: d.noteW,
    noteH: d.noteH,
    gap: d.gap,
    margin: d.margin,
    inset: d.inset,
    warnings,
  };
}

export function computeLayout(settings) {
  return computeGrid(resolveDimensions(settings));
}

// Rectangles inside the printable area that are not covered by the grid.
// Used to place labels and instructions on the alignment sheet.
export function freeRegions(layout) {
  const { printable: p, grid: g } = layout;
  if (layout.count === 0) return [{ ...p, side: 'all' }];
  const regions = [
    { side: 'top', x: p.x, y: p.y, w: p.w, h: g.y - p.y },
    { side: 'bottom', x: p.x, y: g.y + g.h, w: p.w, h: p.y + p.h - (g.y + g.h) },
    { side: 'left', x: p.x, y: g.y, w: g.x - p.x, h: g.h },
    { side: 'right', x: g.x + g.w, y: g.y, w: p.x + p.w - (g.x + g.w), h: g.h },
  ];
  return regions.filter((r) => r.w > EPS && r.h > EPS);
}
