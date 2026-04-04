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
    this._links      = new Map();   // key: `${ch}-${cc}` → { layerId, paramId, min, max }
    this._globalLinks = new Map();  // key: `${type}-${ch}-${num}` → action string
                                    // type: 'cc' | 'note'
                                    // action: 'scene:next' | 'scene:prev' | 'scene:N'

    // Learn mode state
    this._learning      = false;
    this._learnLayerId  = null;
    this._learnParamId  = null;
    this._learnMin      = 0;
    this._learnMax      = 1;
    this._learnGlobal   = false;   // true when learning a global action
    this._learnAction   = null;

    // State
    this.isAvailable    = false;
    this.deviceNames    = [];

    // Callbacks
    this.onLink         = null;   // (link) → void, called when a new link is made
    this.onMessage      = null;   // (ch, cc, value) → void, raw message
    this.onDeviceChange = null;   // () → void, devices connected/disconnected
    this.onGlobalAction = null;   // (action) → void, called on global action trigger
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
    const type    = status & 0xf0;
    const channel = status & 0x0f;

    // Handle note-on (0x90) for global actions
    if (type === 0x90 && data2 > 0) {
      const noteKey = `note-${channel}-${data1}`;
      if (this._learnGlobal) {
        this._globalLinks.set(noteKey, this._learnAction);
        this._learnGlobal = false;
        if (typeof this.onLink === 'function') this.onLink({ type: 'global', key: noteKey, action: this._learnAction });
        return;
      }
      const globalAction = this._globalLinks.get(noteKey);
      if (globalAction && typeof this.onGlobalAction === 'function') {
        this.onGlobalAction(globalAction);
        return;
      }
      if (typeof this.onMessage === 'function') this.onMessage(channel, `note${data1}`, data2 / 127);
      return;
    }

    // CC messages (type 0xB0)
    if (type !== 0xb0) return;

    const cc    = data1;
    const value = data2 / 127;   // normalise to 0–1

    if (typeof this.onMessage === 'function') this.onMessage(channel, cc, value);

    // Learn mode — capture first CC movement
    if (this._learnGlobal) {
      const ccKey = `cc-${channel}-${cc}`;
      this._globalLinks.set(ccKey, this._learnAction);
      this._learnGlobal = false;
      if (typeof this.onLink === 'function') this.onLink({ type: 'global', key: ccKey, action: this._learnAction });
      return;
    }

    if (this._learning) {
      this._createLink(channel, cc, this._learnLayerId, this._learnParamId,
                       this._learnMin, this._learnMax);
      this._learning = false;
      return;
    }

    // Apply global link first (CC threshold: trigger on value > 0)
    const ccKey = `cc-${channel}-${cc}`;
    if (this._globalLinks.has(ccKey) && value > 0) {
      if (typeof this.onGlobalAction === 'function') this.onGlobalAction(this._globalLinks.get(ccKey));
      return;
    }

    // Apply any existing param link
    const key  = `${channel}-${cc}`;
    const link = this._links.get(key);
    if (link) this._applyLink(link, value);
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
    this._learnGlobal  = false;
    console.log(`MidiEngine: learning — move a knob to link to ${paramId}`);
  }

  startLearnGlobal(action) {
    this._learnGlobal = true;
    this._learnAction = action;
    this._learning    = false;
    console.log(`MidiEngine: learning global action "${action}" — press a note or move a CC`);
  }

  stopLearn() {
    this._learning    = false;
    this._learnGlobal = false;
  }

  removeGlobalLink(key) {
    this._globalLinks.delete(key);
  }

  getGlobalLinks() {
    return Array.from(this._globalLinks.entries()).map(([key, action]) => ({ key, action }));
  }

  get isLearning() { return this._learning || this._learnGlobal; }

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
