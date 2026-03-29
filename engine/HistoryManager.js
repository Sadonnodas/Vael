/**
 * engine/HistoryManager.js
 * Timestamped undo history — like Photoshop's History panel.
 *
 * Records full scene snapshots on every meaningful change.
 * Slider/param changes are debounced (800ms) so dragging a knob
 * produces one history entry, not hundreds.
 *
 * Usage (wired in App.js):
 *   const history = new HistoryManager({ layers, lfoManager, layerFactory });
 *   history.snapshot('Added Noise Field');   // manual trigger
 *   history.onParamChange('Speed', layer);   // debounced trigger
 *
 * The History tab in the sidebar renders via history.renderPanel(container).
 */

class HistoryManager {

  constructor({ layers, lfoManager, layerFactory, maxEntries = 60 }) {
    this._layers      = layers;
    this._lfoManager  = lfoManager;
    this._layerFactory = layerFactory;
    this._maxEntries  = maxEntries;

    // Array of { id, label, timestamp, state } newest first
    this._entries     = [];
    this._currentIdx  = 0;   // 0 = present, 1 = one step back, etc.
    this._jumping     = false; // prevent recursive snapshots during restore

    // Debounce state for param changes
    this._debounceTimer  = null;
    this._debounceLabel  = '';
    this._debounceMs     = 800;

    // UI
    this._container   = null;
    this.onJump       = null;   // callback(entry) after restoring a state
  }

  // ── Snapshot ─────────────────────────────────────────────────

