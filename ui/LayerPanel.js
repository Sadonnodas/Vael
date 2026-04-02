/**
 * ui/LayerPanel.js
 * Layer list UI — all rendering, selection, multi-select, grouping,
 * transforms, masks, and layer picker dialog.
 *
 * Call: LayerPanel.init(deps) where deps = { layers, layerFactory, audio, canvas }
 * Listen: LayerPanel.onSelect = (id) => { ... }
 */

const LayerPanel = (() => {

  let _layers, _layerFactory, _audio, _canvas;
  let _selectedLayerId = null;
  let _multiSelect  = new Set();
  let _soloLayerId  = null;   // id of the currently soloed layer, or null

  // External callbacks
  let onSelect = null;          // (layerId) → show params
  let onRenderLayerList = null; // called after list re-renders

  let _layerListEl   = null;
  let _emptyStateEl  = null;
  let _paramsEmptyEl = null;
  let _paramsContentEl = null;
  let _blendModes    = ['normal','multiply','screen','overlay','add','softlight','difference','luminosity','subtract','exclusion'];
  let _layerTypes    = [];
  let _renderImageFn = null;

  function init({ layers, layerFactory, audio, canvas, onSelectLayer,
                  blendModes, layerTypes, renderImageLayerPanel }) {
    _layers       = layers;
    _layerFactory = layerFactory;
    _audio        = audio;
    _canvas       = canvas;
    if (onSelectLayer) onSelect = onSelectLayer;
    if (blendModes)    _blendModes = blendModes;
    if (layerTypes)    _layerTypes = layerTypes;
    if (renderImageLayerPanel) _renderImageFn = renderImageLayerPanel;

    // DOM lookups deferred to after DOMContentLoaded
    _layerListEl     = document.getElementById('layer-list');
    _emptyStateEl    = document.getElementById('layers-empty');
    _paramsEmptyEl   = document.getElementById('params-empty');
    _paramsContentEl = document.getElementById('params-content');

    // Chain onto any existing onChanged (e.g. LFOPanel.refresh set by App.js)
    // rather than overwriting it — LayerStack only supports one callback.
    const _prevOnChanged = _layers.onChanged;
    _layers.onChanged = () => {
      renderLayerList();
      if (typeof _prevOnChanged === 'function') _prevOnChanged();
    };
    _wireGroupButton();
    _startThumbUpdater();

    // Wire add-layer button now that _layerTypes is populated
    document.getElementById('btn-add-layer')?.addEventListener('click', () => {
      showLayerPicker();
    });
  }

  function setSelectedId(id) { _selectedLayerId = id; }
  function getSelectedId()   { return _selectedLayerId; }
  function getMultiSelect()  { return _multiSelect; }

  function _wireGroupButton() {
    document.addEventListener('click', e => {
      if (e.target.id !== 'btn-group-selected') return;
      const selectedLayers = [..._multiSelect]
        .map(id => _layers.layers.find(l => l.id === id))
        .filter(Boolean);
      if (selectedLayers.length < 2) { Toast.warn('Select 2+ layers to group'); return; }

      const group = new GroupLayer(`group-${Date.now()}`);
      group.name = 'Group';

      const indices  = selectedLayers.map(l => _layers.layers.indexOf(l));
      const insertAt = Math.min(...indices);

      selectedLayers.forEach(l => {
        _layers.layers.splice(_layers.layers.indexOf(l), 1);
        group.addChild(l);
      });

      _layers.layers.splice(insertAt, 0, group);
      _multiSelect.clear();
      _layers._notify();
      Toast.success(`Grouped ${selectedLayers.length} layers`);
    });
  }

  // ── Layer panel ──────────────────────────────────────────────

  function selectLayer(id) {
    _selectedLayerId = id;
    // Notify App.js so it can track the selected layer
    if (typeof onSelect === 'function') onSelect(id);
    if (!_paramsEmptyEl || !_paramsContentEl) return;  // DOM not ready yet

    // Search both top-level layers and group children
    let layer = _layers.layers.find(l => l.id === id);
    if (!layer) {
      // Search inside groups
      for (const l of _layers.layers) {
        if (l instanceof GroupLayer) {
          const child = l.children.find(c => c.id === id);
          if (child) { layer = child; break; }
        }
      }
    }
    if (!layer) return;

    document.querySelectorAll('.layer-row').forEach(r => {
      r.style.borderColor = r.dataset.id === id ? 'var(--accent)' : 'var(--border-dim)';
    });

    // Expand the selected layer row, collapse all others
    _layers.layers.forEach(l => {
      l._rowCollapsed = l.id !== id;
    });
    // Also handle group children
    _layers.layers.forEach(l => {
      if (l.children) l.children.forEach(c => { c._rowCollapsed = c.id !== id; });
    });
    renderLayerList();

    _paramsEmptyEl.style.display   = 'none';
    _paramsContentEl.style.display = 'block';

    if (layer instanceof LyricsLayer) {
      LyricsPanel.render(layer, _paramsContentEl);
    } else if (layer instanceof ShaderLayer) {
      ShaderPanel.render(layer, _paramsContentEl);
    } else if (layer instanceof ImageLayer) {
      _renderImageFn && _renderImageFn(layer, _paramsContentEl);
    } else {
      ParamPanel.render(layer, _paramsContentEl, _audio);
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => {
      // Leave panels that are in pop-out windows alone
      const sidebar = document.getElementById('sidebar-content');
      if (sidebar && !sidebar.contains(p)) return;
      p.classList.remove('active');
    });

    const paramsPanel = document.getElementById('tab-params');
    const paramsBtn   = document.querySelector('[data-tab="params"]');
    const sidebar     = document.getElementById('sidebar-content');

    // If PARAMS is popped out, just focus its window; don't switch sidebar tabs
    if (paramsPanel && sidebar && !sidebar.contains(paramsPanel)) {
      const popout = paramsPanel.closest('.vael-popout');
      if (popout) popout.style.zIndex = '320';
    } else {
      paramsBtn?.classList.add('active');
      paramsPanel?.classList.add('active');
    }
  }

  // ── Multi-select state ───────────────────────────────────────

  function renderLayerList() {
    if (!_layerListEl) return;   // not yet initialised — skip silently
    _layerListEl.innerHTML = '';
    const hasLayers = _layers.count > 0;
    _emptyStateEl.style.display = hasLayers ? 'none' : 'block';

    // Show group button only when 2+ layers selected
    const groupBtn = document.getElementById('btn-group-selected');
    if (groupBtn) {
      groupBtn.style.display = _multiSelect.size >= 2 ? 'block' : 'none';
      groupBtn.textContent = `⊞ Group ${_multiSelect.size} selected layers`;
    }

    // Render in reverse so top layer appears first in UI
    [..._layers.layers].reverse().forEach(layer => {
      const isMultiSelected = _multiSelect.has(layer.id);
      const row = document.createElement('div');
      row.className    = 'layer-row';
      row.dataset.id   = layer.id;
      row.draggable = true;

      // Prevent drag when interacting with sliders, selects, inputs inside the row
      row.addEventListener('mousedown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
            e.target.tagName === 'BUTTON' || e.target.tagName === 'LABEL') {
          row.draggable = false;
        }
      });
      row.addEventListener('mouseup',   () => { row.draggable = true; });
      row.addEventListener('mouseleave',() => { row.draggable = true; });
      row.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${
          isMultiSelected ? 'var(--accent2)' :
          layer.id === _selectedLayerId ? 'var(--accent)' :
          'var(--border-dim)'};
        border-radius: 5px;
        padding: 8px 10px;
        margin-bottom: 6px;
        cursor: pointer;
        transition: border-color 0.15s;
        ${isMultiSelected ? 'background: color-mix(in srgb, var(--accent2) 8%, var(--bg-card))' : ''}
      `;

      // Drag-to-reorder
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', layer.id);
        setTimeout(() => { row.style.opacity = '0.4'; }, 0);
      });
      row.addEventListener('dragend', () => { row.style.opacity = '1'; });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        row.style.outline = '2px solid var(--accent)';
      });
      row.addEventListener('dragleave', () => { row.style.outline = 'none'; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.style.outline = 'none';
        const fromId = e.dataTransfer.getData('text/plain');
        if (fromId === layer.id) return;
        const fromIdx = _layers.layers.findIndex(l => l.id === fromId);
        const toIdx   = _layers.layers.findIndex(l => l.id === layer.id);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = _layers.layers.splice(fromIdx, 1);
        _layers.layers.splice(toIdx, 0, moved);
        _layers._notify();
      });

      // Collapsed state per layer (stored on the layer object)
      // Layers are collapsed by default; they open when selected
      if (layer._rowCollapsed === undefined) layer._rowCollapsed = true;

      const typeName = layer.constructor.name.replace('Layer','').replace('Visualizer','Viz');

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <!-- Thumbnail -->
          <canvas class="layer-thumb" width="36" height="24"
            style="border-radius:3px;flex-shrink:0;background:var(--bg);
                   border:1px solid var(--border-dim);cursor:pointer"
            title="Click to select"></canvas>

          <input type="checkbox" class="layer-select-cb"
            ${isMultiSelected ? 'checked' : ''}
            style="accent-color:var(--accent2);cursor:pointer;flex-shrink:0"
            title="Select for grouping" />

          <button class="vis-toggle" data-id="${layer.id}" title="Toggle visibility"
            style="background:none;border:none;cursor:pointer;font-size:13px;flex-shrink:0;
                   color:${layer.visible ? 'var(--accent)' : 'var(--text-dim)'}">
            ${layer.visible ? '◉' : '○'}
          </button>

          <button class="solo-btn" data-id="${layer.id}"
            title="Solo — hide all other layers"
            style="background:none;border:none;cursor:pointer;font-size:9px;flex-shrink:0;
                   font-family:var(--font-mono);padding:0 2px;
                   color:${_soloLayerId === layer.id ? '#ffd700' : 'var(--text-dim)'};
                   opacity:${_soloLayerId === layer.id ? '1' : '0.45'};
                   transition:opacity 0.1s,color 0.1s">S</button>

          <div style="flex:1;min-width:0">
            <span class="layer-name-btn" title="Click to edit · Double-click to rename"
              style="font-family:var(--font-mono);font-size:10px;color:var(--text);
                     cursor:pointer;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${layer instanceof GroupLayer ? '⊞ ' : ''}${layer.name}
            </span>
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                         opacity:0.6">${typeName}</span>
          </div>

          <!-- Row collapse toggle -->
          <button class="row-collapse" title="Collapse/expand"
            style="background:none;border:none;cursor:pointer;color:var(--text-dim);
                   font-size:9px;padding:2px;flex-shrink:0">
            ${layer._rowCollapsed ? '▸' : '▾'}
          </button>

          ${layer instanceof GroupLayer ? `
            <button class="group-collapse" data-id="${layer.id}"
              style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:10px">
              ${layer.collapsed ? '⊞' : '⊟'}
            </button>
            <button class="group-ungroup" data-id="${layer.id}"
              style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                     cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);
                     font-size:8px;padding:1px 5px">ungroup</button>
          ` : `
            <button class="layer-up"   data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move up">↑</button>
            <button class="layer-down" data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move down">↓</button>
          `}
          <button class="layer-del" data-id="${layer.id}"
            style="background:none;border:none;cursor:pointer;color:#ff4444;font-size:11px" title="Remove">✕</button>
          <button class="layer-reset-quick" data-id="${layer.id}"
            style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px;opacity:0.5" title="Reset position, scale &amp; rotation (R)">↺</button>
        </div>

        <!-- Collapsible body -->
        <div class="row-body" style="display:${layer._rowCollapsed ? 'none' : 'block'};margin-top:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);width:30px">opac</span>
            <input type="range" class="opacity-sl" data-id="${layer.id}"
              min="0" max="1" step="0.01" value="${layer.opacity}"
              style="flex:1;accent-color:var(--accent)">
            <span class="opacity-val" style="font-family:var(--font-mono);font-size:9px;
                  color:var(--accent);width:28px;text-align:right">
              ${Math.round(layer.opacity * 100)}%
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);width:30px">blend</span>
            <select class="blend-sel" data-id="${layer.id}"
              style="flex:1;background:var(--bg);border:1px solid var(--border);
                     color:var(--text);font-family:var(--font-mono);font-size:9px;
                     padding:3px;border-radius:3px">
              ${_blendModes.map(m =>
                `<option value="${m}" ${layer.blendMode === m ? 'selected' : ''}>${m}</option>`
              ).join('')}
            </select>
          </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);width:30px">mask</span>
          <select class="mask-sel" data-id="${layer.id}"
            style="flex:1;background:var(--bg);border:1px solid ${layer.maskLayerId ? 'var(--accent2)' : 'var(--border)'};
                   color:${layer.maskLayerId ? 'var(--accent2)' : 'var(--text-dim)'};
                   font-family:var(--font-mono);font-size:9px;padding:3px;border-radius:3px">
            <option value="">— none —</option>
            ${_layers.layers
              .filter(l => l.id !== layer.id)
              .map(l => `<option value="${l.id}" ${layer.maskLayerId === l.id ? 'selected' : ''}>${l.name}</option>`)
              .join('')}
          </select>
        </div>
        ${layer.maskLayerId ? `
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);width:30px"></span>
          <select class="mask-mode-sel" data-id="${layer.id}"
            style="flex:1;background:var(--bg);border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);
                   color:var(--accent2);font-family:var(--font-mono);font-size:9px;padding:3px;border-radius:3px"
            title="Mask mode: how the mask layer controls visibility">
            <option value="luminance" ${(layer.maskMode||'luminance')==='luminance' ? 'selected' : ''}>Luminance (bright=show)</option>
            <option value="invert"    ${(layer.maskMode||'luminance')==='invert'    ? 'selected' : ''}>Luminance inv (dark=show)</option>
            <option value="alpha"     ${(layer.maskMode||'luminance')==='alpha'     ? 'selected' : ''}>Alpha (shape cutout)</option>
          </select>
        </div>` : ''}

        <!-- Transform controls (collapsible) -->
        <div style="margin-top:6px">
          <button class="transform-toggle" data-id="${layer.id}"
            style="background:none;border:none;cursor:pointer;
                   font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                   padding:2px 0;width:100%;text-align:left">
            ▸ Transform ${(layer.transform?.x || layer.transform?.y || layer.transform?.rotation || (layer.transform?.scaleX !== 1) || (layer.transform?.scaleY !== 1)) ? '●' : ''}
          </button>
          <div class="transform-panel" data-id="${layer.id}" style="display:none;padding-top:6px">

            <!-- Position X / Y -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px">
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">X offset</div>
                <input type="number" class="tr-x" data-id="${layer.id}" value="${layer.transform?.x || 0}" step="5"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Y offset</div>
                <input type="number" class="tr-y" data-id="${layer.id}" value="${layer.transform?.y || 0}" step="5"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
            </div>

            <!-- Unified scale slider (linked by default) -->
            <div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
                <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Scale</span>
                <div style="display:flex;align-items:center;gap:4px">
                  <button class="tr-link-scale" title="Unlink X and Y scale"
                    style="background:color-mix(in srgb,var(--accent) 12%,transparent);
                           border:1px solid var(--accent);border-radius:3px;
                           color:var(--accent);font-size:9px;padding:2px 5px;cursor:pointer;
                           line-height:1;font-family:var(--font-mono)">🔒 linked</button>
                  <input type="number" class="tr-scale-num" value="${Math.round(((layer.transform?.scaleX ?? 1) * 100))}"
                    style="width:46px;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                           color:var(--accent);font-family:var(--font-mono);font-size:9px;padding:2px 4px;text-align:right" />
                </div>
              </div>
              <input type="range" class="tr-scale-sl" min="10" max="400" step="1"
                value="${Math.round(((layer.transform?.scaleX ?? 1) * 100))}"
                style="width:100%;accent-color:var(--accent)" />
            </div>

            <!-- Scale X / Y (shown when unlinked) -->
            <div class="tr-xy-scale" style="display:none;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px">
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Scale X</div>
                <input type="number" class="tr-sx" data-id="${layer.id}" value="${layer.transform?.scaleX ?? 1}" step="0.05" min="0.1" max="10"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Scale Y</div>
                <input type="number" class="tr-sy" data-id="${layer.id}" value="${layer.transform?.scaleY ?? 1}" step="0.05" min="0.1" max="10"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
            </div>

            <!-- Rotation -->
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
                <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Rotation (°)</span>
                <input type="number" class="tr-rot-num" value="${layer.transform?.rotation || 0}" min="-180" max="180" step="1"
                  style="width:46px;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:2px 4px;text-align:right" />
              </div>
              <input type="range" class="tr-rot" data-id="${layer.id}" value="${layer.transform?.rotation || 0}" min="-180" max="180" step="1"
                style="width:100%;accent-color:var(--accent)" />
            </div>

            <div style="display:flex;gap:5px">
              <button class="tr-reset btn" data-id="${layer.id}" style="flex:1;font-size:8px;padding:4px">↺ Reset</button>
              <button class="tr-dupe btn accent" data-id="${layer.id}" style="flex:1;font-size:8px;padding:4px">⧉ Duplicate</button>
            </div>
          </div>
        </div>
        </div><!-- /row-body -->
      `;

      // Row collapse toggle
      row.querySelector('.row-collapse')?.addEventListener('click', e => {
        e.stopPropagation();
        layer._rowCollapsed = !layer._rowCollapsed;
        const body = row.querySelector('.row-body');
        const btn  = row.querySelector('.row-collapse');
        if (body) body.style.display = layer._rowCollapsed ? 'none' : 'block';
        if (btn)  btn.textContent     = layer._rowCollapsed ? '▸' : '▾';
      });

      // Multi-select checkbox
      row.querySelector('.layer-select-cb')?.addEventListener('change', e => {
        if (e.target.checked) _multiSelect.add(layer.id);
        else                  _multiSelect.delete(layer.id);
        renderLayerList();
      });

      // Click layer name → open params (also deselects multi-select if clicking a different layer)
      // Thumbnail click → select layer
      const thumbCanvas = row.querySelector('.layer-thumb');
      thumbCanvas?.addEventListener('click', e => { e.stopPropagation(); selectLayer(layer.id); });

      // Render thumbnail (async, small canvas)
      if (thumbCanvas) _renderThumb(thumbCanvas, layer);

      row.querySelector('.layer-name-btn').addEventListener('click', e => {
        e.stopPropagation();
        // Single click: select and expand the row, but stay on current tab
        _selectedLayerId = layer.id;
        if (typeof onSelect === 'function') onSelect(layer.id);
        _layers.layers.forEach(l => { l._rowCollapsed = l.id !== layer.id; });
        _layers.layers.forEach(l => {
          if (l.children) l.children.forEach(c => { c._rowCollapsed = c.id !== layer.id; });
        });
        renderLayerList();
        // Update params content silently (so PARAMS tab is ready if they switch)
        if (_paramsEmptyEl && _paramsContentEl) {
          _paramsEmptyEl.style.display   = 'none';
          _paramsContentEl.style.display = 'block';
          if (layer instanceof LyricsLayer) {
            LyricsPanel.render(layer, _paramsContentEl);
          } else if (layer instanceof ShaderLayer) {
            ShaderPanel.render(layer, _paramsContentEl);
          } else if (layer instanceof ImageLayer) {
            _renderImageFn && _renderImageFn(layer, _paramsContentEl);
          } else {
            ParamPanel.render(layer, _paramsContentEl, _audio);
          }
        }
      });

      // Double-click to go to PARAMS tab
      // Double-click layer name → go to PARAMS tab
      row.querySelector('.layer-name-btn').addEventListener('dblclick', e => {
        e.stopPropagation();
        selectLayer(layer.id);
      });

      // Solo button
      row.querySelector('.solo-btn').addEventListener('click', e => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;

        if (_soloLayerId === id) {
          // Un-solo: restore all layers to their pre-solo visibility
          _soloLayerId = null;
          _layers.layers.forEach(l => {
            if (l._preSoloVisible !== undefined) {
              l.visible = l._preSoloVisible;
              delete l._preSoloVisible;
            }
          });
          Toast.info('Solo off');
        } else {
          // Solo: hide all others, remember their visibility
          _layers.layers.forEach(l => {
            l._preSoloVisible = l.visible;
            l.visible = (l.id === id);
          });
          _soloLayerId = id;
          Toast.info(`Solo: ${_layers.layers.find(l => l.id === id)?.name ?? id}`);
        }

        renderLayerList();
      });

      row.querySelector('.vis-toggle').addEventListener('click', e => {
        e.stopPropagation();
        const newVis = !layer.visible;
        _layers.setVisible(layer.id, newVis);
        if (typeof window._vaelHistory !== 'undefined') window._vaelHistory.onVisibilityChange(layer, newVis);
      });

      // Up/down only on non-group layers
      row.querySelector('.layer-up')?.addEventListener('click', e => {
        e.stopPropagation();
        _layers.moveUp(layer.id);
      });
      row.querySelector('.layer-down')?.addEventListener('click', e => {
        e.stopPropagation();
        _layers.moveDown(layer.id);
      });

      // Group-specific controls
      row.querySelector('.group-collapse')?.addEventListener('click', e => {
        e.stopPropagation();
        layer.collapsed = !layer.collapsed;
        renderLayerList();
      });

      row.querySelector('.group-ungroup')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!(layer instanceof GroupLayer)) return;
        // Insert children back into the main stack at the group's position
        const groupIdx = _layers.layers.indexOf(layer);
        const children = [...layer.children];
        _layers.remove(layer.id);
        children.forEach((child, i) => {
          _layers.layers.splice(groupIdx + i, 0, child);
        });
        _layers._notify();
        Toast.success(`Ungrouped — ${children.length} layers restored`);
      });
      row.querySelector('.layer-del').addEventListener('click', e => {
        e.stopPropagation();
        // Remove immediately — show undo toast instead of confirm dialog
        if (_selectedLayerId === layer.id) {
          _selectedLayerId = null;
          _paramsContentEl.innerHTML = '';
          _paramsEmptyEl.style.display = 'block';
        }
        // Snapshot the layer data before removing for undo
        const snapshot = typeof layer.toJSON === 'function' ? layer.toJSON() : null;
        const removedName = layer.name;
        const removedIndex = _layers.layers.indexOf(layer);
        _layers.remove(layer.id);

        // Undo toast — stays for 4 seconds
        const undoToast = Toast.warn(`Removed "${removedName}" — `, 4000);
        if (undoToast) {
          const undoBtn = document.createElement('button');
          undoBtn.textContent = 'Undo';
          undoBtn.style.cssText = 'background:none;border:1px solid currentColor;border-radius:3px;padding:1px 6px;cursor:pointer;font-family:inherit;font-size:inherit;color:inherit;margin-left:4px';
          undoBtn.addEventListener('click', () => {
            if (snapshot) {
              const restored = _layerFactory(snapshot.type, snapshot.id);
              if (restored) {
                restored.name      = snapshot.name;
                restored.visible   = snapshot.visible ?? true;
                restored.opacity   = snapshot.opacity ?? 1;
                restored.blendMode = snapshot.blendMode ?? 'normal';
                if (snapshot.params && restored.params) Object.assign(restored.params, snapshot.params);
                if (snapshot.transform && restored.transform) Object.assign(restored.transform, snapshot.transform);
                if (typeof restored.init === 'function') restored.init(restored.params || {});
                _layers.add(restored);
                Toast.success(`Restored "${removedName}"`);
              }
            }
            undoToast.click(); // dismiss toast
          });
          undoToast.appendChild(undoBtn);
        }
      });
      // Quick reset button on main row
      row.querySelector('.layer-reset-quick')?.addEventListener('click', e => {
        e.stopPropagation();
        layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        renderLayerList();
        Toast.info('Transform reset');
      });

      row.querySelector('.opacity-sl').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        _layers.setOpacity(layer.id, v);
        row.querySelector('.opacity-val').textContent = Math.round(v * 100) + '%';
        if (typeof window._vaelHistory !== 'undefined') window._vaelHistory.onOpacityChange(layer, v);
      });
      row.querySelector('.opacity-sl').addEventListener('dblclick', e => {
        e.preventDefault();
        _layers.setOpacity(layer.id, 1);
        e.target.value = 1;
        row.querySelector('.opacity-val').textContent = '100%';
        Toast.info('Opacity → 100%');
      });
      row.querySelector('.opacity-sl').addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          _layers.setOpacity(layer.id, 1);
          e.target.value = 1;
          row.querySelector('.opacity-val').textContent = '100%';
          Toast.info('Opacity → 100%');
        }
      });
      row.querySelector('.blend-sel').addEventListener('change', e => {
        _layers.setBlendMode(layer.id, e.target.value);
        if (typeof window._vaelHistory !== 'undefined') window._vaelHistory.onBlendChange(layer, e.target.value);
      });
      row.querySelector('.mask-sel').addEventListener('change', e => {
        layer.maskLayerId = e.target.value || null;
        if (layer.maskLayerId) {
          const maskName = _layers.layers.find(l => l.id === layer.maskLayerId)?.name;
          Toast.info(`Mask: ${layer.name} ← ${maskName} (${layer.maskMode || 'luminance'})`);
        } else {
          Toast.info('Mask removed');
        }
        renderLayerList(); // re-render to show/hide the mode dropdown
      });

      row.querySelector('.mask-mode-sel')?.addEventListener('change', e => {
        layer.maskMode = e.target.value;
        const modeLabels = { luminance: 'Luminance', invert: 'Luminance (inverted)', alpha: 'Alpha cutout' };
        Toast.info(`Mask mode: ${modeLabels[layer.maskMode] || layer.maskMode}`);
      });

      // Transform toggle
      row.querySelector('.transform-toggle').addEventListener('click', () => {
        const panel = row.querySelector('.transform-panel');
        const btn   = row.querySelector('.transform-toggle');
        const open  = panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
        btn.textContent = (open ? '▾' : '▸') + ' Transform' +
          ((layer.transform?.x || layer.transform?.y || layer.transform?.rotation ||
           (layer.transform?.scaleX !== 1) || (layer.transform?.scaleY !== 1)) ? ' ●' : '');
      });

      // Scale link toggle — linked by default
      let _scaleLocked = true;
      const linkBtn    = row.querySelector('.tr-link-scale');
      const xyScaleDiv = row.querySelector('.tr-xy-scale');
      const scaleSl    = row.querySelector('.tr-scale-sl');
      const scaleNum   = row.querySelector('.tr-scale-num');

      linkBtn?.addEventListener('click', () => {
        _scaleLocked = !_scaleLocked;
        if (_scaleLocked) {
          linkBtn.textContent   = '🔒 linked';
          linkBtn.style.background = 'color-mix(in srgb,var(--accent) 12%,transparent)';
          linkBtn.style.borderColor = 'var(--accent)';
          linkBtn.style.color   = 'var(--accent)';
          xyScaleDiv.style.display = 'none';
          scaleSl.style.display    = 'block';
          scaleNum.style.display   = 'block';
        } else {
          linkBtn.textContent   = '🔓 unlinked';
          linkBtn.style.background = 'none';
          linkBtn.style.borderColor = 'var(--border-dim)';
          linkBtn.style.color   = 'var(--text-dim)';
          xyScaleDiv.style.display = 'grid';
          // Sync individual inputs from current scale
          const sx = layer.transform?.scaleX ?? 1;
          const sy = layer.transform?.scaleY ?? 1;
          row.querySelector('.tr-sx').value = sx;
          row.querySelector('.tr-sy').value = sy;
        }
      });

      // Unified scale slider — drives both scaleX and scaleY
      const applyUnifiedScale = (pct) => {
        const s = Math.max(0.1, pct / 100);
        layer.transform.scaleX = s;
        layer.transform.scaleY = s;
        scaleSl.value  = pct;
        scaleNum.value = pct;
        row.querySelector('.tr-sx').value = s.toFixed(2);
        row.querySelector('.tr-sy').value = s.toFixed(2);
      };

      scaleSl?.addEventListener('input', () => {
        applyUnifiedScale(parseInt(scaleSl.value));
      });

      scaleNum?.addEventListener('change', () => {
        const raw = scaleNum.value.replace('%','');
        const pct = Math.max(10, Math.min(400, parseInt(raw) || 100));
        applyUnifiedScale(pct);
      });
      scaleNum?.addEventListener('keydown', e => {
        if (e.key === 'Enter') scaleNum.blur();
      });

      // Individual scale X/Y (unlinked mode)
      const setTransform = (changedId) => {
        if (_scaleLocked) {
          // Linked mode — use unified slider value
          const pct = parseInt(scaleSl?.value || 100);
          const s   = Math.max(0.1, pct / 100);
          layer.transform.scaleX = s;
          layer.transform.scaleY = s;
        } else {
          const newSx = parseFloat(row.querySelector('.tr-sx').value) || 1;
          const newSy = parseFloat(row.querySelector('.tr-sy').value) || 1;
          layer.transform.scaleX = newSx;
          layer.transform.scaleY = newSy;
          // Keep unified slider at average
          const avg = (newSx + newSy) / 2;
          if (scaleSl) scaleSl.value  = Math.round(avg * 100);
          if (scaleNum) scaleNum.value = Math.round(avg * 100);
        }
        layer.transform.x        = parseFloat(row.querySelector('.tr-x').value)  || 0;
        layer.transform.y        = parseFloat(row.querySelector('.tr-y').value)  || 0;
        layer.transform.rotation = parseFloat(row.querySelector('.tr-rot').value) || 0;
      };

      row.querySelector('.tr-sx')?.addEventListener('input',  () => setTransform('sx'));
      row.querySelector('.tr-sx')?.addEventListener('change', () => setTransform('sx'));
      row.querySelector('.tr-sy')?.addEventListener('input',  () => setTransform('sy'));
      row.querySelector('.tr-sy')?.addEventListener('change', () => setTransform('sy'));

      row.querySelectorAll('.tr-x,.tr-y').forEach(el => {
        el.addEventListener('input',  () => setTransform(null));
        el.addEventListener('change', () => setTransform(null));
      });

      // Rotation slider + number input sync
      const rotSl  = row.querySelector('.tr-rot');
      const rotNum = row.querySelector('.tr-rot-num');
      rotSl?.addEventListener('input', () => {
        const v = parseFloat(rotSl.value);
        layer.transform.rotation = v;
        if (rotNum) rotNum.value = v;
      });
      rotNum?.addEventListener('change', () => {
        const v = Math.max(-180, Math.min(180, parseFloat(rotNum.value) || 0));
        layer.transform.rotation = v;
        if (rotSl) rotSl.value = v;
        rotNum.value = v;
      });
      rotNum?.addEventListener('keydown', e => { if (e.key === 'Enter') rotNum.blur(); });

      // Reset transform
      row.querySelector('.tr-reset').addEventListener('click', () => {
        layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        renderLayerList();
        Toast.info('Transform reset');
      });

      // Duplicate layer
      row.querySelector('.tr-dupe').addEventListener('click', () => {
        const newLayer = _layerFactory(layer.constructor.name);
        if (!newLayer) return;
        newLayer.name      = layer.name + ' copy';
        newLayer.opacity   = layer.opacity;
        newLayer.blendMode = layer.blendMode;
        newLayer.transform = { ...layer.transform };
        if (layer.params)  newLayer.params = { ...layer.params };
        if (typeof newLayer.init === 'function') newLayer.init(newLayer.params || {});
        _layers.add(newLayer);
        Toast.success(`Duplicated: ${layer.name}`);
      });

      _layerListEl.appendChild(row);

      // If this is a group and not collapsed, show children indented
      if (layer instanceof GroupLayer && !layer.collapsed && layer.children.length > 0) {
        layer.children.slice().reverse().forEach(child => {
          const childRow = document.createElement('div');
          childRow.style.cssText = `
            background: var(--bg);
            border: 1px solid var(--border-dim);
            border-left: 2px solid var(--accent2);
            border-radius: 4px;
            padding: 5px 8px 5px 20px;
            margin-bottom: 3px;
            margin-left: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
          `;
          childRow.innerHTML = `
            <button class="child-vis" style="background:none;border:none;cursor:pointer;
                    font-size:11px;color:${child.visible ? 'var(--accent2)' : 'var(--text-dim)'}">
              ${child.visible ? '◉' : '○'}
            </button>
            <span style="flex:1;font-family:var(--font-mono);font-size:9px;
                         color:var(--text-muted);cursor:pointer" class="child-name">
              ${child.name}
            </span>
            <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
              ${Math.round((child.opacity ?? 1) * 100)}%
            </span>
            <button class="child-eject" title="Move out of group"
              style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:9px">
              ↑
            </button>
          `;

          childRow.querySelector('.child-vis').addEventListener('click', e => {
            e.stopPropagation();
            child.visible = !child.visible;
            e.target.style.color   = child.visible ? 'var(--accent2)' : 'var(--text-dim)';
            e.target.textContent   = child.visible ? '◉' : '○';
          });

          childRow.querySelector('.child-name').addEventListener('click', () => {
            selectLayer(child.id);
            // Temporarily add child to layers so selectLayer can find it
            if (!_layers.layers.find(l => l.id === child.id)) {
              _layers.layers.push(child);
              selectLayer(child.id);
              _layers.layers.pop();
            }
          });

          childRow.querySelector('.child-eject').addEventListener('click', e => {
            e.stopPropagation();
            layer.removeChild(child.id);
            const groupIdx = _layers.layers.indexOf(layer);
            _layers.layers.splice(groupIdx + 1, 0, child);
            _layers._notify();
            Toast.info(`${child.name} moved out of group`);
          });

          _layerListEl.appendChild(childRow);
        });
      }
    });
  }

  // ── Standalone event wirings (moved to init) ─────────────────

  function showLayerPicker() {
    document.getElementById('layer-picker')?.remove();

    // Separate shader types from regular types
    const shaderTypes  = _layerTypes.filter(t => t.id.startsWith('shader-'));
    const regularTypes = _layerTypes.filter(t => !t.id.startsWith('shader-'));

    const picker = document.createElement('div');
    picker.id = 'layer-picker';
    picker.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      z-index:1000;backdrop-filter:blur(4px);
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background:var(--bg-mid);border:1px solid var(--border);
      border-radius:8px;padding:20px;min-width:260px;max-width:320px;
      position:relative;
    `;
    box.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                  color:var(--accent);margin-bottom:16px">ADD LAYER</div>
    `;

    // Regular layer buttons
    regularTypes.forEach(t => {
      const btn = document.createElement('button');
      btn.className        = 'btn';
      btn.dataset.type     = t.id;
      btn.style.cssText    = 'width:100%;margin-bottom:8px;justify-content:flex-start;font-size:11px';
      btn.textContent      = t.label;
      box.appendChild(btn);
    });

    // Shader entry with hover submenu
    const shaderWrap = document.createElement('div');
    shaderWrap.style.cssText = 'position:relative;margin-bottom:8px';

    const shaderBtn = document.createElement('button');
    shaderBtn.className     = 'btn';
    shaderBtn.style.cssText = 'width:100%;justify-content:space-between;font-size:11px';
    shaderBtn.innerHTML     = 'Shader <span style="font-size:9px;opacity:0.6">▶</span>';
    shaderWrap.appendChild(shaderBtn);

    // Submenu panel
    const submenu = document.createElement('div');
    submenu.style.cssText = `
      display:none;
      position:absolute;
      left:calc(100% + 6px);
      top:0;
      background:var(--bg-mid);
      border:1px solid var(--border);
      border-radius:6px;
      padding:8px;
      min-width:200px;
      z-index:1001;
      box-shadow:4px 4px 20px rgba(0,0,0,0.5);
    `;

    const submenuLabel = document.createElement('div');
    submenuLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--accent);letter-spacing:1px;margin-bottom:8px;padding:0 4px';
    submenuLabel.textContent   = 'SHADER PRESETS';
    submenu.appendChild(submenuLabel);

    shaderTypes.forEach(t => {
      const name = t.label.replace('Shader — ', '').replace('Shader — ', '');
      const sbtn = document.createElement('button');
      sbtn.className       = 'btn';
      sbtn.dataset.type    = t.id;
      sbtn.style.cssText   = 'width:100%;margin-bottom:4px;justify-content:flex-start;font-size:10px';
      sbtn.textContent     = name;
      submenu.appendChild(sbtn);
    });

    shaderWrap.appendChild(submenu);
    box.appendChild(shaderWrap);

    // Show/hide submenu on hover
    let _subHideTimer = null;
    const showSub = () => {
      clearTimeout(_subHideTimer);
      submenu.style.display = 'block';
      // After it's visible, check if it goes off the bottom of the screen
      // and flip it upward if needed
      requestAnimationFrame(() => {
        const rect    = submenu.getBoundingClientRect();
        const wrapR   = shaderWrap.getBoundingClientRect();
        const offBottom = rect.bottom - window.innerHeight + 8;
        if (offBottom > 0) {
          // Flip up: anchor to bottom of shaderWrap instead of top
          submenu.style.top  = 'auto';
          submenu.style.bottom = '0';
        } else {
          submenu.style.top    = '0';
          submenu.style.bottom = 'auto';
        }
        // Also check right-edge overflow and flip left if needed
        if (rect.right > window.innerWidth - 8) {
          submenu.style.left  = 'auto';
          submenu.style.right = 'calc(100% + 6px)';
        } else {
          submenu.style.left  = 'calc(100% + 6px)';
          submenu.style.right = 'auto';
        }
      });
    };
    const hideSub = () => {
      _subHideTimer = setTimeout(() => { submenu.style.display = 'none'; }, 120);
    };
    shaderWrap.addEventListener('mouseenter', showSub);
    shaderWrap.addEventListener('mouseleave', hideSub);
    submenu.addEventListener('mouseenter',   showSub);
    submenu.addEventListener('mouseleave',   hideSub);
    // Also open on click/tap (for touch screens)
    shaderBtn.addEventListener('click', () => {
      submenu.style.display = submenu.style.display === 'none' ? 'block' : 'none';
    });

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className     = 'btn';
    cancelBtn.id            = 'picker-cancel';
    cancelBtn.style.cssText = 'width:100%;margin-top:4px;color:var(--text-dim)';
    cancelBtn.textContent   = 'Cancel';
    box.appendChild(cancelBtn);

    picker.appendChild(box);

    // Click handler — works for regular buttons and shader submenu buttons
    picker.addEventListener('click', e => {
      const typeId = e.target.closest('[data-type]')?.dataset.type;
      if (typeId) {
        const def = _layerTypes.find(t => t.id === typeId);
        if (def) {
          const layer = def.cls();
          if (typeof layer.init === 'function') layer.init({});
          _layers.add(layer);
          setTimeout(() => selectLayer(layer.id), 50);
        }
        picker.remove();
        return;
      }
      if (e.target.id === 'picker-cancel' || e.target === picker) picker.remove();
    });

    document.body.appendChild(picker);
  }


  // ── Layer thumbnails ─────────────────────────────────────────

  // Cache: layerId → last rendered data URL
  const _thumbCache = new Map();
  let   _thumbRafId = null;

  function _renderThumb(canvas, layer) {
    // Use cached version immediately while a new one renders
    if (_thumbCache.has(layer.id)) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 36, 24);
        ctx.drawImage(img, 0, 0, 36, 24);
      };
      img.src = _thumbCache.get(layer.id);
      return;
    }

    // Render fresh thumbnail
    _scheduleThumbRender(canvas, layer);
  }

  function _scheduleThumbRender(canvas, layer) {
    // Stagger renders so we don't block the main thread
    setTimeout(() => {
      try {
        const off  = document.createElement('canvas');
        off.width  = 72;
        off.height = 48;
        const ctx  = off.getContext('2d');
        ctx.fillStyle = '#0a0a10';
        ctx.fillRect(0, 0, 72, 48);

        // Never call render() on stateful particle/canvas layers for thumbnails —
        // it causes reinit at the wrong size. These layers cache their thumb
        // from the main render loop instead (see _updateThumbFromQuad).
        const isStateful = layer._particles !== undefined ||
                           layer.constructor?.name === 'CanvasPaintLayer';

        if (!isStateful && typeof layer.render === 'function') {
          ctx.save();
          ctx.translate(36, 24);
          ctx.scale(0.08, 0.08);
          layer.render(ctx, 900, 600);
          ctx.restore();
        }

        const dataUrl = off.toDataURL('image/jpeg', 0.7);
        _thumbCache.set(layer.id, dataUrl);

        // Draw to the actual thumb canvas
        if (canvas.isConnected) {
          const tCtx = canvas.getContext('2d');
          const img  = new Image();
          img.onload = () => tCtx.drawImage(img, 0, 0, 36, 24);
          img.src    = dataUrl;
        }
      } catch {}
    }, Math.random() * 200);  // stagger up to 200ms
  }

  // Refresh thumbnails periodically (not every frame — that would be slow)
  function _startThumbUpdater() {
    setInterval(() => {
      _thumbCache.clear();  // Force re-render next time layers are drawn
    }, 3000);
  }
  // ── Canvas drag ──────────────────────────────────────────────
  // Click and drag on the canvas to move the selected layer.
  // Scroll on the canvas to scale the selected layer.
  // No modifier key required — just select a layer then interact with the canvas.
  // Groups: if the selected layer is inside a group, the group moves as a whole.

  function _initCanvasDrag(canvas) {
    if (!canvas) return;

    // Hint label — shown briefly when a layer is selected
    const hint = document.createElement('div');
    hint.id = 'canvas-drag-hint';
    hint.style.cssText = `
      position: absolute;
      bottom: 44px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.75);
      border: 1px solid var(--accent);
      border-radius: 4px;
      padding: 4px 10px;
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--accent);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
      white-space: nowrap;
      z-index: 60;
    `;
    hint.textContent = 'Drag: move  ·  Scroll: scale  ·  R: reset';
    // Append to canvas-area (canvas parent)
    canvas.parentElement?.appendChild(hint);

    let _hintTimer = null;
    function _showHint() {
      hint.style.opacity = '1';
      clearTimeout(_hintTimer);
      _hintTimer = setTimeout(() => { hint.style.opacity = '0'; }, 2000);
    }

    // Show hint whenever a layer becomes selected
    const _origSetSelected = setSelectedId.bind(null);
    // Hook into selectLayer instead
    const _origSelectLayer2 = selectLayer;

    // ── Drag state ────────────────────────────────────────────
    let _dragging   = false;
    let _dragLayer  = null;   // the layer (or group) being moved
    let _dragStartX = 0;
    let _dragStartY = 0;
    let _dragOrigX  = 0;
    let _dragOrigY  = 0;

    // Find the layer to move: if selected layer is inside a group,
    // return the group (so the whole group moves).
    function _getMovableLayer() {
      if (!_selectedLayerId) return null;

      // Direct lookup
      const direct = _layers.layers.find(l => l.id === _selectedLayerId);
      if (direct) return direct;

      // Check if it's inside a group
      for (const l of _layers.layers) {
        if (l instanceof GroupLayer && l.children) {
          const inGroup = l.children.find(c => c.id === _selectedLayerId);
          if (inGroup) return l;   // move the whole group
        }
      }
      return null;
    }

    canvas.style.cursor = 'default';

    canvas.addEventListener('mousedown', e => {
      const layer = _getMovableLayer();
      if (!layer) return;

      // If a CanvasPaintLayer is selected with drawMode on, let it handle drawing
      const selLayer = _layers.layers.find(l => l.id === _selectedLayerId)
        || (() => { for (const l of _layers.layers) { if (l.children) { const c = l.children.find(c => c.id === _selectedLayerId); if (c) return c; } } return null; })();
      if (selLayer && selLayer.constructor.name === 'CanvasPaintLayer' && selLayer.params?.drawMode) return;

      _dragging   = true;
      _dragLayer  = layer;
      _dragStartX = e.clientX;
      _dragStartY = e.clientY;
      // Ensure transform object exists
      if (!layer.transform) layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
      _dragOrigX  = layer.transform.x || 0;
      _dragOrigY  = layer.transform.y || 0;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!_dragging || !_dragLayer) return;
      const dx = e.clientX - _dragStartX;
      const dy = e.clientY - _dragStartY;
      _dragLayer.transform.x = _dragOrigX + dx;
      _dragLayer.transform.y = _dragOrigY + dy;

      // Record transform changes into AutomationTimeline when recording
      if (window._vaelTimeline?.isRecording && _dragLayer.id) {
        const renderer = window._vaelRenderer;
        const W = renderer?.width  || 800;
        const H = renderer?.height || 600;
        // Normalise to 0-1 range for timeline recording
        window._vaelTimeline.recordPoint(
          _dragLayer.id, 'transform.x',
          _dragLayer.transform.x,
          { label: 'X position', min: -W/2, max: W/2 }
        );
        window._vaelTimeline.recordPoint(
          _dragLayer.id, 'transform.y',
          _dragLayer.transform.y,
          { label: 'Y position', min: -H/2, max: H/2 }
        );
      }
    });

    document.addEventListener('mouseup', () => {
      if (_dragging) {
        _dragging  = false;
        _dragLayer = null;
        canvas.style.cursor = _selectedLayerId ? 'grab' : 'default';
        // Refresh transform panel if open
        const openPanel = document.querySelector(`.transform-panel[data-id="${_selectedLayerId}"]`);
        if (openPanel && openPanel.style.display !== 'none') renderLayerList();
      }
    });

    // Update cursor when layer is selected/deselected
    // We patch this by watching _selectedLayerId via the selectLayer function
    const _patchSelectForCursor = (id) => {
      canvas.style.cursor = id ? 'grab' : 'default';
      if (id) _showHint();
    };

    // Export so App.js can call after selectLayer
    canvas._onLayerSelect = _patchSelectForCursor;

    // Scroll to scale
    canvas.addEventListener('wheel', e => {
      const layer = _getMovableLayer();
      if (!layer) return;
      e.preventDefault();

      if (!layer.transform) layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

      // Shift+scroll = finer control (0.01 steps), normal = 0.05 steps
      const step   = e.shiftKey ? 0.01 : 0.05;
      const delta  = e.deltaY > 0 ? -step : step;
      const newS   = Math.max(0.1, Math.min(10, (layer.transform.scaleX ?? 1) + delta));
      layer.transform.scaleX = newS;
      layer.transform.scaleY = newS;
    }, { passive: false });

    // R key — reset selected layer transform to default
    // Guard: don't fire during performance mode (R isn't used there but be safe)
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (window.vaelPerfActive) return;
      if (e.key !== 'r' && e.key !== 'R') return;
      const layer = _getMovableLayer();
      if (!layer) return;
      e.preventDefault();
      layer.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
      // Refresh the transform panel row if it's open
      renderLayerList();
      // Show brief feedback
      hint.style.opacity = '1';
      hint.textContent   = 'Transform reset';
      clearTimeout(_hintTimer);
      _hintTimer = setTimeout(() => {
        hint.style.opacity  = '0';
        hint.textContent    = 'Drag: move  ·  Scroll: scale  ·  R: reset';
      }, 1200);
    });
  }

  // Public solo API — called from ParamPanel solo button
  function soloLayer(id) {
    if (_soloLayerId === id) {
      _soloLayerId = null;
      _layers.layers.forEach(l => {
        if (l._preSoloVisible !== undefined) {
          l.visible = l._preSoloVisible;
          delete l._preSoloVisible;
        }
      });
      Toast.info('Solo off');
      if (typeof window._vaelHistory !== 'undefined') window._vaelHistory.onSoloChange(null, false);
    } else {
      _layers.layers.forEach(l => {
        l._preSoloVisible = l.visible;
        l.visible = (l.id === id);
      });
      _soloLayerId = id;
      Toast.info(`Solo: ${_layers.layers.find(l => l.id === id)?.name ?? id}`);
      if (typeof window._vaelHistory !== 'undefined') window._vaelHistory.onSoloChange(_layers.layers.find(l=>l.id===id), true);
    }
    renderLayerList();
  }

  function getSoloId() { return _soloLayerId; }

  return {
    init, 
    selectLayer, 
    renderLayerList,
    setSelectedId,
    getSelectedId,
    getMultiSelect,
    soloLayer,
    getSoloId,
    _initCanvasDrag,
    get onSelect() { return onSelect; },
    set onSelect(fn) { onSelect = fn; } 
  };

})();
