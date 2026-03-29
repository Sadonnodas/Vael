/**
 * engine/SessionManager.js
 * Saves and restores a complete Vael session as a .vaelsession file.
 *
 * What a session captures
 * ───────────────────────
 * ✓ All layer parameters, blend modes, opacity, transforms, FX chains,
 *   modulation routes, LFO config, post-FX state — fully serialised.
 * ✓ Custom GLSL shader source code — stored as text, no re-linking needed.
 * ✓ References (by filename) to every binary asset: audio files, video files,
 *   image files used in ImageLayers.
 *
 * What needs one-click re-linking on load
 * ────────────────────────────────────────
 * ✗ Audio files — browser security prevents storing or accessing local paths.
 *   On restore, a dialog lists missing assets and lets you pick them from disk.
 * ✗ Video library files — same.
 * ✗ Images loaded into ImageLayers — same.
 *
 * The re-linking dialog groups all missing assets by type. Once the user
 * selects the files, Vael matches them by filename and reconnects everything
 * automatically — no manual assignment needed if the filenames haven't changed.
 *
 * Usage (wired in App.js):
 *   SessionManager.init({ layers, lfoManager, audio, videoLibrary,
 *                          LibraryPanel, layerFactory, renderer });
 *   SessionManager.save();          // triggers .vaelsession download
 *   SessionManager.load(file);      // restores from a File object
 */

