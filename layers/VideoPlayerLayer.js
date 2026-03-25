/**
 * layers/VideoPlayerLayer.js
 * Renders a video file or webcam stream as a visual layer.
 * Blend mode + opacity controlled by audio.
 */

class VideoPlayerLayer extends BaseLayer {

  static manifest = {
    name: 'Video',
    version: '1.0',
    params: [
      { id: 'audioTarget', label: 'Audio → opacity', type: 'band',  default: 'volume' },
      { id: 'audioAmount', label: 'Audio amount',    type: 'float', default: 0.3,  min: 0, max: 1 },
      { id: 'flipH',       label: 'Flip horizontal', type: 'bool',  default: false },
      { id: 'fitMode',     label: 'Fit',             type: 'enum',  default: 'cover', options: ['cover','contain','stretch'] },
    ],
  };

  constructor(id, videoElement) {
    super(id, 'Video');
    this._videoEl = videoElement || null;
    this.params   = {
      audioTarget: 'volume',
      audioAmount: 0.3,
      flipH:       false,
      fitMode:     'cover',
    };
    this._audioSmooth = 0;
  }

  init(params = {}) { Object.assign(this.params, params); }

  setVideoElement(el) { this._videoEl = el; }

  update(audioData, videoData, dt) {
    const audioVal    = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, audioVal, 0.08);
  }

  render(ctx, width, height) {
    if (!this._videoEl || this._videoEl.readyState < 2) return;

    const vw = this._videoEl.videoWidth  || width;
    const vh = this._videoEl.videoHeight || height;

    let dw, dh, dx, dy;
    const aspect = vw / vh;

    if (this.params.fitMode === 'cover') {
      if (width / height > aspect) {
        dw = width;  dh = width / aspect;
      } else {
        dh = height; dw = height * aspect;
      }
      dx = -dw / 2; dy = -dh / 2;
    } else if (this.params.fitMode === 'contain') {
      if (width / height > aspect) {
        dh = height; dw = height * aspect;
      } else {
        dw = width;  dh = width / aspect;
      }
      dx = -dw / 2; dy = -dh / 2;
    } else {
      dw = width; dh = height; dx = -width / 2; dy = -height / 2;
    }

    ctx.save();
    if (this.params.flipH) { ctx.scale(-1, 1); }

    // Audio-driven opacity boost
    ctx.globalAlpha = VaelMath.clamp(
      this.opacity * (1 - this.params.audioAmount + this._audioSmooth * this.params.audioAmount),
      0, 1
    );

    ctx.drawImage(this._videoEl, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
