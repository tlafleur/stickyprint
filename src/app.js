// UI wiring: form ⇄ settings, preview rendering, PDF downloads.

import { computeLayout, PAPER_PRESETS, NOTE_PRESETS } from './layout.js';
import { convert, fromPt, roundFor, formatLength } from './units.js';
import { loadSettings, saveSettings, changeUnits } from './settings.js';
import { buildAlignmentPage, buildContentPage } from './sheet.js';
import { renderPdf } from './render-pdf.js';
import { renderCanvas } from './render-canvas.js';
import { renderNoteImage } from './imageproc.js';

const { jsPDF } = window.jspdf;
const IMAGE_KEY = 'note-image';

const form = document.getElementById('controls');
const $ = (id) => document.getElementById(id);

let settings = loadSettings();
const measureDoc = new jsPDF({ unit: 'pt' });

// Image state lives only in memory.
const imageState = { img: null, name: '', canvas: null, cacheKey: '' };

// ---------- settings ⇄ form ----------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function writeForm() {
  for (const el of form.querySelectorAll('[data-path]')) writeField(el);
  for (const el of document.querySelectorAll('.preview [data-path]')) writeField(el);
  const step = settings.units === 'mm' ? '0.5' : '0.01';
  for (const el of form.querySelectorAll('[data-length]')) el.step = step;
  for (const el of document.querySelectorAll('.unit')) el.textContent = `(${settings.units})`;
}

function writeField(el) {
  const v = getPath(settings, el.dataset.path);
  if (el.type === 'radio') el.checked = el.value === v;
  else if (el.type === 'checkbox') el.checked = !!v;
  else if (el.id === 'manual-size') el.value = v > 0 ? v : '';
  else el.value = v;
}

function readField(el) {
  if (el.type === 'radio') return el.checked ? el.value : undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') {
    const n = parseFloat(el.value);
    return Number.isFinite(n) ? n : 0;
  }
  return el.value;
}

// When switching a preset to custom, start from the preset's size.
function presetToCustom(kind, presets, oldPreset) {
  const p = presets[oldPreset];
  if (!p) return;
  settings[kind].width = roundFor(convert(p.width, p.unit, settings.units), settings.units);
  settings[kind].height = roundFor(convert(p.height, p.unit, settings.units), settings.units);
}

function onInput(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.path) return;
  const value = readField(el);
  if (value === undefined) return;
  const path = el.dataset.path;
  if (path === 'units') {
    settings = changeUnits(settings, value);
    writeForm();
  } else {
    const old = getPath(settings, path);
    setPath(settings, path, value);
    if (path === 'paper.preset' && value === 'custom') presetToCustom('paper', PAPER_PRESETS, old);
    if (path === 'note.preset' && value === 'custom') presetToCustom('note', NOTE_PRESETS, old);
    if (path.endsWith('.preset')) writeForm();
  }
  saveSettings(settings);
  scheduleUpdate();
}

form.addEventListener('input', onInput);
document.querySelector('.preview').addEventListener('input', onInput);

$('image-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    imageState.img = img;
    imageState.name = file.name;
    imageState.cacheKey = '';
    scheduleUpdate();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("That file couldn't be read as an image.");
  };
  img.src = url;
});

// ---------- building sheets ----------

function contentSpec() {
  if (settings.content.type === 'image') {
    return imageState.canvas ? { type: 'image', key: IMAGE_KEY } : null;
  }
  return { type: 'text', ...settings.content.text };
}

function updateImage(layout) {
  if (settings.content.type !== 'image' || !imageState.img || layout.count === 0) return;
  const box = layout.notes[0].content;
  if (box.w <= 0 || box.h <= 0) return;
  const opts = settings.content.image;
  const key = JSON.stringify([imageState.name, imageState.img.src, box.w, box.h, opts]);
  if (key === imageState.cacheKey) return;
  imageState.canvas = renderNoteImage(imageState.img, box.w, box.h, opts);
  imageState.cacheKey = key;
}

function images() {
  return imageState.canvas ? new Map([[IMAGE_KEY, imageState.canvas]]) : new Map();
}

function build() {
  const layout = computeLayout(settings);
  updateImage(layout);
  const spec = contentSpec();
  const alignment = buildAlignmentPage(layout, measureDoc, { units: settings.units });
  const content = buildContentPage(layout, measureDoc, () => spec, { outline: settings.contentOutline });
  return { layout, alignment, content };
}

// ---------- preview ----------

function sizeCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  return dpr;
}

function drawGuides(ctx, layout, view, { outlines, inset }) {
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, -view.originX * view.scale, -view.originY * view.scale);
  ctx.setLineDash([4 / view.scale, 3 / view.scale]);
  ctx.lineWidth = 1 / view.scale;
  for (const n of layout.notes) {
    if (outlines) {
      ctx.strokeStyle = 'rgba(0, 90, 200, 0.45)';
      ctx.strokeRect(n.x, n.y, n.w, n.h);
    }
    if (inset && n.content.w > 0) {
      ctx.strokeStyle = 'rgba(0, 90, 200, 0.6)';
      ctx.strokeRect(n.content.x, n.content.y, n.content.w, n.content.h);
    }
  }
  ctx.restore();
}

