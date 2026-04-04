/**
 * electron/main.js
 *
 * Vael — Electron main process.
 * Handles window creation, dual-display output, native menus,
 * and IPC bridges to native APIs (file system, ffmpeg, etc.)
 *
 * Place this file at: vael/electron/main.js
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, screen, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Keep references so windows don't get garbage collected ──────
let mainWindow   = null;  // control window (your laptop screen)
let outputWindow = null;  // canvas-only output (projector / second display)

// ── App ready ───────────────────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow();
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Main window ─────────────────────────────────────────────────

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:  Math.min(1600, width),
    height: Math.min(1000, height),
    minWidth:  900,
    minHeight: 600,
    title: 'Vael — Light onto Sound',
    titleBarStyle: 'hiddenInset',   // macOS: traffic lights inset into content
    backgroundColor: '#07070f',     // matches Vael dark theme, no white flash on load
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      true,
    },
  });

  // Load the app — index.html is one level up from electron/
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Open DevTools in development
  if (process.env.VAEL_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close output window if main closes
    if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
  });
}

// ── Output window (projector / second display) ──────────────────

function createOutputWindow() {
  const displays = screen.getAllDisplays();

  // Prefer the external display; fall back to primary
  const external = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
  const target   = external || screen.getPrimaryDisplay();

  outputWindow = new BrowserWindow({
    x:      target.bounds.x,
    y:      target.bounds.y,
    width:  target.bounds.width,
    height: target.bounds.height,
    frame:       false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: !!external,   // float above taskbar on external display
    title: 'Vael Output',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Load the canvas-only output page
  outputWindow.loadFile(path.join(__dirname, '..', 'output.html'));

  // Go fullscreen on the target display
  outputWindow.setFullScreen(true);

  outputWindow.on('closed', () => {
    outputWindow = null;
    // Notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('output-window-closed');
    }
  });

  return outputWindow;
}

// ── IPC handlers ─────────────────────────────────────────────────

// File: save
ipcMain.handle('file:save', async (event, { defaultName, filters, data }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), 'Desktop', defaultName || 'vael-export'),
    filters:     filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    // data can be a base64 string (for binary) or plain string
    if (typeof data === 'string' && data.startsWith('data:')) {
      const base64 = data.split(',')[1];
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    } else {
      fs.writeFileSync(filePath, data, 'utf8');
    }
    return { filePath, success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// File: open
ipcMain.handle('file:open', async (event, { filters, multiple } = {}) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    filters:    filters || [{ name: 'All Files', extensions: ['*'] }],
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  try {
    const results = filePaths.map(fp => ({
      path: fp,
      name: path.basename(fp),
      data: fs.readFileSync(fp).toString('base64'),
      mime: getMime(fp),
    }));
    return { files: results };
  } catch (e) {
    return { error: e.message };
  }
});

// Projects: save to ~/Documents/Vael Projects/
ipcMain.handle('project:save', async (event, { name, data }) => {
  const dir = path.join(os.homedir(), 'Documents', 'Vael Projects');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${name}.vael`);
  try {
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
    return { path: fp, success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('project:list', async () => {
  const dir = path.join(os.homedir(), 'Documents', 'Vael Projects');
  if (!fs.existsSync(dir)) return { projects: [] };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.vael'));
  return { projects: files.map(f => ({ name: f.replace('.vael', ''), path: path.join(dir, f) })) };
});

ipcMain.handle('project:load', async (event, { filePath }) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { data, success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Output window
ipcMain.handle('output:open', async () => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.focus();
    return { already: true };
  }
  createOutputWindow();
  return { success: true };
});

ipcMain.handle('output:close', async () => {
  if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
  return { success: true };
});

ipcMain.handle('output:getDisplays', async () => {
  return screen.getAllDisplays().map(d => ({
    id:     d.id,
    label:  d.label || `Display ${d.id}`,
    bounds: d.bounds,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
  }));
});

// System info
ipcMain.handle('system:info', async () => ({
  platform:  process.platform,
  arch:      process.arch,
  version:   app.getVersion(),
  electron:  process.versions.electron,
  node:      process.versions.node,
}));

// Open external URL in browser
ipcMain.handle('shell:openExternal', async (event, url) => {
  await shell.openExternal(url);
});

// Anthropic API proxy — direct call without CORS restrictions
ipcMain.handle('anthropic:call', async (event, { apiKey, body }) => {
  try {
    const https = require('https');
    return await new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const options = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers:  {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(bodyStr),
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
      };
      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ ok: false, error: 'Could not parse response' }); }
        });
      });
      req.on('error', e => reject({ error: e.message }));
      req.write(bodyStr);
      req.end();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Native menu ──────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'Vael',
      submenu: [
        { label: 'About Vael', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send('open-preferences') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Scene',       accelerator: 'Cmd+N', click: () => mainWindow?.webContents.send('menu:new-scene') },
        { label: 'Save Scene',      accelerator: 'Cmd+S', click: () => mainWindow?.webContents.send('menu:save-scene') },
        { label: 'Open Project…',   accelerator: 'Cmd+O', click: () => mainWindow?.webContents.send('menu:open-project') },
        { type: 'separator' },
        { label: 'Export Recording…', accelerator: 'Cmd+E', click: () => mainWindow?.webContents.send('menu:export') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Open Output Window', accelerator: 'Cmd+Shift+O', click: () => mainWindow?.webContents.send('menu:open-output') },
        { type: 'separator' },
        { label: 'Performance Mode',   accelerator: 'F',            click: () => mainWindow?.webContents.send('menu:perf-mode') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', accelerator: 'Cmd+Alt+I' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Helpers ──────────────────────────────────────────────────────

function getMime(fp) {
  const ext = path.extname(fp).toLowerCase();
  const map = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.mp4': 'video/mp4',  '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.png': 'image/png',  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.vael': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}
