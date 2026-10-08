/**
 * 大门 (main gate) decoration — 门神 / 倒福 / 门环 / 春联, all procedural.
 *
 * The entrance door used to wear three tech stickers (music / code / ai) on its
 * two recessed panels. Those are retired; the panels now carry the traditional
 * Chinese New Year kit instead:
 *
 *   门神    door gods — 关公 on the left leaf, 张飞 on the right, each painted on
 *           an aged 年画 sheet that sits on the upper panel.
 *   倒福    a red diamond on the lower panel. The 福 is rotated 180° so it reads
 *           福到 ("fortune has arrived") — the traditional pun.
 *   门环    a 铺首 plate with a hanging ring, one per leaf, on the rail between
 *           the two panels.
 *   春联    a 横批 above the lintel plus 上联 / 下联 flanking the door. The word
 *           sets live in config/couplets.js (24 节气 + 传统节日 + 法定假期);
 *           which one is up today is decided by resolveCoupletSet(), and the
 *           UI cross-fades to the 搞笑 easter egg on hover.
 *
 * The two god figures are the vector artwork of the reference mock-up
 * (public/demos/door.html) replayed through Path2D — the canvas art therefore
 * matches the mock-up line for line instead of being redrawn by hand.
 *
 * Nothing is fetched: no image, no webfont, no CDN. Every canvas is authored at
 * the exact aspect ratio of the plane it lands on, so nothing is ever stretched.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32, rgba, roundRectPath } from '../engine/art';
import { COUPLET_SETS } from '../config/couplets';

const cache = new Map();

/* ------------------------------------------------------------------ */
/* Small helpers (mirrors the doorArt / entranceArt conventions)        */
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

