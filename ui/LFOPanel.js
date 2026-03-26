/**
 * ui/LFOPanel.js
 * Renders the LFO modulator panel.
 * Shows active LFOs and lets you add new ones to any layer parameter.
 * Rendered inside the PARAMS tab when the LFO button is clicked.
 */

const LFOPanel = (() => {

  let _lfoManager  = null;
  let _layerStack  = null;
  let _container   = null;

  const SHAPES = ['sine', 'triangle', 'square', 'saw', 'random'];

  function init(lfoManager, layerStack, container) {
    _lfoManager = lfoManager;
    _layerStack = layerStack;
    _container  = container;
    _render();
  }

  function refresh() { _render(); }

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:14px';
    intro.textContent   = 'LFOs animate layer parameters over time. Rate is in Hz (cycles/sec) or beats if BPM sync is on.';
    _container.appendChild(intro);

    // Active LFOs
    if (_lfoManager.lfos.length > 0) {
      const activeLabel = document.createElement('div');
      activeLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px';
      activeLabel.textContent   = `Active (${_lfoManager.lfos.length})`;
      _container.appendChild(activeLabel);

      _lfoManager.lfos.forEach(lfo => {
        const layer = _layerStack.layers.find(l => l.id === lfo.layerId);
        const card  = document.createElement('div');
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

        // Shape visualisation — tiny ASCII wave
        const waveIcons = { sine: '∿', triangle: '⋀', square: '⊓', saw: '⟋', random: '≈' };

        card.innerHTML = `
          <span style="font-size:14px;color:var(--accent2)">${waveIcons[lfo.shape] || '∿'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-mono);font-size:9px;color:var(--text)">
              ${layer?.name ?? lfo.layerId} · ${lfo.paramId}
            </div>
            <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
              ${lfo.shape} · ${lfo.rate}${lfo.syncToBpm ? ' beats' : 'Hz'} · depth ${lfo.depth.toFixed(2)}
            </div>
          </div>
          <button class="lfo-del" data-id="${lfo.id}"
            style="background:none;border:none;color:#454560;cursor:pointer;font-size:11px">✕</button>
        `;

        card.querySelector('.lfo-del').addEventListener('click', () => {
          _lfoManager.remove(lfo.id);
          _render();
        });

        _container.appendChild(card);
      });

      const clearBtn = document.createElement('button');
      clearBtn.className   = 'btn';
      clearBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:14px';
      clearBtn.textContent = 'Clear all LFOs';
      clearBtn.addEventListener('click', () => { _lfoManager.clear(); _render(); });
      _container.appendChild(clearBtn);
    }

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin-bottom:14px';
    _container.appendChild(div);

    // Add new LFO form
    const formLabel = document.createElement('div');
    formLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px';
    formLabel.textContent   = 'Add LFO';
    _container.appendChild(formLabel);

    // Layer picker
    _container.appendChild(_row('Layer', `
      <select id="lfo-layer" style="width:100%;background:var(--bg);border:1px solid var(--border);
        border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
        ${_layerStack.layers.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
      </select>
    `));

    // Param picker (updates when layer changes)
    _container.appendChild(_row('Param', `
      <select id="lfo-param" style="width:100%;background:var(--bg);border:1px solid var(--border);
        border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
      </select>
    `));

    const updateParams = () => {
      const layerId = document.getElementById('lfo-layer')?.value;
      const layer   = _layerStack.layers.find(l => l.id === layerId);
      const sel     = document.getElementById('lfo-param');
      if (!sel) return;
      const params  = layer?.constructor?.manifest?.params?.filter(p => p.type === 'float' || p.type === 'int') || [];
      sel.innerHTML = params.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
    };

    document.getElementById('lfo-layer')?.addEventListener('change', updateParams);
    updateParams();

    // Shape
    _container.appendChild(_row('Shape', `
      <select id="lfo-shape" style="width:100%;background:var(--bg);border:1px solid var(--border);
        border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
        ${SHAPES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    `));

    // Rate
    _container.appendChild(_row('Rate', `
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" id="lfo-rate" value="0.25" min="0.01" max="20" step="0.05"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                 color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px" />
        <label style="display:flex;align-items:center;gap:4px;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);white-space:nowrap">
          <input type="checkbox" id="lfo-sync" /> BPM sync
        </label>
      </div>
    `));

    // Depth + offset
    _container.appendChild(_row('Depth', `
      <input type="range" id="lfo-depth" min="0" max="1" step="0.01" value="0.5"
        style="width:100%;accent-color:var(--accent2)" />
    `));
    _container.appendChild(_row('Offset', `
      <input type="range" id="lfo-offset" min="0" max="1" step="0.01" value="0.5"
        style="width:100%;accent-color:var(--accent)" />
    `));

    const addBtn = document.createElement('button');
    addBtn.className   = 'btn accent';
    addBtn.style.width = '100%';
    addBtn.style.marginTop = '8px';
    addBtn.textContent = '+ Add LFO';
    addBtn.addEventListener('click', () => {
      const layerId = document.getElementById('lfo-layer')?.value;
      const paramId = document.getElementById('lfo-param')?.value;
      if (!layerId || !paramId) { Toast.warn('Select a layer and parameter'); return; }

      const lfo = new LFO({
        layerId,
        paramId,
        shape:      document.getElementById('lfo-shape')?.value  || 'sine',
        rate:       parseFloat(document.getElementById('lfo-rate')?.value) || 0.25,
        depth:      parseFloat(document.getElementById('lfo-depth')?.value) || 0.5,
        offset:     parseFloat(document.getElementById('lfo-offset')?.value) || 0.5,
        syncToBpm:  document.getElementById('lfo-sync')?.checked || false,
        bipolar:    false,
      });

      _lfoManager.add(lfo);
      Toast.success(`LFO added: ${paramId}`);
      _render();
    });
    _container.appendChild(addBtn);
  }

  function _row(label, html) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px';
    wrap.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">${label}</div>
      ${html}
    `;
    return wrap;
  }

  return { init, refresh };

})();
