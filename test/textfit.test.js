import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { autoFitSize, layoutText, LINE_HEIGHT } from '../src/textfit.js';

const doc = () => new jsPDF({ unit: 'pt', format: 'letter' });
const box = { x: 10, y: 20, w: 200, h: 200 };
const base = { text: 'Hello world', font: 'helvetica', bold: false, italic: false, align: 'left', valign: 'top', manualSize: 0 };

test('auto-fit picks the largest size that fits', () => {
  const d = doc();
  d.setFont('helvetica', 'normal');
  const size = autoFitSize(d, 'Hello world', box);
  const fits = (s) => {
    d.setFontSize(s);
    const lines = d.splitTextToSize('Hello world', box.w);
    return lines.length * s * LINE_HEIGHT <= box.h && lines.every((l) => d.getTextWidth(l) <= box.w);
  };
  assert.ok(fits(size), 'chosen size fits');
  assert.ok(!fits(size + 0.5), 'next half point does not fit');
  assert.equal(size * 2, Math.round(size * 2), 'half-point steps');
});

test('longer text gets a smaller size', () => {
  const d = doc();
  const a = layoutText(d, base, box).size;
  const b = layoutText(d, { ...base, text: 'Hello world, this is a much longer note with many words in it.' }, box).size;
  assert.ok(b < a);
});

test('bold text is not larger than regular', () => {
  const d = doc();
  const a = layoutText(d, { ...base, text: 'Measure me please' }, box).size;
  const b = layoutText(d, { ...base, text: 'Measure me please', bold: true }, box).size;
  assert.ok(b <= a);
});

test('lines stay inside the box for every alignment', () => {
  const d = doc();
  for (const align of ['left', 'center', 'right']) {
    for (const valign of ['top', 'middle', 'bottom']) {
      const t = layoutText(d, { ...base, text: 'Buy milk\nCall Sam\nPay rent', align, valign }, box);
      assert.ok(t.fits);
      assert.equal(t.lines.length, 3);
      const first = t.lines[0].y - 0.718 * t.size; // Helvetica ascent
      const last = t.lines[2].y + 0.207 * t.size; // Helvetica descent
      assert.ok(first >= box.y - 1 && last <= box.y + box.h + 1, `${align}/${valign}`);
      const expectedX = { left: box.x, center: box.x + box.w / 2, right: box.x + box.w }[align];
      assert.equal(t.lines[0].x, expectedX);
    }
  }
});

test('manual size override is used even if it overflows', () => {
  const d = doc();
  const t = layoutText(d, { ...base, manualSize: 120 }, box);
  assert.equal(t.size, 120);
  assert.equal(t.auto, false);
  assert.equal(t.fits, false);
});

test('empty text yields no lines', () => {
  const t = layoutText(doc(), { ...base, text: '   ' }, box);
  assert.equal(t.lines.length, 0);
});

test('a single long word shrinks to fit the width', () => {
  const d = doc();
  const t = layoutText(d, { ...base, text: 'Supercalifragilisticexpialidocious' }, box);
  assert.ok(t.fits);
  d.setFont('helvetica', 'normal');
  d.setFontSize(t.size);
  for (const l of t.lines) assert.ok(d.getTextWidth(l.text) <= box.w + 1e-6);
});
