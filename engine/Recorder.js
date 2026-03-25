/**
 * engine/Recorder.js
 * Captures the main canvas as a WebM video file.
 * Uses the MediaRecorder API — works in Chrome with no libraries.
 */

class Recorder {

  constructor() {
    this.state     = 'idle';   // 'idle' | 'recording' | 'stopped'
    this.duration  = 0;        // seconds recorded
    this.blobUrl   = null;
    this._chunks   = [];
    this._recorder = null;
    this._timer    = null;
    this._startMs  = 0;
    this._prevUrl  = null;
  }

  start(canvas, fps = 60) {
    if (this.state === 'recording') return;
    this._chunks = [];

    // Capture the canvas stream
    const stream = canvas.captureStream(fps);

    // Pick best supported codec
    const mimes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    try {
      this._recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.error('Recorder: MediaRecorder not supported', e);
      return;
    }

    this._recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };

    this._recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: mimeType || 'video/webm' });
      if (this._prevUrl) URL.revokeObjectURL(this._prevUrl);
      this.blobUrl   = URL.createObjectURL(blob);
      this._prevUrl  = this.blobUrl;
      this.state     = 'stopped';
    };

    this._recorder.start(100);   // collect in 100ms chunks
    this._startMs = performance.now();
    this.duration = 0;
    this.state    = 'recording';

    this._timer = setInterval(() => {
      this.duration = Math.round((performance.now() - this._startMs) / 1000);
    }, 1000);
  }

  stop() {
    if (this.state !== 'recording') return;
    clearInterval(this._timer);
    this._recorder?.stop();
    // state is set to 'stopped' in onstop handler
  }

  download(filename = 'vael-recording.webm') {
    if (!this.blobUrl) return;
    const a = document.createElement('a');
    a.href = this.blobUrl;
    a.download = filename;
    a.click();
  }

  reset() {
    if (this.state === 'recording') this.stop();
    clearInterval(this._timer);
    if (this._prevUrl) { URL.revokeObjectURL(this._prevUrl); this._prevUrl = null; }
    this.blobUrl  = null;
    this.duration = 0;
    this.state    = 'idle';
    this._chunks  = [];
  }
}