/**
 * layers/TileLayer.js
 * Reads pixels from a source layer's offscreen canvas, crops a region using
 * a chosen shape, then tiles that cropped region across the canvas.
 *
 * Works with any source layer — particles, noise, video, shader, image —
 * because it reads the source's offscreen canvas which is updated every frame
 * during Renderer Pass 1.
 *
 * Source access: window._vaelRenderer._quads.get(sourceId).offscreen
 * Hide source: set source._hiddenSource = true each frame in update()
 */

class TileLayer extends BaseLayer {

  static manifest = {
    name: 'Tile & Repeat',
    version: '1.0',
    params: [
      // Source
      { id: 'sourceId',   label: 'Source layer',           type: 'enum',  default: '', options: [] },
      { id: 'hideSource', label: 'Hide source from output', type: 'bool',  default: false },

      // Crop region (normalised 0–1 of source canvas)
      { id: 'cropX', label: 'Crop X',      type: 'float', default: 0.25, min: 0,    max: 1    },
      { id: 'cropY', label: 'Crop Y',      type: 'float', default: 0.25, min: 0,    max: 1    },
      { id: 'cropW', label: 'Crop width',  type: 'float', default: 0.5,  min: 0.01, max: 1    },
      { id: 'cropH', label: 'Crop height', type: 'float', default: 0.5,  min: 0.01, max: 1    },

      // Crop shape
      { id: 'shape', label: 'Shape', type: 'enum', default: 'rectangle',
        options: ['rectangle', 'circle', 'triangle', 'hexagon', 'diamond', 'freeform'] },

      // Tile arrangement
      { id: 'tileMode',  label: 'Tile mode',  type: 'enum',  default: 'grid',
        options: ['grid', 'hex', 'brick', 'diamond'] },
      { id: 'tileScale', label: 'Tile scale', type: 'float', default: 0.3,  min: 0.05, max: 2.0  },
      { id: 'offsetX',   label: 'Offset X',   type: 'float', default: 0,    min: 0,    max: 1    },
      { id: 'offsetY',   label: 'Offset Y',   type: 'float', default: 0,    min: 0,    max: 1    },

      // Rotation
      { id: 'rotate',    label: 'Rotation',          type: 'float', default: 0,     min: 0,   max: 360  },
      { id: 'rotateAlt', label: 'Alternate rotation', type: 'bool',  default: false },

      // Mirror
      { id: 'mirror', label: 'Mirror', type: 'enum', default: 'none',
        options: ['none', 'x', 'y', 'xy'] },

      // Edge blending
      { id: 'edgeBlend', label: 'Edge blend', type: 'enum', default: 'hard',
        options: ['hard', 'soft', 'feather'] },
      { id: 'feather',   label: 'Feather',    type: 'float', default: 0.15, min: 0, max: 0.5,
        showWhen: { edgeBlend: ['soft', 'feather'] } },

      // Animation & audio
      { id: 'speed',      label: 'Scroll speed', type: 'float', default: 0, min: 0, max: 3   },
      { id: 'audioReact', label: 'Audio react',  type: 'float', default: 0, min: 0, max: 1   },
    ],
  };

