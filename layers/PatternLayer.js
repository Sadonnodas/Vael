/**
 * layers/PatternLayer.js
 * Built-in animated geometric patterns — no file needed.
 * Great as mask sources, backgrounds, or overlays.
 *
 * Patterns: star, mandala, hexgrid, circles, lissajous, spirograph
 */

class PatternLayer extends BaseLayer {

  static manifest = {
    name: 'Pattern',
    version: '1.0',
    params: [
      { id: 'pattern',     label: 'Pattern',      type: 'enum',  default: 'star',
        options: ['star','mandala','hexgrid','circles','lissajous','spirograph','flower','grid'] },
      { id: 'color',       label: 'Color',         type: 'color', default: '#ffffff' },
      { id: 'color2',      label: 'Color 2',       type: 'color', default: '#00d4aa' },
      { id: 'size',        label: 'Size',          type: 'float', default: 1.0, min: 0.1, max: 4   },
      { id: 'speed',       label: 'Speed',         type: 'float', default: 0.3, min: 0,   max: 3   },
      { id: 'complexity',  label: 'Complexity',    type: 'int',   default: 5,   min: 2,   max: 20  },
      { id: 'lineWidth',   label: 'Line width',    type: 'float', default: 1.5, min: 0.5, max: 8   },
      { id: 'filled',      label: 'Filled',        type: 'bool',  default: false },
      { id: 'audioTarget', label: 'Audio → size',  type: 'band',  default: 'bass' },
      { id: 'audioAmount', label: 'Audio amount',  type: 'float', default: 0.3, min: 0,   max: 1   },
    ],
  };

  constructor(id) {
    super(id, 'Pattern');
    this.params = {
      pattern:     'star',
      color:       '#ffffff',
      color2:      '#00d4aa',
      size:        1.0,
      speed:       0.3,
      complexity:  5,
      lineWidth:   1.5,
      filled:      false,
      audioTarget: 'bass',
      audioAmount: 0.3,
    };
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    this._time += dt * this.params.speed;
    const av = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    const scale    = this.params.size * (1 + this._audioSmooth * this.params.audioAmount * 0.5 + this._beatPulse * 0.08);
    const baseSize = Math.min(width, height) * 0.35 * scale;
    const t        = this._time;
    const n        = this.params.complexity;
    const c1       = this.params.color;
    const c2       = this.params.color2;
    const lw       = this.params.lineWidth;
    const filled   = this.params.filled;

    ctx.save();
    ctx.lineWidth   = lw;
    ctx.strokeStyle = c1;
    ctx.fillStyle   = c1;

    switch (this.params.pattern) {
      case 'star':        this._drawStar(ctx, baseSize, n, t, c1, c2, filled); break;
      case 'mandala':     this._drawMandala(ctx, baseSize, n, t, c1, c2, lw);  break;
      case 'hexgrid':     this._drawHexgrid(ctx, width, height, baseSize, t, c1, lw); break;
      case 'circles':     this._drawCircles(ctx, baseSize, n, t, c1, c2, lw, filled); break;
      case 'lissajous':   this._drawLissajous(ctx, baseSize, n, t, c1, lw);   break;
      case 'spirograph':  this._drawSpirograph(ctx, baseSize, n, t, c1, c2, lw); break;
      case 'flower':      this._drawFlower(ctx, baseSize, n, t, c1, c2, filled); break;
      case 'grid':        this._drawGrid(ctx, width, height, baseSize, t, c1, lw); break;
    }

    ctx.restore();
  }

  _drawStar(ctx, r, n, t, c1, c2, filled) {
    const inner = r * 0.4;
    const rot   = t * 0.5;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const angle  = (i / (n * 2)) * Math.PI * 2 + rot;
      const radius = i % 2 === 0 ? r : inner;
      if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else         ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath();
    if (filled) { ctx.fillStyle = c1; ctx.fill(); }
    ctx.strokeStyle = c1;
    ctx.stroke();
  }

