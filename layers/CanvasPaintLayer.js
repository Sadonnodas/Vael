/**
 * layers/CanvasPaintLayer.js
 * A persistent drawing layer — strokes stay on screen until manually or
 * beat-triggered cleared. Great for live illustration and band branding.
 *
 * Features:
 *   - Draw directly on the Vael canvas by clicking/dragging (when this
 *     layer is selected in the PARAMS tab — a mode toggle activates it)
 *   - Brush size and opacity react to audio
 *   - Hue slowly shifts over time (or can be fixed)
 *   - Beat-clear: wipes the canvas on every N beats
 *   - Fade: canvas slowly fades to black each frame, leaving trails
 *   - Clear button in params panel
 *
 * Usage:
 *   Add layer → "Canvas Paint"
 *   Select the layer → enable Draw mode in PARAMS
 *   Click/drag on the canvas to paint
 */

class CanvasPaintLayer extends BaseLayer {

  static manifest = {
    name: 'Canvas Paint',
    version: '1.0',
    params: [
      { id: 'brushSize',   label: 'Brush size',    type: 'float', default: 12,   min: 1,   max: 80  },
      { id: 'opacity',     label: 'Opacity',        type: 'float', default: 0.85, min: 0.05, max: 1  },
      { id: 'color',       label: 'Color',          type: 'color', default: '#00d4aa' },
      { id: 'hueShift',    label: 'Hue shift/sec',  type: 'float', default: 0,    min: 0,   max: 120 },
      { id: 'audioSize',   label: 'Audio → size',   type: 'float', default: 0.5,  min: 0,   max: 1   },
      { id: 'audioOpac',   label: 'Audio → opacity',type: 'float', default: 0,    min: 0,   max: 1   },
      { id: 'fade',        label: 'Fade speed',     type: 'float', default: 0,    min: 0,   max: 0.15 },
      { id: 'beatClear',   label: 'Beat clear',     type: 'bool',  default: false },
      { id: 'beatEvery',   label: 'Clear every N beats', type: 'int', default: 4, min: 1, max: 32,
        showWhen: { beatClear: true } },
      { id: 'blendMode',   label: 'Brush blend',    type: 'enum',  default: 'source-over',
        options: ['source-over','screen','add','multiply','overlay','difference'] },
      { id: 'drawMode',    label: 'Draw mode',      type: 'bool',  default: false },
    ],
  };

  constructor(id) {
    super(id, 'Canvas Paint');
    this.params = {
      brushSize: 12,
      opacity:   0.85,
      color:     '#00d4aa',
      hueShift:  0,
      audioSize: 0.5,
      audioOpac: 0,
      fade:      0,
      beatClear: false,
      beatEvery: 4,
      blendMode: 'source-over',
      drawMode:  false,
    };

    // Persistent paint canvas
    this._paintCanvas = null;
    this._paintCtx    = null;

    // Drawing state
    this._isDrawing   = false;
    this._lastX       = 0;
    this._lastY       = 0;
    this._hueOffset   = 0;
    this._beatCount   = 0;
    this._audioSmooth = 0;

    // Event listener refs for cleanup
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp   = null;
    this._canvas        = null;    // the main Vael canvas element
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  // ── Canvas setup ─────────────────────────────────────────────

  _ensurePaintCanvas(w, h) {
    if (!this._paintCanvas) {
      this._paintCanvas        = document.createElement('canvas');
      this._paintCanvas.width  = w;
      this._paintCanvas.height = h;
      this._paintCtx           = this._paintCanvas.getContext('2d');
    } else if (this._paintCanvas.width !== w || this._paintCanvas.height !== h) {
      // Resize — preserve content by copying to a temp canvas
      const tmp    = document.createElement('canvas');
      tmp.width    = w; tmp.height = h;
      tmp.getContext('2d').drawImage(this._paintCanvas, 0, 0, w, h);
      this._paintCanvas.width  = w;
      this._paintCanvas.height = h;
      this._paintCtx.drawImage(tmp, 0, 0);
    }
  }

  // ── Update ────────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    this._hueOffset   += dt * (this.params.hueShift ?? 0);
    const av           = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    this._audioSmooth  = VaelMath.lerp(this._audioSmooth, av, 0.1);

    // Beat clear
    if (this.params.beatClear && audioData?.isBeat) {
      this._beatCount++;
      if (this._beatCount >= (this.params.beatEvery ?? 4)) {
        this._beatCount = 0;
        this.clear();
      }
    }

    // Fade effect — slowly dim the paint canvas each frame
    if (this.params.fade > 0 && this._paintCtx) {
      this._paintCtx.globalCompositeOperation = 'destination-out';
      this._paintCtx.globalAlpha = this.params.fade * dt * 60 * 0.015;
      this._paintCtx.fillRect(0, 0,
        this._paintCanvas?.width  || 1,
        this._paintCanvas?.height || 1
      );
      this._paintCtx.globalCompositeOperation = 'source-over';
      this._paintCtx.globalAlpha = 1;
    }
  }

