/**
 * osc-bridge.js
 * Tiny Node.js bridge: receives OSC over UDP and forwards to Vael over WebSocket.
 *
 * Setup:
 *   npm install osc ws
 *   node osc-bridge.js
 *
 * Then in Ableton Live, QLab, or any OSC app, send to:
 *   IP:        127.0.0.1 (or your computer's local IP for other devices)
 *   UDP port:  9000
 *
 * Vael connects automatically to ws://localhost:8080
 *
 * OSC addresses Vael understands:
 *   /vael/scene/next
 *   /vael/scene/prev
 *   /vael/scene/goto   <int index>
 *   /vael/layer/<id>/opacity  <float 0-1>
 *   /vael/layer/<id>/visible  <int 0|1>
 *   /vael/layer/<id>/param/<paramId>  <float>
 *   /vael/record/start
 *   /vael/record/stop
 *
 * Example — trigger next scene from Ableton Live:
 *   Use Max for Live or the OSC plugin to send /vael/scene/next
 *
 * Example — set layer opacity from QLab:
 *   Address: /vael/layer/noise-default/opacity
 *   Argument: 0.5
 */

const osc = require('osc');
const WebSocket = require('ws');

// ── Config ──────────────────────────────────────────────────────
const UDP_PORT = 9000;    // OSC input port (from Ableton/QLab etc)
const WS_PORT  = 8080;    // WebSocket port (Vael connects here)
const HOST     = '0.0.0.0';

// ── WebSocket server ────────────────────────────────────────────
const wss     = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  console.log(`Vael connected (${clients.size} client${clients.size !== 1 ? 's' : ''})`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Vael disconnected (${clients.size} remaining)`);
  });
});

wss.on('listening', () => {
  console.log(`WebSocket server listening on ws://localhost:${WS_PORT}`);
});

// ── OSC UDP port ────────────────────────────────────────────────
const udpPort = new osc.UDPPort({
  localAddress: HOST,
  localPort:    UDP_PORT,
  metadata:     true,
});

udpPort.on('message', msg => {
  const payload = JSON.stringify({
    address: msg.address,
    args:    (msg.args || []).map(a => a.value),
  });

  let sent = 0;
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sent++;
    }
  });

  console.log(`OSC ${msg.address} [${(msg.args || []).map(a => a.value).join(', ')}] → ${sent} client${sent !== 1 ? 's' : ''}`);
});

udpPort.on('error', err => {
  console.error('OSC error:', err);
});

udpPort.on('ready', () => {
  console.log(`OSC listening on UDP port ${UDP_PORT}`);
  console.log('');
  console.log('Ready. Send OSC to 127.0.0.1:' + UDP_PORT);
  console.log('Vael will connect automatically at ws://localhost:' + WS_PORT);
});

udpPort.open();
