/**
 * ui/VideoLibraryPanel.js
 * Panel for the LIBRARY tab. Lets users upload multiple video files
 * and see what's loaded. VideoPlayerLayers reference videos by ID from here.
 *
 * Also provides VideoLibraryPanel.buildPicker(currentId, layer) which
 * ParamPanel calls when it encounters a 'videolibrary' type param.
 */

const VideoLibraryPanel = (() => {

  let _library   = null;
  let _container = null;

  function init(videoLibrary, container) {
    _library   = videoLibrary;
    _container = container;

    _library.onChanged = () => _render();
    _render();
  }

  // ── Main panel render ─────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    // Header
    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:14px';
    intro.textContent   = 'Upload video files here. Each Video layer can independently choose which file to play.';
    _container.appendChild(intro);

    // Upload button
    const uploadBtn = document.createElement('button');
    uploadBtn.className   = 'btn accent';
    uploadBtn.style.width = '100%';
    uploadBtn.style.marginBottom = '14px';
    uploadBtn.textContent = '+ Add video file…';
    _container.appendChild(uploadBtn);

    const fileInput = document.createElement('input');
    fileInput.type     = 'file';
    fileInput.accept   = 'video/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    _container.appendChild(fileInput);

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      uploadBtn.textContent = 'Loading…';
      uploadBtn.disabled    = true;

      for (const file of files) {
        try {
          await _library.add(file);
          Toast.success(`Video loaded: ${file.name}`);
        } catch (err) {
          Toast.error(`Could not load: ${file.name}`);
        }
      }

      uploadBtn.textContent = '+ Add video file…';
      uploadBtn.disabled    = false;
      e.target.value        = '';
    });

    // Empty state
    if (_library.count === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        text-align: center;
        padding: 28px 16px;
        border: 1px dashed var(--border-dim);
        border-radius: 6px;
        font-family: var(--font-mono);
        font-size: 9px;
        color: var(--text-dim);
        line-height: 1.8;
      `;
      empty.innerHTML = 'No videos loaded yet.<br>Add files above, then assign them<br>to Video layers in the PARAMS tab.';
      _container.appendChild(empty);
      return;
    }

    // Video list
    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    label.textContent   = `Library (${_library.count})`;
    _container.appendChild(label);

    _library.entries.forEach(entry => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--bg-card);
        border: 1px solid var(--border-dim);
        border-radius: 5px;
        padding: 8px 10px;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;

      // Mini video preview
      const preview = document.createElement('video');
      preview.src         = entry.url;
      preview.muted       = true;
      preview.loop        = true;
      preview.playsInline = true;
      preview.style.cssText = 'width:56px;height:36px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#000';
      preview.play().catch(() => {});

      card.appendChild(preview);

      // Info
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${entry.name}
        </div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:2px">
          ${VaelMath.formatTime(entry.duration)} · ID: ${entry.id}
        </div>
      `;
      card.appendChild(info);

      // Remove button
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;flex-shrink:0';
      delBtn.textContent   = '✕';
      delBtn.title         = 'Remove from library';
      delBtn.addEventListener('click', () => {
        _library.remove(entry.id);
        Toast.info(`Removed: ${entry.name}`);
      });
      card.appendChild(delBtn);

      _container.appendChild(card);
    });
  }

  // ── Param picker (called by ParamPanel for 'videolibrary' params) ──

  /**
   * Build a dropdown that lets a VideoPlayerLayer choose which library
   * video to play. Used by ParamPanel.buildControl() for type 'videolibrary'.
   *
   * @param {string}      currentId  — layer.params.videoId
   * @param {BaseLayer}   layer
   * @param {string}      paramId    — 'videoId'
   * @returns {HTMLElement}
   */
  function buildPicker(currentId, layer, paramId) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';

    const entries = _library ? _library.entries : [];

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">Video source</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">library</span>
      </div>
      <select style="
        width: 100%;
        background: color-mix(in srgb, var(--accent2) 10%, var(--bg));
        border: 1px solid color-mix(in srgb, var(--accent2) 40%, transparent);
        border-radius: 4px;
        color: var(--accent2);
        font-family: var(--font-mono);
        font-size: 10px;
        padding: 5px 8px;
        cursor: pointer;
      ">
        <option value="">— none (use Video tab source) —</option>
        ${entries.map(e =>
          `<option value="${e.id}" ${e.id === currentId ? 'selected' : ''}>
            ${e.name} (${VaelMath.formatTime(e.duration)})
          </option>`
        ).join('')}
      </select>
      ${entries.length === 0
        ? `<div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                       margin-top:4px">Add videos in the LIBRARY tab first.</div>`
        : ''}
    `;

    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[paramId] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(paramId, e.target.value);
    });

    return wrap;
  }

  return { init, buildPicker };

})();
