/**
 * layers/ParticleLayer.js
 *
 * FIXES (v2.1):
 * - Full-canvas init: particles now spawn across the full W×H canvas in all
 *   modes, not just a sub-region.
 * - Drift/trails direction fix: per-particle noiseOx/noiseOy offsets are now
 *   spread across a much wider range (0–8000) so they sample genuinely
 *   independent, well-distributed regions of the Perlin field. Previously the
 *   narrow range (0–1000) meant all particles ended up in a correlated zone
 *   that had a net directional bias toward negative x/y (top-left).
 *   Particles also receive a randomised initial velocity so they start moving
 *   in varied directions rather than all accelerating the same way.
 * - Clustering fix: drift damping tightened (0.96 → 0.94) to prevent
 *   sustained co-alignment. audioForce gain reduced so high audio levels
 *   no longer compress particles into a streak.
 * - Audio reactivity: audioReact=0 now fully stops all audio-driven motion
 *   including beat pulse. Beat pulse gating already respected audioReact>0.
 * - audioTarget param removed — use ModMatrix to route specific bands.
 *
 * MODES (10 total):
 *   drift      — noise-field flow (fixed: no more clumping)
 *   fountain   — gravity-based upward spray
 *   orbit      — circular orbits at varied radii
 *   pulse      — burst outward on beats, contract back
 *   fireflies  — slow organic drift with individual blinking
 *   scatter    — explode outward from centre on beats, drift back
 *   rain       — falls downward, speed modulated by audio
 *   vortex     — spiral inward, audio controls tightness
 *   trails     — leaves a fading trail behind each particle
 */

class ParticleLayer extends BaseLayer {

  static manifest = {
    name: 'Particles',
    version: '2.0',
    params: [
      { id: 'mode',      label: 'Mode',       type: 'enum',  default: 'drift',  triggersRefresh: true,
        options: ['drift','fountain','orbit','pulse','fireflies','scatter','rain','vortex','trails','magnet'] },
      { id: 'count',     label: 'Count',      type: 'int',   default: 600,  min: 50,   max: 3000 },
      { id: 'size',      label: 'Size',       type: 'float', default: 2.0,  min: 0.5,  max: 10   },
      { id: 'speed',     label: 'Speed',      type: 'float', default: 0.4,  min: 0.05, max: 3    },
      { id: 'colorMode', label: 'Color',      type: 'enum',  default: 'rainbow',
        options: ['rainbow','mono','white','accent','warm','cool','ember','audio'] },
      { id: 'hueShift',  label: 'Hue shift',  type: 'float', default: 0,    min: 0,    max: 360  },
      // Mode-specific params — only shown when relevant mode is active
      { id: 'trailLen',  label: 'Trail',      type: 'float', default: 0.85, min: 0.5,  max: 0.99,
        showWhen: { mode: ['trails'] } },
      { id: 'pulseSize', label: 'Pulse size', type: 'float', default: 0.5,  min: 0.05, max: 3.0,
        showWhen: { mode: ['pulse'] } },
      { id: 'audioReact',label: 'Audio react',type: 'float', default: 0.5,  min: 0,    max: 1    },
    ],
  };

  constructor(id) {
    super(id, 'Particles');
    this.params = {
      mode:      'drift',
      count:     600,
      size:      2.0,
      speed:     0.4,
      colorMode: 'rainbow',
      hueShift:  0,
      trailLen:   0.85,
      pulseSize:  0.5,
      audioReact: 0.5,
    };
    this._particles   = [];
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._prevCount   = 0;
    this._prevMode    = '';
    this._trailCanvas = null;
    this._trailCtx    = null;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._prevCount = 0; // force re-init
  }

  _initParticles(w, h) {
    const count = this.params.count;
    const mode  = this.params.mode;
    this._particles = Array.from({ length: count }, (_, i) =>
      this._newParticle(w, h, i, count)
    );
    this._prevCount = count;
    this._prevMode  = mode;

    // Trail mode gets its own offscreen canvas for persistence
    if (mode === 'trails') {
      if (!this._trailCanvas) {
        this._trailCanvas = document.createElement('canvas');
        this._trailCtx    = this._trailCanvas.getContext('2d');
      }
      this._trailCanvas.width  = w;
      this._trailCanvas.height = h;
      this._trailCtx.fillStyle = '#000';
      this._trailCtx.fillRect(0, 0, w, h);
    }
  }

