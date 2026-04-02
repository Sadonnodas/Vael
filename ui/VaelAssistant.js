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
All layers have audioReact(0-1) to control built-in audio sensitivity. Use ModMatrix routes for precise per-band control.
- GradientLayer: params: mode(linear/radial/conic/diagonal-flow), hueA(0-360), hueB(0-360), hueC(0-360), saturation(0-1), lightness(0-0.6), speed(0-1), angle(0-360), audioReact(0-1)
- NoiseFieldLayer: params: mode(field/flow/marble/aurora), scale(0.001-0.02), speed(0.01-1), hueA, hueB, saturation, lightness, contrast(0.3-3), audioReact(0-1)
- ParticleLayer: params: mode(drift/fountain/orbit/pulse/fireflies/scatter/rain/vortex/trails), count(50-3000), size(0.5-10), speed(0.05-3), colorMode(rainbow/mono/white/accent/warm/cool/ember/audio), audioReact(0-1), hueShift(0-360), trailLen(0.5-0.99, trails mode), pulseSize(0.05-3, pulse mode)
- MathVisualizer: params: constant(pi/e/phi/sqrt2), mode(path/tree/circle/chaos/spiral/walk/polar/lsystem/wave/constellation), colorMode(rainbow/digit/mono), digitCount(50-2000), angle(1-180), lineWidth(0.3-8), zoom(0.2-4), audioReact(0-1), hueShift
- WaveformLayer: params: mode(waveform/bars/mirror/radial/particles), color(hex), colorMode(solid/rainbow/frequency), lineWidth(0.5-8), scale(0.1-4), smoothing(0-0.99), barCount(8-256, bars/radial/particles modes), mirror(bool), glow(bool)
- ImageLayer: params: fitMode(contain/cover/stretch/original), tintHue(0-360), tintAmount(0-1), audioReact(0-1)
- ShaderLayer: params: speed(0-4), intensity(0-2), scale(0.1-5), audioReact(0-1), param1/2/3(0-1), hueShift(0-360). Builtin names: plasma, ripple, distort, bloom, chromatic
- LyricsLayer: params: fontSize(12-200), posY(0-1), color(hex), transition(fade/slide/typewriter/none), duration(0.5-30)
- VideoPlayerLayer: params: audioReact(0-1), flipH(bool), fitMode(cover/contain/stretch)
- WebcamLayer: params: flipH(bool), flipV(bool), chromaKey(bool), chromaHue(0-360), chromaRange(5-120), fitMode(cover/contain/stretch), audioReact(0-1)
- GroupLayer: container for multiple layers — type="GroupLayer"
- PatternLayer: params: pattern(star/mandala/hexgrid/circles/lissajous/spirograph/flower/grid), color(hex), color2(hex), size(0.1-4), speed(0-3), complexity(2-20), lineWidth(0.5-8), audioReact(0-1)

## Blend Modes
normal, multiply, screen, overlay, add, softlight, difference, subtract, exclusion

## Audio/Signal Sources (for ModMatrix routes)
bass, mid, treble, volume, brightness(video), motion(video), edgeDensity(video), isBeat, bpm, beat(1-4), bar(1-4), phrase(1+)

## Special ModMatrix targets (in addition to layer params)
opacity, transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation

## Modulation Routes (per-layer, via addModRoute)
Each layer can have multiple routes. source drives target param. depth(0-1) controls amount, smooth(0.01=slow, 1=instant) controls response speed.
Good combos: bass→size (particles pop), iBeat→scaleX+scaleY (pulse), iTime→hueShift (slow color shift), mid→angle (math visualizer sways)

## Per-Layer FX (via addLayerFX)
blur(radius), glow(radius, intensity), brightness(value), contrast(value), saturate(value), hue-rotate(angle), sepia(amount), invert(amount), vignette(darkness, size), chromatic(amount), threshold(threshold), color-overlay(color, opacity, blendMode), pixelate(size)

## Global PostFX (whole canvas, via addPostFX)
bloom(intensity, threshold), chromatic(amount), distort(strength, speed), vignette(darkness, offset), grain(amount), feedback(amount, zoom, rotation)

