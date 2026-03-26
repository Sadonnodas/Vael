/**
 * ui/PerformanceMode.js
 * Manages fullscreen performance mode.
 * Hides the sidebar, shows a minimal floating HUD.
 * Keyboard shortcuts for scene navigation.
 */

class PerformanceMode {

  constructor({ setlist, audio, beatDetector, layerStack }) {
    this._setlist      = setlist;
    this._audio        = audio;
    this._beat         = beatDetector;
    this._layers       = layerStack;
    this._active       = false;
    this._hudTimeout   = null;
    this._beatFlash    = 0;   // 0–1 flash value that decays each frame

    this._buildHUD();
    this._buildSetlistPanel();
    this._bindKeys();

    // React to scene changes
    this._setlist.onSceneChange = (index, entry) => {
      this._updateHUD();
      this._updateSetlistPanel();
    };
  }

  // ── HUD ──────────────────────────────────────────────────────

  _buildHUD() {
    // Remove existing
    document.getElementById('vael-perf-hud')?.remove();

    const hud = document.createElement('div');
    hud.id = 'vael-perf-hud';
    hud.style.cssText = `
      display: none;
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.55);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.7);
      backdrop-filter: blur(12px);
      z-index: 200;
      display: none;
      gap: 20px;
      align-items: center;
      white-space: nowrap;
      transition: opacity 0.4s;
      pointer-events: none;
    `;

    hud.innerHTML = `
      <span id="phud-scene"   style="color:#00d4aa;font-weight:600">—</span>
      <span id="phud-sep1"    style="opacity:0.3">·</span>
      <span id="phud-next"    style="opacity:0.5">next: —</span>
      <span id="phud-sep2"    style="opacity:0.3">·</span>
      <span id="phud-bpm"     style="color:#a78bfa">— bpm</span>
      <span id="phud-sep3"    style="opacity:0.3">·</span>
      <span id="phud-beat"    style="opacity:0">●</span>
      <span id="phud-keys"    style="opacity:0.3;font-size:9px">← → scene  ·  F exit  ·  S setlist</span>
    `;

    document.body.appendChild(hud);
    this._hud = hud;
  }

  _updateHUD() {
    const current = this._setlist.current;
    const next    = this._setlist.next_entry;
    document.getElementById('phud-scene').textContent = current?.name ?? '—';
    document.getElementById('phud-next').textContent  = `next: ${next?.name ?? '—'}`;
    document.getElementById('phud-bpm').textContent   =
      this._beat.bpm > 0 ? `${this._beat.bpm} bpm` : '— bpm';
  }

  // Call this every animation frame from App.js
  tick(dt) {
    if (!this._active) return;

    // Beat flash decay
    if (this._beat.isBeat) {
      this._beatFlash = 1;
      document.getElementById('phud-bpm').textContent =
        this._beat.bpm > 0 ? `${this._beat.bpm} bpm` : '— bpm';
    }
    this._beatFlash = Math.max(0, this._beatFlash - dt * 5);

    const beatEl = document.getElementById('phud-beat');
    if (beatEl) {
      beatEl.style.opacity = this._beatFlash.toFixed(2);
      beatEl.style.color   = `hsl(${160 + this._beatFlash * 30}, 80%, 65%)`;
    }
  }

  // ── Setlist panel ────────────────────────────────────────────

