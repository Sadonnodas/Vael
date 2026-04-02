/**
 * ui/LFOPanel.js
 *
 * CHANGES:
 * - Each LFO card now has an Edit button that expands an inline form
 *   pre-filled with current values. Changes apply live on "Update".
 * - Special targets: Opacity, Position X/Y, Scale X/Y, Rotation.
 *   These are grouped separately from layer params in the target dropdown.
 * - Param dropdown filters to float/int types only (unchanged).
 */

const LFOPanel = (() => {

  let _lfoManager = null;
  let _layerStack = null;
  let _container  = null;

  const SHAPES = ['sine', 'triangle', 'square', 'saw', 'random'];

  // Special targets that write to layer properties outside layer.params
  const SPECIAL_TARGETS = [
    { id: 'opacity',            label: 'Opacity',     min: 0,    max: 1,    group: 'Layer'     },
    { id: 'transform.x',        label: 'Position X',  min: -500, max: 500,  group: 'Transform' },
    { id: 'transform.y',        label: 'Position Y',  min: -500, max: 500,  group: 'Transform' },
    { id: 'transform.scaleX',   label: 'Scale X',     min: 0.1,  max: 4,    group: 'Transform' },
    { id: 'transform.scaleY',   label: 'Scale Y',     min: 0.1,  max: 4,    group: 'Transform' },
    { id: 'transform.rotation', label: 'Rotation',    min: -180, max: 180,  group: 'Transform' },
  ];

  const WAVE_ICONS = { sine: '∿', triangle: '⋀', square: '⊓', saw: '⟋', random: '≈' };

  function init(lfoManager, layerStack, container) {
    _lfoManager = lfoManager;
    _layerStack = layerStack;
    _container  = container;
    _render();
  }

  function refresh() { _render(); }

  // ── Main render ───────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:14px';
    intro.textContent   = 'LFOs animate layer parameters automatically over time, independent of audio.';
    _container.appendChild(intro);

    // Active LFOs
    if (_lfoManager.lfos.length > 0) {
      const label = document.createElement('div');
      label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px';
      label.textContent   = `Active (${_lfoManager.lfos.length})`;
      _container.appendChild(label);

      _lfoManager.lfos.forEach(lfo => _renderLFOCard(lfo));

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

    const layers = _layerStack?.layers || [];
    if (layers.length === 0) {
      const msg = document.createElement('p');
      msg.style.cssText = 'font-size:10px;color:var(--text-dim);text-align:center;padding:12px 0';
      msg.textContent   = 'Add some layers first.';
      _container.appendChild(msg);
      return;
    }

    _container.appendChild(_buildForm(null));
  }

  // ── LFO card (collapsed + expandable edit) ────────────────────

  function _renderLFOCard(lfo) {
    const layer = _layerStack.layers.find(l => l.id === lfo.layerId);
    const targetLabel = _targetLabel(layer, lfo.paramId);

    const card = document.createElement('div');
    card.style.cssText = `
      background: var(--bg-card);
      border: 1px solid var(--border-dim);
      border-radius: 5px;
      padding: 8px 10px;
      margin-bottom: 6px;
    `;

    // ── Collapsed header row ──────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px';

    header.innerHTML = `
      <span style="font-size:14px;color:var(--accent2);flex-shrink:0">${WAVE_ICONS[lfo.shape] || '∿'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${layer?.name ?? lfo.layerId} · ${targetLabel}
        </div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
          ${lfo.shape} · ${lfo.syncToBpm ? (lfo.division || '1/4') + ' bar' : lfo.rate + ' Hz'} · depth ${lfo.depth.toFixed(2)}
        </div>
      </div>
    `;

    const editBtn = document.createElement('button');
    editBtn.style.cssText = 'background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);cursor:pointer;font-family:var(--font-mono);font-size:8px;padding:2px 6px;flex-shrink:0';
    editBtn.textContent = 'Edit';

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:none;border:none;color:#454560;cursor:pointer;font-size:11px;flex-shrink:0';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { _lfoManager.remove(lfo.id); _render(); });

    header.appendChild(editBtn);
    header.appendChild(delBtn);
    card.appendChild(header);

    // ── Expandable edit form ──────────────────────────────────
    const editPanel = document.createElement('div');
    editPanel.style.cssText = 'display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-dim)';

    let isOpen = false;
    editBtn.addEventListener('click', () => {
      isOpen = !isOpen;
      editPanel.style.display = isOpen ? 'block' : 'none';
      editBtn.textContent = isOpen ? 'Close' : 'Edit';
      editBtn.style.color = isOpen ? 'var(--accent)' : 'var(--text-dim)';
      editBtn.style.borderColor = isOpen ? 'var(--accent)' : 'var(--border-dim)';

      if (isOpen && !editPanel.hasChildNodes()) {
        editPanel.appendChild(_buildForm(lfo, card, header));
      }
    });

    card.appendChild(editPanel);
    _container.appendChild(card);
  }

  // ── Form builder (shared by Add and Edit) ─────────────────────

  function _buildForm(existingLfo, card, header) {
    const isEdit = !!existingLfo;
    const wrap   = document.createElement('div');
    const layers = _layerStack?.layers || [];

    // IDs are unique per form to avoid conflicts when multiple edit panels are open
    const uid = existingLfo?.id ?? `new-${Date.now()}`;
    const idLayer   = `lfo-layer-${uid}`;
    const idParam   = `lfo-param-${uid}`;
    const idShape   = `lfo-shape-${uid}`;
    const idRate    = `lfo-rate-${uid}`;
    const idSync    = `lfo-sync-${uid}`;
    const idDiv     = `lfo-div-${uid}`;
    const idDepth   = `lfo-depth-${uid}`;
    const idOffset  = `lfo-offset-${uid}`;
    const idBipolar = `lfo-bipolar-${uid}`;

    const sel = (id, inner, value) => `
      <select id="${id}" style="width:100%;background:var(--bg);border:1px solid var(--border);
        border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
        ${inner}
      </select>`;

    // Layer dropdown
    const layerOptions = layers.map(l =>
      `<option value="${l.id}" ${isEdit && l.id === existingLfo.layerId ? 'selected' : ''}>
        ${l.name} (${l.constructor.name.replace('Layer','').replace('Visualizer','Viz')})
      </option>`
    ).join('');

    wrap.appendChild(_row('Layer', sel(idLayer, layerOptions)));

    // Target dropdown (special + params)
    const paramRow = _row('Target', `<select id="${idParam}" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px"></select>`);
    wrap.appendChild(paramRow);

    // Shape
    const shapeOptions = SHAPES.map(s =>
      `<option value="${s}" ${isEdit && s === existingLfo.shape ? 'selected' : ''}>${s}</option>`
    ).join('');
    wrap.appendChild(_row('Shape', sel(idShape, shapeOptions)));

    // Rate / Division
    const DIVISIONS = ['1/32','1/16','1/8','1/4','1/2','1','2','4'];
    const currentDiv  = isEdit ? (existingLfo.division || '1/4') : '1/4';
    const divOptions  = DIVISIONS.map(d => `<option value="${d}" ${d === currentDiv ? 'selected' : ''}>${d} bar${d === '1' ? '' : 's'.replace('1s','')}</option>`).join('');
    const isSynced    = isEdit ? (existingLfo.syncToBpm || false) : false;

    wrap.appendChild(_row('Rate', `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="${idRate}" value="${isEdit ? existingLfo.rate : 0.25}" min="0.01" max="32" step="0.05"
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                   color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px;
                   display:${isSynced ? 'none' : 'block'}" />
          <select id="${idDiv}"
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                   color:var(--accent2);font-family:var(--font-mono);font-size:10px;padding:5px 8px;
                   display:${isSynced ? 'block' : 'none'}">
            ${divOptions}
          </select>
          <label style="display:flex;align-items:center;gap:4px;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);white-space:nowrap;cursor:pointer">
            <input type="checkbox" id="${idSync}" ${isSynced ? 'checked' : ''} /> BPM sync
          </label>
        </div>
        <div id="${idDiv}-hint" style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);display:${isSynced ? 'block' : 'none'}">
          Phase resets on each downbeat
        </div>
      </div>
    `));

    // Depth
    const depthVal = isEdit ? existingLfo.depth.toFixed(2) : '0.50';
    wrap.appendChild(_row('Depth', `
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" id="${idDepth}" min="0" max="1" step="0.01" value="${depthVal}"
          style="flex:1;accent-color:var(--accent2)" />
        <span id="${idDepth}-val" style="font-family:var(--font-mono);font-size:9px;color:var(--accent2);width:28px;text-align:right">${depthVal}</span>
      </div>
    `));

    // Bipolar toggle — must come before offset so offset range can react to it
    const isBipolarDefault = isEdit ? (existingLfo.bipolar ?? false) : false;
    wrap.appendChild(_row('Bipolar', `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
        <input type="checkbox" id="${idBipolar}" ${isBipolarDefault ? 'checked' : ''} />
        Output range: <span id="${idBipolar}-label">${isBipolarDefault ? '−1 to +1' : '0 to 1'}</span>
      </label>
    `));

    // Offset — centre point. Range 0..1 for unipolar, -1..1 for bipolar.
    const offsetVal = isEdit ? existingLfo.offset.toFixed(2) : (isBipolarDefault ? '0.00' : '0.50');
    const offMin    = isBipolarDefault ? -1 : 0;
    wrap.appendChild(_row('Centre', `
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" id="${idOffset}" min="${offMin}" max="1" step="0.01" value="${offsetVal}"
          style="flex:1;accent-color:var(--accent)" />
        <span id="${idOffset}-val" style="font-family:var(--font-mono);font-size:9px;color:var(--accent);width:36px;text-align:right">${offsetVal}</span>
      </div>
    `));

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.className   = 'btn accent';
    submitBtn.style.cssText = 'width:100%;margin-top:8px';
    submitBtn.textContent = isEdit ? 'Update LFO' : '+ Add LFO';
    wrap.appendChild(submitBtn);

    // ── Wire up ───────────────────────────────────────────────

    const getEl = id => wrap.querySelector(`#${id}`) ?? document.getElementById(id);

    const updateTargetDropdown = () => {
      const layerId = getEl(idLayer)?.value;
      const layer   = _layerStack.layers.find(l => l.id === layerId);
      const sel     = getEl(idParam);
      if (!sel) return;

      // Group 1: Layer-level special targets
      const layerGroup = SPECIAL_TARGETS.filter(t => t.group === 'Layer');
      // Group 2: Layer manifest params (float/int only)
      const paramTargets = (layer?.constructor?.manifest?.params ?? [])
        .filter(p => p.type === 'float' || p.type === 'int');
      // Group 3: Transform special targets
      const transformGroup = SPECIAL_TARGETS.filter(t => t.group === 'Transform');

      const cur = isEdit ? existingLfo.paramId : null;

      sel.innerHTML = [
        `<optgroup label="Layer">${layerGroup.map(t =>
          `<option value="${t.id}" ${cur === t.id ? 'selected' : ''}>${t.label}</option>`
        ).join('')}</optgroup>`,
        paramTargets.length ? `<optgroup label="Parameters">${paramTargets.map(p =>
          `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${p.label}</option>`
        ).join('')}</optgroup>` : '',
        `<optgroup label="Transform">${transformGroup.map(t =>
          `<option value="${t.id}" ${cur === t.id ? 'selected' : ''}>${t.label}</option>`
        ).join('')}</optgroup>`,
      ].join('');
    };

    // Wire layer change → refresh target dropdown
    setTimeout(() => {
      const layerEl  = getEl(idLayer);
      const depthEl  = getEl(idDepth);
      const offsetEl = getEl(idOffset);
      const depthValEl  = wrap.querySelector(`#${idDepth}-val`);
      const offsetValEl = wrap.querySelector(`#${idOffset}-val`);

      layerEl?.addEventListener('change', updateTargetDropdown);
      updateTargetDropdown();

      // Wire BPM sync toggle: show division selector OR Hz rate input
      const syncEl   = getEl(idSync);
      const rateEl   = getEl(idRate);
      const divEl    = getEl(idDiv);
      const divHint  = wrap.querySelector(`#${idDiv}-hint`);
      syncEl?.addEventListener('change', () => {
        const synced = syncEl.checked;
        if (rateEl)  rateEl.style.display  = synced ? 'none' : 'block';
        if (divEl)   divEl.style.display   = synced ? 'block' : 'none';
        if (divHint) divHint.style.display = synced ? 'block' : 'none';
      });

      // Wire bipolar toggle to update offset slider range live
      const bipolarEl  = getEl(idBipolar);
      const bipolarLbl = wrap.querySelector(`#${idBipolar}-label`);
      bipolarEl?.addEventListener('change', () => {
        const isBip = bipolarEl.checked;
        const offEl = getEl(idOffset);
        const valEl = wrap.querySelector(`#${idOffset}-val`);
        if (offEl) {
          offEl.min   = isBip ? -1 : 0;
          // Reset to sensible default when switching modes
          const newVal = isBip ? 0 : 0.5;
          offEl.value = newVal;
          if (valEl) valEl.textContent = newVal.toFixed(2);
        }
        if (bipolarLbl) bipolarLbl.textContent = isBip ? '−1 to +1' : '0 to 1';
      });

      depthEl?.addEventListener('input', () => {
        if (depthValEl) depthValEl.textContent = parseFloat(depthEl.value).toFixed(2);
      });
      offsetEl?.addEventListener('input', () => {
        if (offsetValEl) offsetValEl.textContent = parseFloat(offsetEl.value).toFixed(2);
      });

      submitBtn.addEventListener('click', () => {
        const layerId = getEl(idLayer)?.value;
        const paramId = getEl(idParam)?.value;
        if (!layerId || !paramId) { Toast.warn('Select a layer and target'); return; }

        const props = {
          layerId,
          paramId,
          shape:     getEl(idShape)?.value    || 'sine',
          rate:      parseFloat(getEl(idRate)?.value)   || 0.25,
          depth:     parseFloat(getEl(idDepth)?.value)  || 0.5,
          offset:    parseFloat(getEl(idOffset)?.value) || 0.5,
          syncToBpm: getEl(idSync)?.checked   || false,
          division:  getEl(idDiv)?.value      || '1/4',
          bipolar:   getEl(idBipolar)?.checked || false,
        };

        // When BPM-synced, derive rate from division string (beats per cycle)
        // so that '1/4' = 1 beat, '1/2' = 2 beats, '1' = 4 beats (1 bar), etc.
        if (props.syncToBpm && props.division) {
          props.rate = LFO.divisionToBeats(props.division);
        }

        if (isEdit) {
          // Apply to existing LFO in-place
          Object.assign(existingLfo, props);
          // Rebuild collapsed header
          if (header) {
            const tLabel = _targetLabel(_layerStack.layers.find(l => l.id === layerId), paramId);
            const nameDiv = header.querySelector('div > div:first-child');
            const infoDiv = header.querySelector('div > div:last-child');
            if (nameDiv) nameDiv.textContent = `${_layerStack.layers.find(l=>l.id===layerId)?.name} · ${tLabel}`;
            const rateStr = props.syncToBpm ? `${props.division} bar` : `${props.rate} Hz`;
            if (infoDiv) infoDiv.textContent = `${props.shape} · ${rateStr} · depth ${props.depth.toFixed(2)}`;
          }
          Toast.success('LFO updated');
        } else {
          _lfoManager.add(new LFO(props));
          Toast.success(`LFO added: ${paramId}`);
          _render();
        }
      });
    }, 0);

    return wrap;
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _targetLabel(layer, paramId) {
    const special = SPECIAL_TARGETS.find(t => t.id === paramId);
    if (special) return special.label;
    const manifest = layer?.constructor?.manifest?.params?.find(p => p.id === paramId);
    return manifest?.label || paramId;
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

  /**
   * Open the LFO tab and pre-fill the add-form for a specific layer+param.
   * Called from the ∿ button in ParamPanel's buildSlider.
   */
  function openQuickAdd(layer, paramId, paramLabel) {
    // Switch to LFO tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const lfoBtn   = document.querySelector('[data-tab="lfo"]');
    const lfoPanel = document.getElementById('tab-lfo');
    lfoBtn?.classList.add('active');
    lfoPanel?.classList.add('active');

    // Scroll to add form
    setTimeout(() => {
      if (!_container) return;

      // Remove any existing quick-add form
      _container.querySelector('#lfo-quickadd-form')?.remove();

      const formWrap = document.createElement('div');
      formWrap.id = 'lfo-quickadd-form';
      formWrap.style.cssText = `
        background:var(--bg-card);border:1px solid var(--accent2);
        border-radius:6px;padding:12px;margin-bottom:10px;
      `;

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';
      header.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--accent2)">
          Quick LFO → ${layer.name} · ${paramLabel || paramId}
        </span>
        <button id="lfo-qa-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:12px">✕</button>
      `;
      formWrap.appendChild(header);

      // Shape selector
      const SHAPES = ['sine','triangle','square','sawtooth','random'];
      const shapeRow = document.createElement('div');
      shapeRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';
      let selectedShape = 'sine';
      SHAPES.forEach(s => {
        const b = document.createElement('button');
        b.style.cssText = `flex:1;background:${s==='sine'?'var(--accent2)':'none'};
          border:1px solid ${s==='sine'?'var(--accent2)':'var(--border-dim)'};
          border-radius:3px;color:${s==='sine'?'var(--bg)':'var(--text-dim)'};
          font-family:var(--font-mono);font-size:8px;padding:4px 2px;cursor:pointer`;
        b.textContent = s;
        b.addEventListener('click', () => {
          selectedShape = s;
          shapeRow.querySelectorAll('button').forEach(btn => {
            const active = btn.textContent === s;
            btn.style.background  = active ? 'var(--accent2)' : 'none';
            btn.style.borderColor = active ? 'var(--accent2)' : 'var(--border-dim)';
            btn.style.color       = active ? 'var(--bg)' : 'var(--text-dim)';
          });
        });
        shapeRow.appendChild(b);
      });
      formWrap.appendChild(shapeRow);

      // Rate + depth row
      const controlRow = document.createElement('div');
      controlRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px';

      const makeField = (label, value, min, max, step) => {
        const d = document.createElement('div');
        d.innerHTML = `
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:3px">${label}</div>
          <input type="number" value="${value}" min="${min}" max="${max}" step="${step}"
            style="width:100%;background:var(--bg);border:1px solid var(--border-dim);
                   border-radius:3px;color:var(--text);font-family:var(--font-mono);
                   font-size:10px;padding:4px 6px">
        `;
        return d;
      };
      const rateField  = makeField('Rate (Hz)', '0.5', '0.01', '32', '0.1');
      const depthField = makeField('Depth', '0.5', '-2', '2', '0.05');
      controlRow.append(rateField, depthField);
      formWrap.appendChild(controlRow);

      // BPM sync toggle
      const syncRow = document.createElement('label');
      syncRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px';
      syncRow.innerHTML = `<input type="checkbox" id="qa-bpm-sync" style="accent-color:var(--accent2)"> BPM sync (¼ note)`;
      formWrap.appendChild(syncRow);

      // Add button
      const addBtn = document.createElement('button');
      addBtn.className   = 'btn accent';
      addBtn.style.cssText = 'width:100%;font-size:9px';
      addBtn.textContent = '+ Add LFO';
      addBtn.addEventListener('click', () => {
        const rate     = parseFloat(rateField.querySelector('input').value) || 0.5;
        const depth    = parseFloat(depthField.querySelector('input').value) || 0.5;
        const syncBpm  = formWrap.querySelector('#qa-bpm-sync')?.checked || false;
        const lfoProps = {
          layerId:   layer.id,
          paramId,
          shape:     selectedShape,
          rate,
          depth,
          syncToBpm: syncBpm,
          division:  '1/4',
          offset:    0.5,
          bipolar:   false,
        };
        _lfoManager.add(new LFO(lfoProps));
        formWrap.remove();
        _render();
        Toast.success(`LFO added: ${paramLabel || paramId}`);
      });
      formWrap.appendChild(addBtn);

      // Close button
      setTimeout(() => {
        formWrap.querySelector('#lfo-qa-close')?.addEventListener('click', () => formWrap.remove());
      }, 0);

      _container.insertBefore(formWrap, _container.firstChild);
      formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  return { init, refresh, openQuickAdd };

})();
