/**
 * layers/VideoPlayerLayer.js
 * Renders a video from the VideoLibrary as a visual layer.
 *
 * CHANGE: Added `videoId` param. When set, the layer reads its video
 * from the global VideoLibrary instance (window.videoLibrary) by ID.
 * This allows multiple VideoPlayerLayers to each show a different video.
 * Falls back to the legacy passed-in videoElement if videoId is empty.
 *
 * The VideoLibrary dropdown in the params panel is rendered by
 * ParamPanel as a special 'videolibrary' type param.
 */

class VideoPlayerLayer extends BaseLayer {

  static manifest = {
    name: 'Video',
    version: '2.0',
    params: [
      { id: 'videoId',     label: 'Video source',     type: 'videolibrary', default: '' },
      { id: 'flipH',       label: 'Flip horizontal',  type: 'bool',  default: false },
      { id: 'fitMode',     label: 'Fit',              type: 'enum',  default: 'cover',
        options: ['cover', 'contain', 'stretch'] },
      // Legacy audio params kept for preset compatibility but hidden in UI
      { id: 'audioTarget', label: 'Audio → opacity',  type: 'band',  default: 'volume', legacy: true },
      { id: 'audioAmount', label: 'Audio amount',      type: 'float', default: 0.0, min: 0, max: 1, legacy: true },
    ],
  };

  constructor(id, fallbackVideoElement) {
    super(id, 'Video');
    // fallbackVideoElement is the legacy single VideoEngine element
    this._fallbackEl  = fallbackVideoElement || null;
    this._audioSmooth = 0;
    this.params = {
      videoId:     '',
      flipH:       false,
      fitMode:     'cover',
      audioTarget: 'volume',
      audioAmount: 0.0,
    };
  }

  init(params = {}) { Object.assign(this.params, params); }

  /** Called by legacy VideoPanel when a single video file is loaded */
  setVideoElement(el) { this._fallbackEl = el; }

  // ── Active video element ─────────────────────────────────────

  get _videoEl() {
    // Prefer VideoLibrary if a videoId is set
    if (this.params.videoId && typeof window.videoLibrary !== 'undefined') {
      const el = window.videoLibrary.getElement(this.params.videoId);
      if (el) return el;
    }
    // Fall back to legacy single-video element
    return this._fallbackEl;
  }

  // ── Update / render ──────────────────────────────────────────

  update(audioData, videoData, dt) {
    const audioVal    = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, audioVal, 0.08);
  }

  render(ctx, width, height) {
    const el = this._videoEl;
    if (!el || el.readyState < 2) {
      // Draw a placeholder when no video is loaded yet
      this._drawPlaceholder(ctx, width, height);
      return;
    }

    const vw     = el.videoWidth  || width;
    const vh     = el.videoHeight || height;
    const aspect = vw / vh;

    let dw, dh, dx, dy;

    if (this.params.fitMode === 'cover') {
      if (width / height > aspect) { dw = width;  dh = width / aspect; }
      else                          { dh = height; dw = height * aspect; }
    } else if (this.params.fitMode === 'contain') {
      if (width / height > aspect) { dh = height; dw = height * aspect; }
      else                          { dw = width;  dh = width / aspect; }
    } else {
      dw = width; dh = height;
    }
    dx = -dw / 2;
    dy = -dh / 2;

    ctx.save();
    if (this.params.flipH) ctx.scale(-1, 1);

    const audioOpacity = 1 - this.params.audioAmount + this._audioSmooth * this.params.audioAmount;
    ctx.globalAlpha = VaelMath.clamp(this.opacity * audioOpacity, 0, 1);

    ctx.drawImage(el, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawPlaceholder(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 10]);
    ctx.strokeRect(-width / 2 + 20, -height / 2 + 20, width - 40, height - 40);
    ctx.setLineDash([]);
    ctx.fillStyle   = 'rgba(255,255,255,0.2)';
    ctx.font        = '13px monospace';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No video — open LIBRARY tab', 0, 0);
    ctx.restore();
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
