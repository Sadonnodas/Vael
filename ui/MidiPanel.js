/**
 * ui/MidiPanel.js
 * Renders the MIDI tab content.
 * Shows connected devices, learn mode button, active link list,
 * a performance profile for the Hotone Ampero (or any footswitch),
 * and a MIDI activity indicator in the status bar.
 *
 * Call MidiPanel.init(midiEngine, layerStack) once on startup.
 * Call MidiPanel.refresh() to re-render.
 */

const MidiPanel = (() => {

  let _midi       = null;
  let _layers     = null;
  let _container  = null;
  let _activityDot = null;   // status bar dot element
  let _activityTimer = null;

  // ── Init ─────────────────────────────────────────────────────

  function init(midiEngine, layerStack, container) {
    _midi      = midiEngine;
    _layers    = layerStack;
    _container = container;

    _midi.onDeviceChange = () => refresh();
    _midi.onLink         = ()  => refresh();

    // Wire activity indicator
    _midi.onActivity = () => {
      const dot = _getActivityDot();
      if (!dot) return;
      dot.style.background = 'var(--accent)';
      dot.style.boxShadow  = '0 0 6px var(--accent)';
      if (_activityTimer) clearTimeout(_activityTimer);
      _activityTimer = setTimeout(() => {
        dot.style.background = 'rgba(255,255,255,0.15)';
        dot.style.boxShadow  = 'none';
      }, 120);
    };

    _render();
  }

  // ── Activity dot in status bar ───────────────────────────────

  function _getActivityDot() {
    if (_activityDot && _activityDot.isConnected) return _activityDot;
    const existing = document.getElementById('midi-activity-dot');
    if (existing) { _activityDot = existing; return _activityDot; }

    // Create it in the status bar if not yet present
    const statusLeft = document.getElementById('status-left');
    if (!statusLeft) return null;

    const wrap = document.createElement('div');
    wrap.className = 'status-item';
    wrap.title     = 'MIDI activity';
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:default';

    const dot = document.createElement('div');
    dot.id = 'midi-activity-dot';
    dot.style.cssText = `
      width:7px;height:7px;border-radius:50%;
      background:rgba(255,255,255,0.15);
      transition:background 0.06s,box-shadow 0.06s;
      flex-shrink:0;
    `;

    const label = document.createElement('span');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim)';
    label.textContent = 'MIDI';

    wrap.appendChild(dot);
    wrap.appendChild(label);
    statusLeft.appendChild(wrap);

    _activityDot = dot;
    return dot;
  }

  // ── Render ───────────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    // Always ensure the activity dot exists
    _getActivityDot();

    // Availability check
    if (!_midi.isAvailable) {
      _container.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);
                    line-height:1.7;padding:8px 0">
          MIDI not available.<br>
          Connect a USB controller and click Connect.<br><br>
          <button id="btn-midi-init" class="btn accent" style="width:100%">
            Connect MIDI
          </button>
        </div>`;
      document.getElementById('btn-midi-init')?.addEventListener('click', async () => {
        await _midi.init();
        _render();
      });
      return;
    }

    // ── Devices & input selection ────────────────────────────────
    _renderDevices();

    // ── Performance profile ───────────────────────────────────────
    _renderPerfProfile();

    // ── MIDI Learn ───────────────────────────────────────────────
    _renderLearn();

    // ── Links ────────────────────────────────────────────────────
    _renderLinks();

    // ── Global learned actions ───────────────────────────────────
    _renderGlobalActions();
  }

  // ── Devices section ─────────────────────────────────────────

  function _renderDevices() {
    const section = document.createElement('div');
    section.style.marginBottom = '14px';

    const title = _sectionLabel('Input device');
    section.appendChild(title);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '0';

    if (_midi.deviceNames.length === 0) {
      card.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">
        No MIDI devices detected.<br>Connect a controller and refresh.</div>`;
    } else {
      // Device selector
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:38px';
      lbl.textContent = 'Device';

      const sel = document.createElement('select');
      sel.style.cssText = `flex:1;background:var(--bg);border:1px solid var(--border-dim);
        border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px`;
      sel.innerHTML = '<option value="">— All devices —</option>';
      _midi.deviceNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        opt.selected = _midi.selectedDevice === name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        _midi.setSelectedDevice(sel.value || null);
        _saveMidiSettings();
        Toast.info(sel.value ? `MIDI input: ${sel.value}` : 'MIDI: listening to all devices');
      });

      row.appendChild(lbl);
      row.appendChild(sel);
      card.appendChild(row);

      // Channel filter
      const chRow = document.createElement('div');
      chRow.style.cssText = 'display:flex;align-items:center;gap:8px';

      const chLbl = document.createElement('span');
      chLbl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:38px';
      chLbl.textContent = 'Channel';

      const chSel = document.createElement('select');
      chSel.style.cssText = `flex:1;background:var(--bg);border:1px solid var(--border-dim);
        border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px`;
      chSel.innerHTML = '<option value="0">— All channels —</option>';
      for (let i = 1; i <= 16; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `Channel ${i}`;
        opt.selected = _midi.filterChannel === i;
        chSel.appendChild(opt);
      }
      chSel.addEventListener('change', () => {
        _midi.setFilterChannel(parseInt(chSel.value) || null);
        _saveMidiSettings();
        const ch = parseInt(chSel.value);
        Toast.info(ch ? `MIDI filter: channel ${ch} only` : 'MIDI: all channels');
      });

      chRow.appendChild(chLbl);
      chRow.appendChild(chSel);
      card.appendChild(chRow);

      // Connected device dots
      const dotsDiv = document.createElement('div');
      dotsDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid var(--border-dim)';
      _midi.deviceNames.forEach(name => {
        const dRow = document.createElement('div');
        dRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:3px';
        dRow.innerHTML = `
          <div class="status-dot"></div>
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">${name}</span>`;
        dotsDiv.appendChild(dRow);
      });
      card.appendChild(dotsDiv);
    }

    section.appendChild(card);
    _container.appendChild(section);
  }

  // ── Performance profile ──────────────────────────────────────

  function _renderPerfProfile() {
    const prof = _midi.perfProfile;

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:14px';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';

    const title = _sectionLabel('Performance profile');
    title.style.marginBottom = '0';
    title.style.flex = '1';

    const toggle = document.createElement('input');
    toggle.type    = 'checkbox';
    toggle.checked = prof.enabled;
    toggle.title   = 'Enable fixed CC mappings for footswitch (no MIDI learn needed)';
    toggle.style.cssText = 'accent-color:var(--accent);width:14px;height:14px;cursor:pointer';
    toggle.addEventListener('change', () => {
      _midi.setPerformanceProfile({ enabled: toggle.checked });
      _saveMidiSettings();
      _render();
      Toast.info(toggle.checked ? 'Performance profile ON' : 'Performance profile OFF');
    });

    headerRow.appendChild(title);
    headerRow.appendChild(toggle);
    section.appendChild(headerRow);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = `background:var(--bg-card);border:1px solid ${prof.enabled ? 'var(--accent)' : 'var(--border-dim)'};
      border-radius:5px;padding:10px;opacity:${prof.enabled ? '1' : '0.5'}`;

    const desc = document.createElement('p');
    desc.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);line-height:1.6;margin-bottom:10px';
    desc.textContent = 'Fixed mappings that work without MIDI learn. Designed for the Hotone Ampero Control and similar footswitches. All messages on the configured channel.';
    card.appendChild(desc);

    // Channel selector for performance profile
    const chRow = document.createElement('div');
    chRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';
    const chLbl = document.createElement('span');
    chLbl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:56px';
    chLbl.textContent = 'MIDI ch';
    const chSel = document.createElement('select');
    chSel.style.cssText = `background:var(--bg);border:1px solid var(--border-dim);
      border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 6px`;
    for (let i = 1; i <= 16; i++) {
      const opt = document.createElement('option');
      opt.value = String(i - 1);
      opt.textContent = `Channel ${i}`;
      opt.selected = prof.channel === i - 1;
      chSel.appendChild(opt);
    }
    chSel.addEventListener('change', () => {
      _midi.setPerformanceProfile({ channel: parseInt(chSel.value) });
      _saveMidiSettings();
    });
    chRow.appendChild(chLbl);
    chRow.appendChild(chSel);
    card.appendChild(chRow);

    // Fixed mapping table
    const rows = [
      { label: 'CC 64 → 127',  desc: 'Start / trigger current scene', action: 'scene:play'  },
      { label: 'CC 64 → 0',    desc: 'Stop playback',                  action: 'scene:stop'  },
      { label: 'CC 65',        desc: 'Previous scene',                 action: 'scene:prev'  },
      { label: 'CC 66',        desc: 'Next scene',                     action: 'scene:next'  },
      { label: 'PC 0-127',     desc: 'Jump to scene N (PC 0 = scene 1)', action: 'scene:jump:N' },
    ];

    const table = document.createElement('div');
    table.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    rows.forEach(({ label, desc, action }) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:8px';
      r.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:64px">${label}</span>
        <span style="flex:1;font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">${desc}</span>
        <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim);
                     background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;
                     padding:1px 5px">${action}</span>`;
      table.appendChild(r);
    });
    card.appendChild(table);

    section.appendChild(card);
    _container.appendChild(section);
  }

  // ── MIDI Learn ───────────────────────────────────────────────

  function _renderLearn() {
    const section = document.createElement('div');
    section.style.marginBottom = '14px';

    const title = _sectionLabel('MIDI learn');
    section.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:10px';
    desc.textContent = 'Click a parameter in the PARAMS tab, then press Learn and move a knob on your controller.';
    section.appendChild(desc);

    const btn = document.createElement('button');
    btn.id = 'btn-midi-learn';
    btn.className = `btn ${_midi.isLearning ? 'danger' : 'accent'}`;
    btn.style.width = '100%';
    btn.textContent = _midi.isLearning ? '⏹ Cancel learn' : '⏺ Start learn';
    btn.addEventListener('click', () => {
      if (_midi.isLearning) {
        _midi.stopLearn();
      } else {
        window.dispatchEvent(new CustomEvent('vael:midi-learn-requested'));
      }
      refresh();
    });
    section.appendChild(btn);

    if (_midi.isLearning) {
      const pulse = document.createElement('div');
      pulse.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:#ff6b6b;' +
        'margin-top:8px;text-align:center;animation:pulse 1s ease-in-out infinite';
      pulse.textContent = 'Waiting for MIDI input…';
      section.appendChild(pulse);
    }

    _container.appendChild(section);
  }

  // ── Param links ──────────────────────────────────────────────

  function _renderLinks() {
    const links = _midi.links;

    const section = document.createElement('div');
    section.style.marginBottom = '14px';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';

    const title = _sectionLabel(`Param links (${links.length})`);
    title.style.marginBottom = '0';
    headerRow.appendChild(title);

    if (links.length > 0) {
      const clrBtn = document.createElement('button');
      clrBtn.style.cssText = 'background:none;border:none;color:#ff4444;font-family:var(--font-mono);font-size:9px;cursor:pointer';
      clrBtn.textContent = 'Clear all';
      clrBtn.addEventListener('click', () => {
        if (confirm('Clear all MIDI param links?')) { _midi.clearLinks(); refresh(); }
      });
      headerRow.appendChild(clrBtn);
    }
    section.appendChild(headerRow);

    if (links.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);padding:4px 0';
      empty.textContent   = 'No param links yet. Use MIDI Learn above.';
      section.appendChild(empty);
    } else {
      links.forEach(link => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 8px;
          background:var(--bg-card);border:1px solid var(--border-dim);
          border-radius:4px;margin-bottom:4px`;

        const layer = _layers.layers.find(l => l.id === link.layerId);
        const layerName = layer?.name ?? link.layerId;

        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:54px">
            CC${link.cc} ch${link.channel + 1}
          </span>
          <span style="flex:1;font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">
            ${layerName} · ${link.paramId}
          </span>
          <button class="link-del" data-ch="${link.channel}" data-cc="${link.cc}"
            style="background:none;border:none;color:#454560;cursor:pointer;font-size:10px">✕</button>`;

        row.querySelector('.link-del').addEventListener('click', e => {
          _midi.removeLink(parseInt(e.target.dataset.ch), parseInt(e.target.dataset.cc));
          refresh();
        });

        section.appendChild(row);
      });
    }

    _container.appendChild(section);
  }

  // ── Global learned actions (next/prev + custom) ───────────────

  function _renderGlobalActions() {
    const section = document.createElement('div');
    section.style.cssText = 'border-top:1px solid var(--border-dim);padding-top:12px;margin-top:4px';

    const title = _sectionLabel('Custom MIDI learn actions');
    section.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);line-height:1.6;margin-bottom:10px';
    desc.textContent = 'Map additional MIDI notes or CCs to scene actions. These are in addition to the Performance Profile above.';
    section.appendChild(desc);

    const GLOBAL_ACTIONS = [
      { action: 'scene:next',  label: '→ Next scene'       },
      { action: 'scene:prev',  label: '← Prev scene'       },
      { action: 'scene:play',  label: '▶ Play / trigger'   },
      { action: 'scene:stop',  label: '⏹ Stop'             },
    ];

    GLOBAL_ACTIONS.forEach(({ action, label }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';

      const existing = _midi.getGlobalLinks().find(l => l.action === action);
      const keyLabel = existing ? _formatGlobalKey(existing.key) : '—';

      row.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text);flex:1">${label}</span>
        <span class="gl-key" style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:60px;text-align:right">${keyLabel}</span>
        <button class="gl-learn btn" style="font-size:8px;padding:3px 8px">Learn</button>
        ${existing ? `<button class="gl-del btn" style="font-size:8px;padding:3px 6px;color:#ff4444">✕</button>` : ''}
      `;

      row.querySelector('.gl-learn').addEventListener('click', (e) => {
        e.target.textContent = 'Press key…';
        e.target.style.background = 'var(--accent)';
        e.target.style.color = 'var(--bg)';
        _midi.startLearnGlobal(action);
        const origOnLink = _midi.onLink;
        _midi.onLink = (link) => {
          if (origOnLink) origOnLink(link);
          _midi.onLink = origOnLink;
          refresh();
        };
      });

      const delBtn = row.querySelector('.gl-del');
      if (delBtn && existing) {
        delBtn.addEventListener('click', () => {
          _midi.removeGlobalLink(existing.key);
          refresh();
        });
      }

      section.appendChild(row);
    });

    _container.appendChild(section);
  }

  // ── Persist settings ─────────────────────────────────────────

  function _saveMidiSettings() {
    try {
      localStorage.setItem('vael-midi-settings', JSON.stringify(_midi.toJSON()));
    } catch (_) {}
  }

  // ── Helpers ──────────────────────────────────────────────────

  function _sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'section-label';
    el.style.marginBottom = '8px';
    el.textContent = text;
    return el;
  }

  function _formatGlobalKey(key) {
    const parts = key.split('-');
    if (parts[0] === 'note') return `Note ${parts[2]} ch${parseInt(parts[1]) + 1}`;
    if (parts[0] === 'cc')   return `CC${parts[2]} ch${parseInt(parts[1]) + 1}`;
    return key;
  }

  function refresh() {
    _render();
  }

  return { init, refresh };

})();
