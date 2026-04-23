/**
 * ui/ParamPanel.js
 *
 * Phase 2 upgrades:
 * - Collapsible sections: Transform & Opacity, Parameters, Modulation, FX
 * - Transform + opacity always shown at top of every layer's params panel
 * - Hue sliders (min:0 max:360) show a colour-strip + hex input
 * - MIDI CC badges on mapped params with hover tooltip
 * - GroupLayer renders name + transform/opacity only (no params section)
 * - ParamPanel.renderGlobalModMatrix(layerStack, container) — flat list of
 *   every active route across all layers with delete buttons
 */

const ParamPanel = (() => {

  const BANDS = ['bass', 'mid', 'treble', 'volume', 'brightness', 'motion', 'hue', 'edgeDensity'];

  const LEGACY_PARAM_IDS = new Set([
    'audioTarget', 'audioAmount', 'audioReact',
    'audioScale',  'audioRotate', 'audioOpac',
    'audioSize',   'audioHue',    'audioColor',
  ]);

  // Remember open/closed state per layer constructor name
  const _sectionState = {};

  // ── Live value tracking ──────────────────────────────────────
  let _liveTrackers = new Map();
  let _trackedLayer = null;

  function updateLiveValues(layer) {
    if (!layer || layer !== _trackedLayer) return;
    _liveTrackers.forEach(({ liveBar, numInput, slider, min, max, fmt, paramId }) => {
      const live = paramId === 'opacity' ? layer.opacity : layer.params?.[paramId];
      if (live === undefined || live === null) return;
      const range    = max - min;
      const pct      = range > 0 ? Math.max(0, Math.min(1, (live - min) / range)) : 0;
      const isDriven = Math.abs(live - parseFloat(slider.value)) > 0.005;
      liveBar.style.opacity = isDriven ? '1' : '0';
      liveBar.style.width   = `${pct * 100}%`;
      if (isDriven && document.activeElement !== numInput) {
        numInput.style.color = 'var(--accent2)';
        numInput.value       = fmt(live);
      } else if (!isDriven && document.activeElement !== numInput) {
        numInput.style.color = 'var(--accent)';
        numInput.value       = fmt(parseFloat(slider.value));
      }
    });
  }

  // ── Main render ──────────────────────────────────────────────

  function render(layer, container, audioEngine, layerStack) {
    _liveTrackers.clear();
    _trackedLayer = layer;
    container.innerHTML = '';

    const manifest = layer.constructor.manifest;
    const typeKey  = layer.constructor.name;
    if (!_sectionState[typeKey]) {
      _sectionState[typeKey] = { transform: false, params: true, mod: false, fx: false, automation: false };
    }
    const sec = _sectionState[typeKey];

    // Name header
    container.appendChild(_buildNameHeader(layer, manifest?.name || typeKey));

    // Slideshow: Edit Images button
    if (layer instanceof SlideshowLayer) {
      const editBtn = document.createElement('button');
      editBtn.className   = 'btn accent';
      editBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:10px';
      // Count updates once images finish loading (they load asynchronously)
      const _updateCount = () => {
        const n = layer._entryCount ?? layer._images?.length ?? 0;
        editBtn.textContent = `🖼 Edit images (${n})`;
      };
      _updateCount();
      // Recheck after a short delay for async image loads
      setTimeout(_updateCount, 500);
      setTimeout(_updateCount, 1500);
      editBtn.addEventListener('click', () => {
        const currentUrls = (layer._images || []).map(e => e.url).filter(Boolean);
        SlideshowLayer.showPickerModal(currentUrls, selected => {
          layer.loadEntries(selected);
          setTimeout(_updateCount, 500);
          Toast.success(`Slideshow: ${selected.length} image${selected.length!==1?'s':''}`);
        });
      });
      container.appendChild(editBtn);
    }

    // ── Image / Video source replace buttons ─────────────────────
    if (typeof ImageLayer !== 'undefined' && layer instanceof ImageLayer) {
      const srcBtn = document.createElement('button');
      srcBtn.className = 'btn accent';
      srcBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:10px';
      srcBtn.textContent = layer._sourceName
        ? `🖼 ${layer._sourceName}  — Change image`
        : '🖼 Choose image';
      srcBtn.addEventListener('click', () => {
        if (typeof LibraryPanel !== 'undefined') {
          LibraryPanel.promptImageForLayer(layer, container);
        }
      });
      container.appendChild(srcBtn);
    }

    if (typeof VideoPlayerLayer !== 'undefined' && layer instanceof VideoPlayerLayer) {
      const srcBtn = document.createElement('button');
      srcBtn.className = 'btn accent';
      srcBtn.style.cssText = 'width:100%;font-size:9px;margin-bottom:6px';
      srcBtn.textContent = layer._sourceName
        ? `▶ ${layer._sourceName}  — Change video`
        : '⬆ Choose / upload video';
      srcBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('vael:open-video-picker', { detail: { layerId: layer.id } }));
      });
      container.appendChild(srcBtn);
      _buildVideoTimeline(layer, container);
    }

    // Transform & Opacity — always shown for every layer
    const xfSec = _buildCollapsible('Transform & Opacity', sec.transform, o => { sec.transform = o; });
    _buildTransformControls(layer, xfSec.body);
    container.appendChild(xfSec.el);

    // Layer params section
    const params = (manifest?.params || []).filter(p => {
      if (LEGACY_PARAM_IDS.has(p.id) || p.legacy === true) return false;
      if (!p.showWhen) return true;
      return Object.entries(p.showWhen).every(([key, allowed]) => {
        const val = layer.params?.[key];
        return Array.isArray(allowed) ? allowed.includes(val) : val === allowed;
      });
    });

    if (params.length > 0) {
      const pSec = _buildCollapsible('Parameters', sec.params, o => { sec.params = o; });

      // ⚄ Random button in section header
      const randBtn = document.createElement('button');
      randBtn.style.cssText = `
        background:none;border:1px solid var(--border-dim);border-radius:3px;
        color:var(--text-dim);font-family:var(--font-mono);font-size:8px;
        padding:1px 6px;cursor:pointer;margin-left:auto;flex-shrink:0;
        transition:color 0.1s,border-color 0.1s;
      `;
      randBtn.textContent = '⚄ Random';
      randBtn.title = 'Randomise all parameters';
      randBtn.addEventListener('mouseenter', () => { randBtn.style.color = 'var(--accent)'; randBtn.style.borderColor = 'var(--accent)'; });
      randBtn.addEventListener('mouseleave', () => { randBtn.style.color = 'var(--text-dim)'; randBtn.style.borderColor = 'var(--border-dim)'; });
      randBtn.addEventListener('click', e => {
        e.stopPropagation();
        params.forEach(p => {
          if (!layer.params) return;
          if (p.type === 'float' || p.type === 'int') {
            const min = p.min ?? 0, max = p.max ?? 1;
            const v = p.type === 'int'
              ? Math.round(min + Math.random() * (max - min))
              : parseFloat((min + Math.random() * (max - min)).toFixed(3));
            layer.params[p.id] = v;
            if (typeof layer.setParam === 'function') layer.setParam(p.id, v);
          } else if (p.type === 'bool') {
            layer.params[p.id] = Math.random() > 0.5;
          } else if (p.type === 'enum' && p.options?.length) {
            layer.params[p.id] = p.options[Math.floor(Math.random() * p.options.length)];
          } else if (p.type === 'color') {
            const hue = Math.floor(Math.random() * 360);
            const sat = 60 + Math.floor(Math.random() * 40);
            const lit = 40 + Math.floor(Math.random() * 30);
            layer.params[p.id] = `hsl(${hue},${sat}%,${lit}%)`;
          }
        });
        // Re-render params panel to reflect new values
        window.dispatchEvent(new CustomEvent('vael:refresh-params'));
        Toast.info('Parameters randomised');
      });
      pSec.el.querySelector('summary').appendChild(randBtn);

      params.forEach(p => {
        // TileLayer: populate sourceId dropdown dynamically from live layer stack
        if (typeof TileLayer !== 'undefined' && layer instanceof TileLayer && p.id === 'sourceId') {
          const allLayers = window._vaelLayers?.layers ?? [];
          p.options = allLayers
            .filter(l => l.id !== layer.id)
            .map(l => ({ value: l.id, label: l.name || l.constructor?.name || l.id }));
        }
        pSec.body.appendChild(buildControl(p, layer.params?.[p.id] ?? p.default, layer));
      });

      // TileLayer: freeform crop draw button
      if (typeof TileLayer !== 'undefined' && layer instanceof TileLayer) {
        const drawBtn = document.createElement('button');
        drawBtn.style.cssText = `
          width:100%;margin-top:8px;padding:5px 0;
          background:none;border:1px solid var(--border-dim);border-radius:4px;
          color:var(--text-muted);font-family:var(--font-mono);font-size:9px;
          cursor:pointer;transition:border-color 0.1s,color 0.1s;
        `;
        drawBtn.textContent = '✏ Draw freeform crop shape';
        drawBtn.title = 'Click points on the canvas to define a custom crop region';
        drawBtn.addEventListener('mouseenter', () => { drawBtn.style.borderColor = 'var(--accent)'; drawBtn.style.color = 'var(--accent)'; });
        drawBtn.addEventListener('mouseleave', () => { drawBtn.style.borderColor = 'var(--border-dim)'; drawBtn.style.color = 'var(--text-muted)'; });
        drawBtn.addEventListener('click', e => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('vael:tilelayer-draw', { detail: { layerId: layer.id } }));
        });
        pSec.body.appendChild(drawBtn);
      }

      container.appendChild(pSec.el);
    }

    // Modulation matrix
    if (layer.modMatrix) {
      const label = `Modulation (${layer.modMatrix.routes.length})`;
      const mSec  = _buildCollapsible(label, sec.mod, o => { sec.mod = o; });
      ModMatrixPanel.render(layer, mSec.body);
      container.appendChild(mSec.el);
    }

    // LFO panel — between modulation and FX
    if (typeof LFOPanel !== 'undefined' && layer.modMatrix) {
      if (!layer._lfos) layer._lfos = [];
      const lSec = _buildCollapsible(`LFOs (${layer._lfos.length})`, sec.lfo ?? false, o => { sec.lfo = o; });
      LFOPanel.render(layer, lSec.body, () => {
        const titleNode = lSec.el.querySelector('summary');
        if (titleNode) {
          const textNodes = [...titleNode.childNodes].filter(n => n.nodeType === 3);
          if (textNodes.length) textNodes[textNodes.length-1].textContent = ` LFOs (${layer._lfos.length})`;
        }
      });
      container.appendChild(lSec.el);
    }

    // FX chain
    if (typeof LayerFXPanel !== 'undefined') {
      const fxLabel = `Layer FX (${(layer.fx || []).length})`;
      const fSec    = _buildCollapsible(fxLabel, sec.fx, o => { sec.fx = o; });
      LayerFXPanel.render(layer, fSec.body);
      container.appendChild(fSec.el);
    }

    // Automation ramps
    container.appendChild(_buildAutomationSection(layer, layerStack));
  }

  // ── Video timeline bar ───────────────────────────────────────
  // Canvas-based seek bar with draggable in/out markers, live playhead.
  // Updates via rAF while the panel element is in the DOM.

  function _buildVideoTimeline(layer, container) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;user-select:none';

    // ── Transport controls ──────────────────────────────────────────
    const transport = document.createElement('div');
    transport.style.cssText = 'display:flex;gap:4px;margin-bottom:7px';

    const _armBtn = (label, action, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'btn midi-armable';
      btn.style.cssText = 'font-size:9px;padding:5px 0;flex:1';
      btn.textContent = label;
      btn.title = `${label}  (click in MIDI Learn to arm → ${action})`;
      btn.addEventListener('click', e => {
        if (window._vaelLearnMode && window._vaelMidi) {
          e.stopPropagation();
          window._vaelMidi.startLearnGlobal(action);
          Toast.info(`Move a controller to map → ${action}`);
          return;
        }
        onClick();
      });
      return btn;
    };

    const playPauseBtn = _armBtn('▶ Play', `layer:${layer.id}:toggle`, () => {
      layer.isPlaying ? layer.pause() : layer.play();
    });
    const stopBtn = _armBtn('⏹ Stop', `layer:${layer.id}:stop`, () => {
      layer.stop();
    });
    transport.append(playPauseBtn, stopBtn);
    wrap.appendChild(transport);

    const canvas = document.createElement('canvas');
    canvas.height = 44;
    canvas.style.cssText = 'width:100%;height:44px;display:block;cursor:pointer;border-radius:3px';
    wrap.appendChild(canvas);

    const timeRow = document.createElement('div');
    timeRow.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center',
      'font-family:var(--font-mono);font-size:7px;color:rgba(255,255,255,0.35)',
      'margin-top:2px;padding:0 1px',
    ].join(';');
    const timePos  = document.createElement('span');
    const timeDur  = document.createElement('span');
    const timeMeta = document.createElement('span');  // dimensions centre
    timeMeta.style.cssText = 'font-size:6.5px;color:rgba(255,255,255,0.2)';
    timeRow.append(timePos, timeMeta, timeDur);
    wrap.appendChild(timeRow);

    container.appendChild(wrap);

    // ── helpers ──────────────────────────────────────────────────
    const fmt = s => {
      if (!isFinite(s) || s < 0) return '0:00.0';
      const m = Math.floor(s / 60);
      return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    };

    const getState = () => {
      const vid   = layer._videoEl;
      const dur   = (vid?.duration && isFinite(vid.duration)) ? vid.duration : 0;
      const cur   = vid?.currentTime ?? 0;
      const inPt  = Math.max(0, layer.params.inPoint  ?? 0);
      const outPt = (layer.params.outPoint > 0) ? Math.min(layer.params.outPoint, dur || 999) : (dur || 0);
      return { dur, cur, inPt, outPt, vid };
    };

    // ── draw ─────────────────────────────────────────────────────
    const TRACK_Y = 20;
    const TRACK_H = 4;
    const HEAD_R  = 5;

    const draw = () => {
      const W = canvas.offsetWidth || 200;
      if (canvas.width !== W) canvas.width = W;
      const { dur, cur, inPt, outPt, vid } = getState();
      const c = canvas.getContext('2d');

      c.clearRect(0, 0, W, 44);

      const toX = s => dur > 0 ? Math.round((s / dur) * W) : 0;

      // Track bg
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.beginPath();
      if (c.roundRect) c.roundRect(0, TRACK_Y, W, TRACK_H, 2);
      else c.rect(0, TRACK_Y, W, TRACK_H);
      c.fill();

      if (dur > 0) {
        // In/out region
        const ix = toX(inPt), ox = toX(outPt);
        c.fillStyle = 'rgba(255,255,255,0.1)';
        c.fillRect(ix, TRACK_Y, Math.max(0, ox - ix), TRACK_H);

        // Played portion (inPt → cur)
        if (cur > inPt) {
          c.fillStyle = '#00d4aa';
          c.fillRect(ix, TRACK_Y, Math.max(0, toX(cur) - ix), TRACK_H);
        }

        // In-point marker: teal flag
        c.fillStyle = '#00d4aa';
        c.fillRect(ix, TRACK_Y - 10, 2, TRACK_H + 10);
        c.beginPath();
        c.moveTo(ix, TRACK_Y - 10);
        c.lineTo(ix + 7, TRACK_Y - 6);
        c.lineTo(ix, TRACK_Y - 2);
        c.closePath();
        c.fill();

        // Out-point marker: amber flag (pointing left)
        c.fillStyle = '#ff9f43';
        c.fillRect(ox - 2, TRACK_Y - 10, 2, TRACK_H + 10);
        c.beginPath();
        c.moveTo(ox, TRACK_Y - 10);
        c.lineTo(ox - 7, TRACK_Y - 6);
        c.lineTo(ox, TRACK_Y - 2);
        c.closePath();
        c.fill();

        // Playhead
        const hx = toX(cur);
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(hx, TRACK_Y + TRACK_H / 2, HEAD_R, 0, Math.PI * 2);
        c.fill();
        // Thin time label above playhead
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.font = '6px monospace';
        c.textAlign = hx < W * 0.85 ? 'left' : 'right';
        c.fillText(fmt(cur), hx + (hx < W * 0.85 ? 7 : -7), TRACK_Y - 2);

        // In/out time labels on flags
        c.font = '6px monospace';
        c.fillStyle = 'rgba(0,212,170,0.7)';
        c.textAlign = 'left';
        c.fillText(fmt(inPt), Math.min(ix + 3, W - 28), TRACK_Y - 12);
        c.fillStyle = 'rgba(255,159,67,0.7)';
        c.textAlign = 'right';
        c.fillText(fmt(outPt), Math.max(ox - 3, 28), TRACK_Y - 12);
      }

      // Bottom labels
      timePos.textContent  = fmt(cur);
      timeDur.textContent  = dur > 0 ? fmt(dur) : '';
      if (vid?.videoWidth) {
        timeMeta.textContent = `${vid.videoWidth}×${vid.videoHeight}`;
      }

      // Sync transport button to current playing state
      const playing = layer.isPlaying;
      playPauseBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
      playPauseBtn.style.color       = playing ? 'var(--accent)' : '';
      playPauseBtn.style.borderColor = playing ? 'var(--accent)' : '';
    };

    // ── rAF loop (stops when wrap leaves DOM) ─────────────────────
    let running = true;
    const loop = () => {
      if (!running || !document.contains(wrap)) { running = false; return; }
      draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // ── mouse interaction ─────────────────────────────────────────
    const HIT = 9;   // px hitbox radius for markers
    let dragging = null;  // 'seek' | 'in' | 'out'

    const xToTime = x => {
      const { dur } = getState();
      const W = canvas.offsetWidth || 200;
      return Math.max(0, Math.min(dur, (x / W) * dur));
    };

    const hitTest = x => {
      const { dur, inPt, outPt } = getState();
      if (!dur) return 'seek';
      const W  = canvas.offsetWidth || 200;
      const ix = (inPt / dur) * W;
      const ox = (outPt / dur) * W;
      if (Math.abs(x - ix) <= HIT) return 'in';
      if (Math.abs(x - ox) <= HIT) return 'out';
      return 'seek';
    };

    const applyDrag = x => {
      const t = xToTime(x);
      const { dur, inPt, outPt } = getState();
      if (dragging === 'seek') {
        if (layer._videoEl) layer._videoEl.currentTime = t;
      } else if (dragging === 'in') {
        layer.params.inPoint  = Math.max(0, Math.min(t, outPt - 0.05));
      } else if (dragging === 'out') {
        layer.params.outPoint = Math.min(dur, Math.max(t, inPt + 0.05));
      }
    };

    canvas.addEventListener('mousedown', e => {
      const x = e.clientX - canvas.getBoundingClientRect().left;
      dragging = hitTest(x);
      applyDrag(x);
      e.preventDefault();
    });

    const onMove = e => { if (dragging) applyDrag(e.clientX - canvas.getBoundingClientRect().left); };
    const onUp   = () => { dragging = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    // Cursor hint
    canvas.addEventListener('mousemove', e => {
      if (dragging) return;
      const x = e.clientX - canvas.getBoundingClientRect().left;
      canvas.style.cursor = hitTest(x) !== 'seek' ? 'ew-resize' : 'pointer';
    });

    // Cleanup listeners when panel is replaced
    wrap._destroyTimeline = () => {
      running = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }

  // ── Collapsible section ──────────────────────────────────────

  function _buildCollapsible(title, defaultOpen, onToggle) {
    const details = document.createElement('details');
    details.open  = defaultOpen;
    details.style.cssText = 'border:1px solid var(--border-dim);border-radius:6px;margin-bottom:10px;overflow:hidden';

    const summary = document.createElement('summary');
    summary.style.cssText = `
      font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:1px;padding:8px 10px;
      cursor:pointer;list-style:none;display:flex;align-items:center;
      gap:6px;background:var(--bg-card);user-select:none;
    `;
    const arrow = document.createElement('span');
    arrow.style.cssText = `font-size:8px;transition:transform 0.15s;display:inline-block;
      transform:${defaultOpen ? 'rotate(90deg)' : 'rotate(0deg)'}`;
    arrow.textContent = '▶';
    summary.appendChild(arrow);
    summary.appendChild(document.createTextNode(title));
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 10px 4px';
    details.appendChild(body);

    details.addEventListener('toggle', () => {
      arrow.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
      if (typeof onToggle === 'function') onToggle(details.open);
    });

    return { el: details, body };
  }

  // ── Transform & Opacity ──────────────────────────────────────

  function _buildTransformControls(layer, container) {
    const t = layer.transform || {};

    // Opacity — writes to layer.opacity
    container.appendChild(buildSlider(
      { id: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
      layer.opacity ?? 1, layer,
      v => { layer.opacity = v; if (window._vaelHistory) window._vaelHistory.onOpacityChange(layer, v); }
    ));

    // Blend mode
    const blendModes = ['normal','multiply','screen','overlay','add','softlight',
                        'difference','luminosity','subtract','exclusion'];
    container.appendChild(buildDropdown(
      { id: '_blendMode', label: 'Blend mode', type: 'enum', options: blendModes },
      layer.blendMode || 'normal', layer,
      v => { layer.blendMode = v; }
    ));

    // X / Y — two-column
    const xyRow = document.createElement('div');
    xyRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    xyRow.appendChild(buildSlider(
      { id: '_tx', label: 'X', type: 'float', min: -800, max: 800, step: 1, default: 0 },
      t.x ?? 0, layer, v => { layer.transform.x = v; if (window._vaelHistory) window._vaelHistory.onTransformChange(layer); }
    ));
    xyRow.appendChild(buildSlider(
      { id: '_ty', label: 'Y', type: 'float', min: -450, max: 450, step: 1, default: 0 },
      t.y ?? 0, layer, v => { layer.transform.y = v; if (window._vaelHistory) window._vaelHistory.onTransformChange(layer); }
    ));
    container.appendChild(xyRow);

    // Scale X / Y — two-column
    const scaleRow = document.createElement('div');
    scaleRow.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center';

    let _scaleLinked = layer._scaleLinked ?? true;

    const scaleXEl = buildSlider(
      { id: '_tscaleX', label: 'Scale X', type: 'float', min: 0.1, max: 4, step: 0.01, default: 1 },
      t.scaleX ?? 1, layer, v => {
        layer.transform.scaleX = v;
        if (_scaleLinked) layer.transform.scaleY = v;
        if (window._vaelHistory) window._vaelHistory.onTransformChange(layer);
      }
    );
    const linkBtn = document.createElement('button');
    linkBtn.style.cssText = `background:${_scaleLinked?'color-mix(in srgb,var(--accent) 15%,transparent)':'none'};border:1px solid ${_scaleLinked?'var(--accent)':'var(--border-dim)'};border-radius:3px;color:${_scaleLinked?'var(--accent)':'var(--text-dim)'};font-size:10px;padding:2px 4px;cursor:pointer;align-self:center;margin-top:12px`;
    linkBtn.textContent = '🔗';
    linkBtn.title = 'Link Scale X and Y together';
    linkBtn.addEventListener('click', e => {
      e.stopPropagation();
      _scaleLinked = !_scaleLinked;
      layer._scaleLinked = _scaleLinked;
      linkBtn.style.background  = _scaleLinked ? 'color-mix(in srgb,var(--accent) 15%,transparent)' : 'none';
      linkBtn.style.borderColor = _scaleLinked ? 'var(--accent)' : 'var(--border-dim)';
      linkBtn.style.color       = _scaleLinked ? 'var(--accent)' : 'var(--text-dim)';
    });
    const scaleYEl = buildSlider(
      { id: '_tscaleY', label: 'Scale Y', type: 'float', min: 0.1, max: 4, step: 0.01, default: 1 },
      t.scaleY ?? 1, layer, v => {
        layer.transform.scaleY = v;
        if (_scaleLinked) layer.transform.scaleX = v;
        if (window._vaelHistory) window._vaelHistory.onTransformChange(layer);
      }
    );
    scaleRow.appendChild(scaleXEl);
    scaleRow.appendChild(linkBtn);
    scaleRow.appendChild(scaleYEl);
    container.appendChild(scaleRow);

    // Rotation
    container.appendChild(buildSlider(
      { id: '_trot', label: 'Rotation', type: 'float', min: -180, max: 180, step: 0.5, default: 0 },
      t.rotation ?? 0, layer, v => { layer.transform.rotation = v; if (window._vaelHistory) window._vaelHistory.onTransformChange(layer); }
    ));

    // Soft update toggle
    const updateRow = document.createElement('div');
    updateRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px';
    updateRow.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Param changes</span>
      <div style="display:flex;gap:3px">
        <button class="su-soft" style="
          background:${layer.softUpdate!==false?'var(--accent)':'none'};
          border:1px solid ${layer.softUpdate!==false?'var(--accent)':'var(--border-dim)'};
          border-radius:3px 0 0 3px;color:${layer.softUpdate!==false?'var(--bg)':'var(--text-dim)'};
          font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer"
          title="Smooth — parameters update incrementally without reinitialising">Smooth</button>
        <button class="su-instant" style="
          background:${layer.softUpdate===false?'var(--accent2)':'none'};
          border:1px solid ${layer.softUpdate===false?'var(--accent2)':'var(--border-dim)'};
          border-radius:0 3px 3px 0;color:${layer.softUpdate===false?'var(--bg)':'var(--text-dim)'};
          font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer"
          title="Instant — full reinitialise on every parameter change">Instant</button>
      </div>
    `;
    updateRow.querySelector('.su-soft').addEventListener('click', e => {
      e.stopPropagation();
      layer.softUpdate = true;
      updateRow.querySelector('.su-soft').style.background    = 'var(--accent)';
      updateRow.querySelector('.su-soft').style.borderColor   = 'var(--accent)';
      updateRow.querySelector('.su-soft').style.color         = 'var(--bg)';
      updateRow.querySelector('.su-instant').style.background = 'none';
      updateRow.querySelector('.su-instant').style.borderColor = 'var(--border-dim)';
      updateRow.querySelector('.su-instant').style.color      = 'var(--text-dim)';
    });
    updateRow.querySelector('.su-instant').addEventListener('click', e => {
      e.stopPropagation();
      layer.softUpdate = false;
      updateRow.querySelector('.su-instant').style.background  = 'var(--accent2)';
      updateRow.querySelector('.su-instant').style.borderColor = 'var(--accent2)';
      updateRow.querySelector('.su-instant').style.color       = 'var(--bg)';
      updateRow.querySelector('.su-soft').style.background     = 'none';
      updateRow.querySelector('.su-soft').style.borderColor    = 'var(--border-dim)';
      updateRow.querySelector('.su-soft').style.color          = 'var(--text-dim)';
    });
    container.appendChild(updateRow);

    // Clip shape
    const clipDiv = document.createElement('div');
    clipDiv.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid var(--border-dim)';

    const clipLabel = document.createElement('div');
    clipLabel.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px';
    clipLabel.textContent = 'Clip shape';
    clipDiv.appendChild(clipLabel);

    const clipTypeRow = document.createElement('div');
    clipTypeRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';

    const clipSizeContainer = document.createElement('div');

    const _refreshClip = () => {
      const curType = layer.clipShape?.type || 'none';
      clipTypeRow.querySelectorAll('button').forEach(b => {
        const isActive = b.dataset.shape === curType;
        b.style.background  = isActive ? 'var(--accent)' : 'none';
        b.style.borderColor = isActive ? 'var(--accent)' : 'var(--border-dim)';
        b.style.color       = isActive ? 'var(--bg)'     : 'var(--text-dim)';
      });
      clipSizeContainer.innerHTML = '';
      const cs2 = layer.clipShape;
      if (cs2 && cs2.type && cs2.type !== 'none') {
        const sizeRow = document.createElement('div');
        sizeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
        sizeRow.appendChild(buildSlider(
          { id: '_clipW', label: 'Width',  type: 'float', min: 0.05, max: 1.5, step: 0.01 },
          cs2.w ?? 0.5, layer, v => { if (layer.clipShape) { layer.clipShape.w = v; if (window._vaelTimeline?.isRecording) window._vaelTimeline.recordPoint(layer.id, 'clipShape.w', v, { label:'Clip Width', min:0.05, max:1.5 }); } }
        ));
        sizeRow.appendChild(buildSlider(
          { id: '_clipH', label: 'Height', type: 'float', min: 0.05, max: 1.5, step: 0.01 },
          cs2.h ?? 0.5, layer, v => { if (layer.clipShape) { layer.clipShape.h = v; if (window._vaelTimeline?.isRecording) window._vaelTimeline.recordPoint(layer.id, 'clipShape.h', v, { label:'Clip Height', min:0.05, max:1.5 }); } }
        ));
        clipSizeContainer.appendChild(sizeRow);

        const posRow = document.createElement('div');
        posRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
        posRow.appendChild(buildSlider(
          { id: '_clipX', label: 'X', type: 'float', min: -1, max: 1, step: 0.01 },
          cs2.x ?? 0, layer, v => { if (layer.clipShape) layer.clipShape.x = v; }
        ));
        posRow.appendChild(buildSlider(
          { id: '_clipY', label: 'Y', type: 'float', min: -1, max: 1, step: 0.01 },
          cs2.y ?? 0, layer, v => { if (layer.clipShape) layer.clipShape.y = v; }
        ));
        clipSizeContainer.appendChild(posRow);
        clipSizeContainer.appendChild(buildSlider(
          { id: '_clipFeather', label: 'Feather', type: 'float', min: 0, max: 120, step: 1 },
          cs2.feather ?? 0, layer, v => { if (layer.clipShape) layer.clipShape.feather = v; }
        ));
        if (cs2.type.includes('outline')) {
          clipSizeContainer.appendChild(buildSlider(
            { id: '_clipLW', label: 'Line width', type: 'float', min: 1, max: 30, step: 0.5, default: 3 },
            cs2.lineWidth ?? 3, layer, v => { if (layer.clipShape) { layer.clipShape.lineWidth = v; if (window._vaelTimeline?.isRecording) window._vaelTimeline.recordPoint(layer.id, 'clipShape.lineWidth', v, { label:'Clip Line Width', min:1, max:30 }); } }
          ));
        }
      }
    };

    // Clip shapes: two shapes × three modes each
    const CLIP_SHAPES = ['none','rect-inside','rect-outside','ellipse-inside','ellipse-outside'];
    const CLIP_LABELS = {
      none:             'Full',
      'rect-inside':    '▭ In',
      'rect-outside':   '▭ Out',
      'rect-line':      '▭ On',
      'ellipse-inside': '◯ In',
      'ellipse-outside':'◯ Out',
      'ellipse-line':   '◯ On',
    };
    const CLIP_TIPS = {
      none:             'Full canvas — no clipping',
      'rect-inside':    'Rectangle: show only INSIDE the shape',
      'rect-outside':   'Rectangle: show only OUTSIDE the shape (punch hole)',
      'rect-line':      'Rectangle: show only ON the shape outline (stroke mask)',
      'ellipse-inside': 'Ellipse: show only INSIDE the shape',
      'ellipse-outside':'Ellipse: show only OUTSIDE the shape (punch hole)',
      'ellipse-line':   'Ellipse: show only ON the shape outline (stroke mask)',
    };
    // Migrate old type names
    if (layer.clipShape?.type === 'rect')            layer.clipShape.type = 'rect-inside';
    if (layer.clipShape?.type === 'ellipse')         layer.clipShape.type = 'ellipse-inside';
    if (layer.clipShape?.type === 'rect-outline')    layer.clipShape.type = 'rect-inside';
    if (layer.clipShape?.type === 'ellipse-outline') layer.clipShape.type = 'ellipse-inside';

    CLIP_SHAPES.forEach(shape => {
      const btn = document.createElement('button');
      btn.dataset.shape = shape;
      const isActive = (layer.clipShape?.type || 'none') === shape;
      btn.style.cssText = `background:${isActive?'var(--accent)':'none'};
        border:1px solid ${isActive?'var(--accent)':'var(--border-dim)'};
        border-radius:3px;color:${isActive?'var(--bg)':'var(--text-dim)'};
        font-family:var(--font-mono);font-size:7px;padding:2px 4px;cursor:pointer;flex:1`;
      btn.textContent = CLIP_LABELS[shape] || shape;
      btn.title = CLIP_TIPS[shape] || shape;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        layer.clipShape = shape === 'none' ? null
          : { type: shape, w: layer.clipShape?.w ?? 0.5, h: layer.clipShape?.h ?? 0.5,
              x: layer.clipShape?.x ?? 0, y: layer.clipShape?.y ?? 0,
              lineWidth: layer.clipShape?.lineWidth ?? 10, feather: layer.clipShape?.feather ?? 0 };
        _refreshClip();
        // Record clip type as a numeric step value for automation
        if (window._vaelTimeline?.isRecording && layer.id) {
          const CLIP_TYPE_MAP = { 'none':0,'rect-inside':1,'rect-outside':2,'ellipse-inside':3,'ellipse-outside':4 };
          const typeVal = CLIP_TYPE_MAP[shape] ?? 0;
          window._vaelTimeline.recordPoint(layer.id, 'clipShape.type', typeVal, { label:'Clip Type', min:0, max:4 });
        }
      });
      clipTypeRow.appendChild(btn);
    });

    // Tip about using masks for layer-based clipping
    const maskTip = document.createElement('div');
    maskTip.style.cssText = 'font-family:var(--font-mono);font-size:7px;color:var(--text-dim);margin-top:4px;line-height:1.5';
    maskTip.textContent = 'For layer-shaped clipping → use the Mask dropdown above';
    clipDiv.appendChild(clipTypeRow);
    clipDiv.appendChild(maskTip);
    clipDiv.appendChild(clipSizeContainer);
    _refreshClip();
    container.appendChild(clipDiv);

    // ── Color Mask ───────────────────────────────────────────────
    _buildColorMaskSection(layer, container);
  }

  function _buildColorMaskSection(layer, container) {
    const cm = layer.colorMask;
    const enabled = cm?.enabled ?? false;

    const section = document.createElement('div');
    section.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid var(--border-dim)';

    // Header row: label + enable toggle
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';

    const label = document.createElement('div');
    label.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px';
    label.textContent = 'Color Mask';

    const toggle = document.createElement('input');
    toggle.type    = 'checkbox';
    toggle.checked = enabled;
    toggle.style.cssText = 'accent-color:var(--accent);width:14px;height:14px;cursor:pointer';

    headerRow.appendChild(label);
    headerRow.appendChild(toggle);
    section.appendChild(headerRow);

    // Controls — shown only when enabled
    const body = document.createElement('div');
    body.style.display = enabled ? 'block' : 'none';

    const _buildCMControls = () => {
      body.innerHTML = '';
      const cur = layer.colorMask || {};

      // Color picker + eyedropper
      const colorRow = document.createElement('div');
      colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      colorRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:52px">Color</span>
        <input type="color" class="cm-color" value="${cur.color || '#00ff00'}"
          style="height:22px;flex:1;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer" />
        <button class="cm-eyedropper" title="Sample color from canvas"
          style="background:none;border:1px solid var(--border-dim);border-radius:3px;
                 color:var(--text-dim);font-family:var(--font-mono);font-size:10px;
                 padding:1px 6px;cursor:pointer;line-height:20px">🎯</button>
      `;
      body.appendChild(colorRow);

      // Tolerance slider
      body.appendChild(_buildInlineSlider('Tolerance', cur.tolerance ?? 0.3, 0, 1, 0.01, v => {
        if (layer.colorMask) layer.colorMask.tolerance = v;
      }));

      // Softness slider
      body.appendChild(_buildInlineSlider('Softness', cur.softness ?? 0.1, 0, 1, 0.01, v => {
        if (layer.colorMask) layer.colorMask.softness = v;
      }));

      // Invert toggle
      const invertRow = document.createElement('div');
      invertRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:4px';
      invertRow.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">Invert (keep color, remove rest)</span>
        <input type="checkbox" class="cm-invert" ${cur.invert ? 'checked' : ''}
          style="accent-color:var(--accent);width:14px;height:14px;cursor:pointer" />
      `;
      body.appendChild(invertRow);

      // Wire events
      body.querySelector('.cm-color').addEventListener('input', e => {
        if (layer.colorMask) layer.colorMask.color = e.target.value;
      });

      body.querySelector('.cm-eyedropper').addEventListener('click', () => {
        const colorInput = body.querySelector('.cm-color');
        Toast.info('Click anywhere on the canvas to sample a color');
        const mainCanvas = document.getElementById('main-canvas');
        if (!mainCanvas) return;
        const onCanvasClick = (evt) => {
          mainCanvas.removeEventListener('click', onCanvasClick);
          mainCanvas.style.cursor = '';
          const rect = mainCanvas.getBoundingClientRect();
          const px = Math.round((evt.clientX - rect.left) * (mainCanvas.width / rect.width));
          const py = Math.round((evt.clientY - rect.top)  * (mainCanvas.height / rect.height));
          try {
            const tmp = document.createElement('canvas');
            tmp.width = tmp.height = 1;
            tmp.getContext('2d').drawImage(mainCanvas, -px, -py);
            const d = tmp.getContext('2d').getImageData(0, 0, 1, 1).data;
            const hex = VaelColor.rgbToHex(d[0]/255, d[1]/255, d[2]/255);
            if (layer.colorMask) layer.colorMask.color = hex;
            if (colorInput) colorInput.value = hex;
            Toast.success('Color sampled: ' + hex);
          } catch (_) { Toast.error('Could not sample color'); }
        };
        mainCanvas.style.cursor = 'crosshair';
        mainCanvas.addEventListener('click', onCanvasClick);
      });

      body.querySelector('.cm-invert').addEventListener('change', e => {
        if (layer.colorMask) layer.colorMask.invert = e.target.checked;
      });
    };

    _buildCMControls();
    section.appendChild(body);

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        layer.colorMask = {
          enabled:   true,
          color:     layer.colorMask?.color     || '#00ff00',
          tolerance: layer.colorMask?.tolerance ?? 0.3,
          softness:  layer.colorMask?.softness  ?? 0.1,
          invert:    layer.colorMask?.invert    ?? false,
        };
        body.style.display = 'block';
        _buildCMControls();
      } else {
        layer.colorMask = null;
        body.style.display = 'none';
      }
    });

    container.appendChild(section);
  }

  function _buildInlineSlider(labelText, value, min, max, step, onChange) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:52px';
    lbl.textContent = labelText;
    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = min; slider.max = max; slider.step = step;
    slider.value = value;
    slider.style.cssText = 'flex:1;accent-color:var(--accent)';
    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--accent);min-width:28px;text-align:right';
    valSpan.textContent = parseFloat(value).toFixed(2);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valSpan.textContent = v.toFixed(2);
      onChange(v);
    });
    row.appendChild(lbl); row.appendChild(slider); row.appendChild(valSpan);
    return row;
  }

  // ── Control builders ─────────────────────────────────────────

  function buildControl(param, current, layer) {
    switch (param.type) {
      case 'float':
      case 'int':          return buildSlider(param, current, layer);
      case 'enum':         return buildDropdown(param, current, layer);
      case 'bool':         return buildToggle(param, current, layer);
      case 'color':        return buildColorPicker(param, current, layer);
      case 'band':         return buildBandPicker(param, current, layer);
      case 'videolibrary': return typeof VideoLibraryPanel !== 'undefined'
                             ? VideoLibraryPanel.buildPicker(current, layer, param.id)
                             : buildSlider(param, current, layer);
      default:             return buildSlider(param, current, layer);
    }
  }

  /**
   * Float / int slider.
   * customSetter: optional fn(value) — used for transform/opacity controls
   * that don't live in layer.params. When provided, no live tracker is added.
   */
  function buildSlider(param, current, layer, customSetter) {
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';

    const isHue  = !customSetter &&
                   param.min === 0 && param.max === 360 &&
                   (param.id.toLowerCase().includes('hue') || param.label.toLowerCase().includes('hue'));
    const isInt  = param.type === 'int';
    const step   = isInt ? 1 : (param.step || 0.01);
    const min    = param.min ?? 0;
    const max    = param.max ?? 1;
    const fmt    = v => isInt ? String(Math.round(v)) : parseFloat(v).toFixed(2);
    const clamp  = v => Math.max(min, Math.min(max, v));

    // MIDI mapping badge
    const midiLink = !customSetter ? _getMidiLink(layer, param.id) : null;

    // ── Label row ───────────────────────────────────────────
    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:5px';

    const labelLeft = document.createElement('div');
    labelLeft.style.cssText = 'display:flex;align-items:center;gap:5px';

    const label = document.createElement('span');
    label.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted)';
    label.textContent   = param.label;
    labelLeft.appendChild(label);

    if (midiLink) {
      const badge = document.createElement('span');
      badge.style.cssText = `
        font-family:var(--font-mono);font-size:7px;
        background:color-mix(in srgb,var(--accent2) 20%,transparent);
        color:var(--accent2);border:1px solid color-mix(in srgb,var(--accent2) 50%,transparent);
        border-radius:3px;padding:1px 4px;cursor:default;flex-shrink:0;
      `;
      badge.textContent = `CC${midiLink.cc}`;
      badge.title = `MIDI: ch${midiLink.channel} CC${midiLink.cc} → ${param.label}\nRange: ${midiLink.min.toFixed(2)} – ${midiLink.max.toFixed(2)}`;
      labelLeft.appendChild(badge);
    }

    // MIDI arm button — visible when body.midi-learn-active (controlled by CSS)
    if (!customSetter) {
      const armBtn = document.createElement('span');
      armBtn.className = 'midi-learn-arm-btn';
      armBtn.textContent = 'MIDI';
      armBtn.title = `Arm for MIDI learn: ${param.label}`;
      armBtn.addEventListener('click', e => {
        e.stopPropagation();
        const midi = window._vaelMidi;
        if (!midi || !layer) return;
        midi.startLearn(layer.id, param.id, param.min ?? 0, param.max ?? 1);
        // Exit global learn mode (App.js onLink will finalize)
        if (window._exitLearnMode) window._exitLearnMode();
        if (typeof Toast !== 'undefined') Toast.info(`Move a controller to map → ${param.label}`);
      });
      labelLeft.appendChild(armBtn);
    }

    // ∿ LFO quick-add button (float/int params only, no custom setters)
    // LFO button removed — use the LFO panel (between Modulation and FX sections)

    labelRow.appendChild(labelLeft);

    const numInput = document.createElement('input');
    numInput.type  = 'number';
    numInput.value = fmt(current);
    numInput.min   = min; numInput.max = max; numInput.step = step;
    numInput.style.cssText = `
      font-family:var(--font-mono);font-size:9px;color:var(--accent);
      background:transparent;border:none;border-bottom:1px solid transparent;
      outline:none;width:52px;text-align:right;padding:0;cursor:text;
      -moz-appearance:textfield;
    `;
    numInput.addEventListener('focus', () => numInput.style.borderBottomColor = 'var(--accent)');
    numInput.addEventListener('blur',  () => numInput.style.borderBottomColor = 'transparent');
    labelRow.appendChild(numInput);
    wrap.appendChild(labelRow);

    // ── Hue extras ──────────────────────────────────────────
    let _hueSwatch = null, _hueHexIn = null;
    if (isHue) {
      // Colour spectrum strip
      const strip = document.createElement('div');
      strip.style.cssText = `height:4px;border-radius:2px;margin-bottom:5px;
        background:linear-gradient(to right,
          hsl(0,80%,55%),hsl(60,80%,55%),hsl(120,80%,55%),
          hsl(180,80%,55%),hsl(240,80%,55%),hsl(300,80%,55%),hsl(360,80%,55%))`;
      wrap.appendChild(strip);

      // Swatch + hex input row
      const hexRow = document.createElement('div');
      hexRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px';

      _hueSwatch = document.createElement('input');
      _hueSwatch.type  = 'color';
      _hueSwatch.value = _hueToHex(current);
      _hueSwatch.style.cssText = 'width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg);cursor:pointer;flex-shrink:0';

      _hueHexIn = document.createElement('input');
      _hueHexIn.type        = 'text';
      _hueHexIn.value       = _hueToHex(current);
      _hueHexIn.maxLength   = 7;
      _hueHexIn.placeholder = '#rrggbb';
      _hueHexIn.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 6px;letter-spacing:1px';

      hexRow.append(_hueSwatch, _hueHexIn);
      wrap.appendChild(hexRow);
    }

    // ── Slider ──────────────────────────────────────────────
    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = min; slider.max = max; slider.step = step;
    slider.value = current;
    slider.style.cssText = 'width:100%;cursor:pointer;accent-color:' +
      (isHue ? `hsl(${current},80%,55%)` : 'var(--accent)');

    // Shared apply
    const apply = (v) => {
      const c = clamp(isInt ? Math.round(v) : v);
      slider.value   = c;
      numInput.value = fmt(c);
      if (isHue) {
        slider.style.accentColor = `hsl(${c},80%,55%)`;
        if (_hueSwatch) _hueSwatch.value = _hueToHex(c);
        if (_hueHexIn)  _hueHexIn.value  = _hueToHex(c);
      }
      if (customSetter) {
        customSetter(c);
      } else {
        if (layer.params) layer.params[param.id] = c;
        if (typeof layer.setParam === 'function') layer.setParam(param.id, c);
      }
      if (window._vaelHistory && !customSetter) window._vaelHistory.onParamChange(param.label, layer);
      // Record into AutomationTimeline if recording is active
      if (window._vaelTimeline?.isRecording && !customSetter && layer?.id) {
        window._vaelTimeline.recordPoint(layer.id, param.id, c, param);
      }
    };

    slider.addEventListener('input', () => apply(parseFloat(slider.value)));
    // Double-click or Cmd/Ctrl+click resets to default value
    const resetToDefault = (e) => {
      if (e.type === 'dblclick' || (e.type === 'click' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        if (param.default !== undefined) {
          apply(param.default);
          Toast.info(`${param.label} → default (${fmt(param.default)})`);
        }
      }
    };
    slider.addEventListener('dblclick', resetToDefault);
    slider.addEventListener('click', resetToDefault);
    numInput.addEventListener('dblclick', resetToDefault);
    const commitNum = () => { const v = parseFloat(numInput.value); if (!isNaN(v)) apply(v); };
    numInput.addEventListener('blur', commitNum);
    numInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter')  { e.preventDefault(); numInput.blur(); }
      if (e.key === 'Escape') { numInput.value = fmt(parseFloat(slider.value)); numInput.blur(); }
    });

    // Hue extras → slider sync
    if (isHue && _hueSwatch && _hueHexIn) {
      _hueSwatch.addEventListener('input', e => {
        const hue = _hexToHue(e.target.value);
        _hueHexIn.value = e.target.value;
        apply(hue);
      });
      _hueHexIn.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          _hueSwatch.value = v;
          _hueHexIn.style.borderColor = 'var(--border)';
          apply(_hexToHue(v));
        } else {
          _hueHexIn.style.borderColor = '#ff4444';
        }
      });
    }

    // Live bar
    const liveBar = document.createElement('div');
    liveBar.style.cssText = `position:absolute;bottom:0;left:0;height:2px;background:var(--accent2);
      border-radius:1px;opacity:0;transition:width 0.05s,opacity 0.2s;pointer-events:none`;
    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'position:relative;padding-bottom:2px';
    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(liveBar);
    wrap.appendChild(sliderWrap);

    if (!customSetter) {
      _liveTrackers.set(param.id, { liveBar, numInput, slider, min, max, fmt, paramId: param.id });
    }

    return wrap;
  }

  // Enum dropdown — customSetter optional
  function buildDropdown(param, current, layer, customSetter) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const options = (param.options || [])
      .map(o => {
        const val   = (o && typeof o === 'object') ? o.value : o;
        const label = (o && typeof o === 'object') ? o.label : o;
        return `<option value="${val}" ${val === current ? 'selected' : ''}>${label}</option>`;
      }).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      </div>
      <select style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;
        color:var(--text);font-family:var(--font-mono);font-size:10px;padding:5px 8px;cursor:pointer">
        ${options}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => {
      if (customSetter) { customSetter(e.target.value); return; }
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
      if (window._vaelHistory) window._vaelHistory.onParamChange(param.label, layer);
      if (param.triggersRefresh) {
        const cont = wrap.closest('#params-content');
        if (cont) render(layer, cont);
      }
    });
    return wrap;
  }

  // Boolean toggle
  function buildToggle(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;display:flex;align-items:center;justify-content:space-between';
    let state = !!current;
    wrap.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      <button class="tgl" style="width:40px;height:20px;border-radius:10px;border:1px solid var(--border);
        background:${state ? 'var(--accent)' : 'var(--bg)'};cursor:pointer;position:relative;transition:background 0.2s">
        <span style="position:absolute;top:2px;left:${state ? '20px' : '2px'};width:14px;height:14px;
          border-radius:50%;background:${state ? 'var(--bg)' : 'var(--text-dim)'};transition:left 0.2s"></span>
      </button>
    `;
    const btn = wrap.querySelector('.tgl'), knob = btn.querySelector('span');
    btn.addEventListener('click', () => {
      state = !state;
      btn.style.background  = state ? 'var(--accent)' : 'var(--bg)';
      knob.style.left       = state ? '20px' : '2px';
      knob.style.background = state ? 'var(--bg)' : 'var(--text-dim)';
      if (layer.params) layer.params[param.id] = state;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, state);
      if (window._vaelHistory) window._vaelHistory.onParamChange(param.label, layer);
      if (param.triggersRefresh) {
        const cont = wrap.closest('#params-content');
        if (cont) render(layer, cont);
      }
    });
    return wrap;
  }

  // Colour picker (type:'color')
  function buildColorPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const safe = /^#[0-9a-fA-F]{3,6}$/.test(current) ? current : '#00d4aa';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" class="cp-sw" value="${safe}" style="width:36px;height:28px;padding:2px;
          flex-shrink:0;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer"/>
        <input type="text" class="cp-hex" value="${safe}" maxlength="7" placeholder="#rrggbb"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
          color:var(--text);font-family:var(--font-mono);font-size:10px;padding:4px 8px;letter-spacing:1px"/>
      </div>
    `;
    const sw = wrap.querySelector('.cp-sw'), hex = wrap.querySelector('.cp-hex');
    const apply = v => {
      if (layer.params) layer.params[param.id] = v;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, v);
    };
    sw.addEventListener('input', e => { hex.value = e.target.value; apply(e.target.value); });
    sw.addEventListener('change', () => { if (window._vaelHistory) window._vaelHistory.onParamChange(param.label, layer); });
    hex.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) {
        sw.value = v; apply(v); hex.style.borderColor = 'var(--border)';
      } else { hex.style.borderColor = '#ff4444'; }
    });
    hex.addEventListener('blur', () => { if (!hex.value.startsWith('#')) hex.value = '#' + hex.value; });
    return wrap;
  }

  // Audio band picker
  function buildBandPicker(param, current, layer) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px';
    const opts = BANDS.map(b => `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">${param.label}</span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--accent2)">audio</span>
      </div>
      <select style="width:100%;background:color-mix(in srgb,var(--accent2) 10%,var(--bg));
        border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);border-radius:4px;
        color:var(--accent2);font-family:var(--font-mono);font-size:10px;padding:5px 8px;cursor:pointer">
        ${opts}
      </select>
    `;
    wrap.querySelector('select').addEventListener('change', e => {
      if (layer.params) layer.params[param.id] = e.target.value;
      if (typeof layer.setParam === 'function') layer.setParam(param.id, e.target.value);
    });
    return wrap;
  }

  // ── MIDI badge helper ────────────────────────────────────────

  function _getMidiLink(layer, paramId) {
    const midi = window._vaelMidi;
    if (!midi || !layer) return null;
    return midi.links.find(l => l.layerId === layer.id && l.paramId === paramId) || null;
  }

  // ── Hue helpers ──────────────────────────────────────────────

  function _hueToHex(hue) {
    const [r, g, b] = VaelColor.hslToRgb(((hue % 360) + 360) % 360, 0.8, 0.55);
    return VaelColor.rgbToHex(r, g, b);
  }

  function _hexToHue(hex) {
    const [r, g, b] = VaelColor.hexToRgb(hex);
    const [h]       = VaelColor.rgbToHsl(r, g, b);
    return Math.round(h);
  }

  // ── Editable name header ─────────────────────────────────────

  function _buildNameHeader(layer, typeName) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';

    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px';
    sub.textContent   = typeName || '';
    wrap.appendChild(sub);

    // Name row: visibility button | name | solo button
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';

    // ◉/○ Visibility toggle
    const visBtn = document.createElement('button');
    visBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1;flex-shrink:0;transition:color 0.1s';
    const _updateVis = () => {
      const on = layer.visible !== false;
      visBtn.textContent = on ? '◉' : '○';
      visBtn.style.color = on ? 'var(--accent)' : 'var(--text-dim)';
      visBtn.title = on ? 'Click to hide layer' : 'Click to show layer';
    };
    _updateVis();
    visBtn.addEventListener('click', e => {
      e.stopPropagation();
      layer.visible = layer.visible === false ? true : false;
      _updateVis();
      window.dispatchEvent(new CustomEvent('vael:visibility-changed', { detail: { id: layer.id, visible: layer.visible } }));
    });
    nameRow.appendChild(visBtn);

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `flex:1;font-family:var(--font-mono);font-size:12px;color:var(--accent);
      letter-spacing:1px;cursor:text;padding:2px 0;border-bottom:1px solid transparent;
      transition:border-color 0.15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    nameEl.textContent = layer.name;
    nameEl.title       = 'Click to rename';

    // S Solo button
    const soloBtn = document.createElement('button');
    const _updateSolo = () => {
      const isSoloed = typeof LayerPanel !== 'undefined'
        ? LayerPanel.getSoloId?.() === layer.id
        : window._vaelSolo === layer.id;
      soloBtn.style.background  = isSoloed ? '#ffd700' : 'none';
      soloBtn.style.borderColor = isSoloed ? '#ffd700' : 'var(--border-dim)';
      soloBtn.style.color       = isSoloed ? '#000'    : 'var(--text-dim)';
    };
    soloBtn.style.cssText = 'border:1px solid var(--border-dim);border-radius:3px;font-family:var(--font-mono);font-size:8px;padding:2px 6px;cursor:pointer;flex-shrink:0;transition:all 0.1s';
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo this layer (hides all others)';
    _updateSolo();
    soloBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof LayerPanel !== 'undefined' && LayerPanel.soloLayer) {
        LayerPanel.soloLayer(layer.id);
        _updateSolo();
      }
    });

    nameRow.append(nameEl, soloBtn);
    wrap.appendChild(nameRow);

    nameEl.addEventListener('mouseenter', () => nameEl.style.borderBottomColor = 'var(--accent)');
    nameEl.addEventListener('mouseleave', () => nameEl.style.borderBottomColor = 'transparent');
    nameEl.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type  = 'text'; inp.value = layer.name;
      inp.style.cssText = `font-family:var(--font-mono);font-size:12px;color:var(--accent);
        letter-spacing:1px;background:transparent;border:none;
        border-bottom:1px solid var(--accent);outline:none;width:100%;padding:2px 0`;
      nameEl.replaceWith(inp); inp.focus(); inp.select();
      const commit = () => {
        const n = inp.value.trim() || layer.name;
        layer.name = n; nameEl.textContent = n; inp.replaceWith(nameEl);
        if (typeof LayerPanel !== 'undefined') LayerPanel.renderLayerList();
        Toast.info(`Renamed to "${n}"`);
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = layer.name; inp.blur(); }
      });
    });

    const resetRow = document.createElement('div');
    resetRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:6px';
    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = `background:none;border:1px solid var(--border-dim);border-radius:3px;
      color:var(--text-dim);font-family:var(--font-mono);font-size:8px;padding:2px 7px;cursor:pointer;
      transition:border-color 0.1s,color 0.1s`;
    resetBtn.textContent = '↺ Reset params';
    resetBtn.addEventListener('mouseenter', () => { resetBtn.style.borderColor='var(--accent2)'; resetBtn.style.color='var(--accent2)'; });
    resetBtn.addEventListener('mouseleave', () => { resetBtn.style.borderColor='var(--border-dim)'; resetBtn.style.color='var(--text-dim)'; });
    resetBtn.addEventListener('click', () => {
      const mf = layer.constructor?.manifest;
      if (!mf?.params) return;
      const def = {}; mf.params.forEach(p => { if (p.default !== undefined) def[p.id] = p.default; });
      if (layer.params) Object.assign(layer.params, def);
      if (typeof layer.init === 'function') layer.init(def);
      const cont = resetBtn.closest('#params-content');
      if (cont) render(layer, cont);
      if (window._vaelHistory) window._vaelHistory.snapshot(`Reset ${layer.name} params`);
      Toast.info('Params reset to defaults');
    });
    resetRow.appendChild(resetBtn);
    wrap.appendChild(resetRow);
    return wrap;
  }

  // ── Global ModMatrix view ────────────────────────────────────

  function renderGlobalModMatrix(layerStack, container) {
    container.innerHTML = '';

    const SOURCE_LABELS = {
      bass:'Bass', mid:'Mid', treble:'Treble', volume:'Volume', rms:'RMS',
      spectralCentroid:'Centroid', spectralSpread:'Spread', spectralFlux:'Flux',
      kickEnergy:'Kick', snareEnergy:'Snare', hihatEnergy:'Hi-hat',
      brightness:'Brightness', motion:'Motion', edgeDensity:'Edge',
      iTime:'Time', iBeat:'Beat', iMouseX:'Mouse X', iMouseY:'Mouse Y',
    };
    const SOURCE_COLORS = {
      bass:'#ff6b6b', mid:'#ffd700', treble:'#00d4aa', volume:'#7c6af7', rms:'#ff9f43',
      spectralCentroid:'#54a0ff', spectralSpread:'#5f27cd', spectralFlux:'#ff6348',
      kickEnergy:'#ff4757', snareEnergy:'#ffa502', hihatEnergy:'#2ed573',
      brightness:'#ffd700', motion:'#ff6b6b', edgeDensity:'#a78bfa',
      iTime:'#00d4aa', iBeat:'#ffffff', iMouseX:'#7c6af7', iMouseY:'#7c6af7',
    };

    const header = document.createElement('div');
    header.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px';
    container.appendChild(header);

    let total = 0;
    layerStack.layers.forEach(layer => {
      if (!layer.modMatrix?.routes.length) return;
      const lh = document.createElement('div');
      lh.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text);margin:10px 0 5px;padding-bottom:3px;border-bottom:1px solid var(--border-dim)';
      lh.textContent   = layer.name;
      container.appendChild(lh);

      layer.modMatrix.routes.forEach(route => {
        const mf     = layer.constructor?.manifest?.params?.find(p => p.id === route.target);
        const target = mf?.label || route.target;
        const source = SOURCE_LABELS[route.source] || route.source;
        const color  = SOURCE_COLORS[route.source] || '#00d4aa';
        const sign   = route.depth < 0 ? '−' : '+';
        const abs    = Math.abs(route.depth).toFixed(2);
        const dc     = route.depth < 0 ? '#ff9070' : color;

        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;
          background:var(--bg-card);border:1px solid var(--border-dim);
          border-left:2px solid ${color};border-radius:4px;margin-bottom:4px`;
        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:8px;color:${color};min-width:52px">${source}</span>
          <span style="font-size:8px;color:var(--text-dim)">→</span>
          <span style="font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1">${target}</span>
          <span style="font-family:var(--font-mono);font-size:8px;color:${dc};min-width:36px;text-align:right">${sign}${abs}</span>
          <button class="gdel" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:10px;padding:0 2px">✕</button>
        `;
        row.querySelector('.gdel').addEventListener('click', () => {
          layer.modMatrix.removeRoute(route.id);
          renderGlobalModMatrix(layerStack, container);
        });
        container.appendChild(row);
        total++;
      });
    });

    header.textContent = `All modulation routes (${total})`;

    if (total === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);text-align:center;padding:16px 0';
      empty.textContent   = 'No modulation routes in this scene.';
      container.appendChild(empty);
    }
  }

  // ── Automation ramp section ──────────────────────────────────
  function _buildAutomationSection(layer, layerStack) {
    if (!layer.automation) layer.automation = [];
    const allLayers = layerStack?.layers || [];

    const EXTRA_PARAMS = [
      { id: 'opacity',             label: 'Opacity',    min: 0,    max: 1,    step: 0.01 },
      { id: 'transform.x',        label: 'Position X', min: -1,   max: 1,    step: 0.01 },
      { id: 'transform.y',        label: 'Position Y', min: -1,   max: 1,    step: 0.01 },
      { id: 'transform.scaleX',   label: 'Scale X',    min: 0.1,  max: 4,    step: 0.01 },
      { id: 'transform.scaleY',   label: 'Scale Y',    min: 0.1,  max: 4,    step: 0.01 },
      { id: 'transform.rotation', label: 'Rotation',   min: -180, max: 180,  step: 0.5  },
    ];
    const manifParams = (layer.constructor.manifest?.params || [])
      .filter(p => p.type === 'float' || p.type === 'int')
      .map(p => ({ id: p.id, label: p.label, min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 0.01 }));
    const ALL_PARAMS = [...EXTRA_PARAMS, ...manifParams];

    const TIME_SOURCES = [
      { id: 'clock', label: 'Global clock' },
      { id: 'audio', label: 'Audio playback' },
      ...allLayers
        .filter(l => l.constructor.name === 'VideoPlayerLayer')
        .map(l => ({ id: `video:${l.id}`, label: `Video: ${l.name}` })),
    ];

    const CURVES     = Object.keys(AutomationEngine.CURVES);
    const CRV_LABELS = AutomationEngine.CURVE_LABELS;

    function _uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
    function _fmt(s) { const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:10px;border-top:1px solid var(--border-dim);padding-top:8px';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';
    const title = document.createElement('span');
    title.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px';
    title.textContent = 'Automation';
    const addBtn = document.createElement('button');
    addBtn.style.cssText = 'background:none;border:1px solid var(--accent);border-radius:3px;color:var(--accent);font-family:var(--font-mono);font-size:8px;padding:2px 8px;cursor:pointer';
    addBtn.textContent = '+ Add ramp';
    hdr.append(title, addBtn);
    wrap.appendChild(hdr);

    const list    = document.createElement('div');
    const formBox = document.createElement('div');
    wrap.appendChild(list);
    wrap.appendChild(formBox);

    function _renderList() {
      list.innerHTML = '';
      if (!layer.automation.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);padding:6px 0;opacity:0.6';
        empty.textContent = 'No ramps yet';
        list.appendChild(empty);
        return;
      }
      layer.automation.forEach((ramp, i) => {
        const pInfo = ALL_PARAMS.find(p => p.id === ramp.paramId) || { label: ramp.paramId };
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:5px;padding:5px 6px;margin-bottom:4px;
          background:${ramp.enabled ? 'color-mix(in srgb,var(--accent) 8%,var(--bg-card))' : 'var(--bg-card)'};
          border:1px solid ${ramp.enabled ? 'color-mix(in srgb,var(--accent) 30%,var(--border-dim))' : 'var(--border-dim)'};
          border-radius:4px`;

        const tog = document.createElement('button');
        tog.style.cssText = `background:none;border:none;color:${ramp.enabled ? 'var(--accent)' : 'var(--text-dim)'};font-size:11px;cursor:pointer;padding:0;flex-shrink:0;line-height:1`;
        tog.textContent = ramp.enabled ? '●' : '○';
        tog.title = ramp.enabled ? 'Disable' : 'Enable';
        tog.addEventListener('click', e => { e.stopPropagation(); ramp.enabled = !ramp.enabled; _renderList(); });

        const info = document.createElement('span');
        info.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text);flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
        info.textContent = `${pInfo.label}  ${ramp.startValue}→${ramp.endValue}${ramp.holdEnd ? '⊣' : ''}  ${_fmt(ramp.startTime)}–${_fmt(ramp.endTime)}  ${CRV_LABELS[ramp.curve] || ramp.curve}`;

        const editBtn = document.createElement('button');
        editBtn.style.cssText = 'background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 5px;cursor:pointer;flex-shrink:0';
        editBtn.textContent = '✎'; editBtn.title = 'Edit';
        editBtn.addEventListener('click', e => { e.stopPropagation(); _openForm(ramp, i); });

        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'background:none;border:1px solid var(--border-dim);border-radius:3px;color:#ff4444;font-family:var(--font-mono);font-size:7px;padding:2px 5px;cursor:pointer;flex-shrink:0';
        delBtn.textContent = '✕'; delBtn.title = 'Delete';
        delBtn.addEventListener('click', e => { e.stopPropagation(); layer.automation.splice(i, 1); _renderList(); });

        row.append(tog, info, editBtn, delBtn);
        list.appendChild(row);
      });
    }

    function _openForm(ramp, editIdx) {
      formBox.innerHTML = '';
      const isEdit = editIdx !== undefined && editIdx >= 0;

      const form = document.createElement('div');
      form.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-dim);border-radius:5px;padding:10px;margin-top:4px';

      const _sel = (opts, val) => {
        const s = document.createElement('select');
        s.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px';
        opts.forEach(({ id, label }) => { const o = document.createElement('option'); o.value = id; o.textContent = label; if (id === val) o.selected = true; s.appendChild(o); });
        s.addEventListener('keydown', e => e.stopPropagation());
        return s;
      };
      const _num = (val, step, min, max) => {
        const n = document.createElement('input');
        n.type = 'number'; n.value = val ?? 0; n.step = step ?? 0.01;
        if (min !== undefined) n.min = min;
        if (max !== undefined) n.max = max;
        n.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px;min-width:0';
        n.addEventListener('keydown', e => e.stopPropagation());
        return n;
      };
      const _row = (label, ...els) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:7px';
        const lb = document.createElement('span');
        lb.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);min-width:68px;flex-shrink:0';
        lb.textContent = label;
        r.append(lb, ...els);
        return r;
      };
      const _arrow = () => { const s = document.createElement('span'); s.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);flex-shrink:0'; s.textContent = '→'; return s; };

      const paramSel  = _sel(ALL_PARAMS.map(p => ({ id: p.id, label: p.label })), ramp?.paramId || 'opacity');
      const srcSel    = _sel(TIME_SOURCES, ramp?.timeSource || 'clock');
      const startT    = _num(ramp?.startTime  ?? 0,   0.1, 0);
      const endT      = _num(ramp?.endTime    ?? 10,  0.1, 0);
      const startV    = _num(ramp?.startValue ?? 0,   0.01);
      const endV      = _num(ramp?.endValue   ?? 1,   0.01);
      const curveSel  = _sel(CURVES.map(c => ({ id: c, label: CRV_LABELS[c] || c })), ramp?.curve || 'linear');

      // Hold-end checkbox
      const holdLabel = document.createElement('label');
      holdLabel.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;font-family:var(--font-mono);font-size:8px;color:var(--text-dim)';
      const holdChk = document.createElement('input');
      holdChk.type    = 'checkbox';
      holdChk.checked = !!ramp?.holdEnd;
      holdChk.style.cssText = 'accent-color:var(--accent)';
      holdLabel.append(holdChk, 'Hold end value (don\'t reset after ramp ends)');

      form.appendChild(_row('Param', paramSel));
      form.appendChild(_row('Time source', srcSel));
      form.appendChild(_row('Time (s)', startT, _arrow(), endT));

      // ── Timeline scrubber ────────────────────────────────────
      const scrubWrap = document.createElement('div');
      scrubWrap.style.cssText = 'margin-bottom:7px';

      const _getDuration = (src) => {
        if (src === 'audio') return window._vaelAudio?.duration ?? 0;
        if (src?.startsWith('video:')) {
          const vid = allLayers.find(l => l.id === src.slice(6));
          return vid?._videoEl?.duration ?? 0;
        }
        return 0;
      };

      const _buildScrubber = (src) => {
        scrubWrap.innerHTML = '';
        const dur = _getDuration(src);
        if (!(dur > 0)) return;

        const track = document.createElement('div');
        track.style.cssText = 'position:relative;height:20px;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;cursor:pointer;margin:0 2px 4px';

        const fill = document.createElement('div');
        fill.style.cssText = 'position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--accent) 25%,transparent);pointer-events:none';

        const mkHandle = (cls, color) => {
          const h = document.createElement('div');
          h.style.cssText = `position:absolute;top:-2px;bottom:-2px;width:6px;margin-left:-3px;background:${color};border-radius:3px;cursor:ew-resize;z-index:2`;
          h.className = cls;
          return h;
        };
        const hStart = mkHandle('tl-hs', 'var(--accent)');
        const hEnd   = mkHandle('tl-he', 'var(--accent2)');
        track.append(fill, hStart, hEnd);

        const durLabel = document.createElement('div');
        durLabel.style.cssText = 'font-family:var(--font-mono);font-size:7px;color:var(--text-dim);text-align:right;margin-bottom:2px';
        durLabel.textContent = `duration: ${_fmt(dur)}`;

        const _update = () => {
          const s = Math.max(0, Math.min(dur, parseFloat(startT.value) || 0));
          const e = Math.max(0, Math.min(dur, parseFloat(endT.value) || dur));
          const sl = (s / dur) * 100;
          const el = (e / dur) * 100;
          hStart.style.left = `${sl}%`;
          hEnd.style.left   = `${el}%`;
          fill.style.left   = `${sl}%`;
          fill.style.right  = `${100 - el}%`;
        };
        _update();
        startT.addEventListener('input', _update);
        endT.addEventListener('input', _update);

        const _drag = (handle, isStart) => {
          handle.addEventListener('mousedown', e => {
            e.preventDefault();
            const rect   = track.getBoundingClientRect();
            const onMove = ev => {
              const pct  = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
              const secs = (pct * dur).toFixed(1);
              if (isStart) { startT.value = secs; }
              else         { endT.value   = secs; }
              _update();
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        };
        _drag(hStart, true);
        _drag(hEnd, false);

        scrubWrap.appendChild(durLabel);
        scrubWrap.appendChild(track);
      };

      _buildScrubber(srcSel.value);
      srcSel.addEventListener('change', () => _buildScrubber(srcSel.value));
      form.appendChild(scrubWrap);
      // ── End timeline scrubber ────────────────────────────────

      form.appendChild(_row('Value', startV, _arrow(), endV));
      form.appendChild(_row('Curve', curveSel));

      const holdRow = document.createElement('div');
      holdRow.style.cssText = 'margin-bottom:7px;padding-left:74px';
      holdRow.appendChild(holdLabel);
      form.appendChild(holdRow);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:4px';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn'; cancelBtn.style.cssText = 'flex:1;font-size:9px'; cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { formBox.innerHTML = ''; });
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn accent'; saveBtn.style.cssText = 'flex:1;font-size:9px'; saveBtn.textContent = isEdit ? 'Save' : 'Add ramp';
      saveBtn.addEventListener('click', () => {
        const newRamp = {
          id:         ramp?.id || _uid(),
          paramId:    paramSel.value,
          timeSource: srcSel.value,
          startTime:  parseFloat(startT.value) || 0,
          endTime:    parseFloat(endT.value)   || 10,
          startValue: parseFloat(startV.value) || 0,
          endValue:   parseFloat(endV.value)   ?? 1,
          curve:      curveSel.value,
          holdEnd:    holdChk.checked,
          enabled:    ramp?.enabled !== false,
        };
        if (isEdit) layer.automation[editIdx] = newRamp;
        else        layer.automation.push(newRamp);
        formBox.innerHTML = '';
        _renderList();
      });
      btnRow.append(cancelBtn, saveBtn);
      form.appendChild(btnRow);
      formBox.appendChild(form);
    }

    addBtn.addEventListener('click', () => _openForm(null, -1));
    _renderList();
    return wrap;
  }

  return {
    render, buildControl, buildSlider, buildDropdown, buildToggle,
    buildColorPicker, buildBandPicker, _buildNameHeader,
    updateLiveValues, renderGlobalModMatrix,
  };

})();
