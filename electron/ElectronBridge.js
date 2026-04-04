/**
 * electron/ElectronBridge.js
 *
 * Loaded by index.html only when running in Electron.
 * Progressively enhances Vael with native capabilities:
 *
 *  - Native file open/save dialogs
 *  - Project save/load to ~/Documents/Vael Projects/
 *  - Output window (canvas → projector via BroadcastChannel)
 *  - Direct Anthropic API calls (no CORS proxy needed)
 *  - Native menu event handlers
 *  - Keyboard shortcut forwarding
 *
 * All enhancements are additive — the browser version is unaffected.
 * Detection: window.electronAPI.isElectron === true
 */

(function () {
  'use strict';

  // Guard — only run inside Electron
  if (!window.electronAPI?.isElectron) return;

  const api = window.electronAPI;

  // ── Output window (projector) ─────────────────────────────────

  let _outputOpen   = false;
  let _outputChannel = null;
  let _sendFrames    = false;

  function openOutputWindow() {
    api.openOutput().then(() => {
      _outputOpen = true;
      _outputChannel = new BroadcastChannel('vael-output');
      _sendFrames    = true;
      Toast.success('Output window opened on external display');

      // Notify Vael UI
      document.dispatchEvent(new CustomEvent('vael:output-opened'));
    });
  }

  function closeOutputWindow() {
    api.closeOutput().then(() => {
      _outputOpen  = false;
      _sendFrames  = false;
      if (_outputChannel) { _outputChannel.close(); _outputChannel = null; }
      document.dispatchEvent(new CustomEvent('vael:output-closed'));
    });
  }

  // Hook into the Renderer's onFrame to broadcast frames
  // We wait for the renderer to be ready before hooking
  function _hookRenderer() {
    const renderer = window._vaelRenderer;
    if (!renderer) { setTimeout(_hookRenderer, 500); return; }

    const origOnFrame = renderer.onFrame;
    renderer.onFrame = (dt, fps) => {
      if (origOnFrame) origOnFrame(dt, fps);

      // Send canvas frame to output window via BroadcastChannel
      if (_sendFrames && _outputChannel && renderer.canvas) {
        try {
          createImageBitmap(renderer.canvas).then(bitmap => {
            _outputChannel.postMessage({ type: 'frame', bitmap }, [bitmap]);
          }).catch(() => {});
        } catch {}
      }
    };
  }
  _hookRenderer();

  // Listen for output window closing (user pressed Escape there)
  api.onOutputClosed(() => {
    _outputOpen = false;
    _sendFrames = false;
    document.dispatchEvent(new CustomEvent('vael:output-closed'));
  });

  // Expose globally
  window._vaelOutput = { open: openOutputWindow, close: closeOutputWindow };

  // Add output button to the UI
  function _addOutputButton() {
    const statusLeft = document.getElementById('status-left');
    if (!statusLeft) { setTimeout(_addOutputButton, 1000); return; }

    const btn = document.createElement('button');
    btn.id = 'btn-output-window';
    btn.style.cssText = `
      background: none; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; color: rgba(255,255,255,0.4);
      font-family: var(--font-mono); font-size: 8px;
      padding: 2px 8px; cursor: pointer; margin-left: 8px;
      transition: all 0.15s;
    `;
    btn.textContent = '⊡ Output';
    btn.title = 'Open canvas output on external display (projector)';

    btn.addEventListener('click', () => {
      if (_outputOpen) {
        closeOutputWindow();
        btn.textContent = '⊡ Output';
        btn.style.color = 'rgba(255,255,255,0.4)';
        btn.style.borderColor = 'rgba(255,255,255,0.12)';
      } else {
        openOutputWindow();
        btn.textContent = '⊡ Live';
        btn.style.color = 'var(--accent)';
        btn.style.borderColor = 'var(--accent)';
      }
    });

    document.addEventListener('vael:output-closed', () => {
      btn.textContent = '⊡ Output';
      btn.style.color = 'rgba(255,255,255,0.4)';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
    });

    statusLeft.appendChild(btn);
  }
  _addOutputButton();

  // ── Native file dialogs ───────────────────────────────────────

  // Override the audio file load to use native dialog
  window.addEventListener('vael:request-audio-file', async () => {
    const result = await api.openFile([
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!result.canceled && result.files?.[0]) {
      const f = result.files[0];
      // Convert base64 back to a File-like object
      const bytes  = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      const blob   = new Blob([bytes], { type: f.mime });
      const file   = new File([blob], f.name, { type: f.mime });
      window.dispatchEvent(new CustomEvent('vael:audio-file-selected', { detail: { file } }));
    }
  });

  // Override recording export to save as native file
  window.addEventListener('vael:export-recording', async (e) => {
    const { blob, suggestedName } = e.detail;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = await api.saveFile(
        suggestedName || 'vael-recording.webm',
        [{ name: 'Video', extensions: ['webm', 'mp4'] }],
        reader.result  // base64 data URL
      );
      if (result.success) Toast.success(`Saved: ${result.filePath}`);
    };
    reader.readAsDataURL(blob);
  });

  // ── Project save/load ─────────────────────────────────────────

  window._vaelNativeProject = {
    save: async (name, data) => {
      const result = await api.saveProject(name, data);
      if (result.success) Toast.success(`Project saved to Documents/Vael Projects/${name}.vael`);
      return result;
    },
    list: () => api.listProjects(),
    load: (filePath) => api.loadProject(filePath),
  };

  // ── Anthropic API (direct, no proxy needed) ───────────────────

  window._vaelAnthropicDirect = async (apiKey, body) => {
    const result = await api.callAnthropic(apiKey, body);
    if (!result.ok) throw new Error(`API error ${result.status}: ${result.data?.error?.message || 'Unknown error'}`);
    return result.data;
  };

  // If VaelAssistant is loaded, patch it to use direct API
  function _patchAssistant() {
    // VaelAssistant checks window._vaelAnthropicDirect before fetching
    // The assistant's _callClaude() already has this hook — just needs the flag
    console.log('[ElectronBridge] Anthropic API: direct (no proxy needed)');
  }
  _patchAssistant();

  // ── Native menu events ────────────────────────────────────────

  api.onMenu('new-scene', () => {
    document.getElementById('btn-scene-new')?.click();
  });

  api.onMenu('save-scene', () => {
    document.getElementById('btn-preset-save')?.click();
  });

  api.onMenu('open-output', () => {
    if (_outputOpen) closeOutputWindow();
    else openOutputWindow();
  });

  api.onMenu('perf-mode', () => {
    // Trigger F key for performance mode
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  });

  api.onMenu('export', () => {
    // Switch to REC tab
    document.querySelector('[data-tab="rec"]')?.click();
  });

  api.onMenu('open-project', async () => {
    const { projects } = await api.listProjects();
    if (projects.length === 0) {
      Toast.info('No saved projects yet — save a scene first');
      return;
    }
    // Could show a native picker here — for now dispatch event
    window.dispatchEvent(new CustomEvent('vael:show-project-browser'));
  });

  // ── Display info in status bar ────────────────────────────────

  api.getSystemInfo().then(info => {
    console.log(`[Vael Electron] v${info.version} — Electron ${info.electron} — ${info.platform}/${info.arch}`);
  });

  // Log connected displays
  api.getDisplays().then(displays => {
    const external = displays.filter(d => !d.isPrimary);
    if (external.length > 0) {
      console.log(`[Vael] External display detected: ${external.map(d => d.label || d.id).join(', ')}`);
      Toast.info(`External display found — click ⊡ Output to send canvas there`);
    }
  });

  console.log('[ElectronBridge] Native APIs ready');

})();