  _newParticle(w, h, i, total) {
    const mode = this.params.mode;
    const rnd  = () => Math.random();
    const rng  = (a, b) => a + rnd() * (b - a);

    // Each particle gets a large, unique noise offset so it samples a
    // genuinely independent region of the Perlin field. The narrow 0–1000
    // range in v2.0 put all particles in a correlated zone that had a net
    // bias toward negative x/y. Spreading across 0–8000 eliminates that.
    const p = {
      x:         rng(-w/2, w/2),
      y:         rng(-h/2, h/2),
      // Randomised initial velocity — particles start moving in varied
      // directions rather than all being at rest and then drifting the
      // same way as the first noise sample pushes them.
      vx:        rng(-0.8, 0.8),
      vy:        rng(-0.8, 0.8),
      life:      rng(0, 1),
      maxLife:   rng(0.5, 1),
      size:      rng(0.5, 1.5),
      noiseOx:   rng(0, 8000),
      noiseOy:   rng(0, 8000),
      hue:       (i / total) * 360 + rng(-15, 15),
      angle:     rng(0, Math.PI * 2),
    };

    switch (mode) {
      case 'fountain':
        p.x  = rng(-w * 0.1, w * 0.1);
        p.y  = h * 0.45;
        p.vx = rng(-1, 1);
        p.vy = rng(-4, -2);
        break;

      case 'orbit':
        p.radius = rng(40, Math.min(w, h) * 0.38);
        p.speed  = rng(0.3, 1.2) * (rnd() < 0.5 ? 1 : -1);
        break;

      case 'pulse':
        // Each particle has a home radius it orbits.
        // On beat it gets kicked outward and springs back.
        p.homeRadius = rng(40, Math.min(w, h) * 0.38);
        p.radius     = p.homeRadius;
        p.speed      = rng(0.2, 0.8) * (rnd() < 0.5 ? 1 : -1); // orbit dir
        p.kickV      = 0;  // radial velocity from beat kick
        break;

      case 'fireflies':
        p.vx        = rng(-0.1, 0.1);
        p.vy        = rng(-0.1, 0.1);
        p.phase     = rng(0, Math.PI * 2);
        p.blinkSpeed = rng(0.4, 1.8);
        p.hue       = rng(35, 75);
        break;

      case 'scatter':
        // Particles live at (0,0). On beat they fly outward then fade.
        p.x      = 0; p.y = 0;
        p.vx     = 0; p.vy = 0;
        p.angle  = rng(0, Math.PI * 2);
        p.outV   = 0;   // outward velocity, set on beat
        p.life   = rng(0, 1); // stagger initial lives
        p.maxLife = rng(0.4, 1.0);
        break;

      case 'rain':
        p.x  = rng(-w/2, w/2);
        p.y  = rng(-h/2, h/2);
        p.vy = rng(1, 3);
        p.vx = rng(-0.2, 0.2);
        p.size = rng(0.3, 0.8);
        break;

      case 'vortex':
        p.radius = rng(10, Math.min(w, h) * 0.45);
        p.speed  = rng(0.5, 2.0) * (rnd() < 0.3 ? -1 : 1);
        p.inSpeed = rng(0.1, 0.5);
        break;

      case 'trails':
        p.vx = rng(-0.8, 0.8);
        p.vy = rng(-0.8, 0.8);
        break;

      case 'magnet':
        // Particles drift freely until audio pulls them toward the mouse
        p.vx      = rng(-0.5, 0.5);
        p.vy      = rng(-0.5, 0.5);
        p.charge  = rnd() < 0.5 ? 1 : -1;  // attract or repel
        p.mass    = rng(0.4, 1.4);
        break;
    }

    return p;
  }

  update(audioData, videoData, dt) {
    this._time += dt;

    // Smooth audio — sqrt curve for proportional response
    const rawAudio    = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    const react       = this.params.audioReact ?? 0.5;
    const targetAudio = Math.sqrt(Math.max(0, rawAudio)) * react;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, targetAudio, 0.08);

