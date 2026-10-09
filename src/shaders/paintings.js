/**
 * Famous paintings, written in GLSL (zero image assets)
 *
 * Every picture frame in the corridor is a shader, not a bitmap: the whole
 * canvas is generated per-pixel on the GPU, so the paintings stay crisp when
 * the visitor clicks one and the camera flies right up to it.
 *
 * Five canvases ship today:
 *   sunflowers    Vincent van Gogh — Vase with Fifteen Sunflowers (1888)
 *   starryNight   Vincent van Gogh — The Starry Night (1889)
 *   greatWave     Katsushika Hokusai — The Great Wave off Kanagawa (c.1831)
 *   waterLilies   Claude Monet — Water Lilies (Nymphéas, c.1916)
 *   whileTrue     the corridor's own doodle — an inked infinity loop
 *
 * Technique: a shared noise / domain-warp toolbox plus an anisotropic
 * "impasto" stroke function, so the surfaces carry directional brush marks
 * the way oil paint does instead of looking like flat gradients.
 *
 * Colors are authored as direct sRGB values and written straight to
 * gl_FragColor, matching the convention used by shaders/entranceTextures.js
 * and the unlit meshBasicMaterial hex colors elsewhere in the scene.
 *
 * NOTE: never put a backtick inside these template literals.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Shared vertex stage                                                  */
/* ------------------------------------------------------------------ */

export const PAINTING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Shared fragment toolbox                                              */
/* ------------------------------------------------------------------ */

const COMMON = /* glsl */ `
const float PI = 3.14159265359;

mat2 rot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise2(p);
        p = rot2(0.6) * p * 2.03;
        a *= 0.5;
    }
    return v;
}

/** Lower-frequency fbm, for big soft fields. */
float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * noise2(p);
        p = rot2(0.7) * p * 2.07;
        a *= 0.5;
    }
    return v;
}

/**
 * Anisotropic brush noise: the noise is squashed along the 'ang' axis, so the result
 * reads as long directional brush strokes rather than blobs.
 */
float strokes(vec2 p, float ang, float aniso, float scale) {
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x))) * scale;
    q.y *= aniso;
    return fbm(q);
}

/** Single swirl: rotate a point around c by an amount that falls off with radius. */
vec2 vortex(vec2 p, vec2 c, float strength) {
    vec2 d = p - c;
    float r = length(d);
    float a = atan(d.y, d.x) + strength / (r + 0.28);
    return c + vec2(cos(a), sin(a)) * r;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/** Radial glow with concentric rings - reads as a star with a halo. */
float starGlow(vec2 q, vec2 c, float core, float halo, float rings) {
    float d = length(q - c);
    float g = exp(-d / halo) * 0.75 + smoothstep(core, 0.0, d);
    g += 0.28 * sin(d * rings) * exp(-d / (halo * 0.8));
    return g;
}

/** A tapering brush mark from a to b. */
float brushMark(vec2 p, vec2 a, vec2 b, float w0, float w1) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float d = length(pa - ba * h);
    return smoothstep((w0 + (w1 - w0) * h) * 0.5, 0.0, d);
}
`;

/* ------------------------------------------------------------------ */
/* Van Gogh — Sunflowers                                                */
/* ------------------------------------------------------------------ */