  // ── Render ────────────────────────────────────────────────────

  render(ctx, width, height) {
    this._ensurePaintCanvas(width, height);

    // Draw paint canvas onto layer (ctx is already centred at W/2, H/2)
    ctx.save();
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._paintCanvas, 0, 0);
    ctx.restore();
  }

  // ── Drawing input ─────────────────────────────────────────────

  /**
   * Attach drawing event listeners to the main Vael canvas.
   * Called when drawMode is enabled (from App.js via setParam).
   */
  attachDrawing(mainCanvas) {
    if (this._canvas === mainCanvas) return;
    this.detachDrawing();
    this._canvas = mainCanvas;

    this._onPointerDown = (e) => {
      if (!this.params.drawMode || !this.visible) return;
      this._isDrawing = true;
      const { x, y } = this._canvasPos(e, mainCanvas);
      this._lastX = x; this._lastY = y;
      this._paint(x, y, x, y);
      // Stop the event so the canvas-drag handler doesn't also fire
      e.stopImmediatePropagation();
    };

    this._onPointerMove = (e) => {
      if (!this._isDrawing || !this.params.drawMode) return;
      const { x, y } = this._canvasPos(e, mainCanvas);
      this._paint(this._lastX, this._lastY, x, y);
      this._lastX = x; this._lastY = y;
    };

    this._onPointerUp = () => { this._isDrawing = false; };

    // Use capture phase so we get the event before the drag handler
    mainCanvas.addEventListener('mousedown',  this._onPointerDown, true);
    document.addEventListener('mousemove',    this._onPointerMove);
    document.addEventListener('mouseup',      this._onPointerUp);
    mainCanvas.addEventListener('mouseleave', this._onPointerUp);
  }

  detachDrawing() {
    if (!this._canvas) return;
    this._canvas.removeEventListener('mousedown',  this._onPointerDown, true);
    document.removeEventListener('mousemove',      this._onPointerMove);
    document.removeEventListener('mouseup',        this._onPointerUp);
    this._canvas.removeEventListener('mouseleave', this._onPointerUp);
    this._canvas     = null;
    this._isDrawing  = false;
  }

  _canvasPos(e, canvas) {
    const r     = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / r.width;
    const scaleY = canvas.height / r.height;
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top)  * scaleY,
    };
  }

  _paint(x0, y0, x1, y1) {
    if (!this._paintCtx) return;

    const pc   = this._paintCtx;
    const size = Math.max(0.5,
      (this.params.brushSize ?? 12) * (1 + this._audioSmooth * (this.params.audioSize ?? 0.5) * 3)
    );
    const opac = VaelMath.clamp(
      (this.params.opacity ?? 0.85) + this._audioSmooth * (this.params.audioOpac ?? 0),
      0.02, 1
    );

    // Current brush colour (with hue shift applied)
    let color = this.params.color ?? '#00d4aa';
    if (this._hueOffset !== 0) {
      const [r, g, b] = VaelColor.hexToRgb(color);
      const [h, s, l] = VaelColor.rgbToHsl(r, g, b);
      color = VaelColor.hsl((h + this._hueOffset) % 360, s, l);
    }

    pc.save();
    pc.globalCompositeOperation = this.params.blendMode || 'source-over';
    pc.strokeStyle = color;
    pc.lineWidth   = size;
    pc.lineCap     = 'round';
    pc.lineJoin    = 'round';
    pc.globalAlpha = opac;

    pc.beginPath();
    pc.moveTo(x0, y0);
    pc.lineTo(x1, y1);
    pc.stroke();

    pc.restore();
  }

  // ── Public controls ───────────────────────────────────────────

  clear() {
    if (this._paintCtx && this._paintCanvas) {
      this._paintCtx.clearRect(0, 0, this._paintCanvas.width, this._paintCanvas.height);
    }
  }

  setParam(id, value) {
    this.params[id] = value;
    this.modMatrix?.setBase(id, value);
    // drawMode toggle — attach or detach drawing
    if (id === 'drawMode') {
      const mainCanvas = document.getElementById('main-canvas');
      if (mainCanvas) {
        if (value) {
          this.attachDrawing(mainCanvas);
          mainCanvas.style.cursor = 'crosshair';
        } else {
          this.detachDrawing();
          mainCanvas.style.cursor = '';
        }
      }
    }
  }

  dispose() {
    this.detachDrawing();
    this._paintCanvas = null;
    this._paintCtx    = null;
  }

  toJSON() {
    // Note: paint content is not serialised (binary canvas data).
    // The layer parameters are saved but the drawing itself is session-only.
    return { ...super.toJSON(), params: { ...this.params, drawMode: false } };
  }
}
