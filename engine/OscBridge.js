/**
 * engine/OscBridge.js
 * Receives OSC messages via WebSocket from a local bridge process.
 *
 * The bridge is a tiny Node.js script (osc-bridge.js, ~25 lines)
 * that listens for UDP OSC packets and forwards them over WebSocket.
 * Run it with: node osc-bridge.js
 *
 * OSC address patterns Vael understands:
 *   /vael/scene/next          — advance to next setlist scene
 *   /vael/scene/prev          — go to previous scene
 *   /vael/scene/goto  <int>   — jump to scene index (0-based)
 *   /vael/layer/<id>/opacity  <float 0-1>
 *   /vael/layer/<id>/visible  <int 0|1>
 *   /vael/layer/<id>/param/<paramId>  <float>
 *   /vael/record/start
 *   /vael/record/stop
 *
 * Usage:
 *   const osc = new OscBridge({ layerStack, setlist, recorder });
 *   osc.connect('ws://localhost:8080');
 *   osc.onMessage = (address, args) => { ... };  // optional raw handler
 */

class OscBridge {

  constructor({ layerStack, setlist, recorder } = {}) {
    this._layerStack = layerStack;
    this._setlist    = setlist;
    this._recorder   = recorder;

    this._ws         = null;
    this._url        = null;
    this._retryMs    = 3000;
    this._retryTimer = null;
    this._connected  = false;
    this._enabled    = false;

    // Callbacks
    this.onMessage    = null;   // (address, args) raw
    this.onConnect    = null;
    this.onDisconnect = null;
  }

  // ── Connection ───────────────────────────────────────────────

  connect(url = 'ws://localhost:8080') {
    this._url     = url;
    this._enabled = true;
    this._tryConnect();
  }

  disconnect() {
    this._enabled = false;
    clearTimeout(this._retryTimer);
    if (this._ws) { this._ws.close(); this._ws = null; }
    this._connected = false;
  }

  get connected() { return this._connected; }

  _tryConnect() {
    if (!this._enabled) return;
    try {
      const ws = new WebSocket(this._url);

      ws.onopen = () => {
        this._connected = true;
        console.log(`OscBridge: connected to ${this._url}`);
        if (typeof this.onConnect === 'function') this.onConnect();
      };

      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          // Expected format: { address: '/vael/scene/next', args: [] }
          if (msg.address) this._dispatch(msg.address, msg.args || []);
          if (typeof this.onMessage === 'function') this.onMessage(msg.address, msg.args || []);
        } catch (err) {
          console.warn('OscBridge: bad message', e.data);
        }
      };

      ws.onerror = () => {};  // handled by onclose

      ws.onclose = () => {
        this._connected = false;
        console.log('OscBridge: disconnected');
        if (typeof this.onDisconnect === 'function') this.onDisconnect();
        if (this._enabled) {
          this._retryTimer = setTimeout(() => this._tryConnect(), this._retryMs);
        }
      };

      this._ws = ws;
    } catch (e) {
      if (this._enabled) {
        this._retryTimer = setTimeout(() => this._tryConnect(), this._retryMs);
      }
    }
  }

  // ── Dispatcher ───────────────────────────────────────────────

  _dispatch(address, args) {
    const parts = address.split('/').filter(Boolean);
    if (parts[0] !== 'vael') return;

    // /vael/scene/...
    if (parts[1] === 'scene') {
      if (parts[2] === 'next')  { this._setlist?.next(); return; }
      if (parts[2] === 'prev')  { this._setlist?.prev(); return; }
      if (parts[2] === 'goto')  { this._setlist?.goto(parseInt(args[0]) || 0); return; }
    }

    // /vael/layer/<id>/opacity  <float>
    // /vael/layer/<id>/visible  <0|1>
    // /vael/layer/<id>/param/<paramId>  <float>
    if (parts[1] === 'layer' && parts[2]) {
      const layerId = parts[2];
      const layer   = this._layerStack?.layers.find(l => l.id === layerId);
      if (!layer) return;

      if (parts[3] === 'opacity') {
        layer.opacity = VaelMath.clamp(parseFloat(args[0]) || 0, 0, 1);
      } else if (parts[3] === 'visible') {
        layer.visible = args[0] !== 0 && args[0] !== '0';
      } else if (parts[3] === 'param' && parts[4]) {
        const paramId = parts[4];
        const value   = parseFloat(args[0]) || 0;
        if (layer.params) layer.params[paramId] = value;
        if (typeof layer.setParam === 'function') layer.setParam(paramId, value);
      }
      return;
    }

    // /vael/record/start  /vael/record/stop
    if (parts[1] === 'record') {
      const canvas = document.getElementById('main-canvas');
      if (parts[2] === 'start' && canvas) this._recorder?.start(canvas);
      if (parts[2] === 'stop')            this._recorder?.stop();
      return;
    }

    console.log('OscBridge: unhandled address', address, args);
  }
}


// ── Node.js bridge script (save as osc-bridge.js, run with node) ─
// Copy this to a file called osc-bridge.js next to index.html and run:
//   npm install osc ws
//   node osc-bridge.js
//
// -----------------------------------------------------------------
// const osc = require('osc');
// const WebSocket = require('ws');
//
// const udpPort = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 9000 });
// const wss     = new WebSocket.Server({ port: 8080 });
// const clients = new Set();
//
// wss.on('connection', ws => { clients.add(ws); ws.on('close', () => clients.delete(ws)); });
//
// udpPort.on('message', msg => {
//   const payload = JSON.stringify({ address: msg.address, args: msg.args.map(a => a.value) });
//   clients.forEach(ws => { if (ws.readyState === 1) ws.send(payload); });
// });
//
// udpPort.open();
// console.log('OSC bridge: UDP :9000 → WS :8080');
// -----------------------------------------------------------------
