# Vael — Claude Code Handoff Document
_Last updated: April 13, 2026. Written for Claude Code (VS Code extension) to continue development._

---

## Project Overview

**Vael** is a browser-based + Electron audio-reactive visual performance tool. It runs as:
- A static web app via `npx serve .` (browser at localhost:3000)
- A native app via `npm start` from the project root (Electron)

**Never open `index.html` directly via `file://`** — it breaks security policies and IndexedDB.

### Project structure
```
/Users/toon/Projects/Vael/
├── index.html              # Main entry point — loads all scripts
├── package.json            # Root package (Electron + OSC/WS deps)
├── math.js                 # VaelMath utilities incl. noise2D (Perlin, returns -1 to +1)
├── constants.js
├── color.js
├── loader.js
├── engine/
│   └── Renderer.js         # WebGL + Canvas 2D compositor ← RECENTLY CHANGED
├── layers/
│   ├── _BaseLayer.js
│   ├── ParticleLayer.js    ← RECENTLY CHANGED
│   ├── PatternLayer.js     ← RECENTLY CHANGED
│   ├── GradientLayer.js
│   ├── NoiseFieldLayer.js
│   ├── ShaderLayer.js
│   ├── ImageLayer.js
│   ├── VideoPlayerLayer.js
│   ├── FeedbackLayer.js
│   ├── LyricsLayer.js
│   ├── WaveformLayer.js
│   ├── MathVisualizer.js
│   ├── CanvasPaintLayer.js
│   ├── GroupLayer.js
│   ├── SVGLayer.js
│   └── WebcamLayer.js
├── ui/
│   ├── App.js              ← RECENTLY CHANGED (main controller)
│   ├── ParamPanel.js       ← RECENTLY CHANGED
│   ├── LFOPanel.js         ← RECENTLY CHANGED (full rewrite)
│   ├── LayerPanel.js
│   ├── LayerFXPanel.js
│   ├── ModMatrixPanel.js
│   ├── PlaylistPanel.js
│   ├── PresetBrowser.js
│   ├── ShaderPanel.js
│   ├── VaelAssistant.js
│   ├── PerformanceMode.js
│   ├── MidiPanel.js
│   └── ... (many more panels)
├── electron/
│   ├── main.js             # Electron main process
│   ├── preload.js          # contextBridge
│   └── ElectronBridge.js   # Wires native APIs into Vael UI
└── .gitignore              # node_modules/, dist/, .DS_Store etc.
```

---

## Architecture — Critical Things to Know

### Rendering pipeline
1. Each layer has a `render(ctx, width, height)` method that draws to a 2D offscreen canvas
2. The Renderer reads those offscreen canvases and composites them via WebGL (for normal/screen/add/subtract) OR via Canvas 2D (for multiply/overlay/softlight/difference/exclusion/luminosity/color/hue/saturation)
3. Canvas 2D blend modes use an **overlay canvas** (`this._overlayCanvas`) positioned as a sibling to the WebGL canvas inside `#canvas-area`. It:
   - First copies the WebGL frame onto itself as a base (so blend modes have pixels to blend against)
   - Then draws each canvas-blend layer on top with the correct Canvas 2D composite operation
   - Is inserted BEFORE `#status-strip` in the DOM with `z-index:0` so the status bar stays visible
4. `preserveDrawingBuffer: true` on the WebGLRenderer is required for thumbnail capture and canvas readback
5. Canvas-blend layers are set to `opacity: 0.0001` in the WebGL pass so they don't double-render

### Canvas-blend modes (handled via Canvas 2D, NOT WebGL)
`multiply`, `overlay`, `softlight`, `hardlight`, `luminosity`, `color`, `hue`, `saturation`, `difference`, `exclusion`

All others use WebGL: `normal`, `screen`, `add`, `subtract`

### Coordinate system
- Layers receive `width` and `height` as CSS pixel dimensions (e.g. 1728 × 1117 on MacBook Pro)
- The Renderer translates ctx to canvas centre before calling `layer.render()`, so layers draw as if origin is centre
- Exception: trail canvas in ParticleLayer uses top-left origin (noted in comments)

### Audio
- `audioData` is passed to each layer's `update(audioData, videoData, dt)` method
- `audioData.isActive` — false when no audio playing
- `audioData.bass / mid / treble / volume` — 0 to 1, normalised
- `audioData.isBeat` — boolean, true on detected beats
- `audioData.bpm` — current BPM estimate
- **Audio reactivity is opt-in** — layers should NOT react unless `audioReact > 0` or a ModMatrix route exists

