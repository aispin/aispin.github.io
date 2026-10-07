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
import { alphaBBox, hashString, makeCanvas, mulberry32 } from '../engine/art';

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
    const HEAD = '#F6C078';
    const HEAD_HI = '#FBDCA8';

    const shellPath = (c) => {
        c.beginPath();
        c.moveTo(78, 300);
        c.bezierCurveTo(78, 196, 160, 150, 256, 150);
        c.bezierCurveTo(352, 150, 434, 196, 434, 300);
        c.bezierCurveTo(434, 400, 366, 470, 256, 470);
        c.bezierCurveTo(146, 470, 78, 400, 78, 300);
        c.closePath();
    };
    const headPath = (c) => {
        c.beginPath();
        c.moveTo(112, 272);
        c.bezierCurveTo(104, 164, 172, 92, 256, 92);
        c.bezierCurveTo(340, 92, 408, 164, 400, 272);
        c.closePath();
    };

    // --- antennae (behind everything) ---
    limb(ctx, [[208, 140], [188, 92], [158, 52], [142, 30]], 13, INK, { taper: 0.5 });
    limb(ctx, [[304, 140], [324, 92], [354, 52], [370, 30]], 13, INK, { taper: 0.5 });
    [[142, 30], [370, 30]].forEach(([x, y]) => {
        ctx.save();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.ellipse(x, y, 19, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // --- legs (behind the shell) ---
    [-1, 1].forEach((s) => {
        [[236, 300], [214, 372], [196, 438]].forEach(([x, y], i) => {
            const sx = 256 + s * (x - 256);
            const ex = 256 + s * ((x - 256) + 60 + i * 6);
            limb(ctx, [[sx, y], [ex, y + 26], [ex + s * 16, y + 58]], 12, INK, { taper: 0.6 });
        });
    });

    // --- head ---
    wash(ctx, headPath, HEAD, rand, { passes: 4, spread: 5, alpha: 0.34 });
    speckleIn(ctx, headPath, [HEAD_HI, '#F2AE62', '#FDE6C2'], rand, { count: 110, rMin: 3, rMax: 10, alpha: 0.3 });

    // --- shell ---
    wash(ctx, shellPath, SHELL, rand, { passes: 5, spread: 7, alpha: 0.34 });
    speckleIn(ctx, shellPath, [SHELL_HI, SHELL_LO, '#F26B33', '#D94A20'], rand, { count: 260, rMin: 3, rMax: 14, alpha: 0.26 });

    // shell spots
    ctx.save();
    shellPath(ctx);
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = SHELL_LO;
    [[176, 316, 30, 26], [176, 396, 24, 20], [336, 322, 28, 24], [330, 400, 22, 18], [256, 430, 26, 18]].forEach(
        ([x, y, rx, ry]) => {
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, rand() * 0.6 - 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    );
    ctx.restore();

    // centre seam
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 244);
    ctx.bezierCurveTo(250, 320, 250, 400, 256, 462);
    ctx.stroke();
    ctx.restore();

    // --- face ---
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    [[200, 196, 56], [312, 196, 56]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 1.06, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#2A201A';
    [[206, 200, 30], [306, 200, 30]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = '#FFFFFF';
    [[194, 186, 11], [294, 186, 11]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();

    // smile
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(256, 238, 26, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // --- outlines ---
    inkOutline(ctx, headPath, INK, 10, rand);
    inkOutline(ctx, shellPath, INK, 12, rand);

    // eye rims
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    [[200, 196, 56], [312, 196, 56]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 1.06, 0, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.restore();

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
 */
function taperedPath(c, pts, w0, w1) {
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
    c.beginPath();
    c.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) c.lineTo(left[i][0], left[i][1]);
    for (let i = n - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
    c.closePath();
}

/* Persimmon foliage palette. Autumn tints sit in the minority — a tree in
   fruit is mostly still green, and the orange fruit is what should read. */
const TREE_GREENS = ['#4A6A31', '#567A38', '#3E5B2A', '#62883F', '#375124'];
const TREE_AUTUMN = ['#8E6A2C', '#A87C2E', '#7A5A26', '#B98A33'];
/* The shadow pass: the same greens pushed well down in value. */
const TREE_SHADE = ['#22390F', '#2A4416', '#1B2F0C', '#31501B'];
const TREE_RIB = '#2C421C';

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
function drawRosette(c, cx, cy, R, baseAng, rand, shade = false) {
    // A small irregular wash first so the tuft has body. Deliberately much
    // smaller than the leaves reach, so it can never read as a sphere.
    const body = (cc) => wobblePath(cc, cx, cy, R * 0.66, R * 0.58, rand, { amp: 0.3, segments: 11 });
    wash(c, body, shade ? '#16260A' : '#2C4520', rand, { passes: 3, spread: R * 0.34, alpha: shade ? 0.16 : 0.11 });

    const n = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
        const a = baseAng + (rand() - 0.5) * 2.9;
        const d = R * (0.1 + rand() * 0.75);
        const len = R * (0.5 + rand() * 0.46);
        const pal = shade ? TREE_SHADE : (rand() < 0.3 ? TREE_AUTUMN : TREE_GREENS);
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
    c.globalAlpha = alpha * 0.55;
    c.strokeStyle = rib;
    c.lineWidth = Math.max(0.7, wid * 0.11);
    c.beginPath();
    c.moveTo(len * 0.08, 0);
    c.lineTo(len * 0.9, 0);
    c.stroke();
    c.globalAlpha = alpha * 0.34;
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

export function makeTreeTexture() {
    const key = 'entrance:tree';
    if (cache.has(key)) return cache.get(key);

    // Canvas aspect matches the 6×8 plane, so the tree renders at its natural
    // proportions — the bitmap this replaces was 1010×945 and therefore
    // squashed ~1.4× vertically on screen.
    const W = 768;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // The tree group is parked at y 0.95 with an 8-unit-tall plane, and the
    // lawn sits at y -1.75 — so the ground crosses this canvas at y = 858.
    // The trunk is drawn past that line so the root flare is never sliced off
    // flat; the lawn hides the rest.
    const GROUND = 858;

    const BARK = '#66452A';
    const BARK_DARK = '#3F2A1B';
    const BARK_HI = '#A8835B';

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
    ctx.save();
    ctx.translate(398, GROUND + 12);
    ctx.scale(1, 0.17);
    const shadow = ctx.createRadialGradient(0, 0, 14, 0, 0, 300);
    shadow.addColorStop(0, 'rgba(38,52,24,0.44)');
    shadow.addColorStop(0.5, 'rgba(38,52,24,0.20)');
    shadow.addColorStop(1, 'rgba(38,52,24,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* --- 2. trunk ----------------------------------------------------- */
    // A slight lean to the left as it rises, and a root flare at the base.
    const trunk = [[410, 894], [404, 830], [398, 764], [393, 706], [390, 648]];
    const trunkPath = (c) => taperedPath(c, trunk, 86, 48);
    wash(ctx, trunkPath, BARK, rand, { passes: 4, spread: 5, alpha: 0.34 });

    ctx.save();
    trunkPath(ctx);
    ctx.clip();
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
        const x = 356 + rand() * 62;
        ctx.globalAlpha = 0.16 + rand() * 0.2;
        ctx.strokeStyle = BARK_DARK;
        ctx.lineWidth = 3 + rand() * 5;
        ctx.beginPath();
        ctx.moveTo(x, 900);
        ctx.bezierCurveTo(x - 8, 826, x + 8, 754, x - 3, 660);
        ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
        const x = 368 + rand() * 40;
        ctx.globalAlpha = 0.14 + rand() * 0.16;
        ctx.strokeStyle = BARK_HI;
        ctx.lineWidth = 2 + rand() * 4;
        ctx.beginPath();
        ctx.moveTo(x, 892);
        ctx.bezierCurveTo(x + 7, 818, x - 7, 746, x + 4, 668);
        ctx.stroke();
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
    // 真实树结是**同心的一圈圈**：外层树皮鼓起来、中间凹下去、结心最暗。
    // 所以这里改成三层，并且把圆心对回中轴线。
    // 该处树干半宽约 33px（taperedPath 86→48，y=764 处约 66/2），
    // 最外圈半宽 20 → 旋转后包围盒约 20.6，安全。
    ctx.save();
    ctx.translate(398, 764);
    ctx.rotate(0.22);
    // 结心：最暗最实的一块，这才是「结」的主体
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = BARK_DARK;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // 外面一圈被顶起来的树皮高光
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = BARK_HI;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 26, 0, 0, Math.PI * 2);
    ctx.stroke();
    // 再外一圈暗边，把结从树干上「分」出来
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = BARK_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 21, 31, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* --- 3. limbs ----------------------------------------------------- */
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

    for (const L of LIMBS.slice().sort((a, b) => b.w0 - a.w0)) {
        const build = (c) => taperedPath(c, L.pts, L.w0, L.w1);
        wash(ctx, build, BARK, rand, { passes: 3, spread: 4, alpha: 0.34 });
        ctx.save();
        build(ctx);
        ctx.clip();
        // Thick limbs get grain along their length; thin ones don't need it
        // and it would only muddy the ink edge below.
        if (L.w0 >= 30) {
            ctx.lineCap = 'round';
            for (let i = 0; i < 7; i++) {
                ctx.globalAlpha = 0.14 + rand() * 0.16;
                ctx.strokeStyle = i % 2 ? BARK_HI : BARK_DARK;
                ctx.lineWidth = 2 + rand() * 3;
                ctx.beginPath();
                ctx.moveTo(L.pts[0][0], L.pts[0][1]);
                for (const p of L.pts) ctx.lineTo(p[0] + (rand() - 0.5) * 10, p[1] + (rand() - 0.5) * 10);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 0.17;
        ctx.strokeStyle = BARK_HI;
        ctx.lineWidth = L.w0 * 0.28;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(L.pts[0][0], L.pts[0][1]);
        for (const p of L.pts) ctx.lineTo(p[0], p[1]);
        ctx.stroke();
        ctx.restore();
        // Ink edge. Without it the limbs read as pale bars against a pale
        // wall — the whole point of an ink-and-wash tree is that the
        // branches are drawn, not merely shaded.
        ctx.save();
        ctx.globalAlpha = 0.5;
        build(ctx);
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
        const n = L.pts.length;
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

    /* --- 5. canopy ----------------------------------------------------- */
    // Rosettes at every terminal tip, plus a scattering along the shoots, so
    // the foliage follows the branch structure instead of floating over it.
    // Painted in a shuffled order: cluster-by-cluster along a branch would
    // show up as stripes.
    const rosettes = [];
    for (const [x, y, a] of tips) rosettes.push([x, y, a, 30 + rand() * 26]);
    for (const t of twigs) {
        for (let i = 2; i < t.pts.length; i += 3) {
            if (rand() > 0.28) continue;
            const p = t.pts[i];
            const q = t.pts[i - 1];
            rosettes.push([p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]), 18 + rand() * 22]);
        }
    }
    rosettes.sort(() => rand() - 0.5);

    // Shadow pass, offset down-right, then the lit pass over the top.
    ctx.save();
    ctx.translate(13, 11);
    for (const [x, y, a, R] of rosettes) drawRosette(ctx, x, y, R, a, rand, true);
    ctx.restore();
    for (const [x, y, a, R] of rosettes) drawRosette(ctx, x, y, R, a, rand);

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
    for (const [x, y] of hang.slice(0, 34)) {
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

    /* --- 7. windfalls -------------------------------------------------- */
    // Three on the grass: the detail that turns a tree into a season.
    // Same fruit size as the canopy — a windfall does not shrink on the way
    // down. The old 21/18/20 were the same oversized fruit lying on the lawn.
    for (const [x, y, r] of [[268, 840, 8], [330, 856, 7], [486, 846, 7.5]]) {
        drawPersimmon(ctx, x, y, r, rand);
    }
    for (let i = 0; i < 14; i++) {
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
     */
    const LEAF_DEEP = '#2E4A1F';   // the gaps between leaves
    const LEAF_MID = '#4B7431';    // the body of the mass — the dominant tone
    const LEAF_LIT = '#6E9C46';    // leaves catching the light
    const STEM = '#4C4A29';        // the woody runner: olive-brown, not green
    const INK_RIB = '#1F3313';     // midrib / veins / stem outline

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
    ctx.globalAlpha = 0.66;
    limb(ctx, spinePts, 13, STEM, { taper: 0.62 });
    // the doubled line a brush leaves — without it the stem reads as a wire
    ctx.globalAlpha = 0.26;
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
                0.44 + rand() * 0.30
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
            // tip. Held at 0.66 alpha so the woody part stays darker than the
            // leaves it carries.
            ctx.save();
            ctx.globalAlpha = 0.66;
            limb(ctx, pts, 9, STEM, { taper: 0.34 });
            ctx.globalAlpha = 0.24;
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
                        0.36 + (1 - t) * 0.32
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
                ctx.globalAlpha = 0.46;
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
/* Ink splash — the black blot that blooms where you squash the bug      */
/* ------------------------------------------------------------------ */

/**
 * Square, matching the 2 x 2 plane the splash is drawn on in EntranceDoors
 * (the fifth and last entrance bitmap — `images/ink-splash.webp`). The mesh
 * runs `transparent` + `alphaTest`, so only the silhouette matters: a heavy
 * irregular mass with two attached lobes, a mix of torn wedges and flicked
 * needles, thrown droplets and a few drips running off the bottom.
 *
 * Two things are load-bearing:
 *
 *  - The mass is drawn in a *round* local space and the whole thing is
 *    stretched by ctx.scale afterwards. Scaling the radius per-axis instead
 *    (cos*r*SX) squashes the angular width of any spike sitting at 12 or 6
 *    o'clock, and a needle up there comes out as a rectangular bar.
 *  - It is drawn oversized on a wide scratch canvas and fitted down by
 *    alphaBBox afterwards, so a random spike can never run off an edge and
 *    get its tip clipped flat.
 *
 * No grain: the blot is flat ink, and speckle over an `alphaTest` edge would
 * show up as loose dots.
 */
export const INK_SPLASH_ASPECT = 1; // 500 x 500, drawn onto a 2 x 2 plane

/** Near-black, a shade warmer than #000 so it sits with the scene's ink. */
const SPLAT_INK = '#141110';

export function makeInkSplashTexture() {
    const key = 'entrance:ink-splash';
    if (cache.has(key)) return cache.get(key);

    const SC_W = 1200;
    const SC_H = 900;
    const scratch = makeCanvas(SC_W, SC_H);
    const ctx = scratch.getContext('2d');
    const rand = mulberry32(hashString(key));

    const SX = 1.12; // the reference blot is wider than it is tall
    const SY = 0.94;

    ctx.save();
    ctx.translate(SC_W * 0.5, SC_H * 0.5);
    ctx.rotate(-0.18); // the reference blot runs lower-left to upper-right
    ctx.scale(SX, SY); // everything below is authored in a circle
    ctx.fillStyle = SPLAT_INK;
    ctx.strokeStyle = SPLAT_INK;
    ctx.lineCap = 'round';

    const baseR = SC_H * 0.23;
    const at = (a, r) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

    const harmonics = (k) => [
        { k: 3, a: 0.20 * k, p: rand() * Math.PI * 2 },
        { k: 5, a: 0.14 * k, p: rand() * Math.PI * 2 },
        { k: 8, a: 0.09 * k, p: rand() * Math.PI * 2 },
        { k: 15, a: 0.045 * k, p: rand() * Math.PI * 2 },
    ];

    /**
     * Closed lumpy outline: a few sine harmonics give the organic wobble.
     *
     * Spikes are deliberately NOT added here. A triangular *radius* profile
     * goes flat wherever the peak falls between two samples, and on a needle
     * that flat is wide enough to read as a rectangular chimney. They are
     * drawn afterwards as explicit triangles instead, so every tip is a real
     * point.
     */
    const lumpy = (radius, harm, samples = 1440) => {
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
            const a = (i / samples) * Math.PI * 2;
            let r = radius;
            for (const h of harm) r += Math.sin(a * h.k + h.p) * radius * h.a;
            r += (rand() - 0.5) * radius * 0.025; // rough, torn edge
            const p = at(a, r);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
    };

    // ---- main mass --------------------------------------------------------
    lumpy(baseR, harmonics(1));
    ctx.fill();

    // ---- spikes: explicit triangles, so every tip is a real point ---------
    const spikes = [];
    // broad torn wedges — the mass itself throwing out tongues
    for (let i = 0; i < 6; i++) {
        spikes.push({ a: rand() * Math.PI * 2, w: 0.13 + rand() * 0.22, len: baseR * (0.22 + rand() * 0.5) });
    }
    // sharp needles — the flicked ink
    for (let i = 0; i < 5; i++) {
        spikes.push({ a: rand() * Math.PI * 2, w: 0.03 + rand() * 0.03, len: baseR * (0.5 + rand() * 0.5) });
    }
    // two long tendrils, so the burst reads as directional rather than a star
    spikes.push({ a: -0.6 + rand() * 0.5, w: 0.045, len: baseR * 1.15 });
    spikes.push({ a: 2.2 + rand() * 0.5, w: 0.045, len: baseR * 0.95 });

    for (const sp of spikes) {
        const b1 = at(sp.a - sp.w, baseR * 0.88); // base chord buried in the mass
        const b2 = at(sp.a + sp.w, baseR * 0.88);
        const tip = at(sp.a, baseR + sp.len);
        ctx.beginPath();
        ctx.moveTo(b1.x, b1.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.closePath();
        ctx.fill();
    }

    // ---- two attached lobes, so the mass is not one tidy disc -------------
    for (let i = 0; i < 2; i++) {
        const o = at(rand() * Math.PI * 2, baseR * (0.55 + rand() * 0.35));
        const orad = baseR * (0.34 + rand() * 0.24);
        ctx.save();
        ctx.translate(o.x, o.y);
        lumpy(orad, harmonics(0.9), 720);
        ctx.fill();
        ctx.restore();
    }

    // ---- thrown droplets (some smeared along their flight path) -----------
    for (let i = 0; i < 52; i++) {
        const a = rand() * Math.PI * 2;
        const p = at(a, baseR * (0.95 + rand() * 1.05));
        const rad = 2 + rand() * rand() * 11;
        const smear = rand() < 0.4 ? 1 + rand() * 2.6 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * smear, rad, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // ---- fine spray: thin lines flung outward -----------------------------
    for (let i = 0; i < 12; i++) {
        const a = rand() * Math.PI * 2;
        const r0 = baseR * (0.85 + rand() * 0.6);
        const p0 = at(a, r0);
        const p1 = at(a, r0 + baseR * (0.25 + rand() * 0.8));
        ctx.lineWidth = 1.6 + rand() * 3.4;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    }

    // ---- drips running off the bottom -------------------------------------
    for (let i = 0; i < 4; i++) {
        const dx = (rand() - 0.5) * baseR * 1.4;
        const y0 = baseR * (0.5 + rand() * 0.35);
        const len = baseR * (0.3 + rand() * 0.9);
        const w = 3 + rand() * 6;
        ctx.beginPath();
        ctx.moveTo(dx - w, y0);
        ctx.quadraticCurveTo(dx - w * 1.6, y0 + len * 0.65, dx, y0 + len);
        ctx.quadraticCurveTo(dx + w * 1.6, y0 + len * 0.65, dx + w, y0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dx, y0 + len, w * (0.85 + rand() * 0.5), 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();

    // ---- fit the blot into the square output ------------------------------
    const out = makeCanvas(500, 500);
    const bb = alphaBBox(scratch);
    const bw = bb.x1 - bb.x0 + 1;
    const bh = bb.y1 - bb.y0 + 1;
    const k = (out.width * 0.9) / Math.max(bw, bh);
    const dw = bw * k;
    const dh = bh * k;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(
        scratch,
        bb.x0, bb.y0, bw, bh,
        (out.width - dw) / 2, (out.height - dh) / 2, dw, dh
    );

    return toTexture(out, key);
}

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
