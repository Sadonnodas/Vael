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
        options: ['waveform','bars','mirror','radial','particles','spectrogram'] },
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

  toJSON() { return { ...super.toJSON(), params: { ...this.params } }; }
}