### Noise
- `VaelMath.noise2D(x, y)` returns **-1 to +1** (Perlin noise, already centred around zero)
- **DO NOT subtract 0.5** from the result
- For particle drift use **normalised coordinates**: `p.x / width + p.noiseOx` NOT `p.x * 0.004`
- `noiseOx/noiseOy` should be small values `rng(0, 4)` — values 0-500 cause directional bias

### LFOs
- Per-layer, stored on `layer._lfos` array
- Ticked every frame via `LFOPanel.tickAll(layers.layers, dt, bpm)` in App.js frame loop
- Write directly to `layer.params[paramId]` each frame
- Rendered per-layer in PARAMS panel between Modulation and FX sections — no global init needed

---

## What Was Fixed / Built (April 13 2026)

1. **Particle drift top-left** — normalised noise coords, noiseOx range 0-4 not 0-500
2. **Blend modes ghost frame** — overlay cleared when no canvas-blend layers active
3. **Blend modes all identical** — WebGL frame copied as base before Canvas 2D blend ops
4. **Blend modes hiding status bar** — overlay inserted before #status-strip, z-index:0
5. **difference/exclusion opacity** — moved to canvas-blend path
6. **Particles pulsing without audio** — synthetic beat only for pulse/scatter when audioReact > 0
7. **LFO icon on every param slider** — removed, now in dedicated LFO section
8. **PatternLayer mandala** — rewritten with bezier petals, filled toggle, hueShift param
9. **FeedbackLayer** — restored to Add Layer menu
10. **LFOPanel** — full rewrite: per-layer cards, multiple destinations, BPM sync, shape selector
11. **Scene thumbnails** — preserveDrawingBuffer + canvas.toDataURL()
12. **Image layer Change button** — shows when image already loaded

---

## Outstanding Bug

### Blend modes — opacity may still be partially broken
Test: particle layer on noise field, blend mode `multiply`, adjust opacity 0→100%. Should fade smoothly. If broken, trace from `quad._overlayOpacity` in `_syncQuads()` in Renderer.js.

---

## Features To Build

### HIGH PRIORITY — See VAEL_NEW_FEATURES_PROMPT.md for full implementation details

**1. Chroma Key FX** (`chroma-key`) — per-layer FX, removes pixels matching a key color (green screen). Files: `ui/LayerFX.js`, `ui/LayerFXPanel.js`. Includes eyedropper to sample color from canvas.

**2. Color Isolate FX** (`color-isolate`) — per-layer FX, keeps only pixels matching key color, makes rest transparent. Same files.

**3. Color Mask** — property on any layer (`layer.colorMask`) that punches holes by color. Applied in Renderer.js Pass 1 after render(). UI in `ParamPanel.js`.

**4. TileLayer** — new layer type (`layers/TileLayer.js`) that reads pixels from a source layer, crops a shape, tiles it across canvas. Supports: rectangle/circle/triangle/hexagon/diamond/freeform crop shapes, grid/hex/brick/diamond tile arrangements, mirror, feathered edges, animation, audio reactivity, and a `hideSource` flag.

### MEDIUM PRIORITY

**5. Shader param dynamic naming** — `ui/ShaderPanel.js`: parse `// iParam1 — description` from GLSL and use as slider labels. Hide unused iParam sliders.

**6. Scale X+Y linked modulation** — `ui/ModMatrixPanel.js` + `engine/ModMatrix.js`: link checkbox drives both scaleX and scaleY from one route.

**7. Scene browser improvements** — `ui/PresetBrowser.js`: list/grid toggle, search by name, multi-select + bulk download.

**8. FX tab PostFX reorder** — `ui/PostFXPanel.js`: drag-to-reorder or up/down buttons.

### LOWER PRIORITY

**9. More built-in shaders** (goal 15, currently 9) — `layers/ShaderLayer.js` BUILTINS array. Add: Voronoi, Truchet tiles, Reaction diffusion, Hypnotic tunnel, Water caustics, Glitch/datamosh. Each uses uniforms: `iTime`, `iResolution`, `iBass`, `iMid`, `iTreble`, `iBeat`, `iColorA`, `iColorB`, `iHueShift`, `iParam1/2/3`

**10. More particle modes** (goal 15, currently 10) — `layers/ParticleLayer.js`. Add: curl noise, flocking/boids, string/ribbon, galaxy spiral, DNA helix.

