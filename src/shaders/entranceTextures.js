/**
 * Procedural entrance surface materials (GLSL, zero image assets)
 *
 * Replaces AI-generated textures with GPU shaders to avoid
 * image-generation credit costs:
 *   - SONG_WALL: aged 青砖 (grey-blue brick) in running bond over a 青石
 *              plinth, capped with 黑瓦 barrel tiles, weathered and overlaid
 *              with an ink bamboo wash, plus transparent openings for the
 *              entrance door frame and the window (matches the original
 *              texture's holes)
 *   - STONE:   voronoi cobblestone path with a grass verge on both
 *              sides and mossy dirt in the joints
 *   - GRASS:   the wide ground field either side of the path — tufted
 *              green with sparse procedurally-scattered flowers
 *
 * Colors are authored as direct sRGB hex values and written to
 * gl_FragColor without extra encoding, which matches how the scene's
 * unlit meshBasicMaterial hex colors display on screen.
 */

export const SURFACE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The creeper ink as its own transparent layer, drawn in front of the wall.
 *
 * WHY IT IS NOT LEFT INSIDE SONG_WALL_FRAG
 * ----------------------------------------
 * It used to be `col = mix(col, ink.rgb, ink.a * uInkStrength)` inside the
 * brick shader, i.e. the vine was *part of the wall*. That is fine until
 * something is mounted on the wall in front of it: the 春联 sit at z = 0.17
 * and the facade is at 0.15, so the couplets were painted over the vine and
 * sliced the leaves that cross them. A creeper that has come over the wall is
 * a physical thing standing proud of the plaster — it belongs in front of a
 * paper strip pasted flat on it.
 *
 * 2026-10-09 user note: 「对联：应该在树和藤的后面，现在在树和藤的前面了」.
 *
 * So the ink moved out into this layer, parked at z = 0.18 (in front of the
 * couplets) and above them in the transparent sort order. SONG_WALL_FRAG still
 * declares uInk/uInkStrength and still runs the same `mix` — it is handed a
 * strength of 0, and `mix(col, x, 0.0)` is exactly `col`, so the brick is
 * untouched. Keeping the line in place rather than deleting it is deliberate:
 * it is the seam where this layer can be folded back in.
 *
 * Compositing is identical either way: `mix(dst, ink.rgb, ink.a * s)` and
 * `dst * (1 - ink.a * s) + ink.rgb * (ink.a * s)` are the same expression.
 * The only real difference is *when* it lands — after the paper grain and the
 * snow rather than before — which is a fraction of a percent and, for the
 * snow, arguably more correct: the vine lies on top of the coping's snow.
 *
 * SEASONAL LEAF COLOUR (2026-10-10)
 * ---------------------------------
 * The vine is painted into the canvas texture (`makeWallInkTexture`), so its
 * colour is baked. Rather than re-bake a 1280x768 canvas every time the season
 * changes, `uInkTint` multiplies the sampled rgb here. The user's note was
 * 「把它当作是常春藤，季节稍微改下叶子颜色深浅即可」 — a *tint*, not a
 * repaint, and the multiplier is deliberately within ±25 % (see
 * `SEASON_INK_TINT`). ⚠️ It multiplies `rgb` only: `a` is untouched, so the
 * vine's silhouette and branch shapes are bit-identical across seasons and
 * only the colour moves.
 */
