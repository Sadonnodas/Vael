/**
 * engine/VideoEngine.js
 * Manages video input — file or webcam.
 * Exposes per-frame pixel analysis: brightness, motion, hue, edgeDensity.
 */

class VideoEngine {

  constructor() {
    this.sourceType  = 'none';
    this.isPlaying   = false;
    this.fileName    = '';
    this.videoUrl    = null;
    this._videoEl    = null;
    this._stream     = null;
    this._offscreen  = document.createElement('canvas');
    this._offscreen.width  = 64;
    this._offscreen.height = 48;
    this._offCtx     = this._offscreen.getContext('2d', { willReadFrequently: true });
    this._prevFrame  = null;
    this._rafId      = null;
    this._speed      = 0.06;
    this.smoothed    = { brightness: 0, motion: 0, hue: 0, edgeDensity: 0, isActive: false };
    this.onStateChange = null;
  }

  async loadFile(file) {
    this._stopAll();
    this.fileName   = file.name;
    this.sourceType = 'file';
    const url = URL.createObjectURL(file);
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = url;
    const video = document.createElement('video');
    video.src = url; video.loop = true; video.muted = true; video.playsInline = true;
    await video.play();
    this._videoEl  = video;
    this.isPlaying = true;
    this._startAnalysis();
    this._notifyStateChange();
  }

  async startWebcam() {
    this._stopAll();
    this.sourceType = 'webcam';
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video  = document.createElement('video');
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    this._stream = stream; this._videoEl = video;
    this.isPlaying = true;
    this._startAnalysis();
    this._notifyStateChange();
  }

  pause()  { if (this._videoEl && !this._videoEl.paused) { this._videoEl.pause(); this.isPlaying = false; this._notifyStateChange(); } }
  play()   { if (this._videoEl &&  this._videoEl.paused)  { this._videoEl.play();  this.isPlaying = true;  this._notifyStateChange(); } }

  stop() {
    this._stopAll();
    this.sourceType = 'none'; this.fileName = '';
    if (this.videoUrl) { URL.revokeObjectURL(this.videoUrl); this.videoUrl = null; }
    this.smoothed = { brightness: 0, motion: 0, hue: 0, edgeDensity: 0, isActive: false };
    this._notifyStateChange();
  }

  seekTo(s) { if (this._videoEl && isFinite(this._videoEl.duration)) this._videoEl.currentTime = VaelMath.clamp(s, 0, this._videoEl.duration); }
  setSpeed(v) { this._speed = v; }

  get duration()    { return this._videoEl?.duration    || 0; }
  get currentTime() { return this._videoEl?.currentTime || 0; }
  get videoElement(){ return this._videoEl; }

  _startAnalysis() {
    const loop = () => {
      if (this._videoEl && this._videoEl.readyState >= 2) this._analyseFrame();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _analyseFrame() {
    const W = 64, H = 48, totalPx = W * H;
    this._offCtx.drawImage(this._videoEl, 0, 0, W, H);
    const frame = this._offCtx.getImageData(0, 0, W, H).data;
    const prev  = this._prevFrame;
    let sumL = 0, motionSum = 0;
    const hueBuckets = new Array(36).fill(0);

    for (let i = 0; i < totalPx; i++) {
      const r = frame[i*4], g = frame[i*4+1], b = frame[i*4+2];
      const lum = 0.2126*r + 0.7152*g + 0.0722*b;
      sumL += lum;
      if (prev) motionSum += (Math.abs(r-prev[i*4]) + Math.abs(g-prev[i*4+1]) + Math.abs(b-prev[i*4+2])) / 3;
      const maxC = Math.max(r,g,b), delta = maxC - Math.min(r,g,b);
      if (delta > 20) {
        let h = maxC===r ? ((g-b)/delta)%6 : maxC===g ? (b-r)/delta+2 : (r-g)/delta+4;
        hueBuckets[Math.floor(((h*60)+360)%360/10)]++;
      }
    }

    const brightness  = sumL / (totalPx * 255);
    const motion      = prev ? Math.min(motionSum/(totalPx*80), 1) : 0;
    const hue         = (hueBuckets.indexOf(Math.max(...hueBuckets)) * 10 + 5) / 360;
    const avgLum      = sumL / totalPx;
    let edgeSum = 0;
    for (let i = 0; i < totalPx; i++) {
      edgeSum += Math.abs(0.2126*frame[i*4] + 0.7152*frame[i*4+1] + 0.0722*frame[i*4+2] - avgLum);
    }
    const edgeDensity = Math.min(edgeSum/(totalPx*60), 1);
    this._prevFrame   = new Uint8ClampedArray(frame);

    const s = this._speed, l = VaelMath.lerp;
    this.smoothed.brightness  = l(this.smoothed.brightness,  brightness,  s);
    this.smoothed.motion      = l(this.smoothed.motion,      motion,      s);
    this.smoothed.hue         = l(this.smoothed.hue,         hue,         s);
    this.smoothed.edgeDensity = l(this.smoothed.edgeDensity, edgeDensity, s);
    this.smoothed.isActive    = true;
  }

  _stopAll() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._videoEl)  { this._videoEl.pause(); this._videoEl.src = ''; this._videoEl.srcObject = null; this._videoEl = null; }
    if (this._stream)   { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    this._prevFrame = null; this.isPlaying = false;
  }

  _notifyStateChange() {
    if (typeof this.onStateChange === 'function') this.onStateChange({ sourceType: this.sourceType, isPlaying: this.isPlaying, fileName: this.fileName });
  }

  dispose() { this._stopAll(); }
}