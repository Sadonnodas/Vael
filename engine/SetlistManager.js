/**
 * engine/SetlistManager.js
 * Ordered list of preset scenes with smooth crossfade between them.
 */

class SetlistManager {

  constructor(layerStack, layerFactory) {
    this._layerStack   = layerStack;
    this._layerFactory = layerFactory;

    this.entries       = [];
    this.currentIndex  = -1;

    // Crossfade state
    this.fadeDuration  = 1.5;    // seconds
    this._fading       = false;
    this._fadeT        = 0;      // 0 → 1 progress
    this._oldLayers    = [];     // snapshot of layers being faded out
    this._oldOpacities = [];     // their original opacities

    // Callbacks
    this.onSceneChange = null;
  }

  // ── Setlist management ───────────────────────────────────────

  addEntry(entry) {
    this.entries.push({ notes: '', ...entry });
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
    if (index === this.currentIndex && !this._fading) return;

    this.currentIndex = index;
    const entry = this.entries[index];

    if (this.fadeDuration > 0) {
      this._startFade(entry.preset);
    } else {
      this._loadPreset(entry.preset);
    }

    if (typeof this.onSceneChange === 'function') {
      this.onSceneChange(index, entry);
    }
  }

  // ── Crossfade ────────────────────────────────────────────────

  /**
   * Call this every frame from App.js renderer.onFrame.
   * @param {number} dt  delta time in seconds
   */
  tick(dt) {
    if (!this._fading) return;

    this._fadeT = Math.min(1, this._fadeT + dt / this.fadeDuration);
    const t = VaelMath.smoothstep(this._fadeT);

    // Fade out old layers
    this._oldLayers.forEach((layer, i) => {
      layer.opacity = this._oldOpacities[i] * (1 - t);
    });

    // Fade in new layers (they started at opacity 0)
    this._layerStack.layers.forEach(layer => {
      if (!layer._fadeTarget) return;
      layer.opacity = layer._fadeTarget * t;
    });

    if (this._fadeT >= 1) {
      this._finishFade();
    }
  }

  _startFade(preset) {
    // Snapshot current layers as "old"
    this._oldLayers    = [...this._layerStack.layers];
    this._oldOpacities = this._oldLayers.map(l => l.opacity);
    this._fadeT        = 0;
    this._fading       = true;

    // Load new layers at opacity 0, store target opacity
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
        if (typeof layer.init === 'function') layer.init(layer.params || {});
        this._layerStack.add(layer);
      } catch (e) {
        console.warn('SetlistManager crossfade: could not load layer', e);
      }
    });
  }

  _finishFade() {
    // Remove old layers
    this._oldLayers.forEach(l => this._layerStack.remove(l.id));

    // Snap new layers to their target opacity
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
        if (def.params && layer.params) Object.assign(layer.params, def.params);
        if (typeof layer.init === 'function') layer.init(layer.params || {});
        this._layerStack.add(layer);
      } catch (e) {
        console.warn('SetlistManager: could not load layer', e);
      }
    });
  }

  // ── Accessors ────────────────────────────────────────────────

  get current()     { return this.entries[this.currentIndex] ?? null; }
  get next_entry()  {
    if (!this.entries.length) return null;
    return this.entries[(this.currentIndex + 1) % this.entries.length] ?? null;
  }
  get count()       { return this.entries.length; }
  get isFading()    { return this._fading; }

  // ── Serialisation ────────────────────────────────────────────

  toJSON() {
    return {
      currentIndex: this.currentIndex,
      fadeDuration: this.fadeDuration,
      entries:      this.entries,
    };
  }

  fromJSON(data) {
    this.entries       = data.entries      || [];
    this.fadeDuration  = data.fadeDuration ?? 1.5;
    this.currentIndex  = data.currentIndex ?? 0;
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