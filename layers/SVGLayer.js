/**
 * layers/SVGLayer.js
 * Load and display SVG files as a visual layer.
 * The SVG is rasterised to an offscreen canvas each frame so it
 * participates in the normal layer compositing pipeline (blend modes,
 * FX chains, modulation, masking).
 *
 * Audio reactivity via built-in params (scale pulse, hue shift on SVG elements)
 * plus the standard ModMatrix routes for transform.x/y/scaleX/scaleY/rotation.
 *
 * Workflow:
 *   1. Add SVGLayer → click "Load SVG" in PARAMS tab
 *   2. SVG renders at full canvas size (use transform to reposition/scale)
 *   3. Add ModMatrix route: iBeat → scaleX + scaleY for a pulse effect
 *   4. Use as a mask source for other layers (e.g. particles in a logo shape)
 *
 * Limitations (browser security):
 *   - SVGs with external resources (images, fonts) may not render fully
 *   - CORS restrictions apply to remote URLs
 *   - <script> elements inside SVGs are stripped for safety
 */

class SVGLayer extends BaseLayer {

  static manifest = {
    name: 'SVG',
    version: '1.0',
    params: [
      { id: 'fitMode',     label: 'Fit',            type: 'enum',  default: 'contain',
        options: ['contain', 'cover', 'stretch', 'original'] },
      { id: 'audioScale',  label: 'Audio → scale',  type: 'float', default: 0,   min: 0, max: 1    },
      { id: 'audioRotate', label: 'Audio → rotate', type: 'float', default: 0,   min: 0, max: 1    },
      { id: 'pulseOnBeat', label: 'Pulse on beat',  type: 'bool',  default: false },
      { id: 'hueShift',    label: 'Hue shift',      type: 'float', default: 0,   min: 0, max: 360  },
      { id: 'audioHue',    label: 'Audio → hue',    type: 'float', default: 0,   min: 0, max: 1    },
      { id: 'tintColor',   label: 'Tint color',     type: 'color', default: '#ffffff' },
      { id: 'tintAmount',  label: 'Tint amount',    type: 'float', default: 0,   min: 0, max: 1    },
    ],
  };

