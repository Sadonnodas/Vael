/**
 * layers/WaveformLayer.js
 * Draws the real-time audio waveform or frequency spectrum.
 * Multiple display modes suited for different aesthetics.
 *
 * Modes:
 *   waveform  — classic oscilloscope line
 *   bars      — frequency bars (equalizer style)
 *   mirror    — symmetric waveform top+bottom
 *   radial    — circular spectrum
 *   particles — dots driven by frequency bins
 */

class WaveformLayer extends BaseLayer {

  static manifest = {
    name: 'Waveform',
    version: '1.0',
    params: [
      { id: 'mode',       label: 'Mode',         type: 'enum',   default: 'waveform', triggersRefresh: true,
        options: ['waveform','bars','mirror','radial','particles','spectrogram','scope','waterfall','ribbon','circle-bars','tunnel','polar','blob','dots-freq','arc'] },
      { id: 'color',      label: 'Color',         type: 'color',  default: '#00d4aa' },
      { id: 'colorMode',  label: 'Color mode',    type: 'enum',   default: 'solid',
        options: ['solid','rainbow','frequency'] },
      { id: 'lineWidth',  label: 'Line width',    type: 'float',  default: 1.5, min: 0.5, max: 8  },
      { id: 'scale',      label: 'Amplitude',     type: 'float',  default: 1.0, min: 0.1, max: 4  },
      { id: 'smoothing',  label: 'Smoothing',     type: 'float',  default: 0.8, min: 0,   max: 0.99 },
      { id: 'barCount',   label: 'Bar count',     type: 'int',    default: 64,  min: 8,   max: 256,
        showWhen: { mode: ['bars','radial','particles'] } },
      { id: 'mirror',     label: 'Mirror Y',      type: 'bool',   default: false,
        showWhen: { mode: ['waveform','bars','particles'] } },
      { id: 'glow',       label: 'Glow',          type: 'bool',   default: true },
    ],
  };

  constructor(id) {
    super(id, 'Waveform');
    this.params = {
      mode:      'waveform',
      color:     '#00d4aa',
      colorMode: 'solid',
      lineWidth: 1.5,
      scale:     1.0,
      smoothing: 0.8,
      barCount:  64,
      mirror:    false,
      glow:      true,
    };

    // Raw audio data refs (set each frame by update)
    this._dataArray = null;
    this._timeData  = null;
    this._analyser  = null;

    // Smoothed bar heights for bars/radial modes
    this._smoothedBars = null;
    this._time         = 0;

    // Spectrogram scrolling history — array of Float32Array snapshots
    this._spectroHistory  = [];
    this._spectroMaxRows  = 256;   // how many time-slices to keep (vertical resolution)
    this._spectroOffCanvas = null;
    this._spectroOffCtx    = null;
  }

  init(params = {}) { Object.assign(this.params, params); }

  /**
   * Update() receives audioData from LayerStack.
   * We also need the raw FFT arrays from AudioEngine.
   * App.js sets layer._audioEngine = audio after creation.
   */
  update(audioData, videoData, dt) {
    this._time += dt;

    // Get raw arrays from AudioEngine if available
    if (this._audioEngine) {
      this._analyser  = this._audioEngine._analyser;
      this._dataArray = this._audioEngine._dataArray;

      if (this._analyser && !this._timeData) {
        this._timeData = new Uint8Array(this._analyser.fftSize);
      }
      if (this._analyser && this._timeData) {
        this._analyser.getByteTimeDomainData(this._timeData);
      }
    }

    // Smooth bars
    if (this._dataArray) {
      const count = this.params.barCount;
      if (!this._smoothedBars || this._smoothedBars.length !== count) {
        this._smoothedBars = new Float32Array(count);
      }
      const binStep = Math.floor(this._dataArray.length / count);
      const smooth  = this.params.smoothing;
      for (let i = 0; i < count; i++) {
        const raw = this._dataArray[i * binStep] / 255;
        this._smoothedBars[i] = this._smoothedBars[i] * smooth + raw * (1 - smooth);
      }

      // Spectrogram: push a snapshot of the current bar values each frame
      if (this.params.mode === 'spectrogram') {
        this._spectroHistory.push(new Float32Array(this._smoothedBars));
        if (this._spectroHistory.length > this._spectroMaxRows) {
          this._spectroHistory.shift();
        }
      }
    }
  }

