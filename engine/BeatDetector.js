/**
 * engine/BeatDetector.js
 * Energy-based onset detection for beat tracking.
 * Compares current bass energy against a short-term average.
 * When energy spikes above threshold, fires a beat event.
 * Also maintains a rolling BPM estimate.
 *
 * Usage:
 *   const bd = new BeatDetector();
 *   bd.onBeat = ({ bpm, confidence }) => { ... };
 *   // every frame:
 *   bd.update(audioEngine.smoothed, audioEngine._dataArray);
 */

class BeatDetector {

  constructor() {
    // Config
    this.threshold    = 1.35;   // energy must be this × average to trigger
    this.minInterval  = 280;    // ms — minimum time between beats (≈214 BPM max)
    this.historySize  = 43;     // frames of energy history (~700ms at 60fps)

    // State
    this._energyHistory = [];
    this._lastBeatMs    = 0;
    this._beatIntervals = [];   // recent inter-beat intervals for BPM calc
    this._maxIntervals  = 8;

    // Output
    this.bpm        = 0;
    this.confidence = 0;        // 0–1, how consistent the beat intervals are
    this.isBeat     = false;    // true for exactly one frame on each beat
    this._beatFrame = false;

    // Callback
    this.onBeat = null;         // called with { bpm, confidence, energy }
  }

  // ── Per-frame update ─────────────────────────────────────────

  /**
   * @param {object} smoothed  — audioEngine.smoothed
   * @param {Uint8Array} fftData — raw FFT array (optional, improves accuracy)
   */
  update(smoothed, fftData) {
    // Reset single-frame beat flag
    this.isBeat = false;

    if (!smoothed?.isActive) return;

    // Use bass + low-mid energy for beat detection
    // If we have raw FFT data use it, otherwise use smoothed bass
    let energy;
    if (fftData && fftData.length > 0) {
      energy = this._rawBassEnergy(fftData);
    } else {
      energy = smoothed.bass * 0.7 + smoothed.mid * 0.3;
    }

    // Maintain energy history
    this._energyHistory.push(energy);
    if (this._energyHistory.length > this.historySize) {
      this._energyHistory.shift();
    }

    if (this._energyHistory.length < 10) return;

    // Local average energy
    const avg = this._energyHistory.reduce((a, b) => a + b, 0) / this._energyHistory.length;

    // Beat condition: energy spike + time gate
    const now      = performance.now();
    const elapsed  = now - this._lastBeatMs;
    const isBeat   = energy > avg * this.threshold && elapsed > this.minInterval && avg > 0.02;

    if (isBeat) {
      this.isBeat     = true;
      this._beatFrame = true;

      // Record interval for BPM
      if (this._lastBeatMs > 0) {
        this._beatIntervals.push(elapsed);
        if (this._beatIntervals.length > this._maxIntervals) {
          this._beatIntervals.shift();
        }
        this._updateBPM();
      }

      this._lastBeatMs = now;

      if (typeof this.onBeat === 'function') {
        this.onBeat({ bpm: this.bpm, confidence: this.confidence, energy });
      }
    }
  }

  // ── BPM calculation ──────────────────────────────────────────

  _updateBPM() {
    if (this._beatIntervals.length < 2) return;

    const avg = this._beatIntervals.reduce((a, b) => a + b, 0) / this._beatIntervals.length;
    const rawBpm = 60000 / avg;

    // Keep BPM in a sensible folk/rock range — 50–200 BPM
    let bpm = rawBpm;
    while (bpm > 200) bpm /= 2;
    while (bpm < 50)  bpm *= 2;

    this.bpm = Math.round(bpm);

    // Confidence — how consistent are the intervals?
    const variance = this._beatIntervals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / this._beatIntervals.length;
    const stdDev   = Math.sqrt(variance);
    // Low stdDev relative to avg = high confidence
    this.confidence = VaelMath.clamp(1 - (stdDev / avg) * 2, 0, 1);
  }

  // ── Raw FFT bass energy ──────────────────────────────────────

  _rawBassEnergy(fftData) {
    // Sum the first ~10% of FFT bins (bass frequencies)
    const end = Math.floor(fftData.length * 0.1);
    let sum = 0;
    for (let i = 0; i < end; i++) sum += fftData[i];
    return sum / (end * 255);
  }

  // ── Reset ────────────────────────────────────────────────────

  reset() {
    this._energyHistory = [];
    this._beatIntervals = [];
    this._lastBeatMs    = 0;
    this.bpm            = 0;
    this.confidence     = 0;
    this.isBeat         = false;
  }
}
