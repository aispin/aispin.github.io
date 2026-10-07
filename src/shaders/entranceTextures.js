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

vec3 grassSurface(vec2 gw) {
    // --- Grass base: two octaves of noise for patchy tone ---
    // Muted deliberately. A Song garden is not a lawn: the greens are pulled
    // toward moss and olive so the wall and the orange fruit are the only
    // things that read as bright.
    float n1 = noise2(gw * 1.1);
    float n2 = fbm(gw * 3.0 + 11.0);
    vec3 col = mix(vec3(0.408, 0.514, 0.298), vec3(0.278, 0.400, 0.220), n1 * 0.65 + n2 * 0.35);

    // Blade tufts: two crossed stretched-noise layers give a soft, non-
    // directional shag instead of a single hard streak direction.
    float bladesA = noise2(vec2(gw.x * 22.0, gw.y * 4.0));
    float bladesB = noise2(vec2(gw.x * 4.0, gw.y * 19.0));
    float blades = mix(bladesA, bladesB, 0.45);
    col *= 0.92 + 0.16 * blades;
    // Sunlit tips
    col += vec3(0.040, 0.062, 0.024) * smoothstep(0.82, 0.99, blades);
    // Shadowed clumps
    col *= 1.0 - 0.12 * smoothstep(0.78, 0.97, n2);

    // Moss gathering in the shadier patches — this is what makes the ground
    // read as a garden floor rather than as turf.
    float mossN = fbm(gw * 1.7 + 33.0);
    col = mix(col, vec3(0.322, 0.416, 0.224), smoothstep(0.56, 0.84, mossN) * 0.45);

    // --- Sparse flowers: jittered world grid, roughly one every five cells ---
    float cell = 0.95;
    vec2 g = gw / cell;
    vec2 gid = floor(g);
    vec2 gf = fract(g);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 h = hash22(gid + o);
            // Keep only ~8% of the cells. A Song garden plants a few things
            // deliberately; a meadow of flowers is the wrong century.
            if (h.x > 0.08) continue;

            // Jittered centre inside the cell, never right on the border
            vec2 c = o + 0.24 + h * 0.52;
            vec2 p = gf - c;

            // Petal tint: restrained — cream, pale gold, faded rose, muted red
            float t = hash21((gid + o) * 1.37 + 5.1);
            vec3 petal = mix(vec3(0.960, 0.941, 0.878), vec3(0.937, 0.855, 0.549), smoothstep(0.0, 0.34, t));
            petal = mix(petal, vec3(0.906, 0.729, 0.780), smoothstep(0.34, 0.68, t));
            petal = mix(petal, vec3(0.839, 0.522, 0.463), smoothstep(0.68, 1.0, t));
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

    // Per-stone warm grey/tan variation
    vec2 h = hash22(id1);
    vec3 s1 = vec3(0.722, 0.663, 0.592);
    vec3 s2 = vec3(0.816, 0.745, 0.639);
    vec3 s3 = vec3(0.639, 0.580, 0.514);
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
    vec3 gapMoss = vec3(0.427, 0.557, 0.302);
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

    // 沿阶草 border: a real garden path never goes stone-straight-to-lawn.
    // There is always a strip of damp, darker growth hugging the slabs,
    // and drawing it is what turns the edge into a planting line rather
    // than a boundary between two materials.
    float border = 1.0 - smoothstep(0.0, 0.30, abs(abs(xc) - (vergeHalf + wobble)));
    col = mix(col, vec3(0.302, 0.400, 0.204), border * (1.0 - inPath) * 0.38);

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

export function makeSurfaceUniforms(width, height, origin = [0, 0]) {
    return {
        uSize: { value: [width, height] },
        uOrigin: { value: origin },
        // 下面两个只有部分 shader 声明；three 会忽略多余的 uniform。
        // 放在这里而不是让调用方自己加，是因为漏传时 GLSL 的默认值是 0 ——
        // 那会让 uInLawn=0 的甬路整条没有石板、uCapFrac=0 的墙整面变成黑瓦。
        // 默认值必须落在"正常的墙/正常的路"这一侧。
        uInLawn: { value: 1 },     // STONE_FRAG：1 = 铺在草坪里的甬路
        uCapFrac: { value: 0.905 } // SONG_WALL_FRAG：压顶起始高度占墙高的比例
    };
}
