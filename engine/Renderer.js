/**
 * engine/Renderer.js
 * WebGL compositor built on Three.js (r128).
 *
 * FIX — screen blend + opacity:
 * The screen blend equation (src + dst*(1-src)) uses THREE.OneFactor as the
 * source weight, which ignores material.opacity entirely. The same is true for
 * 'add' and some other custom blending modes.
 *
 * Fix: before uploading each layer's texture to the GPU, if opacity < 1 and
 * the blend mode is one that ignores material.opacity, we bake the opacity
 * into the offscreen canvas by drawing it onto a temp canvas with globalAlpha.
 * This means the alpha is pre-multiplied into the pixel data, and every blend
 * mode respects it correctly.
 */

class Renderer {

  constructor(canvas) {
    this.canvas = canvas;

    this._scene    = new THREE.Scene();
    this._camera   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:            false,
      alpha:                false,
      premultipliedAlpha:   false,
      preserveDrawingBuffer: true,  // needed for canvas.toDataURL() thumbnail capture
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);

    this._quads = new Map();

    this._postEnabled  = false;
    this._postPasses   = [];
    this._postTarget   = null;

    this._rafId       = null;
    this._lastT       = 0;
    this._fpsSmoothed = 60;
    this._cssW        = 0;
    this._cssH        = 0;
    this._lockedRatio = null;
    this._fpsLimit    = 0;  // 0 = unlimited

    // Temp canvas for baking opacity into textures
    this._opacityCanvas = document.createElement('canvas');
    this._opacityCtx    = this._opacityCanvas.getContext('2d');

    this.layerStack   = null;
    this.audioData    = null;
    this.videoData    = null;
    this.onFrame      = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  // ── Resize ───────────────────────────────────────────────────

  _resize() {
    // If a fixed ratio is locked, constrain the canvas element before reading dimensions
    if (this._lockedRatio) {
      const area = this.canvas.parentElement;
      if (area) {
        const areaW = area.clientWidth;
        const areaH = area.clientHeight;
        const [rw, rh] = this._lockedRatio;
        const targetAspect = rw / rh;
        const areaAspect   = areaW / areaH;
        let cw, ch;
        if (areaAspect > targetAspect) {
          // Area is wider than target — constrain by height
          ch = areaH; cw = Math.round(ch * targetAspect);
        } else {
          // Area is taller than target — constrain by width
          cw = areaW; ch = Math.round(cw / targetAspect);
        }
        this.canvas.style.width  = cw + 'px';
        this.canvas.style.height = ch + 'px';
        this.canvas.style.margin = 'auto';
        this.canvas.style.display = 'block';
      }
    } else {
      this.canvas.style.width  = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.margin = '';
    }

    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this._cssW && h === this._cssH) return;
    this._cssW = w;
    this._cssH = h;
    this._renderer.setSize(w, h, false);

    // Keep overlay canvas exactly on top of the WebGL canvas.
    // Match its CSS position to the canvas element so it never covers
    // the status strip or anything outside the canvas bounds.
    if (this._overlayCanvas) {
      this._overlayCanvas.style.width  = this.canvas.style.width  || '100%';
      this._overlayCanvas.style.height = this.canvas.style.height || '100%';
      this._overlayCanvas.style.margin = this.canvas.style.margin || '';
    }

    this._quads.forEach(quad => {
      quad.offscreen.width  = w;
      quad.offscreen.height = h;
      quad.texture.needsUpdate = true;
    });

    if (this._postTarget) this._postTarget.setSize(w, h);

