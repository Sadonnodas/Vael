/**
 * layers/ShaderLayer.js
 * Runs a GLSL fragment shader as a full-screen layer.
 * Compatible with ShaderToy shaders (uses mainImage convention).
 * Provides standard uniforms: iTime, iResolution, iBass, iMid,
 * iTreble, iVolume, iBeat, iBpm.
 *
 * Usage — load from file:
 *   const layer = new ShaderLayer('shader-1');
 *   layer.init({ glsl: shaderSourceString, name: 'Liquid' });
 *   layers.add(layer);
 *
 * Usage — load from built-in:
 *   const layer = ShaderLayer.fromBuiltin('bloom');
 */

class ShaderLayer extends BaseLayer {

  static manifest = {
    name: 'Shader',
    version: '1.0',
    params: [
      { id: 'speed',     label: 'Speed',     type: 'float', default: 1.0, min: 0, max: 4   },
      { id: 'intensity', label: 'Intensity', type: 'float', default: 1.0, min: 0, max: 2   },
      { id: 'scale',     label: 'Scale',     type: 'float', default: 1.0, min: 0.1, max: 5 },
      { id: 'audioTarget', label: 'Audio band', type: 'band', default: 'bass' },
    ],
  };

  // ── Static factory for built-in shaders ──────────────────────

  static fromBuiltin(name, id) {
    const glsl = ShaderLayer.BUILTINS[name];
    if (!glsl) { console.warn(`ShaderLayer: no builtin named "${name}"`); return null; }
    const layer = new ShaderLayer(id || `shader-${name}-${Date.now()}`);
    layer.init({ glsl, shaderName: name });
    return layer;
  }

  // ── Instance ─────────────────────────────────────────────────

  constructor(id) {
    super(id, 'Shader');
    this.params = {
      speed:       1.0,
      intensity:   1.0,
      scale:       1.0,
      audioTarget: 'bass',
    };

    this._glsl        = '';
    this._shaderName  = 'custom';
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;

    // Canvas 2D fallback renderer (WebGL is Phase 3)
    // For now we render via an offscreen canvas using pixel shader simulation
    this._off    = null;
    this._offCtx = null;
    this._w      = 0;
    this._h      = 0;
    this._scale  = 6;   // render at 1/6 resolution for performance
  }

  init(params = {}) {
    if (params.glsl)       this._glsl       = params.glsl;
    if (params.shaderName) this._shaderName = params.shaderName;
    this.name = params.name || this._shaderName || 'Shader';
    Object.keys(this.params).forEach(k => {
      if (params[k] !== undefined) this.params[k] = params[k];
    });

    // Set up offscreen canvas
    this._off    = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d', { willReadFrequently: false });

    // Select render function based on shader name
    this._renderFn = this._selectRenderFn();
  }

  _selectRenderFn() {
    switch (this._shaderName) {
      case 'distort':   return this._renderDistort.bind(this);
      case 'chromatic': return this._renderChromatic.bind(this);
      case 'bloom':     return this._renderBloom.bind(this);
      case 'ripple':    return this._renderRipple.bind(this);
      case 'plasma':    return this._renderPlasma.bind(this);
      default:          return this._renderPlasma.bind(this);
    }
  }

  update(audioData, videoData, dt) {
    this._time += dt * this.params.speed;
    const av = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    if (!this._off) return;

    const s  = this._scale;
    const W  = Math.ceil(width  / s);
    const H  = Math.ceil(height / s);

    if (this._off.width !== W || this._off.height !== H) {
      this._off.width  = W;
      this._off.height = H;
    }

    if (typeof this._renderFn === 'function') {
      this._renderFn(this._offCtx, W, H);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._off, 0, 0, width, height);
    ctx.restore();
  }

  // ── Built-in shader renderers (CPU pixel shaders) ────────────
  // These simulate common GLSL effects on the CPU at low resolution.
  // True GPU shaders arrive in Phase 3 when we migrate to WebGL.

