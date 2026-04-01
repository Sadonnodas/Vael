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
      case 'VideoPlayerLayer': return new VideoPlayerLayer(uid, video.videoElement);
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
      default: console.warn('Unknown layer type:', typeName); return null;
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
    const layer = _findLayerAnywhere(_selectedLayerId);
    if (!layer) return;
    if (layer instanceof ImageLayer)  _renderImageLayerPanel(layer, paramsContent);
    else if (layer instanceof ShaderLayer) ShaderPanel.render(layer, paramsContent);
    else if (layer instanceof LyricsLayer) LyricsPanel.render(layer, paramsContent);
    else ParamPanel.render(layer, paramsContent, audio);
  });

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

  // ── OSC ──────────────────────────────────────────────────────
  const osc = new OscBridge({ layerStack: layers, setlist, recorder });
  osc.connect('ws://localhost:8080');

  // ── LFO ──────────────────────────────────────────────────────
  const lfoManager = new LFOManager();
  LFOPanel.init(lfoManager, layers, document.getElementById('lfo-panel-content'));
  layers.onChanged = () => { renderLayerList(); LFOPanel.refresh(); };

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
  // Close on backdrop click
  document.getElementById('help-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('help-overlay')) {
      document.getElementById('help-overlay').style.display = 'none';
    }
  });

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
    { id: 'canvas-paint',     label: 'Canvas Paint',           cls: () => new CanvasPaintLayer(`canvas-paint-${Date.now()}`) },
    { id: 'svg',              label: 'SVG',                    cls: () => new SVGLayer(`svg-${Date.now()}`) },
    { id: 'feedback',         label: 'Feedback',               cls: () => new FeedbackLayer(`feedback-${Date.now()}`) },
    { id: 'group',            label: 'Group (empty)',           cls: () => { const g = new GroupLayer(`group-${Date.now()}`); g.name = 'Group'; return g; } },
    { id: 'shader-custom',    label: 'Shader — Custom (blank)', cls: () => { const s = new ShaderLayer(`shader-${Date.now()}`); s._shaderName = 'custom'; s._customGLSL = ''; s.name = 'Custom Shader'; return s; } },
    { id: 'shader-plasma',    label: 'Shader — Plasma',        cls: () => ShaderLayer.fromBuiltin('plasma') },
    { id: 'shader-ripple',    label: 'Shader — Ripple',        cls: () => ShaderLayer.fromBuiltin('ripple') },
    { id: 'shader-distort',   label: 'Shader — Distort',       cls: () => ShaderLayer.fromBuiltin('distort') },
    { id: 'shader-bloom',     label: 'Shader — Bloom',         cls: () => ShaderLayer.fromBuiltin('bloom') },
    { id: 'shader-chromatic', label: 'Shader — Chromatic',     cls: () => ShaderLayer.fromBuiltin('chromatic') },
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
  };

  function renderLayerList() { LayerPanel.renderLayerList(); }

  // ── Default scene — clean slate, just noise + particles ──────
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

  // Refresh panels that rendered before layers were added
  LFOPanel.refresh();

  renderer.start();
  setTimeout(() => _restoreAutoSave(), 100);

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
    setTimeout(_renderInlinePresetGrid, 100);
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
    Toast.success(`Scene "${name}" saved`);
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
      if (preset.lfos?.length) { lfoManager.clear(); lfoManager.fromJSON(preset.lfos, layers); LFOPanel.refresh(); }
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

  renderer.onFrame = (dt, fps) => {
    labelFps.textContent    = `${fps} fps`;
    labelLayers.textContent = `${layers.count} layer${layers.count !== 1 ? 's' : ''}`;

    renderer.audioData = audio.smoothed;
    renderer.videoData = video.smoothed;

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
    setlist.tick(dt);
    perfMode.tick(dt);
    AudioPanel.tick(audio.smoothed);
    VideoPanel.tick();
    dotAudio.classList.toggle('inactive', !audio.smoothed.isActive);
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

  function _restoreAutoSave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (!saved) return;
      const preset = JSON.parse(saved);
      if (!preset.layers?.length || layers.count > 0) return;

      // Show startup dialog instead of silently restoring
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

      // Hover effects
      ['sd-resume','sd-fresh','sd-load'].forEach(id => {
        const btn = overlay.querySelector(`#${id}`);
        btn.addEventListener('mouseenter', () => btn.style.filter = 'brightness(1.2)');
        btn.addEventListener('mouseleave', () => btn.style.filter = '');
      });

      // Resume
      overlay.querySelector('#sd-resume').addEventListener('click', () => {
        overlay.remove();
        PresetManager._applyRaw(preset, layers, layerFactory);
        if (preset.lfos?.length) { lfoManager.fromJSON(preset.lfos, layers); LFOPanel.refresh(); }
        Toast.success(`Resumed: "${preset.name}"`);
      });

      // Fresh start — discard autosave
      overlay.querySelector('#sd-fresh').addEventListener('click', () => {
        overlay.remove();
        localStorage.removeItem(AUTOSAVE_KEY);
        Toast.info('Starting fresh');
      });

      // Load from file
      overlay.querySelector('#sd-load').addEventListener('click', () => {
        overlay.remove();
        document.getElementById('btn-preset-load')?.click();
      });

    } catch { /* corrupted autosave — just skip silently */ }
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
