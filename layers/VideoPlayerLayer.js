/**
 * layers/VideoPlayerLayer.js
 * Renders a video file as a visual layer.
 * Each layer owns its own <video> element and can play a different file.
 * Videos are loaded from the library or uploaded directly.
 *
 * Playback modes:
 *   forward  — normal forward playback (default)
 *   reverse  — plays backwards in update() by decrementing currentTime
 *   pingpong — bounces between inPoint and outPoint
 *
 * In/out points are stored in seconds (0 = start, 0 = out means use full duration).
 */

class VideoPlayerLayer extends BaseLayer {

  static manifest = {
    name: 'Video',
    version: '3.0',
    params: [
      { id: 'audioReact',    label: 'Audio react',     type: 'float', default: 0.0,  min: 0,   max: 1    },
      { id: 'playbackRate',  label: 'Playback speed',  type: 'float', default: 1.0,  min: 0.1, max: 4.0, step: 0.05 },
      { id: 'playMode',      label: 'Play mode',       type: 'enum',  default: 'forward', options: ['forward','reverse','pingpong'] },
      { id: 'inPoint',       label: 'In point (s)',    type: 'float', default: 0,    min: 0,   max: 3600, step: 0.1 },
      { id: 'outPoint',      label: 'Out point (s)',   type: 'float', default: 0,    min: 0,   max: 3600, step: 0.1,
        description: '0 = end of clip' },
      { id: 'flipH',        label: 'Flip horizontal', type: 'bool',  default: false },
      { id: 'fitMode',      label: 'Fit',             type: 'enum',  default: 'cover', options: ['cover','contain','stretch'] },
      { id: 'loop',         label: 'Loop',            type: 'bool',  default: true  },
      { id: 'muted',        label: 'Muted',           type: 'bool',  default: true  },
      { id: 'playOnLoad',   label: 'Play on load',    type: 'bool',  default: true  },
    ],
  };

  constructor(id) {
    super(id, 'Video');
    if (!this.transform || this.transform.scaleX === undefined) {
      this.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    }
    this.params = {
      audioReact:   0.0,
      playbackRate: 1.0,
      playMode:     'forward',
      inPoint:      0,
      outPoint:     0,
      flipH:        false,
      fitMode:      'cover',
      loop:         true,
      muted:        true,
    };
    this._audioSmooth  = 0;
    this._videoEl      = null;
    this._sourceName   = null;
    this._sourceUrl    = null;
    this._libraryId    = null;
    this._pingDir      = 1;    // +1 = forward, -1 = reverse (for pingpong)
    this._playing      = true; // controlled by play()/pause()/stop()
    this._frameCache   = null; // last successfully drawn frame (used during seeks)
    this._frameCacheCtx = null;
    this._createOwnVideo();
  }

  _createOwnVideo() {
    const el = document.createElement('video');
    el.muted    = true;
    el.loop     = false;   // we handle looping and in/out manually
    el.autoplay = true;
    el.playsInline = true;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px';
    document.body.appendChild(el);
    this._videoEl = el;

    // When the browser fires 'ended', our update() loop would see a paused video
    // with _playing=true and call play() again, restarting it. Handle it here instead.
    el.addEventListener('ended', () => {
      if (this.params.loop !== false) {
        el.currentTime = this._inPoint();
        el.play().catch(() => {});
      } else {
        this._playing = false;
      }
    });
  }

  init(params = {}) {
    Object.assign(this.params, params);
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
    this._sourceUrl    = url;
    this._sourceName   = name;
    this._frameCache   = null;   // discard stale cache from previous clip
    this._frameCacheCtx = null;
    this._videoEl.src  = url;
    this._videoEl.muted = this.params.muted !== false;
    this._pingDir = 1;
    this._playing = this.params.playOnLoad !== false;
    if (this._playing) this._videoEl.play().catch(() => {});
    // Jump to in point once metadata is ready
    this._videoEl.addEventListener('loadedmetadata', () => {
      const ip = this._inPoint();
      if (ip > 0) this._videoEl.currentTime = ip;
    }, { once: true });
  }

  get isPlaying() { return this._playing; }

  play() {
    this._playing = true;
    if (this._videoEl && this.params.playMode === 'forward') {
      this._videoEl.play().catch(() => {});
    }
  }

  pause() {
    this._playing = false;
    if (this._videoEl && !this._videoEl.paused) this._videoEl.pause();
  }

