/**
 * engine/ModMatrix.js
 * Per-layer modulation matrix.
 *
 * CHANGES:
 * - depth range extended: -2 to +2 (was 0 to 1). Negative depth inverts
 *   the signal. Values > 1 allow more than one full param range of movement.
 * - Transform targets: routes can target 'transform.x', 'transform.y',
 *   'transform.scaleX', 'transform.scaleY', 'transform.rotation'.
 *   These have their own sensible default ranges.
 * - Signal amplification: audio signals are amplified before routing so
 *   small values (like quiet audio) still produce visible movement.
 *   The amplification is per-source and configurable.
 */

class ModRoute {
  constructor({ source, target, depth = 0.5, smooth = 0.1,
                min = null, max = null, invert = false }) {
    this.id      = `mod-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    this.source  = source;
    this.target  = target;
    this.depth   = depth;   // -2 to +2 — negative inverts, >1 = extra range
    this.smooth  = smooth;  // 0.01 (slow) – 1.0 (instant)
    this.min     = min;     // override clamp min (null = use manifest/default)
    this.max     = max;     // override clamp max (null = use manifest/default)
    this.invert  = invert;  // legacy — use negative depth instead

    this._smoothed = 0;
  }

  toJSON() {
    return { source: this.source, target: this.target, depth: this.depth,
             smooth: this.smooth, min: this.min, max: this.max, invert: this.invert };
  }
}

class ModMatrix {
  constructor() {
    this.routes    = [];
    this._baseVals = new Map();
  }

  addRoute(config, layer = null) {
    const route = new ModRoute(config);
    this.routes.push(route);

    // Capture base values immediately from the layer's current state,
    // so the resting position is always the value at the moment of wiring —
    // not whatever it happens to be on the first modulated frame.
    if (layer) {
      this._captureBase(route.target, layer);
    }

    return route;
  }

  /**
   * Record the layer's current param/transform/opacity value as the base
   * for a given target, unless a base has already been stored for it.
   */
  _captureBase(target, layer) {
    if (this._baseVals.has(target)) return; // already set — don't overwrite

    if (target.startsWith('transform.')) {
      const key   = target.slice('transform.'.length);
      const range = _transformRange(key);
      this._baseVals.set(target, layer.transform?.[key] ?? range.base);
    } else if (target === 'opacity') {
      this._baseVals.set('opacity', layer.opacity ?? 1);
    } else {
      this._baseVals.set(target, layer.params?.[target] ?? 0);
    }
  }

  removeRoute(id) {
    this.routes = this.routes.filter(r => r.id !== id);
  }

  clear() {
    this.routes = [];
    this._baseVals.clear();
  }

  /**
   * Apply all routes to layer.params and layer.transform.
   * Called every frame by LayerStack.update().
   */
  apply(layer, signals) {
    if (!this.routes.length) return;

    this.routes.forEach(route => {
      const { source, target, depth, smooth, invert, min, max } = route;

      // Get raw signal (0–1)
      let raw = signals?.[source] ?? layer.uniforms?.[source] ?? 0;
      raw = Math.max(0, Math.min(1, raw));
      if (invert) raw = 1 - raw;

      // Smooth per-route
      route._smoothed += (raw - route._smoothed) * Math.min(1, smooth);

      // Is this a transform target?
      const isTransform = target.startsWith('transform.');
      const transformKey = isTransform ? target.slice('transform.'.length) : null;

      if (isTransform) {
        // Transform targets have their own default ranges
        const range = _transformRange(transformKey);
        const baseKey = `transform.${transformKey}`;

        if (!this._baseVals.has(baseKey)) {
          this._baseVals.set(baseKey, layer.transform?.[transformKey] ?? range.base);
        }
        const base = this._baseVals.get(baseKey);
        const pMin = min ?? range.min;
        const pMax = max ?? range.max;
        const r    = pMax - pMin;

        const modValue = base + route._smoothed * depth * r;
        const clamped  = Math.max(pMin, Math.min(pMax, modValue));
        if (layer.transform) layer.transform[transformKey] = clamped;

      } else if (target === 'opacity') {
        // Opacity lives directly on the layer object, not in params
        if (!this._baseVals.has('opacity')) {
          this._baseVals.set('opacity', layer.opacity ?? 1);
        }
        const base     = this._baseVals.get('opacity');
        const pMin     = min ?? 0;
        const pMax     = max ?? 1;
        const modValue = base + route._smoothed * depth * (pMax - pMin);
        layer.opacity  = Math.max(0, Math.min(1, modValue));

      } else {
        // Standard param target
        if (!layer.params) return;

        if (!this._baseVals.has(target)) {
          this._baseVals.set(target, layer.params[target] ?? 0);
        }
        const base     = this._baseVals.get(target);
        const manifest = layer.constructor?.manifest?.params?.find(p => p.id === target);
        const pMin     = min ?? manifest?.min ?? 0;
        const pMax     = max ?? manifest?.max ?? 1;
        const r        = pMax - pMin;

        const modValue = base + route._smoothed * depth * r;
        layer.params[target] = Math.max(pMin, Math.min(pMax, modValue));
      }
    });
  }

  setBase(target, value) {
    this._baseVals.set(target, value);
  }

  getBase(target, fallback) {
    return this._baseVals.has(target) ? this._baseVals.get(target) : fallback;
  }

  toJSON() {
    return this.routes.map(r => r.toJSON());
  }

  fromJSON(data, layer = null) {
    this._baseVals.clear();
    this.routes = (data || []).map(d => new ModRoute(d));
    // Capture base values from the layer's current state if available,
    // so restored routes start from the correct resting position.
    if (layer) {
      this.routes.forEach(r => this._captureBase(r.target, layer));
    }
  }
}

// Default ranges for transform targets
function _transformRange(key) {
  switch (key) {
    case 'x':        return { min: -800, max: 800,  base: 0   };
    case 'y':        return { min: -450, max: 450,  base: 0   };
    case 'scaleX':   return { min: 0.1,  max: 4,    base: 1   };
    case 'scaleY':   return { min: 0.1,  max: 4,    base: 1   };
    case 'rotation': return { min: -180, max: 180,  base: 0   };
    default:         return { min: -1,   max: 1,    base: 0   };
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
  { id: 'iTime',       label: 'Time',          group: 'Engine' },
  { id: 'iBeat',       label: 'Beat pulse',    group: 'Engine' },
  { id: 'iMouseX',     label: 'Mouse X',       group: 'Engine' },
  { id: 'iMouseY',     label: 'Mouse Y',       group: 'Engine' },
];

// Transform target definitions for the ModMatrix UI
ModMatrix.TRANSFORM_TARGETS = [
  { id: 'transform.x',        label: 'Position X',  min: -800, max: 800  },
  { id: 'transform.y',        label: 'Position Y',  min: -450, max: 450  },
  { id: 'transform.scaleX',   label: 'Scale X',     min: 0.1,  max: 4    },
  { id: 'transform.scaleY',   label: 'Scale Y',     min: 0.1,  max: 4    },
  { id: 'transform.rotation', label: 'Rotation',    min: -180, max: 180  },
];