  constructor(id) {
    super(id, 'SVG');
    this.params = {
      fitMode:     'contain',
      audioScale:  0,
      audioRotate: 0,
      pulseOnBeat: false,
      hueShift:    0,
      audioHue:    0,
      tintColor:   '#ffffff',
      tintAmount:  0,
    };

    this._svgSource   = null;   // raw SVG string
    this._fileName    = '';
    this._loaded      = false;
    this._img         = null;   // HTMLImageElement rendered from SVG blob
    this._imgDirty    = true;   // needs re-rasterisation
    this._imgW        = 0;
    this._imgH        = 0;

    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._rotSmooth   = 0;
    this._hueAccum    = 0;
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  // ── Load ─────────────────────────────────────────────────────

  /**
   * Load an SVG from a File object (from a file picker).
   */
  async loadFile(file) {
    try {
      const text = await file.text();
      this._loadFromString(text, file.name);
      return true;
    } catch (e) {
      console.error('SVGLayer: could not load file', e);
      if (typeof Toast !== 'undefined') Toast.error('Could not load SVG file');
      return false;
    }
  }

  /**
   * Load an SVG from a raw string (e.g. pasted inline SVG code).
   */
  _loadFromString(svgText, filename = 'inline.svg') {
    // Strip any <script> tags for safety
    const clean = svgText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    this._svgSource = clean;
    this._fileName  = filename;
    this._loaded    = true;
    this._imgDirty  = true;
    this.name       = filename.replace(/\.svg$/i, '') || 'SVG';

    this._rasterise();
    if (typeof Toast !== 'undefined') Toast.success(`SVG loaded: ${filename}`);
  }

  /**
   * Convert the SVG string → HTMLImageElement via a Blob URL.
   * The image is cached and only re-created when params that affect
   * rasterisation change (hue shift, tint).
   */
  _rasterise() {
    if (!this._svgSource) return;

    // Apply hue filter and tint via SVG filter injection if needed
    let svg = this._svgSource;

    if (this.params.hueShift !== 0 || this.params.tintAmount > 0) {
      const hue   = (this.params.hueShift + this._hueAccum) % 360;
      const [tr, tg, tb] = VaelColor.hexToRgb(this.params.tintColor || '#ffffff');
      const tintR = (tr * this.params.tintAmount).toFixed(3);
      const tintG = (tg * this.params.tintAmount).toFixed(3);
      const tintB = (tb * this.params.tintAmount).toFixed(3);

      // Inject a filter into the SVG root element
      const filterSvg = `
        <defs>
          <filter id="vael-fx" color-interpolation-filters="sRGB">
            <feColorMatrix type="hueRotate" values="${hue}"/>
            ${this.params.tintAmount > 0 ? `
            <feColorMatrix type="matrix" values="
              ${1 - this.params.tintAmount + parseFloat(tintR)} 0 0 0 ${tintR}
              0 ${1 - this.params.tintAmount + parseFloat(tintG)} 0 0 ${tintG}
              0 0 ${1 - this.params.tintAmount + parseFloat(tintB)} 0 ${tintB}
              0 0 0 1 0"/>` : ''}
          </filter>
        </defs>`;

      // Insert filter into SVG and apply to root
      svg = svg
        .replace(/(<svg[^>]*)(>)/, (_, open, close) => {
          // Add filter attribute if not already present
          const hasFilter = /filter=/.test(open);
          const withFilter = hasFilter ? open : `${open} filter="url(#vael-fx)"`;
          return `${withFilter}${close}`;
        })
        .replace(/<svg/, `<svg`)
        .replace(/>/, `>${filterSvg}`);
    }

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      if (this._imgUrl) URL.revokeObjectURL(this._imgUrl);
      this._imgUrl   = url;
      this._img      = img;
      this._imgW     = img.naturalWidth  || 512;
      this._imgH     = img.naturalHeight || 512;
      this._imgDirty = false;
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.warn('SVGLayer: could not rasterise SVG');
    };
    img.src = url;
  }

  // ── Update ────────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    const av = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);

    if (audioData?.isActive && audioData?.isBeat && this.params.pulseOnBeat) {
      this._beatPulse = 1.0;
    }
    this._beatPulse = Math.max(0, this._beatPulse - dt * 7);

    const targetRot = this._audioSmooth * (this.params.audioRotate ?? 0) * 45;
    this._rotSmooth = VaelMath.lerp(this._rotSmooth, targetRot, 0.06);

    // Accumulate hue for audio-driven shifts
    this._hueAccum += this._audioSmooth * (this.params.audioHue ?? 0) * dt * 180;

    // Re-rasterise if hue or tint changed enough to be visible
    if ((this.params.hueShift > 0 || this.params.audioHue > 0 || this.params.tintAmount > 0)
        && this._loaded && this._svgSource) {
      this._imgDirty = true;
    }
    if (this._imgDirty && this._svgSource) {
      this._rasterise();
    }
  }

  // ── Render ────────────────────────────────────────────────────

  render(ctx, width, height) {
    if (!this._loaded || !this._img || !this._img.complete) {
      // Show placeholder while loading
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 8]);
      ctx.strokeRect(-60, -40, 120, 80);
      ctx.setLineDash([]);
      ctx.fillStyle   = 'rgba(255,255,255,0.15)';
      ctx.font        = '10px monospace';
      ctx.textAlign   = 'center';
      ctx.fillText('SVG', 0, 4);
      ctx.restore();
      return;
    }

    const iw   = this._imgW;
    const ih   = this._imgH;

    // Compute draw dimensions based on fitMode
    let dw, dh;
    const aspect = iw / ih;
    switch (this.params.fitMode) {
      case 'cover':
        if (width / height > aspect) { dw = width; dh = width / aspect; }
        else                          { dh = height; dw = height * aspect; }
        break;
      case 'stretch':
        dw = width; dh = height; break;
      case 'original':
        dw = iw; dh = ih; break;
      default: // contain
        if (width / height > aspect) { dh = height; dw = height * aspect; }
        else                          { dw = width; dh = width / aspect; }
    }

    // Audio-reactive scale
    const scaleBoost = 1
      + this._audioSmooth * (this.params.audioScale ?? 0)
      + this._beatPulse   * 0.1 * (this.params.pulseOnBeat ? 1 : 0);

    ctx.save();
    if (this._rotSmooth !== 0) ctx.rotate(this._rotSmooth * Math.PI / 180);
    ctx.scale(scaleBoost, scaleBoost);
    ctx.drawImage(this._img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // ── Prompt for file load (called from App.js) ─────────────────

  promptLoad() {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.svg,image/svg+xml';
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
    document.body.appendChild(input);
    input.click();
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await this.loadFile(file);
      input.remove();
    });
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON() {
    return {
      ...super.toJSON(),
      params:    { ...this.params },
      fileName:  this._fileName,
      svgSource: this._svgSource,   // embed the SVG text so it survives preset save
    };
  }

  // Restore svgSource when loading from a preset
  init(params = {}) {
    Object.assign(this.params, params);
    if (params.svgSource) {
      this._loadFromString(params.svgSource, params.fileName || 'restored.svg');
    }
  }
}
