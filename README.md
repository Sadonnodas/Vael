# Vael — Light onto Sound

A browser-based visual performance tool for live music.
Stack layers, map audio to visuals, export as video. No install. Open in Chrome.

## Quick start

```bash
git clone https://github.com/Sadonnodas/Vael.git
cd Vael
open index.html   # or drag into Chrome
```

No npm, no build step, no framework. Just open index.html.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause audio |
| `F` | Enter / exit performance mode |
| `→` / `←` | Next / previous scene (with crossfade) |
| `1`–`9` | Jump to setlist scene by number |
| `S` | Open setlist panel (in performance mode) |
| `PageDown` / `PageUp` | Advance / previous lyrics line |
| `Escape` | Close panel or exit performance mode |

## Layers

| Layer | Description |
|-------|-------------|
| Gradient | Audio-reactive colour gradient background |
| Math Visualizer | 8 modes — path, tree, circle, chaos, spiral, walk, polar, plant |
| Particles | 4 modes — drift, fountain, orbit, pulse |
| Noise Field | Perlin noise breathing background |
| Lyrics / Text | Timed text overlay with fade/slide/typewriter transitions |
| Video | Video file or webcam as a layer |
| Shader — Plasma | Animated plasma colour field |
| Shader — Ripple | Concentric ripple, beat-reactive |
| Shader — Distort | Noise-warped UV distortion |
| Shader — Bloom | Radial glow driven by audio |
| Shader — Chromatic | RGB channel split, filmic |

## Post-processing (FX tab)

| Effect | Description |
|--------|-------------|
| Bloom | GPU glow around bright areas — bass-reactive intensity |
| Chromatic aberration | RGB channel offset — spikes on beat |
| Liquid distortion | Noise-based warp — audio-reactive strength |
| Vignette | Edge darkening |
| Film grain | Animated analog noise |

## Workflow for a concert

1. Load a song in the AUDIO tab
2. Build a scene (add layers, adjust params in PARAMS tab)
3. Add FX in the FX tab if desired
4. Save the scene: type a name in the LAYERS tab → Save scene
5. Hit Record in REC tab → Play the song → recording auto-stops when song ends → Download
6. Repeat for each song
7. Play the downloaded .webm files in VLC or any media player at the show

## Setlist / live mode

1. Build and save scenes per song
2. Load them into the setlist (performance mode → S key → Add)
3. Save the whole setlist as a .json file for next time
4. At the show: press F, use → to advance scenes with crossfade

## OSC control (Ableton / QLab)

1. Install: `npm install osc ws`
2. Run: `node osc-bridge.js`
3. Send OSC to `127.0.0.1:9000`

OSC addresses:
```
/vael/scene/next
/vael/scene/prev
/vael/scene/goto   <int>
/vael/layer/<id>/opacity  <float>
/vael/layer/<id>/param/<paramId>  <float>
/vael/record/start
/vael/record/stop
```

## MIDI

Connect any USB MIDI controller. Chrome requests access automatically.
Go to the MIDI tab to see connected devices and active links.
To map a knob: select a layer (click its name), go to MIDI tab, click Learn, move the knob.

## Writing a layer plugin

```javascript
class MyLayer extends BaseLayer {
  static manifest = {
    name: 'My Layer',
    version: '1.0',
    params: [
      { id: 'speed', label: 'Speed', type: 'float', default: 0.5, min: 0, max: 2 },
    ],
  };

  constructor(id) {
    super(id, 'My Layer');
    this.params = { speed: 0.5 };
  }

  init(params = {}) { Object.assign(this.params, params); }

  update(audioData, videoData, dt) {
    // audioData: { bass, mid, treble, volume, isBeat, bpm, isActive }
    // videoData: { brightness, motion, hue, edgeDensity, isActive }
  }

  render(ctx, width, height) {
    // ctx origin is at canvas centre (0,0 = centre)
    // Draw using Canvas 2D API
  }
}
```

Drop in `layers/`, add a script tag in `index.html`, add to `LAYER_TYPES` and `layerFactory` in `ui/App.js`.

## File structure

```
Vael/
├── index.html
├── osc-bridge.js        Node.js OSC→WebSocket bridge
├── engine/
│   ├── AudioEngine.js   Web Audio API, FFT, smoothing
│   ├── BeatDetector.js  Onset detection, BPM
│   ├── LayerStack.js    Layer ordering and management
│   ├── MidiEngine.js    Web MIDI, learn mode
│   ├── OscBridge.js     OSC over WebSocket (browser side)
│   ├── PostFX.js        GLSL post-processing passes
│   ├── PresetManager.js JSON scene save/load
│   ├── Recorder.js      Canvas capture → WebM
│   ├── Renderer.js      WebGL compositor (Three.js)
│   ├── SetlistManager.js Ordered scenes with crossfade
│   └── VideoEngine.js   Video/webcam + pixel analysis
├── layers/
│   ├── _BaseLayer.js
│   ├── GradientLayer.js
│   ├── LyricsLayer.js
│   ├── MathVisualizer.js
│   ├── NoiseFieldLayer.js
│   ├── ParticleLayer.js
│   ├── ShaderLayer.js
│   └── VideoPlayerLayer.js
├── ui/
│   ├── App.js
│   ├── LyricsPanel.js
│   ├── MidiPanel.js
│   ├── ParamPanel.js
│   ├── PerformanceMode.js
│   └── PostFXPanel.js
└── utils/
    ├── color.js
    ├── constants.js
    ├── loader.js
    └── math.js
```