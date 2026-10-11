/**
 * Local camera-frame motion, independent of pose models or recognized gestures.
 *
 * new FrameMotionDetector({width=80,height=60,pixelThreshold=12,
 *   activityThreshold=.02,holdMs=400,energyDecayMs=350})
 * update(rgba,nowMs) accepts width*height*4 numeric RGBA channels (0..255),
 * such as ImageData.data. nowMs uses the local performance.now() clock.
 * Returns {moving,energy,activity,handY,updatedAt}; activity is the changed
 * pixel fraction. handY is the vertical movement centroid, not a body landmark.
 * The first frame establishes the baseline and never reports movement.
 * reset() clears the baseline, motion hold, centroid, and residual energy.
 */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const finite = Number.isFinite;

export class FrameMotionDetector {
  constructor({ width = 80, height = 60, pixelThreshold = 12, activityThreshold = 0.02, holdMs = 400, energyDecayMs = 350 } = {}) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || !finite(pixelThreshold) || pixelThreshold <= 0 || pixelThreshold > 255
      || !finite(activityThreshold) || activityThreshold <= 0 || activityThreshold > 1
      || !finite(holdMs) || holdMs < 0 || holdMs > 650
      || !finite(energyDecayMs) || energyDecayMs <= 0) {
      throw new TypeError('Motion detector dimensions and thresholds must be valid positive numbers; holdMs is 0..650.');
    }
    this.width = width;
    this.height = height;
    this.pixelThreshold = pixelThreshold;
    this.activityThreshold = activityThreshold;
    this.holdMs = holdMs;
    this.energyDecayMs = energyDecayMs;
    this.pixelCount = width * height;
    this.previous = new Float32Array(this.pixelCount);
    this.current = new Float32Array(this.pixelCount);
    this.reset();
  }

  reset() {
    this.initialized = false;
    this.lastUpdate = null;
    this.lastMotionAt = -Infinity;
    this.energy = 0;
    this.handY = 0.5;
  }

  update(rgba, nowMs) {
    if (!finite(nowMs)) throw new TypeError('Frame motion needs a finite monotonic timestamp.');
    if (!rgba || rgba.length !== this.pixelCount * 4) {
      throw new TypeError(`Frame motion needs exactly ${this.pixelCount * 4} RGBA channels.`);
    }
    if (this.lastUpdate !== null && nowMs < this.lastUpdate) this.reset();
    let signedTotal = 0;
    for (let pixel = 0; pixel < this.pixelCount; pixel++) {
      const offset = pixel * 4;
      const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2], a = rgba[offset + 3];
      if (![r, g, b, a].every(channel => finite(channel) && channel >= 0 && channel <= 255)) {
        throw new TypeError('RGBA channels must be finite numbers between 0 and 255.');
      }
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      this.current[pixel] = luma;
      if (this.initialized) signedTotal += luma - this.previous[pixel];
    }

    const elapsed = this.lastUpdate === null ? 0 : nowMs - this.lastUpdate;
    let activity = 0;
    if (this.initialized) {
      // Subtract the signed global change so exposure/room-brightness shifts
      // do not masquerade as simultaneous participant movement.
      const globalChange = signedTotal / this.pixelCount;
      let changed = 0;
      let intensityTotal = 0;
      let weightedY = 0;
      for (let pixel = 0; pixel < this.pixelCount; pixel++) {
        const difference = Math.abs(this.current[pixel] - this.previous[pixel] - globalChange);
        if (difference < this.pixelThreshold) continue;
        changed++;
        intensityTotal += difference;
        weightedY += ((Math.floor(pixel / this.width) + 0.5) / this.height) * difference;
      }
      activity = changed / this.pixelCount;
      this.energy *= Math.exp(-elapsed / this.energyDecayMs);
      if (activity >= this.activityThreshold) {
        this.lastMotionAt = nowMs;
        this.handY = clamp(weightedY / intensityTotal);
        const areaLevel = clamp(activity / Math.max(this.activityThreshold * 6, this.activityThreshold));
        const contrastLevel = clamp((intensityTotal / changed) / 70);
        // Respond in the current frame; residual light decays without extending
        // the boolean motion hold when later frames are still.
        this.energy = Math.max(this.energy, Math.sqrt(areaLevel) * contrastLevel);
      }
    }
    this.initialized = true;
    this.lastUpdate = nowMs;
    [this.previous, this.current] = [this.current, this.previous];
    return {
      moving: nowMs - this.lastMotionAt <= this.holdMs,
      energy: clamp(this.energy),
      activity: clamp(activity),
      handY: clamp(this.handY),
      updatedAt: nowMs,
    };
  }
}
