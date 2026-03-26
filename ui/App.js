/**
 * ui/App.js
 * Top-level application controller.
 * Wires all engine modules to the UI.
 */

(function () {
  'use strict';

  // ── Engine instances ─────────────────────────────────────────
  const canvas   = document.getElementById('main-canvas');
  const renderer = new Renderer(canvas);
  const audio    = new AudioEngine();
  const video    = new VideoEngine();
  const recorder = new Recorder();
  const layers   = new LayerStack();
  const beat     = new BeatDetector();

  renderer.layerStack = layers;
  renderer.audioData  = audio.smoothed;
  renderer.videoData  = video.smoothed;

  // Currently selected layer for param editing
  let _selectedLayerId = null;

  // ── Layer factory (used by preset loader) ────────────────────
  function layerFactory(typeName, id) {
    const uid = id || `${typeName}-${Date.now()}`;
    switch (typeName) {
      case 'GradientLayer':    return new GradientLayer(uid);
      case 'MathVisualizer':   return new MathVisualizer(uid);
      case 'ParticleLayer':    return new ParticleLayer(uid);
      case 'NoiseFieldLayer':  return new NoiseFieldLayer(uid);
      case 'VideoPlayerLayer': return new VideoPlayerLayer(uid, video.videoElement);
      case 'ShaderLayer':      return new ShaderLayer(uid);
      case 'LyricsLayer':      return new LyricsLayer(uid);
      case 'WebcamLayer':      return new WebcamLayer(uid);
      case 'ImageLayer':       return new ImageLayer(uid);
      case 'GroupLayer':       return new GroupLayer(uid);
      default: console.warn('Unknown layer type:', typeName); return null;
    }
  }

  function _renderImageLayerPanel(layer, container) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'font-family:var(--font-mono);font-size:10px;letter-spacing:1.5px;color:var(--accent);margin-bottom:14px;text-transform:uppercase';
    header.textContent = 'Image Layer';
    container.appendChild(header);

    // Load button + status
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px';
    statusEl.textContent = layer._loaded ? `Loaded: ${layer._fileName}` : 'No image loaded';
    container.appendChild(statusEl);

    const loadBtn = document.createElement('button');
    loadBtn.className   = 'btn accent';
    loadBtn.style.width = '100%';
    loadBtn.style.marginBottom = '14px';
    loadBtn.textContent = '↑ Load image file…';
    container.appendChild(loadBtn);

    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      await layer.loadFile(file);
      statusEl.textContent = `Loaded: ${layer._fileName}`;
      e.target.value = '';
    });

    // Tip
    const tip = document.createElement('p');
    tip.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:14px';
    tip.innerHTML = 'Use a PNG with transparency. Set this layer as the <strong style="color:var(--accent2)">mask</strong> on another layer (e.g. Particles) so those layers only appear inside the image shape.';
    container.appendChild(tip);

    // Standard params
    ParamPanel.render(layer, container, audio);
  }
  PresetBrowser.init(layers, layerFactory, (preset) => {
    // After loading, update the scene name input and re-render layer list
    const nameEl = document.getElementById('preset-name');
    if (nameEl && preset.name) nameEl.value = preset.name;
    _selectedLayerId = null;
    document.getElementById('params-content').innerHTML = '';
    document.getElementById('params-empty').style.display = 'block';
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => {
    PresetBrowser.toggle();
  });
  const setlist  = new SetlistManager(layers, layerFactory);
  const perfMode = new PerformanceMode({ setlist, audio, beatDetector: beat, layerStack: layers });

  // Sync fade duration slider from setlist panel → engine
  document.addEventListener('vael:fade-duration', e => {
    setlist.fadeDuration = e.detail;
  });

  // ── MIDI ──────────────────────────────────────────────────────
  const midi = new MidiEngine(layers);
  midi.init().then(() => {
    MidiPanel.init(midi, layers, document.getElementById('midi-panel-content'));
  });

  // ── OSC Bridge ───────────────────────────────────────────────
  // Connects to a local WebSocket bridge (see OscBridge.js for setup).
  // Silently fails if the bridge isn't running — no effect on normal use.
  const osc = new OscBridge({ layerStack: layers, setlist, recorder });
  osc.connect('ws://localhost:8080');

  // ── LFO Modulator ─────────────────────────────────────────────
  const lfoManager = new LFOManager();
  LFOPanel.init(lfoManager, layers, document.getElementById('lfo-panel-content'));

  // ── Post-processing FX ────────────────────────────────────────
  PostFXPanel.init(renderer, document.getElementById('fx-panel-content'));

  // ── Sequencer ────────────────────────────────────────────────
  const seq = new Sequencer();
  SequencerPanel.init(seq, beat, document.getElementById('beat-panel-content'));

  // Wire sequencer events to visual flash overlay
  seq.onStep = (step, event) => {
    if (event === 'flash' || event === 'beat') {
      // Inject isBeat signal into audio data for this frame
      audio.smoothed.isBeat = true;
      setTimeout(() => { audio.smoothed.isBeat = false; }, 50);
    }
  };

  // T key for tap tempo
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); seq.tapTempo(); }
  });

  // MIDI learn — triggered from MidiPanel when learn button clicked
  window.addEventListener('vael:midi-learn-requested', () => {
    if (!_selectedLayerId) {
      alert('Select a layer first (click a layer name in the Layers tab), then go to the MIDI tab and click Learn.');
      return;
    }
    // Default: learn to the first float param of the selected layer
    const layer = layers.layers.find(l => l.id === _selectedLayerId);
    if (!layer) return;
    const manifest = layer.constructor.manifest;
    const param    = manifest?.params?.find(p => p.type === 'float' || p.type === 'int');
    if (!param) { alert('No learnable parameters on this layer.'); return; }
    midi.startLearn(_selectedLayerId, param.id, param.min ?? 0, param.max ?? 1);
    MidiPanel.refresh();
  });

  // ── Layer picker config ──────────────────────────────────────
  const LAYER_TYPES = [
    { id: 'gradient',    label: 'Gradient',            cls: () => new GradientLayer(`gradient-${Date.now()}`) },
    { id: 'math',        label: 'Math Visualizer',      cls: () => new MathVisualizer(`math-${Date.now()}`) },
    { id: 'particles',   label: 'Particles',            cls: () => new ParticleLayer(`particles-${Date.now()}`) },
    { id: 'noise',       label: 'Noise Field',          cls: () => new NoiseFieldLayer(`noise-${Date.now()}`) },
    { id: 'lyrics',      label: 'Lyrics / Text',        cls: () => new LyricsLayer(`lyrics-${Date.now()}`) },
    { id: 'video',       label: 'Video file',           cls: () => new VideoPlayerLayer(`video-${Date.now()}`, video.videoElement) },
    { id: 'webcam',      label: 'Webcam',               cls: () => new WebcamLayer(`webcam-${Date.now()}`) },
    { id: 'image',       label: 'Image (PNG/JPG/SVG)',  cls: () => new ImageLayer(`image-${Date.now()}`) },
    { id: 'shader-plasma',   label: 'Shader — Plasma',    cls: () => ShaderLayer.fromBuiltin('plasma') },
    { id: 'shader-ripple',   label: 'Shader — Ripple',    cls: () => ShaderLayer.fromBuiltin('ripple') },
    { id: 'shader-distort',  label: 'Shader — Distort',   cls: () => ShaderLayer.fromBuiltin('distort') },
    { id: 'shader-bloom',    label: 'Shader — Bloom',     cls: () => ShaderLayer.fromBuiltin('bloom') },
    { id: 'shader-chromatic',label: 'Shader — Chromatic', cls: () => ShaderLayer.fromBuiltin('chromatic') },
  ];

  const BLEND_MODES = ['normal','multiply','screen','overlay','add','softlight','difference','luminosity','subtract','exclusion'];

  // ── Default scene ────────────────────────────────────────────
  // A polished starting point — noise field + math visualizer + subtle particles
  const noiseLayer = new NoiseFieldLayer('noise-default');
  noiseLayer.init({ hueA: 210, hueB: 260, speed: 0.10, lightness: 0.10, saturation: 0.7 });
  noiseLayer.opacity   = 1.0;
  noiseLayer.blendMode = 'normal';

  const mathLayer = new MathVisualizer('math-default');
  mathLayer.init({
    mode:        'path',
    constant:    'pi',
    colorMode:   'rainbow',
    digitCount:  800,
    angle:       36,
    lineWidth:   1.4,
    zoom:        0.9,
    audioTarget: 'bass',
  });
  mathLayer.opacity   = 0.9;
  mathLayer.blendMode = 'screen';

  const particleLayer = new ParticleLayer('particles-default');
  particleLayer.init({ mode: 'drift', count: 300, size: 1.5, speed: 0.25, colorMode: 'rainbow' });
  particleLayer.opacity   = 0.35;
  particleLayer.blendMode = 'add';

  layers.add(noiseLayer);
  layers.add(mathLayer);
  layers.add(particleLayer);

  renderer.start();

  // Restore last autosave if no scene was force-loaded
  setTimeout(() => _restoreAutoSave(), 100);

  // ── Layer panel ──────────────────────────────────────────────
  const layerList    = document.getElementById('layer-list');
  const emptyState   = document.getElementById('layers-empty');
  const paramsEmpty  = document.getElementById('params-empty');
  const paramsContent = document.getElementById('params-content');

  layers.onChanged = () => renderLayerList();

  function selectLayer(id) {
    _selectedLayerId = id;

    // Search both top-level layers and group children
    let layer = layers.layers.find(l => l.id === id);
    if (!layer) {
      // Search inside groups
      for (const l of layers.layers) {
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

    paramsEmpty.style.display   = 'none';
    paramsContent.style.display = 'block';

    if (layer instanceof LyricsLayer) {
      LyricsPanel.render(layer, paramsContent);
    } else if (layer instanceof ShaderLayer) {
      ShaderPanel.render(layer, paramsContent);
    } else if (layer instanceof ImageLayer) {
      _renderImageLayerPanel(layer, paramsContent);
    } else {
      ParamPanel.render(layer, paramsContent, audio);
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="params"]').classList.add('active');
    document.getElementById('tab-params').classList.add('active');
  }

  // ── Multi-select state ───────────────────────────────────────
  let _multiSelect = new Set();  // selected layer ids for grouping

  function renderLayerList() {
    layerList.innerHTML = '';
    const hasLayers = layers.count > 0;
    emptyState.style.display = hasLayers ? 'none' : 'block';

    // Show group button only when 2+ layers selected
    const groupBtn = document.getElementById('btn-group-selected');
    if (groupBtn) {
      groupBtn.style.display = _multiSelect.size >= 2 ? 'block' : 'none';
      groupBtn.textContent = `⊞ Group ${_multiSelect.size} selected layers`;
    }

    // Render in reverse so top layer appears first in UI
    [...layers.layers].reverse().forEach(layer => {
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
        const fromIdx = layers.layers.findIndex(l => l.id === fromId);
        const toIdx   = layers.layers.findIndex(l => l.id === layer.id);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = layers.layers.splice(fromIdx, 1);
        layers.layers.splice(toIdx, 0, moved);
        layers._notify();
      });

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <input type="checkbox" class="layer-select-cb"
            ${isMultiSelected ? 'checked' : ''}
            style="accent-color:var(--accent2);cursor:pointer;flex-shrink:0"
            title="Select for grouping" />
          <button class="vis-toggle" data-id="${layer.id}" title="Toggle visibility"
            style="background:none;border:none;cursor:pointer;font-size:13px;
                   color:${layer.visible ? 'var(--accent)' : 'var(--text-dim)'}">
            ${layer.visible ? '◉' : '○'}
          </button>
          <span class="layer-name-btn" style="flex:1;font-family:var(--font-mono);
                font-size:10px;color:var(--text);cursor:pointer">
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
            ${BLEND_MODES.map(m =>
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
            ${layers.layers
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
      row.querySelector('.layer-name-btn').addEventListener('click', e => {
        e.stopPropagation();
        selectLayer(layer.id);
      });

      row.querySelector('.vis-toggle').addEventListener('click', e => {
        e.stopPropagation();
        layers.setVisible(layer.id, !layer.visible);
      });

      // Up/down only on non-group layers
      row.querySelector('.layer-up')?.addEventListener('click', e => {
        e.stopPropagation();
        layers.moveUp(layer.id);
      });
      row.querySelector('.layer-down')?.addEventListener('click', e => {
        e.stopPropagation();
        layers.moveDown(layer.id);
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
        const groupIdx = layers.layers.indexOf(layer);
        const children = [...layer.children];
        layers.remove(layer.id);
        children.forEach((child, i) => {
          layers.layers.splice(groupIdx + i, 0, child);
        });
        layers._notify();
        Toast.success(`Ungrouped — ${children.length} layers restored`);
      });
      row.querySelector('.layer-del').addEventListener('click', e => {
        e.stopPropagation();
        // Remove immediately — show undo toast instead of confirm dialog
        if (_selectedLayerId === layer.id) {
          _selectedLayerId = null;
          paramsContent.innerHTML = '';
          paramsEmpty.style.display = 'block';
        }
        // Snapshot the layer data before removing for undo
        const snapshot = typeof layer.toJSON === 'function' ? layer.toJSON() : null;
        const removedName = layer.name;
        const removedIndex = layers.layers.indexOf(layer);
        layers.remove(layer.id);

        // Undo toast — stays for 4 seconds
        const undoToast = Toast.warn(`Removed "${removedName}" — `, 4000);
        if (undoToast) {
          const undoBtn = document.createElement('button');
          undoBtn.textContent = 'Undo';
          undoBtn.style.cssText = 'background:none;border:1px solid currentColor;border-radius:3px;padding:1px 6px;cursor:pointer;font-family:inherit;font-size:inherit;color:inherit;margin-left:4px';
          undoBtn.addEventListener('click', () => {
            if (snapshot) {
              const restored = layerFactory(snapshot.type, snapshot.id);
              if (restored) {
                restored.name      = snapshot.name;
                restored.visible   = snapshot.visible ?? true;
                restored.opacity   = snapshot.opacity ?? 1;
                restored.blendMode = snapshot.blendMode ?? 'normal';
                if (snapshot.params && restored.params) Object.assign(restored.params, snapshot.params);
                if (snapshot.transform && restored.transform) Object.assign(restored.transform, snapshot.transform);
                if (typeof restored.init === 'function') restored.init(restored.params || {});
                layers.add(restored);
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
        layers.setOpacity(layer.id, v);
        row.querySelector('.opacity-val').textContent = Math.round(v * 100) + '%';
      });
      row.querySelector('.blend-sel').addEventListener('change', e => {
        layers.setBlendMode(layer.id, e.target.value);
      });
      row.querySelector('.mask-sel').addEventListener('change', e => {
        layer.maskLayerId = e.target.value || null;
        if (layer.maskLayerId) Toast.info(`Mask set: ${layer.name} → ${layers.layers.find(l=>l.id===layer.maskLayerId)?.name}`);
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
        const newLayer = layerFactory(layer.constructor.name);
        if (!newLayer) return;
        newLayer.name      = layer.name + ' copy';
        newLayer.opacity   = layer.opacity;
        newLayer.blendMode = layer.blendMode;
        newLayer.transform = { ...layer.transform };
        if (layer.params)  newLayer.params = { ...layer.params };
        if (typeof newLayer.init === 'function') newLayer.init(newLayer.params || {});
        layers.add(newLayer);
        Toast.success(`Duplicated: ${layer.name}`);
      });

      layerList.appendChild(row);

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
            if (!layers.layers.find(l => l.id === child.id)) {
              layers.layers.push(child);
              selectLayer(child.id);
              layers.layers.pop();
            }
          });

          childRow.querySelector('.child-eject').addEventListener('click', e => {
            e.stopPropagation();
            layer.removeChild(child.id);
            const groupIdx = layers.layers.indexOf(layer);
            layers.layers.splice(groupIdx + 1, 0, child);
            layers._notify();
            Toast.info(`${child.name} moved out of group`);
          });

          layerList.appendChild(childRow);
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
      .map(id => layers.layers.find(l => l.id === id))
      .filter(Boolean);
    if (selectedLayers.length < 2) { Toast.warn('Select 2+ layers to group'); return; }

    const group = new GroupLayer(`group-${Date.now()}`);
    group.name = 'Group';

    // Insert at the position of the topmost selected layer
    const indices = selectedLayers.map(l => layers.layers.indexOf(l));
    const insertAt = Math.min(...indices);

    selectedLayers.forEach(l => {
      layers.layers.splice(layers.layers.indexOf(l), 1);
      group.addChild(l);
    });

    layers.layers.splice(insertAt, 0, group);
    _multiSelect.clear();
    layers._notify();
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
        ${LAYER_TYPES.map(t => `
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
        const def = LAYER_TYPES.find(t => t.id === typeId);
        if (def) {
          const layer = def.cls();
          if (typeof layer.init === 'function') layer.init({});
          layers.add(layer);
          // Auto-select and show params
          setTimeout(() => selectLayer(layer.id), 50);
        }
        picker.remove();
      }
      if (e.target.id === 'picker-cancel' || e.target === picker) picker.remove();
    });
    document.body.appendChild(picker);
  }

  // ── Preset save / load ────────────────────────────────────────
  document.getElementById('btn-preset-save').addEventListener('click', () => {
    const name = document.getElementById('preset-name').value.trim() || 'scene';

    // Capture thumbnail
    let thumb = null;
    try {
      const t = document.createElement('canvas');
      t.width = 120; t.height = 68;
      t.getContext('2d').drawImage(canvas, 0, 0, 120, 68);
      thumb = t.toDataURL('image/jpeg', 0.6);
    } catch {}

    // Save to in-app library
    PresetBrowser.save(layers, name, thumb);

    // Also download .json file
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
    Toast.success(`Scene "${name}" saved to library`);
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => {
    PresetBrowser.toggle();
  });

  document.getElementById('btn-scene-new')?.addEventListener('click', () => {
    _autoSave();
    [...layers.layers].forEach(l => layers.remove(l.id));
    _selectedLayerId = null;
    _multiSelect.clear();
    document.getElementById('params-content').innerHTML = '';
    document.getElementById('params-empty').style.display = 'block';
    document.getElementById('preset-name').value = 'my-scene';
    Toast.info('New scene — previous work auto-saved');
  });

  document.getElementById('btn-preset-load').addEventListener('click', () => {
    document.getElementById('input-preset-file').click();
  });

  document.getElementById('input-preset-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const preset = await PresetManager.load(file, layers, layerFactory);
      if (preset.name) document.getElementById('preset-name').value = preset.name;
      _selectedLayerId = null;
      paramsContent.innerHTML = '';
      paramsEmpty.style.display = 'block';
      Toast.success(`Scene "${preset.name || file.name}" loaded`);
    } catch (err) {
      Toast.error(`Could not load preset: ${err.message}`);
    }
    e.target.value = '';
  });

  // Initial render of layer list
  renderLayerList();

  // ── Status strip ─────────────────────────────────────────────
  const dotAudio    = document.getElementById('dot-audio');
  const labelAudio  = document.getElementById('label-audio');
  const dotVideo    = document.getElementById('dot-video');
  const labelVideo  = document.getElementById('label-video');
  const labelFps    = document.getElementById('label-fps');
  const labelLayers = document.getElementById('label-layers');

  renderer.onFrame = (dt, fps) => {
    labelFps.textContent    = `${fps} fps`;
    labelLayers.textContent = `${layers.count} layer${layers.count !== 1 ? 's' : ''}`;

    renderer.audioData = audio.smoothed;
    renderer.videoData = video.smoothed;

    // Beat detection
    beat.update(audio.smoothed, audio._dataArray);
    audio.smoothed.isBeat = beat.isBeat;
    audio.smoothed.bpm    = beat.bpm;

    // Merge video analysis so layers can target brightness/motion etc.
    if (video.smoothed.isActive) {
      audio.smoothed.brightness  = video.smoothed.brightness;
      audio.smoothed.motion      = video.smoothed.motion;
      audio.smoothed.hue         = video.smoothed.hue;
      audio.smoothed.edgeDensity = video.smoothed.edgeDensity;
    }

    // ── Synthesize a clock signal when no audio is active ────────
    // This lets layers animate without needing audio loaded.
    // Uses iTime and a synthetic 120bpm sine wave on bass/volume.
    if (!audio.smoothed.isActive) {
      const t = performance.now() / 1000;
      const bpm = seq.bpm || 120;
      const beatPhase = (t * bpm / 60) % 1;
      const pulse = Math.pow(Math.max(0, Math.sin(beatPhase * Math.PI)), 3);
      audio.smoothed.bass   = pulse * 0.6;
      audio.smoothed.mid    = pulse * 0.3;
      audio.smoothed.treble = 0;
      audio.smoothed.volume = pulse * 0.4;
      audio.smoothed.isActive = false;
    }

    seq.tick(dt);
    lfoManager.tick(dt, beat.bpm || seq.bpm, layers);
    setlist.tick(dt);
    perfMode.tick(dt);

    // Panel ticks (scrubbers + VU meters)
    AudioPanel.tick(audio.smoothed);
    VideoPanel.tick();

    dotAudio.classList.toggle('inactive', !audio.smoothed.isActive);
  };

  // ── AI Assistant ──────────────────────────────────────────────
  VaelAssistant.init(layers, layerFactory, renderer);
  // Save the current scene to localStorage every 5 minutes
  // Also save on page unload so you never lose work
  const AUTOSAVE_KEY = 'vael-autosave';

  function _autoSave() {
    try {
      const preset = {
        vael:   '1.0',
        name:   document.getElementById('preset-name')?.value || 'autosave',
        saved:  new Date().toISOString(),
        layers: layers.layers.map(layer => {
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
          if (layer instanceof GroupLayer) {
            base.collapsed = layer.collapsed;
            base.children  = layer.children.map(c => {
              const cb = { type: c.constructor.name, id: c.id, name: c.name,
                           visible: c.visible, opacity: c.opacity, blendMode: c.blendMode,
                           transform: { ...c.transform }, modMatrix: c.modMatrix?.toJSON() || [] };
              if (c.params) cb.params = { ...c.params };
              return cb;
            });
          }
          return base;
        }),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(preset));
    } catch (e) { console.warn('Auto-save failed:', e); }
  }

  // Restore autosave if no scene loaded yet
  function _restoreAutoSave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved) return;
      const preset = JSON.parse(saved);
      if (!preset.layers?.length) return;
      // Only restore if no layers currently (fresh open)
      if (layers.count > 0) return;
      PresetManager._applyRaw(preset, layers, layerFactory);
      Toast.info(`Restored autosave: "${preset.name}"`);
    } catch {}
  }

  setInterval(_autoSave, 5 * 60 * 1000);   // every 5 minutes
  window.addEventListener('beforeunload', _autoSave);  // on page close
  AudioPanel.init(audio, dotAudio, labelAudio);
  VideoPanel.init(video, audio, layers, dotVideo, labelVideo);
  RecordPanel.init(recorder, audio, canvas, renderer);

  // ── Tab switching ─────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  const shortcutOverlay = document.getElementById('shortcut-overlay');
  function toggleShortcuts() {
    const open = shortcutOverlay.style.display === 'flex';
    shortcutOverlay.style.display = open ? 'none' : 'flex';
  }
  document.getElementById('shortcut-close')?.addEventListener('click', toggleShortcuts);
  shortcutOverlay?.addEventListener('click', e => { if (e.target === shortcutOverlay) toggleShortcuts(); });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') {
      e.preventDefault();
      const btnPlay = document.getElementById('btn-audio-play');
      if (audio.isPlaying) { audio.pause(); if (btnPlay) btnPlay.textContent = '▶'; }
      else                 { audio.play();  if (btnPlay) btnPlay.textContent = '⏸'; }
    }
    if (e.key === '?') { e.preventDefault(); toggleShortcuts(); }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const lyricsLayer = [...layers.layers].reverse().find(l => l instanceof LyricsLayer && l.visible);
      if (lyricsLayer) e.key === 'PageDown' ? lyricsLayer.next() : lyricsLayer.prev();
    }
  });

  // ── Auto-stop recording when audio song ends ──────────────────
  audio.onStateChange = state => {
    if (state.sourceType === 'file' && !state.isPlaying) RecordPanel.onAudioEnd();
  };

  console.log('%cVAEL%c — Light onto Sound',
    'color:#00d4aa;font-weight:bold;font-size:18px;letter-spacing:4px',
    'color:#7878a0;font-size:12px');
  setTimeout(() => Toast.info('Vael ready — press ? for shortcuts'), 800);

})();