  _buildSetlistPanel() {
    document.getElementById('vael-setlist-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'vael-setlist-panel';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(10,10,20,0.92);
      border: 1px solid rgba(0,212,170,0.3);
      border-radius: 10px;
      padding: 24px;
      min-width: 340px;
      max-width: 480px;
      max-height: 70vh;
      overflow-y: auto;
      z-index: 300;
      backdrop-filter: blur(16px);
      font-family: 'JetBrains Mono', monospace;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-size:11px;letter-spacing:2px;color:#00d4aa">SETLIST</span>
        <button id="sl-close" style="background:none;border:none;color:#7878a0;
          cursor:pointer;font-size:16px;line-height:1">✕</button>
      </div>

      <div id="sl-entries" style="margin-bottom:16px"></div>

      <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:14px">
        <div style="font-size:9px;color:#454560;margin-bottom:8px">ADD CURRENT SCENE</div>
        <div style="display:flex;gap:6px">
          <input id="sl-scene-name" type="text" placeholder="Scene name"
            style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                   border-radius:4px;color:#d4d4e0;font-family:inherit;font-size:10px;padding:6px 8px" />
          <button id="sl-add-scene" style="
            background:rgba(0,212,170,0.15);border:1px solid rgba(0,212,170,0.4);
            border-radius:4px;color:#00d4aa;font-family:inherit;font-size:10px;
            padding:6px 12px;cursor:pointer">+ Add</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button id="sl-save-file" style="flex:1;background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#7878a0;
            font-family:inherit;font-size:9px;padding:5px;cursor:pointer">↓ Save setlist</button>
          <button id="sl-load-file" style="flex:1;background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#7878a0;
            font-family:inherit;font-size:9px;padding:5px;cursor:pointer">↑ Load setlist</button>
        </div>
        <input type="file" id="sl-load-input" accept=".json" style="display:none" />
      </div>
    `;

    document.body.appendChild(panel);
    this._setlistPanel = panel;
    this._bindSetlistEvents();
  }

  _renderSetlistEntries() {
    const container = document.getElementById('sl-entries');
    if (!container) return;
    container.innerHTML = '';

    if (this._setlist.count === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;color:#454560;font-size:10px">
          No scenes in setlist yet.<br>Add the current scene above.
        </div>`;
      return;
    }

    this._setlist.entries.forEach((entry, i) => {
      const isCurrent = i === this._setlist.currentIndex;
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 5px;
        margin-bottom: 4px;
        background: ${isCurrent ? 'rgba(0,212,170,0.12)' : 'rgba(255,255,255,0.04)'};
        border: 1px solid ${isCurrent ? 'rgba(0,212,170,0.4)' : 'rgba(255,255,255,0.06)'};
        cursor: pointer;
        transition: background 0.15s;
      `;

      row.innerHTML = `
        <span style="font-size:9px;color:${isCurrent ? '#00d4aa' : '#454560'};
              min-width:18px;text-align:center">${i + 1}</span>
        <span style="flex:1;font-size:10px;color:${isCurrent ? '#fff' : '#d4d4e0'}">
          ${entry.name}
        </span>
        ${isCurrent ? '<span style="font-size:9px;color:#00d4aa">▶ now</span>' : ''}
        <button class="sl-goto" data-index="${i}"
          style="background:none;border:none;color:#7878a0;cursor:pointer;font-size:10px"
          title="Load this scene">→</button>
        <button class="sl-del" data-index="${i}"
          style="background:none;border:none;color:#454560;cursor:pointer;font-size:10px"
          title="Remove">✕</button>
      `;

      row.addEventListener('dblclick', () => this._setlist.goto(i));
      row.querySelector('.sl-goto').addEventListener('click', e => {
        e.stopPropagation();
        this._setlist.goto(i);
        this._renderSetlistEntries();
      });
      row.querySelector('.sl-del').addEventListener('click', e => {
        e.stopPropagation();
        this._setlist.removeEntry(i);
        this._renderSetlistEntries();
      });

      container.appendChild(row);
    });
  }

  _updateSetlistPanel() {
    if (this._setlistPanel.style.display !== 'none') {
      this._renderSetlistEntries();
    }
  }

  _bindSetlistEvents() {
    document.getElementById('sl-close').addEventListener('click', () => {
      this._setlistPanel.style.display = 'none';
    });

    document.getElementById('sl-add-scene').addEventListener('click', () => {
      const nameEl = document.getElementById('sl-scene-name');
      const name   = nameEl.value.trim() || `Scene ${this._setlist.count + 1}`;

      // Capture current layer stack as a preset
      const preset = {
        name,
        layers: this._layers.layers.map(layer => ({
          type:      layer.constructor.name,
          id:        layer.id,
          name:      layer.name,
          visible:   layer.visible,
          opacity:   layer.opacity,
          blendMode: layer.blendMode,
          params:    layer.params ? { ...layer.params } : {},
        })),
      };

      this._setlist.addEntry({ name, preset });
      nameEl.value = '';
      this._renderSetlistEntries();
      this._updateHUD();
    });

    document.getElementById('sl-save-file').addEventListener('click', () => {
      this._setlist.saveToFile('vael-setlist.json');
    });

    document.getElementById('sl-load-file').addEventListener('click', () => {
      document.getElementById('sl-load-input').click();
    });

    // Fade duration slider — dispatch event so App.js can update setlist engine
    const fadeDurEl  = document.getElementById('sl-fade-dur');
    const fadeValEl  = document.getElementById('sl-fade-val');
    if (fadeDurEl) {
      fadeDurEl.addEventListener('input', () => {
        const v = parseFloat(fadeDurEl.value);
        if (fadeValEl) fadeValEl.textContent = `${v.toFixed(1)}s`;
        document.dispatchEvent(new CustomEvent('vael:fade-duration', { detail: v }));
      });
    }

    document.getElementById('sl-load-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await this._setlist.loadFromFile(file);
        this._renderSetlistEntries();
        this._updateHUD();
        if (this._setlist.currentIndex >= 0) {
          this._setlist.goto(this._setlist.currentIndex);
        }
      } catch (err) {
        alert('Could not load setlist: ' + err.message);
      }
      e.target.value = '';
    });
  }

  // ── Toggle ───────────────────────────────────────────────────

  enter() {
    this._active = true;
    document.body.classList.add('performance');
    this._hud.style.display = 'flex';
    this._showHUD();
    this._updateHUD();
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  exit() {
    this._active = false;
    document.body.classList.remove('performance');
    this._hud.style.display = 'none';
    this._setlistPanel.style.display = 'none';
    if (document.fullscreenElement) document.exitFullscreen?.();
  }

  toggle() {
    this._active ? this.exit() : this.enter();
  }

  get active() { return this._active; }

  // ── HUD auto-hide ────────────────────────────────────────────

  _showHUD() {
    this._hud.style.opacity = '1';
    clearTimeout(this._hudTimeout);
    this._hudTimeout = setTimeout(() => {
      this._hud.style.opacity = '0';
    }, 3000);
  }

  _onMouseMove() {
    if (!this._active) return;
    this._hud.style.opacity = '1';
    clearTimeout(this._hudTimeout);
    this._hudTimeout = setTimeout(() => {
      this._hud.style.opacity = '0';
    }, 3000);
  }

  // ── Keyboard ─────────────────────────────────────────────────

  _bindKeys() {
    document.addEventListener('mousemove', () => this._onMouseMove());

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      switch (e.key) {
        case 'f':
        case 'F':
          e.preventDefault();
          this.toggle();
          break;

        case 'ArrowRight':
          if (this._active) {
            e.preventDefault();
            this._setlist.next();
            this._showHUD();
          }
          break;

        case 'ArrowLeft':
          if (this._active) {
            e.preventDefault();
            this._setlist.prev();
            this._showHUD();
          }
          break;

        case 's':
        case 'S':
          if (this._active) {
            e.preventDefault();
            const isOpen = this._setlistPanel.style.display !== 'none';
            this._setlistPanel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) this._renderSetlistEntries();
          }
          break;

        case 'Escape':
          if (this._setlistPanel.style.display !== 'none') {
            this._setlistPanel.style.display = 'none';
          } else if (this._active) {
            this.exit();
          }
          break;

        // Number keys 1–9 jump to that setlist entry
        default:
          if (this._active && e.key >= '1' && e.key <= '9') {
            const idx = parseInt(e.key) - 1;
            this._setlist.goto(idx);
            this._showHUD();
          }
      }
    });
  }
}