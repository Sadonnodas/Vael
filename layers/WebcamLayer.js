/**
 * layers/WebcamLayer.js
 * Live webcam input as a visual layer.
 * Manages its own MediaStream — no dependency on VideoEngine.
 * Supports flip, chroma key (basic green screen), and audio-reactive opacity.
 */

class WebcamLayer extends BaseLayer {

  static manifest = {
    name: 'Webcam',
    version: '1.0',
    params: [
      { id: 'flipH',       label: 'Flip horizontal', type: 'bool',  default: true  },
      { id: 'flipV',       label: 'Flip vertical',   type: 'bool',  default: false },
      { id: 'chromaKey',   label: 'Chroma key',      type: 'bool',  default: false },
      { id: 'chromaHue',   label: 'Chroma hue',      type: 'float', default: 120, min: 0,   max: 360 },
      { id: 'chromaRange', label: 'Chroma range',    type: 'float', default: 40,  min: 5,   max: 120 },
      { id: 'audioTarget', label: 'Audio → opacity', type: 'band',  default: 'volume' },
      { id: 'audioAmount', label: 'Audio amount',    type: 'float', default: 0.0, min: 0,   max: 1   },
      { id: 'fitMode',     label: 'Fit',             type: 'enum',  default: 'cover',
        options: ['cover', 'contain', 'stretch'] },
    ],
  };

  constructor(id) {
    super(id, 'Webcam');
    this.params = {
      flipH:       true,
      flipV:       false,
      chromaKey:   false,
      chromaHue:   120,
      chromaRange: 40,
      audioTarget: 'volume',
      audioAmount: 0.0,
      fitMode:     'cover',
    };

    this._stream      = null;
    this._videoEl     = null;
    this._ready       = false;
    this._audioSmooth = 0;

    // Offscreen canvas for chroma key processing
    this._chromaCanvas = null;
    this._chromaCtx    = null;
  }

  init(params = {}) {
    Object.assign(this.params, params);
    this._start();
  }

  async _start() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      const video       = document.createElement('video');
      video.srcObject   = this._stream;
      video.muted       = true;
      video.playsInline = true;
      video.autoplay    = true;
      await video.play();

      this._videoEl = video;
      this._ready   = true;

      if (typeof Toast !== 'undefined') Toast.success('Webcam layer started');
    } catch (e) {
      console.error('WebcamLayer: could not start camera', e);
      if (typeof Toast !== 'undefined') Toast.error('Camera access denied');
    }
  }

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
  }

  render(ctx, width, height) {
    if (!this._ready || !this._videoEl || this._videoEl.readyState < 2) return;

    const vw = this._videoEl.videoWidth  || width;
    const vh = this._videoEl.videoHeight || height;

    // Compute draw dimensions
    let dw, dh, dx, dy;
    const aspect = vw / vh;

    if (this.params.fitMode === 'cover') {
      if (width / height > aspect) { dw = width; dh = width / aspect; }
      else                         { dh = height; dw = height * aspect; }
    } else if (this.params.fitMode === 'contain') {
      if (width / height > aspect) { dh = height; dw = height * aspect; }
      else                         { dw = width; dh = width / aspect; }
    } else {
      dw = width; dh = height;
    }
    dx = -dw / 2; dy = -dh / 2;

    ctx.save();

    // Audio-driven opacity
    const audioOpacity = 1 - this.params.audioAmount + this._audioSmooth * this.params.audioAmount;
    ctx.globalAlpha = VaelMath.clamp(this.opacity * audioOpacity, 0, 1);

    // Flip transforms
    const scaleX = this.params.flipH ? -1 : 1;
    const scaleY = this.params.flipV ? -1 : 1;
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);

    if (this.params.chromaKey) {
      this._drawWithChromaKey(ctx, dx, dy, dw, dh);
    } else {
      ctx.drawImage(this._videoEl, dx, dy, dw, dh);
    }

    ctx.restore();
  }

  _drawWithChromaKey(ctx, dx, dy, dw, dh) {
    const W = Math.round(dw);
    const H = Math.round(dh);

    // Resize chroma canvas if needed
    if (!this._chromaCanvas || this._chromaCanvas.width !== W || this._chromaCanvas.height !== H) {
      this._chromaCanvas        = document.createElement('canvas');
      this._chromaCanvas.width  = W;
      this._chromaCanvas.height = H;
      this._chromaCtx           = this._chromaCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Draw video to chroma canvas
    this._chromaCtx.drawImage(this._videoEl, 0, 0, W, H);
    const imageData = this._chromaCtx.getImageData(0, 0, W, H);
    const data      = imageData.data;

    const targetHue = this.params.chromaHue;
    const range     = this.params.chromaRange;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i+1] / 255;
      const b = data[i+2] / 255;
      const [h, s, l] = VaelColor.rgbToHsl(r, g, b);

      // Check if pixel hue is within chroma range and has enough saturation
      let hueDiff = Math.abs(h - targetHue);
      if (hueDiff > 180) hueDiff = 360 - hueDiff;

      if (hueDiff < range && s > 0.25 && l > 0.1 && l < 0.9) {
        // Feather the edges
        const alpha = VaelMath.clamp((hueDiff / range - 0.5) * 2, 0, 1);
        data[i+3]   = Math.round(alpha * 255);
      }
    }

    this._chromaCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(this._chromaCanvas, dx, dy, dw, dh);
  }

  dispose() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._videoEl) {
      this._videoEl.srcObject = null;
      this._videoEl = null;
    }
    this._ready = false;
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
