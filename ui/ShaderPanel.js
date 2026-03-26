/**
 * ui/ShaderPanel.js
 * Renders when a ShaderLayer is selected in the params panel.
 * Shows shader name, param sliders, and a GLSL paste area for custom shaders.
 */

const ShaderPanel = (() => {

  function render(layer, container) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 1.5px;
      color: var(--accent);
      margin-bottom: 14px;
      text-transform: uppercase;
    `;
    header.textContent = layer.name || 'Shader';
    container.appendChild(header);

    // Standard param sliders from manifest
    const manifest = layer.constructor.manifest;
    if (manifest?.params) {
      manifest.params.forEach(param => {
        const current = layer.params?.[param.id] ?? param.default;
        container.appendChild(_buildControl(param, current, layer));
      });
    }

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin:14px 0';
    container.appendChild(div);

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
    hint.textContent   = 'Paste a ShaderToy shader below. Available: iTime, iResolution, iBass, iMid, iTreble, iVolume, iBeat, iBpm. CPU preview — GPU when WebGL renderer is added.';
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

    // Load button
    const loadBtn = document.createElement('button');
    loadBtn.className   = 'btn accent';
    loadBtn.style.width = '100%';
    loadBtn.textContent = 'Load shader';
    loadBtn.addEventListener('click', () => {
      const src = textarea.value.trim();
      if (!src) { Toast.warn('Paste a GLSL shader first'); return; }
      layer.loadGLSL(src);
    });
    container.appendChild(loadBtn);

    // Built-in presets row
    const presetsLabel = document.createElement('div');
    presetsLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-top:14px;margin-bottom:6px';
    presetsLabel.textContent   = 'Built-in shaders';
    container.appendChild(presetsLabel);

    const presets = ['plasma', 'ripple', 'distort', 'bloom', 'chromatic'];
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';

    presets.forEach(name => {
      const btn = document.createElement('button');
      btn.className   = 'btn';
      btn.textContent = name;
      btn.style.cssText = `
        font-size: 9px;
        padding: 4px 8px;
        ${layer._shaderName === name ? 'color:var(--accent);border-color:var(--accent)' : ''}
      `;
      btn.addEventListener('click', () => {
        layer._shaderName = name;
        layer._renderFn   = layer._selectRenderFn();
        layer.name        = `Shader — ${name}`;
        if (typeof Toast !== 'undefined') Toast.info(`Switched to ${name}`);
        render(layer, container);  // re-render panel
      });
      presetRow.appendChild(btn);
    });
    container.appendChild(presetRow);
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
