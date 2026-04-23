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

    // Select from library
    document.getElementById('btn-audio-library')?.addEventListener('click', () => {
      const lib = window.videoLibrary;  // VideoLibrary stores video files, audio uses LibraryPanel's _audioFiles
      // Dispatch to LibraryPanel to open the audio section
      window.dispatchEvent(new CustomEvent('vael:open-library-audio'));
      document.querySelector('[data-tab="library"]')?.click();
    });

    // Listen for audio source set from library
    window.addEventListener('vael:library-set-audio-source', async e => {
      const entry = e.detail; // { name, file, url, duration }
      if (!entry?.file) return;
      try {
        await _audio.loadFile(entry.file);
        filenameEl.textContent   = entry.name;
        transport.style.display  = 'block';
        micActiveEl.style.display = 'none';
        levelsEl.style.display   = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent = entry.name.replace(/\.[^.]+$/, '');
        _loopIn = 0; _loopOut = 1;
        _updateLoopPointUI();
        _buildNewMeters();
        _showAudioMeta(null);
        Toast.success(`Audio loaded: ${entry.name} — press Play to start`);
      } catch { Toast.error('Could not load audio from library'); }
    });

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
        _showAudioMeta(file);
        Toast.success(`Loaded: ${file.name}`);
        // Also register in the library so it appears in LIBRARY → Audio
        if (typeof LibraryPanel !== 'undefined' && LibraryPanel.addAudioFile) {
          LibraryPanel.addAudioFile(file).catch(() => {});
        }
      } catch (err) {
        Toast.error('Could not load audio file');
      }
      e.target.value = '';
    });

    // Mic — with device picker
    const micBtn        = document.getElementById('btn-audio-mic');
    const micDeviceRow  = document.getElementById('audio-mic-device-row');
    const micDeviceSel  = document.getElementById('audio-mic-device');

    // Populate device list when the row becomes visible
    async function _populateMicDevices() {
      if (!micDeviceSel) return;
      const devices = await _audio.getInputDevices();
      micDeviceSel.innerHTML = '';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value       = d.deviceId;
        opt.textContent = d.label;
        micDeviceSel.appendChild(opt);
      });
      if (!devices.length) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = 'No devices found';
        micDeviceSel.appendChild(opt);
      }
    }

    micBtn?.addEventListener('click', async () => {
      if (micDeviceRow) {
        micDeviceRow.style.display = micDeviceRow.style.display === 'none' ? 'flex' : 'none';
        if (micDeviceRow.style.display === 'flex') await _populateMicDevices();
        return;
      }
      // Fallback if no device row in HTML
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

    document.getElementById('btn-audio-mic-start')?.addEventListener('click', async () => {
      const deviceId = micDeviceSel?.value || null;
      const label    = micDeviceSel?.options[micDeviceSel.selectedIndex]?.text || 'Microphone';
      try {
        await _audio.startMic(deviceId);
        if (micDeviceRow) micDeviceRow.style.display = 'none';
        transport.style.display   = 'none';
        micActiveEl.style.display = 'block';
        levelsEl.style.display    = 'block';
        _statusDot.classList.remove('inactive');
        _statusLabel.textContent  = label;
        if (document.getElementById('mic-active-label')) {
          document.getElementById('mic-active-label').textContent = `● ${label} active`;
        }
        Toast.success(`Input active: ${label}`);
      } catch { Toast.error('Could not open audio input — check permissions'); }
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

    // Playback rate (pitch + speed together — Web Audio limitation)
    const slRate  = document.getElementById('sl-playback-rate');
    const valRate = document.getElementById('val-playback-rate');
    slRate?.addEventListener('input', () => {
      const v = parseFloat(slRate.value);
      _audio.setPlaybackRate(v);
      valRate.textContent = v.toFixed(2) + '×';
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

  // ── Spectrum canvas ─────────────────────────────────────────
  let _specCanvas = null;
  let _specCtx    = null;
  let _peakHold   = null;   // per-bin peak hold values

  function _ensureSpectrumCanvas() {
    if (_specCanvas) return;
    const levelsEl = document.getElementById('audio-levels-section');
    if (!levelsEl) return;

    // Insert spectrum canvas above the VU meters
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;border-radius:4px;overflow:hidden;background:#050508';
    _specCanvas = document.createElement('canvas');
    _specCanvas.height = 80;
    _specCanvas.style.cssText = 'width:100%;height:80px;display:block';
    wrap.appendChild(_specCanvas);

    // Insert before the first child of levelsEl
    levelsEl.insertBefore(wrap, levelsEl.firstChild);
    _specCtx = _specCanvas.getContext('2d');
  }

  function _drawSpectrum(fftData, audioData) {
    if (!_specCanvas || !_specCtx || !fftData) return;

    const W = _specCanvas.offsetWidth || 240;
    if (_specCanvas.width !== W) _specCanvas.width = W;
    const H = 80;
    const N = fftData.length;
    const ctx = _specCtx;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, W, H);

    if (!_peakHold || _peakHold.length !== W) {
      _peakHold = new Float32Array(W);
    }

    // Draw frequency bars
    const barW = Math.max(1, W / 128);
    const bins  = 128;
    const step  = Math.floor(N / bins);

    for (let i = 0; i < bins; i++) {
      const binVal = fftData[i * step] / 255;
      const x = i * (W / bins);
      const h = binVal * H * 0.9;

      // Colour by frequency range
      let hue;
      if (i < bins * 0.15)      hue = 0;    // bass — red
      else if (i < bins * 0.4)  hue = 45;   // mid — amber
      else                      hue = 160;  // treble — teal

      const brightness = 0.35 + binVal * 0.45;
      ctx.fillStyle = `hsl(${hue},70%,${Math.round(brightness * 100)}%)`;
      ctx.fillRect(x, H - h, W / bins - 0.5, h);

      // Peak hold
      const px = i;
      if (binVal > (_peakHold[px] || 0)) {
        _peakHold[px] = binVal;
      } else {
        _peakHold[px] = Math.max(0, (_peakHold[px] || 0) - 0.008);
      }
      const peakY = H - _peakHold[px] * H * 0.9 - 1;
      ctx.fillStyle = `hsl(${hue},90%,75%)`;
      ctx.fillRect(x, peakY, W / bins - 0.5, 1.5);
    }

    // Overlay beat band markers
    if (audioData?.isActive) {
      // Kick region marker
      const kickX = W * 0.15;
      ctx.strokeStyle = audioData.isKick ? 'rgba(255,71,87,0.9)' : 'rgba(255,71,87,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(kickX, 0); ctx.lineTo(kickX, H); ctx.stroke();

      // Snare region marker
      const snareX = W * 0.4;
      ctx.strokeStyle = audioData.isSnare ? 'rgba(255,165,2,0.9)' : 'rgba(255,165,2,0.15)';
      ctx.beginPath(); ctx.moveTo(snareX, 0); ctx.lineTo(snareX, H); ctx.stroke();

      // Hihat region marker
      const hihatX = W * 0.75;
      ctx.strokeStyle = audioData.isHihat ? 'rgba(46,213,115,0.9)' : 'rgba(46,213,115,0.15)';
      ctx.beginPath(); ctx.moveTo(hihatX, 0); ctx.lineTo(hihatX, H); ctx.stroke();
      ctx.setLineDash([]);

      // Centroid dot
      const centX = (audioData.spectralCentroid || 0) * W;
      ctx.fillStyle = 'rgba(84,160,255,0.8)';
      ctx.beginPath();
      ctx.arc(centX, 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('KICK', 2, H - 2);
    ctx.textAlign = 'center';
    ctx.fillText('MID', W * 0.27, H - 2);
    ctx.fillText('TREBLE', W * 0.6, H - 2);
    ctx.textAlign = 'right';
    ctx.fillText('CENTROID →', W - 2, 10);
  }

  // Called every frame from render loop to update scrubber position
  function tick(audioData) {
    // Always update spectrum (works for mic, system audio, and file)
    _ensureSpectrumCanvas();
    if (audioData?.isActive && _audio._dataArray) {
      _drawSpectrum(_audio._dataArray, audioData);
    }

    if (_audio.sourceType !== 'file') {
      // Still update new VU meters for non-file sources
      if (audioData?.isActive) _updateNewVUs(audioData);
      return;
    }

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

    // Handle loop points
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
      _updateNewVUs(audioData);
    }
  }

  function _updateVU(band, value) {
    const fill = document.getElementById(`vu-${band}`);
    const num  = document.getElementById(`vn-${band}`);
    if (fill) fill.style.width = `${Math.round(value * 100)}%`;
    if (num)  num.textContent  = Math.round(value * 100);
  }

  function _updateNewVUs(ad) {
    // New signal meters injected into audio-levels-section by _buildNewMeters()
    const pairs = [
      ['rms', ad.rms], ['centroid', ad.spectralCentroid],
      ['flux', ad.spectralFlux], ['kick', ad.kickEnergy],
      ['snare', ad.snareEnergy], ['hihat', ad.hihatEnergy],
    ];
    pairs.forEach(([id, val]) => {
      const fill = document.getElementById(`vu-new-${id}`);
      if (fill) fill.style.width = `${Math.min(100, Math.round((val || 0) * 100))}%`;
    });
  }

  function _buildNewMeters() {
    const levelsEl = document.getElementById('audio-levels-section');
    if (!levelsEl || levelsEl.querySelector('#new-meters')) return;

    const wrap = document.createElement('div');
    wrap.id = 'new-meters';
    wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border-dim)';

    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px';
    label.textContent = 'Spectral signals';
    wrap.appendChild(label);

    const meters = [
      ['rms',     'RMS',       '#ff9f43'],
      ['centroid','Centroid',  '#54a0ff'],
      ['flux',    'Flux',      '#ff6348'],
      ['kick',    'Kick',      '#ff4757'],
      ['snare',   'Snare',     '#ffa502'],
      ['hihat',   'Hi-hat',    '#2ed573'],
    ];

    meters.forEach(([id, lbl, color]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px';
      row.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
                     min-width:52px;text-align:right">${lbl}</span>
        <div style="flex:1;height:5px;background:var(--bg);border-radius:2px;overflow:hidden">
          <div id="vu-new-${id}" style="height:100%;width:0%;background:${color};
               border-radius:2px;transition:width 0.04s linear"></div>
        </div>
      `;
      wrap.appendChild(row);
    });

    levelsEl.appendChild(wrap);
  }

  function _showAudioMeta(file) {
    const metaEl = document.getElementById('audio-meta');
    if (!metaEl) return;
    const buf = _audio._buffer;
    if (!buf) { metaEl.style.display = 'none'; return; }

    const dur     = buf.duration;
    const mins    = Math.floor(dur / 60);
    const secs    = (dur % 60).toFixed(1);
    const ch      = buf.numberOfChannels;
    const sr      = buf.sampleRate;
    const sizeStr = file ? (() => {
      const kb = file.size / 1024;
      return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb/1024).toFixed(1)} MB`;
    })() : null;

    const rows = [
      `Duration: ${mins}:${secs.padStart(4,'0')}`,
      `Sample rate: ${(sr/1000).toFixed(1)} kHz`,
      `Channels: ${ch === 1 ? 'Mono' : ch === 2 ? 'Stereo' : ch + 'ch'}`,
    ];
    if (sizeStr) rows.push(`File size: ${sizeStr}`);

    metaEl.innerHTML = rows.join('&emsp;·&emsp;');
    metaEl.style.display = 'block';
  }

  return { init, tick };

})();
