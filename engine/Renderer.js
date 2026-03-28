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
      antialias:   false,
      alpha:       false,
      premultipliedAlpha: false,
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
    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this._cssW && h === this._cssH) return;
    this._cssW = w;
    this._cssH = h;
    this._renderer.setSize(w, h, false);

    this._quads.forEach(quad => {
      quad.offscreen.width  = w;
      quad.offscreen.height = h;
      quad.texture.needsUpdate = true;
    });

    if (this._postTarget) this._postTarget.setSize(w, h);

    this._opacityCanvas.width  = w;
    this._opacityCanvas.height = h;
  }

  // ── Render loop ──────────────────────────────────────────────

  start() {
    const loop = (timestamp) => {
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

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  // ── Compositing ──────────────────────────────────────────────

  _compositeFrame() {
    const W = this._cssW;
    const H = this._cssH;
    const layers = this.layerStack.layers;

    this._syncQuads(layers, W, H);

    // ── Pass 1: render layers to offscreen canvases ─────────────
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
    });

    // ── Pass 2: masks, FX, opacity bake, upload ─────────────────
    while (this._scene.children.length) this._scene.remove(this._scene.children[0]);

    layers.forEach((layer, i) => {
      if (!layer.visible) return;
      const quad = this._quads.get(layer.id);
      if (!quad) return;

      // Mask
      if (layer.maskLayerId) {
        const maskQuad = this._quads.get(layer.maskLayerId);
        if (maskQuad) {
          quad.offCtx.save();
          quad.offCtx.globalCompositeOperation = 'destination-in';
          quad.offCtx.drawImage(maskQuad.offscreen, 0, 0);
          quad.offCtx.restore();
        }
      }

      // Per-layer FX
      if (layer.fx && layer.fx.length > 0) {
        LayerFX.apply(layer, quad.offscreen, quad.offCtx, W, H, this.audioData);
      }

      const opacity    = VaelMath.clamp(layer.opacity ?? 1, 0, 1);
      const blendMode  = layer.blendMode || 'normal';

      // FIX: for blend modes where THREE ignores material.opacity (screen, add,
      // subtract, difference, exclusion), bake opacity into the canvas pixels.
      // For normal/multiply/overlay etc. material.opacity works fine.
      if (opacity < 0.999 && _blendIgnoresOpacity(blendMode)) {
        this._bakeOpacity(quad.offscreen, W, H, opacity);
        // After baking, tell the material to use full opacity
        this._applyBlend(quad.mesh.material, blendMode, 1.0);
      } else {
        this._applyBlend(quad.mesh.material, blendMode, opacity);
      }

      quad.texture.needsUpdate = true;
      quad.mesh.position.z = i * 0.01;
      this._scene.add(quad.mesh);
    });

    if (this._postEnabled && this._postPasses.length > 0) {
      this._renderWithPost();
    } else {
      this._renderer.setRenderTarget(null);
      this._renderer.render(this._scene, this._camera);
    }
  }

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
      if (this._quads.has(layer.id)) return;

      const offscreen    = document.createElement('canvas');
      offscreen.width    = W || 800;
      offscreen.height   = H || 600;
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

      postScene.add(mesh);
      this._renderer.setRenderTarget(isLast ? null : writeTarget);
      this._renderer.render(postScene, postCamera);
      postScene.remove(mesh);

      const tmp = readTarget; readTarget = writeTarget; writeTarget = tmp;
    });

    if (this._feedbackBuffer && this._postMeshes?.length > 0) {
      const blitScene = new THREE.Scene();
      const geo       = new THREE.PlaneGeometry(2, 2);
      const mat       = new THREE.MeshBasicMaterial({ map: readTarget.texture, depthWrite: false, depthTest: false });
      blitScene.add(new THREE.Mesh(geo, mat));
      this._renderer.setRenderTarget(this._feedbackBuffer);
      this._renderer.render(blitScene, postCamera);
      this._renderer.setRenderTarget(null);
      geo.dispose(); mat.dispose();
    }
  }

  get fps()    { return Math.round(this._fpsSmoothed); }
  get width()  { return this._cssW; }
  get height() { return this._cssH; }

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