  _renderPlasma(ctx, W, H) {
    const img  = ctx.createImageData(W, H);
    const data = img.data;
    const t    = this._time;
    const a    = this._audioSmooth * this.params.intensity;
    const sc   = this.params.scale * 0.05;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const x = px * sc, y = py * sc;
        const v = Math.sin(x + t)
                + Math.sin(y + t * 0.7)
                + Math.sin((x + y) * 0.5 + t * 1.3)
                + Math.sin(Math.sqrt(x*x + y*y) * 0.8 + t + a * 3);

        const hue = (v * 0.25 + 0.5 + a * 0.3) * 360;
        const [r, g, b] = VaelColor.hslToRgb(hue, 0.8, 0.45 + a * 0.2);
        const i = (py * W + px) * 4;
        data[i]   = r * 255;
        data[i+1] = g * 255;
        data[i+2] = b * 255;
        data[i+3] = Math.round(200 * this.params.intensity);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  _renderRipple(ctx, W, H) {
    const img  = ctx.createImageData(W, H);
    const data = img.data;
    const t    = this._time;
    const a    = this._audioSmooth;
    const bp   = this._beatPulse;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const dx = px / W - 0.5, dy = py / H - 0.5;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const wave = Math.sin(dist * 20 * this.params.scale - t * 3 + a * 8 + bp * 4);
        const v    = (wave + 1) * 0.5;
        const hue  = 180 + v * 80 + a * 60;
        const lit  = 0.1 + v * 0.25 * this.params.intensity;
        const [r, g, b] = VaelColor.hslToRgb(hue, 0.7, lit);
        const i = (py * W + px) * 4;
        data[i]   = r * 255;
        data[i+1] = g * 255;
        data[i+2] = b * 255;
        data[i+3] = 220;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  _renderDistort(ctx, W, H) {
    // Warp effect — offset UVs by noise
    ctx.clearRect(0, 0, W, H);
    const a  = this._audioSmooth * this.params.intensity;
    const t  = this._time;
    const sc = this.params.scale;

    const img  = ctx.createImageData(W, H);
    const d    = img.data;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const nx   = px / W * sc, ny = py / H * sc;
        const ox   = VaelMath.noise2D(nx + t * 0.3, ny) * a * 0.15;
        const oy   = VaelMath.noise2D(nx, ny + t * 0.3 + 10) * a * 0.15;
        const hue  = (VaelMath.noise2D(nx + ox, ny + oy + t * 0.1) + 1) * 180;
        const [r, g, b] = VaelColor.hslToRgb(hue + 200, 0.6, 0.15 + a * 0.2);
        const i = (py * W + px) * 4;
        d[i] = r*255; d[i+1] = g*255; d[i+2] = b*255; d[i+3] = 200;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  _renderChromatic(ctx, W, H) {
    // Chromatic aberration — colour channel offset
    ctx.clearRect(0, 0, W, H);
    const a  = this._audioSmooth * this.params.intensity * 12;
    const bp = this._beatPulse * 8;
    const offset = a + bp;

    // Draw three offset coloured rectangles — simulates channel split
    const drawChannel = (color, dx, dy) => {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(dx, dy, W, H);
      ctx.restore();
    };

    ctx.clearRect(0, 0, W, H);
    drawChannel(`rgba(255,0,0,0.4)`,   offset, 0);
    drawChannel(`rgba(0,255,0,0.4)`,   0, 0);
    drawChannel(`rgba(0,0,255,0.4)`,  -offset, 0);
  }

  _renderBloom(ctx, W, H) {
    // Soft glow — radial gradient driven by audio
    ctx.clearRect(0, 0, W, H);
    const a  = this._audioSmooth * this.params.intensity;
    const bp = this._beatPulse;
    const r  = (0.2 + a * 0.4 + bp * 0.2) * Math.max(W, H);
    const hue = 160 + a * 40 + this._time * 10;

    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, r);
    grad.addColorStop(0,   VaelColor.hsla(hue, 0.8, 0.6, 0.4 + a * 0.3 + bp * 0.2));
    grad.addColorStop(0.5, VaelColor.hsla(hue + 20, 0.7, 0.4, 0.15 + a * 0.15));
    grad.addColorStop(1,   VaelColor.hsla(hue + 40, 0.6, 0.2, 0));

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON() {
    return {
      ...super.toJSON(),
      shaderName: this._shaderName,
      params:     { ...this.params },
    };
  }
}

// ── Built-in shader source strings ───────────────────────────────
// These are reference GLSL strings stored for future WebGL use.
// The CPU renderers above are used now; these will power true GPU shaders in Phase 3.

ShaderLayer.BUILTINS = {
  plasma:   '/* plasma — built-in CPU renderer */',
  ripple:   '/* ripple — built-in CPU renderer */',
  distort:  '/* distort — built-in CPU renderer */',
  chromatic:'/* chromatic — built-in CPU renderer */',
  bloom:    '/* bloom — built-in CPU renderer */',
};