const SUNFLOWERS_BODY = /* glsl */ `
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;

/**
 * One sunflower: two rings of petals plus a seed head whose dots spiral
 * outwards, exactly the way Van Gogh painted them.
 *
 * q is aspect-corrected (see main), so the flower stays round no matter how
 * wide the frame makes the canvas.
 */
vec4 flower(vec2 q, vec2 c, float r, float seed) {
    vec2 p = (q - c) / r;
    float d = length(p);
    float a = atan(p.y, p.x);

    float petal = 0.0;
    float rim = 0.0;

    for (int ring = 0; ring < 2; ring++) {
        float fr = float(ring);
        float n = 13.0 + fr * 6.0;
        float rr = 0.62 + fr * 0.32;
        float lobe = pow(0.5 + 0.5 * cos(a * n + seed * 3.1 + fr * 1.9), 0.5);
        float pr = rr + 0.28 * lobe;
        float w = 0.15 + 0.06 * fr;
        float m = smoothstep(w, -w * 0.35, d - pr);
        petal = max(petal, m);
        rim = max(rim, smoothstep(w * 2.6, w * 1.1, abs(d - pr)) * m);
    }

    float head = smoothstep(0.33, 0.29, d);
    float spiral = 0.5 + 0.5 * sin(a * 17.0 + d * 64.0 + seed * 5.0);
    spiral = smoothstep(0.30, 0.80, spiral);

    float shade = 0.5 + 0.5 * sin(a * 8.0 + seed * 2.0);
    vec3 petalCol = mix(vec3(0.94, 0.62, 0.06), vec3(1.00, 0.87, 0.31), shade);
    petalCol *= 0.82 + 0.30 * (1.0 - d * 0.55);
    vec3 headCol = mix(vec3(0.30, 0.14, 0.04), vec3(0.66, 0.38, 0.11), spiral);

    vec3 col = mix(petalCol, headCol, head);
    float alpha = max(petal, head);
    col = mix(col, vec3(0.22, 0.11, 0.02), rim * 0.5 * (1.0 - head));
    return vec4(col, alpha);
}

void main() {
    vec2 uv = vUv;
    // The FRAME decides the canvas aspect (CorridorDecorations sizes the
    // painting to the frame's mount opening), so compose in aspect-corrected
    // coordinates: q.x spans [0, uAspect], q.y spans [0, 1]. Flowers, vase and
    // brush marks are all placed in q, so a wider frame adds bouquet either
    // side instead of stretching the one Van Gogh painted.
    float A = uAspect;
    vec2 q = vec2(uv.x * A, uv.y);

    // ---- ochre wall, painted in vertical impasto ----------------------
    float s1 = strokes(q, 1.38, 6.0, 20.0);
    float s2 = strokes(q, 1.62, 9.0, 44.0);
    vec3 col = mix(vec3(0.80, 0.56, 0.13), vec3(0.98, 0.86, 0.40), s1 * 0.95 + 0.05);
    col += (s2 - 0.5) * 0.17;
    // glow behind the bouquet
    col += vec3(0.12, 0.09, 0.01) * exp(-length((q - vec2(0.5 * A, 0.66)) * vec2(1.05, 1.25)) * 2.2);

    // ---- table ---------------------------------------------------------
    float table = smoothstep(0.17, 0.155, q.y);
    col = mix(col, mix(vec3(0.72, 0.47, 0.15), vec3(0.90, 0.70, 0.33), fbm(q * 9.0)), table * 0.85);

    // ---- leaves behind the flowers ------------------------------------
    col = mix(col, vec3(0.24, 0.32, 0.09),
        brushMark(q, vec2(0.30 * A, 0.40), vec2(0.10 * A, 0.62), 0.10, 0.03) * 0.85);
    col = mix(col, vec3(0.30, 0.40, 0.12),
        brushMark(q, vec2(0.70 * A, 0.40), vec2(0.90 * A, 0.62), 0.10, 0.03) * 0.85);
    col = mix(col, vec3(0.20, 0.29, 0.08),
        brushMark(q, vec2(0.50 * A, 0.36), vec2(0.42 * A, 0.58), 0.09, 0.03) * 0.8);
    col = mix(col, vec3(0.26, 0.34, 0.10),
        brushMark(q, vec2(0.06 * A, 0.44), vec2(0.16 * A, 0.58), 0.08, 0.03) * 0.8);
    col = mix(col, vec3(0.26, 0.34, 0.10),
        brushMark(q, vec2(0.94 * A, 0.44), vec2(0.84 * A, 0.58), 0.08, 0.03) * 0.8);

    // ---- vase ----------------------------------------------------------
    vec2 vp = q - vec2(0.50 * A, 0.175);
    float vd = sdRoundBox(vp, vec2(0.170, 0.105), 0.065);
    float vase = smoothstep(0.006, -0.006, vd);
    vec3 vaseCol = mix(vec3(0.70, 0.43, 0.13), vec3(0.92, 0.71, 0.34),
        0.5 + 0.5 * sin(vp.x * 34.0 + vp.y * 8.0));
    col = mix(col, vaseCol, vase);
    col = mix(col, vec3(0.25, 0.13, 0.03), smoothstep(0.010, 0.0, abs(vd)) * 0.85);

    // ---- bouquet -------------------------------------------------------
    // Twelve heads rather than the original eight: the square canvas had no
    // room for the two outer pairs, the wide one does.
    vec4 f;
    f = flower(q, vec2(0.50 * A, 0.44), 0.155, 0.4); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.50 * A, 0.63), 0.250, 5.0); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.28 * A, 0.70), 0.185, 1.7); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.72 * A, 0.69), 0.178, 3.1); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.13 * A, 0.52), 0.140, 6.4); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.87 * A, 0.50), 0.136, 7.9); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.37 * A, 0.84), 0.150, 9.2); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.64 * A, 0.85), 0.146, 11.5); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.08 * A, 0.66), 0.118, 13.1); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.92 * A, 0.68), 0.114, 14.6); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.20 * A, 0.36), 0.108, 16.2); col = mix(col, f.rgb, f.a);
    f = flower(q, vec2(0.80 * A, 0.35), 0.104, 17.8); col = mix(col, f.rgb, f.a);

    // ---- final impasto -------------------------------------------------
    col += (strokes(q, 1.15, 5.0, 30.0) - 0.5) * 0.13;
    col *= 0.96 + 0.08 * strokes(q, 0.45, 8.0, 66.0);
    // a whisper of life so the painting is not frozen
    col += 0.012 * sin(uTime * 0.6 + q.y * 9.0);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Van Gogh — The Starry Night                                          */
/* ------------------------------------------------------------------ */

const STARRY_NIGHT_BODY = /* glsl */ `
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;

/**
 * A little village house with a pitched roof.
 * Returns (body, lit window) as a vec2 of masks.
 */