    this._opacityCanvas.width  = w;
    this._opacityCanvas.height = h;
  }

  /** Lock canvas to a specific aspect ratio. Pass null to unlock. */
  setRatio(w, h) {
    this._lockedRatio = (w && h) ? [w, h] : null;
    this._resize();
  }

  // ── Render loop ──────────────────────────────────────────────

  start() {
    const loop = (timestamp) => {
      this._rafId = requestAnimationFrame(loop);

      // Frame rate cap — skip frame if not enough time has passed
      if (this._fpsLimit > 0) {
        const minInterval = 1000 / this._fpsLimit;
        if (timestamp - this._lastT < minInterval - 1) return;
      }

      // Always check if canvas dimensions have changed
      this._resize();

      const dt = Math.min((timestamp - this._lastT) / 1000, 0.1);
      this._lastT = timestamp;
      if (dt > 0) this._fpsSmoothed += ((1 / dt) - this._fpsSmoothed) * 0.05;

      if (this.layerStack) {
        this.layerStack.update(this.audioData, this.videoData, dt);
        this._compositeFrame();
      }

      if (typeof this.onFrame === 'function') {
        this.onFrame(dt, Math.round(this._fpsSmoothed));
      }
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /** Set max frame rate. 0 = unlimited. */
  setFpsLimit(fps) {
    this._fpsLimit = fps || 0;
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  // ── Compositing ──────────────────────────────────────────────

  _compositeFrame() {
    const W = this._cssW;
    const H = this._cssH;
    if (W <= 0 || H <= 0) return;  // not ready yet — prevents particle init at 0×0
    const layers = this.layerStack.layers;

    this._syncQuads(layers, W, H);

    // Collect the set of layer IDs that are used purely as masks.
    // These should NOT be rendered as visible layers in the scene —
    // they exist only to provide pixel data for masking other layers.
    const maskSourceIds = new Set(
      layers.filter(l => l.maskLayerId).map(l => l.maskLayerId)
    );

    // ── Pass 1: render ALL layers to their offscreen canvases ───
    // Mask source layers must be rendered even if not added to the scene,
    // because their pixel data is needed in Pass 2. We render ALL visible
    // layers unconditionally here, then selectively skip scene-add in Pass 2.
    layers.forEach(layer => {
      if (!layer.visible) return;
      const quad = this._quads.get(layer.id);
      if (!quad) return;

      const { offscreen, offCtx } = quad;
      offCtx.clearRect(0, 0, W, H);
      offCtx.save();

      const t  = layer.transform || {};
      const cx = W / 2 + (t.x || 0);
      const cy = H / 2 + (t.y || 0);
      offCtx.translate(cx, cy);
      if (t.rotation) offCtx.rotate(t.rotation * Math.PI / 180);
      if (t.scaleX !== undefined || t.scaleY !== undefined) {
        offCtx.scale(t.scaleX ?? 1, t.scaleY ?? 1);
      }

      if (typeof layer.render === 'function') {
        layer.render(offCtx, W, H);
      }
      offCtx.restore();

      // Apply clip shape — punch out everything outside rect/ellipse
      if (layer.clipShape?.type && layer.clipShape.type !== 'none') {
        const cs      = layer.clipShape;
        const t2      = layer.transform || {};
        const cx2     = W / 2 + (t2.x || 0);
        const cy2     = H / 2 + (t2.y || 0);
        const cw      = W * (cs.w ?? 0.5);
        const ch      = H * (cs.h ?? 0.5);
        const isEllipse = cs.type.includes('ellipse');
        const lw      = cs.lineWidth ?? 3;

        // Build a mask canvas with the shape drawn as needed
        const tmp    = document.createElement('canvas');
        tmp.width    = W; tmp.height = H;
        const tc     = tmp.getContext('2d');

        const _drawShape = (ctx) => {
          ctx.beginPath();
          if (isEllipse) {
            ctx.ellipse(cx2, cy2, cw, ch, 0, 0, Math.PI * 2);
          } else {
            ctx.rect(cx2 - cw, cy2 - ch, cw * 2, ch * 2);
          }
        };

        if (cs.type === 'rect-inside' || cs.type === 'ellipse-inside' ||
            cs.type === 'rect'        || cs.type === 'ellipse') {
          // Inside: keep only pixels within the shape
          tc.fillStyle = '#fff';
          _drawShape(tc);
          tc.fill();
          offCtx.save();
          offCtx.globalCompositeOperation = 'destination-in';
          offCtx.drawImage(tmp, 0, 0);
          offCtx.restore();

        } else if (cs.type === 'rect-outside' || cs.type === 'ellipse-outside') {
          // Outside: keep only pixels OUTSIDE the shape (punch hole)
          // Fill everything white, then fill shape black → invert via destination-out
          tc.fillStyle = '#fff';
          tc.fillRect(0, 0, W, H);
          tc.globalCompositeOperation = 'destination-out';
          tc.fillStyle = '#000';
          _drawShape(tc);
          tc.fill();
          tc.globalCompositeOperation = 'source-over';
          offCtx.save();
          offCtx.globalCompositeOperation = 'destination-in';
          offCtx.drawImage(tmp, 0, 0);
          offCtx.restore();

        } else if (cs.type === 'rect-line' || cs.type === 'ellipse-line') {
          // On-line: keep only pixels that fall on the stroke of the shape
          // Draw the stroke as a thick white line on black → use as mask
          tc.fillStyle = '#000';
          tc.fillRect(0, 0, W, H);
          tc.strokeStyle = '#fff';
          tc.lineWidth   = lw;
          _drawShape(tc);
          tc.stroke();
          offCtx.save();
          offCtx.globalCompositeOperation = 'destination-in';
          offCtx.drawImage(tmp, 0, 0);
          offCtx.restore();
        }
      }
    });

    // ── Pass 2: apply masks, FX, opacity bake, upload ───────────
    while (this._scene.children.length) this._scene.remove(this._scene.children[0]);

    layers.forEach((layer, i) => {
      if (!layer.visible) return;
      const quad = this._quads.get(layer.id);
      if (!quad) return;

      // Apply mask if set
      if (layer.maskLayerId) {
        const maskQuad = this._quads.get(layer.maskLayerId);
        if (maskQuad) {
          _applyMask(quad.offscreen, quad.offCtx, maskQuad.offscreen,
                     layer.maskMode || 'luminance', W, H);
        }
      }

      // Per-layer FX
      if (layer.fx && layer.fx.length > 0) {
        LayerFX.apply(layer, quad.offscreen, quad.offCtx, W, H, this.audioData);
      }

      const opacity   = VaelMath.clamp(layer.opacity ?? 1, 0, 1);
      const blendMode = layer.blendMode || 'normal';

      // Modes that need canvas 2D compositing (WebGL can't do them natively):
      // overlay, softlight, hardlight, luminosity, color, hue, saturation.
      // We flag these quads so the composite loop can handle them with a canvas pass.
      quad._needsCanvasBlend = _isCanvasOnlyBlend(blendMode);

      if (quad._needsCanvasBlend) {
        // Canvas-only blend modes: store opacity on quad for use in overlay pass
        // Do NOT bakeOpacity here — globalAlpha on the overlay canvas is correct
        quad._overlayOpacity = opacity;
        this._applyBlend(quad.mesh.material, 'normal', 0.0001);
      } else if (blendMode === 'normal') {
        quad._overlayOpacity = 1;
        this._applyBlend(quad.mesh.material, blendMode, opacity);
      } else {
        // WebGL blend modes: add/subtract use SrcAlphaFactor so bakeOpacity works.
        // screen is handled via canvas-blend path above (THREE.OneFactor ignores alpha).
        quad._overlayOpacity = 1;
        if (opacity < 0.999) this._bakeOpacity(quad.offscreen, W, H, opacity);
        this._applyBlend(quad.mesh.material, blendMode, 1.0);
      }

      quad.texture.needsUpdate = true;
      quad.mesh.position.z = i * 0.01;

      // BUG FIX: If this layer is used as a mask source for another layer,
      // do NOT add it to the scene as a visible quad. It renders silently.
      if (!maskSourceIds.has(layer.id)) {
        this._scene.add(quad.mesh);
      }
    });

    if (this._postEnabled && this._postPasses.length > 0) {
      this._renderWithPost();
    } else {
      this._renderer.setRenderTarget(null);
      this._renderer.render(this._scene, this._camera);
    }

    // ── Canvas-only blend pass ───────────────────────────────────
    // Overlay, softlight, hardlight, luminosity, color, hue, saturation
    // are not achievable in WebGL without custom shaders. We composite
    // them on top using the Canvas 2D API after the GL pass completes.
    const canvasLayers = layers.filter(l =>
      l.visible && this._quads.get(l.id)?._needsCanvasBlend && !maskSourceIds.has(l.id)
    );
    if (canvasLayers.length > 0) {
      this._applyCanvasBlendLayers(canvasLayers, W, H);
    } else if (this._overlayCanvas) {
      // No canvas-blend layers active — clear the overlay so no ghost frames persist
      this._overlayCtx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
    }
  }  // end _compositeFrame()

  /**
   * Draw the offscreen canvas onto itself with globalAlpha = opacity,
   * effectively multiplying every pixel's alpha by the opacity value.
   */
  _bakeOpacity(offscreen, W, H, opacity) {
    const oc  = this._opacityCanvas;
    const oct = this._opacityCtx;
    if (oc.width !== W || oc.height !== H) { oc.width = W; oc.height = H; }
    oct.clearRect(0, 0, W, H);
    oct.globalAlpha = opacity;
    oct.drawImage(offscreen, 0, 0);
    oct.globalAlpha = 1;

    const offCtx = offscreen.getContext('2d');
    offCtx.clearRect(0, 0, W, H);
    offCtx.drawImage(oc, 0, 0);
  }

  // ── Quad pool ────────────────────────────────────────────────

  _syncQuads(layers, W, H) {
    const activeIds = new Set(layers.map(l => l.id));
    this._quads.forEach((quad, id) => {
      if (!activeIds.has(id)) {
        quad.texture.dispose();
        quad.mesh.material.dispose();
        quad.mesh.geometry.dispose();
        this._quads.delete(id);
      }
    });

    layers.forEach(layer => {
      if (this._quads.has(layer.id)) {
        // Resize existing offscreen canvas if W/H changed
        const quad = this._quads.get(layer.id);
        if (W > 0 && H > 0 && (quad.offscreen.width !== W || quad.offscreen.height !== H)) {
          quad.offscreen.width  = W;
          quad.offscreen.height = H;
          quad.texture.needsUpdate = true;
        }
        return;
      }

      // Only create quads when we have real dimensions
      const cw = W > 0 ? W : 800;
      const ch = H > 0 ? H : 600;

      const offscreen    = document.createElement('canvas');
      offscreen.width    = cw;
      offscreen.height   = ch;
      const offCtx       = offscreen.getContext('2d', { willReadFrequently: false });
      const texture      = new THREE.CanvasTexture(offscreen);
      texture.minFilter  = THREE.LinearFilter;
      texture.magFilter  = THREE.LinearFilter;
      const geometry     = new THREE.PlaneGeometry(2, 2);
      const material     = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      this._quads.set(layer.id, { offscreen, offCtx, texture, mesh });
    });
  }

  // ── Blend modes ──────────────────────────────────────────────

  _applyBlend(material, mode, opacity) {
    material.opacity = VaelMath.clamp(opacity, 0, 1);

    switch (mode) {
      case 'add':
        material.blending           = THREE.AdditiveBlending;
        material.premultipliedAlpha = false;
        break;
      case 'multiply':
        material.blending           = THREE.MultiplyBlending;
        material.premultipliedAlpha = false;
        break;
      case 'screen':
        material.blending           = THREE.CustomBlending;
        material.blendSrc           = THREE.OneFactor;
        material.blendDst           = THREE.OneMinusSrcColorFactor;
        material.blendEquation      = THREE.AddEquation;
        material.premultipliedAlpha = false;
        break;
      case 'subtract':
        material.blending           = THREE.CustomBlending;
        material.blendSrc           = THREE.SrcAlphaFactor;
        material.blendDst           = THREE.OneFactor;
        material.blendEquation      = THREE.ReverseSubtractEquation;
        material.premultipliedAlpha = false;
        break;
      case 'difference':
        material.blending           = THREE.CustomBlending;
        material.blendSrc           = THREE.OneMinusDstColorFactor;
        material.blendDst           = THREE.OneMinusSrcColorFactor;
        material.blendEquation      = THREE.AddEquation;
        material.premultipliedAlpha = false;
        break;
      case 'exclusion':
        material.blending           = THREE.CustomBlending;
        material.blendSrc           = THREE.OneMinusDstColorFactor;
        material.blendDst           = THREE.OneMinusSrcColorFactor;
        material.blendEquation      = THREE.AddEquation;
        material.premultipliedAlpha = false;
        break;
      case 'overlay':
      case 'softlight':
      case 'hardlight':
      case 'luminosity':
      case 'color':
      case 'hue':
      case 'saturation':
        material.blending           = THREE.NormalBlending;
        material.premultipliedAlpha = true;
        break;
      default: // normal
        material.blending           = THREE.NormalBlending;
        material.premultipliedAlpha = true;
    }
    material.needsUpdate = true;
  }

  // ── Post-processing ──────────────────────────────────────────

  addPostPass(pass) {
    if (!this._postTarget) {
      this._postTarget  = new THREE.WebGLRenderTarget(this._cssW, this._cssH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      });
      this._postTargetB = new THREE.WebGLRenderTarget(this._cssW, this._cssH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      });
      this._feedbackBuffer = new THREE.WebGLRenderTarget(this._cssW, this._cssH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      });
    }
    this._postPasses.push(pass);
    this._postEnabled = this._postPasses.length > 0;
    this._buildPostMeshes();
  }

  removePostPass(name) {
    this._postPasses = this._postPasses.filter(p => p.name !== name);
    this._postEnabled = this._postPasses.length > 0;
    this._buildPostMeshes();
  }

  _buildPostMeshes() {
    this._postMeshes = this._postPasses.map(pass => {
      const geo = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse:    { value: null },
          tFeedback:   { value: null },
          iResolution: { value: new THREE.Vector2(this._cssW, this._cssH) },
          iTime:       { value: 0 },
          iBass:       { value: 0 },
          iMid:        { value: 0 },
          iTreble:     { value: 0 },
          iVolume:     { value: 0 },
          iBeat:       { value: 0 },
          ...pass.uniforms,
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: pass.fragmentShader,
        depthWrite: false,
        depthTest:  false,
      });
      return { pass, mesh: new THREE.Mesh(geo, mat) };
    });
  }

  _renderWithPost() {
    const postScene  = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._renderer.setRenderTarget(this._postTarget);
    this._renderer.render(this._scene, this._camera);

    let readTarget  = this._postTarget;
    let writeTarget = this._postTargetB;

    const hasFeedbackPass = this._postMeshes?.some(({ pass }) => pass.needsFeedback);

    this._postMeshes?.forEach(({ pass, mesh }, i) => {
      const isLast = i === this._postMeshes.length - 1;
      const mat    = mesh.material;

      mat.uniforms.tDiffuse.value    = readTarget.texture;
      mat.uniforms.iResolution.value.set(this._cssW, this._cssH);
      mat.uniforms.iTime.value       = performance.now() / 1000;
      mat.uniforms.iBass.value       = this.audioData?.bass    ?? 0;
      mat.uniforms.iMid.value        = this.audioData?.mid     ?? 0;
      mat.uniforms.iTreble.value     = this.audioData?.treble  ?? 0;
      mat.uniforms.iVolume.value     = this.audioData?.volume  ?? 0;
      mat.uniforms.iBeat.value       = this.audioData?.isBeat  ? 1.0 : 0.0;

      if (pass.needsFeedback && mat.uniforms.tFeedback) {
        mat.uniforms.tFeedback.value = this._feedbackBuffer.texture;
      }
      if (pass.updateUniforms) pass.updateUniforms(mat.uniforms, this.audioData);

      // When a feedback pass is last, render to writeTarget so we can capture
      // it properly — then blit to screen and feedbackBuffer below.
      const renderToScreen = isLast && !hasFeedbackPass;
      postScene.add(mesh);
      this._renderer.setRenderTarget(renderToScreen ? null : writeTarget);
      this._renderer.render(postScene, postCamera);
      postScene.remove(mesh);

      const tmp = readTarget; readTarget = writeTarget; writeTarget = tmp;
    });

    if (this._feedbackBuffer && this._postMeshes?.length > 0) {
      // readTarget now holds the final post-processed frame.
      // Save it into feedbackBuffer for next frame's tFeedback uniform.
      const blitScene = new THREE.Scene();
      const geo       = new THREE.PlaneGeometry(2, 2);
      const mat       = new THREE.MeshBasicMaterial({ map: readTarget.texture, depthWrite: false, depthTest: false });
      blitScene.add(new THREE.Mesh(geo, mat));

      // Capture to feedbackBuffer
      this._renderer.setRenderTarget(this._feedbackBuffer);
      this._renderer.render(blitScene, postCamera);

      // If last pass rendered to writeTarget (not screen), blit to screen now
      if (hasFeedbackPass) {
        this._renderer.setRenderTarget(null);
        this._renderer.render(blitScene, postCamera);
      }

      this._renderer.setRenderTarget(null);
      geo.dispose(); mat.dispose();
    }
  }

  get fps()    { return Math.round(this._fpsSmoothed); }
  get width()  { return this._cssW; }
  get height() { return this._cssH; }

  /**
   * Composite canvas-only blend mode layers (overlay, softlight, etc.)
   * on top of the WebGL output by reading back the GL canvas and drawing
   * each layer's offscreen canvas onto it with the correct 2D composite op.
   */
  _applyCanvasBlendLayers(layers, W, H) {
    if (!this._overlayCanvas) {
      this._overlayCanvas = document.createElement('canvas');
      this._overlayCanvas.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:0';
      this._overlayCanvas.style.width  = this.canvas.style.width  || '100%';
      this._overlayCanvas.style.height = this.canvas.style.height || '100%';
      this._overlayCanvas.style.margin = this.canvas.style.margin || '';
      this._overlayCanvas.style.display = 'block';
      // Insert before the status strip so it doesn't cover it
      const statusStrip = document.getElementById('status-strip');
      if (statusStrip) {
        this.canvas.parentElement?.insertBefore(this._overlayCanvas, statusStrip);
      } else {
        this.canvas.parentElement?.appendChild(this._overlayCanvas);
      }
      this._overlayCtx = this._overlayCanvas.getContext('2d');
    }
    if (this._overlayCanvas.width !== W || this._overlayCanvas.height !== H) {
      this._overlayCanvas.width  = W;
      this._overlayCanvas.height = H;
    }
    const ctx = this._overlayCtx;
    ctx.clearRect(0, 0, W, H);

    // Step 1: Copy the WebGL scene as a base so blend modes have pixels to blend against.
    // Without this base, blend modes like multiply/overlay composite against transparency
    // which is effectively invisible — they all look identical.
    // preserveDrawingBuffer:true on the WebGLRenderer makes this readback work.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.canvas, 0, 0, W, H);

    // Step 2: Draw each blend-mode layer on top using the correct Canvas 2D op.
    layers.forEach(layer => {
      const quad = this._quads.get(layer.id);
      if (!quad) return;
      const op = _canvas2dBlendOp(layer.blendMode);
      ctx.save();
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = quad._overlayOpacity ?? 1;
      ctx.drawImage(quad.offscreen, 0, 0, W, H,
                    0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
      ctx.restore();
    });
  }

  dispose() {
    this.stop();
    this._quads.forEach(quad => {
      quad.texture.dispose();
      quad.mesh.material.dispose();
      quad.mesh.geometry.dispose();
    });
    this._renderer.dispose();
  }
}