  constructor(id) {
    super(id, 'Tile & Repeat');
    this.params = {
      sourceId:   '',
      hideSource: false,
      cropX: 0.25, cropY: 0.25, cropW: 0.5, cropH: 0.5,
      shape:     'rectangle',
      tileMode:  'grid',
      tileScale: 0.3,
      offsetX:   0,
      offsetY:   0,
      rotate:    0,
      rotateAlt: false,
      mirror:    'none',
      edgeBlend: 'hard',
      feather:   0.15,
      speed:     0,
      audioReact: 0,
    };

    this.freeformPoints = []; // [{x, y}] normalised 0–1, used when shape='freeform'

    this._time        = 0;
    this._audioSmooth = 0;
    this._cropCanvas  = document.createElement('canvas');
    this._cropCtx     = this._cropCanvas.getContext('2d');
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  update(audioData, videoData, dt) {
    this._time += dt;

    // Mark source layer as hidden from composite output if requested
    if (this.params.hideSource && this.params.sourceId) {
      const sourceLayers = window._vaelLayers?.layers;
      const src = sourceLayers?.find(l => l.id === this.params.sourceId);
      if (src) src._hiddenSource = true;
    }

    // Audio smoothing
    const react = this.params.audioReact ?? 0;
    const av = (audioData?.isActive && react > 0) ? (audioData.bass ?? 0) * react : 0;
    this._audioSmooth = 0.08 * av + 0.92 * this._audioSmooth;
  }

  render(ctx, width, height) {
    // 1. Find source layer offscreen canvas
    const sourceQuad = window._vaelRenderer?._quads.get(this.params.sourceId);
    if (!sourceQuad) {
      ctx.save();
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(-width/2, -height/2, width, height);
      ctx.fillStyle = '#444';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Tile & Repeat — select a source layer in params', 0, 0);
      ctx.restore();
      return;
    }
    const src = sourceQuad.offscreen;

    // 2. Crop pixel coordinates on source
    const sx = this.params.cropX * src.width;
    const sy = this.params.cropY * src.height;
    const sw = Math.max(1, this.params.cropW * src.width);
    const sh = Math.max(1, this.params.cropH * src.height);

    // 3. Tile dimensions — maintain crop aspect ratio
    const tileW = width  * this.params.tileScale;
    const tileH = tileW  * (sh / sw);

    // 4. Draw cropped + clipped + feathered tile into _cropCanvas
    if (this._cropCanvas.width  !== Math.ceil(tileW) ||
        this._cropCanvas.height !== Math.ceil(tileH)) {
      this._cropCanvas.width  = Math.ceil(tileW);
      this._cropCanvas.height = Math.ceil(tileH);
    }
    const cc = this._cropCtx;
    cc.clearRect(0, 0, tileW, tileH);

    cc.save();
    cc.beginPath();
    _buildShapePath(cc, this.params.shape, tileW, tileH, this.freeformPoints);
    cc.clip();
    cc.drawImage(src, sx, sy, sw, sh, 0, 0, tileW, tileH);

    if (this.params.edgeBlend !== 'hard') {
      _applyFeatherMask(cc, this.params.shape, tileW, tileH, this.params.feather ?? 0.15);
    }
    cc.restore();

    // 5. Animated offsets
    const animOx  = (this._time * this.params.speed * 0.1)  % 1;
    const animOy  = (this._time * this.params.speed * 0.07) % 1;
    const baseOffX = ((this.params.offsetX + animOx) % 1) * tileW;
    const baseOffY = ((this.params.offsetY + animOy) % 1) * tileH;

    // 6. Tile across canvas — ctx origin is already at canvas centre
    const startX = -width/2  - tileW + (((baseOffX % tileW) + tileW) % tileW);
    const startY = -height/2 - tileH + (((baseOffY % tileH) + tileH) % tileH);

    const cols = Math.ceil(width  / tileW) + 2;
    const rows = Math.ceil(height / tileH) + 2;

    const scaleBoost = 1 + this._audioSmooth * 0.3;
    const rot        = this.params.rotate * Math.PI / 180;
    const mirror     = this.params.mirror;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let tx = startX + col * tileW;
        let ty = startY + row * tileH;

        // Hex / brick offset: shift alternate rows by half a tile width
        if ((this.params.tileMode === 'hex' || this.params.tileMode === 'brick') && row % 2 === 1) {
          tx += tileW * 0.5;
        }

        // Diamond: offset columns on alternate rows + stagger vertically
        if (this.params.tileMode === 'diamond') {
          if (row % 2 === 1) tx += tileW * 0.5;
          ty = startY + row * tileH * 0.5;
        }

        ctx.save();
        ctx.translate(tx + tileW / 2, ty + tileH / 2);

        // Per-tile rotation (with optional alternating flip)
        const altRot = (this.params.rotateAlt && (row + col) % 2 === 1) ? Math.PI : 0;
        if (rot !== 0 || altRot !== 0) ctx.rotate(rot + altRot);

        // Mirror
        const mx = (mirror === 'x' || mirror === 'xy') && col % 2 === 1 ? -1 : 1;
        const my = (mirror === 'y' || mirror === 'xy') && row % 2 === 1 ? -1 : 1;
        ctx.scale(mx * scaleBoost, my * scaleBoost);

        ctx.drawImage(this._cropCanvas, -tileW / 2, -tileH / 2, tileW, tileH);
        ctx.restore();
      }
    }
  }

  dispose() {
    this._cropCanvas = null;
    this._cropCtx    = null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      params:         { ...this.params },
      freeformPoints: this.freeformPoints.map(p => ({ ...p })),
    };
  }
}

// ── Shape path builder ────────────────────────────────────────────

function _buildShapePath(ctx, shape, w, h, freeformPoints) {
  switch (shape) {
    case 'circle':
      ctx.ellipse(w/2, h/2, w/2, h/2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(w/2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
        const x = w/2 + Math.cos(a) * (w/2);
        const y = h/2 + Math.sin(a) * (h/2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(w/2, 0);
      ctx.lineTo(w,   h/2);
      ctx.lineTo(w/2, h);
      ctx.lineTo(0,   h/2);
      ctx.closePath();
      break;
    case 'freeform':
      if (freeformPoints && freeformPoints.length > 2) {
        ctx.moveTo(freeformPoints[0].x * w, freeformPoints[0].y * h);
        for (let i = 1; i < freeformPoints.length; i++) {
          ctx.lineTo(freeformPoints[i].x * w, freeformPoints[i].y * h);
        }
        ctx.closePath();
      } else {
        ctx.rect(0, 0, w, h);
      }
      break;
    default: // rectangle
      ctx.rect(0, 0, w, h);
  }
}

// ── Feather mask ──────────────────────────────────────────────────

function _applyFeatherMask(ctx, shape, w, h, featherAmount) {
  const f = featherAmount * Math.min(w, h) * 0.5;
  ctx.globalCompositeOperation = 'destination-out';

  if (shape === 'circle' || shape === 'hexagon') {
    const r  = Math.min(w, h) / 2;
    const grad = ctx.createRadialGradient(w/2, h/2, Math.max(0, r - f), w/2, h/2, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    const edges = [
      { x0: 0,   y0: 0,   x1: 0,   y1: f,   rx: 0,   ry: 0,   rw: w,   rh: f   }, // top
      { x0: 0,   y0: h-f, x1: 0,   y1: h,   rx: 0,   ry: h-f, rw: w,   rh: f   }, // bottom
      { x0: 0,   y0: 0,   x1: f,   y1: 0,   rx: 0,   ry: 0,   rw: f,   rh: h   }, // left
      { x0: w-f, y0: 0,   x1: w,   y1: 0,   rx: w-f, ry: 0,   rw: f,   rh: h   }, // right
    ];
    edges.forEach(e => {
      const grad = ctx.createLinearGradient(e.x0, e.y0, e.x1, e.y1);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(e.rx, e.ry, e.rw, e.rh);
    });
  }

  ctx.globalCompositeOperation = 'source-over';
}
