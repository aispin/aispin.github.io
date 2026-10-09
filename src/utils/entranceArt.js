/**
 * Procedural entrance art (zero image assets)
 *
 * The entrance used to pull four hand-painted webp bitmaps off disk:
 *
 *   avatar_window.webp  — the character who waves at you from the window
 *   tree_colored.webp   — the big watercolour tree the wind chime hangs from
 *   speech_bubble.webp  — the rubber duck's speech bubble
 *   bug_sketch.webp     — the wandering ladybird you can click
 *
 * All four are now drawn on an offscreen <canvas> and wrapped in a
 * THREE.CanvasTexture, matching the convention already used by
 * utils/doorArt.js (doors), utils/proceduralTextures.js (floors/trim),
 * utils/cursorArt.js (cursors) and shaders/entranceTextures.js (bricks).
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

/* ------------------------------------------------------------------ */
/* Persimmon tree — the courtyard's autumn centrepiece, and the thing   */
/* the wind chime hangs from                                            */
/* ------------------------------------------------------------------ */

/**
 * Sampled centreline for a curved branch: start at (x, y), walk `steps`
 * segments of `len / steps`, turning by `bend` radians in total.
 */
function shoot(x, y, ang, len, bend, steps = 10) {
    const pts = [[x, y]];
    const step = len / steps;
    let a = ang;
    let px = x;
    let py = y;
    for (let i = 0; i < steps; i++) {
        a += bend / steps;
        px += Math.cos(a) * step;
        py += Math.sin(a) * step;
        pts.push([px, py]);
    }
    return pts;
}

/**
 * Closed outline around a centreline, offset by a linearly interpolated
 * half-width. Unlike `limb` — which strokes each segment separately, so a
 * thick branch shows a step at every joint — this is a single continuous
 * silhouette, which is what lets the trunk be filled and then have its bark
 * clipped inside.
 *
 * ⚠️ 路径**刻意不 closePath**（2026-10-09）。
 *
 * 端面的封口线正是「树干像拼接出来的」的成因：这个函数给每一条骨架都画了闭合
 * 轮廓，于是树干顶端有一条**宽 48 的横线**，三条主枝的根部又各有一条
 * （44 / 44 / 40，而且各自垂直于自己第一段的方向）—— 四条线在分叉点交叉，
 * 就是用户看到的那道缝。
 *
 * 去掉 closePath 对**填充零影响**：canvas 规范里 `fill()` 与 `clip()` 会
 * **隐式闭合**子路径。所以只有 `stroke()` 会因此不再画端面 —— 而树干/主枝的
 * 墨线恰好是唯一在意这件事的地方。
 *
 * 🔑 另一个同样重要的性质：这个改动**不消耗任何随机数**。所以树的整体形态
 * 逐位不变，秋天的回归锚点得以保留（见 `makeTreeTexture` 的说明）。
 */
function taperedPath(c, pts, w0, w1, skip = 0) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const hw = (w0 + (w1 - w0) * t) * 0.5;
        const p = pts[i];
        const q = pts[Math.min(n - 1, i + 1)];
        const r = pts[Math.max(0, i - 1)];
        let dx = q[0] - r[0];
        let dy = q[1] - r[1];
        const L = Math.hypot(dx, dy) || 1;
        dx /= L;
        dy /= L;
        left.push([p[0] - dy * hw, p[1] + dx * hw]);
        right.push([p[0] + dy * hw, p[1] - dx * hw]);
    }
    // `skip`：描边时跳过起点的前 `skip` 个采样点。**只对 stroke 有意义** ——
    // 三条主枝共用同一个起点（分叉点），它们的轮廓在分叉附近互相插进对方
    // 内部，描出来会在分叉处织出一个菱形。填充/裁剪一律用默认的 0。
    const s = Math.max(0, Math.min(skip, n - 2));
    c.beginPath();
    c.moveTo(left[s][0], left[s][1]);
    for (let i = s + 1; i < n; i++) c.lineTo(left[i][0], left[i][1]);
    for (let i = n - 1; i >= s; i--) c.lineTo(right[i][0], right[i][1]);
    // 不 closePath —— 见上面的说明。fill()/clip() 会隐式闭合，stroke() 不会。
}

/* ------------------------------------------------------------------ */
/* 树皮：调色板 + 共用规则                                              */
/* ------------------------------------------------------------------ */

/* 树干与主枝**共用**这套颜色。放在模块作用域而不是 makeTreeTexture 里，
 * 是因为 fissure() / coreHighlight() 也要用 —— 树干与主枝共用同一套颜色、
 * 同一条明暗规则，正是「分叉两侧不再像两块拼起来」的关键。 */
const BARK = '#66452A';
const BARK_DARK = '#3F2A1B';
const BARK_HI = '#A8835B';
const BARK_DARK_RGB = '63,42,27';
const BARK_HI_RGB = '168,131,91';

/**
 * 并集水彩：把同一种底色在**一整块并集轮廓**上叠 `passes` 遍。
 *
 * 🔴 这是「树干与主枝像两块拼起来」的正解。
 *
 * 以前是每条枝各自 `wash`：重叠处叠两层、不重叠处只有一层，于是分叉两侧的
 * **色调**必然对不上 —— 那条水平分界就是这么来的。逐条去"把色调调成一样"
 * 治不好：主枝的轮廓在分叉处是一条**平底**，底色画到那儿就断。
 * 改成在并集上叠，底色就只有一个来源，跨分叉连续。
 *
 * ⚠️ `passes` 的总和必须等于改动前逐条 wash 的次数（树干 4 + 主枝 13×3 = 43），
 * 因为 `rand()` 的**总次数**一变，下游的细枝 / 树冠 / 果实会整棵重排。
 * 单遍 alpha 相应压低（43 遍 × 0.038 ≈ 累计 0.81，与原来树干 4 × 0.34 相当）。
 *
 * 不返回值 —— 画完就完。
 */
function unionWash(ctx, path, color, rand, passes, spread, alpha) {
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < passes; i++) {
        ctx.save();
        ctx.globalAlpha = alpha * (0.7 + rand() * 0.6);
        ctx.translate((rand() - 0.5) * spread, (rand() - 0.5) * spread);
        ctx.fill(path);
        ctx.restore();
    }
    ctx.restore();
}

