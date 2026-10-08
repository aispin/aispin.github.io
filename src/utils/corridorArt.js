/**
 * Procedural corridor art (zero image assets)
 *
 * The corridor used to ship ~35 hand-drawn webp bitmaps: door leaves, the
 * architraves, lever handles, arrows, the room-name plaques, picture frames,
 * a potted tree, ventilation grilles, ceiling-lamp parts, a desk, a cabinet
 * and four floating doodles. This module redraws all of them on an offscreen
 * <canvas> and wraps each in a THREE.CanvasTexture.
 *
 * The only corridor bitmap that survives is `avatar_zeo.webp` — the ZEO IP
 * character sprite strip, which is authored artwork rather than decoration.
 *
 * Conventions follow utils/doorArt.js and utils/entranceArt.js:
 *   - deterministic `mulberry32` PRNG seeded from the cache key, so the same
 *     key always yields the same art and nothing flickers between reloads;
 *   - every texture is cached per key, so callers may call these on every
 *     render;
 *   - canvases are sized to the exact aspect of the plane they land on, so
 *     the art is never stretched.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32, rgba, roundRectPath } from '../engine/art';

const cache = new Map();

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function toTexture(canvas, key, { clamp = true, repeat = null } = {}) {
    if (cache.has(key)) return cache.get(key);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (clamp) {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    } else {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    if (repeat) texture.repeat.set(repeat[0], repeat[1]);
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}

/** Hand-drawn rectangle: a closed path whose points wobble by ±amp. */
function sketchRectPath(ctx, x, y, w, h, amp, rand, r = 0) {
    const jit = () => (rand() - 0.5) * amp;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr + jit(), y + jit());
    ctx.lineTo(x + w - rr + jit(), y + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + w + jit(), y + jit(), x + w + jit(), y + rr + jit());
    else ctx.lineTo(x + w + jit(), y + jit());
    ctx.lineTo(x + w + jit(), y + h - rr + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + w + jit(), y + h + jit(), x + w - rr + jit(), y + h + jit());
    else ctx.lineTo(x + w + jit(), y + h + jit());
    ctx.lineTo(x + rr + jit(), y + h + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + jit(), y + h + jit(), x + jit(), y + h - rr + jit());
    else ctx.lineTo(x + jit(), y + h + jit());
    ctx.lineTo(x + jit(), y + rr + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + jit(), y + jit(), x + rr + jit(), y + jit());
    else ctx.lineTo(x + jit(), y + jit());
    ctx.closePath();
}

/** Stroke a sketchy rect twice for the doubled pencil-line look. */
function inkSketchRect(ctx, x, y, w, h, { amp = 2.4, r = 0, color = '#2a2320', width = 4.5, double = true } = {}, rand) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    sketchRectPath(ctx, x, y, w, h, amp, rand, r);
    ctx.stroke();
    if (!double) return;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = width * 0.7;
    sketchRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, amp * 0.8, rand, r);
    ctx.stroke();
    ctx.restore();
}

/** A polyline whose vertices wobble by ±amp — a hand-drawn stroke. */
function wobblePath(ctx, pts, amp, rand) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
        const jx = (rand() - 0.5) * amp;
        const jy = (rand() - 0.5) * amp;
        if (i === 0) ctx.moveTo(x + jx, y + jy);
        else ctx.lineTo(x + jx, y + jy);
    });
}

/** Stroke `build` once, then echo it with a lighter offset pass. */
function inkStroke(ctx, build, { color = '#2a2320', width = 5, echo = 0.4 } = {}) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    build(ctx);
    ctx.stroke();
    if (echo > 0) {
        ctx.save();
        ctx.globalAlpha = echo;
        ctx.lineWidth = width * 0.6;
        ctx.translate(1.6, 1.6);
        build(ctx);
        ctx.stroke();
        ctx.restore();
    }
}

/** Fine paper-grain noise, applied once over a finished canvas. */
function paperGrain(ctx, w, h, rand, amount = 7) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const n = (rand() - 0.5) * amount;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Wood palettes + grain                                                */
/* ------------------------------------------------------------------ */

const WOOD = {
    sketch: {
        stile: [206, 178, 138],
        face: [235, 219, 191],
        grain: [176, 146, 106],
        light: [252, 244, 228],
        ink: '#2a2320',
        inkWidth: 5,
        grainAlpha: 0.30,
    },
    painted: {
        stile: [150, 96, 46],
        face: [201, 145, 78],
        grain: [104, 60, 22],
        light: [238, 196, 140],
        ink: '#33220f',
        inkWidth: 4.5,
        grainAlpha: 0.46,
    },
};

// Warm light oak for the corridor furniture (desk, table top, cabinet).
// This used to be a grey laminate — `GREY_WOOD`, face [212,212,209] — which
// made the whole corridor read as an office. Everything the desk / table /
// cabinet is drawn from routes through here, so the palette is the one place
// the material is decided; the two callers that used to override it back to
// grey (the table top and the cabinet door panels) now override toward the
// darker end of the same wood instead.
const FURNITURE_WOOD = {
    face: [201, 163, 113],
    stile: [181, 143, 95],
    grain: [151, 113, 71],
    light: [228, 198, 154],
    ink: '#3A2B1D',
    inkWidth: 4,
    grainAlpha: 0.26,
};

/** Vertical wood grain over a rect. */
function drawWoodPanel(ctx, x, y, w, h, palette, rand, { vertical = true, streakCount = 0 } = {}) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const [br, bg, bb] = palette.face;
    const [lr, lg, lb] = palette.light;
    const [dr, dg, db] = palette.grain;

    const grad = vertical
        ? ctx.createLinearGradient(x, y, x, y + h)
        : ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, rgba(br + 9, bg + 9, bb + 9));
    grad.addColorStop(0.5, rgba(br, bg, bb));
    grad.addColorStop(1, rgba(br - 14, bg - 14, bb - 14));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    const n = streakCount || Math.round((vertical ? w : h) / 6);
    for (let i = 0; i < n; i++) {
        const t = i / n;
        const dark = rand() > 0.44;
        const off = vertical ? x + t * w + (rand() - 0.5) * 6 : y + t * h + (rand() - 0.5) * 6;
        const amp = 1.2 + rand() * 4.5;
        const freq = 0.004 + rand() * 0.012;
        const phase = rand() * 100;

        ctx.beginPath();
        if (vertical) {
            ctx.moveTo(off, y);
            for (let py = y; py <= y + h; py += 14) ctx.lineTo(off + Math.sin(py * freq + phase) * amp, py);
        } else {
            ctx.moveTo(x, off);
            for (let px = x; px <= x + w; px += 14) ctx.lineTo(px, off + Math.sin(px * freq + phase) * amp);
        }
        ctx.strokeStyle = dark
            ? rgba(dr, dg, db, palette.grainAlpha * (0.5 + rand() * 0.8))
            : rgba(lr, lg, lb, palette.grainAlpha * (0.4 + rand() * 0.7));
        ctx.lineWidth = 0.8 + rand() * 2.2;
        ctx.stroke();
    }

    if (rand() > 0.7) {
        const kx = x + w * (0.2 + rand() * 0.6);
        const ky = y + h * (0.2 + rand() * 0.6);
        const kr = Math.min(w, h) * (0.02 + rand() * 0.035);
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 3);
        kg.addColorStop(0, rgba(dr - 16, dg - 16, db - 14, 0.55));
        kg.addColorStop(0.45, rgba(dr, dg, db, 0.24));
        kg.addColorStop(1, rgba(dr, dg, db, 0));
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * 1.5, kr * 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 1. Door hardware                                                     */
/* ------------------------------------------------------------------ */

