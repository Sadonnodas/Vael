/**
 * layers/GradientLayer.js
 * Full-screen gradient with multiple modes, audio-reactive hue shift,
 * animated rotation, and radial/conic options.
 */
class GradientLayer extends BaseLayer {

  static manifest = {
    name: 'Gradient',
    version: '2.0',
    params: [
      { id: 'mode',        label: 'Mode',          type: 'enum',  default: 'linear',
        options: ['linear','radial','conic','diagonal-flow'] },
      { id: 'hueA',        label: 'Hue A',         type: 'float', default: 220, min: 0,   max: 360 },
      { id: 'hueB',        label: 'Hue B',         type: 'float', default: 280, min: 0,   max: 360 },
      { id: 'hueC',        label: 'Hue C (mid)',   type: 'float', default: 250, min: 0,   max: 360 },
      { id: 'saturation',  label: 'Saturation',    type: 'float', default: 0.65, min: 0,  max: 1   },
      { id: 'lightness',   label: 'Lightness',     type: 'float', default: 0.12, min: 0,  max: 0.6 },
      { id: 'speed',       label: 'Rotate speed',  type: 'float', default: 0.06, min: 0,  max: 1   },
      { id: 'angle',       label: 'Angle (deg)',   type: 'float', default: 135, min: 0,   max: 360 },
      { id: 'audioReact',  label: 'Audio react',   type: 'float', default: 0.5, min: 0,   max: 1   },
    ],
  };

  constructor(id) {
    super(id, 'Gradient');
    this.params = {
      mode:        'linear',
      hueA:        220,
      hueB:        280,
      hueC:        250,
      saturation:  0.65,
      lightness:   0.12,
      speed:       0.06,
      angle:       135,
      audioReact:  0.5,
    };
    this._time        = 0;
    this._hueOffset   = 0;
    this._audioSmooth = 0;
    this._angleSmooth = 135;
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    this._time += dt;
    const av = audioData?.isActive ? (audioData.bass ?? 0) * (this.params.audioReact ?? 0.5) : 0;
    this._audioSmooth  = VaelMath.lerp(this._audioSmooth, av, 0.06);
    this._hueOffset   += dt * this.params.speed * 20;
    this._angleSmooth  = VaelMath.lerp(
      this._angleSmooth,
      this.params.angle + this._audioSmooth * 15,
      0.04
    );
  }

  render(ctx, width, height) {
    const { mode, hueA, hueB, hueC, saturation, audioReact } = this.params;
    const off = this._hueOffset;
    const a   = this._audioSmooth;
    const lit = this.params.lightness + a * 0.10;
    const sat = VaelMath.clamp(saturation + a * 0.15, 0, 1);

    const cA = VaelColor.hsl((hueA + off) % 360, sat, lit);
    const cB = VaelColor.hsl((hueB + off) % 360, sat, lit * 0.7);
    const cC = VaelColor.hsl((hueC + off) % 360, sat * 0.8, lit * 0.5);

    const W = width, H = height;
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
        // Conic gradient via segment rendering
        const segs = 6;
        const angleOff = (this._angleSmooth + off * 0.5) * Math.PI / 180;
        for (let i = 0; i < segs; i++) {
          const a0 = angleOff + (i / segs) * Math.PI * 2;
          const a1 = angleOff + ((i + 1) / segs) * Math.PI * 2;
          const t  = i / segs;
          const hue = VaelMath.lerp(hueA, hueB, (Math.sin(t * Math.PI * 2) + 1) / 2);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, Math.max(W, H), a0, a1);
          ctx.fillStyle = VaelColor.hsl((hue + off) % 360, sat, lit);
          ctx.fill();
        }
        return;
      }
      case 'diagonal-flow': {
        // Two overlapping angled gradients that flow in opposite directions
        const ang1 = VaelMath.degToRad(this._angleSmooth);
        const ang2 = VaelMath.degToRad(this._angleSmooth + 90);
        const d    = Math.max(W, H);

        const g1 = ctx.createLinearGradient(
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

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
