// iParam1 — grid density (number of dots), default ~0.5
// iParam2 — animation speed, default ~0.5
// iParam3 — connection distance threshold, default ~0.5

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hueRotate(vec3 col, float angle) {
    float c = cos(angle), s = sin(angle);
    mat3 m = mat3(
        0.299+0.701*c+0.168*s, 0.587-0.587*c+0.330*s, 0.114-0.114*c-0.497*s,
        0.299-0.299*c-0.328*s, 0.587+0.413*c+0.035*s, 0.114-0.114*c+0.292*s,
        0.299-0.300*c+1.250*s, 0.587-0.588*c-1.050*s, 0.114+0.886*c-0.203*s
    );
    return clamp(m * col, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // Map iParam1 (0–1) to grid scale: 4 to 16 dots across
    float scale = 4.0 + iParam1 * 12.0;

    // Map iParam2 (0–1) to speed: nearly still to fast
    float speed = iParam2 * 0.8;

    // Map iParam3 (0–1) to connection distance: 0.2 to 0.7
    float minDist = 0.2 + iParam3 * 0.5;

    // Bass expands the dots, beat flashes brightness
    float audioPulse = 1.0 + iBass * 1.5 + iBeat * 0.5;
    float audioSpeed = 1.0 + iMid * 2.0;

    float time = iTime * speed * audioSpeed;

    vec2 gv = fract(uv * scale) - 0.5;
    vec2 id = floor(uv * scale);

    vec2 p[9];
    int i = 0;
    for (float y = -1.0; y <= 1.0; y++) {
        for (float x = -1.0; x <= 1.0; x++) {
            vec2 offs = vec2(x, y);
            vec2 n = hash22(id + offs);
            p[i++] = offs + sin(n * 6.28318 + time) * 0.4;
        }
    }

    vec3 color = vec3(0.0);
    float lineThick = 0.008 + iBass * 0.006;

    for (int i = 0; i < 9; i++) {
        // Dot glow — size pulses with audio
        float d = length(gv - p[i]);
        float dotGlow = 0.002 * audioPulse / max(d, 0.001);
        color += dotGlow * iColorA;

        for (int j = i + 1; j < 9; j++) {
            vec2 a = p[i];
            vec2 b = p[j];
            vec2 pa = gv - a;
            vec2 ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            float distLine = length(pa - ba * h);

            float d2 = length(a - b);
            if (d2 < minDist) {
                float fade = smoothstep(minDist, 0.0, d2);
                float lineGlow = (lineThick / max(distLine, 0.001)) * fade * 0.2;
                // Lines fade between iColorA (close) and iColorB (far)
                vec3 lineCol = mix(iColorA, iColorB, fade);
                color += lineGlow * lineCol;
            }
        }
    }

    // Treble adds a brightness shimmer
    color *= 1.0 + iTreble * 0.4;

    // Apply hue shift
    color = hueRotate(color, iHueShift * 3.14159 / 180.0);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}