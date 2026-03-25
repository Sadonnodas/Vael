/**
 * layers/NoiseFieldLayer.js
 * Full-screen animated Perlin noise texture.
 * Slow-breathing organic background. Perfect for folk visuals.
 */

class NoiseFieldLayer extends BaseLayer {

  static manifest = {
    name: 'Noise Field',
    version: '1.0',
    params: [
      { id: 'scale',       label: 'Scale',        type: 'float', default: 0.004, min: 0.001, max: 0.02  },
      { id: 'speed',       label: 'Speed',        type: 'float', default: 0.12,  min: 0.01,  max: 1.0   },
      { id: 'hueA',        label: 'Hue A',        type: 'float', default: 200,   min: 0,     max: 360   },
      { id: 'hueB',        label: 'Hue B',        type: 'float', default: 260,   min: 0,     max: 360   },
      { id: 'saturation',  label: 'Saturation',   type: 'float', default: 0.6,   min: 0,     max: 1     },
      { id: 'lightness',   label: 'Lightness',    type: 'float', default: 0.15,  min: 0.02,  max: 0.5   },
      { id: 'audioTarget', label: 'Audio → speed',type: 'band',  default: 'mid'  },
    ],
  };

  constructor(id) {
    super(id, 'Noise Field');
    this.params = {
      scale:       0.004,
      speed:       0.12,
      hueA:        200,
      hueB:        260,
      saturation:  0.6,
      lightness:   0.15,
      audioTarget: 'mid',
    };
    this._time       = 0;
    this._audioSmooth = 0;

    // Offscreen canvas for pixel painting
    this._off    = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');
    this._w = 0; this._h = 0;

    // Downscale factor — paint at 1/4 resolution, scale up (huge perf win)
    this._scale = 4;
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    this._time += dt;
    const audioVal    = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, audioVal, 0.05);
  }

  render(ctx, width, height) {
    const s = this._scale;
    const W = Math.ceil(width  / s);
    const H = Math.ceil(height / s);

    // Resize offscreen if needed
    if (this._off.width !== W || this._off.height !== H) {
      this._off.width  = W;
      this._off.height = H;
      this._w = W; this._h = H;
    }

    const offCtx   = this._offCtx;
    const imgData  = offCtx.createImageData(W, H);
    const data     = imgData.data;

    const t        = this._time * this.params.speed * (1 + this._audioSmooth * 1.5);
    const sc       = this.params.scale * s;
    const hueA     = this.params.hueA;
    const hueB     = this.params.hueB;
    const sat      = this.params.saturation;
    const lit      = this.params.lightness + this._audioSmooth * 0.08;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const nx = px * sc;
        const ny = py * sc;

        // Two octaves of noise for depth
        const n1 = VaelMath.noise2D(nx,         ny         + t);
        const n2 = VaelMath.noise2D(nx * 2 + 80, ny * 2    + t * 1.3);
        const n  = (n1 * 0.7 + n2 * 0.3 + 1) / 2;  // normalise to 0-1

        // Map noise to hue between hueA and hueB
        const hue = VaelMath.lerp(hueA, hueB, n);
        const [r, g, b] = VaelColor.hslToRgb(hue, sat, lit + n * 0.1);

        const idx = (py * W + px) * 4;
        data[idx]     = Math.round(r * 255);
        data[idx + 1] = Math.round(g * 255);
        data[idx + 2] = Math.round(b * 255);
        data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    // Scale up to full canvas with smoothing
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._off, 0, 0, width, height);
    ctx.restore();
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
