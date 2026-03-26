/**
 * ui/RecordPanel.js
 * Wires the REC tab: manual record, quick-record workflow, resolution.
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
      _recorder.start(_canvas, parseInt(slFps?.value || 60));
      _recIdle.style.display   = 'none';
      _recActive.style.display = 'block';
      _recDone.style.display   = 'none';
      _recTimer.textContent    = '0:00';
      _recorder._uiTimer = setInterval(() => {
        _recTimer.textContent = VaelMath.formatTime(_recorder.duration);
      }, 500);
      Toast.info('Recording started');
    });

    // Manual stop
    document.getElementById('btn-rec-stop')?.addEventListener('click', () => {
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
      _recDone.style.display  = 'none';
      _recIdle.style.display  = 'block';
      _recTimer.textContent   = '0:00';
    });

    // Quick record
    document.getElementById('btn-rec-quick')?.addEventListener('click', () => {
      if (_audio.sourceType !== 'file') {
        Toast.warn('Load an audio file first (AUDIO tab)');
        return;
      }
      _applyResolution();
      _audio.seekTo(0);
      _recorder.start(_canvas, parseInt(slFps?.value || 60));
      _recIdle.style.display   = 'none';
      _recActive.style.display = 'block';
      _recDone.style.display   = 'none';
      _recTimer.textContent    = '0:00';
      _recorder._uiTimer = setInterval(() => {
        _recTimer.textContent = VaelMath.formatTime(_recorder.duration);
      }, 500);
      _audio.play();
      document.getElementById('btn-audio-play').textContent = '⏸';

      const quickStatus = document.getElementById('rec-quick-status');
      if (quickStatus) { quickStatus.style.display = 'block'; quickStatus.textContent = 'Recording… stops when song ends'; }

      // Switch to REC tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="record"]')?.classList.add('active');
      document.getElementById('tab-record')?.classList.add('active');

      Toast.info('Quick record started');
    });

    // Resolution dropdown
    document.getElementById('sl-res')?.addEventListener('change', e => {
      document.getElementById('val-res').textContent = e.target.value === 'native' ? 'Native' : e.target.value;
    });
  }

  function _applyResolution() {
    const res = document.getElementById('sl-res')?.value;
    if (!res || res === 'native') return;
    const [w, h] = res.split('x').map(Number);
    if (w && h && _renderer) {
      _canvas.style.width  = `${w}px`;
      _canvas.style.height = `${h}px`;
      _renderer._resize();
    }
  }

  function _stopRecording() {
    _recorder.stop();
    clearInterval(_recorder._uiTimer);
    setTimeout(() => {
      _recActive.style.display = 'none';
      _recDone.style.display   = 'block';
      _recInfo.textContent     = `${_recTimer.textContent} recorded — ready to download`;
      const qs = document.getElementById('rec-quick-status');
      if (qs) qs.style.display = 'none';
      Toast.success(`Recording ready — ${_recTimer.textContent}`);
    }, 200);
  }

  // Called by audio.onStateChange when song ends
  function onAudioEnd() {
    if (_recorder.state !== 'recording') return;
    setTimeout(() => _stopRecording(), 600);
  }

  return { init, onAudioEnd };

})();
