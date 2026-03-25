/**
 * engine/Renderer.js
 * Minimal working renderer — draws directly to canvas 2D.
 * Will be replaced with Three.js WebGL compositor in next session.
 */
class Renderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this._rafId  = null;
    this._lastT  = 0;
    this._fpsSmoothed = 60;
    this.onFrame = null;   // called every frame with (dt, fps)

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.canvas.width  = this.canvas.clientWidth  || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
  }

  start() {
    const loop = (timestamp) => {
      const dt  = Math.min((timestamp - this._lastT) / 1000, 0.1);
      this._lastT = timestamp;

      // Smooth FPS
      if (dt > 0) this._fpsSmoothed += ((1 / dt) - this._fpsSmoothed) * 0.05;

      this._clear();
      if (this.layerStack) {
        this.layerStack.update(this.audioData, this.videoData, dt);
        this._renderLayers();
      }

      if (typeof this.onFrame === 'function') {
        this.onFrame(dt, Math.round(this._fpsSmoothed));
      }

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  _clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _renderLayers() {
    if (!this.layerStack) return;
    this.layerStack.layers.forEach(layer => {
      if (!layer.visible) return;
      this.ctx.globalAlpha = layer.opacity ?? 1;
      // Each layer renders to ctx directly for now
      if (typeof layer.render === 'function') {
        layer.render(this.ctx, this.canvas.width, this.canvas.height);
      }
      this.ctx.globalAlpha = 1;
    });
  }

  get fps() { return Math.round(this._fpsSmoothed); }
}
