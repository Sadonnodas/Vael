/**
 * electron/preload.js
 *
 * Runs in the renderer process but has access to Node.js APIs.
 * Exposes a safe, limited API to the web app via contextBridge.
 *
 * The renderer (your Vael JS) accesses native features through
 * window.electronAPI — never directly through Node.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Detection ─────────────────────────────────────────────────
  isElectron: true,

  // ── File operations ───────────────────────────────────────────
  /**
   * Show a native save dialog and write data to disk.
   * @param {string} defaultName  Suggested filename
   * @param {Array}  filters      e.g. [{ name: 'JSON', extensions: ['json'] }]
   * @param {string} data         File content (string or base64 data URL for binary)
   */
  saveFile: (defaultName, filters, data) =>
    ipcRenderer.invoke('file:save', { defaultName, filters, data }),

  /**
   * Show a native open dialog and read file(s) from disk.
   * Returns { files: [{ path, name, data (base64), mime }] }
   */
  openFile: (filters, multiple = false) =>
    ipcRenderer.invoke('file:open', { filters, multiple }),

  // ── Projects ──────────────────────────────────────────────────
  /** Save a project to ~/Documents/Vael Projects/{name}.vael */
  saveProject: (name, data) =>
    ipcRenderer.invoke('project:save', { name, data }),

  /** List all saved projects */
  listProjects: () =>
    ipcRenderer.invoke('project:list'),

  /** Load a project by file path */
  loadProject: (filePath) =>
    ipcRenderer.invoke('project:load', { filePath }),

  // ── Output window (projector) ─────────────────────────────────
  /** Open the canvas-only output window on the second display */
  openOutput: () =>
    ipcRenderer.invoke('output:open'),

  /** Close the output window */
  closeOutput: () =>
    ipcRenderer.invoke('output:close'),

  /** Get list of connected displays */
  getDisplays: () =>
    ipcRenderer.invoke('output:getDisplays'),

  /** Listen for output window close event */
  onOutputClosed: (callback) =>
    ipcRenderer.on('output-window-closed', callback),

  // ── Anthropic API (no CORS in Electron) ───────────────────────
  /**
   * Call the Anthropic API directly via Node.js https (no CORS).
   * Returns { ok, status, data } or { ok: false, error }
   */
  callAnthropic: (apiKey, body) =>
    ipcRenderer.invoke('anthropic:call', { apiKey, body }),

  // ── Menu events ───────────────────────────────────────────────
  onMenu: (event, callback) =>
    ipcRenderer.on(`menu:${event}`, callback),

  // ── System info ───────────────────────────────────────────────
  getSystemInfo: () =>
    ipcRenderer.invoke('system:info'),

  /** Open a URL in the default browser (not inside Electron) */
  openExternal: (url) =>
    ipcRenderer.invoke('shell:openExternal', url),

});
