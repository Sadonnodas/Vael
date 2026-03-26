/**
 * layers/ParticleLayer.js
 * GPU-friendly particle system with 4 modes:
 * drift, fountain, orbit, pulse
 */

class ParticleLayer extends BaseLayer {

  static manifest = {
    name: 'Particles',
    version: '1.0',
    params: [
      { id: 'mode',        label: 'Mode',         type: 'enum',  default: 'drift',   options: ['drift','fountain','orbit','pulse'] },
      { id: 'count',       label: 'Count',         type: 'int',   default: 600,  min: 50,   max: 3000 },
      { id: 'size',        label: 'Size',          type: 'float', default: 2.0,  min: 0.5,  max: 10   },
      { id: 'speed',       label: 'Speed',         type: 'float', default: 0.4,  min: 0.05, max: 3    },
      { id: 'colorMode',   label: 'Color',         type: 'enum',  default: 'rainbow', options: ['rainbow','mono','white','accent'] },
      { id: 'audioTarget', label: 'Audio target',  type: 'band',  default: 'bass' },
      { id: 'hueShift',    label: 'Hue shift',     type: 'float', default: 0,    min: 0,    max: 360  },
    ],
  };

  constructor(id) {
    super(id, 'Particles');
    this.params = {
      mode:        'drift',
      count:       600,
      size:        2.0,
      speed:       0.4,
      colorMode:   'rainbow',
      audioTarget: 'bass',
      hueShift:    0,
    };
    this._particles  = [];
    this._time       = 0;
    this._audioSmooth = 0;
    this._prevCount  = 0;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._initParticles(800, 600);
  }

  _initParticles(w, h) {
    const count = this.params.count;
    this._particles = Array.from({ length: count }, (_, i) => this._newParticle(w, h, i, count));
    this._prevCount = count;
  }

  _newParticle(w, h, i, total) {
    const mode = this.params.mode;
    const r    = VaelMath.randFloat;
    const ri   = VaelMath.randInt;

    const p = {
      x: r(-w/2, w/2),
      y: r(-h/2, h/2),
      vx: 0, vy: 0,
      life: r(0, 1),
      maxLife: r(0.5, 1),
      size: r(0.5, 1),
      hue:  (i / total) * 360 + r(-20, 20),
      angle: r(0, Math.PI * 2),
    };

    if (mode === 'fountain') {
      p.x = r(-w * 0.15, w * 0.15);
      p.y = h * 0.4;
      p.vx = r(-0.5, 0.5);
      p.vy = r(-3, -1);
    } else if (mode === 'orbit') {
      p.angle  = r(0, Math.PI * 2);
      p.radius = r(50, Math.min(w, h) * 0.35);
      p.speed  = r(-0.5, 0.5);
    } else if (mode === 'pulse') {
      p.angle  = r(0, Math.PI * 2);
      p.radius = r(0, Math.min(w, h) * 0.4);
    }
    return p;
  }

  update(audioData, videoData, dt) {
    this._time += dt;
    const audioVal = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, audioVal, 0.1);

    // Beat pulse — sharp brightness spike on each beat
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, (this._beatPulse ?? 0) - dt * 6);
  }

  render(ctx, width, height) {
    // Re-init if count changed or first render
    if (this._prevCount !== this.params.count || this._particles.length === 0) {
      this._initParticles(width, height);
    }

    const dt    = 1 / 60;
    const audio = this._audioSmooth;
    const speed = this.params.speed * (1 + audio * 1.5);
    const mode  = this.params.mode;

    this._particles.forEach(p => {
      // Update position by mode
      if (mode === 'drift') {
        p.vx += (VaelMath.noise2D(p.x * 0.005, this._time * 0.3) - 0.5) * 0.4 * speed;
        p.vy += (VaelMath.noise2D(p.y * 0.005 + 100, this._time * 0.3) - 0.5) * 0.4 * speed;
        p.vx *= 0.96; p.vy *= 0.96;
        p.x  += p.vx; p.y  += p.vy;
        // Wrap edges
        const hw = width/2, hh = height/2;
        if (p.x >  hw) p.x = -hw;
        if (p.x < -hw) p.x =  hw;
        if (p.y >  hh) p.y = -hh;
        if (p.y < -hh) p.y =  hh;

      } else if (mode === 'fountain') {
        p.vy += 0.06 * speed;   // gravity
        p.vx += (Math.random() - 0.5) * 0.05;
        p.x  += p.vx * speed;
        p.y  += p.vy * speed;
        p.life -= dt * 0.4;
        if (p.life <= 0 || p.y > height / 2) {
          Object.assign(p, this._newParticle(width, height, 0, this.params.count));
          p.life = p.maxLife;
        }

      } else if (mode === 'orbit') {
        p.angle  += p.speed * speed * dt * (1 + audio);
        const r   = p.radius * (1 + audio * 0.3);
        p.x = Math.cos(p.angle) * r;
        p.y = Math.sin(p.angle) * r;

      } else if (mode === 'pulse') {
        const beat = audio > 0.7 ? audio : 0;
        p.radius += beat * 8 * speed;
        p.radius *= 0.96;
        p.radius  = Math.max(1, p.radius);
        p.angle  += 0.005 * speed;
        p.x = Math.cos(p.angle) * p.radius;
        p.y = Math.sin(p.angle) * p.radius;
      }

      // Draw
      const beat  = this._beatPulse ?? 0;
      const alpha = mode === 'fountain' ? p.life / p.maxLife : 0.7 + audio * 0.3;
      const size  = this.params.size * p.size * (1 + audio * 0.5 + beat * 0.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, size), 0, Math.PI * 2);
      ctx.fillStyle = this._getColor(p);
      ctx.globalAlpha = VaelMath.clamp(alpha + beat * 0.3, 0, 1);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }

  _getColor(p) {
    const shift = this.params.hueShift + this._time * 10;
    switch (this.params.colorMode) {
      case 'white':   return 'rgba(255,255,255,0.9)';
      case 'accent':  return VaelColor.hsl(170 + shift % 40, 0.9, 0.6);
      case 'mono':    return VaelColor.mono(p.life ?? 0.5);
      default:        return VaelColor.hsl((p.hue + shift) % 360, 0.8, 0.6);
    }
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}