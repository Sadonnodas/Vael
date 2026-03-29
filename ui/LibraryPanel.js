/**
 * ui/LibraryPanel.js
 * Unified asset library: Videos, Images, Audio.
 *
 * FIX — doubling bug: All addEventListener('change') calls on file inputs
 * happen ONCE inside _createFileInputs() which runs at init time.
 * _render() only builds the visible UI — it never re-attaches listeners.
 *
 * Image workflow:
 * - showAddImagePrompt(layer) — modal shown right after adding an ImageLayer,
 *   offering: pick from library thumbnails, upload now, or leave blank.
 * - promptImageForLayer(layer, container) — renders a thumbnail grid inside
 *   the params panel so you can swap images without leaving params.
 *
 * Audio/Video source:
 * - "Set as audio source" loads a library file into AudioEngine (paused).
 * - "Set as video source" dispatches 'vael:library-set-video-source' which
 *   VideoPanel listens for.
 * - "+ Add Video/Image layer" creates and adds a layer pre-loaded with the asset.
 */

const LibraryPanel = (() => {

  let _videoLibrary     = null;
  let _layerStack       = null;
  let _getSelectedLayer = null;
  let _container        = null;
  let _audioEngine      = null;
  let _activeSection    = 'video';

  const _images     = new Map();
  let   _imgCounter = 0;

  const _audioFiles = new Map();
  let   _audioCounter = 0;

  // Shader library — persisted in localStorage
  const _shaders     = new Map();
  let   _shaderCallback = null; // set by openShaderSection for picker mode

  // ── Init ─────────────────────────────────────────────────────

  function init({ videoLibrary, audioEngine, layerStack,
                  getSelectedLayer, container }) {
    _videoLibrary     = videoLibrary;
    _audioEngine      = audioEngine;
    _layerStack       = layerStack;
    _getSelectedLayer = getSelectedLayer;
    _container        = container;

    // Wire file inputs ONCE — this is the only place addEventListener is called
    _loadShadersFromStorage();
    _createFileInputs();
    _render();
    // Restore binary assets from IndexedDB after a short delay
    // (IndexedDB is async; we render immediately with empty state then populate)
    _restoreFromIndexedDB();
  }

  function _createFileInputs() {
    // Video
    const vi = _makeInput('_lib-video-input', 'video/*', true);
    vi.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        try {
          await _videoLibrary.add(file);
          Toast.success(`Video added: ${file.name}`);
        } catch { Toast.error(`Could not load: ${file.name}`); }
      }
      e.target.value = '';
      _render();
    });

    // Image
    const ii = _makeInput('_lib-image-input', 'image/*', true);
    ii.addEventListener('change', e => {
      Array.from(e.target.files).forEach(file => {
        const id  = `img-${++_imgCounter}-${Date.now()}`;
        const url = URL.createObjectURL(file);
        _images.set(id, { id, name: file.name, url, file });
        Toast.success(`Image added: ${file.name}`);
        // Persist to IndexedDB
        if (typeof AssetStore !== 'undefined') {
          AssetStore.save('image', file).catch(() => {});
        }
      });
      e.target.value = '';
      _render();
    });

    // Audio
    const ai = _makeInput('_lib-audio-input', 'audio/*,video/*', true);
    ai.addEventListener('change', async e => {
      for (const file of Array.from(e.target.files)) {
        const id       = `aud-${++_audioCounter}-${Date.now()}`;
        const url      = URL.createObjectURL(file);
        const duration = await _getAudioDuration(url);
        _audioFiles.set(id, { id, name: file.name, url, file, duration });
        Toast.success(`Audio added: ${file.name}`);
        // Persist to IndexedDB
        if (typeof AssetStore !== 'undefined') {
          AssetStore.save('audio', file).catch(() => {});
        }
      }
      e.target.value = '';
      _render();
    });

    // Single-file image input used by the "upload now" flow in showAddImagePrompt
    const si = _makeInput('_lib-image-single-input', 'image/*', false);
    si.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const id  = `img-${++_imgCounter}-${Date.now()}`;
      const url = URL.createObjectURL(file);
      _images.set(id, { id, name: file.name, url, file });
      e.target.value = '';
      _render();
      // Dispatch so App.js can load it into the pending ImageLayer
      window.dispatchEvent(new CustomEvent('vael:image-single-added', {
        detail: { id, name: file.name, url, file }
      }));
    });
  }

  function _makeInput(id, accept, multiple) {
    const el       = document.createElement('input');
    el.id          = id;
    el.type        = 'file';
    el.accept      = accept;
    el.multiple    = !!multiple;
    el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
    document.body.appendChild(el);
    return el;
  }

  async function _getAudioDuration(url) {
    return new Promise(resolve => {
      const tmp  = document.createElement('audio');
      tmp.preload = 'metadata';  // metadata only — does NOT trigger playback
      const done = (duration) => {
        tmp.removeEventListener('loadedmetadata', onMeta);
        tmp.pause();
        tmp.src = '';            // release the resource immediately
        resolve(duration);
      };
      const onMeta = () => done(tmp.duration || 0);
      tmp.addEventListener('loadedmetadata', onMeta);
      setTimeout(() => done(0), 5000);
      tmp.src = url;             // assign AFTER listener so event isn't missed
      // Do NOT call tmp.play() — preload="metadata" fetches just the header
    });
  }

  function refresh() { if (_container) _render(); }

  // ── Main render ───────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    const tabRow = document.createElement('div');
    tabRow.style.cssText = 'display:flex;gap:0;margin-bottom:14px;border:1px solid var(--border-dim);border-radius:5px;overflow:hidden';

    const tabs = [
      { id: 'video',  label: `▶ Videos (${_videoLibrary?.count ?? 0})` },
      { id: 'image',  label: `🖼 Images (${_images.size})` },
      { id: 'audio',  label: `♪ Audio (${_audioFiles.size})` },
      { id: 'shader', label: `✦ Shaders (${_shaders.size})` },
    ];

    tabs.forEach((tab, i) => {
      const btn = document.createElement('button');
      const active = _activeSection === tab.id;
      btn.style.cssText = `flex:1;padding:7px 4px;background:${active
        ? 'color-mix(in srgb,var(--accent) 12%,var(--bg-card))' : 'var(--bg-card)'};
        border:none;${i < tabs.length - 1 ? 'border-right:1px solid var(--border-dim);' : ''}
        color:${active ? 'var(--accent)' : 'var(--text-dim)'};
        font-family:var(--font-mono);font-size:9px;letter-spacing:1px;cursor:pointer;text-transform:uppercase`;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => { _activeSection = tab.id; _render(); });
      tabRow.appendChild(btn);
    });

    _container.appendChild(tabRow);

    // Reset picker mode if user switches tabs manually
    if (_activeSection !== 'shader' && _shaderCallback) _shaderCallback = null;

    if      (_activeSection === 'video')  _renderVideoSection();
    else if (_activeSection === 'image')  _renderImageSection();
    else if (_activeSection === 'audio')  _renderAudioSection();
    else                                   _renderShaderSection();
  }

  // ── Video section ─────────────────────────────────────────────

  function _renderVideoSection() {
    _addIntro('Upload videos here. Use "Set as video source" to send to the VIDEO tab, or "+ Add layer" to create a Video layer pre-loaded with this file.');

    const uploadBtn = _addUploadBtn('+ Add video files…');
    uploadBtn.addEventListener('click', () => {
      document.getElementById('_lib-video-input').value = '';
      document.getElementById('_lib-video-input').click();
    });

    if (!_videoLibrary || _videoLibrary.count === 0) {
      _addEmpty('No videos yet.<br>Add files above.');
      return;
    }

    _addSectionLabel(`${_videoLibrary.count} video${_videoLibrary.count !== 1 ? 's' : ''}`);

    _videoLibrary.entries.forEach(entry => {
      const card = _card();

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      const preview = document.createElement('video');
      preview.src = entry.url; preview.muted = true; preview.loop = true; preview.playsInline = true;
      preview.style.cssText = 'width:54px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#000';
      preview.play().catch(() => {});
      row.appendChild(preview);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:2px">${VaelMath.formatTime(entry.duration)}</div>`;
      row.appendChild(info);
      row.appendChild(_delBtn(() => { _videoLibrary.remove(entry.id); _render(); }));
      card.appendChild(row);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:4px';

      const addBtn = _smallBtn('+ Add layer', 'accent');
      addBtn.addEventListener('click', () => {
        if (!_layerStack) return;
        const layer = new VideoPlayerLayer(`video-${Date.now()}`, null);
        layer.params.videoId = entry.id;
        layer.name = entry.name.replace(/\.[^.]+$/, '');
        if (typeof layer.init === 'function') layer.init(layer.params);
        _layerStack.add(layer);
        Toast.success(`Video layer added: ${layer.name}`);
      });
      btnRow.appendChild(addBtn);

      const srcBtn = _smallBtn('Set as video source', '');
      srcBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('vael:library-set-video-source', { detail: entry }));
        document.querySelector('[data-tab="video"]')?.click();
      });
      btnRow.appendChild(srcBtn);

      card.appendChild(btnRow);
    });
  }

  // ── Image section ─────────────────────────────────────────────

  function _renderImageSection() {
    _addIntro('Upload images here. Use "+ Add layer" to create a new Image layer, or select an existing Image layer and click "Load into selected".');

    const uploadBtn = _addUploadBtn('+ Add image files…');
    uploadBtn.addEventListener('click', () => {
      document.getElementById('_lib-image-input').value = '';
      document.getElementById('_lib-image-input').click();
    });

    if (_images.size === 0) {
      _addEmpty('No images yet.<br>Add files above.');
      return;
    }

    _addSectionLabel(`${_images.size} image${_images.size !== 1 ? 's' : ''}`);

    _images.forEach(entry => {
      const card = _card();

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      const img = document.createElement('img');
      img.src = entry.url;
      img.style.cssText = 'width:54px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#111';
      row.appendChild(img);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>`;
      row.appendChild(info);
      row.appendChild(_delBtn(() => {
        URL.revokeObjectURL(entry.url);
        _images.delete(entry.id);
        if (typeof AssetStore !== 'undefined') AssetStore.remove(entry.id).catch(() => {});
        _render();
      }));
      card.appendChild(row);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:4px';

      const addBtn = _smallBtn('+ Add layer', 'accent');
      addBtn.addEventListener('click', async () => {
        if (!_layerStack) return;
        const layer = new ImageLayer(`image-${Date.now()}`);
        layer.name = entry.name.replace(/\.[^.]+$/, '');
        if (typeof layer.init === 'function') layer.init({});
        await layer.loadFile(entry.file);
        _layerStack.add(layer);
        Toast.success(`Image layer added: ${layer.name}`);
      });
      btnRow.appendChild(addBtn);

      const loadBtn = _smallBtn('Load into selected', '');
      loadBtn.addEventListener('click', async () => {
        const layer = _getSelectedLayer ? _getSelectedLayer() : null;
        if (!layer)                         { Toast.warn('Select an Image layer first'); return; }
        if (!(layer instanceof ImageLayer)) { Toast.warn('Selected layer is not an Image layer'); return; }
        loadBtn.textContent = 'Loading…'; loadBtn.disabled = true;
        try {
          await layer.loadFile(entry.file);
          window.dispatchEvent(new CustomEvent('vael:refresh-params'));
          Toast.success(`Loaded into: ${layer.name}`);
        } catch { Toast.error('Could not load image'); }
        loadBtn.textContent = 'Load into selected'; loadBtn.disabled = false;
      });
      btnRow.appendChild(loadBtn);

      card.appendChild(btnRow);
    });
  }

  // ── Audio section ─────────────────────────────────────────────

  function _renderAudioSection() {
    _addIntro('Store audio files here. Click "Set as audio source" to load into the AudioEngine ready to play.');

    const uploadBtn = _addUploadBtn('+ Add audio files…');
    uploadBtn.addEventListener('click', () => {
      document.getElementById('_lib-audio-input').value = '';
      document.getElementById('_lib-audio-input').click();
    });

    if (_audioFiles.size === 0) {
      _addEmpty('No audio files yet.<br>Add files above.');
      return;
    }

    _addSectionLabel(`${_audioFiles.size} audio file${_audioFiles.size !== 1 ? 's' : ''}`);

    // Track the currently previewing audio element so we can stop it
    // when another track is previewed or the section is re-rendered.
    let _previewEl = null;

    _audioFiles.forEach(entry => {
      const card = _card();

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      // Preview play/pause button — local preview only, does NOT affect AudioEngine
      const previewBtn = document.createElement('button');
      previewBtn.style.cssText = `
        width:32px;height:32px;flex-shrink:0;border-radius:3px;
        background:color-mix(in srgb,var(--accent) 12%,var(--bg));
        border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);
        color:var(--accent);font-size:12px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
      `;
      previewBtn.textContent = '▶';
      previewBtn.title = 'Preview (local only — does not affect audio source)';

      previewBtn.addEventListener('click', () => {
        if (_previewEl && !_previewEl.paused) {
          // Stop whatever is playing
          _previewEl.pause();
          _previewEl.currentTime = 0;
          _previewEl = null;
          // Reset all preview buttons
          card.closest('[id="library-panel-content"]')
            ?.querySelectorAll('.lib-preview-btn')
            .forEach(b => { b.textContent = '▶'; b.style.color = 'var(--accent)'; });
          return;
        }
        // Stop any other preview
        if (_previewEl) { _previewEl.pause(); _previewEl.currentTime = 0; }

        const el = new Audio(entry.url);
        el.volume = 0.7;
        el.play().catch(() => {});
        el.addEventListener('ended', () => {
          previewBtn.textContent = '▶';
          previewBtn.style.color = 'var(--accent)';
          _previewEl = null;
        });
        _previewEl = el;
        previewBtn.textContent = '■';
        previewBtn.style.color = 'var(--accent2)';
      });

      previewBtn.classList.add('lib-preview-btn');
      row.appendChild(previewBtn);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:2px">${VaelMath.formatTime(entry.duration)}</div>`;
      row.appendChild(info);
      row.appendChild(_delBtn(() => {
        if (_previewEl) { _previewEl.pause(); _previewEl = null; }
        URL.revokeObjectURL(entry.url);
        _audioFiles.delete(entry.id);
        _render();
      }));
      card.appendChild(row);

      const srcBtn = _smallBtn('Set as audio source', 'accent');
      srcBtn.style.width = '100%';
      srcBtn.addEventListener('click', () => {
        // Stop local preview if playing
        if (_previewEl) { _previewEl.pause(); _previewEl.currentTime = 0; _previewEl = null; }
        window.dispatchEvent(new CustomEvent('vael:library-set-audio-source', {
          detail: { name: entry.name, file: entry.file, url: entry.url, duration: entry.duration }
        }));
        document.querySelector('[data-tab="audio"]')?.click();
      });
      card.appendChild(srcBtn);
    });
  }

  // ── showAddImagePrompt — modal shown right after adding an ImageLayer ──

  function showAddImagePrompt(layer) {
    document.getElementById('_img-add-prompt')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_img-add-prompt';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:1000;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;padding:22px 24px;max-width:380px;width:92%;font-family:var(--font-mono)';

    const title = document.createElement('div');
    title.style.cssText = 'color:var(--accent);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px';
    title.textContent   = 'New Image Layer — Load an image';
    dialog.appendChild(title);

    // Library thumbnails
    if (_images.size > 0) {
      const libLabel = document.createElement('div');
      libLabel.style.cssText = 'font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px';
      libLabel.textContent   = 'Pick from library';
      dialog.appendChild(libLabel);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:14px';

      _images.forEach(entry => {
        const cell = document.createElement('div');
        cell.style.cssText = 'cursor:pointer;border-radius:4px;overflow:hidden;border:2px solid var(--border-dim);transition:border-color 0.15s;aspect-ratio:1;background:#111';

        const img = document.createElement('img');
        img.src   = entry.url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        cell.appendChild(img);

        cell.addEventListener('mouseenter', () => { cell.style.borderColor = 'var(--accent)'; });
        cell.addEventListener('mouseleave', () => { cell.style.borderColor = 'var(--border-dim)'; });
        cell.addEventListener('click', async () => {
          overlay.remove();
          await layer.loadFile(entry.file);
          window.dispatchEvent(new CustomEvent('vael:refresh-params'));
          Toast.success(`Image loaded: ${entry.name}`);
        });

        grid.appendChild(cell);
      });

      dialog.appendChild(grid);

      const div = document.createElement('div');
      div.style.cssText = 'height:1px;background:var(--border-dim);margin-bottom:12px';
      dialog.appendChild(div);
    }

    // Action buttons
    const uploadBtn = document.createElement('button');
    uploadBtn.className   = 'btn accent';
    uploadBtn.style.cssText = 'width:100%;margin-bottom:8px';
    uploadBtn.textContent = '↑ Upload image now';
    uploadBtn.addEventListener('click', () => {
      overlay.remove();
      // Single-file picker — listener in _createFileInputs fires vael:image-single-added
      // which App.js catches and loads into this layer
      window._pendingImageLayer = layer;
      document.getElementById('_lib-image-single-input').value = '';
      document.getElementById('_lib-image-single-input').click();
    });
    dialog.appendChild(uploadBtn);

    const blankBtn = document.createElement('button');
    blankBtn.className   = 'btn';
    blankBtn.style.cssText = 'width:100%;color:var(--text-dim)';
    blankBtn.textContent = 'Leave blank — load later';
    blankBtn.addEventListener('click', () => overlay.remove());
    dialog.appendChild(blankBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── promptImageForLayer — thumbnail grid inside params panel ──

  function promptImageForLayer(layer, container) {
    container.innerHTML = '';

    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-family:var(--font-mono);font-size:9px;margin-bottom:12px;' +
      (layer._loaded ? 'color:var(--accent)' : 'color:var(--text-dim)');
    statusEl.textContent = layer._loaded ? `✓ ${layer._fileName}` : 'No image loaded';
    container.appendChild(statusEl);

    // Upload button
    const uploadBtn = document.createElement('button');
    uploadBtn.className   = 'btn accent';
    uploadBtn.style.cssText = 'width:100%;margin-bottom:12px';
    uploadBtn.textContent = '↑ Upload image file…';
    uploadBtn.addEventListener('click', () => {
      window._pendingImageLayer = layer;
      document.getElementById('_lib-image-single-input').value = '';
      document.getElementById('_lib-image-single-input').click();
    });
    container.appendChild(uploadBtn);

    if (_images.size > 0) {
      const libLabel = document.createElement('div');
      libLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px';
      libLabel.textContent   = 'Pick from library';
      container.appendChild(libLabel);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px';

      _images.forEach(entry => {
        const cell = document.createElement('div');
        const isActive = layer._loaded && layer._fileName === entry.name;
        cell.style.cssText = `cursor:pointer;border-radius:4px;overflow:hidden;
          border:2px solid ${isActive ? 'var(--accent)' : 'var(--border-dim)'};
          transition:border-color 0.15s;background:#111`;

        const img = document.createElement('img');
        img.src   = entry.url;
        img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;display:block';
        cell.appendChild(img);

        const name = document.createElement('div');
        name.style.cssText = 'font-family:var(--font-mono);font-size:7px;color:var(--text-dim);padding:2px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(0,0,0,0.7)';
        name.textContent   = entry.name.replace(/\.[^.]+$/, '');
        cell.appendChild(name);

        cell.addEventListener('mouseenter', () => { if (!isActive) cell.style.borderColor = 'var(--accent2)'; });
        cell.addEventListener('mouseleave', () => { if (!isActive) cell.style.borderColor = 'var(--border-dim)'; });
        cell.addEventListener('click', async () => {
          await layer.loadFile(entry.file);
          statusEl.textContent = `✓ ${layer._fileName}`;
          statusEl.style.color = 'var(--accent)';
          grid.querySelectorAll('div[style*="border"]').forEach(c => {
            c.style.borderColor = 'var(--border-dim)';
          });
          cell.style.borderColor = 'var(--accent)';
          Toast.success(`Image loaded: ${entry.name}`);
        });

        grid.appendChild(cell);
      });

      container.appendChild(grid);
    } else {
      const hint = document.createElement('p');
      hint.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:14px';
      hint.innerHTML = 'No images in library. Go to <strong style="color:var(--accent2)">LIBRARY → Images</strong> to add files.';
      container.appendChild(hint);
    }
  }

  // ── Shader section ───────────────────────────────────────────

  const SHADER_STORAGE_KEY = 'vael-shader-library';

  // ── IndexedDB restore ─────────────────────────────────────────
  // On init, rehydrate the library from IndexedDB so files persisted from
  // the last session reappear without the user having to re-upload them.

  async function _restoreFromIndexedDB() {
    if (typeof AssetStore === 'undefined') return;
    try {
      // Restore images
      const images = await AssetStore.list('image');
      for (const entry of images) {
        if (!_images.has(entry.id)) {
          const url = URL.createObjectURL(entry.blob);
          // Reconstruct a File-like object from the blob
          const file = new File([entry.blob], entry.name, { type: entry.blob.type });
          _images.set(entry.id, { id: entry.id, name: entry.name, url, file });
          // Use a fixed counter offset so IDs don't collide with new uploads
          _imgCounter = Math.max(_imgCounter, parseInt(entry.id.split('-')[1] || 0) + 1);
        }
      }

      // Restore audio files
      const audioFiles = await AssetStore.list('audio');
      for (const entry of audioFiles) {
        if (!_audioFiles.has(entry.id)) {
          const url      = URL.createObjectURL(entry.blob);
          const file     = new File([entry.blob], entry.name, { type: entry.blob.type });
          const duration = await _getAudioDuration(url);
          _audioFiles.set(entry.id, { id: entry.id, name: entry.name, url, file, duration });
          _audioCounter = Math.max(_audioCounter, parseInt(entry.id.split('-')[1] || 0) + 1);
        }
      }

      // Videos are restored via VideoLibrary — check if it supports IndexedDB loading
      const videos = await AssetStore.list('video');
      for (const entry of videos) {
        if (_videoLibrary && ![..._videoLibrary.entries].find(e => e.name === entry.name)) {
          const file = new File([entry.blob], entry.name, { type: entry.blob.type });
          await _videoLibrary.add(file, entry.id);
        }
      }

      if (images.length + audioFiles.length + videos.length > 0) {
        _render();
        Toast.info(`Restored ${images.length + audioFiles.length + videos.length} assets from last session`);
      }
    } catch (e) {
      console.warn('AssetStore restore failed:', e);
    }
  }

  function _loadShadersFromStorage() {
    try {
      const saved = localStorage.getItem(SHADER_STORAGE_KEY);
      if (!saved) return;
      const arr = JSON.parse(saved);
      arr.forEach(entry => {
        _shaders.set(entry.id, entry);
      });
    } catch {}
  }

  function _saveShadersToStorage() {
    try {
      localStorage.setItem(SHADER_STORAGE_KEY, JSON.stringify([..._shaders.values()]));
    } catch {}
  }

  function _renderShaderSection() {
    // If we're in picker mode (opened from ShaderPanel), show a header
    if (_shaderCallback) {
      const pickerNote = document.createElement('div');
      pickerNote.style.cssText = 'background:color-mix(in srgb,var(--accent2) 10%,var(--bg));border:1px solid var(--accent2);border-radius:5px;padding:8px 10px;margin-bottom:12px;font-family:var(--font-mono);font-size:9px;color:var(--accent2)';
      pickerNote.textContent   = 'Click a shader below to load it into the selected layer';
      _container.appendChild(pickerNote);
    }

    _addIntro('Upload .glsl/.frag files or save from a Shader layer PARAMS. Shaders persist across sessions.');

    // Upload .glsl / .frag file directly into library
    const uploadBtn = _addUploadBtn('\u2191 Upload .glsl/.frag file\u2026');
    uploadBtn.addEventListener('click', () => {
      const input    = document.createElement('input');
      input.type     = 'file';
      input.accept   = '.glsl,.frag,.vert,.txt';
      input.multiple = true;
      input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
      document.body.appendChild(input);
      input.click();
      input.addEventListener('change', async e => {
        for (const file of Array.from(e.target.files)) {
          try {
            const glsl = await file.text();
            const name = file.name.replace(/\.[^.]+$/, '');
            addShader({ name, glsl });
            Toast.success('Shader added: ' + name);
          } catch { Toast.error('Could not read: ' + file.name); }
        }
        e.target.value = '';
        input.remove();
        _render();
      });
    });

    if (_shaders.size === 0) {
      _addEmpty('No shaders yet.<br>Upload a .glsl file above, or save from a Shader layer PARAMS tab.');
      return;
    }

    _addSectionLabel(`${_shaders.size} shader${_shaders.size !== 1 ? 's' : ''}`);

    _shaders.forEach(entry => {
      const card = _card();

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      const icon = document.createElement('div');
      icon.style.cssText = 'width:36px;height:24px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent2) 10%,var(--bg));border-radius:3px;flex-shrink:0;font-size:12px;color:var(--accent2)';
      icon.textContent   = '✦';
      row.appendChild(icon);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:2px">${entry.glsl.split('\n').length} lines</div>
      `;
      row.appendChild(info);

      row.appendChild(_delBtn(() => {
        _shaders.delete(entry.id);
        _saveShadersToStorage();
        _render();
      }));
      card.appendChild(row);

      // GLSL preview (first 2 lines)
      const preview = document.createElement('div');
      preview.style.cssText = 'font-family:monospace;font-size:8px;color:#6a9955;background:var(--bg);border-radius:3px;padding:5px 7px;margin-bottom:8px;overflow:hidden;white-space:pre;max-height:34px';
      preview.textContent   = entry.glsl.trim().split('\n').slice(0, 2).join('\n');
      card.appendChild(preview);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:4px';

      if (_shaderCallback) {
        const loadBtn = _smallBtn('Load into layer', 'accent');
        loadBtn.addEventListener('click', () => {
          _shaderCallback(entry.glsl, entry.name);
          _shaderCallback = null;
          document.querySelector('[data-tab="params"]')?.click();
        });
        btnRow.appendChild(loadBtn);
      } else {
        const addBtn = _smallBtn('+ Add layer', 'accent');
        addBtn.addEventListener('click', () => {
          if (!_layerStack) { Toast.warn('Layer stack not available'); return; }
          const layer = new ShaderLayer('shader-' + Date.now());
          layer.name  = entry.name || 'Custom Shader';
          layer.init({ glsl: entry.glsl });
          _layerStack.add(layer);
          Toast.success('Shader layer added: ' + layer.name);
        });
        btnRow.appendChild(addBtn);

        const loadBtn = _smallBtn('Load into selected', '');
        loadBtn.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('vael:library-load-shader', {
            detail: { glsl: entry.glsl, name: entry.name }
          }));
        });
        btnRow.appendChild(loadBtn);
      }

      // Download as .glsl file
      const dlBtn = _smallBtn('↓ Download', '');
      dlBtn.addEventListener('click', () => {
        const blob = new Blob([entry.glsl], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = (entry.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'shader') + '.glsl';
        a.click();
        URL.revokeObjectURL(url);
      });
      btnRow.appendChild(dlBtn);

      // Rename
      const renameBtn = _smallBtn('Rename', '');
      renameBtn.addEventListener('click', () => {
        const newName = prompt('Rename shader:', entry.name);
        if (newName && newName.trim()) {
          entry.name = newName.trim();
          _saveShadersToStorage();
          _render();
        }
      });
      btnRow.appendChild(renameBtn);

      card.appendChild(btnRow);
    });
  }

  // ── Video picker for ParamPanel ───────────────────────────────

  function buildVideoPicker(currentId, layer, paramId) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const entries = _videoLibrary ? _videoLibrary.entries : [];
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">Video source</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">library</span>
      </div>
      <select style="width:100%;background:color-mix(in srgb,var(--accent2) 10%,var(--bg));
        border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);border-radius:4px;
        color:var(--accent2);font-family:var(--font-mono);font-size:10px;padding:5px 8px;cursor:pointer">
        <option value="">— none (use Video tab source) —</option>
        ${entries.map(e => `<option value="${e.id}" ${e.id === currentId ? 'selected' : ''}>${e.name} (${VaelMath.formatTime(e.duration)})</option>`).join('')}
      </select>
      ${entries.length === 0 ? '<div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:4px">Add videos in the LIBRARY tab first.</div>' : ''}
    `;
    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[paramId] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(paramId, e.target.value);
    });
    return wrap;
  }

  // ── DOM helpers ───────────────────────────────────────────────

  function _addIntro(text) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:12px';
    p.textContent   = text;
    _container.appendChild(p);
  }

  function _addUploadBtn(label) {
    const btn = document.createElement('button');
    btn.className        = 'btn accent';
    btn.style.width      = '100%';
    btn.style.marginBottom = '14px';
    btn.textContent      = label;
    _container.appendChild(btn);
    return btn;
  }

  function _addEmpty(html) {
    const d = document.createElement('div');
    d.style.cssText = 'text-align:center;padding:24px 12px;border:1px dashed var(--border-dim);border-radius:6px;font-family:var(--font-mono);font-size:9px;color:var(--text-dim);line-height:1.8';
    d.innerHTML     = html;
    _container.appendChild(d);
  }

  function _addSectionLabel(text) {
    const d = document.createElement('div');
    d.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    d.textContent   = text;
    _container.appendChild(d);
  }

  function _card() {
    const d = document.createElement('div');
    d.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-dim);border-radius:5px;padding:8px 10px;margin-bottom:6px';
    _container.appendChild(d);
    return d;
  }

  function _delBtn(onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px';
    btn.textContent   = '✕';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _smallBtn(label, variant) {
    const btn = document.createElement('button');
    btn.className   = variant ? `btn ${variant}` : 'btn';
    btn.style.cssText = 'flex:1;font-size:9px;padding:5px 6px';
    btn.textContent = label;
    return btn;
  }

  function getImages() { return [..._images.values()]; }

  /**
   * Add a shader to the library and persist it.
   * Called from ShaderPanel's "Save to library" button.
   */
  function addShader({ name, glsl }) {
    const id = `shdr-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    _shaders.set(id, { id, name: name || 'Shader', glsl });
    _saveShadersToStorage();
    if (_activeSection === 'shader') _render();
    return id;
  }

  /**
   * Open the shader library in picker mode.
   * callback(glsl, name) is called when the user clicks a shader.
   */
  function openShaderSection(layer, callback) {
    _shaderCallback = callback;
    _activeSection  = 'shader';
    document.querySelector('[data-tab="library"]')?.click();
    _render();
  }

  // ── Public add methods — called by AudioPanel / VideoPanel ────
  // Allows files uploaded in the AUDIO or VIDEO tabs to appear in
  // the LIBRARY without duplicating the file input listeners.

  async function addAudioFile(file) {
    const id       = `aud-${++_audioCounter}-${Date.now()}`;
    const url      = URL.createObjectURL(file);
    const duration = await _getAudioDuration(url);
    _audioFiles.set(id, { id, name: file.name, url, file, duration });
    // Only re-render if the Audio section is currently visible
    if (_activeSection === 'audio') _render();
    return id;
  }

  // Videos are managed by VideoLibrary (shared singleton), so we just
  // refresh the panel when videoLibrary.onChanged fires — no extra method needed.

  return {
    init, refresh,
    buildVideoPicker,
    promptImageForLayer,
    showAddImagePrompt,
    getImages,
    addAudioFile,
    addShader,
    openShaderSection,
  };

})();