vec2 house(vec2 p, float cx, float ground, float w, float h) {
    vec2 q = p - vec2(cx, ground);
    float body = step(abs(q.x), w) * step(0.0, q.y) * step(q.y, h);
    float k = 1.0 - clamp((q.y - h) / (h * 0.42), 0.0, 1.0);
    float roof = step(abs(q.x), w * k) * step(h, q.y) * step(q.y, h * 1.42);
    vec2 wp = q - vec2(0.0, h * 0.45);
    float win = step(abs(wp.x), w * 0.26) * step(abs(wp.y), h * 0.17);
    return vec2(max(body, roof), win);
}

void main() {
    vec2 uv = vUv;
    vec2 q = vec2(uv.x * uAspect, uv.y);
    float A = uAspect;

    // ---- swirling sky --------------------------------------------------
    vec2 c1 = vec2(0.63 * A, 0.78);
    vec2 c2 = vec2(0.27 * A, 0.58);
    vec2 w1 = vortex(q, c1, 2.10 + 0.12 * sin(uTime * 0.25));
    vec2 w2 = vortex(q, c2, -1.70);

    float bandA = fbm(w1 * 6.5);
    float bandB = fbm(w2 * 6.5);
    float band = bandA * 0.55 + bandB * 0.45;
    float ripple = fbm3(q * 3.1 + band * 2.4);

    vec3 deep = vec3(0.05, 0.09, 0.32);
    vec3 mid = vec3(0.14, 0.26, 0.58);
    vec3 light = vec3(0.58, 0.70, 0.90);

    vec3 col = mix(deep, mid, smoothstep(0.22, 0.74, band));
    col = mix(col, light, smoothstep(0.60, 0.94, ripple) * 0.80);

    float ribbon = smoothstep(0.42, 0.90, band) * (0.35 + 0.65 * smoothstep(0.40, 0.85, ripple));
    col += vec3(0.30, 0.38, 0.50) * ribbon * 0.75;
    col -= vec3(0.03, 0.05, 0.10) * smoothstep(0.55, 0.15, band);

    // ---- moon ----------------------------------------------------------
    vec2 m = q - vec2(0.855 * A, 0.82);
    float md = length(m);
    float crescent = smoothstep(0.075, 0.055, md) * (1.0 - smoothstep(0.030, 0.052, length(m - vec2(0.042, 0.022))));
    col += vec3(1.00, 0.84, 0.30) * exp(-md * 5.0) * 0.65;
    col = mix(col, vec3(1.00, 0.90, 0.45), crescent);

    // ---- eleven stars, each with Van Gogh's rings ----------------------
    float st = 0.0;
    st += starGlow(q, vec2(0.20 * A, 0.90), 0.022, 0.075, 90.0);
    st += starGlow(q, vec2(0.35 * A, 0.80), 0.026, 0.085, 82.0);
    st += starGlow(q, vec2(0.14 * A, 0.68), 0.018, 0.060, 96.0);
    st += starGlow(q, vec2(0.48 * A, 0.94), 0.020, 0.070, 88.0);
    st += starGlow(q, vec2(0.72 * A, 0.92), 0.024, 0.080, 84.0);
    st += starGlow(q, vec2(0.92 * A, 0.62), 0.020, 0.068, 90.0);
    st += starGlow(q, vec2(0.55 * A, 0.64), 0.017, 0.055, 100.0);
    st += starGlow(q, vec2(0.31 * A, 0.46), 0.015, 0.050, 104.0);
    st += starGlow(q, vec2(0.68 * A, 0.50), 0.016, 0.052, 98.0);
    st += starGlow(q, vec2(0.44 * A, 0.37), 0.013, 0.044, 110.0);
    st += starGlow(q, vec2(0.86 * A, 0.35), 0.014, 0.046, 106.0);
    col += vec3(1.00, 0.88, 0.42) * clamp(st, 0.0, 1.6) * 0.55;

    // ---- rolling hills behind the village ------------------------------
    float hill = 0.235 + 0.026 * sin(q.x * 1.9 + 0.7) + 0.020 * fbm3(q * vec2(2.4, 5.0));
    col = mix(col, vec3(0.07, 0.11, 0.22),
        smoothstep(hill + 0.008, hill - 0.008, q.y));

    // ---- village -------------------------------------------------------
    float ground = 0.215;
    float body = 0.0;
    float win = 0.0;
    vec2 hv;
    hv = house(q, 0.30 * A, ground, 0.019, 0.040); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.35 * A, ground, 0.024, 0.055); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.41 * A, ground, 0.017, 0.036); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.46 * A, ground, 0.026, 0.062); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.62 * A, ground, 0.021, 0.046); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.68 * A, ground, 0.028, 0.068); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.76 * A, ground, 0.019, 0.042); body = max(body, hv.x); win = max(win, hv.y);
    hv = house(q, 0.84 * A, ground, 0.023, 0.050); body = max(body, hv.x); win = max(win, hv.y);
    col = mix(col, vec3(0.05, 0.08, 0.17), body * 0.96);
    col = mix(col, vec3(1.00, 0.79, 0.30), win * body * 0.95);

    // the church: a nave plus a tall spire
    vec2 sp = q - vec2(0.555 * A, ground);
    float nave = step(abs(sp.x), 0.030) * step(0.0, sp.y) * step(sp.y, 0.042);
    float spire = step(abs(sp.x), 0.020 * (1.0 - clamp((sp.y - 0.042) / 0.075, 0.0, 1.0)))
        * step(0.042, sp.y) * step(sp.y, 0.117);
    col = mix(col, vec3(0.05, 0.08, 0.17), max(nave, spire) * 0.96);

    // ---- cypress: a dark flame leaning out of the village --------------
    vec2 cp = q - vec2(0.088 * A, 0.30);
    float cy = clamp((cp.y + 0.30) / 0.78, 0.0, 1.0);
    float halfW = 0.030 + 0.085 * (1.0 - cy * cy);
    float lean = 0.030 * sin(cy * 3.4 + 0.6);
    float flame = smoothstep(1.0, 0.35, abs(cp.x - lean) / max(halfW, 0.001));
    flame *= step(0.0, cy) * step(cy, 1.0);
    // scalloped edges, like Van Gogh's licks of flame
    flame *= 0.30 + 1.05 * fbm(q * vec2(15.0, 10.0));
    col = mix(col, mix(vec3(0.025, 0.070, 0.040), vec3(0.09, 0.17, 0.09), fbm(q * 18.0)),
        smoothstep(0.30, 0.85, flame));

    // ---- impasto -------------------------------------------------------
    col += (strokes(uv, 0.95, 5.0, 26.0) - 0.5) * 0.11;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Hokusai — The Great Wave off Kanagawa                                */
