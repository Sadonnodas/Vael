/**
 * ui/App.js
 * Top-level application controller.
 *
 * CHANGES:
 * - Uses LibraryPanel (unified video+image) instead of VideoLibraryPanel.
 * - videoLibrary.onChanged no longer overwrites the panel's internal handler.
 *   Instead App.js calls LibraryPanel.refresh() and updates the param panel
 *   if a VideoPlayerLayer is selected.
 * - VideoPanel now also adds uploaded videos to the VideoLibrary so they
 *   appear in the LIBRARY tab.
 * - _renderImageLayerPanel replaced by a fully working version. File input
 *   lives in document.body and is scoped to the current layer via closure.
 * - MathVisualizer param panel gets a Restart button when buildMode is on.
 * - _autoSave uses layer.toJSON() so modMatrix + fx survive autosave.
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

  // ── Video Library ─────────────────────────────────────────────
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
      default: console.warn('Unknown layer type:', typeName); return null;
    }
  }

  // ── Image layer panel ─────────────────────────────────────────
  // File input is created per-render and scoped to the current layer
  // via closure so there's no stale reference problem.
  function _renderImageLayerPanel(layer, container) {
    container.innerHTML = '';

    // Editable name header
    if (typeof ParamPanel !== 'undefined' && ParamPanel._buildNameHeader) {
      container.appendChild(ParamPanel._buildNameHeader(layer, 'Image'));
    }

    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:10px';
    statusEl.textContent   = layer._loaded ? `Loaded: ${layer._fileName}` : 'No image loaded';
    container.appendChild(statusEl);

    const loadBtn = document.createElement('button');
    loadBtn.className        = 'btn accent';
    loadBtn.style.width      = '100%';
    loadBtn.style.marginBottom = '8px';
    loadBtn.textContent      = '↑ Load image file…';
    container.appendChild(loadBtn);

    const libHint = document.createElement('p');
    libHint.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.5;margin-bottom:14px';
    libHint.innerHTML = 'Or go to the <strong style="color:var(--accent2)">LIBRARY tab → Images</strong> to manage multiple images and load them into any Image layer.';
    container.appendChild(libHint);

    // Create a fresh file input for this layer, appended to body
    // Remove any stale one first
    const OLD_ID = '_image-layer-file-input';
    document.getElementById(OLD_ID)?.remove();

    const fileInput    = document.createElement('input');
    fileInput.id       = OLD_ID;
    fileInput.type     = 'file';
    fileInput.accept   = 'image/*';
    fileInput.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-999px';
    document.body.appendChild(fileInput);

    loadBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    // Closure over `layer` — always refers to the layer this panel was built for
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      loadBtn.textContent = 'Loading…';
      loadBtn.disabled    = true;
      try {
        await layer.loadFile(file);
        statusEl.textContent = `Loaded: ${layer._fileName}`;
        Toast.success(`Image loaded: ${layer._fileName}`);
      } catch {
        Toast.error('Could not load image file');
      }
      loadBtn.textContent = '↑ Load image file…';
      loadBtn.disabled    = false;
    });

    const tip = document.createElement('p');
    tip.style.cssText = 'font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:14px';
    tip.innerHTML = 'Use a PNG with transparency as a <strong style="color:var(--accent2)">mask</strong> on another layer, or use any image as a visual layer with blend modes.';
    container.appendChild(tip);

    // Standard params + ModMatrix + FX
    ParamPanel.render(layer, container, audio);
  }

  // ── MathVisualizer panel — adds Restart button ───────────────
  function _renderMathPanel(layer, container) {
    // Use standard ParamPanel for all controls
    ParamPanel.render(layer, container, audio);

    // Inject a Restart button after the buildMode controls
    // (only useful when buildMode is on, but show it always for discoverability)
    const restartBtn = document.createElement('button');
    restartBtn.className   = 'btn';
    restartBtn.style.cssText = 'width:100%;margin-top:4px;margin-bottom:14px;font-size:9px';
    restartBtn.textContent = '↺ Restart animation';
    restartBtn.addEventListener('click', () => {
      if (typeof layer.restartBuild === 'function') layer.restartBuild();
      Toast.info('Animation restarted');
    });

    // Insert before the ModMatrix divider (first child that is a divider)
    // Fallback: just append
    const modDivider = [...container.children].find(el =>
      el.style.height === '1px' && el.style.background?.includes('border-dim')
    );
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

  document.getElementById('btn-preset-library')?.addEventListener('click', () => {
    PresetBrowser.toggle();
  });

  // ── Setlist + performance mode ───────────────────────────────
  const setlist  = new SetlistManager(layers, layerFactory);
  const perfMode = new PerformanceMode({ setlist, audio, beatDetector: beat, layerStack: layers });

  document.addEventListener('vael:fade-duration',   e => { setlist.fadeDuration   = e.detail; });
  document.addEventListener('vael:transition-type', e => { setlist.transitionType = e.detail; });

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
  const osc = new OscBridge({ layerStack: layers, setlist, recorder });
  osc.connect('ws://localhost:8080');

  // ── LFO Modulator ─────────────────────────────────────────────
  const lfoManager = new LFOManager();
  LFOPanel.init(lfoManager, layers, document.getElementById('lfo-panel-content'));

  layers.onChanged = () => {
    renderLayerList();
    LFOPanel.refresh();
  };

  // ── Post-processing FX ────────────────────────────────────────
  PostFXPanel.init(renderer, document.getElementById('fx-panel-content'));

  // ── Library panel ─────────────────────────────────────────────
  // FIX: We pass a getSelectedLayer callback so LibraryPanel can load
  // images into the currently selected ImageLayer.
  // We do NOT set videoLibrary.onChanged here — LibraryPanel owns that.
  LibraryPanel.init({
    videoLibrary,
    layerStack:        layers,
    getSelectedLayer:  () => layers.layers.find(l => l.id === _selectedLayerId) || null,
    container:         document.getElementById('library-panel-content'),
  });

  // When video library changes, refresh the library panel and update
  // the param panel if a VideoPlayerLayer is currently open.
  videoLibrary.onChanged = () => {
    LibraryPanel.refresh();
    if (_selectedLayerId) {
      const layer = layers.layers.find(l => l.id === _selectedLayerId);
      if (layer instanceof VideoPlayerLayer) {
        ParamPanel.render(layer, paramsContent, audio);
      }
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
    if (!_selectedLayerId) {
      alert('Select a layer first, then go to the MIDI tab and click Learn.');
      return;
    }
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
    layers,
    layerFactory,
    audio,
    canvas,
    blendModes:            BLEND_MODES,
    layerTypes:            LAYER_TYPES,
    renderImageLayerPanel: _renderImageLayerPanel,
    onSelectLayer: (id) => {
      _selectedLayerId = id;
      LayerPanel.setSelectedId(id);
    },
  });

  // Override selectLayer to inject MathVisualizer restart button
  const _origSelectLayer = LayerPanel.selectLayer.bind(LayerPanel);
  LayerPanel.selectLayer = (id) => {
    _origSelectLayer(id);
    // After ParamPanel renders for MathVisualizer, inject the restart button
    const layer = layers.layers.find(l => l.id === id);
    if (layer instanceof MathVisualizer) {
      // Small delay to let ParamPanel finish rendering
      setTimeout(() => _renderMathPanel(layer, paramsContent), 10);
    }
  };

  function renderLayerList() { LayerPanel.renderLayerList(); }

  // ── Default scene ────────────────────────────────────────────
  const noiseLayer = new NoiseFieldLayer('noise-default');
  noiseLayer.init({ mode: 'field', hueA: 210, hueB: 260, speed: 0.08, lightness: 0.08, saturation: 0.6 });
  noiseLayer.opacity   = 1.0;
  noiseLayer.blendMode = 'normal';

  const mathLayer = new MathVisualizer('math-default');
  mathLayer.init({
    mode: 'path', constant: 'pi', colorMode: 'rainbow',
    digitCount: 1200, angle: 36, lineWidth: 1.4, zoom: 0.9,
    buildMode: true, buildSpeed: 10,
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
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
    Toast.success(`Scene "${name}" saved`);
  });

  document.getElementById('btn-preset-library')?.addEventListener('click', () => {
    PresetBrowser.toggle();
  });

  document.getElementById('btn-scene-new')?.addEventListener('click', () => {
    _autoSave();
    [...layers.layers].forEach(l => layers.remove(l.id));
    _selectedLayerId = null;
    LayerPanel.setSelectedId(null);
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
      _selectedLayerId = null;
      LayerPanel.setSelectedId(null);
      paramsContent.innerHTML   = '';
      paramsEmpty.style.display = 'block';
      Toast.success(`Scene "${preset.name || file.name}" loaded`);
    } catch (err) {
      Toast.error(`Could not load preset: ${err.message}`);
    }
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
    audio.smoothed.isBeat = beat.isBeat;
    audio.smoothed.bpm    = beat.bpm;

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
            transform: { ...layer.transform }, modMatrix: layer.modMatrix?.toJSON() || [],
            fx: layer.fx ? layer.fx.map(f => ({ ...f, params: { ...f.params } })) : [],
            params: layer.params ? { ...layer.params } : {},
          }
        ),
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
      PresetManager._applyRaw(preset, layers, layerFactory);
      Toast.info(`Restored autosave: "${preset.name}"`);
    } catch {}
  }

  setInterval(_autoSave, 5 * 60 * 1000);
  window.addEventListener('beforeunload', _autoSave);

  // ── Panel init ────────────────────────────────────────────────
  AudioPanel.init(audio, dotAudio, labelAudio);

  // VideoPanel — wire upload to also add to the library
  VideoPanel.init(video, audio, layers, dotVideo, labelVideo);

  // Intercept VideoPanel file changes to also add to VideoLibrary.
  // We do this by hooking the input-video-file change event after VideoPanel.init().
  const videoFileInput = document.getElementById('input-video-file');
  if (videoFileInput) {
    videoFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      // VideoPanel already handles this file — we just also add it to the library
      try {
        await videoLibrary.add(file);
        // Don't show a second toast — VideoPanel already did
      } catch {}
    });
  }

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

})();
