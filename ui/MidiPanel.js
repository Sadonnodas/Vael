/**
 * ui/MidiPanel.js
 * Renders the MIDI tab content.
 * Shows connected devices, learn mode button, and active link list.
 * Call MidiPanel.init(midiEngine, layerStack) once on startup.
 * Call MidiPanel.refresh() to re-render the link list.
 */

const MidiPanel = (() => {

  let _midi       = null;
  let _layers     = null;
  let _container  = null;

  // ── Init ─────────────────────────────────────────────────────

  function init(midiEngine, layerStack, container) {
    _midi      = midiEngine;
    _layers    = layerStack;
    _container = container;

    _midi.onDeviceChange = () => refresh();
    _midi.onLink         = ()  => refresh();

    _render();
  }

  // ── Render ───────────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    // Availability check
    if (!_midi.isAvailable) {
      _container.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);
                    line-height:1.7;padding:8px 0">
          MIDI not available.<br>
          Use Chrome and connect a USB controller.<br><br>
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

    // Devices section
    const devSection = document.createElement('div');
    devSection.innerHTML = `
      <div class="section-label">Devices</div>
      <div class="card" style="margin-bottom:14px">
        ${_midi.deviceNames.length === 0
          ? `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">
               No MIDI devices detected.<br>Connect a controller and refresh.
             </div>`
          : _midi.deviceNames.map(name => `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div class="status-dot"></div>
                <span style="font-family:var(--font-mono);font-size:9px;color:var(--text)">
                  ${name}
                </span>
              </div>`).join('')
        }
      </div>
    `;
    _container.appendChild(devSection);

    // Clock sync section
    const clockSection = document.createElement('div');
    clockSection.style.marginBottom = '14px';
    const clockActive = _midi.clockSync && _midi.clockBpm > 0;
    clockSection.innerHTML = `
      <div class="section-label">MIDI Clock Sync</div>
      <p style="font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:10px">
        Receive MIDI clock from a DAW or drum machine. Overrides the beat detector BPM when active.
      </p>
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                  background:var(--bg-card);border:1px solid var(--border-dim);
                  border-radius:5px;margin-bottom:8px">
        <div class="status-dot ${clockActive ? '' : 'inactive'}"></div>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text);flex:1">
          ${clockActive ? `Synced — ${_midi.clockBpm} BPM` : 'Waiting for clock signal…'}
        </span>
        ${clockActive ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">${_midi.clockBpm} BPM</span>` : ''}
      </div>
      <button id="btn-clock-reset" class="btn" style="width:100%;font-size:9px;color:var(--text-dim)">
        Reset clock sync
      </button>
    `;
    _container.appendChild(clockSection);

    clockSection.querySelector('#btn-clock-reset')?.addEventListener('click', () => {
      _midi.clockSync    = false;
      _midi.clockBpm     = 0;
      _midi._clockPulses = [];
      refresh();
      Toast.info('MIDI clock sync reset');
    });

    // Learn mode section
    const learnSection = document.createElement('div');
    learnSection.style.marginBottom = '14px';
    learnSection.innerHTML = `
      <div class="section-label">MIDI Learn</div>
      <p style="font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:10px">
        Click a parameter in the PARAMS tab, then press Learn and move a knob on your controller.
      </p>
      <button id="btn-midi-learn" class="btn ${_midi.isLearning ? 'danger' : 'accent'}"
        style="width:100%">
        ${_midi.isLearning ? '⏹ Cancel learn' : '⏺ Start learn'}
      </button>
      ${_midi.isLearning ? `
        <div style="font-family:var(--font-mono);font-size:9px;color:#ff6b6b;
                    margin-top:8px;text-align:center;animation:pulse 1s ease-in-out infinite">
          Waiting for MIDI input…
        </div>` : ''}
    `;
    _container.appendChild(learnSection);

    document.getElementById('btn-midi-learn')?.addEventListener('click', () => {
      if (_midi.isLearning) {
        _midi.stopLearn();
      } else {
        // Learn will be triggered from ParamPanel via a global event
        window.dispatchEvent(new CustomEvent('vael:midi-learn-requested'));
      }
      refresh();
    });

    // Links section
    const links = _midi.links;
    const linksSection = document.createElement('div');
    linksSection.innerHTML = `
      <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Links (${links.length})</span>
        ${links.length > 0
          ? `<button id="btn-midi-clear" style="background:none;border:none;
               color:#ff4444;font-family:var(--font-mono);font-size:9px;cursor:pointer">
               Clear all
             </button>`
          : ''}
      </div>
    `;

    if (links.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);padding:8px 0';
      empty.textContent   = 'No links yet.';
      linksSection.appendChild(empty);
    } else {
      links.forEach(link => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-dim);
          border-radius: 4px;
          margin-bottom: 4px;
        `;

        // Find layer name
        const layer = _layers.layers.find(l => l.id === link.layerId);
        const layerName = layer?.name ?? link.layerId;

        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2);
                       min-width:54px">CC${link.cc} ch${link.channel}</span>
          <span style="flex:1;font-family:var(--font-mono);font-size:8px;color:var(--text-muted)">
            ${layerName} · ${link.paramId}
          </span>
          <button class="link-del" data-ch="${link.channel}" data-cc="${link.cc}"
            style="background:none;border:none;color:#454560;cursor:pointer;font-size:10px">✕</button>
        `;

        row.querySelector('.link-del').addEventListener('click', e => {
          const ch = parseInt(e.target.dataset.ch);
          const cc = parseInt(e.target.dataset.cc);
          _midi.removeLink(ch, cc);
          refresh();
        });

        linksSection.appendChild(row);
      });
    }

    _container.appendChild(linksSection);

    linksSection.querySelector('#btn-midi-clear')?.addEventListener('click', () => {
      if (confirm('Clear all MIDI links?')) { _midi.clearLinks(); refresh(); }
    });
  }

  function refresh() {
    _render();
  }

  return { init, refresh };

})();
