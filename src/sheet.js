// Builds the two sheets as display lists (arrays of drawing operations in
// points). The PDF renderer and the canvas preview both draw from these lists,
// so the preview shows what the PDF contains.
//
// Operation types (colors are gray levels, 0 = black, 255 = white):
//   { type: 'rect', x, y, w, h, stroke?, fill?, lineWidth? }
//   { type: 'line', x1, y1, x2, y2, stroke, lineWidth }
//   { type: 'poly', points: [[x, y], ...], fill }
//   { type: 'text', font, style, size, align, color, lines: [{ text, x, y }] }
//   { type: 'image', key, x, y, w, h }   // key refers to an entry in the image map
//
// `doc` is a jsPDF instance (unit 'pt') used only for text measurement.

import { layoutText } from './textfit.js';
import { freeRegions } from './layout.js';

const IN = 72;
const OUTLINE_GRAY = 150;
const BAND_GRAY = 222;
const MARK_GRAY = 0;
const LABEL_GRAY = 60;
const CONTENT_OUTLINE_GRAY = 200;

export const INSTRUCTIONS = [
  'Print this page at Actual size / 100%.',
  'Check that the reference square is the right size.',
  'Stick a note inside each outline, adhesive strip on the shaded band.',
  'Reload this sheet the same way: same side facing, shaded edge first.',
  'Print the content PDF on it.',
];

// Height of the shaded adhesive band at the leading (top) edge of each note.
export function adhesiveBandHeight(noteH) {
  return Math.min(0.625 * IN, noteH * 0.3);
}

function measure(doc, text, font, style, size) {
  doc.setFont(font, style);
  doc.setFontSize(size);
  return doc.getTextWidth(text);
}

function wrapLines(doc, text, font, style, size, width) {
  doc.setFont(font, style);
  doc.setFontSize(size);
  return doc.splitTextToSize(text, width);
}

function textOp(lines, x, y, size, { font = 'helvetica', style = 'normal', align = 'left', color = LABEL_GRAY, lineH = 1.2 } = {}) {
  return {
    type: 'text',
    font,
    style,
    size,
    align,
    color,
    lines: lines.map((t, i) => ({ text: t, x, y: y + size * 0.75 + i * size * lineH })),
  };
}

// Upward arrow filling the box.
function arrowUp(x, y, w, h, fill = 0) {
  const cx = x + w / 2;
  const headH = h * 0.45;
  const shaftW = w * 0.38;
  return {
    type: 'poly',
    fill,
    points: [
      [cx, y],
      [x + w, y + headH],
      [cx + shaftW / 2, y + headH],
      [cx + shaftW / 2, y + h],
      [cx - shaftW / 2, y + h],
      [cx - shaftW / 2, y + headH],
      [x, y + headH],
    ],
  };
}

