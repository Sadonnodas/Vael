/**
 * layers/_BaseLayer.js
 * Base class for all Vael layer plugins.
 * Every layer extends this and implements the methods below.
 */
class BaseLayer {
  constructor(id, name) {
    this.id      = id || `layer-${Date.now()}`;
    this.name    = name || 'Layer';
    this.visible = true;
    this.opacity = 1.0;
    this.blendMode = 'normal';
  }

  /** Called once when the layer is added. Override to set up resources. */
  init(params) {}

  /** Called every frame. Override to update state. */
  update(audioData, videoData, dt) {}

  /** Called every frame after update. Override to draw. */
  render(ctx, width, height) {}

  /** Called when the layer is removed. Override to free resources. */
  dispose() {}

  /** Serialise to JSON for preset saving. */
  toJSON() {
    return {
      id:        this.id,
      type:      this.constructor.name,
      name:      this.name,
      visible:   this.visible,
      opacity:   this.opacity,
      blendMode: this.blendMode,
    };
  }
}
