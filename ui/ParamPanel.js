/**
 * ui/ParamPanel.js
 * Auto-generates parameter controls from a layer's static manifest.
 *
 * CHANGE: Legacy single-band audio params (audioTarget, audioAmount, audioReact)
 * are hidden from the UI. They still exist in layer code and presets so nothing
 * breaks — they're just no longer shown since ModMatrix covers this more clearly.
 * Mark any param with `legacy: true` in the manifest to hide it the same way.
 */

const ParamPanel = (() => {

  const BANDS = ['bass', 'mid', 'treble', 'volume', 'brightness', 'motion', 'hue', 'edgeDensity'];

  // Param IDs that are legacy single-band audio pickers.
  // The ModMatrix panel replaces these more clearly.
  const LEGACY_PARAM_IDS = new Set([
    'audioTarget', 'audioAmount', 'audioReact',
    'audioScale',  'audioRotate', 'audioOpac',
    'audioSize',   'audioHue',    'audioColor',
  ]);

  // ── Live value tracking ─────────────────────────────────────
  // Maps paramId → { liveBar, numInput, slider, min, max, fmt }
  // Populated by buildSlider, consumed by updateLiveValues().
  let _liveTrackers = new Map();
  let _trackedLayer = null;

  /**
   * Call this every frame (from App.js renderer.onFrame) when a layer
   * is selected, to push live modulated values into the param panel.
   */
  function updateLiveValues(layer) {
    if (!layer || layer !== _trackedLayer) return;
    _liveTrackers.forEach(({ liveBar, numInput, slider, min, max, fmt, paramId }) => {
      // Read the live value from the layer — could be modulated by ModMatrix/LFO
      let live;
      if (paramId === 'opacity') {
        live = layer.opacity;
      } else {
        live = layer.params?.[paramId];
      }
      if (live === undefined || live === null) return;

      const base    = parseFloat(slider.value);
      const range   = max - min;
      const pct     = range > 0 ? Math.max(0, Math.min(1, (live - min) / range)) : 0;
      const basePct = range > 0 ? Math.max(0, Math.min(1, (base - min) / range)) : 0;

      // Show the live bar only when the value differs meaningfully from the base
      const isDriven = Math.abs(live - base) > 0.005;
      liveBar.style.opacity = isDriven ? '1' : '0';
      liveBar.style.width   = `${pct * 100}%`;

      // Show live value in the number input when it's not focused and is driven
      if (isDriven && document.activeElement !== numInput) {
        numInput.style.color = 'var(--accent2)';
        numInput.value       = fmt(live);
      } else if (!isDriven) {
        numInput.style.color = 'var(--accent)';
        // Restore base value when not driven and not focused
        if (document.activeElement !== numInput) {
          numInput.value = fmt(base);
        }
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────

  function render(layer, container, audioEngine) {
    _liveTrackers.clear();
    _trackedLayer = layer;
    container.innerHTML = '';

    const manifest = layer.constructor.manifest;
    if (!manifest || !manifest.params || manifest.params.length === 0) {
      container.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:10px;
                    color:var(--text-dim);padding:12px 0;text-align:center">
          No parameters for this layer.
        </div>`;
      return;
    }

    // Editable layer name header
    container.appendChild(_buildNameHeader(layer, manifest.name));

    manifest.params.forEach(param => {
      // Hide legacy single-band audio pickers — ModMatrix replaces these.
      // Also hide any param explicitly marked legacy: true in the manifest.
      if (LEGACY_PARAM_IDS.has(param.id) || param.legacy === true) return;

      // showWhen: { paramId: [allowedValues] } — hide param unless condition met.
      // Example: showWhen: { mode: ['trails'] } hides the param for all other modes.
      if (param.showWhen) {
        const visible = Object.entries(param.showWhen).every(([key, allowed]) => {
          const val = layer.params?.[key];
          return Array.isArray(allowed) ? allowed.includes(val) : val === allowed;
        });
        if (!visible) return;
      }

      const current = layer.params?.[param.id] ?? param.default;
      const el = buildControl(param, current, layer);
      container.appendChild(el);
    });

    // Modulation matrix — always appended after params
    if (layer.modMatrix) {
      ModMatrixPanel.render(layer, container);
    }

    // Per-layer FX chain
    if (typeof LayerFXPanel !== 'undefined') {
      LayerFXPanel.render(layer, container);
    }
  }

  // ── Control builders ─────────────────────────────────────────

  function buildControl(param, current, layer) {
    switch (param.type) {
      case 'float':
      case 'int':          return buildSlider(param, current, layer);
      case 'enum':         return buildDropdown(param, current, layer);
      case 'bool':         return buildToggle(param, current, layer);
      case 'color':        return buildColorPicker(param, current, layer);
      case 'band':         return buildBandPicker(param, current, layer);
      case 'videolibrary': return typeof LibraryPanel !== 'undefined'
                             ? LibraryPanel.buildVideoPicker(current, layer, param.id)
                             : buildSlider(param, current, layer);
      default:             return buildSlider(param, current, layer);
    }
  }

  // Float / int slider
  function buildSlider(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';

    const isInt  = param.type === 'int';
    const step   = isInt ? 1 : (param.step || 0.01);
    const min    = param.min ?? 0;
    const max    = param.max ?? 1;
    const fmt    = v => isInt ? String(Math.round(v)) : parseFloat(v).toFixed(2);
    const clamp  = v => Math.max(min, Math.min(max, v));

    // Label row
    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:5px';

    const label = document.createElement('span');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted)';
    label.textContent   = param.label;
    labelRow.appendChild(label);

    // Number input — acts as both value display and direct type-in field
    const numInput = document.createElement('input');
    numInput.type  = 'number';
    numInput.value = fmt(current);
    numInput.min   = min;
    numInput.max   = max;
    numInput.step  = step;
    numInput.style.cssText = `
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--accent);
      background: transparent;
      border: none;
      border-bottom: 1px solid transparent;
      outline: none;
      width: 52px;
      text-align: right;
      padding: 0;
      cursor: text;
      -moz-appearance: textfield;
    `;
    // Hide browser spinner arrows (we'll use our own)
    numInput.addEventListener('focus', () => { numInput.style.borderBottomColor = 'var(--accent)'; });
    numInput.addEventListener('blur',  () => { numInput.style.borderBottomColor = 'transparent'; });
    labelRow.appendChild(numInput);
    wrap.appendChild(labelRow);

    // Range slider
    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = min;
    slider.max   = max;
    slider.step  = step;
    slider.value = current;
    slider.style.cssText = 'width:100%;accent-color:var(--accent);cursor:pointer';

    // Shared apply function
    const apply = (v) => {
      const clamped = clamp(isInt ? Math.round(v) : parseFloat(v.toFixed(10)));
      const display = fmt(clamped);
      slider.value   = clamped;
      numInput.value = display;
      if (layer.params) layer.params[param.id] = clamped;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, clamped);
      // Debounced history snapshot
      if (window._vaelHistory) window._vaelHistory.onParamChange(param.label, layer);
    };

    // Slider drives number input
    slider.addEventListener('input', () => {
      apply(parseFloat(slider.value));
    });

    // Number input drives slider — on Enter or blur
    const commitNumber = () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v)) apply(v);
      else numInput.value = fmt(clamp(current));
    };
    numInput.addEventListener('blur',    commitNumber);
    numInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); numInput.blur(); }
      if (e.key === 'Escape') { numInput.value = fmt(parseFloat(slider.value)); numInput.blur(); }
      // Arrow keys on the number input work natively for step increment
    });

    // Live modulation indicator — thin bar that tracks the actual current value
    // (which may differ from slider/base when driven by ModMatrix or LFO)
    const liveBar = document.createElement('div');
    liveBar.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      background: var(--accent2);
      border-radius: 1px;
      opacity: 0;
      transition: width 0.05s, opacity 0.2s;
      pointer-events: none;
    `;
    // Wrap slider in a relative container so the bar can be positioned under it
    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'position:relative;padding-bottom:2px';
    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(liveBar);
    wrap.appendChild(sliderWrap);

    // Register in live tracker (replaces the earlier direct wrap.appendChild(slider))
    _liveTrackers.set(param.id, { liveBar, numInput, slider, min, max, fmt, paramId: param.id });

    return wrap;
  }

  // Enum dropdown
  function buildDropdown(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';

    const options = (param.options || [])
      .map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`)
      .join('');

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
          ${param.label}
        </span>
      </div>
      <select style="
        width:100%;
        background:var(--bg);
        border:1px solid var(--border);
        border-radius:4px;
        color:var(--text);
        font-family:var(--font-mono);
        font-size:10px;
        padding:5px 8px;
        cursor:pointer;
      ">${options}</select>
    `;

    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
      // If this param controls which other params are visible, re-render the panel.
      if (param.triggersRefresh) {
        const cont = wrap.closest('[id="params-content"]');
        if (cont) render(layer, cont);
      }
    });

    return wrap;
  }

  // Boolean toggle
  function buildToggle(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;';

    wrap.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
        ${param.label}
      </span>
      <button class="toggle-btn" style="
        width: 40px; height: 20px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: ${current ? 'var(--accent)' : 'var(--bg)'};
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
      ">
        <span style="
          position:absolute; top:2px;
          left:${current ? '20px' : '2px'};
          width:14px; height:14px;
          border-radius:50%;
          background:${current ? 'var(--bg)' : 'var(--text-dim)'};
          transition: left 0.2s;
        "></span>
      </button>
    `;

    let state = !!current;
    const btn  = wrap.querySelector('.toggle-btn');
    const knob = btn.querySelector('span');

    btn.addEventListener('click', () => {
      state = !state;
      btn.style.background  = state ? 'var(--accent)' : 'var(--bg)';
      knob.style.left       = state ? '20px' : '2px';
      knob.style.background = state ? 'var(--bg)' : 'var(--text-dim)';
      if (layer.params) layer.params[param.id] = state;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, state);
      // If this bool controls showWhen visibility of other params, re-render
      if (param.triggersRefresh) {
        const cont = wrap.closest('[id="params-content"]');
        if (cont) render(layer, cont);
      }
    });

    return wrap;
  }

  // Colour picker
  function buildColorPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;';

    const safeColor = (current && /^#[0-9a-fA-F]{3,6}$/.test(current)) ? current : '#00d4aa';

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" class="cp-swatch" value="${safeColor}" style="
          width:36px;height:28px;padding:2px;flex-shrink:0;
          border:1px solid var(--border);border-radius:4px;
          background:var(--bg);cursor:pointer;
        " />
        <input type="text" class="cp-hex" value="${safeColor}" maxlength="7"
          placeholder="#rrggbb"
          style="flex:1;background:var(--bg);border:1px solid var(--border);
                 border-radius:4px;color:var(--text);font-family:var(--font-mono);
                 font-size:10px;padding:4px 8px;letter-spacing:1px;" />
      </div>
    `;

    const swatch = wrap.querySelector('.cp-swatch');
    const hexIn  = wrap.querySelector('.cp-hex');

    const applyColor = (val) => {
      if (layer.params) layer.params[param.id] = val;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, val);
    };

    swatch.addEventListener('input', e => {
      hexIn.value = e.target.value;
      applyColor(e.target.value);
    });

    hexIn.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) {
        swatch.value = v;
        applyColor(v);
        hexIn.style.borderColor = 'var(--border)';
      } else {
        hexIn.style.borderColor = '#ff4444';
      }
    });

    hexIn.addEventListener('blur', e => {
      const v = e.target.value.trim();
      if (!v.startsWith('#')) { hexIn.value = '#' + v; }
    });

    return wrap;
  }

  // Audio band picker
  function buildBandPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;';

    const options = BANDS
      .map(b => `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`)
      .join('');

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
          ${param.label}
        </span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">audio</span>
      </div>
      <select style="
        width:100%;
        background: color-mix(in srgb, var(--accent2) 10%, var(--bg));
        border:1px solid color-mix(in srgb, var(--accent2) 40%, transparent);
        border-radius:4px;
        color:var(--accent2);
        font-family:var(--font-mono);
        font-size:10px;
        padding:5px 8px;
        cursor:pointer;
      ">${options}</select>
    `;

    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
      // If this param controls which other params are visible, re-render the panel.
      if (param.triggersRefresh) {
        const cont = wrap.closest('[id="params-content"]');
        if (cont) render(layer, cont);
      }
    });

    return wrap;
  }

  // ── Editable name header ─────────────────────────────────────
  //
  // Renders the layer's user-defined name as a click-to-edit field.
  // Shown at the top of every params panel so the user can rename
  // without needing to double-click in the layer list (which is hard
  // because single-click already navigates to params).
  //
  // @param {BaseLayer} layer
  // @param {string}    typeName  — shown as a subtitle (e.g. "Gradient")
  // @returns {HTMLElement}

  function _buildNameHeader(layer, typeName) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:16px';

    // Subtitle — layer type, small and muted
    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px';
    sub.textContent   = typeName || '';
    wrap.appendChild(sub);

    // Name display — click to edit
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent);
      letter-spacing: 1px;
      cursor: text;
      padding: 2px 0;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    nameEl.textContent = layer.name;
    nameEl.title       = 'Click to rename';
    wrap.appendChild(nameEl);

    // Hint shown on hover
    nameEl.addEventListener('mouseenter', () => {
      nameEl.style.borderBottomColor = 'var(--accent)';
    });
    nameEl.addEventListener('mouseleave', () => {
      nameEl.style.borderBottomColor = 'transparent';
    });

    // Click → replace with input
    nameEl.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type  = 'text';
      input.value = layer.name;
      input.style.cssText = `
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--accent);
        letter-spacing: 1px;
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--accent);
        outline: none;
        width: 100%;
        padding: 2px 0;
      `;

      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName   = input.value.trim() || layer.name;
        layer.name      = newName;
        nameEl.textContent = newName;
        input.replaceWith(nameEl);
        // Also update the layer list row without a full re-render
        const rowNameEl = document.querySelector(`.layer-name-btn[data-id="${layer.id}"]`)
          || [...document.querySelectorAll('.layer-name-btn')]
               .find(el => el.closest('[data-id]')?.dataset.id === layer.id);
        if (rowNameEl) rowNameEl.textContent = newName;
        // Full list re-render to sync everything
        if (typeof LayerPanel !== 'undefined') LayerPanel.renderLayerList();
        Toast.info(`Renamed to "${newName}"`);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = layer.name; input.blur(); }
      });
    });

    // Reset to defaults button
    const resetRow = document.createElement('div');
    resetRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:6px';
    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = `
      background: none;
      border: 1px solid var(--border-dim);
      border-radius: 3px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: 8px;
      padding: 2px 7px;
      cursor: pointer;
      transition: border-color 0.1s, color 0.1s;
    `;
    resetBtn.textContent = '↺ Reset params';
    resetBtn.title       = 'Reset all parameters to their default values';
    resetBtn.addEventListener('mouseenter', () => {
      resetBtn.style.borderColor = 'var(--accent2)';
      resetBtn.style.color       = 'var(--accent2)';
    });
    resetBtn.addEventListener('mouseleave', () => {
      resetBtn.style.borderColor = 'var(--border-dim)';
      resetBtn.style.color       = 'var(--text-dim)';
    });
    resetBtn.addEventListener('click', () => {
      const manifest = layer.constructor?.manifest;
      if (!manifest?.params) return;
      // Re-apply all manifest defaults
      const defaults = {};
      manifest.params.forEach(p => { if (p.default !== undefined) defaults[p.id] = p.default; });
      if (layer.params) Object.assign(layer.params, defaults);
      if (typeof layer.init === 'function') layer.init(defaults);
      // Re-render the params panel
      const cont = resetBtn.closest('#params-content');
      if (cont) render(layer, cont);
      // Snapshot history
      if (window._vaelHistory) window._vaelHistory.snapshot(`Reset ${layer.name} params`);
      Toast.info(`Params reset to defaults`);
    });
    resetRow.appendChild(resetBtn);
    wrap.appendChild(resetRow);

    return wrap;
  }

  return { render, buildControl, buildSlider, buildDropdown, buildToggle, buildColorPicker, buildBandPicker, _buildNameHeader };

})();
