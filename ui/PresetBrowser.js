/**
 * ui/PresetBrowser.js
 * In-app preset library — stores full preset JSON + thumbnail in localStorage.
 * Shown as a thumbnail grid panel that slides in from the LAYERS tab.
 *
 * API:
 *   PresetBrowser.init(layerStack, layerFactory)
 *   PresetBrowser.save(layerStack, name, thumbnailDataUrl)  — store
 *   PresetBrowser.open()   — show the panel
 *   PresetBrowser.close()  — hide the panel
 */

const PresetBrowser = (() => {

  const LS_KEY  = 'vael-preset-library-v2';
  const MAX_CAP = 40;   // max presets stored

  let _layerStack   = null;
  let _layerFactory = null;
  let _onLoad       = null;   // callback after loading a preset

  // ── Starter scene templates ───────────────────────────────────

  const STARTER_SCENES = [
    {
      id: 'campfire',
      name: 'Campfire',
      desc: 'Warm embers + fireflies',
      preset: {
        name: 'Campfire',
        layers: [
          { type: 'NoiseFieldLayer', name: 'Smoke', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'flow', hueA: 20, hueB: 45, saturation: 0.5, lightness: 0.08, speed: 0.15 }},
          { type: 'ParticleLayer', name: 'Embers', visible: true, opacity: 0.9,
            blendMode: 'add', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'fountain', count: 200, size: 2.5, speed: 0.6, colorMode: 'ember' }},
          { type: 'ParticleLayer', name: 'Fireflies', visible: true, opacity: 0.7,
            blendMode: 'add', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'fireflies', count: 120, size: 1.8, speed: 0.2, colorMode: 'warm' }},
        ]
      }
    },
    {
      id: 'aurora',
      name: 'Aurora',
      desc: 'Northern lights + stars',
      preset: {
        name: 'Aurora',
        layers: [
          { type: 'NoiseFieldLayer', name: 'Aurora', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'aurora', hueA: 140, hueB: 200, saturation: 0.8, lightness: 0.12, speed: 0.08 }},
          { type: 'ParticleLayer', name: 'Stars', visible: true, opacity: 0.6,
            blendMode: 'add', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'drift', count: 400, size: 0.8, speed: 0.1, colorMode: 'white' }},
          { type: 'MathVisualizer', name: 'Pi constellation', visible: true, opacity: 0.5,
            blendMode: 'screen', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'constellation', constant: 'pi', colorMode: 'rainbow', digitCount: 300 }},
        ]
      }
    },
    {
      id: 'forest',
      name: 'Forest',
      desc: 'Green marble + branches',
      preset: {
        name: 'Forest',
        layers: [
          { type: 'NoiseFieldLayer', name: 'Undergrowth', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'marble', hueA: 100, hueB: 140, saturation: 0.6, lightness: 0.10, speed: 0.06 }},
          { type: 'MathVisualizer', name: 'Branches', visible: true, opacity: 0.7,
            blendMode: 'screen', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'tree', constant: 'phi', colorMode: 'rainbow', digitCount: 600, angle: 25, hueShift: 100 }},
          { type: 'ParticleLayer', name: 'Pollen', visible: true, opacity: 0.4,
            blendMode: 'add', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'drift', count: 200, size: 1.2, speed: 0.15, colorMode: 'cool' }},
        ]
      }
    },
    {
      id: 'cosmos',
      name: 'Cosmos',
      desc: 'Deep space + nebula',
      preset: {
        name: 'Cosmos',
        layers: [
          { type: 'GradientLayer', name: 'Deep space', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'radial', hueA: 240, hueB: 280, hueC: 200, saturation: 0.5, lightness: 0.05 }},
          { type: 'ParticleLayer', name: 'Stars', visible: true, opacity: 0.8,
            blendMode: 'add', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'orbit', count: 600, size: 0.7, speed: 0.15, colorMode: 'rainbow' }},
          { type: 'ShaderLayer', name: 'Nebula', visible: true, opacity: 0.5,
            blendMode: 'screen', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { speed: 0.3, intensity: 0.8, scale: 1.5 }},
        ]
      }
    },
    {
      id: 'waveform-live',
      name: 'Live Waveform',
      desc: 'Clean audio visualizer',
      preset: {
        name: 'Live Waveform',
        layers: [
          { type: 'GradientLayer', name: 'Background', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'linear', hueA: 210, hueB: 260, saturation: 0.4, lightness: 0.06 }},
          { type: 'WaveformLayer', name: 'Waveform', visible: true, opacity: 1,
            blendMode: 'screen', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'mirror', color: '#00d4aa', colorMode: 'rainbow', lineWidth: 1.5, glow: true }},
          { type: 'WaveformLayer', name: 'Spectrum', visible: true, opacity: 0.6,
            blendMode: 'add', transform: { x:0,y:150,scaleX:1,scaleY:0.5,rotation:0 },
            params: { mode: 'bars', colorMode: 'frequency', barCount: 64, glow: true }},
        ]
      }
    },
    {
      id: 'minimal',
      name: 'Minimal',
      desc: 'Clean + intimate',
      preset: {
        name: 'Minimal',
        layers: [
          { type: 'NoiseFieldLayer', name: 'Breath', visible: true, opacity: 1,
            blendMode: 'normal', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'field', hueA: 200, hueB: 230, saturation: 0.3, lightness: 0.08, speed: 0.05 }},
          { type: 'MathVisualizer', name: 'Path', visible: true, opacity: 0.6,
            blendMode: 'screen', transform: { x:0,y:0,scaleX:1,scaleY:1,rotation:0 },
            params: { mode: 'wave', constant: 'pi', colorMode: 'mono', digitCount: 400, lineWidth: 1 }},
        ]
      }
    },
  ];

  function _getAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { return []; }
  }

  function _setAll(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
    catch (e) { Toast.warn('Preset storage full — delete some presets'); }
  }

  function save(layerStack, name, thumbnail = null) {
    const preset = {
      vael:    '1.0',
      name,
      saved:   new Date().toISOString(),
      thumbnail,
      layers:  layerStack.layers.map(layer => {
        const base = {
          type:        layer.constructor.name,
          id:          layer.id,
          name:        layer.name,
          visible:     layer.visible,
          opacity:     layer.opacity,
          blendMode:   layer.blendMode,
          maskLayerId: layer.maskLayerId || null,
          transform:   { ...layer.transform },
          modMatrix:   layer.modMatrix?.toJSON() || [],
        };
        if (layer.params) base.params = { ...layer.params };
        return base;
      }),
    };

    const existing = _getAll().filter(p => p.name !== name);
    _setAll([preset, ...existing].slice(0, MAX_CAP));
    return preset;
  }

  function remove(name) {
    _setAll(_getAll().filter(p => p.name !== name));
  }

  function rename(oldName, newName) {
    const list = _getAll();
    const item = list.find(p => p.name === oldName);
    if (item) { item.name = newName; _setAll(list); }
  }

  // ── Load into scene ──────────────────────────────────────────

  function _applyPreset(preset) {
    if (!preset?.layers) return;
    [..._layerStack.layers].forEach(l => _layerStack.remove(l.id));
    preset.layers.forEach(def => {
      try {
        const layer = _layerFactory(def.type, def.id);
        if (!layer) return;
        layer.name        = def.name      ?? layer.name;
        layer.visible     = def.visible   ?? true;
        layer.opacity     = def.opacity   ?? 1;
        layer.blendMode   = def.blendMode ?? 'normal';
        layer.maskLayerId = def.maskLayerId || null;
        if (def.transform) Object.assign(layer.transform, def.transform);
        if (def.modMatrix) layer.modMatrix?.fromJSON(def.modMatrix);
        if (def.params && layer.params) Object.assign(layer.params, def.params);
        // Pass shaderName + glsl so custom ShaderLayers restore correctly
        if (typeof layer.init === 'function') layer.init({ shaderName: def.shaderName, glsl: def.glsl, ...layer.params });
        _layerStack.add(layer);
      } catch (e) { console.warn('PresetBrowser: could not load layer', e); }
    });
    if (typeof _onLoad === 'function') _onLoad(preset);
    Toast.success(`Loaded: ${preset.name}`);
  }

  // ── UI state ─────────────────────────────────────────────────

  let _panel      = null;
  let _isOpen     = false;
  let _viewMode   = 'grid';    // 'grid' | 'list'
  let _searchText = '';
  let _selected   = new Set(); // selected preset names

  function init(layerStack, layerFactory, onLoad) {
    _layerStack   = layerStack;
    _layerFactory = layerFactory;
    _onLoad       = onLoad;
    _buildPanel();
  }

  function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'preset-browser-panel';
    _panel.style.cssText = `
      display:none;position:absolute;inset:0;background:var(--bg-mid);
      z-index:100;flex-direction:column;overflow:hidden;
    `;

    _panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;
                  border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                     color:var(--accent)">SCENE LIBRARY</span>
        <span id="pb-count" style="font-family:var(--font-mono);font-size:9px;
                                   color:var(--text-dim);margin-right:auto"></span>
        <button id="pb-view-toggle" title="Toggle list / grid view"
          style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                 color:var(--text-dim);font-size:11px;padding:2px 6px;cursor:pointer">⊞</button>
        <button id="pb-close" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-size:16px;line-height:1;padding:0 2px">✕</button>
      </div>

      <div style="padding:8px 12px;border-bottom:1px solid var(--border-dim);
                  flex-shrink:0;display:flex;gap:6px;align-items:center">
        <input id="pb-search" type="search" placeholder="Search scenes…"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                 color:var(--text);font-family:var(--font-mono);font-size:9px;padding:5px 8px"/>
        <button id="pb-select-all" title="Select all visible"
          style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                 color:var(--text-dim);font-family:var(--font-mono);font-size:8px;
                 padding:3px 7px;cursor:pointer;flex-shrink:0">All</button>
        <button id="pb-dl-selected" title="Download selected as .vaelscene files"
          style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                 color:var(--text-dim);font-family:var(--font-mono);font-size:8px;
                 padding:3px 7px;cursor:pointer;flex-shrink:0;display:none">↓ Export</button>
        <button id="pb-del-selected" title="Delete selected"
          style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                 color:#ff4444;font-family:var(--font-mono);font-size:8px;
                 padding:3px 7px;cursor:pointer;flex-shrink:0;display:none">✕ Delete</button>
      </div>

      <div id="pb-grid" style="flex:1;overflow-y:auto;padding:10px 12px;
                                align-content:start;scrollbar-width:thin;
                                scrollbar-color:var(--border) var(--bg-mid)"></div>

      <div style="padding:8px 12px;border-top:1px solid var(--border);
                  flex-shrink:0;display:flex;gap:6px">
        <input type="text" id="pb-save-name" placeholder="Scene name…"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                 color:var(--text);font-family:var(--font-mono);font-size:10px;padding:6px 10px"/>
        <button id="pb-save-btn" class="btn accent" style="flex-shrink:0;font-size:9px">
          ⊕ Save current
        </button>
      </div>
    `;

    const sidebar = document.getElementById('sidebar-content');
    if (sidebar) { sidebar.style.position = 'relative'; sidebar.appendChild(_panel); }

    _panel.querySelector('#pb-close').addEventListener('click', close);

    _panel.querySelector('#pb-view-toggle').addEventListener('click', () => {
      _viewMode = _viewMode === 'grid' ? 'list' : 'grid';
      _panel.querySelector('#pb-view-toggle').textContent = _viewMode === 'grid' ? '⊞' : '☰';
      _renderGrid();
    });

    _panel.querySelector('#pb-search').addEventListener('input', e => {
      _searchText = e.target.value.trim().toLowerCase();
      _selected.clear();
      _updateBulkButtons();
      _renderGrid();
    });

    _panel.querySelector('#pb-select-all').addEventListener('click', () => {
      const visible = _visiblePresets();
      const allSel  = visible.every(p => _selected.has(p.name));
      if (allSel) { visible.forEach(p => _selected.delete(p.name)); }
      else        { visible.forEach(p => _selected.add(p.name));    }
      _updateBulkButtons();
      _renderGrid();
    });

    _panel.querySelector('#pb-dl-selected').addEventListener('click', () => {
      const presets = _getAll().filter(p => _selected.has(p.name));
      presets.forEach(p => _downloadPreset(p));
      Toast.success(`Downloading ${presets.length} scene${presets.length !== 1 ? 's' : ''}`);
    });

    _panel.querySelector('#pb-del-selected').addEventListener('click', () => {
      const names = [..._selected];
      names.forEach(n => remove(n));
      _selected.clear();
      _updateBulkButtons();
      _renderGrid();
      Toast.info(`Deleted ${names.length} scene${names.length !== 1 ? 's' : ''}`);
    });

    _panel.querySelector('#pb-save-btn').addEventListener('click', () => {
      const nameEl = _panel.querySelector('#pb-save-name');
      const name   = nameEl.value.trim() || `Scene ${new Date().toLocaleTimeString()}`;
      let thumb = null;
      try {
        const canvas = document.getElementById('main-canvas');
        const t = document.createElement('canvas');
        t.width = 120; t.height = 68;
        t.getContext('2d').drawImage(canvas, 0, 0, 120, 68);
        thumb = t.toDataURL('image/jpeg', 0.6);
      } catch {}
      save(_layerStack, name, thumb);
      nameEl.value = '';
      _renderGrid();
      Toast.success(`Scene "${name}" saved to library`);
    });
  }

  function _visiblePresets() {
    const all = _getAll();
    if (!_searchText) return all;
    return all.filter(p => p.name.toLowerCase().includes(_searchText));
  }

  function _updateBulkButtons() {
    if (!_panel) return;
    const hasSel = _selected.size > 0;
    _panel.querySelector('#pb-dl-selected').style.display  = hasSel ? 'block' : 'none';
    _panel.querySelector('#pb-del-selected').style.display = hasSel ? 'block' : 'none';
  }

  function _downloadPreset(preset) {
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${preset.name.replace(/[^a-z0-9_\-]/gi, '_')}.vaelscene`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function _renderGrid() {
    const grid    = _panel.querySelector('#pb-grid');
    const countEl = _panel.querySelector('#pb-count');
    const all     = _getAll();
    const presets = _visiblePresets();

    countEl.textContent = _searchText
      ? `${presets.length} of ${all.length}`
      : `${all.length} / ${MAX_CAP}`;

    grid.innerHTML = '';

    // Starter templates — only when library is empty and no search active
    if (all.length === 0 && !_searchText) {
      const startersEl = document.createElement('div');
      startersEl.style.cssText = 'margin-bottom:12px';
      startersEl.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                    text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
          Starter scenes
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${STARTER_SCENES.map(s => `
            <button class="starter-btn" data-id="${s.id}"
              style="background:var(--bg-card);border:1px solid var(--border-dim);
                     border-radius:5px;padding:10px 8px;cursor:pointer;text-align:left;
                     font-family:var(--font-mono);transition:border-color 0.15s">
              <div style="font-size:9px;color:var(--text);margin-bottom:2px">${s.name}</div>
              <div style="font-size:8px;color:var(--text-dim)">${s.desc}</div>
            </button>`).join('')}
        </div>
      `;
      startersEl.querySelectorAll('.starter-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--accent)');
        btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--border-dim)');
        btn.addEventListener('click', () => {
          const starter = STARTER_SCENES.find(s => s.id === btn.dataset.id);
          if (starter) { _applyPreset(starter.preset); close(); }
        });
      });
      grid.appendChild(startersEl);
      return;
    }

    if (presets.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);padding:20px;text-align:center';
      empty.textContent = 'No scenes match your search';
      grid.appendChild(empty);
      return;
    }

    if (_viewMode === 'grid') {
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = '1fr 1fr';
      grid.style.gap = '8px';
      presets.forEach(preset => grid.appendChild(_buildGridCard(preset)));
    } else {
      grid.style.display = 'flex';
      grid.style.flexDirection = 'column';
      grid.style.gap = '4px';
      presets.forEach(preset => grid.appendChild(_buildListRow(preset)));
    }
  }

  function _buildGridCard(preset) {
    const isSel = _selected.has(preset.name);
    const card  = document.createElement('div');
    card.style.cssText = `
      background:var(--bg-card);border:1px solid ${isSel ? 'var(--accent)' : 'var(--border-dim)'};
      border-radius:6px;overflow:hidden;cursor:pointer;
      transition:border-color 0.15s,transform 0.1s;position:relative;
    `;

    card.innerHTML = `
      <div class="pb-sel-chk" style="position:absolute;top:5px;left:5px;z-index:1;
        width:16px;height:16px;border-radius:3px;
        background:${isSel ? 'var(--accent)' : 'rgba(0,0,0,0.55)'};
        border:1px solid ${isSel ? 'var(--accent)' : 'rgba(255,255,255,0.25)'};
        display:flex;align-items:center;justify-content:center;
        font-size:10px;color:var(--bg)">${isSel ? '✓' : ''}</div>
      ${preset.thumbnail
        ? `<img src="${preset.thumbnail}" style="width:100%;aspect-ratio:16/9;
             object-fit:cover;display:block;border-bottom:1px solid var(--border-dim)">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg);
             display:flex;align-items:center;justify-content:center;
             font-size:20px;border-bottom:1px solid var(--border-dim)">◈</div>`
      }
      <div style="padding:5px 8px">
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    margin-bottom:1px">${preset.name}</div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
          ${preset.layers?.length ?? 0} layers
        </div>
      </div>
      <div class="pb-card-actions" style="position:absolute;top:4px;right:4px;
        display:flex;gap:3px;opacity:0;transition:opacity 0.15s">
        <button class="pb-dl" title="Download"
          style="background:rgba(0,0,0,0.7);border:none;border-radius:3px;
                 color:#00d4aa;cursor:pointer;font-size:10px;padding:2px 5px">↓</button>
        <button class="pb-del" title="Delete"
          style="background:rgba(0,0,0,0.7);border:none;border-radius:3px;
                 color:#ff4444;cursor:pointer;font-size:10px;padding:2px 5px">✕</button>
      </div>
    `;

    card.addEventListener('mouseenter', () => {
      if (!_selected.has(preset.name)) card.style.borderColor = 'var(--accent2)';
      card.style.transform = 'scale(1.02)';
      card.querySelector('.pb-card-actions').style.opacity = '1';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = _selected.has(preset.name) ? 'var(--accent)' : 'var(--border-dim)';
      card.style.transform = 'scale(1)';
      card.querySelector('.pb-card-actions').style.opacity = '0';
    });

    // Click body = load; click checkbox = select toggle
    card.addEventListener('click', e => {
      if (e.target.closest('.pb-card-actions') || e.target.closest('.pb-sel-chk')) return;
      _applyPreset(preset);
      close();
    });
    card.querySelector('.pb-sel-chk').addEventListener('click', e => {
      e.stopPropagation();
      _toggleSelect(preset.name);
      _renderGrid();
    });
    card.querySelector('.pb-dl').addEventListener('click', e => {
      e.stopPropagation();
      _downloadPreset(preset);
    });
    card.querySelector('.pb-del').addEventListener('click', e => {
      e.stopPropagation();
      _selected.delete(preset.name);
      remove(preset.name);
      _updateBulkButtons();
      _renderGrid();
      Toast.info(`Deleted "${preset.name}"`);
    });

    return card;
  }

  function _buildListRow(preset) {
    const isSel = _selected.has(preset.name);
    const row   = document.createElement('div');
    row.style.cssText = `
      display:flex;align-items:center;gap:8px;padding:6px 8px;
      background:var(--bg-card);border:1px solid ${isSel ? 'var(--accent)' : 'var(--border-dim)'};
      border-radius:5px;cursor:pointer;transition:border-color 0.15s;
    `;

    // Checkbox
    const chk = document.createElement('div');
    chk.style.cssText = `flex-shrink:0;width:14px;height:14px;border-radius:3px;
      background:${isSel ? 'var(--accent)' : 'transparent'};
      border:1px solid ${isSel ? 'var(--accent)' : 'var(--border)'};
      display:flex;align-items:center;justify-content:center;
      font-size:9px;color:var(--bg);cursor:pointer`;
    chk.textContent = isSel ? '✓' : '';
    chk.addEventListener('click', e => { e.stopPropagation(); _toggleSelect(preset.name); _renderGrid(); });

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.style.cssText = 'flex-shrink:0;width:48px;height:27px;border-radius:3px;overflow:hidden;background:var(--bg)';
    if (preset.thumbnail) {
      const img = document.createElement('img');
      img.src = preset.thumbnail;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      thumb.appendChild(img);
    } else {
      thumb.style.cssText += ';display:flex;align-items:center;justify-content:center;font-size:14px';
      thumb.textContent = '◈';
    }

    // Name + meta
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preset.name}</div>
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
        ${preset.layers?.length ?? 0} layers
      </div>
    `;

    // Actions
    const dlBtn = document.createElement('button');
    dlBtn.title = 'Download';
    dlBtn.style.cssText = 'background:none;border:none;color:#00d4aa;cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0';
    dlBtn.textContent = '↓';
    dlBtn.addEventListener('click', e => { e.stopPropagation(); _downloadPreset(preset); });

    const delBtn = document.createElement('button');
    delBtn.title = 'Delete';
    delBtn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', e => { e.stopPropagation(); _selected.delete(preset.name); remove(preset.name); _updateBulkButtons(); _renderGrid(); Toast.info(`Deleted "${preset.name}"`); });

    row.append(chk, thumb, info, dlBtn, delBtn);

    row.addEventListener('mouseenter', () => { if (!isSel) row.style.borderColor = 'var(--accent2)'; });
    row.addEventListener('mouseleave', () => { row.style.borderColor = _selected.has(preset.name) ? 'var(--accent)' : 'var(--border-dim)'; });
    row.addEventListener('click', () => { _applyPreset(preset); close(); });

    return row;
  }

  function _toggleSelect(name) {
    if (_selected.has(name)) _selected.delete(name);
    else _selected.add(name);
    _updateBulkButtons();
  }

  function open() {
    if (!_panel) return;
    _searchText = '';
    _selected.clear();
    const searchEl = _panel.querySelector('#pb-search');
    if (searchEl) searchEl.value = '';
    _updateBulkButtons();
    _renderGrid();
    _panel.style.display = 'flex';
    _isOpen = true;

    const sceneNameEl = document.getElementById('preset-name');
    const pbNameEl    = _panel.querySelector('#pb-save-name');
    if (sceneNameEl && pbNameEl && !pbNameEl.value) {
      pbNameEl.value = sceneNameEl.value || '';
    }
  }

  function close() {
    if (!_panel) return;
    _panel.style.display = 'none';
    _isOpen = false;
  }

  function toggle() {
    _isOpen ? close() : open();
  }

  return { init, save, remove, open, close, toggle, _getAll, _applyPreset };

})();
