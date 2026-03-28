/**
 * engine/Recorder.js
 * Captures the main canvas + audio as a WebM video file.
 *
 * FIX: Audio is now recorded alongside the video.
 * Pass audioEngine to start() — it creates a MediaStreamAudioDestinationNode
 * from the AudioContext and merges the audio track into the canvas stream.
 * If no audioEngine is passed (or no audio is active), records video only.
 */

class Recorder {

  constructor() {
    this.state     = 'idle';
    this.duration  = 0;
    this.blobUrl   = null;
    this._chunks   = [];
    this._recorder = null;
    this._timer    = null;
    this._startMs  = 0;
    this._prevUrl  = null;
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number}            fps
   * @param {AudioEngine}       audioEngine  — optional, for audio recording
   */
  start(canvas, fps = 60, audioEngine = null) {
    if (this.state === 'recording') return;
    this._chunks = [];

    // Canvas video stream
    const videoStream = canvas.captureStream(fps);

    // Try to get an audio stream from the AudioContext
    let combinedStream = videoStream;
    try {
      if (audioEngine?._ctx && audioEngine.isPlaying) {
        const ctx      = audioEngine._ctx;
        const dest     = ctx.createMediaStreamDestination();

        // Connect the analyser (which sits between source and destination)
        // to our recording destination as well
        if (audioEngine._analyser) {
          audioEngine._analyser.connect(dest);
        }

        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          // Merge: take video tracks + audio tracks into one stream
          combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioTracks,
          ]);
        }
      }
    } catch (e) {
      console.warn('Recorder: could not attach audio — recording video only', e);
      combinedStream = videoStream;
    }

    const mimes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    try {
      this._recorder = new MediaRecorder(
        combinedStream,
        mimeType ? { mimeType } : undefined
      );
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
      this.blobUrl  = URL.createObjectURL(blob);
      this._prevUrl = this.blobUrl;
      this.state    = 'stopped';

      // Disconnect the recording node if we added one
      if (this._recordingDest && audioEngine?._analyser) {
        try { audioEngine._analyser.disconnect(this._recordingDest); } catch {}
        this._recordingDest = null;
      }
    };

    // Store for cleanup in onstop
    this._recordingDest = null;
    try {
      if (audioEngine?._ctx && audioEngine.isPlaying && audioEngine._analyser) {
        const dest = audioEngine._ctx.createMediaStreamDestination();
        audioEngine._analyser.connect(dest);
        this._recordingDest = dest;
        // Rebuild combined stream with this dest (the one we actually connected)
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioTracks,
          ]);
          // Re-create recorder with the correct stream
          this._recorder.stream?.getTracks().forEach(t => {});
          try {
            this._recorder = new MediaRecorder(
              combinedStream,
              mimeType ? { mimeType } : undefined
            );
            this._recorder.ondataavailable = e => {
              if (e.data && e.data.size > 0) this._chunks.push(e.data);
            };
            this._recorder.onstop = () => {
              const blob = new Blob(this._chunks, { type: mimeType || 'video/webm' });
              if (this._prevUrl) URL.revokeObjectURL(this._prevUrl);
              this.blobUrl  = URL.createObjectURL(blob);
              this._prevUrl = this.blobUrl;
              this.state    = 'stopped';
              try { audioEngine._analyser.disconnect(dest); } catch {}
            };
          } catch {}
        }
      }
    } catch {}

    this._recorder.start(100);
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
  }

  download(filename = 'vael-recording.webm') {
    if (!this.blobUrl) return;
    const a    = document.createElement('a');
    a.href     = this.blobUrl;
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
