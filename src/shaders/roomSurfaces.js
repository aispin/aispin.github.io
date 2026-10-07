/**
 * Procedural room surfaces (GLSL, zero image assets)
 *
 * Replaces the webp textures previously used for the room vestibule and the
 * gallery floor:
 *   - WOOD_FLOOR:  warm light-oak plank floor, laid in a real running bond
 *   - WARM_WALL:   warm white wall with soft mottling + grounding gradient
 *   - WARM_CEILING:warm white ceiling, near flat with a faint paper grain
 *   - BASEBOARD:   warm off-white skirting with a highlight and shadow crease
 *
 * Every surface except the floor is driven by `uSize` (plane size in world
 * units) so the pattern scale is identical no matter how big the plane is.
 * The floor instead reads WORLD METRES straight out of `vUv` (see
 * bakeWorldUVs) so its plank layout is continuous across meshes.
 *
 * Colours are authored as direct sRGB values and written straight to
 * gl_FragColor, matching how the scene's unlit meshBasicMaterial hex colours
 * display on screen.
 */

import * as THREE from 'three';

export const ROOM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Vertex stage for the two surfaces whose UVs carry WORLD METRES rather than
 * 0..1 — the plank floor and the corridor's ink-wash wall. It additionally
 * forwards view-space depth so both fragment shaders can fade hairline detail
 * with distance: both are seen at a grazing angle, where a fine seam or a
 * paper fibre has nothing to filter it and aliases into crawling speckle.
 *
 * Deliberately a SEPARATE shader rather than an extra varying on ROOM_VERT: the
 * ceiling and baseboard share ROOM_VERT and do not declare `vViewZ`. Writing a
 * varying that the fragment shader never reads is legal GLSL, but it is exactly
 * the kind of thing that compiles on one driver and warns on another — and
 * there is no reason for those surfaces to carry it.
 */
