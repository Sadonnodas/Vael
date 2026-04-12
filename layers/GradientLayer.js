/**
 * layers/GradientLayer.js
 * Full-screen gradient with multiple modes.
 *
 * FIXED:
 * - Colors now use hex color pickers (colorA/B/C) instead of broken hue floats
 * - audioReact defaults to 0 so it doesn't react without explicit modulation
 * - _hueOffset only advances if speed > 0, doesn't randomly drift colors
 * - Removed implicit audio-driven hue shift from render() — use ModMatrix instead
 */
class GradientLayer extends BaseLayer {

  static manifest = {
    name: 'Gradient',
    version: '3.0',
    params: [
      { id: 'mode',       label: 'Mode',          type: 'enum',  default: 'linear',
        options: ['linear','radial','conic','diagonal-flow','aurora','burst','sweep','spiral','diamond','mesh','sunburst','curtain','spotlight','dusk','prism'] },
      { id: 'colorA',     label: 'Color A',       type: 'color', default: '#1a3a6b' },
      { id: 'colorB',     label: 'Color B',       type: 'color', default: '#4b0082' },
      { id: 'colorC',     label: 'Color C (mid)', type: 'color', default: '#0d2240' },
      { id: 'speed',      label: 'Rotate speed',  type: 'float', default: 0.06, min: 0, max: 1 },
      { id: 'angle',      label: 'Angle (deg)',   type: 'float', default: 135,  min: 0, max: 360 },
      { id: 'audioReact', label: 'Audio react',   type: 'float', default: 0,    min: 0, max: 1 },
    ],
  };

  constructor(id) {
    super(id, 'Gradient');
    this.params = {
      mode:       'linear',
      colorA:     '#1a3a6b',
      colorB:     '#4b0082',
      colorC:     '#0d2240',
      speed:      0.06,
      angle:      135,
      audioReact: 0,
    };
    this._time        = 0;
    this._hueOffset   = 0;
    this._audioSmooth = 0;
    this._angleSmooth = 135;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    // Migrate old hue-based params to hex colors
    if (typeof this.params.hueA === 'number') {
      this.params.colorA = VaelColor.hsl(this.params.hueA, this.params.saturation ?? 0.65, this.params.lightness ?? 0.3);
      this.params.colorB = VaelColor.hsl(this.params.hueB ?? this.params.hueA + 60, this.params.saturation ?? 0.65, this.params.lightness ?? 0.3);
      this.params.colorC = VaelColor.hsl(this.params.hueC ?? this.params.hueA + 30, this.params.saturation ?? 0.65, this.params.lightness ?? 0.2);
      delete this.params.hueA; delete this.params.hueB; delete this.params.hueC;
      delete this.params.saturation; delete this.params.lightness;
    }
    this._angleSmooth = this.params.angle;
  }

  update(audioData, videoData, dt) {
    this._time += dt;
    const av = audioData?.isActive ? (audioData.bass ?? 0) * (this.params.audioReact ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.06);
    if (this.params.speed > 0) {
      this._hueOffset += dt * this.params.speed * 20;
    }
    this._angleSmooth = VaelMath.lerp(
      this._angleSmooth,
      this.params.angle + this._audioSmooth * 15,
      0.04
    );
  }

