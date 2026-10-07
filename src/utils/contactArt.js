/**
 * Contact room art — the whole "message in a bottle" room, drawn on an
 * offscreen <canvas> and wrapped in a THREE.CanvasTexture. Nothing is fetched.
 *
 * Replaced (public/textures/contact/, 8 files / 1.40 MB):
 *
 *   faletopdown.webp    -> makeSeaTexture()            4 stacked wave layers
 *   molo.webp           -> makePierTexture()           the wooden jetty
 *   latarnia.webp       -> makeLighthouseTexture()     cut-out silhouette
 *   statek.webp         -> makeShipTexture()           cut-out silhouette
 *   beczka.webp         -> makeBarrelSketchTexture()   line-art (hover off)
 *   beczka_painted.webp -> makeBarrelPaintedTexture()  filled   (hover on)
 *   paper_form.webp     -> makePaperFormTexture()      the contact sheet
 *   send_button.webp    -> makeSendButtonTexture()     the SEND plate
 *
 * ASPECT-RATIO CONTRACT
 * ---------------------
 * Every canvas is authored at the exact aspect ratio of the plane it lands on,
 * so nothing is ever stretched. The *_ASPECT constants below are the single
 * source of truth for that mapping — if a plane's size changes in the room,
 * change the constant here and the art follows.
 *
 * TONE NOTE
 * ---------
 * Six of these meshes carry `color="#e0e0e0"` (0.878x), so the painted tones
 * below are authored ~14% brighter than what ends up on screen. The sea is the
 * exception: its material is `color="#ffffff"`, and the pier/jetty is meant to
 * read slightly weathered, so its palette is intentionally muted.
 *
 * Textures are cached per key — callers may call these on every render.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32, rgba } from '../engine/art';

const cache = new Map();

/* ------------------------------------------------------------------ */
/* Small helpers (mirrors the doorArt / gateArt / corridorArt set)      */
/* ------------------------------------------------------------------ */

function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Wrap a canvas in a CanvasTexture (cached per key).
 *
 * `wrap` defaults to ClampToEdge because most of these are one-off silhouettes
 * that must NOT bleed their opposite edge back in. The sea opts into
 * MirroredRepeatWrapping, the jetty into RepeatWrapping.
 */
function toTexture(canvas, key, { wrap = THREE.ClampToEdgeWrapping, repeat = null, rotation = 0 } = {}) {
    const cached = cache.get(key);
    if (cached) return cached;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = wrap;
    if (repeat) texture.repeat.set(repeat[0], repeat[1]);
    if (rotation) {
        texture.center.set(0.5, 0.5);
        texture.rotation = rotation;
    }
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
function inkSketchRect(ctx, x, y, w, h, { amp = 2.4, r = 0, color = '#2b2521', width = 4.5, double = true } = {}, rand) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    sketchRectPath(ctx, x, y, w, h, amp, rand, r);
    ctx.stroke();
    if (!double) return;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = width * 0.7;
    sketchRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, amp * 0.8, rand, r);
    ctx.stroke();
    ctx.restore();
}

/** Torn-paper outline: a jittery polygon around the sheet. */
function tornRectPath(ctx, x, y, w, h, rand, amp = 6, per = 30) {
    const pts = [];
    const push = (px, py) => pts.push([px, py]);
    for (let i = 0; i <= per; i++) push(x + (w * i) / per, y + (rand() - 0.5) * amp);
    for (let i = 1; i <= per; i++) push(x + w + (rand() - 0.5) * amp, y + (h * i) / per);
    for (let i = 1; i <= per; i++) push(x + w - (w * i) / per, y + h + (rand() - 0.5) * amp);
    for (let i = 1; i <= per; i++) push(x + (rand() - 0.5) * amp, y + h - (h * i) / per);

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
}

/**
 * Additive paper grain. Fully transparent pixels are left alone so alphaTest
 * cut-outs keep their crisp silhouette.
 */
function paperGrain(ctx, w, h, rand, amount = 7) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const n = (rand() - 0.5) * amount;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
    }
    ctx.putImageData(img, 0, 0);
}

/** fillText with manual letter tracking (canvas letterSpacing is too new). */
function drawTracked(ctx, text, x, y, tracking = 0, align = 'left') {
    if (!tracking) {
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
        return;
    }
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
        ctx.fillText(c, cx, y);
        cx += widths[i] + tracking;
    });
}

const SANS = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

const INK = '#2b2521';

/* ------------------------------------------------------------------ */
/* Aspect contracts                                                     */
/* ------------------------------------------------------------------ */

/**
 * The sea plane is 80 x 30 world units with `repeat.set(6, 4)`, so ONE tile
 * covers 80/6 x 30/4 = 13.333 x 7.5 units -> 16:9. Authoring the canvas at 16:9
 * is what keeps the wave crests from being smeared.
 */
export const SEA_ASPECT = 1024 / 576;

/**
 * The jetty plane is 2.5 x 7 units with `texture.rotation = PI/2`, so the
 * canvas U axis runs ALONG the jetty (7 units) and V runs across it (2.5) ->
 * canvas aspect 7 / 2.5 = 2.8.
 */
export const PIER_ASPECT = 896 / 320;

/** Plane 4.49 x 5 units (LATARNIA_SETTINGS.scale). */
export const LIGHTHOUSE_ASPECT = 718 / 800;

/** Plane 3.35 x 1.3 units (STATEK_SETTINGS.scale). */
export const SHIP_ASPECT = 1030 / 400;

/** Plane 2.12 x 2.3 units (SocialBarrel's default scale). */
export const BARREL_ASPECT = 636 / 690;

/** Plane 1.51 x 1.7 units (PAPER_WIDTH / PAPER_HEIGHT in MessagePaper). */
export const PAPER_FORM_ASPECT = 755 / 850;

/** Plane 0.5 x 0.13 units (the SmoothButton in MessagePaper). */
export const SEND_BUTTON_ASPECT = 500 / 130;

/* ------------------------------------------------------------------ */
/* 🌊 Sea — top-down illustrated water, seamless under mirrored repeat  */
/* ------------------------------------------------------------------ */

/**
 * Traces one wave crest across the full canvas width.
 *
 * The phase is pinned to PI/2 so the curve peaks exactly at x = 0 and x = W and
 * is FLAT there. That is what makes the tile survive MirroredRepeatWrapping
 * without a visible crease where the mirror flips the slope.
 */
function wavePath(ctx, y0, W, amp, periods, offset = 0) {
    const phase = Math.PI / 2;
    const wob = Math.PI / 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) {
        const th = (Math.PI * 2 * periods * x) / W + phase;
        const y = y0 + offset + Math.sin(th) * amp + Math.sin(th * 2 + wob) * amp * 0.32;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
}

