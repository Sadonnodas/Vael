/**
 * layers/ShaderLayer.js
 * Runs GLSL fragment shaders on the GPU via Three.js WebGLRenderer.
 *
 * CHANGE: Added colorA, colorB, and hueShift to the manifest and to all
 * built-in shader uniforms, so colors can be adjusted from the params panel.
 * Each built-in shader now uses a shared color mixing helper that blends
 * between colorA and colorB driven by the shader's internal value,
 * with hueShift rotating the whole palette.
 *
 * Uniforms available in every shader:
 *   uniform float iTime;
 *   uniform vec2  iResolution;
 *   uniform float iBass, iMid, iTreble, iVolume, iBeat, iBpm;
 *   uniform float iMouseX, iMouseY;
 *   uniform float iSpeed, iIntensity, iScale;
 *   uniform vec3  iColorA;       // NEW — primary color (default cyan)
 *   uniform vec3  iColorB;       // NEW — secondary color (default purple)
 *   uniform float iHueShift;     // NEW — rotate entire palette (0–360)
 */

class ShaderLayer extends BaseLayer {

  static manifest = {
    name: 'Shader',
    version: '3.0',
    params: [
      { id: 'speed',       label: 'Speed',       type: 'float', default: 1.0,  min: 0,   max: 4   },
      { id: 'intensity',   label: 'Intensity',   type: 'float', default: 1.0,  min: 0,   max: 2   },
      { id: 'scale',       label: 'Scale',       type: 'float', default: 1.0,  min: 0.1, max: 5   },
      { id: 'colorA',      label: 'Color A',     type: 'color', default: '#00d4aa' },
      { id: 'colorB',      label: 'Color B',     type: 'color', default: '#7c3ff0' },
      { id: 'hueShift',    label: 'Hue shift',   type: 'float', default: 0,    min: 0,   max: 360 },
      { id: 'audioTarget', label: 'Audio band',  type: 'band',  default: 'bass', legacy: true },
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
    this.params = {
      speed:       1.0,
      intensity:   1.0,
      scale:       1.0,
      colorA:      '#00d4aa',
      colorB:      '#7c3ff0',
      hueShift:    0,
      audioTarget: 'bass',
    };

    this._shaderName  = 'plasma';
    this._customGLSL  = null;
    this._time        = 0;
    this._audioSmooth = 0;
    this._beatPulse   = 0;

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
  }

  get glslSource() { return this._customGLSL || ShaderLayer.BUILTINS[this._shaderName] || ''; }
  get isCustom()   { return this._shaderName === 'custom'; }

  // ── Helper: hex color → THREE.Vector3 ────────────────────────

  _hexToVec3(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return new THREE.Vector3(
      ((n >> 16) & 255) / 255,
      ((n >>  8) & 255) / 255,
      ( n        & 255) / 255
    );
  }

  // ── GPU setup ─────────────────────────────────────────────────

  _ensureGPU(W, H) {
    const resized = W !== this._W || H !== this._H;

    if (!this._offCanvas) {
      this._offCanvas        = document.createElement('canvas');
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
    if (this._threeMesh) {
      this._threeScene.remove(this._threeMesh);
      this._threeMesh.material.dispose();
      this._threeMesh.geometry.dispose();
    }

    const glsl = this.glslSource;
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
          iColorA:     { value: new THREE.Vector3(0, 0.83, 0.67) },  // #00d4aa
          iColorB:     { value: new THREE.Vector3(0.49, 0.25, 0.94) }, // #7c3ff0
          iHueShift:   { value: 0 },
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
    const band = this.params.audioTarget || 'bass';
    const av   = audioData?.isActive ? (audioData[band] ?? 0) : 0;
    this._audioSmooth = VaelMath.lerp(this._audioSmooth, av, 0.08);
    if (audioData?.isBeat) this._beatPulse = 1.0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    this._ensureGPU(width, height);
    if (!this._threeMesh?.material?.uniforms) return;

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

    // Color uniforms — convert hex params to vec3 each frame.
    // Only update if the uniform exists (custom shaders may not use them).
    if (u.iColorA) u.iColorA.value = this._hexToVec3(this.params.colorA || '#00d4aa');
    if (u.iColorB) u.iColorB.value = this._hexToVec3(this.params.colorB || '#7c3ff0');
    if (u.iHueShift) u.iHueShift.value = (this.params.hueShift || 0) / 360.0;

    this._threeRenderer.render(this._threeScene, this._threeCamera);

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
    uniform vec3  iColorA;
    uniform vec3  iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    // Rotate hue of an RGB color by angle (0–1 = 0–360 degrees)
    vec3 hueRotate(vec3 c, float angle) {
      float cosA = cos(angle * 6.28318);
      float sinA = sin(angle * 6.28318);
      vec3 k = vec3(0.57735);
      return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
    }

    ${src}

    void main() {
      vec2 fragCoord = vUv * iResolution;
      vec4 col = vec4(0.);
      mainImage(col, fragCoord);
      col.rgb = hueRotate(col.rgb, iHueShift);
      gl_FragColor = col;
    }
  `;
}

function _fallbackGLSL() {
  return `
    uniform float iTime;
    uniform vec2  iResolution;
    uniform float iBass;
    uniform vec3  iColorA;
    uniform vec3  iColorB;
    uniform float iHueShift;
    varying vec2 vUv;
    vec3 hueRotate(vec3 c, float angle) {
      float cosA = cos(angle * 6.28318);
      float sinA = sin(angle * 6.28318);
      vec3 k = vec3(0.57735);
      return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
    }
    void main() {
      vec2 uv = vUv;
      float v = sin(uv.x * 10. + iTime) * sin(uv.y * 10. + iTime * .7) + iBass;
      vec3 col = mix(iColorA, iColorB, v * .5 + .5);
      gl_FragColor = vec4(hueRotate(col, iHueShift), 1.);
    }
  `;
}

// ── Built-in GLSL shaders ─────────────────────────────────────────
// All shaders now use iColorA, iColorB, and iHueShift.
// The color blending formula is:  mix(iColorA, iColorB, internalValue)
// so Color A = low end, Color B = high end of each shader's range.

ShaderLayer.BUILTINS = {

  plasma: `
    uniform float iTime, iBass, iScale, iIntensity;
    uniform vec2  iResolution;
    uniform vec3  iColorA, iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    vec3 hueRotate(vec3 c, float a) {
      float ca = cos(a*6.283), sa = sin(a*6.283);
      vec3 k = vec3(0.577);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.-ca);
    }

    void main() {
      vec2 uv = vUv * iScale;
      float t = iTime;
      float v = sin(uv.x*6.+t) + sin(uv.y*6.+t*.7)
              + sin((uv.x+uv.y)*4.+t*1.3)
              + sin(length(uv-.5)*8.+t+iBass*4.);
      float blend = v*.25+.5+iBass*.15;
      blend = clamp(blend, 0., 1.);
      vec3 col = mix(iColorA, iColorB, blend);
      col = hueRotate(col, iHueShift);
      gl_FragColor = vec4(col, iIntensity);
    }`,

  ripple: `
    uniform float iTime, iBass, iBeat, iScale;
    uniform vec2  iResolution;
    uniform vec3  iColorA, iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    vec3 hueRotate(vec3 c, float a) {
      float ca = cos(a*6.283), sa = sin(a*6.283);
      vec3 k = vec3(0.577);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.-ca);
    }

    void main() {
      vec2 uv  = vUv - .5;
      float d  = length(uv);
      float bp = iBeat * 4. + iBass * 8.;
      float w  = sin(d * 20. * iScale - iTime * 3. + bp);
      float blend = clamp((w + 1.) * .5, 0., 1.);
      vec3 col = mix(iColorA, iColorB, blend);
      col = hueRotate(col, iHueShift);
      gl_FragColor = vec4(col, .9);
    }`,

  distort: `
    uniform float iTime, iBass, iBeat, iScale, iIntensity;
    uniform vec2  iResolution;
    uniform vec3  iColorA, iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                 mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }

