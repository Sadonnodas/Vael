/**
 * ui/LyricsPanel.js
 * Inline editor for LyricsLayer instances.
 * Shows when a LyricsLayer is selected in the params panel.
 * Provides a textarea for lines, prev/next controls, and live preview.
 */

const LyricsPanel = (() => {

  /**
   * Render the lyrics editor into container for the given layer.
   * @param {LyricsLayer} layer
   * @param {HTMLElement} container
   */
  function render(layer, container) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 1.5px;
      color: var(--accent);
      margin-bottom: 14px;
      text-transform: uppercase;
    `;
    header.textContent = 'Lyrics / Text';
    container.appendChild(header);

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

    navRow.querySelector('#lyr-prev').addEventListener('click', () => {
      layer.prev(); updateProgress();
    });
    navRow.querySelector('#lyr-next').addEventListener('click', () => {
      layer.next(); updateProgress();
    });
    navRow.querySelector('#lyr-hide').addEventListener('click', () => {
      layer.hide(); updateProgress();
    });

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
      if (customInput.value.trim()) {
        layer.show(customInput.value.trim());
        updateProgress();
      }
    });
    customInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        layer.show(customInput.value.trim());
        updateProgress();
      }
    });

    // Divider before standard params
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--border-dim);margin:4px 0 14px';
    container.appendChild(divider);

    // Standard param controls (font size, position, color, transition, duration)
    const manifest = layer.constructor.manifest;
    if (manifest?.params) {
      const paramHeader = document.createElement('div');
      paramHeader.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px';
      paramHeader.textContent   = 'Style';
      container.appendChild(paramHeader);

      manifest.params.forEach(param => {
        const current = layer.params?.[param.id] ?? param.default;
        const el = _buildControl(param, current, layer);
        container.appendChild(el);
      });
    }
  }

  // ── Control builders (simplified subset of ParamPanel) ───────

  function _buildControl(param, current, layer) {
    switch (param.type) {
      case 'float':
      case 'int':   return _buildSlider(param, current, layer);
      case 'enum':  return _buildDropdown(param, current, layer);
      case 'bool':  return _buildToggle(param, current, layer);
      case 'color': return _buildColor(param, current, layer);
      default:      return _buildSlider(param, current, layer);
    }
  }

  function _buildSlider(param, current, layer) {
    const isInt = param.type === 'int';
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    const fmt = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <span class="pv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${fmt(current)}</span>
      </div>
      <input type="range" min="${param.min}" max="${param.max}" step="${isInt ? 1 : 0.01}"
             value="${current}" style="width:100%;accent-color:var(--accent)" />
    `;
    const valEl = wrap.querySelector('.pv');
    wrap.querySelector('input').addEventListener('input', e => {
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      valEl.textContent = fmt(v);
      layer.params[param.id] = v;
    });
    return wrap;
  }

  function _buildDropdown(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">${param.label}</div>
      <select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                     color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
        ${(param.options || []).map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => { layer.params[param.id] = e.target.value; });
    return wrap;
  }

  function _buildToggle(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between';
    let state = !!current;
    wrap.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      <button style="width:40px;height:20px;border-radius:10px;border:1px solid var(--border);
        background:${state ? 'var(--accent)' : 'var(--bg)'};cursor:pointer;position:relative;transition:background 0.2s">
        <span style="position:absolute;top:2px;left:${state ? '20px' : '2px'};width:14px;height:14px;
          border-radius:50%;background:${state ? 'var(--bg)' : 'var(--text-dim)'};transition:left 0.2s"></span>
      </button>
    `;
    const btn  = wrap.querySelector('button');
    const knob = btn.querySelector('span');
    btn.addEventListener('click', () => {
      state = !state;
      btn.style.background  = state ? 'var(--accent)' : 'var(--bg)';
      knob.style.left       = state ? '20px' : '2px';
      knob.style.background = state ? 'var(--bg)' : 'var(--text-dim)';
      layer.params[param.id] = state;
    });
    return wrap;
  }

  function _buildColor(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between';
    wrap.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      <input type="color" value="${current || '#ffffff'}"
        style="width:36px;height:24px;padding:2px;border:1px solid var(--border);
               border-radius:4px;background:var(--bg);cursor:pointer" />
    `;
    wrap.querySelector('input').addEventListener('input', e => { layer.params[param.id] = e.target.value; });
    return wrap;
  }

  return { render };

})();