  stop() {
    this._playing = false;
    if (this._videoEl) {
      if (!this._videoEl.paused) this._videoEl.pause();
      this._videoEl.currentTime = this._inPoint();
    }
  }

  /** Called for backwards compat (ignored — we own our element) */
  setVideoElement() {}

  _inPoint() {
    return Math.max(0, this.params.inPoint ?? 0);
  }

  _outPoint() {
    const op = this.params.outPoint ?? 0;
    const dur = this._videoEl?.duration;
    if (!op || op <= 0) return (isFinite(dur) ? dur : 0);
    return isFinite(dur) ? Math.min(op, dur) : op;
  }

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData.volume ?? 0) * (this.params.audioReact ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);

    if (!this._videoEl || this._videoEl.readyState < 1) return;

    const muted = this.params.muted !== false;
    if (this._videoEl.muted !== muted) this._videoEl.muted = muted;

    const rate = this.params.playbackRate ?? 1.0;
    const mode = this.params.playMode ?? 'forward';
    const ip   = this._inPoint();
    const op   = this._outPoint();

    if (mode === 'forward') {
      if (this._playing) {
        if (this._videoEl.paused) this._videoEl.play().catch(() => {});
        if (this._videoEl.playbackRate !== rate) this._videoEl.playbackRate = rate;
        if (op > 0 && this._videoEl.currentTime >= op) {
          if (this.params.loop !== false) {
            this._videoEl.currentTime = ip;
          } else {
            this._videoEl.pause();
            this._playing = false;
          }
        }
        if (this._videoEl.currentTime < ip) this._videoEl.currentTime = ip;
      } else {
        if (!this._videoEl.paused) this._videoEl.pause();
      }

    } else if (mode === 'reverse') {
      if (!this._videoEl.paused) this._videoEl.pause();
      if (!this._playing) return;
      const step = rate * dt;
      let t = this._videoEl.currentTime - step;
      if (t <= ip) {
        t = (this.params.loop !== false) ? op : ip;
        if (this.params.loop === false) { this._playing = false; return; }
      }
      this._videoEl.currentTime = t;

    } else if (mode === 'pingpong') {
      if (!this._videoEl.paused) this._videoEl.pause();
      if (!this._playing) return;
      const step = rate * dt;
      let t = this._videoEl.currentTime + this._pingDir * step;
      if (t >= op) {
        t = op;
        this._pingDir = -1;
      } else if (t <= ip) {
        t = ip;
        this._pingDir = 1;
      }
      this._videoEl.currentTime = t;
    }
  }

  render(ctx, width, height) {
    const el = this._videoEl;

    if (!el || el.readyState < 2) {
      // Use the last good cached frame (e.g. mid-seek) to avoid a blank flash
      if (this._frameCache) {
        this._drawSource(ctx, this._frameCache, width, height);
      }
      // Render nothing while loading — no loading text in the visual output.
      // The operator sees status in the LayerPanel; the audience sees a clean frame.
      return;
    }

    // Draw the live frame
    this._drawSource(ctx, el, width, height);

    // Cache a copy for use during seek-induced readyState drops
    const vw = el.videoWidth || width;
    const vh = el.videoHeight || height;
    if (!this._frameCache || this._frameCache.width !== vw || this._frameCache.height !== vh) {
      this._frameCache    = document.createElement('canvas');
      this._frameCache.width  = vw;
      this._frameCache.height = vh;
      this._frameCacheCtx = this._frameCache.getContext('2d');
    }
    this._frameCacheCtx.drawImage(el, 0, 0, vw, vh);
  }

  /** Draw `source` (video element or canvas) fitted to the layer canvas. */
  _drawSource(ctx, source, width, height) {
    const vw = source.videoWidth || source.width  || width;
    const vh = source.videoHeight || source.height || height;
    const aspect = vw / vh;
    let dw, dh;
    if (this.params.fitMode === 'cover') {
      if (width / height > aspect) { dw = width;  dh = width / aspect; }
      else                          { dh = height; dw = height * aspect; }
    } else if (this.params.fitMode === 'contain') {
      if (width / height > aspect) { dh = height; dw = height * aspect; }
      else                          { dw = width;  dh = width / aspect; }
    } else {
      dw = width; dh = height;
    }
    ctx.save();
    if (this.params.flipH) ctx.scale(-1, 1);
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
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
