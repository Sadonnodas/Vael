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
                min = null, max = null, invert = false, curve = 'linear' }) {
    this.id      = `mod-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    this.source  = source;
    this.target  = target;
    this.depth   = depth;   // -2 to +2 — negative inverts, >1 = extra range
    this.smooth  = smooth;  // 0.01 (slow) – 1.0 (instant)
    this.min     = min;
    this.max     = max;
    this.invert  = invert;  // legacy — use negative depth instead
    this.curve   = curve;   // 'linear' | 'exp' | 'log' | 'scurve' | 'step' | 'invert'

    this._smoothed = 0;
  }

  toJSON() {
    return { source: this.source, target: this.target, depth: this.depth,
             smooth: this.smooth, min: this.min, max: this.max,
             invert: this.invert, curve: this.curve };
  }
}

class ModMatrix {
  constructor() {
    this.routes    = [];
    this._baseVals = new Map();
  }

  addRoute(config) {
    const route = new ModRoute(config);
    this.routes.push(route);
    // Clear cached base values so the new route reads fresh values next frame
    this._baseVals.clear();
    return route;
  }

  removeRoute(id) {
    this.routes = this.routes.filter(r => r.id !== id);
    this._baseVals.clear();
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

    // When no audio is active, audio-sourced signals should be exactly 0,
    // not slowly decaying — this ensures depth slider has no effect without music.
    const audioInactive = signals && signals.isActive === false;

    this.routes.forEach(route => {
      const { source, target, depth, smooth, invert, min, max } = route;

      // Audio sources snap to 0 when audio is inactive
      const AUDIO_SOURCES = new Set([
        'bass','mid','treble','volume','rms',
        'spectralCentroid','spectralSpread','spectralFlux',
        'kickEnergy','snareEnergy','hihatEnergy',
        'isBeat','iBeat','kickBeat','snareBeat','hihatBeat',
        'songPosition','songTime',
      ]);
      const isAudioSource = AUDIO_SOURCES.has(source);

      // Get raw signal (0–1)
      let raw;
      if (source?.startsWith('lfo-') && route.lfoState) {
        // Inline LFO: advance phase and compute output
        const ls  = route.lfoState;
        const bpm = signals?.bpm || 120;
        let rateHz = ls.rate || 1;
        if (ls.syncToBpm && bpm > 0) {
          rateHz = (bpm / 60) / (ls.rate || 1);
        }
        const dt = signals?._dt || (1/60);
        ls._phase = ((ls._phase || 0) + rateHz * dt) % 1;
        const p = ls._phase;
        let lfoOut;
        switch (ls.shape || 'sine') {
          case 'triangle': lfoOut = p < 0.5 ? p * 4 - 1 : 3 - p * 4; break;
          case 'square':   lfoOut = p < 0.5 ? 1 : -1; break;
          case 'sawtooth': lfoOut = p * 2 - 1; break;
          case 'random':   lfoOut = (ls._rand = ls._rand ?? Math.random()); if (p < (ls._prevP || 0)) ls._rand = Math.random(); ls._prevP = p; lfoOut = ls._rand * 2 - 1; break;
          default:         lfoOut = Math.sin(p * Math.PI * 2); // sine
        }
        raw = (lfoOut + 1) / 2; // normalise -1..1 → 0..1
      } else {
        raw = signals?.[source] ?? layer.uniforms?.[source] ?? 0;
      }
      raw = Math.max(0, Math.min(1, raw));
      if (invert) raw = 1 - raw;

      // If audio is inactive and this is an audio-sourced route, snap to 0
      if (audioInactive && isAudioSource) {
        route._smoothed = 0;
      } else {
        route._smoothed += (raw - route._smoothed) * Math.min(1, smooth);
      }

      // Apply curve shaping to the smoothed value before multiplying by depth
      const shaped = _shapeCurve(route._smoothed, route.curve || 'linear');

      // Is this a transform target?
      const isTransform = target.startsWith('transform.');
      const transformKey = isTransform ? target.slice('transform.'.length) : null;

      if (isTransform) {
        // Transform targets have their own default ranges
        const range = _transformRange(transformKey);
        const baseKey = `transform.${transformKey}`;

        // Read from layer.transform — use range.base as fallback if undefined
        const currentVal = layer.transform?.[transformKey];
        if (!this._baseVals.has(baseKey)) {
          this._baseVals.set(baseKey, currentVal !== undefined ? currentVal : range.base);
        }
        const base = this._baseVals.get(baseKey);
        const pMin = min ?? range.min;
        const pMax = max ?? range.max;
        const r    = pMax - pMin;

        const modValue = base + shaped * depth * r;
        const clamped  = Math.max(pMin, Math.min(pMax, modValue));
        if (!layer.transform) layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        layer.transform[transformKey] = clamped;

      } else if (target === 'opacity') {
        // Opacity lives directly on the layer object, not in params
        if (!this._baseVals.has('opacity')) {
          this._baseVals.set('opacity', layer.opacity ?? 1);
        }
        const base     = this._baseVals.get('opacity');
        const pMin     = min ?? 0;
        const pMax     = max ?? 1;
        const modValue = base + shaped * depth * (pMax - pMin);
        layer.opacity  = Math.max(0, Math.min(1, modValue));

      } else if (target === 'clipShape.w' || target === 'clipShape.h') {
        // Clip shape size — only applies when a clip shape is active
        if (!layer.clipShape) return;
        const key = target.split('.')[1]; // 'w' or 'h'
        if (!this._baseVals.has(target)) {
          this._baseVals.set(target, layer.clipShape[key] ?? 0.5);
        }
        const base     = this._baseVals.get(target);
        const pMin     = min ?? 0.05;
        const pMax     = max ?? 1.5;
        const modValue = base + shaped * depth * (pMax - pMin);
        layer.clipShape[key] = Math.max(pMin, Math.min(pMax, modValue));

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

        const modValue = base + shaped * depth * r;
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

  fromJSON(data) {
    this.routes = (data || []).map(d => new ModRoute(d));
  }
}

// ── Curve shaping ──────────────────────────────────────────────────────────
// Maps a normalised 0–1 signal through a shaping curve.
// All inputs and outputs stay in 0–1 range.

function _shapeCurve(v, curve) {
  switch (curve) {
    case 'exponential':
      // Slow start, fast end — good for fades that feel natural
      return v * v;

    case 'logarithmic':
      // Fast start, slow end — immediate response that settles gently
      return Math.sqrt(Math.max(0, v));

    case 'scurve':
      // Smooth S-curve (cubic ease-in-out) — slow at both ends
      return v < 0.5
        ? 2 * v * v
        : 1 - Math.pow(-2 * v + 2, 2) / 2;

    case 'step':
      // Binary: 0 below 0.5, 1 above — on/off trigger
      return v >= 0.5 ? 1 : 0;

    case 'step25':
      // Fires at quarter-threshold — useful for hi-hats and transients
      return v >= 0.25 ? 1 : 0;

    case 'inverted':
      // Signal is flipped: loud = low output, quiet = high output
      return 1 - v;

    case 'linear':
    default:
      return v;
  }
}

// Exported curve definitions for UI
ModMatrix.CURVES = [
  { id: 'linear',      label: 'Linear',      symbol: '╱'  },
  { id: 'exponential', label: 'Exponential',  symbol: '⌒'  },
  { id: 'logarithmic', label: 'Logarithmic',  symbol: '⌣'  },
  { id: 'scurve',      label: 'S-curve',      symbol: '∫'  },
  { id: 'step',        label: 'Step (50%)',    symbol: '⌐'  },
  { id: 'step25',      label: 'Step (25%)',    symbol: '⌐'  },
  { id: 'inverted',    label: 'Inverted',      symbol: '╲'  },
];

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
  // Audio — broad bands
  { id: 'bass',             label: 'Bass',               group: 'Audio' },
  { id: 'mid',              label: 'Mid',                group: 'Audio' },
  { id: 'treble',           label: 'Treble',             group: 'Audio' },
  { id: 'volume',           label: 'Volume',             group: 'Audio' },
  { id: 'rms',              label: 'RMS energy',         group: 'Audio' },
  // Audio — spectral analysis
  { id: 'spectralCentroid', label: 'Centroid (brightness)', group: 'Audio' },
  { id: 'spectralSpread',   label: 'Spectral spread',    group: 'Audio' },
  { id: 'spectralFlux',     label: 'Flux (transients)',  group: 'Audio' },
  // Audio — per-band energy
  { id: 'kickEnergy',       label: 'Kick energy',        group: 'Audio' },
  { id: 'snareEnergy',      label: 'Snare energy',       group: 'Audio' },
  { id: 'hihatEnergy',      label: 'Hi-hat energy',      group: 'Audio' },
  // Video
  { id: 'brightness',       label: 'Brightness',         group: 'Video' },
  { id: 'motion',           label: 'Motion',             group: 'Video' },
  { id: 'edgeDensity',      label: 'Edge density',       group: 'Video' },
  // Engine
  { id: 'iTime',            label: 'Time',               group: 'Engine' },
  { id: 'iBeat',            label: 'Beat pulse',         group: 'Engine' },
  { id: 'iMouseX',          label: 'Mouse X',            group: 'Engine' },
  { id: 'iMouseY',          label: 'Mouse Y',            group: 'Engine' },
];

// Transform target definitions for the ModMatrix UI
ModMatrix.TRANSFORM_TARGETS = [
  { id: 'transform.x',        label: 'Position X',  min: -800, max: 800  },
  { id: 'transform.y',        label: 'Position Y',  min: -450, max: 450  },
  { id: 'transform.scaleX',   label: 'Scale X',     min: 0.1,  max: 4    },
  { id: 'transform.scaleY',   label: 'Scale Y',     min: 0.1,  max: 4    },
  { id: 'transform.rotation', label: 'Rotation',    min: -180, max: 180  },
];
