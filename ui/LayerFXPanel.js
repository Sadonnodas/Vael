/**
 * ui/LayerFXPanel.js
 * Renders the per-layer FX chain at the bottom of the params panel.
 * Call LayerFXPanel.render(layer, container) to append after ModMatrix.
 */

const LayerFXPanel = (() => {

  // Param control definitions per effect type
  const CONTROLS = {
    'blur':          [{ id: 'radius',      label: 'Radius',     min: 0,   max: 40,  step: 0.5, default: 4    },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'glow':          [{ id: 'radius',      label: 'Radius',     min: 1,   max: 40,  step: 0.5, default: 12   },
                      { id: 'intensity',   label: 'Intensity',  min: 0,   max: 2,   step: 0.05, default: 0.7 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'brightness':    [{ id: 'value',       label: 'Value',      min: 0,   max: 3,   step: 0.05, default: 1.3 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'contrast':      [{ id: 'value',       label: 'Value',      min: 0,   max: 4,   step: 0.05, default: 1.4 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'saturate':      [{ id: 'value',       label: 'Value',      min: 0,   max: 4,   step: 0.05, default: 1.5 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'hue-rotate':    [{ id: 'angle',       label: 'Angle',      min: 0,   max: 360, step: 1,    default: 0   },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'sepia':         [{ id: 'amount',      label: 'Amount',     min: 0,   max: 1,   step: 0.05, default: 0.6 }],
    'invert':        [{ id: 'amount',      label: 'Amount',     min: 0,   max: 1,   step: 0.05, default: 1.0 }],
    'vignette':      [{ id: 'darkness',    label: 'Darkness',   min: 0,   max: 1,   step: 0.05, default: 0.6 },
                      { id: 'size',        label: 'Size',       min: 0,   max: 1,   step: 0.05, default: 0.5 }],
    'chromatic':     [{ id: 'amount',      label: 'Offset',     min: 0,   max: 0.03, step: 0.001, default: 0.004 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'threshold':     [{ id: 'threshold',   label: 'Threshold',  min: 0,   max: 1,   step: 0.02, default: 0.5 }],
    'color-overlay': [{ id: 'opacity',     label: 'Opacity',    min: 0,   max: 1,   step: 0.02, default: 0.3 },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
    'pixelate':      [{ id: 'size',        label: 'Pixel size', min: 2,   max: 40,  step: 1,    default: 8   },
                      { id: 'audioAmount', label: 'Audio →',    min: 0,   max: 2,   step: 0.1, default: 0    }],
  };

  function render(layer, container) {
    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:var(--border-dim);margin:18px 0 14px';
    container.appendChild(div);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';
    // Build header without IDs to avoid stale-ID collisions when switching layers
    const fxCountSpan = document.createElement('span');
    fxCountSpan.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px';
    fxCountSpan.textContent   = `Layer FX (${(layer.fx || []).length})`;
    header.appendChild(fxCountSpan);

    const addFxBtn = document.createElement('button');
    addFxBtn.style.cssText = 'background:none;border:1px solid var(--accent);border-radius:3px;color:var(--accent);font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer';
    addFxBtn.textContent   = '+ Add FX';
    header.appendChild(addFxBtn);
    container.appendChild(header);

    // FX chain list
    const fxList = document.createElement('div');
    _renderChain(layer, fxList, fxCountSpan);
    container.appendChild(fxList);

    // Add form
    const form = document.createElement('div');
    form.style.cssText = `
      display: none;
      background: var(--bg-card);
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      padding: 12px;
      margin-top: 8px;
    `;

    const catalog = LayerFX.CATALOG;
    form.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--accent);margin-bottom:8px;letter-spacing:1px">ADD EFFECT</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
        ${catalog.map(e => `
          <button class="lfx-pick" data-type="${e.type}"
            style="background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;
                   color:var(--text-muted);font-family:var(--font-mono);font-size:9px;
                   padding:6px;cursor:pointer;text-align:left;transition:border-color 0.1s">
            ${e.label}
          </button>`).join('')}
      </div>
    `;
    container.appendChild(form);

    // Wire add button directly (no ID lookup needed)
    addFxBtn.addEventListener('click', () => {
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Wire catalog picks
    form.querySelectorAll('.lfx-pick').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--accent)');
      btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--border-dim)');
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const def  = catalog.find(e => e.type === type);
        if (!def) return;
        if (!layer.fx) layer.fx = [];
        layer.fx.push({ type, enabled: true, params: { ...def.params } });
        form.style.display = 'none';
        _renderChain(layer, fxList, fxCountSpan);
        Toast.success(`FX added: ${def.label}`);
      });
    });
  }

  function _renderChain(layer, container, countSpan) {
    container.innerHTML = '';
    const fx = layer.fx || [];

    // Update count
    if (countSpan) countSpan.textContent = `Layer FX (${fx.length})`;

    if (fx.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);text-align:center;padding:8px 0';
      empty.textContent   = 'No effects';
      container.appendChild(empty);
      return;
    }

    fx.forEach((effect, idx) => {
      const def = LayerFX.CATALOG.find(e => e.type === effect.type);
      const controls = CONTROLS[effect.type] || [];

      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${effect.enabled ? 'var(--accent)' : 'var(--border-dim)'};
        border-radius: 5px;
        padding: 8px 10px;
        margin-bottom: 6px;
      `;

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${controls.length > 0 ? '8px' : '0'}">
          <button class="lfx-toggle" style="background:none;border:none;cursor:pointer;
                  font-size:11px;color:${effect.enabled ? 'var(--accent)' : 'var(--text-dim)'}">
            ${effect.enabled ? '◉' : '○'}
          </button>
          <span style="flex:1;font-family:var(--font-mono);font-size:9px;color:var(--text)">
            ${def?.label || effect.type}
          </span>
          ${controls.length > 0 ? `
          <button class="lfx-rand" style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                  cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;
                  padding:1px 5px" title="Randomise this FX">⚄</button>` : ''}
          <button class="lfx-up" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:10px" title="Move up">↑</button>
          <button class="lfx-down" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:10px" title="Move down">↓</button>
          <button class="lfx-del" style="background:none;border:none;cursor:pointer;color:#ff4444;font-size:10px">✕</button>
        </div>
        ${controls.map(ctrl => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:52px">${ctrl.label}</span>
            <input type="range" class="lfx-ctrl" data-param="${ctrl.id}"
              min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}"
              value="${effect.params[ctrl.id] ?? ctrl.default}"
              style="flex:1;accent-color:var(--accent)" />
            <span class="lfx-val" data-param="${ctrl.id}"
              style="font-family:var(--font-mono);font-size:8px;color:var(--accent);min-width:28px;text-align:right">
              ${(effect.params[ctrl.id] ?? ctrl.default).toFixed(2)}
            </span>
          </div>
        `).join('')}
        ${effect.type === 'color-overlay' ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:52px">Color</span>
            <input type="color" class="lfx-color" value="${effect.params.color || '#ff6600'}"
              style="height:22px;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer;flex:1" />
          </div>` : ''}
      `;

      // Toggle
      card.querySelector('.lfx-toggle').addEventListener('click', () => {
        effect.enabled = !effect.enabled;
        _renderChain(layer, container, countSpan);
      });

      // Randomise FX params
      card.querySelector('.lfx-rand')?.addEventListener('click', () => {
        controls.forEach(ctrl => {
          const v = parseFloat((ctrl.min + Math.random() * (ctrl.max - ctrl.min)).toFixed(3));
          effect.params[ctrl.id] = v;
        });
        _renderChain(layer, container, countSpan);
        Toast.info('FX randomised');
      });

      // Sliders
      card.querySelectorAll('.lfx-ctrl').forEach(input => {
        const valEl = card.querySelector(`.lfx-val[data-param="${input.dataset.param}"]`);
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          effect.params[input.dataset.param] = v;
          if (valEl) valEl.textContent = v.toFixed(2);
        });
      });

      // Color picker
      card.querySelector('.lfx-color')?.addEventListener('input', e => {
        effect.params.color = e.target.value;
      });

      // Reorder
      card.querySelector('.lfx-up').addEventListener('click', () => {
        if (idx > 0) { [layer.fx[idx-1], layer.fx[idx]] = [layer.fx[idx], layer.fx[idx-1]]; _renderChain(layer, container, countSpan); }
      });
      card.querySelector('.lfx-down').addEventListener('click', () => {
        if (idx < fx.length-1) { [layer.fx[idx+1], layer.fx[idx]] = [layer.fx[idx], layer.fx[idx+1]]; _renderChain(layer, container, countSpan); }
      });

      // Delete
      card.querySelector('.lfx-del').addEventListener('click', () => {
        layer.fx.splice(idx, 1);
        _renderChain(layer, container, countSpan);
        Toast.info('FX removed');
      });

      container.appendChild(card);
    });
  }

  return { render };

})();
