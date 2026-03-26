/**
 * ui/VaelAssistant.js
 * Claude-powered AI assistant for Vael.
 * Understands the full layer/FX/modulation architecture.
 * Can describe how to achieve effects OR directly execute them.
 *
 * Commands the assistant can execute:
 *   addLayer(type, name, params)
 *   setParam(layerId, paramId, value)
 *   setBlend(layerId, mode)
 *   setOpacity(layerId, value)
 *   addModRoute(layerId, source, target, depth, smooth)
 *   addLayerFX(layerId, fxType, params)
 *   addPostFX(fxType, params)
 *   removeLayer(layerId)
 *   clearScene()
 *   setTransform(layerId, x, y, scaleX, scaleY, rotation)
 */

const VaelAssistant = (() => {

  let _layers      = null;
  let _layerFactory = null;
  let _renderer    = null;
  let _panel       = null;
  let _messages    = [];
  let _isOpen      = false;

  // ── System prompt — describes all of Vael to Claude ──────────

  function _buildSystemPrompt() {
    const layerList = _layers.layers.map(l =>
      `  - id="${l.id}" name="${l.name}" type=${l.constructor.name} opacity=${l.opacity} blend=${l.blendMode}`
    ).join('\n') || '  (none)';

    return `You are the Vael AI assistant. Vael is a browser-based visual performance tool for live music.

## Current Scene
Layers (bottom to top):
${layerList}

## Layer Types
- GradientLayer: params: mode(linear/radial/conic/diagonal-flow), hueA(0-360), hueB(0-360), hueC(0-360), saturation(0-1), lightness(0-0.6), speed(0-1), angle(0-360), audioReact(0-2), audioTarget(band)
- NoiseFieldLayer: params: mode(field/flow/marble/aurora), scale(0.001-0.02), speed(0.01-1), hueA, hueB, saturation, lightness, contrast(0.3-3), audioTarget
- ParticleLayer: params: mode(drift/fountain/orbit/pulse/fireflies), count(50-3000), size(0.5-10), speed(0.05-3), colorMode(rainbow/mono/white/accent/warm/cool/ember), audioTarget, hueShift(0-360)
- MathVisualizer: params: constant(pi/e/phi/sqrt2/ln2/apery/euler-mascheroni/catalan), mode(path/tree/circle/chaos/spiral/walk/polar/lsystem/wave/constellation), colorMode(rainbow/digit/mono), digitCount(50-2000), angle(1-180), lineWidth(0.3-8), dotSize(0.5-12), zoom(0.2-4), audioTarget, hueShift
- ShaderLayer: params: speed(0-4), intensity(0-2), scale(0.1-5), audioTarget. Builtin names: plasma, ripple, distort, bloom, chromatic
- LyricsLayer: params: fontSize(12-200), posY(0-1), color(hex), transition(fade/slide/typewriter/none), duration(0.5-30)
- ImageLayer: params: fitMode(contain/cover/stretch/original), tintHue(0-360), tintAmount(0-1), audioTarget, audioScale(0-1), audioRotate(0-1), pulseOnBeat(bool)
- GradientLayer: same as above
- GroupLayer: container for other layers

## Blend Modes
normal, multiply, screen, overlay, add, softlight, difference, subtract, exclusion

## Audio Sources (for mod routes and audioTarget)
bass, mid, treble, volume, brightness(video), motion(video), edgeDensity(video), iTime, iBeat, iMouseX, iMouseY

## Modulation Routes (per-layer)
Each layer can have multiple mod routes: source → target param, with depth(0-1) and smooth(0.01-1).
Example: bass → angle, depth 0.5, smooth 0.08 makes the angle swell slowly with bass.

## Per-Layer FX
blur(radius, audioAmount), glow(radius, intensity, audioAmount), brightness(value), contrast(value), saturate(value), hue-rotate(angle, audioAmount), sepia(amount), invert(amount), vignette(darkness, size), chromatic(amount, audioAmount), threshold(threshold), color-overlay(color, opacity, blendMode), pixelate(size, audioAmount)

## Global PostFX (whole canvas)
bloom, chromatic, distort, vignette, grain, feedback

## Transform
x(pixels), y(pixels), scaleX(0.1-10), scaleY(0.1-10), rotation(degrees)

## Response Format
Always respond with:
1. A brief friendly explanation of what you're doing or suggesting (1-3 sentences)
2. If executing changes, a JSON block with commands:

\`\`\`json
{
  "commands": [
    { "action": "addLayer", "type": "ParticleLayer", "name": "Stars", "params": { "mode": "drift", "count": 800, "colorMode": "white" } },
    { "action": "setBlend", "layerId": "auto:0", "mode": "add" },
    { "action": "addModRoute", "layerId": "auto:0", "source": "bass", "target": "size", "depth": 0.4, "smooth": 0.1 }
  ]
}
\`\`\`

Use "auto:N" to reference the Nth layer added in this same response (0-indexed).
Use actual layer ids from the current scene to modify existing layers.

## Vibe
You're helping create visuals for Bearfeet, an indie folk band. Their music is organic, warm, earthy. Think: fireflies, aurora, starfields, wood grain, flowing water, candlelight. Avoid harsh strobing or aggressive rave aesthetics unless specifically asked.`;
  }

  // ── Command executor ──────────────────────────────────────────

  function _executeCommands(commands) {
    const newLayers = [];  // track layers added in this batch for auto:N refs

    commands.forEach(cmd => {
      try {
        // Resolve layerId references
        let layerId = cmd.layerId;
        if (typeof layerId === 'string' && layerId.startsWith('auto:')) {
          const idx = parseInt(layerId.split(':')[1]);
          layerId   = newLayers[idx]?.id;
        }
        const layer = layerId ? _layers.layers.find(l => l.id === layerId) : null;

        switch (cmd.action) {
          case 'addLayer': {
            const l = _layerFactory(cmd.type);
            if (!l) { console.warn('VaelAssistant: unknown layer type', cmd.type); break; }
            if (cmd.name) l.name = cmd.name;
            if (cmd.params && l.params) Object.assign(l.params, cmd.params);
            if (typeof l.init === 'function') l.init(l.params || {});
            if (cmd.blend)   l.blendMode = cmd.blend;
            if (cmd.opacity !== undefined) l.opacity = cmd.opacity;
            _layers.add(l);
            newLayers.push(l);
            break;
          }
          case 'removeLayer': {
            if (layer) _layers.remove(layer.id);
            break;
          }
          case 'clearScene': {
            [..._layers.layers].forEach(l => _layers.remove(l.id));
            newLayers.length = 0;
            break;
          }
          case 'setParam': {
            if (layer && layer.params && cmd.paramId !== undefined) {
              layer.params[cmd.paramId] = cmd.value;
              layer.modMatrix?.setBase(cmd.paramId, cmd.value);
            }
            break;
          }
          case 'setBlend': {
            if (layer) layer.blendMode = cmd.mode;
            break;
          }
          case 'setOpacity': {
            if (layer) layer.opacity = Math.max(0, Math.min(1, cmd.value));
            break;
          }
          case 'setTransform': {
            if (layer) {
              Object.assign(layer.transform, {
                x: cmd.x ?? layer.transform.x,
                y: cmd.y ?? layer.transform.y,
                scaleX:   cmd.scaleX   ?? layer.transform.scaleX,
                scaleY:   cmd.scaleY   ?? layer.transform.scaleY,
                rotation: cmd.rotation ?? layer.transform.rotation,
              });
            }
            break;
          }
          case 'addModRoute': {
            if (layer?.modMatrix) {
              layer.modMatrix.addRoute({
                source: cmd.source,
                target: cmd.target,
                depth:  cmd.depth  ?? 0.5,
                smooth: cmd.smooth ?? 0.1,
                invert: cmd.invert ?? false,
              });
            }
            break;
          }
          case 'addLayerFX': {
            if (layer) {
              if (!layer.fx) layer.fx = [];
              layer.fx.push({ type: cmd.fxType, enabled: true, params: cmd.params || {} });
            }
            break;
          }
          case 'addPostFX': {
            if (typeof PostFX !== 'undefined' && _renderer) {
              PostFX.add(_renderer, cmd.fxType, cmd.params || {});
            }
            break;
          }
          case 'setName': {
            if (layer) layer.name = cmd.name;
            break;
          }
        }
      } catch (e) {
        console.warn('VaelAssistant: command error', cmd, e);
      }
    });

    return newLayers.length;
  }

  // ── Parse assistant response ──────────────────────────────────

  function _parseResponse(text) {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) return { text, commands: [] };

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const commands = parsed.commands || [];
      const cleanText = text.replace(/```json[\s\S]*?```/, '').trim();
      return { text: cleanText, commands };
    } catch {
      return { text, commands: [] };
    }
  }

  // ── API call ─────────────────────────────────────────────────

  async function _callClaude(userMessage) {
    const systemPrompt = _buildSystemPrompt();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system:     systemPrompt,
        messages:   _messages.concat([{ role: 'user', content: userMessage }]),
      }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    return data.content[0]?.text || '';
  }

  // ── UI ────────────────────────────────────────────────────────

  function init(layerStack, layerFactory, renderer) {
    _layers       = layerStack;
    _layerFactory = layerFactory;
    _renderer     = renderer;
    _buildPanel();
  }

  function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'vael-assistant-panel';
    _panel.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 24px;
      width: 380px;
      max-height: 520px;
      background: var(--bg-mid);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 400;
      font-family: var(--font-ui);
    `;

    _panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;
                  border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                     color:var(--accent);flex:1">VAEL ASSISTANT</span>
        <button id="va-clear" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-family:var(--font-mono);font-size:8px;padding:2px 6px">clear</button>
        <button id="va-close" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-size:16px">✕</button>
      </div>
      <div id="va-messages" style="flex:1;overflow-y:auto;padding:12px;
                                    scrollbar-width:thin;scrollbar-color:var(--border) var(--bg-mid)">
        <div class="va-msg assistant" style="background:rgba(0,212,170,0.06);border:1px solid rgba(0,212,170,0.15);
             border-radius:8px;padding:10px 12px;font-size:11px;color:var(--text);line-height:1.6;margin-bottom:8px">
          Hi! I'm the Vael assistant. I know how every layer, effect, and parameter works.<br><br>
          Try: <em style="color:var(--accent)">"make something that looks like a campfire"</em><br>
          Or: <em style="color:var(--accent)">"add glow to the math visualizer"</em><br>
          Or: <em style="color:var(--accent)">"make the particles react more to bass"</em>
        </div>
      </div>
      <div style="padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0;
                  display:flex;gap:8px;align-items:flex-end">
        <textarea id="va-input" rows="2" placeholder="Describe what you want…"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;
                 color:var(--text);font-family:var(--font-ui);font-size:11px;padding:8px 10px;
                 resize:none;line-height:1.5"></textarea>
        <button id="va-send" class="btn accent" style="flex-shrink:0;padding:8px 14px;align-self:flex-end">
          Send
        </button>
      </div>
    `;

    document.body.appendChild(_panel);

    // FAB button
    const fab = document.createElement('button');
    fab.id = 'vael-assistant-fab';
    fab.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--accent) 20%, var(--bg-mid));
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 22px;
      cursor: pointer;
      z-index: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,212,170,0.3);
      transition: transform 0.15s;
    `;
    fab.innerHTML = '✦';
    fab.title = 'Vael Assistant (AI)';
    fab.addEventListener('click', toggle);
    fab.addEventListener('mouseenter', () => fab.style.transform = 'scale(1.1)');
    fab.addEventListener('mouseleave', () => fab.style.transform = 'scale(1)');
    document.body.appendChild(fab);

    // Wire events
    _panel.querySelector('#va-close').addEventListener('click', close);
    _panel.querySelector('#va-clear').addEventListener('click', () => {
      _messages = [];
      const msgs = _panel.querySelector('#va-messages');
      msgs.innerHTML = '';
    });

    const input    = _panel.querySelector('#va-input');
    const sendBtn  = _panel.querySelector('#va-send');

    sendBtn.addEventListener('click', () => _sendMessage());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendMessage(); }
    });
  }

  async function _sendMessage() {
    const input = _panel.querySelector('#va-input');
    const text  = input.value.trim();
    if (!text) return;
    input.value = '';

    _appendMessage('user', text);
    _messages.push({ role: 'user', content: text });

    // Typing indicator
    const typing = _appendMessage('assistant', '…', true);

    try {
      const responseText = await _callClaude(text);
      const { text: cleanText, commands } = _parseResponse(responseText);

      // Remove typing indicator
      typing.remove();

      // Execute commands
      let executed = 0;
      if (commands.length > 0) {
        executed = _executeCommands(commands);
      }

      // Show response
      const suffix = executed > 0 ? `\n\n*Applied ${commands.length} change${commands.length !== 1 ? 's' : ''} to your scene.*` : '';
      _appendMessage('assistant', cleanText + suffix);
      _messages.push({ role: 'assistant', content: responseText });

      // Keep history manageable
      if (_messages.length > 20) _messages = _messages.slice(-20);

    } catch (e) {
      typing.remove();
      _appendMessage('assistant', `Sorry, I couldn't connect to Claude. Check your API key. (${e.message})`);
    }
  }

  function _appendMessage(role, text, isTyping = false) {
    const msgs    = _panel.querySelector('#va-messages');
    const el      = document.createElement('div');
    el.className  = `va-msg ${role}`;
    el.style.cssText = `
      background: ${role === 'user' ? 'rgba(124,106,247,0.1)' : 'rgba(0,212,170,0.06)'};
      border: 1px solid ${role === 'user' ? 'rgba(124,106,247,0.2)' : 'rgba(0,212,170,0.12)'};
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11px;
      color: var(--text);
      line-height: 1.6;
      margin-bottom: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    `;

    // Simple markdown: *bold*, _italic_, **bold**
    el.innerHTML = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em style="color:var(--accent)">$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;font-family:var(--font-mono);font-size:9px">$1</code>');

    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function open() {
    if (!_panel) return;
    _panel.style.display = 'flex';
    _isOpen = true;
    setTimeout(() => _panel.querySelector('#va-input')?.focus(), 100);
  }

  function close() {
    if (!_panel) return;
    _panel.style.display = 'none';
    _isOpen = false;
  }

  function toggle() { _isOpen ? close() : open(); }

  return { init, open, close, toggle };

})();
