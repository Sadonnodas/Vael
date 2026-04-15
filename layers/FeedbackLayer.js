/**
 * layers/FeedbackLayer.js
 * Frame-buffer feedback as a compositable layer.
 *
 * Strategy: each frame we capture the composited WebGL canvas into our own
 * offscreen buffer, apply zoom/rotation/hue-shift/decay on top of the
 * previous accumulated buffer, then output that as our layer.
 *
 * The main canvas has preserveDrawingBuffer:true so drawImage works.
 * We use two ping-pong canvases (bufA = last frame result, bufB = scratch)
 * to avoid reading while writing.
 *
 * Audio reactivity: bass drives extra zoom, beat drives a rotation burst.
 *
 * Params:
 *   amount     — blend weight of accumulated buffer (0 = off, 0.99 = infinite)
 *   zoom       — zoom applied to accumulated buffer per frame (1.0 = none)
 *   rotation   — degrees per frame added to accumulated buffer
 *   hueShift   — hue rotation per frame in degrees (CSS filter hue-rotate)
 *   decay      — global brightness decay (multiply; 1.0 = no decay)
 *   audioReact — bass → extra zoom intensity
 *   beatKick   — beat → rotation burst magnitude
 */

class FeedbackLayer extends BaseLayer {

  static manifest = {
    name: 'Feedback',
    version: '2.0',
    params: [
      { id: 'amount',     label: 'Amount',        type: 'float', default: 0.88, min: 0,    max: 0.99, step: 0.01 },
      { id: 'zoom',       label: 'Zoom',          type: 'float', default: 1.002,min: 1.0,  max: 1.05, step: 0.001 },
      { id: 'rotation',   label: 'Rotation/fr°',  type: 'float', default: 0.1,  min: 0,    max: 5.0,  step: 0.05 },
      { id: 'hueShift',   label: 'Hue shift/fr°', type: 'float', default: 0.5,  min: 0,    max: 20,   step: 0.1  },
      { id: 'decay',      label: 'Decay',         type: 'float', default: 0.97, min: 0.8,  max: 1.0,  step: 0.005},
      { id: 'audioReact', label: 'Bass → zoom',   type: 'float', default: 0.0,  min: 0,    max: 1     },
      { id: 'beatKick',   label: 'Beat → rotate', type: 'float', default: 0.3,  min: 0,    max: 5     },
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
      audioReact: 0.0,
      beatKick:   0.3,
    };

    // Ping-pong buffers
    this._bufA      = null;   // accumulated result from previous frame
    this._bufB      = null;   // scratch for building current frame
    this._ctxA      = null;
    this._ctxB      = null;

    this._audioSmooth = 0;
    this._beatPulse   = 0;    // decays to 0 after a beat
    this._hueAccum    = 0;    // degrees, wraps at 360
    this._firstFrame  = true;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._firstFrame = true;
  }

  update(audioData, videoData, dt) {
    const react = this.params.audioReact ?? 0;
    const av = audioData?.isActive ? (audioData.bass ?? 0) * react : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.1);
    if (react > 0 && audioData?.isBeat) {
      this._beatPulse = this.params.beatKick ?? 0;
    }
    this._beatPulse   = Math.max(0, this._beatPulse - dt * 6);
    this._hueAccum   += (this.params.hueShift ?? 0) * dt * 60;
    if (this._hueAccum > 360) this._hueAccum -= 360;
  }

  render(ctx, width, height) {
    this._ensureBuffers(width, height);

    const mainCanvas = window._vaelRenderer?.canvas;

    // ── Step 1: build new accumulated frame in bufB ─────────────
    this._ctxB.save();
    this._ctxB.clearRect(0, 0, width, height);

    if (!this._firstFrame && this._bufA) {
      const amount   = this.params.amount ?? 0.88;
      const zoom     = (this.params.zoom ?? 1.002) + this._audioSmooth * 0.02;
      const rotDeg   = (this.params.rotation ?? 0) + this._beatPulse;
      const rotRad   = rotDeg * Math.PI / 180;
      const decay    = this.params.decay ?? 0.97;

      // Apply hue-rotate filter if needed
      if (this._hueAccum !== 0) {
        this._ctxB.filter = `hue-rotate(${this._hueAccum}deg)`;
      }

      // Draw previous accumulated frame, scaled & rotated
      this._ctxB.globalAlpha = amount * decay;
      this._ctxB.translate(width / 2, height / 2);
      this._ctxB.rotate(rotRad);
      this._ctxB.scale(zoom, zoom);
      this._ctxB.drawImage(this._bufA, -width / 2, -height / 2);

      this._ctxB.setTransform(1, 0, 0, 1, 0, 0);
      this._ctxB.filter = 'none';
      this._ctxB.globalAlpha = 1;
    }

    // Draw the live composite from the main canvas on top (at 1-amount blend)
    if (mainCanvas) {
      const liveAlpha = this._firstFrame ? 1.0 : (1 - (this.params.amount ?? 0.88));
      this._ctxB.globalAlpha = liveAlpha;
      this._ctxB.drawImage(mainCanvas, 0, 0, width, height);
      this._ctxB.globalAlpha = 1;
    }

    this._ctxB.restore();

    // ── Step 2: swap buffers ─────────────────────────────────────
    // Copy bufB → bufA for next frame
    this._ctxA.clearRect(0, 0, width, height);
    this._ctxA.drawImage(this._bufB, 0, 0);

    this._firstFrame = false;

    // ── Step 3: draw accumulated result to layer canvas ──────────
    // ctx is already translated to canvas centre by Renderer
    ctx.save();
    ctx.drawImage(this._bufA, -width / 2, -height / 2);
    ctx.restore();
  }

  _ensureBuffers(W, H) {
    if (this._bufA && this._bufA.width === W && this._bufA.height === H) return;

    this._bufA = document.createElement('canvas');
    this._bufA.width = W; this._bufA.height = H;
    this._ctxA = this._bufA.getContext('2d');

    this._bufB = document.createElement('canvas');
    this._bufB.width = W; this._bufB.height = H;
    this._ctxB = this._bufB.getContext('2d');

    this._firstFrame = true;
  }

  dispose() {
    this._bufA = null; this._bufB = null;
    this._ctxA = null; this._ctxB = null;
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
