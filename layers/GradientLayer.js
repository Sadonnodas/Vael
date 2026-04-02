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
        options: ['linear','radial','conic','diagonal-flow','burst','mesh','sunset','vortex','stripe','diamond','spotlight','noise-blend','aurora','tricolor','checkerboard'] },
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
      case 'burst': {
        // Radial burst — sharp rays alternating two hues
        const rays = 12;
        for (let i = 0; i < rays; i++) {
          const a0 = (i / rays) * Math.PI * 2 + off * 0.01;
          const a1 = ((i + 1) / rays) * Math.PI * 2 + off * 0.01;
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, Math.max(W, H), a0, a1);
          ctx.fillStyle = i % 2 === 0 ? cA : cB; ctx.fill();
        }
        return;
      }
      case 'mesh': {
        // 4-corner mesh gradient
        const img = ctx.createImageData(1, 1);
        // Approximate with 4 overlapping radials at corners
        const corners = [
          { x:-W/2, y:-H/2, c:cA }, { x:W/2, y:-H/2, c:cB },
          { x:-W/2, y:H/2,  c:cC }, { x:W/2, y:H/2,  c:cA },
        ];
        corners.forEach(({ x, y, c }) => {
          const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.8);
          g.addColorStop(0, c); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.fillRect(-W/2, -H/2, W, H);
        });
        return;
      }
      case 'sunset': {
        // Horizontal banded sunset — 5-stop linear
        grad = ctx.createLinearGradient(0, -H/2, 0, H/2);
        grad.addColorStop(0,    VaelColor.hsl((hueA + off + 30) % 360, sat * 0.8, lit * 0.4));
        grad.addColorStop(0.3,  cA);
        grad.addColorStop(0.5,  VaelColor.hsl((hueA + hueB + off) / 2 % 360, sat, lit * 1.2));
        grad.addColorStop(0.7,  cB);
        grad.addColorStop(1,    VaelColor.hsl((hueB + off + 60) % 360, sat * 0.6, lit * 0.3));
        break;
      }
      case 'vortex': {
        // Spiral vortex using rotated concentric rings
        const steps = 60;
        for (let i = 0; i < steps; i++) {
          const t2 = i / steps;
          const angle = t2 * Math.PI * 8 + off * 0.02;
          const r2 = t2 * Math.max(W, H) * 0.7;
          const hue = VaelMath.lerp(hueA, hueB, t2);
          ctx.beginPath();
          ctx.arc(0, 0, r2, angle, angle + Math.PI * 2 / steps + 0.05);
          ctx.strokeStyle = VaelColor.hsl((hue + off) % 360, sat, lit);
          ctx.lineWidth = Math.max(W, H) / steps * 1.5;
          ctx.stroke();
        }
        return;
      }
      case 'stripe': {
        // Animated diagonal stripes
        const stripeW = Math.max(W, H) / 8;
        const ang = VaelMath.degToRad(this._angleSmooth + 45);
        ctx.save();
        ctx.rotate(ang);
        const d2 = Math.max(W, H) * 1.5;
        for (let i = -16; i < 16; i++) {
          ctx.fillStyle = i % 2 === 0 ? cA : cB;
          ctx.fillRect(i * stripeW - off % stripeW, -d2, stripeW, d2 * 2);
        }
        ctx.restore();
        return;
      }
      case 'diamond': {
        // Diamond / lozenge gradient — rotated linear
        const rad2 = VaelMath.degToRad(45 + this._angleSmooth);
        const d3   = Math.max(W, H);
        const g1 = ctx.createLinearGradient(
          -Math.cos(rad2)*d3, -Math.sin(rad2)*d3,
           Math.cos(rad2)*d3,  Math.sin(rad2)*d3
        );
        g1.addColorStop(0, cA); g1.addColorStop(0.5, cB); g1.addColorStop(1, cA);
        ctx.fillStyle = g1; ctx.fillRect(-W/2, -H/2, W, H);
        const rad3 = VaelMath.degToRad(-45 + this._angleSmooth);
        const g2 = ctx.createLinearGradient(
          -Math.cos(rad3)*d3, -Math.sin(rad3)*d3,
           Math.cos(rad3)*d3,  Math.sin(rad3)*d3
        );
        g2.addColorStop(0, 'transparent'); g2.addColorStop(0.5, cC); g2.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.6; ctx.fillStyle = g2; ctx.fillRect(-W/2, -H/2, W, H); ctx.globalAlpha = 1;
        return;
      }
      case 'spotlight': {
        // Single spotlight from top-center
        const sx = Math.sin(off * 0.005) * W * 0.3;
        const sy = -H * 0.4;
        grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.9);
        grad.addColorStop(0,   cA);
        grad.addColorStop(0.3, cC);
        grad.addColorStop(1,   VaelColor.hsl((hueB + off) % 360, sat * 0.5, lit * 0.15));
        break;
      }
      case 'noise-blend': {
        // Noise-perturbed gradient — same as field but rendered as gradient
        const t2 = this._hueOffset * 0.001;
        const cols = 32, rows = 18;
        for (let gy = 0; gy < rows; gy++) {
          for (let gx = 0; gx < cols; gx++) {
            const nx = gx / cols, ny = gy / rows;
            const n = (VaelMath.noise2D(nx * 3 + t2, ny * 3 + t2 * 0.7) + 1) / 2;
            const h = VaelMath.lerp(hueA, hueB, n);
            ctx.fillStyle = VaelColor.hsl((h + off) % 360, sat, lit * 0.5 + n * lit);
            ctx.fillRect(
              (gx / cols - 0.5) * W, (gy / rows - 0.5) * H,
              W / cols + 1, H / rows + 1
            );
          }
        }
        return;
      }
      case 'aurora': {
        // Aurora borealis — horizontal wavy bands
        const bands = 5;
        for (let bi = 0; bi < bands; bi++) {
          const by = (bi / bands - 0.5) * H + Math.sin(off * 0.01 + bi * 1.3) * H * 0.12;
          const bh = H / bands * 0.8;
          const hue = VaelMath.lerp(hueA, hueB, bi / bands);
          const g = ctx.createLinearGradient(0, by - bh, 0, by + bh);
          g.addColorStop(0, 'transparent');
          g.addColorStop(0.5, VaelColor.hsl((hue + off) % 360, sat, lit));
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.fillRect(-W/2, by - bh, W, bh * 2);
        }
        return;
      }
      case 'tricolor': {
        // Three-stop linear with all three hue params visible
        const rad4 = VaelMath.degToRad(this._angleSmooth);
        const d4   = Math.max(W, H);
        grad = ctx.createLinearGradient(
          -Math.cos(rad4)*d4, -Math.sin(rad4)*d4,
           Math.cos(rad4)*d4,  Math.sin(rad4)*d4
        );
        grad.addColorStop(0,    cA);
        grad.addColorStop(0.33, cB);
        grad.addColorStop(0.66, cC);
        grad.addColorStop(1,    cA);
        break;
      }
      case 'checkerboard': {
        // Animated checkerboard — two gradient colours
        const cs = Math.max(W, H) / 8;
        const shift = off * 0.3 % cs;
        for (let gy2 = -1; gy2 < Math.ceil(H / cs) + 1; gy2++) {
          for (let gx2 = -1; gx2 < Math.ceil(W / cs) + 1; gx2++) {
            ctx.fillStyle = (gx2 + gy2) % 2 === 0 ? cA : cB;
            ctx.fillRect(gx2 * cs - W/2 - shift, gy2 * cs - H/2 - shift, cs, cs);
          }
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

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
