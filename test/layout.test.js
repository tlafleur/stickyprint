import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, computeGrid, freeRegions } from '../src/layout.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const IN = 72;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);

function settings(overrides = {}) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return Object.assign(s, overrides);
}

test('Letter + 3x3 defaults: 2 × 3 grid, centered', () => {
  const L = computeLayout(settings());
  near(L.pageW, 8.5 * IN);
  near(L.pageH, 11 * IN);
  assert.equal(L.cols, 2);
  assert.equal(L.rows, 3);
  assert.equal(L.count, 6);
  near(L.grid.w, 6.25 * IN);
  near(L.grid.h, 9.5 * IN);
  near(L.grid.x, 1.125 * IN);
  near(L.grid.y, 0.75 * IN);
  const n = L.notes[3]; // row 1, col 1
  assert.equal(n.row, 1);
  assert.equal(n.col, 1);
  near(n.x, (1.125 + 3.25) * IN);
  near(n.y, (0.75 + 3.25) * IN);
  near(n.content.x, n.x + 0.1 * IN);
  near(n.content.w, 2.8 * IN);
  assert.deepEqual(L.warnings, []);
});

test('A4 + 3x5 portrait and rotated', () => {
  const s = settings({ paper: { preset: 'a4', width: 0, height: 0 }, note: { preset: '3x5', width: 0, height: 0, rotate: false } });
  const L = computeLayout(s);
  near(L.pageW, (210 / 25.4) * IN);
  near(L.pageH, (297 / 25.4) * IN);
  assert.equal(L.cols, 2);
  assert.equal(L.rows, 2);
  near(L.noteW, 3 * IN);
  near(L.noteH, 5 * IN);

  s.note.rotate = true;
  const R = computeLayout(s);
  assert.equal(R.cols, 1);
  assert.equal(R.rows, 3);
  near(R.noteW, 5 * IN);
  near(R.noteH, 3 * IN);
});

test('grid is centered on the page', () => {
  const L = computeLayout(settings({ note: { preset: '1.5x2', width: 0, height: 0, rotate: false } }));
  near(L.grid.x + L.grid.w / 2, L.pageW / 2);
  near(L.grid.y + L.grid.h / 2, L.pageH / 2);
  for (const n of L.notes) {
    assert.ok(n.x >= L.printable.x - 1e-9 && n.x + n.w <= L.printable.x + L.printable.w + 1e-9);
    assert.ok(n.y >= L.printable.y - 1e-9 && n.y + n.h <= L.printable.y + L.printable.h + 1e-9);
  }
});

test('exact fit is not lost to floating point error', () => {
  // Printable width 8", three 2.5" notes with 0.25" gaps = exactly 8".
  const L = computeGrid({ pageW: 8.5 * IN, pageH: 11 * IN, noteW: 2.5 * IN, noteH: 2.5 * IN, gap: 0.25 * IN, margin: 0.25 * IN, inset: 0, offsetX: 0, offsetY: 0 });
  assert.equal(L.cols, 3);
  near(L.grid.x, 0.25 * IN);
});

test('millimetre custom sizes', () => {
  const s = settings({
    units: 'mm',
    paper: { preset: 'custom', width: 100, height: 100 },
    note: { preset: 'custom', width: 40, height: 40, rotate: false },
    gap: 5,
    margin: 5,
    inset: 2,
  });
  const L = computeLayout(s);
  assert.equal(L.count, 4);
  near(L.notes[0].x, (7.5 / 25.4) * IN);
  near(L.notes[0].content.w, (36 / 25.4) * IN);
});

test('note too big: zero notes and a warning', () => {
  const L = computeLayout(settings({ note: { preset: 'custom', width: 9, height: 3, rotate: false } }));
  assert.equal(L.count, 0);
  assert.equal(L.warnings.length, 1);
  assert.deepEqual(freeRegions(L).map((r) => r.side), ['all']);
});

test('inset larger than note warns and clamps content to zero', () => {
  const L = computeLayout(settings({ inset: 2 }));
  assert.ok(L.warnings.some((w) => w.includes('inset')));
  assert.equal(L.notes[0].content.w, 0);
});

test('invalid input does not throw', () => {
  const L = computeLayout(settings({ gap: -1 }));
  assert.equal(L.count, 0);
  const M = computeLayout(settings({ note: { preset: 'custom', width: NaN, height: 3, rotate: false } }));
  assert.equal(M.count, 0);
});

test('offset shifts every note equally', () => {
  const a = computeLayout(settings());
  const b = computeLayout(settings({ offsetX: 0.1, offsetY: -0.05 }));
  a.notes.forEach((n, i) => {
    near(b.notes[i].x - n.x, 0.1 * IN);
    near(b.notes[i].y - n.y, -0.05 * IN);
  });
});

test('free regions surround the grid inside the printable area', () => {
  const L = computeLayout(settings());
  const r = Object.fromEntries(freeRegions(L).map((x) => [x.side, x]));
  near(r.top.h, 0.5 * IN);
  near(r.bottom.h, 0.5 * IN);
  near(r.left.w, 0.875 * IN);
  near(r.right.w, 0.875 * IN);
});
