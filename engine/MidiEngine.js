/**
 * engine/MidiEngine.js
 * Wraps the Web MIDI API.
 * Provides MIDI learn mode — click a parameter, move a hardware knob, they link.
 * Links are stored as { channel, cc } → { layerId, paramId, min, max }
 * and can be saved/loaded as part of a preset.
 *
 * Usage:
 *   const midi = new MidiEngine(layerStack);
 *   await midi.init();
 *   midi.startLearn(layerId, paramId, min, max);
 *   midi.stopLearn();
 *
 *   // Every CC message automatically updates the mapped parameter.
 */

class MidiEngine {

  constructor(layerStack) {
    this._layerStack = layerStack;
    this._access     = null;
    this._inputs     = [];
    this._links      = new Map();

    // Learn mode state
    this._learning      = false;
    this._learnLayerId  = null;
    this._learnParamId  = null;
    this._learnMin      = 0;
    this._learnMax      = 1;

    // State
    this.isAvailable    = false;
    this.deviceNames    = [];

    // ── MIDI Clock sync ──────────────────────────────────────────
    // MIDI clock sends 24 pulses per quarter note (24 PPQ).
    // We collect timestamps of incoming 0xF8 messages and derive BPM.
    this.clockSync        = false;   // true = actively syncing to external clock
    this.clockBpm         = 0;       // current BPM derived from clock
    this._clockPulses     = [];      // ring buffer of pulse timestamps (ms)
    this._clockMaxPulses  = 24;      // average over one full beat (24 pulses)
    this._clockLastMs     = 0;
    // Fired whenever a new BPM is computed from the clock
    this.onClockBpm       = null;    // (bpm) → void
    // Fired on MIDI Start (0xFA) and Stop (0xFC) messages
    this.onClockStart     = null;
    this.onClockStop      = null;

    // Callbacks
    this.onLink         = null;
    this.onMessage      = null;
    this.onDeviceChange = null;
  }

  // ── Init ─────────────────────────────────────────────────────

  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('MidiEngine: Web MIDI API not supported in this browser.');
      return false;
    }

    try {
      this._access = await navigator.requestMIDIAccess({ sysex: false });
      this.isAvailable = true;
      this._scanDevices();

      // Listen for device changes
      this._access.onstatechange = () => {
        this._scanDevices();
        if (typeof this.onDeviceChange === 'function') this.onDeviceChange();
      };

      console.log(`MidiEngine: ready — ${this.deviceNames.length} device(s) found`);
      return true;
    } catch (e) {
      console.warn('MidiEngine: access denied or unavailable', e);
      return false;
    }
  }

  // ── Device scanning ──────────────────────────────────────────

  _scanDevices() {
    // Detach old listeners
    this._inputs.forEach(input => { input.onmidimessage = null; });
    this._inputs = [];
    this.deviceNames = [];

    this._access.inputs.forEach(input => {
      this._inputs.push(input);
      this.deviceNames.push(input.name);
      input.onmidimessage = e => this._onMessage(e);
    });
  }

  // ── Incoming MIDI messages ───────────────────────────────────

  _onMessage(event) {
    const [status, data1, data2] = event.data;

    // ── System Real-Time messages (single byte, no channel) ──────
    // These have status bytes >= 0xF8 and carry no data bytes.

    if (status === 0xF8) {
      // MIDI Timing Clock — 24 pulses per quarter note
      this._onClockPulse();
      return;
    }
    if (status === 0xFA) {
      // MIDI Start
      this._clockPulses = [];
      this.clockBpm     = 0;
      if (typeof this.onClockStart === 'function') this.onClockStart();
      return;
    }
    if (status === 0xFC) {
      // MIDI Stop
      this._clockPulses = [];
      if (typeof this.onClockStop === 'function') this.onClockStop();
      return;
    }

    const type    = status & 0xf0;
    const channel = status & 0x0f;

    // CC messages only (type 0xB0)
    if (type !== 0xb0) return;

    const cc    = data1;
    const value = data2 / 127;

    if (typeof this.onMessage === 'function') this.onMessage(channel, cc, value);

    if (this._learning) {
      this._createLink(channel, cc, this._learnLayerId, this._learnParamId,
                       this._learnMin, this._learnMax);
      this._learning = false;
      return;
    }

    const key  = `${channel}-${cc}`;
    const link = this._links.get(key);
    if (link) this._applyLink(link, value);
  }

  _onClockPulse() {
    const now = performance.now();

    // Ignore pulses that arrive impossibly fast (< 5ms apart = > 2500 BPM)
    if (now - this._clockLastMs < 5) return;

    this._clockPulses.push(now);
    this._clockLastMs = now;

    // Keep only the last _clockMaxPulses timestamps
    if (this._clockPulses.length > this._clockMaxPulses + 1) {
      this._clockPulses.shift();
    }

    // Need at least 2 pulses to compute interval
    if (this._clockPulses.length < 2) return;

    // Average interval across all stored pulses
    const n = this._clockPulses.length;
    const totalMs = this._clockPulses[n - 1] - this._clockPulses[0];
    const avgPulseMs = totalMs / (n - 1);

    // 24 pulses per beat → ms per beat = avgPulseMs * 24
    const msPerBeat = avgPulseMs * 24;
    const bpm = Math.round(60000 / msPerBeat);

    // Sanity check: ignore wildly out-of-range values
    if (bpm < 20 || bpm > 400) return;

    this.clockBpm  = bpm;
    this.clockSync = true;

    if (typeof this.onClockBpm === 'function') this.onClockBpm(bpm);
  }

  // ── Learn mode ───────────────────────────────────────────────

  /**
   * Enter learn mode. The next CC message received will be linked
   * to the specified layer parameter.
   */
  startLearn(layerId, paramId, min = 0, max = 1) {
    this._learning     = true;
    this._learnLayerId = layerId;
    this._learnParamId = paramId;
    this._learnMin     = min;
    this._learnMax     = max;
    console.log(`MidiEngine: learning — move a knob to link to ${paramId}`);
  }

  stopLearn() {
    this._learning = false;
  }

  get isLearning() { return this._learning; }

  // ── Links ────────────────────────────────────────────────────

  _createLink(channel, cc, layerId, paramId, min, max) {
    const key  = `${channel}-${cc}`;
    const link = { channel, cc, layerId, paramId, min, max };
    this._links.set(key, link);
    console.log(`MidiEngine: linked ch${channel} CC${cc} → ${paramId}`);
    if (typeof this.onLink === 'function') this.onLink(link);
  }

  removeLink(channel, cc) {
    this._links.delete(`${channel}-${cc}`);
  }

  clearLinks() { this._links.clear(); }

  get links() { return Array.from(this._links.values()); }

  _applyLink(link, normalised) {
    const layer = this._layerStack.layers.find(l => l.id === link.layerId);
    if (!layer || !layer.params) return;

    // Map 0–1 to the param range
    const value = VaelMath.lerp(link.min, link.max, normalised);
    layer.params[link.paramId] = value;
    if (typeof layer.setParam === 'function') layer.setParam(link.paramId, value);
  }

  // ── Serialisation ────────────────────────────────────────────

  toJSON() {
    return { links: Array.from(this._links.entries()).map(([key, link]) => link) };
  }

  fromJSON(data) {
    this._links.clear();
    (data.links || []).forEach(link => {
      this._links.set(`${link.channel}-${link.cc}`, link);
    });
  }
}