    vec3 hueRotate(vec3 c, float a) {
      float ca = cos(a*6.283), sa = sin(a*6.283);
      vec3 k = vec3(0.577);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.-ca);
    }

    void main() {
      float t  = iTime * .4;
      float e  = iIntensity * .15 * (1. + iBass * 1.5 + iBeat * 2.);
      vec2 d   = vec2(noise(vUv*3.*iScale+vec2(t,0))-.5,
                      noise(vUv*3.*iScale+vec2(0,t+1.7))-.5) * e;
      vec2 uv  = vUv + d;
      float blend = clamp(noise(uv * 2.) * .5 + iBass * .3, 0., 1.);
      vec3 col = mix(iColorA, iColorB, blend);
      col = hueRotate(col, iHueShift);
      gl_FragColor = vec4(col, .9);
    }`,

  bloom: `
    uniform float iTime, iBass, iBeat, iIntensity;
    uniform vec2  iResolution;
    uniform vec3  iColorA, iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    vec3 hueRotate(vec3 c, float a) {
      float ca = cos(a*6.283), sa = sin(a*6.283);
      vec3 k = vec3(0.577);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.-ca);
    }

    void main() {
      vec2 uv  = vUv - .5;
      float bp = iBeat * .2 + iBass * .4;
      float r  = (.2 + bp) * max(iResolution.x, iResolution.y) / iResolution.x;
      float d  = length(uv);
      float glow = exp(-d * d / (r * r * .1)) * iIntensity * (1. + iBass * .5);
      float blend = clamp(glow + iBass * .1 + iTime * 0.01, 0., 1.);
      vec3 col = mix(iColorA, iColorB, blend) * (glow + .05);
      col = hueRotate(col, iHueShift);
      gl_FragColor = vec4(col, glow);
    }`,

  chromatic: `
    uniform float iTime, iBass, iBeat, iScale;
    uniform vec2  iResolution;
    uniform vec3  iColorA, iColorB;
    uniform float iHueShift;
    varying vec2 vUv;

    vec3 hueRotate(vec3 c, float a) {
      float ca = cos(a*6.283), sa = sin(a*6.283);
      vec3 k = vec3(0.577);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.-ca);
    }

    void main() {
      float off = (.003 + iBeat * .008 + iBass * .003) * iScale;
      float t   = iTime * .5;
      float r   = sin((vUv.x + off) * 8. + t) * sin((vUv.y + off) * 6. + t * .8);
      float g   = sin(vUv.x * 8. + t) * sin(vUv.y * 6. + t * .8);
      float b   = sin((vUv.x - off) * 8. + t) * sin((vUv.y - off) * 6. + t * .8);
      float blend = clamp(g * .5 + .5, 0., 1.);
      // Chromatic split applied on top of user colors
      vec3 base = mix(iColorA, iColorB, blend);
      vec3 col  = vec3(
        base.r * (r*.5+.5),
        base.g * (g*.5+.5),
        base.b * (b*.5+.5)
      );
      col = hueRotate(col, iHueShift);
      gl_FragColor = vec4(col, .9);
    }`,
};