export function makeSeaTexture(key = 'contact-sea') {
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 576;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Base wash. Symmetric top<->bottom: a one-way gradient would show a hard
    // seam every 7.5 world units.
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0.0, rgba(199, 226, 241));
    base.addColorStop(0.5, rgba(168, 208, 232));
    base.addColorStop(1.0, rgba(199, 226, 241));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // Broad soft swell shadows. Each blob is stamped 9x (a 3x3 wrap grid) so
    // nothing gets chopped at a tile boundary.
    for (let i = 0; i < 20; i++) {
        const cx = rand() * W;
        const cy = rand() * H;
        const rx = 110 + rand() * 210;
        const ry = 30 + rand() * 60;
        const deep = rand() > 0.5;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const px = cx + ox * W;
                const py = cy + oy * H;
                if (px < -rx || px > W + rx || py < -ry || py > H + ry) continue;
                ctx.save();
                ctx.translate(px, py);
                ctx.scale(rx, ry);
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
                if (deep) {
                    g.addColorStop(0, rgba(126, 174, 210, 0.34));
                    g.addColorStop(1, rgba(126, 174, 210, 0));
                } else {
                    g.addColorStop(0, rgba(240, 250, 255, 0.5));
                    g.addColorStop(1, rgba(240, 250, 255, 0));
                }
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(0, 0, 1, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    // Wave rows. Evenly spaced so the tile stays seamless vertically too.
    const ROWS = 6;
    const rowY = [];
    for (let r = 0; r < ROWS; r++) {
        const y0 = (r + 0.5) * (H / ROWS);
        const amp = 9 + rand() * 9;
        const periods = 2 + Math.floor(rand() * 3);
        rowY.push({ y0, amp, periods });

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Trough: a soft blue shadow sitting under the crest.
        wavePath(ctx, y0, W, amp, periods, 5.5);
        ctx.strokeStyle = rgba(104, 156, 198, 0.42);
        ctx.lineWidth = 5.5;
        ctx.stroke();

        // Body of the wave.
        wavePath(ctx, y0, W, amp, periods, 0);
        ctx.strokeStyle = rgba(146, 192, 224, 0.75);
        ctx.lineWidth = 3.2;
        ctx.stroke();

        // Foam crest catching the light.
        wavePath(ctx, y0, W, amp, periods, -4.5);
        ctx.strokeStyle = rgba(255, 255, 255, 0.88);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }

    // Foam dashes + curls riding the crests.
    for (const { y0, amp, periods } of rowY) {
        const dashes = 9 + Math.floor(rand() * 6);
        for (let i = 0; i < dashes; i++) {
            const t = rand();
            const x = t * W;
            const th = (Math.PI * 2 * periods * x) / W + Math.PI / 2;
            const y = y0 + Math.sin(th) * amp + Math.sin(th * 2 + Math.PI / 2) * amp * 0.32 - 5;
            const len = 14 + rand() * 34;

            ctx.beginPath();
            ctx.moveTo(x - len / 2, y);
            ctx.quadraticCurveTo(x, y - 4 - rand() * 5, x + len / 2, y - 1);
            ctx.strokeStyle = rgba(255, 255, 255, 0.55 + rand() * 0.4);
            ctx.lineWidth = 1.6 + rand() * 2.2;
            ctx.stroke();

            // Occasional curl hook
            if (rand() > 0.62) {
                ctx.beginPath();
                ctx.arc(x, y - 6, 4 + rand() * 5, Math.PI * 0.15, Math.PI * 1.05);
                ctx.strokeStyle = rgba(255, 255, 255, 0.7);
                ctx.lineWidth = 1.8;
                ctx.stroke();
            }
        }
    }

    // Glints — tiny highlights that keep the surface from reading flat.
    for (let i = 0; i < 90; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const r = 1.4 + rand() * 2.6;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(r * 2.4, r);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(255, 255, 255, 0.85));
        g.addColorStop(1, rgba(255, 255, 255, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    paperGrain(ctx, W, H, rand, 6);

    return toTexture(canvas, key, {
        wrap: THREE.MirroredRepeatWrapping,
        repeat: [6, 4],
    });
}

/* ------------------------------------------------------------------ */
/* 🏖️ Jetty (molo)                                                      */
/* ------------------------------------------------------------------ */

export function makePierTexture(key = 'contact-pier') {
    if (cache.has(key)) return cache.get(key);

    // canvas U runs ALONG the jetty, canvas V runs ACROSS it.
    const W = 896;
    const H = 320;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Cool weathered base under the planks.
    ctx.fillStyle = rgba(148, 122, 92);
    ctx.fillRect(0, 0, W, H);

    const PLANKS = 13;
    const pw = W / PLANKS;
    const tones = [
        [222, 196, 152],
        [212, 184, 140],
        [230, 206, 164],
        [204, 176, 132],
        [218, 192, 148],
    ];

    for (let i = 0; i < PLANKS; i++) {
        const x = i * pw;
        const tone = tones[Math.floor(rand() * tones.length)];

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, pw, H);
        ctx.clip();

        // Lit from the near edge: brighter on the left, dropping to the right.
        const g = ctx.createLinearGradient(x, 0, x + pw, 0);
        g.addColorStop(0, rgba(tone[0] + 12, tone[1] + 12, tone[2] + 12));
        g.addColorStop(0.55, rgba(tone[0], tone[1], tone[2]));
        g.addColorStop(1, rgba(tone[0] - 26, tone[1] - 24, tone[2] - 20));
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, pw, H);

        // Grain runs along the plank, i.e. along canvas V.
        const grainCount = 16 + Math.floor(rand() * 10);
        for (let gi = 0; gi < grainCount; gi++) {
            const gx = x + rand() * pw;
            const amp = 1 + rand() * 2.6;
            const freq = 0.03 + rand() * 0.05;
            const dark = rand() > 0.45;
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            for (let y = 0; y <= H; y += 10) {
                ctx.lineTo(gx + Math.sin(y * freq + gi) * amp, y);
            }
            ctx.strokeStyle = dark
                ? rgba(tone[0] - 44, tone[1] - 40, tone[2] - 34, 0.14 + rand() * 0.16)
                : rgba(255, 250, 236, 0.16 + rand() * 0.16);
            ctx.lineWidth = 0.7 + rand() * 1.6;
            ctx.stroke();
        }

        // Weather blotches
        if (rand() > 0.5) {
            const bx = x + rand() * pw;
            const by = rand() * H;
            const br = 14 + rand() * 30;
            const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
            bg.addColorStop(0, rgba(tone[0] - 52, tone[1] - 46, tone[2] - 38, 0.28));
            bg.addColorStop(1, rgba(tone[0] - 40, tone[1] - 36, tone[2] - 30, 0));
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }

        // Knot
        if (rand() > 0.72) {
            const kx = x + 12 + rand() * (pw - 24);
            const ky = 40 + rand() * (H - 80);
            const kr = 3 + rand() * 5;
            const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
            kg.addColorStop(0, rgba(tone[0] - 70, tone[1] - 62, tone[2] - 52, 0.6));
            kg.addColorStop(1, rgba(tone[0] - 40, tone[1] - 36, tone[2] - 30, 0));
            ctx.fillStyle = kg;
            ctx.beginPath();
            ctx.arc(kx, ky, kr, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();

        // Gap between planks — a dark seam plus a light catch on its left.
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.strokeStyle = rgba(96, 74, 52, 0.72);
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + 2.2, 0);
        ctx.lineTo(x + 2.2, H);
        ctx.strokeStyle = rgba(255, 244, 224, 0.35);
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }

    // Nail heads — two per plank, near both long edges of the jetty.
    for (let i = 0; i < PLANKS; i++) {
        const cx = i * pw + pw / 2;
        for (const cy of [0.13 * H, 0.87 * H]) {
            const jx = cx + (rand() - 0.5) * 10;
            const jy = cy + (rand() - 0.5) * 8;
            const ng = ctx.createRadialGradient(jx - 1, jy - 1, 0, jx, jy, 4.2);
            ng.addColorStop(0, rgba(206, 206, 208, 0.95));
            ng.addColorStop(0.55, rgba(138, 136, 132, 0.95));
            ng.addColorStop(1, rgba(84, 80, 76, 0.85));
            ctx.fillStyle = ng;
            ctx.beginPath();
            ctx.arc(jx, jy, 4.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Both long edges: a weathered rim board + a soft drop into the water.
    for (const top of [true, false]) {
        const edgeH = H * 0.075;
        const y = top ? 0 : H - edgeH;

        const eg = ctx.createLinearGradient(0, top ? 0 : H, 0, top ? edgeH : H - edgeH);
        eg.addColorStop(0, rgba(150, 124, 94, 0.85));
        eg.addColorStop(1, rgba(178, 152, 118, 0.35));
        ctx.fillStyle = eg;
        ctx.fillRect(0, y, W, edgeH);

        ctx.beginPath();
        ctx.moveTo(0, top ? edgeH : H - edgeH);
        ctx.lineTo(W, top ? edgeH : H - edgeH);
        ctx.strokeStyle = rgba(92, 70, 48, 0.6);
        ctx.lineWidth = 2.4;
        ctx.stroke();
    }

    paperGrain(ctx, W, H, rand, 7);

    return toTexture(canvas, key, {
        wrap: THREE.RepeatWrapping,
        repeat: [1, 1],
        rotation: Math.PI / 2,
    });
}

/* ------------------------------------------------------------------ */
/* 🗼 Lighthouse (latarnia) — cut-out silhouette                        */
/* ------------------------------------------------------------------ */

export function makeLighthouseTexture(key = 'contact-lighthouse') {
    if (cache.has(key)) return cache.get(key);

    const W = 718;
    const H = 800;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const cx = W * 0.5;
    const yBase = H * 0.885;   // tower foot
    const yTop = H * 0.275;    // tower top, under the gallery
    const hwBase = W * 0.185;
    const hwTop = W * 0.108;

    // Straight taper — lighthouses are conical, so linear interpolation is right.
    const halfAt = (t) => hwBase + (hwTop - hwBase) * t;

    const towerPath = () => {
        ctx.beginPath();
        ctx.moveTo(cx - hwBase, yBase);
        ctx.quadraticCurveTo(cx - halfAt(0.5) - 3, (yBase + yTop) / 2, cx - hwTop, yTop);
        ctx.lineTo(cx + hwTop, yTop);
        ctx.quadraticCurveTo(cx + halfAt(0.5) + 3, (yBase + yTop) / 2, cx + hwBase, yBase);
        ctx.closePath();
    };

    /* --- rock plinth ------------------------------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.30, H * 0.955);
    ctx.lineTo(cx - W * 0.235, H * 0.885);
    ctx.lineTo(cx - W * 0.09, H * 0.862);
    ctx.lineTo(cx + W * 0.10, H * 0.868);
    ctx.lineTo(cx + W * 0.245, H * 0.888);
    ctx.lineTo(cx + W * 0.30, H * 0.955);
    ctx.closePath();
    const rockG = ctx.createLinearGradient(cx - W * 0.3, 0, cx + W * 0.3, 0);
    rockG.addColorStop(0, rgba(178, 172, 164));
    rockG.addColorStop(0.5, rgba(206, 200, 192));
    rockG.addColorStop(1, rgba(150, 144, 136));
    ctx.fillStyle = rockG;
    ctx.fill();
    // Stone facets
    ctx.strokeStyle = rgba(118, 112, 104, 0.5);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 14; i++) {
        const ax = cx - W * 0.26 + rand() * W * 0.52;
        const ay = H * 0.872 + rand() * H * 0.07;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + (rand() - 0.5) * 46, ay + 10 + rand() * 16);
        ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    /* --- tower body with painted bands ------------------------------- */
    ctx.save();
    towerPath();
    ctx.clip();

    const BANDS = 6;
    const warmWhite = [250, 246, 238];
    const coral = [216, 104, 84];
    for (let i = 0; i < BANDS; i++) {
        const t0 = i / BANDS;
        const t1 = (i + 1) / BANDS;
        const y0 = yBase + (yTop - yBase) * t0;
        const y1 = yBase + (yTop - yBase) * t1;
        const isRed = i % 2 === 1;
        const c = isRed ? coral : warmWhite;

        const g = ctx.createLinearGradient(cx - hwBase, 0, cx + hwBase, 0);
        g.addColorStop(0, rgba(c[0] + 10, c[1] + 10, c[2] + 10));
        g.addColorStop(0.42, rgba(c[0], c[1], c[2]));
        g.addColorStop(1, rgba(c[0] - 34, c[1] - 30, c[2] - 28));
        ctx.fillStyle = g;
        ctx.fillRect(cx - hwBase - 6, y0, hwBase * 2 + 12, y1 - y0);

        // Grout line between bands
        ctx.beginPath();
        ctx.moveTo(cx - hwBase, y1);
        ctx.lineTo(cx + hwBase, y1);
        ctx.strokeStyle = rgba(150, 130, 116, 0.35);
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    // Vertical mortar hint + a soft shadow down the right flank.
    const shade = ctx.createLinearGradient(cx - hwBase, 0, cx + hwBase, 0);
    shade.addColorStop(0, rgba(0, 0, 0, 0));
    shade.addColorStop(0.62, rgba(0, 0, 0, 0));
    shade.addColorStop(1, rgba(84, 62, 48, 0.24));
    ctx.fillStyle = shade;
    ctx.fillRect(cx - hwBase, yTop, hwBase * 2, yBase - yTop);

    // Windows: three small arched openings up the front.
    for (const t of [0.16, 0.42, 0.68]) {
        const y = yBase + (yTop - yBase) * t;
        const ww = W * 0.035;
        const wh = H * 0.048;
        ctx.beginPath();
        ctx.moveTo(cx - ww / 2, y);
        ctx.lineTo(cx - ww / 2, y - wh * 0.6);
        ctx.quadraticCurveTo(cx, y - wh * 1.35, cx + ww / 2, y - wh * 0.6);
        ctx.lineTo(cx + ww / 2, y);
        ctx.closePath();
        ctx.fillStyle = rgba(96, 118, 134);
        ctx.fill();
        ctx.strokeStyle = rgba(52, 44, 40, 0.75);
        ctx.lineWidth = 2.4;
        ctx.stroke();
        // Sill
        ctx.beginPath();
        ctx.moveTo(cx - ww * 0.8, y + 1);
        ctx.lineTo(cx + ww * 0.8, y + 1);
        ctx.strokeStyle = rgba(120, 100, 84, 0.7);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }
    ctx.restore();

    // Tower ink outline, doubled.
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    towerPath();
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 3;
    ctx.translate(1.6, 0);
    towerPath();
    ctx.stroke();
    ctx.restore();

    /* --- base door --------------------------------------------------- */
    ctx.save();
    const dw = W * 0.062;
    const dh = H * 0.075;
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, yBase);
    ctx.lineTo(cx - dw / 2, yBase - dh * 0.55);
    ctx.quadraticCurveTo(cx, yBase - dh * 1.3, cx + dw / 2, yBase - dh * 0.55);
    ctx.lineTo(cx + dw / 2, yBase);
    ctx.closePath();
    ctx.fillStyle = rgba(126, 84, 54);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    /* --- gallery deck ------------------------------------------------ */
    const yGallery = yTop;
    const hwGallery = W * 0.155;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - hwGallery, yGallery - H * 0.012, hwGallery * 2, H * 0.026);
    const deckG = ctx.createLinearGradient(0, yGallery - H * 0.012, 0, yGallery + H * 0.014);
    deckG.addColorStop(0, rgba(238, 232, 220));
    deckG.addColorStop(1, rgba(176, 166, 150));
    ctx.fillStyle = deckG;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    // Corbels under the deck
    for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * hwTop, yGallery);
        ctx.lineTo(cx + s * hwGallery * 0.82, yGallery - H * 0.014);
        ctx.strokeStyle = rgba(70, 58, 50, 0.7);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }
    ctx.restore();

    /* --- railing ----------------------------------------------------- */
    const railTop = yGallery - H * 0.072;
    const railBot = yGallery - H * 0.014;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (const y of [railTop, (railTop + railBot) / 2]) {
        ctx.beginPath();
        ctx.moveTo(cx - hwGallery * 0.94, y);
        ctx.lineTo(cx + hwGallery * 0.94, y);
        ctx.lineWidth = 2.8;
        ctx.stroke();
    }
    const posts = 9;
    for (let i = 0; i <= posts; i++) {
        const x = cx - hwGallery * 0.94 + (hwGallery * 1.88 * i) / posts;
        ctx.beginPath();
        ctx.moveTo(x, railBot);
        ctx.lineTo(x, railTop - 3);
        ctx.lineWidth = 2.2;
        ctx.stroke();
    }
    ctx.restore();

    /* --- lantern room ------------------------------------------------ */
    const yLanternTop = railTop - H * 0.075;
    const hwLanternTop = W * 0.072;
    const hwLanternBot = W * 0.088;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - hwLanternBot, railTop);
    ctx.lineTo(cx - hwLanternTop, yLanternTop);
    ctx.lineTo(cx + hwLanternTop, yLanternTop);
    ctx.lineTo(cx + hwLanternBot, railTop);
    ctx.closePath();
    const glassG = ctx.createLinearGradient(0, yLanternTop, 0, railTop);
    glassG.addColorStop(0, rgba(252, 226, 158));
    glassG.addColorStop(0.5, rgba(246, 198, 112));
    glassG.addColorStop(1, rgba(196, 158, 92));
    ctx.fillStyle = glassG;
    ctx.fill();
    ctx.clip();
    // Muntins
    ctx.strokeStyle = rgba(72, 58, 46, 0.72);
    ctx.lineWidth = 2.4;
    for (let i = 1; i < 4; i++) {
        const x = cx - hwLanternBot + (hwLanternBot * 2 * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x, yLanternTop);
        ctx.lineTo(x, railTop);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - hwLanternBot, (yLanternTop + railTop) / 2);
    ctx.lineTo(cx + hwLanternBot, (yLanternTop + railTop) / 2);
    ctx.stroke();
    ctx.restore();

    // Warm bloom so the lamp reads as lit.
    ctx.save();
    const bloom = ctx.createRadialGradient(cx, (yLanternTop + railTop) / 2, 0, cx, (yLanternTop + railTop) / 2, W * 0.20);
    bloom.addColorStop(0, rgba(255, 236, 176, 0.55));
    bloom.addColorStop(1, rgba(255, 236, 176, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, (yLanternTop + railTop) / 2, W * 0.20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(cx - hwLanternBot, railTop);
    ctx.lineTo(cx - hwLanternTop, yLanternTop);
    ctx.lineTo(cx + hwLanternTop, yLanternTop);
    ctx.lineTo(cx + hwLanternBot, railTop);
    ctx.stroke();
    ctx.restore();

    /* --- dome roof + finial ------------------------------------------ */
    const yDome = yLanternTop;
    const domeH = H * 0.085;
    const hwDome = W * 0.098;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - hwDome, yDome);
    ctx.quadraticCurveTo(cx - hwDome * 0.98, yDome - domeH * 1.28, cx, yDome - domeH);
    ctx.quadraticCurveTo(cx + hwDome * 0.98, yDome - domeH * 1.28, cx + hwDome, yDome);
    ctx.closePath();
    const domeG = ctx.createLinearGradient(cx - hwDome, 0, cx + hwDome, 0);
    domeG.addColorStop(0, rgba(232, 128, 104));
    domeG.addColorStop(0.45, rgba(206, 96, 76));
    domeG.addColorStop(1, rgba(152, 66, 52));
    ctx.fillStyle = domeG;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Eave
    ctx.beginPath();
    ctx.moveTo(cx - hwDome, yDome);
    ctx.lineTo(cx + hwDome, yDome);
    ctx.strokeStyle = rgba(96, 62, 48, 0.85);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Finial: ball + spike
    ctx.beginPath();
    ctx.arc(cx, yDome - domeH - H * 0.012, W * 0.016, 0, Math.PI * 2);
    ctx.fillStyle = rgba(214, 176, 96);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, yDome - domeH - H * 0.026);
    ctx.lineTo(cx, yDome - domeH - H * 0.062);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    paperGrain(ctx, W, H, rand, 5);

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 🚢 Ship (statek) — cut-out silhouette                                */
/* ------------------------------------------------------------------ */

export function makeShipTexture(key = 'contact-ship') {
    if (cache.has(key)) return cache.get(key);

    const W = 1030;
    const H = 400;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const DECK = H * 0.60;       // mast step (hidden behind the hull)
    const KEEL = H * 0.925;
    const BOW_X = W * 0.955;
    const STERN_X = W * 0.045;

    const MAIN_X = W * 0.36;
    const FORE_X = W * 0.655;
    const MAIN_TOP = H * 0.075;
    const FORE_TOP = H * 0.135;

    /**
     * The sheer line (deck edge) as a quadratic, sagging amidships the way a
     * real sheer does. Sampling it instead of approximating keeps the hull
     * outline, the gunwale stripe, the deck line and the rail stanchions all on
     * exactly the same curve.
     */
    const sheer = (t) => {
        const u = 1 - t;
        return {
            x: u * u * STERN_X + 2 * t * u * (W * 0.5) + t * t * BOW_X,
            y: u * u * (H * 0.585) + 2 * t * u * (H * 0.628) + t * t * (H * 0.495),
        };
    };
    const sheerBackwards = (from, to, steps) => {
        for (let i = steps; i >= 0; i--) {
            const p = sheer(from + ((to - from) * i) / steps);
            ctx.lineTo(p.x, p.y);
        }
    };

    /* --- standing rigging, painted first so everything sits on top --- */
    ctx.save();
    ctx.strokeStyle = rgba(84, 66, 50, 0.45);
    ctx.lineWidth = 1.6;
    for (const [x0, y0, x1, y1] of [
        [MAIN_X, MAIN_TOP, W * 0.90, H * 0.575],
        [FORE_X, FORE_TOP, MAIN_X, MAIN_TOP + H * 0.02],
        [FORE_X, FORE_TOP, BOW_X, H * 0.51],
    ]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }
    ctx.restore();

    /* --- masts -------------------------------------------------------- */
    ctx.save();
    ctx.strokeStyle = rgba(108, 70, 38);
    ctx.lineWidth = 8;
    for (const [x, top] of [[MAIN_X, MAIN_TOP], [FORE_X, FORE_TOP]]) {
        ctx.beginPath();
        ctx.moveTo(x, DECK + H * 0.08);
        ctx.lineTo(x, top);
        ctx.stroke();
    }
    ctx.restore();

    /**
     * Square sail. The yard is dead straight — that is what makes it read as a
     * square sail instead of a bowl. Only the foot sags, and the luff/leech
     * bulge a hair outward.
     */
    const drawSquareSail = (cx, yTop, yBot, half, sag) => {
        const mid = (yTop + yBot) / 2;
        const bulge = half * 0.035;
        const path = () => {
            ctx.beginPath();
            ctx.moveTo(cx - half, yTop);
            ctx.lineTo(cx + half, yTop);
            ctx.quadraticCurveTo(cx + half + bulge, mid, cx + half * 0.98, yBot);
            ctx.quadraticCurveTo(cx, yBot + sag, cx - half * 0.98, yBot);
            ctx.quadraticCurveTo(cx - half - bulge, mid, cx - half, yTop);
            ctx.closePath();
        };

        path();
        const g = ctx.createLinearGradient(0, yTop, 0, yBot);
        g.addColorStop(0, rgba(250, 246, 236));
        g.addColorStop(0.6, rgba(240, 232, 215));
        g.addColorStop(1, rgba(218, 207, 184));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = rgba(92, 70, 52, 0.9);
        ctx.lineWidth = 3;
        ctx.stroke();

        // Cloth: two reef bands
        ctx.save();
        path();
        ctx.clip();
        ctx.strokeStyle = rgba(158, 140, 114, 0.38);
        ctx.lineWidth = 1.6;
        for (const t of [0.34, 0.68]) {
            const y = yTop + (yBot - yTop) * t;
            ctx.beginPath();
            ctx.moveTo(cx - half - bulge, y);
            ctx.lineTo(cx + half + bulge, y);
            ctx.stroke();
        }
        ctx.restore();

        // Yard, reaching a little past the sail on both sides
        ctx.beginPath();
        ctx.moveTo(cx - half - W * 0.012, yTop);
        ctx.lineTo(cx + half + W * 0.012, yTop);
        ctx.strokeStyle = rgba(108, 70, 38);
        ctx.lineWidth = 6.5;
        ctx.stroke();
    };

    drawSquareSail(MAIN_X, H * 0.155, H * 0.30, W * 0.115, 9);
    drawSquareSail(MAIN_X, H * 0.335, H * 0.48, W * 0.126, 11);
    drawSquareSail(FORE_X, H * 0.215, H * 0.345, W * 0.094, 8);
    drawSquareSail(FORE_X, H * 0.375, H * 0.50, W * 0.104, 9);

    /* --- masthead pennant --------------------------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(MAIN_X, H * 0.048);
    ctx.quadraticCurveTo(MAIN_X + W * 0.055, H * 0.062, MAIN_X + W * 0.040, H * 0.086);
    ctx.quadraticCurveTo(MAIN_X + W * 0.022, H * 0.072, MAIN_X, H * 0.086);
    ctx.closePath();
    ctx.fillStyle = rgba(214, 96, 78);
    ctx.fill();
    ctx.strokeStyle = rgba(122, 52, 42, 0.9);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    /* --- hull ---------------------------------------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(BOW_X, H * 0.495);                                        // stem head
    sheerBackwards(1, 0, 12);                                            // sheer, bow -> stern
    ctx.lineTo(STERN_X, H * 0.755);                                      // transom, near vertical
    ctx.quadraticCurveTo(W * 0.105, H * 0.90, W * 0.255, KEEL);          // run aft
    ctx.lineTo(W * 0.80, KEEL);                                          // keel
    ctx.quadraticCurveTo(W * 0.925, H * 0.90, BOW_X, H * 0.655);         // forefoot
    ctx.lineTo(BOW_X, H * 0.495);                                        // stem, near vertical
    ctx.closePath();

    const hullG = ctx.createLinearGradient(0, H * 0.495, 0, KEEL);
    hullG.addColorStop(0, rgba(216, 164, 102));
    hullG.addColorStop(0.42, rgba(186, 128, 68));
    hullG.addColorStop(1, rgba(122, 74, 36));
    ctx.fillStyle = hullG;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    ctx.save();
    ctx.clip();
    // Plank courses
    ctx.strokeStyle = rgba(94, 56, 26, 0.32);
    ctx.lineWidth = 1.7;
    for (let i = 1; i <= 4; i++) {
        const y = H * 0.495 + ((KEEL - H * 0.495) * i) / 5;
        ctx.beginPath();
        ctx.moveTo(W * 0.02, y + 5);
        ctx.quadraticCurveTo(W * 0.5, y + 13, W * 1.0, y - 2);
        ctx.stroke();
    }
    // Gunwale stripe, following the sheer
    ctx.beginPath();
    ctx.moveTo(STERN_X, H * 0.585);
    for (let i = 0; i <= 12; i++) {
        const p = sheer(i / 12);
        ctx.lineTo(p.x, p.y + H * 0.022);
    }
    ctx.strokeStyle = rgba(58, 76, 96, 0.68);
    ctx.lineWidth = 9;
    ctx.stroke();
    // Portholes
    for (const t of [0.30, 0.44, 0.58]) {
        const px = W * (0.11 + t * 0.72);
        const py = H * 0.775;
        ctx.beginPath();
        ctx.arc(px, py, W * 0.0115, 0, Math.PI * 2);
        ctx.fillStyle = rgba(52, 42, 36);
        ctx.fill();
        ctx.strokeStyle = rgba(216, 192, 142, 0.9);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }
    ctx.restore();

    // Deck line
    ctx.beginPath();
    ctx.moveTo(STERN_X, H * 0.585);
    sheerBackwards(0, 1, 12);
    ctx.strokeStyle = rgba(72, 48, 30, 0.8);
    ctx.lineWidth = 3.6;
    ctx.stroke();
    ctx.restore();

    /* --- bowsprit + rail stanchions ------------------------------------ */
    ctx.save();
    ctx.strokeStyle = rgba(108, 70, 38);
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(W * 0.90, H * 0.585);
    ctx.lineTo(W * 0.998, H * 0.415);
    ctx.stroke();

    // Stanchions sit on the sampled sheer, so they never float off the deck.
    const RAIL_T0 = 0.60;
    const RAIL_T1 = 0.92;
    const railTop = [];
    ctx.strokeStyle = rgba(92, 64, 40, 0.85);
    ctx.lineWidth = 3;
    for (let i = 0; i <= 5; i++) {
        const t = RAIL_T0 + ((RAIL_T1 - RAIL_T0) * i) / 5;
        const p = sheer(t);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y - H * 0.038);
        ctx.stroke();
        railTop.push([p.x, p.y - H * 0.038]);
    }
    ctx.beginPath();
    ctx.moveTo(railTop[0][0], railTop[0][1]);
    for (const [x, y] of railTop.slice(1)) ctx.lineTo(x, y);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.restore();

    paperGrain(ctx, W, H, rand, 5);

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 🛢️ Barrel (beczka) — sketch + painted pair                           */
/* ------------------------------------------------------------------ */

const BARREL_SKETCH = {
    stave: [240, 228, 206],
    staveAlt: [226, 212, 188],
    rim: [176, 168, 158],
    rimDark: [118, 112, 104],
    sign: [246, 236, 214],
    signEdge: [200, 180, 148],
    ink: INK,
    inkWidth: 5,
    hatch: 0.20,
};

const BARREL_PAINTED = {
    stave: [198, 142, 82],
    staveAlt: [176, 120, 62],
    rim: [126, 120, 112],
    rimDark: [66, 62, 58],
    sign: [228, 188, 124],
    signEdge: [162, 114, 58],
    ink: '#33220f',
    inkWidth: 5,
    hatch: 0.0,
};

/** Half-width of the barrel at normalised height t (0 = bottom, 1 = top). */
function barrelHalfWidth(t, W) {
    const belly = Math.sin(Math.PI * (0.12 + t * 0.76));
    return W * (0.208 + 0.098 * belly);
}

function barrelPath(ctx, cx, yBot, yTop, W) {
    const STEPS = 40;
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const y = yBot + (yTop - yBot) * t;
        const x = cx - barrelHalfWidth(t, W);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    for (let i = STEPS; i >= 0; i--) {
        const t = i / STEPS;
        const y = yBot + (yTop - yBot) * t;
        ctx.lineTo(cx + barrelHalfWidth(t, W), y);
    }
    ctx.closePath();
}

function drawBarrel(ctx, W, H, palette, rand, painted) {
    const cx = W * 0.5;
    const yBot = H * 0.955;
    const yTop = H * 0.335;
    const ink = palette.ink;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* --- sign plank on top ------------------------------------------- */
    const signY = H * 0.158;
    const signH = H * 0.168;
    const signX = W * 0.06;
    const signW = W * 0.88;

    ctx.save();
    ctx.translate(cx, signY + signH / 2);
    ctx.rotate(-0.03);
    ctx.translate(-cx, -(signY + signH / 2));

    // Board
    const sg = ctx.createLinearGradient(0, signY, 0, signY + signH);
    sg.addColorStop(0, rgba(palette.sign[0] + 10, palette.sign[1] + 10, palette.sign[2] + 10));
    sg.addColorStop(0.6, rgba(palette.sign[0], palette.sign[1], palette.sign[2]));
    sg.addColorStop(1, rgba(palette.sign[0] - 24, palette.sign[1] - 22, palette.sign[2] - 18));
    ctx.fillStyle = sg;
    sketchRectPath(ctx, signX, signY, signW, signH, 3.4, rand, 8);
    ctx.fill();

    // Grain along the board
    ctx.save();
    sketchRectPath(ctx, signX, signY, signW, signH, 3.4, rand, 8);
    ctx.clip();
    for (let i = 0; i < 18; i++) {
        const y = signY + rand() * signH;
        ctx.beginPath();
        ctx.moveTo(signX, y);
        for (let x = signX; x <= signX + signW; x += 22) {
            ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 1.6);
        }
        ctx.strokeStyle = rgba(palette.signEdge[0], palette.signEdge[1], palette.signEdge[2], 0.22 + rand() * 0.2);
        ctx.lineWidth = 0.8 + rand() * 1.4;
        ctx.stroke();
    }
    ctx.restore();

    inkSketchRect(ctx, signX, signY, signW, signH, {
        amp: 3.4, r: 8, color: ink, width: palette.inkWidth,
    }, rand);

    // Nails in the four corners
    for (const [nx, ny] of [
        [signX + 16, signY + 15],
        [signX + signW - 16, signY + 15],
        [signX + 16, signY + signH - 15],
        [signX + signW - 16, signY + signH - 15],
    ]) {
        ctx.beginPath();
        ctx.arc(nx, ny, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2], 0.85);
        ctx.fill();
    }
    ctx.restore();

    /* --- barrel body -------------------------------------------------- */
    ctx.save();
    barrelPath(ctx, cx, yBot, yTop, W);
    ctx.clip();

    // Staves, alternating tone
    const STAVES = 11;
    for (let i = 0; i < STAVES; i++) {
        const t0 = i / STAVES;
        const t1 = (i + 1) / STAVES;
        const x0 = cx - barrelHalfWidth(0.5, W) + barrelHalfWidth(0.5, W) * 2 * t0;
        const x1 = cx - barrelHalfWidth(0.5, W) + barrelHalfWidth(0.5, W) * 2 * t1;
        const base = i % 2 === 0 ? palette.stave : palette.staveAlt;

        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, rgba(base[0] + 14, base[1] + 12, base[2] + 10));
        g.addColorStop(0.5, rgba(base[0], base[1], base[2]));
        g.addColorStop(1, rgba(base[0] - 26, base[1] - 24, base[2] - 20));
        ctx.fillStyle = g;
        ctx.fillRect(x0, yTop - 4, x1 - x0 + 1, yBot - yTop + 8);

        // Stave seam
        ctx.beginPath();
        ctx.moveTo(x0, yTop - 4);
        ctx.lineTo(x0, yBot + 4);
        ctx.strokeStyle = rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2], painted ? 0.3 : 0.22);
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    // Vertical wood grain
    for (let i = 0; i < 60; i++) {
        const gx = cx - W * 0.36 + rand() * W * 0.72;
        const amp = 1.2 + rand() * 3;
        ctx.beginPath();
        ctx.moveTo(gx, yTop);
        for (let y = yTop; y <= yBot; y += 12) {
            ctx.lineTo(gx + Math.sin(y * 0.05 + i) * amp, y);
        }
        ctx.strokeStyle = rand() > 0.5
            ? rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2], 0.10 + rand() * 0.12)
            : rgba(255, 246, 228, 0.10 + rand() * 0.12);
        ctx.lineWidth = 0.8 + rand() * 1.4;
        ctx.stroke();
    }

    // Hoops: three iron bands
    const hoopTs = [0.14, 0.5, 0.86];
    for (const t of hoopTs) {
        const y = yBot + (yTop - yBot) * t;
        const hw = barrelHalfWidth(t, W);
        const bandH = H * 0.036;

        const hg = ctx.createLinearGradient(0, y - bandH / 2, 0, y + bandH / 2);
        hg.addColorStop(0, rgba(palette.rim[0] + 40, palette.rim[1] + 40, palette.rim[2] + 40));
        hg.addColorStop(0.35, rgba(palette.rim[0], palette.rim[1], palette.rim[2]));
        hg.addColorStop(1, rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2]));
        ctx.fillStyle = hg;
        ctx.fillRect(cx - hw - 2, y - bandH / 2, hw * 2 + 4, bandH);

        ctx.beginPath();
        ctx.moveTo(cx - hw - 2, y - bandH / 2);
        ctx.lineTo(cx + hw + 2, y - bandH / 2);
        ctx.moveTo(cx - hw - 2, y + bandH / 2);
        ctx.lineTo(cx + hw + 2, y + bandH / 2);
        ctx.strokeStyle = rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2], 0.75);
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Bunghole
    ctx.beginPath();
    ctx.arc(cx - W * 0.10, yBot + (yTop - yBot) * 0.5, W * 0.033, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.rimDark[0], palette.rimDark[1], palette.rimDark[2], 0.85);
    ctx.fill();
    ctx.strokeStyle = rgba(palette.rim[0], palette.rim[1], palette.rim[2], 0.9);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Shadow down the right flank so the barrel reads round
    const round = ctx.createLinearGradient(cx - W * 0.36, 0, cx + W * 0.36, 0);
    round.addColorStop(0, rgba(255, 250, 240, 0.22));
    round.addColorStop(0.35, rgba(0, 0, 0, 0));
    round.addColorStop(0.72, rgba(0, 0, 0, 0.06));
    round.addColorStop(1, rgba(0, 0, 0, 0.30));
    ctx.fillStyle = round;
    ctx.fillRect(0, yTop - 6, W, yBot - yTop + 12);

    // Sketch variant: light hatching on the shadow side
    if (palette.hatch > 0) {
        ctx.strokeStyle = rgba(60, 50, 44, palette.hatch);
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 26; i++) {
            const x = cx + W * (0.16 + rand() * 0.22);
            const y = yTop + rand() * (yBot - yTop);
            const len = 14 + rand() * 34;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 10, y + len);
            ctx.stroke();
        }
    }
    ctx.restore();

    // Body outline, doubled
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = palette.inkWidth;
    barrelPath(ctx, cx, yBot, yTop, W);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = palette.inkWidth * 0.66;
    ctx.translate(1.6, 0);
    barrelPath(ctx, cx, yBot, yTop, W);
    ctx.stroke();
    ctx.restore();

    // Top rim: a full ellipse, because we are looking slightly down into it.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, yTop, barrelHalfWidth(1, W), H * 0.022, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.rim[0] - 20, palette.rim[1] - 20, palette.rim[2] - 20, 0.5);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = palette.inkWidth * 0.8;
    ctx.stroke();

    // Bottom: only the bulge BELOW the body, so the barrel sits on a curve
    // instead of on a disc sticking out past its own outline.
    ctx.beginPath();
    ctx.ellipse(cx, yBot, barrelHalfWidth(0, W), H * 0.016, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = rgba(palette.rim[0] - 20, palette.rim[1] - 20, palette.rim[2] - 20, 0.5);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = palette.inkWidth * 0.8;
    ctx.stroke();
    ctx.restore();
}

