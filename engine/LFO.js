/**
 * engine/LFO.js
 * Low-frequency oscillator for modulating layer parameters over time.
 * Ties into the BPM from BeatDetector/Sequencer for musical sync.
 *
 * Each LFO instance modulates one parameter on one layer.
 * LayerStack.updateLFOs(dt, bpm) drives all active LFOs each frame.
 *
 * Usage:
 *   const lfo = new LFO({ layerId, paramId, shape, rate, depth, offset });
 *   lfoManager.add(lfo);
 */

class LFO {
  constructor({ layerId, paramId, shape = 'sine', rate = 1.0,
                depth = 0.5, offset = 0, bipolar = false, syncToBpm = false }) {
    this.id        = `lfo-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    this.layerId   = layerId;
    this.paramId   = paramId;
    this.shape     = shape;      // 'sine' | 'triangle' | 'square' | 'saw' | 'random'
    this.rate      = rate;       // cycles per second (Hz), or beats if syncToBpm
    this.depth     = depth;      // 0–1, how much to modulate
    this.offset    = offset;     // base value offset
    this.bipolar   = bipolar;    // true = output -1..+1, false = 0..1
    this.syncToBpm = syncToBpm;  // true = rate is in beats, not Hz

    this._phase    = 0;          // 0..1
    this._prevRand = Math.random();
    this._nextRand = Math.random();
    this._randPhase = 0;

    // Store the original param value so we can restore it if LFO is removed
    this._originalValue = null;
  }

  /**
   * Advance the LFO and return the current output value.
   * @param {number} dt   delta time in seconds
   * @param {number} bpm  current BPM (used if syncToBpm)
   * @returns {number}    modulated value
   */
  tick(dt, bpm) {
    // Advance phase
    let rateHz = this.rate;
    if (this.syncToBpm && bpm > 0) {
      // rate in beats → convert to Hz
      rateHz = (bpm / 60) / this.rate;
    }

    this._phase += rateHz * dt;
    if (this._phase >= 1) {
      this._phase -= Math.floor(this._phase);
      // Update random targets on each cycle
      this._prevRand = this._nextRand;
      this._nextRand = Math.random();
    }

    return this._compute();
  }

  _compute() {
    const p = this._phase;
    let raw;

    switch (this.shape) {
      case 'sine':
        raw = Math.sin(p * Math.PI * 2);
        break;
      case 'triangle':
        raw = p < 0.5 ? p * 4 - 1 : 3 - p * 4;
        break;
      case 'square':
        raw = p < 0.5 ? 1 : -1;
        break;
      case 'saw':
        raw = p * 2 - 1;
        break;
      case 'random':
        // Smoothly interpolate between random values
        raw = VaelMath.lerp(this._prevRand, this._nextRand, p) * 2 - 1;
        break;
      default:
        raw = Math.sin(p * Math.PI * 2);
    }

    // raw is -1..+1
    if (this.bipolar) {
      return this.offset + raw * this.depth;
    } else {
      return this.offset + ((raw + 1) / 2) * this.depth;
    }
  }

  toJSON() {
    return {
      id: this.id, layerId: this.layerId, paramId: this.paramId,
      shape: this.shape, rate: this.rate, depth: this.depth,
      offset: this.offset, bipolar: this.bipolar, syncToBpm: this.syncToBpm,
    };
  }
}

/**
 * LFOManager — owns a list of LFOs, applies them every frame.
 * Call lfoManager.tick(dt, bpm, layerStack) from App.js render loop.
 */
class LFOManager {
  constructor() {
    this.lfos = [];
  }

  add(lfo) {
    // Store original param value before modulating
    this.lfos.push(lfo);
  }

  remove(id) {
    this.lfos = this.lfos.filter(l => l.id !== id);
  }

  clear() { this.lfos = []; }

  tick(dt, bpm, layerStack) {
    if (!layerStack) return;
    this.lfos.forEach(lfo => {
      const layer = layerStack.layers.find(l => l.id === lfo.layerId);
      if (!layer) return;
      const value = lfo.tick(dt, bpm);

      if (lfo.paramId === 'opacity') {
        // Special: opacity lives on layer directly, not in layer.params
        layer.opacity = Math.max(0, Math.min(1, value));
      } else if (lfo.paramId.startsWith('transform.')) {
        // Special: transform targets
        const key = lfo.paramId.slice('transform.'.length);
        if (layer.transform) layer.transform[key] = value;
      } else {
        if (!layer.params) return;
        layer.params[lfo.paramId] = value;
        if (typeof layer.setParam === 'function') layer.setParam(lfo.paramId, value);
      }
    });
  }

  toJSON() { return this.lfos.map(l => l.toJSON()); }

  fromJSON(data, layerStack) {
    this.lfos = data.map(d => new LFO(d));
  }
}
