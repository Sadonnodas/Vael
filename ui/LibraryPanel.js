/**
 * ui/LibraryPanel.js
 * Unified asset library: Videos, Images, (Audio coming later).
 * Replaces VideoLibraryPanel.js.
 *
 * FIXES:
 * - Does not set videoLibrary.onChanged — App.js owns that callback.
 *   Instead, App.js calls LibraryPanel.refresh() when the library changes.
 * - Image upload directly loads into an ImageLayer if one is selected,
 *   or stores the file for later assignment.
 * - Video upload adds to VideoLibrary and shows immediately.
 * - Each section is a collapsible tab inside the panel.
 *
 * Usage:
 *   LibraryPanel.init({ videoLibrary, layerStack, getSelectedLayer });
 *   LibraryPanel.refresh();  // call whenever library changes
 *   LibraryPanel.buildVideoPicker(currentId, layer, paramId); // for ParamPanel
 */

const LibraryPanel = (() => {

  let _videoLibrary    = null;
  let _layerStack      = null;
  let _getSelectedLayer = null;
  let _container       = null;
  let _activeSection   = 'video';

  // Stored image files: { id, name, url, file }
  const _images = new Map();
  let   _imgCounter = 0;

  function init({ videoLibrary, layerStack, getSelectedLayer, container }) {
    _videoLibrary     = videoLibrary;
    _layerStack       = layerStack;
    _getSelectedLayer = getSelectedLayer;
    _container        = container;
    _render();
  }

  function refresh() {
    if (_container) _render();
  }

  // ── Main render ───────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    // Section tabs
    const tabRow = document.createElement('div');
    tabRow.style.cssText = `
      display: flex;
      gap: 0;
      margin-bottom: 14px;
      border: 1px solid var(--border-dim);
      border-radius: 5px;
      overflow: hidden;
    `;

    ['video', 'image'].forEach(section => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        flex: 1;
        padding: 7px 4px;
        background: ${_activeSection === section ? 'color-mix(in srgb,var(--accent) 12%,var(--bg-card))' : 'var(--bg-card)'};
        border: none;
        border-right: 1px solid var(--border-dim);
        color: ${_activeSection === section ? 'var(--accent)' : 'var(--text-dim)'};
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 1px;
        cursor: pointer;
        text-transform: uppercase;
      `;
      btn.textContent = section === 'video' ? `▶ Videos (${_videoLibrary?.count ?? 0})`
                                             : `🖼 Images (${_images.size})`;
      btn.addEventListener('click', () => { _activeSection = section; _render(); });
      tabRow.appendChild(btn);
    });
    // Remove last border-right
    tabRow.lastChild.style.borderRight = 'none';
    _container.appendChild(tabRow);

    if (_activeSection === 'video') _renderVideoSection();
    else                             _renderImageSection();
  }

  // ── Video section ─────────────────────────────────────────────

  function _renderVideoSection() {
    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:12px';
    intro.textContent   = 'Upload video files here. Assign them to Video layers via the PARAMS tab.';
    _container.appendChild(intro);

    // Upload button
    const uploadBtn = document.createElement('button');
    uploadBtn.className        = 'btn accent';
    uploadBtn.style.width      = '100%';
    uploadBtn.style.marginBottom = '14px';
    uploadBtn.textContent      = '+ Add video files…';
    _container.appendChild(uploadBtn);

    // Hidden file input — in body so dialog opens reliably
    let fileInput = document.getElementById('_lib-video-input');
    if (!fileInput) {
      fileInput          = document.createElement('input');
      fileInput.id       = '_lib-video-input';
      fileInput.type     = 'file';
      fileInput.accept   = 'video/*';
      fileInput.multiple = true;
      fileInput.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
      document.body.appendChild(fileInput);
    }

    uploadBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

    fileInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      uploadBtn.textContent = `Loading ${files.length} file${files.length > 1 ? 's' : ''}…`;
      uploadBtn.disabled    = true;
      for (const file of files) {
        try {
          await _videoLibrary.add(file);
          Toast.success(`Video added: ${file.name}`);
        } catch (err) {
          Toast.error(`Could not load: ${file.name}`);
          console.error(err);
        }
      }
      uploadBtn.textContent = '+ Add video files…';
      uploadBtn.disabled    = false;
      _render();
    });

    // Empty state
    if (!_videoLibrary || _videoLibrary.count === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        text-align:center; padding:24px 12px;
        border:1px dashed var(--border-dim); border-radius:6px;
        font-family:var(--font-mono); font-size:9px; color:var(--text-dim); line-height:1.8;
      `;
      empty.innerHTML = 'No videos yet.<br>Add files above, then assign them<br>to Video layers in PARAMS.';
      _container.appendChild(empty);
      return;
    }

    // Video list
    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    label.textContent   = `${_videoLibrary.count} video${_videoLibrary.count !== 1 ? 's' : ''}`;
    _container.appendChild(label);

    _videoLibrary.entries.forEach(entry => {
      const card = document.createElement('div');
      card.style.cssText = `
        background:var(--bg-card); border:1px solid var(--border-dim);
        border-radius:5px; padding:8px 10px; margin-bottom:6px;
        display:flex; align-items:center; gap:8px;
      `;

      // Mini preview
      const preview = document.createElement('video');
      preview.src         = entry.url;
      preview.muted       = true;
      preview.loop        = true;
      preview.playsInline = true;
      preview.style.cssText = 'width:54px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#000';
      preview.play().catch(() => {});
      card.appendChild(preview);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${entry.name}
        </div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:2px">
          ${VaelMath.formatTime(entry.duration)}
        </div>
      `;
      card.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px';
      delBtn.textContent   = '✕';
      delBtn.title         = 'Remove from library';
      delBtn.addEventListener('click', () => {
        _videoLibrary.remove(entry.id);
        Toast.info(`Removed: ${entry.name}`);
        _render();
      });
      card.appendChild(delBtn);

      _container.appendChild(card);
    });
  }

  // ── Image section ─────────────────────────────────────────────

  function _renderImageSection() {
    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:12px';
    intro.textContent   = 'Upload images here, then click "Load into layer" to apply to a selected Image layer.';
    _container.appendChild(intro);

    // Upload button
    const uploadBtn = document.createElement('button');
    uploadBtn.className        = 'btn accent';
    uploadBtn.style.width      = '100%';
    uploadBtn.style.marginBottom = '14px';
    uploadBtn.textContent      = '+ Add image files…';
    _container.appendChild(uploadBtn);

    let fileInput = document.getElementById('_lib-image-input');
    if (!fileInput) {
      fileInput          = document.createElement('input');
      fileInput.id       = '_lib-image-input';
      fileInput.type     = 'file';
      fileInput.accept   = 'image/*';
      fileInput.multiple = true;
      fileInput.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
      document.body.appendChild(fileInput);
    }

    uploadBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

    fileInput.addEventListener('change', e => {
      Array.from(e.target.files).forEach(file => {
        const id  = `img-${++_imgCounter}-${Date.now()}`;
        const url = URL.createObjectURL(file);
        _images.set(id, { id, name: file.name, url, file });
        Toast.success(`Image added: ${file.name}`);
      });
      _render();
    });

    // Empty state
    if (_images.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        text-align:center; padding:24px 12px;
        border:1px dashed var(--border-dim); border-radius:6px;
        font-family:var(--font-mono); font-size:9px; color:var(--text-dim); line-height:1.8;
      `;
      empty.innerHTML = 'No images yet.<br>Add files above, select an Image layer,<br>then click Load into layer.';
      _container.appendChild(empty);
      return;
    }

    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    label.textContent   = `${_images.size} image${_images.size !== 1 ? 's' : ''}`;
    _container.appendChild(label);

    _images.forEach(entry => {
      const card = document.createElement('div');
      card.style.cssText = `
        background:var(--bg-card); border:1px solid var(--border-dim);
        border-radius:5px; padding:8px 10px; margin-bottom:6px;
      `;

      // Preview row
      const previewRow = document.createElement('div');
      previewRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      const img = document.createElement('img');
      img.src   = entry.url;
      img.style.cssText = 'width:54px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#000';
      previewRow.appendChild(img);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${entry.name}
        </div>
      `;
      previewRow.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px';
      delBtn.textContent   = '✕';
      delBtn.addEventListener('click', () => {
        URL.revokeObjectURL(entry.url);
        _images.delete(entry.id);
        _render();
      });
      previewRow.appendChild(delBtn);
      card.appendChild(previewRow);

      // Load into layer button
      const loadBtn = document.createElement('button');
      loadBtn.className   = 'btn accent';
      loadBtn.style.width = '100%';
      loadBtn.style.fontSize = '9px';
      loadBtn.textContent = '↑ Load into selected Image layer';
      loadBtn.addEventListener('click', async () => {
        const layer = _getSelectedLayer ? _getSelectedLayer() : null;
        if (!layer) { Toast.warn('Select an Image layer first'); return; }
        if (!(layer instanceof ImageLayer)) { Toast.warn('Selected layer is not an Image layer'); return; }
        loadBtn.textContent = 'Loading…';
        loadBtn.disabled    = true;
        try {
          await layer.loadFile(entry.file);
          Toast.success(`Loaded into ${layer.name}`);
        } catch {
          Toast.error('Could not load image into layer');
        }
        loadBtn.textContent = '↑ Load into selected Image layer';
        loadBtn.disabled    = false;
      });
      card.appendChild(loadBtn);

      _container.appendChild(card);
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
      <select style="
        width:100%;
        background:color-mix(in srgb,var(--accent2) 10%,var(--bg));
        border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);
        border-radius:4px; color:var(--accent2);
        font-family:var(--font-mono); font-size:10px; padding:5px 8px; cursor:pointer;
      ">
        <option value="">— none (use Video tab source) —</option>
        ${entries.map(e =>
          `<option value="${e.id}" ${e.id === currentId ? 'selected' : ''}>
            ${e.name} (${VaelMath.formatTime(e.duration)})
          </option>`
        ).join('')}
      </select>
      ${entries.length === 0
        ? `<div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:4px">
             Add videos in the LIBRARY tab first.
           </div>`
        : ''}
    `;

    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[paramId] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(paramId, e.target.value);
    });

    return wrap;
  }

  return { init, refresh, buildVideoPicker };

})();
