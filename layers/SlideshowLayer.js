/**
 * layers/SlideshowLayer.js
 * Cycles through images from the Vael image library as a slideshow.
 *
 * Features:
 * - Duration per slide (seconds)
 * - Transition: cut | crossfade | slide-left | slide-right | zoom-in | zoom-out
 * - Order: sequential | random | ping-pong
 * - Fit mode: contain | cover | stretch
 * - Audio-reactive beat transition (next slide on beat)
 * - Can be used as a mask source just like ImageLayer
 */

class SlideshowLayer extends BaseLayer {

  static manifest = {
    name: 'Slideshow',
    version: '1.0',
    params: [
      { id: 'duration',    label: 'Slide duration (s)', type: 'float', default: 4.0, min: 0.5, max: 60 },
      { id: 'transition',  label: 'Transition',         type: 'enum',  default: 'crossfade',
        options: ['cut','crossfade','slide-left','slide-right','zoom-in','zoom-out'] },
      { id: 'transTime',   label: 'Transition time (s)', type: 'float', default: 0.8, min: 0, max: 4 },
      { id: 'order',       label: 'Order',              type: 'enum',  default: 'sequential',
        options: ['sequential','random','ping-pong'] },
      { id: 'fitMode',     label: 'Fit',                type: 'enum',  default: 'cover',
        options: ['contain','cover','stretch'] },
      { id: 'beatAdvance', label: 'Advance on beat',    type: 'bool',  default: false },
      { id: 'audioReact',  label: 'Audio react',        type: 'float', default: 0.0, min: 0, max: 1 },
    ],
  };

