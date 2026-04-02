/**
 * ui/ShaderPanel.js
 * Renders when a ShaderLayer is selected in the params panel.
 *
 * CHANGES:
 * - audioTarget (Audio band) param removed — use ModMatrix instead.
 * - File loading: "Load .frag/.glsl file" button opens a file picker,
 *   reads the text, and compiles it directly into the layer.
 * - "Save to library" button stores the current GLSL in the shader library
 *   (managed by LibraryPanel) so it persists across sessions via localStorage.
 * - "Load from library" button shows stored shaders.
 * - Uniforms hint updated to include iParam1/2/3, iColorA, iColorB, iHueShift.
 * - ShaderToy wrapper note included — mainImage() works automatically.
 * - Preset buttons fixed: call layer.init({ shaderName }) not _selectRenderFn().
 */

const ShaderPanel = (() => {

  function render(layer, container) {
    container.innerHTML = '';

    // ── Header with editable name ──────────────────────────────
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Shader'));
    } else {
      const h = document.createElement('div');
      h.style.cssText = 'font-family:var(--font-mono);font-size:10px;letter-spacing:1.5px;color:var(--accent);margin-bottom:14px;text-transform:uppercase';
      h.textContent   = layer.name || 'Shader';
      container.appendChild(h);
    }

    // ── Param sliders — rename based on SHADER_META ────────────
    const manifest = layer.constructor.manifest;
    const meta     = ShaderLayer.SHADER_META?.[layer._shaderName] || {};

    if (manifest?.params) {
      manifest.params.forEach(param => {
        if (param.type === 'band') return;

        // Override label with per-shader meaning if known
        const metaLabel = meta[param.id];
        const displayParam = metaLabel
          ? { ...param, label: metaLabel }
          : param;

        // Hide iParam sliders that do nothing for this shader (null in meta)
        const isIParam = ['param1','param2','param3'].includes(param.id);
        if (isIParam && metaLabel === null) {
          // Render greyed-out disabled version so user knows it exists but inactive
          const ghost = document.createElement('div');
          ghost.style.cssText = 'opacity:0.25;margin-bottom:8px;pointer-events:none';
          const current = layer.params?.[param.id] ?? param.default;
          const ctrl = (typeof ParamPanel !== 'undefined')
            ? ParamPanel.buildControl(param, current, layer)
            : _legacySlider(param, current, layer);
          if (ctrl) { ghost.appendChild(ctrl); container.appendChild(ghost); }
          return;
        }

        const current = layer.params?.[param.id] ?? param.default;
        const ctrl = (typeof ParamPanel !== 'undefined')
          ? ParamPanel.buildControl(displayParam, current, layer)
          : _legacySlider(displayParam, current, layer);
        if (ctrl) container.appendChild(ctrl);
      });
    }

    // Per-shader usage note
    if (meta.note) {
      const noteEl = document.createElement('div');
      noteEl.style.cssText = `
        font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
        background:var(--bg-card);border:1px solid var(--border-dim);
        border-radius:4px;padding:6px 8px;margin-bottom:12px;line-height:1.6;
      `;
      noteEl.textContent = '💡 ' + meta.note;
      container.appendChild(noteEl);
    }

    // ── Divider ────────────────────────────────────────────────
    const div1 = document.createElement('div');
    div1.style.cssText = 'height:1px;background:var(--border-dim);margin:14px 0';
    container.appendChild(div1);

    // ── Built-in presets ───────────────────────────────────────
    const presetsLabel = document.createElement('div');
    presetsLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:6px';
    presetsLabel.textContent   = 'Built-in shaders';
    container.appendChild(presetsLabel);

    const presets = [
      'plasma','ripple','distort','bloom','chromatic',
      'kaleidoscope','tunnel','voronoi','turing',
      'fbm','rings','aurora','julia','lissajous',
    ];
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px';

    presets.forEach(name => {
      const btn = document.createElement('button');
      btn.className   = 'btn';
      btn.textContent = name;
      btn.style.cssText = `font-size:9px;padding:4px 8px;
        ${layer._shaderName === name ? 'color:var(--accent);border-color:var(--accent)' : ''}`;
      btn.addEventListener('click', () => {
        layer.init({ shaderName: name });
        layer.name = `Shader — ${name}`;
        Toast.info(`Loaded: ${name}`);
        render(layer, container);
      });
      presetRow.appendChild(btn);
    });
    container.appendChild(presetRow);

    // ── Divider ────────────────────────────────────────────────
    const div2 = document.createElement('div');
    div2.style.cssText = 'height:1px;background:var(--border-dim);margin-bottom:14px';
    container.appendChild(div2);

    // ── GLSL editor ────────────────────────────────────────────
    const glslHeader = document.createElement('div');
    glslHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
    glslHeader.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
        CUSTOM GLSL
      </span>
      <a href="https://www.shadertoy.com" target="_blank"
        style="color:var(--accent2);text-decoration:none;font-family:var(--font-mono);font-size:8px">
        shadertoy.com ↗
      </a>
    `;
    container.appendChild(glslHeader);

    // Uniforms hint
    const hint = document.createElement('details');
    hint.style.cssText = 'margin-bottom:8px';
    hint.innerHTML = `
      <summary style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);cursor:pointer;
                      list-style:none;display:flex;align-items:center;gap:4px">
        <span>▸</span> Available uniforms
      </summary>
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                  line-height:1.8;padding:8px;background:var(--bg);border-radius:4px;
                  border:1px solid var(--border-dim);margin-top:4px">
        <div style="color:var(--accent2);margin-bottom:4px">Audio</div>
        float iBass, iMid, iTreble, iVolume, iBeat, iBpm<br>
        <div style="color:var(--accent2);margin:4px 0">Time &amp; space</div>
        float iTime &nbsp;·&nbsp; vec2 iResolution &nbsp;·&nbsp; float iMouseX, iMouseY<br>
        <div style="color:var(--accent2);margin:4px 0">User controls</div>
        float iParam1, iParam2, iParam3 &nbsp;·&nbsp; float iHueShift<br>
        vec3 iColorA, iColorB<br>
        <div style="color:var(--accent2);margin:4px 0">Legacy</div>
        float iSpeed, iIntensity, iScale<br>
        <div style="color:var(--accent);margin-top:6px">
          ShaderToy mainImage() auto-wrapped — or use void main() + gl_FragColor.
          Do NOT redeclare any uniforms.
        </div>
      </div>
    `;
    container.appendChild(hint);

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.value       = layer.isCustom ? (layer._customGLSL || '') : '';
    textarea.placeholder = `// Paste GLSL here — ShaderToy mainImage() or void main()\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;\n  fragColor = vec4(uv + 0.5, 0.5 + 0.5*sin(iTime + iBass*3.), 1.0);\n}`;
    textarea.spellcheck  = false;
    textarea.style.cssText = `
      width:100%; height:160px; background:var(--bg);
      border:1px solid var(--border); border-radius:4px;
      color:#a8d8a8; font-family:'JetBrains Mono',monospace;
      font-size:9px; padding:8px; resize:vertical;
      line-height:1.5; margin-bottom:8px; tab-size:2; box-sizing:border-box;
    `;
    container.appendChild(textarea);

    // Tab key inserts spaces in textarea
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textarea.selectionStart;
        textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
      }
    });

    // Action button row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px';

    // Compile button
    const compileBtn = document.createElement('button');
    compileBtn.className   = 'btn accent';
    compileBtn.textContent = '▶ Compile';
    compileBtn.addEventListener('click', () => {
      const src = textarea.value.trim();
      if (!src) { Toast.warn('Paste a GLSL shader first'); return; }
      layer.loadGLSL(src);
      compileBtn.textContent = '✓ Compiled';
      setTimeout(() => { compileBtn.textContent = '▶ Compile'; }, 1500);
    });
    btnRow.appendChild(compileBtn);

    // Load .frag / .glsl file button
    const fileBtn = document.createElement('button');
    fileBtn.className   = 'btn';
    fileBtn.textContent = '↑ Load .frag/.glsl';
    fileBtn.addEventListener('click', () => {
      const input    = document.createElement('input');
      input.type     = 'file';
      input.accept   = '.glsl,.frag,.vert,.txt';
      input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
      document.body.appendChild(input);
      input.click();
      input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) { input.remove(); return; }
        try {
          const text = await file.text();
          textarea.value = text;
          layer.loadGLSL(text);
          layer.name = file.name.replace(/\.[^.]+$/, '');
          Toast.success(`Loaded: ${file.name}`);
          render(layer, container);
        } catch { Toast.error('Could not read file'); }
        input.remove();
      });
    });
    btnRow.appendChild(fileBtn);
    container.appendChild(btnRow);

    // Save to library / load from library row
    const libRow = document.createElement('div');
    libRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px';

    const saveLibBtn = document.createElement('button');
    saveLibBtn.className   = 'btn';
    saveLibBtn.style.fontSize = '9px';
    saveLibBtn.textContent = '📚 Save to library';
    saveLibBtn.addEventListener('click', () => {
      const src = textarea.value.trim() || layer._customGLSL || '';
      if (!src) { Toast.warn('No GLSL to save'); return; }
      const name = layer.name || 'Custom Shader';
      if (typeof LibraryPanel !== 'undefined' && LibraryPanel.addShader) {
        LibraryPanel.addShader({ name, glsl: src });
        Toast.success(`Shader "${name}" saved to library`);
      } else {
        Toast.warn('Library panel not available');
      }
    });
    libRow.appendChild(saveLibBtn);

    const loadLibBtn = document.createElement('button');
    loadLibBtn.className   = 'btn';
    loadLibBtn.style.fontSize = '9px';
    loadLibBtn.textContent = '📂 Load from library';
    loadLibBtn.addEventListener('click', () => {
      // Switch to library tab, shaders section
      if (typeof LibraryPanel !== 'undefined' && LibraryPanel.openShaderSection) {
        LibraryPanel.openShaderSection(layer, (glsl, name) => {
          textarea.value = glsl;
          layer.loadGLSL(glsl);
          if (name) layer.name = name;
          Toast.success(`Loaded shader: ${name || 'from library'}`);
          render(layer, container);
        });
      } else {
        document.querySelector('[data-tab="library"]')?.click();
      }
    });
    libRow.appendChild(loadLibBtn);
    container.appendChild(libRow);

    // ── ModMatrix + FX ─────────────────────────────────────────
    if (typeof ModMatrixPanel !== 'undefined') ModMatrixPanel.render(layer, container);
    if (typeof LayerFXPanel   !== 'undefined') LayerFXPanel.render(layer, container);
  }

  // Fallback slider if ParamPanel isn't available
  function _legacySlider(param, current, layer) {
    if (param.type === 'band') return null;
    const isInt = param.type === 'int';
    const fmt   = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <span class="pv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${fmt(current)}</span>
      </div>
      <input type="range" min="${param.min ?? 0}" max="${param.max ?? 1}"
             step="${isInt ? 1 : 0.01}" value="${current}"
             style="width:100%;accent-color:var(--accent)" />
    `;
    const valEl = wrap.querySelector('.pv');
    wrap.querySelector('input').addEventListener('input', e => {
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      valEl.textContent = fmt(v);
      layer.params[param.id] = v;
    });
    return wrap;
  }

  return { render };

})();
