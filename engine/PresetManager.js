/**
 * engine/PresetManager.js
 * Saves and loads the full layer stack as a JSON preset file.
 *
 * FIX: save() now calls layer.toJSON() for each layer, which includes
 * modMatrix routes and fx chains. Previously it only captured params.
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
      vael:   VERSION,
      name,
      saved:  new Date().toISOString(),
      // Use each layer's own toJSON() so modMatrix, fx, transform,
      // shaderName, glsl, and all other layer-specific data is captured.
      layers: layerStack.layers.map(layer => {
        if (typeof layer.toJSON === 'function') {
          return layer.toJSON();
        }
        // Fallback for any layer that doesn't implement toJSON
        return {
          type:        layer.constructor.name,
          id:          layer.id,
          name:        layer.name,
          visible:     layer.visible,
          opacity:     layer.opacity,
          blendMode:   layer.blendMode,
          maskLayerId: layer.maskLayerId || null,
          transform:   { ...layer.transform },
          modMatrix:   layer.modMatrix?.toJSON() || [],
          fx:          layer.fx ? layer.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
          params:      layer.params ? { ...layer.params } : {},
        };
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
   * @param {Function} layerFactory  — function(typeName, id) → new layer instance
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

    _applyRaw(preset, layerStack, layerFactory);

    console.log(`Vael: preset "${preset.name || file.name}" loaded — ${layerStack.count} layers`);
    return preset;
  }

  // ── Internal layer builder ────────────────────────────────────

  function _buildLayer(def, layerFactory) {
    const layer = layerFactory(def.type, def.id);
    if (!layer) return null;

    layer.name        = def.name        ?? layer.name;
    layer.visible     = def.visible     ?? true;
    layer.opacity     = def.opacity     ?? 1;
    layer.blendMode   = def.blendMode   ?? 'normal';
    layer.maskLayerId = def.maskLayerId || null;

    if (def.transform)  Object.assign(layer.transform, def.transform);

    // Restore modulation routes
    if (def.modMatrix && layer.modMatrix) {
      layer.modMatrix.fromJSON(def.modMatrix);
    }

    // Restore fx chain
    if (def.fx && Array.isArray(def.fx)) {
      layer.fx = def.fx.map(f => ({ ...f, params: { ...f.params } }));
    }

    // Restore params
    if (def.params && layer.params) {
      Object.assign(layer.params, def.params);
    }

    // ShaderLayer: restore shader name and custom GLSL
    if (def.shaderName && typeof layer._shaderName !== 'undefined') {
      layer._shaderName = def.shaderName;
    }
    if (def.glsl && typeof layer._customGLSL !== 'undefined') {
      layer._customGLSL = def.glsl;
    }
    if (def.shaderName || def.glsl) {
      layer._gpuDirty = true;
      layer.name = def.name ?? layer.name;
    }

    return layer;
  }

  // ── Apply a preset object directly (no file) ─────────────────

  function _applyRaw(preset, layerStack, layerFactory) {
    if (!preset?.layers) return;
    [...layerStack.layers].forEach(l => layerStack.remove(l.id));

    const errors = [];

    preset.layers.forEach(def => {
      try {
        const layer = _buildLayer(def, layerFactory);
        if (!layer) { errors.push(`Unknown layer type: ${def.type}`); return; }

        // Restore group children
        if (layer instanceof GroupLayer && Array.isArray(def.children)) {
          def.children.forEach(childDef => {
            try {
              const child = _buildLayer(childDef, layerFactory);
              if (!child) return;
              if (typeof child.init === 'function') child.init(child.params || {});
              layer.addChild(child);
            } catch (e) {
              errors.push(`Error loading group child: ${e.message}`);
            }
          });
          layer.collapsed = def.collapsed ?? false;
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
  }

  // ── Local storage (recent presets list) ──────────────────────

  const LS_KEY = 'vael-recent-presets';

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

  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch { return []; }
  }

  // ── Template preset ──────────────────────────────────────────

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
          modMatrix: [],
          fx:        [],
          params:    { hueA: 200, hueB: 270, speed: 0.12, lightness: 0.12 },
        },
        {
          type:      'MathVisualizer',
          name:      'Math Visualizer',
          visible:   true,
          opacity:   0.85,
          blendMode: 'screen',
          modMatrix: [],
          fx:        [],
          params:    { constant: 'pi', mode: 'path', colorMode: 'rainbow', digitCount: 600 },
        },
      ],
    };
  }

  return { save, load, storeRecent, getRecent, template, _applyRaw };

})();
