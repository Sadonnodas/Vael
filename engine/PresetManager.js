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
      postFX:  typeof PostFXPanel !== 'undefined' ? PostFXPanel.serialize() : undefined,
      layers:  layerStack.layers.map(layer => {
        const base = {
          type:        layer.constructor.name,
          id:          layer.id,
          name:        layer.name,
          visible:     layer.visible,
          opacity:     layer.opacity,
          blendMode:   layer.blendMode,
          maskLayerId: layer.maskLayerId || null,
          transform:   { ...layer.transform },
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

        layer.name        = def.name        ?? layer.name;
        layer.visible     = def.visible      ?? true;
        layer.opacity     = def.opacity      ?? 1;
        layer.blendMode   = def.blendMode    ?? 'normal';
        layer.maskLayerId = def.maskLayerId  || null;
        layer.maskMode    = def.maskMode     || 'luminance';
        if (def.transform)  Object.assign(layer.transform, def.transform);
        if (def.clipShape  !== undefined) layer.clipShape  = def.clipShape  ? { ...def.clipShape  } : null;
        if (def.colorMask  !== undefined) layer.colorMask  = def.colorMask  ? { ...def.colorMask  } : null;
        if (def.softUpdate !== undefined) layer.softUpdate = def.softUpdate;
        if (def.modMatrix)  layer.modMatrix?.fromJSON(def.modMatrix, layer);
        if (def.fx)         layer.fx = def.fx.map(f => ({ ...f, params: { ...f.params } }));
        if (Array.isArray(def.automation)) layer.automation = def.automation.map(r => ({ ...r }));
        if (Array.isArray(def.lfos)) layer._lfos = def.lfos.map(l => ({
          ...l, _phase: 0, _value: 0,
          targets: (l.targets || []).map(t => ({ paramId: t.paramId, depth: t.depth })),
        }));
        if (Array.isArray(def.freeformPoints) && layer.freeformPoints !== undefined) {
          layer.freeformPoints = def.freeformPoints.map(p => ({ ...p }));
        }

        if (def.params && layer.params) {
          Object.assign(layer.params, def.params);
        }

        // Restore group children
        if (layer instanceof GroupLayer && Array.isArray(def.children)) {
          def.children.forEach(childDef => {
            try {
              const child = layerFactory(childDef.type, childDef.id);
              if (!child) return;
              child.name        = childDef.name      ?? child.name;
              child.visible     = childDef.visible   ?? true;
              child.opacity     = childDef.opacity   ?? 1;
              child.blendMode   = childDef.blendMode ?? 'normal';
              if (childDef.transform) Object.assign(child.transform, childDef.transform);
              if (childDef.modMatrix) child.modMatrix?.fromJSON(childDef.modMatrix, child);
              if (childDef.params && child.params) Object.assign(child.params, childDef.params);
              if (Array.isArray(childDef.automation)) child.automation = childDef.automation.map(r => ({ ...r }));
              if (Array.isArray(childDef.lfos)) child._lfos = childDef.lfos.map(l => ({
                ...l, _phase: 0, _value: 0,
                targets: (l.targets || []).map(t => ({ paramId: t.paramId, depth: t.depth })),
              }));
              if (typeof child.init === 'function') child.init({ shaderName: childDef.shaderName, glsl: childDef.glsl, ...child.params });
              layer.addChild(child);
            } catch (e) { errors.push(`Error loading group child: ${e.message}`); }
          });
          layer.collapsed = def.collapsed ?? false;
        }

        if (typeof layer.init === 'function') layer.init({ shaderName: def.shaderName, glsl: def.glsl, ...layer.params });
        _restoreVideoSource(layer, def);
        _restoreImageSource(layer, def);
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

  // ── Apply a preset object directly (no file) ─────────────────

  function _applyRaw(preset, layerStack, layerFactory) {
    if (!preset?.layers) return;
    [...layerStack.layers].forEach(l => layerStack.remove(l.id));
    preset.layers.forEach(def => {
      try {
        const layer = layerFactory(def.type, def.id);
        if (!layer) return;
        layer.name        = def.name      ?? layer.name;
        layer.visible     = def.visible   ?? true;
        layer.opacity     = def.opacity   ?? 1;
        layer.blendMode   = def.blendMode ?? 'normal';
        layer.maskLayerId = def.maskLayerId || null;
        layer.maskMode    = def.maskMode    || 'luminance';
        if (def.transform) Object.assign(layer.transform, def.transform);
        if (def.clipShape  !== undefined) layer.clipShape  = def.clipShape  ? { ...def.clipShape  } : null;
        if (def.colorMask  !== undefined) layer.colorMask  = def.colorMask  ? { ...def.colorMask  } : null;
        if (def.softUpdate !== undefined) layer.softUpdate = def.softUpdate;
        if (def.modMatrix) layer.modMatrix?.fromJSON(def.modMatrix, layer);
        if (def.params && layer.params) Object.assign(layer.params, def.params);
        if (Array.isArray(def.automation)) layer.automation = def.automation.map(r => ({ ...r }));
        if (Array.isArray(def.lfos)) layer._lfos = def.lfos.map(l => ({
          ...l, _phase: 0, _value: 0,
          targets: (l.targets || []).map(t => ({ paramId: t.paramId, depth: t.depth })),
        }));
        if (Array.isArray(def.freeformPoints) && layer.freeformPoints !== undefined) {
          layer.freeformPoints = def.freeformPoints.map(p => ({ ...p }));
        }
        if (layer instanceof GroupLayer && Array.isArray(def.children)) {
          def.children.forEach(cd => {
            const child = layerFactory(cd.type, cd.id);
            if (!child) return;
            child.name = cd.name ?? child.name;
            child.visible = cd.visible ?? true;
            child.opacity = cd.opacity ?? 1;
            child.blendMode = cd.blendMode ?? 'normal';
            if (cd.transform) Object.assign(child.transform, cd.transform);
            if (cd.modMatrix) child.modMatrix?.fromJSON(cd.modMatrix, child);
            if (cd.params && child.params) Object.assign(child.params, cd.params);
            if (Array.isArray(cd.automation)) child.automation = cd.automation.map(r => ({ ...r }));
            if (Array.isArray(cd.lfos)) child._lfos = cd.lfos.map(l => ({
              ...l, _phase: 0, _value: 0,
              targets: (l.targets || []).map(t => ({ paramId: t.paramId, depth: t.depth })),
            }));
            if (typeof child.init === 'function') child.init({ shaderName: cd.shaderName, glsl: cd.glsl, ...child.params });
            layer.addChild(child);
          });
          layer.collapsed = def.collapsed ?? false;
        }
        if (typeof layer.init === 'function') layer.init({ shaderName: def.shaderName, glsl: def.glsl, ...layer.params });
        _restoreVideoSource(layer, def);
        _restoreImageSource(layer, def);
        layerStack.add(layer);
      } catch {}
    });
  }

  /**
   * After init(), restore video source from library (by ID then by name fallback).
   * If not found yet (library still restoring from IndexedDB), registers a retry
   * on vael:library-ready. VideoPlayerLayer.init() also handles this, so in
   * practice the retry fires from whichever is registered first.
   */
  function _restoreVideoSource(layer, def) {
    if (!(layer instanceof VideoPlayerLayer)) return;
    // VideoPlayerLayer.init() already handled the lookup and registered the retry —
    // nothing extra needed here. This function is kept for callers that don't go
    // through init() or that need the explicit post-init check.
    const p = def.params || {};
    if (!layer._sourceUrl && !layer._sourceName) {
      // init() didn't load anything — explicit attempt (e.g. init was skipped)
      if (!layer._tryLoadFromLibrary(p)) {
        layer._retryLoadFromLibrary(p);
      }
    }
  }

  /**
   * After init(), restore an ImageLayer's image from the library by filename.
   * The fileName is stored in def.params.fileName (via ImageLayer.toJSON).
   * ImageLayer.init() already handles this via _tryLoadFromLibrary/_retryLoadFromLibrary,
   * so this is a safety net for restore paths that pass a custom params object.
   */
  function _restoreImageSource(layer, def) {
    if (!(layer instanceof ImageLayer)) return;
    if (layer._loaded) return;
    const fileName = (def.params?.fileName) || def.fileName;
    if (!fileName) return;
    if (!layer._tryLoadFromLibrary(fileName)) {
      layer._retryLoadFromLibrary(fileName);
    }
  }

  return { save, load, storeRecent, getRecent, template, _applyRaw };

})();
