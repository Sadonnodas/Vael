/**
 * engine/SetlistManager.js
 * Ordered list of preset scenes with smooth transitions between them.
 *
 * FIXES:
 * - _flashLoaded misfire: was never reset when goto() was called during an
 *   active fade. Now any call to goto() while fading immediately cancels the
 *   current fade cleanly before starting the new one.
 * - blur transition didn't restore canvas.style.filter on fast double-skip.
 * - crossfade left dangling _fadeTarget properties if cancelled mid-fade.
 *
 * NEW:
 * - Thumbnail capture: addEntry() can receive a thumbnail dataURL; when
 *   scenes are added via the setlist panel the canvas is snapshotted.
 * - onSceneChange now receives { index, entry, thumbnail }.
 */

class SetlistManager {

  constructor(layerStack, layerFactory, audioEngine = null) {
    this._layerStack   = layerStack;
    this._layerFactory = layerFactory;
    this._audioEngine  = audioEngine;  // needed to re-attach to WaveformLayer on load

    this.entries       = [];
    this.currentIndex  = -1;

    this.fadeDuration   = 1.5;
    this.transitionType = 'crossfade';  // 'crossfade' | 'flash' | 'blur' | 'cut'
    this._fading        = false;
    this._fadeT         = 0;
    this._oldLayers     = [];
    this._oldOpacities  = [];
    this._pendingPreset = null;
    this._flashLoaded   = false;

    // Auto-thumbnail: when true, captureThumbnail() is called after every
    // scene switch finishes. Set _captureCanvas to the main canvas element.
    this.autoCaptureThumbnails = false;
    this._captureCanvas        = null;

    this.onSceneChange = null;
  }

  // ── Setlist management ───────────────────────────────────────

  addEntry(entry) {
    this.entries.push({ notes: '', thumbnail: null, ...entry });
    if (this.currentIndex === -1) this.currentIndex = 0;
  }

  removeEntry(index) {
    this.entries.splice(index, 1);
    if (this.currentIndex >= this.entries.length) {
      this.currentIndex = Math.max(0, this.entries.length - 1);
    }
  }

  moveEntry(from, to) {
    const [entry] = this.entries.splice(from, 1);
    this.entries.splice(to, 0, entry);
  }

  // ── Navigation ───────────────────────────────────────────────

  next() {
    if (!this.entries.length) return;
    this.goto((this.currentIndex + 1) % this.entries.length);
  }

  prev() {
    if (!this.entries.length) return;
    this.goto((this.currentIndex - 1 + this.entries.length) % this.entries.length);
  }

  goto(index) {
    if (index < 0 || index >= this.entries.length) return;

    // If already fading, cancel cleanly before starting new transition
    if (this._fading) {
      this._cancelFade();
    }

    this.currentIndex = index;
    const entry = this.entries[index];

    if (this.fadeDuration > 0 && this.transitionType !== 'cut') {
      this._startFade(entry.preset);
    } else {
      this._loadPreset(entry.preset);
      // Auto-capture for cut transitions (no _finishFade is called)
      if (this.autoCaptureThumbnails && this._captureCanvas) {
        setTimeout(() => {
          this.captureThumbnail(this._captureCanvas, this.currentIndex);
          if (typeof this.onThumbUpdate === 'function') this.onThumbUpdate(this.currentIndex);
        }, 200);
      }
    }

    if (typeof this.onSceneChange === 'function') {
      this.onSceneChange(index, entry);
    }
  }

  // ── Transition tick ──────────────────────────────────────────

