/**
 * BodyPose adapter and gesture logic, with no browser or network dependencies.
 * All returned x/y values are camera coordinates normalized to 0..1.
 *
 * normalizePose(pose, width, height, options?) accepts ml5 BodyPose keypoints (name/x/y/
 * confidence), PoseNet {pose:{keypoints}}, or named leftWrist/rightWrist points.
 * It returns {hands:[{side,x,y,confidence,raised}], shoulders:{left,right,
 * center,width}|null}. shoulders.width is shoulder distance / image width.
 * options.wristConfidence defaults to .2; shoulderConfidence defaults to .3.
 *
 * WaveDetector.update(pose,width,height,nowMs) returns {waving,energy,hands,
 * handY,updatedAt}. updateHands(hands,nowMs,shoulderWidth=0.24) accepts the same
 * normalized hand objects; confidence defaults to 1 and raised to true.
 * The constructor accepts wristConfidence/shoulderConfidence and holdMs (600
 * by default, capped at 650). energy measures tracked wrist movement even
 * below the chest; waving still requires a raised hand and two reversals.
 *
 * SharedPresence.update(local,remote,nowMs) returns {connected,level,mutual,
 * progress}. Both inputs must have waving and a numeric receivedAt or updatedAt
 * in the SAME local monotonic clock domain as nowMs. Stamp received remote
 * packets with performance.now(); never trust the sender's clock for freshness.
 */

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const finite = Number.isFinite;
const canonicalName = (name = '') => String(name).replace(/[_\s-]/g, '').toLowerCase();
const WRIST_CONFIDENCE = 0.2;
const SHOULDER_CONFIDENCE = 0.3;
const confidenceThreshold = (value, fallback) => finite(value) ? clamp(value) : fallback;

