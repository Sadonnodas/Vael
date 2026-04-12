/**
 * layers/NoiseFieldLayer.js
 * Full-screen animated noise texture with multiple visual modes.
 * Modes: field (classic), flow (directional), marble, aurora
 */

class NoiseFieldLayer extends BaseLayer {

  static manifest = {
    name: 'Noise Field',
    version: '2.0',
    params: [
      { id: 'mode',        label: 'Mode',         type: 'enum',  default: 'field',
        options: ['field','flow','marble','aurora','turbulence','voronoi','ridged','cells','smoke','plasma','terrain','warp','lava','clouds','crystal'] },
      { id: 'scale',       label: 'Scale',        type: 'float', default: 0.004, min: 0.001, max: 0.02  },
      { id: 'speed',       label: 'Speed',        type: 'float', default: 0.12,  min: 0.01,  max: 1.0   },
      { id: 'hueA',        label: 'Hue A',        type: 'float', default: 200,   min: 0,     max: 360   },
      { id: 'hueB',        label: 'Hue B',        type: 'float', default: 260,   min: 0,     max: 360   },
      { id: 'saturation',  label: 'Saturation',   type: 'float', default: 0.65,  min: 0,     max: 1     },
      { id: 'lightness',   label: 'Lightness',    type: 'float', default: 0.14,  min: 0.02,  max: 0.6   },
      { id: 'contrast',    label: 'Contrast',     type: 'float', default: 1.0,   min: 0.3,   max: 3.0   },
      { id: 'audioReact',  label: 'Audio react', type: 'float', default: 0,   min: 0, max: 1 },
    ],
  };

