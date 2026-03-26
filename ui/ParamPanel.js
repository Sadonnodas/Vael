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
  const LEGACY_PARAM_IDS = new Set(['audioTarget', 'audioAmount', 'audioReact']);

  // ── Public API ───────────────────────────────────────────────

  function render(layer, container, audioEngine) {
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

    const isInt = param.type === 'int';
    const step  = isInt ? 1 : (param.step || 0.01);
    const min   = param.min ?? 0;
    const max   = param.max ?? 1;
    const fmt   = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
          ${param.label}
        </span>
        <span class="pv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">
          ${fmt(current)}
        </span>
      </div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${current}"
             style="width:100%;accent-color:var(--accent);cursor:pointer" />
    `;

    const valEl = wrap.querySelector('.pv');
    const input = wrap.querySelector('input');

    input.addEventListener('input', () => {
      const v = isInt ? parseInt(input.value) : parseFloat(input.value);
      valEl.textContent = fmt(v);
      if (layer.params) layer.params[param.id] = v;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, v);
    });

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

    return wrap;
  }

  return { render, buildControl, buildSlider, buildDropdown, buildToggle, buildColorPicker, buildBandPicker, _buildNameHeader };

})();
