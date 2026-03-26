/**
 * ui/ShaderPanel.js
 * Renders when a ShaderLayer is selected in the params panel.
 *
 * FIXES:
 * 1. Preset buttons now call layer.init({ shaderName }) which triggers
 *    _gpuDirty = true and rebuilds the material correctly.
 *    Previously called layer._selectRenderFn() which doesn't exist.
 * 2. ModMatrixPanel and LayerFXPanel are now appended at the bottom,
 *    giving shader layers the same modulation and FX capabilities
 *    as every other layer type.
 */

const ShaderPanel = (() => {

  function render(layer, container) {
    container.innerHTML = '';

    // Editable name header (shared helper from ParamPanel)
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Shader'));
    } else {
      const header = document.createElement('div');
      header.style.cssText = 'font-family:var(--font-mono);font-size:12px;color:var(--accent);margin-bottom:16px';
      header.textContent   = layer.name || 'Shader';
      container.appendChild(header);
    }

    // Standard param sliders from manifest
    const manifest = layer.constructor.manifest;
    if (manifest?.params) {
      manifest.params.forEach(param => {
        const current = layer.params?.[param.id] ?? param.default;
        container.appendChild(_buildControl(param, current, layer));
      });
    }

    // Divider
    _divider(container);

    // Built-in presets row — shown first so user can quickly switch
    const presetsLabel = document.createElement('div');
    presetsLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px';
    presetsLabel.textContent   = 'Built-in shaders';
    container.appendChild(presetsLabel);

    const presets = ['plasma', 'ripple', 'distort', 'bloom', 'chromatic'];
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px';

    presets.forEach(name => {
      const btn = document.createElement('button');
      btn.className   = 'btn';
      btn.textContent = name;
      const isActive  = layer._shaderName === name;
      btn.style.cssText = `
        font-size: 9px;
        padding: 4px 8px;
        ${isActive ? 'color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg))' : ''}
      `;
      btn.addEventListener('click', () => {
        // FIX: use layer.init() which sets _gpuDirty = true and rebuilds
        // the WebGL material correctly on the next render frame.
        // Old code called layer._selectRenderFn() which does not exist.
        layer.init({ shaderName: name });
        layer.name = `Shader — ${name}`;
        Toast.info(`Switched to ${name}`);
        render(layer, container);  // re-render panel to update active highlight
      });
      presetRow.appendChild(btn);
    });
    container.appendChild(presetRow);

    // Divider
    _divider(container);

    // GLSL editor section
    const glslLabel = document.createElement('div');
    glslLabel.style.cssText = `
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    glslLabel.innerHTML = `
      <span>CUSTOM GLSL (ShaderToy compatible)</span>
      <a href="https://www.shadertoy.com" target="_blank"
        style="color:var(--accent2);text-decoration:none;font-size:8px">
        shadertoy.com ↗
      </a>
    `;
    container.appendChild(glslLabel);

    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:8px';
    hint.textContent   = 'Paste any ShaderToy mainImage shader. Available uniforms: iTime, iResolution, iBass, iMid, iTreble, iVolume, iBeat, iBpm, iMouseX, iMouseY, iSpeed, iIntensity, iScale.';
    container.appendChild(hint);

    const textarea = document.createElement('textarea');
    textarea.value       = layer.glslSource || '';
    textarea.placeholder = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, 0.5 + 0.5*sin(iTime), 1.0);\n}`;
    textarea.style.cssText = `
      width: 100%;
      height: 160px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: #a8d8a8;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      padding: 8px;
      resize: vertical;
      line-height: 1.5;
      margin-bottom: 8px;
      tab-size: 2;
    `;
    container.appendChild(textarea);

    const loadBtn = document.createElement('button');
    loadBtn.className   = 'btn accent';
    loadBtn.style.width = '100%';
    loadBtn.textContent = 'Load shader';
    loadBtn.addEventListener('click', () => {
      const src = textarea.value.trim();
      if (!src) { Toast.warn('Paste a GLSL shader first'); return; }
      layer.loadGLSL(src);
      Toast.success('Custom shader loaded on GPU');
    });
    container.appendChild(loadBtn);

    // ── FIX: Modulation matrix — same as all other layers ──────
    if (layer.modMatrix && typeof ModMatrixPanel !== 'undefined') {
      ModMatrixPanel.render(layer, container);
    }

    // ── FIX: Per-layer FX chain — same as all other layers ─────
    if (typeof LayerFXPanel !== 'undefined') {
      LayerFXPanel.render(layer, container);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  function _divider(container) {
    const d = document.createElement('div');
    d.style.cssText = 'height:1px;background:var(--border-dim);margin:14px 0';
    container.appendChild(d);
  }

  // ── Control builders ─────────────────────────────────────────

  function _buildControl(param, current, layer) {
    switch (param.type) {
      case 'float':
      case 'int':  return _slider(param, current, layer);
      case 'band': return _band(param, current, layer);
      default:     return _slider(param, current, layer);
    }
  }

  function _slider(param, current, layer) {
    const isInt = param.type === 'int';
    const fmt   = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
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

  function _band(param, current, layer) {
    const bands = ['bass', 'mid', 'treble', 'volume', 'brightness', 'motion'];
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">
        ${param.label}
      </div>
      <select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                     color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">
        ${bands.map(b => `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`).join('')}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => { layer.params[param.id] = e.target.value; });
    return wrap;
  }

  return { render };

})();