/**
 * 树皮裂隙：**短、断续、沿轴、两端渐隐**。
 *
 * 🔴 原来是 26 条 `moveTo(x, 900)` → `bezierCurveTo(..., 660)` 的
 * **贯穿全高**的竖线，外加 14 条同样贯穿的高光。它们平行、等长、间距均匀
 * —— 那不是树皮，那是**竖着拼起来的木板**。这正是用户说的「像拼接」。
 *
 * 真实树皮是一道道**互不相连**的短裂缝：起点参差、长度不一、两端淡出。
 * 渐隐靠 strokeStyle 的线性渐变做，一次描边就够，不需要分段画。
 *
 * 不消耗随机数 —— 位置由调用方传入（调用方把原有的 rand() 值喂进来，
 * 见 makeTreeTexture 的说明）。
 */
function fissure(ctx, x, y0, y1, bow, rgb, alpha, width) {
    if (y1 <= y0) return;
    const g = ctx.createLinearGradient(x, y0, x + bow, y1);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(0.22, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.78, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + bow * 1.6, (y0 + y1) / 2, x + bow, y1);
    ctx.stroke();
}

/**
 * 0..1 的确定性伪随机，由 (i, x, k) 派生。
 *
 * 用途只有一个：给裂隙挑**位置与长度**。不能再用 `rand()` ——
 * 多一次/少一次 `rand()` 都会让下游的细枝、树冠、果实**整棵重新生成**，
 * 而这一轮只需要动树干。见 makeTreeTexture 的「回归锚点」说明。
 */
