/**
 * engine/Recorder.js
 * Stub — full implementation in next session.
 */
class Recorder {
  constructor() {
    this.state    = 'idle';   // 'idle' | 'recording' | 'stopped'
    this.duration = 0;
    this.blobUrl  = null;
  }
  start(canvas) { console.log('Recorder.start — coming soon'); }
  stop()        {}
  download(filename) { console.log('Recorder.download — coming soon'); }
  reset()       { this.state = 'idle'; this.duration = 0; this.blobUrl = null; }
}
