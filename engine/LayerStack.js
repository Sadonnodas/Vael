/**
 * engine/LayerStack.js
 * Stub — full implementation in next session.
 */
class LayerStack {
  constructor() { this.layers = []; }
  add(layer)    { this.layers.push(layer); }
  remove(id)    { this.layers = this.layers.filter(l => l.id !== id); }
  update(audioData, videoData, dt) {
    this.layers.forEach(l => l.update && l.update(audioData, videoData, dt));
  }
  get count()   { return this.layers.length; }
}
