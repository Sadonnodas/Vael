/**
 * layers/MathVisualizer.js
 *
 * FIXES:
 * - Tree and lsystem modes now respect buildMode — they clip to
 *   _buildCount depth/segments instead of ignoring it.
 * - ctx.translate() calls inside draw methods now use ctx.save/restore
 *   properly so translation doesn't accumulate across frames.
 * - buildLoop 'restart' and 'bounce' now reset correctly.
 * - Added 'restart' button via a new restartBuild() method called
 *   from the params panel via a manifest action.
 *
 * NEW COLOR MODES:
 * - 'hue-range'  — smooth gradient between colorA and colorB (user picks)
 * - 'warm'       — reds, oranges, yellows
 * - 'cool'       — blues, cyans, purples
 * - 'fire'       — black → red → orange → yellow
 * - 'ice'        — black → deep blue → cyan → white
 * - 'gold'       — deep brown → gold → bright yellow
 */

class MathVisualizer extends BaseLayer {

  static manifest = {
    name: 'Math Visualizer',
    version: '3.0',
    params: [
      { id: 'constant',    label: 'Constant',       type: 'enum',  default: 'pi',
        options: ['pi','e','phi','sqrt2','ln2','apery','euler-mascheroni','catalan'] },
      { id: 'mode',        label: 'Mode',           type: 'enum',  default: 'path',
        options: ['path','tree','circle','chaos','spiral','walk','polar','lsystem','wave','constellation'] },
      { id: 'colorMode',   label: 'Color mode',     type: 'enum',  default: 'rainbow',
        options: ['rainbow','hue-range','digit','mono','warm','cool','fire','ice','gold'] },
      { id: 'colorA',      label: 'Color A',        type: 'color', default: '#00d4aa' },
      { id: 'colorB',      label: 'Color B',        type: 'color', default: '#7c3ff0' },
      { id: 'digitCount',  label: 'Max digits',     type: 'int',   default: 800,  min: 50,  max: 2000 },
      { id: 'angle',       label: 'Angle',          type: 'float', default: 36,   min: 1,   max: 180  },
      { id: 'lineWidth',   label: 'Line width',     type: 'float', default: 1.2,  min: 0.3, max: 8    },
      { id: 'dotSize',     label: 'Dot size',       type: 'float', default: 2.5,  min: 0.5, max: 12   },
      { id: 'zoom',        label: 'Zoom',           type: 'float', default: 1.0,  min: 0.2, max: 4    },
      { id: 'hueShift',    label: 'Hue shift',      type: 'float', default: 0,    min: 0,   max: 360  },
      { id: 'buildMode',   label: 'Animate digits', type: 'bool',  default: false },
      { id: 'buildMin',    label: 'Start digits',   type: 'int',   default: 1,    min: 1,   max: 500  },
      { id: 'buildSpeed',  label: 'Grow speed',     type: 'float', default: 8,    min: 0.5, max: 120  },
      { id: 'buildLoop',   label: 'Loop mode',      type: 'enum',  default: 'restart',
        options: ['restart','bounce','once'] },
    ],
  };

  constructor(id) {
    super(id, 'Math Visualizer');
    this.params = {
      constant:    'pi',
      mode:        'path',
      colorMode:   'rainbow',
      colorA:      '#00d4aa',
      colorB:      '#7c3ff0',
      digitCount:  800,
      angle:       36,
      lineWidth:   1.2,
      dotSize:     2.5,
      zoom:        1.0,
      hueShift:    0,
      buildMode:   false,
      buildMin:    1,
      buildSpeed:  8,
      buildLoop:   'restart',
    };
    this._time        = 0;
    this._angleSmooth = 36;
    this._zoomSmooth  = 1.0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._chaosPoints = [];
    this._chaosInit   = false;
    this._buildCount  = 0;
    this._buildDir    = 1;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._chaosInit  = false;
    this._buildCount = 0;
    this._buildDir   = 1;
  }

  setParam(id, value) {
    this.params[id] = value;
    if (id === 'constant' || id === 'mode') {
      this._chaosInit  = false;
      this._buildCount = 0;
      this._buildDir   = 1;
    }
  }

  /** Restart the build animation from the beginning */
  restartBuild() {
    this._buildCount = 0;
    this._buildDir   = 1;
  }

  update(audioData, videoData, dt) {
    this._time += dt;

    const audioVal    = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth ?? 0, audioVal, 0.08);