    if (audioData?.isBeat) {
      this._beatPulse = (this.params.audioReact ?? 0.5) > 0 ? 1.0 : 0;
    } else if (!audioData?.isActive) {
      // Synthetic beat at ~120 BPM so pulse/scatter animate without audio
      const phase = (this._time * 2.0) % 1;  // 2Hz = 120 BPM
      if (phase < 0.05 && (this._lastSynthPhase ?? 1) >= 0.05) {
        this._beatPulse = 0.6;  // weaker than real beat
      }
      this._lastSynthPhase = phase;
    }
    this._beatPulse = Math.max(0, (this._beatPulse ?? 0) - dt * 4);
  }

  render(ctx, width, height) {
    if (this._prevCount !== this.params.count ||
        this._prevMode  !== this.params.mode  ||
        this._particles.length === 0) {
      this._initParticles(width, height);
    }

    const dt    = 1 / 60;
    const audio = this._audioSmooth;
    const beat  = this._beatPulse;
    const speed = this.params.speed;
    const mode  = this.params.mode;

    // Trail mode: dim the trail canvas each frame instead of clearing the main ctx
    if (mode === 'trails' && this._trailCtx) {
      const tc = this._trailCtx;
      tc.globalAlpha            = 1 - this.params.trailLen;
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle              = '#000';
      tc.fillRect(0, 0, width, height);  // trail canvas: (0,0) is top-left
      tc.globalAlpha            = 1;
      tc.globalCompositeOperation = 'source-over';
    }

    this._particles.forEach(p => {
      switch (mode) {

        case 'drift': {
          // Per-particle offsets (0–8000 range) prevent clumping — each
          // particle samples a genuinely independent noise region
          const nx  = VaelMath.noise2D((p.x + p.noiseOx) * 0.003, this._time * 0.2) - 0.5;
          const ny  = VaelMath.noise2D((p.y + p.noiseOy) * 0.003, this._time * 0.2) - 0.5;
          // Gentler audio force — prevents high audio from compressing particles
          const audioForce = 0.10 + audio * 0.18;
          p.vx += nx * audioForce * speed;
          p.vy += ny * audioForce * speed;
          // Tighter damping prevents sustained co-alignment
          p.vx  *= 0.94; p.vy *= 0.94;
          p.x   += p.vx; p.y  += p.vy;
          const hw = width/2, hh = height/2;
          if (p.x >  hw) p.x = -hw;
          if (p.x < -hw) p.x =  hw;
          if (p.y >  hh) p.y = -hh;
          if (p.y < -hh) p.y =  hh;
          break;
        }

        case 'fountain': {
          p.vy  += (0.08 + audio * 0.05) * speed;
          p.vx  += (Math.random() - 0.5) * 0.04;
          p.x   += p.vx * speed;
          p.y   += p.vy * speed;
          p.life -= dt * (0.3 + audio * 0.2);
          if (p.life <= 0 || p.y > height / 2) {
            Object.assign(p, this._newParticle(width, height, 0, this.params.count));
            p.life = p.maxLife;
          }
          break;
        }

        case 'orbit': {
          const angSpeed = p.speed * speed * dt * (0.8 + audio * 0.4);
          p.angle  += angSpeed;
          const r   = p.radius * (1 + audio * 0.2);
          p.x = Math.cos(p.angle) * r;
          p.y = Math.sin(p.angle) * r;
          break;
        }

        case 'pulse': {
          // Particles orbit at their homeRadius.
          // On each beat they get a radial kick outward, then spring back.
          // Spring: F = -k * displacement, damped.
          if (beat > 0.5 && p.kickV < 1) {
            // Scale kick to canvas size so it looks the same regardless of resolution.
            // pulseSize 0.1–1.0 multiplies the kick distance.
            const kickScale = Math.min(width, height) * (this.params.pulseSize ?? 0.5);
            p.kickV += beat * kickScale * (0.8 + audio * 0.4) * speed;
          }
          const disp   = p.radius - p.homeRadius;
          const spring = -disp * 0.06;
          p.kickV += spring;
          p.kickV  *= 0.87;
          p.radius += p.kickV * dt;
          p.radius  = Math.max(5, p.radius);
          // Slow orbit — direction per particle
          p.angle  += p.speed * 0.01 * speed * (1 + audio * 0.3);
          p.x = Math.cos(p.angle) * p.radius;
          p.y = Math.sin(p.angle) * p.radius;
          break;
        }

        case 'fireflies': {
          p.phase += dt * p.blinkSpeed * (1 + audio * 0.3);
          const nx = VaelMath.noise2D((p.x + p.noiseOx) * 0.003, this._time * 0.08) - 0.5;
          const ny = VaelMath.noise2D((p.y + p.noiseOy) * 0.003, this._time * 0.08) - 0.5;
          p.vx += nx * 0.05;
          p.vy += ny * 0.05;
          p.vx *= 0.98; p.vy *= 0.98;
          p.x  += p.vx * speed * 0.4;
          p.y  += p.vy * speed * 0.4;
          const hw = width/2, hh = height/2;
          if (p.x >  hw+20) p.x = -hw;
          if (p.x < -hw-20) p.x =  hw;
          if (p.y >  hh+20) p.y = -hh;
          if (p.y < -hh-20) p.y =  hh;
          break;
        }

        case 'scatter': {
          // On beat: spawn a burst — all particles fly outward from centre.
          // Each particle has its own outward velocity and fades as it travels.
          // When life expires it resets to centre, ready for the next beat.
          if (beat > 0.5 && p.life <= 0.05) {
            // Kick this particle outward with random speed + audio boost
            // Scale to canvas so particles reach the edges properly.
            // At speed 0.4, particles travel ~30-50% of the smaller dimension.
            const maxReach = Math.min(width, height) * (0.4 + audio * 0.35);
            p.outV  = (maxReach * 0.8 + Math.random() * maxReach * 0.8) * speed;
            p.life  = p.maxLife;
            p.angle = Math.random() * Math.PI * 2; // random direction each burst
          }
          // Coast outward, decelerate (friction)
          p.outV  = Math.max(0, p.outV * 0.97 - 0.3);  // gentle friction, travels far
          p.x    += Math.cos(p.angle) * p.outV * dt;
          p.y    += Math.sin(p.angle) * p.outV * dt;
          // Fade life
          p.life  = Math.max(0, p.life - dt * (0.4 + audio * 0.3));
          break;
        }

        case 'rain': {
          const fallSpeed = speed * (0.8 + audio * 0.8);
          p.vy  += 0.04 * fallSpeed;
          p.vx  += (Math.random() - 0.5) * 0.02;
          p.vx  *= 0.99;
          p.x   += p.vx;
          p.y   += p.vy;
          // Respawn at top when hitting bottom
          if (p.y > height / 2 + 10) {
            p.x  = (Math.random() - 0.5) * width;
            p.y  = -height / 2 - 10;
            p.vy = Math.random() * 2 + 1;
            p.vx = (Math.random() - 0.5) * 0.5;
          }
          break;
        }

        case 'vortex': {
          // Spiral inward, audio makes it expand
          p.angle   += p.speed * speed * dt * (0.6 + audio * 0.6);
          p.radius  -= p.inSpeed * speed * dt * (1 - audio * 0.7);
          if (p.radius < 5) {
            // Respawn at edge
            p.radius = Math.min(width, height) * 0.45 * (0.5 + Math.random() * 0.5);
            p.angle  = Math.random() * Math.PI * 2;
          }
          p.x = Math.cos(p.angle) * p.radius;
          p.y = Math.sin(p.angle) * p.radius;
          break;
        }

        case 'trails': {
          // Smooth noise-driven motion, renders to a persistent trail canvas
          const nx = VaelMath.noise2D((p.x + p.noiseOx) * 0.003, this._time * 0.15) - 0.5;
          const ny = VaelMath.noise2D((p.y + p.noiseOy) * 0.003, this._time * 0.15) - 0.5;
          p.vx += nx * (0.12 + audio * 0.22) * speed;
          p.vy += ny * (0.12 + audio * 0.22) * speed;
          p.vx  *= 0.94; p.vy *= 0.94;
          p.x   += p.vx;  p.y  += p.vy;
          const hw = width/2, hh = height/2;
          if (p.x >  hw) p.x = -hw;
          if (p.x < -hw) p.x =  hw;
          if (p.y >  hh) p.y = -hh;
          if (p.y < -hh) p.y =  hh;
          break;
        }

        case 'magnet': {
          // Mouse acts as attractor/repeller. Audio strength scales the force.
          // p.charge: +1 = attracted to mouse, -1 = repelled.
          // Beat pulse flips repel temporarily for a burst effect.
          const mxWorld = (this.uniforms.iMouseX - 0.5) * width;
          const myWorld = (0.5 - this.uniforms.iMouseY) * height;
          const dx = mxWorld - p.x;
          const dy = myWorld - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const norm = { x: dx / dist, y: dy / dist };

          // Force falls off with distance but spikes when close
          const proximity = Math.min(1, 120 / dist);
          const strength  = proximity * (0.8 + audio * 2.5) * speed / p.mass;
          const charge    = p.charge * (this._beatPulse > 0.3 ? -1 : 1); // beat flips

          p.vx += norm.x * charge * strength * dt * 60;
          p.vy += norm.y * charge * strength * dt * 60;

          // Damping — heavier particles slow down faster
          const damp = 0.97 - p.mass * 0.015;
          p.vx *= damp; p.vy *= damp;
          p.x  += p.vx; p.y  += p.vy;

          // Wrap edges
          const hw2 = width/2 + 20, hh2 = height/2 + 20;
          if (p.x >  hw2) { p.x = -hw2; p.vx = 0; }
          if (p.x < -hw2) { p.x =  hw2; p.vx = 0; }
          if (p.y >  hh2) { p.y = -hh2; p.vy = 0; }
          if (p.y < -hh2) { p.y =  hh2; p.vy = 0; }
          break;
        }
      }

      // ── Draw ──────────────────────────────────────────────────
      const color = this._getColor(p);
      let   alpha, sz;

      if (mode === 'fireflies') {
        const blink = (Math.sin(p.phase) + 1) / 2;
        alpha = blink * (0.35 + audio * 0.45);
        sz    = this.params.size * p.size * (0.5 + blink * 0.9 + audio * 0.3);
        // Soft outer glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, sz * 3.5), 0, Math.PI * 2);
        ctx.fillStyle   = color;
        ctx.globalAlpha = alpha * 0.12;
        ctx.fill();

      } else if (mode === 'rain') {
        // Rain draws as elongated streaks
        alpha = 0.5 + audio * 0.3;
        sz    = this.params.size * p.size;
        const len = sz * 4 + Math.abs(p.vy) * 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 2, p.y - len);
        ctx.strokeStyle = color;
        ctx.lineWidth   = Math.max(0.5, sz * 0.5);
        ctx.globalAlpha = VaelMath.clamp(alpha, 0, 1);
        ctx.stroke();
        return; // skip the arc below

      } else if (mode === 'trails') {
        // Draw onto trail canvas, then composite
        alpha = 0.6 + audio * 0.35 + beat * 0.2;
        sz    = this.params.size * p.size * (1 + audio * 0.4 + beat * 0.6);
        if (this._trailCtx) {
          // Trail canvas uses top-left origin, not centred.
          // Shift particle centred coords (+w/2, +h/2) to canvas space.
          const tx = p.x + this._trailCanvas.width  / 2;
          const ty = p.y + this._trailCanvas.height / 2;
          this._trailCtx.beginPath();
          this._trailCtx.arc(tx, ty, Math.max(0.3, sz), 0, Math.PI * 2);
          this._trailCtx.fillStyle   = color;
          this._trailCtx.globalAlpha = VaelMath.clamp(alpha, 0, 1);
          this._trailCtx.fill();
        }
        return; // skip main ctx draw

      } else if (mode === 'scatter') {
        // Fade out as life decreases; invisible when at centre (life==0)
        alpha = p.life > 0 ? (p.life / p.maxLife) * (0.8 + audio * 0.2) : 0;
        sz    = this.params.size * p.size * (1 + audio * 0.3 + beat * 0.4);
      } else {
        alpha = mode === 'fountain'
          ? (p.life / p.maxLife) * (0.7 + audio * 0.3)
          : 0.65 + audio * 0.3;
        sz    = this.params.size * p.size * (1 + audio * 0.4 + beat * 0.6);
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, sz), 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.globalAlpha = VaelMath.clamp(alpha, 0, 1);
      ctx.fill();
    });

    // Composite trail canvas onto main ctx
    // ctx origin is at canvas centre; trail canvas origin is at top-left.
    // Use save/restore so we don't corrupt the Renderer's transform state.
    if (mode === 'trails' && this._trailCanvas) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(-width/2, -height/2);
      ctx.drawImage(this._trailCanvas, 0, 0);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  _getColor(p) {
    const shift = this.params.hueShift + this._time * 10;
    const a     = this._audioSmooth;
    switch (this.params.colorMode) {
      case 'white':   return 'rgba(255,255,255,0.9)';
      case 'accent':  return VaelColor.hsl((170 + shift * 0.3) % 360, 0.9, 0.6);
      case 'mono':    return VaelColor.mono(p.life ?? 0.5);
      case 'warm':    return VaelColor.hsl(((p.hue % 80) + 10 + shift * 0.3) % 360, 0.85, 0.55 + a * 0.1);
      case 'cool':    return VaelColor.hsl(((p.hue % 80) + 180 + shift * 0.3) % 360, 0.75, 0.55 + a * 0.1);
      case 'ember':   return VaelColor.hsl(((p.hue % 40) + 5) % 360, 0.95, 0.4 + a * 0.2);
      case 'audio':   return VaelColor.hsl((a * 240 + shift) % 360, 0.9, 0.5 + a * 0.2);
      default:        return VaelColor.hsl((p.hue + shift) % 360, 0.8, 0.6);
    }
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