/**
 * Lever handle for the double doors at the end of a corridor segment.
 *
 * The mesh is a full-door-size transparent plane, so the lever is drawn at
 * the same relative spot the old `handle_*_sketch.webp` bitmaps used
 * (x 0.39–0.94, y 0.51–0.61 of the leaf). The right leaf is mirrored.
 */
export function makeDoubleDoorHandleTexture(side = 'left', variant = 'sketch') {
    const key = `corridor-double-handle-${side}-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 1310;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.sketch;

    // Measured placement in the legacy bitmap
    const yMid = H * 0.56;
    const xTip = W * 0.36;   // free end of the lever (points into the leaf)
    const xRose = W * 0.90;  // rosette, on the hinge-opposite stile

    const barH = H * 0.045;
    const roseW = W * 0.082;
    const roseH = H * 0.088;

    // ---- rosette (the plate screwed to the leaf) ---------------------
    ctx.save();
    ctx.shadowColor = 'rgba(40, 30, 18, 0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    roundRectPath(ctx, xRose - roseW / 2, yMid - roseH / 2, roseW, roseH, roseW * 0.42);
    const rg = ctx.createLinearGradient(xRose - roseW / 2, 0, xRose + roseW / 2, 0);
    rg.addColorStop(0, rgba(pal.stile[0] + 30, pal.stile[1] + 26, pal.stile[2] + 18));
    rg.addColorStop(0.5, rgba(pal.stile[0] + 6, pal.stile[1] + 6, pal.stile[2] + 4));
    rg.addColorStop(1, rgba(pal.stile[0] - 34, pal.stile[1] - 30, pal.stile[2] - 24));
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.restore();
    inkSketchRect(ctx, xRose - roseW / 2, yMid - roseH / 2, roseW, roseH, {
        amp: 1.8, r: roseW * 0.42, color: pal.ink, width: pal.inkWidth * 0.6,
    }, rand);

    // ---- lever bar ---------------------------------------------------
    const drawLever = (c) => {
        c.beginPath();
        c.moveTo(xTip, yMid - barH * 0.30);
        c.quadraticCurveTo((xTip + xRose) / 2, yMid - barH * 0.62, xRose - roseW * 0.30, yMid - barH * 0.42);
        c.lineTo(xRose - roseW * 0.30, yMid + barH * 0.42);
        c.quadraticCurveTo((xTip + xRose) / 2, yMid + barH * 0.62, xTip, yMid + barH * 0.30);
        c.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(40, 30, 18, 0.30)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 4;
    drawLever(ctx);
    const lg = ctx.createLinearGradient(0, yMid - barH, 0, yMid + barH);
    lg.addColorStop(0, rgba(pal.stile[0] + 46, pal.stile[1] + 40, pal.stile[2] + 30));
    lg.addColorStop(0.45, rgba(pal.stile[0] + 12, pal.stile[1] + 10, pal.stile[2] + 8));
    lg.addColorStop(1, rgba(pal.stile[0] - 40, pal.stile[1] - 36, pal.stile[2] - 28));
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();
    inkStroke(ctx, drawLever, { color: pal.ink, width: pal.inkWidth * 0.7, echo: 0.35 });

    // Bright catch-light along the top of the bar
    ctx.beginPath();
    ctx.moveTo(xTip + 8, yMid - barH * 0.44);
    ctx.lineTo(xRose - roseW * 0.42, yMid - barH * 0.52);
    ctx.strokeStyle = 'rgba(255, 250, 238, 0.55)';
    ctx.lineWidth = Math.max(2, barH * 0.16);
    ctx.lineCap = 'round';
    ctx.stroke();

    // ---- mirror for the right leaf -----------------------------------
    let out = canvas;
    if (side === 'right') {
        const flip = makeCanvas(W, H);
        const fctx = flip.getContext('2d');
        fctx.translate(W, 0);
        fctx.scale(-1, 1);
        fctx.drawImage(canvas, 0, 0);
        out = flip;
    }

    const texture = toTexture(out, key);
    cache.set(key, texture);
    return texture;
}

/**
 * Lever handle for the side room doors (`klamkadodrzwi`).
 *
 * Same full-door-size transparent plane trick: the old bitmap carried the
 * lever at x 0.73–1.00, y 0.53–0.58. DoorSection mirrors the *mesh* for
 * right-hand doors, so one texture covers both sides.
 */
export function makeRoomDoorHandleTexture(variant = 'sketch') {
    const key = `corridor-room-handle-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 1216;                 // matches the 0.421 door aspect
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const brass = variant === 'painted';
    const pal = brass
        ? { dark: [120, 84, 34], mid: [186, 141, 74], light: [236, 202, 140], ink: '#33220f' }
        : { dark: [104, 104, 102], mid: [156, 156, 154], light: [214, 214, 212], ink: '#2a2a28' };

    const yMid = H * 0.555;
    const xRose = W * 0.955;
    const xTip = W * 0.70;

    const barH = H * 0.042;
    const roseW = W * 0.072;
    const roseH = H * 0.066;

    // Rosette
    ctx.save();
    ctx.shadowColor = 'rgba(30, 24, 16, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    roundRectPath(ctx, xRose - roseW, yMid - roseH / 2, roseW, roseH, roseW * 0.4);
    const rg = ctx.createLinearGradient(xRose - roseW, 0, xRose, 0);
    rg.addColorStop(0, rgba(pal.light[0], pal.light[1], pal.light[2]));
    rg.addColorStop(0.55, rgba(pal.mid[0], pal.mid[1], pal.mid[2]));
    rg.addColorStop(1, rgba(pal.dark[0], pal.dark[1], pal.dark[2]));
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.restore();
    inkSketchRect(ctx, xRose - roseW, yMid - roseH / 2, roseW, roseH, {
        amp: 1.6, r: roseW * 0.4, color: pal.ink, width: 2.6,
    }, rand);

    // Lever
    const drawLever = (c) => {
        c.beginPath();
        c.moveTo(xTip, yMid - barH * 0.34);
        c.quadraticCurveTo((xTip + xRose) / 2, yMid - barH * 0.70, xRose - roseW * 0.55, yMid - barH * 0.44);
        c.lineTo(xRose - roseW * 0.55, yMid + barH * 0.44);
        c.quadraticCurveTo((xTip + xRose) / 2, yMid + barH * 0.70, xTip, yMid + barH * 0.34);
        c.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(30, 24, 16, 0.34)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    drawLever(ctx);
    const lg = ctx.createLinearGradient(0, yMid - barH, 0, yMid + barH);
    lg.addColorStop(0, rgba(pal.light[0], pal.light[1], pal.light[2]));
    lg.addColorStop(0.45, rgba(pal.mid[0], pal.mid[1], pal.mid[2]));
    lg.addColorStop(1, rgba(pal.dark[0], pal.dark[1], pal.dark[2]));
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();
    inkStroke(ctx, drawLever, { color: pal.ink, width: 3, echo: 0.3 });

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/**
 * The little hand-drawn arrow that points at a room door.
 *
 * Drawn pointing right; DoorSection mirrors the mesh for the door on the
 * other side of the corridor, so both arrows end up pointing at their door.
 */
export function makeDoorArrowTexture() {
    const key = 'corridor-door-arrow';
    if (cache.has(key)) return cache.get(key);

    const W = 128;
    const H = 64;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Shaft, drawn as a shallow arc so it reads as a pencil flick
    const shaft = (c) => {
        c.beginPath();
        c.moveTo(14, 36);
        c.quadraticCurveTo(56, 27, 92, 30);
    };
    inkStroke(ctx, shaft, { color: '#141414', width: 5, echo: 0.5 });

    // Head
    const head = (c) => {
        c.beginPath();
        c.moveTo(86, 15);
        c.lineTo(114, 30);
        c.lineTo(86, 45);
    };
    inkStroke(ctx, head, { color: '#141414', width: 5, echo: 0.5 });

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 2. Signage                                                           */
/* ------------------------------------------------------------------ */

/**
 * Aspect of the room-door plaque (see DoorSection). The canvas and the plane
 * share it, so the board is never stretched.
 *
 * 1020 x 340 = 3.0. The old plate was 1024 x 512 (2.0) and hung 0.65 tall;
 * the user asked for a shorter board on 2026-10-08 ("高度调小"), so the height
 * came down to 0.42 at the same 1.26 width.
 */
const SIGN_TEX_W = 1020;
const SIGN_TEX_H = 340;
export const SIGN_BOARD_ASPECT = SIGN_TEX_W / SIGN_TEX_H;

/** The plane the plaque is painted for, in world units. Height is derived from
 *  the canvas aspect, so the board can never be stretched. */
export const SIGN_BOARD_W = 1.26;
export const SIGN_BOARD_H = SIGN_BOARD_W / SIGN_BOARD_ASPECT;

/**
 * The 古韵木板招牌 above every room door. `<Text>` draws the room name on top
 * of it, so this is just the board.
 *
 * IT REPLACED A WHITE "SCREW PLATE"
 * ---------------------------------
 * The old board was a warm off-white plate with a bevel, a fine inner rule and
 * four corner screws — a gallery label, not a 匾. The user asked for a wooden
 * sign with some age to it ("换成古韵木板招牌"), so this draws what a real
 * one is: a single plank of dark walnut, lacquered, with
 *
 *   1. **Grain.** Long horizontal figure lines, plus a few knots. Drawn with a
 *      low-alpha dark stroke and an even lower-alpha light one offset a couple
 *      of px, which is what makes grain read as figure rather than as stripes.
 *   2. **A carved border.** A recessed groove just inside the edge: a dark
 *      stroke with a light stroke beneath it, so the light catches the lower
 *      lip. That single pair is what says "carved" instead of "printed".
 *   3. **Age.** Uneven edge darkening, a scatter of darker blotches, and a
 *      grain pass. A board that is perfectly even reads as plastic.
 *
 * The name is drawn in `TEXT.plaque.ink` (a warm bone/gold), which is the only
 * colour that survives on wood this dark.
 */
export function makeWoodenSignTexture() {
    const key = 'corridor-sign-board-wood';
    if (cache.has(key)) return cache.get(key);

    const W = SIGN_TEX_W;
    const H = SIGN_TEX_H;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const M = 10;

    // ---- the plank -----------------------------------------------------
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0.00, '#7C5836');
    base.addColorStop(0.18, '#6E4C2E');
    base.addColorStop(0.62, '#5C3F27');
    base.addColorStop(1.00, '#48301D');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // A faint side-to-side shading so the plank reads as slightly dished.
    const across = ctx.createLinearGradient(0, 0, W, 0);
    across.addColorStop(0.00, 'rgba(24,14,8,0.22)');
    across.addColorStop(0.16, 'rgba(24,14,8,0.00)');
    across.addColorStop(0.84, 'rgba(24,14,8,0.00)');
    across.addColorStop(1.00, 'rgba(24,14,8,0.26)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, W, H);

    // ---- grain ---------------------------------------------------------
    // Long figure lines. `wobble` walks the line's height so no two are
    // parallel — real grain drifts.
    for (let i = 0; i < 46; i++) {
        const y0 = rand() * H;
        const amp = 2 + rand() * 7;
        const light = rand() < 0.42;
        ctx.beginPath();
        for (let x = -10; x <= W + 10; x += 14) {
            const y = y0 + Math.sin(x * (0.004 + rand() * 0.002) + i) * amp;
            if (x <= -10) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 0.8 + rand() * 2.6;
        ctx.strokeStyle = light
            ? `rgba(255,220,168,${(0.03 + rand() * 0.05).toFixed(3)})`
            : `rgba(32,19,10,${(0.05 + rand() * 0.13).toFixed(3)})`;
        ctx.stroke();
    }

    // Two knots, off to one side so the name never sits on one.
    [[W * 0.13, H * 0.36], [W * 0.88, H * 0.68]].forEach(([kx, ky]) => {
        const r = H * (0.09 + rand() * 0.04);
        const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, r);
        kg.addColorStop(0.0, 'rgba(38,22,12,0.55)');
        kg.addColorStop(0.5, 'rgba(58,36,20,0.22)');
        kg.addColorStop(1.0, 'rgba(58,36,20,0.0)');
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * 1.5, r, rand() * 0.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // ---- carved border --------------------------------------------------
    // The recess: dark lip on top, light catch underneath.
    const inset = 22;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,222,172,0.14)';
    ctx.lineWidth = 4;
    roundRectPath(ctx, M + inset - 2, M + inset - 2, W - (M + inset - 2) * 2, H - (M + inset - 2) * 2, 10);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(28,16,8,0.62)';
    ctx.lineWidth = 6;
    roundRectPath(ctx, M + inset, M + inset, W - (M + inset) * 2, H - (M + inset) * 2, 10);
    ctx.stroke();

    // ---- the outer edge of the plank ------------------------------------
    ctx.strokeStyle = 'rgba(22,12,6,0.72)';
    ctx.lineWidth = 7;
    roundRectPath(ctx, M * 0.5, M * 0.5, W - M, H - M, 12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,228,182,0.10)';
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, M, M, W - M * 2, H - M * 2, 11);
    ctx.stroke();

    // ---- age: blotches + a vignette -------------------------------------
    for (let i = 0; i < 90; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const r = 6 + rand() * 46;
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        const dark = rand() < 0.7;
        g.addColorStop(0, dark ? 'rgba(28,16,8,0.10)' : 'rgba(255,214,158,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.34, W * 0.5, H * 0.5, W * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(16,9,4,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    paperGrain(ctx, W, H, rand, 5);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 3. Picture frames                                                    */
/* ------------------------------------------------------------------ */

// The frame's own geometry. The texture and the plane share an aspect, so a
// pixel in the texture and a world unit are in fixed ratio — that is what lets
// pictureMountOpening() below hand the painting a size in world units.
const FRAME_TEX_W = 1024;
const FRAME_TEX_H = 574;               // 1.785 : 1
const FRAME_BAND = 62;                 // moulding thickness, texture px, all four sides
const FRAME_PLANE_W = 2.5;             // world units
const FRAME_PLANE_H = 2.5 / 1.785;

/**
 * The opening inside the moulding — the rectangle the artwork lives in.
 *
 * `inset` (texture px) shrinks the opening, leaving a sliver of mount visible
 * around the painting. The moulding's cast shadow falls across that sliver and
 * reads as depth, so a few pixels of inset is what makes the painting look
 * *mounted* rather than glued into the frame.
 *
 * CorridorDecorations sizes each GLSL painting to this rectangle. The frame is
 * therefore what decides how big the artwork is; sizing the paintings to their
 * own aspect instead is what used to leave a wide empty mount either side.
 */
export function pictureMountOpening(inset = 0) {
    const w = FRAME_TEX_W - (FRAME_BAND + inset) * 2;
    const h = FRAME_TEX_H - (FRAME_BAND + inset) * 2;
    return {
        width: w * (FRAME_PLANE_W / FRAME_TEX_W),
        height: h * (FRAME_PLANE_H / FRAME_TEX_H),
    };
}

/**
 * The wide corridor picture frame. `variant` 'sketch' is the pencil layer
 * that gets wiped away by the reveal shader; 'painted' is the warm beige
 * layer underneath. Both are fully opaque — the painting itself is a
 * separate GLSL plane mounted in the middle.
 */
export function makePictureFrameTexture(variant = 'sketch') {
    const key = `corridor-picture-frame-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = FRAME_TEX_W;
    const H = FRAME_TEX_H;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const painted = variant === 'painted';
    const tone = painted
        ? { face: [223, 208, 191], band: [198, 180, 158], deep: [160, 140, 118], ink: '#4a3a28', inner: [236, 226, 212] }
        : { face: [238, 238, 236], band: [214, 214, 212], deep: [178, 178, 176], ink: '#2f2f2d', inner: [247, 247, 245] };

    // Inner field (visible around the painting as a mount)
    ctx.fillStyle = rgba(tone.inner[0], tone.inner[1], tone.inner[2]);
    ctx.fillRect(0, 0, W, H);

    // Outer moulding: four bands
    const B = FRAME_BAND;
    const bands = [
        [0, 0, W, B],
        [0, H - B, W, B],
        [0, B, B, H - B * 2],
        [W - B, B, B, H - B * 2],
    ];
    bands.forEach(([x, y, w, h]) => {
        drawWoodPanel(ctx, x, y, w, h, {
            face: tone.band, stile: tone.deep, grain: tone.deep,
            light: tone.face, ink: tone.ink, inkWidth: 4, grainAlpha: 0.24,
        }, rand, { vertical: h > w, streakCount: Math.max(10, Math.round(Math.max(w, h) / 12)) });
    });

    // Bevel highlights: bright on the outer lip, shadow on the inner lip
    ctx.fillStyle = rgba(255, 253, 246, 0.55);
    ctx.fillRect(0, 0, W, 5);
    ctx.fillRect(0, 0, 5, H);
    ctx.fillStyle = rgba(80, 68, 52, 0.35);
    ctx.fillRect(0, H - 6, W, 6);
    ctx.fillRect(W - 6, 0, 6, H);

    // Inner lip of the moulding + a cast shadow onto the mount
    inkSketchRect(ctx, B - 8, B - 8, W - (B - 8) * 2, H - (B - 8) * 2, {
        amp: 2.6, r: 6, color: tone.ink, width: 4.5,
    }, rand);
    const sh = ctx.createLinearGradient(0, B - 8, 0, B + 26);
    sh.addColorStop(0, rgba(70, 58, 44, 0.34));
    sh.addColorStop(1, rgba(70, 58, 44, 0));
    ctx.fillStyle = sh;
    ctx.fillRect(B - 8, B - 8, W - (B - 8) * 2, 34);
    const sh2 = ctx.createLinearGradient(B - 8, 0, B + 22, 0);
    sh2.addColorStop(0, rgba(70, 58, 44, 0.28));
    sh2.addColorStop(1, rgba(70, 58, 44, 0));
    ctx.fillStyle = sh2;
    ctx.fillRect(B - 8, B - 8, 30, H - (B - 8) * 2);

    // Carved ornament along the moulding: a repeating bead
    ctx.fillStyle = rgba(tone.deep[0] - 24, tone.deep[1] - 24, tone.deep[2] - 22, 0.30);
    for (let x = B + 12; x < W - B - 12; x += 26) {
        ctx.beginPath();
        ctx.arc(x, B * 0.5, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, H - B * 0.5, 4.2, 0, Math.PI * 2);
        ctx.fill();
    }

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** The little frame that stands on the corridor cabinet. */
export function makeStandingFrameTexture() {
    const key = 'corridor-standing-frame';
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 659;                 // 0.777 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Shadow behind the frame so it reads as standing
    ctx.save();
    ctx.shadowColor = 'rgba(40, 32, 20, 0.30)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, 26, 20, W - 52, H - 52, 10);
    ctx.fillStyle = '#e6e2d8';
    ctx.fill();
    ctx.restore();

    // Moulding
    drawWoodPanel(ctx, 26, 20, W - 52, H - 52, {
        face: [226, 220, 208], stile: [198, 190, 176], grain: [172, 164, 150],
        light: [248, 244, 236], ink: '#332e26', inkWidth: 4, grainAlpha: 0.2,
    }, rand, { vertical: false, streakCount: 90 });

    // Mount + a little landscape "photo" inside the frame
    const ix = 64;
    const iy = 58;
    const iw = W - 128;
    const ih = H - 128;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();

    // Sky wash
    const sky = ctx.createLinearGradient(0, iy, 0, iy + ih);
    sky.addColorStop(0, rgba(224, 231, 234));
    sky.addColorStop(0.55, rgba(241, 236, 226));
    sky.addColorStop(1, rgba(226, 216, 196));
    ctx.fillStyle = sky;
    ctx.fillRect(ix, iy, iw, ih);

    // Low sun with a soft halo
    const sunX = ix + iw * 0.70;
    const sunY = iy + ih * 0.30;
    const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 72);
    sg.addColorStop(0, rgba(250, 226, 158, 0.95));
    sg.addColorStop(1, rgba(250, 226, 158, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 72, 0, Math.PI * 2);
    ctx.fill();

    // Distant ridge
    ctx.fillStyle = rgba(186, 194, 172, 0.85);
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih * 0.70);
    ctx.quadraticCurveTo(ix + iw * 0.35, iy + ih * 0.52, ix + iw * 0.72, iy + ih * 0.70);
    ctx.lineTo(ix + iw, iy + ih * 0.66);
    ctx.lineTo(ix + iw, iy + ih);
    ctx.lineTo(ix, iy + ih);
    ctx.closePath();
    ctx.fill();

    // Near ridge
    ctx.fillStyle = rgba(150, 162, 134, 0.9);
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih * 0.86);
    ctx.quadraticCurveTo(ix + iw * 0.30, iy + ih * 0.70, ix + iw * 0.62, iy + ih * 0.88);
    ctx.lineTo(ix + iw, iy + ih * 0.82);
    ctx.lineTo(ix + iw, iy + ih);
    ctx.lineTo(ix, iy + ih);
    ctx.closePath();
    ctx.fill();

    // Pencil horizon line
    ctx.strokeStyle = 'rgba(90, 96, 78, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih * 0.72);
    ctx.lineTo(ix + iw, iy + ih * 0.70);
    ctx.stroke();

    ctx.restore();

    inkSketchRect(ctx, 26, 20, W - 52, H - 52, {
        amp: 3, r: 10, color: '#332e26', width: 4.5,
    }, rand);
    inkSketchRect(ctx, 64, 58, W - 128, H - 128, {
        amp: 2.2, r: 4, color: 'rgba(60, 54, 44, 0.55)', width: 2.6, double: false,
    }, rand);

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 4. Wall + ceiling fittings                                           */
/* ------------------------------------------------------------------ */

/** The slatted ventilation grate high on the corridor wall. */
export function makeVentGrateTexture() {
    const key = 'corridor-vent-grate';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 512;                 // ~2 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Plate
    ctx.fillStyle = rgba(228, 228, 226);
    ctx.fillRect(0, 0, W, H);

    // Recessed opening
    const ox = 58;
    const oy = 54;
    const ow = W - ox * 2;
    const oh = H - oy * 2;

    const rg = ctx.createLinearGradient(0, oy, 0, oy + oh);
    rg.addColorStop(0, rgba(120, 120, 118));
    rg.addColorStop(0.12, rgba(168, 168, 166));
    rg.addColorStop(1, rgba(196, 196, 194));
    ctx.fillStyle = rg;
    ctx.fillRect(ox, oy, ow, oh);

    // Slats: horizontal bars with dark gaps, angled to read as a louvre
    const slats = 9;
    const step = oh / slats;
    for (let i = 0; i < slats; i++) {
        const y = oy + i * step;
        const g = ctx.createLinearGradient(0, y, 0, y + step * 0.72);
        g.addColorStop(0, rgba(236, 236, 234));
        g.addColorStop(0.55, rgba(206, 206, 204));
        g.addColorStop(1, rgba(148, 148, 146));
        ctx.fillStyle = g;
        ctx.fillRect(ox, y, ow, step * 0.68);
        // gap shadow
        ctx.fillStyle = rgba(58, 58, 56, 0.55);
        ctx.fillRect(ox, y + step * 0.68, ow, step * 0.32);
    }

    // Frame around the opening
    ctx.strokeStyle = rgba(120, 120, 118, 0.75);
    ctx.lineWidth = 5;
    ctx.strokeRect(ox - 2, oy - 2, ow + 4, oh + 4);

    // Bevel on the plate
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = 'rgba(120, 120, 118, 0.28)';
    ctx.fillRect(0, H - 8, W, 8);

    // Corner screws
    [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]].forEach(([sx, sy]) => {
        ctx.fillStyle = rgba(170, 170, 168);
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgba(110, 110, 108, 0.7);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 5, sy - 5);
        ctx.lineTo(sx + 5, sy + 5);
        ctx.stroke();
    });

    paperGrain(ctx, W, H, rand, 5);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/**
 * The ceiling lamp's underside grille. Drawn on a transparent background so
 * the emissive panel behind it shows through the gaps.
 *
 * 木格 — a warm timber lattice, not a grey sheet-metal grille. The geometry
 * was never the problem; the colour was. The same grid in #969696 with white
 * speculars is unmistakably an office fluorescent panel, and it was the single
 * most off-theme thing in the corridor. In wood it reads as a Chinese ceiling
 * light for free.
 */
export function makeLampGrilleTexture() {
    const key = 'corridor-lamp-grille';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 512;                 // 2 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const FRAME = rgba(122, 88, 54);
    const BAR = rgba(148, 110, 68);
    const CATCH = 'rgba(234, 205, 160, 0.5)';   // warm catch-light on the edge

    // Frame
    ctx.fillStyle = FRAME;
    ctx.fillRect(0, 0, 12, H);
    ctx.fillRect(W - 12, 0, 12, H);
    ctx.fillRect(0, 0, W, 14);
    ctx.fillRect(0, H - 14, W, 14);

    // Cross bars: 5 vertical, 3 horizontal
    const bar = 9;
    for (let i = 1; i < 6; i++) {
        const x = (W / 6) * i;
        ctx.fillStyle = BAR;
        ctx.fillRect(x - bar / 2, 14, bar, H - 28);
        ctx.fillStyle = CATCH;
        ctx.fillRect(x - bar / 2, 14, 2.4, H - 28);
    }
    for (let i = 1; i < 4; i++) {
        const y = (H / 4) * i;
        ctx.fillStyle = BAR;
        ctx.fillRect(12, y - bar / 2, W - 24, bar);
        ctx.fillStyle = CATCH;
        ctx.fillRect(12, y - bar / 2, W - 24, 2.4);
    }

    // Slight wear so it does not read as CAD-perfect
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 120; i++) {
        ctx.fillStyle = rand() > 0.5 ? '#2A1C10' : '#F0DCBC';
        ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 6, 1 + rand() * 2);
    }
    ctx.restore();

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** The long sides of the ceiling lamp housing. */
export function makeLampSideTexture() {
    const key = 'corridor-lamp-side';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 64;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Joined timber rather than brushed sheet metal, for the same reason as
    // the grille above — the housing was the other half of the "office
    // fluorescent" read.
    drawWoodPanel(ctx, 0, 0, W, H, {
        ...FURNITURE_WOOD,
        face: [176, 138, 92],
        stile: [158, 120, 78],
    }, rand, { vertical: false, streakCount: 40 });

    // Seam lines so the housing reads as a joined timber box
    ctx.fillStyle = rgba(104, 74, 44, 0.5);
    ctx.fillRect(0, H - 2, W, 2);
    ctx.fillStyle = rgba(236, 210, 170, 0.55);
    ctx.fillRect(0, 1, W, 2);

    const texture = toTexture(canvas, key, { clamp: false, repeat: [1, 1] });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 5. Furniture                                                         */
/* ------------------------------------------------------------------ */

/** Warm oak for the desk legs (the mesh rotates it upright). */
export function makeDeskWoodTexture() {
    const key = 'corridor-desk-wood';
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 32;                  // 16 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    drawWoodPanel(ctx, 0, 0, W, H, FURNITURE_WOOD, rand, { vertical: false, streakCount: 46 });

    const texture = toTexture(canvas, key, { clamp: false, repeat: [1, 1] });
    cache.set(key, texture);
    return texture;
}

/** The desk top: same oak, grain running across the long side. */
export function makeTableTopTexture() {
    const key = 'corridor-table-top';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 410;                 // 2.5 : 1, the box top face
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    drawWoodPanel(ctx, 0, 0, W, H, {
        ...FURNITURE_WOOD,
        // A shade lighter than the cabinet — the table top catches the most
        // light in the corridor, and one uniform tone flattens it.
        face: [211, 174, 124],
        stile: [192, 154, 106],
        grain: [160, 122, 79],
        light: [236, 210, 168],
    }, rand, { vertical: false, streakCount: 120 });

    // A faint shadow along the back edge, like the desk sits against a wall
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(104, 74, 44, 0.16));
    g.addColorStop(0.25, rgba(104, 74, 44, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** The cabinet's corridor-facing door: two recessed panels + knobs. */
export function makeCabinetFrontTexture() {
    const key = 'corridor-cabinet-front';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 1280;                // 0.8 : 1, the box side face
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    drawWoodPanel(ctx, 0, 0, W, H, FURNITURE_WOOD, rand, { vertical: true, streakCount: 150 });

    // Two recessed panels
    const panels = [
        [110, 120, W - 220, 430],
        [110, 700, W - 220, 430],
    ];
    panels.forEach(([x, y, w, h]) => {
        ctx.save();
        roundRectPath(ctx, x, y, w, h, 10);
        ctx.clip();
        drawWoodPanel(ctx, x, y, w, h, {
            ...FURNITURE_WOOD,
            // Recessed panels sit a touch deeper than the surrounding door.
            face: [187, 148, 100],
            stile: [168, 130, 84],
        }, rand, { vertical: true, streakCount: 60 });
        const sh = ctx.createLinearGradient(x, y, x, y + 46);
        sh.addColorStop(0, rgba(92, 62, 34, 0.34));
        sh.addColorStop(1, rgba(92, 62, 34, 0));
        ctx.fillStyle = sh;
        ctx.fillRect(x, y, w, 46);
        ctx.restore();

        inkSketchRect(ctx, x, y, w, h, { amp: 2.4, r: 10, color: FURNITURE_WOOD.ink, width: 3.4 }, rand);
    });

    // Knobs between the panels
    [[W * 0.5, 600]].forEach(([kx, ky]) => {
        const kg = ctx.createRadialGradient(kx - 6, ky - 8, 2, kx, ky, 30);
        kg.addColorStop(0, rgba(250, 232, 198));
        kg.addColorStop(1, rgba(166, 122, 72));
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.arc(kx, ky, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgba(88, 60, 32, 0.6);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    });

    inkSketchRect(ctx, 8, 8, W - 16, H - 16, {
        amp: 3, r: 10, color: FURNITURE_WOOD.ink, width: 4,
    }, rand);

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** The cabinet's plain side / top panels. */
export function makeCabinetSideTexture() {
    const key = 'corridor-cabinet-side';
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 1024;                // 0.5 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    drawWoodPanel(ctx, 0, 0, W, H, FURNITURE_WOOD, rand, { vertical: true, streakCount: 110 });

    // Panel seams so the side does not read as a blank slab
    ctx.strokeStyle = rgba(150, 110, 68, 0.5);
    ctx.lineWidth = 2.4;
    [H * 0.33, H * 0.66].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(10, y);
        ctx.lineTo(W - 10, y);
        ctx.stroke();
    });

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 6. Plants                                                            */
/* ------------------------------------------------------------------ */

/** Terracotta pot shared by the tree and the flower. */
function drawPot(ctx, cx, topY, bottomY, topW, bottomW) {
    const h = bottomY - topY;
    const path = (c) => {
        c.beginPath();
        c.moveTo(cx - topW / 2, topY);
        c.lineTo(cx + topW / 2, topY);
        c.lineTo(cx + bottomW / 2, bottomY);
        c.lineTo(cx - bottomW / 2, bottomY);
        c.closePath();
    };

    path(ctx);
    const g = ctx.createLinearGradient(cx - topW / 2, 0, cx + topW / 2, 0);
    g.addColorStop(0, rgba(158, 92, 52));
    g.addColorStop(0.32, rgba(198, 126, 74));
    g.addColorStop(0.68, rgba(176, 104, 60));
    g.addColorStop(1, rgba(126, 70, 38));
    ctx.fillStyle = g;
    ctx.fill();

    // Rim
    ctx.fillStyle = rgba(206, 138, 86);
    roundRectPath(ctx, cx - topW / 2 - 8, topY - 26, topW + 16, 30, 6);
    ctx.fill();

    // Soil
    ctx.fillStyle = rgba(74, 52, 34);
    ctx.beginPath();
    ctx.ellipse(cx, topY - 10, topW / 2 - 6, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shadow on the pot body
    const sg = ctx.createLinearGradient(0, bottomY - h * 0.5, 0, bottomY);
    sg.addColorStop(0, 'rgba(60, 32, 16, 0)');
    sg.addColorStop(1, 'rgba(60, 32, 16, 0.35)');
    ctx.save();
    path(ctx);
    ctx.clip();
    ctx.fillStyle = sg;
    ctx.fillRect(cx - topW, topY, topW * 2, h);
    ctx.restore();

    inkStroke(ctx, path, { color: '#3a2415', width: 4, echo: 0.3 });
}

/** The tall potted plant that stands opposite the Contact door. */
export function makePottedTreeTexture() {
    const key = 'corridor-potted-tree';
    if (cache.has(key)) return cache.get(key);

    const W = 600;
    const H = 997;                 // 0.602 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const cx = W * 0.5;

    // ---- trunk --------------------------------------------------------
    const trunkTop = H * 0.44;
    const trunkBottom = H * 0.76;
    ctx.strokeStyle = '#7a5a38';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, trunkBottom);
    ctx.quadraticCurveTo(cx - 10, (trunkTop + trunkBottom) / 2, cx + 4, trunkTop);
    ctx.stroke();
    // two branches
    [[0.60, -1], [0.52, 1]].forEach(([t, dir]) => {
        ctx.beginPath();
        ctx.moveTo(cx, H * t);
        ctx.quadraticCurveTo(cx + dir * 46, H * (t - 0.06), cx + dir * 82, H * (t - 0.14));
        ctx.strokeStyle = '#7a5a38';
        ctx.lineWidth = 9;
        ctx.stroke();
    });

    // ---- foliage ------------------------------------------------------
    const blobs = [
        [cx, H * 0.20, W * 0.40, H * 0.17],
        [cx - W * 0.26, H * 0.30, W * 0.26, H * 0.12],
        [cx + W * 0.26, H * 0.28, W * 0.27, H * 0.13],
        [cx - W * 0.16, H * 0.14, W * 0.22, H * 0.10],
        [cx + W * 0.18, H * 0.13, W * 0.20, H * 0.09],
        [cx, H * 0.38, W * 0.30, H * 0.11],
        [cx - W * 0.32, H * 0.42, W * 0.18, H * 0.09],
        [cx + W * 0.32, H * 0.41, W * 0.18, H * 0.09],
    ];
    blobs.forEach(([bx, by, bw, bh]) => {
        const g = ctx.createRadialGradient(bx - bw * 0.25, by - bh * 0.35, bh * 0.2, bx, by, bw);
        g.addColorStop(0, rgba(168, 178, 78));
        g.addColorStop(0.55, rgba(138, 150, 60));
        g.addColorStop(1, rgba(96, 108, 42));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(bx, by, bw, bh, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Leaf speckle so the canopy has texture
    for (let i = 0; i < 340; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand());
        const bx = cx + Math.cos(a) * r * W * 0.40;
        const by = H * 0.27 + Math.sin(a) * r * H * 0.20;
        ctx.fillStyle = rand() > 0.5
            ? rgba(190, 200, 110, 0.45 + rand() * 0.3)
            : rgba(88, 100, 38, 0.35 + rand() * 0.3);
        ctx.beginPath();
        ctx.ellipse(bx, by, 5 + rand() * 7, 3 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
    }

    // Ink contour around the canopy
    ctx.strokeStyle = 'rgba(58, 66, 26, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.27, W * 0.42, H * 0.21, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- pot ----------------------------------------------------------
    drawPot(ctx, cx, H * 0.78, H * 0.96, W * 0.46, W * 0.34);

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** The little flower pot that sits on the desk. */
export function makePottedFlowerTexture() {
    const key = 'corridor-potted-flower';
    if (cache.has(key)) return cache.get(key);

    const W = 400;
    const H = 528;                 // 0.758 : 1
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const cx = W * 0.5;

    // Stem
    ctx.strokeStyle = '#6f8a3a';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.72);
    ctx.quadraticCurveTo(cx - 14, H * 0.52, cx + 2, H * 0.33);
    ctx.stroke();

    // Leaves
    [[0.60, -1], [0.50, 1]].forEach(([t, dir]) => {
        ctx.save();
        ctx.translate(cx + dir * 30, H * t);
        ctx.rotate(dir * 0.5);
        const lg = ctx.createLinearGradient(0, -18, 0, 18);
        lg.addColorStop(0, rgba(150, 176, 84));
        lg.addColorStop(1, rgba(96, 122, 48));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.ellipse(0, 0, 44, 19, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(56, 72, 26, 0.6)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
    });

    // Flower head: six petals + a centre
    const hy = H * 0.27;
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * 34, hy + Math.sin(a) * 34);
        ctx.rotate(a);
        const pg = ctx.createLinearGradient(-26, 0, 26, 0);
        pg.addColorStop(0, rgba(244, 176, 186));
        pg.addColorStop(1, rgba(226, 122, 140));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.ellipse(0, 0, 30, 17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150, 66, 82, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
    const cg = ctx.createRadialGradient(cx - 5, hy - 5, 2, cx, hy, 24);
    cg.addColorStop(0, rgba(255, 226, 150));
    cg.addColorStop(1, rgba(226, 168, 60));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, hy, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 100, 30, 0.55)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Pot
    drawPot(ctx, cx, H * 0.74, H * 0.96, W * 0.62, W * 0.46);

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 7. Floating doodles                                                  */
/* ------------------------------------------------------------------ */

const DOODLE_INK = '#33302b';

/** Crumpled ball of paper. */
export function makePaperBallTexture() {
    const key = 'corridor-doodle-paper-ball';
    if (cache.has(key)) return cache.get(key);

    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const cx = S * 0.5;
    const cy = S * 0.5;
    const r = S * 0.33;

    const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.2, cx, cy, r * 1.15);
    g.addColorStop(0, rgba(250, 246, 236));
    g.addColorStop(0.6, rgba(232, 224, 206));
    g.addColorStop(1, rgba(196, 186, 166));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Creases: chords across the ball
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2;
        const off = (rand() - 0.5) * r * 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 1.4 - off, cy + Math.sin(a) * r * 1.4);
        ctx.lineTo(cx - Math.cos(a) * r * 1.4 - off, cy - Math.sin(a) * r * 1.4);
        ctx.strokeStyle = rgba(178, 168, 148, 0.45 + rand() * 0.3);
        ctx.lineWidth = 1.6 + rand() * 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 1.4 - off + 3, cy + Math.sin(a) * r * 1.4 + 2);
        ctx.lineTo(cx - Math.cos(a) * r * 1.4 - off + 3, cy - Math.sin(a) * r * 1.4 + 2);
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }
    ctx.restore();

    inkStroke(ctx, (c) => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); }, {
        color: DOODLE_INK, width: 5, echo: 0.35,
    });

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** Folded paper aeroplane. */
export function makePaperAirplaneTexture() {
    const key = 'corridor-doodle-paper-plane';
    if (cache.has(key)) return cache.get(key);

    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Body: nose at the right, two wings sweeping back-left
    const nose = [S * 0.80, S * 0.50];
    const wingTop = [S * 0.19, S * 0.28];
    const wingBot = [S * 0.19, S * 0.73];
    const tail = [S * 0.44, S * 0.52];

    // Upper wing (lit)
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(wingTop[0], wingTop[1]);
    ctx.lineTo(tail[0], tail[1]);
    ctx.closePath();
    const wg = ctx.createLinearGradient(wingTop[0], wingTop[1], nose[0], nose[1]);
    wg.addColorStop(0, rgba(238, 234, 224));
    wg.addColorStop(1, rgba(255, 253, 248));
    ctx.fillStyle = wg;
    ctx.fill();

    // Lower wing (shaded)
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(wingBot[0], wingBot[1]);
    ctx.lineTo(tail[0], tail[1]);
    ctx.closePath();
    const wg2 = ctx.createLinearGradient(wingBot[0], wingBot[1], nose[0], nose[1]);
    wg2.addColorStop(0, rgba(198, 192, 178));
    wg2.addColorStop(1, rgba(230, 226, 216));
    ctx.fillStyle = wg2;
    ctx.fill();

    // Fuselage fold line
    ctx.strokeStyle = 'rgba(150, 144, 130, 0.7)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(tail[0], tail[1]);
    ctx.stroke();

    // Ink outline
    const outline = (c) => {
        c.beginPath();
        c.moveTo(nose[0], nose[1]);
        c.lineTo(wingTop[0], wingTop[1]);
        c.lineTo(tail[0], tail[1]);
        c.lineTo(wingBot[0], wingBot[1]);
        c.closePath();
    };
    inkStroke(ctx, outline, { color: DOODLE_INK, width: 5, echo: 0.35 });

    void rand;
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** Pencil, lying diagonally. */
export function makePencilTexture() {
    const key = 'corridor-doodle-pencil';
    if (cache.has(key)) return cache.get(key);

    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Draw along the canvas diagonal, then let the mesh rotate it
    const x0 = S * 0.20;
    const y0 = S * 0.80;
    const x1 = S * 0.78;
    const y1 = S * 0.24;

    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(Math.atan2(y1 - y0, x1 - x0));

    const len = Math.hypot(x1 - x0, y1 - y0);
    const th = 30;

    // Body
    ctx.beginPath();
    ctx.rect(0, -th / 2, len * 0.80, th);
    const bg = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
    bg.addColorStop(0, rgba(248, 206, 96));
    bg.addColorStop(0.42, rgba(238, 178, 62));
    bg.addColorStop(1, rgba(188, 128, 34));
    ctx.fillStyle = bg;
    ctx.fill();

    // Facet lines
    ctx.strokeStyle = 'rgba(150, 98, 24, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -th * 0.16);
    ctx.lineTo(len * 0.80, -th * 0.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, th * 0.22);
    ctx.lineTo(len * 0.80, th * 0.22);
    ctx.stroke();

    // Ferrule + eraser
    ctx.fillStyle = rgba(176, 176, 174);
    ctx.fillRect(len * 0.80, -th / 2, len * 0.12, th);
    ctx.fillStyle = rgba(232, 150, 160);
    ctx.beginPath();
    roundRectPath(ctx, len * 0.92, -th / 2, len * 0.08, th, th * 0.35);
    ctx.fill();

    // Sharpened tip
    ctx.beginPath();
    ctx.moveTo(0, -th / 2);
    ctx.lineTo(-len * 0.14, 0);
    ctx.lineTo(0, th / 2);
    ctx.closePath();
    ctx.fillStyle = rgba(232, 214, 178);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-len * 0.10, -th * 0.16);
    ctx.lineTo(-len * 0.14, 0);
    ctx.lineTo(-len * 0.10, th * 0.16);
    ctx.closePath();
    ctx.fillStyle = rgba(48, 44, 40);
    ctx.fill();

    // Ink outline of the body
    ctx.strokeStyle = DOODLE_INK;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -th / 2);
    ctx.lineTo(len * 0.80, -th / 2);
    ctx.lineTo(len * 0.80, th / 2);
    ctx.lineTo(0, th / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -th / 2);
    ctx.lineTo(-len * 0.14, 0);
    ctx.lineTo(0, th / 2);
    ctx.stroke();

    ctx.restore();

    void rand;
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/** Coffee cup seen from the side, with steam. */
export function makeCoffeeCupTexture() {
    const key = 'corridor-doodle-coffee-cup';
    if (cache.has(key)) return cache.get(key);

    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const cx = S * 0.50;
    const topY = S * 0.42;
    const botY = S * 0.76;
    const topW = S * 0.34;
    const botW = S * 0.26;

    // Cup body
    const body = (c) => {
        c.beginPath();
        c.moveTo(cx - topW / 2, topY);
        c.lineTo(cx + topW / 2, topY);
        c.lineTo(cx + botW / 2, botY);
        c.quadraticCurveTo(cx, botY + 10, cx - botW / 2, botY);
        c.closePath();
    };
    body(ctx);
    const g = ctx.createLinearGradient(cx - topW / 2, 0, cx + topW / 2, 0);
    g.addColorStop(0, rgba(250, 246, 238));
    g.addColorStop(0.55, rgba(238, 232, 222));
    g.addColorStop(1, rgba(206, 198, 184));
    ctx.fillStyle = g;
    ctx.fill();

    // Coffee surface
    ctx.fillStyle = rgba(112, 74, 44);
    ctx.beginPath();
    ctx.ellipse(cx, topY, topW / 2, topW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(70, 44, 24, 0.7);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Handle
    ctx.beginPath();
    ctx.moveTo(cx + topW * 0.48, topY + 18);
    ctx.quadraticCurveTo(cx + topW * 0.95, (topY + botY) / 2, cx + topW * 0.42, botY - 14);
    ctx.strokeStyle = rgba(216, 208, 194);
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = DOODLE_INK;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Saucer
    ctx.fillStyle = rgba(232, 226, 214);
    ctx.beginPath();
    ctx.ellipse(cx, botY + 14, topW * 0.72, topW * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = DOODLE_INK;
    ctx.lineWidth = 4;
    ctx.stroke();

    inkStroke(ctx, body, { color: DOODLE_INK, width: 4.5, echo: 0.3 });

    // Steam: two wavy ribbons
    [[-16, 0], [14, 0.6]].forEach(([dx, phase]) => {
        ctx.beginPath();
        for (let i = 0; i <= 22; i++) {
            const t = i / 22;
            const y = topY - 12 - t * (topY * 0.62);
            const x = cx + dx + Math.sin(t * 5.2 + phase) * 9;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(150, 146, 140, 0.5)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();
    });

    void rand;
    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}