  constructor(id) {
    super(id, 'Slideshow');
    this.params = {
      duration:    4.0,
      transition:  'crossfade',
      transTime:   0.8,
      order:       'sequential',
      fitMode:     'cover',
      beatAdvance: false,
      audioReact:  0.0,
    };

    this._images    = [];    // array of { img, name }
    this._index     = 0;
    this._pingDir   = 1;
    this._elapsed   = 0;     // time in current slide (seconds)
    this._transElapsed = 0;  // time into the current transition
    this._inTransition = false;
    this._nextIndex = 0;

    this._audioSmooth = 0;
    this._beatPulse   = 0;
    this._prevBeat    = false;

    // Offline canvas for blending during transitions
    this._offA = null;
    this._offB = null;
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  /**
   * Load a specific set of library entries as the slideshow images.
   * @param {Array} entries  Array of { url, name } from LibraryPanel.getImages()
   */
  loadEntries(entries) {
    // Build a map of existing transforms by URL so they survive a reload
    const existingTransforms = new Map(this._images.map(e => [e.url, e.transform]));
    this._images = [];
    this._entryCount = entries.length; // synchronous count for UI before images load
    entries.forEach(entry => {
      const img = new Image();
      const savedTransform = existingTransforms.get(entry.url) || entry.transform;
      img.onload = () => {
        this._images.push({
          img,
          name:      entry.name,
          url:       entry.url,
          transform: savedTransform || { offsetX: 0, offsetY: 0, scale: 1 },
        });
      };
      img.src = entry.url;
    });
    this._index = 0;
    this._elapsed = 0;
    this._inTransition = false;
  }

  /**
   * Reorder images by providing an array of indices into this._images.
   */
  reorderImages(newOrder) {
    this._images = newOrder.map(i => this._images[i]).filter(Boolean);
    this._index  = 0;
  }

  removeImageAt(index) {
    this._images.splice(index, 1);
    if (this._index >= this._images.length) this._index = 0;
  }

  addEntry(entry) {
    const img = new Image();
    img.onload = () => this._images.push({ img, name: entry.name, url: entry.url });
    img.src = entry.url;
  }

  /**
   * Show a picker modal that lets the user choose images from the library
   * and arrange them in order. Calls onConfirm(selectedEntries) when done.
   */
  static showPickerModal(existingUrls = [], onConfirm) {
    const entries = typeof LibraryPanel !== 'undefined' ? (LibraryPanel.getImages?.() || []) : [];

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;
      display:flex;align-items:center;justify-content:center;
      font-family:var(--font-mono);
    `;

    overlay.innerHTML = `
      <div style="background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;
                  width:600px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:14px 18px;border-bottom:1px solid var(--border-dim)">
          <span style="font-size:10px;letter-spacing:2px;color:var(--accent)">SLIDESHOW IMAGES</span>
          <button id="ss-close" style="background:none;border:none;color:var(--text-dim);
                  cursor:pointer;font-size:16px">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;flex:1;overflow:hidden">
          <!-- Left: library -->
          <div style="border-right:1px solid var(--border-dim);display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 14px;font-size:8px;color:var(--text-dim);
                        border-bottom:1px solid var(--border-dim);text-transform:uppercase;letter-spacing:1px">
              Library — click to add
            </div>
            <div id="ss-library" style="overflow-y:auto;padding:8px;flex:1"></div>
          </div>
          <!-- Right: selected order -->
          <div style="display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 14px;font-size:8px;color:var(--text-dim);
                        border-bottom:1px solid var(--border-dim);text-transform:uppercase;letter-spacing:1px">
              Selected order — drag to reorder
            </div>
            <div id="ss-selected" style="overflow-y:auto;padding:8px;flex:1"></div>
          </div>
        </div>
        <div style="padding:12px 18px;border-top:1px solid var(--border-dim);
                    display:flex;justify-content:flex-end;gap:8px">
          <button id="ss-cancel" class="btn" style="font-size:9px">Cancel</button>
          <button id="ss-confirm" class="btn accent" style="font-size:9px">Use these images</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // State
    let selected = entries.filter(e => existingUrls.includes(e.url));
    if (selected.length === 0 && entries.length > 0) selected = [...entries];

    const libEl  = overlay.querySelector('#ss-library');
    const selEl  = overlay.querySelector('#ss-selected');

    const _renderLib = () => {
      libEl.innerHTML = '';
      if (entries.length === 0) {
        libEl.innerHTML = '<div style="padding:20px;text-align:center;font-size:9px;color:var(--text-dim)">No images in library.<br>Add images in the LIBRARY tab first.</div>';
        return;
      }
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px;
          border-radius:4px;cursor:pointer;margin-bottom:3px;
          background:${selected.find(s=>s.url===entry.url) ? 'rgba(0,212,170,0.1)' : 'none'};
          border:1px solid ${selected.find(s=>s.url===entry.url) ? 'var(--accent)' : 'transparent'}`;
        row.innerHTML = `
          <img src="${entry.url}" style="width:40px;height:28px;object-fit:cover;border-radius:3px;flex-shrink:0">
          <span style="font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${entry.name}</span>
          <span style="font-size:8px;color:${selected.find(s=>s.url===entry.url)?'var(--accent)':'var(--text-dim)'}">
            ${selected.find(s=>s.url===entry.url) ? '✓' : '+'}
          </span>
        `;
        row.addEventListener('click', () => {
          const idx = selected.findIndex(s => s.url === entry.url);
          if (idx >= 0) selected.splice(idx, 1);
          else selected.push(entry);
          _renderLib();
          _renderSel();
        });
        libEl.appendChild(row);
      });
    };

    // ── Transform editor: opens inside selEl replacing the list ────
    const _openTransformEditor = (entry, i) => {
      if (!entry.transform) entry.transform = { offsetX: 0, offsetY: 0, scale: 1 };
      const tr = entry.transform;
      selEl.innerHTML = '';

      // Header
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-dim)';
      hdr.innerHTML = `
        <button id="tr-back" style="background:none;border:1px solid var(--border-dim);border-radius:4px;
          color:var(--text-dim);font-family:var(--font-mono);font-size:9px;padding:3px 8px;cursor:pointer">← Back</button>
        <img src="${entry.url}" style="width:32px;height:22px;object-fit:cover;border-radius:3px;flex-shrink:0">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${entry.name}</span>
      `;
      selEl.appendChild(hdr);
      hdr.querySelector('#tr-back').addEventListener('click', () => _renderSel());

      // Live preview canvas — 16:9 aspect, fills the panel width
      const previewWrap = document.createElement('div');
      previewWrap.style.cssText = 'padding:12px;background:var(--bg)';
      const previewCanvas = document.createElement('canvas');
      const PW = 240, PH = 135; // 16:9 preview
      previewCanvas.width  = PW;
      previewCanvas.height = PH;
      previewCanvas.style.cssText = `width:100%;aspect-ratio:16/9;display:block;
        border-radius:6px;border:1px solid var(--border-dim);background:#0a0a10`;
      previewWrap.appendChild(previewCanvas);
      selEl.appendChild(previewWrap);

      const pCtx = previewCanvas.getContext('2d');
      const img  = new Image();
      img.src    = entry.url;

      const _drawPreview = () => {
        pCtx.clearRect(0, 0, PW, PH);
        pCtx.fillStyle = '#0a0a10';
        pCtx.fillRect(0, 0, PW, PH);
        if (!img.complete || !img.naturalWidth) return;

        // Draw image with cover fit + transform offsets (scaled to preview)
        const scaleX = PW / 1920; // treat canvas as 1920-wide for offset mapping
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const canvasAspect = PW / PH;

        let dw, dh;
        if (imgAspect > canvasAspect) {
          dh = PH * tr.scale;
          dw = dh * imgAspect;
        } else {
          dw = PW * tr.scale;
          dh = dw / imgAspect;
        }
        const dx = (PW - dw) / 2 + tr.offsetX * scaleX;
        const dy = (PH - dh) / 2 + tr.offsetY * scaleX;

        pCtx.save();
        pCtx.beginPath();
        pCtx.rect(0, 0, PW, PH);
        pCtx.clip();
        pCtx.drawImage(img, dx, dy, dw, dh);
        pCtx.restore();

        // Draw canvas border indicator
        pCtx.strokeStyle = 'rgba(0,212,170,0.3)';
        pCtx.lineWidth = 1;
        pCtx.strokeRect(0.5, 0.5, PW - 1, PH - 1);
      };
      img.onload = _drawPreview;
      if (img.complete) _drawPreview();

      // Sliders
      const sliderWrap = document.createElement('div');
      sliderWrap.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:14px';

      const _slider = (label, key, min, max, step, fmt) => {
        const wrap2 = document.createElement('div');
        const val   = tr[key];
        wrap2.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">${label}</span>
            <span class="sv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${fmt(val)}</span>
          </div>
          <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
            style="width:100%;accent-color:var(--accent);height:6px">
        `;
        wrap2.querySelector('input').addEventListener('input', e => {
          const v = parseFloat(e.target.value);
          tr[key] = v;
          wrap2.querySelector('.sv').textContent = fmt(v);
          _drawPreview();
        });
        return wrap2;
      };

      sliderWrap.appendChild(_slider('X offset', 'offsetX', -500, 500, 1,  v => v + 'px'));
      sliderWrap.appendChild(_slider('Y offset', 'offsetY', -500, 500, 1,  v => v + 'px'));
      sliderWrap.appendChild(_slider('Scale',    'scale',   0.1,  3,   0.01, v => v.toFixed(2) + '×'));
      selEl.appendChild(sliderWrap);

      // Reset + nav buttons
      const foot = document.createElement('div');
      foot.style.cssText = 'padding:10px 12px;border-top:1px solid var(--border-dim);display:flex;gap:8px';
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn';
      resetBtn.style.cssText = 'font-size:9px;flex:1';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', () => {
        tr.offsetX = 0; tr.offsetY = 0; tr.scale = 1;
        sliderWrap.querySelectorAll('input').forEach((sl, idx) => {
          sl.value = [0, 0, 1][idx];
        });
        sliderWrap.querySelectorAll('.sv').forEach((sp, idx) => {
          sp.textContent = ['0px', '0px', '1.00×'][idx];
        });
        _drawPreview();
      });

      // Prev / Next image buttons
      const prevBtn = document.createElement('button');
      prevBtn.className = 'btn'; prevBtn.textContent = '← Prev'; prevBtn.style.cssText = 'font-size:9px';
      prevBtn.disabled = i === 0;
      prevBtn.addEventListener('click', () => _openTransformEditor(selected[i - 1], i - 1));

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn'; nextBtn.textContent = 'Next →'; nextBtn.style.cssText = 'font-size:9px';
      nextBtn.disabled = i === selected.length - 1;
      nextBtn.addEventListener('click', () => _openTransformEditor(selected[i + 1], i + 1));

      foot.append(prevBtn, resetBtn, nextBtn);
      selEl.appendChild(foot);
    };

    const _renderSel = () => {
      selEl.innerHTML = '';
      if (selected.length === 0) {
        selEl.innerHTML = '<div style="padding:20px;text-align:center;font-size:9px;color:var(--text-dim)">No images selected.<br>Click images on the left to add them.</div>';
        return;
      }
      selected.forEach((entry, i) => {
        if (!entry.transform) entry.transform = { offsetX: 0, offsetY: 0, scale: 1 };
        const tr = entry.transform;
        const hasTransform = tr.offsetX !== 0 || tr.offsetY !== 0 || tr.scale !== 1;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:4px;border:1px solid var(--border-dim);border-radius:4px;overflow:hidden';

        const row = document.createElement('div');
        row.draggable = true;
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:grab;background:var(--bg-card)';
        row.innerHTML = `
          <span style="font-size:8px;color:var(--text-dim);min-width:14px;flex-shrink:0">${i + 1}</span>
          <img src="${entry.url}" style="width:44px;height:30px;object-fit:cover;border-radius:3px;flex-shrink:0;cursor:pointer" class="tr-thumb" title="Click to edit transform">
          <span style="font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${entry.name}</span>
          <button class="tr-edit" style="background:${hasTransform ? 'var(--accent)' : 'none'};
            border:1px solid ${hasTransform ? 'var(--accent)' : 'var(--border-dim)'};
            border-radius:4px;color:${hasTransform ? 'var(--bg)' : 'var(--text-dim)'};
            font-family:var(--font-mono);font-size:8px;padding:3px 8px;cursor:pointer;flex-shrink:0"
            title="Edit position and scale">
            ${hasTransform ? '✎ edited' : '✎ fit'}
          </button>
          <button data-rm="${i}" style="background:none;border:none;cursor:pointer;color:#ff4444;font-size:12px;flex-shrink:0">✕</button>
        `;

        // Click image thumb or edit button → open transform editor
        const openEditor = () => _openTransformEditor(entry, i);
        row.querySelector('.tr-thumb').addEventListener('click', e => { e.stopPropagation(); openEditor(); });
        row.querySelector('.tr-edit').addEventListener('click',  e => { e.stopPropagation(); openEditor(); });

        // Drag to reorder
        row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); wrap.style.opacity = '0.4'; });
        row.addEventListener('dragend',   () => { wrap.style.opacity = '1'; });
        wrap.addEventListener('dragover',  e => { e.preventDefault(); wrap.style.borderColor = 'var(--accent)'; });
        wrap.addEventListener('dragleave', () => { wrap.style.borderColor = 'var(--border-dim)'; });
        wrap.addEventListener('drop', e => {
          e.preventDefault();
          wrap.style.borderColor = 'var(--border-dim)';
          const from = parseInt(e.dataTransfer.getData('text/plain'));
          if (from !== i) {
            const [moved] = selected.splice(from, 1);
            selected.splice(i, 0, moved);
            _renderSel();
          }
        });

        row.querySelector('[data-rm]').addEventListener('click', e => {
          e.stopPropagation();
          selected.splice(i, 1);
          _renderLib();
          _renderSel();
        });

        wrap.appendChild(row);
        selEl.appendChild(wrap);
      });
    };

    _renderLib();
    _renderSel();

    overlay.querySelector('#ss-close').addEventListener('click',   () => overlay.remove());
    overlay.querySelector('#ss-cancel').addEventListener('click',  () => overlay.remove());
    overlay.querySelector('#ss-confirm').addEventListener('click', () => {
      overlay.remove();
      if (typeof onConfirm === 'function') onConfirm(selected);
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  _advance() {
    if (this._images.length < 2) return;
    this._nextIndex = this._getNextIndex();
    this._inTransition  = true;
    this._transElapsed  = 0;
  }

  _getNextIndex() {
    const n = this._images.length;
    if (n <= 1) return 0;
    switch (this.params.order) {
      case 'random':
        let r;
        do { r = Math.floor(Math.random() * n); } while (r === this._index && n > 1);
        return r;
      case 'ping-pong':
        const next = this._index + this._pingDir;
        if (next >= n || next < 0) {
          this._pingDir *= -1;
          return this._index + this._pingDir;
        }
        return next;
      case 'sequential':
      default:
        return (this._index + 1) % n;
    }
  }

  update(audioData, videoData, dt) {
    this._elapsed += dt;

    const react = this.params.audioReact ?? 0;
    const raw   = audioData?.isActive ? (audioData.bass ?? 0) * react : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, raw, 0.1);

    const isBeat   = (audioData?.isActive && audioData?.isBeat) || false;
    const beatFired = isBeat && !this._prevBeat;
    this._prevBeat  = isBeat;

    if (this.params.beatAdvance && beatFired && react > 0) {
      this._elapsed = this.params.duration; // force advance
    }

    if (this._inTransition) {
      this._transElapsed += dt;
      if (this._transElapsed >= this.params.transTime) {
        this._index       = this._nextIndex;
        this._inTransition = false;
        this._elapsed     = 0;
      }
    } else if (this._elapsed >= this.params.duration) {
      if (this._images.length > 1) {
        this._advance();
      } else {
        this._elapsed = 0;
      }
    }
  }

  render(ctx, width, height) {
    if (this._images.length === 0) {
      // Empty state
      ctx.save();
      ctx.fillStyle = 'rgba(80,80,100,0.3)';
      ctx.fillRect(-width/2, -height/2, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Slideshow — no images in library', 0, 0);
      ctx.restore();
      return;
    }

    const cur  = this._images[this._index];
    const next = this._inTransition ? this._images[this._nextIndex] : null;
    const t    = this._inTransition
      ? Math.min(1, this._transElapsed / Math.max(0.001, this.params.transTime))
      : 1;

    ctx.save();

    if (!this._inTransition || this.params.transition === 'cut') {
      this._drawImage(ctx, cur.img, width, height, 1, cur.transform?.offsetX||0, cur.transform?.offsetY||0, cur.transform?.scale||1);
      if (this._inTransition && t > 0.5 && next) {
        this._drawImage(ctx, next.img, width, height, 1, next.transform?.offsetX||0, next.transform?.offsetY||0, next.transform?.scale||1);
      }
    } else {
      switch (this.params.transition) {
        case 'crossfade':
          this._drawImage(ctx, cur.img,  width, height, 1 - t, cur.transform?.offsetX||0, cur.transform?.offsetY||0, cur.transform?.scale||1);
          this._drawImage(ctx, next.img, width, height, t,     next.transform?.offsetX||0, next.transform?.offsetY||0, next.transform?.scale||1);
          break;
        case 'slide-left':
          this._drawImage(ctx, cur.img,  width, height, 1, -t * width + (cur.transform?.offsetX||0), cur.transform?.offsetY||0, cur.transform?.scale||1);
          this._drawImage(ctx, next.img, width, height, 1, (1-t) * width + (next.transform?.offsetX||0), next.transform?.offsetY||0, next.transform?.scale||1);
          break;
        case 'slide-right':
          this._drawImage(ctx, cur.img,  width, height, 1, t * width + (cur.transform?.offsetX||0), cur.transform?.offsetY||0, cur.transform?.scale||1);
          this._drawImage(ctx, next.img, width, height, 1, -(1-t) * width + (next.transform?.offsetX||0), next.transform?.offsetY||0, next.transform?.scale||1);
          break;
        case 'zoom-in':
          this._drawImage(ctx, cur.img,  width, height, 1 - t, cur.transform?.offsetX||0, cur.transform?.offsetY||0, (cur.transform?.scale||1) * (1 + t * 0.3));
          this._drawImage(ctx, next.img, width, height, t,     0, 0, 1);
          break;
        case 'zoom-out':
          this._drawImage(ctx, cur.img,  width, height, 1 - t, 0, 0, 1);
          this._drawImage(ctx, next.img, width, height, t,     next.transform?.offsetX||0, next.transform?.offsetY||0, (next.transform?.scale||1) * (1 - (1-t) * 0.3));
          break;
        default:
          this._drawImage(ctx, cur.img, width, height, 1, 0, 0, 1);
      }
    }

    ctx.restore();
  }

  _drawImage(ctx, img, width, height, alpha, offsetX, offsetY, scale) {
    if (!img || !img.complete) return;
    ctx.save();
    ctx.globalAlpha = VaelMath.clamp(alpha, 0, 1);
    ctx.translate(offsetX, offsetY);
    if (scale !== 1) ctx.scale(scale, scale);

    const iw = img.naturalWidth  || img.width  || 1;
    const ih = img.naturalHeight || img.height || 1;
    const fit = this.params.fitMode || 'cover';

    let dx, dy, dw, dh;
    if (fit === 'stretch') {
      dx = -width/2; dy = -height/2; dw = width; dh = height;
    } else if (fit === 'cover') {
      const scale2 = Math.max(width / iw, height / ih);
      dw = iw * scale2; dh = ih * scale2;
      dx = -dw/2; dy = -dh/2;
    } else { // contain
      const scale2 = Math.min(width / iw, height / ih);
      dw = iw * scale2; dh = ih * scale2;
      dx = -dw/2; dy = -dh/2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  toJSON() {
    return {
      ...super.toJSON(),
      params: { ...this.params },
    };
  }
}
