import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, changeUnits, loadSettings, saveSettings, normalizeSettings, STORAGE_KEY } from '../src/settings.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('save and load round-trip', () => {
  const st = memoryStorage();
  const s = { ...DEFAULT_SETTINGS, gap: 0.5 };
  assert.equal(saveSettings(s, st), true);
  assert.equal(loadSettings(st).gap, 0.5);
});

test('storage errors fall back to defaults', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, broken), false);
  const st = memoryStorage();
  st.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadSettings(st), DEFAULT_SETTINGS);
});

test('partial saved settings are filled from defaults', () => {
  const s = normalizeSettings({ gap: 0.3, content: { text: { bold: true } } });
  assert.equal(s.gap, 0.3);
  assert.equal(s.content.text.bold, true);
  assert.equal(s.content.text.font, 'helvetica');
  assert.equal(s.margin, DEFAULT_SETTINGS.margin);
});

test('changing units converts lengths', () => {
  const mm = changeUnits(DEFAULT_SETTINGS, 'mm');
  assert.equal(mm.units, 'mm');
  assert.equal(mm.gap, 6.35);
  assert.equal(mm.note.width, 76.2);
  const back = changeUnits(mm, 'in');
  assert.equal(back.note.width, 3);
  assert.equal(back.gap, 0.25);
});
