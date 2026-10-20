/**
 * Procedural entrance art (zero image assets)
 *
 * The entrance used to pull four hand-painted webp bitmaps off disk:
 *
 *   avatar_window.webp  — the character who waves at you from the window（2026-10-20 删除）
 *   tree_colored.webp   — the big watercolour tree the wind chime hangs from
 *   speech_bubble.webp  — the rubber duck's speech bubble
 *   bug_sketch.webp     — the wandering ladybird you can click
 *
 * All four were drawn on an offscreen <canvas> and wrapped in a
 * THREE.CanvasTexture, matching the convention already used by
 * utils/doorArt.js (doors), utils/proceduralTextures.js (floors/trim),
 * utils/cursorArt.js (cursors) and shaders/entranceTextures.js (bricks).
 *
 * （`avatar_window.webp` 后来一度"回到位图"当 IP 插画，2026-10-20 又按用户
 *  要求整个删掉了 —— 见下面「Avatar at the window — REMOVED」。现在门前
 *  一张磁盘位图都没有。）
 *
 * Why bother: the bitmaps were 481 KB of downloads that had to be fetched
 * before the entrance could finish fading in, they were baked at a fixed
 * resolution (the tree was 1010×945 stretched onto a 6×8 plane, i.e. squashed
 * ~1.4× vertically), and every one of them was a binary blob nobody could
 * restyle. Drawn in code they cost nothing, are crisp at any zoom, and the
 * palette lives next to the rest of the scene's colours.
 *
 * Every generator caches per key, so callers may call them on every render.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32 } from '../engine/art';
// 竹篱上的攀爬植物复用花箱那套四季叶色 —— 「同一张表写两遍，迟早在某个文件里漂移」
// 是这个项目最贵的一课（见 config/seasons.js 开头）。依赖是**单向**的：
// entranceTextures.js 只导出数据/shader，不 import 本文件，所以不会成环。
//
// ⚠️ 2026-10-11：这里原来还 import 了 `SEASON_PLANT`（给已删的
//    `makeBambooFenceTexture` 用）。墙脚那道矮竹篱换成狗尾巴草之后，
//    那个函数一起删了，这个 import 也就成了死引用 —— 一并去掉。

const cache = new Map();

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function toTexture(canvas, key) {
    if (cache.has(key)) return cache.get(key);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}

/**
 * Closed wobbly ellipse. Straight segments with a per-vertex radius jitter
 * read as a pencil outline instead of a CAD-perfect ellipse.
 */
