/**
 * engine/ModMatrix.js
 * Per-layer modulation matrix.
 * Routes any signal source to any numeric layer parameter
 * with independent depth, smoothing, and range per route.
 *
 * Sources:
 *   Audio:  bass, mid, treble, volume
 *   Video:  brightness, motion, hue, edgeDensity
 *   Engine: iTime, iBeat, iBpm, iMouseX, iMouseY
 *
 * Each layer owns a ModMatrix instance at layer.modMatrix.
 * LayerStack calls modMatrix.apply(layer, audioData) every frame,
 * after which layer.params contain the modulated values.
 *
 * Usage:
 *   layer.modMatrix.addRoute({ source: 'bass', target: 'angle', depth: 0.5, smooth: 0.1 });
 *   layer.modMatrix.addRoute({ source: 'motion', target: 'zoom', depth: 0.3, smooth: 0.05 });
 *   // every frame:
 *   layer.modMatrix.apply(layer, audioData);
 */

class ModRoute {
  constructor({ source, target, depth = 0.5, smooth = 0.1, min = null, max = null, invert = false }) {
    this.id      = `mod-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    this.source  = source;   // signal source key
    this.target  = target;   // layer.params key to modulate
    this.depth   = depth;    // 0–1, how much the source drives the param
    this.smooth  = smooth;   // 0.01 (very slow) – 1.0 (instant)
    this.min     = min;      // optional clamp min (null = use param manifest min)
    this.max     = max;      // optional clamp max (null = use param manifest max)
    this.invert  = invert;   // flip the signal (1-value)

    this._smoothed = 0;      // internal smoothed signal value
  }

  toJSON() {
    return { source: this.source, target: this.target, depth: this.depth,
             smooth: this.smooth, min: this.min, max: this.max, invert: this.invert };
  }
}

class ModMatrix {
  constructor() {
    this.routes    = [];
    this._baseVals = new Map();  // target → original param value before modulation
  }

  addRoute(config) {
    const route = new ModRoute(config);
    this.routes.push(route);
    return route;
  }

  removeRoute(id) {
    this.routes = this.routes.filter(r => r.id !== id);
  }

  clear() {
    this.routes = [];
    this._baseVals.clear();
  }

  /**
   * Apply all routes to layer.params.
   * Called every frame by LayerStack.update().
   * @param {BaseLayer} layer
   * @param {object} signals  — merged audio/video/uniform data
   */
  apply(layer, signals) {
    if (!this.routes.length || !layer.params) return;

    // Reset params to base values before applying modulation
    // Base values are the "static" values — what the user set manually
    // We store them the first time we see each param
    this.routes.forEach(route => {
      const { source, target, depth, smooth, invert, min, max } = route;

      // Get raw signal value
      let raw = 0;
      if (signals)         raw = signals[source] ?? 0;
      if (layer.uniforms)  raw = raw || (layer.uniforms[source] ?? raw);

      // Clamp and optionally invert
      raw = Math.max(0, Math.min(1, raw));
      if (invert) raw = 1 - raw;

      // Smooth the signal per-route (independent smoothing per route)
      route._smoothed = route._smoothed + (raw - route._smoothed) * Math.min(1, smooth);

      // Get the base value (what the param was when no modulation applied)
      if (!this._baseVals.has(target)) {
        this._baseVals.set(target, layer.params[target] ?? 0);
      }
      const base = this._baseVals.get(target);

      // Find param range from manifest
      const manifest = layer.constructor?.manifest?.params?.find(p => p.id === target);
      const pMin = min    ?? manifest?.min  ?? 0;
      const pMax = max    ?? manifest?.max  ?? 1;
      const range = pMax - pMin;

      // Apply: base + signal * depth * range, clamped to param range
      const modValue = base + route._smoothed * depth * range;
      layer.params[target] = Math.max(pMin, Math.min(pMax, modValue));
    });
  }

  /**
   * Update a base value when the user manually moves a slider.
   * Call this from ParamPanel when a slider changes.
   */
  setBase(target, value) {
    this._baseVals.set(target, value);
  }

  /**
   * Get base value for display in the slider (unmodulated value).
   */
  getBase(target, fallback) {
    return this._baseVals.has(target) ? this._baseVals.get(target) : fallback;
  }

  toJSON() {
    return this.routes.map(r => r.toJSON());
  }

  fromJSON(data) {
    this.routes = (data || []).map(d => new ModRoute(d));
  }
}

// Signal source definitions for UI
ModMatrix.SOURCES = [
  { id: 'bass',        label: 'Bass',          group: 'Audio' },
  { id: 'mid',         label: 'Mid',           group: 'Audio' },
  { id: 'treble',      label: 'Treble',        group: 'Audio' },
  { id: 'volume',      label: 'Volume',        group: 'Audio' },
  { id: 'brightness',  label: 'Brightness',    group: 'Video' },
  { id: 'motion',      label: 'Motion',        group: 'Video' },
  { id: 'edgeDensity', label: 'Edge density',  group: 'Video' },
  { id: 'iTime',       label: 'Time (slow)',   group: 'Engine' },
  { id: 'iBeat',       label: 'Beat pulse',    group: 'Engine' },
  { id: 'iMouseX',     label: 'Mouse X',       group: 'Engine' },
  { id: 'iMouseY',     label: 'Mouse Y',       group: 'Engine' },
];
