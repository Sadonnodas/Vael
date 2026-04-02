/**
 * engine/AutomationTimeline.js
 * Records and plays back parameter automation for any layer param.
 *
 * Architecture
 * ─────────────
 * A "clip" is a recording session with a start time and an array of "lanes".
 * Each lane tracks one param on one layer: { layerId, paramId, points[] }
 * where each point is { t, v } — time offset in seconds, normalised value 0–1.
 *
 * Recording: AutomationTimeline.startRecord() begins capturing.
 * Any call to layer.setParam() during recording is intercepted and stored.
 * AutomationTimeline.stopRecord() ends the clip.
 *
 * Playback: AutomationTimeline.play() loops the clip from t=0.
 * Each frame, values are interpolated and written to layer params.
 *
 * The UI (TimelinePanel) renders a scrollable lane view, a playhead,
 * and transport controls.
 */

class AutomationTimeline {

  constructor({ layerStack }) {
    this._layers    = layerStack;

    // Recording state
    this.isRecording = false;
    this._recStart   = 0;
    this._recClip    = null;   // the clip being recorded into

    // Clips — array of { id, name, duration, lanes[] }
    this.clips       = [];
    this._activeClip = null;

    // Playback state
    this.isPlaying   = false;
    this._playStart  = 0;
    this._playhead   = 0;   // seconds from clip start
    this.loop        = true;

    // Play modes: 'forward' | 'reverse' | 'pingpong' | 'random'
    this.playMode    = 'forward';
    this._pingDir    = 1;    // 1 = forward, -1 = backward in pingpong mode
    this.inPoint     = 0;    // loop region start (seconds)
    this.outPoint    = null; // loop region end (null = use clip.duration)
    this.crossfade   = 0;    // crossfade time at loop point (seconds)

    // Callbacks
    this.onUpdate    = null;   // (playhead) → void — called each frame during playback
    this.onStop      = null;
  }

  // ── Recording ─────────────────────────────────────────────────

  startRecord(name = 'Take') {
    if (this.isRecording) this.stopRecord();
    if (this.isPlaying)   this.stop();

    this._recClip = {
      id:       `clip-${Date.now()}`,
      name,
      duration: 0,
      lanes:    new Map(),   // key: `${layerId}::${paramId}` → { layerId, paramId, points[] }
    };

    this._recStart   = performance.now() / 1000;
    this.isRecording = true;
    console.log(`AutomationTimeline: recording "${name}"`);
  }

  /**
   * Called by App.js whenever a param changes during recording.
   * @param {string} layerId
   * @param {string} paramId
   * @param {number} value     raw param value
   * @param {object} manifest  param manifest entry (for min/max normalisation)
   */
  recordPoint(layerId, paramId, value, manifest) {
    if (!this.isRecording || !this._recClip) return;

    const t   = performance.now() / 1000 - this._recStart;
    const key = `${layerId}::${paramId}`;

    if (!this._recClip.lanes.has(key)) {
      this._recClip.lanes.set(key, {
        layerId,
        paramId,
        label:  manifest?.label || paramId,
        min:    manifest?.min   ?? 0,
        max:    manifest?.max   ?? 1,
        points: [],
      });
    }

    // Normalise value to 0–1
    const lane  = this._recClip.lanes.get(key);
    const range = lane.max - lane.min;
    const v     = range > 0 ? Math.max(0, Math.min(1, (value - lane.min) / range)) : 0;
    lane.points.push({ t, v });
  }

  stopRecord() {
    if (!this.isRecording || !this._recClip) return;

    const duration = performance.now() / 1000 - this._recStart;
    this._recClip.duration = Math.max(0.1, duration);

    // Convert lanes Map to Array for serialisation
    const clip = {
      ...this._recClip,
      lanes: Array.from(this._recClip.lanes.values()),
    };

    this.clips.push(clip);
    this._activeClip = clip;
    this.isRecording = false;
    this._recClip    = null;

    console.log(`AutomationTimeline: recorded "${clip.name}" — ${clip.duration.toFixed(1)}s, ${clip.lanes.length} lane(s)`);
    if (typeof this.onUpdate === 'function') this.onUpdate(0);
    return clip;
  }

