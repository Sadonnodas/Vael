/**
 * engine/AudioEngine.js
 * Wraps the Web Audio API.
 * Provides smoothed FFT band values (bass, mid, treble, volume)
 * that any layer can read every frame via audioEngine.smoothed.
 *
 * Usage:
 *   const ae = new AudioEngine();
 *   await ae.loadFile(file);
 *   ae.play();
 *   // every frame:
 *   const { bass, mid, treble, volume } = ae.smoothed;
 */

class AudioEngine {

  constructor() {
    this._ctx         = null;
    this._analyser    = null;
    this._source      = null;
    this._buffer      = null;
    this._stream      = null;
    this._rafId       = null;
    this._smoothRafId = null;

    // Playback state
    this.sourceType   = 'none';   // 'none' | 'file' | 'mic'
    this.isPlaying    = false;
    this.loop         = false;    // loop the current file
    this.fileName     = '';
    this._startTime   = 0;        // AudioContext time when playback started
    this._offset      = 0;        // seconds into the track

    // Raw FFT data
    this._fftSize     = 2048;
    this._dataArray   = null;

    // Smoothed output — what layers read
    this.smoothed = { bass: 0, mid: 0, treble: 0, volume: 0, isActive: false };

    // Per-band normaliser for dynamic range compression
    this._normaliser  = new VaelMath.RollingNormaliser({ decay: 0.002, sensitivity: 1.0 });

    // Config
    this.inputSpeed   = 0.05;     // lerp speed for smoothing
    this.bias         = { bass: 1, mid: 1, treble: 1 };

    // Volume
    this._gainNode     = null;
    this._volume       = 1.0;

    // Callbacks
    this.onStateChange = null;    // called when play/pause/stop changes
    this.onBeat        = null;    // called when a beat is detected (future)
  }

  // ── Context ──────────────────────────────────────────────────

  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  _buildAnalyser(ctx) {
    const analyser       = ctx.createAnalyser();
    analyser.fftSize     = this._fftSize;
    analyser.smoothingTimeConstant = 0;   // we do our own smoothing
    if (this._gainNode) { try { this._gainNode.disconnect(); } catch (_) {} }
    this._gainNode = ctx.createGain();
    this._gainNode.gain.value = this._volume;
    analyser.connect(this._gainNode);
    this._gainNode.connect(ctx.destination);
    this._analyser   = analyser;
    this._dataArray  = new Uint8Array(analyser.frequencyBinCount);
    return analyser;
  }

  get volume() { return this._volume; }
  set volume(v) {
    this._volume = Math.max(0, Math.min(2, v));
    if (this._gainNode) this._gainNode.gain.value = this._volume;
  }

  // ── File loading ─────────────────────────────────────────────

  async loadFile(file) {
    this.stop();
    this.fileName   = file.name;
    this.sourceType = 'file';

    const ctx = this._getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      const arrayBuffer  = await file.arrayBuffer();
      this._buffer       = await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error('AudioEngine: could not decode file', e);
      this.sourceType = 'none';
      throw e;
    }