  /**
   * Take an immediate snapshot with the given label.
   * Call this for structural changes (add/remove layer, load preset, etc.)
   */
  snapshot(label) {
    if (this._jumping) return;

    // If we're not at the present, discard future entries first
    if (this._currentIdx > 0) {
      this._entries.splice(0, this._currentIdx);
      this._currentIdx = 0;
    }

    const state = this._captureState();
    const entry = {
      id:        `h-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label,
      timestamp: Date.now(),
      state,
    };

    this._entries.unshift(entry);

    // Cap at max entries
    if (this._entries.length > this._maxEntries) {
      this._entries.length = this._maxEntries;
    }

    this._renderPanel();
  }

  /**
   * Debounced snapshot for param changes — groups rapid slider movements
   * into a single history entry.
   * @param {string}    paramLabel  Human-readable param name
   * @param {BaseLayer} layer       The layer being edited
   */
  onParamChange(paramLabel, layer) {
    const label = `Changed ${layer?.name ?? ''} · ${paramLabel}`;
    this._debounceLabel = label;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.snapshot(this._debounceLabel);
    }, this._debounceMs);
  }

  // ── State capture ─────────────────────────────────────────────

  _captureState() {
    return {
      layers: this._layers.layers.map(layer =>
        typeof layer.toJSON === 'function' ? layer.toJSON() : {
          type: layer.constructor.name, id: layer.id, name: layer.name,
          visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode,
          maskLayerId: layer.maskLayerId || null, maskMode: layer.maskMode || 'luminance',
          transform: { ...layer.transform },
          modMatrix: layer.modMatrix?.toJSON() || [],
          fx: layer.fx ? layer.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
          params: layer.params ? { ...layer.params } : {},
        }
      ),
      lfos: this._lfoManager?.toJSON() || [],
    };
  }

  // ── Restore ───────────────────────────────────────────────────

  /**
   * Jump to a specific history entry by its id.
   */
  jumpTo(id) {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx === -1) return;

    this._jumping    = true;
    this._currentIdx = idx;

    const { state } = this._entries[idx];
    this._applyState(state);

    this._jumping = false;
    this._renderPanel();

    if (typeof this.onJump === 'function') {
      this.onJump(this._entries[idx]);
    }
  }

  /**
   * Step back one entry (standard undo).
   */
  undo() {
    if (this._currentIdx >= this._entries.length - 1) return;
    this.jumpTo(this._entries[this._currentIdx + 1].id);
    Toast.info(`Undo: ${this._entries[this._currentIdx].label}`);
  }

  /**
   * Step forward one entry (redo).
   */
  redo() {
    if (this._currentIdx <= 0) return;
    this.jumpTo(this._entries[this._currentIdx - 1].id);
    Toast.info(`Redo: ${this._entries[this._currentIdx].label}`);
  }

  _applyState(state) {
    if (!state) return;

    // Clear current layers
    [...this._layers.layers].forEach(l => this._layers.remove(l.id));

    // Restore layers
    (state.layers || []).forEach(def => {
      try {
        const layer = this._layerFactory(def.type, def.id);
        if (!layer) return;
        layer.name        = def.name      ?? layer.name;
        layer.visible     = def.visible   ?? true;
        layer.opacity     = def.opacity   ?? 1;
        layer.blendMode   = def.blendMode ?? 'normal';
        layer.maskLayerId = def.maskLayerId || null;
        layer.maskMode    = def.maskMode    || 'luminance';
        if (def.transform) Object.assign(layer.transform, def.transform);
        if (def.modMatrix) layer.modMatrix?.fromJSON(def.modMatrix, layer);
        if (def.fx)        layer.fx = def.fx.map(f => ({ ...f, params: { ...f.params } }));
        if (def.params && layer.params) Object.assign(layer.params, def.params);
        if (typeof layer.init === 'function') layer.init(layer.params || {});
        this._layers.add(layer);
      } catch (e) {
        console.warn('HistoryManager: could not restore layer', e);
      }
    });

    // Restore LFOs
    if (this._lfoManager && state.lfos?.length) {
      this._lfoManager.clear();
      this._lfoManager.fromJSON(state.lfos, this._layers);
    } else if (this._lfoManager) {
      this._lfoManager.clear();
    }
  }

  // ── Panel rendering ───────────────────────────────────────────

  /**
   * Mount the history panel into a container element.
   * Called once at startup; the panel re-renders itself on every snapshot.
   */
  mountPanel(container) {
    this._container = container;
    this._renderPanel();
  }

  _renderPanel() {
    if (!this._container) return;
    this._container.innerHTML = '';

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
    header.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                   text-transform:uppercase;letter-spacing:1px;flex:1">
        History (${this._entries.length})
      </span>
      <button id="hist-undo" title="Undo (Ctrl+Z)"
        style="background:none;border:1px solid var(--border-dim);border-radius:3px;
               color:var(--text-dim);cursor:pointer;font-family:var(--font-mono);
               font-size:8px;padding:2px 7px">← Undo</button>
      <button id="hist-redo" title="Redo (Ctrl+Shift+Z)"
        style="background:none;border:1px solid var(--border-dim);border-radius:3px;
               color:var(--text-dim);cursor:pointer;font-family:var(--font-mono);
               font-size:8px;padding:2px 7px">Redo →</button>
    `;
    this._container.appendChild(header);

    header.querySelector('#hist-undo').addEventListener('click', () => this.undo());
    header.querySelector('#hist-redo').addEventListener('click', () => this.redo());

    if (this._entries.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);text-align:center;padding:16px 0;line-height:1.8';
      empty.textContent   = 'No history yet.\nMake some changes and they\nwill appear here.';
      this._container.appendChild(empty);
      return;
    }

    // Entry list — newest at top
    this._entries.forEach((entry, i) => {
      const isCurrent = i === this._currentIdx;
      const row       = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        margin-bottom: 3px;
        cursor: pointer;
        border: 1px solid ${isCurrent ? 'var(--accent)' : 'transparent'};
        background: ${isCurrent
          ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))'
          : 'var(--bg-card)'};
        transition: border-color 0.1s, background 0.1s;
        opacity: ${i > this._currentIdx ? '0.45' : '1'};
      `;

      const time   = new Date(entry.timestamp);
      const hh     = String(time.getHours()).padStart(2, '0');
      const mm     = String(time.getMinutes()).padStart(2, '0');
      const ss     = String(time.getSeconds()).padStart(2, '0');
      const timeStr = `${hh}:${mm}:${ss}`;

      row.innerHTML = `
        <div style="flex-shrink:0;margin-top:1px">
          <div style="width:6px;height:6px;border-radius:50%;margin-top:2px;
               background:${isCurrent ? 'var(--accent)' : 'var(--border)'}"></div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-mono);font-size:9px;
               color:${isCurrent ? 'var(--text)' : 'var(--text-muted)'};
               overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${entry.label}
          </div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-top:1px">
            ${timeStr}${i === 0 ? ' <span style="color:var(--accent2)">latest</span>' : ''}
            ${isCurrent && i > 0 ? ' <span style="color:var(--accent)">current</span>' : ''}
          </div>
        </div>
      `;

      row.addEventListener('click', () => this.jumpTo(entry.id));
      row.addEventListener('mouseenter', () => {
        if (!isCurrent) row.style.background = 'var(--bg-card)';
        row.style.borderColor = isCurrent ? 'var(--accent)' : 'var(--border-dim)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background  = isCurrent ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))' : 'var(--bg-card)';
        row.style.borderColor = isCurrent ? 'var(--accent)' : 'transparent';
      });

      this._container.appendChild(row);
    });

    // Clear button at bottom
    if (this._entries.length > 1) {
      const clearBtn = document.createElement('button');
      clearBtn.className   = 'btn';
      clearBtn.style.cssText = 'width:100%;font-size:9px;margin-top:10px;color:var(--text-dim)';
      clearBtn.textContent = 'Clear history';
      clearBtn.addEventListener('click', () => {
        if (this._entries.length > 0) {
          this._entries = [this._entries[this._currentIdx]];
          this._currentIdx = 0;
          this._renderPanel();
        }
      });
      this._container.appendChild(clearBtn);
    }
  }

  get canUndo() { return this._currentIdx < this._entries.length - 1; }
  get canRedo() { return this._currentIdx > 0; }
}
