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
    { group: 'Audio — bands',    ids: ['bass','mid','treble','volume','rms'] },
    { group: 'Audio — spectrum', ids: ['spectralCentroid','spectralSpread','spectralFlux'] },
    { group: 'Audio — beats',    ids: ['kickEnergy','snareEnergy','hihatEnergy'] },
    { group: 'Song position',    ids: ['songPosition','songTime'] },
    { group: 'Video',            ids: ['brightness','motion','edgeDensity'] },
    { group: 'Engine',           ids: ['iTime','iBeat','iMouseX','iMouseY'] },
    { group: 'LFO',              ids: ['lfo-1','lfo-2','lfo-3','lfo-4'] },
  ];

  const SOURCE_LABELS = {
    // Audio bands
    bass: 'Bass', mid: 'Mid', treble: 'Treble', volume: 'Volume', rms: 'RMS energy',
    // Spectral
    spectralCentroid: 'Centroid (brightness)', spectralSpread: 'Spread', spectralFlux: 'Flux (transients)',
    // Per-band energy
    kickEnergy: 'Kick energy', snareEnergy: 'Snare energy', hihatEnergy: 'Hi-hat energy',
    // Song position
    songPosition: 'Song position (0→1)', songTime: 'Song time (seconds)',
    // Video
    brightness: 'Brightness', motion: 'Motion', edgeDensity: 'Edge density',
    // Engine
    iTime: 'Time', iBeat: 'Beat', iMouseX: 'Mouse X', iMouseY: 'Mouse Y',
    // LFO inline
    'lfo-1': 'LFO 1', 'lfo-2': 'LFO 2', 'lfo-3': 'LFO 3', 'lfo-4': 'LFO 4',
  };

  const SOURCE_COLORS = {
    bass: '#ff6b6b', mid: '#ffd700', treble: '#00d4aa', volume: '#7c6af7', rms: '#ff9f43',
    spectralCentroid: '#54a0ff', spectralSpread: '#5f27cd', spectralFlux: '#ff6348',
    kickEnergy: '#ff4757', snareEnergy: '#ffa502', hihatEnergy: '#2ed573',
    songPosition: '#00d4aa', songTime: '#00d4aa',
    brightness: '#ffd700', motion: '#ff6b6b', edgeDensity: '#a78bfa',
    iTime: '#00d4aa', iBeat: '#ffffff', iMouseX: '#7c6af7', iMouseY: '#7c6af7',
    'lfo-1': '#ff9f43', 'lfo-2': '#ee5a24', 'lfo-3': '#0652dd', 'lfo-4': '#9980FA',
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
    { id: 'opacity',       label: 'Opacity'       },
    { id: 'clipShape.w',   label: 'Clip width'    },
    { id: 'clipShape.h',   label: 'Clip height'   },
  ];

  // Module-level clipboard — persists across layer selections within a session
  let _routeClipboard = null;   // null | Array<route toJSON objects>

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

    // Button group: Copy · Paste · Add
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;align-items:center';

    // Copy routes
    const copyBtn = document.createElement('button');
    copyBtn.style.cssText = 'background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:2px 7px;cursor:pointer';
    copyBtn.textContent   = '⎘ Copy';
    copyBtn.title         = 'Copy all routes from this layer to clipboard';
    copyBtn.addEventListener('click', () => {
      if (!layer.modMatrix.routes.length) {
        Toast.warn('No routes to copy'); return;
      }
      _routeClipboard = layer.modMatrix.routes.map(r => r.toJSON());
      Toast.success(`Copied ${_routeClipboard.length} route${_routeClipboard.length !== 1 ? 's' : ''}`);
      pasteBtn.disabled = false;
      pasteBtn.style.opacity = '1';
    });
    btnGroup.appendChild(copyBtn);

    // Paste routes
    const pasteBtn = document.createElement('button');
    const hasClip  = _routeClipboard && _routeClipboard.length > 0;
    pasteBtn.style.cssText = `background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:2px 7px;cursor:pointer;opacity:${hasClip ? '1' : '0.35'}`;
    pasteBtn.textContent   = '⎘ Paste';
    pasteBtn.title         = 'Paste copied routes onto this layer (appends, does not replace)';
    pasteBtn.disabled      = !hasClip;
    pasteBtn.addEventListener('click', () => {
      if (!_routeClipboard?.length) return;
      _routeClipboard.forEach(def => {
        // Deep-clone and assign a fresh id so routes are independent
        layer.modMatrix.addRoute({ ...def });
      });
      modCountSpan.textContent = `Modulation (${layer.modMatrix.routes.length})`;
      _renderRoutes(layer, routeList);
      Toast.success(`Pasted ${_routeClipboard.length} route${_routeClipboard.length !== 1 ? 's' : ''}`);
    });
    btnGroup.appendChild(pasteBtn);

    // Add route
    const addRouteBtn = document.createElement('button');
    addRouteBtn.style.cssText = 'background:none;border:1px solid var(--accent2);border-radius:3px;color:var(--accent2);font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer';
    addRouteBtn.textContent   = '+ Add route';
    btnGroup.appendChild(addRouteBtn);

    headerRow.appendChild(btnGroup);
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

    const SHAPES = ['sine','triangle','square','sawtooth','random'];
    const DIVS   = ['1/32','1/16','1/8','1/4','1/2','1','2','4'];
    const CURVES = typeof ModMatrix !== 'undefined' && ModMatrix.CURVES
      ? ModMatrix.CURVES
      : [
          { id: 'linear', label: 'Linear' }, { id: 'exponential', label: 'Exponential' },
          { id: 'logarithmic', label: 'Logarithmic' }, { id: 'scurve', label: 'S-curve' },
          { id: 'step', label: 'Step' }, { id: 'inverted', label: 'Inverted' },
        ];

    // Track which routes are expanded (persist across re-renders via route.id)
    if (!_renderRoutes._expanded) _renderRoutes._expanded = new Set();
    const expanded = _renderRoutes._expanded;

    layer.modMatrix.routes.forEach(route => {
      const paramManifest = layer.constructor?.manifest?.params?.find(p => p.id === route.target);
      const transformDef  = TRANSFORM_TARGETS.find(t => t.id === route.target);
      const layerDef      = LAYER_TARGETS.find(t => t.id === route.target);
      const targetName    = paramManifest?.label || transformDef?.label || layerDef?.label || route.target;
      const sourceName    = SOURCE_LABELS[route.source] || route.source;
      const color         = SOURCE_COLORS[route.source] || '#00d4aa';
      const isOpen        = expanded.has(route.id);
      const depthSign     = route.depth < 0 ? '−' : '+';
      const depthAbs      = Math.abs(route.depth).toFixed(2);
      const depthColor    = route.depth < 0 ? '#ff9070' : color;

      // ── Card wrapper ─────────────────────────────────────────
      const card = document.createElement('div');
      card.style.cssText = `
        background:var(--bg-card);border:1px solid var(--border-dim);
        border-left:3px solid ${color};border-radius:5px;
        margin-bottom:5px;overflow:hidden;
      `;

      // ── Collapsed header row ─────────────────────────────────
      const header = document.createElement('div');
      header.style.cssText = `
        display:flex;align-items:center;gap:6px;padding:7px 10px;
        cursor:pointer;user-select:none;
      `;
      header.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;font-weight:600;color:${color};flex-shrink:0">${sourceName}</span>
        <span style="font-size:9px;color:var(--text-dim)">→</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${targetName}</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:${depthColor};flex-shrink:0">${depthSign}${depthAbs}</span>
        <span class="route-arrow" style="font-size:9px;color:var(--text-dim);transition:transform 0.15s;transform:${isOpen?'rotate(90deg)':'rotate(0deg)'};flex-shrink:0">▶</span>
        <button class="mod-del" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;padding:0 2px;flex-shrink:0">✕</button>
      `;

      // ── Expanded body ────────────────────────────────────────
      const body = document.createElement('div');
      body.style.cssText = `display:${isOpen?'block':'none'};padding:10px 12px;border-top:1px solid var(--border-dim);background:var(--bg)`;

      // Target selector
      const allTargets = [
        ...(layer.constructor?.manifest?.params || []).filter(p => p.type === 'float' || p.type === 'int').map(p => ({ id: p.id, label: p.label })),
        ...TRANSFORM_TARGETS,
        ...LAYER_TARGETS,
      ];
      const tgtRow = document.createElement('div');
      tgtRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      tgtRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:44px">Target</span>
        <select class="mod-target" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
          ${allTargets.map(t => `<option value="${t.id}" ${t.id===route.target?'selected':''}>${t.label}</option>`).join('')}
        </select>
      `;
      body.appendChild(tgtRow);

      // Source selector
      const srcOpts = SOURCE_GROUPS.map(g =>
        `<optgroup label="${g.group}">${g.ids.map(id=>`<option value="${id}" ${id===route.source?'selected':''}>${SOURCE_LABELS[id]||id}</option>`).join('')}</optgroup>`
      ).join('');
      const srcRow = document.createElement('div');
      srcRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      srcRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:44px">Source</span>
        <select class="mod-source" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
          ${srcOpts}
        </select>
      `;
      body.appendChild(srcRow);

      // Depth slider
      const depthRow = document.createElement('div');
      depthRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      depthRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:44px">Depth</span>
        <input type="range" class="mod-depth" min="-2" max="2" step="0.05" value="${route.depth}"
          style="flex:1;accent-color:${depthColor}" title="-2 to +2, negative inverts">
        <span class="mod-depth-val" style="font-family:var(--font-mono);font-size:9px;color:${depthColor};min-width:36px;text-align:right">${depthSign}${depthAbs}</span>
      `;
      body.appendChild(depthRow);

      // Link X+Y — only shown for scale targets
      const isScaleTarget = route.target === 'transform.scaleX' || route.target === 'transform.scaleY';
      if (isScaleTarget) {
        const linkRow = document.createElement('div');
        linkRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
        const linkLabel = document.createElement('label');
        linkLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--font-mono);font-size:8px;color:var(--text-muted)';
        const linkChk = document.createElement('input');
        linkChk.type    = 'checkbox';
        linkChk.checked = !!route.linked;
        linkChk.style.cssText = 'accent-color:var(--accent)';
        linkChk.addEventListener('change', () => { route.linked = linkChk.checked; });
        linkLabel.append(linkChk, 'Link X + Y (uniform scale)');
        linkRow.appendChild(linkLabel);
        body.appendChild(linkRow);
      }

      // Curve + lag row
      const curveRow = document.createElement('div');
      curveRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      curveRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:44px">Curve</span>
        <select class="mod-curve" style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
          ${CURVES.map(c=>`<option value="${c.id}" ${(route.curve||'linear')===c.id?'selected':''}>${c.label}</option>`).join('')}
        </select>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-left:8px;flex-shrink:0">Lag</span>
        <input type="range" class="mod-smooth" min="0.01" max="1" step="0.01" value="${route.smooth}"
          style="width:60px;accent-color:var(--accent2)" title="Response lag: 0.01=slow, 1=instant">
      `;
      body.appendChild(curveRow);

      // LFO controls (shown when source is lfo-*)
      if (!route.lfoState) route.lfoState = { shape: 'sine', syncToBpm: true, division: '1/4', rate: 1.0, _phase: 0 };
      const lfoWrap = document.createElement('div');
      lfoWrap.style.cssText = `display:${route.source?.startsWith('lfo-')?'block':'none'};padding:8px;background:rgba(255,159,67,0.08);border:1px solid rgba(255,159,67,0.25);border-radius:4px;margin-top:4px`;
      const ls = route.lfoState;

      // LFO shape buttons
      const lfoShapeRow = document.createElement('div');
      lfoShapeRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';
      const lfoLabel = document.createElement('span');
      lfoLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:44px;line-height:28px';
      lfoLabel.textContent = 'Shape';
      lfoShapeRow.appendChild(lfoLabel);
      const shapeGroup = document.createElement('div');
      shapeGroup.style.cssText = 'display:flex;gap:3px;flex:1';
      SHAPES.forEach(s => {
        const b = document.createElement('button');
        const active = ls.shape === s;
        b.style.cssText = `flex:1;background:${active?'#ff9f43':'none'};border:1px solid ${active?'#ff9f43':'var(--border-dim)'};border-radius:3px;color:${active?'var(--bg)':'var(--text-dim)'};font-family:var(--font-mono);font-size:8px;padding:4px 2px;cursor:pointer`;
        b.textContent = s[0].toUpperCase() + s.slice(1);
        b.addEventListener('click', () => {
          ls.shape = s;
          shapeGroup.querySelectorAll('button').forEach((btn, i) => {
            const a = SHAPES[i] === s;
            btn.style.background  = a ? '#ff9f43' : 'none';
            btn.style.borderColor = a ? '#ff9f43' : 'var(--border-dim)';
            btn.style.color       = a ? 'var(--bg)' : 'var(--text-dim)';
          });
        });
        shapeGroup.appendChild(b);
      });
      lfoShapeRow.appendChild(shapeGroup);
      lfoWrap.appendChild(lfoShapeRow);

      // LFO rate row
      const lfoRateRow = document.createElement('div');
      lfoRateRow.style.cssText = 'display:flex;align-items:center;gap:8px';
      const syncLabel2 = document.createElement('label');
      syncLabel2.style.cssText = 'display:flex;align-items:center;gap:4px;font-family:var(--font-mono);font-size:8px;color:var(--text-dim);cursor:pointer;flex-shrink:0';
      const syncChk = document.createElement('input');
      syncChk.type = 'checkbox'; syncChk.checked = ls.syncToBpm;
      syncChk.style.cssText = 'accent-color:#ff9f43';
      syncLabel2.append(syncChk, 'BPM sync');
      lfoRateRow.appendChild(syncLabel2);

      const divSel2 = document.createElement('select');
      divSel2.style.cssText = `flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px;display:${ls.syncToBpm?'block':'none'}`;
      DIVS.forEach(d => {
        const o = document.createElement('option');
        o.value = d;
        o.textContent = d === '1/4' ? '1/4 (1 beat)' : d === '1' ? '1 bar (4 beats)' : d === '1/2' ? '1/2 (2 beats)' : d;
        o.selected = d === (ls.division || '1/4');
        divSel2.appendChild(o);
      });
      divSel2.addEventListener('change', () => { ls.division = divSel2.value; ls.rate = LFO.divisionToBeats(divSel2.value); });
      lfoRateRow.appendChild(divSel2);

      const rateIn2 = document.createElement('input');
      rateIn2.type = 'number'; rateIn2.value = ls.rate || 1; rateIn2.min = 0.01; rateIn2.max = 32; rateIn2.step = 0.1;
      rateIn2.style.cssText = `width:70px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px;display:${ls.syncToBpm?'none':'block'}`;
      const rateHz = document.createElement('span');
      rateHz.style.cssText = `font-family:var(--font-mono);font-size:8px;color:var(--text-dim);display:${ls.syncToBpm?'none':'inline'}`;
      rateHz.textContent = 'Hz';
      rateIn2.addEventListener('input', () => { ls.rate = parseFloat(rateIn2.value) || 1; });
      lfoRateRow.append(rateIn2, rateHz);

      syncChk.addEventListener('change', () => {
        ls.syncToBpm = syncChk.checked;
        divSel2.style.display = ls.syncToBpm ? 'block' : 'none';
        rateIn2.style.display = rateHz.style.display = ls.syncToBpm ? 'none' : 'block';
        if (ls.syncToBpm) ls.rate = LFO.divisionToBeats(ls.division || '1/4');
      });
      lfoWrap.appendChild(lfoRateRow);
      body.appendChild(lfoWrap);

      // ── Wire events ──────────────────────────────────────────
      header.querySelector('.mod-del').addEventListener('click', e => {
        e.stopPropagation();
        expanded.delete(route.id);
        layer.modMatrix.removeRoute(route.id);
        _renderRoutes(layer, container);
      });

      header.addEventListener('click', e => {
        if (e.target.classList.contains('mod-del')) return;
        if (expanded.has(route.id)) {
          expanded.delete(route.id);
          body.style.display = 'none';
          header.querySelector('.route-arrow').style.transform = 'rotate(0deg)';
        } else {
          expanded.add(route.id);
          body.style.display = 'block';
          header.querySelector('.route-arrow').style.transform = 'rotate(90deg)';
        }
      });

      body.querySelector('.mod-target').addEventListener('change', e => {
        route.target = e.target.value;
        // Update header summary
        const newTarget = allTargets.find(t => t.id === e.target.value)?.label || e.target.value;
        header.querySelectorAll('span')[2].textContent = newTarget;
      });

      body.querySelector('.mod-source').addEventListener('change', e => {
        route.source = e.target.value;
        const newColor = SOURCE_COLORS[route.source] || '#00d4aa';
        const newName  = SOURCE_LABELS[route.source] || route.source;
        card.style.borderLeftColor = newColor;
        header.querySelectorAll('span')[0].style.color = newColor;
        header.querySelectorAll('span')[0].textContent = newName;
        lfoWrap.style.display = route.source.startsWith('lfo-') ? 'block' : 'none';
      });

      const depthSlider = body.querySelector('.mod-depth');
      const depthValEl  = body.querySelector('.mod-depth-val');
      depthSlider.addEventListener('input', () => {
        const v = parseFloat(depthSlider.value);
        route.depth = v;
        const sign = v < 0 ? '−' : '+';
        const abs  = Math.abs(v).toFixed(2);
        const col  = v < 0 ? '#ff9070' : (SOURCE_COLORS[route.source] || '#00d4aa');
        depthValEl.textContent = `${sign}${abs}`;
        depthValEl.style.color = col;
        header.querySelectorAll('span')[3].textContent = `${sign}${abs}`;
        header.querySelectorAll('span')[3].style.color = col;
      });

      body.querySelector('.mod-curve').addEventListener('change', e => { route.curve = e.target.value; });
      body.querySelector('.mod-smooth').addEventListener('input', e => { route.smooth = parseFloat(e.target.value); });

      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);
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

      <div style="margin-bottom:10px">
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">
          Curve shape
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${(typeof ModMatrix !== 'undefined' && ModMatrix.CURVES ? ModMatrix.CURVES : [
            { id:'linear',label:'Linear'}, { id:'exponential',label:'Exponential'},
            { id:'logarithmic',label:'Logarithmic'}, { id:'scurve',label:'S-curve'},
            { id:'step',label:'Step 50%'}, { id:'step25',label:'Step 25%'},
            { id:'inverted',label:'Inverted'},
          ]).map(c => `
            <label style="display:flex;align-items:center;gap:3px;cursor:pointer;
                          font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">
              <input type="radio" name="mod-curve" value="${c.id}"
                ${c.id === 'linear' ? 'checked' : ''}
                style="accent-color:var(--accent)" />
              ${c.label}
            </label>`).join('')}
        </div>
      </div>

      <div id="mod-link-row" style="display:none;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">
          <input type="checkbox" id="mod-link" style="accent-color:var(--accent)" />
          Link X + Y (uniform scale)
        </label>
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

    // Show/hide link checkbox based on target selection
    const targetSel = form.querySelector('#mod-target');
    const linkRow   = form.querySelector('#mod-link-row');
    const _updateLinkRow = () => {
      const t = targetSel?.value;
      linkRow.style.display = (t === 'transform.scaleX' || t === 'transform.scaleY') ? 'block' : 'none';
    };
    targetSel?.addEventListener('change', _updateLinkRow);
    _updateLinkRow();

    form.querySelector('#mod-confirm')?.addEventListener('click', () => {
      const source = form.querySelector('#mod-source')?.value;
      const target = form.querySelector('#mod-target')?.value;
      const depth  = parseFloat(form.querySelector('#mod-depth-sl')?.value) || 0.5;
      const smooth = parseFloat(form.querySelector('#mod-smooth-sl')?.value) || 0.1;
      const curve  = form.querySelector('input[name="mod-curve"]:checked')?.value || 'linear';
      const linked = !!(form.querySelector('#mod-link')?.checked);
      if (!source || !target) return;

      layer.modMatrix.addRoute({ source, target, depth, smooth, curve, linked });
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