function readPoint(pose, name, minimumConfidence) {
  const expected = canonicalName(name);
  const keypoints = Array.isArray(pose.keypoints) ? pose.keypoints : [];
  const point = keypoints.find((entry) => canonicalName(entry.name || entry.part) === expected)
    || pose[name]
    || pose[name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
  if (!point) return null;
  const position = point.position || point;
  const confidence = point.confidence ?? point.score ?? 1;
  if (!finite(position.x) || !finite(position.y) || !finite(confidence) || confidence < minimumConfidence) return null;
  return { x: position.x, y: position.y, confidence: clamp(confidence) };
}

export function normalizePose(input, width, height, { wristConfidence = WRIST_CONFIDENCE, shoulderConfidence = SHOULDER_CONFIDENCE } = {}) {
  const pose = input?.pose || input;
  if (!pose || !finite(width) || !finite(height) || width <= 0 || height <= 0) {
    return { hands: [], shoulders: null };
  }
  const shoulderMinimum = confidenceThreshold(shoulderConfidence, SHOULDER_CONFIDENCE);
  const wristMinimum = confidenceThreshold(wristConfidence, WRIST_CONFIDENCE);
  const left = readPoint(pose, 'leftShoulder', shoulderMinimum);
  const right = readPoint(pose, 'rightShoulder', shoulderMinimum);
  const shoulderDistance = left && right ? Math.hypot(left.x - right.x, left.y - right.y) : width * 0.24;
  const shoulderY = left && right ? (left.y + right.y) / 2 : height * 0.43;
  const normalizePoint = (point) => ({ x: clamp(point.x / width), y: clamp(point.y / height), confidence: point.confidence });
  const shoulders = left && right ? {
    left: normalizePoint(left),
    right: normalizePoint(right),
    center: { x: clamp((left.x + right.x) / (2 * width)), y: clamp(shoulderY / height) },
    width: clamp(shoulderDistance / width, 0.08, 0.65),
  } : null;
  const hands = ['left', 'right'].flatMap((side) => {
    const wrist = readPoint(pose, `${side}Wrist`, wristMinimum);
    if (!wrist) return [];
    return [{ ...normalizePoint(wrist), side, raised: wrist.y <= shoulderY + shoulderDistance * 0.55 }];
  });
  return { hands, shoulders };
}

export class WaveDetector {
  constructor({ holdMs = 600, reversalWindowMs = 1150, wristConfidence = WRIST_CONFIDENCE, shoulderConfidence = SHOULDER_CONFIDENCE } = {}) {
    this.holdMs = clamp(holdMs, 0, 650);
    this.reversalWindowMs = reversalWindowMs;
    this.wristConfidence = confidenceThreshold(wristConfidence, WRIST_CONFIDENCE);
    this.shoulderConfidence = confidenceThreshold(shoulderConfidence, SHOULDER_CONFIDENCE);
    this.reset();
  }

  reset() {
    this.trackers = new Map();
    this.lastUpdate = null;
  }

  update(pose, width, height, nowMs) {
    const normalized = normalizePose(pose, width, height, this);
    return this.updateHands(normalized.hands, nowMs, normalized.shoulders?.width || 0.24);
  }

  updateHands(input, nowMs, shoulderWidth = 0.24) {
    if (!finite(nowMs)) throw new TypeError('WaveDetector needs a finite monotonic timestamp.');
    if (this.lastUpdate !== null && (nowMs < this.lastUpdate || nowMs - this.lastUpdate > 700)) this.reset();
    this.lastUpdate = nowMs;
    const hands = (Array.isArray(input) ? input : []).flatMap((hand, index) => {
      if (!hand || !finite(hand.x) || !finite(hand.y)) return [];
      const confidence = hand.confidence ?? 1;
      if (!finite(confidence) || confidence < this.wristConfidence) return [];
      return [{ side: hand.side || (index ? 'right' : 'left'), x: clamp(hand.x), y: clamp(hand.y), confidence: clamp(confidence), raised: hand.raised !== false }];
    });
    const scale = finite(shoulderWidth) ? clamp(shoulderWidth, 0.08, 0.65) : 0.24;
    // A reversal needs lateral travel of at least 18% of shoulder width.
    const minimumTravel = Math.max(0.012, scale * 0.18);
    const activeSides = new Set();
    let waving = false;
    let energy = 0;

    for (const hand of hands) {
      activeSides.add(hand.side);
      let track = this.trackers.get(hand.side);
      if (!track) {
        track = { x: hand.x, y: hand.y, anchor: hand.x, extreme: hand.x, direction: 0, reversals: [], lastAt: nowMs, lastWaveAt: -Infinity, energy: 0, raised: hand.raised };
        this.trackers.set(hand.side, track);
        continue;
      }
      // Preserve motion energy across raised/lowered transitions, but a lowered
      // hand clears wave history immediately and cannot keep a connection alive.
      if (track.raised !== hand.raised) {
        track.anchor = track.x;
        track.extreme = track.x;
        track.direction = 0;
        track.reversals = [];
        track.lastWaveAt = -Infinity;
        track.raised = hand.raised;
      }
      const elapsed = nowMs - track.lastAt;
      if (elapsed <= 0) {
        waving ||= hand.raised && nowMs - track.lastWaveAt <= this.holdMs;
        energy = Math.max(energy, track.energy);
        continue;
      }
      const smoothing = 1 - Math.exp(-elapsed / 45);
      const oldX = track.x;
      const oldY = track.y;
      track.x += (hand.x - track.x) * smoothing;
      track.y += (hand.y - track.y) * smoothing;
      const speed = Math.hypot(track.x - oldX, track.y - oldY) / scale / (elapsed / 1000);
      track.energy += (clamp(speed / 3.5) - track.energy) * (1 - Math.exp(-elapsed / 130));
      track.lastAt = nowMs;
      track.reversals = track.reversals.filter((time) => nowMs - time <= this.reversalWindowMs);
      energy = Math.max(energy, track.energy);
      if (!hand.raised) continue;

      let reversed = false;
      if (!track.direction) {
        if (Math.abs(track.x - track.anchor) >= minimumTravel) {
          track.direction = Math.sign(track.x - track.anchor);
          track.extreme = track.x;
        }
      } else if (track.direction * (track.x - track.extreme) > 0) {
        track.extreme = track.x;
      } else if (track.direction * (track.extreme - track.x) >= minimumTravel) {
        track.direction *= -1;
        track.extreme = track.x;
        track.reversals.push(nowMs);
        reversed = true;
      }

      // Refresh only on a NEW reversal; old history must not keep a still hand active.
      if (reversed && track.reversals.length >= 2) track.lastWaveAt = nowMs;
      waving ||= nowMs - track.lastWaveAt <= this.holdMs;
    }

    for (const side of this.trackers.keys()) {
      if (!activeSides.has(side)) this.trackers.delete(side);
    }
    return {
      waving,
      energy: clamp(energy),
      hands,
      handY: hands.length ? hands.reduce((total, hand) => total + hand.y, 0) / hands.length : 0.5,
      updatedAt: nowMs,
    };
  }
}

export class SharedPresence {
  constructor({ freshnessMs = 600, buildupMs = 200, fadeMs = 3000 } = {}) {
    this.freshnessMs = freshnessMs;
    this.buildupMs = Math.max(0, buildupMs);
    this.fadeMs = Math.max(1, fadeMs);
    this.reset();
  }

  reset() {
    this.mutualSince = null;
    this.level = 0;
    this.lastUpdate = null;
  }

  update(local, remote, nowMs) {
    if (!finite(nowMs)) throw new TypeError('SharedPresence needs a finite monotonic timestamp.');
    if (this.lastUpdate !== null && nowMs < this.lastUpdate) this.reset();
    const elapsed = this.lastUpdate === null ? 0 : nowMs - this.lastUpdate;
    this.lastUpdate = nowMs;
    const isFreshWave = (state) => {
      if (!state?.waving) return false;
      const timestamp = state.receivedAt ?? state.updatedAt;
      return finite(timestamp) && nowMs >= timestamp && nowMs - timestamp <= this.freshnessMs;
    };
    const mutual = isFreshWave(local) && isFreshWave(remote);
    if (mutual) {
      if (this.mutualSince === null) this.mutualSince = nowMs;
    } else {
      this.mutualSince = null;
    }
    const progress = mutual ? (this.buildupMs === 0 ? 1 : clamp((nowMs - this.mutualSince) / this.buildupMs)) : 0;
    const connected = mutual && progress >= 1;
    if (connected) this.level = Math.min(1, this.level + elapsed / 400);
    else this.level = Math.max(0, this.level - elapsed / this.fadeMs);
    return { connected, level: this.level, mutual, progress };
  }
}