  // ── Playback ─────────────────────────────────────────────────

  play(clip = null) {
    if (this.isRecording) return;
    this._activeClip = clip || this._activeClip || this.clips[this.clips.length - 1];
    if (!this._activeClip) return;

    this.isPlaying  = true;
    this._playStart = performance.now() / 1000 - this._playhead;

    // Multi-clip: each clip gets its own playStart for independent looping
    if (this.playAll) {
      const now = performance.now() / 1000;
      this.clips.forEach(c => { if (!c._playStart) c._playStart = now; });
    }
  }

  /** Play all recorded clips simultaneously, each looping independently. */
  playAll() {
    if (this.isRecording || this.clips.length === 0) return;
    this._playAllMode = true;
    this.isPlaying    = true;
    const now = performance.now() / 1000;
    this.clips.forEach(c => { c._playStart = now; c._playhead = 0; });
    this._activeClip  = this.clips[this.clips.length - 1]; // for UI display
  }

  stopAll() {
    this._playAllMode = false;
    this.stop();
    this.clips.forEach(c => { c._playStart = null; c._playhead = 0; });
  }

  pause() {
    this.isPlaying = false;
  }

  stop() {
    this.isPlaying  = false;
    this._playhead  = 0;
    if (typeof this.onStop === 'function') this.onStop();
  }

  seekTo(t) {
    this._playhead  = Math.max(0, t);
    this._playStart = performance.now() / 1000 - this._playhead;
    if (!this.isPlaying) this._applyFrame(this._playhead);
  }

  // ── Per-frame tick ────────────────────────────────────────────

