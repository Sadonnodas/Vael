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
  let _multiSelect = new Set();

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

    _layers.onChanged = () => renderLayerList();
    _wireGroupButton();
    _startThumbUpdater();
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
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="params"]').classList.add('active');
    document.getElementById('tab-params').classList.add('active');
  }

  // ── Multi-select state ───────────────────────────────────────

  function renderLayerList() {
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
      row.draggable    = true;
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

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
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
            style="background:none;border:none;cursor:pointer;font-size:13px;
                   color:${layer.visible ? 'var(--accent)' : 'var(--text-dim)'}">
            ${layer.visible ? '◉' : '○'}
          </button>
          <span class="layer-name-btn" title="Click to edit params · Double-click to rename"
            style="flex:1;font-family:var(--font-mono);font-size:10px;color:var(--text);
                   cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${layer instanceof GroupLayer ? '⊞ ' : ''}${layer.name}
          </span>
          ${layer instanceof GroupLayer ? `
            <button class="group-collapse" data-id="${layer.id}"
              style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:10px">
              ${layer.collapsed ? '▸' : '▾'}
            </button>
            <button class="group-ungroup" data-id="${layer.id}"
              style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                     cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);
                     font-size:8px;padding:1px 5px">ungroup</button>
          ` : `
            <button class="layer-up"   data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move up">↑</button>
            <button class="layer-down" data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move down">↓</button>
          `}
          <button class="layer-del"  data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:#ff4444;font-size:11px" title="Remove">✕</button>
        </div>
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

        <!-- Transform controls (collapsible) -->
        <div style="margin-top:6px">
          <button class="transform-toggle" data-id="${layer.id}"
            style="background:none;border:none;cursor:pointer;
                   font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                   padding:2px 0;width:100%;text-align:left">
            ▸ Transform ${(layer.transform?.x || layer.transform?.y || layer.transform?.rotation || (layer.transform?.scaleX !== 1) || (layer.transform?.scaleY !== 1)) ? '●' : ''}
          </button>
          <div class="transform-panel" data-id="${layer.id}" style="display:none;padding-top:6px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
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
            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:5px;margin-bottom:5px;align-items:end">
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Scale X</div>
                <input type="number" class="tr-sx" data-id="${layer.id}" value="${layer.transform?.scaleX ?? 1}" step="0.1" min="0.1" max="10"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
              <div style="display:flex;align-items:center;padding-bottom:2px">
                <button class="tr-link-scale" title="Link X and Y scale"
                  style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                         color:var(--text-dim);font-size:10px;padding:3px 4px;cursor:pointer;
                         line-height:1">🔓</button>
              </div>
              <div>
                <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Scale Y</div>
                <input type="number" class="tr-sy" data-id="${layer.id}" value="${layer.transform?.scaleY ?? 1}" step="0.1" min="0.1" max="10"
                  style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;
                         color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 5px" />
              </div>
            </div>
            </div>
            <div style="margin-bottom:5px">
              <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:2px">Rotation (°)</div>
              <input type="range" class="tr-rot" data-id="${layer.id}" value="${layer.transform?.rotation || 0}" min="-180" max="180" step="1"
                style="width:100%;accent-color:var(--accent)" />
            </div>
            <div style="display:flex;gap:5px">
              <button class="tr-reset btn" data-id="${layer.id}" style="flex:1;font-size:8px;padding:4px">Reset</button>
              <button class="tr-dupe btn accent" data-id="${layer.id}" style="flex:1;font-size:8px;padding:4px">⧉ Duplicate</button>
            </div>
          </div>
        </div>
      `;

      // Multi-select checkbox
      row.querySelector('.layer-select-cb').addEventListener('change', e => {
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
        selectLayer(layer.id);
      });

      // Double-click to rename inline
      row.querySelector('.layer-name-btn').addEventListener('dblclick', e => {
        e.stopPropagation();
        const span  = e.target;
        const input = document.createElement('input');
        input.type  = 'text';
        input.value = layer.name;
        input.style.cssText = `
          flex:1;background:var(--bg);border:1px solid var(--accent);border-radius:3px;
          color:var(--text);font-family:var(--font-mono);font-size:10px;padding:1px 4px;
          width:100%;outline:none;
        `;
        span.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
          const name = input.value.trim() || layer.name;
          layer.name = name;
          const newSpan = document.createElement('span');
          newSpan.className = 'layer-name-btn';
          newSpan.style = span.style.cssText;
          newSpan.textContent = (layer instanceof GroupLayer ? '⊞ ' : '') + name;
          input.replaceWith(newSpan);
          newSpan.addEventListener('click', ev => { ev.stopPropagation(); selectLayer(layer.id); });
          newSpan.addEventListener('dblclick', ev => { ev.stopPropagation(); /* re-trigger not needed, row re-renders */ renderLayerList(); });
          Toast.info(`Renamed to "${name}"`);
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { input.value = layer.name; input.blur(); }
        });
      });

      row.querySelector('.vis-toggle').addEventListener('click', e => {
        e.stopPropagation();
        _layers.setVisible(layer.id, !layer.visible);
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
      row.querySelector('.opacity-sl').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        _layers.setOpacity(layer.id, v);
        row.querySelector('.opacity-val').textContent = Math.round(v * 100) + '%';
      });
      row.querySelector('.blend-sel').addEventListener('change', e => {
        _layers.setBlendMode(layer.id, e.target.value);
      });
      row.querySelector('.mask-sel').addEventListener('change', e => {
        layer.maskLayerId = e.target.value || null;
        if (layer.maskLayerId) Toast.info(`Mask set: ${layer.name} → ${_layers.layers.find(l=>l.id===layer.maskLayerId)?.name}`);
        else Toast.info('Mask removed');
        renderLayerList();
      });

      // Transform toggle
      row.querySelector('.transform-toggle').addEventListener('click', () => {
        const panel = row.querySelector('.transform-panel');
        const btn   = row.querySelector('.transform-toggle');
        const open  = panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
        btn.textContent = (open ? '▾' : '▸') + ' Transform';
      });

      // Linked scale lock
      let _scaleLocked = false;
      const linkBtn = row.querySelector('.tr-link-scale');
      if (linkBtn) {
        linkBtn.addEventListener('click', () => {
          _scaleLocked = !_scaleLocked;
          linkBtn.textContent = _scaleLocked ? '🔒' : '🔓';
          linkBtn.style.color = _scaleLocked ? 'var(--accent)' : 'var(--text-dim)';
          linkBtn.style.borderColor = _scaleLocked ? 'var(--accent)' : 'var(--border-dim)';
        });
      }

      // Transform inputs
      const setTransform = (changedId) => {
        const newSx = parseFloat(row.querySelector('.tr-sx').value) || 1;
        const newSy = parseFloat(row.querySelector('.tr-sy').value) || 1;

        // If scale locked, sync the other axis
        if (_scaleLocked && changedId === 'sx') {
          row.querySelector('.tr-sy').value = newSx;
          layer.transform.scaleY = newSx;
        } else if (_scaleLocked && changedId === 'sy') {
          row.querySelector('.tr-sx').value = newSy;
          layer.transform.scaleX = newSy;
        }

        layer.transform.x        = parseFloat(row.querySelector('.tr-x').value)  || 0;
        layer.transform.y        = parseFloat(row.querySelector('.tr-y').value)  || 0;
        layer.transform.scaleX   = parseFloat(row.querySelector('.tr-sx').value) || 1;
        layer.transform.scaleY   = parseFloat(row.querySelector('.tr-sy').value) || 1;
        layer.transform.rotation = parseFloat(row.querySelector('.tr-rot').value) || 0;
      };

      row.querySelector('.tr-sx')?.addEventListener('input', () => setTransform('sx'));
      row.querySelector('.tr-sy')?.addEventListener('input', () => setTransform('sy'));
      row.querySelectorAll('.tr-x,.tr-y,.tr-rot').forEach(el => {
        el.addEventListener('input', () => setTransform(null));
        el.addEventListener('change', () => setTransform(null));
      });

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

  // Add layer button → simple picker
  document.getElementById('btn-add-layer').addEventListener('click', () => {
    showLayerPicker();
  });

  // Group selected button — injected into DOM by renderLayerList
  // Wire via delegation since the button is created dynamically
  document.addEventListener('click', e => {
    if (e.target.id !== 'btn-group-selected') return;
    const selectedLayers = [..._multiSelect]
      .map(id => _layers.layers.find(l => l.id === id))
      .filter(Boolean);
    if (selectedLayers.length < 2) { Toast.warn('Select 2+ layers to group'); return; }

    const group = new GroupLayer(`group-${Date.now()}`);
    group.name = 'Group';

    // Insert at the position of the topmost selected layer
    const indices = selectedLayers.map(l => _layers.layers.indexOf(l));
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

  function showLayerPicker() {
    document.getElementById('layer-picker')?.remove();
    const picker = document.createElement('div');
    picker.id = 'layer-picker';
    picker.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      z-index:1000;backdrop-filter:blur(4px);
    `;
    picker.innerHTML = `
      <div style="background:var(--bg-mid);border:1px solid var(--border);
                  border-radius:8px;padding:20px;min-width:260px;max-width:320px">
        <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                    color:var(--accent);margin-bottom:16px">ADD LAYER</div>
        ${_layerTypes.map(t => `
          <button class="btn" data-type="${t.id}"
            style="width:100%;margin-bottom:8px;justify-content:flex-start;font-size:11px">
            ${t.label}
          </button>
        `).join('')}
        <button id="picker-cancel" class="btn"
          style="width:100%;margin-top:4px;color:var(--text-dim)">Cancel</button>
      </div>
    `;
    picker.addEventListener('click', e => {
      const typeId = e.target.closest('[data-type]')?.dataset.type;
      if (typeId) {
        const def = _layerTypes.find(t => t.id === typeId);
        if (def) {
          const layer = def.cls();
          if (typeof layer.init === 'function') layer.init({});
          _layers.add(layer);
          // Auto-select and show params
          setTimeout(() => selectLayer(layer.id), 50);
        }
        picker.remove();
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

        if (typeof layer.render === 'function') {
          ctx.save();
          ctx.translate(36, 24);
          // Temporarily set a small scale so layer fits in thumb
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
           return { 
    init, 
    selectLayer, 
    renderLayerList,
    setSelectedId,
    getSelectedId,
    getMultiSelect,
    get onSelect() { return onSelect; },
    set onSelect(fn) { onSelect = fn; } 
  };

})();
