/**
 * engine/LayerFX.js
 * Per-layer post-processing effects.
 * Applied to each layer's offscreen canvas after it renders,
 * before the Renderer uploads the texture to GPU.
 *
 * Effects use two approaches:
 *  1. CSS filter strings (fast, GPU-accelerated via browser) — blur, brightness,
 *     contrast, saturate, hue-rotate, invert, sepia
 *  2. Canvas 2D compositing — glow, threshold, vignette
 *  3. WebGL ShaderMaterial (via a shared mini-renderer) — chromatic, distort
 *
 * Usage on a layer:
 *   layer.fx = [
 *     { type: 'blur',       params: { radius: 4 } },
 *     { type: 'glow',       params: { radius: 12, intensity: 0.8 } },
 *     { type: 'hue-rotate', params: { angle: 45 } },
 *   ];
 *
 * The Renderer calls LayerFX.apply(layer, offscreen, offCtx, W, H, audioData)
 * in Pass 2 after rendering.
 */

const LayerFX = (() => {

  // ── Shared WebGL mini-renderer for shader-based effects ──────
  let _glCanvas   = null;
  let _glRenderer = null;
  let _glScene    = null;
  let _glCamera   = null;

  function _ensureGL(W, H) {
    if (!_glCanvas) {
      _glCanvas = document.createElement('canvas');
      _glCanvas.width  = W;
      _glCanvas.height = H;
      _glRenderer = new THREE.WebGLRenderer({ canvas: _glCanvas, alpha: true, antialias: false });
      _glRenderer.setPixelRatio(1);
      _glScene  = new THREE.Scene();
      _glCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    } else if (_glCanvas.width !== W || _glCanvas.height !== H) {
      _glCanvas.width  = W;
      _glCanvas.height = H;
      _glRenderer.setSize(W, H, false);
    }
  }

  // ── Main apply function ───────────────────────────────────────

  /**
   * Apply all fx on a layer to its offscreen canvas.
   * @param {BaseLayer} layer
   * @param {HTMLCanvasElement} offscreen
   * @param {CanvasRenderingContext2D} offCtx
   * @param {number} W
   * @param {number} H
   * @param {object} audioData
   */
  function apply(layer, offscreen, offCtx, W, H, audioData) {
    if (!layer.fx || layer.fx.length === 0) return;

    layer.fx.forEach(effect => {
      if (!effect.enabled) return;
      try {
        _applyEffect(effect, offscreen, offCtx, W, H, audioData);
      } catch (e) {
        console.warn(`LayerFX: error in "${effect.type}"`, e);
      }
    });
  }

  function _applyEffect(effect, offscreen, offCtx, W, H, audioData) {
    const p   = effect.params || {};
    const a   = audioData;
    const av  = a ? (a[p.audioTarget || 'bass'] ?? 0) : 0;
    const bp  = a?.iBeat || 0;

    switch (effect.type) {

      // ── CSS filter effects (fast, composited via drawImage) ───

      case 'blur': {
        const r = (p.radius ?? 4) + av * (p.audioAmount ?? 0) * 10;
        _cssFilter(offscreen, offCtx, W, H, `blur(${r.toFixed(1)}px)`);
        break;
      }

      case 'brightness': {
        const v = (p.value ?? 1.2) + av * (p.audioAmount ?? 0);
        _cssFilter(offscreen, offCtx, W, H, `brightness(${v.toFixed(2)})`);
        break;
      }

      case 'contrast': {
        const v = (p.value ?? 1.5) + av * (p.audioAmount ?? 0) * 2;
        _cssFilter(offscreen, offCtx, W, H, `contrast(${v.toFixed(2)})`);
        break;
      }

      case 'saturate': {
        const v = (p.value ?? 1.5) + av * (p.audioAmount ?? 0) * 2;
        _cssFilter(offscreen, offCtx, W, H, `saturate(${v.toFixed(2)})`);
        break;
      }

      case 'hue-rotate': {
        const deg = (p.angle ?? 0) + av * (p.audioAmount ?? 0) * 180 + bp * 30;
        _cssFilter(offscreen, offCtx, W, H, `hue-rotate(${deg.toFixed(1)}deg)`);
        break;
      }

      case 'invert': {
        const v = VaelMath.clamp((p.amount ?? 1) * 100, 0, 100);
        _cssFilter(offscreen, offCtx, W, H, `invert(${v}%)`);
        break;
      }

      case 'sepia': {
        const v = VaelMath.clamp((p.amount ?? 0.8) * 100, 0, 100);
        _cssFilter(offscreen, offCtx, W, H, `sepia(${v}%)`);
        break;
      }

      // ── Canvas 2D compositing effects ─────────────────────────

      case 'glow': {
        _applyGlow(offscreen, offCtx, W, H, p, av, bp);
        break;
      }

      case 'vignette': {
        _applyVignette(offCtx, W, H, p);
        break;
      }

      case 'threshold': {
        _applyThreshold(offscreen, offCtx, W, H, p);
        break;
      }

      case 'color-overlay': {
        offCtx.save();
        offCtx.globalCompositeOperation = p.blendMode || 'color';
        offCtx.fillStyle = p.color || '#ff0000';
        offCtx.globalAlpha = VaelMath.clamp((p.opacity ?? 0.3) + av * (p.audioAmount ?? 0), 0, 1);
        offCtx.fillRect(0, 0, W, H);
        offCtx.restore();
        break;
      }

      // ── WebGL shader effects ──────────────────────────────────

      case 'chromatic': {
        _applyGLShader(offscreen, offCtx, W, H, _chromaticShader, {
          offset: (p.amount ?? 0.004) + av * (p.audioAmount ?? 0) * 0.015 + bp * 0.008,
        });
        break;
      }

      case 'pixelate': {
        const px = Math.max(2, Math.round((p.size ?? 8) - av * (p.audioAmount ?? 0) * 6));
        _applyPixelate(offscreen, offCtx, W, H, px);
        break;
      }

      case 'chroma-key': {
        _applyChromaKeyFX(offCtx, W, H, p, false);
        break;
      }

      case 'color-isolate': {
        _applyChromaKeyFX(offCtx, W, H, p, true);
        break;
      }
    }
  }

  // ── CSS filter helper ─────────────────────────────────────────

  function _cssFilter(offscreen, offCtx, W, H, filterStr) {
    // Draw the canvas back onto itself with a CSS filter
    const tmp       = document.createElement('canvas');
    tmp.width       = W;
    tmp.height      = H;
    const tCtx      = tmp.getContext('2d');
    tCtx.filter     = filterStr;
    tCtx.drawImage(offscreen, 0, 0);
    offCtx.clearRect(0, 0, W, H);
    offCtx.drawImage(tmp, 0, 0);
  }

  // ── Glow ─────────────────────────────────────────────────────

  function _applyGlow(offscreen, offCtx, W, H, p, av, bp) {
    const radius    = (p.radius ?? 12) + av * (p.audioAmount ?? 0) * 20 + bp * 10;
    const intensity = VaelMath.clamp((p.intensity ?? 0.7) + av * 0.2, 0, 1.5);

    const tmp    = document.createElement('canvas');
    tmp.width    = W; tmp.height = H;
    const tCtx   = tmp.getContext('2d');

    // Blur + screen blend for glow
    tCtx.filter  = `blur(${radius.toFixed(0)}px)`;
    tCtx.drawImage(offscreen, 0, 0);
    tCtx.filter  = 'none';

    offCtx.save();
    offCtx.globalCompositeOperation = 'screen';
    offCtx.globalAlpha = intensity;
    offCtx.drawImage(tmp, 0, 0);
    offCtx.restore();
  }

  // ── Vignette ──────────────────────────────────────────────────

  function _applyVignette(offCtx, W, H, p) {
    const darkness = p.darkness ?? 0.6;
    const size     = p.size     ?? 0.5;
    const cx = W / 2, cy = H / 2;
    const r0 = Math.max(W, H) * size;
    const r1 = Math.max(W, H) * (size + 0.5);

    const grad = offCtx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, `rgba(0,0,0,${darkness})`);

    offCtx.save();
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.fillStyle = grad;
    offCtx.fillRect(0, 0, W, H);
    offCtx.restore();
  }

  // ── Threshold ────────────────────────────────────────────────

  function _applyThreshold(offscreen, offCtx, W, H, p) {
    const thresh = (p.threshold ?? 0.5) * 255;
    const imgData = offCtx.getImageData(0, 0, W, H);
    const d       = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      const val = lum > thresh ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = val;
    }
    offCtx.putImageData(imgData, 0, 0);
  }

  // ── Pixelate ─────────────────────────────────────────────────

  function _applyPixelate(offscreen, offCtx, W, H, px) {
    const tmp    = document.createElement('canvas');
    tmp.width    = Math.ceil(W / px);
    tmp.height   = Math.ceil(H / px);
    const tCtx   = tmp.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(offscreen, 0, 0, tmp.width, tmp.height);
    offCtx.clearRect(0, 0, W, H);
    offCtx.imageSmoothingEnabled = false;
    offCtx.drawImage(tmp, 0, 0, W, H);
    offCtx.imageSmoothingEnabled = true;
  }

  // ── WebGL shader helper ───────────────────────────────────────

  const _chromaticShader = `
    uniform sampler2D tDiffuse;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec2 dir = normalize(vUv - 0.5) * length(vUv - 0.5);
      float r = texture2D(tDiffuse, vUv + dir * offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * offset).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }`;

  function _applyGLShader(offscreen, offCtx, W, H, fragSrc, uniformValues) {
    _ensureGL(W, H);

    // Upload canvas as texture
    const tex = new THREE.CanvasTexture(offscreen);
    tex.minFilter = THREE.LinearFilter;

    while (_glScene.children.length) _glScene.remove(_glScene.children[0]);

    const mat  = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: tex },
        ...Object.fromEntries(Object.entries(uniformValues).map(([k,v]) => [k, { value: v }])),
      },
      vertexShader:   'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.);}',
      fragmentShader: fragSrc,
      depthWrite:     false,
      depthTest:      false,
    });
    const geo  = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geo, mat);
    _glScene.add(mesh);

    _glRenderer.setRenderTarget(null);
    _glRenderer.render(_glScene, _glCamera);

    // Copy result back to offscreen canvas
    offCtx.clearRect(0, 0, W, H);
    offCtx.drawImage(_glCanvas, 0, 0);

    tex.dispose();
    mat.dispose();
    geo.dispose();
  }

  // ── Chroma Key / Color Isolate ────────────────────────────────

  /**
   * Shared pixel-loop for Chroma Key and Color Isolate.
   * isolate=false → remove pixels matching the key color (green screen)
   * isolate=true  → keep only pixels matching the key color; rest → transparent
   *                 When p.invert is true, behaviour flips back to chroma-key.
   */
  function _applyChromaKeyFX(offCtx, W, H, p, isolate) {
    const [kr, kg, kb] = VaelColor.hexToRgb(p.color || (isolate ? '#ffff00' : '#00ff00'));
    const [kh, ks, kl] = VaelColor.rgbToHsl(kr, kg, kb);
    const khN  = kh / 360;
    const tol  = p.tolerance ?? 0.3;
    const soft = Math.max(0.001, p.softness ?? 0.1);
    const spill = p.spill ?? 0.1;
    const invert = p.invert ?? false;

    const imageData = offCtx.getImageData(0, 0, W, H);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] === 0) continue;
      const [ph, ps, pl] = VaelColor.rgbToHsl(d[i]/255, d[i+1]/255, d[i+2]/255);
      const phN = ph / 360;
      const dh   = Math.min(Math.abs(phN - khN), 1 - Math.abs(phN - khN));
      const dist = dh * 0.6 + Math.abs(ps - ks) * 0.2 + Math.abs(pl - kl) * 0.2;

      // removeMatching=true  → chroma key behaviour (remove pixels near key color)
      // removeMatching=false → isolate behaviour   (keep pixels near key color)
      const removeMatching = isolate ? invert : !invert;

      if (removeMatching) {
        if (dist < tol) {
          d[i+3] = 0;
        } else if (dist < tol + soft) {
          const t = (dist - tol) / soft;
          d[i+3] = Math.round(d[i+3] * t);
          // Spill suppression: desaturate pixels near the key hue
          if (!isolate && spill > 0 && dh < 0.15) {
            const grey   = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
            const factor = spill * (1 - t);
            d[i]   = Math.round(d[i]   + (grey - d[i])   * factor);
            d[i+1] = Math.round(d[i+1] + (grey - d[i+1]) * factor);
            d[i+2] = Math.round(d[i+2] + (grey - d[i+2]) * factor);
          }
        }
      } else {
        // Keep pixels near key color, remove everything else
        if (dist < tol) {
          // fully keep — no change
        } else if (dist < tol + soft) {
          const t = (dist - tol) / soft;
          d[i+3] = Math.round(d[i+3] * (1 - t));
        } else {
          d[i+3] = 0;
        }
      }
    }
    offCtx.putImageData(imageData, 0, 0);
  }

  // ── Effect catalog for UI ─────────────────────────────────────

  const CATALOG = [
    { type: 'blur',         label: 'Blur',            params: { radius: 4,    audioAmount: 0 } },
    { type: 'glow',         label: 'Glow',            params: { radius: 12,   intensity: 0.7, audioAmount: 0 } },
    { type: 'brightness',   label: 'Brightness',      params: { value: 1.3,   audioAmount: 0 } },
    { type: 'contrast',     label: 'Contrast',        params: { value: 1.4,   audioAmount: 0 } },
    { type: 'saturate',     label: 'Saturate',        params: { value: 1.5,   audioAmount: 0 } },
    { type: 'hue-rotate',   label: 'Hue rotate',      params: { angle: 0,     audioAmount: 0 } },
    { type: 'sepia',        label: 'Sepia',           params: { amount: 0.6 } },
    { type: 'invert',       label: 'Invert',          params: { amount: 1.0 } },
    { type: 'vignette',     label: 'Vignette',        params: { darkness: 0.6, size: 0.5 } },
    { type: 'chromatic',    label: 'Chromatic aberr.', params: { amount: 0.004, audioAmount: 0 } },
    { type: 'threshold',    label: 'Threshold',       params: { threshold: 0.5 } },
    { type: 'color-overlay',label: 'Color overlay',   params: { color: '#ff6600', opacity: 0.3, blendMode: 'color', audioAmount: 0 } },
    { type: 'pixelate',     label: 'Pixelate',        params: { size: 8,      audioAmount: 0 } },
    { type: 'chroma-key',   label: '🎨 Chroma Key',   params: { color: '#00ff00', tolerance: 0.3, softness: 0.1, spill: 0.1 } },
    { type: 'color-isolate',label: '🎯 Color Isolate', params: { color: '#ffff00', tolerance: 0.3, softness: 0.1, invert: false } },
  ];

  return { apply, CATALOG };

})();