/* ------------------------------------------------------------------ */

const GREAT_WAVE_BODY = /* glsl */ `
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;

/**
 * The water line. The face is concave: it creeps along the bottom, steepens
 * as it climbs, rounds over at the crest, then drops almost vertically into
 * the trough on the right where Fuji and the boats ride.
 */
float seaTop(float x) {
    float t = clamp((x + 0.10) / 0.62, 0.0, 1.0);
    float h = 0.150 + 0.540 * (0.40 * pow(t, 0.85) + 0.60 * pow(t, 2.7));
    h -= 0.048 * smoothstep(0.44, 0.62, x);
    h -= 0.540 * smoothstep(0.56, 0.72, x);
    return h + 0.012 * sin(x * 19.0) + 0.007 * sin(x * 43.0 + 1.7);
}

void main() {
    vec2 uv = vUv;

    // ---- sky -----------------------------------------------------------
    vec3 sky = mix(vec3(0.958, 0.930, 0.852), vec3(0.790, 0.838, 0.858),
        smoothstep(0.30, 1.00, uv.y));
    sky += (fbm3(uv * vec2(5.0, 3.0)) - 0.5) * 0.042;
    vec3 col = sky;

    // ---- Mount Fuji, small, standing in the trough ---------------------
    vec2 fp = uv - vec2(0.880, 0.140);
    float fuji = smoothstep(0.100, 0.076, abs(fp.x) + fp.y * 0.80) * step(0.0, fp.y);
    vec3 fujiCol = mix(vec3(0.34, 0.42, 0.58), vec3(0.975, 0.975, 0.965),
        smoothstep(0.026, 0.074, fp.y + abs(fp.x) * 0.55));
    col = mix(col, fujiCol, fuji * 0.95);

    // ---- the sea -------------------------------------------------------
    float top = seaTop(uv.x);
    float below = top - uv.y;
    float sea = smoothstep(-0.005, 0.005, below);

    vec3 deepSea = vec3(0.028, 0.095, 0.250);
    vec3 midSea  = vec3(0.115, 0.290, 0.520);
    float climb = clamp(1.0 - below / 0.58, 0.0, 1.0);
    vec3 seaCol = mix(deepSea, midSea, pow(climb, 0.90));

    // woodblock contour lines that follow the face
    float follow = sin(below * 26.0 + uv.x * 1.5 + fbm3(uv * 3.0) * 4.5);
    seaCol += vec3(0.065, 0.110, 0.155) * smoothstep(0.48, 0.99, follow) * 0.36;
    seaCol -= vec3(0.022, 0.038, 0.058) * smoothstep(0.48, 0.99, -follow) * 0.28;
    // vertical strands down the plunging right face
    float fall = smoothstep(0.50, 0.62, uv.x) * (1.0 - smoothstep(0.62, 0.76, uv.x));
    float strand = sin(uv.x * 90.0 + fbm3(uv * vec2(9.0, 2.4)) * 6.0);
    seaCol += vec3(0.040, 0.070, 0.100) * smoothstep(0.55, 0.99, strand) * fall * 0.45;
    // the wave casts its own shadow just beneath the lip
    float shade = (1.0 - smoothstep(0.02, 0.20, below)) * smoothstep(0.02, 0.26, uv.x)
                * (1.0 - smoothstep(0.46, 0.60, uv.x));
    seaCol = mix(seaCol, vec3(0.020, 0.070, 0.190), shade * 0.75);

    col = mix(col, seaCol, sea);

    // ---- the curling lip: an arc of water peeling off the crest --------
    vec2 C = vec2(0.450, 0.420);
    vec2 cq = uv - C;
    float qd = length(cq);
    float qa = atan(cq.y, cq.x);
    float rOut = 0.330;
    float halfT = 0.030 * (1.0 - 0.88 * smoothstep(2.35, 3.35, qa));
    float rIn = rOut - 2.0 * halfT;
    float win = smoothstep(0.72, 1.18, qa) * (1.0 - smoothstep(3.10, 3.50, qa));
    float band = smoothstep(rOut, rOut - 0.008, qd) * smoothstep(rIn, rIn + 0.008, qd);
    float lip = band * win;

    vec3 lipCol = mix(vec3(0.070, 0.175, 0.375), vec3(0.185, 0.375, 0.575),
        smoothstep(rIn, rOut, qd));
    lipCol += vec3(0.05, 0.09, 0.13) * smoothstep(0.50, 0.99,
        sin(qd * 90.0 + fbm3(uv * 3.4) * 4.0)) * 0.30;
    col = mix(col, lipCol, lip);

    // ---- foam: a ragged rim along the outer edge of the lip ------------
    float jag = 0.026 + 0.030 * fbm(vec2(qa * 4.6, 1.7));
    float foam = smoothstep(jag, jag * 0.12, abs(qd - rOut)) * win;

    // claws: tapering fingers of spray streaming down-left off the lip
    for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float a0 = 1.50 + fi * 0.175;
        vec2 s = C + vec2(cos(a0), sin(a0)) * (rOut - 0.008);
        float len = 0.10 + 0.19 * fbm(vec2(fi * 4.1, 1.9));
        float t = clamp((s.y - uv.y) / max(len, 0.001), 0.0, 1.0);
        float lean = -0.072 * t - 0.052 * t * t;
        float w = (0.014 + 0.012 * fbm(vec2(fi * 7.3, 5.1))) * (1.0 - t * t * 0.90);
        float m = smoothstep(w, w * 0.24, abs(uv.x - s.x - lean))
                * step(uv.y, s.y)
                * smoothstep(1.0, 0.80, t);
        foam = max(foam, m);
    }
    // a thin foam edge along the open face, fading in from the left
    // (kept off the near-vertical face, where a surface band would smear)
    float lipLine = smoothstep(0.012 + 0.016 * fbm(vec2(uv.x * 15.0, 4.1)), 0.0, below)
                  * step(0.0, below) * smoothstep(0.04, 0.26, uv.x)
                  * (1.0 - smoothstep(0.44, 0.56, uv.x));
    foam = max(foam, lipLine * 0.9);
    // foam cascading down the plunging face
    float cascade = smoothstep(0.52, 0.60, uv.x) * (1.0 - smoothstep(0.62, 0.76, uv.x));
    float casc = smoothstep(0.74, 0.96, sin(uv.x * 130.0 + fbm3(uv * vec2(14.0, 3.0)) * 8.0));
    casc *= smoothstep(0.0, 0.06, below) * (1.0 - smoothstep(0.10, 0.46, below));
    foam = max(foam, casc * cascade * 0.55);
    // stray spray
    foam = max(foam, step(0.860, fbm(uv * 46.0)) * smoothstep(0.16, 0.42, uv.x) * 0.8);

    vec3 foamCol = vec3(0.982, 0.972, 0.945);
    foamCol -= 0.13 * step(0.50, fbm(uv * 58.0));
    col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.96);

    // striations inside the foam so it reads as spray, not snow
    float striate = sin(qd * 70.0 - uv.y * 9.0 + fbm3(uv * 7.0) * 4.0);
    col = mix(col, vec3(0.285, 0.430, 0.575),
        smoothstep(0.87, 0.995, striate) * foam * 0.30);

    // ---- the boats, riding the trough ----------------------------------
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float bx = 0.762 + fi * 0.064;
        float by = 0.182 + 0.007 * sin(uTime * 1.2 + fi * 2.1);
        vec2 bp = (uv - vec2(bx, by)) * vec2(1.0, 3.4);
        float hull = smoothstep(0.068, 0.042, abs(bp.x)) * smoothstep(0.018, 0.007, abs(bp.y));
        col = mix(col, vec3(0.235, 0.190, 0.148), hull * 0.94);
        for (int j = 0; j < 3; j++) {
            float fj = float(j);
            vec2 rp = (uv - vec2(bx - 0.030 + fj * 0.030, by + 0.022)) * vec2(1.0, 2.4);
            col = mix(col, vec3(0.885, 0.845, 0.760), smoothstep(0.011, 0.005, length(rp)) * 0.9);
        }
    }

    // ---- washi paper grain ---------------------------------------------
    col += (strokes(uv, 0.0, 3.0, 42.0) - 0.5) * 0.05;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;






/* ------------------------------------------------------------------ */
/* Monet — Water Lilies                                                 */
/* ------------------------------------------------------------------ */

const WATER_LILIES_BODY = /* glsl */ `
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;

