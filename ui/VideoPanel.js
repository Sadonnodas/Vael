/**
 * ui/VideoPanel.js
 * Wires the VIDEO tab: file load, webcam, transport, loop points.
 *
 * CHANGES:
 * - Listens for 'vael:library-set-video-source' from LibraryPanel so
 *   "Set as video source" in the library works without opening the VIDEO tab.
 * - Audio import prompt: when a video with audio is loaded and audio is
 *   already active, asks before replacing. Silent import if nothing loaded.
 */

const VideoPanel = (() => {

  let _video       = null;
  let _audio       = null;
  let _layers      = null;
  let _statusDot   = null;
  let _statusLabel = null;
  let _videoEl     = null;

  let _loopIn  = 0;
  let _loopOut = 1;

  function init(videoEngine, audioEngine, layerStack, statusDot, statusLabel) {
    _video       = videoEngine;
    _audio       = audioEngine;
    _layers      = layerStack;
    _statusDot   = statusDot;
    _statusLabel = statusLabel;
    _videoEl     = document.getElementById('video-el');
    _wire();

    // Listen for "Set as video source" from LibraryPanel
    window.addEventListener('vael:library-set-video-source', async e => {
      const entry = e.detail;
      if (!entry?.url || !entry?.file) return;
      try {
        // Create a File-like object from the library entry
        _videoEl.src  = entry.url;
        _videoEl.loop = true;
        await _videoEl.play();
        await _video.loadFile(entry.file);

        const filenameEl   = document.getElementById('video-filename');
        const transport    = document.getElementById('video-transport');
        const monitorEl    = document.getElementById('video-monitor');
        const webcamActive = document.getElementById('webcam-active');
        const levelsEl     = document.getElementById('video-levels-section');
        const btnPlay      = document.getElementById('btn-video-play');

        if (filenameEl)   filenameEl.textContent     = entry.name;
        if (transport)    transport.style.display    = 'block';
        if (monitorEl)    monitorEl.style.display    = 'block';
        if (webcamActive) webcamActive.style.display = 'none';
        if (levelsEl)     levelsEl.style.display     = 'block';
        if (btnPlay)      btnPlay.textContent        = '⏸';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent = entry.name.replace(/\.[^.]+$/, '');
        _loopIn = 0; _loopOut = 1;
        _updateLoopPointUI();

        _layers.layers.forEach(l => {
          if (l instanceof VideoPlayerLayer) l.setVideoElement(_video.videoElement);
        });

        _handleVideoAudio(entry.file);
        Toast.success(`Video source set: ${entry.name}`);
      } catch (err) {
        Toast.error('Could not set video source');
        console.error(err);
      }
    });
  }

  function _wire() {
    const inputFile    = document.getElementById('input-video-file');
    const transport    = document.getElementById('video-transport');
    const webcamActive = document.getElementById('webcam-active');
    const levelsEl     = document.getElementById('video-levels-section');
    const monitorEl    = document.getElementById('video-monitor');
    const filenameEl   = document.getElementById('video-filename');
    const btnPlay      = document.getElementById('btn-video-play');

    document.getElementById('btn-video-file')?.addEventListener('click', () => inputFile?.click());

    inputFile?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      _videoEl.src  = url;
      _videoEl.loop = true;
      await _videoEl.play();
      await _video.loadFile(file);

      filenameEl.textContent     = file.name;
      transport.style.display    = 'block';
      monitorEl.style.display    = 'block';
      webcamActive.style.display = 'none';
      levelsEl.style.display     = 'block';
      _statusDot.classList.remove('inactive');
      _statusLabel.textContent = file.name.replace(/\.[^.]+$/, '');
      btnPlay.textContent = '⏸';
      _loopIn = 0; _loopOut = 1;
      _updateLoopPointUI();

      _layers.layers.forEach(l => {
        if (l instanceof VideoPlayerLayer) l.setVideoElement(_video.videoElement);
      });

      _handleVideoAudio(file);
      e.target.value = '';
    });

    // Webcam
    document.getElementById('btn-video-webcam')?.addEventListener('click', async () => {
      try {
        await _video.startWebcam();
        const stream = _video.videoElement?.srcObject;
        if (stream) { _videoEl.srcObject = stream; _videoEl.play(); }
        monitorEl.style.display    = 'block';
        transport.style.display    = 'none';
        webcamActive.style.display = 'block';
        levelsEl.style.display     = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent = 'Webcam';
        _layers.layers.forEach(l => {
          if (l instanceof VideoPlayerLayer) l.setVideoElement(_video.videoElement);
        });
        Toast.success('Webcam active');
      } catch { Toast.error('Camera access denied'); }
    });

    // Play/pause
    btnPlay?.addEventListener('click', () => {
      if (_videoEl.paused) { _videoEl.play(); _video.play(); btnPlay.textContent = '⏸'; }
      else                 { _videoEl.pause(); _video.pause(); btnPlay.textContent = '▶'; }
    });

    // Stop
    document.getElementById('btn-video-stop')?.addEventListener('click', () => {
      _videoEl.pause(); _videoEl.src = ''; _videoEl.srcObject = null;
      _video.stop();
      transport.style.display  = 'none';
      monitorEl.style.display  = 'none';
      levelsEl.style.display   = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No video';
    });

    document.getElementById('btn-webcam-stop')?.addEventListener('click', () => {
      _video.stop();
      if (_videoEl.srcObject) { _videoEl.srcObject.getTracks().forEach(t => t.stop()); _videoEl.srcObject = null; }
      monitorEl.style.display    = 'none';
      webcamActive.style.display = 'none';
      levelsEl.style.display     = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent   = 'No video';
    });

    // Scrubber
    document.getElementById('video-seek')?.addEventListener('input', e => {
      const pct = parseFloat(e.target.value);
      if (_videoEl.duration) _videoEl.currentTime = pct * _videoEl.duration;
      _video.seekTo(pct * _video.duration);
    });

    // Loop points
    document.getElementById('btn-video-set-in')?.addEventListener('click', () => {
      _loopIn = _videoEl.duration > 0 ? _videoEl.currentTime / _videoEl.duration : 0;
      _updateLoopPointUI();
      Toast.info(`Video in: ${VaelMath.formatTime(_videoEl.currentTime)}`);
    });
    document.getElementById('btn-video-set-out')?.addEventListener('click', () => {
      _loopOut = _videoEl.duration > 0 ? _videoEl.currentTime / _videoEl.duration : 1;
      _updateLoopPointUI();
      Toast.info(`Video out: ${VaelMath.formatTime(_videoEl.currentTime)}`);
    });
    document.getElementById('btn-video-clear-loop')?.addEventListener('click', () => {
      _loopIn = 0; _loopOut = 1;
      _updateLoopPointUI();
      Toast.info('Video loop points cleared');
    });
  }

  // ── Audio import prompt ───────────────────────────────────────

  async function _handleVideoAudio(file) {
    let hasAudio = false;
    try {
      const ctx         = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      await ctx.decodeAudioData(arrayBuffer);
      ctx.close();
      hasAudio = true;
    } catch { hasAudio = false; }

    if (!hasAudio) { Toast.info('No audio track in this video'); return; }

    // No audio loaded — import silently
    if (_audio.sourceType === 'none') {
      await _importAudio(file);
      return;
    }

    // Audio already active — ask
    _showAudioPrompt(file);
  }

  function _showAudioPrompt(file) {
    document.getElementById('_video-audio-prompt')?.remove();

    const prompt = document.createElement('div');
    prompt.id    = '_video-audio-prompt';
    prompt.style.cssText = `
      position:fixed;bottom:60px;left:50%;transform:translateX(-50%);
      background:var(--bg-mid);border:1px solid var(--accent2);border-radius:8px;
      padding:14px 18px;z-index:1000;font-family:var(--font-mono);font-size:10px;
      color:var(--text);box-shadow:0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter:blur(12px);max-width:340px;width:90%;
    `;
    prompt.innerHTML = `
      <div style="color:var(--accent2);font-size:9px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">
        Video has audio track
      </div>
      <div style="color:var(--text-muted);margin-bottom:12px;line-height:1.6">
        Replace current audio with audio from
        <strong style="color:var(--text)">${file.name}</strong>?
      </div>
      <div style="display:flex;gap:8px">
        <button id="_vap-yes" class="btn accent" style="flex:1;font-size:9px">↺ Replace audio</button>
        <button id="_vap-no"  class="btn"        style="flex:1;font-size:9px">Keep current</button>
      </div>
    `;
    document.body.appendChild(prompt);

    document.getElementById('_vap-yes').addEventListener('click', async () => {
      prompt.remove();
      await _importAudio(file);
    });
    document.getElementById('_vap-no').addEventListener('click', () => {
      prompt.remove();
      Toast.info('Audio unchanged');
    });
    setTimeout(() => { document.getElementById('_video-audio-prompt')?.remove(); }, 12000);
  }

  async function _importAudio(file) {
    try {
      await _audio.loadFile(file);
      _audio.loop = true;
      _audio.play();
      const fnEl = document.getElementById('audio-filename');
      const tr   = document.getElementById('audio-transport');
      const lv   = document.getElementById('audio-levels-section');
      const bp   = document.getElementById('btn-audio-play');
      if (fnEl) fnEl.textContent = file.name + ' (video)';
      if (tr)   tr.style.display = 'block';
      if (lv)   lv.style.display = 'block';
      if (bp)   bp.textContent   = '⏸';
      Toast.success('Audio imported from video');
    } catch { Toast.error('Could not import audio from video'); }
  }

  // ── Tick ─────────────────────────────────────────────────────

  function _updateLoopPointUI() {
    const dur      = _videoEl?.duration || 0;
    const inEl     = document.getElementById('video-loop-in');
    const outEl    = document.getElementById('video-loop-out');
    const regionEl = document.getElementById('video-loop-region');
    if (inEl)     inEl.textContent  = VaelMath.formatTime(_loopIn  * dur);
    if (outEl)    outEl.textContent = VaelMath.formatTime(_loopOut * dur);
    if (regionEl) {
      regionEl.style.left  = `${_loopIn  * 100}%`;
      regionEl.style.width = `${(_loopOut - _loopIn) * 100}%`;
    }
  }

  function tick() {
    if (_video.sourceType !== 'file' || !_videoEl) return;
    const pos = _videoEl.currentTime;
    const dur = _videoEl.duration || 0;
    const pct = dur > 0 ? pos / dur : 0;
    const fill  = document.getElementById('video-fill');
    const head  = document.getElementById('video-head');
    const posEl = document.getElementById('video-pos');
    const durEl = document.getElementById('video-duration');
    if (fill)  fill.style.width  = `${pct * 100}%`;
    if (head)  head.style.left   = `${pct * 100}%`;
    if (posEl) posEl.textContent = VaelMath.formatTime(pos);
    if (durEl) durEl.textContent = VaelMath.formatTime(dur);
    if (!_videoEl.paused && dur > 0 && _loopOut < 1) {
      if (pos >= _loopOut * dur) _videoEl.currentTime = _loopIn * dur;
    }
    if (_video.smoothed.isActive) {
      _updateVU('bright', _video.smoothed.brightness);
      _updateVU('motion', _video.smoothed.motion);
      _updateVU('edges',  _video.smoothed.edgeDensity);
    }
  }

  function _updateVU(id, value) {
    const fill = document.getElementById(`vu-${id}`);
    const num  = document.getElementById(`vn-${id}`);
    if (fill) fill.style.width = `${Math.round(value * 100)}%`;
    if (num)  num.textContent  = Math.round(value * 100);
  }

  return { init, tick };

})();