## Transform
x(pixels offset), y(pixels offset), scaleX(0.1-10), scaleY(0.1-10), rotation(degrees)

## Response Format
Brief explanation (1-3 sentences), then if making changes:

\`\`\`json
{
  "commands": [
    { "action": "clearScene" },
    { "action": "addLayer", "type": "NoiseFieldLayer", "name": "Background", "params": { "mode": "aurora", "hueA": 30, "hueB": 60 }, "blend": "normal", "opacity": 1 },
    { "action": "addLayer", "type": "ParticleLayer", "name": "Fireflies", "params": { "mode": "fireflies", "count": 400, "colorMode": "warm" }, "blend": "add", "opacity": 0.8 },
    { "action": "addModRoute", "layerId": "auto:1", "source": "bass", "target": "size", "depth": 0.4, "smooth": 0.15 },
    { "action": "addLayerFX", "layerId": "auto:1", "fxType": "glow", "params": { "radius": 8, "intensity": 0.6 } }
  ]
}
\`\`\`

Use "auto:N" for layers added in this response (0-indexed). Use actual layer ids for existing layers.
Available actions: addLayer, removeLayer, clearScene, setParam, setBlend, setOpacity, setTransform, addModRoute, addLayerFX, addPostFX, setName

## Vibe for Bearfeet (indie folk band)
Organic, warm, earthy. Think: fireflies, aurora borealis, starfields, candlelight, wood grain, flowing rivers, morning mist. Avoid harsh strobing or aggressive rave aesthetics. Prefer slow breathing animations, warm color palettes (ambers, greens, teals), screen and add blend modes over harsh ones. For quiet intimate songs: low particle counts, aurora/marble noise, soft glow. For energetic songs: more particles, wave mode, beat-reactive scale pulses.`;
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
            let l;
            if (cmd.type === 'ShaderLayer' && cmd.shaderName) {
              l = ShaderLayer.fromBuiltin(cmd.shaderName);
            } else {
              l = _layerFactory(cmd.type);
            }
            if (!l) { console.warn('VaelAssistant: unknown layer type', cmd.type); break; }
            if (cmd.name) l.name = cmd.name;
            if (cmd.params && l.params) Object.assign(l.params, cmd.params);
            if (typeof l.init === 'function') l.init(l.params || {});
            if (cmd.blend)               l.blendMode = cmd.blend;
            if (cmd.opacity !== undefined) l.opacity  = cmd.opacity;
            if (cmd.transform)           Object.assign(l.transform, cmd.transform);
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

  const API_KEY_STORAGE = 'vael-claude-api-key';

  function _getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  }

  function _setApiKey(key) {
    localStorage.setItem(API_KEY_STORAGE, key);
  }

  // ── API call ─────────────────────────────────────────────────

  async function _callClaude(userMessage) {
    const apiKey = _getApiKey();
    if (!apiKey) throw new Error('No API key set — click ⚙ to add your Claude API key');

    const systemPrompt = _buildSystemPrompt();

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-io': 'true',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system:     systemPrompt,
          messages:   _messages.concat([{ role: 'user', content: userMessage }]),
        }),
      });
    } catch (networkErr) {
      // CORS or network failure — usually means running from file:// or a
      // domain that isn't allowlisted by Anthropic for direct browser access.
      throw new Error(
        'Cannot reach the Anthropic API from this page. ' +
        'This usually means the page is served from a domain not permitted ' +
        'for direct browser API calls. ' +
        'Try opening Vael from localhost or your GitHub Pages URL, ' +
        'and make sure your API key is correct.'
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`API error ${response.status}: ${err.error?.message || response.statusText}`);
    }

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
      min-width: 280px;
      min-height: 200px;
      background: var(--bg-mid);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 401;
      font-family: var(--font-ui);
      resize: both;
    `;

    _panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;
                  border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-family:var(--font-mono);font-size:11px;letter-spacing:2px;
                     color:var(--accent);flex:1">VAEL ASSISTANT</span>
        <button id="va-settings" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-size:14px;padding:2px 6px" title="API key settings">⚙</button>
        <button id="va-clear" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-family:var(--font-mono);font-size:8px;padding:2px 6px">clear</button>
        <button id="va-close" style="background:none;border:none;color:var(--text-dim);
                cursor:pointer;font-size:16px">✕</button>
      </div>

      <!-- API key settings panel (hidden by default) -->
      <div id="va-key-panel" style="display:none;padding:12px 16px;
           border-bottom:1px solid var(--border);background:rgba(0,0,0,0.3);flex-shrink:0">
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:8px">
          CLAUDE API KEY
        </div>
        <div style="display:flex;gap:8px">
          <input type="password" id="va-key-input" placeholder="sk-ant-api03-…"
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;
                   color:var(--text);font-family:var(--font-mono);font-size:10px;padding:6px 8px" />
          <button id="va-key-save" class="btn accent" style="font-size:9px;flex-shrink:0">Save</button>
        </div>
        <p style="font-size:9px;color:var(--text-dim);margin-top:6px;line-height:1.5">
          Get a key at <a href="https://console.anthropic.com" target="_blank"
          style="color:var(--accent)">console.anthropic.com</a>.
          Stored locally in your browser only.
        </p>
      </div>

      <div id="va-messages" style="flex:1;overflow-y:auto;padding:12px;
                                    scrollbar-width:thin;scrollbar-color:var(--border) var(--bg-mid)">
        <div class="va-msg assistant" style="background:rgba(0,212,170,0.06);border:1px solid rgba(0,212,170,0.15);
             border-radius:8px;padding:10px 12px;font-size:11px;color:var(--text);line-height:1.6;margin-bottom:8px">
          Hi! I'm the Vael assistant. I know how every layer, effect, and parameter works.<br><br>
          <strong>First:</strong> click ⚙ above to add your Claude API key.<br><br>
          Then try: <em style="color:var(--accent)">"make something that looks like a campfire"</em><br>
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

    // Make the panel header draggable so the chat window can be repositioned
    let _panelDragOffX = 0, _panelDragOffY = 0, _panelDragging = false;
    const panelHeader = _panel.querySelector('div');
    if (panelHeader) {
      panelHeader.style.cursor = 'move';
      panelHeader.addEventListener('pointerdown', e => {
        if (e.target.tagName === 'BUTTON') return;
        _panelDragging = true;
        const r = _panel.getBoundingClientRect();
        _panelDragOffX = e.clientX - r.left;
        _panelDragOffY = e.clientY - r.top;
        _panel.style.transition = 'none';
        panelHeader.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      panelHeader.addEventListener('pointermove', e => {
        if (!_panelDragging) return;
        const x = Math.max(0, Math.min(window.innerWidth  - 100, e.clientX - _panelDragOffX));
        const y = Math.max(0, Math.min(window.innerHeight - 40,  e.clientY - _panelDragOffY));
        _panel.style.left   = x + 'px';
        _panel.style.top    = y + 'px';
        _panel.style.right  = 'auto';
        _panel.style.bottom = 'auto';
      });
      panelHeader.addEventListener('pointerup', () => { _panelDragging = false; });
    }

    // FAB button — draggable, position saved to localStorage
    const fab = document.createElement('button');
    fab.id = 'vael-assistant-fab';

    const _fabPosKey = 'vael-assistant-fab-pos';
    const _fabSaved  = (() => {
      try { return JSON.parse(localStorage.getItem(_fabPosKey)); } catch { return null; }
    })();

    fab.style.cssText = `
      position: fixed;
      ${_fabSaved ? `left:${_fabSaved.x}px;top:${_fabSaved.y}px;` : 'bottom:24px;right:24px;'}
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--accent) 20%, var(--bg-mid));
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 22px;
      cursor: grab;
      z-index: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,212,170,0.3);
      transition: transform 0.1s;
      user-select: none;
      touch-action: none;
    `;
    fab.innerHTML = '✦';
    fab.title = 'Vael Assistant — drag to reposition, click to open';

    let _fabDragging = false;
    let _fabOffX     = 0;
    let _fabOffY     = 0;
    let _fabMoved    = false;

    fab.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      _fabDragging = true;
      _fabMoved    = false;
      const r = fab.getBoundingClientRect();
      _fabOffX = e.clientX - r.left;
      _fabOffY = e.clientY - r.top;
      fab.style.cursor     = 'grabbing';
      fab.style.transition = 'none';
      fab.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    fab.addEventListener('pointermove', e => {
      if (!_fabDragging) return;
      _fabMoved = true;
      const x = Math.max(0, Math.min(window.innerWidth  - 48, e.clientX - _fabOffX));
      const y = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - _fabOffY));
      fab.style.left   = x + 'px';
      fab.style.top    = y + 'px';
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
    });

    fab.addEventListener('pointerup', () => {
      if (!_fabDragging) return;
      _fabDragging        = false;
      fab.style.cursor    = 'grab';
      fab.style.transition = 'transform 0.1s';
      if (_fabMoved) {
        // Persist position
        try {
          localStorage.setItem(_fabPosKey, JSON.stringify({
            x: parseInt(fab.style.left),
            y: parseInt(fab.style.top),
          }));
        } catch {}
        // Reposition open panel near new FAB position
        _repositionPanel();
      } else {
        // No drag — treat as click
        toggle();
      }
    });

    fab.addEventListener('mouseenter', () => { if (!_fabDragging) fab.style.transform = 'scale(1.1)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
    document.body.appendChild(fab);

    // Wire events
    _panel.querySelector('#va-close').addEventListener('click', close);
    _panel.querySelector('#va-clear').addEventListener('click', () => {
      _messages = [];
      const msgs = _panel.querySelector('#va-messages');
      msgs.innerHTML = '';
    });

    // Settings toggle
    _panel.querySelector('#va-settings').addEventListener('click', () => {
      const kp = _panel.querySelector('#va-key-panel');
      kp.style.display = kp.style.display === 'none' ? 'block' : 'none';
      // Pre-fill with existing key (masked)
      const existing = _getApiKey();
      if (existing) _panel.querySelector('#va-key-input').placeholder = '••••••••' + existing.slice(-4);
    });

    _panel.querySelector('#va-key-save').addEventListener('click', () => {
      const val = _panel.querySelector('#va-key-input').value.trim();
      if (val) {
        _setApiKey(val);
        _panel.querySelector('#va-key-panel').style.display = 'none';
        _panel.querySelector('#va-key-input').value = '';
        Toast.success('API key saved');
      }
    });

    // Enter to save key
    _panel.querySelector('#va-key-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') _panel.querySelector('#va-key-save').click();
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
    // Position near FAB on first open (before user moves it manually)
    if (!_panel.style.left || _panel.style.left === 'auto') {
      _repositionPanel();
    }
    setTimeout(() => _panel.querySelector('#va-input')?.focus(), 100);
  }

  function close() {
    if (!_panel) return;
    _panel.style.display = 'none';
    _isOpen = false;
  }

  // Position the panel near the FAB when it opens or after the FAB is dragged
  function _repositionPanel() {
    if (!_panel || _panel.style.display === 'none') return;
    const fab = document.getElementById('vael-assistant-fab');
    if (!fab) return;
    const fr = fab.getBoundingClientRect();
    const pw = _panel.offsetWidth  || 380;
    const ph = _panel.offsetHeight || 400;
    let x = fr.left - pw + fr.width;
    let y = fr.top  - ph - 8;
    if (y < 8)                        y = fr.bottom + 8;
    if (x < 8)                        x = 8;
    if (x + pw > window.innerWidth)   x = window.innerWidth - pw - 8;
    _panel.style.left   = x + 'px';
    _panel.style.top    = y + 'px';
    _panel.style.right  = 'auto';
    _panel.style.bottom = 'auto';
  }

  function toggle() { _isOpen ? close() : open(); }

  return { init, open, close, toggle };

})();