/** Fine paper fibre: short random strokes, low alpha. */
function paperFibre(ctx, w, h, rand, { count = 900, alpha = 0.05, len = 14 } = {}) {
    ctx.save();
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI;
        const l = len * (0.4 + rand());
        const dark = rand() > 0.5;
        ctx.strokeStyle = dark
            ? `rgba(90, 70, 45, ${alpha})`
            : `rgba(255, 252, 240, ${alpha * 1.5})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
    }
    ctx.restore();
}

/** A handful of translucent age spots so the paper never reads as flat. */
function ageSpots(ctx, w, h, rand, { count = 14, alpha = 0.09 } = {}) {
    ctx.save();
    for (let i = 0; i < count; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = (0.03 + rand() * 0.09) * Math.min(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(122, 88, 44, ${alpha})`);
        g.addColorStop(1, 'rgba(122, 88, 44, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Darkened corners — keeps the sheet from floating off the door. */
function vignette(ctx, w, h, strength = 0.34) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(40, 26, 12, 0)');
    g.addColorStop(1, `rgba(40, 26, 12, ${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* CJK type                                                             */
/* ------------------------------------------------------------------ */

/**
 * Canvas has no access to the troika scene font, so the brushwork characters
 * (福 and the couplets) are set in whatever CJK serif the OS has. The stack
 * mirrors the reference mock-up; the generic `serif` tail keeps a system
 * without any named CJK serif from rendering tofu.
 */
const CJK = '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "PingFang SC", serif';

function cjkFont(size, weight = 700) {
    return `${weight} ${Math.round(size)}px ${CJK}`;
}

/* ------------------------------------------------------------------ */
/* 年画 sheet — aged cream paper with a red frame                       */
/* ------------------------------------------------------------------ */

function drawNianhuaPaper(ctx, w, h, rand) {
    // Base stock
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#f6ecd2');
    base.addColorStop(0.45, '#efe3c6');
    base.addColorStop(1, '#e2d2ae');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    paperFibre(ctx, w, h, rand, { count: 1100, alpha: 0.045, len: 18 });

    // Outer red frame (double stroke) — the classic 年画 border
    const m = Math.round(w * 0.022);
    ctx.strokeStyle = '#a8231a';
    ctx.lineWidth = Math.max(4, w * 0.016);
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.strokeStyle = 'rgba(168, 35, 26, 0.75)';
    ctx.lineWidth = Math.max(1.5, w * 0.004);
    ctx.strokeRect(m + w * 0.028, m + w * 0.028, w - (m + w * 0.028) * 2, h - (m + w * 0.028) * 2);

    // Corner ticks — hand-cut paper feel
    const t = w * 0.075;
    ctx.strokeStyle = '#8f1c14';
    ctx.lineWidth = Math.max(3, w * 0.009);
    ctx.lineCap = 'round';
    [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * t, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * t);
        ctx.stroke();
    });

    ageSpots(ctx, w, h, rand, { count: 12, alpha: 0.085 });
}

/** Small carved seal in the lower margin — no glyph, so no font dependency. */
function drawSeal(ctx, cx, cy, size) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#b3271c';
    roundRectPath(ctx, -size / 2, -size / 2, size, size, size * 0.1);
    ctx.fill();

    ctx.strokeStyle = 'rgba(248, 232, 205, 0.9)';
    ctx.lineWidth = Math.max(2, size * 0.07);
    const i = size * 0.16;
    ctx.strokeRect(-size / 2 + i, -size / 2 + i, size - i * 2, size - i * 2);

    // 回-pattern cross carved into the middle
    ctx.lineWidth = Math.max(2, size * 0.075);
    ctx.beginPath();
    ctx.moveTo(-size * 0.2, -size * 0.2);
    ctx.lineTo(size * 0.2, -size * 0.2);
    ctx.lineTo(size * 0.2, size * 0.2);
    ctx.lineTo(-size * 0.2, size * 0.2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.2);
    ctx.lineTo(0, size * 0.2);
    ctx.stroke();
    ctx.restore();
}

/** A ruyi cloud outline — fills the margins the narrow figures leave. */
function drawRuyiCloud(ctx, cx, cy, s, color, alpha = 0.75) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx - s * 0.95, cy, s * 0.72, Math.PI, Math.PI * 2);
    ctx.arc(cx, cy, s, Math.PI, Math.PI * 2);
    ctx.arc(cx + s * 0.95, cy, s * 0.72, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.55, cy);
    ctx.lineTo(cx + s * 1.55, cy);
    ctx.stroke();
    ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Door god figures — the mock-up's vector paths, replayed              */
/* ------------------------------------------------------------------ */
/*
 * Shape spec:
 *   { t:'r', x,y,w,h, r, f, s, sw }        rect / rounded rect
 *   { t:'e', cx,cy,rx,ry, f, s, sw }       ellipse
 *   { t:'c', cx,cy,r, f, s, sw }           circle
 *   { t:'l', x1,y1,x2,y2, s, sw, o }       line
 *   { t:'p', d, f, s, sw, o, cap, join }   path (SVG `d` through Path2D)
 *   { t:'g', tr:[tx,ty,scale,tx2,ty2], ch:[...] }   nested transform group
 *
 * `f` / `s` accept a colour string or '@gold' / '@blade' / '@steel'.
 */

/** 青龙偃月刀 — the blade sub-group of 关公, with its own nested transform. */
const GUANYU_BLADE = {
    t: 'g', tr: [292, 303, 0.65, -100, -236], ch: [
        { t: 'r', x: 95, y: 360, w: 10, h: 240, r: 3, f: '#3a2a18' },
        { t: 'r', x: 95, y: 360, w: 10, h: 240, r: 3, s: '#20140a', sw: 1.5 },
        { t: 'r', x: 90, y: 240, w: 20, h: 120, r: 4, f: '@gold' },
        { t: 'l', x1: 90, y1: 260, x2: 110, y2: 250, s: '#7d5f0e', sw: 1.5, o: 0.6 },
        { t: 'l', x1: 90, y1: 280, x2: 110, y2: 270, s: '#7d5f0e', sw: 1.5, o: 0.6 },
        { t: 'l', x1: 90, y1: 300, x2: 110, y2: 290, s: '#7d5f0e', sw: 1.5, o: 0.6 },
        { t: 'l', x1: 90, y1: 320, x2: 110, y2: 310, s: '#7d5f0e', sw: 1.5, o: 0.6 },
        { t: 'l', x1: 90, y1: 340, x2: 110, y2: 330, s: '#7d5f0e', sw: 1.5, o: 0.6 },
        { t: 'r', x: 78, y: 231, w: 44, h: 10, r: 2, f: '@gold', s: '#7d5f0e', sw: 1.5 },
        { t: 'p', d: 'M 78 236 Q 66 236 62 231 Q 70 239 78 241 Z', f: '@gold' },
        { t: 'p', d: 'M 122 236 Q 132 236 135 231 Q 128 239 122 241 Z', f: '@gold' },
        { t: 'p', d: 'M 82 231 C 86 223, 90 223, 94 231 Z', f: '@gold' },
        { t: 'p', d: 'M 106 231 C 110 223, 114 223, 118 231 Z', f: '@gold' },
        { t: 'p', d: 'M 84 230 C 54 190, 58 100, 132 50 C 111 100, 114 180, 116 230 Z', f: '@blade', s: '#5a6a75', sw: 2, join: 'round' },
        { t: 'p', d: 'M 94 220 C 65 180, 70 105, 125 60', s: '#8a9aa5', sw: 2, o: 0.6 },
        { t: 'p', d: 'M 102 220 C 75 180, 80 105, 120 65', s: '#8a9aa5', sw: 1.5, o: 0.4 },
        { t: 'p', d: 'M 95 242 C 85 255, 80 270, 85 285', s: '#c0392b', sw: 5, cap: 'round' },
        { t: 'p', d: 'M 100 245 C 92 260, 90 275, 95 290', s: '#e74c3c', sw: 4, cap: 'round' },
        { t: 'p', d: 'M 105 242 C 100 255, 100 270, 105 280', s: '#c0392b', sw: 4, cap: 'round' },
    ],
};

const GUANYU = {
    root: [101.4, 72.1, 0.78],
    shapes: [
        GUANYU_BLADE,
        // 青龙偃月刀 is gripped by the left hand; both fists:
        { t: 'p', d: 'M 330 330 C 316 348, 306 366, 300 382', s: '#1f6b4a', sw: 19, cap: 'round' },
        { t: 'e', cx: 298, cy: 390, rx: 14, ry: 11, f: '#b03a2e' },
        { t: 'p', d: 'M 290 386 Q 296 382 302 386', s: '#8a2a20', sw: 1.5 },
        { t: 'p', d: 'M 396 330 C 410 348, 416 370, 414 392', s: '#1f6b4a', sw: 19, cap: 'round' },
        { t: 'e', cx: 414, cy: 398, rx: 12, ry: 11, f: '#b03a2e' },
        // robe
        { t: 'p', d: 'M 358 298 C 322 298, 304 324, 302 362 L 292 510 L 424 510 L 414 362 C 412 324, 394 298, 358 298 Z', f: '#1f6b4a' },
        { t: 'p', d: 'M 306 318 C 294 328, 290 348, 294 366 L 326 356 L 330 324 Z', f: '#17573c' },
        { t: 'p', d: 'M 410 318 C 422 328, 426 348, 422 366 L 390 356 L 386 324 Z', f: '#17573c' },
        { t: 'p', d: 'M 342 306 L 358 344 L 374 306', s: '#f0e2c4', sw: 4, join: 'round' },
        { t: 'r', x: 300, y: 404, w: 116, h: 22, r: 3, f: '@gold', s: '#7d5f0e', sw: 1.4 },
        { t: 'r', x: 350, y: 408, w: 18, h: 14, r: 2, f: '#2d6b4f', s: '#8a6a12', sw: 1.2 },
        { t: 'p', d: 'M 292 498 L 424 498', s: '#c9a227', sw: 5 },
        { t: 'p', d: 'M 293 506 L 423 506', s: '#c9a227', sw: 2, o: 0.65 },
        // boots
        { t: 'p', d: 'M 322 510 L 318 534 Q 318 540 327 540 L 347 540 Q 354 540 354 534 L 354 510 Z', f: '#1a1a1a' },
        { t: 'p', d: 'M 362 510 L 362 534 Q 362 540 369 540 L 389 540 Q 398 540 398 534 L 394 510 Z', f: '#1a1a1a' },
        // head: 冠 / 面 / 眉 / 眼 / 髯
        { t: 'e', cx: 358, cy: 200, rx: 18, ry: 10, f: '#17573c' },
        { t: 'p', d: 'M 320 252 C 317 210, 334 192, 358 192 C 382 192, 399 210, 396 252 C 390 234, 382 226, 358 226 C 334 226, 326 234, 320 252 Z', f: '#1f6b4a' },
        { t: 'e', cx: 358, cy: 256, rx: 34, ry: 41, f: '#b03a2e' },
        { t: 'e', cx: 324, cy: 260, rx: 6.5, ry: 11, f: '#9c3226' },
        { t: 'e', cx: 392, cy: 260, rx: 6.5, ry: 11, f: '#9c3226' },
        { t: 'p', d: 'M 332 244 C 340 236, 350 237, 356 244', s: '#141414', sw: 5, cap: 'round' },
        { t: 'p', d: 'M 384 244 C 376 236, 366 237, 360 244', s: '#141414', sw: 5, cap: 'round' },
        { t: 'p', d: 'M 334 258 Q 344 251 354 258', s: '#141414', sw: 3, cap: 'round' },
        { t: 'c', cx: 344, cy: 257, r: 2.4, f: '#141414' },
        { t: 'p', d: 'M 382 258 Q 372 251 362 258', s: '#141414', sw: 3, cap: 'round' },
        { t: 'c', cx: 372, cy: 257, r: 2.4, f: '#141414' },
        { t: 'p', d: 'M 358 263 L 358 275', s: '#8a2a20', sw: 2.2, cap: 'round' },
        { t: 'p', d: 'M 350 285 Q 358 289 366 285', s: '#6f1d15', sw: 2.2, cap: 'round' },
        { t: 'p', d: 'M 340 278 C 328 310, 332 344, 346 362 C 353 371, 363 371, 370 362 C 384 344, 388 310, 376 278 C 372 294, 366 302, 358 302 C 350 302, 344 294, 340 278 Z', f: '#141414' },
        { t: 'p', d: 'M 346 280 C 340 287, 338 296, 342 302', s: '#141414', sw: 4, cap: 'round' },
        { t: 'p', d: 'M 370 280 C 376 287, 378 296, 374 302', s: '#141414', sw: 4, cap: 'round' },
    ],
};

/**
 * 张飞. The mock-up draws him inside the *right* 年画 box, so his coordinates
 * are shifted left by one leaf width (284) to land in the same frame as 关公.
 */
const ZHANGFEI = {
    root: [135.8 - 284, 72.1, 0.78],
    shapes: [
        // 丈八蛇矛
        { t: 'r', x: 708, y: 318, w: 9, h: 222, r: 2, f: '#3a2a18' },
        { t: 'r', x: 708, y: 318, w: 9, h: 222, r: 2, s: '#20140a', sw: 1 },
        { t: 'p', d: 'M 712 190 C 702 212, 700 234, 708 250 C 716 266, 704 286, 702 306 C 700 316, 702 320, 706 322 L 716 322 C 720 320, 722 316, 720 306 C 718 286, 706 266, 714 250 C 722 234, 720 212, 712 190 Z', f: '@steel', s: '#6e7f8a', sw: 1.5, join: 'round' },
        { t: 'p', d: 'M 712 190 C 706 212, 706 234, 712 250 C 718 266, 710 286, 708 306 C 707 314, 708 318, 710 322', s: '#a8b6c0', sw: 1.6, o: 0.7 },
        { t: 'r', x: 690, y: 314, w: 44, h: 10, r: 2, f: '@gold', s: '#7d5f0e', sw: 1.5 },
        { t: 'p', d: 'M 708 324 C 700 336, 696 350, 702 364', s: '#c0392b', sw: 5, cap: 'round' },
        { t: 'p', d: 'M 712 326 C 706 340, 704 354, 710 368', s: '#e74c3c', sw: 4, cap: 'round' },
        { t: 'p', d: 'M 716 324 C 714 338, 714 352, 718 362', s: '#c0392b', sw: 4, cap: 'round' },
        // fists
        { t: 'p', d: 'M 596 330 C 584 348, 580 368, 582 386', s: '#2f2f33', sw: 19, cap: 'round' },
        { t: 'e', cx: 582, cy: 392, rx: 12, ry: 11, f: '#3a3a40' },
        { t: 'p', d: 'M 670 330 C 684 346, 692 362, 698 376', s: '#2f2f33', sw: 19, cap: 'round' },
        { t: 'e', cx: 700, cy: 382, rx: 13, ry: 11, f: '#3a3a40' },
        { t: 'p', d: 'M 692 378 Q 698 374 704 378', s: '#1c1c20', sw: 1.5 },
        // 甲
        { t: 'p', d: 'M 642 298 C 606 298, 588 324, 586 362 L 576 510 L 708 510 L 698 362 C 696 324, 678 298, 642 298 Z', f: '#2f2f33' },
        { t: 'p', d: 'M 594 384 H 690', s: '#4d4d57', sw: 1.6, o: 0.85 },
        { t: 'p', d: 'M 590 422 H 694', s: '#4d4d57', sw: 1.6, o: 0.85 },
        { t: 'p', d: 'M 586 460 H 698', s: '#4d4d57', sw: 1.6, o: 0.85 },
        { t: 'p', d: 'M 582 498 H 702', s: '#4d4d57', sw: 1.6, o: 0.85 },
        { t: 'p', d: 'M 590 318 C 576 328, 572 348, 576 366 L 610 356 L 614 324 Z', f: '#1c1c20' },
        { t: 'p', d: 'M 694 318 C 708 328, 712 348, 708 366 L 674 356 L 670 324 Z', f: '#1c1c20' },
        { t: 'c', cx: 642, cy: 376, r: 22, f: '@gold', s: '#8a6a12', sw: 2 },
        { t: 'c', cx: 642, cy: 376, r: 12, f: '#f0d98a' },
        { t: 'c', cx: 642, cy: 376, r: 12, s: '#a8841c', sw: 1.4 },
        { t: 'c', cx: 642, cy: 376, r: 5, f: '#c9a227' },
        { t: 'r', x: 584, y: 404, w: 116, h: 22, r: 3, f: '#a8841c', s: '#6b5210', sw: 1.4 },
        { t: 'r', x: 634, y: 408, w: 18, h: 14, r: 2, f: '#3a3a40', s: '#6b5210', sw: 1.2 },
        // boots
        { t: 'p', d: 'M 606 510 L 602 534 Q 602 540 611 540 L 631 540 Q 638 540 638 534 L 638 510 Z', f: '#141414' },
        { t: 'p', d: 'M 646 510 L 646 534 Q 646 540 653 540 L 673 540 Q 682 540 682 534 L 678 510 Z', f: '#141414' },
        // head: 巾 / 面 / 髯 / 虬髯
        { t: 'p', d: 'M 604 252 C 601 208, 618 190, 642 190 C 666 190, 683 208, 680 252 C 674 234, 666 226, 642 226 C 618 226, 610 234, 604 252 Z', f: '#c0392b' },
        { t: 'p', d: 'M 604 252 C 614 242, 626 238, 642 238 C 658 238, 670 242, 680 252', s: '#c9a227', sw: 3 },
        { t: 'c', cx: 642, cy: 196, r: 7, f: '@gold', s: '#8a6a12', sw: 1.2 },
        { t: 'e', cx: 642, cy: 256, rx: 34, ry: 41, f: '#3a3a40' },
        { t: 'e', cx: 608, cy: 260, rx: 6.5, ry: 11, f: '#2e2e34' },
        { t: 'e', cx: 676, cy: 260, rx: 6.5, ry: 11, f: '#2e2e34' },
        { t: 'p', d: 'M 614 244 C 624 232, 634 234, 640 242', s: '#0d0d0d', sw: 6.5, cap: 'round' },
        { t: 'p', d: 'M 670 244 C 660 232, 650 234, 644 242', s: '#0d0d0d', sw: 6.5, cap: 'round' },
        { t: 'c', cx: 626, cy: 258, r: 9.5, f: '#f4f0e6' },
        { t: 'c', cx: 626, cy: 258, r: 5, f: '#0d0d0d' },
        { t: 'c', cx: 628, cy: 256, r: 1.6, f: '#fff' },
        { t: 'c', cx: 658, cy: 258, r: 9.5, f: '#f4f0e6' },
        { t: 'c', cx: 658, cy: 258, r: 5, f: '#0d0d0d' },
        { t: 'c', cx: 660, cy: 256, r: 1.6, f: '#fff' },
        { t: 'p', d: 'M 642 264 L 642 277', s: '#1c1c20', sw: 2.4, cap: 'round' },
        { t: 'p', d: 'M 633 288 Q 642 292 651 288', s: '#1c1c20', sw: 2.2, cap: 'round' },
        { t: 'p', d: 'M 614 278 C 594 290, 584 310, 590 330 C 604 316, 616 308, 628 304 Z', f: '#0d0d0d' },
        { t: 'p', d: 'M 670 278 C 690 290, 700 310, 694 330 C 680 316, 668 308, 656 304 Z', f: '#0d0d0d' },
        { t: 'p', d: 'M 624 294 C 616 320, 618 348, 632 364 C 638 370, 646 370, 652 364 C 666 348, 668 320, 660 294 C 654 304, 650 308, 642 308 C 634 308, 630 304, 624 294 Z', f: '#0d0d0d' },
    ],
};

const GODS = { guanyu: GUANYU, zhangfei: ZHANGFEI };

/**
 * Named gradients, authored in the mock-up's coordinate space. Canvas resolves
 * gradient coordinates through the CTM at paint time, so creating them while
 * the figure transform is live keeps them aligned with the paths.
 */
function godGradients(ctx) {
    const gold = ctx.createLinearGradient(0, 190, 0, 430);
    gold.addColorStop(0, '#f4e09a');
    gold.addColorStop(0.45, '#c9a227');
    gold.addColorStop(1, '#8a6a12');

    const blade = ctx.createLinearGradient(54, 0, 135, 0);
    blade.addColorStop(0, '#eef3f5');
    blade.addColorStop(0.4, '#c3ced4');
    blade.addColorStop(1, '#8496a2');

    const steel = ctx.createLinearGradient(700, 190, 722, 322);
    steel.addColorStop(0, '#f0f5f8');
    steel.addColorStop(0.4, '#c8d4dc');
    steel.addColorStop(1, '#8496a2');

    return { gold, blade, steel };
}

function paintOf(spec, grads) {
    if (!spec) return null;
    return spec[0] === '@' ? grads[spec.slice(1)] : spec;
}

function drawShapes(ctx, shapes, grads) {
    for (const sh of shapes) {
        if (sh.t === 'g') {
            ctx.save();
            const [tx, ty, sc, tx2, ty2] = sh.tr;
            ctx.translate(tx, ty);
            ctx.scale(sc, sc);
            ctx.translate(tx2, ty2);
            drawShapes(ctx, sh.ch, grads);
            ctx.restore();
            continue;
        }

        ctx.save();
        if (sh.o != null) ctx.globalAlpha = sh.o;
        if (sh.cap) ctx.lineCap = sh.cap;
        if (sh.join) ctx.lineJoin = sh.join;

        if (sh.t === 'r') {
            roundRectPath(ctx, sh.x, sh.y, sh.w, sh.h, sh.r || 0);
            if (sh.f) { ctx.fillStyle = paintOf(sh.f, grads); ctx.fill(); }
            if (sh.s) { ctx.strokeStyle = paintOf(sh.s, grads); ctx.lineWidth = sh.sw || 1; ctx.stroke(); }
        } else if (sh.t === 'e') {
            ctx.beginPath();
            ctx.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2);
            if (sh.f) { ctx.fillStyle = paintOf(sh.f, grads); ctx.fill(); }
            if (sh.s) { ctx.strokeStyle = paintOf(sh.s, grads); ctx.lineWidth = sh.sw || 1; ctx.stroke(); }
        } else if (sh.t === 'c') {
            ctx.beginPath();
            ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
            if (sh.f) { ctx.fillStyle = paintOf(sh.f, grads); ctx.fill(); }
            if (sh.s) { ctx.strokeStyle = paintOf(sh.s, grads); ctx.lineWidth = sh.sw || 1; ctx.stroke(); }
        } else if (sh.t === 'p') {
            const path = new Path2D(sh.d);
            if (sh.f) { ctx.fillStyle = paintOf(sh.f, grads); ctx.fill(path); }
            if (sh.s) { ctx.strokeStyle = paintOf(sh.s, grads); ctx.lineWidth = sh.sw || 1; ctx.stroke(path); }
        } else if (sh.t === 'l') {
            ctx.beginPath();
            ctx.moveTo(sh.x1, sh.y1);
            ctx.lineTo(sh.x2, sh.y2);
            ctx.strokeStyle = paintOf(sh.s, grads);
            ctx.lineWidth = sh.sw || 1;
            ctx.stroke();
        }
        ctx.restore();
    }
}

/* ------------------------------------------------------------------ */
/* 门神                                                                  */
/* ------------------------------------------------------------------ */

export const DOOR_GOD_ASPECT = 512 / 724;

/**
 * The mock-up's 年画 box (232..484 × 196..512) is remapped so that the *figure*
 * — not the box — fills the sheet: the box centre lands on the canvas centre
 * and the box is scaled so the taller of the two gods keeps a slim margin.
 */
const GOD_BOX_CX = 358;
const GOD_BOX_CY = 354;
const GOD_SCALE = 2.345;

/**
 * A 年画 sheet with one of the two door gods on it.
 * @param {'guanyu'|'zhangfei'} god
 */
export function makeDoorGodTexture(god = 'guanyu') {
    const key = `gate-god-${god}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 724;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    drawNianhuaPaper(ctx, W, H, rand);

    // Margin fillers: the figures are narrow, so the sheet gets clouds + a seal
    // the way a real 年画 sheet does instead of sitting in empty paper. Both sit
    // outboard of the figure's x-range (≈122..429) so they never collide.
    drawRuyiCloud(ctx, W * 0.115, H * 0.105, W * 0.050, '#9d8a5e', 0.5);
    drawRuyiCloud(ctx, W * 0.885, H * 0.895, W * 0.050, '#9d8a5e', 0.45);

    // Figure
    const def = GODS[god] || GUANYU;
    ctx.save();
    ctx.translate(W / 2 - GOD_BOX_CX * GOD_SCALE, H / 2 - GOD_BOX_CY * GOD_SCALE);
    ctx.scale(GOD_SCALE, GOD_SCALE);
    ctx.save();
    ctx.translate(def.root[0], def.root[1]);
    ctx.scale(def.root[2], def.root[2]);
    drawShapes(ctx, def.shapes, godGradients(ctx));
    ctx.restore();
    ctx.restore();

    drawSeal(ctx, W * 0.115, H * 0.775, W * 0.105);

    vignette(ctx, W, H, 0.30);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 倒福                                                                  */
/* ------------------------------------------------------------------ */

export const FU_ASPECT = 1;

/** Diamond (rotated square) path centred on (cx, cy) with half-diagonal d. */
function diamondPath(ctx, cx, cy, d) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d, cy);
    ctx.closePath();
}

