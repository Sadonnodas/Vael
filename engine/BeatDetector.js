/**
 * engine/BeatDetector.js  — v2
 * Full-spectrum audio analysis with spectral flux onset detection,
 * per-band beat tracking, adaptive threshold, spectral centroid, RMS.
 *
 * New output signals (all merged into audioData by App.js):
 *   isKick / isSnare / isHihat   — per-band one-shot beat flags
 *   kickEnergy / snareEnergy / hihatEnergy  — continuous 0-1 band levels
 *   spectralCentroid  0-1  "brightness" of the sound
 *   spectralSpread    0-1  how wide the energy is spread
 *   spectralFlux      0-1  rate of change this frame (smoothed)
 *   rms               0-1  true RMS energy (smoother than peak)
 *   confidence        0-1  BPM tracking confidence
 *
 * Phrase tracking unchanged: beat 1-4, bar 1-4, phrase 1+,
 * isDownbeat, isBarOne.
 */

class BeatDetector {

  constructor() {
    this.minInterval   = 250;
    this.historySize   = 60;
    this.fluxMult      = 1.5;
    this.smoothing     = 0.3;

    this._prevSpectrum  = null;
    this._fluxHistory   = [];
    this._lastBeatMs    = 0;
    this._beatIntervals = [];
    this._maxIntervals  = 12;

    this._kick  = this._makeBand(1.8);
    this._snare = this._makeBand(1.6);
    this._hihat = this._makeBand(1.7);

    this.isBeat  = false;
    this.isKick  = false;
    this.isSnare = false;
    this.isHihat = false;

    this.bpm              = 0;
    this.confidence       = 0;
    this.spectralCentroid = 0;
    this.spectralSpread   = 0;
    this.spectralFlux     = 0;
    this.rms              = 0;
    this.kickEnergy       = 0;
    this.snareEnergy      = 0;
    this.hihatEnergy      = 0;

    this.beat       = 1;
    this.bar        = 1;
    this.phrase     = 1;
    this.isDownbeat = false;
    this.isBarOne   = false;
    this._beatCount = 0;
    this._barCount  = 0;

    this.onBeat = null;
  }

  _makeBand(mult) {
    return { prevBins: null, fluxHistory: [], lastBeatMs: 0, mult: mult ?? 1.8 };
  }

  update(smoothed, fftData, sampleRate) {
    sampleRate = sampleRate || 44100;
    this.isBeat  = false;
    this.isKick  = false;
    this.isSnare = false;
    this.isHihat = false;

    if (!smoothed || !smoothed.isActive || !fftData || fftData.length === 0) return;

    const N         = fftData.length;
    const nyq       = sampleRate / 2;
    const hzPerBin  = nyq / N;

    // Normalise FFT to 0-1 floats
    const spectrum = new Float32Array(N);
    for (var i = 0; i < N; i++) spectrum[i] = fftData[i] / 255;

    // RMS
    var sumSq = 0;
    for (var i = 0; i < N; i++) sumSq += spectrum[i] * spectrum[i];
    this.rms = this._lerp(this.rms, Math.sqrt(sumSq / N), this.smoothing);

    // Spectral centroid
    var weightedSum = 0, totalEnergy = 0;
    for (var i = 0; i < N; i++) {
      weightedSum += i * spectrum[i];
      totalEnergy += spectrum[i];
    }
    var centroidBin   = totalEnergy > 0 ? weightedSum / totalEnergy : 0;
    var rawCentroid   = centroidBin / N;
    this.spectralCentroid = this._lerp(this.spectralCentroid, rawCentroid, this.smoothing);

    // Spectral spread
    var spreadSum = 0;
    for (var i = 0; i < N; i++) {
      var diff = (i / N) - rawCentroid;
      spreadSum += diff * diff * spectrum[i];
    }
    var rawSpread = totalEnergy > 0 ? Math.sqrt(spreadSum / totalEnergy) : 0;
    this.spectralSpread = this._lerp(this.spectralSpread, rawSpread * 4, this.smoothing);

    // Full-spectrum flux (half-wave rectified)
    var flux = 0;
    if (this._prevSpectrum) {
      for (var i = 0; i < N; i++) {
        var d = spectrum[i] - this._prevSpectrum[i];
        if (d > 0) flux += d;
      }
      flux /= N;
    }
    this._prevSpectrum = spectrum;
    this.spectralFlux = this._lerp(this.spectralFlux, flux, 0.4);

    // Full-spectrum beat
    var now = performance.now();
    this.isBeat = this._detectOnset(
      this._fluxHistory, flux, now, this._lastBeatMs, this.minInterval, this.fluxMult
    );
    if (this.isBeat) {
      if (this._lastBeatMs > 0) {
        this._beatIntervals.push(now - this._lastBeatMs);
        if (this._beatIntervals.length > this._maxIntervals) this._beatIntervals.shift();
        this._updateBPM();
      }
      this._lastBeatMs = now;
      this._advancePhrase();
      if (typeof this.onBeat === 'function') this.onBeat(this._beatPayload());
    }

    // Per-band ranges
    var kickStart  = Math.floor(20   / hzPerBin);
    var kickEnd    = Math.floor(200  / hzPerBin);
    var snareStart = Math.floor(200  / hzPerBin);
    var snareEnd   = Math.floor(2000 / hzPerBin);
    var hihatStart = Math.floor(2000 / hzPerBin);
    var hihatEnd   = Math.min(N - 1, Math.floor(16000 / hzPerBin));

    this.isKick  = this._updateBand(this._kick,  spectrum, kickStart,  kickEnd,  now, this._kick.mult);
    this.isSnare = this._updateBand(this._snare, spectrum, snareStart, snareEnd, now, this._snare.mult);
    this.isHihat = this._updateBand(this._hihat, spectrum, hihatStart, hihatEnd, now, this._hihat.mult);

    this.kickEnergy  = this._lerp(this.kickEnergy,  this._bandEnergy(spectrum, kickStart,  kickEnd),  0.15);
    this.snareEnergy = this._lerp(this.snareEnergy, this._bandEnergy(spectrum, snareStart, snareEnd), 0.15);
    this.hihatEnergy = this._lerp(this.hihatEnergy, this._bandEnergy(spectrum, hihatStart, hihatEnd), 0.15);
  }

