/**
 * ui/App.js
 * Top-level application controller.
 */

(function () {
  'use strict';

  const canvas   = document.getElementById('main-canvas');
  const renderer = new Renderer(canvas);
  window._vaelRenderer = renderer;  // exposes .width/.height (logical CSS px) to layers
  const audio    = new AudioEngine();
  const video    = new VideoEngine();
  const recorder = new Recorder();
  const layers   = new LayerStack();
  const beat     = new BeatDetector();

  const videoLibrary  = new VideoLibrary();
  window.videoLibrary = videoLibrary;

  renderer.layerStack = layers;
  renderer.audioData  = audio.smoothed;
  renderer.videoData  = video.smoothed;

  let _selectedLayerId = null;

  // ── Layer factory ────────────────────────────────────────────
  function layerFactory(typeName, id) {
    const uid = id || `${typeName}-${Date.now()}`;
    switch (typeName) {
      case 'GradientLayer':    return new GradientLayer(uid);
      case 'MathVisualizer':   return new MathVisualizer(uid);
      case 'ParticleLayer':    return new ParticleLayer(uid);
      case 'NoiseFieldLayer':  return new NoiseFieldLayer(uid);
      case 'VideoPlayerLayer': return new VideoPlayerLayer(uid);
      case 'ShaderLayer':      return new ShaderLayer(uid);
      case 'LyricsLayer':      return new LyricsLayer(uid);
      case 'WebcamLayer':      return new WebcamLayer(uid);
      case 'WaveformLayer':    { const l = new WaveformLayer(uid); l._audioEngine = audio; return l; }
      case 'PatternLayer':     return new PatternLayer(uid);
      case 'ImageLayer':       return new ImageLayer(uid);
      case 'GroupLayer':       return new GroupLayer(uid);
      case 'CanvasPaintLayer': return new CanvasPaintLayer(uid);
      case 'SVGLayer':         return new SVGLayer(uid);
      case 'FeedbackLayer':    return new FeedbackLayer(uid);
      case 'SlideshowLayer':   return new SlideshowLayer(uid);
      default: console.warn('Unknown layer type:', typeName); return null;
    }
  }

  // ── Image layer panel ─────────────────────────────────────────
  function _renderImageLayerPanel(layer, container) {
    container.innerHTML = '';
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Image'));
    }

    // If image already loaded, show Change button instead of full picker
    if (layer._sourceName || layer._imageUrl) {
      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn accent';
      changeBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:10px';
      changeBtn.textContent = '🖼 ' + (layer._sourceName || 'Image') + ' — Change image';
      changeBtn.addEventListener('click', () => {
        LibraryPanel.promptImageForLayer(layer, container);
        setTimeout(() => _renderImageLayerPanel(layer, container), 50);
      });
      container.appendChild(changeBtn);
    } else {
      LibraryPanel.promptImageForLayer(layer, container);
    }

    const tip = document.createElement('p');
    tip.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:14px;margin-top:4px';
    tip.innerHTML = 'Use a PNG with transparency as a <strong style="color:var(--accent2)">mask</strong> on another layer, or any image as a visual with blend modes.';
    container.appendChild(tip);
    ParamPanel.render(layer, container, audio);
  }

  // ── Image upload events ───────────────────────────────────────
  window.addEventListener('vael:image-single-added', async e => {
    const pendingLayer = window._pendingImageLayer;
    if (!pendingLayer) return;
    window._pendingImageLayer = null;
    try {
      await pendingLayer.loadFile(e.detail.file);
      if (_selectedLayerId === pendingLayer.id) {
        _renderImageLayerPanel(pendingLayer, paramsContent);
      }
      Toast.success(`Image loaded: ${e.detail.name}`);
    } catch { Toast.error('Could not load image'); }
  });

  window.addEventListener('vael:image-layer-upload', e => {
    window._pendingImageLayer = e.detail.layer;
    document.getElementById('_lib-image-single-input').value = '';
    document.getElementById('_lib-image-single-input').click();
  });

  // Wire shader library load into currently selected ShaderLayer
  window.addEventListener('vael:library-load-shader', e => {
    const { glsl, name } = e.detail;
    const layer = layers.layers.find(l => l.id === _selectedLayerId);
    if (!layer || !(layer instanceof ShaderLayer)) {
      Toast.warn('Select a Shader layer first, then click Load into selected');
      return;
    }
    layer.loadGLSL(glsl);
    if (name) layer.name = name;
    // Re-render params so the editor shows the new code
    window.dispatchEvent(new CustomEvent('vael:refresh-params'));
    Toast.success('Shader loaded: ' + (name || 'from library'));
  });

  window.addEventListener('vael:refresh-params', () => {
    if (!_selectedLayerId) return;
    const layer = _findLayerAnywhere(_selectedLayerId);
    if (!layer) return;
    if (layer instanceof ImageLayer)       _renderImageLayerPanel(layer, paramsContent);
    else if (layer instanceof ShaderLayer)      ShaderPanel.render(layer, paramsContent);
    else if (layer instanceof LyricsLayer)      LyricsPanel.render(layer, paramsContent);
    else if (layer instanceof VideoPlayerLayer) _renderVideoLayerPanel(layer, paramsContent);
    else ParamPanel.render(layer, paramsContent, audio);
  });

  function _showVideoPickerForLayer(layer) {
    _renderVideoLayerPanel(layer, paramsContent);
    // Auto-open the picker if no video loaded yet
    if (!layer._sourceUrl) _openVideoPicker(layer, paramsContent);
  }

  function _openVideoPicker(layer, container) {
    const entries = videoLibrary.entries;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono)';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;width:480px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden';

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border-dim)">
        <span style="font-size:10px;letter-spacing:2px;color:var(--accent)">SELECT VIDEO</span>
        <button id="vp-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
      </div>
      <div style="padding:12px 18px;border-bottom:1px solid var(--border-dim);display:flex;gap:8px">
        <button id="vp-upload" class="btn accent" style="font-size:9px">⬆ Upload new video</button>
        <span style="font-size:9px;color:var(--text-dim);line-height:32px">or pick from library below</span>
      </div>
      <div id="vp-list" style="overflow-y:auto;flex:1;padding:8px 18px"></div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector('#vp-list');
    if (entries.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;font-size:9px;color:var(--text-dim)">No videos in library yet.<br>Use the Upload button above.</div>';
    } else {
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-radius:4px;cursor:pointer;margin-bottom:4px;border:1px solid var(--border-dim)';
        row.innerHTML = `
          <div style="width:64px;height:36px;background:#000;border-radius:3px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
            <span style="font-size:18px;opacity:0.4">▶</span>
          </div>
          <div style="flex:1;overflow:hidden">
            <div style="font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>
            <div style="font-size:8px;color:var(--text-dim);margin-top:2px">${entry.duration ? entry.duration.toFixed(1) + 's' : ''}</div>
          </div>
          <button class="btn accent" style="font-size:8px;flex-shrink:0">Use</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
          layer.loadFromLibraryEntry(entry);
          overlay.remove();
          _renderVideoLayerPanel(layer, container);
          Toast.success(`Video: ${entry.name}`);
        });
        row.addEventListener('mouseenter', () => row.style.borderColor = 'var(--accent)');
        row.addEventListener('mouseleave', () => row.style.borderColor = 'var(--border-dim)');
        list.appendChild(row);
      });
    }

    // Upload handler — adds to library AND loads into layer
    modal.querySelector('#vp-upload').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'video/*';
      inp.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        await videoLibrary.add(file);
        layer.loadFile(file);
        overlay.remove();
        _renderVideoLayerPanel(layer, container);
        Toast.success(`Video loaded: ${file.name}`);
      });
      inp.click();
    });

    modal.querySelector('#vp-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function _renderVideoLayerPanel(layer, container) {
    container.innerHTML = '';

    // "Change video" button at top
    const changeBtn = document.createElement('button');
    changeBtn.className = 'btn accent';
    changeBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:12px';
    changeBtn.textContent = layer._sourceName ? `▶ ${layer._sourceName}  — Change video` : '⬆ Choose / upload video';
    changeBtn.addEventListener('click', () => _openVideoPicker(layer, container));
    container.appendChild(changeBtn);

    // Show video metadata if loaded
    if (layer._videoEl && layer._videoEl.readyState >= 1 && layer._videoEl.videoWidth) {
      const meta = document.createElement('div');
      meta.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:10px;line-height:1.8';
      meta.textContent = `${layer._videoEl.videoWidth}×${layer._videoEl.videoHeight}  ·  ${layer._videoEl.duration ? layer._videoEl.duration.toFixed(1) + 's' : ''}`;
      container.appendChild(meta);
    }

    // Regular params (playback speed, flip, fit, loop, muted)
    ParamPanel.render(layer, container, audio);
  }

  // Searches top-level layers AND group children
  function _findLayerAnywhere(id) {
    for (const l of layers.layers) {
      if (l.id === id) return l;
      if (l instanceof GroupLayer) {
        const child = l.children.find(c => c.id === id);
        if (child) return child;
      }
    }
    return null;
  }

  // ── MathVisualizer restart button ─────────────────────────────
  function _injectMathRestartBtn(layer, container) {
    const restartBtn = document.createElement('button');
    restartBtn.className   = 'btn';
    restartBtn.style.cssText = 'width:100%;margin-top:4px;margin-bottom:14px;font-size:9px';
    restartBtn.textContent = '↺ Restart animation';
    restartBtn.addEventListener('click', () => {
      if (typeof layer.restartBuild === 'function') layer.restartBuild();
      Toast.info('Animation restarted');
    });
    const modDivider = [...container.children].find(el => el.style?.height === '1px');
    if (modDivider) container.insertBefore(restartBtn, modDivider);
    else            container.appendChild(restartBtn);
  }

  // ── Preset browser — inline grid in SCENES tab ──────────────
  // Initialise the engine (IndexedDB storage, save/load logic)
  PresetBrowser.init(layers, layerFactory, (preset) => {
    const nameEl = document.getElementById('preset-name');
    if (nameEl && preset.name) nameEl.value = preset.name;
    _selectedLayerId = null;
    LayerPanel.setSelectedId(null);
    const pc = document.getElementById('params-content');
    const pe = document.getElementById('params-empty');
    if (pc) pc.innerHTML = '';
    if (pe) pe.style.display = 'block';
    _renderInlinePresetGrid();
  });

  // Render inline preset grid in the SCENES tab
  function _renderInlinePresetGrid() {
    const grid    = document.getElementById('pb-inline-grid');
    const countEl = document.getElementById('pb-inline-count');
    const searchEl = document.getElementById('pb-inline-search');
    const sortEl   = document.getElementById('pb-inline-sort');
    if (!grid) return;

    let presets = PresetBrowser._getAll ? PresetBrowser._getAll() : [];

    // Search filter
    const query = (searchEl?.value || '').trim().toLowerCase();
    if (query) {
      presets = presets.filter(p =>
        p.name.toLowerCase().includes(query) ||
        (p.layers || []).some(l => (l.type || '').toLowerCase().includes(query))
      );
    }

    // Sort
    const sort = sortEl?.value || 'recent';
    if (sort === 'name')   presets.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'layers') presets.sort((a, b) => (b.layers?.length ?? 0) - (a.layers?.length ?? 0));

    if (countEl) countEl.textContent = query
      ? `${presets.length} result${presets.length !== 1 ? 's' : ''}`
      : `${presets.length} preset${presets.length !== 1 ? 's' : ''} saved`;

    grid.innerHTML = '';

    if (presets.length === 0 && query) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;
        font-family:var(--font-mono);font-size:9px;color:var(--text-dim)">
        No presets matching "${query}"</div>`;
      return;
    }

    if (presets.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;
        font-family:var(--font-mono);font-size:9px;color:var(--text-dim);line-height:1.8">
        No saved presets yet.<br>
        <span style="color:var(--accent)">↓ Save scene</span> above to create one.</div>`;
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

      const layerTypes = [...new Set((preset.layers || []).map(l =>
        (l.type || '').replace('Layer','').replace('Visualizer','Math') || '?'
      ))].slice(0, 3);

      const savedDate = preset.saved
        ? new Date(preset.saved).toLocaleDateString(undefined, { month:'short', day:'numeric' })
        : '';

      card.innerHTML = `
        ${preset.thumbnail
          ? `<img src="${preset.thumbnail}" style="width:100%;aspect-ratio:16/9;
               object-fit:cover;display:block;border-bottom:1px solid var(--border-dim)">`
          : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg);
               display:flex;align-items:center;justify-content:center;
               font-size:18px;border-bottom:1px solid var(--border-dim);color:var(--text-dim)">◈</div>`
        }
        <div style="padding:5px 7px">
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">
            ${preset.name}
          </div>
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:3px">
            ${layerTypes.map(t =>
              `<span style="font-family:var(--font-mono);font-size:7px;background:rgba(255,255,255,0.06);
                            border-radius:2px;padding:1px 3px;color:var(--text-dim)">${t}</span>`
            ).join('')}
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim)">
              ${preset.layers?.length ?? 0} layers
            </span>
            <span style="font-family:var(--font-mono);font-size:7px;color:var(--text-dim);opacity:0.6">
              ${savedDate}
            </span>
          </div>
        </div>
        <button class="pb-inline-del" style="position:absolute;top:3px;right:3px;
          background:rgba(0,0,0,0.6);border:none;border-radius:2px;color:#ff4444;
          cursor:pointer;font-size:9px;padding:1px 4px;opacity:0;transition:opacity 0.15s">✕</button>
      `;

      card.addEventListener('mouseenter', () => {
        card.style.borderColor = 'var(--accent)';
        card.style.transform   = 'scale(1.02)';
        card.querySelector('.pb-inline-del').style.opacity = '1';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'var(--border-dim)';
        card.style.transform   = 'scale(1)';
        card.querySelector('.pb-inline-del').style.opacity = '0';
      });

      card.addEventListener('click', e => {
        if (e.target.closest('.pb-inline-del')) return;
        PresetBrowser._applyPreset(preset);
        Toast.success(`Loaded: ${preset.name}`);
        _renderInlinePresetGrid();
      });

      card.querySelector('.pb-inline-del').addEventListener('click', e => {
        e.stopPropagation();
        PresetBrowser.remove(preset.name);
        _renderInlinePresetGrid();
        Toast.info(`Deleted "${preset.name}"`);
      });

      grid.appendChild(card);
    });
  }

  // Wire search + sort live filtering
  document.getElementById('pb-inline-search')?.addEventListener('input',  _renderInlinePresetGrid);
  document.getElementById('pb-inline-sort')?.addEventListener('change',   _renderInlinePresetGrid);

  // Initial render (IDB loads async so also re-render when data arrives)
  _renderInlinePresetGrid();

  // ── Setlist + performance mode ───────────────────────────────
  const setlist  = new SetlistManager(layers, layerFactory, audio);
  window._vaelSetlist = setlist;
  const perfMode = new PerformanceMode({ setlist, audio, beatDetector: beat, layerStack: layers });

  // Concert setlist panel in SCENES tab
  if (typeof PlaylistPanel !== 'undefined') {
    PlaylistPanel.init({
      setlist,
      audio,
      layerStack:   layers,
      layerFactory: layerFactory,
      container:    document.getElementById('tab-scenes'),
    });
  }

  document.addEventListener('vael:fade-duration',   e => { setlist.fadeDuration   = e.detail; });
  document.addEventListener('vael:transition-type', e => { setlist.transitionType = e.detail; });

  const flashOverlay = document.createElement('div');
  flashOverlay.id = 'vael-transition-overlay';
  flashOverlay.style.cssText = 'position:fixed;inset:0;background:white;opacity:0;pointer-events:none;z-index:99;transition:opacity 0.05s';
  document.body.appendChild(flashOverlay);

  // ── MIDI ──────────────────────────────────────────────────────
  const midi = new MidiEngine(layers);
  window._vaelMidi = midi;
  midi.init().then(() => MidiPanel.init(midi, layers, document.getElementById('midi-panel-content')));

  // MIDI clock sync — override beat detector BPM when external clock is active
  midi.onClockBpm = (bpm) => {
    // Sequencer always gets the clock BPM
    seq.setBpm(bpm);
    // Refresh MIDI panel to show current BPM
    MidiPanel.refresh();
  };
  midi.onClockStart = () => Toast.info('MIDI clock: started');
  midi.onClockStop  = () => Toast.info('MIDI clock: stopped');

  // Global MIDI actions → setlist navigation
  midi.onGlobalAction = (action) => {
    if (action === 'scene:next') {
      setlist.next();
      Toast.info(`Scene → ${setlist.currentIndex + 1} / ${setlist.entries.length}`);
    } else if (action === 'scene:prev') {
      setlist.prev();
      Toast.info(`Scene → ${setlist.currentIndex + 1} / ${setlist.entries.length}`);
    } else if (action.startsWith('scene:')) {
      const idx = parseInt(action.split(':')[1]) - 1;
      if (!isNaN(idx)) {
        setlist.goto(idx);
        Toast.info(`Scene → ${idx + 1} / ${setlist.entries.length}`);
      }
    }
  };

  // ── OSC ──────────────────────────────────────────────────────
  const osc = new OscBridge({ layerStack: layers, setlist, recorder });
  // OscBridge does NOT auto-connect — it only connects when the user
  // explicitly enables it (e.g. via a toggle in the panel). This prevents
  // console spam when the bridge script isn't running.
  // To enable: osc.enable('ws://localhost:8080');

  // ── LFO ──────────────────────────────────────────────────────
  const lfoManager = new LFOManager();
  window._vaelLFOManager = lfoManager;
  // LFOPanel is now per-layer in ParamPanel — no global init needed
  layers.onChanged = () => { renderLayerList(); }; // LFOPanel.refresh() now handled per-layer in ParamPanel

  // ── Post FX ──────────────────────────────────────────────────
  PostFXPanel.init(renderer, document.getElementById('fx-panel-content'));

  // Help / manual — triggered by ? button in sidebar header
  if (typeof HelpPanel !== 'undefined') {
    HelpPanel.init(document.getElementById('help-panel-content'));
  }
  document.getElementById('btn-help')?.addEventListener('click', () => {
    const ov = document.getElementById('help-overlay');
    if (ov) ov.style.display = ov.style.display === 'flex' ? 'none' : 'flex';
  });
  document.getElementById('help-close')?.addEventListener('click', () => {
    const ov = document.getElementById('help-overlay');
    if (ov) ov.style.display = 'none';
  });
  document.getElementById('help-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('help-overlay')) {
      document.getElementById('help-overlay').style.display = 'none';
    }
  });

  // ── History (HIST tab) ────────────────────────────────────────
  const history = new HistoryManager({ layers, lfoManager, layerFactory });
  history.mountPanel(document.getElementById('history-panel-content'));
  window._vaelHistory = history;

  // Take an initial snapshot so the panel isn't empty on first open
  setTimeout(() => history.snapshot('App started'), 200);

  // Snapshot on layer add/remove
  const _origLayersAddForHistory = layers.add.bind(layers);
  // Wrap layers.add and layers.remove to snapshot on structural changes
  // (lightweight — HistoryManager debounces param changes internally)
  layers.addEventListener?.('change', () => {
    history.snapshot('Layer changed');
  });

  // ── AutomationTimeline (AUTO tab) ─────────────────────────────
  const timeline = new AutomationTimeline({ layerStack: layers });
  window._vaelTimeline = timeline;  // exposed so ParamPanel can record param changes
  if (typeof TimelinePanel !== 'undefined') {
    TimelinePanel.init(timeline, layers, document.getElementById('timeline-panel-content'));
  }

  // ── Library panel ─────────────────────────────────────────────
  LibraryPanel.init({
    videoLibrary,
    audioEngine:       audio,
    layerStack:        layers,
    getSelectedLayer:  () => layers.layers.find(l => l.id === _selectedLayerId) || null,
    container:         document.getElementById('library-panel-content'),
  });

  videoLibrary.onChanged = () => {
    LibraryPanel.refresh();
    if (_selectedLayerId) {
      const layer = layers.layers.find(l => l.id === _selectedLayerId);
      if (layer instanceof VideoPlayerLayer) _renderVideoLayerPanel(layer, paramsContent);
    }
  };

  // ── Sequencer ────────────────────────────────────────────────
  const seq = new Sequencer();
  SequencerPanel.init(seq, beat, document.getElementById('beat-panel-content'));
  seq.onStep = (step, event) => {
    if (event === 'flash' || event === 'beat') {
      audio.smoothed.isBeat = true;
      setTimeout(() => { audio.smoothed.isBeat = false; }, 50);
    }
  };

  document.addEventListener('keydown', e => {
    const _tag = e.target.tagName;
    if (_tag === 'INPUT' || _tag === 'SELECT' || _tag === 'TEXTAREA') return;
    if (e.target.isContentEditable) return;
    if (e.target.closest?.('#vael-assistant-panel, [data-no-shortcuts]')) return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); seq.tapTempo(); }
  });

  // Performance mode TAP button fires this event (no direct seq ref in PerformanceMode)
  window.addEventListener('vael:tap-tempo', () => seq.tapTempo());

  // ── MIDI learn ───────────────────────────────────────────────
  window.addEventListener('vael:midi-learn-requested', () => {
    if (!_selectedLayerId) { alert('Select a layer first.'); return; }
    const layer = layers.layers.find(l => l.id === _selectedLayerId);
    if (!layer) return;
    const manifest = layer.constructor.manifest;
    const param    = manifest?.params?.find(p => p.type === 'float' || p.type === 'int');
    if (!param) { alert('No learnable parameters on this layer.'); return; }
    midi.startLearn(_selectedLayerId, param.id, param.min ?? 0, param.max ?? 1);
    MidiPanel.refresh();
  });

  // ── Layer types ───────────────────────────────────────────────
  const LAYER_TYPES = [
    // ── Backgrounds & procedural ─────────────────────────────
    { id: 'gradient',         label: '🎨 Gradient',              cls: () => new GradientLayer(`gradient-${Date.now()}`) },
    { id: 'noise',            label: '🌊 Noise Field',            cls: () => new NoiseFieldLayer(`noise-${Date.now()}`) },
    { id: 'pattern',          label: '⬡ Pattern (geometric)',    cls: () => new PatternLayer(`pattern-${Date.now()}`) },

    // ── Audio-reactive ───────────────────────────────────────
    { id: 'particles',        label: '✦ Particles',              cls: () => new ParticleLayer(`particles-${Date.now()}`) },
    { id: 'waveform',         label: '〜 Waveform / Spectrum',    cls: () => { const l = new WaveformLayer(`waveform-${Date.now()}`); l._audioEngine = audio; return l; }},
    { id: 'math',             label: '∑ Math Visualizer',        cls: () => new MathVisualizer(`math-${Date.now()}`) },

    // ── Image & video ────────────────────────────────────────
    { id: 'image',            label: '🖼 Image (PNG/JPG/SVG)',    cls: () => new ImageLayer(`image-${Date.now()}`) },
    { id: 'slideshow',        label: '🖼 Slideshow (images)',     cls: () => {
        const s = new SlideshowLayer(`slideshow-${Date.now()}`);
        s.init({});
        setTimeout(() => {
          SlideshowLayer.showPickerModal([], selected => {
            s.loadEntries(selected);
            if (selected.length > 0) Toast.success(`Slideshow: ${selected.length} image${selected.length!==1?'s':''} loaded`);
          });
        }, 100);
        return s;
      }
    },
    { id: 'video',            label: '🎬 Video file',             cls: () => new VideoPlayerLayer(`video-${Date.now()}`) },
    { id: 'webcam',           label: '📷 Webcam',                 cls: () => new WebcamLayer(`webcam-${Date.now()}`) },

    // ── Text ─────────────────────────────────────────────────
    { id: 'lyrics',           label: '💬 Lyrics / Text',          cls: () => new LyricsLayer(`lyrics-${Date.now()}`) },

    // ── Utilities ────────────────────────────────────────────
    { id: 'feedback',         label: '⟳ Feedback Trail',         cls: () => new FeedbackLayer(`feedback-${Date.now()}`) },
    { id: 'canvas-paint',     label: '✏ Canvas Paint',           cls: () => new CanvasPaintLayer(`canvas-paint-${Date.now()}`) },
    { id: 'group',            label: '▤ Group (empty)',           cls: () => { const g = new GroupLayer(`group-${Date.now()}`); g.name = 'Group'; return g; } },

    // ── Shaders ──────────────────────────────────────────────
    { id: 'shader-custom',    label: '⚡ Shader — Custom (blank)', cls: () => { const s = new ShaderLayer(`shader-${Date.now()}`); s._shaderName = 'custom'; s._customGLSL = ''; s.name = 'Custom Shader'; return s; } },
    { id: 'shader-plasma',    label: '⚡ Shader — Plasma',        cls: () => ShaderLayer.fromBuiltin('plasma') },
    { id: 'shader-ripple',    label: '⚡ Shader — Ripple',        cls: () => ShaderLayer.fromBuiltin('ripple') },
    { id: 'shader-distort',   label: '⚡ Shader — Distort',       cls: () => ShaderLayer.fromBuiltin('distort') },
    { id: 'shader-bloom',     label: '⚡ Shader — Bloom',         cls: () => ShaderLayer.fromBuiltin('bloom') },
    { id: 'shader-chromatic',    label: '⚡ Shader — Chromatic',      cls: () => ShaderLayer.fromBuiltin('chromatic') },
    { id: 'shader-kaleidoscope', label: '⚡ Shader — Kaleidoscope',   cls: () => ShaderLayer.fromBuiltin('kaleidoscope') },
    { id: 'shader-tunnel',       label: '⚡ Shader — Tunnel',          cls: () => ShaderLayer.fromBuiltin('tunnel') },
    { id: 'shader-voronoi',      label: '⚡ Shader — Voronoi',         cls: () => ShaderLayer.fromBuiltin('voronoi') },
    { id: 'shader-turing',       label: '⚡ Shader — Turing',          cls: () => ShaderLayer.fromBuiltin('turing') },
    { id: 'shader-fbm',          label: '⚡ Shader — FBM Clouds',      cls: () => ShaderLayer.fromBuiltin('fbm') },
    { id: 'shader-rings',        label: '⚡ Shader — Rings',           cls: () => ShaderLayer.fromBuiltin('rings') },
    { id: 'shader-aurora',       label: '⚡ Shader — Aurora',          cls: () => ShaderLayer.fromBuiltin('aurora') },
    { id: 'shader-julia',        label: '⚡ Shader — Julia Fractal',   cls: () => ShaderLayer.fromBuiltin('julia') },
    { id: 'shader-lissajous',    label: '⚡ Shader — Lissajous',       cls: () => ShaderLayer.fromBuiltin('lissajous') },
  ];

  const BLEND_MODES = ['normal','multiply','screen','overlay','add','softlight','difference','luminosity','subtract','exclusion'];

  // ── Layer panel ───────────────────────────────────────────────
  const paramsEmpty   = document.getElementById('params-empty');
  const paramsContent = document.getElementById('params-content');

  LayerPanel.init({
    layers, layerFactory, audio, canvas,
    blendModes:            BLEND_MODES,
    layerTypes:            LAYER_TYPES,
    renderImageLayerPanel: _renderImageLayerPanel,
    videoLibrary:          videoLibrary,
    onSelectLayer: (id) => {
      _selectedLayerId = id;
      LayerPanel.setSelectedId(id);
      // Update canvas cursor + show drag hint
      if (canvas._onLayerSelect) canvas._onLayerSelect(id);
    },
  });

  // Wire canvas drag — hold Alt to drag/scroll selected layer
  LayerPanel._initCanvasDrag(canvas);

  // Hook selectLayer to inject Restart button for MathVisualizer
  const _origSelectLayer = LayerPanel.selectLayer.bind(LayerPanel);
  LayerPanel.selectLayer = (id) => {
    _origSelectLayer(id);
    const layer = _findLayerAnywhere(id);
    if (layer instanceof MathVisualizer) {
      setTimeout(() => _injectMathRestartBtn(layer, paramsContent), 15);
    }
  };

  // When an ImageLayer is added, show the library/upload prompt
  const _origLayersAdd = layers.add.bind(layers);
  layers.add = (layer) => {
    _origLayersAdd(layer);
    if (layer instanceof ImageLayer) {
      setTimeout(() => LibraryPanel.showAddImagePrompt(layer), 100);
    }
    if (layer instanceof VideoPlayerLayer) {
      setTimeout(() => _showVideoPickerForLayer(layer), 100);
    }
    // Log to history (skip default startup layers which fire before history is ready)
    if (window._vaelHistory) {
      window._vaelHistory.onLayerAdded(layer.name || layer.constructor.name.replace('Layer',''));
    }
  };

  const _origLayersRemove = layers.remove.bind(layers);
  layers.remove = (id) => {
    const layer = layers.layers.find(l => l.id === id);
    const name  = layer?.name || id;
    _origLayersRemove(id);
    if (window._vaelHistory) {
      window._vaelHistory.onLayerRemoved(name);
    }
  };

  function renderLayerList() { LayerPanel.renderLayerList(); }

  // ── Startup: check for autosave BEFORE adding default layers ─
  // If an autosave exists, show the resume dialog first.
  // Default layers are only added if starting fresh.
  renderer.start();
  // LFOPanel.refresh() — handled per-layer in ParamPanel

  // Wait for the renderer to complete its first frame (which calls _resize() and
  // sets _cssW/_cssH to the real canvas dimensions) before adding any layers.
  // Without this wait, offscreen canvases are created at the 800×600 fallback size.
  const _waitForDimensions = (cb) => {
    const check = () => {
      if (renderer.width > 0 && renderer.height > 0) {
        cb();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  };

  const _hasSave = (() => {
    try {
      const s = localStorage.getItem('vael-autosave');
      if (!s) return false;
      const p = JSON.parse(s);
      return !!(p.layers?.length);
    } catch { return false; }
  })();

  function _addDefaultLayers() {
    const noiseLayer = new NoiseFieldLayer('noise-default');
    noiseLayer.init({ mode: 'field', hueA: 210, hueB: 260, speed: 0.08, lightness: 0.08, saturation: 0.6 });
    noiseLayer.opacity   = 1.0;
    noiseLayer.blendMode = 'normal';

    const particleLayer = new ParticleLayer('particles-default');
    particleLayer.init({ mode: 'drift', count: 300, size: 1.5, speed: 0.25, colorMode: 'cool' });
    particleLayer.opacity   = 0.5;
    particleLayer.blendMode = 'add';

    _origLayersAdd(noiseLayer);
    _origLayersAdd(particleLayer);
    // LFOPanel.refresh() — handled per-layer in ParamPanel
  }

  if (_hasSave) {
    // Show the dialog — wait for dimensions first so restored layers spawn correctly
    _waitForDimensions(() => setTimeout(() => _restoreAutoSave(_addDefaultLayers), 50));
  } else {
    // No save — wait for dimensions, then add defaults
    _waitForDimensions(_addDefaultLayers);
  }

  // ── Preset save / load ────────────────────────────────────────
  document.getElementById('btn-preset-save').addEventListener('click', () => {
    const name = document.getElementById('preset-name').value.trim() || 'scene';
    let thumb = null;
    try {
      // canvas is WebGL — toDataURL works with preserveDrawingBuffer:true
      thumb = canvas.toDataURL('image/jpeg', 0.6);
    } catch {}
    PresetBrowser.save(layers, name, thumb);
    setTimeout(_renderInlinePresetGrid, 100);
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
    Toast.success(`Scene "${name}" saved`);
  });

  // Save scene with a specific name — used by PlaylistPanel "save as scene" button
  window.addEventListener('vael:save-scene-named', e => {
    const name = e.detail?.name;
    if (!name) return;
    let thumb = null;
    try {
      // canvas is WebGL — toDataURL works with preserveDrawingBuffer:true
      thumb = canvas.toDataURL('image/jpeg', 0.6);
    } catch {}
    PresetBrowser.save(layers, name, thumb);
    setTimeout(_renderInlinePresetGrid, 100);
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
  });



  document.getElementById('btn-scene-new')?.addEventListener('click', () => {
    _autoSave();
    [...layers.layers].forEach(l => layers.remove(l.id));
    _selectedLayerId = null; LayerPanel.setSelectedId(null);
    paramsContent.innerHTML   = '';
    paramsEmpty.style.display = 'block';
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
      // LFO state per-layer — lfoManager kept for compatibility
      if (preset.lfos?.length) { lfoManager.clear(); lfoManager.fromJSON(preset.lfos, layers); }
      _selectedLayerId = null; LayerPanel.setSelectedId(null);
      paramsContent.innerHTML   = '';
      paramsEmpty.style.display = 'block';
      Toast.success(`Scene "${preset.name || file.name}" loaded`);
    } catch (err) { Toast.error(`Could not load preset: ${err.message}`); }
    e.target.value = '';
  });

  renderLayerList();

  // ── Status strip ─────────────────────────────────────────────
  const dotAudio    = document.getElementById('dot-audio');
  const labelAudio  = document.getElementById('label-audio');
  const dotVideo    = document.getElementById('dot-video');
  const labelVideo  = document.getElementById('label-video');
  const labelFps    = document.getElementById('label-fps');
  const labelLayers = document.getElementById('label-layers');

  // Make canvas-area a flex container so ratio-locked canvas centers properly
  const canvasArea = canvas.parentElement;
  if (canvasArea) {
    canvasArea.style.display         = 'flex';
    canvasArea.style.alignItems      = 'center';
    canvasArea.style.justifyContent  = 'center';
    canvasArea.style.background      = '#000';
  }

  // Add extra resolution options to REC panel dropdown (portrait, square, social)
  const resSelect = document.getElementById('sl-res');
  if (resSelect) {
    const extraOptions = [
      { value: '2560x1440', label: '2560 × 1440 (1440p)' },
      { value: '3840x2160', label: '3840 × 2160 (4K)' },
      { value: '1080x1920', label: '1080 × 1920 (9:16 portrait / Instagram Story)' },
      { value: '1080x1080', label: '1080 × 1080 (1:1 square / Instagram post)' },
      { value: '1080x1350', label: '1080 × 1350 (4:5 Instagram portrait)' },
      { value: '1920x1080', label: '— already listed —', skip: true },
    ].filter(o => !o.skip);
    extraOptions.forEach(o => {
      // Only add if not already present
      if (!resSelect.querySelector(`option[value="${o.value}"]`)) {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        resSelect.appendChild(opt);
      }
    });
  }

  // ── Canvas ratio selector ─────────────────────────────────────
  const RATIOS = [
    { label: 'Free',    w: null, h: null },
    { label: '16:9',    w: 16,   h: 9    },
    { label: '9:16',    w: 9,    h: 16   },
    { label: '1:1',     w: 1,    h: 1    },
    { label: '4:3',     w: 4,    h: 3    },
    { label: '21:9',    w: 21,   h: 9    },
    { label: 'Custom',  w: null, h: null, custom: true },
  ];

  // ── Canvas ratio toolbar (injected above canvas) ───────────────
  const ratioToolbar = document.createElement('div');
  ratioToolbar.style.cssText = `
    position:absolute;top:8px;left:50%;transform:translateX(-50%);
    display:flex;align-items:center;gap:6px;z-index:50;
    background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.08);
    border-radius:20px;padding:4px 10px;backdrop-filter:blur(4px);
  `;

  const ratioLabel = document.createElement('span');
  ratioLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:rgba(255,255,255,0.4);letter-spacing:0.5px';
  ratioLabel.textContent = 'RATIO';

  const ratioSel = document.createElement('select');
  ratioSel.style.cssText = 'background:transparent;border:none;color:rgba(255,255,255,0.7);font-family:var(--font-mono);font-size:9px;cursor:pointer;outline:none';

  RATIOS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.label;
    opt.textContent = r.label;
    ratioSel.appendChild(opt);
  });

  const _applyRatio = (chosen) => {
    if (!chosen) return;
    if (chosen.custom) {
      const input = prompt('Enter ratio or resolution (e.g. 9x16, 1080x1920, 1x1):');
      if (!input) { ratioSel.value = 'Free'; return; }
      const match = input.match(/(\d+)\s*[x:×]\s*(\d+)/i);
      if (!match) { Toast.warn('Invalid format — use e.g. 9x16 or 1080x1920'); ratioSel.value = 'Free'; return; }
      const [, rw, rh] = match;
      renderer.setRatio(parseInt(rw), parseInt(rh));
      Toast.info(`Canvas ratio locked: ${rw}:${rh}`);
    } else if (chosen.w) {
      renderer.setRatio(chosen.w, chosen.h);
      Toast.info(`Canvas ratio: ${chosen.label}`);
    } else {
      renderer.setRatio(null, null);
      Toast.info('Canvas ratio: free');
    }
  };

  ratioSel.addEventListener('change', () => {
    _applyRatio(RATIOS.find(r => r.label === ratioSel.value));
  });

  ratioToolbar.append(ratioLabel, ratioSel);

  // FPS cap selector — sits right next to the ratio toolbar
  const fpsPill = document.createElement('div');
  fpsPill.style.cssText = `
    position:absolute;top:8px;right:12px;
    display:flex;align-items:center;gap:6px;z-index:50;
    background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.08);
    border-radius:20px;padding:4px 10px;backdrop-filter:blur(4px);
  `;
  const fpsLabel = document.createElement('span');
  fpsLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:rgba(255,255,255,0.4);letter-spacing:0.5px';
  fpsLabel.textContent = 'FPS';
  const fpsSel = document.createElement('select');
  fpsSel.style.cssText = 'background:transparent;border:none;color:rgba(255,255,255,0.7);font-family:var(--font-mono);font-size:9px;cursor:pointer;outline:none';
  [['Unlimited', 0], ['120', 120], ['60', 60], ['30', 30]].forEach(([label, val]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    fpsSel.appendChild(opt);
  });
  fpsSel.addEventListener('change', () => {
    const v = parseInt(fpsSel.value);
    renderer.setFpsLimit(v);
    Toast.info(v ? `FPS capped at ${v}` : 'FPS unlimited');
  });
  fpsPill.append(fpsLabel, fpsSel);
  if (canvasArea) canvasArea.appendChild(fpsPill);

  // Inject into canvas-area (above canvas, centered)
  if (canvasArea) {
    canvasArea.style.position = 'relative';
    canvasArea.appendChild(ratioToolbar);
  }

  renderer.onFrame = (dt, fps) => {
    labelFps.textContent    = `${fps} fps`;
    labelLayers.textContent = `${layers.count} layer${layers.count !== 1 ? 's' : ''}`;

    renderer.audioData = audio.smoothed;
    renderer.videoData = video.smoothed;
    audio.smoothed._dt = dt;  // pass dt for inline LFO evaluation in ModMatrix

    // Tick per-layer LFOs
    if (typeof LFOPanel !== 'undefined') {
      LFOPanel.tickAll(layers.layers, dt, beat.bpm || 120);
    }

    beat.update(audio.smoothed, audio._dataArray);
    // MIDI clock overrides beat detector BPM when active
    const activeBpm = (midi.clockSync && midi.clockBpm > 0) ? midi.clockBpm : beat.bpm;
    audio.smoothed.isBeat     = beat.isBeat;
    audio.smoothed.bpm        = activeBpm;
    audio.smoothed.beat       = beat.beat;
    audio.smoothed.bar        = beat.bar;
    audio.smoothed.phrase     = beat.phrase;
    audio.smoothed.isDownbeat = beat.isDownbeat;
    audio.smoothed.isBarOne   = beat.isBarOne;

    // Song position signals — available as ModMatrix sources
    // songPosition: 0.0 (start) → 1.0 (end), useful for "reveal over time" effects
    // songTime: current position in seconds
    const _dur = audio.duration || 0;
    const _pos = audio.currentTime || 0;
    audio.smoothed.songPosition = _dur > 0 ? Math.min(1, _pos / _dur) : 0;
    audio.smoothed.songTime     = _pos;

    if (video.smoothed.isActive) {
      audio.smoothed.brightness  = video.smoothed.brightness;
      audio.smoothed.motion      = video.smoothed.motion;
      audio.smoothed.hue         = video.smoothed.hue;
      audio.smoothed.edgeDensity = video.smoothed.edgeDensity;
    }

    if (!audio.smoothed.isActive) {
      const t     = performance.now() / 1000;
      const bpm   = seq.bpm || 120;
      const phase = (t * bpm / 60) % 1;
      const pulse = Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 3);
      audio.smoothed.bass     = pulse * 0.6;
      audio.smoothed.mid      = pulse * 0.3;
      audio.smoothed.treble   = 0;
      audio.smoothed.volume   = pulse * 0.4;
      audio.smoothed.isActive = false;
    }

    seq.tick(dt);
    lfoManager.tick(dt, activeBpm || seq.bpm, layers, beat.isDownbeat);
    timeline.tick(dt);  // AutomationTimeline playback
    if (timeline.isPlaying && typeof TimelinePanel !== 'undefined') TimelinePanel.refresh();
    setlist.tick(dt);
    perfMode.tick(dt);
    AudioPanel.tick(audio.smoothed);
    VideoPanel.tick();
    RecordPanel.tick();
    PostFXPanel.tick(audio.smoothed);
    dotAudio.classList.toggle('inactive', !audio.smoothed.isActive);

    // Recording indicator in status strip
    const recIndicator = document.getElementById('status-rec-indicator');
    if (recIndicator) {
      if (recorder.state === 'recording') {
        recIndicator.style.display = 'flex';
        const secs = Math.floor(recorder.duration);
        const m = Math.floor(secs / 60);
        const s = String(secs % 60).padStart(2, '0');
        recIndicator.querySelector('#status-rec-time').textContent = `REC ${m}:${s}`;
      } else {
        recIndicator.style.display = 'none';
      }
    }
  };

  // ── Scene Palette ─────────────────────────────────────────────
  const paletteContainer = document.getElementById('params-palette-container');
  if (paletteContainer) ScenePalette.renderPanel(layers, paletteContainer);
  VaelAssistant.init(layers, layerFactory, renderer);

  // ── Autosave ──────────────────────────────────────────────────
  const AUTOSAVE_KEY = 'vael-autosave';

  function _autoSave() {
    try {
      const preset = {
        vael:   '1.0',
        name:   document.getElementById('preset-name')?.value || 'autosave',
        saved:  new Date().toISOString(),
        layers: layers.layers.map(layer =>
          typeof layer.toJSON === 'function' ? layer.toJSON() : {
            type: layer.constructor.name, id: layer.id, name: layer.name,
            visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode,
            maskLayerId: layer.maskLayerId || null, maskMode: layer.maskMode || 'luminance',
            transform: { ...layer.transform }, modMatrix: layer.modMatrix?.toJSON() || [],
            fx: layer.fx ? layer.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
            params: layer.params ? { ...layer.params } : {},
          }
        ),
        lfos: lfoManager.toJSON(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(preset));
    } catch (e) { console.warn('Auto-save failed:', e); }
  }

  function _restoreAutoSave(onFresh) {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved) { if (onFresh) onFresh(); return; }
      const preset = JSON.parse(saved);
      if (!preset.layers?.length) { if (onFresh) onFresh(); return; }

      // Show startup dialog
      const savedDate = preset.saved
        ? new Date(preset.saved).toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : 'unknown time';

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;
        display:flex;align-items:center;justify-content:center;
        font-family:'JetBrains Mono',monospace;
      `;

      overlay.innerHTML = `
        <div style="
          background:var(--bg-mid,#12121e);border:1px solid rgba(0,212,170,0.3);
          border-radius:12px;padding:28px 32px;width:360px;
          box-shadow:0 24px 64px rgba(0,0,0,0.6);
        ">
          <div style="color:#00d4aa;font-size:11px;letter-spacing:2px;
                      text-transform:uppercase;margin-bottom:6px">Vael</div>
          <div style="color:rgba(255,255,255,0.85);font-size:14px;
                      font-weight:600;margin-bottom:6px">
            Resume previous work?
          </div>
          <div style="color:rgba(255,255,255,0.35);font-size:9px;margin-bottom:24px">
            "${preset.name}" · ${savedDate} · ${preset.layers.length} layer${preset.layers.length !== 1 ? 's' : ''}
          </div>

          <div style="display:flex;flex-direction:column;gap:8px">
            <button id="sd-resume" style="
              background:rgba(0,212,170,0.15);border:1px solid rgba(0,212,170,0.5);
              border-radius:6px;color:#00d4aa;font-family:inherit;font-size:10px;
              padding:10px 16px;cursor:pointer;text-align:left;
              transition:background 0.15s;
            ">
              ↩  Resume — restore my last session
            </button>
            <button id="sd-fresh" style="
              background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
              border-radius:6px;color:rgba(255,255,255,0.55);font-family:inherit;font-size:10px;
              padding:10px 16px;cursor:pointer;text-align:left;
              transition:background 0.15s;
            ">
              ✦  Start fresh — empty canvas
            </button>
            <button id="sd-load" style="
              background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
              border-radius:6px;color:rgba(255,255,255,0.55);font-family:inherit;font-size:10px;
              padding:10px 16px;cursor:pointer;text-align:left;
              transition:background 0.15s;
            ">
              ↑  Load a saved project file
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      ['sd-resume','sd-fresh','sd-load'].forEach(id => {
        const btn = overlay.querySelector(`#${id}`);
        btn.addEventListener('mouseenter', () => btn.style.filter = 'brightness(1.2)');
        btn.addEventListener('mouseleave', () => btn.style.filter = '');
      });

      // Resume — restore saved layers (no default layers added)
      overlay.querySelector('#sd-resume').addEventListener('click', () => {
        overlay.remove();
        PresetManager._applyRaw(preset, layers, layerFactory);
        if (preset.lfos?.length) { lfoManager.fromJSON(preset.lfos, layers); }
        Toast.success(`Resumed: "${preset.name}"`);
      });

      // Fresh start — delete save, add default layers
      overlay.querySelector('#sd-fresh').addEventListener('click', () => {
        overlay.remove();
        localStorage.removeItem(AUTOSAVE_KEY);
        if (onFresh) onFresh();
        Toast.info('Starting fresh');
      });

      // Load from file — add defaults then open picker
      overlay.querySelector('#sd-load').addEventListener('click', () => {
        overlay.remove();
        if (onFresh) onFresh();
        setTimeout(() => document.getElementById('btn-preset-load')?.click(), 100);
      });

    } catch { if (onFresh) onFresh(); }
  }

  setInterval(_autoSave, 5 * 60 * 1000);
  window.addEventListener('beforeunload', _autoSave);

  // ── Panel init ────────────────────────────────────────────────
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
    const _etag = e.target.tagName;
    if (_etag === 'INPUT' || _etag === 'SELECT' || _etag === 'TEXTAREA') return;
    if (e.target.isContentEditable) return;
    if (e.target.closest?.('#vael-assistant-panel, [data-no-shortcuts]')) return;
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

  audio.onStateChange = state => {
    if (state.sourceType === 'file' && !state.isPlaying) RecordPanel.onAudioEnd();
  };

  console.log('%cVAEL%c — Light onto Sound',
    'color:#00d4aa;font-weight:bold;font-size:18px;letter-spacing:4px',
    'color:#7878a0;font-size:12px');
  setTimeout(() => Toast.info('Vael ready — press ? for shortcuts'), 800);

  // Discover locally installed fonts for LyricsLayer (Chrome 103+, graceful fallback)
  LyricsLayer.discoverFonts().catch(() => {});

})();