export function makeBarrelSketchTexture(key = 'contact-barrel-sketch') {
    if (cache.has(key)) return cache.get(key);
    const W = 636;
    const H = 690;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    drawBarrel(ctx, W, H, BARREL_SKETCH, rand, false);
    paperGrain(ctx, W, H, rand, 5);
    return toTexture(canvas, key);
}

export function makeBarrelPaintedTexture(key = 'contact-barrel-painted') {
    if (cache.has(key)) return cache.get(key);
    const W = 636;
    const H = 690;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    drawBarrel(ctx, W, H, BARREL_PAINTED, rand, true);
    paperGrain(ctx, W, H, rand, 5);
    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 📜 Contact sheet (paper_form)                                        */
/* ------------------------------------------------------------------ */

/**
 * Field geometry is NOT arbitrary — it is pinned to the Text meshes in
 * MessagePaper.jsx. Each field's world Z maps to a canvas row like this:
 *
 *   v = (z_local + PAPER_HEIGHT/2) / PAPER_HEIGHT   with  z_local = -z_group
 *   canvasY = (1 - v) * H
 *
 *   email   z = -0.61 -> canvasY = 0.141 H
 *   subject z = -0.46 -> canvasY = 0.229 H
 *   message z = -0.30 -> canvasY = 0.324 H (anchorY="top", 10 lines)
 *   send    z = +0.68 -> canvasY = 0.900 H (its own mesh)
 *
 * So the labels and rules below are placed around those rows, not eyeballed.
 */
export function makePaperFormTexture(key = 'contact-paper-form') {
    if (cache.has(key)) return cache.get(key);

    const W = 755;
    const H = 850;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    /* --- the sheet itself -------------------------------------------- */
    const m = 9;
    ctx.save();
    tornRectPath(ctx, m, m, W - m * 2, H - m * 2, rand, 7, 30);
    const sheet = ctx.createLinearGradient(0, 0, 0, H);
    sheet.addColorStop(0, rgba(252, 248, 238));
    sheet.addColorStop(0.55, rgba(246, 240, 226));
    sheet.addColorStop(1, rgba(236, 228, 210));
    ctx.fillStyle = sheet;
    ctx.fill();

    // Inner vignette so the sheet reads as paper, not a flat fill
    ctx.save();
    tornRectPath(ctx, m, m, W - m * 2, H - m * 2, mulberry32(hashString(key + '-clip')), 7, 30);
    ctx.clip();
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H * 0.78);
    vig.addColorStop(0, rgba(255, 255, 255, 0.35));
    vig.addColorStop(1, rgba(196, 182, 156, 0.30));
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // Fibres
    ctx.strokeStyle = rgba(198, 186, 164, 0.22);
    ctx.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const a = rand() * Math.PI;
        const len = 5 + rand() * 22;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    /* --- header ------------------------------------------------------- */
    ctx.save();
    ctx.fillStyle = rgba(58, 48, 40);
    ctx.font = `700 30px ${SERIF}`;
    ctx.textBaseline = 'alphabetic';
    drawTracked(ctx, 'MESSAGE IN A BOTTLE', W / 2, H * 0.058, 3.4, 'center');

    ctx.font = `400 15px ${SANS}`;
    ctx.fillStyle = rgba(120, 108, 94);
    drawTracked(ctx, 'DROP A NOTE — IT WILL FIND ITS WAY', W / 2, H * 0.084, 2.2, 'center');

    // Rule under the header
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.098);
    ctx.lineTo(W * 0.92, H * 0.098);
    ctx.strokeStyle = rgba(120, 104, 84, 0.5);
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Tiny bottle doodle, right of the title block
    const bx = W * 0.905;
    const by = H * 0.055;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(0.28);
    ctx.beginPath();
    ctx.moveTo(-7, -20);
    ctx.lineTo(7, -20);
    ctx.lineTo(7, -12);
    ctx.quadraticCurveTo(17, -6, 17, 8);
    ctx.lineTo(17, 20);
    ctx.quadraticCurveTo(17, 26, 10, 26);
    ctx.lineTo(-10, 26);
    ctx.quadraticCurveTo(-17, 26, -17, 20);
    ctx.lineTo(-17, 8);
    ctx.quadraticCurveTo(-17, -6, -7, -12);
    ctx.closePath();
    ctx.strokeStyle = rgba(72, 88, 104, 0.75);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(6, -20);
    ctx.strokeStyle = rgba(150, 110, 70, 0.85);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, 6);
    ctx.quadraticCurveTo(0, 12, 10, 6);
    ctx.strokeStyle = rgba(150, 178, 200, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    /* --- field labels + rules ---------------------------------------- */
    const field = (label, canvasY, ruleY) => {
        ctx.save();
        ctx.fillStyle = rgba(126, 112, 96);
        ctx.font = `700 17px ${SANS}`;
        drawTracked(ctx, label, W * 0.062, canvasY, 2.0, 'left');

        ctx.beginPath();
        ctx.moveTo(W * 0.062, ruleY);
        ctx.lineTo(W * 0.938, ruleY);
        ctx.strokeStyle = rgba(150, 134, 112, 0.55);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
    };

    field('EMAIL', H * 0.118, H * 0.170);
    field('SUBJECT', H * 0.206, H * 0.258);

    // MESSAGE — label plus a faint ruled block that matches the 10 line slots
    ctx.save();
    ctx.fillStyle = rgba(126, 112, 96);
    ctx.font = `700 17px ${SANS}`;
    drawTracked(ctx, 'MESSAGE', W * 0.062, H * 0.298, 2.0, 'left');

    const lineTop = H * 0.324;
    const lineStep = H * 0.0357;   // 0.045 fontSize * 1.35 lineHeight / 1.7
    for (let i = 1; i <= 10; i++) {
        const y = lineTop + lineStep * i;
        ctx.beginPath();
        ctx.moveTo(W * 0.062, y);
        ctx.lineTo(W * 0.938, y);
        ctx.strokeStyle = rgba(160, 146, 126, 0.20);
        ctx.lineWidth = 1.1;
        ctx.stroke();
    }
    // Left margin rule
    ctx.beginPath();
    ctx.moveTo(W * 0.062, H * 0.312);
    ctx.lineTo(W * 0.062, lineTop + lineStep * 10 + 6);
    ctx.strokeStyle = rgba(178, 146, 128, 0.35);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    /* --- divider above the send plate -------------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.858);
    ctx.lineTo(W * 0.92, H * 0.858);
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = rgba(150, 134, 112, 0.45);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    paperGrain(ctx, W, H, rand, 6);

    return toTexture(canvas, key);
}

/* ------------------------------------------------------------------ */
/* 🔘 Send plate (send_button)                                          */
/* ------------------------------------------------------------------ */

export function makeSendButtonTexture(key = 'contact-send-button') {
    if (cache.has(key)) return cache.get(key);

    const W = 500;
    const H = 130;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const m = 7;
    const x = m;
    const y = m;
    const w = W - m * 2;
    const h = H - m * 2;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Plate
    sketchRectPath(ctx, x, y, w, h, 2.6, rand, 16);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(250, 236, 206));
    g.addColorStop(0.45, rgba(240, 220, 180));
    g.addColorStop(1, rgba(214, 188, 142));
    ctx.fillStyle = g;
    ctx.fill();

    // Inner top highlight
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 9);
    ctx.lineTo(x + w - 14, y + 9);
    ctx.strokeStyle = rgba(255, 252, 240, 0.85);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Doubled ink outline
    inkSketchRect(ctx, x, y, w, h, { amp: 2.6, r: 16, color: INK, width: 4.4 }, rand);

    // A couple of pencil ticks in the corners so it reads hand-made
    ctx.strokeStyle = rgba(70, 58, 46, 0.45);
    ctx.lineWidth = 1.6;
    for (const [tx, ty] of [[x + 26, y + h - 12], [x + w - 26, y + 12]]) {
        ctx.beginPath();
        ctx.moveTo(tx - 8, ty);
        ctx.lineTo(tx + 8, ty);
        ctx.stroke();
    }
    ctx.restore();

    paperGrain(ctx, W, H, rand, 5);

    return toTexture(canvas, key);
}