  _detectOnset(history, flux, now, lastBeatMs, minInterval, mult) {
    history.push(flux);
    if (history.length > this.historySize) history.shift();
    if (history.length < 8) return false;
    if (now - lastBeatMs < minInterval) return false;
    var median = this._median(history);
    return flux > median * mult && flux > 0.002;
  }

  _updateBand(band, spectrum, startBin, endBin, now, mult) {
    var flux = 0;
    if (band.prevBins) {
      for (var i = startBin; i < endBin; i++) {
        var d = spectrum[i] - band.prevBins[i];
        if (d > 0) flux += d;
      }
      flux /= Math.max(1, endBin - startBin);
    }
    band.prevBins = spectrum.slice(startBin, endBin);
    if (this._detectOnset(band.fluxHistory, flux, now, band.lastBeatMs, this.minInterval, mult)) {
      band.lastBeatMs = now;
      return true;
    }
    return false;
  }

  _bandEnergy(spectrum, startBin, endBin) {
    var sum = 0;
    var count = Math.max(1, endBin - startBin);
    for (var i = startBin; i < endBin; i++) sum += spectrum[i];
    return sum / count;
  }

  _updateBPM() {
    if (this._beatIntervals.length < 3) return;
    var avg = this._beatIntervals.reduce(function(a, b) { return a + b; }, 0) / this._beatIntervals.length;
    var rawBpm = 60000 / avg;
    while (rawBpm > 200) rawBpm /= 2;
    while (rawBpm < 50)  rawBpm *= 2;
    this.bpm = Math.round(rawBpm);
    var variance = this._beatIntervals.reduce(function(a, v) { return a + (v - avg) * (v - avg); }, 0) / this._beatIntervals.length;
    this.confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / avg * 2));
  }

  _advancePhrase() {
    this._beatCount++;
    this.beat       = ((this._beatCount - 1) % 4) + 1;
    this.isDownbeat = this.beat === 1;
    if (this.confidence < 0.4) return;
    if (this.isDownbeat) {
      this._barCount++;
      this.bar      = ((this._barCount - 1) % 4) + 1;
      this.isBarOne = this.bar === 1;
      if (this.isBarOne && this._barCount > 1) this.phrase++;
    }
  }

  _beatPayload() {
    return {
      bpm: this.bpm, confidence: this.confidence,
      beat: this.beat, bar: this.bar, phrase: this.phrase,
      isDownbeat: this.isDownbeat, isBarOne: this.isBarOne,
      isKick: this.isKick, isSnare: this.isSnare, isHihat: this.isHihat,
      spectralCentroid: this.spectralCentroid, rms: this.rms,
    };
  }

  _median(arr) {
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }

  _lerp(a, b, t) { return a + (b - a) * t; }

  reset() {
    this._prevSpectrum  = null;
    this._fluxHistory   = [];
    this._beatIntervals = [];
    this._lastBeatMs    = 0;
    const kickMult  = this._kick?.mult  ?? 1.8;
    const snareMult = this._snare?.mult ?? 1.6;
    const hihatMult = this._hihat?.mult ?? 1.7;
    this._kick   = this._makeBand(kickMult);
    this._snare  = this._makeBand(snareMult);
    this._hihat  = this._makeBand(hihatMult);
    this.bpm = this.confidence = this.spectralCentroid = 0;
    this.spectralSpread = this.spectralFlux = this.rms = 0;
    this.kickEnergy = this.snareEnergy = this.hihatEnergy = 0;
    this.isBeat = this.isKick = this.isSnare = this.isHihat = false;
    this.beat = this.bar = this.phrase = 1;
    this.isDownbeat = this.isBarOne = false;
    this._beatCount = this._barCount = 0;
  }
}
