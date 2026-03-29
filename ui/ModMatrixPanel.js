/**
 * ui/ModMatrixPanel.js
 * Renders the modulation matrix section inside the params panel.
 *
 * CHANGES:
 * - Depth slider range: -2 to +2 (was 0 to 1).
 *   Negative = inverts the signal. > 1 = larger than one full param range.
 * - Target dropdown now includes transform targets (Position X/Y, Scale, Rotation)
 *   in a separate "Transform" optgroup.
 * - Depth value shown with sign so it's clear when negative.
 * - Removed separate "invert" button — just use negative depth instead.
 *   (Invert flag still works for backwards compat but is hidden from new UI.)
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

  // Transform target definitions (matches ModMatrix.TRANSFORM_TARGETS)
  const TRANSFORM_TARGETS = [
    { id: 'transform.x',        label: 'Position X' },
    { id: 'transform.y',        label: 'Position Y' },
    { id: 'transform.scaleX',   label: 'Scale X'    },
    { id: 'transform.scaleY',   label: 'Scale Y'    },
    { id: 'transform.rotation', label: 'Rotation'   },
  ];

  const LAYER_TARGETS = [
    { id: 'opacity', label: 'Opacity' },
  ];

  function render(layer, container) {
    if (!layer.modMatrix) return;

    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin:18px 0 14px';
    container.appendChild(div);

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';

    const modCountSpan = document.createElement('span');
    modCountSpan.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px';
    modCountSpan.textContent   = `Modulation (${layer.modMatrix.routes.length})`;
    headerRow.appendChild(modCountSpan);

    const addRouteBtn = document.createElement('button');
    addRouteBtn.style.cssText = 'background:none;border:1px solid var(--accent2);border-radius:3px;color:var(--accent2);font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer';
    addRouteBtn.textContent   = '+ Add route';
    headerRow.appendChild(addRouteBtn);
    container.appendChild(headerRow);

    const routeList = document.createElement('div');
    routeList.id = 'mod-route-list';
    _renderRoutes(layer, routeList);
    container.appendChild(routeList);

    const form = document.createElement('div');
    form.id = 'mod-add-form';
    form.style.cssText = `
      display:none; background:var(--bg-card); border:1px solid var(--border-dim);
      border-radius:6px; padding:12px; margin-top:8px;
    `;
    form.innerHTML = _buildAddForm(layer);
    container.appendChild(form);

    addRouteBtn.addEventListener('click', () => {
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : 'block';
      if (!open) {
        form.innerHTML = _buildAddForm(layer);
        _wireForm(layer, form, routeList, modCountSpan);
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
      // Find the label for this target
      const paramManifest = layer.constructor?.manifest?.params?.find(p => p.id === route.target);
      const transformDef  = TRANSFORM_TARGETS.find(t => t.id === route.target);
      const layerDef      = LAYER_TARGETS.find(t => t.id === route.target);
      const targetName    = paramManifest?.label || transformDef?.label || layerDef?.label || route.target;
      const sourceName    = SOURCE_LABELS[route.source] || route.source;
      const color         = SOURCE_COLORS[route.source] || '#00d4aa';

      const row = document.createElement('div');
      row.style.cssText = `
        display:flex; align-items:center; gap:6px; padding:6px 8px;
        background:var(--bg-card); border:1px solid var(--border-dim);
        border-left:2px solid ${color}; border-radius:4px;
        margin-bottom:4px; flex-wrap:wrap;
      `;

      const depthSign  = route.depth < 0 ? '−' : '+';
      const depthAbs   = Math.abs(route.depth).toFixed(2);
      const depthColor = route.depth < 0 ? '#ff9070' : color;

      row.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;font-weight:600;
                     color:${color};min-width:52px">${sourceName}</span>
        <span style="font-size:9px;color:var(--text-dim)">→</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1">
          ${targetName}
        </span>

        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim)">depth</span>
          <input type="range" class="mod-depth" min="-2" max="2" step="0.05"
            value="${route.depth}"
            style="width:52px;accent-color:${depthColor}"
            title="Depth: -2 to +2. Negative inverts the signal." />
          <span class="mod-depth-val" style="font-family:var(--font-mono);font-size:8px;
                color:${depthColor};min-width:30px;text-align:right">
            ${depthSign}${depthAbs}
          </span>
        </div>

        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim)">lag</span>
          <input type="range" class="mod-smooth" min="0.01" max="1" step="0.01"
            value="${route.smooth}"
            style="width:40px;accent-color:var(--accent2)"
            title="Response lag: 0.01=very slow, 1=instant" />
        </div>

        <button class="mod-del"
          style="background:none;border:none;color:#ff4444;cursor:pointer;
                 font-size:10px;padding:0 2px">✕</button>
      `;

      const depthSlider = row.querySelector('.mod-depth');
      const depthVal    = row.querySelector('.mod-depth-val');

      depthSlider.addEventListener('input', () => {
        const v    = parseFloat(depthSlider.value);
        route.depth = v;
        const sign = v < 0 ? '−' : '+';
        const abs  = Math.abs(v).toFixed(2);
        const col  = v < 0 ? '#ff9070' : (SOURCE_COLORS[route.source] || '#00d4aa');
        depthVal.textContent = `${sign}${abs}`;
        depthVal.style.color = col;
        depthSlider.style.accentColor = col;
      });

      row.querySelector('.mod-smooth').addEventListener('input', e => {
        route.smooth = parseFloat(e.target.value);
      });

      row.querySelector('.mod-del').addEventListener('click', () => {
        layer.modMatrix.removeRoute(route.id);
        _renderRoutes(layer, container);
      });

      container.appendChild(row);
    });
  }

  function _buildAddForm(layer) {
    // Param targets from manifest
    const manifest = layer.constructor?.manifest?.params?.filter(p =>
      p.type === 'float' || p.type === 'int'
    ) || [];

    const sourceOptions = SOURCE_GROUPS.map(group =>
      `<optgroup label="${group.group}">${
        group.ids.map(id => `<option value="${id}">${SOURCE_LABELS[id]}</option>`).join('')
      }</optgroup>`
    ).join('');

    const paramTargetOptions = manifest.map(p =>
      `<option value="${p.id}">${p.label}</option>`
    ).join('');

    const transformTargetOptions = TRANSFORM_TARGETS.map(t =>
      `<option value="${t.id}">${t.label}</option>`
    ).join('');

    const targetOptions = [
      `<optgroup label="Layer">${LAYER_TARGETS.map(t =>
        `<option value="${t.id}">${t.label}</option>`
      ).join('')}</optgroup>`,
      paramTargetOptions ? `<optgroup label="Parameters">${paramTargetOptions}</optgroup>` : '',
      `<optgroup label="Transform">${transformTargetOptions}</optgroup>`,
    ].join('');

    if (!paramTargetOptions && !transformTargetOptions) {
      return '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">No modulatable targets.</div>';
    }

    return `
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);margin-bottom:10px;letter-spacing:1px">ADD ROUTE</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">Source signal</div>
          <select id="mod-source" style="width:100%;background:var(--bg);border:1px solid var(--border);
            border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
            ${sourceOptions}
          </select>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">Target</div>
          <select id="mod-target" style="width:100%;background:var(--bg);border:1px solid var(--border);
            border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
            ${targetOptions}
          </select>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
            Depth  <span style="color:var(--text-dim);font-size:7px">(−2 to +2, negative = invert)</span>
          </span>
          <span id="mod-depth-val" style="font-family:var(--font-mono);font-size:8px;color:var(--accent)">+0.50</span>
        </div>
        <input type="range" id="mod-depth-sl" min="-2" max="2" step="0.05" value="0.5"
          style="width:100%;accent-color:var(--accent)" />
      </div>

      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
            Response lag  <span style="color:var(--text-dim);font-size:7px">(0.01=slow, 1=instant)</span>
          </span>
          <span id="mod-smooth-val" style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">0.10</span>
        </div>
        <input type="range" id="mod-smooth-sl" min="0.01" max="1" step="0.01" value="0.1"
          style="width:100%;accent-color:var(--accent2)" />
      </div>

      <button id="mod-confirm" class="btn accent" style="width:100%;font-size:9px">Add route</button>
    `;
  }

  function _wireForm(layer, form, routeList, modCountSpan) {
    form.querySelector('#mod-depth-sl')?.addEventListener('input', e => {
      const v    = parseFloat(e.target.value);
      const sign = v < 0 ? '−' : '+';
      form.querySelector('#mod-depth-val').textContent = `${sign}${Math.abs(v).toFixed(2)}`;
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

      layer.modMatrix.addRoute({ source, target, depth, smooth }, layer);
      form.style.display = 'none';
      _renderRoutes(layer, routeList);

      modCountSpan.textContent = `Modulation (${layer.modMatrix.routes.length})`;

      const targetLabel = layer.constructor?.manifest?.params?.find(p => p.id === target)?.label
        || TRANSFORM_TARGETS.find(t => t.id === target)?.label
        || target;
      Toast.success(`Route: ${SOURCE_LABELS[source] || source} → ${targetLabel}`);
    });
  }

  return { render };

})();