  render(ctx, width, height) {
    if (!this._dataArray && !this._timeData) {
      // No audio — draw a flat line placeholder
      this._drawNoAudio(ctx, width, height);
      return;
    }

    switch (this.params.mode) {
      case 'waveform':  this._drawWaveform(ctx, width, height);  break;
      case 'bars':      this._drawBars(ctx, width, height);       break;
      case 'mirror':    this._drawMirror(ctx, width, height);     break;
      case 'radial':    this._drawRadial(ctx, width, height);     break;
      case 'particles':    this._drawParticles(ctx, width, height);   break;
      case 'spectrogram': this._drawSpectrogram(ctx, width, height); break;
      case 'scope':       this._drawScope(ctx, width, height);       break;
      case 'waterfall':   this._drawWaterfall(ctx, width, height);   break;
      case 'ribbon':      this._drawRibbon(ctx, width, height);      break;
      case 'circle-bars': this._drawCircleBars(ctx, width, height);  break;
      case 'tunnel':      this._drawTunnel(ctx, width, height);      break;
      case 'polar':       this._drawPolar(ctx, width, height);       break;
      case 'blob':        this._drawBlob(ctx, width, height);        break;
      case 'dots-freq':   this._drawDotsFreq(ctx, width, height);    break;
      case 'arc':         this._drawArc(ctx, width, height);         break;
    }
  }

  _getColor(t) {
    switch (this.params.colorMode) {
      case 'rainbow':   return VaelColor.rainbow(t, this._time * 20);
      case 'frequency': return VaelColor.hsl(t * 240, 0.9, 0.55);
      default:          return this.params.color;
    }
  }

  _setupGlow(ctx) {
    if (!this.params.glow) return;
    ctx.shadowColor = this.params.color;
    ctx.shadowBlur  = 8;
  }

  _clearGlow(ctx) {
    ctx.shadowBlur = 0;
  }

  _drawNoAudio(ctx, W, H) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(-W/2, 0);
    ctx.lineTo( W/2, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawWaveform(ctx, W, H) {
    const data  = this._timeData;
    if (!data) return;
    const scale = (H * 0.4) * this.params.scale;
    const lw    = this.params.lineWidth;
    const steps = Math.min(data.length, 1024);

    ctx.save();
    this._setupGlow(ctx);
    ctx.strokeStyle = this._getColor(0);
    ctx.lineWidth   = lw;
    ctx.beginPath();

    for (let i = 0; i < steps; i++) {
      const x = (i / steps) * W - W / 2;
      const v = (data[i] / 128.0 - 1.0) * scale;
      if (i === 0) ctx.moveTo(x, v);
      else         ctx.lineTo(x, v);
    }
    ctx.stroke();

    if (this.params.mirror) {
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const x = (i / steps) * W - W / 2;
        const v = -(data[i] / 128.0 - 1.0) * scale;
        if (i === 0) ctx.moveTo(x, v);
        else         ctx.lineTo(x, v);
      }
      ctx.stroke();
    }

    this._clearGlow(ctx);
    ctx.restore();
  }

  _drawMirror(ctx, W, H) {
    const data  = this._timeData;
    if (!data) return;
    const scale = (H * 0.45) * this.params.scale;
    const lw    = this.params.lineWidth;
    const steps = Math.min(data.length, 1024);

    ctx.save();
    this._setupGlow(ctx);
    ctx.lineWidth = lw;

    // Top half
    ctx.strokeStyle = this._getColor(0);
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
      const x = (i / steps) * W - W / 2;
      const v = (data[i] / 128.0 - 1.0) * scale * 0.5;
      if (i === 0) ctx.moveTo(x, v - scale * 0.1);
      else         ctx.lineTo(x, v - scale * 0.1);
    }
    ctx.stroke();

