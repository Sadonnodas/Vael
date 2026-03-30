/**
 * layers/CanvasPaintLayer.js
 *
 * FIXES:
 * - Coordinate tracking: _canvasPos() now accounts for CSS transforms applied
 *   to the canvas by the Renderer (object-fit, scaling via style). It reads
 *   the actual rendered rect vs the canvas pixel dimensions to get exact scale.
 * - Undo stack: every stroke end saves an ImageData snapshot. undo() pops the
 *   stack and restores. Stack is capped at 40 snapshots to limit memory.
 */

class CanvasPaintLayer extends BaseLayer {

  static manifest = {
    name: 'Canvas Paint',
    version: '1.1',
    params: [
      { id: 'brushSize',   label: 'Brush size',       type: 'float', default: 12,   min: 1,    max: 80   },
      { id: 'opacity',     label: 'Opacity',           type: 'float', default: 0.85, min: 0.05, max: 1    },
      { id: 'color',       label: 'Color',             type: 'color', default: '#00d4aa' },
      { id: 'hueShift',    label: 'Hue shift/sec',     type: 'float', default: 0,    min: 0,    max: 120  },
      { id: 'audioSize',   label: 'Audio → size',      type: 'float', default: 0.5,  min: 0,    max: 1    },
      { id: 'audioOpac',   label: 'Audio → opacity',   type: 'float', default: 0,    min: 0,    max: 1    },
      { id: 'fade',        label: 'Fade speed',        type: 'float', default: 0,    min: 0,    max: 0.15 },
      { id: 'beatClear',   label: 'Beat clear',        type: 'bool',  default: false },
      { id: 'beatEvery',   label: 'Clear every N beats', type: 'int', default: 4,   min: 1,    max: 32,
        showWhen: { beatClear: true } },
      { id: 'blendMode',   label: 'Brush blend',       type: 'enum',  default: 'source-over',
        options: ['source-over','screen','add','multiply','overlay','difference'] },
      { id: 'drawMode',    label: 'Draw mode',         type: 'bool',  default: false },
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

    // Undo stack — array of ImageData snapshots, capped at 40
    this._undoStack   = [];
    this._maxUndo     = 40;
    this._strokeActive = false;  // true between pointerdown and pointerup

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
    this._canvas        = null;
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  // ── Canvas setup ──────────────────────────────────────────────

  _ensurePaintCanvas(w, h) {
    if (!this._paintCanvas) {
      this._paintCanvas        = document.createElement('canvas');
      this._paintCanvas.width  = w;
      this._paintCanvas.height = h;
      this._paintCtx           = this._paintCanvas.getContext('2d');
    } else if (this._paintCanvas.width !== w || this._paintCanvas.height !== h) {
      const tmp  = document.createElement('canvas');
      tmp.width  = w; tmp.height = h;
      tmp.getContext('2d').drawImage(this._paintCanvas, 0, 0, w, h);
      this._paintCanvas.width  = w;
      this._paintCanvas.height = h;
      this._paintCtx.drawImage(tmp, 0, 0);
      // Clear undo stack on resize — snapshots are the wrong size
      this._undoStack = [];
    }
  }

  // ── Undo stack ────────────────────────────────────────────────

  /** Save a snapshot before the current stroke begins. */
  _pushUndo() {
    if (!this._paintCtx || !this._paintCanvas) return;
    const snap = this._paintCtx.getImageData(
      0, 0, this._paintCanvas.width, this._paintCanvas.height
    );
    this._undoStack.push(snap);
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
  }

  /** Restore the most recent snapshot. */
  undo() {
    if (!this._paintCtx || !this._paintCanvas || this._undoStack.length === 0) return;
    const snap = this._undoStack.pop();
    this._paintCtx.putImageData(snap, 0, 0);
    if (typeof Toast !== 'undefined') Toast.info('Paint undo');
  }

  get canUndo() { return this._undoStack.length > 0; }

  // ── Update ────────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    this._hueOffset  += dt * (this.params.hueShift ?? 0);
    const av          = audioData?.isActive ? (audioData.bass ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.1);

    if (this.params.beatClear && audioData?.isBeat) {
      this._beatCount++;
      if (this._beatCount >= (this.params.beatEvery ?? 4)) {
        this._beatCount = 0;
        this.clear();
      }
    }

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
    ctx.save();
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._paintCanvas, 0, 0);
    ctx.restore();
  }

  // ── Drawing input ─────────────────────────────────────────────

  attachDrawing(mainCanvas) {
    if (this._canvas === mainCanvas) return;
    this.detachDrawing();
    this._canvas = mainCanvas;

    this._onPointerDown = (e) => {
      if (!this.params.drawMode || !this.visible) return;
      // Save undo snapshot at the START of each stroke, not during it
      if (!this._strokeActive) {
        this._strokeActive = true;
        this._pushUndo();
      }
      this._isDrawing = true;
      const { x, y } = this._canvasPos(e, mainCanvas);
      this._lastX = x; this._lastY = y;
      this._paint(x, y, x, y);
      e.stopImmediatePropagation();
    };

    this._onPointerMove = (e) => {
      if (!this._isDrawing || !this.params.drawMode) return;
      const { x, y } = this._canvasPos(e, mainCanvas);
      this._paint(this._lastX, this._lastY, x, y);
      this._lastX = x; this._lastY = y;
    };

    this._onPointerUp = () => {
      this._isDrawing   = false;
      this._strokeActive = false;
    };

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
    this._canvas      = null;
    this._isDrawing   = false;
    this._strokeActive = false;
  }

  /**
   * Convert a mouse event to paint-canvas pixel coordinates.
   *
   * The canvas element is rendered at devicePixelRatio scaling by Three.js
   * (canvas.width = clientWidth * dpr). The paint canvas however works in
   * logical CSS pixels — the same space the layer render() receives as
   * width/height. So we map the mouse position into the CSS display rect
   * only, ignoring the physical pixel scaling entirely.
   *
   * scaleX/Y = logical render size / CSS display size.
   * On a standard display this is 1.0. On Retina it is still 1.0 because
   * both the logical render size (what render() uses) and the CSS display
   * size are in the same coordinate space.
   *
   * We derive the logical render size from the Renderer via
   * window._vaelRenderer if available, falling back to clientWidth/clientHeight.
   */
  _canvasPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();

    // Logical render dimensions (what layers receive as width/height in render())
    // These equal clientWidth/clientHeight, NOT canvas.width/canvas.height which
    // includes devicePixelRatio multiplication done by Three.js.
    const logicalW = window._vaelRenderer?.width  ?? canvas.clientWidth;
    const logicalH = window._vaelRenderer?.height ?? canvas.clientHeight;

    const scaleX = logicalW / rect.width;
    const scaleY = logicalH / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
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
    this._undoStack = [];
  }

  setParam(id, value) {
    this.params[id] = value;
    this.modMatrix?.setBase(id, value);
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
    this._undoStack   = [];
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params, drawMode: false } };
  }
}