/** One lily pad: a soft ellipse with a notch cut out of the side. */
float pad(vec2 uv, vec2 c, float rx, float ry, float ang, float notch) {
    vec2 p = (uv - c);
    p = rot2(ang) * p;
    float d = length(vec2(p.x / rx, p.y / ry));
    float a = atan(p.y / ry, p.x / rx);
    float cut = smoothstep(0.38, 0.04, abs(a - notch)) * step(d, 0.94);
    return smoothstep(1.02, 0.88, d) * (1.0 - cut);
}

/**
 * One water lily flower.
 * Returns (petals, warm centre) so the middle can be tinted separately.
 * Petals are fat and rounded — a Monet bloom, not a starburst.
 */
vec2 lily(vec2 uv, vec2 c, float r, float seed) {
    vec2 p = (uv - c) / r;
    float d = length(p);
    float a = atan(p.y, p.x);
    float petals = 0.0;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float n = 8.0 + fi * 2.0;
        float slice = 6.2831853 / n;
        float phase = a + seed * 1.7 + fi * 0.78;
        float nearest = floor(phase / slice + 0.5) * slice;
        float da = phase - nearest;
        float along = d * cos(da);
        float across = d * sin(da);
        float len = 0.42 + 0.24 * fi;
        float wid = 0.20 - 0.030 * fi;
        float m = smoothstep(wid, wid * 0.32, abs(across))
                * smoothstep(len, len * 0.38, along)
                * step(0.05, along);
        petals = max(petals, m);
    }
    float centre = smoothstep(0.26, 0.10, d);
    petals = max(petals, centre);
    return vec2(petals, centre);
}

