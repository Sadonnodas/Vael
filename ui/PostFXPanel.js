/**
 * ui/PostFXPanel.js
 * Sidebar panel for adding, removing, and adjusting post-processing effects.
 * Renders inside the FX tab.
 */

const PostFXPanel = (() => {

  let _renderer  = null;
  let _container = null;

  // Simple per-effect modulation routes
  // Each: { id, effectId, paramId, source, depth, _smoothed, _base, _enabled }
  const _fxMods = [];

  const FX_MOD_SOURCES = [
    { id: 'bass',         label: 'Bass'          },
    { id: 'mid',          label: 'Mid'           },
    { id: 'treble',       label: 'Treble'        },
    { id: 'volume',       label: 'Volume'        },
    { id: 'isBeat',       label: 'Beat pulse'    },
    { id: 'songPosition', label: 'Song position' },
  ];

  // Called each frame from App.js render loop
  function tick(audioSmoothed) {
    if (!audioSmoothed || !_fxMods.length) return;
    _fxMods.forEach(mod => {
      if (!mod._enabled) return;
      let raw = audioSmoothed[mod.source] ?? 0;
      if (mod.source === 'isBeat') raw = audioSmoothed.isBeat ? 1 : 0;
      mod._smoothed = (mod._smoothed ?? 0) + (raw - (mod._smoothed ?? 0)) * 0.12;
      const effect = EFFECTS.find(e => e.id === mod.effectId);
      const pDef   = effect?.params.find(p => p.id === mod.paramId);
      if (!pDef) return;
      const base   = mod._base ?? pDef.default;
      const range  = pDef.max - pDef.min;
      const newVal = Math.max(pDef.min, Math.min(pDef.max, base + mod._smoothed * mod.depth * range));
      PostFX.update(mod.effectId, { [mod.paramId]: newVal });
    });
  }

  const EFFECTS = [
    {
      id: 'bloom',
      label: 'Bloom',
      desc: 'Glow around bright areas',
      defaults: { intensity: 0.6, threshold: 0.35 },
      params: [
        { id: 'intensity', label: 'Intensity', min: 0, max: 2,   step: 0.05, default: 0.6  },
        { id: 'threshold', label: 'Threshold', min: 0, max: 1,   step: 0.05, default: 0.35 },
        { id: 'radius',    label: 'Radius',    min: 0, max: 4,   step: 0.1,  default: 0.8  },
      ],
    },
    {
      id: 'chromatic',
      label: 'Chromatic aberration',
      desc: 'RGB channel split — filmic look',
      defaults: { amount: 0.003 },
      params: [
        { id: 'amount', label: 'Amount', min: 0, max: 0.02, step: 0.001, default: 0.003 },
      ],
    },
    {
      id: 'distort',
      label: 'Liquid distortion',
      desc: 'Noise-based warp, audio-reactive',
      defaults: { strength: 0.015, speed: 0.4 },
      params: [
        { id: 'strength', label: 'Strength', min: 0, max: 0.08, step: 0.002, default: 0.015 },
        { id: 'speed',    label: 'Speed',    min: 0, max: 2,    step: 0.05,  default: 0.4   },
      ],
    },
    {
      id: 'vignette',
      label: 'Vignette',
      desc: 'Darken the edges',
      defaults: { darkness: 0.5, offset: 0.5 },
      params: [
        { id: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.05, default: 0.5 },
        { id: 'offset',   label: 'Size',     min: 0, max: 1, step: 0.05, default: 0.5 },
      ],
    },
    {
      id: 'grain',
      label: 'Film grain',
      desc: 'Analog noise texture',
      defaults: { amount: 0.04 },
      params: [
        { id: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.005, default: 0.04 },
      ],
    },
    {
      id: 'feedback',
      label: 'Feedback trail',
      desc: 'Echoes the previous frame — creates tunnels, trails, and motion smear',
      defaults: { amount: 0.85, zoom: 1.002, rotation: 0.001, hueShift: 0.002, decay: 0.97 },
      params: [
        { id: 'amount',    label: 'Amount',     min: 0,     max: 0.98,  step: 0.01,   default: 0.85  },
        { id: 'zoom',      label: 'Zoom',       min: 0.98,  max: 1.02,  step: 0.0005, default: 1.002 },
        { id: 'rotation',  label: 'Rotation',   min: -0.05, max: 0.05,  step: 0.001,  default: 0.001 },
        { id: 'hueShift',  label: 'Hue drift',  min: 0,     max: 0.1,   step: 0.001,  default: 0.002 },
        { id: 'decay',     label: 'Decay',      min: 0.8,   max: 1.0,   step: 0.005,  default: 0.97  },
      ],
    },
  ];

  function init(renderer, container) {
    _renderer  = renderer;
    _container = container;
    _render();
  }

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:14px';
    intro.textContent   = 'Post-processing runs after all layers composite. Effects stack in order.';
    _container.appendChild(intro);

    EFFECTS.forEach(effect => {
      const isActive = PostFX.has(effect.id);
      const card     = document.createElement('div');
      card.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${isActive ? 'var(--accent)' : 'var(--border-dim)'};
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 8px;
        transition: border-color 0.15s;
      `;

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${isActive ? '10px' : '0'}">
          <span style="flex:1;font-family:var(--font-mono);font-size:10px;
                       color:${isActive ? 'var(--text)' : 'var(--text-muted)'}">
            ${effect.label}
          </span>
          <span style="font-size:9px;color:var(--text-dim);flex:1">${effect.desc}</span>
          <button class="fx-toggle btn ${isActive ? 'danger' : 'accent'}"
            data-id="${effect.id}"
            style="font-size:9px;padding:4px 10px;flex-shrink:0">
            ${isActive ? 'Remove' : 'Add'}
          </button>
        </div>
        ${isActive ? _buildParams(effect) : ''}
      `;

      // Toggle button
      card.querySelector('.fx-toggle').addEventListener('click', () => {
        if (PostFX.has(effect.id)) {
          PostFX.remove(_renderer, effect.id);
        } else {
          PostFX.add(_renderer, effect.id, effect.defaults);
        }
        _render();
      });

      // Parameter sliders (only when active)
      if (isActive) {
        effect.params.forEach(param => {
          const slider = card.querySelector(`[data-param="${param.id}"]`);
          const valEl  = card.querySelector(`[data-val="${param.id}"]`);
          if (!slider) return;
          slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (valEl) valEl.textContent = v.toFixed(3);
            PostFX.update(effect.id, { [param.id]: v });
            // Update base value for any active mod routes on this param
            _fxMods.filter(m => m.effectId === effect.id && m.paramId === param.id)
              .forEach(m => { m._base = v; });
          });
        });

        // ── Mod routes for this effect ──────────────────────
        const existingMods = _fxMods.filter(m => m.effectId === effect.id);
        if (existingMods.length > 0) {
          const modList = document.createElement('div');
          modList.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid var(--border-dim)';
          existingMods.forEach((mod, mi) => {
            const mRow = document.createElement('div');
            mRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:4px;font-family:var(--font-mono);font-size:8px';
            mRow.innerHTML = `
              <span style="color:var(--accent2);min-width:52px">${mod.source}</span>
              <span style="color:var(--text-dim)">→ ${mod.paramId}</span>
              <input type="range" min="-2" max="2" step="0.05" value="${mod.depth}"
                style="flex:1;accent-color:var(--accent2)" />
              <span class="mod-depth-val" style="color:var(--accent2);min-width:28px">${mod.depth.toFixed(2)}</span>
              <button class="mod-del-btn" style="background:none;border:none;cursor:pointer;color:#ff4444;font-size:10px">✕</button>
            `;
            mRow.querySelector('input').addEventListener('input', e => {
              mod.depth = parseFloat(e.target.value);
              mRow.querySelector('.mod-depth-val').textContent = mod.depth.toFixed(2);
            });
            mRow.querySelector('.mod-del-btn').addEventListener('click', () => {
              const idx = _fxMods.indexOf(mod);
              if (idx >= 0) _fxMods.splice(idx, 1);
              _render();
            });
            modList.appendChild(mRow);
          });
          card.appendChild(modList);
        }

        // + Add mod button
        const addModBtn = document.createElement('button');
        addModBtn.style.cssText = 'background:none;border:1px dashed var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:3px 8px;cursor:pointer;width:100%;margin-top:6px';
        addModBtn.textContent = '∿ Add modulation';
        addModBtn.addEventListener('click', () => {
          // Inline mini-form
          addModBtn.style.display = 'none';
          const form = document.createElement('div');
          form.style.cssText = 'margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px';
          const srcOpts  = FX_MOD_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
          const paramOpts = effect.params.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
          form.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
              <select class="mod-src" style="background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:8px;padding:3px">${srcOpts}</select>
              <select class="mod-tgt" style="background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:8px;padding:3px">${paramOpts}</select>
            </div>
            <div style="display:flex;gap:6px">
              <button class="mod-add-ok" style="flex:1;background:var(--accent2);border:none;border-radius:3px;color:var(--bg);font-family:var(--font-mono);font-size:8px;padding:4px;cursor:pointer">Add</button>
              <button class="mod-add-cancel" style="background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:4px 8px;cursor:pointer">Cancel</button>
            </div>
          `;
          form.querySelector('.mod-add-ok').addEventListener('click', () => {
            const src = form.querySelector('.mod-src').value;
            const tgt = form.querySelector('.mod-tgt').value;
            const pDef = effect.params.find(p => p.id === tgt);
            _fxMods.push({
              id: `fxmod-${Date.now()}`,
              effectId: effect.id,
              paramId:  tgt,
              source:   src,
              depth:    0.5,
              _smoothed: 0,
              _base:    pDef?.default ?? 0,
              _enabled: true,
            });
            _render();
          });
          form.querySelector('.mod-add-cancel').addEventListener('click', () => {
            form.remove();
            addModBtn.style.display = '';
          });
          card.appendChild(form);
        });
        card.appendChild(addModBtn);
      }

      _container.appendChild(card);
    });
  }

  function _buildParams(effect) {
    return effect.params.map(param => `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
            ${param.label}
          </span>
          <span data-val="${param.id}"
            style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">
            ${param.default.toFixed(3)}
          </span>
        </div>
        <input type="range" data-param="${param.id}"
          min="${param.min}" max="${param.max}" step="${param.step}"
          value="${param.default}"
          style="width:100%;accent-color:var(--accent)" />
      </div>
    `).join('');
  }

  return { init, tick };

})();
