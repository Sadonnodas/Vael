/**
 * ui/LyricsPanel.js
 * Inline editor for LyricsLayer instances.
 *
 * CHANGES:
 * - All fixed IDs replaced with direct element references to prevent
 *   collision when switching between layers.
 * - Uses ParamPanel.buildControl() for param sliders instead of duplicating
 *   the control builders.
 * - showWhen support: outline colour/width only show when outline is on.
 * - New params (align, posX, outline, outlineColor, outlineWidth, uppercase)
 *   render automatically via ParamPanel.
 * - ModMatrixPanel + LayerFXPanel appended at bottom.
 */

const LyricsPanel = (() => {

  function render(layer, container) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'font-family:var(--font-mono);font-size:10px;letter-spacing:1.5px;color:var(--accent);margin-bottom:14px;text-transform:uppercase';
    header.textContent   = 'Lyrics / Text';
    container.appendChild(header);

    // Lines textarea
    const linesLabel = document.createElement('div');
    linesLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:6px';
    linesLabel.textContent   = 'Lines (one per line)';
    container.appendChild(linesLabel);

    const textarea = document.createElement('textarea');
    textarea.value       = layer.lines.join('\n');
    textarea.placeholder = 'One lyric line per line\u2026';
    textarea.style.cssText = 'width:100%;height:120px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:8px;resize:vertical;line-height:1.6;margin-bottom:10px;box-sizing:border-box';
    container.appendChild(textarea);
    textarea.addEventListener('input', () => {
      layer.lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    });

    // Progress
    const progress = document.createElement('div');
    progress.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);margin-bottom:10px;text-align:center';
    const updateProgress = () => {
      const idx = layer.currentLine, total = layer.totalLines;
      progress.textContent = total > 0
        ? `Line ${idx + 1} of ${total}: "${(layer.lines[idx] || '').slice(0, 35)}"`
        : 'No lines yet';
    };
    updateProgress();
    container.appendChild(progress);

    // Navigation — direct element refs, no fixed IDs
    const navRow = document.createElement('div');
    navRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
    const prevBtn = _btn('\u2190 Prev', 'btn');
    const nextBtn = _btn('Next \u2192', 'btn accent');
    const hideBtn = _btn('Hide',         'btn');
    prevBtn.style.flex = nextBtn.style.flex = hideBtn.style.flex = '1';
    prevBtn.addEventListener('click', () => { layer.prev(); updateProgress(); });
    nextBtn.addEventListener('click', () => { layer.next(); updateProgress(); });
    hideBtn.addEventListener('click', () => { layer.hide(); updateProgress(); });
    navRow.append(prevBtn, nextBtn, hideBtn);
    container.appendChild(navRow);

    // Custom text
    const customLabel = document.createElement('div');
    customLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:6px';
    customLabel.textContent   = 'Show custom text';
    container.appendChild(customLabel);

    const customRow = document.createElement('div');
    customRow.style.cssText = 'display:flex;gap:6px;margin-bottom:14px';
    const customInput = document.createElement('input');
    customInput.type        = 'text';
    customInput.placeholder = 'Type anything\u2026';
    customInput.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:6px 8px';
    const showBtn = _btn('Show', 'btn accent');
    showBtn.style.flexShrink = '0';
    const doShow = () => {
      const t = customInput.value.trim();
      if (t) { layer.show(t); updateProgress(); }
    };
    showBtn.addEventListener('click', doShow);
    customInput.addEventListener('keydown', e => { if (e.key === 'Enter') doShow(); });
    customRow.append(customInput, showBtn);
    container.appendChild(customRow);

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin:4px 0 14px';
    container.appendChild(div);

    // Style params
    const styleLabel = document.createElement('div');
    styleLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px';
    styleLabel.textContent   = 'Style';
    container.appendChild(styleLabel);

    const manifest = layer.constructor.manifest;
    if (manifest?.params) {
      manifest.params.forEach(param => {
        // showWhen evaluation
        if (param.showWhen) {
          const visible = Object.entries(param.showWhen).every(([key, allowed]) => {
            const val = layer.params?.[key];
            return Array.isArray(allowed) ? allowed.includes(val) : val === allowed;
          });
          if (!visible) return;
        }

        const current = layer.params?.[param.id] ?? param.default;

        if (typeof ParamPanel !== 'undefined' && ParamPanel.buildControl) {
          const el = ParamPanel.buildControl(param, current, layer);
          if (el) {
            // Outline toggle re-renders panel to show/hide dependent params
            if (param.id === 'outline') {
              const toggleBtn = el.querySelector('button');
              if (toggleBtn) {
                toggleBtn.addEventListener('click', () => setTimeout(() => render(layer, container), 50));
              }
            }
            container.appendChild(el);
          }
        } else {
          container.appendChild(_buildControl(param, current, layer));
        }
      });
    }

    // ModMatrix + Layer FX
    if (typeof ModMatrixPanel !== 'undefined') ModMatrixPanel.render(layer, container);
    if (typeof LayerFXPanel   !== 'undefined') LayerFXPanel.render(layer, container);
  }

  function _btn(text, cls) {
    const b = document.createElement('button');
    b.className = cls; b.textContent = text; return b;
  }

  // Fallback builders if ParamPanel unavailable
  function _buildControl(p, cur, layer) {
    switch (p.type) {
      case 'float': case 'int': return _sl(p, cur, layer);
      case 'enum':  return _dd(p, cur, layer);
      case 'bool':  return _tg(p, cur, layer);
      case 'color': return _co(p, cur, layer);
      default:      return _sl(p, cur, layer);
    }
  }

  function _sl(p, cur, layer) {
    const isInt = p.type === 'int', fmt = v => isInt ? Math.round(v) : parseFloat(v).toFixed(2);
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${p.label}</span><span class="pv" style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${fmt(cur)}</span></div><input type="range" min="${p.min??0}" max="${p.max??1}" step="${isInt?1:0.01}" value="${cur}" style="width:100%;accent-color:var(--accent)" />`;
    const valEl = wrap.querySelector('.pv');
    wrap.querySelector('input').addEventListener('input', e => { const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value); valEl.textContent = fmt(v); layer.params[p.id] = v; });
    return wrap;
  }

  function _dd(p, cur, layer) {
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-bottom:12px';
    wrap.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">${p.label}</div><select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px">${(p.options||[]).map(o=>`<option value="${o}" ${o===cur?'selected':''}>${o}</option>`).join('')}</select>`;
    wrap.querySelector('select').addEventListener('change', e => { layer.params[p.id] = e.target.value; });
    return wrap;
  }

  function _tg(p, cur, layer) {
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between';
    let state = !!cur;
    const lbl = document.createElement('span'); lbl.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted)'; lbl.textContent = p.label;
    const btn = document.createElement('button'); const knob = document.createElement('span');
    btn.style.cssText = `width:40px;height:20px;border-radius:10px;border:1px solid var(--border);background:${state?'var(--accent)':'var(--bg)'};cursor:pointer;position:relative;transition:background 0.2s`;
    knob.style.cssText = `position:absolute;top:2px;left:${state?'20px':'2px'};width:14px;height:14px;border-radius:50%;background:${state?'var(--bg)':'var(--text-dim)'};transition:left 0.2s`;
    btn.appendChild(knob);
    btn.addEventListener('click', () => { state=!state; btn.style.background=state?'var(--accent)':'var(--bg)'; knob.style.left=state?'20px':'2px'; knob.style.background=state?'var(--bg)':'var(--text-dim)'; layer.params[p.id]=state; });
    wrap.append(lbl, btn); return wrap;
  }

  function _co(p, cur, layer) {
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:space-between';
    const lbl = document.createElement('span'); lbl.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted)'; lbl.textContent = p.label;
    const inp = document.createElement('input'); inp.type='color'; inp.value=cur||'#ffffff'; inp.style.cssText='width:36px;height:24px;padding:2px;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer';
    inp.addEventListener('input', e => { layer.params[p.id] = e.target.value; });
    wrap.append(lbl, inp); return wrap;
  }

  return { render };

})();
