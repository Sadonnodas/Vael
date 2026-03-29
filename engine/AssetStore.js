/**
 * engine/AssetStore.js
 * Persists binary assets (video, audio, image files) across browser sessions
 * using IndexedDB. Falls back gracefully if IndexedDB is unavailable.
 *
 * Why not localStorage?
 *   localStorage is string-only and capped at ~5MB. IndexedDB stores Blobs
 *   directly, handles gigabytes, and is async — no blocking the main thread.
 *
 * Usage:
 *   await AssetStore.save('video', file);       // store a File/Blob
 *   const files = await AssetStore.list('audio'); // get all of type
 *   await AssetStore.remove('video', id);
 *   await AssetStore.clear('image');
 *
 * Each entry: { id, name, type, blob, savedAt }
 */

const AssetStore = (() => {

  const DB_NAME    = 'vael-assets';
  const DB_VERSION = 1;
  const STORE_NAME = 'assets';

  let _db = null;

  // ── Open / init ───────────────────────────────────────────────

  async function _open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db    = e.target.result;
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_type', 'type', { unique: false });
      };

      req.onsuccess = e => {
        _db = e.target.result;
        resolve(_db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  // ── Save ─────────────────────────────────────────────────────

  /**
   * Save a File or Blob to the store.
   * @param {string} type   'video' | 'audio' | 'image'
   * @param {File}   file   The file object from a file input
   * @returns {string}      The generated ID
   */
  async function save(type, file) {
    const db  = await _open();
    const id  = `${type}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const entry = {
      id,
      name:    file.name,
      type,
      blob:    file,       // IndexedDB stores the Blob natively
      savedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(entry);
      req.onsuccess = () => resolve(id);
      req.onerror   = () => reject(req.error);
    });
  }

  // ── List ─────────────────────────────────────────────────────

  /**
   * Get all stored assets of a given type.
   * @param {string} type  'video' | 'audio' | 'image' | null (all)
   * @returns {Array}      Array of { id, name, type, blob, savedAt }
   */
  async function list(type) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE_NAME, 'readonly');
      const store   = tx.objectStore(STORE_NAME);
      const request = type
        ? store.index('by_type').getAll(type)
        : store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror   = () => reject(request.error);
    });
  }

  // ── Remove ────────────────────────────────────────────────────

  async function remove(id) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ── Clear ─────────────────────────────────────────────────────

  async function clear(type) {
    if (!type) {
      // Clear everything
      const db = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).clear();
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      });
    }
    // Clear only entries of a specific type
    const entries = await list(type);
    for (const entry of entries) await remove(entry.id);
  }

  // ── Size estimate ─────────────────────────────────────────────

  async function estimateSize() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      return estimate ?? null;
    } catch { return null; }
  }

  return { save, list, remove, clear, estimateSize };

})();