**11. Global FX modulation** — `ui/PostFXPanel.js`: ModMatrix-style audio routes for global FX params.

---

## Key Code Patterns

### Adding a new layer type
1. Create `layers/MyLayer.js` with `class MyLayer extends BaseLayer`
2. Add `static manifest = { name, params: [...] }`
3. Implement `update(audioData, videoData, dt)` and `render(ctx, width, height)`
4. Register in `App.js` `_layerFactory` switch and `LAYER_TYPES` array
5. Add `<script src="layers/MyLayer.js"></script>` to `index.html` before App.js
6. Add to `PresetManager.js` serialization if layer has non-standard state

### Adding a param to an existing layer
1. Add to `static manifest.params` with `{ id, label, type, default, min, max }`
2. Add to constructor `this.params` defaults
3. Use in `render()` via `this.params.myParam`
4. ParamPanel auto-renders sliders from manifest — no extra UI code needed

### Adding a canvas-blend mode
1. Add to `_isCanvasOnlyBlend()` in `Renderer.js`
2. Add to `_canvas2dBlendOp()` map in `Renderer.js`
3. Add to blend mode options in layer UI

### Correct particle noise drift pattern
```javascript
// CORRECT — normalised coords, small per-particle offset
const nx = VaelMath.noise2D(p.x / width  + p.noiseOx, this._time * 0.25);
const ny = VaelMath.noise2D(p.y / height + p.noiseOy, this._time * 0.25);
// noiseOx/noiseOy = rng(0, 4) — SMALL values

// WRONG — causes top-left drift bias
const nx = VaelMath.noise2D((p.x + p.noiseOx) * 0.004, ...) - 0.5;
```

### Accessing another layer's pixels (for TileLayer, Color Mask)
```javascript
const quad = window._vaelRenderer?._quads.get(layerId);
const offscreenCanvas = quad?.offscreen; // live canvas, updated every frame in Pass 1
```

### Hide a layer from output but keep it rendering (for TileLayer hideSource)
```javascript
// In consuming layer's update():
sourceLayer._hiddenSource = true; // set each frame

// In Renderer.js _compositeFrame() Pass 2, at top of forEach:
if (layer._hiddenSource) {
  layer._hiddenSource = false; // reset here, consuming layer re-sets next frame
  return; // skip compositing to screen
}
// Pass 1 (render to offscreen) is unaffected — pixels always available
```

---

## Electron Setup

- `npm start` from project root launches Electron
- Main process: `electron/main.js`
- Native features via `window.electronAPI` (contextBridge in `electron/preload.js`)
- Output window: `⊡ Output` button → canvas fullscreen on secondary display via BroadcastChannel

---

## Testing Checklist After Renderer.js Changes
- [ ] Normal blend — particles visible on noise field
- [ ] Screen — particles glow additively
- [ ] Multiply — particles darken noise field beneath them
- [ ] Overlay — contrast blend with noise field
- [ ] Difference — inverted colours where particles overlap
- [ ] Status bar visible in ALL blend modes
- [ ] Opacity 0→100% works for all blend modes
- [ ] No ghost frames when switching blend modes

## Testing Checklist After ParticleLayer.js Changes
- [ ] Drift — particles move in all directions, no top-left bias
- [ ] Trails — same random drift, trails persist
- [ ] Fireflies — same random drift
- [ ] No pulsing without audio (audioReact = 0)
- [ ] Particles fill full canvas on first render

---

## Files You Should NOT Change
- `math.js` — VaelMath is stable and correct
- `electron/preload.js` — contextBridge security boundary, fragile
- `index.html` — only add `<script>` tags for new files; don't touch CSS
- Any panel not listed in the outstanding features above

---

## How to Run

```bash
# Browser (recommended for development)
cd /Users/toon/Projects/Vael
npx serve .
# Open http://localhost:3000

# Electron
npm start

# Build Mac distributable
npm run build:mac
```

---

## About This Project

Built by Toon, a musician and visual artist, for live concert visuals with Audient ID14 audio interface, Boss Ampero MIDI footswitch, projected onto a screen during performances.

**Design principles:**
- Simplicity for live use — fewer clicks to do common things
- Audio reactivity is opt-in — layers don't react unless explicitly configured
- Performance first — target 60fps on MacBook Pro, CSS pixel dimensions (not device pixel ratio)
- All params modulatable — anything in a layer manifest can be driven by audio, MIDI, or LFO

**Full implementation prompts** for the new features are in `VAEL_NEW_FEATURES_PROMPT.md`.