export const INK_OVERLAY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uInk;
uniform float uInkStrength;
uniform vec3  uInkTint;     // 季节叶色乘数（只乘 rgb，不动 alpha）
void main() {
    vec4 ink = texture2D(uInk, vUv);
    float a = ink.a * uInkStrength;
    // Almost the whole quad is empty; discarding it keeps the extra pass free.
    if (a < 0.004) discard;
    gl_FragColor = vec4(ink.rgb * uInkTint, a);
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
/* Shared grass field                                                   */
/*                                                                      */
/* The wide ground plane AND the grass verge of the stone path both     */
/* call grassSurface(). Before this they each carried their own copy of  */
/* the same idea — different greens, different noise, no shared frame —  */
/* and the two met at the stone path's straight rectangle edge. Two      */
/* slightly different greens abutting along a ruler-straight line is     */
/* exactly what reads as 生硬 (harsh), so the fix is not to soften the   */
/* seam but to delete it: one function, one palette, one coordinate      */
/* frame, so the surfaces are the same material on both sides.           */
/*                                                                      */
/* Both callers therefore pass `gw`, the TRUE world XZ of the fragment,  */
/* built as `uOrigin + world * vec2(1.0, -1.0)` — the v axis of a        */
/* -PI/2-rotated plane runs against world +Z, hence the flip. With that  */
/* frame the grass is stable in world space: it no longer repeats or     */
/* mirrors every 40-unit ground tile either.                             */
/* ------------------------------------------------------------------ */

const GRASS_GLSL = /* glsl */ `
// ---- 季节调色板 ------------------------------------------------------
// **只在这里声明一次。** GRASS_FRAG（草地）与 STONE_FRAG（甬路的草边）都
// include 本段，所以两边的季节色板天生相同 —— 石路矩形边上不可能裂出接缝。
//
// 这是本文件最贵的一课的直接应用：这两个 surface 曾经各有一套调色板和
// 两个坐标系，在石路的直边相接，那正是「生硬」的定义。当时的解法是
// **删掉接缝而不是柔化它**。季节色板加在共享函数里，接缝就没机会回来。
//
// 用 palette uniforms 而不是在 GLSL 里写季节分支：着色器保持通用，
// 季节只是数据（SEASON_GROUND 是唯一真源，见本文件下方）。
// ⚠️ 这一段在**模板字符串里** —— 注释里别写反引号，会直接把字符串截断。
uniform vec3  uGrassA;        // 草基色 A
uniform vec3  uGrassB;        // 草基色 B
uniform vec3  uMoss;          // 苔色
uniform vec3  uTip;           // 受光叶尖
uniform vec3  uFlowerA;       // 花瓣色阶 2
uniform vec3  uFlowerB;       // 花瓣色阶 3
uniform vec3  uFlowerC;       // 花瓣色阶 4
uniform float uFlowerDensity; // 开花格子比例
uniform float uSnow;          // 0..1 积雪覆盖
uniform vec3  uLitterCol;     // 秋：地上杂着的黄（落叶碎屑 / 枯草）
uniform float uLitter;        // 0..1，只有秋天非 0（见 grassSurface 里的用法）

vec2 hash22(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// One flower head: a 5-petal disc drawn inside a ~0.16 world-unit cell.
// "petal" tints the petals, "core" the centre. Returns rgb + mask.
vec4 flowerHead(vec2 p, float seed, vec3 petal, vec3 core) {
    float a = hash21(vec2(seed, 1.7)) * 6.28318;
    float c = cos(a), s = sin(a);
    vec2 q = mat2(c, -s, s, c) * p;

    float r = length(q);
    // 5 petals: radius modulated by the polar angle
    float ang = atan(q.y, q.x);
    float lobes = 0.62 + 0.38 * abs(cos(2.5 * ang));
    float petalMask = 1.0 - smoothstep(0.055 * lobes, 0.075 * lobes, r);

    vec3 col = mix(petal, petal * 0.82, smoothstep(0.0, 0.07, r));
    float coreMask = 1.0 - smoothstep(0.016, 0.026, r);
    col = mix(col, core, coreMask);

    return vec4(col, max(petalMask, coreMask));
}

/* ---- 雪：颜色与覆盖度**只在这里定义一次** -------------------------------
 *
 * 草地（grassSurface）与石板（STONE_FRAG 的冬季薄雪）必须共用同一场雪。
 *
 * 2026-10-10 用户报「即使是冬季，石板路上的积雪也没有和周边雪地做到自然
 * 融合的效果」。原因就是两边各写各的：颜色虽然都是同一个 vec3，但**噪声
 * 是两条**（草地 fbm(gw*0.62+61.0)、石板 fbm(gw*0.85+17.0)），于是边界
 * 两侧的斑驳互不相关 —— 雪是同一片白，但"哪块露底、哪块积厚"对不上，
 * 眼睛读到的就是两种材料。
 *
 * 这与 GRASS_GLSL 顶上那条教训是同一个：**接缝的解法是删掉它，不是柔化它。**
 */
const vec3 SNOW_COL = vec3(0.930, 0.947, 0.972);

/** 世界坐标处的积雪覆盖度 0..1（低频斑驳：没盖满、还露着枯草）。 */
float snowCoverage(vec2 gw) {
    float snowN = fbm(gw * 0.62 + 61.0);
    return 0.42 + 0.58 * smoothstep(0.28, 0.66, snowN);
}

vec3 grassSurface(vec2 gw) {
    // --- Grass base: two octaves of noise for patchy tone ---
    // Muted deliberately. A Song garden is not a lawn: the greens are pulled
    // toward moss and olive so the wall and the orange fruit are the only
    // things that read as bright.
    float n1 = noise2(gw * 1.1);
    float n2 = fbm(gw * 3.0 + 11.0);
    vec3 col = mix(uGrassA, uGrassB, n1 * 0.65 + n2 * 0.35);

    // Blade tufts: two crossed stretched-noise layers give a soft, non-
    // directional shag instead of a single hard streak direction.
    float bladesA = noise2(vec2(gw.x * 22.0, gw.y * 4.0));
    float bladesB = noise2(vec2(gw.x * 4.0, gw.y * 19.0));
    float blades = mix(bladesA, bladesB, 0.45);
    col *= 0.92 + 0.16 * blades;
    // Sunlit tips
    col += uTip * smoothstep(0.82, 0.99, blades);
    // Shadowed clumps
    col *= 1.0 - 0.12 * smoothstep(0.78, 0.97, n2);

    // Moss gathering in the shadier patches — this is what makes the ground
    // read as a garden floor rather than as turf.
    float mossN = fbm(gw * 1.7 + 33.0);
    col = mix(col, uMoss, smoothstep(0.56, 0.84, mossN) * 0.45);

    // --- 秋：地上杂着的黄（落叶碎屑 / 枯草） ---------------------------
    // 「深绿杂黄」里的**杂**字。只改 uGrassA/B 只能得到一片**均匀**的橄榄，
    // 那读起来像"整块地褪了色"；要读成"深绿里混着黄"，需要**斑块**。
    // 与草地基色同理：色相只解决"看得见"，斑驳才解决"认得出"。
    //
    // 放在苔之后、花之前：先让苔把底色压稳，再撒黄；花是**立在地上**的，
    // 不该被当作落叶重新着色，所以它排在最外面。
    //
    // ⚠️ 其余三季 uLitter = 0，而「mix(col, x, 0.0)」在数值上严格等于 col，
    // 所以它们**逐位不受影响** —— 与下面那场雪同一个前提。
    float litterN = fbm(gw * 2.35 + 77.0);
    col = mix(col, uLitterCol, smoothstep(0.42, 0.78, litterN) * uLitter);

    // --- Sparse flowers: jittered world grid, roughly one every five cells ---
    float cell = 0.95;
    vec2 g = gw / cell;
    vec2 gid = floor(g);
    vec2 gf = fract(g);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 h = hash22(gid + o);
            // Keep only a small share of the cells. A Song garden plants a few
            // things deliberately; a meadow of flowers is the wrong century.
            // 密度按季节给：春最多（0.16）、夏秋回到 0.08、冬为 0。
            if (h.x > uFlowerDensity) continue;

            // Jittered centre inside the cell, never right on the border
            vec2 c = o + 0.24 + h * 0.52;
            vec2 p = gf - c;

            // Petal tint: restrained — cream, pale gold, faded rose, muted red.
            // 第 1 阶（奶白）是基准，2..4 阶按季节给：春偏粉白、夏秋是上面这套。
            float t = hash21((gid + o) * 1.37 + 5.1);
            vec3 petal = mix(vec3(0.960, 0.941, 0.878), uFlowerA, smoothstep(0.0, 0.34, t));
            petal = mix(petal, uFlowerB, smoothstep(0.34, 0.68, t));
            petal = mix(petal, uFlowerC, smoothstep(0.68, 1.0, t));
            vec3 core = vec3(0.890, 0.749, 0.310);

            // Scale each flower a little differently
            float sz = 0.95 + hash21((gid + o) * 2.13 + 9.4) * 0.75;

            // Stem: a thin vertical line below the head
            float stemW = 0.018 * sz;
            float stem = (1.0 - smoothstep(stemW, stemW * 1.9, abs(p.x)))
                       * (1.0 - smoothstep(0.16 * sz, 0.20 * sz, abs(p.y + 0.11 * sz)));
            col = mix(col, vec3(0.322, 0.478, 0.235), stem * 0.9);

            vec4 fl = flowerHead(p / sz, hash21(gid + o + 3.3), petal, core);

            // Soft dark contact shadow under the head
            float sh = (1.0 - smoothstep(0.05 * sz, 0.13 * sz, length(p))) * 0.20;
            col *= 1.0 - sh;

            col = mix(col, fl.rgb, fl.a);
        }
    }

    // --- 积雪 ---------------------------------------------------------
    // 雪是**一次 mix**，不是新增几何：地面薄雪全靠这一个 uniform。
    // 颜色与覆盖度都取自上面共用的 SNOW_COL / snowCoverage()，石板那边同一套。
    //
    // ⚠️ 其余三季 uSnow = 0，而「mix(col, x, 0.0)」在数值上严格等于 col，
    // 所以这三季的画面**逐位不受影响**（这是秋天回归锚点成立的前提之一）。
    col = mix(col, SNOW_COL, uSnow * snowCoverage(gw));

    // Paper-like grain to match the sketchy art direction. Keyed off the
    // world frame so it does not band across the ground tiles.
    col *= 0.97 + 0.06 * noise2(gw * 20.0);

    return col;
}
`;

/* ------------------------------------------------------------------ */
/* Song-dynasty courtyard wall + door/window openings                   */
/*                                                                      */
/* Replaces the running-bond red brick — and the lime-washed plaster    */
/* (白粉墙) that briefly stood in for it. The house is now read as an    */
/* old 青砖黑瓦 building: cool grey-blue brick in running bond over a    */
/* 青石 plinth (勒脚), capped with a roll of near-black barrel tiles      */
/* (瓦顶压顶).                                                          */
/*                                                                      */
/* Why 青砖 and not red brick: 青砖 is fired in a reducing kiln, so the   */
/* iron in the clay comes out as ferrous oxide and the brick is cool    */
/* grey with a faint blue-green cast. That cast — not the shape of the  */
/* bricks — is what makes a wall read as Chinese rather than as a       */
/* Victorian terrace, so it is the one thing the shader must not lose.  */
/*                                                                      */
/* The plaster carried its own weathering (rain streaks, rising damp,   */
/* hairline cracks); brick carries all of those PLUS 泛碱, the chalky    */
/* white salt bloom that migrates out of old brick and is the single    */
/* most recognisable sign of age on a grey-brick wall.                  */
/*                                                                      */
/* Every band is authored in world units measured UP FROM THE GROUND,    */
/* which is uOrigin.y: EntranceDoors parks the facade's bottom edge on   */
/* floorY, so the plane's own bottom edge is the datum.                  */
/* ------------------------------------------------------------------ */

export const SONG_WALL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;      // plane size in world units
uniform vec2 uOrigin;     // world XY of the plane's BOTTOM-LEFT corner
uniform vec4 uHoleDoor;   // cx, cy, halfW, halfH (WORLD coords, centred on the facade)
uniform vec4 uHoleWindow; // cx, cy, halfW, halfH (WORLD coords)
uniform sampler2D uInk;   // creeper ink wash, drawn in utils/entranceArt.js
uniform float uInkStrength;
// 压顶从墙高的哪个比例开始。0.905 = 一堵有黑瓦压顶的墙。
// 传 >1 就是「这面墙没有压顶」—— 台基/勒脚那类矮石台用它，
// 否则压顶的 smoothstep 会落在石头顶上，给石台盖一条瓦色的带子。
uniform float uCapFrac;
// 0..1 积雪。STONE_FRAG / GRASS_FRAG 里这一行声明在共享的 GRASS_GLSL 中，
// 本 shader 不 include 那一段，所以自己声明 —— 名字与 makeSurfaceUniforms
// 分发的那个必须一致，否则冬天会静默不生效（three 忽略多余的 uniform，
// 也**不会**为缺失的 uniform 报错）。
uniform float uSnow;

${NOISE_GLSL}

// 1.0 inside the rect, 0 outside, soft 0.06-world-unit edge
float rectHole(vec2 world, vec4 hole) {
    vec2 d = abs(world - hole.xy) - hole.zw;
    return 1.0 - smoothstep(0.0, 0.06, max(d.x, d.y));
}

void main() {
    vec2 world = vUv * uSize;
    vec2 worldPos = uOrigin + world;
    float above = worldPos.y - uOrigin.y;

    /* ---- 青砖 (grey-blue brick, running bond) ------------------------- */
    // The coursing is deliberately coarser than a real 240x115x53 mm
    // brick, which at this scale would be ~0.063 world units: an 8-unit
    // wall would then carry 127 courses and the facade would alias into
    // grey mush at any distance. 0.155 puts roughly 15 courses in frame
    // at the resting entrance camera — that count is what makes the wall
    // read as brick at all, so it is a rendering decision, not a metric.
    float course = 0.155;
    float brickLen = 0.62;
    float row = floor(above / course);
    float yf = fract(above / course);
    float bx = world.x / brickLen + mod(row, 2.0) * 0.5;   // running bond offset
    float cid = floor(bx);
    float xf = fract(bx);

    // Mortar joint: a thin recess. 青砖 is often laid 丝缝 (joints barely
    // there), but the wall has to read as brick, and a joint you cannot
    // see is a joint that does not exist.
    float jw = 0.017;
    float jd = min(min(xf, 1.0 - xf) * brickLen, min(yf, 1.0 - yf) * course);
    float face = 1.0 - smoothstep(jw * 0.5, jw * 1.4, jd);

    // Per-brick tone. Three base tones give the wall its patchiness; the
    // rare fourth (sooty / rusted, ~4.5% of bricks) is what stops it
    // looking like a tiling pattern.
    float bh = hash21(vec2(cid, row));
    float bh2 = hash21(vec2(cid + 7.31, row + 3.17));
    vec3 brick = mix(vec3(0.600, 0.620, 0.612), vec3(0.452, 0.478, 0.480), bh);
    brick = mix(brick, vec3(0.690, 0.700, 0.678), smoothstep(0.80, 0.98, bh2) * 0.75);
    brick = mix(brick, vec3(0.522, 0.443, 0.373), step(0.955, bh) * 0.55);
    brick *= 0.955 + 0.090 * noise2(world * 14.0);   // faint clay grain

    vec3 joint = vec3(0.318, 0.330, 0.330) * (0.92 + 0.16 * noise2(world * 11.0));
    vec3 col = mix(joint, brick, face);

    // Bevel: the face darkens toward its own edges, which is what gives
    // the coursing relief without any lighting model.
    col *= 0.90 + 0.14 * smoothstep(0.0, 0.055, jd);

    /* ---- weathering -------------------------------------------------- */
    // Rain streaks run DOWN the wall, so the noise is squeezed in x and
    // stretched in y. Squeezing y instead gives horizontal banding, which
    // reads as a rendering artefact rather than as weather. On brick the
    // streaks pool in the joints, so they are allowed to darken harder
    // than they would on plaster.
    float streak = fbm(vec2(world.x * 3.6, world.y * 0.40) + 3.7);
    col = mix(col, vec3(0.318, 0.336, 0.330), smoothstep(0.50, 0.88, streak) * 0.30);

    // 泛碱 — efflorescence. Soluble salts migrate out of old brick and
    // bloom as a chalky white crust, in patches rather than everywhere,
    // and only above the splash zone. This field replaces the plaster's
    // mottle at no extra cost: same one fbm.
    float bloom = fbm(world * vec2(1.5, 1.9) + 57.0);
    col = mix(col, vec3(0.796, 0.804, 0.788),
              smoothstep(0.62, 0.86, bloom) * smoothstep(0.30, 1.10, above) * 0.42);

    // Rising damp and splash-back: the foot of every real wall is dirtier.
    col = mix(col, vec3(0.365, 0.376, 0.360), (1.0 - smoothstep(0.5, 2.6, above)) * 0.34);

    // Hairline cracks. High frequency and heavily gated: a low-frequency
    // ridge here draws contour lines the size of dinner plates and the wall
    // ends up looking like a jigsaw.
    float crack = abs(noise2(world * vec2(6.0, 8.5) + 41.0) - 0.5);
    col *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.012, crack)) * step(0.62, fbm(world * 1.6 + 7.0));

    /* ---- stone plinth (勒脚) ------------------------------------------ */
    // 青石 — the same cool cast as the brick, two steps darker, so the
    // base reads as a separate material rather than as more wall.
    float pCourse = 0.31;
    float pRow = floor(above / pCourse);
    float pyf = fract(above / pCourse);
    float pbx = world.x / 1.15 + mod(pRow, 2.0) * 0.5;
    float pxf = fract(pbx);
    float pEdge = min(min(pxf, 1.0 - pxf) * 1.15, min(pyf, 1.0 - pyf) * pCourse);
    float pFace = smoothstep(0.016, 0.042, pEdge);
    vec3 pStone = mix(vec3(0.408, 0.424, 0.420), vec3(0.520, 0.533, 0.524), hash21(vec2(pRow, floor(pbx))));
    pStone *= 0.92 + 0.16 * noise2(world * 5.5);
    vec3 pJoint = vec3(0.258, 0.270, 0.270) * (0.9 + 0.2 * noise2(world * 8.5));
    vec3 plinth = mix(pJoint, pStone, pFace);
    float moss = smoothstep(0.28, 0.64, fbm(world * 2.8 + 21.0)) * (1.0 - smoothstep(0.04, 0.55, above));
    plinth = mix(plinth, vec3(0.352, 0.420, 0.286), moss * 0.46);

    float plinthTop = 0.62;
    col = mix(plinth, col, smoothstep(plinthTop - 0.05, plinthTop + 0.03, above));

    // the brick overhangs the plinth, so it drops a shadow onto it
    float underLip = smoothstep(plinthTop - 0.40, plinthTop - 0.06, above)
                   * (1.0 - smoothstep(plinthTop - 0.06, plinthTop + 0.01, above));
    col *= 1.0 - 0.26 * underLip;

    /* ---- tile coping (黑瓦 瓦顶压顶) ----------------------------------- */
    // A roll course of barrel tiles under a flat capping course. Off the top
    // of the resting entrance camera, but the wall is several units tall and
    // the player can look up, so it still has to be right. Kept a shade blue so
    // the tiles read as fired clay in shade rather than as flat black paint.
    //
    // Anchored to the wall's own top, not to 7.26 world units. That literal
    // was the coping height for the 8-unit facade; on any other facade the
    // smoothstep below would have evaluated entirely past uSize.y and the
    // 黑瓦 would simply have vanished.
    float capBase = uSize.y * uCapFrac;
    float capT = clamp((above - capBase) / (uSize.y - capBase), 0.0, 1.0);
    float roll = abs(fract(world.x / 0.285) - 0.5) * 2.0;
    vec3 tile = mix(vec3(0.176, 0.188, 0.192), vec3(0.302, 0.316, 0.320), 1.0 - roll * 0.85);
    tile *= 0.90 + 0.20 * noise2(world * 9.0);
    tile = mix(tile, vec3(0.412, 0.420, 0.412), smoothstep(0.62, 0.90, capT));
    float capMask = smoothstep(capBase - 0.05, capBase + 0.05, above);
    col = mix(col, tile, capMask);

    float capShadow = smoothstep(capBase - 0.90, capBase - 0.06, above) * (1.0 - capMask);
    col *= 1.0 - 0.22 * capShadow;

    /* ---- 瓦当 / 滴水 (eave-end tiles) ---------------------------------- */
    // 压顶的下沿就是檐口。瓦当是压在每垄中线上的圆头（挡住筒瓦的空腔），
    // 滴水是两垄之间那块下垂的尖头（把雨水甩离墙面）—— 一个挡、一个导，
    // 合起来才是"瓦"的收口，缺了它屋脊就只是一卷花纹。
    //
    // 它是唯一一处**画在砖面上**的构件：瓦当本来就出檐、悬在墙面上方，
    // 所以它落在 above < capBase 的区域里是对的。不新增 draw call ——
    // 它和压顶共用同一个片元。
    float eaveDrop = 0.155;                    // 出檐往下垂多少
    float below = capBase - above;             // >0 = 在檐口之下
    float colU = fract(world.x / 0.285);       // 0..1，一垄
    float cx = (colU - 0.5) * 0.285;           // 距本垄中线
    // 瓦当：圆头，上缘贴檐口，直径约半垄
    float dang = 1.0 - smoothstep(0.062, 0.086, length(vec2(cx, below - 0.072)));
    // 滴水：越往下越窄，收成一个尖
    float tipW = mix(0.050, 0.004, clamp(below / eaveDrop, 0.0, 1.0));
    float tip = (1.0 - smoothstep(tipW, tipW + 0.028, abs(abs(cx) - 0.1425)))
              * (1.0 - smoothstep(eaveDrop - 0.030, eaveDrop, below));
    float eaveMask = max(dang, tip) * step(0.0, below)
                   * (1.0 - smoothstep(eaveDrop - 0.030, eaveDrop, below));
    vec3 eaveCol = mix(vec3(0.196, 0.208, 0.214), vec3(0.322, 0.336, 0.340), 1.0 - roll);
    eaveCol *= 0.90 + 0.20 * noise2(world * 12.0);
    col = mix(col, eaveCol, eaveMask);

    /* ---- ink creeper cast on the wall --------------------------------- */
    // Authored with a real 2D canvas rather than as signed distances here:
    // tapered strokes, midribbed leaves and curled tendrils are a drawing,
    // and the canvas is the right tool for it. Held back from full strength:
    // ink belongs on plaster, and at 1.0 it fought the coursing for attention
    // once the wall stopped being white.
    vec4 ink = texture2D(uInk, vUv);
    col = mix(col, ink.rgb, ink.a * uInkStrength);

    /* ---- 冬：压顶与檐口积雪 -------------------------------------------- */
    // 冬天最容易露馅的一笔：地面全白了、屋顶还是黑的，整个场景立刻"假"。
    // 雪只落在**水平的瓦面**上（压顶 capMask 那一段 + 瓦当滴水的檐口），
    // 砖墙立面保持干净 —— 垂直面挂不住雪，这也正是它读起来像"雪后"、
    // 而不是像蒙了一层白纱的原因。
    //
    // ⚠️ uSnow = 0 时「mix(col, x, 0.0)」在数值上严格等于 col，所以其余
    // 三季**逐字节不变**（秋天回归锚点的一部分，别把这一行挪到 ink 之前）。
    float wallSnow = smoothstep(capBase - 0.05, capBase + 0.02, above)
                   + eaveMask * 0.80;
    float wallSnowN = 0.55 + 0.45 * fbm(world * 2.1 + 23.0);
    col = mix(col, vec3(0.930, 0.947, 0.972),
              clamp(uSnow * wallSnow, 0.0, 1.0) * wallSnowN);

    /* ---- paper grain -------------------------------------------------- */
    col *= 0.975 + 0.05 * noise2(vUv * uSize * 24.0);

    /* ---- openings ----------------------------------------------------- */
    float hole = max(rectHole(worldPos, uHoleDoor), rectHole(worldPos, uHoleWindow));
    if (hole > 0.98) discard;

    gl_FragColor = vec4(col, 1.0 - hole);
}
`;

/* ------------------------------------------------------------------ */
/* Cobblestone path with grass verge                                    */
/*                                                                      */
/* The stone body is a jittered voronoi of irregular slabs; everything   */
/* outside the slab band is the shared grassSurface(), in the same       */
/* world frame as the surrounding field — which is what removes the      */
/* seam that used to run down both edges of this plane.                  */
/* ------------------------------------------------------------------ */

export const STONE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;   // plane size in world units
uniform vec2 uOrigin; // world XZ of vUv = (0,0)
// 1 = 这片铺装是**铺在草坪里**的（甬路）：两侧留草边，石缝里长苔。
// 0 = 悬空/贴墙的石台（台明、踏跺顶面）：整块都是石板，缝里是土不是草。
//
// 一个开关管两件事，因为它们是同一件事：这块石板**和草有没有交界**。
// 分成两个 uniform 就会漏 —— 一开始只关了草边，台明的每一条石缝里还留着
// 苔绿色，整片石台看起来像浮在草地上。
uniform float uInLawn;
// 甬路专有的两处绿 —— **必须跟着季节走**，否则冬天草坪白了、石缝还油绿。
// 原来它们写死在下面的 main() 里（vec3(0.427,0.557,0.302) / vec3(0.302,0.400,0.204)），
// 用户 2026-10-09 报的「冬天院子过道的草需要处理下」就是这两处。
// ⚠️ autumn 分发的那两个值**逐位等于原常量**，所以秋天（回归锚点）逐位不变。
uniform vec3 uMossJoint;
uniform vec3 uVergeGreen;

${NOISE_GLSL}
${GRASS_GLSL}

void main() {
    vec2 world = vUv * uSize;
    vec2 gw = uOrigin + world * vec2(1.0, -1.0);   // true world XZ

    // Jittered voronoi cobblestones (~0.34 world units per cell)
    float cellSize = 0.34;
    vec2 g = world / cellSize;
    vec2 gid = floor(g);
    vec2 gf = fract(g);

    float f1 = 8.0;
    float f2 = 8.0;
    vec2 id1 = gid;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 pt = o + hash22(gid + o);
            float d = length(pt - gf);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                id1 = gid + o;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }

    // Stone body where the two nearest sites are far apart (cell interior)
    float interior = f2 - f1;
    float stoneMask = smoothstep(0.05, 0.16, interior);

    // Per-stone warm grey/tan variation.
    //
    // 🔴 2026-10-10：整体压暗（原 0.722 / 0.816 / 0.639 → 现 0.520 / 0.600 / 0.442），
    // **色相不动**（仍是 ~33° 的暖调石板，与青砖墙的冷调对比是有意为之）。
    //
    // 原值太亮：叠上倒角（×1.06）与石材噪声（×1.08）后峰值到 0.934 ⇒ sRGB 238，
    // 也就是**接近纯白**。实测台明顶面 p95 = (221,202,175)，而春/夏/秋三季
    // 逐通道差 ≤ 1 —— 用户 2026-10-10 报的「四季石板路上都是积雪」其实是
    // **石头本身太白**，不是雪（那三季 uSnow 恒为 0）。
    // 判据脚本：harness/shot-apron-seasons.mjs（读 uniform + 采多边形内部像素）。
    vec2 h = hash22(id1);
    vec3 s1 = vec3(0.520, 0.470, 0.408);
    vec3 s2 = vec3(0.600, 0.545, 0.472);
    vec3 s3 = vec3(0.442, 0.396, 0.340);
    vec3 stone = mix(s1, s2, h.x);
    stone = mix(stone, s3, step(0.72, h.y));
    stone *= 0.92 + 0.16 * noise2(world * 4.0);

    // Bevel shading: darker rim toward the joint
    stone *= 0.72 + 0.34 * smoothstep(0.02, 0.22, interior);

    // Mossy dirt between stones. The moss is gated by uInLawn: a stone slab
    // laid in a lawn grows moss in its joints, one sitting on a raised terrace
    // in front of a gate does not — there is nothing feeding it.
    float m = fbm(world * 2.2 + 3.0);
    vec3 dirt = vec3(0.545, 0.463, 0.353);
    // 苔色**跟着季节走**（原来写死成 vec3(0.427,0.557,0.302)）——
    // 冬天那一片油绿的石缝就是这么来的。
    vec3 gapMoss = uMossJoint;
    vec3 gap = mix(dirt, gapMoss, smoothstep(0.45, 0.75, m) * uInLawn);
    gap *= 0.9 + 0.2 * noise2(world * 6.0);

    vec3 pathCol = mix(gap, stone, stoneMask);

    // --- Verge ---------------------------------------------------------
    // Two octaves of wobble on the boundary so the walkway is laid, not
    // ruled. The low frequency gives the path its wander; the high one
    // keeps the edge from looking like a smooth sine.
    float xc = world.x - uSize.x * 0.5;
    float vergeHalf = uSize.x * 0.30;
    float wobble = (noise2(vec2(gw.y * 2.2, 4.7)) - 0.5) * 0.52
                 + (noise2(vec2(gw.y * 6.1, 11.3)) - 0.5) * 0.17;
    float inPath = 1.0 - smoothstep(vergeHalf - 0.12 + wobble, vergeHalf + 0.12 + wobble, abs(xc));
    inPath = mix(1.0, inPath, uInLawn);

    vec3 col = mix(grassSurface(gw), pathCol, inPath);

    // --- 冬：石板上的一层薄雪 -------------------------------------------
    // 厚雪在 grassSurface() 里。石板是**扫过的路**，所以这里只给一层薄得多
    // 的雪：积在石缝和低处，露出石头的暖色。满铺会把甬路变成一条白布，
    // 而雪后的院子恰恰是靠"哪块扫了、哪块没扫"读出来的。
    //
    // 🔴 2026-10-10 改：**与草地同一场雪**（同 SNOW_COL、同 snowCoverage()）。
    // 原来这里是一条独立的噪声 fbm(gw*0.85+17.0)，于是边界两侧的斑驳对不上，
    // 雪是同一片白但"哪块露底"各说各话 —— 用户报的「冬季石板的雪和周边雪地
    // 不融合」就是它。现在两边共用一个覆盖度，只差一个**折率**：
    // 路中间扫得干净、靠边留雪堆（swept 走位置 + 噪声），
    // 于是雪在石板上是"扫剩的斑块"，而不是一层均匀的膜。
    //
    // 「* inPath」仍然必须：草边已经吃过 grassSurface 的厚雪了，再叠一层
    // 就会比草地还白，接缝立刻回来。
    //
    // ⚠️ uSnow = 0 时逐位不变（秋天回归锚点）。
    float swept = mix(0.30, 1.0, smoothstep(vergeHalf * 0.45, vergeHalf + 0.25, abs(xc)));
    swept *= mix(0.75, 1.0, fbm(gw * 1.4 + 5.0));
    col = mix(col, SNOW_COL, uSnow * snowCoverage(gw) * inPath * swept);

    // 沿阶草 border: a real garden path never goes stone-straight-to-lawn.
    // There is always a strip of damp, darker growth hugging the slabs,
    // and drawing it is what turns the edge into a planting line rather
    // than a boundary between two materials.
    float border = 1.0 - smoothstep(0.0, 0.30, abs(abs(xc) - (vergeHalf + wobble)));
    // 沿阶草的颜色同样跟着季节走（原来写死成 vec3(0.302,0.400,0.204)）。
    col = mix(col, uVergeGreen, border * (1.0 - inPath) * 0.38);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Grass field with sparse flowers (replaces the white paper floor)     */
/*                                                                      */
/* A thin wrapper: the material itself lives in grassSurface() above,    */
/* shared with the stone path's verge. All this does is build the true   */
/* world XZ and hand it over.                                            */
/* ------------------------------------------------------------------ */

export const GRASS_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;   // plane size in world units
uniform vec2 uOrigin; // world XZ of vUv = (0,0)

${NOISE_GLSL}
${GRASS_GLSL}

void main() {
    vec2 world = vUv * uSize;
    // The v axis of a -PI/2-rotated ground plane runs against world +Z.
    vec2 gw = uOrigin + world * vec2(1.0, -1.0);

    gl_FragColor = vec4(grassSurface(gw), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Uniform factories                                                    */
/* ------------------------------------------------------------------ */

/**
 * 四季的地面色板。
 *
 * 🔴 **2026-10-10（WO-6）：这三季的绿全部重挑过，"秋天逐位一致"那个锚点作废了。**
 * ---------------------------------------------------------------------------
 * 起因是用户的一句需求：「春：嫩绿草，夏：深绿草，秋：深绿杂黄」。量出来的事实是
 * **三季的草坪几乎一模一样**（1600×900 同机位、草坪像素池、CIE76）：
 *
 * | 季 | 改前均色 | 与秋的 ΔE |
 * |---|---|---|
 * | 春 | rgb(97,125,75) | 6.6 |
 * | 夏 | rgb(82,110,61) | **5.0** |
 * | 秋 | rgb(90,112,70) | — |
 *
 * ΔE 5 是什么概念：**同一个颜色**。用户看到的"四季"里，其实只有冬真换了。
 * 所以这一版把三季按"亮/暗/黄"三个方向拉开（判据是**两两 ΔE ≥ 25**，见
 * `docs/seasons.md` §9.4j），秋天也终于真的是「深绿杂黄」：
 * 底色推成橄榄 + `uLitter` 撒一层黄斑（落叶碎屑）。
 *
 * ⚠️ **代价（必须知道）**：`autumn` 一栏**不再逐位等于**加季节之前的硬编码常量。
 * 那个锚点曾是本方案最便宜的回归保护 —— 现在秋天只有"光照 / 树 / 果实 / 落叶"
 * 仍然逐位（石板早在 WO-7 就脱离了，见 §9.4h）。**替代锚点**是
 * `.workbuddy-ai/wo6-2026-10-10/` 里的 `before-*` 四季定妆照 + sha1。
 *
 * ⚠️ 色板值是 **sRGB 0..1，不是线性**：shader 是无色彩管理的 raw ShaderMaterial，
 * 实测 `uGrassB = [0.302,0.451,0.239]` → 屏幕 `rgb(77,115,61)` = **逐位 ×255**。
 * 所以「色板中点 `(A+B)/2`」≈ 屏幕基色 —— 这是设计这些数的唯一依据，
 * 也是"改了色板画面一定跟着变"的证明（不必等渲染出来才知道方向）。
 *
 * 花色的第 1 阶（奶白那一档）在 GLSL 里仍是基准常量，这里给的是 2..4 阶。
 *
 * 🔴 `uMossJoint` / `uVergeGreen`（2026-10-09 补）
 * ------------------------------------------------
 * 这两个是**甬路专有**的两处绿，原先**写死在 STONE_FRAG 的 GLSL 里**：
 *   石缝里的苔  `vec3(0.427, 0.557, 0.302)`
 *   贴边的沿阶草 `vec3(0.302, 0.400, 0.204)`
 * 于是草坪都换成冬色了、甬路的石缝还是一片**油绿** —— 用户报的
 * 「冬天院子过道的草需要处理下」。它们早该跟 `uMoss` 一起走季节。
 * 现在两栏都按当季 `uGrassA` / `uGrassB` 派生（石缝苔 ≈ A × 1.05、
 * 沿阶草 ≈ B × 1.06），所以甬路与草坪永远同一族色，不会再各说各话。
 */
/**
 * 落叶碎屑的黄 —— 「深绿杂黄」里的那个黄。四季共用同一个值，
 * 只有秋天把 `uLitter` 开起来（其余三季为 0 ⇒ 逐位不受影响）。
 * sRGB (199,153,51)：干叶的暖黄，比花色的奶白明显偏橙，不至于被读成花。
 */
const LITTER_COL = [0.780, 0.600, 0.200];

const SEASON_GROUND = {
    /* 春：**嫩绿** —— 三季里最亮、最黄（Lab L*≈71 / C*≈44 / h≈124°）。
     * 花最多（0.16）且偏粉白 —— 春是唯一"多花"的一季。
     * 中点 sRGB ≈ (152,185,105)。 */
    spring: {
        uGrassA: [0.639, 0.779, 0.452],
        uGrassB: [0.551, 0.669, 0.375],
        uMoss: [0.617, 0.749, 0.420],
        uMossJoint: [0.671, 0.818, 0.475],
        uVergeGreen: [0.584, 0.709, 0.398],
        uTip: [0.088, 0.107, 0.060],
        uFlowerA: [0.960, 0.878, 0.898],
        uFlowerB: [0.925, 0.760, 0.800],
        uFlowerC: [0.960, 0.941, 0.878],
        uFlowerDensity: 0.16,
        uSnow: 0,
        uLitterCol: LITTER_COL,
        uLitter: 0,
    },
    /* 夏：**深绿** —— 三季里最暗、最饱和、最"正绿"（L*≈28 / C*≈38 / h≈142°）。
     * 中点 sRGB ≈ (19,76,28)。 */
    summer: {
        uGrassA: [0.120, 0.355, 0.147],
        uGrassB: [0.032, 0.245, 0.070],
        uMoss: [0.036, 0.274, 0.078],
        uMossJoint: [0.126, 0.373, 0.154],
        uVergeGreen: [0.034, 0.260, 0.074],
        uTip: [0.005, 0.039, 0.011],
        uFlowerA: [0.960, 0.941, 0.878],
        uFlowerB: [0.937, 0.855, 0.549],
        uFlowerC: [0.839, 0.522, 0.463],
        uFlowerDensity: 0.08,
        uSnow: 0,
        uLitterCol: LITTER_COL,
        uLitter: 0,
    },
    /* 秋：**深绿杂黄** —— 底色是暗橄榄（L*≈40 / h≈105°，比夏明显偏黄），
     * 再靠 `uLitter` 撒一层黄斑（落叶碎屑）把"杂"字画出来。
     * 中点 sRGB ≈ (96,98,21)。
     *
     * ⚠️ 这一栏**不再是**"加季节之前的原值"（见上面的大警告）。 */
    autumn: {
        uGrassA: [0.420, 0.439, 0.121],
        uGrassB: [0.332, 0.329, 0.044],
        uMoss: [0.372, 0.368, 0.049],
        uMossJoint: [0.441, 0.461, 0.127],
        uVergeGreen: [0.352, 0.349, 0.046],
        uTip: [0.053, 0.053, 0.007],
        uFlowerA: [0.937, 0.855, 0.549],
        uFlowerB: [0.906, 0.729, 0.780],
        uFlowerC: [0.839, 0.522, 0.463],
        uFlowerDensity: 0.08,
        uSnow: 0,
        uLitterCol: LITTER_COL,
        uLitter: 0.5,
    },
    /* 冬：枯黄底 + 全覆雪，一朵花都没有。**这一季没有改**（它就是那 34~43 的
     * 参照物：其余三季之所以要重挑，正是因为它们都挤在冬的对立面挤成了一团）。 */
    winter: {
        uGrassA: [0.478, 0.463, 0.353],
        uGrassB: [0.365, 0.353, 0.271],
        uMoss: [0.408, 0.400, 0.318],
        // 石缝：比周围稍亮的**冻土**（仍带一点暖），不是苔。
        uMossJoint: [0.543, 0.532, 0.423],
        // 沿阶草：枯草色，和周围的冬草同一族。
        uVergeGreen: [0.408, 0.400, 0.318],
        uTip: [0.075, 0.071, 0.055],
        uFlowerA: [0.960, 0.941, 0.878],
        uFlowerB: [0.960, 0.941, 0.878],
        uFlowerC: [0.960, 0.941, 0.878],
        uFlowerDensity: 0,
        uSnow: 1,
        uLitterCol: LITTER_COL,
        uLitter: 0,
    },
};

/* ------------------------------------------------------------------ */
/* 季节调色板（JS 侧）—— 外墙藤蔓 + 窗下花箱                            */
/*                                                                      */
/* 为什么和 SEASON_GROUND 挤在一个文件里                                 */
/* ------------------------------------------------------------------ */
/* 「同一张表写两遍，迟早在某个文件里漂移」是这个项目最贵的一课（见        */
/* config/seasons.js 开头）。四季的颜色现在有三组消费者：                 */
/*   · 地面 / 幕墙 / 甬路 → SEASON_GROUND（shader uniform）              */
/*   · 外墙藤蔓（常春藤）→ SEASON_INK_TINT（shader uniform，乘在贴图上）  */
/*   · 窗下花箱的绿植    → SEASON_PLANT（**JS 颜色**，喂 meshStandardMaterial）*/
/* 前两组必须是 sRGB 0..1 的数组（shader 要），第三组是 CSS 字符串        */
/* （three 的 material.color 要）。都放这儿 —— 改一季能一眼看全。         */

/**
 * 外墙藤蔓（当常春藤看）的**季节叶色乘数**，乘在 `makeWallInkTexture` 画出来的
 * 贴图上（见 `INK_OVERLAY_FRAG`）。
 *
 * 为什么是"乘"而不是重烘贴图
 * --------------------------
 * 藤蔓是 canvas 画的，重烘一次是 1280×768 的画布；为一次换季重烘不值得。
 * 而且用户要的只是「**稍微**改下叶子颜色深浅」（2026-10-10 原话）。
 * 乘法只动 rgb、**不动 alpha** ⇒ 藤蔓的枝形与轮廓逐位不变。
 *
 * 取值的分寸
 * ----------
 * **夏 = [1,1,1]，即完全不动** —— 它是参照季，也是常春藤最绿的时候；改前
 * 那套颜色就是夏天的样子。其余三季都在 **±25 %** 以内，色相只动一点点：
 * 要的是"同一株常春藤的四季"，不是"四种不同的植物"。
 * ⚠️ 常春藤是**常绿**的 —— 冬天只变暗变闷，**不许变白、也不许掉叶**。
 */
export const SEASON_INK_TINT = {
    spring: [1.14, 1.20, 0.92],  // 嫩：最亮、偏黄绿（G 抬得最多）
    summer: [1.00, 1.00, 1.00],  // 参照季（= 改动前本来的样子）
    autumn: [1.24, 1.02, 0.62],  // 转黄：R 抬、B 砍掉近四成 ⇒ 偏橄榄/黄绿
    winter: [0.78, 0.83, 0.85],  // 暗：整体压暗、略偏灰（但仍然是绿的）
};

/**
 * 窗下花箱那丛绿植的四季配色（`EntranceProps.jsx` 的 `WoodenPlanter`）。
 *
 * 与 `SEASON_GROUND` 是同一个思路的两套数：春嫩、夏浓、秋转黄、冬沉。
 * **`summer` 就是改动前写死的那三个值**（`#3F7A35` / `#4C8A3F` / `#5FA24A`），
 * 所以夏天看起来和以前一模一样 —— 这也让 A/B 有了一个"必须逐位不变"的对照季。
 */