  tick(dt) {
    if (!this._fading) return;

    this._fadeT = Math.min(1, this._fadeT + dt / this.fadeDuration);
    const t = VaelMath.smoothstep(this._fadeT);

    switch (this.transitionType) {
      case 'flash': {
        const overlay = document.getElementById('vael-transition-overlay');
        if (overlay) {
          // Triangle wave: ramp up 0→1 in first half, ramp down 1→0 in second half
          const flashT = this._fadeT < 0.5
            ? this._fadeT * 2
            : (1 - this._fadeT) * 2;
          overlay.style.opacity = (flashT * 0.95).toString();
        }
        // Load new scene at peak of flash (halfway point)
        if (this._fadeT >= 0.5 && !this._flashLoaded) {
          this._flashLoaded = true;
          if (this._pendingPreset) {
            this._loadPreset(this._pendingPreset);
            this._pendingPreset = null;
          }
        }
        break;
      }

      case 'blur': {
        const canvas = document.getElementById('main-canvas');
        if (canvas) {
          const blurPeak = t < 0.5 ? t * 2 : (1 - t) * 2;
          canvas.style.filter = `blur(${(blurPeak * 14).toFixed(1)}px)`;
        }
        // Swap scenes at halfway
        if (this._fadeT >= 0.5 && !this._flashLoaded) {
          this._flashLoaded = true;
          if (this._pendingPreset) {
            this._loadPreset(this._pendingPreset);
            this._pendingPreset = null;
          }
        }
        break;
      }

      default: { // crossfade
        this._oldLayers.forEach((layer, i) => {
          layer.opacity = this._oldOpacities[i] * (1 - t);
        });
        this._layerStack.layers.forEach(layer => {
          if (layer._fadeTarget === undefined) return;
          layer.opacity = layer._fadeTarget * t;
        });
      }
    }

    if (this._fadeT >= 1) {
      this._finishFade();
    }
  }

  // ── Internal fade machinery ──────────────────────────────────

  _startFade(preset) {
    this._flashLoaded   = false;
    this._pendingPreset = null;
    this._fadeT         = 0;
    this._fading        = true;

    if (this.transitionType === 'flash' || this.transitionType === 'blur') {
      this._pendingPreset = preset;
      return;
    }

    // Crossfade: snapshot current layers, then load new ones at opacity 0
    this._oldLayers    = [...this._layerStack.layers];
    this._oldOpacities = this._oldLayers.map(l => l.opacity);

    if (!preset?.layers) { this._finishFade(); return; }

    preset.layers.forEach(def => {
      try {
        const layer = this._layerFactory(def.type, `${def.id}-fade-${Date.now()}`);
        if (!layer) return;
        layer.name        = def.name      ?? layer.name;
        layer.visible     = def.visible   ?? true;
        layer.blendMode   = def.blendMode ?? 'normal';
        layer._fadeTarget = def.opacity   ?? 1;
        layer.opacity     = 0;
        if (def.params && layer.params) Object.assign(layer.params, def.params);
        if (def.transform && layer.transform) Object.assign(layer.transform, def.transform);
        if (this._audioEngine && '_audioEngine' in layer) {
          layer._audioEngine = this._audioEngine;
        }
        if (typeof layer.init === 'function') layer.init(layer.params || {});
        this._layerStack.add(layer);
      } catch (e) {
        console.warn('SetlistManager crossfade: could not load layer', e);
      }
    });
  }

  /**
   * Cancel an in-progress fade cleanly.
   * Restores canvas state and removes any half-loaded crossfade layers.
   */
  _cancelFade() {
    // Restore canvas filter if blur was active
    const canvas = document.getElementById('main-canvas');
    if (canvas) canvas.style.filter = '';

    // Restore flash overlay
    const overlay = document.getElementById('vael-transition-overlay');
    if (overlay) overlay.style.opacity = '0';

    // Remove half-loaded crossfade layers and restore old opacities
    if (this._oldLayers.length) {
      // Remove new layers (those with _fadeTarget set)
      [...this._layerStack.layers].forEach(layer => {
        if (layer._fadeTarget !== undefined) {
          this._layerStack.remove(layer.id);
        }
      });
      // Restore old layer opacities
      this._oldLayers.forEach((layer, i) => {
        layer.opacity = this._oldOpacities[i];
      });
    }

    this._oldLayers     = [];
    this._oldOpacities  = [];
    this._fading        = false;
    this._fadeT         = 0;
    this._flashLoaded   = false;
    this._pendingPreset = null;
  }