    this._angleSmooth = VaelMath.lerp(this._angleSmooth, this.params.angle + audioVal * 25, 0.06);
    this._zoomSmooth  = VaelMath.lerp(this._zoomSmooth,  this.params.zoom  + audioVal * 0.3, 0.04);

    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 5);

    if (this.params.buildMode) {
      const min   = Math.max(1, this.params.buildMin || 1);
      const max   = this.params.digitCount;
      const speed = this.params.buildSpeed * (1 + this._audioSmooth * 1.5);

      if (this._buildCount === 0) this._buildCount = min;

      switch (this.params.buildLoop) {
        case 'bounce':
          this._buildCount += this._buildDir * dt * speed;
          if (this._buildCount >= max) { this._buildCount = max; this._buildDir = -1; }
          else if (this._buildCount <= min) { this._buildCount = min; this._buildDir = 1; }
          break;
        case 'once':
          if (this._buildDir > 0) {
            this._buildCount = Math.min(max, this._buildCount + dt * speed);
          }
          break;
        default: // restart
          this._buildCount += dt * speed;
          if (this._buildCount > max) this._buildCount = min;
      }
    }
  }

  render(ctx, width, height) {
    const allDigits = this._getDigits();
    if (!allDigits) return;

    const digits = this.params.buildMode && this._buildCount > 0
      ? allDigits.slice(0, Math.max(1, Math.floor(this._buildCount)))
      : allDigits;

    if (digits.length === 0) return;

    ctx.save();
    const beatScale = 1 + this._beatPulse * 0.06;
    ctx.scale(this._zoomSmooth * beatScale, this._zoomSmooth * beatScale);

    switch (this.params.mode) {
      case 'path':          this._drawPath(ctx, digits, width, height);          break;
      case 'tree':          this._drawTree(ctx, digits, width, height);          break;
      case 'circle':        this._drawCircle(ctx, digits, width, height);        break;
      case 'chaos':         this._drawChaos(ctx, digits, width, height);         break;
      case 'spiral':        this._drawSpiral(ctx, digits, width, height);        break;
      case 'walk':          this._drawWalk(ctx, digits, width, height);          break;
      case 'polar':         this._drawPolar(ctx, digits, width, height);         break;
      case 'lsystem':       this._drawLSystem(ctx, digits, width, height);       break;
      case 'wave':          this._drawWave(ctx, digits, width, height);          break;
      case 'constellation': this._drawConstellation(ctx, digits, width, height); break;
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
    const t     = index / Math.max(1, total);
    const d     = typeof digit === 'number' ? digit : parseInt(digit);

    switch (this.params.colorMode) {
      case 'digit':
        return VaelColor.digitColor(d, shift, 0.85);

      case 'mono':
        return VaelColor.mono(t);

      case 'hue-range': {
        // Blend between colorA and colorB along the sequence
        const [r1,g1,b1] = VaelColor.hexToRgb(this.params.colorA || '#00d4aa');
        const [r2,g2,b2] = VaelColor.hexToRgb(this.params.colorB || '#7c3ff0');
        const L = VaelMath.lerp;
        return VaelColor.rgbToHex(L(r1,r2,t), L(g1,g2,t), L(b1,b2,t));
      }

      case 'warm':
        return VaelColor.hsl(((t * 80) + shift) % 360, 0.9, 0.45 + t * 0.2);

      case 'cool':
        return VaelColor.hsl((200 + t * 80 + shift) % 360, 0.8, 0.45 + t * 0.2);

      case 'fire': {
        // Black → deep red → orange → bright yellow
        const fire_h = t * 60;  // 0 = red, 60 = yellow
        const fire_s = 1.0;
        const fire_l = 0.05 + t * 0.55;
        return VaelColor.hsl((fire_h + shift) % 360, fire_s, fire_l);
      }

      case 'ice': {
        // Dark blue → cyan → near-white
        const ice_h = 200 + t * 40;  // deep blue to cyan
        const ice_s = 0.9 - t * 0.4;
        const ice_l = 0.1 + t * 0.7;
        return VaelColor.hsl((ice_h + shift) % 360, ice_s, ice_l);
      }

      case 'gold': {
        // Brown → gold → bright
        const gold_h = 25 + t * 20;
        const gold_s = 0.85;
        const gold_l = 0.15 + t * 0.55;
        return VaelColor.hsl((gold_h + shift) % 360, gold_s, gold_l);
      }

      default: // rainbow
        return VaelColor.rainbow(t, shift + this._time * 8);
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
  // FIX: buildMode now controls maxDepth so the tree grows visibly.
  // FIX: ctx.save/restore wraps the translate so it doesn't accumulate.

  _drawTree(ctx, digits, width, height) {
    const baseLen = Math.min(width, height) * 0.18;

    // buildMode: map buildCount (0→digitCount) to depth (0→8)
    const fullDepth = 8;
    const maxDepth  = this.params.buildMode
      ? Math.max(1, Math.round((this._buildCount / this.params.digitCount) * fullDepth))
      : fullDepth;

    ctx.save();
    ctx.translate(0, height * 0.35);
    this._branch(ctx, digits, 0, 0, -Math.PI / 2, baseLen, 0, maxDepth);
    ctx.restore();
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
    const r   = Math.min(width, height) * 0.38;
    const n   = 10;
    const pts = Array.from({ length: n }, (_, i) => ({
      x: Math.cos((i / n) * Math.PI * 2 - Math.PI / 2) * r,
      y: Math.sin((i / n) * Math.PI * 2 - Math.PI / 2) * r,
    }));

    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.params.dotSize * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = this._getColor(i, i, n);
      ctx.fill();
    });

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
    const r     = Math.min(width, height) * 0.4;
    const sides = 3 + (parseInt(digits[0]) % 4);
    const verts = Array.from({ length: sides }, (_, i) => ({
      x: Math.cos((i / sides) * Math.PI * 2 - Math.PI / 2) * r,
      y: Math.sin((i / sides) * Math.PI * 2 - Math.PI / 2) * r,
    }));

    if (!this._chaosInit) {
      this._chaosPoints = [{ x: 0, y: 0 }];
      this._chaosInit   = true;
    }

    let { x, y } = this._chaosPoints[this._chaosPoints.length - 1];
    const ratio  = 0.5 + (parseInt(digits[1]) % 3) * 0.08;

    for (let i = 0; i < Math.min(digits.length, 600); i++) {
      const d = parseInt(digits[i]) % sides;
      const v = verts[d];
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
      const freq  = count[d] / total;
      const barH  = freq * maxR * 6;
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

      ctx.font      = `${12 * this._zoomSmooth}px monospace`;
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
      const d        = parseInt(digits[i]);
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
  // FIX: buildMode controls maxSegs, ctx.translate is wrapped in save/restore.

  _drawLSystem(ctx, digits, width, height) {
    const angleStep = VaelMath.degToRad(this._angleSmooth);
    const len       = Math.min(width, height) * 0.06;

    // buildMode: limit segments proportionally to _buildCount
    const totalPossible = Math.min(digits.length * 2, 1200);
    const maxSegs = this.params.buildMode
      ? Math.max(1, Math.round((this._buildCount / this.params.digitCount) * totalPossible))
      : totalPossible;

    ctx.save();
    ctx.translate(0, height * 0.38);

    const stack = [];
    let x = 0, y = 0, dir = -Math.PI / 2;
    let segCount = 0;

    for (let i = 0; i < digits.length && segCount < maxSegs; i++) {
      const d = parseInt(digits[i]);
      if (d < 3) {
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

    ctx.restore();
  }

  // ── Wave mode ────────────────────────────────────────────────

  _drawWave(ctx, digits, width, height) {
    const count  = Math.min(digits.length, 200);
    const layers = 8;
    const audio  = this._audioSmooth;
    const t      = this._time;
    const lw     = this.params.lineWidth;

    for (let l = 0; l < layers; l++) {
      const yBase = (l / (layers - 1) - 0.5) * height * 0.7;
      const amp   = (60 + audio * 120) * (1 + (digits[l] ?? 3) * 0.08);
      const freq  = 0.008 + (digits[(l * 3) % count] ?? 1) * 0.001;
      const phase = t * (0.3 + l * 0.05) + l * Math.PI / layers;

      ctx.beginPath();
      ctx.lineWidth   = lw * (0.5 + (layers - l) / layers);
      ctx.strokeStyle = this._getColor(digits[l] ?? l, l, layers);
      ctx.globalAlpha = 0.6 + audio * 0.3;

      for (let px = -width / 2; px <= width / 2; px += 3) {
        const dy = Math.sin(px * freq + phase) * amp;
        const y  = yBase + dy;
        if (px === -width / 2) ctx.moveTo(px, y);
        else                   ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Constellation mode ────────────────────────────────────────

  _drawConstellation(ctx, digits, width, height) {
    const count = Math.min(digits.length, this.params.digitCount);
    const audio = this._audioSmooth;
    const t     = this._time;
    const W     = width * 0.45, H = height * 0.45;
    const lw    = this.params.lineWidth;

    const pts = [];
    for (let i = 0; i + 1 < count; i += 2) {
      const d1 = parseInt(digits[i])   / 9;
      const d2 = parseInt(digits[i+1]) / 9;
      pts.push({
        x:   (d1 - 0.5) * W * 2,
        y:   (d2 - 0.5) * H * 2,
        r:   1.5 + parseInt(digits[i]) * 0.4,
      });
    }

    const threshold = 60 + audio * 80 + this._beatPulse * 40;

    ctx.lineWidth = lw * 0.5;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < Math.min(i + 12, pts.length); j++) {
        const dx   = pts[j].x - pts[i].x;
        const dy   = pts[j].y - pts[i].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < threshold) {
          ctx.beginPath();
          ctx.strokeStyle = this._getColor(digits[i], i, count);
          ctx.globalAlpha = (1 - dist / threshold) * (0.3 + audio * 0.3);
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }

    pts.forEach((p, i) => {
      const pulse = (Math.sin(t * 0.8 + i * 0.3) + 1) * 0.5;
      const r     = p.r * (1 + audio * 0.5 + pulse * 0.3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fillStyle   = this._getColor(digits[i], i, count);
      ctx.globalAlpha = 0.7 + pulse * 0.3;
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