export const SEASON_PLANT = {
    spring: { stem: '#4E8F42', leafA: '#5C9E4B', leafB: '#72B65C' },
    summer: { stem: '#3F7A35', leafA: '#4C8A3F', leafB: '#5FA24A' },
    autumn: { stem: '#5A7A2E', leafA: '#6B8A33', leafB: '#86A244' },
    winter: { stem: '#2F5A2B', leafA: '#3A6B36', leafB: '#48793F' },
};

/** 某一季的地面色板 → three 的 uniform 对象。未知季节落到秋天。 */
export function groundSeasonUniforms(season = 'autumn') {
    const p = SEASON_GROUND[season] || SEASON_GROUND.autumn;
    return {
        uGrassA: { value: p.uGrassA },
        uGrassB: { value: p.uGrassB },
        uMoss: { value: p.uMoss },
        uMossJoint: { value: p.uMossJoint },
        uVergeGreen: { value: p.uVergeGreen },
        uTip: { value: p.uTip },
        uFlowerA: { value: p.uFlowerA },
        uFlowerB: { value: p.uFlowerB },
        uFlowerC: { value: p.uFlowerC },
        uFlowerDensity: { value: p.uFlowerDensity },
        uSnow: { value: p.uSnow },
        uLitterCol: { value: p.uLitterCol },
        uLitter: { value: p.uLitter },
    };
}

