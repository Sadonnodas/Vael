/**
 * layers/MathVisualizer.js
 * Port of all 8 mathematical constant visualisation modes.
 * Modes: path, tree, circle, chaos, spiral, walk, polar, lsystem
 */

class MathVisualizer extends BaseLayer {

  static manifest = {
    name: 'Math Visualizer',
    version: '1.0',
    params: [
      { id: 'constant',    label: 'Constant',    type: 'enum',  default: 'pi',    options: ['pi','e','phi','sqrt2','ln2','apery','euler-mascheroni','catalan'] },
      { id: 'mode',        label: 'Mode',        type: 'enum',  default: 'path',  options: ['path','tree','circle','chaos','spiral','walk','polar','lsystem'] },
      { id: 'colorMode',   label: 'Color mode',  type: 'enum',  default: 'rainbow', options: ['rainbow','digit','mono'] },
      { id: 'digitCount',  label: 'Digits',      type: 'int',   default: 800,  min: 50,  max: 2000 },
      { id: 'angle',       label: 'Angle',       type: 'float', default: 36,   min: 1,   max: 180  },
      { id: 'lineWidth',   label: 'Line width',  type: 'float', default: 1.2,  min: 0.3, max: 8    },
      { id: 'dotSize',     label: 'Dot size',    type: 'float', default: 2.5,  min: 0.5, max: 12   },
      { id: 'zoom',        label: 'Zoom',        type: 'float', default: 1.0,  min: 0.2, max: 4    },
      { id: 'audioTarget', label: 'Audio → angle', type: 'band', default: 'bass' },
      { id: 'hueShift',    label: 'Hue shift',   type: 'float', default: 0,    min: 0,   max: 360  },
    ],
  };

  constructor(id) {
    super(id, 'Math Visualizer');
    this.params = {
      constant:    'pi',
      mode:        'path',
      colorMode:   'rainbow',
      digitCount:  800,
      angle:       36,
      lineWidth:   1.2,
      dotSize:     2.5,
      zoom:        1.0,
      audioTarget: 'bass',
      hueShift:    0,
    };
    this._time       = 0;
    this._angleSmooth = 36;
    this._zoomSmooth  = 1.0;
    this._chaosPoints = [];
    this._chaosInit   = false;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._chaosInit = false;
  }

  setParam(id, value) {
    this.params[id] = value;
    if (id === 'constant' || id === 'mode') this._chaosInit = false;
  }

  update(audioData, videoData, dt) {
    this._time += dt;

    // Smooth angle with audio
    const audioVal = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    const targetAngle = this.params.angle + audioVal * 25;
    this._angleSmooth = VaelMath.lerp(this._angleSmooth, targetAngle, 0.06);

    const targetZoom = this.params.zoom + audioVal * 0.3;
    this._zoomSmooth = VaelMath.lerp(this._zoomSmooth, targetZoom, 0.04);
  }

  render(ctx, width, height) {
    const digits = this._getDigits();
    if (!digits) return;
    const mode = this.params.mode;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this._zoomSmooth, this._zoomSmooth);

