/**
 * layers/ShaderLayer.js
 * Runs GLSL fragment shaders on the GPU via Three.js WebGLRenderer.
 *
 * FIXES:
 * - GLSL_HEADER now prepended to EVERY shader path. This was the root cause
 *   of "iResolution undeclared" — Three.js does not auto-inject uniforms.
 * - Added iParam1, iParam2, iParam3 uniforms (the main user sliders).
 * - Added iColorA (vec3), iColorB (vec3), iHueShift (float) uniforms.
 * - iMid, iTreble, iVolume now correctly wired from audioData (were 0 before).
 * - Manifest updated: Param 1/2/3, Color A/B, Hue Shift all appear in PARAMS.
 * - Builtins stripped of their own uniform declarations — GLSL_HEADER covers all.
 */

const GLSL_HEADER = `
uniform float iTime;
uniform vec2  iResolution;
uniform float iBass;
uniform float iMid;
uniform float iTreble;
uniform float iVolume;
uniform float iBeat;
uniform float iBpm;
uniform float iMouseX;
uniform float iMouseY;
uniform float iParam1;
uniform float iParam2;
uniform float iParam3;
uniform vec3  iColorA;
uniform vec3  iColorB;
uniform float iHueShift;
uniform float iSpeed;
uniform float iIntensity;
uniform float iScale;
varying vec2 vUv;
`;

class ShaderLayer extends BaseLayer {

  static manifest = {
    name: 'Shader',
    version: '3.0',
    params: [
      { id: 'param1',      label: 'Param 1',     type: 'float', default: 0.5, min: 0,   max: 1   },
      { id: 'param2',      label: 'Param 2',     type: 'float', default: 0.5, min: 0,   max: 1   },
      { id: 'param3',      label: 'Param 3',     type: 'float', default: 0.5, min: 0,   max: 1   },
      { id: 'colorA',      label: 'Color A',     type: 'color', default: '#00d4aa'               },
      { id: 'colorB',      label: 'Color B',     type: 'color', default: '#7c3ff0'               },
      { id: 'hueShift',    label: 'Hue shift',   type: 'float', default: 0,   min: 0,   max: 360 },
      { id: 'audioReact',     label: 'Audio react',     type: 'float', default: 1.0, min: 0,    max: 1,
        // 0 = audio uniforms (iBass etc.) are always 0 in built-in shader response.
        // 1 = full audio feeds uniforms. Shader GLSL still receives real values via
        //     iBass/iMid/iTreble regardless — this only gates the speed/beat reaction.
      },
      { id: 'audioSmoothing', label: 'Audio smoothing', type: 'float', default: 0.08, min: 0.01, max: 1, step: 0.01,
        // How quickly audio values chase their target each frame.
        // 0.01 = very smooth/slow (buttery, no jitter). 1.0 = instant/raw (maximum reactivity, can be jerky).
        // Default 0.08 gives gentle smoothing that eliminates per-frame spikes without killing responsiveness.
      },
      { id: 'speed',       label: 'Speed',       type: 'float', default: 1.0, min: 0,   max: 4   },
      { id: 'intensity',   label: 'Intensity',   type: 'float', default: 1.0, min: 0,   max: 2   },
      { id: 'scale',       label: 'Scale',       type: 'float', default: 1.0, min: 0.1, max: 5   },
    ],
  };

  static fromBuiltin(name, id) {
    const glsl = ShaderLayer.BUILTINS[name];
    if (!glsl) { console.warn(`ShaderLayer: no builtin "${name}"`); return null; }
    const layer = new ShaderLayer(id || `shader-${name}-${Date.now()}`);
    layer.init({ shaderName: name });
    return layer;
  }

  constructor(id) {
    super(id, 'Shader');
    this.params = {
      param1: 0.5, param2: 0.5, param3: 0.5,
      colorA: '#00d4aa', colorB: '#7c3ff0', hueShift: 0,
      audioReact: 1.0, audioSmoothing: 0.08, speed: 1.0, intensity: 1.0, scale: 1.0,
    };

    this._shaderName  = 'plasma';
    this._customGLSL  = null;
    this._time        = 0;
    this._audioSmooth  = 0;
    this._bassSmooth   = 0;
    this._midSmooth    = 0;
    this._trebleSmooth = 0;
    this._volumeSmooth = 0;
    this._beatPulse    = 0;
    this._audioData    = null;

    this._threeRenderer = null;
    this._threeScene    = null;
    this._threeCamera   = null;
    this._threeMesh     = null;
    this._offCanvas     = null;
    this._W = 0; this._H = 0;
    this._gpuDirty = true;
  }