/**
 * 把某一季的地面色板**写进已有的 uniform 对象**（就地改 `.value`），返回同一个对象。
 *
 * ⚠️ 为什么不能直接换掉 `material.uniforms`
 * ----------------------------------------
 * three 在材质上缓存 `materialProperties.uniformsList` —— 一串指向 uniform
 * **对象**的引用（`{ id, uniform }`），上传时读的是这些对象里的 `.value`。
 * 它只在 **program 变化**时被置 null 重建（见 three 的 `getProgram()` 末尾
 * `materialProperties.uniformsList = null`），而 R3F 更新 `uniforms` prop 走的是
 * `applyProps` 的最后一个分支 `root[key] = value` —— **整体替换**。
 *
 * 于是「把 season 放进 useMemo 依赖、换一个新 uniforms 对象」这种写法会：
 * 对象换了 → 上传的还是旧对象 → 画面**静默停在旧季节**，没有任何报错。
 * （`material.needsUpdate = true` 也救不了：program 缓存命中且 currentProgram
 * 未变时会 early-return，`uniformsList` 照样不重建。）
 *
 * 唯一稳的写法：**保留 uniform 对象本身，只改 `.value`**。数组与数字都是每帧
 * 现读的，所以直接换掉 `.value` 的引用就够，不必逐元素写。
 *
 * 只写 `groundSeasonUniforms` 里出现的那些键 —— 调用方自己加的
 * `uInk` / `uHoleDoor` / `uCapFrac` 等**原样不动**。
 *
 * @param {object} uniforms 就地更新，并原样返回
 * @param {string} season
 */
