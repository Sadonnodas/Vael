/**
 * engine/BeatDetector.js
 * Energy-based onset detection with bar and phrase tracking.
 *
 * NEW — phrase/bar tracking:
 * Once BPM is established (confidence > 0.5), beats are counted into bars
 * (4 beats = 1 bar) and bars into phrases (4 bars = 1 phrase).
 *
 * New output properties:
 *   bd.beat      — 1-4, which beat within the current bar
 *   bd.bar       — 1-4, which bar within the current phrase
 *   bd.phrase    — 1+, which phrase since tracking started
 *   bd.isDownbeat  — true on beat 1 of each bar
 *   bd.isBarOne    — true on bar 1 of each phrase
 *
 * These are available on audioData in App.js as audioData.beat etc.,
 * and can be used in ModMatrix routes and layer update() methods.
 *
 * Usage (unchanged):
 *   bd.update(audioEngine.smoothed, audioEngine._dataArray);
 */

class BeatDetector {

  constructor() {
    // Config
    this.threshold   = 1.35;
    this.minInterval = 280;
    this.historySize = 43;

    // State
    this._energyHistory = [];
    this._lastBeatMs    = 0;
    this._beatIntervals = [];
    this._maxIntervals  = 8;

    // Beat output
    this.bpm        = 0;
    this.confidence = 0;
    this.isBeat     = false;

    // ── Phrase tracking ────────────────────────────────────────
    // Beat position within current bar (1–4)
    this.beat      = 1;
    // Bar position within current phrase (1–4)
    this.bar       = 1;
    // Current phrase number (increments every 4 bars)
    this.phrase    = 1;
    // Convenience flags
    this.isDownbeat = false;  // true on beat 1 of any bar
    this.isBarOne   = false;  // true on bar 1 of each phrase (the "1" of the phrase)

    this._beatCount  = 0;   // total beats since tracking started
    this._barCount   = 0;   // total bars since tracking started
    this._tracking   = false; // whether we have enough confidence to phrase-track

    // Callback
    this.onBeat = null;
  }

  // ── Per-frame update ─────────────────────────────────────────

  update(smoothed, fftData) {
    this.isBeat     = false;
    this.isDownbeat = false;
    this.isBarOne   = false;

    if (!smoothed?.isActive) return;

    let energy;
    if (fftData && fftData.length > 0) {
      energy = this._rawBassEnergy(fftData);
    } else {
      energy = smoothed.bass * 0.7 + smoothed.mid * 0.3;
    }

    this._energyHistory.push(energy);
    if (this._energyHistory.length > this.historySize) {
      this._energyHistory.shift();
    }

    if (this._energyHistory.length < 10) return;

    const avg      = this._energyHistory.reduce((a, b) => a + b, 0) / this._energyHistory.length;
    const now      = performance.now();
    const elapsed  = now - this._lastBeatMs;
    const isBeat   = energy > avg * this.threshold && elapsed > this.minInterval && avg > 0.02;

    if (isBeat) {
      this.isBeat = true;

      if (this._lastBeatMs > 0) {
        this._beatIntervals.push(elapsed);
        if (this._beatIntervals.length > this._maxIntervals) {
          this._beatIntervals.shift();
        }
        this._updateBPM();
      }

      this._lastBeatMs = now;
      this._advancePhrase();

      if (typeof this.onBeat === 'function') {
        this.onBeat({
          bpm:       this.bpm,
          confidence: this.confidence,
          energy,
          beat:      this.beat,
          bar:       this.bar,
          phrase:    this.phrase,
          isDownbeat: this.isDownbeat,
          isBarOne:   this.isBarOne,
        });
      }
    }
  }

  // ── Phrase tracking ──────────────────────────────────────────

  _advancePhrase() {
    // Only phrase-track when BPM is reasonably confident
    if (this.confidence < 0.4 || this.bpm === 0) {
      // Still count beats but don't advance bar/phrase until locked
      this._beatCount++;
      this.beat = ((this._beatCount - 1) % 4) + 1;
      this.isDownbeat = this.beat === 1;
      return;
    }

    this._tracking = true;
    this._beatCount++;

    // Beat 1-4 within bar
    this.beat = ((this._beatCount - 1) % 4) + 1;
    this.isDownbeat = this.beat === 1;

    // On each downbeat, advance bar counter
    if (this.isDownbeat) {
      this._barCount++;
      this.bar = ((this._barCount - 1) % 4) + 1;
      this.isBarOne = this.bar === 1;

      // On bar 1 (start of new phrase), advance phrase counter
      if (this.isBarOne) {
        if (this._barCount > 1) this.phrase++; // don't increment on very first bar
      }
    }
  }

  // ── BPM calculation ──────────────────────────────────────────

  _updateBPM() {
    if (this._beatIntervals.length < 2) return;

    const avg    = this._beatIntervals.reduce((a, b) => a + b, 0) / this._beatIntervals.length;
    const rawBpm = 60000 / avg;

    let bpm = rawBpm;
    while (bpm > 200) bpm /= 2;
    while (bpm < 50)  bpm *= 2;

    this.bpm = Math.round(bpm);

    const variance   = this._beatIntervals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / this._beatIntervals.length;
    const stdDev     = Math.sqrt(variance);
    this.confidence  = VaelMath.clamp(1 - (stdDev / avg) * 2, 0, 1);
  }

  // ── Raw FFT bass energy ──────────────────────────────────────

  _rawBassEnergy(fftData) {
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
    this._beatCount     = 0;
    this._barCount      = 0;
    this._tracking      = false;
    this.beat           = 1;
    this.bar            = 1;
    this.phrase         = 1;
    this.isDownbeat     = false;
    this.isBarOne       = false;
  }
}
