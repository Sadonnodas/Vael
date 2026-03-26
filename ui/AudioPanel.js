/**
 * ui/AudioPanel.js
 * Wires the AUDIO tab: file load, mic, transport, loop, loop points.
 */

const AudioPanel = (() => {

  let _audio      = null;
  let _statusDot  = null;
  let _statusLabel = null;

  // Loop point state (0–1 normalised)
  let _loopIn  = 0;
  let _loopOut = 1;

  function init(audioEngine, statusDot, statusLabel) {
    _audio       = audioEngine;
    _statusDot   = statusDot;
    _statusLabel = statusLabel;
    _wire();
  }

  function _wire() {
    const inputFile    = document.getElementById('input-audio-file');
    const transport    = document.getElementById('audio-transport');
    const micActiveEl  = document.getElementById('mic-active');
    const levelsEl     = document.getElementById('audio-levels-section');
    const filenameEl   = document.getElementById('audio-filename');
    const btnPlay      = document.getElementById('btn-audio-play');

    // File upload
    document.getElementById('btn-audio-file')?.addEventListener('click', () => inputFile?.click());

    inputFile?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await _audio.loadFile(file);
        filenameEl.textContent   = file.name;
        transport.style.display  = 'block';
        micActiveEl.style.display = 'none';
        levelsEl.style.display   = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent = file.name.replace(/\.[^.]+$/, '');
        _loopIn = 0; _loopOut = 1;
        _updateLoopPointUI();
        _audio.play();
        btnPlay.textContent = '⏸';
        Toast.success(`Loaded: ${file.name}`);
      } catch (err) {
        Toast.error('Could not load audio file');
      }
      e.target.value = '';
    });

    // Mic
    document.getElementById('btn-audio-mic')?.addEventListener('click', async () => {
      try {
        await _audio.startMic();
        transport.style.display   = 'none';
        micActiveEl.style.display = 'block';
        levelsEl.style.display    = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent  = 'Microphone';
        Toast.success('Microphone active');
      } catch { Toast.error('Microphone access denied'); }
    });

    // System audio (Spotify, Cubase, YouTube etc via getDisplayMedia)
    document.getElementById('btn-audio-system')?.addEventListener('click', async () => {
      try {
        Toast.info('Select a tab or window — check "Share tab audio" in the browser prompt');
        await _audio.startSystemAudio();
        transport.style.display   = 'none';
        micActiveEl.style.display = 'block';
        levelsEl.style.display    = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent  = 'System audio';
        document.getElementById('mic-active-label')?.textContent && (
          document.getElementById('mic-active-label').textContent = '● System audio active'
        );
        Toast.success('System audio captured — Vael is now listening to your app');
      } catch (e) {
        Toast.error(e.message || 'System audio capture failed');
      }
    });

    // Play/pause
    btnPlay?.addEventListener('click', () => {
      if (_audio.isPlaying) { _audio.pause(); btnPlay.textContent = '▶'; }
      else                  { _audio.play();  btnPlay.textContent = '⏸'; }
    });

    // Stop
    document.getElementById('btn-audio-stop')?.addEventListener('click', () => {
      _audio.stop();
      transport.style.display = 'none';
      levelsEl.style.display  = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No audio';
      btnPlay.textContent = '▶';
    });

    // Mic stop
    document.getElementById('btn-mic-stop')?.addEventListener('click', () => {
      _audio.stop();
      micActiveEl.style.display = 'none';
      levelsEl.style.display    = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No audio';
    });

    // Loop toggle
    document.getElementById('btn-audio-loop')?.addEventListener('click', e => {
      _audio.loop = !_audio.loop;
      e.target.textContent   = `⟳ Loop: ${_audio.loop ? 'On' : 'Off'}`;
      e.target.style.color   = _audio.loop ? 'var(--accent)' : '';
      e.target.style.borderColor = _audio.loop ? 'var(--accent)' : '';
      if (_audio.isPlaying) {
        const pos = _audio.currentTime;
        _audio.pause(); _audio.seekTo(pos); _audio.play();
      }
      Toast.info(`Loop ${_audio.loop ? 'on' : 'off'}`);
    });

    // Scrubber seek
    document.getElementById('audio-seek')?.addEventListener('input', e => {
      const pct = parseFloat(e.target.value);
      _audio.seekTo(pct * _audio.duration);
    });

    // Smoothing speed
    const slSpeed  = document.getElementById('sl-audio-speed');
    const valSpeed = document.getElementById('val-audio-speed');
    slSpeed?.addEventListener('input', () => {
      const v = parseFloat(slSpeed.value);
      _audio.inputSpeed = v;
      valSpeed.textContent = v.toFixed(3);
    });

    // Loop points
    document.getElementById('btn-audio-set-in')?.addEventListener('click', () => {
      _loopIn = _audio.duration > 0 ? _audio.currentTime / _audio.duration : 0;
      _audio.loopStart = _audio.currentTime;
      _updateLoopPointUI();
      Toast.info(`In point: ${VaelMath.formatTime(_audio.currentTime)}`);
    });

    document.getElementById('btn-audio-set-out')?.addEventListener('click', () => {
      _loopOut = _audio.duration > 0 ? _audio.currentTime / _audio.duration : 1;
      _audio.loopEnd = _audio.currentTime;
      _updateLoopPointUI();
      Toast.info(`Out point: ${VaelMath.formatTime(_audio.currentTime)}`);
    });

    document.getElementById('btn-audio-clear-loop')?.addEventListener('click', () => {
      _loopIn = 0; _loopOut = 1;
      _audio.loopStart = 0;
      _audio.loopEnd   = _audio.duration;
      _updateLoopPointUI();
      Toast.info('Loop points cleared');
    });
  }

  function _updateLoopPointUI() {
    const inEl  = document.getElementById('audio-loop-in');
    const outEl = document.getElementById('audio-loop-out');
    const regionEl = document.getElementById('audio-loop-region');
    if (inEl)  inEl.textContent  = VaelMath.formatTime((_loopIn  || 0) * (_audio.duration || 0));
    if (outEl) outEl.textContent = VaelMath.formatTime((_loopOut || 1) * (_audio.duration || 0));
    if (regionEl) {
      regionEl.style.left  = `${_loopIn  * 100}%`;
      regionEl.style.width = `${(_loopOut - _loopIn) * 100}%`;
    }
  }

  // Called every frame from render loop to update scrubber position
  function tick(audioData) {
    if (_audio.sourceType !== 'file') return;

    const pos = _audio.currentTime;
    const dur = _audio.duration;
    const pct = dur > 0 ? pos / dur : 0;

    const fill = document.getElementById('audio-fill');
    const head = document.getElementById('audio-head');
    const posEl = document.getElementById('audio-pos');
    const durEl = document.getElementById('audio-duration');

    if (fill) fill.style.width = `${pct * 100}%`;
    if (head) head.style.left  = `${pct * 100}%`;
    if (posEl) posEl.textContent = VaelMath.formatTime(pos);
    if (durEl) durEl.textContent = VaelMath.formatTime(dur);

    // Handle loop points — seek back to in-point when we pass out-point
    if (_audio.loop && _audio.isPlaying && dur > 0 && _loopOut < 1) {
      if (pos >= _loopOut * dur) {
        _audio.seekTo(_loopIn * dur);
      }
    }

    // Update VU meters
    if (audioData?.isActive) {
      _updateVU('bass',   audioData.bass);
      _updateVU('mid',    audioData.mid);
      _updateVU('treble', audioData.treble);
      _updateVU('volume', audioData.volume);
    }
  }

  function _updateVU(band, value) {
    const fill = document.getElementById(`vu-${band}`);
    const num  = document.getElementById(`vn-${band}`);
    if (fill) fill.style.width = `${Math.round(value * 100)}%`;
    if (num)  num.textContent  = Math.round(value * 100);
  }

  return { init, tick };

})();
