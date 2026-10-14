import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { computeLayout } from '../src/layout.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { buildAlignmentPage, buildContentPage } from '../src/sheet.js';
import { renderPdf } from '../src/render-pdf.js';

const doc = () => new jsPDF({ unit: 'pt', format: 'letter' });
const settings = (o = {}) => Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), o);
const allText = (page) => page.ops.filter((o) => o.type === 'text').flatMap((o) => o.lines.map((l) => l.text)).join(' ');

test('alignment page has an outline per note and all labels', () => {
  const L = computeLayout(settings());
  const page = buildAlignmentPage(L, doc());
  assert.equal(page.width, L.pageW);
  const outlines = page.ops.filter((o) => o.type === 'rect' && o.stroke === 150);
  assert.equal(outlines.length, L.count);
  outlines.forEach((o, i) => assert.deepEqual([o.x, o.y, o.w, o.h], [L.notes[i].x, L.notes[i].y, L.notes[i].w, L.notes[i].h]));
  const text = allText(page);
  assert.match(text, /Feed this edge into the printer first/);
  assert.match(text, /This side gets printed/);
  assert.match(text, /exactly 1 inch/);
  assert.match(text, /How to use this sheet/);
  // Reference square is exactly one inch.
  assert.ok(page.ops.some((o) => o.type === 'rect' && o.stroke === 0 && Math.abs(o.w - 72) < 1e-9 && Math.abs(o.h - 72) < 1e-9));
});

test('mm units use a 25 mm square', () => {
  const page = buildAlignmentPage(computeLayout(settings()), doc(), { units: 'mm' });
  const sq = (25 / 25.4) * 72;
  assert.ok(page.ops.some((o) => o.type === 'rect' && o.stroke === 0 && Math.abs(o.w - sq) < 1e-9));
  assert.match(allText(page), /exactly 25 mm/);
});

test('nothing is drawn inside the printer margin', () => {
  for (const preset of ['3x3', '3x5', '1.5x2', '4x6']) {
    const L = computeLayout(settings({ note: { preset, width: 0, height: 0, rotate: false } }));
    const page = buildAlignmentPage(L, doc());
    const p = L.printable;
    for (const o of page.ops) {
      const pts = o.type === 'line' ? [[o.x1, o.y1], [o.x2, o.y2]]
        : o.type === 'poly' ? o.points
        : o.type === 'rect' ? [[o.x, o.y], [o.x + o.w, o.y + o.h]]
        : o.lines.map((l) => [l.x, l.y]);
      for (const [x, y] of pts) {
        assert.ok(x >= p.x - 1e-6 && x <= p.x + p.w + 1e-6 && y >= p.y - 1e-6 && y <= p.y + p.h + 1e-6, `${preset} ${o.type} at ${x},${y}`);
      }
    }
  }
});

test('content page places text inside each content box, same coordinates as the layout', () => {
  const L = computeLayout(settings());
  const spec = { type: 'text', ...DEFAULT_SETTINGS.content.text };
  const page = buildContentPage(L, doc(), () => spec);
  const texts = page.ops.filter((o) => o.type === 'text');
  assert.equal(texts.length, L.count);
  texts.forEach((t, i) => {
    const b = L.notes[i].content;
    for (const l of t.lines) {
      assert.ok(l.y > b.y && l.y < b.y + b.h);
      assert.equal(l.x, b.x + b.w / 2); // centered
    }
  });
  // No outlines unless requested.
  assert.equal(page.ops.filter((o) => o.type === 'rect').length, 0);
  const withOutline = buildContentPage(L, doc(), () => spec, { outline: true });
  assert.equal(withOutline.ops.filter((o) => o.type === 'rect').length, L.count);
});

test('image content uses the content box', () => {
  const L = computeLayout(settings());
  const page = buildContentPage(L, doc(), () => ({ type: 'image', key: 'img' }));
  const imgs = page.ops.filter((o) => o.type === 'image');
  assert.equal(imgs.length, L.count);
  assert.deepEqual([imgs[0].x, imgs[0].y, imgs[0].w, imgs[0].h], [L.notes[0].content.x, L.notes[0].content.y, L.notes[0].content.w, L.notes[0].content.h]);
});

test('PDF page size equals the paper size', () => {
  for (const paper of ['letter', 'a4']) {
    const L = computeLayout(settings({ paper: { preset: paper, width: 0, height: 0 } }));
    const pdf = renderPdf(jsPDF, [buildAlignmentPage(L, doc())]);
    assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - L.pageW) < 0.01);
    assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - L.pageH) < 0.01);
  }
});