  _drawMandala(ctx, r, n, t, c1, c2, lw) {
    const rings = Math.max(2, Math.floor(n / 2));
    for (let ring = 1; ring <= rings; ring++) {
      const rr    = r * (ring / rings);
      const count = ring * n;
      const rot   = t * (ring % 2 === 0 ? 0.3 : -0.3);
      ctx.strokeStyle = ring % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw * (1.5 - ring / rings);
      for (let i = 0; i < count; i++) {
        const a  = (i / count) * Math.PI * 2 + rot;
        const x1 = Math.cos(a) * rr * 0.7;
        const y1 = Math.sin(a) * rr * 0.7;
        const x2 = Math.cos(a) * rr;
        const y2 = Math.sin(a) * rr;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawHexgrid(ctx, W, H, cellSize, t, c1, lw) {
    const hex   = cellSize * 0.3;
    const cols  = Math.ceil(W / (hex * 1.5)) + 2;
    const rows  = Math.ceil(H / (hex * Math.sqrt(3))) + 2;
    const ox    = (-cols * hex * 1.5 / 2) + Math.sin(t * 0.2) * hex;
    const oy    = (-rows * hex * Math.sqrt(3) / 2);
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw * 0.5;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const cx = ox + col * hex * 1.5;
        const cy = oy + row * hex * Math.sqrt(3) + (col % 2) * hex * Math.sqrt(3) / 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
          if (i === 0) ctx.moveTo(cx + Math.cos(a) * hex, cy + Math.sin(a) * hex);
          else         ctx.lineTo(cx + Math.cos(a) * hex, cy + Math.sin(a) * hex);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  _drawCircles(ctx, r, n, t, c1, c2, lw, filled) {
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + t;
      const cr    = r * 0.3;
      const cx    = Math.cos(angle) * r * 0.6;
      const cy    = Math.sin(angle) * r * 0.6;
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      if (filled) { ctx.fillStyle = i % 2 === 0 ? c1 : c2; ctx.fill(); }
      ctx.stroke();
    }
  }

  _drawLissajous(ctx, r, n, t, c1, lw) {
    const a = n;
    const b = n + 1;
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    for (let i = 0; i <= 628; i++) {
      const angle = i / 100;
      const x = r * Math.sin(a * angle + t);
      const y = r * Math.sin(b * angle);
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawSpirograph(ctx, r, n, t, c1, c2, lw) {
    const R = r;
    const rr = r / n;
    const d  = rr * 0.8;
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    for (let i = 0; i <= 1000; i++) {
      const angle = (i / 1000) * Math.PI * 2 * n + t;
      const x = (R - rr) * Math.cos(angle) + d * Math.cos((R - rr) / rr * angle);
      const y = (R - rr) * Math.sin(angle) - d * Math.sin((R - rr) / rr * angle);
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawFlower(ctx, r, n, t, c1, c2, filled) {
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + t * 0.3;
      ctx.save();
      ctx.rotate(angle);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.fillStyle   = i % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = this.params.lineWidth;
      ctx.beginPath();
      ctx.ellipse(r * 0.35, 0, r * 0.35, r * 0.15, 0, 0, Math.PI * 2);
      if (filled) ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Centre
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = c2;
    ctx.fill();
  }

  _drawGrid(ctx, W, H, cellSize, t, c1, lw) {
    const cell  = cellSize * 0.25;
    const cols  = Math.ceil(W / cell) + 2;
    const rows  = Math.ceil(H / cell) + 2;
    const ox    = -W / 2;
    const oy    = -H / 2;
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw * 0.4;
    ctx.globalAlpha = 0.5;
    // Vertical lines
    for (let i = 0; i <= cols; i++) {
      const x = ox + i * cell + (Math.sin(t * 0.3 + i * 0.2) * cell * 0.1);
      ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, -oy); ctx.stroke();
    }
    // Horizontal lines
    for (let i = 0; i <= rows; i++) {
      const y = oy + i * cell + (Math.cos(t * 0.3 + i * 0.2) * cell * 0.1);
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(-ox, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
