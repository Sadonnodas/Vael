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
        options: ['linear','radial','conic','diagonal-flow','aurora'] },
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
