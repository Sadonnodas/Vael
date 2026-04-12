/**
 * engine/PostFX.js
 * Post-processing effect passes for the WebGL Renderer.
 * Each pass is a full-screen GLSL shader applied after all layers composite.
 */

const PostFX = (() => {

  const SHADERS = {

    // ── Bloom ──────────────────────────────────────────────────
    bloom: {
      name: 'bloom',
      uniforms: { intensity: { value: 0.6 }, threshold: { value: 0.35 }, radius: { value: 0.8 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 iResolution;
        uniform float iBass;
        uniform float intensity;
        uniform float threshold;
        uniform float radius;
        varying vec2 vUv;
        float luminance(vec3 c) { return dot(c, vec3(0.2126,0.7152,0.0722)); }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 bloom = vec3(0.0); float total = 0.0;
          float r = radius * (1.0 + iBass * 0.5);
          for (int x = -4; x <= 4; x++) {
            for (int y = -4; y <= 4; y++) {
              vec2 off = vec2(float(x), float(y)) * r / iResolution;
              vec4 s = texture2D(tDiffuse, vUv + off);
              if (luminance(s.rgb) > threshold) {
                float w = 1.0 / (1.0 + float(x*x + y*y));
                bloom += s.rgb * w; total += w;
              }
            }
          }
          if (total > 0.0) bloom /= total;
          gl_FragColor = vec4(base.rgb + bloom * intensity * (1.0 + iBass * 0.4), base.a);
        }`,
    },

    // ── Chromatic aberration ────────────────────────────────────
    chromatic: {
      name: 'chromatic',
      uniforms: { amount: { value: 0.003 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float iBass;
        uniform float iBeat;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          float offset = amount + iBeat * 0.008 + iBass * 0.002;
          vec2 dir = normalize(vUv - 0.5);
          float dist = length(vUv - 0.5);
          float r = texture2D(tDiffuse, vUv + dir * dist * offset).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - dir * dist * offset).b;
          gl_FragColor = vec4(r, g, b, texture2D(tDiffuse, vUv).a);
        }`,
    },

    // ── Liquid distortion ───────────────────────────────────────
    distort: {
      name: 'distort',
      uniforms: { strength: { value: 0.015 }, speed: { value: 0.4 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float iTime;
        uniform float iBass;
        uniform float iBeat;
        uniform float strength;
        uniform float speed;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
        }
        void main() {
          float t = iTime * speed;
          float eff = strength * (1.0 + iBass * 1.5 + iBeat * 2.0);
          vec2 d = vec2(noise(vUv*3.0+vec2(t,0))-0.5, noise(vUv*3.0+vec2(0,t+1.7))-0.5) * eff;
          gl_FragColor = texture2D(tDiffuse, vUv + d);
        }`,
    },

    // ── Vignette ────────────────────────────────────────────────
    vignette: {
      name: 'vignette',
      uniforms: { darkness: { value: 0.5 }, offset: { value: 0.5 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float v = smoothstep(offset, offset - darkness, length(vUv - 0.5));
          gl_FragColor = vec4(color.rgb * v, color.a);
        }`,
    },

    // ── Film grain ──────────────────────────────────────────────
    grain: {
      name: 'grain',
      uniforms: { amount: { value: 0.04 }, animated: { value: 1.0 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float iTime;
        uniform float iBass;
        uniform float amount;
        uniform float animated;
        varying vec2 vUv;
        float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float t = animated > 0.5 ? iTime : 0.0;
          float n = rand(vUv + fract(t)) * 2.0 - 1.0;
          gl_FragColor = vec4(color.rgb + n * amount * (1.0 + iBass * 0.3), color.a);
        }`,
    },

    // ── Feedback loop ───────────────────────────────────────────
    feedback: {
      name: 'feedback',
      uniforms: {
        amount:   { value: 0.85 },   // 0 = no trail, 1 = infinite trail
        zoom:     { value: 1.002 },  // slight zoom each frame (creates expansion)
        rotation: { value: 0.001 },  // slight rotation each frame (radians)
        hueShift: { value: 0.002 },  // colour shift per frame
        decay:    { value: 0.97 },   // brightness decay
      },
      // Requires tFeedback uniform (previous frame texture) set by Renderer
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tFeedback;
        uniform vec2  iResolution;
        uniform float iTime;
        uniform float iBass;
        uniform float iBeat;
        uniform float amount;
        uniform float zoom;
        uniform float rotation;
        uniform float hueShift;
        uniform float decay;
        varying vec2 vUv;

        vec3 hueRotate(vec3 c, float angle) {
          float cosA = cos(angle), sinA = sin(angle);
          vec3 k = vec3(0.577350);
          return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
        }

        void main() {
          // Transform UV for zoom + rotation feedback
          vec2 center = vec2(0.5);
          vec2 uv = vUv - center;

          // Audio-driven intensity
          float beatBoost = iBeat * 0.003;
          float audioZoom = zoom + iBass * 0.001 + beatBoost;
          float audioRot  = rotation + iBass * 0.0005;

          // Apply rotation
          float s = sin(audioRot), c = cos(audioRot);
          uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

          // Apply zoom
          uv /= audioZoom;
          uv += center;

          // Sample previous frame
          vec4 prev = texture2D(tFeedback, uv);

          // Hue-shift the feedback
          vec3 shifted = hueRotate(prev.rgb, hueShift + iBass * 0.01);
          vec4 feed = vec4(shifted * decay, prev.a * decay);

          // Blend current frame over feedback
          vec4 curr = texture2D(tDiffuse, vUv);
          gl_FragColor = mix(feed, curr, 1.0 - amount + curr.a * (1.0 - amount));
          gl_FragColor.a = 1.0;
        }`,
      // Flag so Renderer knows to provide tFeedback
      needsFeedback: true,
    },

    // ── Subtract blend ──────────────────────────────────────────
    subtract: {
      name: 'subtract',
      uniforms: { amount: { value: 0.5 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tPrev;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          vec4 curr = texture2D(tDiffuse, vUv);
          vec4 prev = texture2D(tPrev, vUv);
          gl_FragColor = vec4(max(vec3(0.0), curr.rgb - prev.rgb * amount), curr.a);
        }`,
    },

    // ── Difference ──────────────────────────────────────────────
    difference: {
      name: 'difference',
      uniforms: { amount: { value: 1.0 }, threshold: { value: 0.05 } },
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float iTime;
        uniform float iBass;
        uniform float amount;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          vec4 a = texture2D(tDiffuse, vUv);
          vec2 off = vec2(sin(iTime*0.3)*0.01, cos(iTime*0.2)*0.01) * (1.0 + iBass);
          vec4 b = texture2D(tDiffuse, clamp(vUv + off, 0.0, 1.0));
          vec3 diff = abs(a.rgb - b.rgb) * amount;
          diff = mix(a.rgb, diff, step(threshold, length(diff)));
          gl_FragColor = vec4(diff, a.a);
        }`,
    },

  };

  // ── Renderer integration: feedback buffer ────────────────────
  // The Renderer checks pass.needsFeedback and manages the ping-pong buffer.

  // ── Public API ───────────────────────────────────────────────

  const _active = new Map();

  function add(renderer, name, overrides = {}) {
    const def = SHADERS[name];
    if (!def) { console.warn(`PostFX: unknown effect "${name}"`); return; }
    const uniforms = {};
    Object.entries(def.uniforms).forEach(([key, val]) => {
      uniforms[key] = { value: overrides[key] ?? val.value };
    });
    const pass = { name: def.name, uniforms, fragmentShader: def.fragmentShader,
                   needsFeedback: def.needsFeedback || false };
    _active.set(name, pass);
    renderer.addPostPass(pass);
  }

  function remove(renderer, name) {
    _active.delete(name);
    renderer.removePostPass(name);
  }

  function update(name, values) {
    const pass = _active.get(name);
    if (!pass) return;
    Object.entries(values).forEach(([k, v]) => { if (pass.uniforms[k]) pass.uniforms[k].value = v; });
  }

  function has(name)  { return _active.has(name); }
  function list()     { return Array.from(_active.keys()); }

  /** Return current uniform values for a named effect, or null if not active. */
  function getValues(name) {
    const pass = _active.get(name);
    if (!pass) return null;
    const out = {};
    Object.entries(pass.uniforms).forEach(([k, u]) => { out[k] = u.value; });
    return out;
  }

  /**
   * Reorder active passes to match the given names array.
   * Names not currently active are ignored.
   */
  function reorder(renderer, names) {
    const current = Array.from(_active.entries());
    const newOrder = names
      .map(n => current.find(([k]) => k === n))
      .filter(Boolean);
    // Add any active passes not mentioned (safety)
    current.forEach(entry => { if (!newOrder.find(([k]) => k === entry[0])) newOrder.push(entry); });

    _active.clear();
    newOrder.forEach(([k, v]) => _active.set(k, v));

    // Rebuild renderer pass list in new order
    renderer._postPasses = newOrder.map(([, v]) => v);
    renderer._buildPostMeshes?.();
  }

  return { add, remove, update, has, list, reorder, getValues, SHADERS };

})();