/** Upside-down 福 on a red diamond — 福到. */
export function makeFuDiamondTexture() {
    const key = 'gate-fu-diamond';
    if (cache.has(key)) return cache.get(key);

    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const c = S / 2;
    const d = S * 0.46;             // half-diagonal

    ctx.save();

    // Paper
    diamondPath(ctx, c, c, d);
    const g = ctx.createLinearGradient(c - d, c - d, c + d, c + d);
    g.addColorStop(0, '#e5503c');
    g.addColorStop(0.5, '#c9331f');
    g.addColorStop(1, '#a3200f');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.clip();

    // Gold trim following the diamond edges (outer heavy + inner hairline)
    diamondPath(ctx, c, c, d - S * 0.012);
    ctx.strokeStyle = '#f0d27a';
    ctx.lineWidth = S * 0.024;
    ctx.stroke();
    diamondPath(ctx, c, c, d * 0.86);
    ctx.strokeStyle = 'rgba(240, 210, 122, 0.5)';
    ctx.lineWidth = S * 0.006;
    ctx.stroke();

    // Corner hooks at the four diamond tips
    ctx.strokeStyle = 'rgba(250, 232, 190, 0.6)';
    ctx.lineWidth = S * 0.011;
    ctx.lineCap = 'round';
    const t = d * 0.17;
    [[c, c - d, 0, 1], [c + d, c, -1, 0], [c, c + d, 0, -1], [c - d, c, 1, 0]].forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x + dx * t, y + dy * t);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dy * t, y + dx * t);
        ctx.stroke();
    });

    paperFibre(ctx, S, S, rand, { count: 620, alpha: 0.05, len: 12 });
    ageSpots(ctx, S, S, rand, { count: 8, alpha: 0.1 });

    // 福, rotated 180° — drawn last so it sits above the grain
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(Math.PI);
    ctx.font = cjkFont(S * 0.44);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(90, 20, 8, 0.5)';
    ctx.shadowBlur = S * 0.02;
    ctx.shadowOffsetY = S * 0.008;
    ctx.fillStyle = '#f7e3a1';
    ctx.fillText('福', 0, S * 0.012);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = 'rgba(255, 248, 220, 0.45)';
    ctx.strokeText('福', 0, S * 0.012);
    ctx.restore();

    ctx.restore();

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 春联                                                                  */
/* ------------------------------------------------------------------ */