  _finishFade() {
    // Restore canvas effects
    const canvas = document.getElementById('main-canvas');
    if (canvas) canvas.style.filter = '';
    const overlay = document.getElementById('vael-transition-overlay');
    if (overlay) overlay.style.opacity = '0';

    // Remove old crossfade layers
    this._oldLayers.forEach(l => this._layerStack.remove(l.id));

    // Snap new layers to target opacity
    this._layerStack.layers.forEach(layer => {
      if (layer._fadeTarget !== undefined) {
        layer.opacity = layer._fadeTarget;
        delete layer._fadeTarget;
      }
    });

    this._oldLayers    = [];
    this._oldOpacities = [];
    this._fading       = false;
    this._fadeT        = 0;
    this._flashLoaded  = false;

    // Auto-capture thumbnail after fade completes — small delay lets the
    // new scene render a frame first so the snapshot isn't black.
    if (this.autoCaptureThumbnails && this._captureCanvas) {
      setTimeout(() => {
        this.captureThumbnail(this._captureCanvas, this.currentIndex);
        if (typeof this.onThumbUpdate === 'function') this.onThumbUpdate(this.currentIndex);
      }, 200);
    }
  }

  // ── Direct load (no fade) ────────────────────────────────────

  _loadPreset(preset) {
    if (!preset?.layers) return;
    [...this._layerStack.layers].forEach(l => this._layerStack.remove(l.id));
    preset.layers.forEach(def => {
      try {
        const layer = this._layerFactory(def.type, def.id + '-sl');
        if (!layer) return;
        layer.name      = def.name      ?? layer.name;
        layer.visible   = def.visible   ?? true;
        layer.opacity   = def.opacity   ?? 1;
        layer.blendMode = def.blendMode ?? 'normal';
        if (def.params    && layer.params)     Object.assign(layer.params, def.params);
        if (def.transform && layer.transform)  Object.assign(layer.transform, def.transform);
        if (def.modMatrix && layer.modMatrix)  layer.modMatrix.fromJSON(def.modMatrix, layer);
        // Re-attach audio engine for layers that need direct analyser access
        if (this._audioEngine && '_audioEngine' in layer) {
          layer._audioEngine = this._audioEngine;
        }
        if (typeof layer.init === 'function')  layer.init(layer.params || {});
        this._layerStack.add(layer);
      } catch (e) {
        console.warn('SetlistManager: could not load layer', e);
      }
    });
  }

  // ── Thumbnail capture ────────────────────────────────────────

  /**
   * Capture a thumbnail from the current canvas output.
   * Call this when adding a scene to the setlist.
   * @param {HTMLCanvasElement} canvas  — the main output canvas
   * @param {number} index              — setlist entry index to update
   */
  captureThumbnail(canvas, index) {
    if (index < 0 || index >= this.entries.length) return;
    try {
      const t = document.createElement('canvas');
      t.width  = 160;
      t.height = 90;
      t.getContext('2d').drawImage(canvas, 0, 0, 160, 90);
      this.entries[index].thumbnail = t.toDataURL('image/jpeg', 0.7);
    } catch {}
  }

  // ── Accessors ────────────────────────────────────────────────

  get current()    { return this.entries[this.currentIndex] ?? null; }
  get nextEntry()  {
    if (!this.entries.length) return null;
    return this.entries[(this.currentIndex + 1) % this.entries.length] ?? null;
  }
  get count()      { return this.entries.length; }
  get isFading()   { return this._fading; }

  // ── Serialisation ────────────────────────────────────────────

  toJSON() {
    return {
      currentIndex: this.currentIndex,
      fadeDuration: this.fadeDuration,
      entries:      this.entries,
    };
  }

  fromJSON(data) {
    this.entries      = data.entries      || [];
    this.fadeDuration = data.fadeDuration ?? 1.5;
    this.currentIndex = data.currentIndex ?? 0;
  }

  saveToFile(filename = 'vael-setlist.json') {
    const blob = new Blob([JSON.stringify(this.toJSON(), null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async loadFromFile(file) {
    const text = await file.text();
    try { this.fromJSON(JSON.parse(text)); }
    catch { throw new Error('Invalid setlist file'); }
  }
}
