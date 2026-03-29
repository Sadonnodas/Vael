/**
 * ui/App.js
 * Top-level application controller.
 */

(function () {
  'use strict';

  // ── Dirty flag — hoisted so markDirty() is safe to call anywhere ─────────
  // var (not let) avoids the temporal dead zone; markDirty() can be called
  // from layers.onChanged which fires during initialisation before the
  // autosave block further down is reached.
  var _isDirty      = false;
  var _lastSaveTime = 0;
  const AUTOSAVE_DEBOUNCE_MS = 30_000;
  function markDirty() { _isDirty = true; }

  const canvas   = document.getElementById('main-canvas');
  const renderer = new Renderer(canvas);
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

  // ── Layer plugin registry ───────────────────────────────────────
  // Layers self-register via LayerRegistry.register(ClassName).
  // layerFactory() looks them up by class name — no hardcoded switch needed.
  // To add a new layer: create the class, call LayerRegistry.register(MyLayer)
  // at the bottom of its file, add a script tag in index.html. Done.
  const LayerRegistry = {
    _map: new Map(),
    register(cls) {
      this._map.set(cls.name, cls);
      // Also register under manifest name for display
      if (cls.manifest?.name) this._map.set(cls.manifest.name, cls);
    },
    get(name) { return this._map.get(name) || null; },
    all() { return Array.from(this._map.values()).filter((v, i, a) => a.indexOf(v) === i); },
  };

  // Register all built-in layer types
  [
    GradientLayer, MathVisualizer, ParticleLayer, NoiseFieldLayer,
    VideoPlayerLayer, ShaderLayer, LyricsLayer, WebcamLayer,
    WaveformLayer, PatternLayer, ImageLayer, GroupLayer,
    CanvasPaintLayer, FeedbackLayer, SVGLayer,
  ].forEach(cls => LayerRegistry.register(cls));

  // Expose globally so external layers can self-register
  window.LayerRegistry = LayerRegistry;

  function layerFactory(typeName, id) {
    const uid = id || `${typeName}-${Date.now()}`;
    // Try registry first (covers all registered layers including external plugins)
    const RegCls = LayerRegistry.get(typeName);
    if (RegCls) {
      try { return new RegCls(uid); } catch (e) { console.warn('LayerRegistry: could not instantiate', typeName, e); }
    }
    // Fallback switch for special construction cases
    switch (typeName) {
      case 'GradientLayer':    return new GradientLayer(uid);
      case 'MathVisualizer':   return new MathVisualizer(uid);
      case 'ParticleLayer':    return new ParticleLayer(uid);
      case 'NoiseFieldLayer':  return new NoiseFieldLayer(uid);
      case 'VideoPlayerLayer': return new VideoPlayerLayer(uid, video.videoElement);
      case 'ShaderLayer':      return new ShaderLayer(uid);
      case 'LyricsLayer':      return new LyricsLayer(uid);
      case 'WebcamLayer':      return new WebcamLayer(uid);
      case 'WaveformLayer':    { const l = new WaveformLayer(uid); l._audioEngine = audio; return l; }
      case 'PatternLayer':     return new PatternLayer(uid);
      case 'ImageLayer':       return new ImageLayer(uid);
      case 'GroupLayer':       return new GroupLayer(uid);
      case 'CanvasPaintLayer':   return new CanvasPaintLayer(uid);
      case 'FeedbackLayer':      return new FeedbackLayer(uid);
      case 'SVGLayer':           return new SVGLayer(uid);
      default:
        // Try registry one more time (handles plugins registered after startup)
        const dynCls = LayerRegistry.get(typeName);
        if (dynCls) { try { return new dynCls(uid); } catch {} }
        console.warn('Unknown layer type:', typeName);
        return null;
    }
  }

  // ── Image layer panel ─────────────────────────────────────────
  function _renderImageLayerPanel(layer, container) {
    container.innerHTML = '';
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Image'));
    }
    LibraryPanel.promptImageForLayer(layer, container);
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
    const layer = layers.layers.find(l => l.id === _selectedLayerId);
    if (!layer) return;
    if (layer instanceof ImageLayer)       _renderImageLayerPanel(layer, paramsContent);
    else if (layer instanceof ShaderLayer) ShaderPanel.render(layer, paramsContent);
    else if (layer instanceof LyricsLayer) LyricsPanel.render(layer, paramsContent);
    else {
      ParamPanel.render(layer, paramsContent, audio);
      if (layer instanceof CanvasPaintLayer) _injectPaintClearBtn(layer, paramsContent);
      if (layer instanceof SVGLayer)         _injectSVGLoadBtn(layer, paramsContent);
    }
  });

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

  // ── Preset browser ───────────────────────────────────────────
  PresetBrowser.init(layers, layerFactory, (preset) => {
    const nameEl = document.getElementById('preset-name');
    if (nameEl && preset.name) nameEl.value = preset.name;
    _selectedLayerId = null;
    LayerPanel.setSelectedId(null);
    document.getElementById('params-content').innerHTML = '';
    document.getElementById('params-empty').style.display = 'block';
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => PresetBrowser.toggle());

  // ── Setlist + performance mode ───────────────────────────────
  const setlist  = new SetlistManager(layers, layerFactory);
  const perfMode = new PerformanceMode({ setlist, audio, beatDetector: beat, layerStack: layers });

  document.addEventListener('vael:fade-duration',   e => { setlist.fadeDuration   = e.detail; });
  document.addEventListener('vael:transition-type', e => { setlist.transitionType = e.detail; });

  const flashOverlay = document.createElement('div');
  flashOverlay.id = 'vael-transition-overlay';
  flashOverlay.style.cssText = 'position:fixed;inset:0;background:white;opacity:0;pointer-events:none;z-index:99;transition:opacity 0.05s';
  document.body.appendChild(flashOverlay);

  // ── MIDI ──────────────────────────────────────────────────────
  const midi = new MidiEngine(layers);
  midi.init().then(() => MidiPanel.init(midi, layers, document.getElementById('midi-panel-content')));

  // ── OSC ──────────────────────────────────────────────────────
  const osc = new OscBridge({ layerStack: layers, setlist, recorder });
  osc.connect('ws://localhost:8080');

  // ── LFO ──────────────────────────────────────────────────────
  const lfoManager = new LFOManager();
  // Wrap LFOManager mutations to trigger dirty flag
  const _origLfoAdd    = lfoManager.add.bind(lfoManager);
  const _origLfoRemove = lfoManager.remove.bind(lfoManager);
  const _origLfoClear  = lfoManager.clear.bind(lfoManager);
  lfoManager.add    = (...a) => { _origLfoAdd(...a);    markDirty(); setTimeout(() => history.snapshot('Added LFO'), 50); };
  lfoManager.remove = (...a) => { _origLfoRemove(...a); markDirty(); setTimeout(() => history.snapshot('Removed LFO'), 50); };
  lfoManager.clear  = (...a) => { _origLfoClear(...a);  markDirty(); };

  LFOPanel.init(lfoManager, layers, document.getElementById('lfo-panel-content'));
  // ── History manager ──────────────────────────────────────────
  const history = new HistoryManager({
    layers, lfoManager, layerFactory, maxEntries: 60,
  });
  history.mountPanel(document.getElementById('history-panel-content'));
  window._vaelHistory = history;

  // ── Automation timeline ───────────────────────────────────────
  const timeline = new AutomationTimeline({ layerStack: layers });
  TimelinePanel.init(timeline, layers, document.getElementById('timeline-panel-content'));
  history.onJump = () => {
    // After restoring a state, refresh all panels
    renderLayerList();
    LFOPanel.refresh();
    _selectedLayerId = null;
    LayerPanel.setSelectedId(null);
    if (paramsContent) paramsContent.innerHTML = '';
    if (paramsEmpty) paramsEmpty.style.display = 'block';
    markDirty();
  };

  layers.onChanged = () => {
    renderLayerList();
    LFOPanel.refresh();
    markDirty();
  };

  // ── Post FX ──────────────────────────────────────────────────
  PostFXPanel.init(renderer, document.getElementById('fx-panel-content'));

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
      if (layer instanceof VideoPlayerLayer) ParamPanel.render(layer, paramsContent, audio);
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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); seq.tapTempo(); }
  });

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
  // LAYER_TYPES drives the "Add layer" picker.
  // Manually curated for UX — controls label, grouping, and factory function.
  // External plugins can push entries here after registering with LayerRegistry.
  const LAYER_TYPES = [
    { id: 'gradient',         label: 'Gradient',              cls: () => new GradientLayer(`gradient-${Date.now()}`) },
    { id: 'noise',            label: 'Noise Field',            cls: () => new NoiseFieldLayer(`noise-${Date.now()}`) },
    { id: 'particles',        label: 'Particles',              cls: () => new ParticleLayer(`particles-${Date.now()}`) },
    { id: 'math',             label: 'Math Visualizer',        cls: () => new MathVisualizer(`math-${Date.now()}`) },
    { id: 'waveform',         label: 'Waveform / Spectrum',    cls: () => { const l = new WaveformLayer(`waveform-${Date.now()}`); l._audioEngine = audio; return l; }},
    { id: 'pattern',          label: 'Pattern (geometric)',    cls: () => new PatternLayer(`pattern-${Date.now()}`) },
    { id: 'lyrics',           label: 'Lyrics / Text',          cls: () => new LyricsLayer(`lyrics-${Date.now()}`) },
    { id: 'image',            label: 'Image (PNG/JPG/SVG)',    cls: () => new ImageLayer(`image-${Date.now()}`) },
    { id: 'video',            label: 'Video file',             cls: () => new VideoPlayerLayer(`video-${Date.now()}`, video.videoElement) },
    { id: 'webcam',           label: 'Webcam',                 cls: () => new WebcamLayer(`webcam-${Date.now()}`) },
    { id: 'group',            label: 'Group (empty)',           cls: () => { const g = new GroupLayer(`group-${Date.now()}`); g.name = 'Group'; return g; } },
    { id: 'shader-custom',    label: 'Shader — Custom (blank)', cls: () => { const s = new ShaderLayer(`shader-${Date.now()}`); s._shaderName = 'custom'; s._customGLSL = ''; s.name = 'Custom Shader'; return s; } },
    { id: 'shader-plasma',         label: 'Shader — Plasma',          cls: () => ShaderLayer.fromBuiltin('plasma') },
    { id: 'shader-ripple',         label: 'Shader — Ripple',          cls: () => ShaderLayer.fromBuiltin('ripple') },
    { id: 'shader-distort',        label: 'Shader — Distort',         cls: () => ShaderLayer.fromBuiltin('distort') },
    { id: 'shader-bloom',          label: 'Shader — Bloom',           cls: () => ShaderLayer.fromBuiltin('bloom') },
    { id: 'shader-chromatic',      label: 'Shader — Chromatic',       cls: () => ShaderLayer.fromBuiltin('chromatic') },
    { id: 'shader-kaleidoscope',   label: 'Shader — Kaleidoscope',    cls: () => ShaderLayer.fromBuiltin('kaleidoscope') },
    { id: 'shader-tunnel',         label: 'Shader — Tunnel',          cls: () => ShaderLayer.fromBuiltin('tunnel') },
    { id: 'shader-voronoi',        label: 'Shader — Voronoi',         cls: () => ShaderLayer.fromBuiltin('voronoi') },
    { id: 'shader-turing',         label: 'Shader — Turing patterns', cls: () => ShaderLayer.fromBuiltin('turing') },
    { id: 'canvaspaint',          label: 'Canvas Paint',             cls: () => new CanvasPaintLayer(`paint-${Date.now()}`) },
    { id: 'feedback',            label: 'Feedback',                 cls: () => new FeedbackLayer(`feedback-${Date.now()}`) },
    { id: 'svg',                 label: 'SVG file',                 cls: () => { const l = new SVGLayer(`svg-${Date.now()}`); return l; } },
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
    onSelectLayer: (id) => {
      _selectedLayerId = id;
      LayerPanel.setSelectedId(id);
      // Update canvas cursor + show drag hint
      if (canvas._onLayerSelect) canvas._onLayerSelect(id);
    },
  });

  // Wire canvas drag — hold Alt to drag/scroll selected layer
  LayerPanel._initCanvasDrag(canvas);

  // Hook selectLayer to inject action buttons for special layer types
  const _origSelectLayer = LayerPanel.selectLayer.bind(LayerPanel);
  LayerPanel.selectLayer = (id) => {
    _origSelectLayer(id);
    const layer = layers.layers.find(l => l.id === id);
    if (layer instanceof MathVisualizer) {
      setTimeout(() => _injectMathRestartBtn(layer, paramsContent), 15);
    }
    if (layer instanceof CanvasPaintLayer) {
      setTimeout(() => _injectPaintClearBtn(layer, paramsContent), 15);
    }
    if (layer instanceof SVGLayer) {
      setTimeout(() => _injectSVGLoadBtn(layer, paramsContent), 15);
    }
  };

  // When an ImageLayer is added, show the library/upload prompt
  // Wrap setParam on a layer so automation can record it
  function _wrapLayerSetParam(layer) {
    if (layer._setParamWrapped) return;
    const origSetParam = layer.setParam.bind(layer);
    layer.setParam = (id, value) => {
      origSetParam(id, value);
      // Feed into automation recorder if active
      if (timeline.isRecording) {
        const manifest = layer.constructor?.manifest?.params?.find(p => p.id === id);
        timeline.recordPoint(layer.id, id, value, manifest);
      }
    };
    layer._setParamWrapped = true;
  }

  const _origLayersAdd = layers.add.bind(layers);
  layers.add = (layer) => {
    _origLayersAdd(layer);
    _wrapLayerSetParam(layer);
    if (layer instanceof ImageLayer) {
      setTimeout(() => LibraryPanel.showAddImagePrompt(layer), 100);
    }
    // Auto-prompt file load for media layers
    if (layer instanceof SVGLayer) {
      setTimeout(() => layer.promptLoad(), 100);
    }
    // Snapshot after add (timeout lets the layer finish initialising)
    if (!history._jumping) {
      setTimeout(() => history.snapshot(`Added ${layer.name}`), 50);
    }
  };

  function renderLayerList() { LayerPanel.renderLayerList(); }

  function _loadDefaultScene() {
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
    LFOPanel.refresh();
  }

  renderer.start();
  setTimeout(() => _showStartupDialog(), 150);

  // ── Preset save / load ────────────────────────────────────────
  document.getElementById('btn-preset-save').addEventListener('click', () => {
    const name = document.getElementById('preset-name').value.trim() || 'scene';
    let thumb = null;
    try {
      const t = document.createElement('canvas');
      t.width = 120; t.height = 68;
      t.getContext('2d').drawImage(canvas, 0, 0, 120, 68);
      thumb = t.toDataURL('image/jpeg', 0.6);
    } catch {}
    PresetBrowser.save(layers, name, thumb);
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
    Toast.success(`Scene "${name}" saved`);
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => PresetBrowser.toggle());

  document.getElementById('btn-scene-new')?.addEventListener('click', () => {
    _autoSave();
    history.snapshot('New scene');
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
      if (preset.lfos?.length) { lfoManager.clear(); lfoManager.fromJSON(preset.lfos, layers); LFOPanel.refresh(); }
      _selectedLayerId = null; LayerPanel.setSelectedId(null);
      paramsContent.innerHTML   = '';
      paramsEmpty.style.display = 'block';
      markDirty();
      history.snapshot(`Loaded preset: ${preset.name || file.name}`);
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

  renderer.onFrame = (dt, fps) => {
    labelFps.textContent    = `${fps} fps`;
    labelLayers.textContent = `${layers.count} layer${layers.count !== 1 ? 's' : ''}`;

    renderer.audioData = audio.smoothed;
    renderer.videoData = video.smoothed;

    beat.update(audio.smoothed, audio._dataArray);
    audio.smoothed.isBeat     = beat.isBeat;
    audio.smoothed.bpm        = beat.bpm;
    audio.smoothed.beat       = beat.beat;       // 1-4: beat within bar
    audio.smoothed.bar        = beat.bar;         // 1-4: bar within phrase
    audio.smoothed.phrase     = beat.phrase;      // 1+: current phrase
    audio.smoothed.isDownbeat = beat.isDownbeat;  // true on beat 1 of bar
    audio.smoothed.isBarOne   = beat.isBarOne;    // true on bar 1 of phrase

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
    lfoManager.tick(dt, beat.bpm || seq.bpm, layers);
    timeline.tick(dt);
    setlist.tick(dt);
    perfMode.tick(dt);
    AudioPanel.tick(audio.smoothed);
    VideoPanel.tick();
    dotAudio.classList.toggle('inactive', !audio.smoothed.isActive);

    // Push live modulated values into the params panel sliders
    if (_selectedLayerId) {
      const sel = layers.layers.find(l => l.id === _selectedLayerId);
      if (sel && typeof ParamPanel.updateLiveValues === 'function') {
        ParamPanel.updateLiveValues(sel);
      }
    }
  };

  // ── Scene Palette ─────────────────────────────────────────────
  const paletteContainer = document.getElementById('params-palette-container');
  if (paletteContainer) ScenePalette.renderPanel(layers, paletteContainer);
  VaelAssistant.init(layers, layerFactory, renderer);

  // ── Autosave ──────────────────────────────────────────────────
  const AUTOSAVE_KEY = 'vael-autosave';

  // _isDirty, _lastSaveTime, AUTOSAVE_DEBOUNCE_MS and markDirty()
  // are declared at the top of this IIFE to avoid temporal dead zone issues.

  function _autoSave() {
    if (!_isDirty && (Date.now() - _lastSaveTime) < 5 * 60 * 1000) return;
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
        timeline: timeline.toJSON(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(preset));
      _isDirty      = false;
      _lastSaveTime = Date.now();
    } catch (e) { console.warn('Auto-save failed:', e); }
  }

  function _restoreAutoSave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved) return false;
      const preset = JSON.parse(saved);
      if (!preset.layers?.length) return false;
      PresetManager._applyRaw(preset, layers, layerFactory);
      if (preset.lfos?.length) lfoManager.fromJSON(preset.lfos, layers);
      if (preset.timeline)    { timeline.fromJSON(preset.timeline); TimelinePanel.refresh(); }
      LFOPanel.refresh();
      return true;
    } catch { return false; }
  }

  function _showStartupDialog() {
    // Check if there's anything to restore
    let savedPreset = null;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.layers?.length) savedPreset = p;
      }
    } catch {}

    // If no autosave exists, just load the default scene silently
    if (!savedPreset) {
      _loadDefaultScene();
      return;
    }

    // Build startup dialog
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.88);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000; backdrop-filter: blur(12px);
    `;

    const savedDate = savedPreset.saved
      ? new Date(savedPreset.saved).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      : 'unknown';

    const box = document.createElement('div');
    box.style.cssText = `
      background: var(--bg-mid);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px 32px 28px;
      max-width: 400px;
      width: 90%;
      font-family: var(--font-mono);
      text-align: center;
    `;

    box.innerHTML = `
      <div style="font-size:28px;margin-bottom:12px">✦</div>
      <div style="font-size:13px;letter-spacing:2px;color:var(--accent);margin-bottom:8px">VAEL</div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:24px;line-height:1.7">
        Last session: <span style="color:var(--text)">${savedPreset.name}</span><br>
        <span style="color:var(--text-dim);font-size:9px">${savedDate}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button id="startup-restore" class="btn accent" style="font-size:11px;padding:12px">
          ↺ Restore last session
        </button>
        <button id="startup-new" class="btn" style="font-size:11px;padding:12px">
          ✦ Start new scene
        </button>
        <button id="startup-load" class="btn" style="font-size:11px;padding:12px;color:var(--text-dim)">
          ↑ Load a file…
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const dismiss = () => overlay.remove();

    box.querySelector('#startup-restore').addEventListener('click', () => {
      dismiss();
      const ok = _restoreAutoSave();
      if (ok) {
        Toast.info(`Restored: "${savedPreset.name}"`);
      } else {
        _loadDefaultScene();
        Toast.warn('Could not restore — starting fresh');
      }
    });

    box.querySelector('#startup-new').addEventListener('click', () => {
      dismiss();
      _loadDefaultScene();
    });

    box.querySelector('#startup-load').addEventListener('click', () => {
      dismiss();
      _loadDefaultScene();
      // Small delay then trigger the preset load dialog
      setTimeout(() => document.getElementById('btn-preset-load')?.click(), 200);
    });
  }

  setInterval(_autoSave, AUTOSAVE_DEBOUNCE_MS);
  window.addEventListener('beforeunload', () => { _isDirty = true; _autoSave(); });

  // ── Panel init ────────────────────────────────────────────────
  AudioPanel.init(audio, dotAudio, labelAudio);
  VideoPanel.init(video, audio, layers, dotVideo, labelVideo);
  RecordPanel.init(recorder, audio, canvas, renderer);

  // ── Tab switching ─────────────────────────────────────────────
  // Skips any tab panel that has been moved into a pop-out floating window
  // (detected by checking whether it still lives inside #sidebar-content).
  const _sidebarContent = document.getElementById('sidebar-content');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      // Only deactivate tab buttons for panels still in the sidebar
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => {
        // If the panel is inside a pop-out window, leave it alone
        if (_sidebarContent && !_sidebarContent.contains(p)) return;
        p.classList.remove('active');
      });

      const panel = document.getElementById(`tab-${target}`);
      if (!panel) return;

      // If this tab is in a pop-out, just focus that window instead of activating in sidebar
      if (_sidebarContent && !_sidebarContent.contains(panel)) {
        // Find and bring the pop-out to front
        const popout = panel.closest('.vael-popout');
        if (popout) {
          popout.style.zIndex = String(320);
          popout.style.boxShadow = '0 8px 40px rgba(0,212,170,0.2)';
        }
        return;
      }

      btn.classList.add('active');
      panel.classList.add('active');
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      history.redo();
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

})();