export const COUPLET_STRIP_ASPECT = 200 / 1420;
export const COUPLET_BANNER_ASPECT = 700 / 200;

/**
 * 门联文案在 config/couplets.js。这里只负责把字画到红纸上。
 *
 * 贴法：`upper`（上联）在门的右边，`lower`（下联）在左边 —— 面朝大门从外
 * 往里看时的读序。上联收仄声、下联收平声，config/couplets.js 里逐条验过。
 *
 * 这个模块**不再持有文案**：原来这里只有两副（文艺/搞笑），现在有 39 副，
 * 文案属于 config，画法属于 utils。
 */

/** Red couplet paper with its gold trim, shared by strips and banner. */
function drawCoupletPaper(ctx, w, h, rand) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e04230');
    g.addColorStop(0.5, '#c9331f');
    g.addColorStop(1, '#a3200f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // gold border, double line
    const m = Math.round(Math.min(w, h) * 0.045);
    ctx.strokeStyle = '#f0d27a';
    ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.026);
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.strokeStyle = 'rgba(240, 210, 122, 0.5)';
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.008);
    const i = m + Math.min(w, h) * 0.038;
    ctx.strokeRect(i, i, w - i * 2, h - i * 2);

    paperFibre(ctx, w, h, rand, { count: 700, alpha: 0.05, len: 16 });
    ageSpots(ctx, w, h, rand, { count: 9, alpha: 0.09 });
}

