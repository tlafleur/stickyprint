import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeImage, toGray, threshold, ditherFloydSteinberg, processPixels } from '../src/imageproc.js';

test('placeImage fit (contain) and fill (cover)', () => {
  assert.deepEqual(placeImage(200, 100, 100, 100, 'fit'), { x: 0, y: 25, w: 100, h: 50 });
  assert.deepEqual(placeImage(200, 100, 100, 100, 'fill'), { x: -50, y: 0, w: 200, h: 100 });
});

test('toGray uses luminance and composites alpha over white', () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255]);
  const g = toGray(px);
  assert.ok(Math.abs(g[0] - 0.299 * 255) < 0.01);
  assert.equal(g[1], 255);
  assert.equal(g[2], 0);
});

test('brightness and contrast', () => {
  const px = new Uint8ClampedArray([100, 100, 100, 255]);
  assert.ok(toGray(px, 50)[0] > 100);
  assert.ok(toGray(px, -50)[0] < 100);
  assert.ok(toGray(px, 0, 50)[0] < 100); // below mid-gray gets darker
  assert.equal(toGray(px, 0, 0)[0], 100);
});

test('threshold produces only black and white', () => {
  const out = threshold(Float32Array.from([0, 127, 128, 255]), 128);
  assert.deepEqual([...out], [0, 0, 255, 255]);
});

test('dither of mid-gray is about half black and only 0/255', () => {
  const w = 64;
  const h = 64;
  const out = ditherFloydSteinberg(new Float32Array(w * h).fill(128), w, h);
  const black = out.filter((v) => v === 0).length;
  assert.ok(out.every((v) => v === 0 || v === 255));
  assert.ok(Math.abs(black / (w * h) - 0.5) < 0.05, `black ratio ${black / (w * h)}`);
});

test('processPixels grayscale passes values through', () => {
  const px = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
  assert.deepEqual([...processPixels(px, 2, 1, { mode: 'grayscale' })], [10, 200]);
});
