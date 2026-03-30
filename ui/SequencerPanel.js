/**
 * ui/SequencerPanel.js
 * UI for the Sequencer — tap tempo button and 8-step event grid.
 * Renders into the BEAT tab.
 */

const SequencerPanel = (() => {

  let _seq       = null;
  let _beat      = null;
  let _container = null;
  let _gridEl    = null;
  let _bpmEl     = null;
  let _tapEl     = null;
  let _rafId     = null;

  const EVENT_TYPES   = ['none', 'beat', 'flash', 'zoom', 'color'];
  const EVENT_COLORS  = {
    none:  'var(--bg)',
    beat:  '#00d4aa',
    flash: '#ffffff',
    zoom:  '#7c6af7',
    color: '#ffd700',
  };

  function init(sequencer, beatDetector, container) {
    _seq       = sequencer;
    _beat      = beatDetector;
    _container = container;

    _seq.onBpmChange = bpm => {
      if (_bpmEl) _bpmEl.textContent = bpm > 0 ? `${bpm} BPM` : '— BPM';
    };

    _seq.onStep = (step, event) => {
      // Highlight the active step in the grid
      if (!_gridEl) return;
      _gridEl.querySelectorAll('.step-btn').forEach((btn, i) => {
        btn.style.outline = i === step ? '2px solid rgba(255,255,255,0.8)' : 'none';
      });
    };

    _render();
    _startHighlight();
  }

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    // BPM display
    const bpmRow = document.createElement('div');
    bpmRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px';
    bpmRow.innerHTML = `
      <span id="seq-bpm" style="font-family:var(--font-mono);font-size:22px;
            font-weight:600;color:var(--accent);min-width:90px">
        ${_seq.bpm > 0 ? `${_seq.bpm} BPM` : '— BPM'}
      </span>
      <div style="flex:1"></div>
      <button id="seq-stop" class="btn danger" style="font-size:9px;padding:4px 10px">Stop</button>
    `;
    _container.appendChild(bpmRow);
    _bpmEl = document.getElementById('seq-bpm');

    // Tap button
    const tapBtn = document.createElement('button');
    tapBtn.id    = 'seq-tap';
    tapBtn.style.cssText = `
      width: 100%;
      height: 64px;
      background: color-mix(in srgb, var(--accent) 15%, var(--bg-card));
      border: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      border-radius: 8px;
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 2px;
      cursor: pointer;
      transition: background 0.05s, transform 0.05s;
      margin-bottom: 14px;
      user-select: none;
    `;
    tapBtn.textContent = 'TAP TEMPO';
    _container.appendChild(tapBtn);
    _tapEl = tapBtn;

    tapBtn.addEventListener('pointerdown', () => {
      _seq.tapTempo();
      tapBtn.style.background = 'color-mix(in srgb, var(--accent) 40%, var(--bg-card))';
      tapBtn.style.transform  = 'scale(0.97)';
    });
    tapBtn.addEventListener('pointerup', () => {
      tapBtn.style.background = 'color-mix(in srgb, var(--accent) 15%, var(--bg-card))';
      tapBtn.style.transform  = 'scale(1)';
    });

    // Sync from beat detector
    const syncRow = document.createElement('div');
    syncRow.style.cssText = 'display:flex;gap:6px;margin-bottom:16px;align-items:center';
    syncRow.innerHTML = `
      <button id="seq-sync" class="btn" style="flex:1;font-size:9px">
        Sync from detector
      </button>
      <select id="seq-sub" style="
        background:var(--bg);border:1px solid var(--border);border-radius:4px;
        color:var(--text);font-family:var(--font-mono);font-size:9px;padding:5px 6px">
        <option value="quarter" ${_seq.subdivision==='quarter'?'selected':''}>♩ Quarter</option>
        <option value="eighth"  ${_seq.subdivision==='eighth' ?'selected':''}>♪ Eighth</option>
      </select>
    `;
    _container.appendChild(syncRow);

    document.getElementById('seq-sync').addEventListener('click', () => {
      if (_beat.bpm > 0) _seq.syncToBeat(_beat.bpm);
      else alert('No BPM detected yet — play audio with a steady beat first.');
    });
    document.getElementById('seq-sub').addEventListener('change', e => {
      _seq.setSubdivision(e.target.value);
    });
    document.getElementById('seq-stop').addEventListener('click', () => {
      _seq.stop();
    });

    // Step grid label
    const gridLabel = document.createElement('div');
    gridLabel.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px';
    gridLabel.textContent   = 'Step events — click to cycle';
    _container.appendChild(gridLabel);

    // 8-step grid
    const grid = document.createElement('div');
    grid.id    = 'seq-grid';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-bottom:14px';
    _gridEl = grid;

    _seq.steps.forEach((event, i) => {
      const btn  = document.createElement('button');
      btn.className = 'step-btn';
      btn.dataset.step = i;
      btn.style.cssText = `
        aspect-ratio: 1;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: ${EVENT_COLORS[event] || 'var(--bg)'};
        cursor: pointer;
        position: relative;
        transition: transform 0.1s;
      `;

      // Beat markers — small number below
      const label = document.createElement('span');
      label.style.cssText = 'position:absolute;bottom:2px;left:0;right:0;text-align:center;font-family:var(--font-mono);font-size:7px;color:rgba(0,0,0,0.5)';
      label.textContent   = i + 1;
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        // Cycle through event types
        const idx = EVENT_TYPES.indexOf(_seq.steps[i]);
        _seq.steps[i] = EVENT_TYPES[(idx + 1) % EVENT_TYPES.length];
        btn.style.background = EVENT_COLORS[_seq.steps[i]] || 'var(--bg)';
      });

      btn.title = event;
      grid.appendChild(btn);
    });
    _container.appendChild(grid);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    EVENT_TYPES.filter(e => e !== 'none').forEach(event => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:4px';
      item.innerHTML = `
        <div style="width:10px;height:10px;border-radius:2px;background:${EVENT_COLORS[event]};flex-shrink:0"></div>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">${event}</span>
      `;
      legend.appendChild(item);
    });
    _container.appendChild(legend);
    _renderSensitivitySection();
    _renderSignalMeters();
  }

  // Animate active step highlight
  function _startHighlight() {
    if (_rafId) cancelAnimationFrame(_rafId);
    const loop = () => {
      if (_gridEl) {
        _gridEl.querySelectorAll('.step-btn').forEach((btn, i) => {
          const isActive = _seq.active && i === _seq.currentStep;
          btn.style.outline = isActive ? '2px solid rgba(255,255,255,0.9)' : 'none';
          btn.style.transform = isActive ? 'scale(1.1)' : 'scale(1)';
        });
      }
      _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  }

  // ── Beat detector sensitivity controls ──────────────────────

  function _renderSensitivitySection() {
    if (!_container || !_beat) return;

    const section = document.createElement('div');
    section.style.cssText = 'margin-top:18px';

    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px';
    label.textContent = 'Beat detector sensitivity';
    section.appendChild(label);

    // Helper: build a labelled slider row wired to a BeatDetector property
    function _sliderRow(lbl, min, max, step, getValue, setValue) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:7px';

      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:96px';
      nameEl.textContent = lbl;

      const slider = document.createElement('input');
      slider.type  = 'range';
      slider.min   = min; slider.max = max; slider.step = step;
      slider.value = getValue();
      slider.style.cssText = 'flex:1;accent-color:var(--accent2)';

      const valEl = document.createElement('span');
      valEl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:36px;text-align:right';
      valEl.textContent = parseFloat(getValue()).toFixed(step < 1 ? 2 : 0);

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        setValue(v);
        valEl.textContent = v.toFixed(step < 1 ? 2 : 0);
      });

      row.append(nameEl, slider, valEl);
      return row;
    }

    section.appendChild(_sliderRow(
      'Flux sensitivity', 1.0, 4.0, 0.05,
      () => _beat.fluxMult,
      v  => { _beat.fluxMult = v; }
    ));
    section.appendChild(_sliderRow(
      'Min interval (ms)', 50, 600, 10,
      () => _beat.minInterval,
      v  => { _beat.minInterval = v; }
    ));
    section.appendChild(_sliderRow(
      'Kick threshold', 1.0, 3.5, 0.05,
      () => _beat._kick?.mult ?? 1.8,
      v  => { if (_beat._kick) _beat._kick.mult = v; }
    ));
    section.appendChild(_sliderRow(
      'Snare threshold', 1.0, 3.5, 0.05,
      () => _beat._snare?.mult ?? 1.6,
      v  => { if (_beat._snare) _beat._snare.mult = v; }
    ));
    section.appendChild(_sliderRow(
      'Hi-hat threshold', 1.0, 3.5, 0.05,
      () => _beat._hihat?.mult ?? 1.7,
      v  => { if (_beat._hihat) _beat._hihat.mult = v; }
    ));

    // Reset to defaults button
    const resetBtn = document.createElement('button');
    resetBtn.className   = 'btn';
    resetBtn.style.cssText = 'width:100%;font-size:9px;margin-top:4px;color:var(--text-dim)';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', () => {
      _beat.fluxMult    = 1.5;
      _beat.minInterval = 250;
      if (_beat._kick)  _beat._kick.mult  = 1.8;
      if (_beat._snare) _beat._snare.mult = 1.6;
      if (_beat._hihat) _beat._hihat.mult = 1.7;
      _render();
      Toast.info('Beat detector reset to defaults');
    });
    section.appendChild(resetBtn);

    _container.appendChild(section);
  }

  // ── Signal meters — live readout of all new audio signals ───

  function _renderSignalMeters() {
    if (!_container) return;

    const section = document.createElement('div');
    section.style.cssText = 'margin-top:16px';

    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px';
    label.textContent   = 'Live signal meters';
    section.appendChild(label);

    // Signal rows: [id, label, color]
    const signals = [
      // Beat booleans shown as flash indicators
      ['isBeat',          'Beat',          '#ffffff'],
      ['isKick',          'Kick',          '#ff4757'],
      ['isSnare',         'Snare',         '#ffa502'],
      ['isHihat',         'Hi-hat',        '#2ed573'],
      // Continuous band energy
      ['kickEnergy',      'Kick energy',   '#ff6b6b'],
      ['snareEnergy',     'Snare energy',  '#ffd700'],
      ['hihatEnergy',     'Hi-hat energy', '#00d4aa'],
      ['rms',             'RMS',           '#ff9f43'],
      // Spectral
      ['spectralCentroid','Centroid',      '#54a0ff'],
      ['spectralSpread',  'Spread',        '#5f27cd'],
      ['spectralFlux',    'Flux',          '#ff6348'],
    ];

    signals.forEach(([id, lbl, color]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px';
      row.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                     min-width:88px;text-align:right">${lbl}</span>
        <div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
          <div class="sig-bar" data-id="${id}"
            style="height:100%;width:0%;background:${color};border-radius:3px;
                   transition:width 0.05s linear"></div>
        </div>
        <span class="sig-val" data-id="${id}"
          style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                 min-width:28px;text-align:right">0</span>
      `;
      section.appendChild(row);
    });

    _container.appendChild(section);

    // Animate meters each frame
    const animate = () => {
      const ad = window._vaelAudioData;
      if (!ad) { requestAnimationFrame(animate); return; }

      signals.forEach(([id]) => {
        const raw = ad[id];
        const v   = typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw || 0);
        const bar = _container.querySelector(`.sig-bar[data-id="${id}"]`);
        const val = _container.querySelector(`.sig-val[data-id="${id}"]`);
        if (bar) bar.style.width = Math.min(100, v * 100).toFixed(1) + '%';
        if (val) val.textContent = typeof raw === 'boolean' ? (raw ? '●' : '○') : v.toFixed(2);
      });

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  return { init, renderSignalMeters: _renderSignalMeters };

})();