    switch (mode) {
      case 'path':   this._drawPath(ctx, digits, width, height);   break;
      case 'tree':   this._drawTree(ctx, digits, width, height);   break;
      case 'circle': this._drawCircle(ctx, digits, width, height); break;
      case 'chaos':  this._drawChaos(ctx, digits, width, height);  break;
      case 'spiral': this._drawSpiral(ctx, digits, width, height); break;
      case 'walk':   this._drawWalk(ctx, digits, width, height);   break;
      case 'polar':  this._drawPolar(ctx, digits, width, height);  break;
      case 'lsystem':this._drawLSystem(ctx, digits, width, height);break;
    }
    ctx.restore();
  }

  // ── Helpers ──────────────────────────────────────────────────

  _getDigits() {
    const c = VaelConstants.CONSTANTS.find(c => c.id === this.params.constant);
    return c ? c.digits.slice(0, this.params.digitCount) : null;
  }

  _getColor(digit, index, total) {
    const shift = this.params.hueShift;
    switch (this.params.colorMode) {
      case 'digit':   return VaelColor.digitColor(parseInt(digit), shift, 0.85);
      case 'mono':    return VaelColor.mono(index / total);
      default:        return VaelColor.rainbow(index / total, shift + this._time * 8);
    }
  }

  // ── Mode: Winding path ───────────────────────────────────────

  _drawPath(ctx, digits, width, height) {
    const step  = Math.min(width, height) * 0.018;
    const angle = VaelMath.degToRad(this._angleSmooth);
    let x = 0, y = 0, dir = 0;

    for (let i = 0; i < digits.length - 1; i++) {
      const d  = parseInt(digits[i]);
      const nx = x + Math.cos(dir + angle * d) * step;
      const ny = y + Math.sin(dir + angle * d) * step;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = this._getColor(d, i, digits.length);
      ctx.lineWidth   = this.params.lineWidth;
      ctx.stroke();
      x = nx; y = ny;
      dir += angle * d / 5;
    }
  }

  // ── Mode: Branching tree ─────────────────────────────────────

  _drawTree(ctx, digits, width, height) {
    const baseLen = Math.min(width, height) * 0.18;
    ctx.translate(0, height * 0.35);
    this._branch(ctx, digits, 0, 0, -Math.PI / 2, baseLen, 0, 8);
  }

  _branch(ctx, digits, x, y, angle, len, depth, maxDepth) {
    if (depth >= maxDepth || len < 2) return;
    const d  = parseInt(digits[depth % digits.length]) || 5;
    const nx = x + Math.cos(angle) * len;
    const ny = y + Math.sin(angle) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = this._getColor(d, depth, maxDepth);
    ctx.lineWidth   = Math.max(0.5, this.params.lineWidth * (1 - depth / maxDepth) * 3);
    ctx.stroke();
    const spread = VaelMath.degToRad(this._angleSmooth);
    this._branch(ctx, digits, nx, ny, angle - spread, len * 0.68, depth + 1, maxDepth);
    this._branch(ctx, digits, nx, ny, angle + spread, len * 0.68, depth + 1, maxDepth);
    if (d > 5) this._branch(ctx, digits, nx, ny, angle, len * 0.55, depth + 1, maxDepth);
  }

  // ── Mode: String art (circle) ────────────────────────────────

  _drawCircle(ctx, digits, width, height) {
    const r    = Math.min(width, height) * 0.38;
    const n    = 10;
    const pts  = Array.from({ length: n }, (_, i) => ({
      x: Math.cos((i / n) * Math.PI * 2 - Math.PI / 2) * r,
      y: Math.sin((i / n) * Math.PI * 2 - Math.PI / 2) * r,
    }));

    // Draw digit nodes
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.params.dotSize * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = this._getColor(i, i, n);
      ctx.fill();
    });

    // Draw connecting lines
    for (let i = 0; i < digits.length - 1; i++) {
      const a = parseInt(digits[i]);
      const b = parseInt(digits[i + 1]);
      if (a === b) continue;
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.strokeStyle = this._getColor(a, i, digits.length);
      ctx.globalAlpha = 0.25;
      ctx.lineWidth   = this.params.lineWidth * 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ── Mode: Chaos game ─────────────────────────────────────────

  _drawChaos(ctx, digits, width, height) {
    const r = Math.min(width, height) * 0.4;

    // Attractor vertices based on digit count mod 3-7
    const sides = 3 + (parseInt(digits[0]) % 4);
    const verts = Array.from({ length: sides }, (_, i) => ({
      x: Math.cos((i / sides) * Math.PI * 2 - Math.PI / 2) * r,
      y: Math.sin((i / sides) * Math.PI * 2 - Math.PI / 2) * r,
    }));

    if (!this._chaosInit) {
      this._chaosPoints = [{ x: 0, y: 0 }];
      this._chaosInit = true;
    }

    let { x, y } = this._chaosPoints[this._chaosPoints.length - 1];
    const ratio = 0.5 + (parseInt(digits[1]) % 3) * 0.08;

    for (let i = 0; i < Math.min(digits.length, 600); i++) {
      const d  = parseInt(digits[i]) % sides;
      const v  = verts[d];
      x = x + (v.x - x) * ratio;
      y = y + (v.y - y) * ratio;
      ctx.beginPath();
      ctx.arc(x, y, this.params.dotSize * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = this._getColor(d, i, digits.length);
      ctx.fill();
    }
  }

  // ── Mode: Digit frequency spiral ────────────────────────────

  _drawSpiral(ctx, digits, width, height) {
    const maxR  = Math.min(width, height) * 0.42;
    const count = new Array(10).fill(0);
    digits.split('').forEach(d => count[parseInt(d)]++);
    const total = digits.length;

    for (let d = 0; d < 10; d++) {
      const freq = count[d] / total;
      const barH = freq * maxR * 6;
      const angle = (d / 10) * Math.PI * 2 - Math.PI / 2;
      const x1 = Math.cos(angle) * maxR * 0.15;
      const y1 = Math.sin(angle) * maxR * 0.15;
      const x2 = Math.cos(angle) * (maxR * 0.15 + barH);
      const y2 = Math.sin(angle) * (maxR * 0.15 + barH);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = this._getColor(d, d, 10);
      ctx.lineWidth   = this.params.lineWidth * 5;
      ctx.lineCap     = 'round';
      ctx.stroke();

      ctx.font = `${12 * this._zoomSmooth}px monospace`;
      ctx.fillStyle = this._getColor(d, d, 10);
      ctx.textAlign = 'center';
      ctx.fillText(d, x2 + Math.cos(angle) * 14, y2 + Math.sin(angle) * 14 + 4);
    }
  }

  // ── Mode: Random walk ────────────────────────────────────────

  _drawWalk(ctx, digits, width, height) {
    const step = Math.min(width, height) * 0.012;
    let x = 0, y = 0;
    const dirs = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
      [0, -1], [0, 1],
    ];

    for (let i = 0; i < digits.length; i++) {
      const d  = parseInt(digits[i]);
      const [dx, dy] = dirs[d];
      const nx = x + dx * step;
      const ny = y + dy * step;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = this._getColor(d, i, digits.length);
      ctx.lineWidth   = this.params.lineWidth;
      ctx.stroke();
      x = nx; y = ny;
    }

    // Mark start
    ctx.beginPath();
    ctx.arc(0, 0, this.params.dotSize * 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
  }

  // ── Mode: Polar flower ───────────────────────────────────────

  _drawPolar(ctx, digits, width, height) {
    const maxR = Math.min(width, height) * 0.42;
    const k    = parseInt(digits[0]) + 2;

    ctx.beginPath();
    for (let i = 0; i < digits.length; i++) {
      const d     = parseInt(digits[i]);
      const theta = (i / digits.length) * Math.PI * 2 * k;
      const r     = maxR * (0.3 + (d / 9) * 0.7);
      const x     = Math.cos(theta) * r;
      const y     = Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = this._getColor(parseInt(digits[0]), 0, 9);
    ctx.lineWidth   = this.params.lineWidth;
    ctx.stroke();

    // Overlay dots at digit positions
    for (let i = 0; i < Math.min(digits.length, 300); i++) {
      const d     = parseInt(digits[i]);
      const theta = (i / digits.length) * Math.PI * 2 * k;
      const r     = maxR * (0.3 + (d / 9) * 0.7);
      ctx.beginPath();
      ctx.arc(Math.cos(theta)*r, Math.sin(theta)*r, this.params.dotSize * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = this._getColor(d, i, digits.length);
      ctx.fill();
    }
  }

  // ── Mode: L-System plant ─────────────────────────────────────

  _drawLSystem(ctx, digits, width, height) {
    // Use digit values to seed L-system rules
    const angleStep = VaelMath.degToRad(this._angleSmooth);
    const len       = Math.min(width, height) * 0.06;

    ctx.translate(0, height * 0.38);

    const stack = [];
    let x = 0, y = 0, dir = -Math.PI / 2;
    let segCount = 0;
    const maxSegs = Math.min(digits.length * 2, 1200);

    for (let i = 0; i < digits.length && segCount < maxSegs; i++) {
      const d = parseInt(digits[i]);
      if (d < 3) {
        // Draw forward
        const nx = x + Math.cos(dir) * len * (0.5 + d * 0.2);
        const ny = y + Math.sin(dir) * len * (0.5 + d * 0.2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = this._getColor(d, segCount, maxSegs);
        ctx.lineWidth   = Math.max(0.4, this.params.lineWidth * (1 - segCount / maxSegs) * 2);
        ctx.stroke();
        x = nx; y = ny;
        segCount++;
      } else if (d < 5) {
        dir -= angleStep * (d - 3 + 1);
      } else if (d < 7) {
        dir += angleStep * (d - 5 + 1);
      } else if (d === 7) {
        stack.push({ x, y, dir });
      } else if (d === 8 && stack.length > 0) {
        ({ x, y, dir } = stack.pop());
      } else {
        dir -= angleStep * 0.5;
      }
    }
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}