    this._notifyStateChange();
  }

  async loadUrl(url, name = '') {
    this.stop();
    this.fileName   = name || url.split('/').pop();
    this.sourceType = 'file';

    const ctx = this._getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      const resp        = await fetch(url);
      const arrayBuffer = await resp.arrayBuffer();
      this._buffer      = await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error('AudioEngine: could not load URL', url, e);
      this.sourceType = 'none';
      throw e;
    }

    this._notifyStateChange();
  }

  // ── Microphone ───────────────────────────────────────────────

  async startMic() {
    this.stop();
    this.sourceType = 'mic';

    const ctx = this._getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const analyser = this._buildAnalyser(ctx);
      const src      = ctx.createMediaStreamSource(this._stream);
      src.connect(analyser);
      this._source   = src;
      this.isPlaying = true;
      this._startFFT();
      this._startSmoother();
    } catch (e) {
      console.error('AudioEngine: microphone access denied', e);
      this.sourceType = 'none';
      throw e;
    }

    this._notifyStateChange();
  }

  /**
   * Capture system/tab audio via getDisplayMedia.
   * Works in Chrome 74+ — prompts user to share a tab/window WITH audio.
   * This is how you route Spotify, Cubase, or any system audio into Vael.
   */
  async startSystemAudio() {
    this.stop();
    this.sourceType = 'system';

    const ctx = this._getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      // Request screen+audio capture — user picks the audio source
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // Chrome requires video:true even if we only want audio
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate:       44100,
        },
      });

      // Only keep the audio track
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('No audio track in capture — make sure to check "Share tab audio" in the browser prompt');
      }

      // Stop video tracks (we don't need them)
      stream.getVideoTracks().forEach(t => t.stop());

      // Create audio-only stream
      const audioStream = new MediaStream(audioTracks);
      this._stream = audioStream;

      const analyser = this._buildAnalyser(ctx);
      const src      = ctx.createMediaStreamSource(audioStream);
      src.connect(analyser);
      this._source   = src;
      this.isPlaying = true;
      this._startFFT();
      this._startSmoother();

      // Auto-stop when stream ends (user stops sharing)
      audioTracks[0].addEventListener('ended', () => {
        this.stop();
        this._notifyStateChange();
      });

    } catch (e) {
      console.error('AudioEngine: system audio capture failed', e);
      this.sourceType = 'none';
      throw e;
    }

    this._notifyStateChange();
  }

  // ── Playback ─────────────────────────────────────────────────

  play() {
    if (!this._buffer || this.isPlaying) return;

    const ctx      = this._getCtx();
    const analyser = this._buildAnalyser(ctx);
    const src      = ctx.createBufferSource();
    src.buffer     = this._buffer;
    src.loop       = this.loop;   // ← honour loop flag
    src.connect(analyser);
    src.start(0, this._offset);
    src.onended = () => {
      if (this.isPlaying && !this.loop) {
        this._offset   = 0;
        this.isPlaying = false;
        this._stopFFT();
        this._notifyStateChange();
      }
    };

    this._source    = src;
    this._startTime = ctx.currentTime - this._offset;
    this.isPlaying  = true;

    this._startFFT();
    this._startSmoother();
    this._notifyStateChange();
  }

  pause() {
    if (!this.isPlaying || this.sourceType !== 'file') return;
    const ctx = this._getCtx();
    this._offset = ctx.currentTime - this._startTime;
    this._stopSource();
    this.isPlaying = false;
    this._stopFFT();
    this._notifyStateChange();
  }

  stop() {
    this._stopSource();
    this._stopFFT();

    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }

    this._buffer   = null;
    this._offset   = 0;
    this.isPlaying = false;
    this.sourceType = 'none';
    this.fileName  = '';

    this.smoothed  = { bass: 0, mid: 0, treble: 0, volume: 0, isActive: false };
    this._normaliser.reset();

    this._notifyStateChange();
  }

  seekTo(seconds) {
    const buffer = this._buffer;
    if (!buffer) return;
    const clamped = VaelMath.clamp(seconds, 0, buffer.duration);
    this._offset  = clamped;

    if (this.isPlaying) {
      this._stopSource();
      this.isPlaying = false;
      this.play();
    }
  }

  // ── Accessors ────────────────────────────────────────────────

  /** Duration of the loaded file in seconds, or 0 */
  get duration() {
    return this._buffer ? this._buffer.duration : 0;
  }

  /** Current playback position in seconds */
  get currentTime() {
    const ctx = this._ctx;
    if (!ctx) return this._offset;
    if (this.isPlaying && this.sourceType === 'file') {
      return ctx.currentTime - this._startTime;
    }
    return this._offset;
  }

  // ── FFT analysis loop ────────────────────────────────────────

  _startFFT() {
    const loop = () => {
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(this._dataArray);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopFFT() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._smoothRafId) { cancelAnimationFrame(this._smoothRafId); this._smoothRafId = null; }
  }

  /** Separate loop that smooths the raw FFT values */
  _startSmoother() {
    const loop = () => {
      if (!this._dataArray || !this._analyser) return;

      const data = this._dataArray;
      const binCount = this._analyser.frequencyBinCount;
      const sampleRate = this._ctx ? this._ctx.sampleRate : 44100;

      // Band boundaries in Hz
      const bassEnd   = 250;
      const midEnd    = 4000;
      // treble is everything above midEnd

      // Convert Hz to FFT bin index
      const hzToBin = hz => Math.round(hz / (sampleRate / this._fftSize));

      const bassEndBin   = hzToBin(bassEnd);
      const midEndBin    = hzToBin(midEnd);

      const avg = (from, to) => {
        to = Math.min(to, binCount - 1);
        if (from >= to) return 0;
        let sum = 0;
        for (let i = from; i <= to; i++) sum += data[i];
        return sum / ((to - from + 1) * 255);
      };

      const rawBass   = avg(0, bassEndBin)     * this.bias.bass;
      const rawMid    = avg(bassEndBin, midEndBin) * this.bias.mid;
      const rawTreble = avg(midEndBin, binCount)   * this.bias.treble;
      const rawVolume = avg(0, binCount);

      // Normalise each band through the rolling range compressor
      const normBass   = this._normaliser.push('bass',   VaelMath.clamp(rawBass,   0, 1));
      const normMid    = this._normaliser.push('mid',    VaelMath.clamp(rawMid,    0, 1));
      const normTreble = this._normaliser.push('treble', VaelMath.clamp(rawTreble, 0, 1));
      const normVolume = this._normaliser.push('volume', VaelMath.clamp(rawVolume, 0, 1));

      // Lerp toward target
      const s = this.inputSpeed;
      const L = VaelMath.lerp;
      this.smoothed.bass    = L(this.smoothed.bass,   normBass,   s);
      this.smoothed.mid     = L(this.smoothed.mid,    normMid,    s);
      this.smoothed.treble  = L(this.smoothed.treble, normTreble, s);
      this.smoothed.volume  = L(this.smoothed.volume, normVolume, s);
      this.smoothed.isActive = true;

      this._smoothRafId = requestAnimationFrame(loop);
    };
    this._smoothRafId = requestAnimationFrame(loop);
  }

  // ── Internal helpers ─────────────────────────────────────────

  _stopSource() {
    if (this._source) {
      try { this._source.stop(); } catch (_) {}
      this._source.onended = null;
      this._source = null;
    }
    if (this._gainNode) {
      try { this._gainNode.disconnect(); } catch (_) {}
      this._gainNode = null;
    }
    if (this._analyser) {
      try { this._analyser.disconnect(); } catch (_) {}
      this._analyser = null;
    }
    this._dataArray = null;
  }

  _notifyStateChange() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange({
        sourceType: this.sourceType,
        isPlaying:  this.isPlaying,
        fileName:   this.fileName,
        duration:   this.duration,
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────

  dispose() {
    this.stop();
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
  }
}