function wobblePath(ctx, cx, cy, rx, ry, rand, { amp = 0.05, segments = 24, rot = 0 } = {}) {
    ctx.beginPath();
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const k = 1 + (rand() - 0.5) * amp * 2;
        const px = Math.cos(a) * rx * k;
        const py = Math.sin(a) * ry * k;
        const x = cx + px * cos - py * sin;
        const y = cy + px * sin + py * cos;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

/**
 * Watercolour wash: the same silhouette filled several times with a small
 * random offset and a low alpha. The overlapping translucent passes build up
 * the blotchy, slightly-bleeding edge a single flat fill can't fake.
 */
function wash(ctx, buildPath, color, rand, { passes = 4, spread = 6, alpha = 0.3 } = {}) {
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < passes; i++) {
        ctx.save();
        ctx.globalAlpha = alpha * (0.7 + rand() * 0.6);
        ctx.translate((rand() - 0.5) * spread, (rand() - 0.5) * spread);
        buildPath(ctx);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

/** Pencil outline, stroked twice with a slight offset for a doubled line. */
function inkOutline(ctx, buildPath, color, width, rand, { double = true } = {}) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    buildPath(ctx);
    ctx.stroke();
    if (double) {
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = width * 0.62;
        ctx.save();
        ctx.translate((rand() - 0.5) * width * 0.8, (rand() - 0.5) * width * 0.8);
        buildPath(ctx);
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();
}

/**
 * Grain / speckle. Uses `source-atop` so it only lands on pixels that are
 * already opaque — plain `multiply` would also dust the transparent margin
 * and put visible specks in mid-air.
 */
function grain(ctx, w, h, rand, { count, alpha = 0.05, color = '#6B5A44', size = 1.3 } = {}) {
    const n = count ?? Math.round((w * h) / 110);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
        ctx.fillRect(rand() * w, rand() * h, size, size);
    }
    ctx.restore();
}

/** Soft lightening/darkening speckle clipped to a path — leaf and shell texture. */
function speckleIn(ctx, buildPath, colors, rand, { count = 160, rMin = 2, rMax = 9, alpha = 0.22 } = {}) {
    ctx.save();
    buildPath(ctx);
    ctx.clip();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < count; i++) {
        ctx.fillStyle = colors[(rand() * colors.length) | 0];
        const r = rMin + rand() * (rMax - rMin);
        ctx.beginPath();
        ctx.arc(rand() * ctx.canvas.width, rand() * ctx.canvas.height, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Round-capped tapered stroke, used for limbs, stems and rope. */
function limb(ctx, pts, width, color, { taper = 0.55 } = {}) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
        const t = pts.length > 1 ? i / (pts.length - 1) : 0;
        ctx.lineWidth = width * (1 - (1 - taper) * t);
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
        ctx.stroke();
    }
    ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */

const INK = '#3A2E28';
const INK_SOFT = '#5A4636';

/* ------------------------------------------------------------------ */
/* Ladybird — the wandering bug above the window                        */
/* ------------------------------------------------------------------ */

/**
 * 瓢虫. Redrawn 2026-10-08.
 *
 * WHAT WAS WRONG
 * --------------
 * The first version stroked TWO closed paths — a "head" and a "shell" — and
 * the head path was a **D**: a dome closed with a *straight* line from
 * (400,272) back to (112,272). It was stroked *after* the shell had been
 * filled, so that flat bottom edge and the two vertical ends of the dome
 * landed on top of the orange body as a hard black **rectangle bracket**
 * straight across the eyes. At the size this thing is actually seen (a 0.4
 * unit plane, ~100 px on screen) the bracket plus the 12 px shell outline
 * read as exactly what the user reported: 一个黑圈.
 *
 * The eyes were also drawn at 56 px radius on a head that is only ~92 px
 * tall, so they overflowed the head and sat on the wing cases.
 *
 * THE FIX
 * -------
 * One silhouette, one outline. `bodyPath` is the union of the head dome and
 * the shell as a single closed curve, and it is the ONLY path that gets an
 * ink stroke — so a bracket is not expressible any more. Everything else
 * (pronotum cap, seam, spots) is clipped to it. Eyes are down to 42 px and
 * live inside the dark pronotum cap, the way a real ladybird's head does.
 *
 * The outline is stroked with `double: false`. `inkOutline`'s second pass
 * offsets the path by up to 0.8 x width and strokes at 0.38 alpha, which
 * puts a soft dark echo *outside* the silhouette — at scene scale that is a
 * halo, i.e. another ring. Crisp single stroke here.
 */
export function makeLadybirdTexture() {
    const key = 'entrance:ladybird';
    if (cache.has(key)) return cache.get(key);

    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const SHELL = '#E8552A';
    const SHELL_HI = '#F58A44';
    const SHELL_LO = '#C4351A';
    const DARK = '#2E2320';
    const cx = 256;

    /** Head dome + shell, as ONE closed silhouette. */
    const bodyPath = (c) => {
        c.beginPath();
        c.moveTo(158, 176);
        c.bezierCurveTo(162, 92, 350, 92, 354, 176);   // head dome
        c.bezierCurveTo(394, 200, 428, 240, 428, 302); // right shoulder
        c.bezierCurveTo(428, 388, 352, 460, 256, 460); // bottom right
        c.bezierCurveTo(160, 460, 84, 388, 84, 302);   // bottom left
        c.bezierCurveTo(84, 240, 118, 200, 158, 176);  // left shoulder
        c.closePath();
    };

    /** 前胸背板 + head: the dark cap across the top, rear edge dipped. */
    const capPath = (c) => {
        c.beginPath();
        c.moveTo(150, 180);
        c.bezierCurveTo(156, 90, 356, 90, 362, 180);
        c.bezierCurveTo(344, 216, 300, 224, cx, 216);
        c.bezierCurveTo(212, 224, 168, 216, 150, 180);
        c.closePath();
    };

    // --- antennae (behind everything) ---
    limb(ctx, [[216, 128], [198, 88], [174, 58], [160, 40]], 10, DARK, { taper: 0.5 });
    limb(ctx, [[296, 128], [314, 88], [338, 58], [352, 40]], 10, DARK, { taper: 0.5 });
    [[160, 40], [352, 40]].forEach(([x, y]) => {
        ctx.save();
        ctx.fillStyle = DARK;
        ctx.beginPath();
        ctx.ellipse(x, y, 15, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // --- legs (behind the shell) ---
    [-1, 1].forEach((s) => {
        [[296, 30], [356, 40], [414, 34]].forEach(([y, drop]) => {
            const x0 = cx + s * 152;
            limb(ctx, [[x0, y], [x0 + s * 32, y + 20], [x0 + s * 50, y + drop + 20]], 11, DARK, { taper: 0.55 });
        });
    });

    // --- body: solid fill, then blotchy watercolour clipped inside it ---
    ctx.save();
    ctx.fillStyle = SHELL;
    bodyPath(ctx);
    ctx.fill();
    ctx.restore();
    wash(ctx, bodyPath, SHELL, rand, { passes: 4, spread: 8, alpha: 0.22 });
    speckleIn(ctx, bodyPath, [SHELL_HI, SHELL_LO, '#F26B33', '#D94A20'], rand,
        { count: 260, rMin: 3, rMax: 14, alpha: 0.22 });

    // --- dark head + pronotum cap, clipped to the silhouette ---
    ctx.save();
    bodyPath(ctx);
    ctx.clip();
    ctx.fillStyle = DARK;
    capPath(ctx);
    ctx.fill();
    ctx.restore();

    // --- wing-case seam ---
    ctx.save();
    bodyPath(ctx);
    ctx.clip();
    ctx.strokeStyle = DARK;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, 214);
    ctx.bezierCurveTo(cx - 7, 300, cx - 7, 392, cx, 452);
    ctx.stroke();

    // --- spots (symmetric about the seam) ---
    ctx.fillStyle = DARK;
    [[172, 292, 31, 28], [340, 292, 31, 28], [140, 372, 25, 22], [372, 372, 25, 22],
     [196, 428, 23, 20], [316, 428, 23, 20]].forEach(([x, y, rx, ry]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();

    // --- soft top-left highlight so the shell reads as domed ---
    ctx.save();
    bodyPath(ctx);
    ctx.clip();
    const hl = ctx.createRadialGradient(190, 250, 20, 210, 280, 240);
    hl.addColorStop(0, 'rgba(255, 226, 190, 0.30)');
    hl.addColorStop(0.6, 'rgba(255, 226, 190, 0.07)');
    hl.addColorStop(1, 'rgba(255, 226, 190, 0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    // --- face: two eyes inside the dark cap ---
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    [[204, 158, 42], [308, 158, 42]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 1.04, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = '#241B17';
    [[211, 163, 22], [301, 163, 22]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = '#FFFFFF';
    [[200, 152, 8.5], [290, 152, 8.5]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();

    // --- the one and only outline ---
    inkOutline(ctx, bodyPath, DARK, 11, rand, { double: false });

    grain(ctx, S, S, rand, { alpha: 0.045 });

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* Speech bubble — the rubber duck's line                               */
/* ------------------------------------------------------------------ */

export function makeSpeechBubbleTexture() {
    const key = 'entrance:speech-bubble';
    if (cache.has(key)) return cache.get(key);

    const W = 1152;
    const H = 768;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const bubblePath = (c) => {
        c.beginPath();
        c.moveTo(586, 62);
        c.bezierCurveTo(806, 62, 1046, 140, 1058, 300);
        c.bezierCurveTo(1070, 452, 900, 566, 700, 574);
        c.bezierCurveTo(596, 578, 520, 570, 452, 566);
        c.lineTo(452, 566);
        // tail
        c.bezierCurveTo(430, 640, 356, 690, 268, 726);
        c.bezierCurveTo(330, 690, 372, 636, 372, 578);
        c.bezierCurveTo(210, 546, 104, 452, 100, 320);
        c.bezierCurveTo(96, 160, 344, 62, 586, 62);
        c.closePath();
    };

    wash(ctx, bubblePath, '#FCF4E2', rand, { passes: 5, spread: 8, alpha: 0.34 });
    speckleIn(ctx, bubblePath, ['#F6E7C8', '#EFDDB8', '#FFFCF0'], rand, {
        count: 320, rMin: 8, rMax: 34, alpha: 0.16,
    });

    // warm rim shading
    ctx.save();
    bubblePath(ctx);
    ctx.clip();
    const grad = ctx.createRadialGradient(560, 300, 120, 560, 300, 560);
    grad.addColorStop(0, 'rgba(255,252,240,0)');
    grad.addColorStop(0.72, 'rgba(233,213,175,0.22)');
    grad.addColorStop(1, 'rgba(214,186,140,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    inkOutline(ctx, bubblePath, INK_SOFT, 9, rand);

    grain(ctx, W, H, rand, { alpha: 0.05, size: 1.6 });

    return toTexture(canvas, key);
}

/** One persimmon leaf: pointed ellipse, midrib, two side veins. */
function drawLeaf(c, x, y, ang, len, wid, fill, rib, alpha) {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.globalAlpha = alpha;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(len * 0.24, -wid, len * 0.74, -wid * 0.9, len, 0);
    c.bezierCurveTo(len * 0.74, wid * 0.9, len * 0.24, wid, 0, 0);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.globalAlpha = alpha * 0.72;
    c.strokeStyle = rib;
    c.lineWidth = Math.max(0.7, wid * 0.11);
    c.beginPath();
    c.moveTo(len * 0.08, 0);
    c.lineTo(len * 0.9, 0);
    c.stroke();
    c.globalAlpha = alpha * 0.50;
    c.lineWidth = Math.max(0.5, wid * 0.07);
    for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(len * 0.34, 0);
        c.quadraticCurveTo(len * 0.52, s * wid * 0.34, len * 0.66, s * wid * 0.42);
        c.stroke();
        c.beginPath();
        c.moveTo(len * 0.54, 0);
        c.quadraticCurveTo(len * 0.7, s * wid * 0.3, len * 0.82, s * wid * 0.32);
        c.stroke();
    }
    c.restore();
}

/* ------------------------------------------------------------------ */
/* Ink vines for the courtyard wall                                      */
/* ------------------------------------------------------------------ */

/**
 * The ink wash the courtyard wall is overlaid with, in SONG_WALL_FRAG.
 *
 * WHAT IT IS
 * ----------
 * A creeper that has come over the wall: a woody runner lying along the
 * 黑瓦 coping carrying most of the foliage, with bare-ish strands dangling
 * down the brick below it. It replaced a bamboo grove that grew UP from the
 * ground on both sides of the gate. The user's note was
 * 「外墙上的竹影去掉，改为从上而下的藤蔓（柿子树的另一边的墙）」, so the
 * direction of growth is the point: bamboo is drawn root-to-tip and reads as
 * a grove standing on the lawn, a creeper is drawn tip-to-root and reads as
 * something spilling over from the neighbouring garden.
 *
 * WHY THE RIGHT HALF ONLY
 * -----------------------
 * The persimmon tree hangs on the left (EntranceDoors parks it at world
 * x = -2.9), so the ink lives on the other side of the gate and the two
 * never fight for the same panel. The window is at world x = 2.5, and the
 * runners are spaced to dangle either side of it (x ≈ 1.2 / 1.6 / 3.5 /
 * 4.1 / 4.6) rather than across it — the wall plane discards its window
 * hole, so ink could not paint over the opening anyway, but leaves crowding
 * the architrave would still read as dirt rather than as a plant.
 *
 * WHY A CANVAS AND NOT THE SHADER
 * -------------------------------
 * A creeper is a drawing: tapered strokes, leaf shapes with midribs, curled
 * tendrils, wet-edge blotches. Canvas2D does those in a line; GLSL does them
 * in fifty.
 *
 * The canvas maps 1:1 onto the facade with its origin at the GROUND, so `x`
 * is world x and `above` is height off the ground. EntranceDoors parks the
 * facade's bottom edge on floorY, which is what makes that true.
 *
 * Parameterised by facade size rather than assuming 16 x 8. The canvas is
 * sized at a fixed 128 px per world unit, so every brush constant below
 * (leaf length, stroke width, the 5 px doubled-line offset) keeps its world
 * size when the facade changes — scaling a fixed 2048 x 1024 canvas instead
 * would have scaled the vine along with it. Shrinking the facade from
 * 16 x 8 to 10 x 6 also takes this texture from 8.4 MB to 3.9 MB.
 */

/**
 * 藤蔓**锚点**在画布上的高度比例（从底边算起）。0.92 ⇒ 上面 8% 是空的，
 * 藤是从那里"从瓦后面钻出来"的。
 *
 * ⚠️ 导出给 `EntranceDoors` 用：门脸没了之后，那块 overlay 的竖向位置必须
 * 由"压顶下沿"反推（`INK_CENTER_Y = 压顶线 − INK_H × INK_TOP_FRAC + INK_H / 2`），
 * 否则藤会挂在屋面以上、浮在屋顶外面。两边必须用**同一个**数。
 */
export const INK_TOP_FRAC = 0.92;

export function makeWallInkTexture(worldW = 16, worldH = 8) {
    const key = `entrance:wall-ink:${worldW}x${worldH}`;
    if (cache.has(key)) return cache.get(key);

    const PX = 128; // canvas pixels per world unit
    const W = Math.round(worldW * PX);
    const H = Math.round(worldH * PX);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const X = (worldX) => (worldX + worldW / 2) * PX;
    const Y = (above) => (worldH - above) * PX;

    /* ---- the creeper's palette ------------------------------------------
     *
     * THIS USED TO BE ONE NEAR-BLACK GREEN, AND IT CAME OUT GREY.
     *
     * The old value was `INK = '#243528'`. It *is* green — G−R = 0.067. The
     * problem is that a colour that dark carries almost no chroma, so the
     * mix destroys what little it has. The shader does
     * `col = mix(col, ink.rgb, ink.a * uInkStrength)`, and the effective
     * factor here is leaf alpha (0.40..0.68) × uInkStrength — about 0.23.
     * At 0.23 the surviving chroma is 0.067 × 0.23 ≈ 0.015, i.e. **4/255**,
     * which no eye can see. Over the grey-blue 青砖 that is a neutral grey
     * vine — exactly what the user reported.
     *
     * The fix is not "more green", it is **lighter green**: mid-tone greens
     * hold their chroma through the mix because the absolute gap between
     * their R and G is large. `LEAF_MID` is (0.294, 0.455, 0.192) — G−R is
     * 0.161, and at the same 0.47 mix that lands as ~22/255. Same wash, same
     * watercolour passes, actually green.
     *
     * Three tones rather than one, because a single fill turns the mass into
     * a flat silhouette. Distribution is biased to the middle: mostly
     * shadowed body, a few deep gaps, a few sunlit leaves on top.
     *
     * --- second pass, 2026-10-07 evening (user: "调绿点 / 有点半透明的模糊感")
     *
     * "More green" again means *widening G−R*, not darkening: the three tones
     * moved from G−R of 28 / 41 / 46 to 35 / 59 / 62 out of 255, by dropping
     * R and B while holding or lifting G. The mass is now unambiguously green
     * over the blue-grey brick instead of merely "not grey".
     *
     * The translucency was a *separate* problem and is fixed separately — see
     * the per-stroke alphas below and `uInkStrength` in EntranceDoors: the
     * leaf fill sat at 0.36..0.74 alpha, so the brick coursing showed straight
     * through the foliage and every edge read as soft. Between the two knobs
     * the effective compositing factor went from ~0.31..0.64 to ~0.56..0.92.
     */
    const LEAF_DEEP = '#274A12';   // the gaps between leaves
    const LEAF_MID = '#3F7A22';    // the body of the mass — the dominant tone
    const LEAF_LIT = '#68A634';    // leaves catching the light
    const STEM = '#4C4A29';        // the woody runner: olive-brown, not green
    const INK_RIB = '#182E0B';     // midrib / veins / stem outline

    /** Pick a leaf tone. `lit` forces the sunlit one for leaves on the crown. */
    const leafTone = (lit) => {
        if (lit) return rand() < 0.45 ? LEAF_LIT : LEAF_MID;
        const r = rand();
        if (r < 0.44) return LEAF_MID;
        if (r < 0.80) return LEAF_DEEP;
        return LEAF_LIT;
    };

    // Where the mass sits. Everything above this is dissolved into the tile
    // coping by the fade at the end of this function, so the creeper appears
    // to come from behind the 黑瓦 rather than being pasted on at y = 0.
    //
    // ⚠️ 这个比例被导出（`INK_TOP_FRAC`）—— 门脸没了之后，藤蔓 overlay 得
    //    自己算出"该挂在哪一行"，好让 TOP 正好落在屋身前墙的压顶下沿上。
    //    见 `EntranceDoors` 的 `INK_CENTER_Y`。
    const TOP = worldH * INK_TOP_FRAC;

    /* ---- WO-9：藤横向铺开的范围，以及"绕开右窗"的那一段 ----------------
     *
     * 2026-10-11 用户：「重新做下常春藤，让它长宽点，最好和右侧外墙一样宽，
     * 藤太粗要改小，打磨下细节」。
     *
     * overlay 中心在 world x = `WALL_INK_CENTER_X` = 6.0、宽 `worldW` = 10
     * ⇒ 局部 x = world x − 6.0，覆盖 world x ∈ [1.0, 11.0]（大门右边 → 墙右缘）。
     *
     * 下面的数一律是**半宽的倍数**（沿用本函数原有的约定）：
     *   SPAN_LO/HI  藤铺开的范围。不取 ±1 —— 叶子还会从枝上往外散 ±0.2 世界单位，
     *               贴到画布边界会被切平。
     *   WIN_F_LO/HI **右窗**占的那一段。右窗 world x ∈ [4.3, 5.7]
     *               ⇒ 局部 ∈ [−1.7, −0.3] ⇒ 半宽倍数 ∈ [−0.34, −0.06]，
     *               两侧各再留 0.08。runners 与"水渍"都跳过这一段。
     *
     * ⚠️ 藤**必须**绕开窗：这块 overlay 在墙**之前**（z = 0.18 > 墙 0.15），
     * 所以落在窗洞上的笔画会直接糊在玻璃/窗帘上，而不是被墙挡住。
     */
    const SPAN_LO = -0.92;
    const SPAN_HI = 0.94;
    const WIN_F_LO = -0.42;
    const WIN_F_HI = 0.02;
    const inWindow = (f) => f > WIN_F_LO && f < WIN_F_HI;
    /** u ∈ [0,1] → 半宽倍数（横向铺满 SPAN_LO…SPAN_HI）。 */
    const fx = (u) => SPAN_LO + u * (SPAN_HI - SPAN_LO);

    // Runners. `x` is a fraction of the half-width (so the planting re-spaces
    // itself when the facade changes size instead of sliding off the edge),
    // `len` a fraction of the wall height, `drift` how far the tip wanders
    // sideways, `sway` the amplitude of its S-curve, `n` how many strands
    // come off one anchor. Unevenly spaced and unevenly long on purpose — an
    // even row reads as wallpaper, not as a creeper.
    //
    // WO-9：5 根 → **8 根**，从"大门右侧一缕"铺满右半面墙。
    // ⚠️ 中间空出来的一段就是右窗（见 `inWindow`）—— 不是漏了，是绕开。
    const runners = [
        // —— 窗左侧（world x ≈ 1.5 … 3.2）——
        { x: -0.90, len: 0.48, drift: 0.070, sway: 0.15, n: 1 },
        { x: -0.74, len: 0.64, drift: -0.050, sway: 0.21, n: 2 },
        { x: -0.56, len: 0.45, drift: 0.080, sway: 0.17, n: 1 },
        // ———— 右窗（局部 −0.34…−0.06）留空 ————
        // —— 窗右侧（world x ≈ 6.4 … 10.6）——
        { x: 0.08, len: 0.58, drift: -0.070, sway: 0.20, n: 2 },
        { x: 0.30, len: 0.50, drift: 0.060, sway: 0.16, n: 1 },
        { x: 0.52, len: 0.66, drift: -0.055, sway: 0.22, n: 2 },
        { x: 0.74, len: 0.46, drift: 0.085, sway: 0.14, n: 1 },
        { x: 0.92, len: 0.57, drift: -0.045, sway: 0.19, n: 1 },
    ].map((r) => ({
        ...r,
        x: r.x * (worldW / 2),
        len: r.len * worldH,
        drift: r.drift * (worldW / 2),
    }));

    // --- 1. the woody runner lying along the coping ---------------------
    // Drawn first so every dangling strand sits in front of it. It enters
    // from the right edge of the frame, because a creeper this size did not
    // start on this wall — it walked in from the garden next door.
    const spinePts = [];
    const spineSteps = 30;
    for (let k = 0; k <= spineSteps; k++) {
        const t = k / spineSteps;
        // WO-9：铺满整块 overlay（原来只走 0.10…0.96，因为 overlay 只盖大门
        // 右侧一缕）。主干贴着压顶走，所以**可以**跨过窗那一段 —— 它在窗顶
        // 之上 2.5 个世界单位。
        const wx = fx(t) * (worldW / 2);
        // a shallow sag between attachment points, plus a slight climb to the
        // right, so it reads as a stem and not as a ruled line
        const sag = Math.sin(t * 2.3) * 0.055 * worldH + t * 0.025 * worldH;
        spinePts.push([X(wx), Y(TOP - sag)]);
    }
    ctx.save();
    // The runner is the vine's backbone: at the old 0.66 it was see-through and
    // the whole creeper read as a wash rather than as a plant with a stem.
    //
    // WO-9：13 → **9**。用户说「藤太粗要改小」。128 px/世界单位下 13 px =
    // 0.102 世界单位，比真实藤蔓的木质部粗一倍；9 px = 0.070，配 0.62 的
    // 收梢已经够读成"木质的枝"，又不再像一根水管。
    ctx.globalAlpha = 0.80;
    limb(ctx, spinePts, 9, STEM, { taper: 0.62 });
    // the doubled line a brush leaves — without it the stem reads as a wire
    ctx.globalAlpha = 0.34;
    limb(ctx, spinePts.map(([x, y]) => [x, y + 5]), 3.4, INK_RIB, { taper: 0.7 });
    ctx.restore();

    /**
     * A creeper leaf, NOT the persimmon leaf.
     *
     * `drawLeaf` is shared with the tree, where leaves are 24..42 long by
     * 6..9.5 wide — about 4:1. That is right for a persimmon and wrong here:
     * at 4:1 a wall of hanging strands reads as **bamboo**, which is what the
     * first green pass looked like. A creeper (常春藤/爬山虎) has a much
     * rounder leaf, closer to 2.2:1. Same generator, same midrib and veins.
     */
    const creeperLeaf = (x, y, ang, big, tone, alpha) => drawLeaf(
        ctx, x, y, ang,
        (big ? 20 : 16) + rand() * 14,     // length
        (big ? 9.5 : 7.5) + rand() * 4.5,  // width — nearly half the length
        tone, INK_RIB, alpha
    );

    // --- 2. foliage on the runner --------------------------------------
    // Lumpy, not a band: a few dense rosettes with gaps between them. An even
    // scatter along the coping reads as a painted stripe.
    //
    // WO-9：26 → **52**，因为 overlay 从"一缕"变成"半面墙"（面积 ×2.5）。
    // 竖向带宽也从 0.80 放到 **1.55** —— 原来所有叶团都挤在紧贴压顶的那 0.8
    // 个单位里，藤一铺开就显得"顶上一条绿带、下面全是光杆"。
    // ⚠️ 1.55 是**上限**：这一段最低只到 world y ≈ 2.1，而右窗顶在 0.75，
    // 中间还留着 1.3 个世界单位的安全距离，所以叶团可以横跨窗的 x 位置。
    // `rand() * rand()` 保持"越靠压顶越密"的偏置。
    for (let c = 0; c < 52; c++) {
        const wx = fx(rand()) * (worldW / 2);
        const cx = X(wx);
        // biased downward so the mass sits ON the wall under the tiles rather
        // than floating above the coping where it would be clipped flat
        const cy = Y(TOP - rand() * rand() * 1.55);
        const lump = 2 + Math.floor(rand() * 4);
        for (let j = 0; j < lump; j++) {
            const a = rand() * Math.PI * 2;
            const d = rand() * 26;
            // The crown of the mass is the part the light reaches, so it gets
            // the sunlit tone and the lower half does not.
            creeperLeaf(
                cx + Math.cos(a) * d,
                cy + Math.sin(a) * d * 0.7,
                a + (rand() - 0.5) * 0.6,
                true,
                leafTone(cy < Y(TOP - worldH * 0.20)),
                // 0.66..0.94. Was 0.44..0.74: at those values the tile coursing
                // read straight through the crown and the mass looked like a
                // stain rather than foliage.
                0.66 + rand() * 0.28
            );
        }
    }

    // --- 3. the strands dangling down the brick -------------------------
    for (const r of runners) {
        for (let i = 0; i < r.n; i++) {
            const ox = r.x + (i - (r.n - 1) / 2) * 0.22 + (rand() - 0.5) * 0.18;
            const len = r.len * (0.72 + rand() * 0.5);
            const drift = r.drift * (0.6 + rand() * 0.8);
            const sway = r.sway * (0.7 + rand() * 0.6);

            // A strand hangs plumb where it is attached and wanders where it
            // is free, so the sin() term is scaled by t² — a constant-amplitude
            // sine would swing the strand away from its own anchor and the
            // whole thing would read as seaweed.
            const steps = 16;
            const pts = [];
            for (let k = 0; k <= steps; k++) {
                const t = k / steps;
                const wx = ox + drift * t + Math.sin(t * 3.1 + i * 1.9) * sway * t * t;
                pts.push([X(wx), Y(TOP - t * len)]);
            }

            // A strand, not a trunk: thin from the start and thinner at the
            // tip. Held at 0.80 alpha so the woody part stays darker than the
            // leaves it carries *without* going see-through (it was 0.66).
            //
            // WO-9：9 → **6**（用户「藤太粗要改小」）。6 px = 0.047 世界单位，
            // 约是主干（9 px）的三分之二 —— 一枝比主干细，但还没细成丝线。
            ctx.save();
            ctx.globalAlpha = 0.80;
            limb(ctx, pts, 6, STEM, { taper: 0.34 });
            ctx.globalAlpha = 0.32;
            limb(ctx, pts.map(([x, y]) => [x + 5, y]), 2.4, INK_RIB, { taper: 0.5 });
            ctx.restore();

            // Foliage is concentrated where the strand is young. A creeper
            // keeps its leaves in the light and lets the tip run bare, which
            // is also what stops a wall of dangling strands reading as a
            // hedge. Leaves per node falls from ~3 at the coping to 0.
            for (let k = 1; k <= steps; k++) {
                const t = k / steps;
                // Thins towards the tip but does not vanish: a creeper keeps
                // leaves most of the way down and only the last stretch runs
                // bare. The old curve (×3.2 − 0.25) hit zero at t ≈ 0.9 and
                // left a long naked strand, which is the other half of why it
                // read as bamboo.
                //
                // WO-9：系数 3.9 → **5.0**。枝干改细（9 → 6 px）之后，同样的
                // 叶量在画面上看着更稀了 —— 枝越细，越要靠叶子把它"撑"起来，
                // 否则整片藤就是一排光溜溜的线。
                const count = Math.max(0, Math.round((1 - t) * 5.0 - 0.1 + rand() * 1.4));
                // Young leaves near the top are the lit ones.
                const tone = leafTone(t < 0.3);
                for (let j = 0; j < count; j++) {
                    const a = (rand() - 0.5) * 2.6 + (rand() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5);
                    const d = 6 + rand() * 22;
                    creeperLeaf(
                        pts[k][0] + Math.cos(a) * d,
                        pts[k][1] + Math.sin(a) * d * 0.75,
                        a + (rand() - 0.5) * 0.55,
                        false,
                        tone,
                        // 0.58..0.92, thinnest at the tip — the tip SHOULD read
                        // lighter, but the old 0.36 floor made the upper half of
                        // every strand a grey smear.
                        0.58 + (1 - t) * 0.34
                    );
                }
            }

            // A tendril curling off the tip — the one detail that says
            // "creeper" rather than "hanging rope". It is a spiral of
            // DECREASING radius: a constant radius just draws a ring, and a
            // ring on the end of a strand reads as a key chain.
            if (rand() < 0.8) {
                const [tx, ty] = pts[steps];
                const dir = rand() < 0.5 ? -1 : 1;
                const tpts = [];
                for (let k = 0; k <= 14; k++) {
                    const u = k / 14;
                    const a = u * Math.PI * 2.1 * dir;
                    const rr = 15 * (1 - u * 0.72);
                    tpts.push([tx + Math.sin(a) * rr, ty + 10 + (1 - Math.cos(a)) * rr * 0.85]);
                }
                ctx.save();
                ctx.globalAlpha = 0.58;
                limb(ctx, tpts, 3.2, STEM, { taper: 0.3 });
                ctx.restore();
            }
        }
    }

    // Wet-edge blotches: soft irregular pools where the wash pooled on the
    // plaster. Purely atmospheric, and the thing that stops the strokes
    // floating on a blank field. Kept on the same half as the vine — a blotch
    // on the empty left wall would just look like damp.
    //
    // WO-9：10 → **16**（面积变大），并且**跳过右窗那一段** —— 这块 overlay
    // 在墙之前（z = 0.18 > 0.15），水渍落在窗洞上会糊在玻璃上，像一块洗不掉的脏。
    for (let i = 0; i < 16; i++) {
        const f = fx(rand());
        if (inWindow(f)) continue;
        const cx = X(f * (worldW / 2));
        const cy = Y((0.06 + rand() * 0.72) * worldH);
        const rx = 40 + rand() * 120;
        const blob = (c) => wobblePath(c, cx, cy, rx, rx * (0.5 + rand() * 0.5), rand, { amp: 0.34, segments: 13 });
        wash(ctx, blob, LEAF_DEEP, rand, { passes: 2, spread: rx * 0.3, alpha: 0.028 });
    }

    // Taper the wash off. Two ends, two different jobs:
    //   bottom — a dangling strand must not end on a hard line mid-wall, so
    //            the tips dissolve into the brick over the lower ~13%;
    //   top    — the creeper has to read as having come OVER the 黑瓦 coping,
    //            so the last ~4.5% (the tiles themselves) fades it out and
    //            the runner looks like it continues on the far side.
    const fade = ctx.createLinearGradient(0, H, 0, 0);
    fade.addColorStop(0.000, 'rgba(0,0,0,0)');
    fade.addColorStop(0.130, 'rgba(0,0,0,0.70)');
    fade.addColorStop(0.400, 'rgba(0,0,0,1)');
    fade.addColorStop(0.955, 'rgba(0,0,0,1)');
    fade.addColorStop(1.000, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Avatar at the window — REMOVED (2026-10-20)                          */
/* ------------------------------------------------------------------ */
/*
 * 这里原来记着"窗口里那个招手的小人"的来龙去脉：先是 ~500 行 canvas 矢量
 * （drawWavingCharacter + makeAvatarWindowTexture），2026-10-07 换成
 * public/textures/entrance/avatar-window.webp（与走廊 IP sprite
 * `avatar_zeo.webp` 成对生成，好让两个"同一个人"长得一样），也是全站
 * "零位图"规矩的唯一例外。
 *
 * 🔴 2026-10-20 用户要求「把窗口里的人物相关代码去掉，包括贴图」⇒ 小人、
 * 贴图（`avatar-window.webp` 已删）、hover 热区、hover 状态一起移除。
 * `ENTRANCE_TEXTURES` 因此**彻底为空** —— 门前场景不再有任何磁盘位图，
 * "零位图"从"有例外"变回"无条件成立"。
 *
 * 走廊里那个 ZEO 小人（`corridor/Avatar.jsx` + `corridor/avatar_zeo.webp`）
 * **不在此列**，它不在窗口里，没有动。
 */

/* ------------------------------------------------------------------ */
/* The room seen through the window                                     */
/* ------------------------------------------------------------------ */

/**
 * Aspect of the interior backdrop plane in EntranceProps (1.55 x 1.62).
 * Kept here so the canvas is drawn at the plane's real proportions rather
 * than at whatever pixel size was convenient — the project's standing rule.
 */
export const WINDOW_INTERIOR_ASPECT = 1.55 / 1.62;

/**
 * The room beyond the window.
 *
 * WHY THIS IS A BITMAP AND NOT THE SHADER IT REPLACED
 * ---------------------------------------------------
 * It was a tiny ShaderMaterial writing `mix(warm, dark, ...)` straight into
 * `gl_FragColor`. Two things were wrong with it. First, those were sRGB
 * numbers being written into a linear-space pipeline, so the "warm dark
 * interior" came out as #E0CFB5 — near-white, brighter than the wall outside.
 * Second, and worse, the curtains in front of it were painted `#EFE0C9`:
 * within a few percent of the backdrop they were supposed to be standing
 * against, so the fabric was invisible and all you saw was a blank pane.
 *
 * A canvas can hold the thing a shader finds awkward here: a *scene*. A back
 * wall, a floor, a lamp pool off to one side, a shelf with two jars, and a
 * vignette — enough depth cues that the eye reads "someone's room" instead of
 * "a pale rectangle". It is also unlit, so it never changes with the outdoor
 * light: a room seen through a window is its own light source.
 */
export function makeWindowInteriorTexture() {
    const key = 'window-interior';
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / WINDOW_INTERIOR_ASPECT);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const FLOOR_Y = H * 0.74; // where the back wall meets the floor

    // ---- back wall: warm plaster, darkening towards the corners --------
    const wall = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    wall.addColorStop(0.00, '#3A2A1F');
    wall.addColorStop(0.35, '#5C412E');
    wall.addColorStop(1.00, '#48321F');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, FLOOR_Y);

    // ---- floor: darker, and warmer where the lamp reaches --------------
    const floor = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    floor.addColorStop(0, '#2E2016');
    floor.addColorStop(1, '#1A120C');
    ctx.fillStyle = floor;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

    // ---- faint plaster mottle ------------------------------------------
    ctx.fillStyle = 'rgba(255, 226, 186, 0.035)';
    for (let i = 0; i < 260; i++) {
        const y = rand() * FLOOR_Y;
        ctx.fillRect(rand() * W, y, 6 + rand() * 30, 2 + rand() * 7);
    }

    // ---- the lamp pool. Offset left of centre, as if the lamp is on a
    // table just outside the frame — a centred glow reads as a spotlight. --
    const LX = W * 0.34;
    const LY = FLOOR_Y * 0.42;
    const lamp = ctx.createRadialGradient(LX, LY, 4, LX, LY, W * 0.52);
    lamp.addColorStop(0.00, 'rgba(255, 206, 138, 0.62)');
    lamp.addColorStop(0.30, 'rgba(255, 178, 104, 0.30)');
    lamp.addColorStop(0.62, 'rgba(214, 128, 70, 0.12)');
    lamp.addColorStop(1.00, 'rgba(120, 70, 40, 0.0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, FLOOR_Y + 10);

    // ---- a shelf on the right-hand wall, with two jars ------------------
    const SH_Y = FLOOR_Y * 0.46;
    ctx.fillStyle = 'rgba(24, 15, 10, 0.55)';
    ctx.fillRect(W * 0.60, SH_Y, W * 0.36, 6);
    ctx.fillStyle = 'rgba(38, 24, 16, 0.75)';
    ctx.fillRect(W * 0.60, SH_Y + 6, W * 0.36, 10);

    const jar = (cx, w, h, tint) => {
        const y = SH_Y - h;
        ctx.beginPath();
        // shoulder -> neck -> mouth, so it reads as a jar not a box
        ctx.moveTo(cx - w / 2, SH_Y);
        ctx.lineTo(cx - w / 2, y + h * 0.34);
        ctx.quadraticCurveTo(cx - w / 2, y, cx, y);
        ctx.quadraticCurveTo(cx + w / 2, y, cx + w / 2, y + h * 0.34);
        ctx.lineTo(cx + w / 2, SH_Y);
        ctx.closePath();
        ctx.fillStyle = tint;
        ctx.fill();
        // a highlight down the left side, where the lamp catches it
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.28, SH_Y - 3);
        ctx.lineTo(cx - w * 0.28, y + h * 0.36);
        ctx.lineTo(cx - w * 0.08, y + h * 0.22);
        ctx.lineTo(cx - w * 0.08, SH_Y - 3);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 216, 160, 0.20)';
        ctx.fill();
    };
    jar(W * 0.70, W * 0.045, H * 0.15, '#2A3B33');
    jar(W * 0.795, W * 0.038, H * 0.115, '#3A2A33');
    jar(W * 0.875, W * 0.052, H * 0.175, '#2E3242');

    // ---- skirting: the shadow line where wall meets floor --------------
    const skirt = ctx.createLinearGradient(0, FLOOR_Y - H * 0.05, 0, FLOOR_Y + H * 0.03);
    skirt.addColorStop(0.0, 'rgba(18, 11, 7, 0.0)');
    skirt.addColorStop(0.7, 'rgba(18, 11, 7, 0.55)');
    skirt.addColorStop(1.0, 'rgba(14, 8, 5, 0.85)');
    ctx.fillStyle = skirt;
    ctx.fillRect(0, FLOOR_Y - H * 0.05, W, H * 0.08);

    // ---- vignette: the window light does not reach the corners ---------
    const vig = ctx.createRadialGradient(W * 0.5, H * 0.46, H * 0.18, W * 0.5, H * 0.5, H * 0.78);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* The curtain fabric                                                   */
/* ------------------------------------------------------------------ */

/**
 * Aspect of one curtain panel in EntranceProps (0.44 x 1.42).
 *
 * ⚠️ The plane's geometry is *displaced* — `useWavyPanelGeometry` pushes each
 * vertex in z by a sine of x — but that changes what the panel occludes, not
 * its outline. The silhouette seen through the window is still the flat
 * 0.44 x 1.42 rectangle, so that is the aspect to draw at.
 */
export const CURTAIN_ASPECT = 0.44 / 1.42;

/**
 * Cream curtain fabric — the thing that was missing.
 *
 * The old panels were a flat `#EFE0C9` MeshStandardMaterial. Against a
 * near-white interior that is invisible, and even against a dark one it reads
 * as cardboard: no folds, no weave, nothing to say "cloth". So this draws the
 * three things that make fabric legible at window scale:
 *
 *   1. **Folds.** Vertical bands of light and shade. The band *width* varies
 *      and the shading is a smoothstep rather than a sine, because a real
 *      gathered curtain has folds of different depths, not a corrugation.
 *   2. **Weave.** A fine crosshatch, drawn as two offset 50%-alpha line sets.
 *      At this size it only ever resolves to a texture grain, which is exactly
 *      the point — it stops large flat areas reading as vector art.
 *   3. **A gather at the top.** Gathers bunch the cloth up against the rod, so
 *      the fold contrast is strongest along the top and softens downwards.
 */
export function makeCurtainTexture() {
    const key = 'curtain-fabric';
    if (cache.has(key)) return cache.get(key);

    const W = 256;
    const H = Math.round(W / CURTAIN_ASPECT);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // ---- base cloth ------------------------------------------------------
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0.00, '#D9C4A2');
    base.addColorStop(0.16, '#EADAC0');
    base.addColorStop(0.55, '#E4D2B4');
    base.addColorStop(1.00, '#C9B291');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // ---- folds -----------------------------------------------------------
    // Walk across the panel placing folds of varying width and depth. Each is
    // drawn as a soft vertical gradient: dark in the trough, light on the
    // crest, so it shades both ways like a real fold rather than banding.
    let x = -W * 0.06;
    while (x < W + W * 0.06) {
        const w = W * (0.075 + rand() * 0.075);
        const depth = 0.16 + rand() * 0.22;
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0.00, `rgba(96, 76, 54, 0)`);
        g.addColorStop(0.34, `rgba(96, 76, 54, ${depth.toFixed(3)})`);
        g.addColorStop(0.62, `rgba(255, 244, 224, ${(depth * 0.85).toFixed(3)})`);
        g.addColorStop(1.00, `rgba(96, 76, 54, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, w, H);

        // The gather: folds fade out towards the hem, where the cloth is
        // hanging free. Painted over the fold it just laid down.
        const fade = ctx.createLinearGradient(0, 0, 0, H);
        fade.addColorStop(0.00, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(0.10, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(0.70, `rgba(226, 208, 178, ${(depth * 0.8).toFixed(3)})`);
        fade.addColorStop(1.00, `rgba(214, 194, 162, ${(depth * 0.95).toFixed(3)})`);
        ctx.fillStyle = fade;
        ctx.fillRect(x, 0, w, H);

        x += w;
    }

    // ---- weave -----------------------------------------------------------
    // Two offset line sets, each at half alpha, so the crossings are darker
    // than either family of threads — a real weave, not a grid.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 98, 72, 0.10)';
    for (let i = 0; i < W; i += 3) {
        ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, H); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 248, 232, 0.09)';
    for (let j = 0; j < H; j += 3) {
        ctx.beginPath(); ctx.moveTo(0, j + 0.5); ctx.lineTo(W, j + 0.5); ctx.stroke();
    }

    // ---- slubs: the irregular thick threads in a cheap linen -------------
    ctx.fillStyle = 'rgba(255, 252, 240, 0.16)';
    for (let i = 0; i < 150; i++) {
        ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 7, 1);
    }

    // ---- hem: a couple of stitches along the bottom ---------------------
    ctx.strokeStyle = 'rgba(122, 96, 66, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - 12.5); ctx.lineTo(W, H - 12.5);
    ctx.moveTo(0, H - 5.5); ctx.lineTo(W, H - 5.5);
    ctx.stroke();

    return toTexture(canvas, key);
}

/**
 * The lantern's paper skin, wrapped around a lathe.
 *
 * `u` runs around the circumference and `v` down the profile, which is why the
 * ribs are vertical stripes in x and the glow is a vertical gradient in y: the
 * bulge in the middle of a 灯笼 is where the candle is, so that is where the
 * paper is thinnest and the light comes through.
 *
 * Drawn rather than modelled because the ribbing IS the object. A smooth
 * lathe with a flat red material reads as a tomato; the 18 bamboo ribs with a
 * highlight down one side of each are what make it read as paper over a
 * frame. Doing that with geometry would be 18 more meshes.
 *
 * The tassel is drawn in here too, as the bottom band, because it hangs from
 * the same point and would otherwise need its own texture at a different
 * aspect.
 */
export function makeLanternTexture() {
    const key = 'lantern-paper';
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 512;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // ---- paper, lit from the inside -------------------------------------
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, '#7E1710'); // cinched at the top cap
    g.addColorStop(0.18, '#C22C1A');
    g.addColorStop(0.46, '#EF5A38'); // the bulge — thin paper, candle shows
    g.addColorStop(0.66, '#D3381F');
    g.addColorStop(0.88, '#8E1B12');
    g.addColorStop(1.00, '#6B120C');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ---- 18 bamboo ribs --------------------------------------------------
    const RIBS = 18;
    for (let i = 0; i < RIBS; i++) {
        const x = (i / RIBS) * W;
        // shadow side of the rib
        ctx.fillStyle = 'rgba(74, 10, 6, 0.42)';
        ctx.fillRect(x - 5, 0, 7, H);
        // the highlight that makes it read as a rounded spline, not a stripe
        ctx.fillStyle = 'rgba(255, 178, 130, 0.28)';
        ctx.fillRect(x + 2, 0, 3, H);
    }

    // ---- paper fibre: short horizontal flecks, denser near the caps ------
    ctx.fillStyle = 'rgba(255, 214, 170, 0.10)';
    for (let i = 0; i < 900; i++) {
        const y = rand() * H;
        const edge = Math.abs(y / H - 0.5) * 2; // 0 at the middle, 1 at a cap
        if (rand() > 0.35 + edge * 0.5) continue;
        ctx.fillRect(rand() * W, y, 2 + rand() * 9, 1);
    }

    // ---- a hint of gold thread at both ends ------------------------------
    const band = (y) => {
        const bg = ctx.createLinearGradient(0, y - 9, 0, y + 9);
        bg.addColorStop(0, 'rgba(120, 84, 20, 0.0)');
        bg.addColorStop(0.5, 'rgba(232, 190, 92, 0.55)');
        bg.addColorStop(1, 'rgba(120, 84, 20, 0.0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, y - 9, W, 18);
    };
    band(H * 0.045);
    band(H * 0.955);

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 石桌 / 石凳的**石面**                                                */
/* ------------------------------------------------------------------ */

/**
 * 石面纹理 —— 石桌、石凳的顶面用。
 *
 * 🔴 为什么非要有纹理，不能只用纯色（用户 2026-10-09 连报两次「桌面看起来
 * 倾斜的」）：
 *
 * 先证明了几何确实是平的 —— 直接读世界空间的面法线，全是 `(0, 1, 0)`。
 * 那"倾斜"就是**看出来**的。而一个**纯色的椭圆**在透视下没有任何可读的线索：
 * 眼睛能判断"这是个水平面"靠的是**面上花纹的透视缩短**（近处疏、远处密）。
 * 纯色面把这个线索丢掉了，剩下的椭圆就既能读成"平放的圆"，也能读成
 * "斜对着我的圆盘" —— 尤其当它比周围都亮、又没有影子的时候。
 *
 * 对照：兔子的花箱之所以不觉得斜，是因为它的顶面是**矩形** —— 它的远棱/近棱
 * **平行于世界 X 轴**，而任何平行于 X 轴的世界直线投影后**恒为屏幕水平线**，
 * 所以它永远有两条精确 0.00° 的边可读。⚠️ **注意不是「四条边往灭点收」那个
 * 理由**（那是错的：收拢是"有朝向"的线索，不解决"平不平"）。
 * 圆盘一条直边都没有，所以**光靠花纹救不了它** —— 花纹只能给"朝向"，
 * 给不了"水平"。（2026-10-10 的结论：得把形状改掉，见 `StoneTable`。）
 *
 * 所以这里画的是**各向同性的细石粒**：淡到几乎看不出的大尺度斑驳（读"石头"）
 * + 密集的小点（读"面"）。刻意**不画**长裂纹与拼缝 —— 那会重新变成"几大块折面"。
 *
 * 🔴 2026-10-10 第三次报「还是倾斜」之后修正了两处（见下面每一段的注释）：
 *   1. **大云斑的 alpha 砍到 1/3** —— 它在平面上会被读成**起伏**，正对着"面是平的"打架；
 *   2. **细石粒加密到 9000** —— 面不能靠云斑撑，得靠粒子。
 * ⚠️ 但要说清楚：**这张贴图只管「实不实」，管不了「歪不歪」**。斜不斜是**投影**
 * 的事，贴图/材质/光照/厚度/倒角/阴影全都改不了它（8 变体实测倾角一个都没变）。
 * 2026-10-10 定案的解法在 `StoneTable` 里：**顶面改成矩形**（长宽比 ≈ 2.2，
 * 长边平行世界 X 轴）。16 边形试过、不行 —— 棱到了 0.00°，但**轮廓主轴一个像素
 * 都没动**；矩形之所以行，是因为它的长边**同时是轮廓的主轴**（见该文件头的 tan(2θ)）。
 *
 * 色号与 `StoneTable` 的顶面同族；用 `map` 时材质的 `color` 留白，颜色全部由这张图给。
 */
export function makeStoneSlabTexture(key = 'stone-slab-top') {
    if (cache.has(key)) return cache.get(key);

    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // ---- 1. 底色 ------------------------------------------------------
    // 🔴 比原来（#b3aa9c）提亮一档：场景是平光，顶面必须**从底色上**就比侧壁亮，
    // 光靠光照拉不开（见 StoneTable 里 STONE_SIDE 的注释）。
    ctx.fillStyle = '#c2b9a9';
    ctx.fillRect(0, 0, S, S);

    // ---- 2. 大尺度斑驳：**必须很淡** -----------------------------------
    // 🔴 2026-10-10 用户第三次报「还是倾斜」，并给了正确的线索：「你去看看花箱」。
    // 复查发现**上一版就是这里帮了倒忙**：18 块半径 0.16~0.46×S 的云斑、alpha 到 0.20，
    // 糊在顶面上会被读成**起伏**（像被水浸过的波浪）—— 而"这个面是平的"正是我们要
    // 它读出来的东西。一个平面上任何**大尺度**的明暗，眼睛都会当成形状。
    // 所以这里把 alpha 砍到原来的 1/3（0.03~0.08）、半径也收小，只留"石头的呼吸"，
    // 不构成形状。判据：把它单独排成一屏看，应当是**一块石头**，不是**一堆云**。
    for (let i = 0; i < 12; i++) {
        const cx = rand() * S;
        const cy = rand() * S;
        const r = S * (0.12 + rand() * 0.20);
        const light = rand() > 0.45;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const c = light ? '226, 220, 208' : '140, 131, 118';
        g.addColorStop(0, `rgba(${c}, ${0.03 + rand() * 0.05})`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---- 3. 细石粒：各向同性的小点，密度足够高才是"面"不是"斑点" --------
    // 这是**透视缩短的载体** —— 近处被拉稀、远处被压密，眼睛靠它读平面朝向。
    // 2026-10-10 加密到 9000：大云斑退下去之后，面的"实"就全靠它撑。
    for (let i = 0; i < 9000; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const r = 0.5 + rand() * 1.5;
        const light = rand() > 0.5;
        ctx.fillStyle = light
            ? `rgba(244, 240, 232, ${0.12 + rand() * 0.24})`
            : `rgba(92, 84, 72, ${0.10 + rand() * 0.22})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---- 4. 少量石疵：稍大的暗点，给"石"一点脾气 ------------------------
    for (let i = 0; i < 90; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const r = 1.6 + rand() * 3.4;
        ctx.fillStyle = `rgba(74, 66, 56, ${0.10 + rand() * 0.16})`;
        ctx.beginPath();
        ctx.ellipse(x, y, r * (0.7 + rand() * 0.8), r, rand() * 3.14, 0, Math.PI * 2);
        ctx.fill();
    }

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 石桌的季生物证：冬雪盖 / 秋落叶                                      */
/* ------------------------------------------------------------------ */

/**
 * 石桌 / 石凳顶面的**积雪**（RGBA，带 alpha 边）。
 *
 * 🔴 2026-10-10 用户报「冬季、桌凳上面的积雪不自然」。原来是一块
 * `#E4E9EF` 的**纯色矩形平面**，每边缩进 0.05 —— 三个毛病叠在一起：
 *
 *   1. **直边**。真雪的边界是"积到哪儿算哪儿"，没有一条直边；一条笔直的
 *      边会立刻读成"贴上去的"。
 *   2. **均匀色**。平光场景里一块均匀的浅灰 = 零信息，眼睛读不出这是雪
 *      还是刷了白漆。雪需要**起伏**（哪怕只是画出来的）。
 *   3. **厚度为零**。平面没有侧壁，边缘没有任何"厚"的暗示。
 *
 * 修法就是把这三件事画进贴图（几何仍然是那块平面，**不加 mesh**）：
 *   - 用 `destination-out` 沿周长啃一圈大小不一的圆 ⇒ 不规则落雪线；
 *   - 中心的提亮 + 靠边的冷暗 ⇒ 鼓起来的感觉；
 *   - 几十个极淡的亮/暗斑 ⇒ 雪面的起伏。
 *
 * 缩进从几何搬到了贴图：原来 `SNOW_INSET` 是**几何**每边缩 0.05（所以边界
 * 是直线），现在它是啃边圆的**平均**半径，边界因此是起伏的 —— 语义没变，
 * 但不再是矩形。调用方传**整块顶面**的几何即可。
 *
 * @param {string} key   缓存键（同一个 key 只会烘一次）
 * @param {number} aspect 顶面宽高比（画布按真实宽高比出，别让贴图被拉伸）
 * @param {number} inset  平均缩进，占短边的比例
 */
export function makeSnowCapTexture(key = 'snow-cap', aspect = 2.22, inset = 0.05) {
    if (cache.has(key)) return cache.get(key);

    const H = 256;
    const W = Math.max(64, Math.round(H * aspect));
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // ---- 1. 底色：**不是纯白** ----------------------------------------
    // 纯白在平光下是一块死白；比石面略冷、略亮的那一点点色差才是"雪"。
    ctx.fillStyle = '#E4E9EF';
    ctx.fillRect(0, 0, W, H);

    // ---- 2. 厚度：中心提亮 + 靠边冷暗 ---------------------------------
    // ⚠️ 必须在"啃边"**之前**画：啃完之后边界就不是矩形了，径向渐变对不上。
    const g = ctx.createRadialGradient(W * 0.40, H * 0.32, H * 0.05, W * 0.50, H * 0.50, W * 0.62);
    g.addColorStop(0.00, 'rgba(255, 255, 255, 0.52)');
    g.addColorStop(0.42, 'rgba(244, 247, 251, 0.20)');
    g.addColorStop(1.00, 'rgba(194, 203, 217, 0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ---- 3. 雪面的起伏：几十个极淡的亮/暗斑 ---------------------------
    for (let i = 0; i < 70; i++) {
        const cx = rand() * W;
        const cy = rand() * H;
        const r = H * (0.05 + rand() * 0.16);
        const light = rand() > 0.42;
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, light ? 'rgba(255,255,255,0.30)' : 'rgba(186,196,211,0.26)');
        rg.addColorStop(1, light ? 'rgba(255,255,255,0)' : 'rgba(186,196,211,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---- 3b. 周长采样点（啃边与"薄雪"共用同一组，见下） ----------------
    const m = Math.min(W, H) * inset;
    const per = 2 * (W + H);
    const steps = Math.round(per / 3);       // ≈3 px 一个，保证 stamp 彼此重叠
    const pts = [];
    for (let i = 0; i < steps; i++) {
        const d = (i / steps) * per;
        let x, y;
        if (d < W) { x = d; y = 0; }
        else if (d < W + H) { x = W; y = d - W; }
        else if (d < 2 * W + H) { x = W - (d - W - H); y = H; }
        else { x = 0; y = H - (d - 2 * W - H); }
        pts.push([x, y, rand()]);
    }

    // ---- 4. 贴边的「薄雪」：沿周长压一圈**软**的冷色 -------------------
    // 真雪的边是薄的，薄到透出底下的石色 —— 所以边缘比中心更冷、更暗。
    // 这一笔给"厚度递减"，下面的啃边给"形状"，两者是一对。
    // ⚠️ 必须画在啃边**之前**：啃边会把这一圈的外侧连色一起擦掉，于是最终
    //    可见的边界是这条冷带的**内侧**，而不是一个硬框。
    //
    // 🔴 强度只能到这个量级（2026-10-10 调过一版）：alpha 0.50 + 色号
    //    (164,178,199) 时，桌上会读出一圈明显的**蓝边**，像一汪水/一块冰，
    //    而不是雪。雪边的冷是"一点点"，所以现在压到 0.30 且色号更中性。
    for (const [x, y, j] of pts) {
        const r = m * (1.5 + j * 1.3);
        const cr = ctx.createRadialGradient(x, y, 0, x, y, r);
        cr.addColorStop(0.00, 'rgba(178, 188, 205, 0.30)');
        cr.addColorStop(0.50, 'rgba(186, 195, 210, 0.12)');
        cr.addColorStop(1.00, 'rgba(192, 200, 214, 0)');
        ctx.fillStyle = cr;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---- 5. 啃边：把矩形边界咬成不规则的落雪线 ------------------------
    // 🔴 这是整张图存在的理由。沿周长 stamp 一串大小不一的圆，比"按噪声算
    //    半径再连成多边形"简单得多，而且**天然不可能留下直边**。
    //
    // 🔴🔴 **`fillStyle` 必须在这里显式设成不透明的**（2026-10-10 修的真 bug）。
    //    原来这一行漏了：`fillStyle` 还是第 3 步最后一次 `createRadialGradient`
    //    留下的**那个局部渐变**（半径 r、r 以外 alpha 恒为 0）。而
    //    `destination-out` 的擦除量 = **源的 alpha** ⇒ 整圈啃边**一个像素都没擦掉**，
    //    边界仍是直线；唯一擦到的，是恰好落在最后那个斑圆心附近的一小块
    //    （凳面贴图右下角那块深色圆斑就是这么来的）。
    //    后果：雪盖读起来还是"一张白贴纸"—— 用户报的正是这个。
    //    ⚠️ 这类 bug **不报错、不警告**，只有把贴图单独画出来看才发现
    //      （根目录 `__artpreview.html`，5 秒）。
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    const bite = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    for (const [x, y, j] of pts) bite(x, y, m * (0.35 + j * 1.15));
    // 再往内撒几个孔：雪没盖满、露着石头的点（纯白平铺会像塑料布）。
    // ⚠️ 每个孔由 3~5 个小圆**错位叠成**，不能是单个正圆 —— 单个正圆在
    //    2.2:1 的贴图上会读成一排"波点"，比不画还假。
    // ⚠️ 也不能大：`alphaTest = 0.5` 之下，孔是"石头直接露出来"（不是薄雪），
    //    半径超过 ~m×0.3 就会变成一个个黑洞。
    for (let i = 0; i < 4; i++) {
        const hx = W * (0.14 + rand() * 0.72);
        const hy = H * (0.18 + rand() * 0.64);
        const n = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
            bite(hx + (rand() - 0.5) * m * 0.6, hy + (rand() - 0.5) * m * 0.6, m * (0.08 + rand() * 0.10));
        }
    }
    ctx.globalCompositeOperation = 'source-over';

    return toTexture(canvas, key);
}

/**
 * 桌面上的**落叶**（RGBA，透明底，一片平面铺上去）。
 *
 * 用户 2026-10-10：「秋季是否放几张落叶和 2 个果实」。叶形复用 `drawLeaf`
 * —— 和柿子树上的叶子是同一套笔法，所以落在桌上的叶子和长在树上的
 * **看起来是一棵树掉下来的**。（这与 memory 里那条"共用画法要检查形状是否
 * 适用"的教训不冲突：这里要的就是一致，不是复用带来的错位。）
 *
 * 用**一张贴图 + 一块平面**而不是四块平面：落叶是平的，贴在桌面上读起来
 * 完全对，而且省 3 个 mesh。
 */
export function makeLeafLitterTexture(key = 'leaf-litter', aspect = 2.22) {
    if (cache.has(key)) return cache.get(key);

    const H = 256;
    const W = Math.max(64, Math.round(H * aspect));
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // 秋天落叶的四档色：赭 / 砖 / 枯 / 黄。压得比树上的果略暗，
    // 免得桌上比树上还抢眼。
    const FILL = ['#C9762B', '#A9532A', '#8E5A2A', '#D19A3C'];
    // 6 片主体叶 + 2 片碎叶。
    // ⚠️ 桌面在默认机位下只有 ~180 px 宽，而这张贴图 569 px ⇒ 屏幕上被**降采样
    //    ~3 倍**。所以叶片不能太小：`len` 取 0.10..0.20 的 H（≈26..51 px 贴图
    //    ≈ 8..16 px 屏幕），再小就糊成土色噪点、读不出"叶子"了。
    // ⚠️ 位置避开四周 10% —— 叶尖探出矩形会被 `alphaTest` 直接切掉半个。
    for (let i = 0; i < 6; i++) {
        const x = W * (0.10 + rand() * 0.76);
        const y = H * (0.18 + rand() * 0.62);
        const ang = rand() * Math.PI * 2;
        const len = H * (0.10 + rand() * 0.10);
        const wid = len * (0.30 + rand() * 0.16);
        drawLeaf(ctx, x, y, ang, len, wid, FILL[i % FILL.length], '#7A4318', 0.95);
    }
    // 两片碎叶：真实的落叶堆里总有几片只剩一半的
    for (let i = 0; i < 2; i++) {
        drawLeaf(ctx, W * (0.14 + rand() * 0.70), H * (0.22 + rand() * 0.56),
            rand() * Math.PI * 2, H * (0.05 + rand() * 0.03), H * 0.020,
            FILL[(i + 1) % FILL.length], '#7A4318', 0.85);
    }

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* WO-3 新道具的贴图：荷花缸的水面 / 竹篱                               */
/* ------------------------------------------------------------------ */

/**
 * 荷花缸的**水面**（春/夏/秋）或**薄冰**（冬）。
 *
 * 圆盘几何（`sharedGeometry('circle', r)`）的 UV 铺满它的**外接正方形**，
 * 四角永远采不到 ⇒ 主体画在中心圆里就行，不必裁。
 *
 * ⚠️ 缓存键**含季节**（§7 硬约束：贴图缓存键必须进季节，否则切季拿到上一季的图），
 * 但**种子不含** —— 四季是同一口缸、同一片水，波纹的随机相位不该跟着季节变
 * （和 `makeTreeTexture` 同一个约定）。
 *
 * @param {'spring'|'summer'|'autumn'|'winter'} season
 */
export function makeVatWaterTexture(season = 'summer') {
    const key = `vat-water-${season}`;
    if (cache.has(key)) return cache.get(key);

    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString('vat-water'));
    const isIce = season === 'winter';

    // ---- 1. 底色 ------------------------------------------------------
    // 水是**深墨绿**不是蓝：中式院子的缸水映的是天和树，偏绿偏浊。
    const BASE = {
        spring: '#3C6A5C',
        summer: '#2F5D57',
        autumn: '#3F6259',
        winter: '#C6D6DC',
    }[season] || '#2F5D57';
    ctx.fillStyle = BASE;
    ctx.fillRect(0, 0, S, S);

    // ---- 2. 中心深 / 边缘亮（缸壁反光）--------------------------------
    const g = ctx.createRadialGradient(S * 0.46, S * 0.42, S * 0.06, S * 0.5, S * 0.5, S * 0.52);
    if (isIce) {
        g.addColorStop(0.00, 'rgba(255,255,255,0.36)');
        g.addColorStop(0.60, 'rgba(232,240,246,0.16)');
        g.addColorStop(1.00, 'rgba(166,186,198,0.32)');
    } else {
        g.addColorStop(0.00, 'rgba(16,40,40,0.32)');
        g.addColorStop(0.65, 'rgba(24,56,52,0.12)');
        g.addColorStop(1.00, 'rgba(150,196,180,0.26)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    if (isIce) {
        // ---- 3a. 冰：几道细长裂纹 -----------------------------------
        for (let i = 0; i < 10; i++) {
            let x = S * (0.16 + rand() * 0.68);
            let y = S * (0.16 + rand() * 0.68);
            let a = rand() * Math.PI * 2;
            const L = S * (0.06 + rand() * 0.10);
            ctx.strokeStyle = `rgba(255,255,255,${0.28 + rand() * 0.36})`;
            ctx.lineWidth = 0.7 + rand() * 1.2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let k = 0; k < 3; k++) {
                a += (rand() - 0.5) * 1.2;
                x += Math.cos(a) * L;
                y += Math.sin(a) * L;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    } else {
        // ---- 3b. 水：同心弧（半径/相位都抖，否则读成一个"靶子"）------
        for (let i = 0; i < 16; i++) {
            const cx = S * (0.28 + rand() * 0.44);
            const cy = S * (0.28 + rand() * 0.44);
            const r = S * (0.05 + rand() * 0.20);
            ctx.strokeStyle = `rgba(214,238,228,${0.05 + rand() * 0.09})`;
            ctx.lineWidth = 0.9 + rand() * 1.6;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * (0.55 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
            ctx.stroke();
        }
        // 浮萍 / 杂质：让水面不是一块纯渐变
        for (let i = 0; i < 26; i++) {
            ctx.fillStyle = rand() > 0.5
                ? `rgba(198,224,206,${0.06 + rand() * 0.12})`
                : `rgba(30,62,58,${0.06 + rand() * 0.12})`;
            ctx.beginPath();
            ctx.arc(rand() * S, rand() * S, 1 + rand() * 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    return toTexture(canvas, key);
}