  tick(dt) {
    if (!this.isPlaying) return;

    // Multi-clip mode: apply all clips independently
    if (this._playAllMode) {
      const now2 = performance.now() / 1000;
      this.clips.forEach(clip => {
        if (!clip._playStart) return;
        let ph = now2 - clip._playStart;
        if (ph >= clip.duration) {
          if (this.loop) { ph = ph % clip.duration; clip._playStart = now2 - ph; }
          else { ph = clip.duration; }
        }
        clip._playhead = ph;
        this._applyClip(clip, ph);
      });
      if (typeof this.onUpdate === 'function') this.onUpdate(this._activeClip?._playhead ?? 0);
      return;
    }

    if (!this._activeClip) return;

    const clip  = this._activeClip;
    const dur   = clip.duration;
    const inPt  = Math.max(0, this.inPoint || 0);
    const outPt = Math.min(dur, this.outPoint ?? dur);
    const range = Math.max(0.01, outPt - inPt);
    const now   = performance.now() / 1000;

    // Advance playhead based on play mode
    if (this.playMode === 'reverse') {
      this._playhead = outPt - (now - this._playStart);
    } else {
      this._playhead = inPt + (now - this._playStart);
    }

    if (this.playMode === 'forward' || !this.playMode) {
      if (this._playhead >= outPt) {
        if (this.loop) {
          this._playhead  = inPt + (this._playhead - outPt) % range;
          this._playStart = now - (this._playhead - inPt);
        } else {
          this._playhead = outPt; this.stop();
          if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead); return;
        }
      }
    } else if (this.playMode === 'reverse') {
      if (this._playhead <= inPt) {
        if (this.loop) {
          this._playhead  = outPt - (inPt - this._playhead) % range;
          this._playStart = now - (outPt - this._playhead);
        } else {
          this._playhead = inPt; this.stop();
          if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead); return;
        }
      }
    } else if (this.playMode === 'pingpong') {
      if (!this._pingDir) this._pingDir = 1;
      const raw = now - this._playStart;
      const period = range * 2;
      const pos    = raw % period;
      this._playhead = pos < range ? inPt + pos : outPt - (pos - range);
      this._pingDir  = pos < range ? 1 : -1;
    } else if (this.playMode === 'random') {
      if (this._playhead >= outPt || !this._randJumped) {
        this._randJumped = true;
        this._playhead   = inPt + Math.random() * range;
        this._playStart  = now - (this._playhead - inPt);
      }
    }

    // Crossfade at loop point
    if (this.crossfade > 0 && (this.playMode === 'forward' || !this.playMode)) {
      const fadeOut = outPt - this._playhead;
      if (fadeOut > 0 && fadeOut < this.crossfade) {
        const mix     = 1 - fadeOut / this.crossfade;
        const loopPh  = inPt + (this.crossfade - fadeOut);
        this._applyFrameMixed(this._playhead, loopPh, mix);
        if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead);
        return;
      }
    }

    this._applyFrame(this._playhead);
    if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead);
  }

  _applyFrameMixed(t1, t2, mix) {
    if (!this._activeClip) return;
    this._activeClip.lanes.forEach(lane => {
      const layer = this._layers.layers.find(l => l.id === lane.layerId);
      if (!layer?.params) return;
      const v1 = this._interpolate(lane.points, t1);
      const v2 = this._interpolate(lane.points, t2);
      if (v1 === null) return;
      const r = lane.max - lane.min;
      layer.params[lane.paramId] = (lane.min + v1 * r) * (1 - mix) + (lane.min + (v2 ?? v1) * r) * mix;
    });
  }


  _applyClip(clip, t) {
    clip.lanes.forEach(lane => {
      const layer = this._layers.layers.find(l => l.id === lane.layerId);
      if (!layer || !layer.params) return;
      const v = this._interpolate(lane.points, t);
      if (v === null) return;
      const range = lane.max - lane.min;
      layer.params[lane.paramId] = lane.min + v * range;
    });
  }

  _applyFrame(t) {
    if (!this._activeClip) return;
    this._activeClip.lanes.forEach(lane => {
      const layer = this._layers.layers.find(l => l.id === lane.layerId);
      if (!layer || !layer.params) return;

      const v = this._interpolate(lane.points, t);
      if (v === null) return;

      // Denormalise
      const range = lane.max - lane.min;
      const value = lane.min + v * range;
      layer.params[lane.paramId] = value;
      if (typeof layer.setParam === 'function') {
        // Bypass normal setParam to avoid re-recording
        layer.params[lane.paramId] = value;
      }
    });
  }

  _interpolate(points, t) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) return points[0].v;

    // Find surrounding points
    let lo = null, hi = null;
    for (let i = 0; i < points.length; i++) {
      if (points[i].t <= t) lo = points[i];
      else if (!hi)         hi = points[i];
    }
    if (!lo) return points[0].v;
    if (!hi) return lo.v;

    const span = hi.t - lo.t;
    if (span < 0.0001) return lo.v;
    const frac = (t - lo.t) / span;
    return lo.v + (hi.v - lo.v) * frac;
  }

  // ── Clip management ───────────────────────────────────────────

  deleteClip(id) {
    this.clips = this.clips.filter(c => c.id !== id);
    if (this._activeClip?.id === id) {
      this.stop();
      this._activeClip = this.clips[this.clips.length - 1] || null;
    }
  }

  renameClip(id, name) {
    const clip = this.clips.find(c => c.id === id);
    if (clip) clip.name = name;
  }

  setActiveClip(id) {
    const clip = this.clips.find(c => c.id === id);
    if (clip) { this.stop(); this._activeClip = clip; }
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON() {
    return { clips: this.clips, loop: this.loop };
  }

  fromJSON(data) {
    this.clips       = data.clips || [];
    this.loop        = data.loop  ?? true;
    this._activeClip = this.clips[this.clips.length - 1] || null;
  }

  get playhead()    { return this._playhead; }
  get activeClip()  { return this._activeClip; }
}
