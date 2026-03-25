/**
 * ui/App.js
 * Top-level application controller.
 * Initialises all engine modules, wires them to the UI,
 * and keeps the status strip updated every frame.
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

  // Wire renderer
  renderer.layerStack = layers;
  renderer.audioData  = audio.smoothed;
  renderer.videoData  = video.smoothed;

  // Add default layers
  const gradientLayer  = new GradientLayer('gradient-1');
  const mathLayer      = new MathVisualizer('math-1');
  gradientLayer.init();
  layers.add(gradientLayer);
  layers.add(mathLayer);

  // Start render loop
  renderer.start();

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

    // Audio dot
    const audioActive = audio.smoothed.isActive;
    dotAudio.classList.toggle('inactive', !audioActive);
    if (!audioActive) labelAudio.textContent = 'No audio';

    // Update VU meters when active
    if (audioActive) {
      const s = audio.smoothed;
      updateVU('bass',   s.bass);
      updateVU('mid',    s.mid);
      updateVU('treble', s.treble);
      updateVU('volume', s.volume);
    }

    // Video scrubber
    if (video.sourceType === 'file' && video.isPlaying) {
      const pos = video.currentTime;
      const dur = video.duration;
      updateScrubber('video', pos, dur);
    }

    // Audio scrubber
    if (audio.sourceType === 'file') {
      const pos = audio.currentTime;
      const dur = audio.duration;
      updateScrubber('audio', pos, dur);
    }
  };

  function updateVU(band, value) {
    const fill = document.getElementById(`vu-${band}`);
    const num  = document.getElementById(`vn-${band}`);
    if (fill) fill.style.width = `${Math.round(value * 100)}%`;
    if (num)  num.textContent  = Math.round(value * 100);
  }

  function updateScrubber(type, pos, dur) {
    const pct = dur > 0 ? pos / dur : 0;
    const fill = document.getElementById(`${type}-fill`);
    const head = document.getElementById(`${type}-head`);
    const posEl = document.getElementById(`${type}-pos`);
    const durEl = document.getElementById(`${type}-duration`);
    if (fill) fill.style.width = `${pct * 100}%`;
    if (head) head.style.left  = `${pct * 100}%`;
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
  const micActive      = document.getElementById('mic-active');
  const audioLevels    = document.getElementById('audio-levels-section');
  const audioFilename  = document.getElementById('audio-filename');
  const btnAudioPlay   = document.getElementById('btn-audio-play');

  document.getElementById('btn-audio-file').addEventListener('click', () => {
    inputAudioFile.click();
  });

  inputAudioFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await audio.loadFile(file);
      audioFilename.textContent = file.name;
      audioTransport.style.display = 'block';
      micActive.style.display      = 'none';
      audioLevels.style.display    = 'block';
      dotAudio.classList.remove('inactive');
      labelAudio.textContent = file.name.replace(/\.[^.]+$/, '');
      audio.play();
      btnAudioPlay.textContent = '⏸';
      updateScrubber('audio', 0, audio.duration);
    } catch (err) {
      console.error(err);
    }
    e.target.value = '';
  });

  document.getElementById('btn-audio-mic').addEventListener('click', async () => {
    try {
      await audio.startMic();
      audioTransport.style.display = 'none';
      micActive.style.display      = 'block';
      audioLevels.style.display    = 'block';
      dotAudio.classList.remove('inactive');
      labelAudio.textContent = 'Microphone';
    } catch (err) {
      alert('Microphone access denied.');
    }
  });

  btnAudioPlay.addEventListener('click', () => {
    if (audio.isPlaying) {
      audio.pause();
      btnAudioPlay.textContent = '▶';
    } else {
      audio.play();
      btnAudioPlay.textContent = '⏸';
    }
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
    micActive.style.display   = 'none';
    audioLevels.style.display = 'none';
    dotAudio.classList.add('inactive');
    labelAudio.textContent = 'No audio';
  });

  // Audio scrubber
  const audioSeek = document.getElementById('audio-seek');
  audioSeek.addEventListener('input', () => {
    const pos = parseFloat(audioSeek.value) * audio.duration;
    audio.seekTo(pos);
  });

  // Keep seek range in sync with duration
  audio.onStateChange = state => {
    if (state.duration > 0) audioSeek.max = 1;
    renderer.audioData = audio.smoothed;
  };

  // Audio smoothing slider
  const slAudioSpeed = document.getElementById('sl-audio-speed');
  const valAudioSpeed = document.getElementById('val-audio-speed');
  slAudioSpeed.addEventListener('input', () => {
    const v = parseFloat(slAudioSpeed.value);
    audio.inputSpeed = v;
    valAudioSpeed.textContent = v.toFixed(3);
  });

  // ── Video tab ─────────────────────────────────────────────────
  const inputVideoFile  = document.getElementById('input-video-file');
  const videoTransport  = document.getElementById('video-transport');
  const webcamActive    = document.getElementById('webcam-active');
  const videoLevels     = document.getElementById('video-levels-section');
  const videoMonitorEl  = document.getElementById('video-monitor');
  const videoEl         = document.getElementById('video-el');
  const videoFilename   = document.getElementById('video-filename');
  const btnVideoPlay    = document.getElementById('btn-video-play');

  document.getElementById('btn-video-file').addEventListener('click', () => {
    inputVideoFile.click();
  });

  inputVideoFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.loop = true;
    await videoEl.play();
    videoFilename.textContent    = file.name;
    videoTransport.style.display = 'block';
    videoMonitorEl.style.display = 'block';
    webcamActive.style.display   = 'none';
    dotVideo.classList.remove('inactive');
    labelVideo.textContent = file.name.replace(/\.[^.]+$/, '');
    btnVideoPlay.textContent = '⏸';
    e.target.value = '';
  });

  document.getElementById('btn-video-webcam').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoEl.srcObject = stream;
      videoEl.play();
      videoMonitorEl.style.display = 'block';
      videoTransport.style.display = 'none';
      webcamActive.style.display   = 'block';
      dotVideo.classList.remove('inactive');
      labelVideo.textContent = 'Webcam';
    } catch {
      alert('Camera access denied.');
    }
  });

  btnVideoPlay.addEventListener('click', () => {
    if (videoEl.paused) { videoEl.play(); btnVideoPlay.textContent = '⏸'; }
    else                { videoEl.pause(); btnVideoPlay.textContent = '▶'; }
  });

  document.getElementById('btn-video-stop').addEventListener('click', () => {
    videoEl.pause();
    videoEl.src = '';
    videoEl.srcObject = null;
    videoTransport.style.display = 'none';
    videoMonitorEl.style.display = 'none';
    dotVideo.classList.add('inactive');
    labelVideo.textContent = 'No video';
  });

  document.getElementById('btn-webcam-stop').addEventListener('click', () => {
    if (videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
    }
    videoMonitorEl.style.display = 'none';
    webcamActive.style.display   = 'none';
    dotVideo.classList.add('inactive');
    labelVideo.textContent = 'No video';
  });

  // Video scrubber
  document.getElementById('video-seek').addEventListener('input', e => {
    const pct = parseFloat(e.target.value);
    if (videoEl.duration) videoEl.currentTime = pct * videoEl.duration;
  });

  // ── Record tab ────────────────────────────────────────────────
  const recIdle   = document.getElementById('rec-idle');
  const recActive = document.getElementById('rec-active');
  const recDone   = document.getElementById('rec-done');
  const recTimer  = document.getElementById('rec-timer');
  const recInfo   = document.getElementById('rec-info');
  const slFps     = document.getElementById('sl-fps');
  const valFps    = document.getElementById('val-fps');

  slFps.addEventListener('input', () => {
    valFps.textContent = `${slFps.value} fps`;
  });

  document.getElementById('btn-rec-start').addEventListener('click', () => {
    recorder.start(canvas);
    recIdle.style.display   = 'none';
    recActive.style.display = 'block';
    recDone.style.display   = 'none';
    // Update timer display
    let elapsed = 0;
    recorder._timerInterval = setInterval(() => {
      elapsed++;
      recTimer.textContent = VaelMath.formatTime(elapsed);
    }, 1000);
  });

  document.getElementById('btn-rec-stop').addEventListener('click', () => {
    recorder.stop();
    clearInterval(recorder._timerInterval);
    recActive.style.display = 'none';
    recDone.style.display   = 'block';
    recInfo.textContent     = `Recorded ${recTimer.textContent}`;
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
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (audio.sourceType === 'file') {
          if (audio.isPlaying) { audio.pause(); btnAudioPlay.textContent = '▶'; }
          else                 { audio.play();  btnAudioPlay.textContent = '⏸'; }
        }
        break;
      case 'f':
      case 'F':
        document.body.classList.toggle('performance');
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        break;
    }
  });

  // ── Layers tab (minimal for now) ─────────────────────────────
  document.getElementById('btn-add-layer').addEventListener('click', () => {
    // Placeholder — full layer picker in next session
    alert('Layer picker coming in the next session!\n\nFor now, layers are added via code in App.js.');
  });

  // Hide empty state since we added layers by default
  document.getElementById('layers-empty').style.display = 'none';

  console.log('%cVAEL%c — Light onto Sound — loaded successfully',
    'color:#00d4aa;font-weight:bold;font-size:16px;',
    'color:#7878a0;font-size:12px;'
  );

})();