function drawGoldChars(ctx, chars, positions, size) {
    ctx.save();
    ctx.font = cjkFont(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(88, 18, 6, 0.55)';
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetY = size * 0.02;
    ctx.fillStyle = '#f7e3a1';
    for (let i = 0; i < chars.length; i++) {
        const [x, y] = positions[i];
        ctx.fillText(chars[i], x, y);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // faint outline so the gold never melts into the red at distance
    ctx.lineWidth = size * 0.014;
    ctx.strokeStyle = 'rgba(255, 248, 220, 0.4)';
    for (let i = 0; i < chars.length; i++) {
        const [x, y] = positions[i];
        ctx.strokeText(chars[i], x, y);
    }
    ctx.restore();
}

/**
 * The red paper as a reusable CANVAS, cached per size.
 *
 * Every couplet piece shares the same paper — the gradient, the double gold
 * border, 700 fibre strokes and 9 age spots are identical no matter which
 * words land on it. Drawing it per set was fine when two sets shipped; now
 * that a set can be re-baked whenever the date rolls over, it is not. Draw it
 * once per size and blit.
 *
 * Cached as a canvas rather than a texture because the caller needs to keep
 * drawing on top of it.
 */
const paperCache = new Map();
function paperCanvas(W, H) {
    const key = `couplet-paper-${W}x${H}`;
    let c = paperCache.get(key);
    if (!c) {
        c = makeCanvas(W, H);
        // seeded by size, so the paper is identical on every visit — a
        // different fibre pattern each reload would read as flicker
        drawCoupletPaper(c.getContext('2d'), W, H, mulberry32(hashString(key)));
        paperCache.set(key, c);
    }
    return c;
}

/**
 * One piece of a couplet set.
 *
 * @param {string} setId  任意 COUPLET_SETS 的 id；找不到就退回第一副
 * @param {'banner'|'upper'|'lower'} piece
 */
export function makeCoupletTexture(setId, piece) {
    const set = COUPLET_SETS.find((s) => s.id === setId) || COUPLET_SETS[0];
    const key = `gate-couplet-${set.id}-${piece}`;
    if (cache.has(key)) return cache.get(key);

    const isBanner = piece === 'banner';
    const W = isBanner ? 700 : 200;
    const H = isBanner ? 200 : 1420;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(paperCanvas(W, H), 0, 0);

    const text = set[piece] || '';
    const chars = text.split('');

    if (isBanner) {
        const size = 130;
        const gap = 150;
        const x0 = W / 2 - gap * (chars.length - 1) / 2;
        drawGoldChars(ctx, chars, chars.map((_, i) => [x0 + i * gap, H / 2 + size * 0.03]), size);
    } else {
        const size = 110;
        const gap = 191;
        const y0 = H / 2 - gap * (chars.length - 1) / 2;
        drawGoldChars(ctx, chars, chars.map((_, i) => [W / 2, y0 + i * gap + size * 0.03]), size);
    }

    vignette(ctx, W, H, 0.20);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 门槛 (the threshold beam)                                            */
/* ------------------------------------------------------------------ */

/** 门槛的宽高比，按 entranceMetrics 的 THRESHOLD_W / THRESHOLD_H 量出来。 */
export const THRESHOLD_ASPECT = 1024 / 90;

/**
 * 门槛 —— 那根要抬脚跨过去的硬木横梁。
 *
 * 画的是一根被踩了很多年的榆木：中间一段被鞋底磨得发亮发白，两端还是
 * 深色；木纹沿长度方向走（横梁是整根料，纹路必然是顺着梁长的）；下缘压
 * 一道暗线，让它和下面的石台分开。
 *
 * 宽高比 ≈ 11.4 : 1，对应实际尺寸 1.94 x 0.17。顶面和正面共用这一张 ——
 * 17cm 高的一根梁不值得为每个面单独出图。
 */
export function makeThresholdTexture(key = 'gate-threshold') {
    const cached = cache.get(key);
    if (cached) return cached;

    const W = 1024;
    const H = 90;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // 底色：深榆木，中间略亮（受光），两端收暗
    const base = ctx.createLinearGradient(0, 0, W, 0);
    base.addColorStop(0.0, rgba(74, 46, 26));
    base.addColorStop(0.16, rgba(96, 61, 34));
    base.addColorStop(0.5, rgba(108, 70, 40));
    base.addColorStop(0.84, rgba(96, 61, 34));
    base.addColorStop(1.0, rgba(74, 46, 26));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // 竖向明暗：上缘受光，下缘落在石台的阴影里
    const vert = ctx.createLinearGradient(0, 0, 0, H);
    vert.addColorStop(0.0, rgba(255, 240, 214, 0.16));
    vert.addColorStop(0.28, rgba(255, 240, 214, 0.02));
    vert.addColorStop(0.78, rgba(30, 16, 8, 0.10));
    vert.addColorStop(1.0, rgba(24, 12, 6, 0.30));
    ctx.fillStyle = vert;
    ctx.fillRect(0, 0, W, H);

    // 木纹：沿长度方向的长条，微微起伏
    for (let i = 0; i < 46; i++) {
        const y = rand() * H;
        const amp = 0.5 + rand() * 1.6;
        const freq = 0.004 + rand() * 0.010;
        const dark = rand() > 0.42;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= W; x += 14) {
            ctx.lineTo(x, y + Math.sin(x * freq + i * 1.7) * amp);
        }
        ctx.strokeStyle = dark
            ? rgba(48, 28, 14, 0.10 + rand() * 0.16)
            : rgba(196, 158, 112, 0.08 + rand() * 0.12);
        ctx.lineWidth = 0.6 + rand() * 1.6;
        ctx.stroke();
    }

    // 中段磨损：人来人往踩出来的浅色亮带
    const worn = ctx.createLinearGradient(0, 0, W, 0);
    worn.addColorStop(0.0, rgba(214, 186, 146, 0));
    worn.addColorStop(0.30, rgba(214, 186, 146, 0.10));
    worn.addColorStop(0.5, rgba(226, 202, 164, 0.20));
    worn.addColorStop(0.70, rgba(214, 186, 146, 0.10));
    worn.addColorStop(1.0, rgba(214, 186, 146, 0));
    ctx.fillStyle = worn;
    ctx.fillRect(0, H * 0.14, W, H * 0.62);

    // 几处磕碰
    for (let i = 0; i < 14; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const r = 1.2 + rand() * 2.8;
        ctx.beginPath();
        ctx.ellipse(x, y, r * (1 + rand()), r, 0, 0, Math.PI * 2);
        ctx.fillStyle = rgba(38, 20, 10, 0.12 + rand() * 0.16);
        ctx.fill();
    }

    // 上下两道边线，把梁从背景里切出来
    ctx.fillStyle = rgba(30, 16, 8, 0.42);
    ctx.fillRect(0, H - 2, W, 2);
    ctx.fillStyle = rgba(255, 236, 206, 0.16);
    ctx.fillRect(0, 0, W, 1.5);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}
