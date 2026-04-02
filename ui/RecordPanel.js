/**
 * ui/RecordPanel.js
 * Wires the REC tab: manual record, quick-record workflow, resolution.
 *
 * CHANGE: recorder.start() now receives _audio so the Recorder can
 * attach a MediaStreamAudioDestinationNode and record audio + video.
 */

const RecordPanel = (() => {

  let _recorder = null;
  let _audio    = null;
  let _canvas   = null;
  let _renderer = null;

  let _recIdle, _recActive, _recDone, _recTimer, _recInfo;

  function init(recorder, audioEngine, canvas, renderer) {
    _recorder = recorder;
    _audio    = audioEngine;
    _canvas   = canvas;
    _renderer = renderer;

    _recIdle   = document.getElementById('rec-idle');
    _recActive = document.getElementById('rec-active');
    _recDone   = document.getElementById('rec-done');
    _recTimer  = document.getElementById('rec-timer');
    _recInfo   = document.getElementById('rec-info');

    _wire();
  }

  function _wire() {
    const slFps  = document.getElementById('sl-fps');
    const valFps = document.getElementById('val-fps');

    slFps?.addEventListener('input', () => {
      valFps.textContent = `${slFps.value} fps`;
    });

    // Manual start
    document.getElementById('btn-rec-start')?.addEventListener('click', () => {
      _applyResolution();
      _recorder.start(_canvas, parseInt(slFps?.value || 60), _audio);
      _recIdle.style.display   = 'none';
      _recActive.style.display = 'block';
      _recDone.style.display   = 'none';
      _recTimer.textContent    = '0:00';
      _showFloatStop();
      _recorder._uiTimer = setInterval(() => {
        const t = VaelMath.formatTime(_recorder.duration);
        _recTimer.textContent = t;
        const ft = document.getElementById('rec-float-time');
        if (ft) ft.textContent = t;
      }, 500);
      const hasAudio = _audio?.isPlaying;
      Toast.info(hasAudio ? 'Recording started (video + audio)' : 'Recording started (video only)');
    });

    // Manual stop
    document.getElementById('btn-rec-stop')?.addEventListener('click', () => {
      _stopRecording();
    });

    // Floating stop button
    document.getElementById('rec-float-stop')?.addEventListener('click', () => {
      _stopRecording();
    });

    // Download
    document.getElementById('btn-rec-download')?.addEventListener('click', () => {
      _recorder.download('vael-recording.webm');
      Toast.success('Download started');
    });

    // Discard
    document.getElementById('btn-rec-discard')?.addEventListener('click', () => {
      _recorder.reset();
      _recDone.style.display = 'none';
      _recIdle.style.display = 'block';
      _recTimer.textContent  = '0:00';
    });

    // Quick record
    document.getElementById('btn-rec-quick')?.addEventListener('click', () => {
      if (_audio.sourceType !== 'file') {
        Toast.warn('Load an audio file first (AUDIO tab)');
        return;
      }
      _applyResolution();
      _audio.seekTo(0);
      _audio.play();
      document.getElementById('btn-audio-play').textContent = '⏸';

      // Small delay so AudioEngine has time to start playing before we capture
      setTimeout(() => {
        _recorder.start(_canvas, parseInt(slFps?.value || 60), _audio);
        _recIdle.style.display   = 'none';
        _recActive.style.display = 'block';
        _recDone.style.display   = 'none';
        _recTimer.textContent    = '0:00';
        _showFloatStop();
        _recorder._uiTimer = setInterval(() => {
          const t = VaelMath.formatTime(_recorder.duration);
          _recTimer.textContent = t;
          const ft = document.getElementById('rec-float-time');
          if (ft) ft.textContent = t;
        }, 500);

        const quickStatus = document.getElementById('rec-quick-status');
        if (quickStatus) {
          quickStatus.style.display = 'block';
          quickStatus.textContent   = 'Recording video + audio… stops when song ends';
        }

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="record"]')?.classList.add('active');
        document.getElementById('tab-record')?.classList.add('active');

        Toast.info('Quick record started (video + audio)');
      }, 150);
    });

    // Resolution dropdown
    document.getElementById('sl-res')?.addEventListener('change', e => {
      document.getElementById('val-res').textContent =
        e.target.value === 'native' ? 'Native' : e.target.value;
    });
  }

  // Store native canvas dimensions so we can restore after recording
  let _nativeW = 0;
  let _nativeH = 0;
  let _nativeStyleW = '';
  let _nativeStyleH = '';
  let _resolutionOverrideActive = false;

  function _applyResolution() {
    const res = document.getElementById('sl-res')?.value;
    if (!res || res === 'native') return;
    const [w, h] = res.split('x').map(Number);
    if (!w || !h || !_renderer) return;

    // Save current state so we can restore it after recording
    _nativeW       = _canvas.width;
    _nativeH       = _canvas.height;
    _nativeStyleW  = _canvas.style.width;
    _nativeStyleH  = _canvas.style.height;
    _resolutionOverrideActive = true;

    // Set actual canvas pixel dimensions (not just CSS)
    // This is what the WebGL renderer captures, so this is the real output size
    _canvas.width        = w;
    _canvas.height       = h;
    _canvas.style.width  = '100%';   // let CSS scale it visually
    _canvas.style.height = '100%';

    // Tell the renderer about the new size
    _renderer._cssW = w;
    _renderer._cssH = h;
    _renderer._renderer.setSize(w, h, false);

    // Resize all offscreen canvases in the quad pool
    _renderer._quads?.forEach(quad => {
      quad.offscreen.width  = w;
      quad.offscreen.height = h;
      if (quad.texture) quad.texture.needsUpdate = true;
    });

    if (_renderer._postTarget) _renderer._postTarget.setSize(w, h);

    Toast.info(`Output: ${w}×${h}`);
  }

  function _restoreResolution() {
    if (!_resolutionOverrideActive) return;
    _resolutionOverrideActive = false;

    _canvas.width        = _nativeW;
    _canvas.height       = _nativeH;
    _canvas.style.width  = _nativeStyleW;
    _canvas.style.height = _nativeStyleH;

    // Let renderer recalculate from CSS dimensions
    _renderer._resize?.();
  }

  function _showFloatStop() {
    const fb = document.getElementById('rec-float-stop');
    if (fb) { fb.style.display = 'flex'; }
  }

  function _hideFloatStop() {
    const fb = document.getElementById('rec-float-stop');
    if (fb) { fb.style.display = 'none'; }
  }

  function _stopRecording() {
    _recorder.stop();
    clearInterval(_recorder._uiTimer);
    _hideFloatStop();
    setTimeout(() => {
      _recActive.style.display = 'none';
      _recDone.style.display   = 'block';
      _recInfo.textContent     = `${_recTimer.textContent} recorded — ready to download`;
      const qs = document.getElementById('rec-quick-status');
      if (qs) qs.style.display = 'none';
      Toast.success(`Recording ready — ${_recTimer.textContent}`);
      _restoreResolution();
    }, 200);
  }

  function onAudioEnd() {
    if (_recorder.state !== 'recording') return;
    setTimeout(() => _stopRecording(), 600);
  }

  // Called every frame by App.js to keep the audio indicator fresh
  function tick() {
    const indicator = document.getElementById('rec-audio-indicator');
    if (!indicator) return;
    if (_recorder.state === 'recording') {
      indicator.style.display = 'none';
      return;
    }
    // Audio is always captured when the AudioContext exists (even if not playing
    // yet) — the track outputs silence until playback starts.
    const hasAudioCtx = !!_audio?._ctx;
    indicator.style.display = 'flex';
    indicator.style.color   = hasAudioCtx ? 'var(--accent)' : 'var(--text-dim)';
    indicator.textContent   = hasAudioCtx
      ? '🎵 Audio track ready — output will include audio + video'
      : '🔇 No audio loaded — output will be video only (load audio first)';
  }

  return { init, onAudioEnd, tick };

})();
