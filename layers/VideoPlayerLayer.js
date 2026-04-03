/**
 * layers/VideoPlayerLayer.js
 * Renders a video file as a visual layer.
 * Each layer owns its own <video> element and can play a different file.
 * Videos are loaded from the library or uploaded directly.
 */

class VideoPlayerLayer extends BaseLayer {

  static manifest = {
    name: 'Video',
    version: '2.0',
    params: [
      { id: 'audioReact',    label: 'Audio react',     type: 'float', default: 0.0,  min: 0,    max: 1   },
      { id: 'playbackRate',  label: 'Playback speed',  type: 'float', default: 1.0,  min: 0.1,  max: 4.0, step: 0.05 },
      { id: 'flipH',        label: 'Flip horizontal', type: 'bool',  default: false },
      { id: 'fitMode',      label: 'Fit',             type: 'enum',  default: 'cover', options: ['cover','contain','stretch'] },
      { id: 'loop',         label: 'Loop',            type: 'bool',  default: true  },
      { id: 'muted',        label: 'Muted',           type: 'bool',  default: true  },
    ],
  };

  constructor(id) {
    super(id, 'Video');
    // Ensure transform is fully initialized so ModMatrix can cache correct base values
    if (!this.transform || this.transform.scaleX === undefined) {
      this.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    }
    this.params = {
      audioReact:   0.0,
      playbackRate: 1.0,
      flipH:        false,
      fitMode:      'cover',
      loop:         true,
      muted:        true,
    };
    this._audioSmooth  = 0;
    this._videoEl      = null;
    this._sourceName   = null;   // display name of loaded file
    this._sourceUrl    = null;   // object URL or library URL
    this._libraryId    = null;   // if loaded from library, the entry id
    this._createOwnVideo();
  }

  _createOwnVideo() {
    const el = document.createElement('video');
    el.muted    = true;
    el.loop     = true;
    el.autoplay = true;
    el.playsInline = true;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px';
    document.body.appendChild(el);
    this._videoEl = el;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    // Restore from saved state
    if (params._sourceUrl) this._loadUrl(params._sourceUrl, params._sourceName || 'video');
    if (params._libraryId) this._libraryId = params._libraryId;
  }

  /** Load a video from a File object (upload) */
  loadFile(file) {
    if (this._sourceUrl && this._sourceUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this._sourceUrl);
    }
    const url = URL.createObjectURL(file);
    this._sourceName = file.name;
    this._libraryId  = null;
    this._loadUrl(url, file.name);
  }

  /** Load from a VideoLibrary entry { id, url, name, element } */
  loadFromLibraryEntry(entry) {
    this._libraryId  = entry.id;
    this._sourceName = entry.name;
    this._loadUrl(entry.url, entry.name);
  }

  _loadUrl(url, name) {
    this._sourceUrl  = url;
    this._sourceName = name;
    this._videoEl.src = url;
    this._videoEl.loop   = this.params.loop  !== false;
    this._videoEl.muted  = this.params.muted !== false;
    this._videoEl.play().catch(() => {});
  }

  /** Called by setVideoElement for backwards compat (ignored — we own our element) */
  setVideoElement() {}

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData.volume ?? 0) * (this.params.audioReact ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (this._videoEl) {
      const rate = this.params.playbackRate ?? 1.0;
      if (Math.abs(this._videoEl.playbackRate - rate) > 0.01) this._videoEl.playbackRate = rate;
      if (this._videoEl.loop  !== (this.params.loop  !== false)) this._videoEl.loop  = this.params.loop  !== false;
      if (this._videoEl.muted !== (this.params.muted !== false)) this._videoEl.muted = this.params.muted !== false;
    }
  }

  render(ctx, width, height) {
    if (!this._videoEl || this._videoEl.readyState < 2) {
      // Draw placeholder if no video loaded
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(-width/2, -height/2, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this._sourceName ? 'Loading...' : 'No video — click Edit in PARAMS', 0, 0);
      ctx.restore();
      return;
    }

    const vw = this._videoEl.videoWidth  || width;
    const vh = this._videoEl.videoHeight || height;
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
    dx = -dw / 2; dy = -dh / 2;

    ctx.save();
    if (this.params.flipH) ctx.scale(-1, 1);
    ctx.drawImage(this._videoEl, dx, dy, dw, dh);
    ctx.restore();
  }

  destroy() {
    if (this._videoEl) {
      this._videoEl.pause();
      this._videoEl.src = '';
      if (this._videoEl.parentNode) this._videoEl.parentNode.removeChild(this._videoEl);
      this._videoEl = null;
    }
    if (this._sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(this._sourceUrl);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      params: { ...this.params, _sourceUrl: this._sourceUrl, _sourceName: this._sourceName, _libraryId: this._libraryId },
    };
  }
}
