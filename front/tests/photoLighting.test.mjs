import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLighting, sampleLighting } from '../src/features/enrollments/photoLighting.ts';

function image(value, width = 20, height = 20) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([value, value, value, 255], i);
  return pixels;
}

test('detects a dark image', () => {
  const result = calculateLighting(image(20), 20, 20);
  assert.equal(result.sufficient, false);
  assert.equal(result.darkFraction, 1);
});

test('accepts normally lit images without requiring a white background', () => {
  assert.equal(calculateLighting(image(85), 20, 20).sufficient, true);
  assert.equal(calculateLighting(image(200), 20, 20).sufficient, true);
});

test('bright background cannot hide a dark central subject', () => {
  const pixels = image(220);
  for (let y = 4; y < 16; y++) for (let x = 5; x < 15; x++) pixels.set([20, 20, 20, 255], (y * 20 + x) * 4);
  const result = calculateLighting(pixels, 20, 20);
  assert.ok(result.mean > 150);
  assert.equal(result.sufficient, false);
  assert.ok(result.centerMean < 50);
});

test('majority of dark pixels is detected even with a lit center', () => {
  const pixels = image(5);
  for (let y = 4; y < 16; y++) for (let x = 5; x < 15; x++) pixels.set([255, 255, 255, 255], (y * 20 + x) * 4);
  const result = calculateLighting(pixels, 20, 20);
  assert.ok(result.mean >= 55);
  assert.ok(result.centerMean > 200);
  assert.equal(result.sufficient, false);
});

test('transparent pixels use the white display background', () => {
  assert.equal(calculateLighting(new Uint8ClampedArray(20 * 20 * 4), 20, 20).sufficient, true);
});

test('rejects empty and incomplete pixel buffers', () => {
  assert.throws(() => calculateLighting([], 0, 0));
  assert.throws(() => calculateLighting([0, 0, 0, 255], 20, 20));
});

test('samples a bounded canvas without decoding full-size pixel buffers', () => {
  const context = {
    drawImage() {},
    getImageData: (_x, _y, width, height) => ({ data: image(100, width, height) }),
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  assert.equal(sampleLighting({}, 4000, 3000, canvas).sufficient, true);
  assert.equal(canvas.width, 160);
  assert.equal(canvas.height, 120);
});

test('unavailable frames and unsupported canvas fail clearly', () => {
  assert.throws(() => sampleLighting({}, 0, 0, {}));
  assert.throws(() => sampleLighting({}, 160, 120, { getContext: () => null }));
});
