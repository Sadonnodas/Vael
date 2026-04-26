/**
 * ui/SceneDirtyGuard.js
 *
 * Warns before switching scenes when the current scene has unsaved changes.
 * Call setClean(name) after loading a scene.
 * Call confirmSwitch(newName, proceed) before any scene navigation.
 * Call markSaved() when the user explicitly updates/saves the current scene.
 */

const SceneDirtyGuard = (() => {

  let _sceneName = null;
  let _snapshot  = null;

  function _snap() {
    const lys = window._vaelLayers?.layers;
    if (!lys) return null;
    try {
      return JSON.stringify(lys.map(l => {
        if (typeof l.toJSON !== 'function') return null;
        const j  = l.toJSON();
        // ModMatrix writes live audio-modulated values directly into layer.params,
        // layer.transform, layer.opacity, layer.fx, and layer.clipShape every frame.
        // _baseVals holds the user-set value BEFORE modulation for each targeted key.
        // We swap in those base values so the snapshot is stable across frames.
        const bv = l.modMatrix?._baseVals;
        if (!bv || bv.size === 0) return j;

        if (j.params) {
          const p = { ...j.params };
          bv.forEach((base, key) => {
            if (key in p) p[key] = base;
          });
          j.params = p;
        }
        if (bv.has('opacity') && j.opacity !== undefined) {
          j.opacity = bv.get('opacity');
        }
        if (j.transform) {
          const t = { ...j.transform };
          bv.forEach((base, key) => {
            if (key.startsWith('transform.')) t[key.slice(10)] = base;
          });
          j.transform = t;
        }
        if (j.clipShape) {
          const cs = { ...j.clipShape };
          bv.forEach((base, key) => {
            if (key.startsWith('clipShape.')) cs[key.slice(10)] = base;
          });
          j.clipShape = cs;
        }
        if (j.fx) {
          j.fx = j.fx.map((f, fi) => {
            const fp = { ...f.params };
            bv.forEach((base, key) => {
              const pfx = `fx:${fi}.`;
              if (key.startsWith(pfx)) fp[key.slice(pfx.length)] = base;
            });
            return { ...f, params: fp };
          });
        }
        return j;
      }));
    } catch { return null; }
  }

  /** Call after a scene has been applied. Waits one frame for layers to settle. */
  function setClean(sceneName) {
    _sceneName = sceneName;
    requestAnimationFrame(() => { _snapshot = _snap(); });
  }

  /** Call when the user explicitly saves / updates the current scene. */
  function markSaved() {
    _snapshot = _snap();
  }

  function _isDirty() {
    if (!_snapshot || !_sceneName) return false;
    const cur = _snap();
    return cur !== null && cur !== _snapshot;
  }

  /**
   * Gate before switching to newSceneName.
   * If the current scene is dirty, shows a modal asking what to do.
   * onProceed() is only called when the user confirms the switch.
   */
  function confirmSwitch(newSceneName, onProceed) {
    if (!_sceneName || !_isDirty() || newSceneName === _sceneName) {
      onProceed();
      return;
    }
    _showModal(_sceneName, onProceed);
  }

  function _showModal(dirtyName, onProceed) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9001;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(8px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;
      padding:24px;max-width:380px;width:90%;font-family:var(--font-mono);
      box-shadow:0 20px 60px rgba(0,0,0,0.85);
    `;

    modal.innerHTML = `
      <div style="font-size:9px;letter-spacing:1.5px;color:var(--accent);
                  text-transform:uppercase;margin-bottom:10px">Unsaved changes</div>
      <div style="font-size:11px;color:var(--text);line-height:1.75;margin-bottom:22px">
        <strong style="color:var(--accent2)">${dirtyName}</strong> has been modified
        but not updated. Switching now will discard those changes.
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button id="sg-update" style="
          width:100%;padding:10px 14px;text-align:left;cursor:pointer;border-radius:6px;
          background:rgba(0,212,170,0.1);border:1px solid var(--accent);
          color:var(--accent);font-family:var(--font-mono);font-size:10px">
          ↑ Update &ldquo;${dirtyName}&rdquo; then switch
        </button>
        <button id="sg-discard" style="
          width:100%;padding:10px 14px;text-align:left;cursor:pointer;border-radius:6px;
          background:transparent;border:1px solid var(--border);
          color:var(--text-dim);font-family:var(--font-mono);font-size:10px">
          → Switch without saving
        </button>
        <button id="sg-cancel" style="
          width:100%;padding:10px 14px;text-align:left;cursor:pointer;border-radius:6px;
          background:transparent;border:none;
          color:var(--text-muted);font-family:var(--font-mono);font-size:10px">
          ✕ Stay on this scene
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    modal.querySelector('#sg-update').addEventListener('click', () => {
      close();
      if (window._vaelLayers && typeof PresetBrowser !== 'undefined') {
        let thumb = null;
        try {
          const canvas = document.getElementById('main-canvas');
          if (canvas) {
            const t = document.createElement('canvas');
            t.width = 120; t.height = 68;
            t.getContext('2d').drawImage(canvas, 0, 0, 120, 68);
            thumb = t.toDataURL('image/jpeg', 0.6);
          }
        } catch {}
        PresetBrowser.save(window._vaelLayers, dirtyName, thumb);
        markSaved();
        Toast.success(`"${dirtyName}" updated`);
      }
      onProceed();
    });

    modal.querySelector('#sg-discard').addEventListener('click', () => { close(); onProceed(); });
    modal.querySelector('#sg-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  return { setClean, markSaved, confirmSwitch };

})();
