# Vael — Claude Code Handoff Document
_Last updated: April 11, 2026. Written for Claude Code (VS Code extension) to continue development._

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
3. Canvas 2D blend modes use an **overlay canvas** (`this._overlayCanvas`) that sits on top of the WebGL canvas. It first copies the WebGL frame as a base, then draws blend-mode layers on top.
4. `preserveDrawingBuffer: true` on the WebGLRenderer is required for thumbnail capture and the canvas readback.

### Coordinate system
- Layers receive `width` and `height` as CSS pixel dimensions (e.g. 1728 × 1117 on a MacBook Pro)
- The canvas origin for layer rendering is **top-left (0,0)** — but the Renderer translates to centre before calling `render()`, so layers draw as if origin is the centre of the canvas
- Exception: trail canvas in ParticleLayer uses top-left origin (noted in comments)

### Audio
- `audioData` is passed to each layer's `update(audioData, videoData, dt)` method
- `audioData.isActive` — false when no audio playing
- `audioData.bass / mid / treble / volume` — 0 to 1, normalised
- `audioData.isBeat` — boolean, true on detected beats
- `audioData.bpm` — current BPM estimate

### Noise
- `VaelMath.noise2D(x, y)` returns **-1 to +1** (Perlin noise)
- DO NOT subtract 0.5 from the result — it's already centred around zero
- For particle drift: use **normalised coordinates** `p.x / width` not `p.x * 0.004` — large absolute coords cause directional bias in the noise field

### LFOs
- Per-layer, stored on `layer._lfos` array
- Each LFO ticks every frame via `LFOPanel.tickAll(layers.layers, dt, bpm)` called in App.js frame loop
- LFOs write directly to `layer.params[paramId]` each frame

---

## What Was Recently Fixed (This Session)

1. **Particle drift top-left** — Fixed by using normalised noise coordinates (`p.x/width + noiseOx`) and reducing `noiseOx` range from 0-500 to 0-4
2. **Blend modes ghost frame** — Fixed by clearing overlay canvas when no canvas-blend layers are active
3. **Blend modes all looked identical** — Fixed by copying WebGL frame onto overlay canvas as base before applying Canvas 2D blend ops
4. **Blend modes hiding status bar** — Fixed by inserting overlay canvas before `#status-strip` in DOM and using `z-index:0`
5. **difference/exclusion opacity** — Fixed by moving them to canvas-blend path
6. **Particles pulsing without audio** — Fixed: synthetic beat only fires for pulse/scatter modes when `audioReact > 0`
7. **LFO ∿ icon on every param slider** — Removed (now handled by dedicated LFO section in PARAMS)
8. **PatternLayer mandala** — Rewritten with bezier petals, filled toggle works, hueShift param added
9. **FeedbackLayer** — Restored to Add Layer menu
10. **App.js syntax error** — Was caused by a `//` comment swallowing a closing `}` on same line

---

## Outstanding Bugs & Features To Build

### 🔴 High Priority Bugs

#### 1. Blend modes — opacity still partially broken for some modes
Some canvas-blend modes may still have opacity issues. Test: add particle layer, set blend mode to `multiply`, adjust opacity slider — verify it smoothly fades from invisible to full effect.

#### 2. Blend mode visual correctness — needs user testing
The blend modes now composite correctly in theory (WebGL frame copied as base). User needs to confirm multiply/overlay/softlight/difference look visually correct vs expectation.

---

### 🟡 Medium Priority Features

#### 3. Shader param sliders — dynamic naming from GLSL comments
**File:** `ui/ShaderPanel.js`

ShaderLayer GLSL shaders can have comments like:
```glsl
// iParam1 — grid density (number of dots), default ~0.5
// iParam2 — animation speed, default ~0.5
```

Parse these comments from the GLSL source and use them as slider labels instead of generic "Param 1", "Param 2", "Param 3".

Implementation:
- In `ShaderPanel.js`, after loading GLSL source, scan for `// iParam1 —` or `// iParam1:` patterns
- Extract the description after the dash/colon
- Use as the slider label in the UI
- Also: only show iParam sliders that are actually referenced in the GLSL (`iParam1`, `iParam2`, `iParam3`) — hide unused ones

#### 4. Scale X+Y linked modulation
**File:** `ui/ModMatrixPanel.js` and `engine/ModMatrix.js`

Add a "link" checkbox to ModMatrix routes targeting `transform.scaleX` or `transform.scaleY`. When linked, one route drives both axes simultaneously (uniform scale). 

#### 5. Scene browser improvements
**File:** `ui/PresetBrowser.js`

- Add list/grid view toggle (currently grid only)
- Add search/filter by name
- Add multi-select + bulk download as zip

#### 6. FX tab PostFX reorder
**File:** `ui/PostFXPanel.js`

The global FX chain (bloom, chromatic aberration, etc.) currently can't be reordered. Add drag-to-reorder or up/down buttons.

---

### 🟢 Lower Priority / Polish

#### 7. NoiseFieldLayer particle drift direction
**File:** `layers/NoiseFieldLayer.js`

Similar to the ParticleLayer fix — the plasma/noise field shader may drift toward bottom-left. Check if the GLSL uses a time offset that accumulates in one direction. Add a `driftAngle` param (0-360°) or randomise drift direction on init.

