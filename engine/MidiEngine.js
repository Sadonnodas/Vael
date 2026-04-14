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

    // ── Device & channel filtering ───────────────────────────────
    // null = listen to all devices / all channels
    this._selectedDevice  = null;  // device name string or null
    this._filterChannel   = null;  // 0-indexed channel (0 = MIDI ch1), null = all

    // ── Performance profile ──────────────────────────────────────
    // Fixed CC/PC → action mappings that work without learn mode.
    // Designed for the Hotone Ampero Control (CC 64/65/66 + PC on Ch 1).
    this._perfProfile = {
      enabled: false,
      channel: 0,   // 0-indexed (ch1 = 0)
      // CC mappings: { ccNumber: { high: 'action', low: 'action' } }
      // high fires when value >= 64, low fires when value < 64
      cc: {
        64: { high: 'scene:play',  low: 'scene:stop' },
        65: { high: 'scene:prev' },
        66: { high: 'scene:next' },
      },
      programChange: true,  // PC N → scene:jump:N
    };

    // State
    this.isAvailable    = false;
    this.deviceNames    = [];

    // Callbacks
    this.onLink         = null;   // (link) → void, called when a new link is made
    this.onMessage      = null;   // (ch, cc, value) → void, raw message
    this.onDeviceChange = null;   // () → void, devices connected/disconnected
    this.onGlobalAction = null;   // (action) → void, called on global action trigger
    this.onActivity     = null;   // () → void, called on every incoming MIDI message
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
      // Attach listener only if this device is selected (or all devices selected)
      if (!this._selectedDevice || input.name === this._selectedDevice) {
        input.onmidimessage = e => this._onMessage(e);
      }
    });
  }

  /** Select a specific device by name. Pass null to listen to all devices. */
  setSelectedDevice(name) {
    this._selectedDevice = name || null;
    if (this._access) this._scanDevices();
  }

  /** Filter incoming messages to a specific MIDI channel (1-indexed, human-readable).
   *  Pass null or 0 to listen on all channels. */
  setFilterChannel(channel) {
    this._filterChannel = (channel && channel > 0) ? channel - 1 : null;
  }

  /** Enable or configure the performance profile. */
  setPerformanceProfile(config) {
    Object.assign(this._perfProfile, config);
  }

  get selectedDevice()  { return this._selectedDevice; }
  get filterChannel()   { return this._filterChannel === null ? null : this._filterChannel + 1; }
  get perfProfile()     { return this._perfProfile; }

  // ── Incoming MIDI messages ───────────────────────────────────

  _onMessage(event) {
    const [status, data1, data2] = event.data;
    const type    = status & 0xf0;
    const channel = status & 0x0f;

    // ── Activity callback ────────────────────────────────────────
    if (typeof this.onActivity === 'function') this.onActivity();

    // ── Channel filter ───────────────────────────────────────────
    if (this._filterChannel !== null && channel !== this._filterChannel) return;

    // ── Program Change (0xC0) ────────────────────────────────────
    if (type === 0xc0) {
      const program = data1;  // 0-indexed program number
      // Performance profile: PC → scene:jump:N
      if (this._perfProfile.enabled &&
          this._perfProfile.programChange &&
          (this._filterChannel !== null
            ? channel === this._filterChannel
            : channel === this._perfProfile.channel)) {
        if (typeof this.onGlobalAction === 'function') {
          this.onGlobalAction(`scene:jump:${program}`);
        }
      }
      if (typeof this.onMessage === 'function') this.onMessage(channel, `pc`, data1 / 127);
      return;
    }

    // ── Note-on (0x90) for global actions ───────────────────────
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

    // ── CC messages (0xB0) ───────────────────────────────────────
    if (type !== 0xb0) return;

    const cc    = data1;
    const value = data2 / 127;   // normalise to 0–1

    if (typeof this.onMessage === 'function') this.onMessage(channel, cc, value);

    // ── Performance profile CC handling ──────────────────────────
    if (this._perfProfile.enabled) {
      const perfCh = this._filterChannel !== null
        ? this._filterChannel
        : this._perfProfile.channel;
      if (channel === perfCh && this._perfProfile.cc[cc]) {
        const mapping = this._perfProfile.cc[cc];
        const action  = data2 >= 64 ? mapping.high : mapping.low;
        if (action && typeof this.onGlobalAction === 'function') {
          this.onGlobalAction(action);
        }
        return;  // consumed by performance profile — don't fall through
      }
    }

    // ── Learn mode — capture first CC movement ───────────────────
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

    // ── Global learned links (CC threshold: trigger on value > 0) ─
    const ccKey = `cc-${channel}-${cc}`;
    if (this._globalLinks.has(ccKey) && value > 0) {
      if (typeof this.onGlobalAction === 'function') this.onGlobalAction(this._globalLinks.get(ccKey));
      return;
    }

    // ── Per-param links ──────────────────────────────────────────
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
    return {
      links:          Array.from(this._links.entries()).map(([, link]) => link),
      globalLinks:    Array.from(this._globalLinks.entries()).map(([key, action]) => ({ key, action })),
      selectedDevice: this._selectedDevice,
      filterChannel:  this._filterChannel,
      perfProfile:    { ...this._perfProfile },
    };
  }

  fromJSON(data) {
    this._links.clear();
    (data.links || []).forEach(link => {
      this._links.set(`${link.channel}-${link.cc}`, link);
    });
    if (data.globalLinks) {
      this._globalLinks.clear();
      data.globalLinks.forEach(({ key, action }) => this._globalLinks.set(key, action));
    }
    if (data.selectedDevice !== undefined) this._selectedDevice = data.selectedDevice;
    if (data.filterChannel  !== undefined) this._filterChannel  = data.filterChannel;
    if (data.perfProfile) Object.assign(this._perfProfile, data.perfProfile);
    // Re-scan devices to apply new device filter
    if (this._access) this._scanDevices();
  }
}
