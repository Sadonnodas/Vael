/**
 * ui/ParamPanel.js
 * Auto-generates parameter controls from a layer's static manifest.
 * Call ParamPanel.render(layer, container) to populate a DOM element
 * with sliders, dropdowns, toggles and colour pickers.
 */

const ParamPanel = (() => {

  const BANDS = ['bass', 'mid', 'treble', 'volume', 'brightness', 'motion', 'hue', 'edgeDensity'];

  // ── Public API ───────────────────────────────────────────────

  /**
   * Render controls for `layer` into `container`.
   * Clears the container first.
   * @param {BaseLayer} layer
   * @param {HTMLElement} container
   * @param {AudioEngine} audioEngine  — used for live value preview
   */
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

    // Layer name header
    const header = document.createElement('div');
    header.style.cssText = `
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 1.5px;
      color: var(--accent);
      margin-bottom: 14px;
      text-transform: uppercase;
    `;
    header.textContent = manifest.name;
    container.appendChild(header);

    manifest.params.forEach(param => {
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
      case 'int':    return buildSlider(param, current, layer);
      case 'enum':   return buildDropdown(param, current, layer);
      case 'bool':   return buildToggle(param, current, layer);
      case 'color':  return buildColorPicker(param, current, layer);
      case 'band':   return buildBandPicker(param, current, layer);
      default:       return buildSlider(param, current, layer);
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

    const fmt = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);

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
      // Auto-fix partial hex on blur
      const v = e.target.value.trim();
      if (!v.startsWith('#')) { hexIn.value = '#' + v; }
    });

    return wrap;
  }

  // Audio band picker — dropdown restricted to audio bands
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

  return { render };

})();