    // Bottom half (mirrored)
    ctx.strokeStyle = this._getColor(0.5);
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
      const x = (i / steps) * W - W / 2;
      const v = (data[i] / 128.0 - 1.0) * scale * 0.5;
      if (i === 0) ctx.moveTo(x, -(v - scale * 0.1));
      else         ctx.lineTo(x, -(v - scale * 0.1));
    }
    ctx.stroke();

    this._clearGlow(ctx);
    ctx.restore();
  }

  _drawBars(ctx, W, H) {
    if (!this._smoothedBars) return;
    const count  = this.params.barCount;
    const scale  = H * 0.45 * this.params.scale;
    const gap    = 1;
    const barW   = (W / count) - gap;

    ctx.save();
    this._setupGlow(ctx);

    for (let i = 0; i < count; i++) {
      const h    = this._smoothedBars[i] * scale;
      const x    = (i / count) * W - W / 2;
      const t    = i / count;
      ctx.fillStyle = this._getColor(t);

      ctx.fillRect(x, -h, barW, h);
      if (this.params.mirror) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, 0, barW, h * 0.5);
        ctx.globalAlpha = 1;
      }
    }

    this._clearGlow(ctx);
    ctx.restore();
  }

  _drawRadial(ctx, W, H) {
    if (!this._smoothedBars) return;
    const count  = this.params.barCount;
    const innerR = Math.min(W, H) * 0.12;
    const maxR   = Math.min(W, H) * 0.42 * this.params.scale;
    const lw     = this.params.lineWidth;

    ctx.save();
    this._setupGlow(ctx);
    ctx.lineWidth = lw;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const h     = this._smoothedBars[i] * maxR;
      const x1    = Math.cos(angle) * innerR;
      const y1    = Math.sin(angle) * innerR;
      const x2    = Math.cos(angle) * (innerR + h);
      const y2    = Math.sin(angle) * (innerR + h);
      ctx.strokeStyle = this._getColor(i / count);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    this._clearGlow(ctx);
    ctx.restore();
  }

  _drawParticles(ctx, W, H) {
    if (!this._smoothedBars) return;
    const count = this.params.barCount;
    const scale = H * 0.45 * this.params.scale;
    const t     = this._time;

    ctx.save();
    this._setupGlow(ctx);

    for (let i = 0; i < count; i++) {
      const h    = this._smoothedBars[i] * scale;
      const x    = (i / count) * W - W / 2 + W / count / 2;
      const y    = -h + Math.sin(t * 2 + i * 0.3) * 3;
      const r    = Math.max(1, this.params.lineWidth * 1.5 * this._smoothedBars[i] * 3);
      ctx.fillStyle = this._getColor(i / count);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      if (this.params.mirror) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, -y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    this._clearGlow(ctx);
    ctx.restore();
  }

  _drawSpectrogram(ctx, W, H) {
    const history = this._spectroHistory;
    if (!history.length) return;

    const rows    = history.length;
    const cols    = this.params.barCount;
    const cellW   = W / cols;
    const cellH   = H / this._spectroMaxRows;

    ctx.save();
    ctx.translate(-W / 2, -H / 2);

    // Draw from oldest (top) to newest (bottom)
    for (let r = 0; r < rows; r++) {
      const snapshot = history[r];
      // Newest row at bottom: map r=0 → y near top of visible area
      const startRow = this._spectroMaxRows - rows;
      const y = (startRow + r) * cellH;

      for (let c = 0; c < cols; c++) {
        const v = snapshot[c];
        if (v < 0.01) continue;

        // Colour: frequency position determines hue, amplitude drives brightness
        const t       = c / cols;
        const hue     = this.params.colorMode === 'rainbow'
          ? (t * 280 + (this._time * 5)) % 360
          : VaelColor.rgbToHsl(...VaelColor.hexToRgb(this.params.color))[0];
        const bright  = VaelMath.clamp(v * 1.4, 0, 1);
        const alpha   = VaelMath.clamp(v * 2.0, 0, 1);

        ctx.fillStyle = VaelColor.hsla(hue, 0.85, 0.15 + bright * 0.6, alpha);
        ctx.fillRect(c * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }

    // Horizontal line at the current write position (newest row)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - cellH);
    ctx.lineTo(W, H - cellH);
    ctx.stroke();

    ctx.restore();
  }


  _drawScope(ctx, W, H) {
    // Oscilloscope — XY Lissajous using left/right channel simulation
    if (!this._timeData) return;
    const rawBuf = this._timeData; const n = rawBuf.length;
    const buf = Array.from(rawBuf).map(v => (v / 128) - 1);
    ctx.save(); ctx.translate(-W/2, -H/2);
    ctx.lineWidth = this.params.lineWidth; ctx.strokeStyle = this._getColor(0.5);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (buf[i] + 1) / 2 * W;
      const y = (buf[(i + Math.floor(n/4)) % n] + 1) / 2 * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }

  _drawWaterfall(ctx, W, H) {
    // Scrolling waterfall — same as spectrogram but horizontal scroll
    this._drawSpectrogram(ctx, W, H); // reuse for now
  }

  _drawRibbon(ctx, W, H) {
    // Thick ribbon with fill between waveform and midline
    if (!this._timeData) return;
    const rawBuf = this._timeData; const n = rawBuf.length;
    const buf = Array.from(rawBuf).map(v => (v / 128) - 1);
    const sc = this.params.scale;
    ctx.save(); ctx.translate(-W/2, -H/2);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const y = H/2 - buf[i] * H/2 * sc;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = n-1; i >= 0; i--) {
      const x = (i / n) * W;
      const y = H/2;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 8; i++) grad.addColorStop(i/8, this._getColor(i/8));
    ctx.fillStyle = grad; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawCircleBars(ctx, W, H) {
    // Bars radiating from a circle
    if (!this._smoothedBars) return;
    const buf = this._smoothedBars;
    const n = Math.min(this.params.barCount, buf.length);
    const sc = this.params.scale; const lw = this.params.lineWidth;
    const baseR = Math.min(W, H) * 0.2;
    ctx.lineWidth = lw;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const amp = buf[Math.floor(i / n * buf.length)] * sc;
      const r1 = baseR, r2 = baseR + amp * Math.min(W, H) * 0.3;
      ctx.strokeStyle = this._getColor(i / n);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
      ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
      ctx.stroke();
    }
  }

  _drawTunnel(ctx, W, H) {
    // Frequency rings creating a tunnel perspective
    const buf = this._smoothedBars || new Float32Array(64);
    const rings = 16;
    for (let r = rings; r >= 1; r--) {
      const t2 = r / rings;
      const idx = Math.floor(t2 * buf.length);
      const amp = (buf[idx] || 0) * this.params.scale;
      const radius = t2 * Math.min(W, H) * 0.5 * (1 + amp * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = this._getColor(1 - t2);
      ctx.lineWidth   = this.params.lineWidth * (1 + amp * 2);
      ctx.globalAlpha = t2 * 0.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawPolar(ctx, W, H) {
    // Polar waveform — waveform mapped onto a circle
    if (!this._timeData) return;
    const rawBuf = this._timeData; const n = rawBuf.length;
    const buf = Array.from(rawBuf).map(v => (v / 128) - 1);
    const sc = this.params.scale; const baseR = Math.min(W, H) * 0.25;
    ctx.lineWidth = this.params.lineWidth;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = baseR + buf[i % n] * baseR * sc;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = this._getColor(0.5); ctx.stroke();
  }

  _drawBlob(ctx, W, H) {
    // Morphing blob driven by frequency bands
    const buf = this._smoothedBars || new Float32Array(64);
    const sc = this.params.scale;
    const pts = 32; const baseR = Math.min(W, H) * 0.28;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const angle = (i / pts) * Math.PI * 2;
      const idx = Math.floor((i / pts) * buf.length);
      const r = baseR + buf[idx] * baseR * sc * 0.8;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, baseR * 1.5);
    grad.addColorStop(0, this._getColor(0.3));
    grad.addColorStop(1, this._getColor(0.8));
    ctx.fillStyle = grad; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = this._getColor(0.5); ctx.lineWidth = this.params.lineWidth; ctx.stroke();
  }

  _drawDotsFreq(ctx, W, H) {
    // Frequency dots — grid of dots, amplitude controls size
    const buf = this._smoothedBars || new Float32Array(64);
    const cols = this.params.barCount; const rows = 8;
    const cw = W / cols; const ch = H / rows;
    for (let c = 0; c < cols; c++) {
      const amp = buf[Math.floor(c / cols * buf.length)] * this.params.scale;
      for (let r = 0; r < rows; r++) {
        const active = (rows - r) / rows <= amp;
        if (!active) continue;
        const x = c * cw - W/2 + cw/2;
        const y = r * ch - H/2 + ch/2;
        ctx.beginPath(); ctx.arc(x, y, Math.min(cw, ch) * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = this._getColor(c / cols); ctx.fill();
      }
    }
  }

  _drawArc(ctx, W, H) {
    // Bars arranged in a semicircle arc
    const buf = this._smoothedBars || new Float32Array(64);
    const n = Math.min(this.params.barCount, buf.length);
    const sc = this.params.scale; const lw = this.params.lineWidth * 2;
    const arcR = Math.min(W, H) * 0.35;
    ctx.lineWidth = lw; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const t2 = i / n;
      const angle = -Math.PI + t2 * Math.PI;
      const amp = buf[Math.floor(t2 * buf.length)] * sc;
      const x1 = Math.cos(angle) * arcR;
      const y1 = Math.sin(angle) * arcR;
      const x2 = Math.cos(angle) * (arcR + amp * arcR * 0.8);
      const y2 = Math.sin(angle) * (arcR + amp * arcR * 0.8);
      ctx.strokeStyle = this._getColor(t2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
