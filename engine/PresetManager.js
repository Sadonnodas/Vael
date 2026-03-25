/**
 * engine/PresetManager.js
 * Saves and loads the full layer stack as a JSON preset file.
 * Each preset captures every layer type, order, opacity,
 * blend mode, and all parameter values.
 *
 * Usage:
 *   PresetManager.save(layerStack, 'song-opener');
 *   PresetManager.load(file, layerStack, layerFactory);
 */

const PresetManager = (() => {

  const VERSION = '1.0';

  // ── Save ─────────────────────────────────────────────────────

  /**
   * Serialise the current layer stack and trigger a .json download.
   * @param {LayerStack} layerStack
   * @param {string} name  — used as the filename
   */
  function save(layerStack, name = 'scene') {
    const preset = {
      vael:    VERSION,
      name,
      saved:   new Date().toISOString(),
      layers:  layerStack.layers.map(layer => {
        const base = {
          type:      layer.constructor.name,
          id:        layer.id,
          name:      layer.name,
          visible:   layer.visible,
          opacity:   layer.opacity,
          blendMode: layer.blendMode,
        };
        if (layer.params) base.params = { ...layer.params };
        return base;
      }),
    };

    const blob     = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `${name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    console.log(`Vael: preset "${name}" saved`);
    return preset;
  }

  // ── Load ─────────────────────────────────────────────────────

  /**
   * Load a preset from a File object (from a file picker).
   * Clears the current layer stack and rebuilds it from the preset.
   *
   * @param {File} file
   * @param {LayerStack} layerStack
   * @param {Function} layerFactory  — function(typeName) → new layer instance
   * @returns {Promise<object>}  the parsed preset
   */
  async function load(file, layerStack, layerFactory) {
    const text   = await file.text();
    let preset;

    try {
      preset = JSON.parse(text);
    } catch {
      throw new Error('Invalid preset file — could not parse JSON.');
    }

    if (!preset.layers || !Array.isArray(preset.layers)) {
      throw new Error('Invalid preset — no layers array found.');
    }

    // Remove all existing layers
    [...layerStack.layers].forEach(l => layerStack.remove(l.id));

    // Rebuild from preset
    const errors = [];
    preset.layers.forEach(def => {
      try {
        const layer = layerFactory(def.type, def.id);
        if (!layer) { errors.push(`Unknown layer type: ${def.type}`); return; }

        layer.name      = def.name      ?? layer.name;
        layer.visible   = def.visible   ?? true;
        layer.opacity   = def.opacity   ?? 1;
        layer.blendMode = def.blendMode ?? 'normal';

        if (def.params && layer.params) {
          Object.assign(layer.params, def.params);
        }

        if (typeof layer.init === 'function') layer.init(layer.params || {});
        layerStack.add(layer);
      } catch (e) {
        errors.push(`Error loading layer "${def.type}": ${e.message}`);
      }
    });

    if (errors.length > 0) {
      console.warn('Vael preset load warnings:\n' + errors.join('\n'));
    }

    console.log(`Vael: preset "${preset.name || file.name}" loaded — ${layerStack.count} layers`);
    return preset;
  }

  // ── Local storage (recent presets list) ──────────────────────

  const LS_KEY = 'vael-recent-presets';

  /**
   * Store a preset object in localStorage for the recent presets list.
   * Keeps only the last 8.
   */
  function storeRecent(preset) {
    try {
      const existing = getRecent();
      const updated  = [
        { name: preset.name, saved: preset.saved },
        ...existing.filter(p => p.name !== preset.name),
      ].slice(0, 8);
      localStorage.setItem(LS_KEY, JSON.stringify(updated));
    } catch { /* localStorage may be unavailable */ }
  }

  /**
   * Return the list of recently saved preset names.
   * @returns {Array<{name, saved}>}
   */
  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch { return []; }
  }

  // ── Template preset ──────────────────────────────────────────

  /**
   * Return a minimal working preset object.
   * Useful as a starting point or for testing.
   */
  function template(name = 'New Scene') {
    return {
      vael:   VERSION,
      name,
      saved:  new Date().toISOString(),
      layers: [
        {
          type:      'NoiseFieldLayer',
          name:      'Noise Field',
          visible:   true,
          opacity:   1.0,
          blendMode: 'normal',
          params: { hueA: 200, hueB: 270, speed: 0.12, lightness: 0.12 },
        },
        {
          type:      'MathVisualizer',
          name:      'Math Visualizer',
          visible:   true,
          opacity:   0.85,
          blendMode: 'screen',
          params: { constant: 'pi', mode: 'path', colorMode: 'rainbow', digitCount: 600 },
        },
      ],
    };
  }

  return { save, load, storeRecent, getRecent, template };

})();