// Blend modes where THREE.js ignores material.opacity —
// we need to bake opacity into the canvas pixels instead.
function _blendIgnoresOpacity(mode) {
  return ['screen', 'add', 'subtract', 'difference', 'exclusion'].includes(mode);
}

// Blend modes that WebGL can't do natively — handled via Canvas 2D after the GL pass.
// Also includes multiply (WebGL multiply ignores material.opacity) and screen
// (THREE.OneFactor ignores src alpha entirely, so bakeOpacity has no effect on it).
function _isCanvasOnlyBlend(mode) {
  return ['overlay', 'softlight', 'hardlight', 'luminosity', 'color',
          'hue', 'saturation', 'multiply', 'difference', 'exclusion', 'screen'].includes(mode);
}

// Map Vael blend mode names to Canvas 2D globalCompositeOperation values.
function _canvas2dBlendOp(mode) {
  const map = {
    screen:     'screen',
    multiply:   'multiply',
    difference: 'difference',
    exclusion:  'exclusion',
    overlay:    'overlay',
    softlight:  'soft-light',
    hardlight:  'hard-light',
    luminosity: 'luminosity',
    color:      'color',
    hue:        'hue',
    saturation: 'saturation',
  };
  return map[mode] || 'source-over';
}

/**
 * Apply a mask from maskCanvas onto targetCanvas.
 *
 * mode 'alpha'     — Hard alpha mask. The mask layer's drawn pixels (any colour,
 *                    any alpha > 0) define what is visible. Areas outside the mask
 *                    are cut away. Best for shape/silhouette masks using an image
 *                    layer with transparency.
 *
 * mode 'luminance' — Soft luminance mask. The mask layer's brightness controls
 *                    the target layer's opacity: white = fully visible,
 *                    black = fully transparent, grey = semi-transparent.
 *                    Best for organic, painterly masks using noise, video,
 *                    or shaders. The most cinematic of the two modes.
 *
 * mode 'invert'    — Same as luminance but inverted: dark areas of the mask
 *                    reveal the layer, bright areas hide it.
 */
