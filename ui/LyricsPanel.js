/**
 * ui/LyricsPanel.js
 * Inline editor for LyricsLayer instances.
 *
 * CHANGES:
 * - Uses ParamPanel._buildNameHeader() so the layer can be renamed
 *   from the params panel, consistent with all other layer types.
 * - Delegates control building to ParamPanel.buildControl() instead
 *   of maintaining its own duplicate set of builders.
 */

const LyricsPanel = (() => {

  function render(layer, container) {
    container.innerHTML = '';

    // Editable name header — shared with ParamPanel and ShaderPanel
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Lyrics / Text'));
    } else {
      const header = document.createElement('div');
      header.style.cssText = 'font-family:var(--font-mono);font-size:12px;color:var(--accent);margin-bottom:16px';
      header.textContent   = layer.name || 'Lyrics';
      container.appendChild(header);
    }

    // Lines textarea
    const linesLabel = document.createElement('div');
    linesLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:6px';
    linesLabel.textContent   = 'Lines (one per line)';
    container.appendChild(linesLabel);

    const textarea = document.createElement('textarea');
    textarea.value = layer.lines.join('\n');
    textarea.style.cssText = `
      width: 100%;
      height: 120px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 8px;
      resize: vertical;
      line-height: 1.6;
      margin-bottom: 10px;
    `;
    textarea.placeholder = 'One lyric line per line…';
    container.appendChild(textarea);

    textarea.addEventListener('input', () => {
      layer.lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    });

    // Progress indicator
    const progress = document.createElement('div');
    progress.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);margin-bottom:10px;text-align:center';
    const updateProgress = () => {
      const total = layer.totalLines;
      const cur   = layer.currentLine;
      progress.textContent = total > 0
        ? `Line ${cur >= 0 ? cur + 1 : 0} of ${total}`
        : 'No lines — add some above';
    };
    updateProgress();
    container.appendChild(progress);

    // Navigation controls
    const navRow = document.createElement('div');
    navRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
    navRow.innerHTML = `
      <button id="lyr-prev" class="btn" style="flex:1">← Prev</button>
      <button id="lyr-next" class="btn accent" style="flex:1">Next →</button>
      <button id="lyr-hide" class="btn" style="flex:1">Hide</button>
    `;
    container.appendChild(navRow);

    navRow.querySelector('#lyr-prev').addEventListener('click', () => { layer.prev(); updateProgress(); });
    navRow.querySelector('#lyr-next').addEventListener('click', () => { layer.next(); updateProgress(); });
    navRow.querySelector('#lyr-hide').addEventListener('click', () => { layer.hide(); updateProgress(); });

    // Custom text input
    const customLabel = document.createElement('div');
    customLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:6px';
    customLabel.textContent   = 'Show custom text';
    container.appendChild(customLabel);

    const customRow = document.createElement('div');
    customRow.style.cssText = 'display:flex;gap:6px;margin-bottom:14px';
    customRow.innerHTML = `
      <input type="text" id="lyr-custom" placeholder="Type anything…"
        style="flex:1;background:var(--bg);border:1px solid var(--border);
               border-radius:4px;color:var(--text);font-family:var(--font-mono);
               font-size:10px;padding:6px 8px" />
      <button id="lyr-show" class="btn accent" style="flex-shrink:0">Show</button>
    `;
    container.appendChild(customRow);

    const customInput = customRow.querySelector('#lyr-custom');
    customRow.querySelector('#lyr-show').addEventListener('click', () => {
      if (customInput.value.trim()) { layer.show(customInput.value.trim()); updateProgress(); }
    });
    customInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { layer.show(customInput.value.trim()); updateProgress(); }
    });

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--border-dim);margin:4px 0 14px';
    container.appendChild(divider);

    // Style params — delegate to ParamPanel.buildControl() to avoid duplication
    const manifest = layer.constructor.manifest;
    if (manifest?.params) {
      const paramHeader = document.createElement('div');
      paramHeader.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px';
      paramHeader.textContent   = 'Style';
      container.appendChild(paramHeader);

      manifest.params.forEach(param => {
        const current = layer.params?.[param.id] ?? param.default;
        // Use ParamPanel builders if available, otherwise fall back to inline
        const el = (typeof ParamPanel !== 'undefined')
          ? ParamPanel.buildControl(param, current, layer)
          : _buildControlFallback(param, current, layer);
        container.appendChild(el);
      });
    }

    // Modulation + FX — same as every other layer
    if (layer.modMatrix && typeof ModMatrixPanel !== 'undefined') {
      ModMatrixPanel.render(layer, container);
    }
    if (typeof LayerFXPanel !== 'undefined') {
      LayerFXPanel.render(layer, container);
    }
  }

  // ── Minimal fallback builders (only used if ParamPanel not loaded) ──

  function _buildControlFallback(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    if (param.type === 'bool') {
      wrap.innerHTML = `<label style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" ${current ? 'checked' : ''} /> ${param.label}
      </label>`;
      wrap.querySelector('input').addEventListener('change', e => { layer.params[param.id] = e.target.checked; });
    } else if (param.type === 'color') {
      wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <input type="color" value="${current || '#ffffff'}" style="width:36px;height:24px;cursor:pointer" />
      </div>`;
      wrap.querySelector('input').addEventListener('input', e => { layer.params[param.id] = e.target.value; });
    } else if (param.type === 'enum') {
      wrap.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">${param.label}</div>
        <select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
          ${(param.options||[]).map(o=>`<option value="${o}" ${o===current?'selected':''}>${o}</option>`).join('')}
        </select>`;
      wrap.querySelector('select').addEventListener('change', e => { layer.params[param.id] = e.target.value; });
    } else {
      const isInt = param.type === 'int';
      wrap.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <span class="pv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${isInt ? Math.round(current) : parseFloat(current).toFixed(2)}</span>
      </div>
      <input type="range" min="${param.min??0}" max="${param.max??1}" step="${isInt?1:0.01}" value="${current}" style="width:100%;accent-color:var(--accent)" />`;
      const valEl = wrap.querySelector('.pv');
      wrap.querySelector('input').addEventListener('input', e => {
        const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
        valEl.textContent = isInt ? v : v.toFixed(2);
        layer.params[param.id] = v;
      });
    }
    return wrap;
  }

  return { render };

})();
