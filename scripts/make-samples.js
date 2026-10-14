// Generates sample PDFs into samples/ for checking alignment by eye or with
// scripts/check-samples.py. Uses the same modules as the web app.
import { mkdirSync, writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { encode } from 'fast-png';
import { computeLayout } from '../src/layout.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { buildAlignmentPage, buildContentPage } from '../src/sheet.js';
import { renderPdf } from '../src/render-pdf.js';
import { processPixels, IMAGE_DPI } from '../src/imageproc.js';

const out = 'samples';
mkdirSync(out, { recursive: true });

const cases = [
  { name: 'letter-3x3', paper: 'letter', note: '3x3', rotate: false },
  { name: 'a4-3x5', paper: 'a4', note: '3x5', rotate: false },
  { name: 'letter-5x3', paper: 'letter', note: '3x5', rotate: true },
];

// A synthetic test image: radial gradient with a dark ring, dithered.
function testImagePng(wPt, hPt) {
  const w = Math.round((wPt / 72) * IMAGE_DPI);
  const h = Math.round((hPt / 72) * IMAGE_DPI);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w / 2, y - h / 2) / (Math.min(w, h) / 2);
      const v = d > 0.85 && d < 0.95 ? 0 : Math.min(255, d * 255);
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const gray = processPixels(rgba, w, h, { mode: 'dither' });
  return encode({ width: w, height: h, data: gray, channels: 1, depth: 8 });
}

const summary = [];
for (const c of cases) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.paper.preset = c.paper;
  s.note.preset = c.note;
  s.note.rotate = c.rotate;
  const layout = computeLayout(s);
  const measure = new jsPDF({ unit: 'pt' });

  const write = (suffix, page, images) => {
    const pdf = renderPdf(jsPDF, [page], images);
    writeFileSync(`${out}/${c.name}-${suffix}.pdf`, Buffer.from(pdf.output('arraybuffer')));
  };

  write('alignment', buildAlignmentPage(layout, measure));
  const textSpec = { type: 'text', ...s.content.text, text: 'Buy milk\nCall the dentist\nWater the plants' };
  write('content', buildContentPage(layout, measure, () => textSpec));
  write('content-outline', buildContentPage(layout, measure, () => textSpec, { outline: true }));
  const box = layout.notes[0].content;
  const images = new Map([['img', testImagePng(box.w, box.h)]]);
  write('image', buildContentPage(layout, measure, () => ({ type: 'image', key: 'img' }), { outline: true }), images);

  summary.push({
    name: c.name,
    pageW: layout.pageW,
    pageH: layout.pageH,
    count: layout.count,
    notes: layout.notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, content: n.content })),
  });
}
writeFileSync(`${out}/layouts.json`, JSON.stringify(summary, null, 2));
console.log(summary.map((s) => `${s.name}: ${s.count} notes, page ${s.pageW.toFixed(2)} × ${s.pageH.toFixed(2)} pt`).join('\n'));
