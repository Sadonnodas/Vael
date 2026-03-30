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
        if (typeof layer.init === 'function') layer.init(layer.params || {});
        _layerStack.add(layer);
      } catch (e) { console.warn('PresetBrowser: could not load layer', e); }
    });
    if (typeof _onLoad === 'function') _onLoad(preset);
    Toast.success(`Loaded: ${preset.name}`);
  }

  // ── UI ───────────────────────────────────────────────────────

  let _panel     = null;
  let _isOpen    = false;

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
      display: none;
      position: absolute;
      inset: 0;
      background: var(--bg-mid);
      z-index: 100;
      display: none;
      flex-direction: column;
      overflow: hidden;
    `;

    _panel.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      ">
        <span style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                     color:var(--accent);flex:1">SCENE LIBRARY</span>
        <span id="pb-count" style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim)"></span>
        <button id="pb-close" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-size:16px;line-height:1;padding:0">✕</button>
      </div>
      <div id="pb-grid" style="
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        align-content: start;
        scrollbar-width: thin;
        scrollbar-color: var(--border) var(--bg-mid);
      "></div>
      <div style="
        padding: 10px 16px;
        border-top: 1px solid var(--border);
        flex-shrink: 0;
        display: flex;
        gap: 6px;
      ">
        <input type="text" id="pb-save-name" placeholder="Scene name…"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                 color:var(--text);font-family:var(--font-mono);font-size:10px;padding:7px 10px" />
        <button id="pb-save-btn" class="btn accent" style="flex-shrink:0;font-size:9px">
          ⊕ Save current
        </button>
      </div>
    `;

    // Insert into sidebar
    const sidebar = document.getElementById('sidebar-content');
    if (sidebar) {
      sidebar.style.position = 'relative';
      sidebar.appendChild(_panel);
    }

    // Wire close
    _panel.querySelector('#pb-close').addEventListener('click', close);

    // Wire save
    _panel.querySelector('#pb-save-btn').addEventListener('click', () => {
      const nameEl = _panel.querySelector('#pb-save-name');
      const name   = nameEl.value.trim() || `Scene ${new Date().toLocaleTimeString()}`;

      // Capture thumbnail from canvas
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

  function _renderGrid() {
    const grid    = _panel.querySelector('#pb-grid');
    const countEl = _panel.querySelector('#pb-count');
    const presets = _getAll();

    countEl.textContent = `${presets.length} / ${MAX_CAP}`;
    grid.innerHTML = '';

    // Starter templates (always shown at top if library is empty)
    if (presets.length === 0) {
      const startersEl = document.createElement('div');
      startersEl.style.cssText = 'grid-column:1/-1;margin-bottom:12px';
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
          if (starter) {
            _applyPreset(starter.preset);
            close();
          }
        });
      });

      grid.appendChild(startersEl);
      return;
    }

    presets.forEach(preset => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--bg-card);
        border: 1px solid var(--border-dim);
        border-radius: 6px;
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.15s, transform 0.1s;
        position: relative;
      `;

      card.innerHTML = `
        ${preset.thumbnail
          ? `<img src="${preset.thumbnail}" style="width:100%;aspect-ratio:16/9;
               object-fit:cover;display:block;border-bottom:1px solid var(--border-dim)">`
          : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg);
               display:flex;align-items:center;justify-content:center;
               font-size:20px;border-bottom:1px solid var(--border-dim)">◈</div>`
        }
        <div style="padding:6px 8px">
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                      margin-bottom:2px">${preset.name}</div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">
            ${preset.layers?.length ?? 0} layers
          </div>
        </div>
        <div class="pb-card-actions" style="
          position:absolute;top:4px;right:4px;
          display:flex;gap:3px;opacity:0;transition:opacity 0.15s
        ">
          <button class="pb-del" title="Delete"
            style="background:rgba(0,0,0,0.7);border:none;border-radius:3px;
                   color:#ff4444;cursor:pointer;font-size:10px;padding:2px 5px">✕</button>
        </div>
      `;

      card.addEventListener('mouseenter', () => {
        card.style.borderColor = 'var(--accent)';
        card.style.transform   = 'scale(1.02)';
        card.querySelector('.pb-card-actions').style.opacity = '1';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'var(--border-dim)';
        card.style.transform   = 'scale(1)';
        card.querySelector('.pb-card-actions').style.opacity = '0';
      });

      card.addEventListener('click', e => {
        if (e.target.closest('.pb-card-actions')) return;
        _applyPreset(preset);
        close();
      });

      card.querySelector('.pb-del').addEventListener('click', e => {
        e.stopPropagation();
        remove(preset.name);
        _renderGrid();
        Toast.info(`Deleted "${preset.name}"`);
      });

      grid.appendChild(card);
    });
  }

  function open() {
    if (!_panel) return;
    _renderGrid();
    _panel.style.display = 'flex';
    _isOpen = true;

    // Pre-fill name input from current scene name input
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
