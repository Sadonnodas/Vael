/**
 * utils/loader.js
 * Centralised file loading utilities.
 * Handles GLSL shaders, audio buffers, images, and JSON presets.
 * All functions return Promises.
 */

const VaelLoader = (() => {

  // ── GLSL shaders ─────────────────────────────────────────────

  /**
   * Fetch a GLSL shader file and return its source string.
   * @param {string} path - relative path e.g. 'shaders/noise.glsl'
   * @returns {Promise<string>}
   */
  async function loadGLSL(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load shader: ${path}`);
    return res.text();
  }

  // ── Audio ─────────────────────────────────────────────────────

  /**
   * Load an audio file from a File object into an AudioBuffer.
   * @param {File} file
   * @param {AudioContext} ctx
   * @returns {Promise<AudioBuffer>}
   */
  async function loadAudioFile(file, ctx) {
    const arrayBuffer = await file.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  }

  // ── JSON presets ─────────────────────────────────────────────

  /**
   * Load a JSON preset file from disk (via fetch).
   * @param {string} path
   * @returns {Promise<object>}
   */
  async function loadPreset(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load preset: ${path}`);
    return res.json();
  }

  /**
   * Parse a JSON preset from a File object selected by the user.
   * @param {File} file
   * @returns {Promise<object>}
   */
  function loadPresetFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => {
        try { resolve(JSON.parse(e.target.result)); }
        catch (err) { reject(new Error('Invalid preset JSON')); }
      };
      reader.onerror = () => reject(new Error('Could not read preset file'));
      reader.readAsText(file);
    });
  }

  // ── Images / textures ────────────────────────────────────────

  /**
   * Load an image URL as a Three.js texture.
   * Only usable after Three.js is loaded.
   * @param {string} url
   * @returns {Promise<THREE.Texture>}
   */
  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      if (typeof THREE === 'undefined') {
        reject(new Error('Three.js not loaded'));
        return;
      }
      const loader = new THREE.TextureLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  /**
   * Load an image File as a Three.js texture.
   * @param {File} file
   * @returns {Promise<THREE.Texture>}
   */
  function loadTextureFile(file) {
    const url = URL.createObjectURL(file);
    return loadTexture(url).then(tex => {
      // Store the object URL on the texture so it can be revoked later
      tex.userData.objectUrl = url;
      return tex;
    });
  }

  // ── Utility ──────────────────────────────────────────────────

  /**
   * Trigger a browser download of a Blob.
   * @param {Blob} blob
   * @param {string} filename
   */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * Trigger a browser download of a JSON object as a .json file.
   * @param {object} data
   * @param {string} filename
   */
  function downloadJSON(data, filename = 'preset.json') {
    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: 'application/json' }
    );
    download(blob, filename);
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    loadGLSL,
    loadAudioFile,
    loadPreset,
    loadPresetFile,
    loadTexture,
    loadTextureFile,
    download,
    downloadJSON,
  };

})();
