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
      default: console.warn('Unknown layer type:', typeName); return null;
    }
  }

  // ── Setlist + Performance mode ────────────────────────────────
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
    { id: 'gradient',  label: 'Gradient',        cls: () => new GradientLayer(`gradient-${Date.now()}`) },
    { id: 'math',      label: 'Math Visualizer',  cls: () => new MathVisualizer(`math-${Date.now()}`) },
    { id: 'particles', label: 'Particles',        cls: () => new ParticleLayer(`particles-${Date.now()}`) },
    { id: 'noise',     label: 'Noise Field',      cls: () => new NoiseFieldLayer(`noise-${Date.now()}`) },
    { id: 'video',     label: 'Video',            cls: () => {
      const l = new VideoPlayerLayer(`video-${Date.now()}`, video.videoElement);
      return l;
    }},
    { id: 'shader-plasma',   label: 'Shader — Plasma',    cls: () => ShaderLayer.fromBuiltin('plasma') },
    { id: 'shader-ripple',   label: 'Shader — Ripple',    cls: () => ShaderLayer.fromBuiltin('ripple') },
    { id: 'shader-distort',  label: 'Shader — Distort',   cls: () => ShaderLayer.fromBuiltin('distort') },
    { id: 'shader-bloom',    label: 'Shader — Bloom',     cls: () => ShaderLayer.fromBuiltin('bloom') },
    { id: 'shader-chromatic',label: 'Shader — Chromatic', cls: () => ShaderLayer.fromBuiltin('chromatic') },
  ];

  const BLEND_MODES = ['normal','multiply','screen','overlay','add','softlight','difference','luminosity'];

  // ── Default scene ────────────────────────────────────────────
  const noiseLayer = new NoiseFieldLayer('noise-default');
  noiseLayer.init({ hueA: 200, hueB: 270, lightness: 0.12 });
  noiseLayer.opacity = 1.0;

  const mathLayer = new MathVisualizer('math-default');
  mathLayer.init({ mode: 'path', constant: 'pi', colorMode: 'rainbow', digitCount: 600 });
  mathLayer.opacity   = 0.85;
  mathLayer.blendMode = 'screen';

  layers.add(noiseLayer);
  layers.add(mathLayer);

  renderer.start();

  // ── Layer panel ──────────────────────────────────────────────
  const layerList    = document.getElementById('layer-list');
  const emptyState   = document.getElementById('layers-empty');
  const paramsEmpty  = document.getElementById('params-empty');
  const paramsContent = document.getElementById('params-content');

  layers.onChanged = () => renderLayerList();

  function selectLayer(id) {
    _selectedLayerId = id;
    const layer = layers.layers.find(l => l.id === id);
    if (!layer) return;

    // Highlight selected row
    document.querySelectorAll('.layer-row').forEach(r => {
      r.style.borderColor = r.dataset.id === id
        ? 'var(--accent)' : 'var(--border-dim)';
    });

    // Render params panel
    paramsEmpty.style.display   = 'none';
    paramsContent.style.display = 'block';
    ParamPanel.render(layer, paramsContent, audio);

    // Switch to params tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="params"]').classList.add('active');
    document.getElementById('tab-params').classList.add('active');
  }

  function renderLayerList() {
    layerList.innerHTML = '';
    const hasLayers = layers.count > 0;
    emptyState.style.display = hasLayers ? 'none' : 'block';

    // Render in reverse so top layer appears first in UI
    [...layers.layers].reverse().forEach(layer => {
      const row = document.createElement('div');
      row.className    = 'layer-row';
      row.dataset.id   = layer.id;
      row.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${layer.id === _selectedLayerId ? 'var(--accent)' : 'var(--border-dim)'};
        border-radius: 5px;
        padding: 8px 10px;
        margin-bottom: 6px;
        cursor: pointer;
        transition: border-color 0.15s;
      `;

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <button class="vis-toggle" data-id="${layer.id}" title="Toggle visibility"
            style="background:none;border:none;cursor:pointer;font-size:13px;
                   color:${layer.visible ? 'var(--accent)' : 'var(--text-dim)'}">
            ${layer.visible ? '◉' : '○'}
          </button>
          <span class="layer-name-btn" style="flex:1;font-family:var(--font-mono);
                font-size:10px;color:var(--text);cursor:pointer">
            ${layer.name}
          </span>
          <button class="layer-up"   data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move up">↑</button>
          <button class="layer-down" data-id="${layer.id}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px" title="Move down">↓</button>
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
      `;

      // Click layer name → open params
      row.querySelector('.layer-name-btn').addEventListener('click', e => {
        e.stopPropagation();
        selectLayer(layer.id);
      });

      row.querySelector('.vis-toggle').addEventListener('click', e => {
        e.stopPropagation();
        layers.setVisible(layer.id, !layer.visible);
      });
      row.querySelector('.layer-up').addEventListener('click', e => {
        e.stopPropagation();
        layers.moveUp(layer.id);
      });
      row.querySelector('.layer-down').addEventListener('click', e => {
        e.stopPropagation();
        layers.moveDown(layer.id);
      });
      row.querySelector('.layer-del').addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Remove "${layer.name}"?`)) {
          if (_selectedLayerId === layer.id) {
            _selectedLayerId = null;
            paramsContent.innerHTML = '';
            paramsEmpty.style.display = 'block';
          }
          layers.remove(layer.id);
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

      layerList.appendChild(row);
    });
  }

  // Add layer button → simple picker
  document.getElementById('btn-add-layer').addEventListener('click', () => {
    showLayerPicker();
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
    const preset = PresetManager.save(layers, name);
    PresetManager.storeRecent(preset);
  });

  document.getElementById('btn-preset-load').addEventListener('click', () => {
    document.getElementById('input-preset-file').click();
  });

  document.getElementById('input-preset-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const preset = await PresetManager.load(file, layers, layerFactory);
      if (preset.name) {
        document.getElementById('preset-name').value = preset.name;
      }
      _selectedLayerId = null;
      paramsContent.innerHTML = '';
      paramsEmpty.style.display = 'block';
    } catch (err) {
      alert(`Could not load preset:\n${err.message}`);
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

    // Keep renderer data refs fresh
    renderer.audioData = audio.smoothed;
    renderer.videoData = video.smoothed;

    // Beat detection — update every frame
    beat.update(audio.smoothed, audio._dataArray);

    // Expose isBeat on the shared audio data so layers can read it
    audio.smoothed.isBeat = beat.isBeat;
    audio.smoothed.bpm    = beat.bpm;

    // Crossfade tick
    setlist.tick(dt);

    // Performance mode tick (beat flash, HUD updates)
    perfMode.tick(dt);

    // Audio status
    const audioActive = audio.smoothed.isActive;
    dotAudio.classList.toggle('inactive', !audioActive);

    // VU meters
    if (audioActive) {
      updateVU('bass',   audio.smoothed.bass);
      updateVU('mid',    audio.smoothed.mid);
      updateVU('treble', audio.smoothed.treble);
      updateVU('volume', audio.smoothed.volume);
    }

    // Video scrubber
    if (video.sourceType === 'file') {
      updateScrubber('video', video.currentTime, video.duration);
    }

    // Audio scrubber
    if (audio.sourceType === 'file') {
      updateScrubber('audio', audio.currentTime, audio.duration);
    }

    // Video VU
    if (video.smoothed.isActive) {
      updateVUById('vu-bright', 'vn-bright', video.smoothed.brightness);
      updateVUById('vu-motion', 'vn-motion', video.smoothed.motion);
      updateVUById('vu-edges',  'vn-edges',  video.smoothed.edgeDensity);
    }
  };

  function updateVU(band, value) {
    updateVUById(`vu-${band}`, `vn-${band}`, value);
  }

  function updateVUById(fillId, numId, value) {
    const fill = document.getElementById(fillId);
    const num  = document.getElementById(numId);
    if (fill) fill.style.width = `${Math.round(value * 100)}%`;
    if (num)  num.textContent  = Math.round(value * 100);
  }

  function updateScrubber(type, pos, dur) {
    const pct  = dur > 0 ? pos / dur : 0;
    const fill = document.getElementById(`${type}-fill`);
    const head = document.getElementById(`${type}-head`);
    const posEl= document.getElementById(`${type}-pos`);
    const durEl= document.getElementById(`${type}-duration`);
    if (fill)  fill.style.width = `${pct * 100}%`;
    if (head)  head.style.left  = `${pct * 100}%`;
    if (posEl) posEl.textContent = VaelMath.formatTime(pos);
    if (durEl) durEl.textContent = VaelMath.formatTime(dur);
  }

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

  // ── Audio tab ─────────────────────────────────────────────────
  const inputAudioFile = document.getElementById('input-audio-file');
  const audioTransport = document.getElementById('audio-transport');
  const micActiveEl    = document.getElementById('mic-active');
  const audioLevels    = document.getElementById('audio-levels-section');
  const audioFilename  = document.getElementById('audio-filename');
  const btnAudioPlay   = document.getElementById('btn-audio-play');

  document.getElementById('btn-audio-file').addEventListener('click', () => inputAudioFile.click());

  inputAudioFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await audio.loadFile(file);
      audioFilename.textContent    = file.name;
      audioTransport.style.display = 'block';
      micActiveEl.style.display    = 'none';
      audioLevels.style.display    = 'block';
      dotAudio.classList.remove('inactive');
      labelAudio.textContent = file.name.replace(/\.[^.]+$/, '');
      audio.play();
      btnAudioPlay.textContent = '⏸';
    } catch (err) { console.error(err); }
    e.target.value = '';
  });

  document.getElementById('btn-audio-mic').addEventListener('click', async () => {
    try {
      await audio.startMic();
      audioTransport.style.display = 'none';
      micActiveEl.style.display    = 'block';
      audioLevels.style.display    = 'block';
      dotAudio.classList.remove('inactive');
      labelAudio.textContent = 'Microphone';
    } catch { alert('Microphone access denied.'); }
  });

  btnAudioPlay.addEventListener('click', () => {
    if (audio.isPlaying) { audio.pause(); btnAudioPlay.textContent = '▶'; }
    else                 { audio.play();  btnAudioPlay.textContent = '⏸'; }
  });

  document.getElementById('btn-audio-stop').addEventListener('click', () => {
    audio.stop();
    audioTransport.style.display = 'none';
    audioLevels.style.display    = 'none';
    dotAudio.classList.add('inactive');
    labelAudio.textContent = 'No audio';
    btnAudioPlay.textContent = '▶';
  });

  document.getElementById('btn-mic-stop').addEventListener('click', () => {
    audio.stop();
    micActiveEl.style.display = 'none';
    audioLevels.style.display = 'none';
    dotAudio.classList.add('inactive');
    labelAudio.textContent = 'No audio';
  });

  document.getElementById('audio-seek').addEventListener('input', e => {
    audio.seekTo(parseFloat(e.target.value) * audio.duration);
  });

  const slAudioSpeed  = document.getElementById('sl-audio-speed');
  const valAudioSpeed = document.getElementById('val-audio-speed');
  slAudioSpeed.addEventListener('input', () => {
    const v = parseFloat(slAudioSpeed.value);
    audio.inputSpeed = v;
    valAudioSpeed.textContent = v.toFixed(3);
  });

  // ── Video tab ─────────────────────────────────────────────────
  const inputVideoFile  = document.getElementById('input-video-file');
  const videoTransport  = document.getElementById('video-transport');
  const webcamActiveEl  = document.getElementById('webcam-active');
  const videoLevels     = document.getElementById('video-levels-section');
  const videoMonitorEl  = document.getElementById('video-monitor');
  const videoEl         = document.getElementById('video-el');
  const videoFilename   = document.getElementById('video-filename');
  const btnVideoPlay    = document.getElementById('btn-video-play');

  document.getElementById('btn-video-file').addEventListener('click', () => inputVideoFile.click());

  inputVideoFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    videoEl.src  = url;
    videoEl.loop = true;
    await videoEl.play();

    // Also wire the VideoEngine for pixel analysis
    await video.loadFile(file);

    videoFilename.textContent    = file.name;
    videoTransport.style.display = 'block';
    videoMonitorEl.style.display = 'block';
    webcamActiveEl.style.display = 'none';
    videoLevels.style.display    = 'block';
    dotVideo.classList.remove('inactive');
    labelVideo.textContent = file.name.replace(/\.[^.]+$/, '');
    btnVideoPlay.textContent = '⏸';

    // Update any VideoPlayerLayer instances
    layers.layers.forEach(layer => {
      if (layer instanceof VideoPlayerLayer) {
        layer.setVideoElement(video.videoElement);
      }
    });

    e.target.value = '';
  });

  document.getElementById('btn-video-webcam').addEventListener('click', async () => {
    try {
      await video.startWebcam();
      // Show the webcam feed in the sidebar monitor
      const stream = video.videoElement?.srcObject;
      if (stream) { videoEl.srcObject = stream; videoEl.play(); }
      videoMonitorEl.style.display = 'block';
      videoTransport.style.display = 'none';
      webcamActiveEl.style.display = 'block';
      videoLevels.style.display    = 'block';
      dotVideo.classList.remove('inactive');
      labelVideo.textContent = 'Webcam';

      // Update any VideoPlayerLayer instances with the live element
      layers.layers.forEach(layer => {
        if (layer instanceof VideoPlayerLayer) {
          layer.setVideoElement(video.videoElement);
        }
      });
    } catch { alert('Camera access denied.'); }
  });

  btnVideoPlay.addEventListener('click', () => {
    if (videoEl.paused) { videoEl.play(); video.play(); btnVideoPlay.textContent = '⏸'; }
    else                { videoEl.pause(); video.pause(); btnVideoPlay.textContent = '▶'; }
  });

  document.getElementById('btn-video-stop').addEventListener('click', () => {
    videoEl.pause(); videoEl.src = ''; videoEl.srcObject = null;
    video.stop();
    videoTransport.style.display = 'none';
    videoMonitorEl.style.display = 'none';
    videoLevels.style.display    = 'none';
    dotVideo.classList.add('inactive');
    labelVideo.textContent = 'No video';
  });

  document.getElementById('btn-webcam-stop').addEventListener('click', () => {
    video.stop();
    if (videoEl.srcObject) { videoEl.srcObject.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; }
    videoMonitorEl.style.display = 'none';
    webcamActiveEl.style.display = 'none';
    videoLevels.style.display    = 'none';
    dotVideo.classList.add('inactive');
    labelVideo.textContent = 'No video';
  });

  document.getElementById('video-seek').addEventListener('input', e => {
    const pct = parseFloat(e.target.value);
    if (videoEl.duration) videoEl.currentTime = pct * videoEl.duration;
    video.seekTo(pct * video.duration);
  });

  // ── Record tab ────────────────────────────────────────────────
  const recIdle   = document.getElementById('rec-idle');
  const recActive = document.getElementById('rec-active');
  const recDone   = document.getElementById('rec-done');
  const recTimer  = document.getElementById('rec-timer');
  const recInfo   = document.getElementById('rec-info');
  const slFps     = document.getElementById('sl-fps');
  const valFps    = document.getElementById('val-fps');

  slFps.addEventListener('input', () => { valFps.textContent = `${slFps.value} fps`; });

  document.getElementById('btn-rec-start').addEventListener('click', () => {
    recorder.start(canvas, parseInt(slFps.value));
    recIdle.style.display   = 'none';
    recActive.style.display = 'block';
    recDone.style.display   = 'none';
    recTimer.textContent    = '0:00';

    recorder._uiTimer = setInterval(() => {
      recTimer.textContent = VaelMath.formatTime(recorder.duration);
    }, 500);
  });

  document.getElementById('btn-rec-stop').addEventListener('click', () => {
    recorder.stop();
    clearInterval(recorder._uiTimer);
    // Wait for onstop to fire
    setTimeout(() => {
      recActive.style.display = 'none';
      recDone.style.display   = 'block';
      recInfo.textContent     = `${recTimer.textContent} recorded — ready to download`;
    }, 200);
  });

  document.getElementById('btn-rec-download').addEventListener('click', () => {
    recorder.download('vael-recording.webm');
  });

  document.getElementById('btn-rec-discard').addEventListener('click', () => {
    recorder.reset();
    recDone.style.display = 'none';
    recIdle.style.display = 'block';
    recTimer.textContent  = '0:00';
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  // F, arrows, Escape, S, 1-9 are handled by PerformanceMode.
  // Space (play/pause) stays here.
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === ' ') {
      e.preventDefault();
      if (audio.sourceType === 'file') {
        if (audio.isPlaying) { audio.pause(); btnAudioPlay.textContent = '▶'; }
        else                 { audio.play();  btnAudioPlay.textContent = '⏸'; }
      }
    }
  });

  console.log(
    '%cVAEL%c — Light onto Sound',
    'color:#00d4aa;font-weight:bold;font-size:18px;letter-spacing:4px',
    'color:#7878a0;font-size:12px'
  );

})();