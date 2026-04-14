/**
 * ui/MidiPanel.js
 * Renders the MIDI tab content.
 *
 * Layout:
 *   1. Learn Mode toggle button (global — affects all panels)
 *   2. Input device selector + channel filter
 *   3. Unified mappings table (action links + param links)
 *      Columns: Type | Ch | Trigger | Action / Parameter | Min | Max | Delete
 *   4. Quick-add buttons for common actions (next/prev/play/stop/jump)
 *
 * Global learn mode is stored on window._vaelLearnMode (set in App.js).
 * Toggle via: window.dispatchEvent(new CustomEvent('vael:learn-mode-toggle'))
 *
 * Call MidiPanel.init(midiEngine, layerStack) once on startup.
 * Call MidiPanel.refresh() to re-render.
 */

const MidiPanel = (() => {

  let _midi       = null;
  let _layers     = null;
  let _container  = null;
  let _activityDot = null;
  let _activityTimer = null;

  // ── Init ─────────────────────────────────────────────────────

  function init(midiEngine, layerStack, container) {
    _midi      = midiEngine;
    _layers    = layerStack;
    _container = container;

    _midi.onDeviceChange = () => refresh();

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

    // Re-render when global learn mode changes
    window.addEventListener('vael:learn-mode-changed', () => refresh());

    _render();
  }

  // ── Activity dot in status bar ───────────────────────────────

  function _getActivityDot() {
    if (_activityDot && _activityDot.isConnected) return _activityDot;
    const existing = document.getElementById('midi-activity-dot');
    if (existing) { _activityDot = existing; return _activityDot; }

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
    _getActivityDot();

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

    _renderLearnToggle();
    _renderDevices();
    _renderMappingsTable();
    _renderQuickAdd();
  }

  // ── Learn Mode toggle ────────────────────────────────────────

  function _renderLearnToggle() {
    const isLearning = !!window._vaelLearnMode;

    const section = document.createElement('div');
    section.style.marginBottom = '14px';

    const btn = document.createElement('button');
    btn.className = `btn ${isLearning ? 'danger' : 'accent'}`;
    btn.style.cssText = 'width:100%;font-size:10px;padding:10px;letter-spacing:0.5px';
    btn.textContent   = isLearning ? '⏹ Exit MIDI Learn' : '⏺ Enter MIDI Learn';
    btn.title = isLearning
      ? 'Click any armable button or slider to arm it, then move a controller'
      : 'Enable MIDI learn mode — then click any button or slider to map it';
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('vael:learn-mode-toggle'));
    });
    section.appendChild(btn);

    if (isLearning) {
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:8px;font-family:var(--font-mono);font-size:8px;' +
        'color:var(--accent);text-align:center;line-height:1.6';
      hint.textContent = 'Click a param slider or scene button to arm it, then move a controller';
      section.appendChild(hint);
    }

    _container.appendChild(section);
  }

  // ── Devices section ──────────────────────────────────────────

  function _renderDevices() {
    const section = document.createElement('div');
    section.style.marginBottom = '14px';
    section.appendChild(_sectionLabel('Input device'));

    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '0';

    if (_midi.deviceNames.length === 0) {
      card.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">
        No MIDI devices detected.<br>Connect a controller and refresh.</div>`;
    } else {
      // Device selector
      const row = _flexRow('8px', '8px');

      const lbl = _monoSpan('Device', '8px', 'var(--text-dim)', 'min-width:38px');
      const sel = document.createElement('select');
      sel.style.cssText = `flex:1;background:var(--bg);border:1px solid var(--border-dim);
        border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px`;
      sel.innerHTML = '<option value="">— All devices —</option>';
      _midi.deviceNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        opt.selected = _midi.selectedDevice === name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        _midi.setSelectedDevice(sel.value || null);
        _save();
        Toast.info(sel.value ? `MIDI input: ${sel.value}` : 'MIDI: all devices');
      });
      row.appendChild(lbl); row.appendChild(sel);
      card.appendChild(row);

      // Channel filter
      const chRow = _flexRow('8px', '8px');
      const chLbl = _monoSpan('Channel', '8px', 'var(--text-dim)', 'min-width:38px');
      const chSel = document.createElement('select');
      chSel.style.cssText = `flex:1;background:var(--bg);border:1px solid var(--border-dim);
        border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px`;
      chSel.innerHTML = '<option value="0">— All channels —</option>';
      for (let i = 1; i <= 16; i++) {
        const opt = document.createElement('option');
        opt.value = String(i); opt.textContent = `Channel ${i}`;
        opt.selected = _midi.filterChannel === i;
        chSel.appendChild(opt);
      }
      chSel.addEventListener('change', () => {
        _midi.setFilterChannel(parseInt(chSel.value) || null);
        _save();
        const ch = parseInt(chSel.value);
        Toast.info(ch ? `MIDI filter: channel ${ch}` : 'MIDI: all channels');
      });
      chRow.appendChild(chLbl); chRow.appendChild(chSel);
      card.appendChild(chRow);

      // Device list
      const dotsDiv = document.createElement('div');
      dotsDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid var(--border-dim)';
      _midi.deviceNames.forEach(name => {
        const dRow = _flexRow('8px', '3px');
        dRow.innerHTML = `<div class="status-dot"></div>
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">${name}</span>`;
        dotsDiv.appendChild(dRow);
      });
      card.appendChild(dotsDiv);
    }

    section.appendChild(card);
    _container.appendChild(section);
  }

  // ── Unified mappings table ───────────────────────────────────

  function _renderMappingsTable() {
    const globalLinks = _midi.getGlobalLinks();
    const paramLinks  = _midi.links;
    const total = globalLinks.length + paramLinks.length;

    const section = document.createElement('div');
    section.style.marginBottom = '14px';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
    const title = _sectionLabel(`Mappings (${total})`);
    title.style.marginBottom = '0';
    headerRow.appendChild(title);

    if (total > 0) {
      const clrBtn = document.createElement('button');
      clrBtn.style.cssText = 'background:none;border:none;color:#ff4444;font-family:var(--font-mono);font-size:9px;cursor:pointer';
      clrBtn.textContent = 'Clear all';
      clrBtn.addEventListener('click', () => {
        if (!confirm('Clear ALL MIDI mappings (action links + param links)?')) return;
        _midi.clearLinks();
        _midi.getGlobalLinks().forEach(l => _midi.removeGlobalLink(l.key));
        _save();
        refresh();
      });
      headerRow.appendChild(clrBtn);
    }
    section.appendChild(headerRow);

    if (total === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);padding:4px 0;line-height:1.6';
      empty.textContent = 'No mappings yet. Enter Learn Mode then click a button or slider, or use Quick Add below.';
      section.appendChild(empty);
    } else {
      // Header row
      const thead = document.createElement('div');
      thead.style.cssText = 'display:grid;grid-template-columns:52px 32px 48px 1fr 44px 44px 22px;' +
        'gap:4px;padding:3px 6px;margin-bottom:3px';
      ['Type','Ch','#','Action / Param','Min','Max',''].forEach(h => {
        const c = document.createElement('span');
        c.style.cssText = 'font-family:var(--font-mono);font-size:7px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px';
        c.textContent = h;
        thead.appendChild(c);
      });
      section.appendChild(thead);

      // Global action link rows
      globalLinks.forEach(({ key, action }) => {
        section.appendChild(_buildActionRow(key, action));
      });

      // Param link rows
      paramLinks.forEach(link => {
        section.appendChild(_buildParamRow(link));
      });
    }

    _container.appendChild(section);
  }

  function _buildActionRow(key, action) {
    const parts = key.split('-');
    const type  = parts[0];                                 // 'cc' | 'note' | 'pc'
    const ch    = type === 'pc' ? parseInt(parts[1]) : parseInt(parts[1]);
    const num   = type === 'pc' ? '—' : parts[2];

    const typeLabel  = type === 'note' ? 'Note' : type.toUpperCase();
    const actionLabel = _actionLabel(action);

    const row = _mappingRow();
    row.dataset.key = key;

    // Type
    const typeSpan = _pill(typeLabel, 'var(--accent2)');
    // Ch
    const chSpan   = _mono(`${ch + 1}`, '8px', 'var(--text-muted)');
    // Number
    const numSpan  = _mono(num, '8px', 'var(--text-muted)');
    // Action
    const actSpan  = _mono(actionLabel, '8px', 'var(--text)', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    // Min / Max (empty for actions)
    const minSpan  = _mono('—', '8px', 'var(--text-dim)', 'text-align:center');
    const maxSpan  = _mono('—', '8px', 'var(--text-dim)', 'text-align:center');
    // Delete
    const del = _deleteBtn(() => {
      _midi.removeGlobalLink(key);
      _save();
      refresh();
    });

    [typeSpan, chSpan, numSpan, actSpan, minSpan, maxSpan, del].forEach(el => row.appendChild(el));
    return row;
  }

  function _buildParamRow(link) {
    const layer     = _layers?.layers.find(l => l.id === link.layerId);
    const layerName = layer?.name ?? link.layerId;
    const missing   = !layer;

    const row = _mappingRow();
    if (missing) row.style.opacity = '0.55';

    // Type
    const typeSpan = _pill('CC', 'var(--accent)');
    // Ch
    const chSpan   = _mono(`${link.channel + 1}`, '8px', 'var(--text-muted)');
    // Number
    const numSpan  = _mono(`${link.cc}`, '8px', 'var(--text-muted)');
    // Param label
    const actSpan  = document.createElement('div');
    actSpan.style.cssText = 'flex:1;overflow:hidden;min-width:0';
    actSpan.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:8px;color:${missing ? '#ff6666' : 'var(--text)'};
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${missing ? '⚠ ' : ''}${layerName} · ${link.paramId}
      </div>`;

    // Min input
    const minIn = _rangeInput(link.min, (v) => { _midi.updateLinkRange(link.channel, link.cc, v, link.max); _save(); });
    // Max input
    const maxIn = _rangeInput(link.max, (v) => { _midi.updateLinkRange(link.channel, link.cc, link.min, v); _save(); });
    // Delete
    const del = _deleteBtn(() => {
      _midi.removeLink(link.channel, link.cc);
      _save();
      refresh();
    });

    [typeSpan, chSpan, numSpan, actSpan, minIn, maxIn, del].forEach(el => row.appendChild(el));
    return row;
  }

  // ── Quick-add action bindings ────────────────────────────────

  function _renderQuickAdd() {
    const section = document.createElement('div');
    section.style.cssText = 'border-top:1px solid var(--border-dim);padding-top:12px';

    section.appendChild(_sectionLabel('Quick-add action mapping'));

    const desc = document.createElement('p');
    desc.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);line-height:1.6;margin-bottom:10px';
    desc.textContent = 'Click a button to arm that action, then move a CC, press a note, or send a PC on your controller.';
    section.appendChild(desc);

    const ACTIONS = [
      { action: 'scene:next',  label: '→ Next scene'            },
      { action: 'scene:prev',  label: '← Prev scene'            },
      { action: 'scene:play',  label: '▶ Play / trigger'        },
      { action: 'scene:stop',  label: '⏹ Stop'                  },
      { action: 'scene:jump',  label: '⬇ PC → Jump to scene'   },
    ];

    ACTIONS.forEach(({ action, label }) => {
      const existing = _midi.getGlobalLinks().find(l => l.action === action ||
        (action === 'scene:jump' && l.action === 'scene:jump'));
      const isArmed  = _midi.isLearning && _midi._learnAction === action;

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';

      const lbl = _mono(label, '9px', 'var(--text)', 'flex:1');

      // Current binding indicator
      const keyLbl = document.createElement('span');
      keyLbl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:64px;text-align:right';
      keyLbl.textContent = existing ? _formatKey(existing.key) : '—';

      const btn = document.createElement('button');
      btn.className = isArmed ? 'btn danger' : 'btn';
      btn.style.cssText = 'font-size:8px;padding:3px 8px;flex-shrink:0';
      btn.textContent = isArmed ? 'Press key…' : 'Learn';

      if (isArmed) {
        btn.style.animation = 'midi-learn-pulse 1.1s ease-in-out infinite';
      }

      btn.addEventListener('click', () => {
        _midi.startLearnGlobal(action);
        // Override onLink once to refresh panel when the link arrives
        const prev = _midi.onLink;
        _midi.onLink = (link) => {
          if (prev) prev(link);
          _midi.onLink = prev;  // restore (App.js onLink also saves settings)
          refresh();
        };
        refresh();   // immediately show "Press key…" state
        Toast.info(`Arm: ${label} — now move a controller`);
      });

      row.appendChild(lbl);
      row.appendChild(keyLbl);
      row.appendChild(btn);

      if (existing) {
        const del = _deleteBtn(() => {
          _midi.removeGlobalLink(existing.key);
          _save();
          refresh();
        });
        row.appendChild(del);
      }

      section.appendChild(row);
    });

    _container.appendChild(section);
  }

  // ── Save settings ────────────────────────────────────────────

  function _save() {
    if (typeof window._saveMidiSettings === 'function') {
      window._saveMidiSettings();
    } else {
      try { localStorage.setItem('vael-midi-settings', JSON.stringify(_midi.toJSON())); } catch (_) {}
    }
  }

  // ── DOM helpers ──────────────────────────────────────────────

  function _sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'section-label';
    el.style.marginBottom = '8px';
    el.textContent = text;
    return el;
  }

  function _mono(text, size, color, extra = '') {
    const el = document.createElement('span');
    el.style.cssText = `font-family:var(--font-mono);font-size:${size};color:${color};${extra}`;
    el.textContent = text;
    return el;
  }

  function _monoSpan(text, size, color, extra = '') {
    return _mono(text, size, color, extra);
  }

  function _pill(text, color) {
    const el = document.createElement('span');
    el.style.cssText = `font-family:var(--font-mono);font-size:7px;
      background:color-mix(in srgb,${color} 18%,transparent);
      color:${color};border:1px solid color-mix(in srgb,${color} 40%,transparent);
      border-radius:3px;padding:1px 5px;white-space:nowrap`;
    el.textContent = text;
    return el;
  }

  function _mappingRow() {
    const row = document.createElement('div');
    row.style.cssText = `display:grid;grid-template-columns:52px 32px 48px 1fr 44px 44px 22px;
      gap:4px;align-items:center;padding:5px 6px;
      background:var(--bg-card);border:1px solid var(--border-dim);
      border-radius:4px;margin-bottom:3px`;
    return row;
  }

  function _flexRow(gap, marginBottom) {
    const el = document.createElement('div');
    el.style.cssText = `display:flex;align-items:center;gap:${gap};margin-bottom:${marginBottom}`;
    return el;
  }

  function _rangeInput(value, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'number';
    inp.value = typeof value === 'number' ? value.toFixed(2) : value;
    inp.step  = '0.01'; inp.min = '-10'; inp.max = '10';
    inp.style.cssText = `font-family:var(--font-mono);font-size:8px;color:var(--accent);
      background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;
      width:42px;padding:2px 4px;text-align:right`;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) onChange(v);
    });
    return inp;
  }

  function _deleteBtn(onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;color:#454560;cursor:pointer;font-size:11px;padding:0;line-height:1;width:20px;text-align:center';
    btn.textContent = '✕';
    btn.title = 'Remove mapping';
    btn.addEventListener('mouseenter', () => btn.style.color = '#ff6666');
    btn.addEventListener('mouseleave', () => btn.style.color = '#454560');
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _formatKey(key) {
    const parts = key.split('-');
    if (parts[0] === 'note') return `Note ${parts[2]} ch${parseInt(parts[1]) + 1}`;
    if (parts[0] === 'cc')   return `CC${parts[2]} ch${parseInt(parts[1]) + 1}`;
    if (parts[0] === 'pc')   return `PC ch${parseInt(parts[1]) + 1}`;
    return key;
  }

  function _actionLabel(action) {
    const map = {
      'scene:next':  '→ Next scene',
      'scene:prev':  '← Prev scene',
      'scene:play':  '▶ Play / trigger',
      'scene:stop':  '⏹ Stop',
      'scene:jump':  '⬇ Jump to scene (PC)',
    };
    if (action.startsWith('scene:jump:')) return `⬇ Jump to scene ${action.split(':')[2]}`;
    return map[action] ?? action;
  }

  function refresh() {
    _render();
  }

  return { init, refresh };

})();