  init(params = {}) {
    if (params.shaderName) this._shaderName = params.shaderName;
    if (params.glsl) { this._customGLSL = params.glsl; this._shaderName = 'custom'; }
    this.name = params.name || `Shader — ${this._shaderName}`;
    Object.keys(this.params).forEach(k => { if (params[k] !== undefined) this.params[k] = params[k]; });
    this._gpuDirty = true;
  }

  loadGLSL(src) {
    this._customGLSL = src;
    this._shaderName = 'custom';
    this.name        = 'Custom Shader';
    this._gpuDirty   = true;
    if (typeof Toast !== 'undefined') Toast.success('Shader compiled');
  }

  get glslSource() { return this._customGLSL || ShaderLayer.BUILTINS[this._shaderName] || ''; }
  get isCustom()   { return this._shaderName === 'custom'; }

  _ensureGPU(W, H) {
    const resized = W !== this._W || H !== this._H;

    if (!this._offCanvas) {
      this._offCanvas        = document.createElement('canvas');
      this._offCanvas.width  = W;
      this._offCanvas.height = H;
      this._threeRenderer = new THREE.WebGLRenderer({
        canvas: this._offCanvas, antialias: false,
        alpha: true, premultipliedAlpha: false,
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
      if (this._threeMesh?.material?.uniforms?.iResolution) {
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

    const fragSrc = _buildFragSrc(this.glslSource);

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
          iParam1:     { value: 0.5 },
          iParam2:     { value: 0.5 },
          iParam3:     { value: 0.5 },
          iColorA:     { value: new THREE.Color(0x00d4aa) },
          iColorB:     { value: new THREE.Color(0x7c3ff0) },
          iHueShift:   { value: 0 },
          iSpeed:      { value: 1 },
          iIntensity:  { value: 1 },
          iScale:      { value: 1 },
        },
        vertexShader:   'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.);}',
        fragmentShader: fragSrc,
        depthWrite: false,
        depthTest:  false,
      });
    } catch (e) {
      console.warn('ShaderLayer: material build error', e);
      material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    }

    const geo = new THREE.PlaneGeometry(2, 2);
    this._threeMesh = new THREE.Mesh(geo, material);
    this._threeScene.add(this._threeMesh);
  }

  update(audioData, videoData, dt) {
    this._time += dt * (this.params.speed ?? 1);
    this._audioData = audioData;
    const react = this.params.audioReact ?? 1.0;
    // audioSmoothing: 0.01=very smooth/slow, 1.0=instant/raw
    // Default 0.08 gives gentle smoothing — user can go lower for buttery or higher for snappy
    const lag = Math.max(0.01, Math.min(1.0, this.params.audioSmoothing ?? 0.08));
    const active = audioData?.isActive;
    this._bassSmooth   = VaelMath.lerp(this._bassSmooth,   active ? (audioData.bass   ?? 0) * react : 0, lag);
    this._midSmooth    = VaelMath.lerp(this._midSmooth,    active ? (audioData.mid    ?? 0) * react : 0, lag);
    this._trebleSmooth = VaelMath.lerp(this._trebleSmooth, active ? (audioData.treble ?? 0) * react : 0, lag);
    this._volumeSmooth = VaelMath.lerp(this._volumeSmooth, active ? (audioData.volume ?? 0) * react : 0, lag);
    this._audioSmooth  = this._bassSmooth; // keep compat
    if (audioData?.isBeat) this._beatPulse = react > 0 ? 1.0 : 0;
    this._beatPulse = Math.max(0, this._beatPulse - dt * 6);
  }

