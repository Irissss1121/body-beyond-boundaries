import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePose, SharedPresence, WaveDetector } from '../dist/gesture.js';

const hand = (x, extra = {}) => [{ side: 'left', x, y: 0.25, confidence: 0.95, raised: true, ...extra }];
const wave = (detector, start = 0, side = 'left') => {
  let state;
  for (let index = 0; index <= 36; index++) {
    const x = 0.5 + 0.15 * Math.sin(index * Math.PI / 6);
    state = detector.updateHands(hand(x, { side }), start + index * 50);
  }
  return state;
};

test('normalizes current ml5 keypoints and rejects low-confidence wrists', () => {
  const pose = { keypoints: [
    { name: 'left_shoulder', x: 220, y: 210, confidence: 0.8 },
    { name: 'right_shoulder', x: 420, y: 210, confidence: 0.9 },
    { name: 'left_wrist', x: 160, y: 80, confidence: 0.9 },
    { name: 'right_wrist', x: 540, y: 370, confidence: 0.2 },
  ] };
  const result = normalizePose(pose, 640, 480);
  assert.equal(result.hands.length, 1);
  assert.equal(result.hands[0].x, 0.25);
  assert.equal(result.hands[0].raised, true);
  assert.equal(result.shoulders.width, 200 / 640);
  assert.deepEqual(normalizePose(null, 640, 480), { hands: [], shoulders: null });
});

test('a stationary raised hand and one-way movement never count as waving', () => {
  const detector = new WaveDetector();
  for (let index = 0; index < 60; index++) {
    const state = detector.updateHands(hand(0.5), index * 50);
    assert.equal(state.waving, false);
  }
  detector.reset();
  for (let index = 0; index < 30; index++) {
    const state = detector.updateHands(hand(0.25 + index * 0.01), index * 50);
    assert.equal(state.waving, false);
  }
});

test('repeated lateral waving is detected for either hand, and stops within 650ms', () => {
  for (const side of ['left', 'right']) {
    const detector = new WaveDetector();
    const state = wave(detector, 0, side);
    assert.equal(state.waving, true);
    assert.ok(state.energy > 0.2 && state.energy <= 1);
    let stopped;
    for (let index = 1; index <= 14; index++) {
      stopped = detector.updateHands(hand(0.5, { side }), 1800 + index * 50);
    }
    assert.equal(stopped.waving, false);
  }
});

test('small tracking jitter, lowered hands, missing pose and weak confidence do not wave', () => {
  const detector = new WaveDetector();
  for (let index = 0; index < 60; index++) {
    const state = detector.updateHands(hand(0.5 + (index % 2 ? 0.006 : -0.006)), index * 50);
    assert.equal(state.waving, false);
  }
  for (let index = 0; index < 30; index++) {
    assert.equal(detector.updateHands(hand(0.5 + 0.15 * Math.sin(index), { raised: false }), 3000 + index * 50).waving, false);
  }
  detector.reset();
  assert.equal(wave(detector).waving, true);
  assert.equal(detector.updateHands([], 1850).waving, false);
  assert.equal(detector.updateHands(hand(0.6, { confidence: 0.2 }), 1900).waving, false);
  assert.equal(detector.update(null, 640, 480, 1950).hands.length, 0);
});

test('connection requires two fresh waves sustained for 200ms', () => {
  const presence = new SharedPresence();
  const fresh = (waving, time) => ({ waving, updatedAt: time });
  assert.equal(presence.update(fresh(true, 0), fresh(false, 0), 0).connected, false);
  assert.equal(presence.update(fresh(false, 100), fresh(true, 100), 100).connected, false);
  assert.equal(presence.update(fresh(true, 200), fresh(true, 200), 200).connected, false);
  assert.equal(presence.update(fresh(true, 350), fresh(true, 350), 350).connected, false);
  const connected = presence.update(fresh(true, 400), fresh(true, 400), 400);
  assert.equal(connected.connected, true);
  assert.equal(connected.mutual, true);
  assert.ok(connected.level > 0);
  const stopped = presence.update(fresh(false, 450), fresh(true, 450), 450);
  assert.equal(stopped.connected, false);
  assert.ok(stopped.level < connected.level && stopped.level > 0);
  assert.equal(presence.update(fresh(false, 4000), fresh(false, 4000), 4000).level, 0);
});

test('stale, missing, future and sender-clock timestamps cannot connect', () => {
  const presence = new SharedPresence({ buildupMs: 0 });
  const local = { waving: true, updatedAt: 1000 };
  for (const remote of [
    null,
    { waving: true },
    { waving: true, receivedAt: 0 },
    { waving: true, receivedAt: 399 },
    { waving: true, receivedAt: 1100 },
    { waving: true, receivedAt: 0, updatedAt: 1000 },
  ]) {
    assert.equal(presence.update(local, remote, 1000).connected, false);
  }
  assert.equal(presence.update(local, { waving: true, receivedAt: 1000 }, 1000).connected, true);
  assert.equal(presence.update({ waving: true, updatedAt: 1701 }, { waving: true, receivedAt: 1000 }, 1701).connected, false);
});

test('timestamp zero is valid only when supplied and fresh; loss interrupts buildup', () => {
  const presence = new SharedPresence();
  assert.equal(presence.update({ waving: true, updatedAt: 0 }, { waving: true, receivedAt: 0 }, 0).mutual, true);
  presence.update({ waving: true, updatedAt: 150 }, { waving: false, receivedAt: 150 }, 150);
  assert.equal(presence.update({ waving: true, updatedAt: 200 }, { waving: true, receivedAt: 200 }, 200).progress, 0);
  assert.equal(presence.update({ waving: true, updatedAt: 350 }, { waving: true, receivedAt: 350 }, 350).connected, false);
});
