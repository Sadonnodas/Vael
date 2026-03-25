/**
 * utils/math.js
 * Pure mathematical utility functions used across Vael.
 * No dependencies. No side effects.
 */

const VaelMath = (() => {

  // ── Basic ────────────────────────────────────────────────────

  /** Linear interpolation between a and b by factor t (0–1) */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Clamp value x between min and max */
  function clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  /** Map value from one range to another */
  function map(value, inMin, inMax, outMin, outMax) {
    const t = (value - inMin) / (inMax - inMin);
    return outMin + t * (outMax - outMin);
  }

  /** Map and clamp */
  function mapClamp(value, inMin, inMax, outMin, outMax) {
    return clamp(map(value, inMin, inMax, outMin, outMax), outMin, outMax);
  }

  // ── Easing ───────────────────────────────────────────────────

  function easeInQuad(t)  { return t * t; }
  function easeOutQuad(t) { return t * (2 - t); }
  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function easeInCubic(t)  { return t * t * t; }
  function easeOutCubic(t) { return (--t) * t * t + 1; }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  /** Simple spring-like smooth step */
  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  // ── Rolling range normaliser ─────────────────────────────────
  /**
   * Tracks the observed min/max of a signal over time and normalises
   * the current value within that range. This means even a quiet,
   * compressed signal uses the full 0–1 output range.
   *
   * Usage:
   *   const norm = new RollingNormaliser({ decay: 0.002, sensitivity: 1.5 });
   *   const output = norm.push('bass', rawBassValue);
   */
  class RollingNormaliser {
    constructor({ decay = 0.002, sensitivity = 1.0 } = {}) {
      this.decay       = decay;
      this.sensitivity = sensitivity;
      this._min = {};
      this._max = {};
    }

    push(key, raw) {
      const prevMin = this._min[key] ?? raw;
      const prevMax = this._max[key] ?? raw;

      // Slowly relax the window back toward the current value
      this._min[key] = Math.min(prevMin + this.decay, raw);
      this._max[key] = Math.max(prevMax - this.decay, raw);

      const range = this._max[key] - this._min[key];

      // Signal too flat — return 0 so visuals start from nothing
      if (range < 0.01) return 0;

      const normalised = (raw - this._min[key]) / range;

      // Amplify deviation from centre using sensitivity
      const amplified = 0.5 + (normalised - 0.5) * this.sensitivity;
      return clamp(amplified, 0, 1);
    }

    reset() {
      this._min = {};
      this._max = {};
    }
  }

  // ── Angle ────────────────────────────────────────────────────

  function degToRad(deg) { return deg * Math.PI / 180; }
  function radToDeg(rad) { return rad * 180 / Math.PI; }

  /** Wrap an angle in radians to [0, 2π] */
  function wrapAngle(a) {
    while (a < 0)           a += Math.PI * 2;
    while (a > Math.PI * 2) a -= Math.PI * 2;
    return a;
  }

  // ── Time formatting ──────────────────────────────────────────

  /** Format seconds as M:SS */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ── Random ───────────────────────────────────────────────────

  /** Random float between min and max */
  function randFloat(min, max) {
    return min + Math.random() * (max - min);
  }

  /** Random integer between min (inclusive) and max (exclusive) */
  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min));
  }

  // ── Perlin noise (simple 2D implementation) ──────────────────
  // Used by NoiseFieldLayer without requiring a shader

  const _permTable = (() => {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p];
  })();

  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function _grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  function noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = _fade(x), v = _fade(y);
    const a  = _permTable[X]   + Y;
    const b  = _permTable[X+1] + Y;
    return lerp(
      lerp(_grad(_permTable[a],   x,   y  ), _grad(_permTable[b],   x-1, y  ), u),
      lerp(_grad(_permTable[a+1], x,   y-1), _grad(_permTable[b+1], x-1, y-1), u),
      v
    );
  }

  /** Fractional brownian motion — layered noise, more organic */
  function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let value     = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      value     += amplitude * noise2D(x * frequency, y * frequency);
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value;
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    lerp, clamp, map, mapClamp,
    easeInQuad, easeOutQuad, easeInOutQuad,
    easeInCubic, easeOutCubic, easeInOutCubic,
    smoothstep,
    RollingNormaliser,
    degToRad, radToDeg, wrapAngle,
    formatTime,
    randFloat, randInt,
    noise2D, fbm,
  };

})();