export function applyGroundSeason(uniforms, season) {
    const next = groundSeasonUniforms(season);
    for (const key in next) {
        const slot = uniforms[key];
        if (slot) slot.value = next[key].value;
    }
    return uniforms;
}

export function makeSurfaceUniforms(width, height, origin = [0, 0], season = 'autumn') {
    return {
        uSize: { value: [width, height] },
        uOrigin: { value: origin },
        // 下面两个只有部分 shader 声明；three 会忽略多余的 uniform。
        // 放在这里而不是让调用方自己加，是因为漏传时 GLSL 的默认值是 0 ——
        // 那会让 uInLawn=0 的甬路整条没有石板、uCapFrac=0 的墙整面变成黑瓦。
        // 默认值必须落在"正常的墙/正常的路"这一侧。
        uInLawn: { value: 1 },     // STONE_FRAG：1 = 铺在草坪里的甬路
        uCapFrac: { value: 0.905 }, // SONG_WALL_FRAG：压顶起始高度占墙高的比例
        // 季节地面色板。**默认秋天**，所以忘记传 season 的调用方既不会变黑
        // 也不会拿到 undefined。⚠️ 但秋天自 WO-6 起**不再是**"加季节之前的原值"
        // （见 SEASON_GROUND 上面的大警告），所以"漏传 season"仍然是个 bug ——
        // 它只会静默地把这一块冻在秋天。所有调用方都必须显式传 season。
        ...groundSeasonUniforms(season),
    };
}
