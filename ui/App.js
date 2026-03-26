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
      case 'WaveformLayer':    { const l = new WaveformLayer(uid); l._audioEngine = audio; return l; }
      case 'PatternLayer':     return new PatternLayer(uid);
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
    _selectedLayerId = null; LayerPanel.setSelectedId(null);
    document.getElementById('params-content').innerHTML = '';
    document.getElementById('params-empty').style.display = 'block';
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => {
    PresetBrowser.toggle();
  });
  const setlist  = new SetlistManager(layers, layerFactory);
  const perfMode = new PerformanceMode({ setlist, audio, beatDetector: beat, layerStack: layers });

  // Sync fade duration and transition type from setlist panel → engine
  document.addEventListener('vael:fade-duration', e => { setlist.fadeDuration = e.detail; });
  document.addEventListener('vael:transition-type', e => {
    setlist.transitionType = e.detail;
  });

  // Flash overlay for flash transition
  const flashOverlay = document.createElement('div');
  flashOverlay.id = 'vael-transition-overlay';
  flashOverlay.style.cssText = `
    position:fixed;inset:0;background:white;opacity:0;pointer-events:none;z-index:99;
    transition:opacity 0.05s;
  `;
  document.body.appendChild(flashOverlay);

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
    { id: 'waveform',    label: 'Waveform / Spectrum',   cls: () => {
      const l = new WaveformLayer(`waveform-${Date.now()}`);
      l._audioEngine = audio;
      return l;
    }},
    { id: 'pattern',     label: 'Pattern (geometric)',   cls: () => new PatternLayer(`pattern-${Date.now()}`) },
    { id: 'image',       label: 'Image (PNG/JPG/SVG)',   cls: () => new ImageLayer(`image-${Date.now()}`) },
    { id: 'group',       label: 'Group (empty)',          cls: () => { const g = new GroupLayer(`group-${Date.now()}`); g.name = 'Group'; return g; } },
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


  // ── Layer panel (delegated to LayerPanel module) ──────────────
  const paramsEmpty   = document.getElementById('params-empty');
  const paramsContent = document.getElementById('params-content');

  LayerPanel.init({
    layers,
    layerFactory,
    audio,
    canvas,
    blendModes:  ['normal','multiply','screen','overlay','add','softlight','difference','luminosity','subtract','exclusion'],
    layerTypes:  LAYER_TYPES,
    renderImageLayerPanel: _renderImageLayerPanel,
    onSelectLayer: (id) => {
      _selectedLayerId = id;
      LayerPanel.setSelectedId(id);
      // LayerPanel.selectLayer handles params panel rendering and tab switching
    },
  });

  function renderLayerList() { LayerPanel.renderLayerList(); }

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
    _selectedLayerId = null; LayerPanel.setSelectedId(null);
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
      _selectedLayerId = null; LayerPanel.setSelectedId(null);
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

  // ── Scene Palette — shown in PARAMS tab when no layer selected ─
  const paletteContainer = document.getElementById('params-palette-container');
  if (paletteContainer) ScenePalette.renderPanel(layers, paletteContainer);
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
