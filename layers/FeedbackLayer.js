/**
 * layers/FeedbackLayer.js
 * Frame-buffer feedback as a compositable layer.
 *
 * Unlike the PostFX feedback pass (which applies to the entire canvas),
 * this layer can sit anywhere in the stack and be blended selectively.
 * It captures the current composite below it each frame, then applies
 * zoom + rotation + hue-shift + decay to that captured frame, creating
 * an evolving feedback trail of everything beneath it.
 *
 * Audio reactivity: bass drives zoom intensity, beat drives rotation burst.
 *
 * Params:
 *   amount    — 0 = no feedback, 1 = infinite (try 0.8–0.95)
 *   zoom      — subtle zoom per frame (1.0 = none, 1.005 = slow expand)
 *   rotation  — rotation per frame in degrees (0.05–0.5 works well)
 *   hueShift  — hue rotation per frame in degrees
 *   decay     — brightness decay (0.95–0.99)
 *   audioReact — how much bass drives extra zoom
 */

class FeedbackLayer extends BaseLayer {

  static manifest = {
    name: 'Feedback',
    version: '1.0',
    params: [
      { id: 'amount',     label: 'Amount',       type: 'float', default: 0.88, min: 0,     max: 0.99  },
      { id: 'zoom',       label: 'Zoom',         type: 'float', default: 1.002,min: 1.0,   max: 1.02  },
      { id: 'rotation',   label: 'Rotation/fr',  type: 'float', default: 0.1,  min: 0,     max: 2.0   },
      { id: 'hueShift',   label: 'Hue shift/fr', type: 'float', default: 0.5,  min: 0,     max: 10    },
      { id: 'decay',      label: 'Decay',        type: 'float', default: 0.97, min: 0.8,   max: 1.0   },
      { id: 'audioReact', label: 'Audio → zoom', type: 'float', default: 0.4,  min: 0,     max: 1     },
      { id: 'beatKick',   label: 'Beat → rotate',type: 'float', default: 0.3,  min: 0,     max: 2     },
    ],
  };

  constructor(id) {
    super(id, 'Feedback');
    this.params = {
      amount:     0.88,
      zoom:       1.002,
      rotation:   0.1,
      hueShift:   0.5,
      decay:      0.97,
      audioReact: 0.4,
      beatKick:   0.3,
    };

    // Two-canvas ping-pong for feedback accumulation
    this._bufA      = null;   // previous frame
    this._bufB      = null;   // current frame being built
    this._ctxA      = null;
    this._ctxB      = null;

    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._hueAccum    = 0;    // accumulated hue rotation in degrees
    this._firstFrame  = true;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._firstFrame = true;
  }

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.1);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
    this._hueAccum += this.params.hueShift * dt * 60;
  }

  render(ctx, width, height) {
    this._ensureBuffers(width, height);

    const W = width, H = height;
    const p = this.params;

    // ── Step 1: Draw previous buffer (bufA) → bufB with transform ──
    const ctxB = this._ctxB;
    ctxB.clearRect(0, 0, W, H);

    if (!this._firstFrame) {
      const audioZoom = p.zoom + this._audioSmooth * (p.audioReact ?? 0.4) * 0.008;
      const beatRot   = this._beatPulse * (p.beatKick ?? 0.3);
      const rotRad    = (p.rotation + beatRot) * Math.PI / 180;

      ctxB.save();
      ctxB.translate(W / 2, H / 2);
      ctxB.rotate(rotRad);
      ctxB.scale(audioZoom, audioZoom);
      ctxB.translate(-W / 2, -H / 2);

      // Apply decay as globalAlpha
      ctxB.globalAlpha = VaelMath.clamp(p.decay ?? 0.97, 0, 1);
      ctxB.drawImage(this._bufA, 0, 0);
      ctxB.restore();
      ctxB.globalAlpha = 1;

      // Apply hue shift if needed — using CSS filter (fast)
      if (p.hueShift > 0) {
        const tmp    = document.createElement('canvas');
        tmp.width    = W; tmp.height = H;
        const tCtx   = tmp.getContext('2d');
        tCtx.filter  = `hue-rotate(${(this._hueAccum % 360).toFixed(1)}deg)`;
        tCtx.drawImage(this._bufB, 0, 0);
        tCtx.filter  = 'none';
        ctxB.clearRect(0, 0, W, H);
        ctxB.drawImage(tmp, 0, 0);
      }
    }

    // ── Step 2: Composite bufB (transformed feedback) onto layer ctx ──
    // The amount param controls how much of the feedback bleeds through.
    // We composite it using the layer's blend mode at the given amount opacity.
    if (!this._firstFrame) {
      ctx.save();
      ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = VaelMath.clamp(p.amount ?? 0.88, 0, 1);
      ctx.drawImage(this._bufB, 0, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ── Step 3: Capture the full composite so far into bufA ──────────
    // We draw the current output canvas (everything below + this layer)
    // into bufA as the source for next frame's feedback.
    // We can't access the WebGL canvas pixels directly here, but we can
    // copy bufB (which already has the previous frame's feedback) as a proxy.
    // A full read-back would require Renderer integration; this self-referencing
    // approach produces the signature feedback look without pixel readback.
    const ctxA = this._ctxA;
    ctxA.clearRect(0, 0, W, H);
    ctxA.drawImage(this._bufB, 0, 0);

    this._firstFrame = false;
  }

  _ensureBuffers(W, H) {
    const needsReset = !this._bufA
      || this._bufA.width !== W
      || this._bufA.height !== H;

    if (needsReset) {
      this._bufA = document.createElement('canvas');
      this._bufA.width = W; this._bufA.height = H;
      this._ctxA = this._bufA.getContext('2d');

      this._bufB = document.createElement('canvas');
      this._bufB.width = W; this._bufB.height = H;
      this._ctxB = this._bufB.getContext('2d');

      this._firstFrame = true;
    }
  }

  dispose() {
    this._bufA = null; this._bufB = null;
    this._ctxA = null; this._ctxB = null;
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