function clampTo(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

const MARK_OFFSET = 2;
const MARK_LENGTH = 8;
const MARK_EXTENT = MARK_OFFSET + MARK_LENGTH + 1;

function cornerMarks(note, printable, ops) {
  const o = MARK_OFFSET;
  const len = MARK_LENGTH;
  const px0 = printable.x;
  const py0 = printable.y;
  const px1 = printable.x + printable.w;
  const py1 = printable.y + printable.h;
  const corners = [
    [note.x, note.y, -1, -1],
    [note.x + note.w, note.y, 1, -1],
    [note.x, note.y + note.h, -1, 1],
    [note.x + note.w, note.y + note.h, 1, 1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    const hx1 = clampTo(cx + dx * o, px0, px1);
    const hx2 = clampTo(cx + dx * (o + len), px0, px1);
    if (Math.abs(hx2 - hx1) > 1) ops.push({ type: 'line', x1: hx1, y1: cy, x2: hx2, y2: cy, stroke: MARK_GRAY, lineWidth: 0.6 });
    const vy1 = clampTo(cy + dy * o, py0, py1);
    const vy2 = clampTo(cy + dy * (o + len), py0, py1);
    if (Math.abs(vy2 - vy1) > 1) ops.push({ type: 'line', x1: cx, y1: vy1, x2: cx, y2: vy2, stroke: MARK_GRAY, lineWidth: 0.6 });
  }
}

function noteOutlineOps(note, doc, ops) {
  const bandH = adhesiveBandHeight(note.h);
  ops.push({ type: 'rect', x: note.x, y: note.y, w: note.w, h: bandH, fill: BAND_GRAY });
  ops.push({ type: 'rect', x: note.x, y: note.y, w: note.w, h: note.h, stroke: OUTLINE_GRAY, lineWidth: 0.5 });

  // Label inside the band with an up arrow on each side, sized to the band.
  const size = Math.max(4, Math.min(7, bandH * 0.35));
  const label = 'ADHESIVE STRIP HERE';
  const tw = measure(doc, label, 'helvetica', 'bold', size);
  const tri = size * 0.9;
  const total = tw + 2 * (tri + size * 0.6);
  if (total < note.w - 6) {
    const cx = note.x + note.w / 2;
    const midY = note.y + bandH / 2;
    ops.push(textOp([label], cx, midY - size / 2, size, { style: 'bold', align: 'center', color: 90 }));
    for (const side of [-1, 1]) {
      const tx = cx + side * (tw / 2 + size * 0.6 + tri / 2);
      ops.push(arrowUp(tx - tri / 2, midY - tri / 2, tri, tri, 90));
    }
  }
}

// Places decoration items into free regions, or inside empty note outlines
// (which are blank on the alignment sheet until notes are stuck on).
class Placer {
  constructor(regions, noteSlots) {
    this.regions = regions.map((r) => ({ ...r, used: false }));
    this.noteSlots = noteSlots.map((r) => ({ ...r, used: false }));
  }

  // `item(width, height)` returns { w, h, draw(x, y) } for a box, or null if it
  // can't fit. Returns true if placed.
  place(item, sides = null, allowNotes = true) {
    const candidates = this.regions.filter((r) => !r.used && (!sides || sides.includes(r.side)));
    if (sides) candidates.sort((a, b) => sides.indexOf(a.side) - sides.indexOf(b.side));
    const pools = allowNotes ? [candidates, this.noteSlots.filter((s) => !s.used)] : [candidates];
    for (const pool of pools) {
      for (const r of pool) {
        const it = item(r.w, r.h);
        if (!it || it.w > r.w + 0.01 || it.h > r.h + 0.01) continue;
        it.draw(r.x + (r.w - it.w) / 2, r.y + (r.h - it.h) / 2);
        r.used = true;
        return true;
      }
    }
    return false;
  }
}

export function buildAlignmentPage(layout, doc, { units = 'in' } = {}) {
  const ops = [];
  for (const note of layout.notes) noteOutlineOps(note, doc, ops);
  for (const note of layout.notes) cornerMarks(note, layout.printable, ops);

  // Keep labels clear of the corner marks that stick out from the grid.
  const regions = freeRegions(layout)
    .map((r) => {
      const m = MARK_EXTENT;
      if (r.side === 'top') return { ...r, h: r.h - m };
      if (r.side === 'bottom') return { ...r, y: r.y + m, h: r.h - m };
      if (r.side === 'left') return { ...r, w: r.w - m };
      if (r.side === 'right') return { ...r, x: r.x + m, w: r.w - m };
      return r;
    })
    .filter((r) => r.w > 1 && r.h > 1);
  const pad = 6;
  const noteSlots = layout.notes.map((n) => {
    const band = adhesiveBandHeight(n.h);
    return { x: n.x + pad, y: n.y + band + pad, w: n.w - 2 * pad, h: n.h - band - 2 * pad, side: 'note' };
  }).filter((s) => s.w > 0 && s.h > 0);
  const placer = new Placer(regions, noteSlots);

  // 1. Feed arrow, at the leading edge.
  const feedItem = (w, h) => {
    const label = 'Feed this edge into the printer first';
    const ah = Math.min(h - 4, 54);
    if (ah < 14) return null;
    const aw = ah * 0.75;
    let size = Math.min(16, Math.max(7, ah * 0.42));
    let tw = measure(doc, label, 'helvetica', 'bold', size);
    const gapX = Math.max(6, ah * 0.25);
    const maxText = w - 2 * (aw + gapX);
    if (tw > maxText) {
      size = (size * maxText) / tw;
      if (size < 6) return null;
      tw = measure(doc, label, 'helvetica', 'bold', size);
    }
    const total = 2 * (aw + gapX) + tw;
    return {
      w: total,
      h: ah,
      draw: (x, y) => {
        ops.push(arrowUp(x, y, aw, ah));
        ops.push(arrowUp(x + total - aw, y, aw, ah));
        ops.push(textOp([label], x + total / 2, y + ah / 2 - size / 2, size, { style: 'bold', align: 'center', color: 0 }));
      },
    };
  };
  placer.place(feedItem, ['top'], false) || placer.place(feedItem, [], true);

  // 2. Which side gets printed.
  const sideItem = (w, h) => {
    const text = 'This side gets printed. Reload with this side facing the same way.';
    const size = 10;
    const width = Math.min(w, measure(doc, text, 'helvetica', 'bold', size));
    if (width < 120) return null;
    const lines = wrapLines(doc, text, 'helvetica', 'bold', size, width);
    const lineH = size * 1.2;
    const textH = lines.length * lineH;
    if (textH > h) return null;
    return {
      w: width,
      h: textH,
      draw: (x, y) => ops.push(textOp(lines, x + width / 2, y, size, { style: 'bold', align: 'center', color: 0 })),
    };
  };
  placer.place(sideItem, ['bottom', 'top', 'left', 'right', 'all']);

  // 3. Reference square.
  const sq = units === 'mm' ? (25 / 25.4) * IN : IN;
  const sqName = units === 'mm' ? '25 mm' : '1 inch';
  const refItem = (w, h) => {
    const text = `If this square isn't exactly ${sqName}, print at 'Actual size' / 100% scale, not 'Fit to page.'`;
    const size = 7.5;
    const lineH = size * 1.2;
    const gapX = 8;
    // Label beside the square if there's room, otherwise below it.
    const besideW = Math.min(150, w - sq - gapX);
    if (besideW >= 80) {
      const lines = wrapLines(doc, text, 'helvetica', 'normal', size, besideW);
      const bh = Math.max(sq, lines.length * lineH);
      if (bh <= h) {
        const tw = Math.max(...lines.map((l) => measure(doc, l, 'helvetica', 'normal', size)));
        return {
          w: sq + gapX + tw,
          h: bh,
          draw: (x, y) => {
            ops.push({ type: 'rect', x, y, w: sq, h: sq, stroke: 0, lineWidth: 0.75 });
            ops.push(textOp(lines, x + sq + gapX, y, size, { color: LABEL_GRAY }));
          },
        };
      }
    }
    const belowW = Math.min(w, 150);
    if (belowW < sq) return null;
    const lines = wrapLines(doc, text, 'helvetica', 'normal', size, belowW);
    const bh = sq + 4 + lines.length * lineH;
    if (bh > h) return null;
    return {
      w: belowW,
      h: bh,
      draw: (x, y) => {
        ops.push({ type: 'rect', x: x + (belowW - sq) / 2, y, w: sq, h: sq, stroke: 0, lineWidth: 0.75 });
        ops.push(textOp(lines, x + belowW / 2, y + sq + 4, size, { align: 'center', color: LABEL_GRAY }));
      },
    };
  };
  placer.place(refItem);

  // 4. Numbered instructions, if there's room.
  const instrItem = (w, h) => {
    const size = 7.5;
    const lineH = size * 1.25;
    const width = Math.min(w, 230);
    if (width < 120) return null;
    const lines = [];
    INSTRUCTIONS.forEach((t, i) => {
      const wrapped = wrapLines(doc, `${i + 1}. ${t}`, 'helvetica', 'normal', size, width - 8);
      wrapped.forEach((l, j) => lines.push(j === 0 ? l : `    ${l}`));
    });
    const bh = (lines.length + 1) * lineH;
    if (bh > h) return null;
    return {
      w: width,
      h: bh,
      draw: (x, y) => {
        ops.push(textOp(['How to use this sheet'], x, y, size, { style: 'bold', color: LABEL_GRAY, lineH: 1.25 }));
        ops.push(textOp(lines, x, y + lineH, size, { color: LABEL_GRAY, lineH: 1.25 }));
      },
    };
  };
  placer.place(instrItem);

  return { width: layout.pageW, height: layout.pageH, ops };
}

// Content for one note:
//   { type: 'text', text, font, bold, italic, align, valign, manualSize }
//   { type: 'image', key }   // image pre-rendered to the content box size
//
// `contentFor(note)` returns the content for a note, so per-note content and
// mail merge only need a different function.
export function buildContentPage(layout, doc, contentFor, { outline = false } = {}) {
  const ops = [];
  const textCache = new Map();
  const results = [];
  for (const note of layout.notes) {
    if (outline) {
      ops.push({ type: 'rect', x: note.x, y: note.y, w: note.w, h: note.h, stroke: CONTENT_OUTLINE_GRAY, lineWidth: 0.5 });
    }
    const content = contentFor(note);
    const box = note.content;
    if (!content || box.w <= 0 || box.h <= 0) {
      results.push(null);
      continue;
    }
    if (content.type === 'image') {
      if (content.key) ops.push({ type: 'image', key: content.key, x: box.x, y: box.y, w: box.w, h: box.h });
      results.push({ type: 'image' });
    } else {
      // Lay out once per distinct text and box size, then translate.
      const cacheKey = JSON.stringify([content, box.w, box.h]);
      let t = textCache.get(cacheKey);
      if (!t) {
        t = layoutText(doc, content, { x: 0, y: 0, w: box.w, h: box.h });
        textCache.set(cacheKey, t);
      }
      if (t.lines.length) {
        ops.push({
          type: 'text',
          font: t.font,
          style: t.style,
          size: t.size,
          align: t.align,
          color: 0,
          lines: t.lines.map((l) => ({ text: l.text, x: l.x + box.x, y: l.y + box.y })),
        });
      }
      results.push(t);
    }
  }
  return { width: layout.pageW, height: layout.pageH, ops, results };
}
