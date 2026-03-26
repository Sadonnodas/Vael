/**
 * layers/ShaderLayer.js
 * Runs GLSL fragment shaders on the GPU via Three.js WebGLRenderer.
 * ShaderToy mainImage convention supported.
 *
 * Uniforms available in every shader:
 *   uniform float iTime;         // seconds since start
 *   uniform vec2  iResolution;   // canvas size in pixels
 *   uniform float iBass;         // 0–1
 *   uniform float iMid;
 *   uniform float iTreble;
 *   uniform float iVolume;
 *   uniform float iBeat;         // 1 on beat frame, 0 otherwise
 *   uniform float iBpm;
 *   uniform float iMouseX;       // 0–1
 *   uniform float iMouseY;       // 0–1
 *   uniform float iSpeed;        // user param
 *   uniform float iIntensity;    // user param
 *   uniform float iScale;        // user param
 *
 * Write shaders in ShaderToy mainImage style:
 *   void mainImage(out vec4 fragColor, in vec2 fragCoord) { ... }
 *
 * Or standard GLSL main():
 *   void main() { gl_FragColor = ...; }
 */

class ShaderLayer extends BaseLayer {

  static manifest = {
    name: 'Shader',
    version: '2.0',
    params: [
      { id: 'speed',       label: 'Speed',       type: 'float', default: 1.0, min: 0, max: 4   },
      { id: 'intensity',   label: 'Intensity',   type: 'float', default: 1.0, min: 0, max: 2   },
      { id: 'scale',       label: 'Scale',       type: 'float', default: 1.0, min: 0.1, max: 5 },
      { id: 'audioTarget', label: 'Audio band',  type: 'band',  default: 'bass' },
    ],
  };

  // ── Static factory ────────────────────────────────────────────

  static fromBuiltin(name, id) {
    const glsl = ShaderLayer.BUILTINS[name];
    if (!glsl) { console.warn(`ShaderLayer: no builtin "${name}"`); return null; }
    const layer = new ShaderLayer(id || `shader-${name}-${Date.now()}`);
    layer.init({ shaderName: name });
    return layer;
  }

  // ── Instance ──────────────────────────────────────────────────

  constructor(id) {
    super(id, 'Shader');
    this.params = { speed: 1.0, intensity: 1.0, scale: 1.0, audioTarget: 'bass' };

    this._shaderName  = 'plasma';
    this._customGLSL  = null;
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;

    // Three.js GPU renderer
    this._threeRenderer = null;
    this._threeScene    = null;
    this._threeCamera   = null;
    this._threeMesh     = null;
    this._offCanvas     = null;
    this._W = 0; this._H = 0;
  }

  init(params = {}) {
    if (params.shaderName) this._shaderName = params.shaderName;
    if (params.glsl)       { this._customGLSL = params.glsl; this._shaderName = 'custom'; }
    this.name = params.name || `Shader — ${this._shaderName}`;
    Object.keys(this.params).forEach(k => { if (params[k] !== undefined) this.params[k] = params[k]; });
    this._gpuDirty = true;
  }

  loadGLSL(src) {
    this._customGLSL = src;
    this._shaderName = 'custom';
    this.name        = 'Custom Shader';
    this._gpuDirty   = true;
    if (typeof Toast !== 'undefined') Toast.success('Shader loaded on GPU');
  }

  get glslSource() { return this._customGLSL || ShaderLayer.BUILTINS[this._shaderName] || ''; }
  get isCustom()   { return this._shaderName === 'custom'; }

  // ── GPU setup ─────────────────────────────────────────────────

  _ensureGPU(W, H) {
    const resized = W !== this._W || H !== this._H;

    if (!this._offCanvas) {
      this._offCanvas      = document.createElement('canvas');
      this._offCanvas.width  = W;
      this._offCanvas.height = H;

      this._threeRenderer = new THREE.WebGLRenderer({
        canvas:    this._offCanvas,
        antialias: false,
        alpha:     true,
        premultipliedAlpha: false,
      });
      this._threeRenderer.setPixelRatio(1);
      this._threeScene  = new THREE.Scene();
      this._threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._gpuDirty    = true;
    }

    if (resized) {
      this._offCanvas.width  = W;
      this._offCanvas.height = H;
      this._threeRenderer.setSize(W, H, false);
      this._W = W; this._H = H;
      if (this._threeMesh?.material) {
        this._threeMesh.material.uniforms.iResolution.value.set(W, H);
      }
    }

    if (this._gpuDirty) {
      this._buildMaterial(W, H);
      this._gpuDirty = false;
    }
  }