const SessionManager = (() => {

  const VERSION = '1.0';

  // Injected by init()
  let _layers       = null;
  let _lfoManager   = null;
  let _audio        = null;
  let _videoLibrary = null;
  let _LibraryPanel = null;
  let _layerFactory = null;
  let _renderer     = null;
  let _postFX       = null;   // PostFX module reference

  // ── Init ─────────────────────────────────────────────────────

  function init({ layers, lfoManager, audio, videoLibrary,
                  LibraryPanel, layerFactory, renderer, postFX }) {
    _layers       = layers;
    _lfoManager   = lfoManager;
    _audio        = audio;
    _videoLibrary = videoLibrary;
    _LibraryPanel = LibraryPanel;
    _layerFactory = layerFactory;
    _renderer     = renderer;
    _postFX       = postFX;
  }

  // ── Save ─────────────────────────────────────────────────────

  /**
   * Serialise the full session and download it as a .vaelsession file.
   * @param {string} name  Session name (used as filename)
   */
  function save(name = 'vael-session') {
    const session = _buildSessionObject(name);
    const json    = JSON.stringify(session, null, 2);
    const blob    = new Blob([json], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `${name.replace(/\s+/g, '-').toLowerCase()}.vaelsession`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    Toast.success(`Session "${name}" saved`);
    return session;
  }

  function _buildSessionObject(name) {
    // Collect asset references — filenames only, no binary data
    const audioRef = _audio?.fileName
      ? { name: _audio.fileName, type: 'audio', role: 'main-audio' }
      : null;

    const videoRefs = (_videoLibrary?.entries || []).map(e => ({
      id:   e.id,
      name: e.name,
      type: 'video',
      role: 'library',
    }));

    // Image layers — collect filename references
    const imageRefs = [];
    _layers.layers.forEach(layer => {
      if (layer._fileName && layer._loaded) {
        imageRefs.push({
          layerId: layer.id,
          name:    layer._fileName,
          type:    'image',
          role:    'layer-image',
        });
      }
      // Also check group children
      if (layer.children) {
        layer.children.forEach(child => {
          if (child._fileName && child._loaded) {
            imageRefs.push({
              layerId: child.id,
              name:    child._fileName,
              type:    'image',
              role:    'layer-image',
            });
          }
        });
      }
    });

    // Collect active PostFX
    const postFXState = _postFX ? _postFX.list().map(name => ({
      name,
      uniforms: Object.fromEntries(
        Object.entries((_postFX.SHADERS[name]?.uniforms || {})).map(([k, v]) => [k, v.value])
      ),
    })) : [];

    // Full layer state (params, FX, modMatrix, transforms, GLSL source for shaders)
    const layerData = _layers.layers.map(layer => {
      const base = typeof layer.toJSON === 'function' ? layer.toJSON() : {};
      // For ShaderLayers, embed the GLSL source directly — no re-linking needed
      if (layer._customGLSL) base.glsl = layer._customGLSL;
      if (layer._shaderName)  base.shaderName = layer._shaderName;
      return base;
    });

    return {
      vael:       VERSION,
      name,
      savedAt:    new Date().toISOString(),
      // ── State (fully self-contained) ──────────────────────────
      layers:     layerData,
      lfos:       _lfoManager?.toJSON() || [],
      postFX:     postFXState,
      // ── Asset references (filenames only — need re-linking) ───
      assets: {
        audio:  audioRef ? [audioRef] : [],
        videos: videoRefs,
        images: imageRefs,
      },
      // ── Playback state ────────────────────────────────────────
      playback: {
        loop:       _audio?.loop ?? false,
        inputSpeed: _audio?.inputSpeed ?? 0.05,
      },
    };
  }

  // ── Load ─────────────────────────────────────────────────────

  /**
   * Load a .vaelsession file (File object from a file picker).
   * Shows a re-linking dialog for any assets that need to be re-selected.
   * @param {File} file
   * @param {Function} applyPreset   PresetManager._applyRaw
   */
  async function load(file, applyPreset) {
    let session;
    try {
      const text = await file.text();
      session    = JSON.parse(text);
    } catch {
      Toast.error('Invalid session file — could not parse');
      return;
    }

    if (!session.layers) {
      Toast.error('Session file has no layer data');
      return;
    }

    // Apply the layer/LFO/postFX state immediately
    _applyState(session, applyPreset);

    // Check which assets need re-linking
    const missing = _findMissingAssets(session.assets || {});

    if (missing.total === 0) {
      Toast.success(`Session "${session.name}" restored`);
      return;
    }

    // Show re-linking dialog
    _showRelinkDialog(session, missing);
  }

  function _applyState(session, applyPreset) {
    // Restore layers
    if (typeof applyPreset === 'function' && session.layers?.length) {
      applyPreset({ layers: session.layers }, _layers, _layerFactory);
    }

    // Restore LFOs
    if (_lfoManager && session.lfos?.length) {
      _lfoManager.clear();
      _lfoManager.fromJSON(session.lfos, _layers);
    }

    // Restore PostFX
    if (_postFX && _renderer && session.postFX?.length) {
      // Remove all current passes first
      _postFX.list().forEach(name => _postFX.remove(_renderer, name));
      session.postFX.forEach(pass => {
        _postFX.add(_renderer, pass.name, pass.uniforms || {});
      });
    }

    // Restore playback settings
    if (session.playback && _audio) {
      _audio.loop       = session.playback.loop ?? false;
      _audio.inputSpeed = session.playback.inputSpeed ?? 0.05;
    }
  }

  function _findMissingAssets(assets) {
    const missing = { audio: [], videos: [], images: [], total: 0 };

    // Audio — missing if we have a reference but no file currently loaded
    (assets.audio || []).forEach(ref => {
      if (_audio?.fileName !== ref.name) {
        missing.audio.push(ref);
      }
    });

    // Videos — missing if not already in the library by name
    const loadedVideoNames = new Set(
      (_videoLibrary?.entries || []).map(e => e.name)
    );
    (assets.videos || []).forEach(ref => {
      if (!loadedVideoNames.has(ref.name)) missing.videos.push(ref);
    });

    // Images — missing if the layer exists but has no loaded image
    (assets.images || []).forEach(ref => {
      const layer = _findLayerById(ref.layerId);
      if (layer && !layer._loaded) missing.images.push(ref);
    });

    missing.total = missing.audio.length + missing.videos.length + missing.images.length;
    return missing;
  }

  function _findLayerById(id) {
    let layer = _layers.layers.find(l => l.id === id);
    if (!layer) {
      for (const l of _layers.layers) {
        if (l.children) {
          const child = l.children.find(c => c.id === id);
          if (child) { layer = child; break; }
        }
      }
    }
    return layer || null;
  }

  // ── Re-link dialog ────────────────────────────────────────────

  function _showRelinkDialog(session, missing) {
    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.82);
      z-index: 1000; display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: var(--bg-mid); border: 1px solid var(--border);
      border-radius: 10px; padding: 28px 28px 24px;
      max-width: 480px; width: 90%; font-family: var(--font-mono);
      max-height: 80vh; overflow-y: auto;
    `;

    panel.innerHTML = `
      <div style="font-size:11px;letter-spacing:2px;color:var(--accent);margin-bottom:6px">
        SESSION RESTORE
      </div>
      <div style="font-size:10px;color:var(--text);margin-bottom:4px;font-weight:600">
        "${session.name}"
      </div>
      <div style="font-size:9px;color:var(--text-muted);margin-bottom:20px;line-height:1.7">
        The layer settings have been restored. Re-link the files below to complete the session.
        Files are matched by filename — pick the same files from the same location.
      </div>
    `;

    const assetList = document.createElement('div');

    // ── Audio re-link ─────────────────────────────────────────
    if (missing.audio.length > 0) {
      _addRelinkSection(assetList, 'Audio file', missing.audio, 'audio/*', async (files) => {
        for (const file of files) {
          try {
            await _audio.loadFile(file);
            // Notify AudioPanel of the new file
            window.dispatchEvent(new CustomEvent('vael:session-audio-loaded', {
              detail: { file }
            }));
            Toast.success(`Audio re-linked: ${file.name}`);
          } catch { Toast.error(`Could not load audio: ${file.name}`); }
        }
      });
    }

    // ── Video re-link ─────────────────────────────────────────
    if (missing.videos.length > 0) {
      _addRelinkSection(assetList, 'Video files', missing.videos, 'video/*', async (files) => {
        for (const file of files) {
          try {
            await _videoLibrary.add(file);
            Toast.success(`Video re-linked: ${file.name}`);
          } catch { Toast.error(`Could not load video: ${file.name}`); }
        }
      });
    }

    // ── Image re-link ─────────────────────────────────────────
    if (missing.images.length > 0) {
      _addRelinkSection(assetList, 'Images', missing.images, 'image/*', async (files) => {
        for (const file of files) {
          // Match by filename to the layer that needs it
          const ref   = missing.images.find(r => r.name === file.name);
          const layer = ref ? _findLayerById(ref.layerId) : null;
          if (layer && typeof layer.loadFile === 'function') {
            try {
              await layer.loadFile(file);
              Toast.success(`Image re-linked: ${file.name}`);
            } catch { Toast.error(`Could not load image: ${file.name}`); }
          } else {
            // Best-effort: add to image library for manual assignment
            if (_LibraryPanel) _LibraryPanel.promptImageForLayer?.(null, null);
            Toast.warn(`No layer found for "${file.name}" — added to image library`);
          }
        }
      });
    }

    panel.appendChild(assetList);

    // Done button
    const doneBtn = document.createElement('button');
    doneBtn.className   = 'btn accent';
    doneBtn.style.cssText = 'width:100%;margin-top:16px';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => {
      overlay.remove();
      Toast.success(`Session "${session.name}" fully restored`);
    });
    panel.appendChild(doneBtn);

    overlay.appendChild(panel);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /**
   * Build a re-link section for one asset type.
   * @param {HTMLElement} container
   * @param {string}      label
   * @param {Array}       refs          Asset reference objects from the session file
   * @param {string}      accept        File input accept string
   * @param {Function}    onFiles       async (File[]) => void
   */
  function _addRelinkSection(container, label, refs, accept, onFiles) {
    const section = document.createElement('div');
    section.style.cssText = `
      background: var(--bg-card); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 12px 14px; margin-bottom: 10px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
    header.innerHTML = `
      <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">
        ${label}
      </span>
      <span style="font-size:8px;color:var(--accent2)">${refs.length} needed</span>
    `;
    section.appendChild(header);

    // List the expected filenames
    const nameList = document.createElement('div');
    nameList.style.cssText = 'margin-bottom:10px';
    refs.forEach(ref => {
      const row = document.createElement('div');
      row.style.cssText = `
        font-size:9px; color:var(--text-dim); padding:3px 0;
        display:flex; align-items:center; gap:6px;
      `;
      row.innerHTML = `
        <span style="color:#ff9966">○</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${ref.name}
        </span>
      `;
      row.dataset.refName = ref.name;
      nameList.appendChild(row);
    });
    section.appendChild(nameList);

    // File picker button
    const pickBtn = document.createElement('button');
    pickBtn.className   = 'btn';
    pickBtn.style.cssText = 'width:100%;font-size:9px';
    pickBtn.textContent = `↑ Select ${label.toLowerCase()}…`;

    const fileInput    = document.createElement('input');
    fileInput.type     = 'file';
    fileInput.accept   = accept;
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    pickBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      pickBtn.textContent = 'Loading…';
      pickBtn.disabled    = true;

      await onFiles(files);

      // Update the row indicators for matched files
      const matchedNames = new Set(files.map(f => f.name));
      nameList.querySelectorAll('[data-ref-name]').forEach(row => {
        if (matchedNames.has(row.dataset.refName)) {
          row.querySelector('span').textContent = '●';
          row.querySelector('span').style.color = 'var(--accent)';
          row.style.color = 'var(--text)';
        }
      });

      pickBtn.textContent = `↑ Select more ${label.toLowerCase()}…`;
      pickBtn.disabled    = false;
      e.target.value = '';
    });

    section.appendChild(fileInput);
    section.appendChild(pickBtn);
    container.appendChild(section);
  }

  // ── Public API ────────────────────────────────────────────────

  return { init, save, load };

})();
