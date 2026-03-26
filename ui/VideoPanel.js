/**
 * ui/VideoPanel.js
 * Wires the VIDEO tab: file load, webcam, transport, loop points.
 */

const VideoPanel = (() => {

  let _video      = null;
  let _audio      = null;
  let _layers     = null;
  let _statusDot  = null;
  let _statusLabel = null;
  let _videoEl    = null;

  // Loop points (normalised 0–1)
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
  }

  function _wire() {
    const inputFile    = document.getElementById('input-video-file');
    const transport    = document.getElementById('video-transport');
    const webcamActive = document.getElementById('webcam-active');
    const levelsEl     = document.getElementById('video-levels-section');
    const monitorEl    = document.getElementById('video-monitor');
    const filenameEl   = document.getElementById('video-filename');
    const btnPlay      = document.getElementById('btn-video-play');

    // File upload
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

      // Update VideoPlayerLayer instances
      _layers.layers.forEach(l => {
        if (l instanceof VideoPlayerLayer) l.setVideoElement(_video.videoElement);
      });

      // Extract audio from video
      try {
        await _audio.loadFile(file);
        _audio.loop = true;
        _audio.play();
        document.getElementById('btn-audio-play').textContent = '⏸';
        document.getElementById('audio-filename').textContent = file.name + ' (video)';
        document.getElementById('audio-transport').style.display = 'block';
        document.getElementById('audio-levels-section').style.display = 'block';
        Toast.success('Video + audio loaded');
      } catch { Toast.info('No audio track in video'); }

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
      transport.style.display    = 'none';
      monitorEl.style.display    = 'none';
      levelsEl.style.display     = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No video';
    });

    // Webcam stop
    document.getElementById('btn-webcam-stop')?.addEventListener('click', () => {
      _video.stop();
      if (_videoEl.srcObject) { _videoEl.srcObject.getTracks().forEach(t => t.stop()); _videoEl.srcObject = null; }
      monitorEl.style.display    = 'none';
      webcamActive.style.display = 'none';
      levelsEl.style.display     = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No video';
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

  function _updateLoopPointUI() {
    const dur   = _videoEl?.duration || 0;
    const inEl  = document.getElementById('video-loop-in');
    const outEl = document.getElementById('video-loop-out');
    const regionEl = document.getElementById('video-loop-region');
    if (inEl)  inEl.textContent  = VaelMath.formatTime(_loopIn  * dur);
    if (outEl) outEl.textContent = VaelMath.formatTime(_loopOut * dur);
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

    const fill = document.getElementById('video-fill');
    const head = document.getElementById('video-head');
    const posEl = document.getElementById('video-pos');
    const durEl = document.getElementById('video-duration');

    if (fill) fill.style.width = `${pct * 100}%`;
    if (head) head.style.left  = `${pct * 100}%`;
    if (posEl) posEl.textContent = VaelMath.formatTime(pos);
    if (durEl) durEl.textContent = VaelMath.formatTime(dur);

    // Loop point enforcement
    if (!_videoEl.paused && dur > 0 && _loopOut < 1) {
      if (pos >= _loopOut * dur) {
        _videoEl.currentTime = _loopIn * dur;
      }
    }

    // VU meters
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
