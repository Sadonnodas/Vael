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
    { id: 'lfo1',         label: 'LFO 1'         },
    { id: 'lfo2',         label: 'LFO 2'         },
    { id: 'lfo3',         label: 'LFO 3'         },
  ];

  // Three built-in global LFOs for FX modulation (independent of layer LFOs)
  const _globalLFOs = [
    { phase: 0, rate: 0.5, shape: 'sine',  value: 0 },
    { phase: 0, rate: 1.0, shape: 'sine',  value: 0 },
    { phase: 0, rate: 2.0, shape: 'triangle', value: 0 },
  ];
  const _lfoValues = { lfo1: 0, lfo2: 0, lfo3: 0 };

  function _tickGlobalLFOs(dt) {
    _globalLFOs.forEach((lfo, i) => {
      lfo.phase = (lfo.phase + lfo.rate * dt) % 1;
      const p = lfo.phase;
      switch (lfo.shape) {
        case 'sine':     lfo.value = Math.sin(p * Math.PI * 2); break;
        case 'triangle': lfo.value = p < 0.5 ? p * 4 - 1 : 3 - p * 4; break;
        case 'saw':      lfo.value = p * 2 - 1; break;
        case 'square':   lfo.value = p < 0.5 ? 1 : -1; break;
        default:         lfo.value = Math.sin(p * Math.PI * 2);
      }
    });
    _lfoValues.lfo1 = _globalLFOs[0].value;
    _lfoValues.lfo2 = _globalLFOs[1].value;
    _lfoValues.lfo3 = _globalLFOs[2].value;
  }

  // Called each frame from App.js render loop
  function tick(audioSmoothed) {
    const dt = audioSmoothed?._dt ?? 0.016;
    _tickGlobalLFOs(dt);
    if (!audioSmoothed || !_fxMods.length) return;
    _fxMods.forEach(mod => {
      if (!mod._enabled) return;
      let raw;
      if (mod.source.startsWith('lfo')) {
        raw = (_lfoValues[mod.source] ?? 0) * 0.5 + 0.5; // convert -1..1 → 0..1
      } else if (mod.source === 'isBeat') {
        raw = audioSmoothed.isBeat ? 1 : 0;
      } else {
        raw = audioSmoothed[mod.source] ?? 0;
      }
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

    // ── Active chain (in rendering order) ────────────────────────
    const activeNames = PostFX.list();

    if (activeNames.length > 0) {
      const chainLabel = document.createElement('div');
      chainLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
      chainLabel.textContent = 'Active chain';
      _container.appendChild(chainLabel);

      activeNames.forEach((name, idx) => {
        const effect = EFFECTS.find(e => e.id === name);
        if (!effect) return;
        _container.appendChild(_buildActiveCard(effect, idx, activeNames));
      });

      const div = document.createElement('div');
      div.style.cssText = 'height:1px;background:var(--border-dim);margin:14px 0';
      _container.appendChild(div);
    }

    // ── Global LFOs ───────────────────────────────────────────────
    if (activeNames.length > 0) {
      const lfoLabel = document.createElement('div');
      lfoLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
      lfoLabel.textContent = 'Global LFOs';
      _container.appendChild(lfoLabel);

      const SHAPES = ['sine','triangle','saw','square'];
      _globalLFOs.forEach((lfo, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
        const shapeOpts = SHAPES.map(s => `<option value="${s}"${lfo.shape===s?' selected':''}>${s}</option>`).join('');
        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);min-width:28px">LFO ${i+1}</span>
          <select class="lfo-shape" style="background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:8px;padding:2px 4px;flex:1">${shapeOpts}</select>
          <input type="number" class="lfo-rate" value="${lfo.rate.toFixed(2)}" min="0.01" max="20" step="0.1"
            style="width:48px;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--accent);font-family:var(--font-mono);font-size:8px;padding:2px 4px;text-align:right" />
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Hz</span>
        `;
        row.querySelector('.lfo-shape').addEventListener('change', e => { lfo.shape = e.target.value; });
        row.querySelector('.lfo-rate').addEventListener('change', e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v > 0) lfo.rate = v;
        });
        _container.appendChild(row);
      });

      const div2 = document.createElement('div');
      div2.style.cssText = 'height:1px;background:var(--border-dim);margin:14px 0';
      _container.appendChild(div2);
    }

    // ── Available effects catalogue ───────────────────────────────
    const catLabel = document.createElement('div');
    catLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    catLabel.textContent = activeNames.length > 0 ? 'Add more' : 'Effects';
    _container.appendChild(catLabel);

    EFFECTS.filter(e => !PostFX.has(e.id)).forEach(effect => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border-dim);border-radius:5px;margin-bottom:6px';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:1px">${effect.label}</div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">${effect.desc}</div>
        </div>
        <button class="btn accent" style="font-size:9px;padding:3px 10px;flex-shrink:0">Add</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        PostFX.add(_renderer, effect.id, effect.defaults);
        _render();
      });
      _container.appendChild(row);
    });
  }

  function _buildActiveCard(effect, idx, activeNames) {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card);border:1px solid var(--accent);border-radius:6px;padding:10px 12px;margin-bottom:8px';

    // ── Header row ────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px';

    // Up/down reorder buttons
    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.title = 'Move up in chain';
    upBtn.disabled = idx === 0;
    upBtn.style.cssText = `background:none;border:1px solid var(--border-dim);border-radius:3px;color:${idx===0?'var(--border)':'var(--text-dim)'};font-size:10px;padding:1px 5px;cursor:${idx===0?'default':'pointer'};flex-shrink:0`;
    upBtn.addEventListener('click', () => {
      const names = [...activeNames];
      [names[idx-1], names[idx]] = [names[idx], names[idx-1]];
      PostFX.reorder(_renderer, names);
      _render();
    });

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.title = 'Move down in chain';
    downBtn.disabled = idx === activeNames.length - 1;
    downBtn.style.cssText = `background:none;border:1px solid var(--border-dim);border-radius:3px;color:${idx===activeNames.length-1?'var(--border)':'var(--text-dim)'};font-size:10px;padding:1px 5px;cursor:${idx===activeNames.length-1?'default':'pointer'};flex-shrink:0`;
    downBtn.addEventListener('click', () => {
      const names = [...activeNames];
      [names[idx], names[idx+1]] = [names[idx+1], names[idx]];
      PostFX.reorder(_renderer, names);
      _render();
    });

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;font-family:var(--font-mono);font-size:10px;color:var(--text)';
    label.textContent = effect.label;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.style.cssText = 'font-size:9px;padding:3px 10px;flex-shrink:0';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      PostFX.remove(_renderer, effect.id);
      _fxMods.splice(0, _fxMods.length, ..._fxMods.filter(m => m.effectId !== effect.id));
      _render();
    });

    header.append(upBtn, downBtn, label, removeBtn);
    card.appendChild(header);

    // ── Param sliders ─────────────────────────────────────────
    card.insertAdjacentHTML('beforeend', _buildParams(effect));
    effect.params.forEach(param => {
      const slider = card.querySelector(`[data-param="${param.id}"]`);
      const valEl  = card.querySelector(`[data-val="${param.id}"]`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (valEl) valEl.textContent = v.toFixed(3);
        PostFX.update(effect.id, { [param.id]: v });
        _fxMods.filter(m => m.effectId === effect.id && m.paramId === param.id)
          .forEach(m => { m._base = v; });
      });
    });

    // ── Mod routes ────────────────────────────────────────────
    const existingMods = _fxMods.filter(m => m.effectId === effect.id);
    if (existingMods.length > 0) {
      const modList = document.createElement('div');
      modList.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid var(--border-dim)';
      existingMods.forEach(mod => {
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
          const i = _fxMods.indexOf(mod);
          if (i >= 0) _fxMods.splice(i, 1);
          _render();
        });
        modList.appendChild(mRow);
      });
      card.appendChild(modList);
    }

    // ── Add mod button ────────────────────────────────────────
    const addModBtn = document.createElement('button');
    addModBtn.style.cssText = 'background:none;border:1px dashed var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:3px 8px;cursor:pointer;width:100%;margin-top:6px';
    addModBtn.textContent = '∿ Add modulation';
    addModBtn.addEventListener('click', () => {
      addModBtn.style.display = 'none';
      const form = document.createElement('div');
      form.style.cssText = 'margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px';
      const srcOpts   = FX_MOD_SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
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
        const src  = form.querySelector('.mod-src').value;
        const tgt  = form.querySelector('.mod-tgt').value;
        const pDef = effect.params.find(p => p.id === tgt);
        _fxMods.push({ id:`fxmod-${Date.now()}`, effectId:effect.id, paramId:tgt,
                       source:src, depth:0.5, _smoothed:0, _base:pDef?.default??0, _enabled:true });
        _render();
      });
      form.querySelector('.mod-add-cancel').addEventListener('click', () => {
        form.remove(); addModBtn.style.display = '';
      });
      card.appendChild(form);
    });
    card.appendChild(addModBtn);

    return card;
  }

  function _buildParams(effect) {
    const current = PostFX.getValues(effect.id) || {};
    return effect.params.map(param => {
      const val = current[param.id] ?? param.default;
      return `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
            ${param.label}
          </span>
          <span data-val="${param.id}"
            style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">
            ${val.toFixed(3)}
          </span>
        </div>
        <input type="range" data-param="${param.id}"
          min="${param.min}" max="${param.max}" step="${param.step}"
          value="${val}"
          style="width:100%;accent-color:var(--accent)" />
      </div>
    `}).join('');
  }

  /**
   * Serialise active FX chain + param values + mod routes for preset save.
   * @returns {{ chain: string[], params: object, mods: object[] }}
   */
  function serialize() {
    const chain  = PostFX.list();
    const params = {};
    chain.forEach(name => {
      params[name] = PostFX.getValues(name) || {};
    });
    const mods = _fxMods.map(m => ({
      effectId: m.effectId, paramId: m.paramId,
      source: m.source, depth: m.depth, base: m._base,
    }));
    const lfos = _globalLFOs.map(l => ({ rate: l.rate, shape: l.shape }));
    return { chain, params, mods, lfos };
  }

  /**
   * Restore active FX chain from a serialised state.
   * @param {{ chain: string[], params: object, mods: object[] }} data
   */
  function restore(data) {
    if (!data?.chain) return;
    // Remove all current effects
    PostFX.list().forEach(name => PostFX.remove(_renderer, name));
    _fxMods.splice(0);

    // Re-add in saved order with saved param values
    data.chain.forEach(name => {
      const effect = EFFECTS.find(e => e.id === name);
      if (!effect) return;
      const defaults = { ...effect.defaults, ...(data.params?.[name] || {}) };
      PostFX.add(_renderer, name, defaults);
    });

    // Restore mod routes
    (data.mods || []).forEach(m => {
      const effect = EFFECTS.find(e => e.id === m.effectId);
      const pDef   = effect?.params.find(p => p.id === m.paramId);
      if (!pDef) return;
      _fxMods.push({
        id: `fxmod-${Date.now()}-${Math.random()}`,
        effectId: m.effectId, paramId: m.paramId,
        source: m.source, depth: m.depth,
        _smoothed: 0, _base: m.base ?? pDef.default, _enabled: true,
      });
    });

    // Restore global LFO settings
    if (data.lfos) {
      data.lfos.forEach((saved, i) => {
        if (_globalLFOs[i]) {
          if (saved.rate  !== undefined) _globalLFOs[i].rate  = saved.rate;
          if (saved.shape !== undefined) _globalLFOs[i].shape = saved.shape;
        }
      });
    }

    _render();
  }

  return { init, tick, serialize, restore };

})();
