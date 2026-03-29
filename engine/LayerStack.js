/**
 * engine/LayerStack.js
 * Manages the ordered array of active layers.
 * Pushes global uniforms (iTime, iBeat, iBpm, iMouse) to every layer each frame.
 */

class LayerStack {

  constructor() {
    this.layers    = [];
    this.onChanged = null;

    // Global uniforms written here, read by layers
    this._startTime = performance.now();
    this._beatPulse = 0;
    this._bpm       = 0;
    this._mouseX    = 0.5;
    this._mouseY    = 0.5;

    // Track mouse for iMouse uniform
    document.addEventListener('mousemove', e => {
      this._mouseX = e.clientX / window.innerWidth;
      this._mouseY = 1.0 - (e.clientY / window.innerHeight);
    });
  }

  // ── Mutation ─────────────────────────────────────────────────

  add(layer) {
    this.layers.push(layer);
    this._notify();
  }

  remove(id) {
    const layer = this.layers.find(l => l.id === id);
    if (layer && typeof layer.dispose === 'function') layer.dispose();
    this.layers = this.layers.filter(l => l.id !== id);
    this._notify();
  }

  moveUp(id) {
    const i = this.layers.findIndex(l => l.id === id);
    if (i < this.layers.length - 1) {
      [this.layers[i], this.layers[i+1]] = [this.layers[i+1], this.layers[i]];
      this._notify();
    }
  }

  moveDown(id) {
    const i = this.layers.findIndex(l => l.id === id);
    if (i > 0) {
      [this.layers[i], this.layers[i-1]] = [this.layers[i-1], this.layers[i]];
      this._notify();
    }
  }

  setVisible(id, visible)   { const l = this._find(id); if (l) { l.visible   = visible;   this._notify(); } }
  setOpacity(id, opacity)   { const l = this._find(id); if (l)   l.opacity   = VaelMath.clamp(opacity, 0, 1); }
  setBlendMode(id, mode)    { const l = this._find(id); if (l)   l.blendMode = mode; }

  // ── Per-frame ────────────────────────────────────────────────

  /**
   * @param {object} audioData  — from AudioEngine.smoothed (includes isBeat, bpm)
   * @param {object} videoData  — from VideoEngine.smoothed
   * @param {number} dt         — delta time in seconds
   */
  update(audioData, videoData, dt) {
    const iTime = (performance.now() - this._startTime) / 1000;

    // Update beat pulse (decays over ~200ms)
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 5);
    if (audioData?.bpm) this._bpm = audioData.bpm;

    // Push global uniforms to every layer and apply modulation
    this.layers.forEach(layer => {
      if (!layer.visible) return;

      layer.uniforms.iTime   = iTime;
      layer.uniforms.iBeat   = this._beatPulse;
      layer.uniforms.iBpm    = this._bpm;
      layer.uniforms.iMouseX = this._mouseX;
      layer.uniforms.iMouseY = this._mouseY;

      // Apply modulation matrix — routes signals to params
      if (layer.modMatrix && layer.modMatrix.routes.length > 0) {
        // Build merged signal object: audio + video + uniforms
        const signals = Object.assign({}, audioData, videoData, {
          iTime:   iTime,
          iBeat:   this._beatPulse,
          iBpm:    this._bpm,
          iMouseX: this._mouseX,
          iMouseY: this._mouseY,
        });
        layer.modMatrix.apply(layer, signals);
      }

      if (typeof layer.update === 'function') {
        layer.update(audioData, videoData, dt);
      }
    });
  }

  // ── Accessors ────────────────────────────────────────────────

  get count() { return this.layers.length; }
  _find(id)   { return this.layers.find(l => l.id === id); }
  _notify()   { if (typeof this.onChanged === 'function') this.onChanged(this.layers); }

  toJSON() {
    return this.layers.map(l => typeof l.toJSON === 'function' ? l.toJSON() : {});
  }
}