export const WORLD_UV_VERT = /* glsl */ `
varying vec2 vUv;
varying float vViewZ;
void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mvPosition.z;     // metres in front of the camera
    gl_Position = projectionMatrix * mvPosition;
}
`;

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
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
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        v += amp * noise2(p);
        p *= 2.03;
        amp *= 0.5;
    }
    return v;
}
`;

/* ------------------------------------------------------------------ */
/* Warm light-wood plank floor — real running-bond laying               */
/* ------------------------------------------------------------------ */

/**
 * IMPORTANT — this shader reads `vUv` as WORLD METRES, not 0..1 UVs:
 *   vUv.x = world X (across the corridor)
 *   vUv.y = world Z (along the corridor, the walking direction)
 * Callers bake those coordinates in with `bakeWorldUVs()`.
 *
 * Working in world space is what fixes the "unnatural cross-corridor lines":
 * the floor used to be a run of 10-unit tiles whose UVs restarted at every
 * tile, and the plank length (2.50) divided that tile evenly — so every plank
 * END lined up across the whole corridor at exactly the same Z, reading as a
 * hard horizontal cut. A real floor is laid in a running bond: each row gets
 * its own plank length and phase, so butt joints are staggered and no line
 * ever runs uninterrupted across the floor.
 */
export const WOOD_FLOOR_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vViewZ;
// 0 = 木地板（房间），1 = 方砖墁地（门厅 / 过道）。
// 同一个 shader 出两种地面，因为它们的骨架完全一样（都是世界坐标铺装 +
// 按视距淡出的缝），差别只在砖/板的尺寸、铺法和色系。
uniform float uPaving;

${NOISE_GLSL}

const float PW = 0.62;   // plank width (across the corridor)

void main() {
    vec2 world = vUv;

    // ---- plank rows: strips of PW running along the corridor ----
    float row = floor(world.x / PW);
    float v = fract(world.x / PW);          // 0..1 across the plank

    // ---- running bond: per-row plank length + phase ----
    float h1 = hash21(vec2(row, 3.71));
    float h2 = hash21(vec2(row, 17.13));
    float rowLen = 1.35 + 1.05 * h1;        // 1.35 .. 2.40 m boards
    float alongP = world.y / rowLen + h2;
    float seg = floor(alongP);
    float u = fract(alongP);                // 0..1 along the plank

    vec2 pid = vec2(row, seg);              // stable per-board identity

    // ---- per-board tone (oak family) ----
    //
    // 2026-10-07: warmed and deepened. These were a pale, almost bleached
    // family — c1/c2 sat at R−B of 0.169 / 0.202, which on screen is a
    // whitish board. The user asked for the floor to be 温馨, and warmth in
    // wood is that R−B gap, so all three came down a step and gained
    // saturation (now 0.236 / 0.294 / 0.198). Still an oak, just a honeyed
    // one — not a mahogany, and not so dark that the corridor loses its air.
    float t = hash21(pid * 1.37 + 2.4);
    vec3 c1 = vec3(0.871, 0.776, 0.635);    // pale oak
    vec3 c2 = vec3(0.788, 0.663, 0.494);    // honey oak
    vec3 c3 = vec3(0.914, 0.842, 0.716);    // bleached oak
    vec3 col = mix(c1, c2, t);
    col = mix(col, c3, step(0.78, hash21(pid * 2.9 + 7.1)));

    // ---- grain: lines running parallel to the board edges ----
    float g1 = noise2(vec2(v * 5.0, u * 0.55 + pid.x * 7.3));
    float g2 = noise2(vec2(v * 17.0, u * 1.10 + pid.x * 13.7));
    col *= 0.930 + 0.145 * (g1 * 0.65 + g2 * 0.35);

    // occasional darker streak so boards are not all identical
    float streak = smoothstep(0.80, 1.0, noise2(vec2(v * 2.4 + pid.x * 5.0, u * 0.7 + pid.y * 3.0)));
    col *= 1.0 - 0.16 * streak;

    // ---- seams (board-to-board and board-to-board end) ----
    //
    // Thin and LIGHT — not wide and dark. The first pass darkened the board to
    // 68% out to 7% of the plank width, which drew a heavy near-black grid over
    // the whole floor and chopped it into obvious tiles. These are roughly a
    // quarter of that width, and they BRIGHTEN toward a desaturated grey-white
    // instead of darkening, which is what a limed / whitewashed oak joint
    // actually looks like. The per-board tone above is what separates the
    // planks; the joint only has to hint at the edge.
    float edgeV = min(v, 1.0 - v);          // distance to the long edges
    float edgeU = min(u, 1.0 - u);          // distance to the short ends
    float seamV = smoothstep(0.004, 0.018, edgeV);
    float seamU = smoothstep(0.002, 0.010, edgeU);
    float seamMask = 1.0 - min(seamV, seamU);   // 1 on the joint, 0 across the board

    // Ease the joint back into the board tone with distance.
    //
    // The floor is ONE four-vertex quad per segment (see CorridorWalls'
    // floorGeometry) sampled in world metres, so there is no mip chain and a
    // hairline joint has nothing to filter it — at the corridor's grazing angle
    // the far half would alias into crawling speckle. Fading it out beyond a few
    // metres costs nothing and reads like depth of field.
    float seamFade = 1.0 - smoothstep(5.0, 24.0, vViewZ);

    // Warm the joint to agree with the honeyed boards above. It was a cool
    // grey-white (0.930, 0.918, 0.896) — right for limed oak, noticeably blue
    // against the warmer boards.
    vec3 seamCol = vec3(0.918, 0.884, 0.836);   // warm, desaturated off-white
    col = mix(col, seamCol, seamMask * seamFade);

    // NOTE: the additive bevel highlight that used to sit here is gone. It
    // existed to give the old dark seam a "wet edge"; against a light seam it
    // would just smear a second, wider bright band across every joint.

    // ---- broad sheen so the floor reads as a lit surface ----
    col += vec3(0.028, 0.024, 0.017) * (1.0 - smoothstep(0.0, 1.0, abs(v - 0.5) * 2.0));

    // ---- paper grain ----
    col *= 0.976 + 0.048 * noise2(world * 18.0);

    /* ================================================================== */
    /* 方砖墁地 (square brick paving) — uPaving = 1                        */
    /* ================================================================== */
    // 为什么要有这一支：外墙做成青砖黑瓦之后，跨过门槛第一脚踩的却是浅色
    // 橡木 —— 门厅和过道是**室外到室内的过渡**，传统宅子这里墁的是方砖
    // （或青石），木地板在更里面的房间。一个暖一个冷、一个软一个硬，
    // 木地板用在过道上既不合年代，也让"进门"这件事没有材质上的变化。
    //
    // 尺寸：方砖 0.55 见方，**十字缝**铺法（不是错缝）—— 方砖墁地是
    // 对缝的，错缝的是条砖墙。缝比木地板的板缝宽、颜色深。
    // 砖色比外墙的青砖浅：室内不进雨水，没有泛碱，也没有冻融。
    vec2 pcell = world / 0.55;
    vec2 pid2 = floor(pcell);
    vec2 pf = fract(pcell);
    vec2 pe = min(pf, 1.0 - pf);
    float pjoint = 1.0 - smoothstep(0.005, 0.018, min(pe.x, pe.y) * 0.55);

    float pt = hash21(pid2 * 1.71 + 4.3);
    vec3 pc1 = vec3(0.604, 0.610, 0.592);
    vec3 pc2 = vec3(0.548, 0.556, 0.546);
    vec3 pc3 = vec3(0.656, 0.648, 0.618);
    vec3 pcol = mix(pc1, pc2, pt);
    pcol = mix(pcol, pc3, step(0.80, hash21(pid2 * 3.3 + 9.1)));
    // 手工窑烧的砖不是平的
    pcol *= 0.960 + 0.080 * noise2(world * 9.0);

    vec3 pj = vec3(0.368, 0.376, 0.372) * (0.92 + 0.16 * noise2(world * 14.0));
    pcol = mix(pj, pcol, 1.0 - pjoint * seamFade);

    // 走道中间被踩得亮一点 —— 和木地板的中段磨损同一个道理
    pcol += vec3(0.022, 0.021, 0.017) * (1.0 - smoothstep(0.0, 1.4, abs(world.x)));

    pcol *= 0.976 + 0.048 * noise2(world * 18.0);

    col = mix(col, pcol, uPaving);

    gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Rewrites a PlaneGeometry's UVs so `vUv` carries world metres instead of 0..1.
 * Used by the plank floor (WOOD_FLOOR_FRAG) and the corridor's ink-wash wall
 * (INK_WALL_FRAG), both of which need a pattern that runs continuously through
 * a mesh rather than restarting inside it.
 *
 * `mapLocalToWorld(lx, ly)` receives the vertex position in plane-local metres,
 * measured from the plane's centre, and returns `[u, v]` — whatever pair of
 * world-space numbers the shader wants to read as `vUv`.
 */
export function bakeWorldUVs(geometry, width, height, mapLocalToWorld) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        const lx = (uv.getX(i) - 0.5) * width;
        const ly = (uv.getY(i) - 0.5) * height;
        const [u, v] = mapLocalToWorld(lx, ly);
        uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    return geometry;
}

/**
 * ShaderMaterial for the world-space plank floor.
 *
 * `paving: true` 出方砖墁地而不是木地板。两者共用同一个 WOOD_FLOOR_FRAG，
 * 只差一个 uPaving。
 *
 * ⚠️ **2026-10-07 起没有调用点再用方砖了** —— 用户要求屋里/过道的地板改回
 * 橡木、要温馨，`CorridorWalls` 和 `RoomInterior` 都改成了 `paving: false`
 * （也就是默认值）。这个分支**故意保留**：方砖本身画得没问题，改回一行即可，
 * 而删掉它就等于把那段调试过的工作丢了。别把它当成"没人用的死代码"顺手清掉。
 */
export function makeFloorMaterial({ paving = false } = {}) {
    return new THREE.ShaderMaterial({
        vertexShader: WORLD_UV_VERT,
        fragmentShader: WOOD_FLOOR_FRAG,
        uniforms: { uPaving: { value: paving ? 1 : 0 } },
        side: THREE.DoubleSide
    });
}

/* ------------------------------------------------------------------ */
/* Warm white wall                                                      */
/* ------------------------------------------------------------------ */

export const WARM_WALL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;
uniform float uBottomShade; // 0..1 strength of the grounding gradient

${NOISE_GLSL}

void main() {
    vec2 world = vUv * uSize;

    vec3 col = vec3(0.965, 0.937, 0.886); // warm white

    // Gentle plaster mottling — big and soft so it never reads as noise
    float m = fbm(world * 0.55 + 3.7);
    col *= 0.975 + 0.05 * m;

    // Faint vertical wash (walls are lit from above)
    col *= 0.985 + 0.030 * smoothstep(0.0, 1.0, vUv.y);

    // Grounding shadow toward the floor
    float ground = smoothstep(0.22, 0.0, vUv.y) * uBottomShade;
    col *= 1.0 - 0.10 * ground;

    // Paper grain
    col *= 0.985 + 0.03 * noise2(vUv * uSize * 24.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Corridor wall — literati ink wash on rice paper                      */
/* ------------------------------------------------------------------ */

/**
 * The corridor walls used to be a flat `meshBasicMaterial` in #f7f1e6, which
 * left a long hallway with nothing on it. This paints them instead: rice
 * paper, a far and a near mountain range dissolving into mist, and occasional
 * bamboo — the vocabulary of a Song-dynasty ink landscape, held light enough
 * that the picture frames and the room doors still read as the subject rather
 * than the wallpaper.
 *
 * ------------------------------------------------------------------------
 * REWRITE — why the first version read as damp stains
 * ------------------------------------------------------------------------
 * The first version was diagnosed by looking at what it actually drew, and
 * every one of its five faults was structural rather than a matter of taste:
 *
 *  1. NO MOUNTAIN. `ridge()` had wavelengths of 232 / 92 / 41 / 20 m. The
 *     corridor is 80 m and the fog leaves ~60 m visible, so a visitor saw a
 *     quarter of a single wave and the "range" collapsed into one horizontal
 *     band. Wavelengths are now 18.5 / 8.6 / 4.1 / 2.0 m, which puts about
 *     three distinct peaks inside the visible stretch.
 *
 *  2. NO BODY. The wash profile was `smoothstep(0, 0.26, d) * exp(-(d-0.26)
 *     / 0.36)` — a 26 cm ramp into a 36 cm e-fold. That is a thin ribbon
 *     hugging the skyline, not a mountain. The e-fold is now 0.95 m (far) and
 *     0.62 m (near), so each range is a mass roughly a metre deep.
 *
 *  3. NO BRUSH. A single `noise2` with an 87 cm x-feature modulated the wash
 *     between 0.18x and 1.38x — a smooth multiplier, so it produced smooth
 *     blotches. It is now a domain-warped stroke field (16 cm across a
 *     stroke, 77 cm along it) pushed through a `smoothstep` so the strokes
 *     have edges, and the wash is posterised into discrete passes by
 *     `washes()` — real ink goes down in layers, and it is the step between
 *     two of them that the eye reads as a brush edge.
 *
 *  4. STAIN-PATCHES. `mist` was `fbm` at a 3.3 m feature scale removing up to
 *     78 % of the ink. Patches that big, that soft and that strong are
 *     exactly what a damp wall looks like. It is now a light modulation
 *     (30 % max) at a finer scale.
 *
 *  5. TOO BLACK. `INK_DARK` was (0.180, 0.222, 0.232) against paper at 0.973
 *     — a 5:1 ratio, which is charcoal, not ink. Ink on rice paper lands
 *     around 0.70. Both ink colours were lifted and the mix strengths were
 *     reduced; the darkest pixel on the wall is now ~0.70 instead of ~0.63.
 *
 * Everything is still analytic: no image assets, and the only texture-like
 * detail comes from hash noise.
 *
 * IMPORTANT — like WOOD_FLOOR_FRAG, this reads `vUv` as WORLD METRES:
 *   vUv.x = world Z along the corridor (see CorridorWalls' bakeWorldUVs call)
 *   vUv.y = metres above the floor (0 at the skirting board)
 * CorridorWalls bakes those in with `bakeWorldUVs()`. A 0..1 UV would restart
 * the mural at every filler panel and drop a seam across the wall every few
 * metres — the same bug the floor had.
 *
 * Cost: two fbm() calls and four noise2() calls (about 44 hash21 in total)
 * plus eight sines. Roughly double the first version, which is the price of
 * the stroke field; the `detail` fade collapses it back to a flat wash past
 * 26 m, where the fog has taken over anyway. The bamboo loop is analytic —
 * no noise at all — and is skipped entirely outside a clump, so most wall
 * pixels never run it.
 */
export const INK_WALL_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vViewZ;
uniform float uTime;

${NOISE_GLSL}

const float PI = 3.14159265;

// Ink, lifted well clear of black. The paper sits at ~0.95, and the previous
// (0.180, 0.222, 0.232) was a 5:1 ratio against it — charcoal. Ink on rice
// paper lands near 0.70, so both colours moved up and the mix strengths came
// down; the darkest pixel the wall can reach is now ~0.70.
const vec3 INK_MID  = vec3(0.585, 0.622, 0.630);
const vec3 INK_DARK = vec3(0.360, 0.396, 0.404);

/**
 * A ridge line, in metres above the floor.
 *
 * Wavelengths are 18.5 / 8.6 / 4.1 / 2.0 m. The old set (232 / 92 / 41 /
 * 20 m) was longer than the corridor is wide, so the whole "range" collapsed
 * into one horizontal band with no peak in it. At this scale the ~60 m the
 * fog leaves visible holds about three distinct peaks, which is what a
 * literati scroll actually shows.
 *
 * Amplitudes sum to 0.55 m. The far range sits at base 2.12 and the near one
 * at 1.34; the only term whose phase differs between them is the first sine,
 * and that offset makes the gap vary between 0.31 m and 1.25 m — it never
 * closes, so the far range can never punch through the near one.
 */
float ridge(float x, float o) {
    return 1.78 + o
         + 0.30 * sin(x * 0.3400 + 1.7 + o * 2.3)
         + 0.15 * sin(x * 0.7300 + 4.2)
         + 0.07 * sin(x * 1.5300 + 2.6)
         + 0.03 * sin(x * 3.1000 + 5.1);
}

/**
 * Posterises a wash into a few discrete passes.
 *
 * Ink is not sprayed on — it is laid down in layers, and the eye reads the
 * step between two layers as a brush edge. Collapsing a smooth gradient into
 * three or four levels is what turns a soft smear into something that looks
 * like it was painted. The 0.55 mix keeps it from going full contour-map.
 */
float washes(float v, float levels) {
    return mix(v, floor(v * levels + 0.5) / levels, 0.32);
}

/**
 * A bamboo leaf: a tapered blade running from the origin along dir, widest a
 * little past its middle and pointed at both ends. sin() of the normalised
 * distance gives exactly that profile, which is what makes it read as a leaf
 * rather than a spoke.
 */
float blade(vec2 p, vec2 dir, float len, float wid) {
    float along  = dot(p, dir);
    float across = dot(p, vec2(-dir.y, dir.x));
    float t = clamp(along / len, 0.0, 1.0);
    float w = wid * sin(t * PI);
    return smoothstep(w, w * 0.30, abs(across)) * step(0.0, along) * step(along, len);
}

/**
 * One bamboo clump: four culms of different heights fanning up from a common
 * root, each with node rings and a fan of leaves near the top.
 * lx is metres from the clump centre, y metres above the floor, and slot a
 * per-clump seed so no two clumps share a height or a spread.
 *
 * The culms are kept short (1.1..2.2 m) and strongly bowed on purpose. Tall
 * straight ones read as scaffolding poles rather than bamboo — a literati
 * clump is mostly leaf, with the stems barely visible behind it.
 */
float bamboo(float lx, float y, float slot) {
    float m = 0.0;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float h  = hash21(vec2(slot, fi * 3.1 + 1.0));
        float h2 = hash21(vec2(slot, fi * 5.7 + 9.0));
        float h3 = hash21(vec2(slot, fi * 8.3 + 4.0));
        float root = (fi - 1.5) * 0.20 + (h - 0.5) * 0.12;
        float lean = (h2 - 0.5) * 0.46;
        float top  = 1.15 + h * 1.05;
        float t = clamp(y / top, 0.0, 1.0);
        float cx = root + lean * t * t;              // strongly bowed
        // Wind. The culm bends rather than slides, so the sway grows with t²
        // — the base stays planted while the tip travels. Per-culm (fi) and
        // per-clump (slot) phase keep the clump from moving as one rigid body.
        // 0.62 rad/s is ~0.1 Hz: slow enough to read as a breeze.
        cx += sin(uTime * 0.62 + slot * 1.7 + fi * 1.9) * 0.055 * t * t;
        float halfW = mix(0.026, 0.010, t);          // tapers upward
        float stalk = smoothstep(halfW, halfW * 0.30, abs(lx - cx))
                    * step(0.18, y) * step(y, top);
        // node rings: a darker band every third of a metre
        float node = step(0.82, fract(y / 0.31 + h2 * 3.0));
        m = max(m, stalk * (0.72 + 0.28 * node));

        // leaf fan, up where a culm actually carries one
        if (y > top * 0.62) {
            vec2 lp = vec2(lx - cx, y - top * 0.80);
            for (int j = 0; j < 5; j++) {
                float fj = float(j);
                float ang = (fj - 2.0) * 0.42 + (h3 - 0.5) * 0.8
                          + sin(uTime * 1.35 + slot + fj * 1.3) * 0.10;
                vec2 dir = vec2(cos(ang), sin(ang));
                float len = 0.26 + h * 0.22;
                m = max(m, blade(lp, dir, len, 0.040 + h2 * 0.016) * 0.95);
            }
        }
    }
    return m;
}

void main() {
    float x = vUv.x;
    float y = vUv.y;

    // ---- distance fades for the fine detail ----
    // Seen at a grazing angle down the corridor, a 3 mm paper fibre or a
    // 16 cm brush stroke has nothing to filter it and crawls. Fading both
    // past a few metres costs nothing and reads as depth of field. The
    // detail fade also converges the stroke field to a mid grey, so a
    // distant range becomes a flat wash instead of a shimmering mess.
    float near   = 1.0 - smoothstep(5.0, 22.0, vViewZ);
    float detail = 1.0 - smoothstep(4.0, 26.0, vViewZ);

    // ---- rice paper ----
    float mottle = fbm(vec2(x, y) * 0.34 + 3.7);
    float fibre  = noise2(vec2(x, y) * 2.9);
    vec3 paper = vec3(0.973, 0.958, 0.926)
               * (0.968 + 0.054 * mottle)
               * (1.0 - 0.022 * near * (1.0 - fibre));
    vec3 col = paper;

    // ---- dry brush ----
    // One domain-warped noise rather than two stacked ones. Two things make
    // this read as brushwork instead of as rain:
    //   * the slow warp (2.4 m x 1.8 m) shifts each stroke's phase, so the
    //     strokes fan and break the way a loaded brush does as it runs dry;
    //   * the 0.18 * y shear leans them, because a brush travelling down a
    //     slope does not leave a plumb line.
    // A stroke is ~19 cm across and ~53 cm long, so two or three of them fit
    // inside a range's ~1 m body rather than one streak spanning the whole
    // thing. The fine 8 cm component roughens their edges — a clean
    // smoothstep boundary, combined with the posterised washes below, cut the
    // strokes into little rectangles and the range read as brickwork.
    float warp    = noise2(vec2(x * 0.42, y * 0.55));
    float strokeN = noise2(vec2(x * 5.2 + 2.4 * warp + 0.18 * y, y * 1.90));
    float fineN   = noise2(vec2(x * 13.0 + 5.0 * warp, y * 3.60));
    float brush   = smoothstep(0.38, 0.68, strokeN * 0.78 + fineN * 0.28);
    brush = mix(0.55, brush, detail);

    // ---- haze ----
    // A light modulation only. At full strength this field used to remove up
    // to 78 % of the ink in patches 3.3 m across, which is precisely what
    // read as damp stains rather than as mist.
    // The drift translates the noise INPUT rather than adding an octave, so
    // animating the mist costs one vec2 add per fragment — no extra hash. The
    // ridges themselves (ridge/fray) stay put; only the haze lying over them
    // moves, which is what "flowing mist" means for a landscape that is not
    // itself going anywhere.
    float mist = fbm(vec2(x * 0.55, y * 1.25) + 12.0 + vec2(uTime * 0.055, uTime * 0.020));
    float haze = 1.0 - 0.30 * smoothstep(0.32, 0.74, mist);

    // A common per-ridge jitter, so the two skyline curves are not the same
    // sine family shifted — they fray against each other.
    float fray = noise2(vec2(x * 0.90, 3.10)) - 0.5;

    // ---- far range: high, pale, more than half dissolved ----
    float d1 = ridge(x, 0.34) + 0.10 * fray - y;
    float m1 = smoothstep(0.0, 0.11, d1) * exp(-max(d1 - 0.14, 0.0) / 0.95);
    // Stroke texture decays faster than the mass does, so the ink breaks into
    // strokes near the skyline — where a brush is actually loaded — and the
    // lower body settles into a flat wash. Without this the streaks hang all
    // the way down and the range reads as a curtain.
    float tex1 = exp(-max(d1 - 0.14, 0.0) / 0.55);
    float b1 = mix(1.0, brush, tex1);
    // The factors stop just short of 1.0 on purpose. When the product reaches
    // the clamp the whole saturated region becomes one flat plateau, and the
    // contour where saturation begins draws a hard vertical edge — a cliff in
    // the middle of a mountain. Staying under it keeps every level a wash.
    float i1 = washes(clamp(m1 * (0.16 + 0.80 * b1) * haze, 0.0, 1.0), 5.0);
    col = mix(col, INK_MID, i1 * 0.38);

    // ---- near range: lower, darker, holds its body longer ----
    float d2 = ridge(x, -0.44) + 0.10 * fray - y;
    float m2 = smoothstep(0.0, 0.13, d2) * exp(-max(d2 - 0.16, 0.0) / 0.62);
    float tex2 = exp(-max(d2 - 0.16, 0.0) / 0.40);
    float b2 = mix(1.0, brush, tex2);
    float i2 = washes(clamp(m2 * (0.14 + 0.78 * b2) * haze, 0.0, 1.0), 6.0);
    col = mix(col, INK_DARK, i2 * 0.46);

    // ---- bamboo: one clump every 9 m, placed irregularly inside its slot ----
    float slot = floor(x / 9.0);
    float bx = (slot + 0.5 + (hash21(vec2(slot, 2.3)) - 0.5) * 0.7) * 9.0;
    if (abs(x - bx) < 1.10) {
        float ink = bamboo(x - bx, y, slot);
        col = mix(col, INK_DARK, clamp(ink, 0.0, 1.0) * 0.58);
    }

    // ---- keep the ink off the skirting and the ceiling ----
    // Only the ink retreats; the paper stays, so the wall keeps its texture
    // right down to the baseboard.
    float band = smoothstep(0.10, 0.70, y) * (1.0 - smoothstep(3.05, 3.45, y));
    col = mix(paper, col, band);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Warm white ceiling                                                   */
/* ------------------------------------------------------------------ */

export const WARM_CEILING_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;

${NOISE_GLSL}

void main() {
    vec2 world = vUv * uSize;

    vec3 col = vec3(0.980, 0.960, 0.922); // warm white, a touch brighter than the walls

    float m = fbm(world * 0.7 + 9.1);
    col *= 0.985 + 0.030 * m;

    // Soft corner falloff so the ceiling does not look like a flat card
    vec2 d = abs(vUv - 0.5) * 2.0;
    col *= 1.0 - 0.035 * smoothstep(0.55, 1.0, max(d.x, d.y));

    col *= 0.99 + 0.02 * noise2(vUv * uSize * 26.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Baseboard / threshold trim                                           */
/* ------------------------------------------------------------------ */

export const BASEBOARD_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;
uniform float uVertical; // 1.0 for wall trim (highlight on top), 0.0 for floor trim

${NOISE_GLSL}

void main() {
    vec2 world = vUv * uSize;

    vec3 col = vec3(0.949, 0.925, 0.878); // warm off-white

    // Subtle wood/plaster grain along the run
    float g = fbm(vec2(world.x * 2.6, world.y * 0.9));
    col *= 0.965 + 0.06 * g;

    // Top highlight + bottom shadow crease
    float top = smoothstep(0.55, 1.0, vUv.y);
    float bottom = 1.0 - smoothstep(0.0, 0.30, vUv.y);
    col = mix(col, col * 1.06, top * uVertical);
    col *= 1.0 - 0.16 * bottom * uVertical;

    // A thin darker line where the trim meets the wall/floor
    float edge = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
    col *= 0.93 + 0.07 * edge;

    col *= 0.985 + 0.03 * noise2(vUv * uSize * 30.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* ShaderMaterial factory                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds a ShaderMaterial for one of the room surfaces above.
 * @param {string} fragmentShader one of WOOD_FLOOR_FRAG / WARM_WALL_FRAG / ...
 * @param {number} width  plane width in world units
 * @param {number} height plane height in world units
 * @param {object} [extra] extra uniform values, e.g. { uSwapAxes: 1 }
 * @param {string} [vertexShader] defaults to ROOM_VERT; pass WORLD_UV_VERT for
 *   a fragment shader that reads vUv in world metres and wants vViewZ.
 */

/**
 * The ink mural's clock — ONE uniform object shared by every material whose
 * shader declares `uTime`, so a single writer drives the whole corridor.
 *
 * CorridorWalls and DoorSection both build ink-wall materials (three wall
 * segments plus every door-side wall). Handing each its own `{ value: 0 }`
 * would need a useFrame in every caller, and the copies would drift apart —
 * the bamboo would fall out of phase across a seam. `makeRoomMaterial` hands
 * out this object by default instead.
 *
 * Written by InfiniteCorridorManager, which already runs a frame loop.
 */
export const uTimeUniform = { value: 0 };

export function makeRoomMaterial(fragmentShader, width, height, extra = {}, vertexShader = ROOM_VERT) {
    const uniforms = {
        uSize: { value: [width, height] },
        ...extra
    };
    // Defaults for uniforms the shader declares but the caller did not set
    if (fragmentShader.includes('uBottomShade') && uniforms.uBottomShade === undefined) {
        uniforms.uBottomShade = { value: 1 };
    }
    if (fragmentShader.includes('uVertical') && uniforms.uVertical === undefined) {
        uniforms.uVertical = { value: 1 };
    }
    if (fragmentShader.includes('uTime') && uniforms.uTime === undefined) {
        uniforms.uTime = uTimeUniform;
    }
    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        side: THREE.DoubleSide
    });
}