function pick01(i, x, k) {
    const s = Math.sin(i * 12.9898 + x * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
}

/* Persimmon foliage palette. Autumn tints sit in the minority — a tree in
   fruit is mostly still green, and the orange fruit is what should read. */
const TREE_GREENS = ['#4A6A31', '#567A38', '#3E5B2A', '#62883F', '#375124'];
const TREE_AUTUMN = ['#8E6A2C', '#A87C2E', '#7A5A26', '#B98A33'];
/* 春：返青的嫩芽。比 TREE_GREENS 亮一档、往黄绿偏 —— 新叶本来就更黄更透。 */
const TREE_SPRING = ['#6E8F3C', '#7FA246', '#5E7D33', '#8CB053', '#547029'];
/* The shadow pass: the same greens pushed well down in value. */
const TREE_SHADE = ['#22390F', '#2A4416', '#1B2F0C', '#31501B'];
const TREE_RIB = '#2C421C';

/**
 * 每季的树参数。
 *
 * ⚠️ `autumn` 一栏**必须逐位等于加季节之前的行为** —— 它就是原来那些写死的
 * 常量搬进了表里。改动它等于放弃本方案最便宜的回归锚点。
 *
 * 四个状态里只有两处是"结构性"的：
 *   - `winter.canopy = false` —— 整段树冠不画（柿子树的骨架 `LIMBS` 是手写死的，
 *     所以"冬天秃枝"是删一段绘制，不是做一套新资产）
 *   - `spring/summer.fruit = 0` —— 果实段不画
 *
 * `shadow` 是**画在 canvas 上的影子**的压扁系数（`ctx.scale(1, shadow)`），
 * 不是光照算出来的 —— 本项目 `LIGHTS.shadows = false`，影长只能手绘。
 * 夏至最短（0.11）、冬至最长（0.30）。`shadowDx` 是太阳方位的水平偏移。
 */
const TREE_SEASON = {
    spring: {
        canopy: true,
        foliage: { lit: TREE_SPRING, accent: null, accentChance: 0 },
        rosetteR: [30, 26],
        scatterChance: 0.28,
        fruit: 0,
        blossoms: 26,
        windfalls: 0,
        litter: 14,
        litterKind: 'petal',
        shadow: 0.20,
        shadowDx: -14,
        snow: false,
    },
    summer: {
        canopy: true,
        foliage: { lit: TREE_GREENS, accent: null, accentChance: 0 },
        rosetteR: [36, 30],
        scatterChance: 0.34,
        fruit: 0,
        blossoms: 0,
        windfalls: 0,
        litter: 0,
        litterKind: 'leaf',
        shadow: 0.11,
        shadowDx: 0,
        snow: false,
    },
    /* 秋 = 现状。这一栏是原值，不是"又调了一遍的秋色"。 */
    autumn: {
        canopy: true,
        foliage: { lit: TREE_GREENS, accent: TREE_AUTUMN, accentChance: 0.3 },
        rosetteR: [30, 26],
        scatterChance: 0.28,
        fruit: 34,
        blossoms: 0,
        windfalls: 3,
        litter: 14,
        litterKind: 'leaf',
        shadow: 0.17,
        shadowDx: 0,
        snow: false,
    },
    winter: {
        canopy: false,
        foliage: null,
        rosetteR: [0, 0],
        scatterChance: 0,
        fruit: 0,
        blossoms: 0,
        windfalls: 0,
        litter: 0,
        litterKind: 'leaf',
        shadow: 0.30,
        shadowDx: 22,
        snow: true,
    },
};

const treeSeasonOf = (season) => TREE_SEASON[season] || TREE_SEASON.autumn;

/**
 * One leaf rosette. Persimmon foliage grows in tufts at the end of a shoot,
 * so the canopy is assembled from these rather than from a single filled
 * silhouette: overlapping rosettes leave the gaps that let the wall read
 * through, which is both what the tree actually does and what keeps the
 * canopy from collapsing into a green ball.
 *
 * `shade` paints the same tuft in the dark palette. The canopy is drawn
 * twice — shade pass first, offset down and to the right, then the lit pass
 * on top — which is how the foliage gets depth. A separate blob of shadow
 * would show through the gaps between tufts as smudge on the wall; a shadow
 * made of the tufts themselves cannot escape the foliage.
 */
function drawRosette(c, cx, cy, R, baseAng, rand, shade = false, foliage = null) {
    // A small irregular wash first so the tuft has body. Deliberately much
    // smaller than the leaves reach, so it can never read as a sphere.
    const body = (cc) => wobblePath(cc, cx, cy, R * 0.66, R * 0.58, rand, { amp: 0.3, segments: 11 });
    wash(c, body, shade ? '#16260A' : '#2C4520', rand, { passes: 3, spread: R * 0.34, alpha: shade ? 0.16 : 0.11 });

    // 季节只换调色板，不换结构。`foliage.accent` 为 null 时**不调用 rand()**
    // （短路），所以春/夏是纯色树冠，而秋保持原来的「30% 秋色叶」混搭。
    const fol = foliage || { lit: TREE_GREENS, accent: TREE_AUTUMN, accentChance: 0.3 };

    const n = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
        const a = baseAng + (rand() - 0.5) * 2.9;
        const d = R * (0.1 + rand() * 0.75);
        const len = R * (0.5 + rand() * 0.46);
        const pal = shade ? TREE_SHADE
            : (fol.accent && rand() < fol.accentChance ? fol.accent : fol.lit);
        drawLeaf(
            c,
            cx + Math.cos(a) * d, cy + Math.sin(a) * d,
            a + (rand() - 0.5) * 0.7,
            len, len * (0.33 + rand() * 0.13),
            pal[Math.floor(rand() * pal.length) % pal.length],
            TREE_RIB,
            shade ? 0.94 : 0.84 + rand() * 0.16
        );
    }
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

/**
 * One persimmon. Squashed and faintly lobed rather than a clean disc, with
 * the highlight up and to the left to agree with the scene's light, a warm
 * rim so the fruit reads against the leaves, and the four-lobed calyx that
 * is the whole reason a persimmon looks like a persimmon.
 */
function drawPersimmon(c, x, y, r, rand) {
    // contact shadow, so a fruit in front of the canopy still sits in it
    c.save();
    c.globalAlpha = 0.16;
    c.fillStyle = '#2A1A0E';
    c.beginPath();
    c.ellipse(x + r * 0.12, y + r * 0.42, r * 1.2, r * 0.72, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    const g = c.createRadialGradient(
        x - r * 0.34, y - r * 0.4, r * 0.08,
        x, y + r * 0.12, r * 1.14
    );
    g.addColorStop(0.0, '#F7A94E');
    g.addColorStop(0.34, '#EE7C31');
    g.addColorStop(0.72, '#D4531D');
    g.addColorStop(1.0, '#9E3410');

    c.save();
    wobblePath(c, x, y, r, r * 0.87, rand, { amp: 0.07, segments: 20 });
    c.fillStyle = g;
    c.fill();
    c.globalAlpha = 0.32;
    c.strokeStyle = '#7A2A0B';
    c.lineWidth = Math.max(1, r * 0.085);
    c.stroke();
    c.restore();

    // calyx: four small pointed leaves splayed over the top
    c.save();
    c.fillStyle = '#6E6030';
    for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i / 4) * Math.PI * 2 + 0.35;
        const px = x + Math.cos(a) * r * 0.44;
        const py = y - r * 0.72 + Math.sin(a) * r * 0.3;
        c.save();
        c.translate(px, py);
        c.rotate(a + Math.PI / 2);
        c.beginPath();
        c.ellipse(0, 0, r * 0.4, r * 0.19, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
    }
    // a second, darker layer under the first so the calyx has depth
    c.globalAlpha = 0.55;
    c.fillStyle = '#4E4322';
    c.beginPath();
    c.ellipse(x, y - r * 0.76, r * 0.34, r * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    // stalk back up to the twig
    c.globalAlpha = 1;
    c.strokeStyle = '#5A4423';
    c.lineWidth = Math.max(1.4, r * 0.15);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y - r * 0.78);
    c.lineTo(x + r * 0.1, y - r * 1.34);
    c.stroke();
    c.restore();
}

/**
 * 一朵柿子花 / 一片落花。
 *
 * 四瓣、极淡的黄白，中间一小点花心。柿子花本来就小得几乎看不见，
 * 所以这里不追求单朵的好看，追求的是**远看能读出「这树在开花」**——
 * 春天需要一个正向信号（花开了），而不只是"没有果子"。
 */
function drawBlossom(c, x, y, r, rand) {
    c.save();
    c.translate(x, y);
    c.rotate(rand() * Math.PI * 2);
    const petals = 4;
    for (let i = 0; i < petals; i++) {
        c.save();
        c.rotate((i / petals) * Math.PI * 2);
        c.globalAlpha = 0.70 + rand() * 0.26;
        c.fillStyle = i % 2 ? '#F6F0DE' : '#EFE5CB';
        c.beginPath();
        c.ellipse(r * 0.60, 0, r * 0.66, r * 0.42, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
    }
    c.globalAlpha = 0.85;
    c.fillStyle = '#C9A24A';
    c.beginPath();
    c.arc(0, 0, r * 0.28, 0, Math.PI * 2);
    c.fill();
    c.restore();
}

/**
 * 柿子树 —— 院子的四季主心骨。
 *
 * 为什么树是四季的主轴
 * --------------------
 * 它是全场唯一有生命周期的物件：春华、夏荫、秋实、冬枯。而且它本来就被**冻在秋天** ——
 * 这个函数从写下第一天起就画的是红果 + 黄叶 + 落果 + 落叶。所以「做四季」不是给
 * 四个变体加装饰，而是**把冻住的那一季解冻**。
 *
 * 冬秃枝之所以便宜
 * ----------------
 * 树骨架（`LIMBS` 那 13 条主枝）是**手写死的**，所以冬天只是 `canopy: false` ——
 * 少画一段，不是另一套资产。
 *
 * 🔑 回归锚点：秋天的随机序列必须逐位不变
 * --------------------------------------
 * 种子里**不含季节**（固定 `'entrance:tree'`），季节只体现在 `cfg` 的开关与调色板上。
 * 加上 `taperedPath` 那次「去掉 closePath」也不消耗随机数，所以
 * `?season=autumn` 的树与加季节之前**逐位一致** —— 这是本方案最便宜的回归测试。
 * 改动本函数时，任何**新增/删减 `rand()` 调用**都会打破它。
 *
 * @param {'spring'|'summer'|'autumn'|'winter'} [season]
 */
export function makeTreeTexture(season = 'autumn') {
    const key = `entrance:tree:${season}`;
    if (cache.has(key)) return cache.get(key);
    const cfg = treeSeasonOf(season);

    // Canvas aspect matches the 6×8 plane, so the tree renders at its natural
    // proportions — the bitmap this replaces was 1010×945 and therefore
    // squashed ~1.4× vertically on screen.
    const W = 768;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    // ⚠️ 种子不含季节 —— 见上面的「回归锚点」。key 只负责缓存身份。
    const rand = mulberry32(hashString('entrance:tree'));

    // The tree group is parked at y 0.95 with an 8-unit-tall plane, and the
    // lawn sits at y -1.75 — so the ground crosses this canvas at y = 858.
    // The trunk is drawn past that line so the root flare is never sliced off
    // flat; the lawn hides the rest.
    const GROUND = 858;

    // 树皮调色板已提到模块作用域（BARK / BARK_DARK / BARK_HI）——
    // 因为 fissure() / coreHighlight() 与树干、主枝共用同一套颜色与明暗规则。

    // Keep the canopy off the canvas edges. A twig that runs out of room has
    // its length cut rather than being clipped flat — and the budget has to
    // allow for the rosette planted on its tip, which reaches roughly 1.7x
    // its own radius past the end point.
    const EDGE = { x0: 200, x1: 568, y0: 300, y1: 636 };
    const edgeFactor = (x, y) => {
        const d = Math.min(x - EDGE.x0, EDGE.x1 - x, y - EDGE.y0, EDGE.y1 - y);
        return Math.max(0.16, Math.min(1, d / 130));
    };

    /* --- 1. ground shadow -------------------------------------------- */
    // Drawn first so the trunk lands on top of it. Squashed by the context
    // transform rather than by a per-axis radius, so the falloff stays round.
    //
    // 影长是**季节信号里最强的一条**，而本项目 `LIGHTS.shadows = false`
    // （模板刻意关掉阴影贴图，是要保留的性能红利），所以影长不能靠灯算 ——
    // 它就是下面这个压扁系数：夏至 0.11 最短、冬至 0.30 最长。
    // `shadowDx` 跟着太阳方位左右挪一点。
    ctx.save();
    ctx.translate(398 + cfg.shadowDx, GROUND + 12);
    ctx.scale(1, cfg.shadow);
    const shadow = ctx.createRadialGradient(0, 0, 14, 0, 0, 300);
    shadow.addColorStop(0, 'rgba(38,52,24,0.44)');
    shadow.addColorStop(0.5, 'rgba(38,52,24,0.20)');
    shadow.addColorStop(1, 'rgba(38,52,24,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* --- 2. 树干与主枝：一次成型 -------------------------------------- */
    // A slight lean to the left as it rises, and a root flare at the base.
    const trunk = [[410, 894], [404, 830], [398, 764], [393, 706], [390, 648]];
    const trunkPath = (c) => taperedPath(c, trunk, 86, 48);

    // Hand-authored rather than grown, so the silhouette is art-directed
    // instead of merely random: three scaffolds off the trunk, each splitting
    // into three sub-limbs, plus a short arm placed where the wind chime
    // hangs. Everything finer than this is generated.
    const LIMBS = [
        // --- scaffold A, to the left
        { pts: [[390, 648], [352, 606], [310, 570], [266, 536], [220, 506], [176, 482]], w0: 44, w1: 17 },
        { pts: [[310, 570], [262, 540], [212, 514], [166, 494]], w0: 20, w1: 9 },
        { pts: [[266, 536], [236, 484], [208, 434], [188, 390]], w0: 18, w1: 8 },
        { pts: [[220, 506], [176, 480], [134, 460]], w0: 16, w1: 7 },
        // --- scaffold B, to the right
        { pts: [[390, 648], [434, 606], [480, 568], [526, 534], [572, 506], [618, 482]], w0: 44, w1: 17 },
        { pts: [[480, 568], [530, 538], [580, 512], [626, 490]], w0: 20, w1: 9 },
        { pts: [[526, 534], [558, 482], [590, 432], [612, 388]], w0: 18, w1: 8 },
        { pts: [[572, 506], [618, 484], [658, 466]], w0: 16, w1: 7 },
        // --- scaffold C, straight up
        { pts: [[390, 648], [396, 578], [402, 508], [410, 440], [418, 376]], w0: 40, w1: 15 },
        { pts: [[402, 508], [362, 470], [320, 436]], w0: 18, w1: 8 },
        { pts: [[410, 440], [452, 402], [492, 370]], w0: 18, w1: 8 },
        { pts: [[418, 376], [424, 318], [428, 264]], w0: 16, w1: 7 },
        // --- the arm the wind chime hangs from (see EntranceDoors: the chime
        //     group sits at world x 2.45, which lands on this canvas at 442,493)
        { pts: [[396, 578], [420, 544], [440, 512], [450, 486]], w0: 18, w1: 7 },
    ];

    /* 🔴 「像拼接出来的」的正解：树干与 13 条主枝**共用一个并集轮廓**。
     *
     * 以前它们是各自 `wash` + 各自打光 + 各自描边。重叠的地方叠了两层、
     * 不重叠的地方只有一层 —— 于是分叉两侧的**色调**必然对不上，那条水平的
     * 分界就是这么来的（放大 5 倍看得最清楚）。逐条去"把色调调成一样"
     * 是治不好的：主枝的轮廓在分叉处是一条**平底**，底色画到那儿就断。
     *
     * 裁到并集之后，底色、水彩、亮芯、树皮裂隙**全都跨过分叉连续**，
     * 只剩墨线还是逐条的 —— 而墨线本来就该是并集的边界。
     */
    const skeleton = new Path2D();
    const skeletonSink = {
        beginPath() { },
        moveTo: (x, y) => skeleton.moveTo(x, y),
        lineTo: (x, y) => skeleton.lineTo(x, y),
    };
    taperedPath(skeletonSink, trunk, 86, 48);
    for (const L of LIMBS) taperedPath(skeletonSink, L.pts, L.w0, L.w1);

    /**
     * 全局光：**水平**的一束，整棵树共用一条渐变。
     *
     * 为什么是水平而不是斜的：树干是竖直的，所以**横向**渐变对树干而言
     * 正好就是圆柱明暗（左亮右暗）。斜向渐变在树干上的投影几乎只剩竖直
     * 分量 —— 那是"上亮下暗"，树干照样是平的（试过，就是一团糊的棕色）。
     * 对主枝而言横向渐变则是一盏从左来的方向光：左边亮、右边暗。
     *
     * 试过「每条枝各画一条亮芯」，结果是三条亮芯在分叉处交叠、拼出一个
     * 亮 X —— 逐条打光天然会在交汇处打架。一盏灯照一整块就没这问题。
     */
    const lightField = () => {
        const g = ctx.createLinearGradient(170, 700, 640, 700);
        g.addColorStop(0.00, `rgba(${BARK_HI_RGB},0.08)`);
        g.addColorStop(0.28, `rgba(${BARK_HI_RGB},0.20)`);
        g.addColorStop(0.55, `rgba(${BARK_HI_RGB},0.02)`);
        g.addColorStop(0.80, `rgba(${BARK_DARK_RGB},0.12)`);
        g.addColorStop(1.00, `rgba(${BARK_DARK_RGB},0.22)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    };

    ctx.save();
    ctx.clip(skeleton);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 底色。⚠️ 总遍数必须等于原来逐条 wash 的次数（树干 4 + 主枝 13×3 = 43）：
    // `rand()` 的**总次数**一变，下游的细枝、树冠、果实会**整棵重排**。
    // 所以这里照样跑 43 遍，只是把落点从「各自的轮廓」换成「并集轮廓」。
    // 单遍 alpha 相应压到 0.038（43 遍累计 ≈ 0.81，与原来树干的 4×0.34 相当）。
    unionWash(ctx, skeleton, BARK, rand, 4, 5, 0.038);
    for (const L of LIMBS) unionWash(ctx, skeleton, BARK, rand, 3, 4, 0.038);

    // 全局光 + 根部压暗（环境遮蔽）。两者都裁在并集内，所以跨分叉连续。
    lightField();
    const ao = ctx.createLinearGradient(0, 910, 0, 620);
    ao.addColorStop(0, `rgba(${BARK_DARK_RGB},0.20)`);
    ao.addColorStop(0.5, `rgba(${BARK_DARK_RGB},0.05)`);
    ao.addColorStop(1, `rgba(${BARK_DARK_RGB},0)`);
    ctx.fillStyle = ao;
    ctx.fillRect(100, 580, 580, 360);

    // 树皮裂隙。⚠️ 每条裂隙**只占树干的一小段**（原来是从 y=900 一路贯到
    // y=660 的长线 —— 26 条平行等长的竖线读出来就是「竖着拼的木板」）。
    // 位置与长度由 pick01() 派生，**不再多消耗 rand()**：这里 26×3 / 14×3
    // 次调用的次数必须原样保留，否则细枝、树冠、果实会跟着整棵重生成。
    for (let i = 0; i < 26; i++) {
        const x = 356 + rand() * 62;
        const alpha = 0.22 + rand() * 0.26;
        const width = 3 + rand() * 5;
        const y0 = 662 + pick01(i, x, 1) * 168;
        const len = 62 + pick01(i, x, 2) * 168;
        fissure(ctx, x, y0, Math.min(902, y0 + len), (pick01(i, x, 3) - 0.5) * 12,
            BARK_DARK_RGB, alpha, width);
    }
    for (let i = 0; i < 14; i++) {
        const x = 368 + rand() * 40;
        const alpha = 0.17 + rand() * 0.20;
        const width = 2 + rand() * 4;
        const y0 = 664 + pick01(i + 40, x, 4) * 150;
        const len = 48 + pick01(i + 40, x, 5) * 132;
        fissure(ctx, x, y0, Math.min(894, y0 + len), (pick01(i + 40, x, 6) - 0.5) * 10,
            BARK_HI_RGB, alpha, width);
    }
    // 横向短裂纹。柿子树的皮是**块状**开裂，不是只有竖纹 —— 而且竖纹加横纹
    // 交织之后，也就不容易再被读成"竖着拼起来的木板"。
    // ⚠️ 位置全部由 pick01 派生：**一次 rand() 都不能再消耗**。
    for (let i = 0; i < 16; i++) {
        ctx.save();
        ctx.translate(356 + pick01(i, 13, 12) * 58, 672 + pick01(i, 7, 11) * 216);
        ctx.rotate(Math.PI / 2 + (pick01(i, 29, 16) - 0.5) * 0.5);
        fissure(ctx, 0, 0, 12 + pick01(i, 17, 13) * 26,
            (pick01(i, 31, 17) - 0.5) * 4, BARK_DARK_RGB,
            0.10 + pick01(i, 19, 14) * 0.16, 1.5 + pick01(i, 23, 15) * 1.6);
        ctx.restore();
    }
    ctx.restore();

    // Ink edge, same as the limbs get — an ink-and-wash trunk is drawn, not
    // merely shaded, and without this it reads as a pale bar on a pale wall.
    ctx.save();
    ctx.globalAlpha = 0.5;
    trunkPath(ctx);
    ctx.strokeStyle = BARK_DARK;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // A knot where the trunk forks.
    //
    // 第一版只画了「暗色实心椭圆 + 一圈亮色描边」，结果读出来是个**悬空的
    // 圆环**：实心那层 alpha 0.4、又是压在同样暗的树皮上，几乎看不见；
    // 而 BARK_HI 那圈 alpha 0.3 的描边反而是唯一看得见的东西。
    // 再加上圆心 (416) 偏离中轴线 (398)，右边就溢出到轮廓外面去了。
    //
    // 第二版改成三层同心椭圆，**还是**读成一个悬空的环 —— 因为完整的一圈
    // 亮边本身就等于"这里有个环"。真实树结是**结心凹下去 + 只在上缘顶起
    // 一圈皮**，所以这一版把亮边改成**半圈弧**（只画受光的上半圈），
    // 再从结的两侧各拉一条树皮线出去，把结缝回树干里。
    // 该处树干半宽约 33px（taperedPath 86→48，y=764 处约 66/2），
    // 最外圈半宽 16 → 旋转后包围盒约 16.6，安全。
    ctx.save();
    ctx.translate(398, 764);
    ctx.rotate(0.22);
    // 结心：最暗最实的一块，这才是「结」的主体
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = BARK_DARK;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    // 上缘被顶起来的那半圈树皮高光（0.78π → 1.72π 是画布上的上半圈）
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = BARK_HI;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 25, 0, Math.PI * 0.78, Math.PI * 1.72);
    ctx.stroke();
    // 结两侧顺下来的树皮线 —— 把结"缝"回树干，而不是让它浮在上面
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = BARK_DARK;
    ctx.lineWidth = 2;
    for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 13, -25);
        ctx.quadraticCurveTo(sx * 27, 0, sx * 14, 26);
        ctx.stroke();
    }
    ctx.restore();

    /* --- 3. 主枝：顺纹 + 墨线 ------------------------------------------ */
    // 底色与全局光已经在上面按**并集**画完了。这里只剩两件事：
    // 粗主枝的顺纹（grain），和逐条的墨线。
    for (const L of LIMBS.slice().sort((a, b) => b.w0 - a.w0)) {
        // Thick limbs get grain along their length; thin ones don't need it
        // and it would only muddy the ink edge below.
        // ⚠️ 这 7×4 次 rand() 是随机数序列的一部分 —— 与上面并集底色的
        // 12 + 117 次、树干的 78 + 42 次一起，总数必须与改动前一致
        // （否则下游的细枝 / 树冠 / 果实会整棵重排）。
        if (L.w0 >= 30) {
            ctx.save();
            ctx.clip(skeleton);
            ctx.lineCap = 'round';
            for (let i = 0; i < 7; i++) {
                ctx.globalAlpha = 0.14 + rand() * 0.16;
                ctx.strokeStyle = i % 2 ? BARK_HI : BARK_DARK;
                ctx.lineWidth = 2 + rand() * 3;
                ctx.beginPath();
                let started = false;
                L.pts.forEach((p, idx) => {
                    // ⚠️ rand() 照常消耗（两个点两次），只是**不画**起点 ——
                    // 起点就是分叉点，三条主枝的顺纹都在那里收拢，会在分叉处
                    // 织出一片明暗条纹，看着又像"拼"上去的。
                    const jx = p[0] + (rand() - 0.5) * 10;
                    const jy = p[1] + (rand() - 0.5) * 10;
                    if (idx === 0) return;
                    if (!started) { ctx.moveTo(jx, jy); started = true; }
                    else ctx.lineTo(jx, jy);
                });
                ctx.stroke();
            }
            ctx.restore();
        }
        // Ink edge. Without it the limbs read as pale bars against a pale
        // wall — the whole point of an ink-and-wash tree is that the
        // branches are drawn, not merely shaded.
        //
        // ⚠️ 子枝的**起点埋在父枝里**（LIMBS 里那些 `pts[0]` 都落在另一条枝的
        // 路径上）。整条描边会在父枝内部留下一道缝，看着就像小枝是贴上去的。
        // 所以子枝描边前先**挖掉起点附近的一个圆** —— 那里本来就该长在父枝
        // 里面，不该有轮廓线。三条主枝不挖：它们的起点就是分叉点，轮廓正是
        // 并集的边界，挖了反而在分叉处缺口。
        ctx.save();
        ctx.globalAlpha = 0.5;
        // 三条主枝**共用同一个起点**（分叉点），轮廓在分叉附近互相插进对方
        // 内部 —— 直接描会在分叉处织出一个菱形。所以主枝从第 1 个采样点开始描。
        // 子枝是另一种情况：起点埋在**父枝**里，用「挖圆」更直接。
        if (L.w0 < 30) {
            const hole = new Path2D();
            hole.rect(-200, -200, W + 400, H + 400);
            hole.arc(L.pts[0][0], L.pts[0][1], L.w0 * 0.75 + 6, 0, Math.PI * 2);
            ctx.clip(hole, 'evenodd');
        }
        taperedPath(ctx, L.pts, L.w0, L.w1, L.w0 >= 30 ? 1 : 0);
        ctx.strokeStyle = BARK_DARK;
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.restore();
    }

    /* --- 4. twigs ----------------------------------------------------- */
    const twigs = [];
    const tips = [];

    const grow = (x, y, ang, len, w, depth) => {
        const pts = shoot(x, y, ang, len * edgeFactor(x, y), (rand() - 0.5) * 0.85, depth > 0 ? 9 : 6);
        for (const p of pts) {
            p[0] = Math.max(150, Math.min(620, p[0]));
            p[1] = Math.max(220, Math.min(700, p[1]));
        }
        twigs.push({ pts, w });
        const [ex, ey] = pts[pts.length - 1];
        if (depth <= 0) {
            tips.push([ex, ey, ang]);
            return;
        }
        const n = rand() < 0.45 ? 3 : 2;
        for (let i = 0; i < n; i++) {
            const spread = 0.62 + rand() * 0.55;
            grow(
                ex, ey,
                ang + (i - (n - 1) / 2) * spread + (rand() - 0.5) * 0.3,
                len * (0.6 + rand() * 0.22),
                w * 0.6,
                depth - 1
            );
        }
    };

    const shootOff = (L, at, ang, len, w, depth) => {
        const p = L.pts[at];
        const q = L.pts[Math.max(0, at - 1)];
        grow(p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]) + ang, len, w, depth);
    };

    for (const L of LIMBS) {
        if (L.w0 >= 30) {
            // A scaffold: a fan of twigs off its end, plus two side shoots.
            shootOff(L, L.pts.length - 1, 0, 76 + rand() * 30, 9, 2);
            shootOff(L, 3, 1.05, 62 + rand() * 24, 7, 1);
            shootOff(L, 4, -1.05, 62 + rand() * 24, 7, 1);
        } else if (L.w0 >= 16) {
            // A sub-limb: one fan, one side shoot.
            shootOff(L, L.pts.length - 1, 0, 62 + rand() * 26, 7, 2);
            shootOff(L, 1, rand() < 0.5 ? 0.95 : -0.95, 52 + rand() * 20, 6, 1);
        }
    }

    // thin first, thick last, so the heavier twigs sit on top of the fine ones
    for (const t of twigs.slice().sort((a, b) => a.w - b.w)) {
        limb(ctx, t.pts, t.w, '#6B4A30', { taper: 0.72 });
    }

    /* --- 4b. 冬：枝上积雪 ---------------------------------------------- */
    // 只在冬天画，压在骨架与细枝之上 —— 雪是最后落到枝上的东西。
    //
    // 沿每条枝的**法线朝上**偏一段，而不是简单地把 y 减小：水平走向的枝上
    // 减 y 会把雪线整个挪出枝条外，法线偏移才对所有走向都成立。
    // （canvas 的 y 轴朝下，所以"朝上"是 ny < 0。）
    //
    // 🔴 只在**够水平**的段落上画雪，竖直段直接跳过。
    //
    // 第一版把偏移量乘了个「朝上程度」`|ny|` —— 那是错的：`|ny| → 0` 只是让
    // 雪线**贴回枝条中线**，于是树干上出现一条从分叉点拖到根部的白线。
    // 短不等于对，得**不画**。所以这里把折线按 `up` 切成若干段，只给
    // `up >= 0.30` 的连续段描边 —— 物理上也对：竖直的枝干挂不住雪。
    //
    // 🔴 「雪条相交」（2026-10-09 用户截图）的成因与解法
    // ----------------------------------------------------
    // 「法线永远朝上」这条规则本身没错。错在**分叉处**：两条枝的"朝上法线"
    // 会**指向彼此**，于是各自的雪线朝对方偏，在分叉上方的**空隙**里交叉成
    // 一个 X —— 那正是截图里最显眼的一处。
    //
    // 解法不是改偏移方向（改成朝下雪就跑到枝底下了），而是**把整段雪裁在
    // 树冠轮廓之内**。裁完那个 X 落在实心枝干上，读起来是"分叉处积了雪"，
    // 而不是两条白线悬在空中打架；顺带所有悬空的白线也一并消失。
    // 再加一条：每条雪线的首尾各让掉一成，避开分叉最挤的地方。
    if (cfg.snow) {
        const UP_MIN = 0.30;
        const INSET = 0.14;

        // 树冠并集轮廓：树干 + 主枝 + 细枝。taperedPath 对所有枝都用同一种
        // 绕向，所以 `clip(path)` 的 nonzero 规则得到的正好是**并集**。
        // 细枝是 `limb()` 描出来的圆头粗线，用同宽同 taper 的 taperedPath
        // 做等效轮廓，裁雪够用了。
        const canopy = new Path2D();
        const sink = {
            beginPath() { },
            moveTo: (x, y) => canopy.moveTo(x, y),
            lineTo: (x, y) => canopy.lineTo(x, y),
        };
        taperedPath(sink, trunk, 86, 48);
        for (const L of LIMBS) taperedPath(sink, L.pts, L.w0, L.w1);
        for (const t of twigs) taperedPath(sink, t.pts, t.w, t.w * 0.72);

        const snowRun = (run) => {
            if (run.length < 2) return;
            const a = run[0];
            const b = run[run.length - 1];
            // 两端渐隐：strokeStyle 用线性渐变，一次描边就够，不必把 run
            // 拆成几段。雪是**积**在枝上的，不该是一条两端齐平的硬白条。
            const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
            g.addColorStop(0, 'rgba(239,244,249,0)');
            g.addColorStop(0.20, 'rgba(239,244,249,1)');
            g.addColorStop(0.80, 'rgba(239,244,249,1)');
            g.addColorStop(1, 'rgba(239,244,249,0)');
            ctx.strokeStyle = g;
            ctx.beginPath();
            run.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
            ctx.stroke();
        };

        const snowLine = (pts, w0, w1, wMul) => {
            const n = pts.length;
            let run = [];
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                if (t < INSET || t > 1 - INSET * 0.5) { snowRun(run); run = []; continue; }
                const w = (w0 + (w1 - w0) * t) * wMul;
                const p = pts[i];
                const q = pts[Math.min(n - 1, i + 1)];
                const r = pts[Math.max(0, i - 1)];
                let dx = q[0] - r[0];
                let dy = q[1] - r[1];
                const L = Math.hypot(dx, dy) || 1;
                dx /= L;
                dy /= L;
                let nx = -dy;
                let ny = dx;
                if (ny > 0) { nx = -nx; ny = -ny; }
                if (Math.abs(ny) < UP_MIN) { snowRun(run); run = []; continue; }
                run.push([p[0] + nx * w, p[1] + ny * w]);
            }
            snowRun(run);
        };

        ctx.save();
        ctx.clip(canopy);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 树干**不画**：它几乎竖直，`up ≈ 0.08` 会被 UP_MIN 整段跳过。
        // 留着这一条反而是个陷阱 —— 它看起来像"给树干也上了雪"，
        // 但实际一个像素都不会落下去。要真的给树干积雪，得改的是
        // 根部的**根盘**（水平面），不是这条竖直的轮廓。

        // 主枝
        ctx.globalAlpha = 0.90;
        ctx.lineWidth = 3.2;
        for (const L of LIMBS) snowLine(L.pts, L.w0, L.w1, 0.22);

        // 细枝：薄薄一层，细枝挂不住多少雪
        ctx.globalAlpha = 0.70;
        ctx.lineWidth = 1.8;
        for (const t of twigs) snowLine(t.pts, t.w, t.w * 0.72, 0.30);

        ctx.restore();
    }

    /* --- 5. canopy ----------------------------------------------------- */
    // Rosettes at every terminal tip, plus a scattering along the shoots, so
    // the foliage follows the branch structure instead of floating over it.
    // Painted in a shuffled order: cluster-by-cluster along a branch would
    // show up as stripes.
    //
    // 冬：整段不画 —— **这就是「秃枝」**。骨架是手写死的，所以冬天是少画一段，
    // 不是另一套资产。春夏秋的差异只在 rosetteR（树冠厚度）、scatterChance
    // （细枝上补多少簇）与 foliage（调色板）。
    if (cfg.canopy) {
        const [rBase, rJit] = cfg.rosetteR;
        const rosettes = [];
        for (const [x, y, a] of tips) rosettes.push([x, y, a, rBase + rand() * rJit]);
        for (const t of twigs) {
            for (let i = 2; i < t.pts.length; i += 3) {
                if (rand() > cfg.scatterChance) continue;
                const p = t.pts[i];
                const q = t.pts[i - 1];
                rosettes.push([p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]), 18 + rand() * 22]);
            }
        }
        rosettes.sort(() => rand() - 0.5);

        // Shadow pass, offset down-right, then the lit pass over the top.
        ctx.save();
        ctx.translate(13, 11);
        for (const [x, y, a, R] of rosettes) drawRosette(ctx, x, y, R, a, rand, true, cfg.foliage);
        ctx.restore();
        for (const [x, y, a, R] of rosettes) drawRosette(ctx, x, y, R, a, rand, false, cfg.foliage);
    }

    /* --- 6. fruit ------------------------------------------------------ */
    // Persimmons hang off the terminal twigs. A tree in fruit shows them on
    // the outside of the canopy, not buried in it, so the drooping low limbs
    // get a share as well.
    const hang = [];
    for (const [x, y] of tips) if (rand() < 0.6) hang.push([x, y]);
    // the two long low sub-limbs carry fruit out where it can be seen
    for (const li of [1, 5]) {
        for (const p of LIMBS[li].pts) if (rand() < 0.55) hang.push(p);
    }
    hang.sort(() => rand() - 0.5);
    // 数量由季节给：秋 34（现状），其余三季 0。
    // `slice(0, 0)` 是空数组 —— 既没画东西也没消耗随机数，所以不需要额外的 if。
    for (const [x, y] of hang.slice(0, cfg.fruit)) {
        // Fruit radius, against the canopy leaves drawn by drawRosette.
        //
        // A rosette's leaves come out at R * (0.5..0.96) with R = 30..56, so a
        // typical canopy leaf is ~31 px long on this canvas. A 柿 leaf really
        // is ~12 cm and a 柿 fruit ~6.5 cm — the fruit is a bit over HALF the
        // leaf. At the old 15..23 the fruit was 38 px across, i.e. wider than
        // the leaves holding it, which is why the tree read as an apple tree.
        // 7..10 puts the fruit back at ~0.55 of a leaf.
        const r = 7 + rand() * 3;
        drawPersimmon(ctx, x + (rand() - 0.5) * 16, y + r * 1.15 + rand() * 8, r, rand);
    }

    /* --- 6b. 春：花 ---------------------------------------------------- */
    // 柿子花其实很小、黄白色，不像桃花那样张扬。所以这里刻意画得**小、颜色淡**，
    // 靠数量读出春天，而不是靠单朵的艳 —— 一棵柿树开花本来就不是一场花事。
    if (cfg.blossoms > 0) {
        const spots = [];
        for (const [x, y] of tips) if (rand() < 0.5) spots.push([x, y]);
        spots.sort(() => rand() - 0.5);
        for (const [x, y] of spots.slice(0, cfg.blossoms)) {
            drawBlossom(ctx, x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 12, 5 + rand() * 3, rand);
        }
    }

    /* --- 7. windfalls / 落花 ------------------------------------------- */
    // Three on the grass: the detail that turns a tree into a season.
    // Same fruit size as the canopy — a windfall does not shrink on the way
    // down. The old 21/18/20 were the same oversized fruit lying on the lawn.
    //
    // 地上这一层是四季差异最讨巧的地方：秋 = 落果 + 落叶，春 = 落花，
    // 夏冬什么都不落（`litter: 0`）。`slice(0, 0)` 同样是空数组。
    const WINDSPOTS = [[268, 840, 8], [330, 856, 7], [486, 846, 7.5]];
    for (const [x, y, r] of WINDSPOTS.slice(0, cfg.windfalls)) {
        drawPersimmon(ctx, x, y, r, rand);
    }
    for (let i = 0; i < cfg.litter; i++) {
        if (cfg.litterKind === 'petal') {
            drawBlossom(ctx, 180 + rand() * 400, 826 + rand() * 30, 4 + rand() * 3, rand);
            continue;
        }
        const pal = rand() < 0.5 ? TREE_AUTUMN : TREE_GREENS;
        drawLeaf(
            ctx, 180 + rand() * 400, 826 + rand() * 30, rand() * Math.PI * 2,
            17 + rand() * 9, 7 + rand() * 3,
            pal[Math.floor(rand() * pal.length) % pal.length],
            TREE_RIB, 0.5 + rand() * 0.3
        );
    }

    grain(ctx, W, H, rand, { alpha: 0.05, size: 1.5 });

    return toTexture(canvas, key);
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
    const TOP = worldH * 0.92;

    // Runners. `x` is a fraction of the half-width (so the planting re-spaces
    // itself when the facade changes size instead of sliding off the edge),
    // `len` a fraction of the wall height, `drift` how far the tip wanders
    // sideways, `sway` the amplitude of its S-curve, `n` how many strands
    // come off one anchor. Unevenly spaced and unevenly long on purpose — an
    // even row reads as wallpaper, not as a creeper.
    //
    // All five sit right of the gate (x/5 ≥ 0.236, i.e. world x ≥ 1.18) and
    // clear the window at 2.5: the two nearest it drift AWAY from it, so the
    // strand nearest the opening ends up at ≈ 1.25 while the opening starts
    // at 1.8.
    const runners = [
        { x: 0.236, len: 0.46, drift: 0.075, sway: 0.15, n: 1 },
        { x: 0.320, len: 0.63, drift: -0.055, sway: 0.21, n: 2 },
        { x: 0.700, len: 0.56, drift: -0.090, sway: 0.18, n: 2 },
        { x: 0.810, len: 0.40, drift: 0.060, sway: 0.13, n: 1 },
        { x: 0.924, len: 0.53, drift: -0.045, sway: 0.22, n: 1 },
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
    const spineSteps = 22;
    for (let k = 0; k <= spineSteps; k++) {
        const t = k / spineSteps;
        const wx = (worldW / 2) * (0.10 + t * 0.86);
        // a shallow sag between attachment points, plus a slight climb to the
        // right, so it reads as a stem and not as a ruled line
        const sag = Math.sin(t * 2.3) * 0.055 * worldH + t * 0.025 * worldH;
        spinePts.push([X(wx), Y(TOP - sag)]);
    }
    ctx.save();
    // The runner is the vine's backbone: at the old 0.66 it was see-through and
    // the whole creeper read as a wash rather than as a plant with a stem.
    ctx.globalAlpha = 0.80;
    limb(ctx, spinePts, 13, STEM, { taper: 0.62 });
    // the doubled line a brush leaves — without it the stem reads as a wire
    ctx.globalAlpha = 0.34;
    limb(ctx, spinePts.map(([x, y]) => [x, y + 5]), 5, INK_RIB, { taper: 0.7 });
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
    for (let c = 0; c < 26; c++) {
        const wx = (worldW / 2) * (0.10 + rand() * 0.88);
        const cx = X(wx);
        // biased downward so the mass sits ON the wall under the tiles rather
        // than floating above the coping where it would be clipped flat
        const cy = Y(TOP - rand() * rand() * 0.80);
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
            ctx.save();
            ctx.globalAlpha = 0.80;
            limb(ctx, pts, 9, STEM, { taper: 0.34 });
            ctx.globalAlpha = 0.32;
            limb(ctx, pts.map(([x, y]) => [x + 5, y]), 3.4, INK_RIB, { taper: 0.5 });
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
                const count = Math.max(0, Math.round((1 - t) * 3.9 - 0.1 + rand() * 1.4));
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
    for (let i = 0; i < 10; i++) {
        const cx = X((0.12 + rand() * 0.84) * (worldW / 2));
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
/* Avatar at the window — now a bitmap, not canvas art                  */
/* ------------------------------------------------------------------ */
/*
 * The character who slides into the window used to be drawn here:
 * drawWavingCharacter + makeAvatarWindowTexture, ~500 lines of flat vector
 * shapes. Replaced on 2026-10-07 by
 * public/textures/entrance/avatar-window.webp, generated as a PAIR with the
 * corridor IP sprite (public/textures/corridor/avatar_zeo.webp) so the two
 * characters finally read as the same person.
 *
 * This is a deliberate exception to the "zero bitmap" rule. That rule exists
 * so the site never NEEDS an image asset — not to forbid character art.
 * A face assembled from circles and beziers is the one thing that always
 * looks like a placeholder next to the rest of the scene.
 *
 * Loaded with useTexture in EntranceDoors, preloaded via ENTRANCE_TEXTURES.
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
