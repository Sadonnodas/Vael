/**
 * engine/LayerStack.js
 * Manages the ordered array of active layers.
 * Handles add, remove, reorder, visibility, opacity, blend mode.
 */

class LayerStack {

  constructor() {
    this.layers = [];             // ordered bottom → top
    this.onChanged = null;        // called whenever the stack changes
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

  setVisible(id, visible) {
    const l = this._find(id);
    if (l) { l.visible = visible; this._notify(); }
  }

  setOpacity(id, opacity) {
    const l = this._find(id);
    if (l) l.opacity = VaelMath.clamp(opacity, 0, 1);
  }

  setBlendMode(id, mode) {
    const l = this._find(id);
    if (l) l.blendMode = mode;
  }

  // ── Per-frame ────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    this.layers.forEach(layer => {
      if (layer.visible && typeof layer.update === 'function') {
        layer.update(audioData, videoData, dt);
      }
    });
  }

  // ── Accessors ────────────────────────────────────────────────

  get count() { return this.layers.length; }

  _find(id) { return this.layers.find(l => l.id === id); }

  _notify() {
    if (typeof this.onChanged === 'function') this.onChanged(this.layers);
  }

  // ── Serialisation ────────────────────────────────────────────

  toJSON() {
    return this.layers.map(l => typeof l.toJSON === 'function' ? l.toJSON() : {});
  }
}