function drawPreview(state) {
  const { layout } = state;
  const mode = settings.previewMode;
  const page = mode === 'content' ? state.content : state.alignment;
  const imgs = images();

  // Whole sheet.
  const sheetCanvas = $('sheet-canvas');
  const wrap = sheetCanvas.parentElement;
  const maxW = wrap.clientWidth - 24; // minus .sheet-wrap padding
  const maxH = Math.max(320, window.innerHeight - 140);
  const fit = Math.min(maxW / layout.pageW, maxH / layout.pageH);
  const cssW = Math.floor(layout.pageW * fit);
  const cssH = Math.floor(layout.pageH * fit);
  const dpr = sizeCanvas(sheetCanvas, cssW, cssH);
  const ctx = sheetCanvas.getContext('2d');
  const view = { scale: fit * dpr, originX: 0, originY: 0 };
  renderCanvas(ctx, page, imgs, view);
  if (mode === 'content' && !settings.contentOutline) drawGuides(ctx, layout, view, { outlines: true });
  // Printer margin, preview only.
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
  ctx.strokeStyle = 'rgba(200, 60, 0, 0.35)';
  ctx.setLineDash([2 / view.scale, 3 / view.scale]);
  ctx.lineWidth = 1 / view.scale;
  const p = layout.printable;
  if (p.w > 0 && p.h > 0) ctx.strokeRect(p.x, p.y, p.w, p.h);
  ctx.restore();

  // One note, enlarged.
  const noteCanvas = $('note-canvas');
  const noteWrap = noteCanvas.parentElement;
  if (layout.count === 0) {
    sizeCanvas(noteCanvas, 1, 1);
    return;
  }
  const n = layout.notes[0];
  const pad = 12;
  const boxW = Math.min(noteWrap.clientWidth, 360);
  const nfit = Math.min((boxW - 2) / (n.w + 2 * pad), 360 / (n.h + 2 * pad));
  const ncssW = Math.floor((n.w + 2 * pad) * nfit);
  const ncssH = Math.floor((n.h + 2 * pad) * nfit);
  const ndpr = sizeCanvas(noteCanvas, ncssW, ncssH);
  const nctx = noteCanvas.getContext('2d');
  const nview = { scale: nfit * ndpr, originX: n.x - pad, originY: n.y - pad };
  nctx.fillStyle = '#fff';
  nctx.fillRect(0, 0, noteCanvas.width, noteCanvas.height);
  // Render only this note's area: the page ops are clipped by the canvas.
  renderCanvas(nctx, page, imgs, nview);
  drawGuides(nctx, { notes: [n] }, nview, { outlines: mode === 'content' && !settings.contentOutline, inset: true });
}

// ---------- status text ----------

function updateStatus(state) {
  const { layout, content } = state;
  const u = settings.units;
  $('paper-custom').hidden = settings.paper.preset !== 'custom';
  $('note-custom').hidden = settings.note.preset !== 'custom';
  $('note-dims').textContent = layout.noteW > 0 ? `(${formatLength(fromPt(layout.noteW, u), u)} wide × ${formatLength(fromPt(layout.noteH, u), u)} tall)` : '';
  $('paper-info').textContent = `${formatLength(fromPt(layout.pageW, u), u)} × ${formatLength(fromPt(layout.pageH, u), u)}`;

  $('count').textContent = layout.count === 1 ? '1 note per sheet' : `${layout.count} notes per sheet`;
  $('layout-warnings').replaceChildren(
    ...layout.warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })),
  );

  const isText = settings.content.type === 'text';
  $('text-controls').hidden = !isText;
  $('image-controls').hidden = isText;
  $('threshold-field').hidden = settings.content.image.mode !== 'threshold';
  $('threshold-out').textContent = settings.content.image.threshold;
  $('brightness-out').textContent = settings.content.image.brightness;
  $('contrast-out').textContent = settings.content.image.contrast;

  const fitInfo = $('fit-info');
  fitInfo.classList.remove('bad');
  const r = content.results.find((x) => x && x.lines);
  if (!isText) fitInfo.textContent = '';
  else if (!r || !r.lines.length) fitInfo.textContent = layout.count ? 'Enter some text.' : '';
  else if (r.auto) fitInfo.textContent = `Auto-fit: ${r.size} pt`;
  else {
    fitInfo.textContent = r.fits ? `Using ${r.size} pt` : `${r.size} pt doesn't fit the note`;
    if (!r.fits) fitInfo.classList.add('bad');
  }

  const noImage = !isText && !imageState.canvas;
  $('dl-alignment').disabled = layout.count === 0;
  $('dl-content').disabled = layout.count === 0 || noImage;
  $('dl-content').title = noImage ? 'Choose an image first' : '';
}

// ---------- downloads ----------

function fileTag() {
  const paper = settings.paper.preset === 'custom' ? 'custom' : settings.paper.preset;
  const note = settings.note.preset === 'custom' ? 'custom' : settings.note.preset + (settings.note.rotate ? 'r' : '');
  return `${paper}-${note}`;
}

$('dl-alignment').addEventListener('click', () => {
  const { alignment } = build();
  renderPdf(jsPDF, [alignment]).save(`sticky-alignment-${fileTag()}.pdf`);
});

$('dl-content').addEventListener('click', () => {
  const { content } = build();
  renderPdf(jsPDF, [content], images()).save(`sticky-content-${fileTag()}.pdf`);
});

// ---------- update loop ----------

let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const state = build();
    updateStatus(state);
    drawPreview(state);
  });
}

window.addEventListener('resize', scheduleUpdate);
writeForm();
scheduleUpdate();
