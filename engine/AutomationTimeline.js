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
    if (!this.isPlaying || !this._activeClip) return;

    this._playhead = performance.now() / 1000 - this._playStart;

    const dur = this._activeClip.duration;
    if (this._playhead >= dur) {
      if (this.loop) {
        this._playhead  = this._playhead % dur;
        this._playStart = performance.now() / 1000 - this._playhead;
      } else {
        this._playhead = dur;
        this.stop();
        if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead);
        return;
      }
    }

    this._applyFrame(this._playhead);
    if (typeof this.onUpdate === 'function') this.onUpdate(this._playhead);
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