void main() {
    vec2 uv = vUv;

    // ---- water, built from layers of horizontal brush strokes -----------
    float w1 = strokes(uv, 0.00, 7.0, 22.0);
    float w2 = strokes(uv, 0.05, 11.0, 48.0);
    float w3 = strokes(uv, -0.03, 5.0, 13.0);
    vec3 col = mix(vec3(0.20, 0.33, 0.30), vec3(0.44, 0.56, 0.47), w1);
    col = mix(col, vec3(0.58, 0.68, 0.61), smoothstep(0.55, 0.95, w2) * 0.50);
    col = mix(col, vec3(0.32, 0.44, 0.38), smoothstep(0.55, 0.95, w3) * 0.42);
    // pale sky caught in the upper half of the pond
    float skyPatch = smoothstep(0.64, 0.96, strokes(uv, 0.0, 3.0, 9.0));
    col = mix(col, vec3(0.74, 0.79, 0.74), skyPatch * smoothstep(0.34, 0.86, uv.y) * 0.45);

    // ---- reflected trees along the top ---------------------------------
    float reflect = smoothstep(0.62, 0.90, uv.y);
    float rt = strokes(uv, 1.57, 5.0, 30.0);
    col = mix(col, mix(vec3(0.34, 0.28, 0.42), vec3(0.52, 0.58, 0.42), rt), reflect * 0.58);
    col += vec3(0.10, 0.12, 0.14) * reflect * smoothstep(0.60, 0.95, rt);

    // ---- lily pads ------------------------------------------------------
    float pads = 0.0;
    float padRim = 0.0;
    pads = max(pads, pad(uv, vec2(0.14, 0.30), 0.115, 0.070, 0.4, 2.2));
    pads = max(pads, pad(uv, vec2(0.36, 0.20), 0.130, 0.078, -0.3, 0.9));
    pads = max(pads, pad(uv, vec2(0.58, 0.34), 0.105, 0.062, 0.9, 3.4));
    pads = max(pads, pad(uv, vec2(0.82, 0.24), 0.120, 0.072, -0.7, 1.8));
    pads = max(pads, pad(uv, vec2(0.24, 0.55), 0.100, 0.060, 0.2, 4.0));
    pads = max(pads, pad(uv, vec2(0.48, 0.62), 0.115, 0.068, -1.1, 2.6));
    pads = max(pads, pad(uv, vec2(0.72, 0.52), 0.098, 0.058, 0.6, 5.1));
    pads = max(pads, pad(uv, vec2(0.92, 0.62), 0.090, 0.054, -0.2, 1.2));
    pads = max(pads, pad(uv, vec2(0.08, 0.72), 0.095, 0.056, 1.2, 3.0));
    pads = max(pads, pad(uv, vec2(0.62, 0.80), 0.085, 0.050, -0.5, 4.4));
    pads = max(pads, pad(uv, vec2(0.40, 0.88), 0.080, 0.048, 0.8, 5.6));

    // per-pad tone so the raft does not read as one flat green shape
    float padTone = fbm3(uv * 6.0);
    vec3 padCol = mix(vec3(0.13, 0.25, 0.15), vec3(0.31, 0.45, 0.24),
        strokes(uv, 0.5, 4.0, 40.0));
    padCol = mix(padCol, vec3(0.38, 0.50, 0.30), padTone * 0.45);
    col = mix(col, padCol, pads * 0.92);

    // a soft rim where the pad lifts off the water
    padRim = pads * (1.0 - smoothstep(0.10, 0.34, pads));
    col = mix(col, vec3(0.44, 0.56, 0.36), padRim * 0.35);

    // ---- flowers --------------------------------------------------------
    vec2 lil = vec2(0.0);
    vec2 one;
    one = lily(uv, vec2(0.20, 0.32), 0.070, 1.1); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));
    one = lily(uv, vec2(0.55, 0.30), 0.078, 2.7); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));
    one = lily(uv, vec2(0.78, 0.58), 0.064, 4.2); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));
    one = lily(uv, vec2(0.34, 0.58), 0.060, 5.9); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));
    one = lily(uv, vec2(0.62, 0.76), 0.055, 7.4); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));
    one = lily(uv, vec2(0.44, 0.44), 0.050, 9.1); lil.x = max(lil.x, one.x); lil.y = max(lil.y, one.y * step(0.5, one.x));

    float petalMix = strokes(uv, 1.2, 3.0, 50.0);
    vec3 lilyCol = mix(vec3(0.97, 0.70, 0.76), vec3(1.00, 0.95, 0.92), petalMix);
    col = mix(col, lilyCol, lil.x * 0.95);
    col = mix(col, vec3(0.97, 0.80, 0.30), lil.y * 0.85);

    // ---- gentle drift ---------------------------------------------------
    col += 0.010 * sin(uTime * 0.4 + uv.x * 7.0 + uv.y * 3.0);
    col += (strokes(uv, 0.02, 6.0, 34.0) - 0.5) * 0.09;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;


