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
      { id: 'audioReact', label: 'Audio → zoom', type: 'float', default: 0.0,  min: 0,     max: 1     },
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
      audioReact: 0.0,
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
    const react = this.params.audioReact ?? 0;
    const av = audioData?.isActive ? (audioData.bass ?? 0) * react : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.1);
    if (react > 0 && audioData?.isActive && audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
    this._hueAccum += this.params.hueShift * dt * 60;
  }

  render(ctx, width, height) {
    // FeedbackLayer as a canvas 2D layer cannot access the WebGL framebuffer,
    // so it cannot capture the composited scene beneath it. This means the
    // feedback loop has nothing to feed on and produces no visible output.
    //
    // ✅ USE THE FX TAB INSTEAD:
    // Go to FX tab → Add "Feedback trail" — this is the working GPU-level
    // feedback effect with Amount, Zoom, Rotation, Hue drift, and Decay.
    //
    // This placeholder renders a visible notice so the layer isn't invisible.
    ctx.save();
    ctx.translate(-width/2, -height/2);
    ctx.fillStyle = 'rgba(120,60,180,0.12)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(200,160,255,0.7)';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Feedback Trail → use the FX tab instead', width/2, height/2 - 12);
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(200,160,255,0.45)';
    ctx.fillText('FX tab → Add → Feedback trail', width/2, height/2 + 12);
    ctx.restore();
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
