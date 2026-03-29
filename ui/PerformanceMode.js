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
      background: rgba(0,0,0,0.65);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 12px 20px;
      font-family: 'JetBrains Mono', monospace;
      color: rgba(255,255,255,0.8);
      backdrop-filter: blur(16px);
      z-index: 200;
      align-items: center;
      gap: 16px;
      white-space: nowrap;
      transition: opacity 0.4s;
      pointer-events: none;
    `;

    hud.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <!-- Scene name large -->
        <div id="phud-scene" style="color:#00d4aa;font-weight:700;font-size:16px;
             letter-spacing:1px;text-align:center;max-width:400px;
             white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>
        <!-- Progress row -->
        <div style="display:flex;align-items:center;gap:14px;font-size:10px">
          <span id="phud-index" style="opacity:0.4">—</span>
          <span style="opacity:0.2">·</span>
          <span id="phud-bpm" style="color:#a78bfa">— bpm</span>
          <span style="opacity:0.2">·</span>
          <span id="phud-beat" style="opacity:0;font-size:14px">●</span>
          <span style="opacity:0.2">·</span>
          <span id="phud-time" style="opacity:0.4">0:00</span>
        </div>
      </div>

      <!-- Next scene preview -->
      <div id="phud-next-block" style="display:flex;align-items:center;gap:8px;
           border-left:1px solid rgba(255,255,255,0.1);padding-left:14px">
        <div style="font-size:8px;opacity:0.4;text-transform:uppercase;letter-spacing:1px;
                    writing-mode:vertical-lr;transform:rotate(180deg)">next</div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <img id="phud-next-thumb" src="" style="width:60px;height:34px;border-radius:3px;
               object-fit:cover;background:rgba(255,255,255,0.05);display:block" />
          <div id="phud-next-name" style="font-size:9px;opacity:0.5;
               max-width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>
        </div>
      </div>

      <!-- Hint -->
      <div style="font-size:8px;opacity:0.2;border-left:1px solid rgba(255,255,255,0.1);
                  padding-left:14px;line-height:1.8">
        ← → scene<br>S setlist<br>F exit
      </div>
    `;

    document.body.appendChild(hud);
    this._hud = hud;
  }

  _updateHUD() {
    const current = this._setlist.current;
    const next    = this._setlist.next_entry;
    const idx     = this._setlist.currentIndex;
    const total   = this._setlist.count;

    const sceneEl = document.getElementById('phud-scene');
    const indexEl = document.getElementById('phud-index');
    const nextName = document.getElementById('phud-next-name');
    const nextThumb = document.getElementById('phud-next-thumb');
    const nextBlock = document.getElementById('phud-next-block');

    if (sceneEl) sceneEl.textContent = current?.name ?? '—';
    if (indexEl) indexEl.textContent = total > 0 ? `${idx + 1} / ${total}` : '—';
    if (nextName) nextName.textContent = next?.name ?? '—';
    if (nextThumb) {
      if (next?.thumbnail) {
        nextThumb.src = next.thumbnail;
        nextThumb.style.display = 'block';
      } else {
        nextThumb.src = '';
        nextThumb.style.background = 'rgba(255,255,255,0.05)';
      }
    }
    if (nextBlock) nextBlock.style.display = total > 1 ? 'flex' : 'none';
    if (document.getElementById('phud-bpm')) {
      document.getElementById('phud-bpm').textContent =
        this._beat.bpm > 0 ? `${this._beat.bpm} bpm` : '— bpm';
    }
  }

  tick(dt) {
    if (!this._active) return;

    if (this._beat.isBeat) {
      this._beatFlash = 1;
      const bpmEl = document.getElementById('phud-bpm');
      if (bpmEl) bpmEl.textContent = this._beat.bpm > 0 ? `${this._beat.bpm} bpm` : '— bpm';
    }
    this._beatFlash = Math.max(0, this._beatFlash - dt * 5);

    const beatEl = document.getElementById('phud-beat');
    if (beatEl) {
      beatEl.style.opacity = this._beatFlash.toFixed(2);
      beatEl.style.color   = `hsl(${160 + this._beatFlash * 30}, 80%, 65%)`;
    }

    // Audio time
    const timeEl = document.getElementById('phud-time');
    if (timeEl && this._audio) {
      const pos = this._audio.currentTime || 0;
      const dur = this._audio.duration    || 0;
      timeEl.textContent = dur > 0
        ? `${VaelMath.formatTime(pos)} / ${VaelMath.formatTime(dur)}`
        : VaelMath.formatTime(pos);
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
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <span style="font-size:9px;color:#7878a0;min-width:70px">Duration</span>
          <input id="sl-fade-dur" type="range" min="0" max="4" step="0.1" value="1.5"
            style="flex:1;accent-color:#00d4aa" />
          <span id="sl-fade-val" style="font-size:9px;color:#00d4aa;min-width:28px">1.5s</span>
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <span style="font-size:9px;color:#7878a0;min-width:70px">Transition</span>
          <select id="sl-transition-type" style="flex:1;background:rgba(255,255,255,0.06);
            border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#d4d4e0;
            font-family:inherit;font-size:9px;padding:4px 6px">
            <option value="crossfade">Crossfade</option>
            <option value="flash">Flash</option>
            <option value="blur">Blur</option>
            <option value="cut">Cut (instant)</option>
          </select>
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
        flex-direction: column;
        gap: 0;
        padding: 7px 10px;
        border-radius: 5px;
        margin-bottom: 4px;
        background: ${isCurrent ? 'rgba(0,212,170,0.12)' : 'rgba(255,255,255,0.04)'};
        border: 1px solid ${isCurrent ? 'rgba(0,212,170,0.4)' : 'rgba(255,255,255,0.06)'};
        cursor: pointer;
      `;

      // Thumbnail
      const thumbHtml = entry.thumbnail
        ? `<img src="${entry.thumbnail}" class="sl-thumb" style="width:48px;height:27px;border-radius:3px;
             object-fit:cover;flex-shrink:0;border:1px solid rgba(255,255,255,0.1)">`
        : `<div class="sl-thumb" style="width:48px;height:27px;border-radius:3px;background:rgba(255,255,255,0.05);
             flex-shrink:0;display:flex;align-items:center;justify-content:center;
             font-size:8px;color:rgba(255,255,255,0.2)">—</div>`;

      // Main row
      const mainRow = document.createElement('div');
      mainRow.style.cssText = 'display:flex;align-items:center;gap:10px';
      mainRow.innerHTML = `
        <span style="font-size:9px;color:${isCurrent ? '#00d4aa' : '#454560'};
              min-width:16px;text-align:center">${i + 1}</span>
        ${thumbHtml}
        <span class="sl-name" title="Double-click to rename"
          style="flex:1;font-size:10px;color:${isCurrent ? '#fff' : '#d4d4e0'};
                 cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${entry.name}
        </span>
        ${isCurrent ? '<span style="font-size:9px;color:#00d4aa;flex-shrink:0">▶</span>' : ''}
        <button class="sl-update" data-index="${i}"
          style="background:none;border:1px solid rgba(0,212,170,0.35);border-radius:3px;
                 color:rgba(0,212,170,0.7);cursor:pointer;font-size:7px;
                 font-family:var(--font-mono);padding:2px 5px;flex-shrink:0;white-space:nowrap"
          title="Update this scene from the current canvas state">↻ Update</button>
        <button class="sl-goto" data-index="${i}"
          style="background:none;border:none;color:#7878a0;cursor:pointer;font-size:10px"
          title="Load this scene">→</button>
        <button class="sl-del" data-index="${i}"
          style="background:none;border:none;color:#454560;cursor:pointer;font-size:10px"
          title="Remove">✕</button>
      `;
      row.appendChild(mainRow);

      // Inline rename input (hidden by default)
      const renameRow = document.createElement('div');
      renameRow.style.cssText = 'display:none;margin-top:6px;padding-left:26px';
      renameRow.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center">
          <input class="sl-rename-input" type="text" value="${entry.name}"
            style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(0,212,170,0.4);
                   border-radius:3px;color:#fff;font-family:var(--font-mono);font-size:9px;
                   padding:4px 7px;outline:none" />
          <button class="sl-rename-ok"
            style="background:rgba(0,212,170,0.15);border:1px solid rgba(0,212,170,0.4);
                   border-radius:3px;color:#00d4aa;font-family:var(--font-mono);
                   font-size:8px;padding:3px 8px;cursor:pointer">OK</button>
        </div>
      `;
      row.appendChild(renameRow);

      // ── Event wiring ──────────────────────────────────────────

      // Single click → load scene
      mainRow.querySelector('.sl-goto').addEventListener('click', e => {
        e.stopPropagation();
        this._setlist.goto(i);
        this._renderSetlistEntries();
      });

      // Double-click name → show rename input
      mainRow.querySelector('.sl-name').addEventListener('dblclick', e => {
        e.stopPropagation();
        renameRow.style.display = renameRow.style.display === 'none' ? 'block' : 'none';
        if (renameRow.style.display === 'block') {
          renameRow.querySelector('.sl-rename-input').focus();
          renameRow.querySelector('.sl-rename-input').select();
        }
      });

      // Rename confirm
      const doRename = () => {
        const newName = renameRow.querySelector('.sl-rename-input').value.trim();
        if (newName && newName !== entry.name) {
          entry.name = newName;
          mainRow.querySelector('.sl-name').textContent = newName;
        }
        renameRow.style.display = 'none';
      };
      renameRow.querySelector('.sl-rename-ok').addEventListener('click', doRename);
      renameRow.querySelector('.sl-rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter')  doRename();
        if (e.key === 'Escape') renameRow.style.display = 'none';
      });

      // Update scene from current canvas state
      mainRow.querySelector('.sl-update').addEventListener('click', e => {
        e.stopPropagation();
        // Snapshot current layers into this entry's preset
        const layerStack = this._layerStack;
        entry.preset = {
          name:   entry.name,
          layers: layerStack.layers.map(layer => ({
            type:        layer.constructor.name,
            id:          layer.id,
            name:        layer.name,
            visible:     layer.visible,
            opacity:     layer.opacity,
            blendMode:   layer.blendMode,
            maskLayerId: layer.maskLayerId || null,
            transform:   { ...layer.transform },
            modMatrix:   layer.modMatrix?.toJSON() || [],
            fx:          layer.fx ? layer.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
            params:      layer.params ? { ...layer.params } : {},
          })),
        };
        // Also refresh thumbnail
        try {
          const canvas = document.getElementById('main-canvas');
          const thumb  = document.createElement('canvas');
          thumb.width  = 120; thumb.height = 68;
          thumb.getContext('2d').drawImage(canvas, 0, 0, 120, 68);
          entry.thumbnail = thumb.toDataURL('image/jpeg', 0.6);
          // Update the thumb image in the row if it exists
          const imgEl = mainRow.querySelector('.sl-thumb');
          if (imgEl && imgEl.tagName === 'IMG') imgEl.src = entry.thumbnail;
        } catch {}
        Toast.success(`Scene ${i + 1} updated from current canvas`);
      });

      // Delete
      mainRow.querySelector('.sl-del').addEventListener('click', e => {
        e.stopPropagation();
        this._setlist.removeEntry(i);
        this._renderSetlistEntries();
      });

      row.addEventListener('dblclick', () => this._setlist.goto(i));
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

      // Capture thumbnail from main canvas
      let thumbnail = null;
      try {
        const canvas  = document.getElementById('main-canvas');
        const thumb   = document.createElement('canvas');
        thumb.width   = 120;
        thumb.height  = 68;
        const tCtx    = thumb.getContext('2d');
        tCtx.drawImage(canvas, 0, 0, 120, 68);
        thumbnail = thumb.toDataURL('image/jpeg', 0.6);
      } catch (e) { /* canvas may be cross-origin tainted — skip */ }

      this._setlist.addEntry({ name, preset, thumbnail });
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

    const transitionSel = document.getElementById('sl-transition-type');
    if (transitionSel) {
      transitionSel.addEventListener('change', () => {
        document.dispatchEvent(new CustomEvent('vael:transition-type', { detail: transitionSel.value }));
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
    window.vaelPerfActive = true;   // global flag for other modules
    document.body.classList.add('performance');
    this._hud.style.display = 'flex';
    this._showHUD();
    this._updateHUD();
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  exit() {
    this._active = false;
    window.vaelPerfActive = false;
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
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.target.isContentEditable) return;

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
