/**
 * layers/ImageLayer.js
 * Loads a static image (PNG, JPG, SVG, WebP) as a visual layer.
 * Supports audio-reactive scale, rotation, and opacity.
 * Works perfectly as a mask source for other layers.
 *
 * Workflow for image-masked particles:
 *   1. Add ImageLayer → load star.png
 *   2. Add ParticleLayer → set mask = ImageLayer
 *   3. Particles only appear where the star has pixels
 *   4. Add mod route: iBeat → scaleX + scaleY on ImageLayer
 *   5. Star pulses to beat, particles follow
 */

class ImageLayer extends BaseLayer {

  static manifest = {
    name: 'Image',
    version: '1.0',
    params: [
      { id: 'fitMode',      label: 'Fit',           type: 'enum',  default: 'contain',
        options: ['contain', 'cover', 'stretch', 'original'] },
      { id: 'opacity',      label: 'Opacity',       type: 'float', default: 1.0, min: 0, max: 1   },
      { id: 'tintHue',      label: 'Tint hue',      type: 'float', default: 0,   min: 0, max: 360  },
      { id: 'tintAmount',   label: 'Tint amount',   type: 'float', default: 0,   min: 0, max: 1    },
      { id: 'audioTarget',  label: 'Audio → scale', type: 'band',  default: 'bass' },
      { id: 'audioScale',   label: 'Audio scale',   type: 'float', default: 0.0, min: 0, max: 1    },
      { id: 'audioRotate',  label: 'Audio rotate',  type: 'float', default: 0.0, min: 0, max: 1    },
      { id: 'pulseOnBeat',  label: 'Pulse on beat', type: 'bool',  default: false },
    ],
  };

  constructor(id) {
    super(id, 'Image');
    this.params = {
      fitMode:     'contain',
      opacity:     1.0,
      tintHue:     0,
      tintAmount:  0,
      audioTarget: 'bass',
      audioScale:  0.0,
      audioRotate: 0.0,
      pulseOnBeat: false,
    };

    this._img         = null;
    this._loaded      = false;
    this._fileName    = '';
    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._rotSmooth   = 0;

    // Tint offscreen canvas
    this._tintCanvas  = null;
    this._tintCtx     = null;
    this._tintDirty   = true;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    if (params.src) this._loadUrl(params.src);
  }

  // ── Load ─────────────────────────────────────────────────────

  loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this._loadUrl(url, file.name, resolve, reject);
    });
  }

  _loadUrl(url, name = '', resolve, reject) {
    const img = new Image();
    img.onload = () => {
      this._img      = img;
      this._loaded   = true;
      this._fileName = name || url.split('/').pop();
      this.name      = this._fileName.replace(/\.[^.]+$/, '') || 'Image';
      this._tintDirty = true;
      if (typeof Toast !== 'undefined') Toast.success(`Image loaded: ${this.name}`);
      if (resolve) resolve(img);
    };
    img.onerror = () => {
      if (typeof Toast !== 'undefined') Toast.error('Could not load image');
      if (reject) reject(new Error('Image load failed'));
    };
    img.src = url;
  }

  // ── Update ────────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);

    if (audioData?.isBeat && this.params.pulseOnBeat) {
      this._beatPulse = 1.0;
    }
    this._beatPulse = Math.max(0, this._beatPulse - dt * 8);

    const targetRot = this._audioSmooth * this.params.audioRotate * 45;
    this._rotSmooth = VaelMath.lerp(this._rotSmooth, targetRot, 0.05);

    // Mark tint dirty if tint params changed
    this._tintDirty = true;
  }

  render(ctx, width, height) {
    if (!this._loaded || !this._img) return;

    const img  = this._img;
    const iw   = img.naturalWidth;
    const ih   = img.naturalHeight;
    const fit  = this.params.fitMode;

    // Compute draw size
    let dw, dh;
    const aspect = iw / ih;

    switch (fit) {
      case 'cover':
        if (width / height > aspect) { dw = width; dh = width / aspect; }
        else                          { dh = height; dw = height * aspect; }
        break;
      case 'stretch':
        dw = width; dh = height;
        break;
      case 'original':
        dw = iw; dh = ih;
        break;
      default: // contain
        if (width / height > aspect) { dh = height; dw = height * aspect; }
        else                          { dw = width; dh = width / aspect; }
    }

    // Audio-reactive scale
    const scaleBoost = 1 + this._audioSmooth * this.params.audioScale
                         + this._beatPulse * 0.12 * (this.params.pulseOnBeat ? 1 : 0);

    ctx.save();

    // Rotation from audio
    if (this._rotSmooth !== 0) {
      ctx.rotate(this._rotSmooth * Math.PI / 180);
    }

    ctx.scale(scaleBoost, scaleBoost);

    // Draw image (ctx origin is at canvas centre)
    const source = this._getTintedSource(dw, dh);
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);

    ctx.restore();
  }

  // ── Tint ─────────────────────────────────────────────────────

  _getTintedSource(dw, dh) {
    if (this.params.tintAmount <= 0) return this._img;

    const W = Math.ceil(dw);
    const H = Math.ceil(dh);

    if (!this._tintCanvas || this._tintCanvas.width !== W || this._tintCanvas.height !== H) {
      this._tintCanvas       = document.createElement('canvas');
      this._tintCanvas.width  = W;
      this._tintCanvas.height = H;
      this._tintCtx           = this._tintCanvas.getContext('2d');
      this._tintDirty         = true;
    }

    if (this._tintDirty) {
      const tc = this._tintCtx;
      tc.clearRect(0, 0, W, H);
      tc.drawImage(this._img, 0, 0, W, H);

      // Apply hue tint via color blend
      tc.globalCompositeOperation = 'color';
      tc.fillStyle = VaelColor.hsl(this.params.tintHue, 0.8, 0.5);
      tc.globalAlpha = this.params.tintAmount;
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'source-over';
      tc.globalAlpha = 1;

      this._tintDirty = false;
    }

    return this._tintCanvas;
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON() {
    return {
      ...super.toJSON(),
      fileName: this._fileName,
      params:   { ...this.params },
      // Note: image data is NOT serialised — user must reload on next session
      // A future version could store as data URL (but could be large)
    };
  }
}
