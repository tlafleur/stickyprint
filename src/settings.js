// Settings model, defaults, unit switching and localStorage persistence.

import { convert, roundFor } from './units.js';

export const STORAGE_KEY = 'stickyprint.settings.v1';

export const DEFAULT_SETTINGS = {
  units: 'in',
  paper: { preset: 'letter', width: 8.5, height: 11 },
  note: { preset: '3x3', width: 3, height: 3, rotate: false },
  gap: 0.25,
  margin: 0.25,
  inset: 0.1,
  // Reserved for printer offset calibration (not exposed in v1).
  offsetX: 0,
  offsetY: 0,
  contentOutline: false,
  previewMode: 'alignment',
  content: {
    type: 'text',
    text: {
      text: 'Hello!\nThis is a sticky note.',
      font: 'helvetica',
      bold: false,
      italic: false,
      align: 'center',
      valign: 'middle',
      manualSize: 0,
    },
    image: {
      fit: 'fit',
      mode: 'grayscale',
      threshold: 128,
      brightness: 0,
      contrast: 0,
    },
  },
};

// Lengths stored in the current unit, converted when units change.
const LENGTH_PATHS = [
  ['paper', 'width'],
  ['paper', 'height'],
  ['note', 'width'],
  ['note', 'height'],
  ['gap'],
  ['margin'],
  ['inset'],
  ['offsetX'],
  ['offsetY'],
];

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Fills missing fields from defaults so older or partial saves still load.
function mergeDefaults(defaults, value) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) {
    return typeof value === typeof defaults ? value : defaults;
  }
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = value && typeof value === 'object' && key in value ? mergeDefaults(defaults[key], value[key]) : clone(defaults[key]);
  }
  return out;
}

export function normalizeSettings(value) {
  return mergeDefaults(DEFAULT_SETTINGS, value || {});
}

export function changeUnits(settings, newUnit) {
  if (settings.units === newUnit) return settings;
  const s = clone(settings);
  for (const path of LENGTH_PATHS) {
    let obj = s;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    const key = path[path.length - 1];
    obj[key] = roundFor(convert(obj[key], settings.units, newUnit), newUnit);
  }
  s.units = newUnit;
  return s;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    // Unavailable or corrupt storage: fall back to defaults.
  }
  return clone(DEFAULT_SETTINGS);
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