/* ------------------------------------------------------------------ */
/* while (true) — the corridor's infinite-loop doodle                   */
/* ------------------------------------------------------------------ */

/**
 * The corridor's top-wall decoration used to be a `while_true_loop.webp`
 * doodle. It is now a painting like every other frame in the corridor: a
 * warm sheet of paper with a hand-inked infinity symbol, a cursor dot
 * running the loop forever, and a blinking terminal caret underneath.
 *
 * The infinity is the Bernoulli lemniscate, evaluated by sampling so the
 * stroke and the travelling dot share exactly the same curve.
 */
const WHILE_TRUE_BODY = /* glsl */ `
uniform float uAspect;
uniform float uTime;
varying vec2 vUv;

/** Point on the Bernoulli lemniscate at parameter t. */
vec2 infPoint(float t, float a) {
    float s = sin(t);
    float c = cos(t);
    return a * vec2(c, c * s) / (1.0 + s * s);
}

/** Distance to that same lemniscate, by sampling the curve. */
float infSDF(vec2 p, float a) {
    float best = 1e3;
    for (int i = 0; i < 48; i++) {
        float t = float(i) / 48.0 * 6.2831853;
        best = min(best, length(p - infPoint(t, a)));
    }
    return best;
}

void main() {
    // Aspect-corrected coords: y in [-1, 1], x in [-uAspect, uAspect].
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;

    // ---- warm sheet of paper -------------------------------------------
    vec3 col = vec3(0.966, 0.948, 0.906);
    col *= 0.958 + 0.070 * fbm(vUv * vec2(uAspect, 1.0) * 24.0);

    // Faint blueprint grid, like a sketchbook page
    vec2 g = abs(fract(p * 2.6) - 0.5);
    col = mix(col, vec3(0.79, 0.77, 0.71), smoothstep(0.47, 0.50, max(g.x, g.y)) * 0.15);

    // Normalised sheet coords: max(|x|, |y|) reaches 1.0 at the canvas edge.
    vec2 q = p / vec2(uAspect, 1.0);
    float m = max(abs(q.x), abs(q.y));

    // Vignette + darkened outer margin, so the sheet lifts off the wall
    // instead of dissolving into the (very similar) warm-white plaster.
    col *= 1.0 - 0.22 * smoothstep(0.50, 1.05, length(q));
    col *= 1.0 - 0.20 * smoothstep(0.84, 1.00, m);

    // ---- the inked infinity --------------------------------------------
    vec2 lp = p - vec2(0.0, 0.16);
    const float A = 0.80;

    float wob = (noise2(lp * 8.0 + 5.3) - 0.5) * 0.026;
    float ink = smoothstep(0.028, 0.007, infSDF(lp, A) + wob);
    // Second, slightly offset pass = the doubled pencil line
    ink = max(ink, smoothstep(0.020, 0.004, infSDF(lp + vec2(0.013, -0.011), A)) * 0.55);
    col = mix(col, vec3(0.17, 0.15, 0.13), ink);

    // ---- cursor dot chasing its own tail around the loop ---------------
    float t = uTime * 0.75;
    float dot = smoothstep(0.075, 0.028, length(lp - infPoint(t, A)));
    for (int i = 1; i <= 6; i++) {
        float trail = 1.0 - float(i) / 7.0;
        vec2 tp = infPoint(t - float(i) * 0.11, A);
        dot = max(dot, smoothstep(0.055, 0.010, length(lp - tp)) * trail * 0.55);
    }
    col = mix(col, vec3(0.90, 0.34, 0.20), dot);

    // ---- a line of "code" and a blinking caret -------------------------
    vec2 base = p - vec2(-uAspect * 0.5 + 0.20, 0.0);

    // dashes
    vec2 lq = base - vec2(0.0, -0.54);
    float ly = 1.0 - smoothstep(0.0, 0.010, abs(lq.y) - 0.022);
    float lx = 0.0;
    for (int i = 0; i < 5; i++) {
        float x0 = float(i) * 0.135;
        float w = 0.080 + 0.030 * fract(sin(float(i) * 12.9898) * 43758.5453);
        lx = max(lx, 1.0 - smoothstep(0.0, 0.012, abs(lq.x - x0 - w * 0.5) - w * 0.5));
    }
    col = mix(col, vec3(0.34, 0.31, 0.28), ly * lx * 0.85);

    // caret
    vec2 cq = base - vec2(0.06, -0.74);
    float caret = (1.0 - smoothstep(0.0, 0.012, abs(cq.x) - 0.055))
                * (1.0 - smoothstep(0.0, 0.012, abs(cq.y) - 0.075));
    col = mix(col, vec3(0.20, 0.18, 0.16), caret * step(0.5, fract(uTime * 0.8)) * 0.9);

    // ---- hand-drawn border, so the canvas reads as a framed sheet --------
    float bw = (noise2(p * 5.0 + 11.7) - 0.5) * 0.016;
    float ring = smoothstep(0.880, 0.902, m + bw) * (1.0 - smoothstep(0.930, 0.952, m + bw));
    col = mix(col, vec3(0.20, 0.18, 0.16), ring * 0.92);
    // lighter echo just inside it — the doubled pencil line
    float ring2 = smoothstep(0.855, 0.868, m + bw * 0.7) * (1.0 - smoothstep(0.870, 0.884, m + bw * 0.7));
    col = mix(col, vec3(0.20, 0.18, 0.16), ring2 * 0.32);

    // ---- paper tooth ----------------------------------------------------
    col += (strokes(vUv * vec2(uAspect, 1.0), 0.4, 5.0, 40.0) - 0.5) * 0.035;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export const PAINTINGS = {
    sunflowers: {
        title: 'Sunflowers',
        artist: 'Vincent van Gogh, 1888',
        fragmentShader: COMMON + SUNFLOWERS_BODY,
        aspect: 1.0,
    },
    starryNight: {
        title: 'The Starry Night',
        artist: 'Vincent van Gogh, 1889',
        fragmentShader: COMMON + STARRY_NIGHT_BODY,
        aspect: 1.55,
    },
    greatWave: {
        title: 'The Great Wave off Kanagawa',
        artist: 'Katsushika Hokusai, c.1831',
        fragmentShader: COMMON + GREAT_WAVE_BODY,
        aspect: 1.5,
    },
    waterLilies: {
        title: 'Water Lilies',
        artist: 'Claude Monet, c.1916',
        fragmentShader: COMMON + WATER_LILIES_BODY,
        aspect: 1.45,
    },
    whileTrue: {
        title: 'while (true)',
        artist: 'Infinite loop',
        fragmentShader: COMMON + WHILE_TRUE_BODY,
        aspect: 1.833,
    },
};

/**
 * The one clock every painting shares.
 *
 * PaintingCanvas already advanced a single module-level time for all of them
 * (a dozen frames are recycled along the corridor and only one material is ever
 * drawn at a time), so hoisting the uniform itself out of the per-material
 * object makes that sharing explicit: the canvas can tick the clock without
 * reaching into a material it does not own.
 */
export const PAINTING_CLOCK = { value: 0 };

/**
 * Build a ShaderMaterial for one painting.
 *
 * @param {keyof typeof PAINTINGS} name
 * @param {number} aspect  width / height of the plane it will be drawn on
 */
export function makePaintingMaterial(name, aspect = 1.6) {
    const painting = PAINTINGS[name];
    if (!painting) throw new Error('Unknown painting: ' + name);

    const material = new THREE.ShaderMaterial({
        vertexShader: PAINTING_VERT,
        fragmentShader: painting.fragmentShader,
        uniforms: {
            uAspect: { value: aspect },
            uTime: PAINTING_CLOCK,
        },
        side: THREE.DoubleSide,
    });
    // Nazwa ułatwia diagnozę sceny (window.__aispin / harness headless).
    material.name = 'painting:' + name;
    return material;
}

/**
 * Cache wspólnych materiałów.
 *
 * Korytarz recyklinguje segmenty przy każdym przewinięciu, więc tworzenie
 * (i zwalnianie) materiału per ramka kończyło się wyścigiem z wewnętrznym
 * odpytywaniem `gl.compileAsync` w three.js — a to wywala się poza łańcuchem
 * promise i potrafi zatrzymać preloader. Jeden materiał na obraz, żyjący
 * przez całą sesję, usuwa problem i oszczędza programy GPU.
 */
const materialCache = new Map();

export function getPaintingMaterial(name, aspect = 1.6) {
    const key = name + '@' + Number(aspect).toFixed(4);
    let material = materialCache.get(key);
    if (!material) {
        material = makePaintingMaterial(name, aspect);
        materialCache.set(key, material);
    }
    return material;
}
