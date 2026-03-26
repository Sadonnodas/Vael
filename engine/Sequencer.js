/**
 * engine/Sequencer.js
 * Tap tempo and 8-step visual event sequencer.
 *
 * Tap tempo: tap T key (or call tapTempo()) at least 3 times to set BPM.
 * Step sequencer: 8 steps per bar, each step can trigger a visual event.
 *
 * Events fired on active steps:
 *   'flash'   — brief white flash overlay
 *   'beat'    — same as BeatDetector.isBeat signal
 *   'zoom'    — zoom pulse on MathVisualizer layers
 *   'color'   — hue shift on all layers
 *   'none'    — silent step
 *
 * Usage:
 *   const seq = new Sequencer();
 *   seq.onStep = (step, event) => { ... };
 *   seq.onBpmChange = (bpm) => { ... };
 *   // every frame:
 *   seq.tick(dt);
 */

class Sequencer {

  constructor() {
    // Tap tempo
    this._taps        = [];
    this._maxTapGap   = 2000;   // ms — gap larger than this resets tap history

    // BPM and timing
    this.bpm          = 0;
    this.active       = false;
    this._stepMs      = 0;      // ms per step (beat / 2 for 8th notes, or beat for quarter)
    this._accumMs     = 0;      // accumulated ms since last step
    this._currentStep = 0;      // 0–7

    // Steps config — 8 steps, each has an event type
    this.steps = [
      'beat', 'none', 'none', 'none',
      'beat', 'none', 'none', 'none',
    ];

    // Subdivision: 'quarter' = 4 steps/bar, 'eighth' = 8 steps/bar
    this.subdivision  = 'quarter';

    // Flash state (0–1, decays each frame)
    this.flashAmount  = 0;

    // Callbacks
    this.onStep      = null;     // (stepIndex, eventType) → void
    this.onBpmChange = null;     // (bpm) → void
  }

  // ── Tap tempo ────────────────────────────────────────────────

  tapTempo() {
    const now = performance.now();

    // Reset if gap too large
    if (this._taps.length > 0 && now - this._taps[this._taps.length - 1] > this._maxTapGap) {
      this._taps = [];
    }

    this._taps.push(now);

    // Need at least 3 taps for a reliable estimate
    if (this._taps.length < 2) return;

    // Keep only last 8 taps
    if (this._taps.length > 8) this._taps.shift();

    // Average interval between taps
    const intervals = [];
    for (let i = 1; i < this._taps.length; i++) {
      intervals.push(this._taps[i] - this._taps[i-1]);
    }
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm   = Math.round(60000 / avgMs);

    this.setBpm(VaelMath.clamp(bpm, 40, 240));
  }

  setBpm(bpm) {
    this.bpm    = bpm;
    this.active = bpm > 0;
    this._updateStepMs();
    if (typeof this.onBpmChange === 'function') this.onBpmChange(bpm);
    console.log(`Sequencer: BPM set to ${bpm}`);
  }

  _updateStepMs() {
    // Quarter note = 1 beat = 60000/bpm ms
    // Eighth note = half a beat
    const beatMs = 60000 / this.bpm;
    this._stepMs = this.subdivision === 'eighth' ? beatMs / 2 : beatMs;
  }

  setSubdivision(sub) {
    this.subdivision = sub;
    this._updateStepMs();
  }

  reset() {
    this._accumMs     = 0;
    this._currentStep = 0;
    this._taps        = [];
    this.flashAmount  = 0;
  }

  stop() {
    this.active = false;
    this.bpm    = 0;
    this.reset();
    if (typeof this.onBpmChange === 'function') this.onBpmChange(0);
  }

  // ── Per-frame tick ───────────────────────────────────────────

  /**
   * Call this every frame from App.js renderer.onFrame.
   * @param {number} dt  delta time in seconds
   */
  tick(dt) {
    // Decay flash
    this.flashAmount = Math.max(0, this.flashAmount - dt * 8);

    if (!this.active || this.bpm <= 0 || this._stepMs <= 0) return;

    this._accumMs += dt * 1000;

    while (this._accumMs >= this._stepMs) {
      this._accumMs -= this._stepMs;
      this._fireStep(this._currentStep);
      this._currentStep = (this._currentStep + 1) % 8;
    }
  }

  _fireStep(step) {
    const event = this.steps[step] || 'none';
    if (event === 'none') return;

    if (event === 'flash') this.flashAmount = 1.0;
    if (event === 'beat')  this.flashAmount = 0.3;

    if (typeof this.onStep === 'function') this.onStep(step, event);
  }

  // ── Accessors ────────────────────────────────────────────────

  get currentStep() { return this._currentStep; }

  // ── Sync with BeatDetector ───────────────────────────────────

  /**
   * Sync the sequencer phase to an incoming beat from BeatDetector.
   * If BPM is already set, this just realigns the step counter.
   */
  syncToBeat(detectedBpm) {
    if (!this.active) {
      // Auto-start from detector
      this.setBpm(detectedBpm);
    }
    // Reset accumulator to align with the beat
    this._accumMs     = 0;
    this._currentStep = 0;
  }

  // ── Serialisation ────────────────────────────────────────────

  toJSON() {
    return { bpm: this.bpm, steps: [...this.steps], subdivision: this.subdivision };
  }

  fromJSON(data) {
    if (data.steps)       this.steps       = data.steps;
    if (data.subdivision) this.subdivision = data.subdivision;
    if (data.bpm && data.bpm > 0) this.setBpm(data.bpm);
  }
}
