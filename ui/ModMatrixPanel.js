/**
 * ui/ModMatrixPanel.js
 * Renders the modulation matrix section inside the params panel.
 * Shows active routes and an "Add route" form.
 * Call ModMatrixPanel.render(layer, container) to append after other params.
 */

const ModMatrixPanel = (() => {

  const SOURCE_GROUPS = [
    { group: 'Audio',  ids: ['bass','mid','treble','volume'] },
    { group: 'Video',  ids: ['brightness','motion','edgeDensity'] },
    { group: 'Engine', ids: ['iTime','iBeat','iMouseX','iMouseY'] },
  ];

  const SOURCE_LABELS = {
    bass: 'Bass', mid: 'Mid', treble: 'Treble', volume: 'Volume',
    brightness: 'Brightness', motion: 'Motion', edgeDensity: 'Edge density',
    iTime: 'Time', iBeat: 'Beat', iMouseX: 'Mouse X', iMouseY: 'Mouse Y',
  };

  const SOURCE_COLORS = {
    bass: '#ff6b6b', mid: '#ffd700', treble: '#00d4aa', volume: '#7c6af7',
    brightness: '#ffd700', motion: '#ff6b6b', edgeDensity: '#a78bfa',
    iTime: '#00d4aa', iBeat: '#ffffff', iMouseX: '#7c6af7', iMouseY: '#7c6af7',
  };

  function render(layer, container) {
    if (!layer.modMatrix) return;

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin:18px 0 14px';
    container.appendChild(div);

    // Header row
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';
    headerRow.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                   text-transform:uppercase;letter-spacing:1px">
        Modulation (${layer.modMatrix.routes.length})
      </span>
      <button id="mod-add-btn" style="background:none;border:1px solid var(--accent2);
        border-radius:3px;color:var(--accent2);font-family:var(--font-mono);font-size:8px;
        padding:2px 8px;cursor:pointer">+ Add route</button>
    `;
    container.appendChild(headerRow);

    // Active routes
    const routeList = document.createElement('div');
    routeList.id = 'mod-route-list';
    _renderRoutes(layer, routeList);
    container.appendChild(routeList);

    // Add route form (hidden by default)
    const form = document.createElement('div');
    form.id = 'mod-add-form';
    form.style.cssText = `
      display: none;
      background: var(--bg-card);
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      padding: 12px;
      margin-top: 8px;
    `;
    form.innerHTML = _buildAddForm(layer);
    container.appendChild(form);

    // Wire add button
    headerRow.querySelector('#mod-add-btn').addEventListener('click', () => {
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : 'block';
      if (!open) {
        // Re-render form in case params changed
        form.innerHTML = _buildAddForm(layer);
        _wireForm(layer, form, routeList, headerRow, container);
      }
    });
  }

  function _renderRoutes(layer, container) {
    container.innerHTML = '';
    if (layer.modMatrix.routes.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);padding:6px 0;text-align:center';
      empty.textContent   = 'No modulation routes';
      container.appendChild(empty);
      return;
    }

    layer.modMatrix.routes.forEach(route => {
      const manifest = layer.constructor?.manifest?.params?.find(p => p.id === route.target);
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--bg-card);
        border: 1px solid var(--border-dim);
        border-left: 2px solid ${SOURCE_COLORS[route.source] || '#00d4aa'};
        border-radius: 4px;
        margin-bottom: 4px;
        flex-wrap: wrap;
      `;

      const sourceName = SOURCE_LABELS[route.source] || route.source;
      const targetName = manifest?.label || route.target;

      row.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;font-weight:600;
                     color:${SOURCE_COLORS[route.source] || '#00d4aa'};min-width:58px">
          ${sourceName}
        </span>
        <span style="font-size:9px;color:var(--text-dim)">→</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1">
          ${targetName}
        </span>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="range" class="mod-depth" min="0" max="1" step="0.01"
            value="${route.depth}"
            style="width:50px;accent-color:${SOURCE_COLORS[route.source] || '#00d4aa'}"
            title="Depth: how much this source drives the param" />
          <span class="mod-depth-val" style="font-family:var(--font-mono);font-size:8px;
                color:var(--text-dim);min-width:22px">${route.depth.toFixed(2)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim)">smooth</span>
          <input type="range" class="mod-smooth" min="0.01" max="1" step="0.01"
            value="${route.smooth}"
            style="width:40px;accent-color:var(--accent2)"
            title="Smoothing: 0.01=slow, 1=instant" />
        </div>
        <button class="mod-invert" title="Invert signal"
          style="background:none;border:1px solid ${route.invert ? 'var(--accent2)' : 'var(--border-dim)'};
                 border-radius:2px;color:${route.invert ? 'var(--accent2)' : 'var(--text-dim)'};
                 font-size:8px;padding:1px 4px;cursor:pointer">↕</button>
        <button class="mod-del"
          style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:10px;
                 padding:0 2px">✕</button>
      `;

      // Wire controls
      const depthSlider = row.querySelector('.mod-depth');
      const depthVal    = row.querySelector('.mod-depth-val');
      depthSlider.addEventListener('input', () => {
        route.depth = parseFloat(depthSlider.value);
        depthVal.textContent = route.depth.toFixed(2);
      });

      row.querySelector('.mod-smooth').addEventListener('input', e => {
        route.smooth = parseFloat(e.target.value);
      });

      row.querySelector('.mod-invert').addEventListener('click', e => {
        route.invert = !route.invert;
        e.target.style.borderColor = route.invert ? 'var(--accent2)' : 'var(--border-dim)';
        e.target.style.color       = route.invert ? 'var(--accent2)' : 'var(--text-dim)';
      });

      row.querySelector('.mod-del').addEventListener('click', () => {
        layer.modMatrix.removeRoute(route.id);
        _renderRoutes(layer, container);
      });

      container.appendChild(row);
    });
  }

  function _buildAddForm(layer) {
    const manifest = layer.constructor?.manifest?.params?.filter(p =>
      p.type === 'float' || p.type === 'int'
    ) || [];

    const sourceOptions = SOURCE_GROUPS.map(group =>
      `<optgroup label="${group.group}">${
        group.ids.map(id => `<option value="${id}">${SOURCE_LABELS[id]}</option>`).join('')
      }</optgroup>`
    ).join('');

    const targetOptions = manifest.map(p =>
      `<option value="${p.id}">${p.label}</option>`
    ).join('');

    if (!targetOptions) return '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">No modulatable params on this layer.</div>';

    return `
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);margin-bottom:10px;letter-spacing:1px">ADD ROUTE</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">Source</div>
          <select id="mod-source" style="width:100%;background:var(--bg);border:1px solid var(--border);
            border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
            ${sourceOptions}
          </select>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">Target param</div>
          <select id="mod-target" style="width:100%;background:var(--bg);border:1px solid var(--border);
            border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
            ${targetOptions}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Depth</span>
            <span id="mod-depth-val" style="font-family:var(--font-mono);font-size:8px;color:var(--accent)">0.50</span>
          </div>
          <input type="range" id="mod-depth-sl" min="0" max="1" step="0.01" value="0.5"
            style="width:100%;accent-color:var(--accent)" />
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Smooth</span>
            <span id="mod-smooth-val" style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">0.10</span>
          </div>
          <input type="range" id="mod-smooth-sl" min="0.01" max="1" step="0.01" value="0.1"
            style="width:100%;accent-color:var(--accent2)" />
        </div>
      </div>
      <button id="mod-confirm" class="btn accent" style="width:100%;font-size:9px">Add route</button>
    `;
  }

  function _wireForm(layer, form, routeList, headerRow, outerContainer) {
    form.querySelector('#mod-depth-sl')?.addEventListener('input', e => {
      form.querySelector('#mod-depth-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    form.querySelector('#mod-smooth-sl')?.addEventListener('input', e => {
      form.querySelector('#mod-smooth-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    form.querySelector('#mod-confirm')?.addEventListener('click', () => {
      const source = form.querySelector('#mod-source')?.value;
      const target = form.querySelector('#mod-target')?.value;
      const depth  = parseFloat(form.querySelector('#mod-depth-sl')?.value) || 0.5;
      const smooth = parseFloat(form.querySelector('#mod-smooth-sl')?.value) || 0.1;
      if (!source || !target) return;
      layer.modMatrix.addRoute({ source, target, depth, smooth });
      form.style.display = 'none';
      _renderRoutes(layer, routeList);
      // Update route count
      const countEl = headerRow.querySelector('span');
      if (countEl) countEl.textContent = `Modulation (${layer.modMatrix.routes.length})`;
      Toast.success(`Route: ${SOURCE_LABELS[source] || source} → ${target}`);
    });
  }

  return { render };

})();