  _buildMaterial(W, H) {
    // Dispose old mesh
    if (this._threeMesh) {
      this._threeScene.remove(this._threeMesh);
      this._threeMesh.material.dispose();
      this._threeMesh.geometry.dispose();
    }

    const glsl = this.glslSource;
    // Detect ShaderToy mainImage style and wrap if needed
    const fragSrc = glsl.includes('mainImage')
      ? _wrapShaderToy(glsl)
      : (glsl.includes('void main') ? glsl : _fallbackGLSL());

    let material;
    try {
      material = new THREE.ShaderMaterial({
        uniforms: {
          iTime:       { value: 0 },
          iResolution: { value: new THREE.Vector2(W, H) },
          iBass:       { value: 0 },
          iMid:        { value: 0 },
          iTreble:     { value: 0 },
          iVolume:     { value: 0 },
          iBeat:       { value: 0 },
          iBpm:        { value: 0 },
          iMouseX:     { value: 0.5 },
          iMouseY:     { value: 0.5 },
          iSpeed:      { value: 1 },
          iIntensity:  { value: 1 },
          iScale:      { value: 1 },
        },
        vertexShader:   'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.);}',
        fragmentShader: fragSrc,
        depthWrite:     false,
        depthTest:      false,
      });
    } catch (e) {
      console.warn('ShaderLayer: material build error', e);
      material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    }

    const geo  = new THREE.PlaneGeometry(2, 2);
    this._threeMesh = new THREE.Mesh(geo, material);
    this._threeScene.add(this._threeMesh);
  }

  // ── Update / render ───────────────────────────────────────────

  update(audioData, videoData, dt) {
    this._time += dt * this.params.speed;
    const av = audioData?.isActive ? (audioData[this.params.audioTarget] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    this._ensureGPU(width, height);
    if (!this._threeMesh?.material?.uniforms) return;

    // Update uniforms
    const u = this._threeMesh.material.uniforms;
    u.iTime.value       = this._time;
    u.iResolution.value.set(width, height);
    u.iBass.value       = this._audioSmooth;
    u.iMid.value        = 0;
    u.iTreble.value     = 0;
    u.iVolume.value     = this._audioSmooth;
    u.iBeat.value       = this._beatPulse;
    u.iBpm.value        = this.uniforms.iBpm;
    u.iMouseX.value     = this.uniforms.iMouseX;
    u.iMouseY.value     = this.uniforms.iMouseY;
    u.iSpeed.value      = this.params.speed;
    u.iIntensity.value  = this.params.intensity;
    u.iScale.value      = this.params.scale;

    // Render to offscreen canvas
    this._threeRenderer.render(this._threeScene, this._threeCamera);

    // Draw offscreen canvas onto layer ctx (already translated to centre)
    ctx.save();
    ctx.globalAlpha = this.params.intensity > 0 ? 1 : 0;
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._offCanvas, 0, 0, width, height);
    ctx.restore();
  }

  dispose() {
    this._threeMesh?.material?.dispose();
    this._threeMesh?.geometry?.dispose();
    this._threeRenderer?.dispose();
    this._offCanvas = null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      shaderName: this._shaderName,
      glsl:       this._customGLSL || null,
      params:     { ...this.params },
    };
  }
}

// ── GLSL helpers ──────────────────────────────────────────────────

function _wrapShaderToy(src) {
  return `
    uniform float iTime;
    uniform vec2  iResolution;
    uniform float iBass, iMid, iTreble, iVolume, iBeat, iBpm;
    uniform float iMouseX, iMouseY;
    uniform float iSpeed, iIntensity, iScale;
    varying vec2 vUv;

    ${src}

    void main() {
      vec2 fragCoord = vUv * iResolution;
      vec4 col = vec4(0.);
      mainImage(col, fragCoord);
      gl_FragColor = col;
    }
  `;
}

