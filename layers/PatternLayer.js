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
      { id: 'pattern',     label: 'Pattern',      type: 'enum',  default: 'star', triggersRefresh: true,
        options: ['star','mandala','hexgrid','circles','lissajous','spirograph','flower','grid','triangle','rings','weave','rays','rose','maze','dots'] },
      { id: 'color',       label: 'Color',         type: 'color', default: '#ffffff' },
      { id: 'color2',      label: 'Color 2',       type: 'color', default: '#00d4aa' },
      { id: 'size',        label: 'Size',          type: 'float', default: 1.0, min: 0.1, max: 4   },
      { id: 'speed',       label: 'Speed',         type: 'float', default: 0.3, min: 0,   max: 3   },
      { id: 'complexity',  label: 'Complexity',    type: 'int',   default: 5,   min: 2,   max: 20  },
      { id: 'lineWidth',   label: 'Line width',    type: 'float', default: 1.5, min: 0.5, max: 8   },
      { id: 'filled',      label: 'Filled',        type: 'bool',  default: false,
        showWhen: { pattern: ['star','circles','flower','mandala'] } },
      { id: 'hueShift',   label: 'Hue shift',     type: 'float', default: 0,   min: 0,   max: 360 },
      { id: 'audioReact',  label: 'Audio react',  type: 'float', default: 0,   min: 0,   max: 1   },
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
      hueShift:    0,
      audioReact:  0,
    };
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    this._time += dt * this.params.speed;
    const av = audioData?.isActive ? (audioData.bass ?? 0) * (this.params.audioReact ?? 0.3) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    const scale    = this.params.size * (1 + this._audioSmooth * 0.5 + this._beatPulse * 0.08);
    const baseSize = Math.min(width, height) * 0.35 * scale;
    const t        = this._time;
    const n        = this.params.complexity;
    const lw       = this.params.lineWidth;
    const filled   = this.params.filled;
    const hueShift = this.params.hueShift || 0;

    // Apply hue rotation to colors
    const c1 = hueShift ? this._hueRotateHex(this.params.color,  hueShift) : this.params.color;
    const c2 = hueShift ? this._hueRotateHex(this.params.color2, hueShift) : this.params.color2;

    ctx.save();
    ctx.lineWidth   = lw;
    ctx.strokeStyle = c1;
    ctx.fillStyle   = c1;

    switch (this.params.pattern) {
      case 'star':        this._drawStar(ctx, baseSize, n, t, c1, c2, filled); break;
      case 'mandala':     this._drawMandala(ctx, baseSize, n, t, c1, c2, lw, filled); break;
      case 'hexgrid':     this._drawHexgrid(ctx, width, height, baseSize, t, c1, lw); break;
      case 'circles':     this._drawCircles(ctx, baseSize, n, t, c1, c2, lw, filled); break;
      case 'lissajous':   this._drawLissajous(ctx, baseSize, n, t, c1, lw);   break;
      case 'spirograph':  this._drawSpirograph(ctx, baseSize, n, t, c1, c2, lw); break;
      case 'flower':      this._drawFlower(ctx, baseSize, n, t, c1, c2, filled); break;
      case 'grid':        this._drawGrid(ctx, width, height, baseSize, t, c1, lw); break;
      case 'triangle':    this._drawTriangle(ctx, baseSize, n, t, c1, c2, lw, filled); break;
      case 'rings':       this._drawRings(ctx, baseSize, n, t, c1, c2, lw); break;
      case 'weave':       this._drawWeave(ctx, width, height, baseSize, t, c1, c2, lw); break;
      case 'rays':        this._drawRays(ctx, baseSize, n, t, c1, c2, lw); break;
      case 'rose':        this._drawRose(ctx, baseSize, n, t, c1, lw); break;
      case 'maze':        this._drawMaze(ctx, width, height, baseSize, t, c1, lw); break;
      case 'dots':        this._drawDots(ctx, width, height, baseSize, n, t, c1, c2); break;
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

  _drawMandala(ctx, r, n, t, c1, c2, lw, filled) {
    const rings    = Math.max(2, Math.floor(n / 2));
    const petals   = Math.max(4, n);
    const hueShift = this.params.hueShift || 0;

    // Outer petal ring
    for (let i = 0; i < petals; i++) {
      const a   = (i / petals) * Math.PI * 2 + t * 0.2;
      const rot = (i / petals) * Math.PI * 2;
      ctx.save();
      ctx.rotate(rot + t * 0.15);

      // Petal shape using bezier curves
      const pr = r * 0.45;
      const pc = r * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(pr * 0.5, pc * 0.3, pr * 0.8, pc * 0.7, 0, pc);
      ctx.bezierCurveTo(-pr * 0.8, pc * 0.7, -pr * 0.5, pc * 0.3, 0, 0);
      ctx.closePath();

      const col = i % 2 === 0 ? c1 : c2;
      if (filled) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = col;
      ctx.lineWidth   = lw;
      ctx.stroke();
      ctx.restore();
    }

    // Inner rings with rotational symmetry
    for (let ring = 1; ring <= rings; ring++) {
      const rr    = r * (ring / (rings + 1)) * 0.85;
      const count = ring * (petals < 8 ? 4 : 3);
      const dir   = ring % 2 === 0 ? 1 : -1;
      const rot   = t * 0.25 * dir;

      ctx.strokeStyle = ring % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw * Math.max(0.3, 1 - ring / rings);

      // Dots or small shapes at each node
      for (let i = 0; i < count; i++) {
        const a  = (i / count) * Math.PI * 2 + rot;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        const sr = rr * 0.12;

        ctx.beginPath();
        ctx.arc(px, py, sr, 0, Math.PI * 2);
        if (filled) {
          ctx.fillStyle = ring % 2 === 0 ? c1 : c2;
          ctx.globalAlpha = 0.6;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();

        // Connect to next node
        const a2  = ((i + 1) / count) * Math.PI * 2 + rot;
        const px2 = Math.cos(a2) * rr;
        const py2 = Math.sin(a2) * rr;
        ctx.beginPath();
        ctx.moveTo(px, py);
        // Curved connector through center direction
        const mx = (px + px2) / 2 * 0.7;
        const my = (py + py2) / 2 * 0.7;
        ctx.quadraticCurveTo(mx, my, px2, py2);
        ctx.stroke();
      }

      // Ring circle
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Center ornament
    const cr = r * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, Math.PI * 2);
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw;
    if (filled) { ctx.fillStyle = c1; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();

    // Spoke lines
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + t * 0.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * cr, Math.sin(a) * cr);
      ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw * 0.4;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
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

  // ── Sierpinski triangle (recursive subdivisions) ─────────────
  _drawTriangle(ctx, r, n, t, c1, c2, lw, filled) {
    const depth = Math.max(1, Math.min(n - 1, 5));
    const rot   = t * 0.2;
    ctx.save();
    ctx.rotate(rot);
    this._sierpinski(ctx, 0, -r * 0.7, r * 0.9, 0, depth, c1, c2, lw, filled);
    ctx.restore();
  }

  _sierpinski(ctx, x1, y1, size, depth, maxDepth, c1, c2, lw, filled) {
    const h  = size * Math.sqrt(3) / 2;
    const ax = x1,         ay = y1;
    const bx = x1 - size/2, by = y1 + h;
    const cx2 = x1 + size/2, cy2 = y1 + h;
    if (depth === 0) {
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2);
      ctx.closePath();
      const col = depth % 2 === 0 ? c1 : c2;
      ctx.strokeStyle = col; ctx.lineWidth = lw * 0.5;
      if (filled) { ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.stroke();
      return;
    }
    const half = size / 2;
    this._sierpinski(ctx, x1,         y1,     half, depth - 1, maxDepth, c1, c2, lw, filled);
    this._sierpinski(ctx, x1 - half/2, y1 + h/2, half, depth - 1, maxDepth, c2, c1, lw, filled);
    this._sierpinski(ctx, x1 + half/2, y1 + h/2, half, depth - 1, maxDepth, c1, c2, lw, filled);
  }

  // ── Concentric animated rings ────────────────────────────────
  _drawRings(ctx, r, n, t, c1, c2, lw) {
    for (let i = 1; i <= n; i++) {
      const rr    = r * (i / n);
      const phase = t + i * 0.4;
      const pulse = Math.sin(phase) * 0.07 + 1;
      ctx.beginPath();
      ctx.arc(0, 0, rr * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw * (1.5 - i / n);
      ctx.globalAlpha = 0.5 + 0.5 * (i / n);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Interlocking diagonal weave ──────────────────────────────
  _drawWeave(ctx, W, H, cellSize, t, c1, c2, lw) {
    const cell = cellSize * 0.2;
    ctx.lineWidth   = lw * 0.6;
    ctx.globalAlpha = 0.7;
    for (let i = -Math.ceil(W / cell); i < Math.ceil(W / cell); i++) {
      const x = i * cell + Math.sin(t * 0.4 + i * 0.3) * cell * 0.12;
      ctx.beginPath();
      ctx.moveTo(x, -H / 2); ctx.lineTo(x + H, H / 2);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, -H / 2); ctx.lineTo(x - H, H / 2);
      ctx.strokeStyle = i % 2 === 0 ? c2 : c1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Rotating rays from centre ────────────────────────────────
  _drawRays(ctx, r, n, t, c1, c2, lw) {
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + t * 0.3;
      const len   = r * (0.5 + 0.5 * Math.abs(Math.sin(t + i)));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
      ctx.lineWidth   = lw * (1 + Math.sin(t * 0.8 + i) * 0.5);
      ctx.globalAlpha = 0.4 + 0.6 * (i / n);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Rose curve (r = cos(k*θ)) ────────────────────────────────
  _drawRose(ctx, r, n, t, c1, lw) {
    const k = n % 2 === 0 ? n : n;  // odd k → n petals, even k → 2n petals
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    const steps = 800;
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2 * (k % 2 === 0 ? 2 : 1);
      const rr    = r * Math.cos(k * theta + t * 0.15);
      const x     = rr * Math.cos(theta);
      const y     = rr * Math.sin(theta);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ── Recursive maze-like grid ─────────────────────────────────
  _drawMaze(ctx, W, H, cellSize, t, c1, lw) {
    const cell = cellSize * 0.22;
    const cols = Math.ceil(W / cell / 2);
    const rows = Math.ceil(H / cell / 2);
    ctx.strokeStyle = c1;
    ctx.lineWidth   = lw * 0.5;
    ctx.globalAlpha = 0.6;
    for (let col = -cols; col <= cols; col++) {
      for (let row = -rows; row <= rows; row++) {
        const x = col * cell;
        const y = row * cell;
        // Deterministic "random" wall choice based on grid position + slow time
        const seed = Math.abs(Math.sin(col * 7.3 + row * 13.7 + Math.floor(t * 0.2) * 99));
        if (seed < 0.5) {
          // Horizontal wall segment
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x + cell, y);
          ctx.stroke();
        } else {
          // Vertical wall segment
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x, y + cell);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Dot matrix with breathing animation ──────────────────────
  _drawDots(ctx, W, H, cellSize, n, t, c1, c2) {
    const spacing = cellSize * (0.18 + (20 - n) * 0.008); // more complexity = tighter grid
    const cols    = Math.ceil(W / spacing / 2) + 1;
    const rows    = Math.ceil(H / spacing / 2) + 1;
    for (let col = -cols; col <= cols; col++) {
      for (let row = -rows; row <= rows; row++) {
        const x    = col * spacing;
        const y    = row * spacing;
        const dist = Math.sqrt(x * x + y * y);
        const wave = Math.sin(dist * 0.04 - t * 2 + (col + row) * 0.15);
        const r    = Math.max(0.5, (cellSize * 0.05) * (0.5 + wave * 0.5));
        const mix  = (wave + 1) / 2;
        // Interpolate between c1 and c2 per dot
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle   = mix > 0.5 ? c1 : c2;
        ctx.globalAlpha = 0.4 + mix * 0.6;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _hueRotateHex(hex, deg) {
    // Parse hex → RGB → HSL → rotate H → back to hex
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
    const d=max-min;
    let h=0,s=0;
    if(d>0){ s=l>0.5?d/(2-max-min):d/(max+min);
      h=max===r?((g-b)/d+(g<b?6:0))/6:max===g?((b-r)/d+2)/6:((r-g)/d+4)/6; }
    h=(h+(deg/360))%1; if(h<0)h+=1;
    if(s===0){ const v=Math.round(l*255); return `#${v.toString(16).padStart(2,'0').repeat(3)}`; }
    const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
    const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
    const nr=Math.round(hue2rgb(p,q,h+1/3)*255);
    const ng=Math.round(hue2rgb(p,q,h)*255);
    const nb=Math.round(hue2rgb(p,q,h-1/3)*255);
    return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
