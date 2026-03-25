/**
 * engine/VideoEngine.js
 * Stub — full implementation in next session.
 */
class VideoEngine {
  constructor() {
    this.sourceType = 'none';
    this.isPlaying  = false;
    this.fileName   = '';
    this.videoUrl   = null;
    this.smoothed   = { brightness: 0, motion: 0, hue: 0, edgeDensity: 0, isActive: false };
    this.onStateChange = null;
  }
  async loadFile(file)  { console.log('VideoEngine.loadFile — coming soon'); }
  async startWebcam()   { console.log('VideoEngine.startWebcam — coming soon'); }
  stop()                {}
  seekTo(s)             {}
  get duration()        { return 0; }
  get currentTime()     { return 0; }
  dispose()             {}
}