  constructor(id) {
    super(id, 'Noise Field');
    this.params = {
      mode:        'field',
      scale:       0.004,
      speed:       0.12,
      hueA:        200,
      hueB:        260,
      saturation:  0.65,
      lightness:   0.14,
      contrast:    1.0,
      audioReact:  0,
    };
    this._time        = 0;
    this._audioSmooth = 0;
    this._off         = document.createElement('canvas');
    this._offCtx      = this._off.getContext('2d', { willReadFrequently: false });
    this._ds          = 4;  // downsample factor
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    this._time       += dt;
    const react       = this.params.audioReact ?? 0;
    const av          = audioData?.isActive ? (audioData.bass ?? 0) * react : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.05);
  }

  render(ctx, width, height) {
    const ds = this._ds;
    const W  = Math.ceil(width  / ds);
    const H  = Math.ceil(height / ds);

    if (this._off.width !== W || this._off.height !== H) {
      this._off.width  = W;
      this._off.height = H;
    }

    const oCtx = this._offCtx;
    const img  = oCtx.createImageData(W, H);
    const data = img.data;

    const t    = this._time * this.params.speed * (1 + this._audioSmooth * 1.5);
    const sc   = this.params.scale * ds;
    const hueA = this.params.hueA;
    const hueB = this.params.hueB;
    const sat  = this.params.saturation;
    const lit  = this.params.lightness + this._audioSmooth * 0.06;
    const con  = this.params.contrast;
    const mode = this.params.mode;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const nx = px * sc;
        const ny = py * sc;
        let n, hue, l, s;

        switch (mode) {
          case 'flow': {
            // Directional flow with curl-like noise
            const n1 = VaelMath.noise2D(nx,        ny + t);
            const n2 = VaelMath.noise2D(nx + 50,   ny + t * 0.7);
            const flow = VaelMath.noise2D(nx + n1 * 0.5, ny + n2 * 0.5 + t * 0.3);
            n = (flow + 1) / 2;
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit + n * 0.12 * con;
            s   = sat;
            break;
          }
          case 'marble': {
            // Marble veins
            const base = nx * 0.5 + VaelMath.noise2D(nx, ny + t * 0.3) * 4;
            n   = (Math.sin(base) + 1) / 2;
            n   = Math.pow(n, 1 / con);
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.5 + n * lit * 2;
            s   = sat * (0.3 + n * 0.7);
            break;
          }
          case 'aurora': {
            // Horizontal bands with vertical shimmer
            const band = VaelMath.noise2D(nx * 0.3, t * 0.2) * 2;
            const shimmer = VaelMath.noise2D(nx * 2 + 100, ny * 0.5 + t * 0.5);
            const y_norm = py / H;
            n   = VaelMath.clamp((Math.sin(y_norm * 6 + band) * 0.5 + 0.5) + shimmer * 0.3, 0, 1);
            hue = VaelMath.lerp(hueA, hueB + 40, n);
            l   = lit + n * 0.2 * con;
            s   = sat * (0.5 + n * 0.5);
            break;
          }
          case 'turbulence': {
            // Absolute value of layered noise — creates sharp veins and ridges
            const n1 = Math.abs(VaelMath.noise2D(nx,          ny          + t));
            const n2 = Math.abs(VaelMath.noise2D(nx * 2 + 40, ny * 2      + t * 1.7));
            const n3 = Math.abs(VaelMath.noise2D(nx * 4 + 80, ny * 4      + t * 2.3));
            n   = VaelMath.clamp((n1 * 0.5 + n2 * 0.3 + n3 * 0.2) * con, 0, 1);
            // High contrast: dark background with bright veins
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.3 + n * n * (lit * 4 + 0.1);   // power curve → punchy highlights
            s   = sat * (0.6 + n * 0.4);
            break;
          }
          case 'voronoi': {
            // Approximate Voronoi using noise — cell-like blobs
            const cx = Math.floor(nx * 3) / 3;
            const cy = Math.floor(ny * 3) / 3;
            const cellNoise = VaelMath.noise2D(cx * 8 + 200, cy * 8 + t * 0.5);
            const distort   = VaelMath.noise2D(nx * 2 + t, ny * 2) * 0.4;
            n   = VaelMath.clamp(Math.abs(cellNoise + distort) * con, 0, 1);
            const edgeSharp = 1 - Math.pow(Math.abs(n - 0.5) * 2, 0.3);
            hue = VaelMath.lerp(hueA, hueB, cellNoise * 0.5 + 0.5);
            l   = lit + edgeSharp * 0.18;
            s   = sat * (0.4 + edgeSharp * 0.6);
            break;
          }
          case 'ridged': {
            // Ridged multifractal — sharp bright ridges on dark background
            const r1 = 1 - Math.abs(VaelMath.noise2D(nx,          ny          + t));
            const r2 = 1 - Math.abs(VaelMath.noise2D(nx * 2 + 40, ny * 2      + t * 1.5));
            const r3 = 1 - Math.abs(VaelMath.noise2D(nx * 4 + 80, ny * 4      + t * 2.1));
            n   = VaelMath.clamp((r1 * 0.5 + r2 * 0.3 + r3 * 0.2) * con, 0, 1);
            n   = n * n; // sharpen ridges
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.2 + n * 0.5;
            s   = sat * (0.5 + n * 0.5);
            break;
          }
          case 'cells': {
            // Cellular / worley-like noise: soft blobs
            const cx1 = Math.floor(nx * 2) + 0.5;
            const cy1 = Math.floor(ny * 2) + 0.5;
            const jx  = VaelMath.noise2D(cx1 * 7.3, cy1 * 7.3 + t * 0.3) * 0.5;
            const jy  = VaelMath.noise2D(cx1 * 13.7 + 50, cy1 * 13.7 + t * 0.2) * 0.5;
            const dx2 = nx * 2 - (cx1 + jx);
            const dy2 = ny * 2 - (cy1 + jy);
            const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            n   = VaelMath.clamp(1 - dist2 * con, 0, 1);
            hue = VaelMath.lerp(hueA, hueB, VaelMath.noise2D(cx1 * 3 + 200, cy1 * 3) * 0.5 + 0.5);
            l   = lit + n * 0.25;
            s   = sat * (0.4 + n * 0.6);
            break;
          }
          case 'smoke': {
            // Slow billowing smoke: multiple octaves drifting upward
            const s1 = VaelMath.noise2D(nx,          ny + t * 0.6);
            const s2 = VaelMath.noise2D(nx * 2 + 30, ny * 2 + t * 0.9);
            const s3 = VaelMath.noise2D(nx * 4 + 60, ny * 4 + t * 1.2);
            n   = VaelMath.clamp(((s1 * 0.6 + s2 * 0.3 + s3 * 0.1) + 1) / 2, 0, 1);
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.5 + n * n * (lit * 3 + 0.05);
            s   = sat * 0.4;
            break;
          }
          case 'plasma': {
            // Sinusoidal plasma: sum of sines in noise-warped space
            const w1 = VaelMath.noise2D(nx * 0.5, ny * 0.5 + t * 0.2) * 2;
            const p1 = Math.sin(nx * 4 + t + w1);
            const p2 = Math.sin(ny * 4 + t * 0.7);
            const p3 = Math.sin((nx + ny) * 3 + t * 1.3);
            const p4 = Math.sin(Math.sqrt(nx * nx + ny * ny) * 5 + t);
            n   = VaelMath.clamp(((p1 + p2 + p3 + p4) / 4 + 1) / 2, 0, 1);
            hue = VaelMath.lerp(hueA, hueB, n) + n * 40;
            l   = lit + n * 0.18 * con;
            s   = sat;
            break;
          }
          case 'terrain': {
            // Heightmap-style terrain with contour lines
            const h1 = VaelMath.noise2D(nx,          ny          + t * 0.05);
            const h2 = VaelMath.noise2D(nx * 2 + 40, ny * 2      + t * 0.08);
            const h3 = VaelMath.noise2D(nx * 4 + 80, ny * 4      + t * 0.12);
            const height2 = (h1 * 0.6 + h2 * 0.3 + h3 * 0.1 + 1) / 2;
            const contour = Math.abs(Math.sin(height2 * Math.PI * 8 * con));
            n   = height2;
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.4 + n * 0.3 + contour * 0.08;
            s   = sat * (0.3 + contour * 0.7);
            break;
          }
          case 'warp': {
            // Domain-warped fractal: p → q → r chains
            const q1 = VaelMath.noise2D(nx + t,          ny);
            const q2 = VaelMath.noise2D(nx + 1.7,        ny + 9.2 + t * 0.8);
            const r1 = VaelMath.noise2D(nx + 2 * q1 + 1.7 + t * 0.3, ny + 2 * q2 + 9.2);
            const r2 = VaelMath.noise2D(nx + 2 * q1 + 8.3,            ny + 2 * q2 + 2.8 + t * 0.4);
            n   = VaelMath.clamp((VaelMath.noise2D(nx + 3 * r1, ny + 3 * r2) + 1) / 2, 0, 1);
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit + n * 0.14 * con;
            s   = sat;
            break;
          }
          case 'lava': {
            // Lava lamp: slow-moving blobs with hot-colour interior
            const la = VaelMath.noise2D(nx * 0.7,       ny * 0.7 + t * 0.25);
            const lb = VaelMath.noise2D(nx * 1.5 + 100, ny * 1.5 + t * 0.18);
            n   = VaelMath.clamp((la * 0.6 + lb * 0.4 + 1) / 2, 0, 1);
            const blob = Math.pow(Math.max(0, n - 0.3) / 0.7, 1.5);
            hue = VaelMath.lerp(hueA, hueB, blob);
            l   = lit * 0.3 + blob * 0.55 * con;
            s   = sat * (0.4 + blob * 0.6);
            break;
          }
          case 'clouds': {
            // Soft cumulus: layered octaves with bright tops
            const c1n = (VaelMath.noise2D(nx,          ny * 0.6 + t * 0.1) + 1) / 2;
            const c2n = (VaelMath.noise2D(nx * 2 + 30, ny * 1.2 + t * 0.15) + 1) / 2;
            const c3n = (VaelMath.noise2D(nx * 4 + 60, ny * 2.4 + t * 0.2) + 1) / 2;
            n   = VaelMath.clamp(c1n * 0.6 + c2n * 0.3 + c3n * 0.1, 0, 1);
            n   = Math.pow(n, 1 / con);
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit * 0.3 + n * 0.55;
            s   = sat * (1 - n * 0.6); // desaturate toward white at top
            break;
          }
          case 'crystal': {
            // Faceted crystal: angular voronoi-like with sharp edges
            // Cell size scales with sc so the Scale param is meaningful
            const cellSize = 0.5; // cells are 0.5 units in noise-space
            const gx = Math.floor(nx / cellSize) * cellSize;
            const gy = Math.floor(ny / cellSize) * cellSize;
            // Jitter moves with time so facets slowly drift
            const jx2 = VaelMath.noise2D(gx * 9.1 + 300, gy * 9.1 + t * 0.4) * cellSize * 0.45;
            const jy2 = VaelMath.noise2D(gx * 7.3 + 400, gy * 7.3 + t * 0.35) * cellSize * 0.45;
            const dx3 = (nx - gx - cellSize * 0.5) - jx2;
            const dy3 = (ny - gy - cellSize * 0.5) - jy2;
            // facetNoise includes t so hue slowly shifts
            const facetNoise = VaelMath.noise2D(gx * 5 + 500, gy * 5 + t * 0.08);
            const edge  = Math.abs(dx3) + Math.abs(dy3);
            n   = VaelMath.clamp(1 - edge * con * (6 / cellSize), 0, 1);
            hue = VaelMath.lerp(hueA, hueB, facetNoise * 0.5 + 0.5);
            l   = lit * 0.2 + n * 0.5 + (1 - n) * 0.02;
            s   = sat * (0.6 + n * 0.4);
            break;
          }
          default: { // field
            const n1 = VaelMath.noise2D(nx,          ny          + t);
            const n2 = VaelMath.noise2D(nx * 2 + 80, ny * 2      + t * 1.3);
            n   = VaelMath.clamp(((n1 * 0.7 + n2 * 0.3) * con + 1) / 2, 0, 1);
            hue = VaelMath.lerp(hueA, hueB, n);
            l   = lit + n * 0.10;
            s   = sat;
          }
        }

        const [r, g, b] = VaelColor.hslToRgb(hue, s, l);
        const idx = (py * W + px) * 4;
        data[idx]   = r * 255 | 0;
        data[idx+1] = g * 255 | 0;
        data[idx+2] = b * 255 | 0;
        data[idx+3] = 255;
      }
    }

    oCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._off, 0, 0, width, height);
    ctx.restore();
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
