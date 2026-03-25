# Vael — Light onto Sound

A browser-based visual performance tool for live music.
Stack visual layers, map audio to visuals, export as video.

## Getting started

No installation. No build step.

1. Clone the repository
2. Open `index.html` in Chrome
3. That's it

```bash
git clone https://github.com/Sadonnodas/Vael.git
cd Vael
open index.html   # macOS
# or just drag index.html into Chrome
```

## Project structure

```
Vael/
├── index.html          Entry point — open this in Chrome
├── engine/             Core engine modules
│   ├── AudioEngine.js  Web Audio API — FFT analysis and smoothing
│   ├── VideoEngine.js  Webcam and video file input
│   ├── LayerStack.js   Manages the ordered list of layers
│   ├── Renderer.js     Composites layers to the canvas
│   └── Recorder.js     Captures canvas as WebM video
├── layers/             Visual layer plugins
│   ├── _BaseLayer.js   Base class — all plugins extend this
│   ├── GradientLayer.js  Audio-reactive colour gradient
│   └── MathVisualizer.js Mathematical constant visualizer (π, φ, e…)
├── utils/              Pure utility functions
│   ├── math.js         Lerp, clamp, easing, Perlin noise
│   ├── color.js        HSL/RGB conversion, palettes
│   ├── constants.js    Pi, e, phi digit strings
│   └── loader.js       File loading utilities
├── shaders/            GLSL shader files (Phase 2)
├── ui/
│   └── App.js          Wires everything together
└── presets/            Saved scenes (JSON)
```

## Writing a layer plugin

Every layer extends `BaseLayer` and exports a static `manifest`:

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
    this._time  = 0;
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  update(audioData, videoData, dt) {
    this._time += dt * this.params.speed;
  }

  render(ctx, width, height) {
    // Draw to ctx here
  }
}
```

Drop the file in `layers/` and add a script tag in `index.html`.
Add it to the layer stack in `ui/App.js`:

```javascript
const myLayer = new MyLayer('my-layer-1');
myLayer.init({ speed: 1.0 });
layers.add(myLayer);
```

## Keyboard shortcuts

| Key   | Action                        |
|-------|-------------------------------|
| Space | Play / pause audio            |
| F     | Toggle fullscreen / perf mode |

## Roadmap

- **Phase 1** (current) — Core engine, gradient + math layers, audio analysis, basic UI
- **Phase 2** — Particle system, noise field, MIDI learn, performance mode
- **Phase 3** — WebGL compositor, GLSL shaders, OSC bridge, scene presets

## Built with

- [Three.js](https://threejs.org/) — WebGL renderer (Phase 2)
- Web Audio API — audio analysis
- MediaRecorder API — canvas capture
- No framework. No build step. Open in Chrome.
