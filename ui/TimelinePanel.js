/**
 * ui/TimelinePanel.js
 * Automation timeline UI — record, playback, lane view.
 *
 * Layout:
 *   Transport bar  [● REC] [▶ Play] [■ Stop] [⟳ Loop] | Clip name | Duration
 *   Lane list      Scrollable rows, one per recorded param
 *   Mini canvas    Scrollable time ruler + lane curves + playhead
 *
 * Usage:
 *   TimelinePanel.init(timeline, layerStack, container);
 *   TimelinePanel.refresh();   // re-render after external state change
 */

const TimelinePanel = (() => {

  let _tl        = null;   // AutomationTimeline instance
  let _layers    = null;
  let _container = null;

  // Canvas drawing state
  let _canvas    = null;
  let _ctx       = null;
  let _rafId     = null;
  let _viewStart = 0;      // time offset of left edge (seconds)
  let _viewEnd   = 10;     // time offset of right edge (seconds)
  let _isDraggingPlayhead = false;

  const LANE_H   = 28;     // px per lane row
  const RULER_H  = 22;     // px for time ruler
  const LABEL_W  = 120;    // px for lane label column

  // ── Init ─────────────────────────────────────────────────────

  function init(timeline, layerStack, container) {
    _tl        = timeline;
    _layers    = layerStack;
    _container = container;

    _tl.onUpdate = () => _drawCanvas();
    _tl.onStop   = () => _drawCanvas();

    _render();
  }

  function refresh() { _render(); }

  // ── Main render ───────────────────────────────────────────────

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    // ── Transport bar ─────────────────────────────────────────
    const transport = document.createElement('div');
    transport.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0 10px;
      flex-shrink: 0;
    `;

    const recBtn  = _btn('● REC',  _tl.isRecording ? 'btn danger' : 'btn');
    const playBtn = _btn(_tl.isPlaying ? '⏸' : '▶', 'btn accent');
    const stopBtn = _btn('■', 'btn');
    const loopBtn = _btn('⟳', _tl.loop ? 'btn accent' : 'btn');
    loopBtn.title = 'Loop playback';

    recBtn.style.cssText  += ';font-size:9px;padding:5px 10px';
    playBtn.style.cssText += ';font-size:11px;padding:5px 10px;min-width:36px';
    stopBtn.style.cssText += ';font-size:11px;padding:5px 10px';
    loopBtn.style.cssText += ';font-size:11px;padding:5px 10px';

    if (_tl.isRecording) {
      recBtn.style.animation = 'pulse 1s ease-in-out infinite';
    }

    recBtn.addEventListener('click', () => {
      if (_tl.isRecording) {
        _tl.stopRecord();
        Toast.success('Recording stopped');
      } else {
        const name = `Take ${_tl.clips.length + 1}`;
        _tl.startRecord(name);
        Toast.info('Recording… interact with layer params');
      }
      _render();
    });

    playBtn.addEventListener('click', () => {
      if (_tl.isPlaying) { _tl.pause(); }
      else               { _tl.play(); }
      _render();
    });

    stopBtn.addEventListener('click', () => {
      _tl.stop();
      _render();
    });

    loopBtn.addEventListener('click', () => {
      _tl.loop = !_tl.loop;
      _render();
    });

    transport.append(recBtn, playBtn, stopBtn, loopBtn);

    // Clip selector (if multiple clips)
    if (_tl.clips.length > 1) {
      const sel = document.createElement('select');
      sel.style.cssText = `
        flex: 1;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text);
        font-family: var(--font-mono);
        font-size: 9px;
        padding: 4px 6px;
      `;
      _tl.clips.forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.id;
        opt.textContent = `${c.name} (${c.duration.toFixed(1)}s)`;
        opt.selected    = c.id === _tl.activeClip?.id;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', e => {
        _tl.setActiveClip(e.target.value);
        _updateViewRange();
        _render();
      });
      transport.appendChild(sel);
    } else if (_tl.activeClip) {
      const info = document.createElement('span');
      info.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);flex:1';
      info.textContent   = `${_tl.activeClip.name} · ${_tl.activeClip.duration.toFixed(1)}s · ${_tl.activeClip.lanes.length} lane(s)`;
      transport.appendChild(info);
    }

    _container.appendChild(transport);

    // ── Empty state ───────────────────────────────────────────
    if (_tl.clips.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        padding: 20px 0;
        text-align: center;
        font-family: var(--font-mono);
        font-size: 9px;
        color: var(--text-dim);
        line-height: 2;
        border: 1px dashed var(--border-dim);
        border-radius: 6px;
      `;
      empty.innerHTML = `
        No automation recorded yet.<br>
        Click <span style="color:var(--accent)">● REC</span>, interact with
        layer param sliders,<br>then click REC again to stop.<br>
        <span style="color:var(--text-dim);font-size:8px">Tip: use ModMatrix for audio-reactive motion;<br>use the timeline for scripted, repeating automation.</span>
      `;
      _container.appendChild(empty);
      return;
    }

    // ── Timeline canvas ───────────────────────────────────────
    const clip   = _tl.activeClip;
    if (!clip) return;

    const lanes  = clip.lanes;
    const totalH = RULER_H + lanes.length * LANE_H + 2;

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = `
      width: 100%;
      height: ${totalH}px;
      display: block;
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      cursor: pointer;
      flex-shrink: 0;
    `;
    _container.appendChild(_canvas);

    _updateViewRange();
    _resizeCanvas();
    _drawCanvas();

    // Playhead scrub
    _canvas.addEventListener('mousedown', e => {
      if (e.offsetX < LABEL_W) return;
      _isDraggingPlayhead = true;
      _scrubTo(e);
    });
    window.addEventListener('mousemove', e => {
      if (!_isDraggingPlayhead) return;
      _scrubTo(e);
    });
    window.addEventListener('mouseup', () => { _isDraggingPlayhead = false; });

    // Scroll to zoom
    _canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const dur   = clip.duration;
      const range = _viewEnd - _viewStart;
      const zoom  = e.deltaY > 0 ? 1.15 : 0.87;
      const newRange = Math.max(1, Math.min(dur * 2, range * zoom));
      // Keep centre point stable
      const centre = (_viewStart + _viewEnd) / 2;
      _viewStart = Math.max(0, centre - newRange / 2);
      _viewEnd   = _viewStart + newRange;
      _drawCanvas();
    }, { passive: false });

    // Lane list below canvas
    _renderLaneList(clip, lanes);

    // Animate playhead during playback
    const _animLoop = () => {
      if (_tl.isPlaying || _tl.isRecording) _drawCanvas();
      _rafId = requestAnimationFrame(_animLoop);
    };
    _rafId = requestAnimationFrame(_animLoop);
  }

  // ── Lane list (delete controls) ───────────────────────────────

  function _renderLaneList(clip, lanes) {
    if (!lanes.length) return;
    const list = document.createElement('div');
    list.style.cssText = 'margin-top:8px';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px';
    hdr.textContent   = `Recorded lanes (${lanes.length})`;
    list.appendChild(hdr);

    lanes.forEach((lane, i) => {
      const layer = _layers.layers.find(l => l.id === lane.layerId);
      const row   = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        background: var(--bg-card);
        border-radius: 4px;
        margin-bottom: 3px;
      `;
      const hue = (i * 47) % 360;
      row.innerHTML = `
        <div style="width:8px;height:8px;border-radius:50%;background:hsl(${hue},70%,55%);flex-shrink:0"></div>
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${layer?.name ?? lane.layerId} · ${lane.label}
        </span>
        <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim)">${lane.points.length}pt</span>
        <button class="lane-del" style="background:none;border:none;color:#454560;cursor:pointer;font-size:10px">✕</button>
      `;
      row.querySelector('.lane-del').addEventListener('click', () => {
        clip.lanes.splice(i, 1);
        _render();
      });
      list.appendChild(row);
    });

    // Delete clip button
    const delClipBtn = _btn('Delete clip', 'btn');
    delClipBtn.style.cssText += ';width:100%;font-size:9px;margin-top:8px;color:var(--text-dim)';
    delClipBtn.addEventListener('click', () => {
      if (!confirm(`Delete clip "${clip.name}"?`)) return;
      _tl.deleteClip(clip.id);
      _render();
    });
    list.appendChild(delClipBtn);

    _container.appendChild(list);
  }

  // ── Canvas drawing ────────────────────────────────────────────

  function _resizeCanvas() {
    if (!_canvas) return;
    const r = _canvas.getBoundingClientRect();
    _canvas.width  = r.width  || 300;
    _canvas.height = r.height || 100;
    _ctx = _canvas.getContext('2d');
  }

  function _drawCanvas() {
    if (!_ctx || !_canvas || !_tl.activeClip) return;

    const W     = _canvas.width;
    const H     = _canvas.height;
    const clip  = _tl.activeClip;
    const lanes = clip.lanes;
    const dur   = clip.duration;

    _ctx.clearRect(0, 0, W, H);

    // Background
    _ctx.fillStyle = '#0a0a10';
    _ctx.fillRect(0, 0, W, H);

    // Time-to-X helper
    const tToX = t => LABEL_W + (t - _viewStart) / (_viewEnd - _viewStart) * (W - LABEL_W);
    const xToT = x => _viewStart + (x - LABEL_W) / (W - LABEL_W) * (_viewEnd - _viewStart);

    // ── Ruler ─────────────────────────────────────────────────
    _ctx.fillStyle = '#12121c';
    _ctx.fillRect(0, 0, W, RULER_H);
    _ctx.strokeStyle = '#2a2a3a';
    _ctx.lineWidth   = 1;
    _ctx.beginPath();
    _ctx.moveTo(0, RULER_H); _ctx.lineTo(W, RULER_H);
    _ctx.stroke();

    // Tick marks
    const range    = _viewEnd - _viewStart;
    const tickStep = _niceStep(range / 8);
    const firstTick = Math.ceil(_viewStart / tickStep) * tickStep;

    _ctx.fillStyle  = '#7878a0';
    _ctx.font       = '8px monospace';
    _ctx.textAlign  = 'center';
    for (let t = firstTick; t <= _viewEnd; t += tickStep) {
      const x = tToX(t);
      if (x < LABEL_W || x > W) continue;
      _ctx.strokeStyle = '#2a2a3a';
      _ctx.lineWidth   = 0.5;
      _ctx.beginPath();
      _ctx.moveTo(x, RULER_H - 6); _ctx.lineTo(x, RULER_H);
      _ctx.stroke();
      _ctx.fillText(t.toFixed(1) + 's', x, RULER_H - 8);
    }

    // ── Lane backgrounds + curves ─────────────────────────────
    lanes.forEach((lane, i) => {
      const y0  = RULER_H + i * LANE_H;
      const hue = (i * 47) % 360;

      // Alternating bg
      _ctx.fillStyle = i % 2 === 0 ? '#0e0e18' : '#0a0a10';
      _ctx.fillRect(LABEL_W, y0, W - LABEL_W, LANE_H);

      // Lane separator
      _ctx.strokeStyle = '#1e1e2a';
      _ctx.lineWidth   = 0.5;
      _ctx.beginPath();
      _ctx.moveTo(LABEL_W, y0 + LANE_H);
      _ctx.lineTo(W, y0 + LANE_H);
      _ctx.stroke();

      // Label column
      _ctx.fillStyle = '#12121c';
      _ctx.fillRect(0, y0, LABEL_W, LANE_H);
      _ctx.fillStyle = `hsl(${hue},60%,60%)`;
      _ctx.font      = '9px monospace';
      _ctx.textAlign = 'left';
      _ctx.fillText(lane.label, 6, y0 + LANE_H / 2 + 4);

      // Automation curve
      const pts = lane.points.filter(p => p.t >= _viewStart - 0.1 && p.t <= _viewEnd + 0.1);
      if (pts.length === 0) return;

      _ctx.strokeStyle = `hsl(${hue},70%,55%)`;
      _ctx.lineWidth   = 1.5;
      _ctx.beginPath();
      pts.forEach((p, pi) => {
        const x = tToX(p.t);
        const y = y0 + LANE_H - p.v * LANE_H * 0.85 - LANE_H * 0.075;
        if (pi === 0) _ctx.moveTo(x, y);
        else          _ctx.lineTo(x, y);
      });
      _ctx.stroke();

      // Fill under curve
      _ctx.fillStyle = `hsla(${hue},70%,55%,0.08)`;
      _ctx.lineTo(tToX(pts[pts.length - 1].t), y0 + LANE_H);
      _ctx.lineTo(tToX(pts[0].t), y0 + LANE_H);
      _ctx.closePath();
      _ctx.fill();
    });

    // ── Clip end marker ───────────────────────────────────────
    const clipEndX = tToX(dur);
    if (clipEndX >= LABEL_W && clipEndX <= W) {
      _ctx.strokeStyle = '#2a2a4a';
      _ctx.lineWidth   = 1;
      _ctx.setLineDash([4, 4]);
      _ctx.beginPath();
      _ctx.moveTo(clipEndX, RULER_H);
      _ctx.lineTo(clipEndX, H);
      _ctx.stroke();
      _ctx.setLineDash([]);
    }

    // ── Playhead ──────────────────────────────────────────────
    const ph = _tl.isRecording
      ? (performance.now() / 1000 - _tl._recStart)
      : _tl.playhead;

    const phX = tToX(ph);
    if (phX >= LABEL_W && phX <= W) {
      _ctx.strokeStyle = _tl.isRecording ? '#ff4444' : '#00d4aa';
      _ctx.lineWidth   = 1.5;
      _ctx.beginPath();
      _ctx.moveTo(phX, 0);
      _ctx.lineTo(phX, H);
      _ctx.stroke();

      // Playhead head triangle
      _ctx.fillStyle = _tl.isRecording ? '#ff4444' : '#00d4aa';
      _ctx.beginPath();
      _ctx.moveTo(phX - 5, 0);
      _ctx.lineTo(phX + 5, 0);
      _ctx.lineTo(phX, 8);
      _ctx.closePath();
      _ctx.fill();

      // Time readout
      _ctx.fillStyle  = '#fff';
      _ctx.font       = '8px monospace';
      _ctx.textAlign  = 'left';
      const labelX    = Math.min(phX + 4, W - 32);
      _ctx.fillText(ph.toFixed(2) + 's', labelX, 10);
    }

    // Recording red flash dot on ruler
    if (_tl.isRecording) {
      _ctx.fillStyle  = '#ff4444';
      _ctx.font       = '8px monospace';
      _ctx.textAlign  = 'left';
      _ctx.fillText('● REC', 4, RULER_H - 7);
    }
  }

  function _scrubTo(e) {
    if (!_canvas) return;
    const r   = _canvas.getBoundingClientRect();
    const x   = e.clientX - r.left;
    const t   = _viewStart + (x - LABEL_W) / (_canvas.width - LABEL_W) * (_viewEnd - _viewStart);
    _tl.seekTo(Math.max(0, t));
    _drawCanvas();
  }

  function _updateViewRange() {
    const clip = _tl.activeClip;
    if (clip) {
      _viewStart = 0;
      _viewEnd   = Math.max(clip.duration * 1.1, 2);
    }
  }

  function _niceStep(approx) {
    const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30];
    return steps.find(s => s >= approx) || 30;
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _btn(label, cls) {
    const b = document.createElement('button');
    b.className = cls; b.textContent = label; return b;
  }

  return { init, refresh };

})();
