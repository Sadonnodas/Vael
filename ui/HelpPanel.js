/**
 * ui/HelpPanel.js
 * In-app manual and step-by-step tutorial for Vael.
 *
 * Self-contained — no external dependencies.
 * Renders into #tab-help when init() is called.
 *
 * Sections:
 *   1. Tab-by-tab reference
 *   2. Three worked tutorials
 *   3. Keyboard shortcuts
 *   4. How modulations work (answers the recurring question)
 */

const HelpPanel = (() => {

  // ── Content ───────────────────────────────────────────────────

  const TABS_REFERENCE = [
    {
      tab: 'LAYERS',
      color: '#00d4aa',
      summary: 'The layer stack — add, reorder, and manage every visual element.',
      items: [
        ['+ Add layer', 'Opens the layer picker. Click a type to create it and add it to the top of the stack.'],
        ['Layer order', 'Layers at the top of the list are composited last (drawn on top). Drag rows to reorder.'],
        ['Visibility ◉', 'Click the eye icon to show/hide a layer without deleting it.'],
        ['Blend modes', 'How a layer composites onto everything below it. Screen and Add are great for glowing light effects. Multiply darkens. Difference creates inverting colour shifts.'],
        ['Opacity', 'The percentage next to the layer name. Double-click a layer name to rename it.'],
        ['Solo', 'Hold Shift and click a layer name to solo it — all others hide temporarily.'],
        ['Groups', 'Select multiple layers with Ctrl+click, then click Group. The group gets a single opacity/blend mode applied to all children together. Expand with the ▾ arrow.'],
        ['Drag into group', 'Drag any layer row onto the drop zone that appears inside an expanded group.'],
        ['Eject from group', 'Click ⇥ next to a child layer to move it back to the main stack.'],
      ],
    },
    {
      tab: 'PARAMS',
      color: '#7c6af7',
      summary: 'All controls for the selected layer — organised into collapsible sections.',
      items: [
        ['Transform & Opacity', 'Always shown at the top. X/Y position, Scale X/Y, Rotation, Opacity, and Blend mode. These apply to the whole layer on top of any ModMatrix routes.'],
        ['Parameters', 'Layer-specific controls. Sliders are click-and-drag. Click the number on the right to type an exact value. Press Enter to confirm, Escape to cancel.'],
        ['Hue sliders', 'Hue params (0–360) show a colour strip and a hex input. Drag the slider, click the swatch, or type a hex code — all three stay in sync.'],
        ['Modulation', 'Routes that connect audio/video signals or engine values to any parameter. See the Modulations section below for a full explanation.'],
        ['Layer FX', 'Per-layer post-processing: blur, glow, chromatic aberration, hue-rotate, vignette, and more. Multiple effects stack in order.'],
        ['MIDI badge', 'If a param has a MIDI CC mapped to it, a small "CC42" badge appears next to its label. Hover for full details.'],
        ['↺ Reset params', 'Restores all layer parameters to their manifest defaults. Transform is unaffected.'],
      ],
    },
    {
      tab: 'LAYER TYPES',
      color: '#54a0ff',
      summary: 'Every layer type explained — what it does, when to use it, and key parameters.',
      items: [
        ['🎨 Gradient', 'Full-canvas colour gradient. 15 modes including Linear, Radial, Conic, Sunset, Vortex, Aurora, Mesh, and more. Use as a background behind everything else, or on Screen blend mode as a colour wash. Key params: Hue A/B/C, Saturation, Lightness, Angle, Speed.'],
        ['🌊 Noise Field', '15 modes of animated noise texture: Field, Flow, Marble, Aurora, Turbulence, Voronoi, Cellular, Ridges, Domain-warp, FBM, Curl, Wood, Cloud, Crystal, Plasma. Excellent as backgrounds and as mask sources. Key params: Hue A/B, Scale, Speed, Contrast, Lightness.'],
        ['⬡ Pattern', '15 geometric pattern modes: Star, Mandala, Hexgrid, Circles, Lissajous, Spirograph, Flower, Grid, Triangles, Weave, Rings, Cross, Labyrinth, Kaleidoscope, Dots. Use Screen blend to overlay patterns on video. Key params: Size, Speed, Color 1/2, Line width.'],
        ['✦ Particles', '15 particle system modes: Drift, Fountain, Orbit, Pulse, Fireflies, Scatter, Rain, Vortex, Trails, Magnet, Explosion, Strings, Spiral, Snow, Galaxy. Particles work as mask sources — add a mask to an Image layer pointing to a Particle layer and particles reveal the image. Key params: Mode, Count, Size, Speed, Color mode, Trail length (trails mode).'],
        ['〜 Waveform', '15 audio visualiser modes: Waveform, Bars, Mirror, Radial, Particles, Spectrogram, Scope, Ribbon, Circle-bars, Tunnel, Polar, Blob, Dots-freq, Arc, Waterfall. Requires audio input. Key params: Mode, Color, Amplitude, Smoothing, Bar count.'],
        ['∑ Math Visualizer', 'Complex mathematical visualisations — reaction-diffusion, flow fields, Lissajous curves, fractals, and more. These are CPU-intensive and best used sparingly. Audio-reactive via audioReact slider.'],
        ['🖼 Image', 'Load any PNG, JPG, WebP, or SVG from the Library. Works as a static frame or mask source. Key params: Fit mode (contain/cover/stretch/original), Tint hue, Audio scale, Audio rotate, Pulse on beat. To add SVGs: load them via the Library tab exactly like any image file.'],
        ['🖼 Slideshow', 'Cycles through a set of images from the Library. On creation a picker opens to choose and order images. Transitions: cut, crossfade, slide-left, slide-right, zoom-in, zoom-out. Order: sequential, random, ping-pong. Beat advance fires on detected beats. Edit images any time via the "🖼 Edit images" button at the top of PARAMS.'],
        ['🎬 Video', 'Plays a video file or webcam stream as a layer. Supports all blend modes and opacity. Video can be used as a mask source. Key params: Fit mode, Playback speed, Flip horizontal, Audio react.'],
        ['📷 Webcam', 'Live webcam feed rendered as a layer. Same controls as Video. Useful for interactive installations or mixing with generative visuals.'],
        ['💬 Lyrics / Text', 'Displays text on the canvas with 30+ fonts. Text can be static, animated (typewriter, bounce, wave), or beat-synced. Supports multiple lines. Key params: Text content, Font, Size, Color, Animation mode, Alignment.'],
        ['✏ Canvas Paint', 'A persistent offscreen canvas you draw on directly in the browser. Click and drag on the canvas to paint. Supports brush size, opacity, and color. Painted content persists between sessions (saved with the project). Use as a mask or overlay.'],
        ['⚡ Shaders', '15 built-in GLSL shaders: Plasma, Ripple, Distort, Bloom, Chromatic, Kaleidoscope, Tunnel, Voronoi, Turing, FBM Clouds, Rings, Aurora, Julia Fractal, Lissajous, Grid. Plus a Custom (blank) shader for writing your own GLSL. Key params: Scale, Speed, audioReact (gates all audio uniforms). Custom shaders receive iBass, iMid, iTreble, iVolume, iBeat, iTime, iResolution uniforms.'],
        ['↩ Feedback (use FX tab)', 'Architecturally cannot work as a canvas 2D layer — use FX tab → Add → "Feedback trail" instead. The FX version is the working GPU implementation with Amount, Zoom, Rotation, Hue drift, and Decay controls.'],
        ['▤ Group', 'Wraps multiple layers into a single compositing unit. All children are rendered to an offscreen buffer, then the group is composited with a single opacity/blend mode. Useful for applying a blend mode to a collection of layers together. Drag layers into/out of groups in the LAYERS tab.'],
        ['How SVGs work', 'SVG files are supported by the Image and Slideshow layer types. To use an SVG: go to LIBRARY tab → click the image upload area → select your .svg file. It appears in the library and can be loaded into any Image layer. SVGs scale perfectly at any resolution. Complex animated SVGs may not animate (only static SVG is supported).'],
        ['Masks', 'Any layer can use another layer as a luminance mask. In PARAMS → Transform & Opacity, the Mask dropdown lists all other layers. Where the mask layer is bright, the masked layer is visible; where dark, it is hidden. Particle trails revealing an image is the classic use: set particles as the mask of an image layer.'],
      ],
    },
    {
      tab: 'FX',
      color: '#ff9f43',
      summary: 'Global post-processing — applied after all layers composite, affects the whole output.',
      items: [
        ['Bloom', 'Adds a glow halo around bright areas. Bass-reactive intensity. Good with Screen-blended particle layers.'],
        ['Chromatic aberration', 'Splits RGB channels outward from centre — filmic, glitchy look. Spikes on each beat.'],
        ['Liquid distortion', 'Noise-based UV warp. Strength scales with bass. Speed controls how fast the distortion field moves.'],
        ['Vignette', 'Darkens the edges. Darkness = how dark, Size = how far from centre the darkening starts.'],
        ['Film grain', 'Animated analogue noise texture. Subtle amounts (0.03–0.06) add warmth without being distracting.'],
        ['Order matters', 'Effects run top-to-bottom in the list. Bloom before grain looks different from grain before bloom.'],
      ],
    },
    {
      tab: 'SCENES',
      color: '#54a0ff',
      summary: 'Build a setlist of named scenes, switch between them with crossfades.',
      items: [
        ['Save scene', 'Type a name in the field and click Save. The current layer stack and all parameter values are stored.'],
        ['Load scene', 'Click a saved scene in the list to load it. Choose the transition type and duration in the setlist panel.'],
        ['Transitions', 'Crossfade blends old and new layers over time. Flash whites out and snaps at the peak. Blur softens through a defocus. Cut is instant.'],
        ['Auto-thumbnail', 'Enable "Auto-capture thumbnail on scene switch" in the setlist panel (S key in performance mode) to automatically capture a preview image of each scene after loading it.'],
        ['Setlist order', 'In the scene grid (G key in performance mode), drag tiles to reorder them.'],
      ],
    },
    {
      tab: 'AUDIO',
      color: '#ff6b6b',
      summary: 'Audio input — file, microphone, or system audio.',
      items: [
        ['Load file', 'Click "Load audio file" or drag an MP3/WAV/OGG onto the panel. Use the Loop toggle to repeat it.'],
        ['Mic input', 'Click "Use microphone" to analyse live audio from your default input device.'],
        ['System audio', 'Click "Capture system audio" — Chrome will ask you to share a tab or window. Check "Share tab audio" in the prompt. This is how you route Spotify, Ableton, or any playing audio into Vael.'],
        ['Smoothed signals', 'Bass, Mid, Treble, and Volume are smoothed and normalised in real time. They always fill 0–1 regardless of the track\'s loudness — Vael self-calibrates.'],
        ['Audio react = 0', 'Setting any layer\'s Audio React slider to 0 completely stops all audio-driven movement including beat pulses. Use this when you want a layer to be static.'],
      ],
    },
    {
      tab: 'BEAT',
      color: '#ffd700',
      summary: 'Beat detection, BPM, tap tempo, step sequencer, and signal meters.',
      items: [
        ['Beat detector', 'Analyses the audio frame by frame using spectral flux onset detection — watches for sudden increases in frequency content indicating transients like drum hits. Outputs: a beat pulse (iBeat), per-band beats (kick/snare/hi-hat), BPM estimate, and phrase tracking (beat 1–4 within a bar, bar 1–4 within a phrase).'],
        ['Flux', 'Spectral flux measures how fast the audio spectrum is changing frame to frame. High flux = sharp transient (drum hit, note attack). Low flux = sustained tone or silence. The beat detector uses flux to find onsets. Also available as a ModMatrix source — drives visuals on any transient, not just on-beat ones.'],
        ['Step sequencer', 'Eight buttons across the top of the BEAT tab represent 8 evenly-spaced steps per bar. Click a step to cycle through its event type. Steps fire in sync with BPM from tap tempo, beat detector, or MIDI clock.'],
        ['None', 'Silent rest — step does nothing. Use for gaps between events.'],
        ['Beat', 'Soft visual pulse (0.3 intensity), same signal as an audio-detected beat. Good for subtle regular reactions.'],
        ['Flash', 'Full white screen flash (1.0 intensity). Very obvious — use sparingly for drops or climactic moments.'],
        ['Zoom', 'Brief zoom-in snap on MathVisualizer layers. Layers spring outward and settle back.'],
        ['Color', 'Hue shift applied to all layers simultaneously on that step.'],
        ['Sensitivity sliders', 'Flux sensitivity: how much louder than the noise floor a transient must be to trigger. Min interval: minimum ms gap between beats — prevents double-triggering on a single hit.'],
        ['Auto-calibrate', 'Click \'Auto-calibrate (8s)\', play audio, and wait. Vael sets thresholds from your track\'s actual signal distribution. Run during a representative section — not silence or a quiet intro.'],
        ['Tap tempo', 'Press T (or TAP button in the performance HUD) at least 3 times to set BPM manually. Averages the last 8 taps. Useful when the detector struggles with a specific track.'],
        ['MIDI clock', 'When a MIDI clock arrives from a DAW or drum machine, it overrides the beat detector BPM. All LFO divisions, ModMatrix beat routes, and the sequencer snap to the external clock.'],
        ['Signal meters', 'Live readout of all signals: RMS, spectral centroid (brightness), spectral flux, and per-band energy (kick/snare/hi-hat). If a meter barely moves, routing from that signal won\'t produce visible results.'],
      ],
    },
    {
      tab: 'VIDEO',
      color: '#2ed573',
      summary: 'Video input — file or webcam — for video layers and video-driven modulation.',
      items: [
        ['Load video', 'Click "Load video file". The video loops silently and is used as the source for Video layers.'],
        ['Webcam', 'Click "Use webcam" to start live webcam input.'],
        ['Video signals', 'Brightness, Motion, Hue, and Edge Density are computed from every frame of the video and exposed as modulation sources in ModMatrix. Motion is especially useful — it spikes when fast movement happens.'],
        ['Video layer', 'Add a "Video file" layer to render the video as part of your scene. Set blend mode to Screen or Multiply for compositing effects.'],
      ],
    },
    {
      tab: 'LIBRARY',
      color: '#a78bfa',
      summary: 'Upload and manage images and video files for use across layers.',
      items: [
        ['Images', 'Uploaded images are available to all Image layers and SVG layers in the session. They persist across reloads via IndexedDB.'],
        ['Videos', 'Upload multiple video files here. Each Video Player layer can independently choose which library video to play from its PARAMS tab.'],
        ['Persistence', 'The library survives page reloads. Files are stored locally in IndexedDB — nothing is sent to a server.'],
      ],
    },
    {
      tab: 'MIDI',
      color: '#ff6b6b',
      summary: 'Connect MIDI controllers, map knobs to parameters, and receive MIDI clock.',
      items: [
        ['Connect', 'Chrome requests MIDI access automatically on first use. Connect your controller before opening the page for best results.'],
        ['MIDI Learn', 'Select a layer in PARAMS, click "Start learn" in the MIDI tab, then move a knob on your controller. The first CC message received gets linked to the first float/int param of the selected layer. For specific params, click the Learn button in the MIDI tab and then move the relevant slider in PARAMS.'],
        ['CC badges', 'Once mapped, a "CC42" badge appears on the slider in PARAMS. Hover to see full details.'],
        ['MIDI clock', 'If your DAW or drum machine sends MIDI clock (24 PPQ), Vael receives it on any connected input and derives BPM. This overrides the beat detector — all LFOs, ModMatrix routes, and the sequencer sync to the external clock.'],
        ['Fader boards', 'Any MIDI controller with faders works. Map each fader to a layer param using Learn mode. Groups of faders are great for controlling multiple layer opacities simultaneously.'],
      ],
    },
    {
      tab: 'REC',
      color: '#ff4757',
      summary: 'Capture the canvas output as a WebM video file.',
      items: [
        ['Manual record', 'Click Start, do your visuals, click Stop, then Download. The recording includes audio if audio is playing.'],
        ['Quick record', 'Load an audio file, then click Quick Record. It starts recording, plays the audio from the beginning, and stops automatically when the track ends. Perfect for full-song exports.'],
        ['Resolution', 'Set to 1920×1080 for broadcast-quality export. The canvas scales up during recording and restores afterward.'],
        ['Format', 'Exports as WebM (VP9+Opus). Chrome plays it natively. For MP4 convert with HandBrake or ffmpeg: ffmpeg -i recording.webm -c:v libx264 output.mp4'],
        ['Audio + video', 'The recording captures both canvas video and the audio that\'s playing through Vael\'s AudioEngine. System audio and microphone input are both captured.'],
      ],
    },
    {
      tab: 'AUTO (Timeline)',
      color: '#00d4aa',
      summary: 'Record parameter automation and play it back in sync.',
      items: [
        ['Record', 'Click Record in the Timeline tab, then move any parameter sliders. Every movement is captured with a timestamp.'],
        ['Playback', 'Click Play to loop the recorded automation. The timeline shows each lane as a waveform — you can see exactly what was recorded.'],
        ['Loop', 'Automation loops continuously. Great for cyclical effects that would be tedious to build with LFOs.'],
        ['Multiple clips', 'Record multiple takes as separate clips and switch between them. Each clip can have different lanes.'],
      ],
    },
  ];

  const TUTORIALS = [
    {
      title: 'Build a basic audio-reactive scene from scratch',
      steps: [
        {
          heading: 'Load audio',
          body: 'Go to the AUDIO tab. Click "Load audio file" and pick an MP3. Press Space to play it. You should see the audio waveform in the scrubber and the Bass/Mid/Treble values moving.',
        },
        {
          heading: 'Add a background',
          body: 'Click "+ Add layer" in the LAYERS tab and choose "Noise Field". It appears as an animated colour texture. Click its name to select it and open PARAMS. Try changing Hue A, Hue B, and Speed. The Noise Field is your background.',
        },
        {
          heading: 'Add particles',
          body: 'Add another layer — choose "Particles". Select it in PARAMS. Set Mode to "drift", Count to 400, and Color to "cool". Set its blend mode in the layer list to "screen". The particles now glow on top of the noise.',
        },
        {
          heading: 'Make particles react to audio',
          body: 'With the Particles layer selected, open the Modulation section in PARAMS. Click "+ Add route". Set Source to "Bass", Target to "Speed", Depth to +0.80, Curve to "Exponential". Now when bass hits, particles speed up. Add a second route: Bass → Size, depth +0.50.',
        },
        {
          heading: 'Make the background pulse on beats',
          body: 'Select the Noise Field layer. In Modulation, add: Source "Beat pulse" (iBeat), Target "Speed", Depth +1.20, Curve "S-curve", Lag 0.05 (instant). The background now lurches forward on every beat and smoothly settles back.',
        },
        {
          heading: 'Add a post-FX glow',
          body: 'Go to the FX tab. Add Bloom (intensity 0.5, threshold 0.3). The brightest areas of your scene will now glow. The bloom intensity is automatically driven by bass — no setup needed.',
        },
        {
          heading: 'Save your scene',
          body: 'Go to the SCENES tab, type a name in the field, click Save. Your scene is now stored and will appear in the scene picker. You can reload it any time.',
        },
      ],
    },
    {
      title: 'Build a lyrics display for a live show',
      steps: [
        {
          heading: 'Add a Lyrics layer',
          body: 'Click "+ Add layer" → "Lyrics / Text". Select it. In PARAMS you\'ll see a text area for your lines. Type each lyric line on its own line. For example:\nVerse 1 line 1\nVerse 1 line 2\nChorus here',
        },
        {
          heading: 'Style the text',
          body: 'Set Font Size to 64, choose a Font (try Impact for bold punch or Georgia for elegance). Set Color to white. Set Vertical pos to 0.82 (near the bottom). Set Transition to "slide" — lines slide up from below.',
        },
        {
          heading: 'Trigger lines manually',
          body: 'Use PageDown to advance to the next line, PageUp to go back. In performance mode (F key), PageDown/PageUp still work. This is the simplest way to sync lyrics to a live performance.',
        },
        {
          heading: 'Auto-advance with timing',
          body: 'Enable Auto advance in PARAMS and set Duration to the number of seconds each line should show. This works for songs where the timing is consistent — less useful for live performance where you want manual control.',
        },
        {
          heading: 'Add a background layer',
          body: 'Add a Gradient layer beneath the Lyrics layer (drag it below in the layer list). Set blend mode of the Lyrics layer to Normal. The lyrics render sharp on top of your gradient.',
        },
        {
          heading: 'Save as a scene',
          body: 'Save this as "Song name — lyrics". You can have a separate scene per song section, each with different text and styling, and switch between them in the setlist.',
        },
      ],
    },
    {
      title: 'Sync Vael to a DAW using MIDI clock',
      steps: [
        {
          heading: 'Configure your DAW',
          body: 'In Ableton Live: go to Preferences → MIDI. Enable the MIDI output port for your interface (or a virtual MIDI port like IAC Driver on Mac). Enable "Sync" on that port. In VST Live: go to Devices → MIDI, enable the clock output port.',
        },
        {
          heading: 'Connect and check',
          body: 'Go to the MIDI tab in Vael. You should see your MIDI device listed. Play your DAW — the MIDI Clock Sync section will show a green dot and the current BPM once Vael starts receiving clock pulses.',
        },
        {
          heading: 'Add a BPM-synced LFO',
          body: 'Go to the LFO tab. Click "+ Add LFO". Choose a layer and a parameter (try Noise Field → Hue A). Enable BPM sync. Set Division to "1/4" (one cycle per beat). The hue will now shift in sync with your DAW\'s tempo.',
        },
        {
          heading: 'Add a beat-synced ModMatrix route',
          body: 'Select your Particles layer. In Modulation, add: Source "Beat pulse" (iBeat), Target "Size", Depth +0.80, Curve "S-curve". The particle size will pulse in sync with the beat your DAW is playing.',
        },
        {
          heading: 'Use the step sequencer',
          body: 'Go to the BEAT tab. Click "Sync from detector" — since MIDI clock is active, this syncs the sequencer to the external BPM. Set some steps to "flash" or "beat". The sequencer now fires visual events in exact musical time.',
        },
        {
          heading: 'Record your visuals',
          body: 'Once everything is synced, go to the REC tab and use Quick Record. Start playback from bar 1 in your DAW at the same moment. Vael records audio + video together and stops when your track ends.',
        },
      ],
    },
  ];

  const MOD_EXPLAINER = {
    title: 'How modulations work',
    body: [
      'A modulation route connects a signal source (like bass energy) to a parameter (like particle size). Every frame, Vael reads the current value of the source, shapes it through a curve, and adds it to the parameter\'s base value.',
      'The base value is what the slider shows. If your particle size slider is at 2.0 and you add a bass → size route with depth +1.0, the particle size will range from 2.0 (silence) up to 3.0 (loud bass).',
      'Depth controls the amount of modulation. Depth +1.0 means the signal adds one full parameter range. Depth -1.0 inverts it — loud bass makes the parameter go down. Depths above 1.0 or below -1.0 exceed the parameter range, which is clamped at the edges but useful for dramatic effect.',
      'Lag controls response speed. At 1.0 the parameter tracks the signal instantly. At 0.1 it smoothly chases it — good for slow, organic movement. At 0.01 it barely responds, creating very slow drifts.',
      'The curve shapes the signal before it drives the parameter. Linear is proportional. Exponential reacts slowly at low levels and explosively at high levels — perfect for bass hits. Logarithmic is the opposite: immediate at low levels, saturating at high. S-curve eases both ends. Step turns the signal into an on/off trigger.',
      'Multiple routes on the same parameter add together on top of the base value. The total is always clamped within the parameter\'s min/max range. You can combine a slow LFO drift with a sharp beat pulse on the same parameter and both will work simultaneously.',
      'The live indicator bar under a slider (the thin line that sometimes appears in a different colour) shows the actual current value including all modulation. When it matches the slider, nothing is modulating. When it differs, you can see exactly how far the modulation is pushing the value away from the base.',
    ],
  };

  // ── Render ────────────────────────────────────────────────────

  function init(container) {
    if (!container) return;
    container.innerHTML = '';
    _render(container);
  }

  function _render(container) {
    // Outer scroll wrapper
    container.style.cssText = 'overflow-y:auto;height:100%;padding:0';

    // ── Navigation tabs ────────────────────────────────────────
    const nav = document.createElement('div');
    nav.style.cssText = `
      display:flex;gap:2px;flex-wrap:wrap;padding:10px 10px 0;
      position:sticky;top:0;background:var(--bg-mid);z-index:1;
      border-bottom:1px solid var(--border-dim);padding-bottom:8px;
    `;

    const sections = [
      { id: 'ref',     label: 'Tab guide' },
      { id: 'tut',     label: 'Tutorials' },
      { id: 'mod',     label: 'Modulations' },
      { id: 'shaders', label: 'Shaders' },
      { id: 'keys',    label: 'Shortcuts' },
    ];

    const content = document.createElement('div');
    content.style.cssText = 'padding:14px 12px';

    let activeSection = 'ref';

    const navBtns = {};
    sections.forEach(s => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background:none;border:1px solid var(--border-dim);border-radius:4px;
        color:var(--text-muted);font-family:var(--font-mono);font-size:8px;
        padding:4px 9px;cursor:pointer;transition:all 0.1s;letter-spacing:0.5px;
      `;
      btn.textContent = s.label.toUpperCase();
      btn.addEventListener('click', () => {
        activeSection = s.id;
        _renderSection(content, activeSection);
        Object.entries(navBtns).forEach(([id, b]) => {
          b.style.background    = id === activeSection ? 'var(--accent)' : 'none';
          b.style.color         = id === activeSection ? 'var(--bg)'     : 'var(--text-muted)';
          b.style.borderColor   = id === activeSection ? 'var(--accent)' : 'var(--border-dim)';
        });
      });
      navBtns[s.id] = btn;
      nav.appendChild(btn);
    });

    // Set initial active
    navBtns['ref'].style.background  = 'var(--accent)';
    navBtns['ref'].style.color       = 'var(--bg)';
    navBtns['ref'].style.borderColor = 'var(--accent)';

    container.appendChild(nav);
    container.appendChild(content);
    _renderSection(content, 'ref');
  }

  function _renderSection(container, section) {
    container.innerHTML = '';
    switch (section) {
      case 'ref':   _renderTabRef(container);   break;
      case 'tut':   _renderTutorials(container); break;
      case 'mod':     _renderModExplainer(container); break;
      case 'shaders': _renderShaderGuide(container);  break;
      case 'keys':    _renderShortcuts(container);    break;
    }
  }

  // ── Tab reference ─────────────────────────────────────────────

  function _renderTabRef(container) {
    TABS_REFERENCE.forEach(tab => {
      const section = document.createElement('details');
      section.style.cssText = 'margin-bottom:8px;border:1px solid var(--border-dim);border-radius:6px;overflow:hidden';

      const summary = document.createElement('summary');
      summary.style.cssText = `
        font-family:var(--font-mono);font-size:9px;color:${tab.color};
        text-transform:uppercase;letter-spacing:1px;padding:8px 10px;
        cursor:pointer;list-style:none;display:flex;align-items:center;
        gap:8px;background:var(--bg-card);user-select:none;
      `;
      summary.innerHTML = `
        <span style="font-size:8px;transition:transform 0.15s;display:inline-block">▶</span>
        <span>${tab.tab}</span>
        <span style="font-size:8px;color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;flex:1">${tab.summary}</span>
      `;
      section.appendChild(summary);

      const body = document.createElement('div');
      body.style.cssText = 'padding:10px 12px';

      tab.items.forEach(([term, def]) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:10px;display:flex;gap:10px';
        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:8px;color:${tab.color};
                       min-width:110px;flex-shrink:0;padding-top:1px">${term}</span>
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                       line-height:1.6">${def}</span>
        `;
        body.appendChild(row);
      });

      section.appendChild(body);

      section.addEventListener('toggle', () => {
        summary.querySelector('span').style.transform =
          section.open ? 'rotate(90deg)' : 'rotate(0deg)';
      });

      container.appendChild(section);
    });
  }

  // ── Tutorials ─────────────────────────────────────────────────

  function _renderTutorials(container) {
    TUTORIALS.forEach((tut, ti) => {
      const section = document.createElement('details');
      section.style.cssText = 'margin-bottom:10px;border:1px solid var(--border-dim);border-radius:6px;overflow:hidden';
      section.open = ti === 0;

      const summary = document.createElement('summary');
      summary.style.cssText = `
        font-family:var(--font-mono);font-size:9px;color:var(--accent);
        padding:10px 12px;cursor:pointer;list-style:none;
        display:flex;align-items:center;gap:8px;
        background:var(--bg-card);user-select:none;
      `;
      summary.innerHTML = `
        <span style="font-size:8px;transition:transform 0.15s;display:inline-block;
                     transform:${ti === 0 ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
        <span style="font-size:8px;color:var(--text-dim)">Tutorial ${ti + 1}</span>
        <span>${tut.title}</span>
      `;
      section.appendChild(summary);

      const body = document.createElement('div');
      body.style.cssText = 'padding:12px';

      tut.steps.forEach((step, si) => {
        const stepEl = document.createElement('div');
        stepEl.style.cssText = `
          display:flex;gap:12px;margin-bottom:14px;
          padding-bottom:14px;
          border-bottom:${si < tut.steps.length - 1 ? '1px solid var(--border-dim)' : 'none'};
        `;

        const num = document.createElement('div');
        num.style.cssText = `
          flex-shrink:0;width:20px;height:20px;border-radius:50%;
          background:var(--accent);color:var(--bg);
          font-family:var(--font-mono);font-size:9px;font-weight:600;
          display:flex;align-items:center;justify-content:center;margin-top:1px;
        `;
        num.textContent = si + 1;

        const text = document.createElement('div');
        text.innerHTML = `
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);
                      font-weight:500;margin-bottom:5px">${step.heading}</div>
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                      line-height:1.7;white-space:pre-line">${step.body}</div>
        `;

        stepEl.appendChild(num);
        stepEl.appendChild(text);
        body.appendChild(stepEl);
      });

      section.appendChild(body);

      section.addEventListener('toggle', () => {
        summary.querySelector('span').style.transform =
          section.open ? 'rotate(90deg)' : 'rotate(0deg)';
      });

      container.appendChild(section);
    });
  }

  // ── Modulations explainer ─────────────────────────────────────

  function _renderModExplainer(container) {
    const title = document.createElement('div');
    title.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--accent);margin-bottom:14px;letter-spacing:1px';
    title.textContent = MOD_EXPLAINER.title.toUpperCase();
    container.appendChild(title);

    MOD_EXPLAINER.body.forEach((para, i) => {
      const p = document.createElement('p');
      p.style.cssText = `
        font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
        line-height:1.8;margin-bottom:12px;
        padding-bottom:12px;
        border-bottom:${i < MOD_EXPLAINER.body.length - 1 ? '1px solid var(--border-dim)' : 'none'};
      `;
      p.textContent = para;
      container.appendChild(p);
    });

    // Visual diagram of signal flow
    const diagram = document.createElement('div');
    diagram.style.cssText = `
      margin-top:16px;padding:12px;background:var(--bg-card);
      border:1px solid var(--border-dim);border-radius:6px;
      font-family:var(--font-mono);font-size:8px;color:var(--text-dim);
      line-height:2.0;
    `;
    diagram.innerHTML = `
      <div style="color:var(--accent);font-size:9px;margin-bottom:8px">Signal flow</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="background:color-mix(in srgb,var(--accent2) 20%,transparent);
                     border:1px solid var(--accent2);border-radius:3px;padding:2px 8px;
                     color:var(--accent2)">Audio / video / engine signal</span>
        <span style="color:var(--text-dim)">→</span>
        <span style="background:color-mix(in srgb,#7c6af7 20%,transparent);
                     border:1px solid #7c6af7;border-radius:3px;padding:2px 8px;
                     color:#7c6af7">Smooth (lag)</span>
        <span style="color:var(--text-dim)">→</span>
        <span style="background:color-mix(in srgb,#ffd700 20%,transparent);
                     border:1px solid #ffd700;border-radius:3px;padding:2px 8px;
                     color:#ffd700">Shape (curve)</span>
        <span style="color:var(--text-dim)">→</span>
        <span style="background:color-mix(in srgb,#ff6b6b 20%,transparent);
                     border:1px solid #ff6b6b;border-radius:3px;padding:2px 8px;
                     color:#ff6b6b">× Depth</span>
        <span style="color:var(--text-dim)">→</span>
        <span style="background:color-mix(in srgb,var(--accent) 20%,transparent);
                     border:1px solid var(--accent);border-radius:3px;padding:2px 8px;
                     color:var(--accent)">+ Base value</span>
        <span style="color:var(--text-dim)">→</span>
        <span style="color:var(--text)">Parameter output</span>
      </div>
    `;
    container.appendChild(diagram);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────

  function _renderShortcuts(container) {
    const groups = [
      {
        label: 'Audio',
        color: '#ff6b6b',
        shortcuts: [
          ['Space',       'Play / pause audio'],
          ['T',           'Tap tempo (works everywhere, including performance mode)'],
          ['PageDown',    'Next lyrics line'],
          ['PageUp',      'Previous lyrics line'],
        ],
      },
      {
        label: 'Layers',
        color: '#00d4aa',
        shortcuts: [
          ['Click layer name', 'Select layer and open its params'],
          ['Shift + click',    'Add to / remove from multi-select'],
          ['Ctrl + click',     'Same as Shift + click'],
          ['Alt + drag canvas','Move selected layer (X/Y transform)'],
          ['Alt + scroll',     'Scale selected layer'],
          ['Shift + scroll',   'Fine scale (0.01 steps)'],
          ['R',                'Reset selected layer transform to defaults'],
        ],
      },
      {
        label: 'Performance mode',
        color: '#7c6af7',
        shortcuts: [
          ['F',           'Enter / exit performance mode'],
          ['→ / ←',       'Next / previous scene (with transition)'],
          ['1 – 9',       'Jump to scene by number'],
          ['G',           'Open / close scene grid'],
          ['S',           'Open / close setlist panel'],
          ['T',           'Tap tempo (TAP button also visible in HUD)'],
          ['Escape',      'Close panel or exit performance mode'],
        ],
      },
      {
        label: 'General',
        color: '#ffd700',
        shortcuts: [
          ['Ctrl + Z',    'Undo (also ← button in HIST tab)'],
          ['Ctrl + Shift + Z', 'Redo'],
          ['?',           'Show / hide keyboard shortcuts overlay'],
        ],
      },
    ];

    groups.forEach(group => {
      const label = document.createElement('div');
      label.style.cssText = `
        font-family:var(--font-mono);font-size:8px;color:${group.color};
        text-transform:uppercase;letter-spacing:1px;
        margin:14px 0 6px;
      `;
      label.textContent = group.label;
      container.appendChild(label);

      group.shortcuts.forEach(([key, desc]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;margin-bottom:7px;align-items:baseline';
        row.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:9px;color:${group.color};
                       min-width:120px;flex-shrink:0">${key}</span>
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);
                       line-height:1.5">${desc}</span>
        `;
        container.appendChild(row);
      });
    });
  }

  // ── Shader guide ─────────────────────────────────────────────

  function _renderShaderGuide(container) {
    const sections = [
      {
        title: 'How shaders work in Vael',
        color: '#00d4aa',
        body: `Vael shaders are GLSL fragment shaders. The GPU runs your code once per pixel per frame, and you return a colour for that pixel via gl_FragColor. Vael automatically provides a set of uniforms (variables) you can read — audio signals, time, mouse position, parameters — so you never need to set up a WebGL context yourself.`,
      },
      {
        title: 'Required output',
        color: '#7c6af7',
        body: `Every shader must write to gl_FragColor:\n\n  gl_FragColor = vec4(red, green, blue, alpha);\n\nAll four channels are floats in the 0.0–1.0 range. Alpha should normally be 1.0. Use clamp() to prevent values going outside this range — unclamped values can produce visual glitches.`,
        code: `void main() {\n    vec2 uv = gl_FragCoord.xy / iResolution.xy;\n    gl_FragColor = vec4(uv.x, uv.y, 0.5, 1.0);\n}`,
      },
      {
        title: 'Available uniforms',
        color: '#ffd700',
        items: [
          ['iTime',        'float', 'Seconds since the shader started. Advances at a rate controlled by the Speed slider. Use this as your animation clock.'],
          ['iResolution',  'vec2',  'Canvas size in pixels (width, height). Divide gl_FragCoord.xy by this to get normalised 0–1 UV coordinates.'],
          ['iBass',        'float', 'Bass energy, 0–1. Pre-smoothed by the Audio Smoothing slider — no jitter.'],
          ['iMid',         'float', 'Mid-range energy, 0–1.'],
          ['iTreble',      'float', 'Treble energy, 0–1.'],
          ['iVolume',      'float', 'Overall volume, 0–1.'],
          ['iBeat',        'float', 'Beat pulse — spikes to 1.0 on each detected beat, decays to 0 quickly. Good for flashes.'],
          ['iBpm',         'float', 'Current BPM as detected or tapped. 60–200 range typically.'],
          ['iMouseX',      'float', 'Mouse X position, 0–1 (left to right).'],
          ['iMouseY',      'float', 'Mouse Y position, 0–1 (top to bottom).'],
          ['iParam1',      'float', 'Param 1 slider value, 0–1. Wire to anything you want to control. Label it with a comment: // iParam1 — density'],
          ['iParam2',      'float', 'Param 2 slider value, 0–1. Label with: // iParam2 — speed'],
          ['iParam3',      'float', 'Param 3 slider value, 0–1. Label with: // iParam3 — brightness'],
          ['iColorA',      'vec3',  'Color A picker value as RGB (0–1 each). Use as your primary colour.'],
          ['iColorB',      'vec3',  'Color B picker value as RGB. Use as your secondary / accent colour.'],
          ['iHueShift',    'float', 'Hue rotation in degrees (0–360). Apply with a hueRotate function to shift all colours.'],
          ['iSpeed',       'float', 'Speed slider value (0–4). iTime already incorporates this — only read it if you need speed separately.'],
          ['iIntensity',   'float', 'Intensity slider value (0–2). Multiply into brightness or glow calculations.'],
          ['iScale',       'float', 'Scale slider value (0–4). Multiply into spatial coordinates to zoom in/out.'],
        ],
      },
      {
        title: 'Getting UV coordinates right',
        color: '#ff9f43',
        body: `Always normalise coordinates so your shader looks the same at any canvas size. The standard approach centres the coordinate system and corrects for aspect ratio:`,
        code: `void main() {\n    // Centred, aspect-corrected UV: ranges from roughly -1 to +1\n    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;\n\n    // Simple 0-1 UV (top-left to bottom-right)\n    vec2 uv01 = gl_FragCoord.xy / iResolution.xy;\n}`,
      },
      {
        title: 'Reacting to audio — the right way',
        color: '#ff6b6b',
        body: `The most common mistake is multiplying audio signals into iTime or animation speed. This causes jerkiness because the speed changes every frame as the audio value fluctuates.\n\nInstead: let iTime advance at a constant rate, and use audio signals to modulate visual properties — brightness, size, colour, connection distance — not speed.`,
        code: `// WRONG — jerky when audio plays\nfloat time = iTime * (1.0 + iMid * 3.0);\n\n// RIGHT — smooth drift, audio affects appearance only\nfloat time  = iTime * iParam2;          // constant rate\nfloat glow  = 0.02 + iBass * 0.04;     // bass blooms the glow\nfloat size  = 0.1  + iBeat * 0.05;     // beat flashes size\nfloat bright = 1.0 + iMid * 0.8;       // mid lifts brightness`,
      },
      {
        title: 'Making sliders actually do something',
        color: '#54a0ff',
        body: `Vael shows sliders for iParam1/2/3, iScale, iIntensity, and iSpeed in the PARAMS panel. But a slider only affects your shader if your GLSL code reads the corresponding uniform. If you don't use iScale in your code, moving the Scale slider does nothing.\n\nAlways map your uniforms explicitly:`,
        code: `void main() {\n    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;\n\n    // iParam1 controls grid density\n    float scale = 4.0 + iParam1 * 12.0;\n\n    // iScale zooms the whole thing\n    uv *= iScale;\n\n    // iIntensity controls overall brightness\n    float bright = iIntensity;\n\n    // ... rest of shader ...\n    gl_FragColor = vec4(color * bright, 1.0);\n}`,
      },
      {
        title: 'Naming your param sliders',
        color: '#54a0ff',
        body: `By default the PARAMS panel shows sliders labelled "Param 1", "Param 2", "Param 3". You can give them meaningful names by adding a comment at the top of your GLSL — one line per param, using an em-dash (—), hyphen (-), or colon (:) as the separator:\n\n  // iParam1 — grid density\n  // iParam2 — animation speed\n  // iParam3 — glow radius\n\nVael reads these comments and updates the slider labels automatically. Any iParam not referenced anywhere in your code is greyed out so you know it has no effect.`,
        code: `// iParam1 — number of cells (4–20)\n// iParam2 — rotation speed\n// iParam3 — edge sharpness\n\nvoid main() {\n    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;\n\n    float cells = mix(4.0, 20.0, iParam1);   // now labelled "number of cells"\n    float speed = iParam2 * 2.0;             // "rotation speed"\n    float sharp = mix(0.1, 2.0, iParam3);    // "edge sharpness"\n\n    // ... your effect ...\n    gl_FragColor = vec4(color, 1.0);\n}`,
      },
      {
        title: 'Using iColorA and iColorB',
        color: '#a78bfa',
        body: `Always drive your colours from iColorA and iColorB so users can change them from the colour pickers in PARAMS. Mix between them based on position, audio, or time:`,
        code: `// Mix between colour A and B based on audio\nvec3 col = mix(iColorA, iColorB, iBass);\n\n// Mix based on position\nvec3 col = mix(iColorA, iColorB, uv.y + 0.5);\n\n// Add hue rotation on top\ncol = hueRotate(col, iHueShift * 3.14159 / 180.0);`,
      },
      {
        title: 'Hue rotation helper',
        color: '#2ed573',
        body: `Copy this function into any shader to enable the Hue Shift slider:`,
        code: `vec3 hueRotate(vec3 col, float angle) {\n    float c = cos(angle), s = sin(angle);\n    mat3 m = mat3(\n        0.299+0.701*c+0.168*s, 0.587-0.587*c+0.330*s, 0.114-0.114*c-0.497*s,\n        0.299-0.299*c-0.328*s, 0.587+0.413*c+0.035*s, 0.114-0.114*c+0.292*s,\n        0.299-0.300*c+1.250*s, 0.587-0.588*c-1.050*s, 0.114+0.886*c-0.203*s\n    );\n    return clamp(m * col, 0.0, 1.0);\n}\n\nvoid main() {\n    // ... compute color ...\n    color = hueRotate(color, iHueShift * 3.14159 / 180.0);\n    gl_FragColor = vec4(color, 1.0);\n}`,
      },
      {
        title: 'Minimal working template',
        color: '#00d4aa',
        body: `Start from this template — it uses every uniform correctly and all sliders will do something:`,
        code: `// Minimal Vael shader template\n// Copy this and replace the main() body with your effect.\n//\n// iParam1 — density        ← these comments rename the sliders in PARAMS\n// iParam2 — color shift\n// iParam3 — threshold\n\nvec3 hueRotate(vec3 col, float angle) {\n    float c = cos(angle), s = sin(angle);\n    mat3 m = mat3(\n        0.299+0.701*c+0.168*s, 0.587-0.587*c+0.330*s, 0.114-0.114*c-0.497*s,\n        0.299-0.299*c-0.328*s, 0.587+0.413*c+0.035*s, 0.114-0.114*c+0.292*s,\n        0.299-0.300*c+1.250*s, 0.587-0.588*c-1.050*s, 0.114+0.886*c-0.203*s\n    );\n    return clamp(m * col, 0.0, 1.0);\n}\n\nvoid main() {\n    // Centred, aspect-corrected UV\n    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;\n\n    // Apply scale and speed (iTime already uses Speed slider)\n    uv *= iScale;\n    float t = iTime;\n\n    // iParam1/2/3 — wire to whatever you need\n    float density = 2.0 + iParam1 * 8.0;\n    float detail  = iParam2;\n    float threshold = iParam3;\n\n    // Audio — modulate appearance, never speed\n    float brightness = iIntensity * (1.0 + iBass * 0.8 + iBeat * 0.3);\n    float colorShift = iMid * 0.5;\n\n    // Your effect here — replace with your own\n    float pattern = sin(uv.x * density + t) * sin(uv.y * density + t);\n    vec3 color = mix(iColorA, iColorB, pattern * 0.5 + 0.5 + colorShift);\n    color *= brightness;\n\n    // Hue shift\n    color = hueRotate(color, iHueShift * 3.14159 / 180.0);\n\n    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);\n}`,
      },
    ];

    sections.forEach(sec => {
      const block = document.createElement('details');
      block.style.cssText = 'margin-bottom:8px;border:1px solid var(--border-dim);border-radius:6px;overflow:hidden';

      const summary = document.createElement('summary');
      summary.style.cssText = `font-family:var(--font-mono);font-size:9px;color:${sec.color};
        text-transform:uppercase;letter-spacing:1px;padding:8px 12px;
        cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;
        background:var(--bg-card);user-select:none`;
      summary.innerHTML = `<span style="font-size:8px;transition:transform 0.15s;display:inline-block">▶</span><span>${sec.title}</span>`;
      block.appendChild(summary);

      const body = document.createElement('div');
      body.style.cssText = 'padding:12px 14px;background:var(--bg)';

      if (sec.body) {
        const p = document.createElement('p');
        p.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);line-height:1.7;margin:0 0 10px;white-space:pre-line';
        p.textContent = sec.body;
        body.appendChild(p);
      }

      if (sec.items) {
        const table = document.createElement('div');
        table.style.cssText = 'display:grid;grid-template-columns:auto auto 1fr;gap:0';
        sec.items.forEach(([name, type, desc]) => {
          const n = document.createElement('div');
          n.style.cssText = `font-family:var(--font-mono);font-size:9px;color:${sec.color};padding:4px 10px 4px 0;border-bottom:1px solid var(--border-dim);font-weight:500`;
          n.textContent = name;
          const t = document.createElement('div');
          t.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:#7c6af7;padding:4px 12px 4px 0;border-bottom:1px solid var(--border-dim)';
          t.textContent = type;
          const d = document.createElement('div');
          d.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);padding:4px 0;border-bottom:1px solid var(--border-dim);line-height:1.5';
          d.textContent = desc;
          table.appendChild(n); table.appendChild(t); table.appendChild(d);
        });
        body.appendChild(table);
      }

      if (sec.code) {
        const codeWrap = document.createElement('div');
        codeWrap.style.cssText = 'position:relative;margin:' + (sec.body || sec.items ? '8px' : '0') + ' 0 0';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.style.cssText = 'position:absolute;top:6px;right:6px;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 7px;cursor:pointer;z-index:1';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(sec.code).then(() => {
            copyBtn.textContent = 'Copied!';
            copyBtn.style.color = 'var(--accent)';
            setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.color = 'var(--text-dim)'; }, 1500);
          });
        });

        const pre = document.createElement('pre');
        pre.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-dim);border-radius:4px;padding:10px 12px;overflow-x:auto;font-family:var(--font-mono);font-size:8px;color:var(--text-muted);line-height:1.6;margin:0;user-select:text;cursor:text';
        pre.textContent = sec.code;

        codeWrap.appendChild(copyBtn);
        codeWrap.appendChild(pre);
        body.appendChild(codeWrap);
      }

      block.appendChild(body);
      block.addEventListener('toggle', () => {
        summary.querySelector('span').style.transform = block.open ? 'rotate(90deg)' : 'rotate(0deg)';
      });
      container.appendChild(block);
    });
  }

  return { init };

})();