function _applyMask(targetCanvas, targetCtx, maskCanvas, mode, W, H) {
  if (mode === 'alpha') {
    // Standard alpha compositing: keep only pixels where the mask has coverage
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(maskCanvas, 0, 0);
    targetCtx.restore();
    return;
  }

  // Luminance modes: read mask pixels, derive an alpha map, apply to target
  // This requires reading pixel data — done on a small temp canvas to keep
  // it off the GPU hot path. We read at full resolution for accuracy.
  try {
    // Get mask pixel data
    const maskCtx  = maskCanvas.getContext('2d');
    const maskData = maskCtx.getImageData(0, 0, W, H);
    const md       = maskData.data;

    // Get target pixel data
    const targetData = targetCtx.getImageData(0, 0, W, H);
    const td         = targetData.data;

    const invert = mode === 'invert';

    for (let i = 0; i < td.length; i += 4) {
      // Perceived luminance (ITU-R BT.709 weights)
      const r = md[i], g = md[i+1], b = md[i+2], a = md[i+3];
      // Premultiply by mask alpha so fully-transparent mask pixels become black
      const premR = r * (a / 255);
      const premG = g * (a / 255);
      const premB = b * (a / 255);
      let luma = (0.2126 * premR + 0.7152 * premG + 0.0722 * premB) / 255;
      if (invert) luma = 1 - luma;
      // Multiply the target pixel's alpha by the luminance value
      td[i+3] = Math.round(td[i+3] * luma);
    }

    targetCtx.putImageData(targetData, 0, 0);
  } catch (e) {
    // Canvas tainted (cross-origin) or other error — fall back to alpha mask
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(maskCanvas, 0, 0);
    targetCtx.restore();
  }
}
