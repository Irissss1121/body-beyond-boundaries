import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMotionDetector } from '../dist/motion.js';

const width = 80, height = 60;
function frame(brightness = 60) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = rgba[index + 1] = rgba[index + 2] = brightness;
    rgba[index + 3] = 255;
  }
  return rgba;
}
function rectangle(rgba, x, y, w = 16, h = 12, brightness = 220) {
  const result = rgba.slice();
  for (let row = y; row < y + h; row++) {
    for (let column = x; column < x + w; column++) {
      const index = (row * width + column) * 4;
      result[index] = result[index + 1] = result[index + 2] = brightness;
    }
  }
  return result;
}

test('first and stationary camera frames never report movement', () => {
  const detector = new FrameMotionDetector();
  const still = rectangle(frame(), 25, 20);
  for (let index = 0; index < 50; index++) {
    const state = detector.update(still, index * 50);
    assert.equal(state.moving, false);
    assert.equal(state.energy, 0);
    assert.equal(state.activity, 0);
  }
});

test('a moving rectangle produces immediate motion and a vertical centroid', () => {
  const detector = new FrameMotionDetector();
  detector.update(rectangle(frame(), 10, 38), 0);
  const moved = detector.update(rectangle(frame(), 24, 38), 50);
  assert.equal(moved.moving, true);
  assert.ok(moved.activity >= 0.02 && moved.activity <= 1);
  assert.ok(moved.energy > 0.4 && moved.energy <= 1);
  assert.ok(moved.handY > 0.7 && moved.handY < 0.8);
  assert.equal(moved.updatedAt, 50);
});

test('uniform room brightness changes are removed from frame differences', () => {
  const detector = new FrameMotionDetector();
  detector.update(frame(40), 0);
  for (const [index, brightness] of [90, 130, 65, 35].entries()) {
    const state = detector.update(frame(brightness), (index + 1) * 50);
    assert.equal(state.moving, false);
    assert.equal(state.activity, 0);
    assert.equal(state.energy, 0);
  }
});

test('one-to-three luma camera noise does not count as movement', () => {
  const detector = new FrameMotionDetector();
  detector.update(frame(100), 0);
  for (let iteration = 1; iteration <= 20; iteration++) {
    const noisy = frame(100);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const noise = ((pixel * 17 + iteration * 3) % 7) - 3;
      noisy[pixel * 4] += noise;
      noisy[pixel * 4 + 1] += noise;
      noisy[pixel * 4 + 2] += noise;
    }
    const state = detector.update(noisy, iteration * 50);
    assert.equal(state.moving, false);
    assert.equal(state.energy, 0);
  }
});

test('still frames let motion expire within 600ms and energy steadily fade', () => {
  const detector = new FrameMotionDetector();
  const moved = rectangle(frame(), 35, 25);
  detector.update(frame(), 0);
  const active = detector.update(moved, 50);
  assert.equal(active.moving, true);
  const held = detector.update(moved, 350);
  assert.equal(held.moving, true);
  assert.ok(held.energy > 0 && held.energy < active.energy);
  const stopped = detector.update(moved, 500);
  assert.equal(stopped.moving, false);
  assert.ok(stopped.energy > 0 && stopped.energy < held.energy);
  assert.equal(stopped.activity, 0);
});

test('activity threshold is configurable and reset removes old held movement', () => {
  const strict = new FrameMotionDetector({ activityThreshold: 0.1 });
  strict.update(frame(), 0);
  assert.equal(strict.update(rectangle(frame(), 30, 25), 50).moving, false);
  const sensitive = new FrameMotionDetector({ activityThreshold: 0.01 });
  sensitive.update(frame(), 0);
  assert.equal(sensitive.update(rectangle(frame(), 30, 25), 50).moving, true);
  sensitive.reset();
  const first = sensitive.update(rectangle(frame(), 10, 40), 60);
  assert.equal(first.moving, false);
  assert.equal(first.energy, 0);
  assert.equal(first.handY, 0.5);
});

test('invalid timestamps and mismatched RGBA arrays throw clear errors', () => {
  const detector = new FrameMotionDetector();
  assert.throws(() => detector.update(frame(), NaN), TypeError);
  assert.throws(() => detector.update(frame(), Infinity), TypeError);
  assert.throws(() => detector.update(new Uint8Array(4), 0), TypeError);
  assert.throws(() => detector.update(null, 0), TypeError);
  const invalid = Array.from(frame());
  invalid[5] = NaN;
  assert.throws(() => detector.update(invalid, 0), TypeError);
  assert.throws(() => new FrameMotionDetector({ width: 0 }), TypeError);
});