#### 8. Add more built-in shader presets
**File:** `layers/ShaderLayer.js` — `ShaderLayer.BUILTINS` array

Currently 9 built-in shaders. Goal is 15. Good candidates to add:
- Voronoi / cellular noise
- Truchet tiles  
- Reaction diffusion
- Hypnotic tunnel
- Water caustics
- Glitch / datamosh effect

Each needs: name, description, GLSL source using `iTime`, `iResolution`, `iBass`, `iMid`, `iTreble`, `iBeat`, `iColorA`, `iColorB`, `iHueShift`, `iParam1/2/3`

#### 9. Add more particle modes
**File:** `layers/ParticleLayer.js` — `_newParticle()` switch and render loop

Currently 10 modes. Candidates: curl noise, flocking/boids, string/ribbon, galaxy spiral, DNA helix

#### 10. Global FX modulation
**File:** `ui/PostFXPanel.js`

Allow ModMatrix-style routes on global FX params (bloom intensity, aberration amount, etc.) triggered by audio signals.

---

## Key Code Patterns

### Adding a new layer type
1. Create `layers/MyLayer.js` with `class MyLayer extends BaseLayer`
2. Add `static manifest = { name, params: [...] }` 
3. Implement `update(audioData, videoData, dt)` and `render(ctx, width, height)`
4. Register in `App.js` `_layerFactory` switch and `LAYER_TYPES` array
5. Add `<script src="layers/MyLayer.js">` to `index.html`

### Adding a param to an existing layer
1. Add to `static manifest.params` array with `{ id, label, type, default, min, max }`
2. Add to constructor `this.params` defaults
3. Use in `render()` via `this.params.myParam`
4. ParamPanel auto-renders sliders from manifest — no UI code needed

### Canvas-blend modes
Modes handled via Canvas 2D (not WebGL):
`multiply`, `overlay`, `softlight`, `hardlight`, `luminosity`, `color`, `hue`, `saturation`, `difference`, `exclusion`

To add a new canvas-blend mode:
1. Add to `_isCanvasOnlyBlend()` in `Renderer.js`
2. Add to `_canvas2dBlendOp()` map in `Renderer.js`
3. Add to the blend mode options in the layer UI

### Particle noise drift (correct pattern)
```javascript
// CORRECT — normalised coords, small per-particle offset
const nx = VaelMath.noise2D(p.x / width  + p.noiseOx, this._time * 0.25);
const ny = VaelMath.noise2D(p.y / height + p.noiseOy, this._time * 0.25);
// noiseOx/noiseOy initialised as rng(0, 4) — SMALL values

// WRONG — absolute coords cause top-left drift bias
const nx = VaelMath.noise2D((p.x + p.noiseOx) * 0.004, ...) - 0.5;
```

---

## Electron Setup

- `npm start` from project root launches Electron
- Main process: `electron/main.js`
- Renderer process: `index.html` (same as browser)
- Native features exposed via `window.electronAPI` (contextBridge in `electron/preload.js`)
- Direct Anthropic API calls go through Node.js (no CORS) when running in Electron
- Output window: `⊡ Output` button → canvas fullscreen on secondary display via BroadcastChannel

---

## Testing Checklist After Changes

After any Renderer.js change:
- [ ] Normal blend mode — particles visible on noise field
- [ ] Screen blend — particles glow (additive)  
- [ ] Multiply — particles darken the noise field beneath them
- [ ] Overlay — contrast blend with noise field
- [ ] Difference — inverted colours where particles overlap noise
- [ ] Status bar still visible (fps, layer count) in ALL blend modes
- [ ] Opacity slider works 0-100% for all blend modes
- [ ] No ghost frames when switching blend modes

After any ParticleLayer.js change:
- [ ] Drift mode — particles move in all directions, no top-left bias
- [ ] Trails mode — same random drift, trails persist correctly
- [ ] Fireflies mode — same random drift
- [ ] No pulsing without audio (audioReact = 0)
- [ ] Particles fill the full canvas (no small cluster top-left)

---

## Files You Should NOT Change

- `math.js` — VaelMath is stable, noise2D implementation is correct
- `electron/preload.js` — contextBridge security boundary, fragile
- `index.html` — only change script tags when adding new files; don't touch CSS
- Any `*Panel.js` files not listed in the outstanding work above — they're stable

---

## How to Run

```bash
# Browser (recommended for development)
cd /Users/toon/Projects/Vael
npx serve .
# Open http://localhost:3000

# Electron
npm start

# Build distributable (Mac)
npm run build:mac
```

---

## Contact / Context

This project was developed over 4 sessions with Claude (claude.ai). The user is Toon, a musician and visual artist building Vael for live concert visuals. The tool is used with an Audient ID14 audio interface, Boss Ampero MIDI controller, and projected onto a screen during performances.

Design principles:
- **Simplicity for live use** — fewer clicks to do common things
- **Audio reactivity is opt-in** — layers should NOT react to audio unless explicitly configured via ModMatrix or LFO
- **Performance first** — target 60fps on MacBook Pro, canvas renders at CSS pixel size (not device pixel ratio)
- **All params modulate-able** — anything in a layer manifest can be driven by audio, MIDI, or LFO