  render(ctx, width, height) {
    this._ensureGPU(width, height);
    if (!this._threeMesh?.material?.uniforms) return;

    const u  = this._threeMesh.material.uniforms;
    const ad = this._audioData;

    u.iTime.value      = this._time;
    u.iResolution.value.set(width, height);

    // Always use pre-smoothed values — eliminates per-frame spikes that cause jerkiness
    u.iBass.value      = this._bassSmooth;
    u.iMid.value       = this._midSmooth;
    u.iTreble.value    = this._trebleSmooth;
    u.iVolume.value    = this._volumeSmooth;
    u.iBeat.value      = this._beatPulse;
    u.iBpm.value       = ad?.bpm ?? 120;
    u.iMouseX.value    = this.uniforms?.iMouseX ?? 0.5;
    u.iMouseY.value    = this.uniforms?.iMouseY ?? 0.5;

    u.iParam1.value    = this.params.param1   ?? 0.5;
    u.iParam2.value    = this.params.param2   ?? 0.5;
    u.iParam3.value    = this.params.param3   ?? 0.5;
    if (this.params.colorA) u.iColorA.value.set(this.params.colorA);
    if (this.params.colorB) u.iColorB.value.set(this.params.colorB);
    u.iHueShift.value  = this.params.hueShift  ?? 0;

    u.iSpeed.value     = this.params.speed     ?? 1;
    u.iIntensity.value = this.params.intensity ?? 1;
    u.iScale.value     = this.params.scale     ?? 1;

    this._threeRenderer.render(this._threeScene, this._threeCamera);

    ctx.save();
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

// ── Fragment shader builder ───────────────────────────────────────

function _buildFragSrc(glsl) {
  if (!glsl || !glsl.trim()) {
    return GLSL_HEADER + `
void main() {
  vec2 uv = vUv;
  float v = sin(uv.x * 10. + iTime) * sin(uv.y * 10. + iTime * .7) + iBass;
  gl_FragColor = vec4(v*.5+.5, v*.2+.3, v*.8+.2, 1.);
}`;
  }

  if (glsl.includes('mainImage')) {
    // ShaderToy style — wrap in standard main()
    return GLSL_HEADER + glsl + `
void main() {
  vec2 fragCoord = vUv * iResolution;
  vec4 col = vec4(0.);
  mainImage(col, fragCoord);
  gl_FragColor = col;
}`;
  }

  // Standard void main() — just prepend the header
  return GLSL_HEADER + glsl;
}

// ── Built-in shaders ──────────────────────────────────────────────
// No uniform declarations here — GLSL_HEADER provides them all.

ShaderLayer.BUILTINS = {

  plasma: `
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
float _hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
float _noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(_hash(i),_hash(i+vec2(1,0)),f.x),
             mix(_hash(i+vec2(0,1)),_hash(i+vec2(1,1)),f.x),f.y);
}
void main() {
  float t  = iTime * .4;
  float e  = iIntensity * .15 * (1. + iBass * 1.5 + iBeat * 2.);
  vec2 d   = vec2(_noise(vUv*3.*iScale+vec2(t,0))-.5,
                  _noise(vUv*3.*iScale+vec2(0,t+1.7))-.5)*e;
  vec2 uv  = vUv + d;
  float h  = _noise(uv * 2.) * .5 + iBass * .3;
  gl_FragColor = vec4(h*.2, h*.4+.1, h*.8+.2, .9);
}`,

  bloom: `
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
  gl_FragColor = vec4(rv*glow, gv*glow, bv*glow, glow);
}`,

  chromatic: `
void main() {
  vec2 uv = vUv;
  float off = (.003 + iBeat * .008 + iBass * .003) * iScale;
  float t = iTime * .5;
  float r = sin((uv.x+off)*8.+t) * sin((uv.y+off)*6.+t*.8);
  float g = sin(uv.x*8.+t)       * sin(uv.y*6.+t*.8);
  float b = sin((uv.x-off)*8.+t) * sin((uv.y-off)*6.+t*.8);
  gl_FragColor = vec4(r*.5+.5, g*.5+.5, b*.5+.5, .9);
}`,

  kaleidoscope: `
void main() {
  vec2 uv   = vUv - .5;
  float segments = max(2., floor(iParam1 * 14.) + 2.); // 2-16 segments via param1
  float angle     = atan(uv.y, uv.x);
  float r         = length(uv);
  float segAngle  = 3.14159 * 2. / segments;
  angle = mod(angle, segAngle);
  if (angle > segAngle * .5) angle = segAngle - angle;
  vec2 sym = vec2(cos(angle), sin(angle)) * r;
  sym = sym * iScale + .5;
  float t  = iTime * iSpeed * .3;
  float v  = sin(sym.x * 8. + t) * sin(sym.y * 8. + t * .7)
           + sin((sym.x + sym.y) * 6. + t * 1.3 + iBass * 3.);
  float hue = v * .25 + .5 + iBeat * .08;
  vec3 cA = iColorA, cB = iColorB;
  float blend = v * .5 + .5 + iBass * .15;
  vec3 col = mix(cA, cB, clamp(blend, 0., 1.));
  col *= iIntensity;
  gl_FragColor = vec4(col, 1.);
}`,

  tunnel: `
void main() {
  vec2 uv = vUv - .5;
  float t  = iTime * iSpeed * .4;
  float a  = atan(uv.y, uv.x);
  float r  = length(uv);
  // Map to tunnel coordinates: z goes forward with time
  vec2 tuv = vec2(a / 3.14159, .15 / r + t);
  tuv *= iScale;
  float bri = sin(tuv.x * 6. + t) * .5 + .5;
  float dep = sin(tuv.y * 4.)      * .5 + .5;
  float pulse = 1. + iBass * .3 + iBeat * .15;
  bri *= dep * pulse;
  // Colour from iColorA/B blended by angle
  float blend = a / 3.14159 * .5 + .5;
  vec3 col = mix(iColorA, iColorB, blend) * bri * iIntensity;
  // Vignette at the mouth
  col *= smoothstep(.5, .1, r);
  gl_FragColor = vec4(col, 1.);
}`,

  voronoi: `
vec2 _hash2(vec2 p) {
  p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
  return fract(sin(p)*43758.5453);
}
void main() {
  vec2 uv   = (vUv - .5) * iScale * 4. + .5;
  float t   = iTime * iSpeed * .15;
  float minD = 1e9, minD2 = 1e9;
  vec2  minP;
  vec2  cell = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 nb = cell + vec2(x, y);
      vec2 pt = nb + _hash2(nb + floor(t));
      // Animate: cells drift with time and audio
      pt += .45 * sin(6.28 * _hash2(nb) + t + iBass * 2.);
      float d = length(uv - pt);
      if (d < minD) { minD2 = minD; minD = d; minP = pt; }
      else if (d < minD2) { minD2 = d; }
    }
  }
  // Edge = distance difference between nearest two cells
  float edge  = minD2 - minD;
  float glow  = exp(-edge * 12.) * (1. + iBeat * .5);
  float cells = smoothstep(.45, .5, minD);
  // Colour: cell interior from iColorA, edges from iColorB
  vec3 col = mix(iColorA * (1. - cells * .6), iColorB, glow);
  col *= iIntensity;
  gl_FragColor = vec4(col, 1.);
}`,

  // Reaction-diffusion (Gray-Scott) — GPU ping-pong approximation via noise
  // True R-D needs framebuffer ping-pong; this is a convincing one-pass fake
  // using layered noise to mimic the characteristic spotted/striped patterns.
  turing: `
float _hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5); }
float _n(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(_hash(i),_hash(i+vec2(1,0)),f.x),
             mix(_hash(i+vec2(0,1)),_hash(i+vec2(1,1)),f.x),f.y);
}
void main() {
  vec2 uv  = vUv * iScale * 3.;
  float t  = iTime * iSpeed * .08;
  float f  = iParam1 * 0.06 + 0.01;   // feed rate proxy — controls spot/stripe balance
  // Multi-scale noise layers to mimic activator–inhibitor separation
  float a1 = _n(uv * 2.  + vec2(t, 0.));
  float a2 = _n(uv * 5.  + vec2(0., t * 1.3));
  float a3 = _n(uv * 12. + vec2(t * .7, t * .5));
  // Activator: sharp threshold on combined layers
  float activator = smoothstep(.45 + f, .55 + f, a1 * .5 + a2 * .3 + a3 * .2);
  activator = mix(activator, 1. - activator, step(.5, _n(uv * .3 + t * .05)));
  // Audio drives the threshold, making patterns shift on beats
  activator = smoothstep(.0, 1., activator + iBass * .2 + iBeat * .1);
  vec3 col = mix(iColorA, iColorB, activator) * iIntensity;
  gl_FragColor = vec4(col, 1.);
}`,

};