  render(ctx, width, height) {
    const { mode, colorA, colorB, colorC, audioReact } = this.params;
    const a  = this._audioSmooth;
    const W  = width, H = height;

    // Parse hex colors — with audio brightening applied
    const cA = this._brighten(colorA, a * 0.15 * audioReact);
    const cB = this._brighten(colorB, a * 0.10 * audioReact);
    const cC = this._brighten(colorC, a * 0.08 * audioReact);

    let grad;

    switch (mode) {
      case 'radial': {
        const r = Math.max(W, H) * (0.6 + a * 0.2 * audioReact);
        grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0,   cA);
        grad.addColorStop(0.5, cC);
        grad.addColorStop(1,   cB);
        break;
      }
      case 'conic': {
        const segs = 6;
        const angleOff = this._angleSmooth * Math.PI / 180;
        for (let i = 0; i < segs; i++) {
          const a0 = angleOff + (i / segs) * Math.PI * 2;
          const a1 = angleOff + ((i + 1) / segs) * Math.PI * 2;
          const t  = i / segs;
          const c  = t < 0.5 ? this._mixColors(cA, cC, t * 2) : this._mixColors(cC, cB, (t - 0.5) * 2);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, Math.max(W, H), a0, a1);
          ctx.fillStyle = c;
          ctx.fill();
        }
        return;
      }
      case 'diagonal-flow': {
        const ang1 = VaelMath.degToRad(this._angleSmooth);
        const ang2 = VaelMath.degToRad(this._angleSmooth + 90);
        const d    = Math.max(W, H);
        const g1   = ctx.createLinearGradient(
          -Math.cos(ang1)*d, -Math.sin(ang1)*d,
           Math.cos(ang1)*d,  Math.sin(ang1)*d
        );
        g1.addColorStop(0, cA); g1.addColorStop(1, cC);
        ctx.fillStyle = g1;
        ctx.fillRect(-W/2, -H/2, W, H);
        const g2 = ctx.createLinearGradient(
          -Math.cos(ang2)*d, -Math.sin(ang2)*d,
           Math.cos(ang2)*d,  Math.sin(ang2)*d
        );
        g2.addColorStop(0, 'transparent'); g2.addColorStop(1, cB);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = g2;
        ctx.fillRect(-W/2, -H/2, W, H);
        ctx.globalAlpha = 1;
        return;
      }
      case 'aurora': {
        // Layered horizontal bands mimicking aurora borealis
        const t = this._time;
        for (let band = 0; band < 3; band++) {
          const y  = H * (0.3 + band * 0.2 + Math.sin(t * 0.3 + band * 1.2) * 0.08) - H/2;
          const bh = H * (0.15 + Math.sin(t * 0.2 + band) * 0.05);
          const c  = band === 0 ? cA : band === 1 ? cC : cB;
          const g  = ctx.createLinearGradient(0, y - bh, 0, y + bh);
          g.addColorStop(0,   'transparent');
          g.addColorStop(0.4, c);
          g.addColorStop(0.6, c);
          g.addColorStop(1,   'transparent');
          ctx.fillStyle = g;
          ctx.fillRect(-W/2, y - bh, W, bh * 2);
        }
        return;
      }
      case 'burst': {
        // Radial burst: multiple rings emanating from centre
        const t2 = this._time;
        for (let ring = 0; ring < 4; ring++) {
          const phase = (t2 * 0.3 + ring * 0.25) % 1;
          const r1    = Math.max(W, H) * phase * 0.9;
          const r2    = Math.max(W, H) * (phase + 0.12);
          const g     = ctx.createRadialGradient(0, 0, r1, 0, 0, r2);
          const c     = ring % 2 === 0 ? cA : cB;
          g.addColorStop(0,   'transparent');
          g.addColorStop(0.4, c);
          g.addColorStop(1,   'transparent');
          ctx.fillStyle   = g;
          ctx.globalAlpha = 0.5 * (1 - phase);
          ctx.fillRect(-W/2, -H/2, W, H);
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'sweep': {
        // Single rotating beam of colour
        const sweepAngle = this._angleSmooth * Math.PI / 180 + this._time * 0.4;
        const d = Math.max(W, H);
        const g = ctx.createLinearGradient(
          Math.cos(sweepAngle) * d * -0.5, Math.sin(sweepAngle) * d * -0.5,
          Math.cos(sweepAngle) * d * 0.5,  Math.sin(sweepAngle) * d * 0.5
        );
        g.addColorStop(0,    cB);
        g.addColorStop(0.45, 'transparent');
        g.addColorStop(0.5,  cA);
        g.addColorStop(0.55, 'transparent');
        g.addColorStop(1,    cC);
        grad = g;
        break;
      }
      case 'spiral': {
        // Approximated spiral: stacked offset radial gradients
        const spiralT = this._time * 0.25;
        for (let i = 0; i < 6; i++) {
          const ang   = spiralT + (i / 6) * Math.PI * 2;
          const ox    = Math.cos(ang) * Math.min(W, H) * 0.15;
          const oy    = Math.sin(ang) * Math.min(W, H) * 0.15;
          const r3    = Math.max(W, H) * 0.6;
          const g     = ctx.createRadialGradient(ox, oy, 0, ox, oy, r3);
          const c     = i % 2 === 0 ? cA : cB;
          g.addColorStop(0,   c);
          g.addColorStop(0.5, cC);
          g.addColorStop(1,   'transparent');
          ctx.fillStyle   = g;
          ctx.globalAlpha = 0.25;
          ctx.fillRect(-W/2, -H/2, W, H);
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'diamond': {
        // Diamond / rhombus gradient using rotated linear
        const rad45 = (this._angleSmooth + 45) * Math.PI / 180;
        const d4    = Math.max(W, H);
        const g1    = ctx.createLinearGradient(
          -Math.cos(rad45)*d4, -Math.sin(rad45)*d4,
           Math.cos(rad45)*d4,  Math.sin(rad45)*d4
        );
        g1.addColorStop(0, cA); g1.addColorStop(0.5, cC); g1.addColorStop(1, cB);
        ctx.fillStyle = g1;
        ctx.fillRect(-W/2, -H/2, W, H);
        const rad135 = (this._angleSmooth + 135) * Math.PI / 180;
        const g2 = ctx.createLinearGradient(
          -Math.cos(rad135)*d4, -Math.sin(rad135)*d4,
           Math.cos(rad135)*d4,  Math.sin(rad135)*d4
        );
        g2.addColorStop(0, 'transparent'); g2.addColorStop(0.5, cA); g2.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = g2;
        ctx.fillRect(-W/2, -H/2, W, H);
        ctx.globalAlpha = 1;
        return;
      }
      case 'mesh': {
        // 3×3 grid of overlapping radial gradients — soft colour mesh
        const meshR = Math.max(W, H) * 0.6;
        const pts   = [
          [-W*0.35, -H*0.35, cA], [0, -H*0.35, cC], [W*0.35, -H*0.35, cB],
          [-W*0.35,  0,      cC], [0,  0,       cA], [W*0.35,  0,      cC],
          [-W*0.35,  H*0.35, cB], [0,  H*0.35,  cC], [W*0.35,  H*0.35, cA],
        ];
        pts.forEach(([mx, my, mc], idx) => {
          const drift = this._time * 0.08 + idx;
          const ox = mx + Math.sin(drift) * W * 0.06;
          const oy = my + Math.cos(drift * 0.7) * H * 0.06;
          const g  = ctx.createRadialGradient(ox, oy, 0, ox, oy, meshR);
          g.addColorStop(0, mc); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.globalAlpha = 0.45;
          ctx.fillRect(-W/2, -H/2, W, H);
        });
        ctx.globalAlpha = 1;
        return;
      }
      case 'sunburst': {
        // Alternating coloured wedges emanating from centre
        const segments = 12;
        const sunT     = this._time * 0.15;
        for (let i = 0; i < segments; i++) {
          const a0 = (i / segments) * Math.PI * 2 + sunT;
          const a1 = ((i + 1) / segments) * Math.PI * 2 + sunT;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, Math.max(W, H), a0, a1);
          ctx.fillStyle   = i % 2 === 0 ? cA : cB;
          ctx.globalAlpha = i % 2 === 0 ? 0.7 : 0.4;
          ctx.fill();
        }
        // Soft centre fade
        const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(W, H) * 0.5);
        sg.addColorStop(0, cC); sg.addColorStop(1, 'transparent');
        ctx.fillStyle = sg; ctx.globalAlpha = 0.6;
        ctx.fillRect(-W/2, -H/2, W, H);
        ctx.globalAlpha = 1;
        return;
      }
      case 'curtain': {
        // Vertical bands like a stage curtain
        const bands = 6;
        const cT    = this._time * 0.12;
        for (let i = 0; i < bands; i++) {
          const x0    = -W/2 + (i / bands) * W;
          const x1    = x0 + W / bands;
          const sway  = Math.sin(cT + i * 1.1) * W * 0.04;
          const g     = ctx.createLinearGradient(x0 + sway, 0, x1 + sway, 0);
          const c     = i % 2 === 0 ? cA : cB;
          g.addColorStop(0,   'transparent');
          g.addColorStop(0.3, c);
          g.addColorStop(0.7, c);
          g.addColorStop(1,   'transparent');
          ctx.fillStyle = g;
          ctx.fillRect(x0 + sway - 20, -H/2, W / bands + 40, H);
        }
        return;
      }
      case 'spotlight': {
        // Moving spotlight on a dark background
        const spT = this._time * 0.3;
        const sx  = Math.sin(spT)       * W * 0.3;
        const sy  = Math.cos(spT * 0.7) * H * 0.25;
        ctx.fillStyle = cC; ctx.fillRect(-W/2, -H/2, W, H);
        const sg2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.min(W, H) * 0.55);
        sg2.addColorStop(0, cA); sg2.addColorStop(0.6, cB); sg2.addColorStop(1, 'transparent');
        ctx.fillStyle = sg2; ctx.fillRect(-W/2, -H/2, W, H);
        return;
      }
      case 'dusk': {
        // Horizon gradient: dark sky → warm horizon → dark ground
        const duskAng = VaelMath.degToRad(this._angleSmooth);
        const d5      = Math.max(W, H);
        grad = ctx.createLinearGradient(
          -Math.cos(duskAng) * d5, -Math.sin(duskAng) * d5,
           Math.cos(duskAng) * d5,  Math.sin(duskAng) * d5
        );
        grad.addColorStop(0,    cB);
        grad.addColorStop(0.35, cA);
        grad.addColorStop(0.5,  cC);
        grad.addColorStop(0.65, cA);
        grad.addColorStop(1,    cB);
        break;
      }
      case 'prism': {
        // Full-spectrum prism: rainbow band across the canvas
        const prismAng = VaelMath.degToRad(this._angleSmooth);
        const d6       = Math.max(W, H);
        const pg = ctx.createLinearGradient(
          -Math.cos(prismAng) * d6, -Math.sin(prismAng) * d6,
           Math.cos(prismAng) * d6,  Math.sin(prismAng) * d6
        );
        pg.addColorStop(0,    '#ff0000');
        pg.addColorStop(0.17, '#ff9900');
        pg.addColorStop(0.33, '#ffff00');
        pg.addColorStop(0.5,  '#00cc00');
        pg.addColorStop(0.67, '#0066ff');
        pg.addColorStop(0.83, '#6600cc');
        pg.addColorStop(1,    '#cc00cc');
        grad = pg;
        break;
      }
      default: { // linear
        const rad = VaelMath.degToRad(this._angleSmooth);
        const d   = Math.max(W, H);
        grad = ctx.createLinearGradient(
          -Math.cos(rad)*d, -Math.sin(rad)*d,
           Math.cos(rad)*d,  Math.sin(rad)*d
        );
        grad.addColorStop(0,   cA);
        grad.addColorStop(0.5, cC);
        grad.addColorStop(1,   cB);
      }
    }

    ctx.fillStyle = grad;
    ctx.fillRect(-W/2, -H/2, W, H);
  }

  // Brighten a hex color by adding lightness
  _brighten(hex, amount) {
    if (!amount || amount <= 0) return hex || '#000000';
    const [r, g, b] = this._hexToRgb(hex || '#000000');
    const clamp = v => Math.min(255, Math.round(v + amount * 255));
    return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
  }

  _hexToRgb(hex) {
    const h = hex.replace('#','');
    if (h.length === 3) {
      return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
    }
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }

  _mixColors(hexA, hexB, t) {
    // hexA/hexB might be 'transparent' or rgb() strings — handle gracefully
    try {
      const [r1,g1,b1] = this._hexToRgb(hexA.startsWith('#') ? hexA : '#000000');
      const [r2,g2,b2] = this._hexToRgb(hexB.startsWith('#') ? hexB : '#000000');
      return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
    } catch { return hexA; }
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
