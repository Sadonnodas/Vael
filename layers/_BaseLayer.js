/**
 * layers/_BaseLayer.js
 * Base class for all Vael layer plugins.
 *
 * Global uniforms — available in every layer's update() and render():
 *   this.uniforms.iTime    — seconds since page load
 *   this.uniforms.iBeat    — 1.0 on beat frame, decays to 0
 *   this.uniforms.iBpm     — current BPM estimate
 *   this.uniforms.iMouseX  — normalised mouse X (0–1)
 *   this.uniforms.iMouseY  — normalised mouse Y (0–1)
 *
 * Updated every frame by LayerStack before calling update().
 */
class BaseLayer {
  constructor(id, name) {
    this.id          = id   || `layer-${Date.now()}`;
    this.name        = name || 'Layer';
    this.visible     = true;
    this.opacity     = 1.0;
    this.blendMode   = 'normal';
    this.maskLayerId = null;
    this.maskMode    = 'luminance'; // 'alpha' | 'luminance' | 'invert'
    // alpha     — hard cutout mask (transparent areas in mask = transparent here)
    // luminance — bright areas of mask = visible, dark = transparent (cinematic)
    // invert    — dark areas of mask = visible, bright = transparent

    // Per-layer transform
    this.transform = { x: 0, y: 0, scaleX: 1.0, scaleY: 1.0, rotation: 0 };

    // Per-layer clip shape — clips the layer to a rectangle or ellipse
    // before compositing. null = no clip (full canvas).
    // { type: 'none'|'rect'|'ellipse', w: 0–1, h: 0–1, feather: 0–1 }
    // w and h are fractions of the canvas half-dimensions (1.0 = full canvas).
    this.clipShape = null;

    // Param update mode — true = soft/incremental (no full reset on param change)
    // false = instant (full reinitialise on every param change, old behaviour)
    this.softUpdate = true;

    // Color mask — punch holes in the layer by color. null = disabled.
    // { enabled, color, tolerance, softness, invert }
    this.colorMask = null;

    // Per-layer FX chain
    this.fx = [];

    // Per-layer automation ramps
    this.automation = [];

    // Modulation matrix — routes signal sources to layer params
    this.modMatrix = new ModMatrix();

    // Global uniforms — read-only for layers, written by LayerStack
    this.uniforms = {
      iTime:   0,
      iBeat:   0,
      iBpm:    0,
      iMouseX: 0.5,
      iMouseY: 0.5,
    };
  }

  init(params)                          {}
  update(audioData, videoData, dt)      {}
  render(ctx, width, height)            {}
  dispose()                             {}
  setParam(id, value)                   {
    if (this.params) {
      this.params[id] = value;
      this.modMatrix?.setBase(id, value);
    }
  }

  toJSON() {
    return {
      id:          this.id,
      type:        this.constructor.name,
      name:        this.name,
      visible:     this.visible,
      opacity:     this.opacity,
      blendMode:   this.blendMode,
      maskLayerId: this.maskLayerId || null,
      maskMode:    this.maskMode    || 'luminance',
      transform:   { ...this.transform },
      clipShape:   this.clipShape  ? { ...this.clipShape }  : null,
      colorMask:   this.colorMask  ? { ...this.colorMask }  : null,
      softUpdate:  this.softUpdate,
      fx:          this.fx ? this.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
      modMatrix:   this.modMatrix?.toJSON() || [],
      automation:  this.automation ? this.automation.map(r => ({ ...r })) : [],
    };
  }
}
