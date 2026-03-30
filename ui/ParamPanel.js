/**
 * ui/ParamPanel.js
 *
 * Phase 2 upgrades:
 * - Collapsible sections: Transform & Opacity, Parameters, Modulation, FX
 * - Transform + opacity always shown at top of every layer's params panel
 * - Hue sliders (min:0 max:360) show a colour-strip + hex input
 * - MIDI CC badges on mapped params with hover tooltip
 * - GroupLayer renders name + transform/opacity only (no params section)
 * - ParamPanel.renderGlobalModMatrix(layerStack, container) — flat list of
 *   every active route across all layers with delete buttons
 */

const ParamPanel = (() => {

  const BANDS = ['bass', 'mid', 'treble', 'volume', 'brightness', 'motion', 'hue', 'edgeDensity'];

  const LEGACY_PARAM_IDS = new Set([
    'audioTarget', 'audioAmount', 'audioReact',
    'audioScale',  'audioRotate', 'audioOpac',
    'audioSize',   'audioHue',    'audioColor',
  ]);

  // Remember open/closed state per layer constructor name
  const _sectionState = {};

  // ── Live value tracking ──────────────────────────────────────
  let _liveTrackers = new Map();
  let _trackedLayer = null;

  function updateLiveValues(layer) {
    if (!layer || layer !== _trackedLayer) return;
    _liveTrackers.forEach(({ liveBar, numInput, slider, min, max, fmt, paramId }) => {
      const live = paramId === 'opacity' ? layer.opacity : layer.params?.[paramId];
      if (live === undefined || live === null) return;
      const range    = max - min;
      const pct      = range > 0 ? Math.max(0, Math.min(1, (live - min) / range)) : 0;
      const isDriven = Math.abs(live - parseFloat(slider.value)) > 0.005;
      liveBar.style.opacity = isDriven ? '1' : '0';
      liveBar.style.width   = `${pct * 100}%`;
      if (isDriven && document.activeElement !== numInput) {
        numInput.style.color = 'var(--accent2)';
        numInput.value       = fmt(live);
      } else if (!isDriven && document.activeElement !== numInput) {
        numInput.style.color = 'var(--accent)';
        numInput.value       = fmt(parseFloat(slider.value));
      }
    });
  }

  // ── Main render ──────────────────────────────────────────────

  function render(layer, container, audioEngine) {
    _liveTrackers.clear();
    _trackedLayer = layer;
    container.innerHTML = '';

    const manifest = layer.constructor.manifest;
    const typeKey  = layer.constructor.name;
    if (!_sectionState[typeKey]) {
      _sectionState[typeKey] = { transform: false, params: true, mod: false, fx: false };
    }
    const sec = _sectionState[typeKey];

    // Name header
    container.appendChild(_buildNameHeader(layer, manifest?.name || typeKey));

    // Transform & Opacity — always shown for every layer
    const xfSec = _buildCollapsible('Transform & Opacity', sec.transform, o => { sec.transform = o; });
    _buildTransformControls(layer, xfSec.body);
    container.appendChild(xfSec.el);

    // Layer params section
    const params = (manifest?.params || []).filter(p => {
      if (LEGACY_PARAM_IDS.has(p.id) || p.legacy === true) return false;
      if (!p.showWhen) return true;
      return Object.entries(p.showWhen).every(([key, allowed]) => {
        const val = layer.params?.[key];
        return Array.isArray(allowed) ? allowed.includes(val) : val === allowed;
      });
    });

    if (params.length > 0) {
      const pSec = _buildCollapsible('Parameters', sec.params, o => { sec.params = o; });
      params.forEach(p => {
        pSec.body.appendChild(buildControl(p, layer.params?.[p.id] ?? p.default, layer));
      });
      container.appendChild(pSec.el);
    }

    // Modulation matrix
    if (layer.modMatrix) {
      const label = `Modulation (${layer.modMatrix.routes.length})`;
      const mSec  = _buildCollapsible(label, sec.mod, o => { sec.mod = o; });
      ModMatrixPanel.render(layer, mSec.body);
      container.appendChild(mSec.el);
    }

    // FX chain
    if (typeof LayerFXPanel !== 'undefined') {
      const fxLabel = `Layer FX (${(layer.fx || []).length})`;
      const fSec    = _buildCollapsible(fxLabel, sec.fx, o => { sec.fx = o; });
      LayerFXPanel.render(layer, fSec.body);
      container.appendChild(fSec.el);
    }
  }

  // ── Collapsible section ──────────────────────────────────────

  function _buildCollapsible(title, defaultOpen, onToggle) {
    const details = document.createElement('details');
    details.open  = defaultOpen;
    details.style.cssText = 'border:1px solid var(--border-dim);border-radius:6px;margin-bottom:10px;overflow:hidden';

    const summary = document.createElement('summary');
    summary.style.cssText = `
      font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:1px;padding:8px 10px;
      cursor:pointer;list-style:none;display:flex;align-items:center;
      gap:6px;background:var(--bg-card);user-select:none;
    `;
    const arrow = document.createElement('span');
    arrow.style.cssText = `font-size:8px;transition:transform 0.15s;display:inline-block;
      transform:${defaultOpen ? 'rotate(90deg)' : 'rotate(0deg)'}`;
    arrow.textContent = '▶';
    summary.appendChild(arrow);
    summary.appendChild(document.createTextNode(title));
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 10px 4px';
    details.appendChild(body);

    details.addEventListener('toggle', () => {
      arrow.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
      if (typeof onToggle === 'function') onToggle(details.open);
    });

    return { el: details, body };
  }

  // ── Transform & Opacity ──────────────────────────────────────

  function _buildTransformControls(layer, container) {
    const t = layer.transform || {};

    // Opacity — writes to layer.opacity
    container.appendChild(buildSlider(
      { id: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01 },
      layer.opacity ?? 1, layer,
      v => { layer.opacity = v; }
    ));

    // Blend mode
    const blendModes = ['normal','multiply','screen','overlay','add','softlight',
                        'difference','luminosity','subtract','exclusion'];
    container.appendChild(buildDropdown(
      { id: '_blendMode', label: 'Blend mode', type: 'enum', options: blendModes },
      layer.blendMode || 'normal', layer,
      v => { layer.blendMode = v; }
    ));

    // X / Y — two-column
    const xyRow = document.createElement('div');
    xyRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    xyRow.appendChild(buildSlider(
      { id: '_tx', label: 'X', type: 'float', min: -800, max: 800, step: 1 },
      t.x ?? 0, layer, v => { layer.transform.x = v; }
    ));
    xyRow.appendChild(buildSlider(
      { id: '_ty', label: 'Y', type: 'float', min: -450, max: 450, step: 1 },
      t.y ?? 0, layer, v => { layer.transform.y = v; }
    ));
    container.appendChild(xyRow);

    // Scale X / Y — two-column
    const scaleRow = document.createElement('div');
    scaleRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    scaleRow.appendChild(buildSlider(
      { id: '_tscaleX', label: 'Scale X', type: 'float', min: 0.1, max: 4, step: 0.01 },
      t.scaleX ?? 1, layer, v => { layer.transform.scaleX = v; }
    ));
    scaleRow.appendChild(buildSlider(
      { id: '_tscaleY', label: 'Scale Y', type: 'float', min: 0.1, max: 4, step: 0.01 },
      t.scaleY ?? 1, layer, v => { layer.transform.scaleY = v; }
    ));
    container.appendChild(scaleRow);

    // Rotation
    container.appendChild(buildSlider(
      { id: '_trot', label: 'Rotation', type: 'float', min: -180, max: 180, step: 0.5 },
      t.rotation ?? 0, layer, v => { layer.transform.rotation = v; }
    ));
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
      case 'videolibrary': return typeof VideoLibraryPanel !== 'undefined'
                             ? VideoLibraryPanel.buildPicker(current, layer, param.id)
                             : buildSlider(param, current, layer);
      default:             return buildSlider(param, current, layer);
    }
  }

  /**
   * Float / int slider.
   * customSetter: optional fn(value) — used for transform/opacity controls
   * that don't live in layer.params. When provided, no live tracker is added.
   */
  function buildSlider(param, current, layer, customSetter) {
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';

    const isHue  = !customSetter &&
                   param.min === 0 && param.max === 360 &&
                   (param.id.toLowerCase().includes('hue') || param.label.toLowerCase().includes('hue'));
    const isInt  = param.type === 'int';
    const step   = isInt ? 1 : (param.step || 0.01);
    const min    = param.min ?? 0;
    const max    = param.max ?? 1;
    const fmt    = v => isInt ? String(Math.round(v)) : parseFloat(v).toFixed(2);
    const clamp  = v => Math.max(min, Math.min(max, v));

    // MIDI mapping badge
    const midiLink = !customSetter ? _getMidiLink(layer, param.id) : null;

    // ── Label row ───────────────────────────────────────────
    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:5px';

    const labelLeft = document.createElement('div');
    labelLeft.style.cssText = 'display:flex;align-items:center;gap:5px';

    const label = document.createElement('span');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted)';
    label.textContent   = param.label;
    labelLeft.appendChild(label);

    if (midiLink) {
      const badge = document.createElement('span');
      badge.style.cssText = `
        font-family:var(--font-mono);font-size:7px;
        background:color-mix(in srgb,var(--accent2) 20%,transparent);
        color:var(--accent2);border:1px solid color-mix(in srgb,var(--accent2) 50%,transparent);
        border-radius:3px;padding:1px 4px;cursor:default;flex-shrink:0;
      `;
      badge.textContent = `CC${midiLink.cc}`;
      badge.title = `MIDI: ch${midiLink.channel} CC${midiLink.cc} → ${param.label}\nRange: ${midiLink.min.toFixed(2)} – ${midiLink.max.toFixed(2)}`;
      labelLeft.appendChild(badge);
    }
    labelRow.appendChild(labelLeft);

    const numInput = document.createElement('input');
    numInput.type  = 'number';
    numInput.value = fmt(current);
    numInput.min   = min; numInput.max = max; numInput.step = step;
    numInput.style.cssText = `
      font-family:var(--font-mono);font-size:9px;color:var(--accent);
      background:transparent;border:none;border-bottom:1px solid transparent;
      outline:none;width:52px;text-align:right;padding:0;cursor:text;
      -moz-appearance:textfield;
    `;
    numInput.addEventListener('focus', () => numInput.style.borderBottomColor = 'var(--accent)');
    numInput.addEventListener('blur',  () => numInput.style.borderBottomColor = 'transparent');
    labelRow.appendChild(numInput);
    wrap.appendChild(labelRow);

    // ── Hue extras ──────────────────────────────────────────
    let _hueSwatch = null, _hueHexIn = null;
    if (isHue) {
      // Colour spectrum strip
      const strip = document.createElement('div');
      strip.style.cssText = `height:4px;border-radius:2px;margin-bottom:5px;
        background:linear-gradient(to right,
          hsl(0,80%,55%),hsl(60,80%,55%),hsl(120,80%,55%),
          hsl(180,80%,55%),hsl(240,80%,55%),hsl(300,80%,55%),hsl(360,80%,55%))`;
      wrap.appendChild(strip);

      // Swatch + hex input row
      const hexRow = document.createElement('div');
      hexRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px';

      _hueSwatch = document.createElement('input');
      _hueSwatch.type  = 'color';
      _hueSwatch.value = _hueToHex(current);
      _hueSwatch.style.cssText = 'width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer;flex-shrink:0';

      _hueHexIn = document.createElement('input');
      _hueHexIn.type        = 'text';
      _hueHexIn.value       = _hueToHex(current);
      _hueHexIn.maxLength   = 7;
      _hueHexIn.placeholder = '#rrggbb';
      _hueHexIn.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 6px;letter-spacing:1px';

      hexRow.append(_hueSwatch, _hueHexIn);
      wrap.appendChild(hexRow);
    }

    // ── Slider ──────────────────────────────────────────────
    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = min; slider.max = max; slider.step = step;
    slider.value = current;
    slider.style.cssText = 'width:100%;cursor:pointer;accent-color:' +
      (isHue ? `hsl(${current},80%,55%)` : 'var(--accent)');

    // Shared apply
    const apply = (v) => {
      const c = clamp(isInt ? Math.round(v) : v);
      slider.value   = c;
      numInput.value = fmt(c);
      if (isHue) {
        slider.style.accentColor = `hsl(${c},80%,55%)`;
        if (_hueSwatch) _hueSwatch.value = _hueToHex(c);
        if (_hueHexIn)  _hueHexIn.value  = _hueToHex(c);
      }
      if (customSetter) {
        customSetter(c);
      } else {
        if (layer.params) layer.params[param.id] = c;
        if (typeof layer.setParam === 'function') layer.setParam(param.id, c);
      }
      if (window._vaelHistory && !customSetter) window._vaelHistory.onParamChange(param.label, layer);
    };

    slider.addEventListener('input', () => apply(parseFloat(slider.value)));
    const commitNum = () => { const v = parseFloat(numInput.value); if (!isNaN(v)) apply(v); };
    numInput.addEventListener('blur', commitNum);
    numInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); numInput.blur(); }
      if (e.key === 'Escape') { numInput.value = fmt(parseFloat(slider.value)); numInput.blur(); }
    });

    // Hue extras → slider sync
    if (isHue && _hueSwatch && _hueHexIn) {
      _hueSwatch.addEventListener('input', e => {
        const hue = _hexToHue(e.target.value);
        _hueHexIn.value = e.target.value;
        apply(hue);
      });
      _hueHexIn.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          _hueSwatch.value = v;
          _hueHexIn.style.borderColor = 'var(--border)';
          apply(_hexToHue(v));
        } else {
          _hueHexIn.style.borderColor = '#ff4444';
        }
      });
    }

    // Live bar
    const liveBar = document.createElement('div');
    liveBar.style.cssText = `position:absolute;bottom:0;left:0;height:2px;background:var(--accent2);
      border-radius:1px;opacity:0;transition:width 0.05s,opacity 0.2s;pointer-events:none`;
    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'position:relative;padding-bottom:2px';
    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(liveBar);
    wrap.appendChild(sliderWrap);

    if (!customSetter) {
      _liveTrackers.set(param.id, { liveBar, numInput, slider, min, max, fmt, paramId: param.id });
    }

    return wrap;
  }

  // Enum dropdown — customSetter optional
  function buildDropdown(param, current, layer, customSetter) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const options = (param.options || [])
      .map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      </div>
      <select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;
        color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px;cursor:pointer">
        ${options}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => {
      if (customSetter) { customSetter(e.target.value); return; }
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
      if (param.triggersRefresh) {
        const cont = wrap.closest('#params-content');
        if (cont) render(layer, cont);
      }
    });
    return wrap;
  }

  // Boolean toggle
  function buildToggle(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;display:flex;align-items:center;justify-content:space-between';
    let state = !!current;
    wrap.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      <button class="tgl" style="width:40px;height:20px;border-radius:10px;border:1px solid var(--border);
        background:${state ? 'var(--accent)' : 'var(--bg)'};cursor:pointer;position:relative;transition:background 0.2s">
        <span style="position:absolute;top:2px;left:${state ? '20px' : '2px'};width:14px;height:14px;
          border-radius:50%;background:${state ? 'var(--bg)' : 'var(--text-dim)'};transition:left 0.2s"></span>
      </button>
    `;
    const btn = wrap.querySelector('.tgl'), knob = btn.querySelector('span');
    btn.addEventListener('click', () => {
      state = !state;
      btn.style.background  = state ? 'var(--accent)' : 'var(--bg)';
      knob.style.left       = state ? '20px' : '2px';
      knob.style.background = state ? 'var(--bg)' : 'var(--text-dim)';
      if (layer.params) layer.params[param.id] = state;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, state);
      if (param.triggersRefresh) {
        const cont = wrap.closest('#params-content');
        if (cont) render(layer, cont);
      }
    });
    return wrap;
  }

  // Colour picker (type:'color')
  function buildColorPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const safe = /^#[0-9a-fA-F]{3,6}$/.test(current) ? current : '#00d4aa';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" class="cp-sw" value="${safe}" style="width:36px;height:28px;padding:2px;
          flex-shrink:0;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer"/>
        <input type="text" class="cp-hex" value="${safe}" maxlength="7" placeholder="#rrggbb"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
          color:var(--text);font-family:var(--font-mono);font-size:10px;padding:4px 8px;letter-spacing:1px"/>
      </div>
    `;
    const sw = wrap.querySelector('.cp-sw'), hex = wrap.querySelector('.cp-hex');
    const apply = v => {
      if (layer.params) layer.params[param.id] = v;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, v);
    };
    sw.addEventListener('input', e => { hex.value = e.target.value; apply(e.target.value); });
    hex.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) {
        sw.value = v; apply(v); hex.style.borderColor = 'var(--border)';
      } else { hex.style.borderColor = '#ff4444'; }
    });
    hex.addEventListener('blur', () => { if (!hex.value.startsWith('#')) hex.value = '#' + hex.value; });
    return wrap;
  }

  // Audio band picker
  function buildBandPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const opts = BANDS.map(b => `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">audio</span>
      </div>
      <select style="width:100%;background:color-mix(in srgb,var(--accent2) 10%,var(--bg));
        border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);border-radius:4px;
        color:var(--accent2);font-family:var(--font-mono);font-size:10px;padding:5px 8px;cursor:pointer">
        ${opts}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
    });
    return wrap;
  }

  // ── MIDI badge helper ────────────────────────────────────────

  function _getMidiLink(layer, paramId) {
    const midi = window._vaelMidi;
    if (!midi || !layer) return null;
    return midi.links.find(l => l.layerId === layer.id && l.paramId === paramId) || null;
  }

  // ── Hue helpers ──────────────────────────────────────────────

  function _hueToHex(hue) {
    const [r, g, b] = VaelColor.hslToRgb(((hue % 360) + 360) % 360, 0.8, 0.55);
    return VaelColor.rgbToHex(r, g, b);
  }

  function _hexToHue(hex) {
    const [r, g, b] = VaelColor.hexToRgb(hex);
    const [h]       = VaelColor.rgbToHsl(r, g, b);
    return Math.round(h);
  }

  // ── Editable name header ─────────────────────────────────────

  function _buildNameHeader(layer, typeName) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';

    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px';
    sub.textContent   = typeName || '';
    wrap.appendChild(sub);

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-family:var(--font-mono);font-size:12px;color:var(--accent);
      letter-spacing:1px;cursor:text;padding:2px 0;border-bottom:1px solid transparent;
      transition:border-color 0.15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    nameEl.textContent = layer.name;
    nameEl.title       = 'Click to rename';
    wrap.appendChild(nameEl);

    nameEl.addEventListener('mouseenter', () => nameEl.style.borderBottomColor = 'var(--accent)');
    nameEl.addEventListener('mouseleave', () => nameEl.style.borderBottomColor = 'transparent');
    nameEl.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type  = 'text'; inp.value = layer.name;
      inp.style.cssText = `font-family:var(--font-mono);font-size:12px;color:var(--accent);
        letter-spacing:1px;background:transparent;border:none;
        border-bottom:1px solid var(--accent);outline:none;width:100%;padding:2px 0`;
      nameEl.replaceWith(inp); inp.focus(); inp.select();
      const commit = () => {
        const n = inp.value.trim() || layer.name;
        layer.name = n; nameEl.textContent = n; inp.replaceWith(nameEl);
        if (typeof LayerPanel !== 'undefined') LayerPanel.renderLayerList();
        Toast.info(`Renamed to "${n}"`);
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = layer.name; inp.blur(); }
      });
    });

    const resetRow = document.createElement('div');
    resetRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:6px';
    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = `background:none;border:1px solid var(--border-dim);border-radius:3px;
      color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:2px 7px;cursor:pointer;
      transition:border-color 0.1s,color 0.1s`;
    resetBtn.textContent = '↺ Reset params';
    resetBtn.addEventListener('mouseenter', () => { resetBtn.style.borderColor='var(--accent2)'; resetBtn.style.color='var(--accent2)'; });
    resetBtn.addEventListener('mouseleave', () => { resetBtn.style.borderColor='var(--border-dim)'; resetBtn.style.color='var(--text-dim)'; });
    resetBtn.addEventListener('click', () => {
      const mf = layer.constructor?.manifest;
      if (!mf?.params) return;
      const def = {}; mf.params.forEach(p => { if (p.default !== undefined) def[p.id] = p.default; });
      if (layer.params) Object.assign(layer.params, def);
      if (typeof layer.init === 'function') layer.init(def);
      const cont = resetBtn.closest('#params-content');
      if (cont) render(layer, cont);
      if (window._vaelHistory) window._vaelHistory.snapshot(`Reset ${layer.name} params`);
      Toast.info('Params reset to defaults');
    });
    resetRow.appendChild(resetBtn);
    wrap.appendChild(resetRow);
    return wrap;
  }

  // ── Global ModMatrix view ────────────────────────────────────

  function renderGlobalModMatrix(layerStack, container) {
    container.innerHTML = '';

    const SOURCE_LABELS = {
      bass:'Bass', mid:'Mid', treble:'Treble', volume:'Volume', rms:'RMS',
      spectralCentroid:'Centroid', spectralSpread:'Spread', spectralFlux:'Flux',
      kickEnergy:'Kick', snareEnergy:'Snare', hihatEnergy:'Hi-hat',
      brightness:'Brightness', motion:'Motion', edgeDensity:'Edge',
      iTime:'Time', iBeat:'Beat', iMouseX:'Mouse X', iMouseY:'Mouse Y',
    };
    const SOURCE_COLORS = {
      bass:'#ff6b6b', mid:'#ffd700', treble:'#00d4aa', volume:'#7c6af7', rms:'#ff9f43',
      spectralCentroid:'#54a0ff', spectralSpread:'#5f27cd', spectralFlux:'#ff6348',
      kickEnergy:'#ff4757', snareEnergy:'#ffa502', hihatEnergy:'#2ed573',
      brightness:'#ffd700', motion:'#ff6b6b', edgeDensity:'#a78bfa',
      iTime:'#00d4aa', iBeat:'#ffffff', iMouseX:'#7c6af7', iMouseY:'#7c6af7',
    };

    const header = document.createElement('div');
    header.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px';
    container.appendChild(header);

    let total = 0;
    layerStack.layers.forEach(layer => {
      if (!layer.modMatrix?.routes.length) return;
      const lh = document.createElement('div');
      lh.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text);margin:10px 0 5px;padding-bottom:3px;border-bottom:1px solid var(--border-dim)';
      lh.textContent   = layer.name;
      container.appendChild(lh);

      layer.modMatrix.routes.forEach(route => {
        const mf     = layer.constructor?.manifest?.params?.find(p => p.id === route.target);
        const target = mf?.label || route.target;
        const source = SOURCE_LABELS[route.source] || route.source;
        const color  = SOURCE_COLORS[route.source] || '#00d4aa';
        const sign   = route.depth < 0 ? '−' : '+';
        const abs    = Math.abs(route.depth).toFixed(2);
        const dc     = route.depth < 0 ? '#ff9070' : color;

        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;
          background:var(--bg-card);border:1px solid var(--border-dim);
          border-left:2px solid ${color};border-radius:4px;margin-bottom:4px`;
        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:8px;color:${color};min-width:52px">${source}</span>
          <span style="font-size:8px;color:var(--text-dim)">→</span>
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1">${target}</span>
          <span style="font-family:var(--font-mono);font-size:8px;color:${dc};min-width:36px;text-align:right">${sign}${abs}</span>
          <button class="gdel" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:10px;padding:0 2px">✕</button>
        `;
        row.querySelector('.gdel').addEventListener('click', () => {
          layer.modMatrix.removeRoute(route.id);
          renderGlobalModMatrix(layerStack, container);
        });
        container.appendChild(row);
        total++;
      });
    });

    header.textContent = `All modulation routes (${total})`;

    if (total === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);text-align:center;padding:16px 0';
      empty.textContent   = 'No modulation routes in this scene.';
      container.appendChild(empty);
    }
  }

  return {
    render, buildControl, buildSlider, buildDropdown, buildToggle,
    buildColorPicker, buildBandPicker, _buildNameHeader,
    updateLiveValues, renderGlobalModMatrix,
  };

})();
