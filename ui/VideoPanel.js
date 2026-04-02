/**
 * ui/VideoPanel.js
 * Wires the VIDEO tab.
 *
 * FIXES:
 * - 'vael:library-set-video-source' handler now works: uses entry.file
 *   (now stored in VideoLibrary entries) to call _video.loadFile() properly.
 * - Added "Select from library" button in the video source section.
 * - Added "Select from library" button in the audio source section (dispatches
 *   to AudioPanel via 'vael:library-set-audio-source').
 * - Audio import prompt: asks before replacing active audio from a video file.
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
      // entry has: { id, name, url, file, element, duration }
      if (!entry?.file) {
        Toast.error('Library entry missing file data — try re-uploading');
        return;
      }
      try {
        await _loadVideoFile(entry.file, entry.url);
        Toast.success(`Video source: ${entry.name}`);
      } catch (err) {
        Toast.error('Could not set video source');
        console.error(err);
      }
    });
  }

  // ── Shared file load helper ───────────────────────────────────
  // Used by both the file input handler and the library source handler.

  async function _loadVideoFile(file, prebuiltUrl) {
    const url = prebuiltUrl || URL.createObjectURL(file);

    // Set DOM preview element
    _videoEl.srcObject = null;
    _videoEl.src       = url;
    _videoEl.loop      = true;
    await _videoEl.play().catch(() => {});

    // Load into VideoEngine (creates its own internal element for analysis)
    await _video.loadFile(file);

    // Update UI
    const filenameEl   = document.getElementById('video-filename');
    const transport    = document.getElementById('video-transport');
    const monitorEl    = document.getElementById('video-monitor');
    const webcamActive = document.getElementById('webcam-active');
    const levelsEl     = document.getElementById('video-levels-section');
    const btnPlay      = document.getElementById('btn-video-play');

    if (filenameEl)   filenameEl.textContent     = file.name;
    if (transport)    transport.style.display    = 'block';
    if (monitorEl)    monitorEl.style.display    = 'block';
    if (webcamActive) webcamActive.style.display = 'none';
    if (levelsEl)     levelsEl.style.display     = 'block';
    if (btnPlay)      btnPlay.textContent        = '⏸';

    _statusDot.classList.remove('inactive');
    _statusLabel.textContent = file.name.replace(/\.[^.]+$/, '');
    _loopIn = 0; _loopOut = 1;
    _updateLoopPointUI();

    // Show video metadata once the video element has loaded
    const metaEl = document.getElementById('video-meta');
    if (metaEl && _video.videoElement) {
      const showMeta = () => {
        const el  = _video.videoElement;
        const dur = el.duration || 0;
        const mins = Math.floor(dur / 60);
        const secs = (dur % 60).toFixed(1);
        const w   = el.videoWidth  || 0;
        const h   = el.videoHeight || 0;
        const sizeStr = (() => {
          const kb = file.size / 1024;
          return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb/1024).toFixed(1)} MB`;
        })();
        const rows = [
          `Duration: ${mins}:${secs.padStart(4,'0')}`,
          w && h ? `Resolution: ${w}×${h}` : null,
          `File size: ${sizeStr}`,
        ].filter(Boolean);
        metaEl.innerHTML  = rows.join('&emsp;·&emsp;');
        metaEl.style.display = 'block';
      };
      if (_video.videoElement.readyState >= 1) {
        showMeta();
      } else {
        _video.videoElement.addEventListener('loadedmetadata', showMeta, { once: true });
      }
    }

    // Update any VideoPlayerLayer using the legacy single-video path
    _layers.layers.forEach(l => {
      if (l instanceof VideoPlayerLayer) l.setVideoElement(_video.videoElement);
    });

    // Register in VideoLibrary so it appears in LIBRARY → Videos
    // Only when uploaded fresh (prebuiltUrl means it came from library already)
    if (!prebuiltUrl && window.videoLibrary) {
      window.videoLibrary.add(file).catch(() => {});
      // Persist to IndexedDB for next session
      if (typeof AssetStore !== 'undefined') {
        AssetStore.save('video', file).catch(() => {});
      }
    }

    // Handle audio track
    _handleVideoAudio(file);
  }

  // ── Wire UI ───────────────────────────────────────────────────

  function _wire() {
    const inputFile = document.getElementById('input-video-file');
    const btnPlay   = document.getElementById('btn-video-play');

    // Upload file button
    document.getElementById('btn-video-file')?.addEventListener('click', () => inputFile?.click());

    // "Select from library" button — shows a small picker modal
    document.getElementById('btn-video-library')?.addEventListener('click', () => {
      _showLibraryPicker('video');
    });

    inputFile?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      await _loadVideoFile(file);
      e.target.value = '';
    });

    // Webcam
    document.getElementById('btn-video-webcam')?.addEventListener('click', async () => {
      try {
        await _video.startWebcam();
        const stream = _video.videoElement?.srcObject;
        if (stream) { _videoEl.srcObject = stream; _videoEl.play(); }
        document.getElementById('video-monitor').style.display    = 'block';
        document.getElementById('video-transport').style.display  = 'none';
        document.getElementById('webcam-active').style.display    = 'block';
        document.getElementById('video-levels-section').style.display = 'block';
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
      document.getElementById('video-transport').style.display    = 'none';
      document.getElementById('video-monitor').style.display      = 'none';
      document.getElementById('video-levels-section').style.display = 'none';
      _statusDot.classList.add('inactive');
      _statusLabel.textContent = 'No video';
    });

    document.getElementById('btn-webcam-stop')?.addEventListener('click', () => {
      _video.stop();
      if (_videoEl.srcObject) { _videoEl.srcObject.getTracks().forEach(t => t.stop()); _videoEl.srcObject = null; }
      document.getElementById('video-monitor').style.display      = 'none';
      document.getElementById('webcam-active').style.display      = 'none';
      document.getElementById('video-levels-section').style.display = 'none';
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

  // ── Library picker modal ──────────────────────────────────────

  function _showLibraryPicker(type) {
    document.getElementById('_lib-picker-modal')?.remove();

    // Get entries from the library
    const entries = type === 'video'
      ? (window.videoLibrary?.entries || [])
      : [];   // audio handled differently below

    if (entries.length === 0) {
      Toast.warn(`No ${type} files in library yet — add some in the LIBRARY tab`);
      document.querySelector('[data-tab="library"]')?.click();
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = '_lib-picker-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:1000;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;padding:20px 22px;max-width:380px;width:92%;font-family:var(--font-mono)';

    const title = document.createElement('div');
    title.style.cssText = 'color:var(--accent2);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px';
    title.textContent   = `Select ${type} source from library`;
    dialog.appendChild(title);

    entries.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-dim);border-radius:5px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s';
      row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--accent2)'; });
      row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--border-dim)'; });

      if (type === 'video') {
        const preview = document.createElement('video');
        preview.src = entry.url; preview.muted = true; preview.playsInline = true;
        preview.style.cssText = 'width:60px;height:38px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#000';
        preview.play().catch(() => {});
        row.appendChild(preview);
      } else {
        const icon = document.createElement('div');
        icon.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 10%,var(--bg));border-radius:3px;flex-shrink:0;font-size:18px';
        icon.textContent   = '♪';
        row.appendChild(icon);
      }

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.name}</div>
        <div style="font-size:8px;color:var(--text-dim);margin-top:2px">${VaelMath.formatTime(entry.duration)}</div>
      `;
      row.appendChild(info);

      row.addEventListener('click', async () => {
        overlay.remove();
        window.dispatchEvent(new CustomEvent('vael:library-set-video-source', { detail: entry }));
      });

      dialog.appendChild(row);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'btn';
    cancelBtn.style.cssText = 'width:100%;margin-top:6px;color:var(--text-dim)';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Audio import from video ───────────────────────────────────

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
    if (_audio.sourceType === 'none') { await _importAudio(file); return; }
    _showAudioPrompt(file);
  }

  function _showAudioPrompt(file) {
    document.getElementById('_video-audio-prompt')?.remove();
    const prompt = document.createElement('div');
    prompt.id    = '_video-audio-prompt';
    prompt.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:var(--bg-mid);border:1px solid var(--accent2);border-radius:8px;padding:14px 18px;z-index:1000;font-family:var(--font-mono);font-size:10px;color:var(--text);box-shadow:0 8px 32px rgba(0,0,0,0.6);backdrop-filter:blur(12px);max-width:340px;width:90%';
    prompt.innerHTML = `
      <div style="color:var(--accent2);font-size:9px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Video has audio track</div>
      <div style="color:var(--text-muted);margin-bottom:12px;line-height:1.6">
        Replace current audio with audio from <strong style="color:var(--text)">${file.name}</strong>?
      </div>
      <div style="display:flex;gap:8px">
        <button id="_vap-yes" class="btn accent" style="flex:1;font-size:9px">↺ Replace audio</button>
        <button id="_vap-no"  class="btn"        style="flex:1;font-size:9px">Keep current</button>
      </div>`;
    document.body.appendChild(prompt);
    document.getElementById('_vap-yes').addEventListener('click', async () => { prompt.remove(); await _importAudio(file); });
    document.getElementById('_vap-no').addEventListener('click',  () => { prompt.remove(); Toast.info('Audio unchanged'); });
    setTimeout(() => { document.getElementById('_video-audio-prompt')?.remove(); }, 12000);
  }

  async function _importAudio(file) {
    try {
      await _audio.loadFile(file);
      _audio.loop = true; _audio.play();
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
    if (regionEl) { regionEl.style.left = `${_loopIn*100}%`; regionEl.style.width = `${(_loopOut-_loopIn)*100}%`; }
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
