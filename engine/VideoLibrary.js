/**
 * engine/VideoLibrary.js
 * Manages a collection of uploaded video files.
 * Each VideoPlayerLayer references a video by its library ID.
 *
 * FIX: Uses 'loadeddata' instead of 'oncanplay' — more reliable.
 * Timeout fallback prevents the promise hanging on bad files.
 */

class VideoLibrary {

  constructor() {
    this._videos  = new Map();
    this._counter = 0;
    this.onChanged = null;
  }

  async add(file) {
    const id  = `vid-${++this._counter}-${Date.now()}`;
    const url = URL.createObjectURL(file);

    const el = document.createElement('video');
    el.src         = url;
    el.loop        = true;
    el.muted       = true;
    el.playsInline = true;
    el.preload     = 'auto';

    // Wait for enough data — with a 10s timeout fallback
    await new Promise((resolve) => {
      const done = () => { el.removeEventListener('loadeddata', done); resolve(); };
      el.addEventListener('loadeddata', done);
      setTimeout(resolve, 10000);
      el.load();
    });

    await el.play().catch(() => {});

    const entry = {
      id,
      name:     file.name,
      url,
      element:  el,
      duration: isFinite(el.duration) ? el.duration : 0,
    };

    this._videos.set(id, entry);
    this._notify();
    return id;
  }

  remove(id) {
    const entry = this._videos.get(id);
    if (!entry) return;
    entry.element.pause();
    entry.element.src = '';
    URL.revokeObjectURL(entry.url);
    this._videos.delete(id);
    this._notify();
  }

  clear() {
    [...this._videos.keys()].forEach(id => this.remove(id));
  }

  getElement(id) {
    return this._videos.get(id)?.element || null;
  }

  get entries() { return Array.from(this._videos.values()); }
  get count()   { return this._videos.size; }

  playAll()  { this._videos.forEach(v => v.element.play().catch(() => {})); }
  pauseAll() { this._videos.forEach(v => v.element.pause()); }

  seekTo(id, seconds) {
    const entry = this._videos.get(id);
    if (entry && isFinite(entry.element.duration)) {
      entry.element.currentTime = VaelMath.clamp(seconds, 0, entry.element.duration);
    }
  }

  _notify() {
    if (typeof this.onChanged === 'function') this.onChanged(this.entries);
  }
}
