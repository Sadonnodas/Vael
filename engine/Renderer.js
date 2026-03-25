/**
 * engine/Renderer.js
 * Canvas 2D compositor.
 * Runs the 60fps render loop, composites all layers with blend modes.
 */

class Renderer {

  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');

    this._rafId       = null;
    this._lastT       = 0;
    this._fpsSmoothed = 60;

    // Set by App.js
    this.layerStack = null;
    this.audioData  = null;
    this.videoData  = null;

    // Callbacks
    this.onFrame = null;    // (dt, fps) called every frame

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    // Use device pixel ratio for sharp rendering on retina
    const dpr = window.devicePixelRatio || 1;
    const w   = this.canvas.clientWidth  || window.innerWidth;
    const h   = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.scale(dpr, dpr);
    this._cssW = w;
    this._cssH = h;
  }

  start() {
    const loop = (timestamp) => {
      const dt = Math.min((timestamp - this._lastT) / 1000, 0.1);
      this._lastT = timestamp;
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
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this._cssW, this._cssH);
  }

  _renderLayers() {
    if (!this.layerStack) return;
    const { ctx } = this;
    const W = this._cssW;
    const H = this._cssH;

    this.layerStack.layers.forEach(layer => {
      if (!layer.visible) return;

      ctx.save();
      ctx.globalAlpha          = VaelMath.clamp(layer.opacity ?? 1, 0, 1);
      ctx.globalCompositeOperation = this._blendMode(layer.blendMode);

      // Centre the coordinate system
      ctx.translate(W / 2, H / 2);

      if (typeof layer.render === 'function') {
        layer.render(ctx, W, H);
      }

      ctx.restore();
    });

    // Reset composite after all layers
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _blendMode(mode) {
    const map = {
      normal:      'source-over',
      multiply:    'multiply',
      screen:      'screen',
      overlay:     'overlay',
      add:         'lighter',
      softlight:   'soft-light',
      hardlight:   'hard-light',
      difference:  'difference',
      exclusion:   'exclusion',
      luminosity:  'luminosity',
      color:       'color',
      hue:         'hue',
      saturation:  'saturation',
    };
    return map[mode] || 'source-over';
  }

  get fps() { return Math.round(this._fpsSmoothed); }
  get width()  { return this._cssW; }
  get height() { return this._cssH; }
}