function _fallbackGLSL() {
  return `
    uniform float iTime;
    uniform vec2  iResolution;
    uniform float iBass;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float v = sin(uv.x * 10. + iTime) * sin(uv.y * 10. + iTime * .7) + iBass;
      gl_FragColor = vec4(v*.5+.5, v*.2+.3, v*.8+.2, 1.);
    }
  `;
}

// ── Built-in GLSL shaders (run on GPU) ───────────────────────────

ShaderLayer.BUILTINS = {

  plasma: `
    uniform float iTime, iBass, iScale, iIntensity;
    uniform vec2 iResolution;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv * iScale;
      float t = iTime;
      float v = sin(uv.x*6.+t) + sin(uv.y*6.+t*.7)
              + sin((uv.x+uv.y)*4.+t*1.3)
              + sin(length(uv-.5)*8.+t+iBass*4.);
      float h = v*.25+.5+iBass*.2;
      float r = abs(sin(h*3.14159));
      float g = abs(sin(h*3.14159+2.094));
      float b = abs(sin(h*3.14159+4.189));
      gl_FragColor = vec4(r,g,b,iIntensity);
    }`,

  ripple: `
    uniform float iTime, iBass, iBeat, iScale;
    uniform vec2 iResolution;
    varying vec2 vUv;
    void main() {
      vec2 uv  = vUv - .5;
      float d  = length(uv);
      float bp = iBeat * 4. + iBass * 8.;
      float w  = sin(d * 20. * iScale - iTime * 3. + bp);
      float v  = (w + 1.) * .5;
      float h  = .55 + v * .2;
      gl_FragColor = vec4(0., h*.8, h, .9);
    }`,

  distort: `
    uniform float iTime, iBass, iBeat, iScale, iIntensity;
    uniform vec2 iResolution;
    varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main() {
      float t  = iTime * .4;
      float e  = iIntensity * .15 * (1. + iBass * 1.5 + iBeat * 2.);
      vec2 d   = vec2(noise(vUv*3.*iScale+vec2(t,0))-.5, noise(vUv*3.*iScale+vec2(0,t+1.7))-.5)*e;
      vec2 uv  = vUv + d;
      float h  = noise(uv * 2.) * .5 + iBass * .3;
      gl_FragColor = vec4(h*.2, h*.4+.1, h*.8+.2, .9);
    }`,

  bloom: `
    uniform float iTime, iBass, iBeat, iIntensity;
    uniform vec2 iResolution;
    varying vec2 vUv;
    void main() {
      vec2 uv  = vUv - .5;
      float bp = iBeat * .2 + iBass * .4;
      float r  = (.2 + bp) * max(iResolution.x, iResolution.y) / iResolution.x;
      float d  = length(uv);
      float h  = .45 + iTime * .03;
      float glow = exp(-d * d / (r * r * .1)) * iIntensity * (1. + iBass * .5);
      float hue  = h + iBass * .1;
      float rv   = abs(sin(hue * 6.28));
      float gv   = abs(sin(hue * 6.28 + 2.09));
      float bv   = abs(sin(hue * 6.28 + 4.19));
      gl_FragColor = vec4(rv * glow, gv * glow, bv * glow, glow);
    }`,

  chromatic: `
    uniform float iTime, iBass, iBeat, iScale;
    uniform vec2 iResolution;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float off = (.003 + iBeat * .008 + iBass * .003) * iScale;
      vec2 dir  = normalize(uv - .5) * length(uv - .5);
      // Chromatic split on a moving plasma background
      float t = iTime * .5;
      float r = sin((uv.x + off) * 8. + t) * sin((uv.y + off) * 6. + t * .8);
      float g = sin(uv.x * 8. + t) * sin(uv.y * 6. + t * .8);
      float b = sin((uv.x - off) * 8. + t) * sin((uv.y - off) * 6. + t * .8);
      gl_FragColor = vec4(r*.5+.5, g*.5+.5, b*.5+.5, .9);
    }`,
};