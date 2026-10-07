/**
 * Procedural art for the Gallery room (zero image assets).
 *
 * The room used to ship seven webp files — a village of terracotta roofs, a
 * city skyline, a pencil balustrade, a pixel bird, a clothespin, and the two
 * sides of the hanging cards. Together they were 0.85 MB, the largest raster
 * cluster left in the project after the entrance, corridor and clouds were
 * converted. They are drawn here instead, on an offscreen canvas, and wrapped
 * in a THREE.CanvasTexture — which means:
 *
 *   - nothing is downloaded on a cold start,
 *   - each surface is authored at ITS PLANE'S aspect ratio, so nothing is
 *     stretched the way the old bitmaps were (the railing tile was 2.0 on a
 *     2.286 plane, the bird was square on a 1.4 plane, the card back was 0.5
 *     on a 0.75 plane),
 *   - and the gallery's `onBeforeCompile` paint-reveal patch keeps working
 *     untouched, because a CanvasTexture is just a texture.
 *
 * Textures are cached per key, so these are safe to call from a render body.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32, rgba } from '../engine/art';

const cache = new Map();

function toTexture(canvas, { wrap = false, repeat = [1, 1] } = {}) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (wrap) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.needsUpdate = true;
    return texture;
}

/** '#rrggbb' -> [r,g,b] */
function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear blend between two '#rrggbb' colours. */
function mixHex(a, b, t) {
    const A = hex(a), B = hex(b);
    return '#' + [0, 1, 2]
        .map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0'))
        .join('');
}

/** A pale wash of one colour over the whole canvas, for paper tooth. */
function paperTooth(ctx, w, h, rand, tint = 'rgba(120,110,95,0.030)') {
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < Math.round((w * h) / 900); i++) {
        const x = rand() * w;
        const y = rand() * h;
        ctx.fillStyle = rand() > 0.55 ? tint : 'rgba(255,255,255,0.45)';
        ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();
}

/** A hand-drawn line: a straight segment with a small wobble. */
function wobblyLine(ctx, x0, y0, x1, y1, rand, amp = 1.2) {
    const seg = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 26));
    ctx.beginPath();
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const jx = i === 0 || i === seg ? 0 : (rand() - 0.5) * amp * 2;
        const jy = i === 0 || i === seg ? 0 : (rand() - 0.5) * amp * 2;
        const x = x0 + (x1 - x0) * t + jx;
        const y = y0 + (y1 - y0) * t + jy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

/** Stroke a closed rect path, optionally with the wobble of a pencil. */
function pencilRect(ctx, x, y, w, h, rand, amp = 1.0) {
    wobblyLine(ctx, x, y, x + w, y, rand, amp);
    wobblyLine(ctx, x + w, y, x + w, y + h, rand, amp);
    wobblyLine(ctx, x + w, y + h, x, y + h, rand, amp);
    wobblyLine(ctx, x, y + h, x, y, rand, amp);
}

/* ------------------------------------------------------------------ */
/* 1. Balustrade — the gallery's railing                                */
/* ------------------------------------------------------------------ */

/**
 * Turned balusters between two rails, drawn as a pencil sketch on
 * transparent ground.
 *
 * The mesh is 20 world units wide and RAILING_HEIGHT (1.25) tall with
 * `repeat.set(7, 1)`, so ONE tile is 2.857 × 1.25 — aspect 2.286. The old
 * bitmap was 1228 × 614 (aspect 2.0) and therefore squashed every baluster
 * by 14 %. This canvas is authored at the tile's real ratio.
 */
export function makeRailingTexture() {
    const key = 'gallery-railing';
    if (cache.has(key)) return cache.get(key);

    const W = 1024;
    const H = 448;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const INK = 'rgba(120,120,118,0.92)';
    const INK_FAINT = 'rgba(120,120,118,0.42)';
    const FILL = '#f5f4f1';

    // Rails: a plank centred on TOP / BOT with thickness RAIL_H.
    const TOP = 36;
    const BOT = 398;
    const RAIL_H = 30;

    // Half-width profile of one turned baluster, sampled ridge-to-foot.
    // A bulge high up, a narrow waist, then a swelling that settles into a
    // square foot block — the ordinary vocabulary of a turned post.
    const PROFILE = [
        [0.00, 15], [0.04, 15], [0.07, 9], [0.13, 8],
        [0.20, 15], [0.30, 19], [0.40, 17], [0.49, 11],
        [0.57, 8], [0.65, 11], [0.73, 15], [0.81, 13],
        [0.87, 9], [0.92, 14], [1.00, 14],
    ];
    const halfAt = (t) => {
        for (let i = 1; i < PROFILE.length; i++) {
            if (t <= PROFILE[i][0]) {
                const [t0, w0] = PROFILE[i - 1];
                const [t1, w1] = PROFILE[i];
                const k = (t - t0) / (t1 - t0 || 1);
                // smoothstep between the two knots so the profile is a curve
                const s = k * k * (3 - 2 * k);
                return w0 + (w1 - w0) * s;
            }
        }
        return PROFILE[PROFILE.length - 1][1];
    };

    const yTop = TOP + RAIL_H / 2;
    const yBot = BOT - RAIL_H / 2;
    const body = yBot - yTop;

    // --- balusters (drawn first, the rails overlap their ends) ---------
    const COUNT = 14;
    const step = W / COUNT;
    for (let i = 0; i < COUNT; i++) {
        const cx = (i + 0.5) * step;
        const STEPS = 64;

        ctx.beginPath();
        for (let s = 0; s <= STEPS; s++) {
            const t = s / STEPS;
            const y = yTop + t * body;
            const x = cx + halfAt(t);
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        for (let s = STEPS; s >= 0; s--) {
            const t = s / STEPS;
            const y = yTop + t * body;
            ctx.lineTo(cx - halfAt(t), y);
        }
        ctx.closePath();

        const g = ctx.createLinearGradient(cx - 20, 0, cx + 20, 0);
        g.addColorStop(0, '#e9e7e2');
        g.addColorStop(0.42, FILL);
        g.addColorStop(1, '#ecebe6');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // a pencil highlight down the lit side, and a soft core shadow
        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let s = 0; s <= STEPS; s++) {
            const t = s / STEPS;
            const y = yTop + t * body;
            const x = cx - halfAt(t) * 0.34;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // the neck ring and the foot ring
        for (const t of [0.055, 0.115, 0.90]) {
            const y = yTop + t * body;
            const hw = halfAt(t);
            ctx.beginPath();
            ctx.moveTo(cx - hw, y);
            ctx.lineTo(cx + hw, y);
            ctx.stroke();
        }
    }

    // --- rails ---------------------------------------------------------
    const rail = (cy, thick, lines) => {
        const y = cy - thick / 2;
        const g = ctx.createLinearGradient(0, y, 0, y + thick);
        g.addColorStop(0, '#eceae5');
        g.addColorStop(0.35, FILL);
        g.addColorStop(1, '#e7e5e0');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, W, thick);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6;
        wobblyLine(ctx, 0, y, W, y, rand, 0.9);
        wobblyLine(ctx, 0, y + thick, W, y + thick, rand, 0.9);
        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 1.1;
        for (const l of lines) wobblyLine(ctx, 0, y + l, W, y + l, rand, 0.8);
    };
    rail(TOP, RAIL_H, [9, 20]);
    rail(BOT, RAIL_H, [9, 20]);

    // --- the apron below the bottom rail --------------------------------
    // Short posts dropping off the underside, as in the reference.
    const APRON_Y = BOT + RAIL_H / 2;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
        const x = 70 + i * (W - 140) / 4;
        ctx.fillStyle = '#eeede9';
        ctx.fillRect(x - 13, APRON_Y, 26, H - APRON_Y);
        ctx.strokeRect(x - 13, APRON_Y, 26, H - APRON_Y);
    }

    // --- a shadow the top rail casts on the balusters --------------------
    const shadow = ctx.createLinearGradient(0, yTop, 0, yTop + 26);
    shadow.addColorStop(0, 'rgba(90,88,82,0.16)');
    shadow.addColorStop(1, 'rgba(90,88,82,0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, yTop, W, 26);

    const texture = toTexture(canvas, { wrap: true, repeat: [7, 1] });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 2. The village of terracotta roofs                                   */
/* ------------------------------------------------------------------ */

/**
 * A sea of tiled roofs seen from a high angle, with bushes in the gaps.
 *
 * The mesh is 15 × 15/2.357 world units (aspect 2.357) and the old bitmap was
 * 1290 × 645 (aspect 2.0), so it was stretched 18 % wide. This canvas matches
 * the plane.
 */
export function makeHousesTexture() {
    const key = 'gallery-houses';
    if (cache.has(key)) return cache.get(key);

    const W = 1536;
    const H = 652;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const ROOFS = ['#c9642f', '#d5733a', '#bd5a2b', '#dd8347', '#c05f31', '#cf6c34'];
    const RIDGE = '#8f4322';
    const WALLS = ['#f0e4cf', '#e8dac0', '#f3ead8', '#e2d3b6'];
    const BUSH = ['#7d9f54', '#6b8f46', '#89a95e', '#5f8340'];

    /** One roof slab: a trapezoid whose ridge is narrower than its eaves. */
    const roof = (cx, top, w, h, fill) => {
        const wTop = w * 0.74;
        const yBot = top + h;

        ctx.beginPath();
        ctx.moveTo(cx - wTop / 2, top);
        ctx.lineTo(cx + wTop / 2, top);
        ctx.lineTo(cx + w / 2, yBot);
        ctx.lineTo(cx - w / 2, yBot);
        ctx.closePath();

        const g = ctx.createLinearGradient(0, top, 0, yBot);
        g.addColorStop(0, mixHex(fill, '#ffffff', 0.22));
        g.addColorStop(0.55, fill);
        g.addColorStop(1, mixHex(fill, '#5a2a12', 0.24));
        ctx.fillStyle = g;
        ctx.fill();

        // Tile ribs: lines converging on the ridge, so the slope reads as
        // pan-tiles rather than a flat parallelogram.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(120,52,22,0.30)';
        ctx.lineWidth = 1.4;
        const ribs = Math.max(4, Math.round(w / 13));
        for (let i = 1; i < ribs; i++) {
            const t = i / ribs;
            ctx.beginPath();
            ctx.moveTo(cx - wTop / 2 + wTop * t, top);
            ctx.lineTo(cx - w / 2 + w * t, yBot);
            ctx.stroke();
        }
        // Two courses of tiles across the slope.
        ctx.strokeStyle = 'rgba(120,52,22,0.18)';
        for (let i = 1; i < 3; i++) {
            const t = i / 3;
            const y = top + h * t;
            const half = (wTop / 2) + ((w / 2) - (wTop / 2)) * t;
            ctx.beginPath();
            ctx.moveTo(cx - half, y);
            ctx.lineTo(cx + half, y);
            ctx.stroke();
        }
        ctx.restore();

        // Every slab is outlined, otherwise neighbouring roofs of similar
        // tone melt into one orange band and the field loses its structure.
        ctx.strokeStyle = 'rgba(122,54,22,0.62)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - wTop / 2, top);
        ctx.lineTo(cx + wTop / 2, top);
        ctx.lineTo(cx + w / 2, yBot);
        ctx.lineTo(cx - w / 2, yBot);
        ctx.closePath();
        ctx.stroke();

        // Ridge cap and eave shadow.
        ctx.strokeStyle = RIDGE;
        ctx.lineWidth = 3.0;
        ctx.beginPath();
        ctx.moveTo(cx - wTop / 2, top);
        ctx.lineTo(cx + wTop / 2, top);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(90,40,16,0.55)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, yBot);
        ctx.lineTo(cx + w / 2, yBot);
        ctx.stroke();
    };

    /** A chimney poking above a ridge. */
    const chimney = (x, top, w, h) => {
        ctx.fillStyle = '#d9c8ab';
        ctx.fillRect(x, top, w, h);
        ctx.strokeStyle = 'rgba(110,80,54,0.75)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x, top, w, h);
        ctx.fillStyle = '#b8a184';
        ctx.fillRect(x - 2, top, w + 4, 5);
    };

    /** A clump of bushes — three or four overlapping blobs. */
    const bush = (cx, cy, r) => {
        for (let i = 0; i < 4; i++) {
            const bx = cx + (rand() - 0.5) * r * 1.5;
            const by = cy + (rand() - 0.5) * r * 0.7;
            const br = r * (0.5 + rand() * 0.5);
            ctx.fillStyle = BUSH[Math.floor(rand() * BUSH.length)];
            ctx.beginPath();
            ctx.ellipse(bx, by, br, br * 0.78, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    // Four rows, back to front, so nearer roofs overlap the ones behind.
    // `count × width` deliberately exceeds the canvas width in every row, so
    // neighbours overlap and the field reads as a dense village rather than
    // as stripes of houses with sky between them.
    const ROWS = [
        { top: 40, h: 104, w: 196, count: 13 },
        { top: 152, h: 132, w: 244, count: 10 },
        { top: 300, h: 158, w: 300, count: 7 },
        { top: 470, h: 122, w: 372, count: 5 },
    ];
    const FRONT = ROWS.length - 1;

    ROWS.forEach((row, ri) => {
        const step = W / row.count;
        for (let i = 0; i < row.count; i++) {
            const cx = (i + 0.5) * step + (rand() - 0.5) * step * 0.22;
            const jitter = (rand() - 0.5) * 68;
            const top = row.top + jitter;
            const w = row.w * (0.82 + rand() * 0.4);
            const h = row.h * (0.85 + rand() * 0.35);
            roof(cx, top, w, h, ROOFS[Math.floor(rand() * ROOFS.length)]);

            // A strip of wall under the eaves — only the front row shows much.
            const wallH = ri === FRONT ? 74 : 26;
            const wy = top + h;
            ctx.fillStyle = WALLS[Math.floor(rand() * WALLS.length)];
            ctx.fillRect(cx - w / 2, wy, w, wallH);
            ctx.strokeStyle = 'rgba(120,92,64,0.45)';
            ctx.lineWidth = 1.3;
            ctx.strokeRect(cx - w / 2, wy, w, wallH);

            // Windows on the front row's walls.
            if (ri === FRONT) {
                const wins = Math.max(2, Math.round(w / 58));
                for (let k = 0; k < wins; k++) {
                    const wx = cx - w / 2 + (k + 0.5) * (w / wins) - 11;
                    ctx.fillStyle = 'rgba(126,104,80,0.55)';
                    ctx.fillRect(wx, wy + 16, 22, 26);
                }
            }

            // Chimneys and roof vents, sparse.
            if (rand() > 0.55) chimney(cx + (rand() - 0.5) * w * 0.5, top - 30 - rand() * 26, 20, 44);
            if (rand() > 0.72) {
                ctx.fillStyle = '#cfc3ad';
                ctx.beginPath();
                ctx.ellipse(cx + (rand() - 0.5) * w * 0.4, top + h * 0.3, 15, 9, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(110,80,54,0.6)';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            // Bushes crowding the gaps between houses.
            if (rand() > 0.35) {
                bush(cx + (rand() > 0.5 ? 1 : -1) * w * 0.5, top + h * 0.55, 34 + rand() * 26);
            }
        }
    });

    // A band of bushes and grass along the very bottom edge.
    for (let i = 0; i < 26; i++) {
        bush(rand() * W, H - 22 - rand() * 30, 26 + rand() * 30);
    }

    paperTooth(ctx, W, H, rand, 'rgba(150,110,80,0.035)');

    const texture = toTexture(canvas);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 3. City skyline                                                      */
/* ------------------------------------------------------------------ */

/**
 * A skyline standing on a flat baseline, with TV masts and a row of trees at
 * its foot. Same plane and same stretch story as the village above.
 */
export function makeCityTexture() {
    const key = 'gallery-city';
    if (cache.has(key)) return cache.get(key);

    const W = 1536;
    const H = 652;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const WALLS = ['#efe3ce', '#e6d8be', '#dcd3c4', '#cfd8dc', '#e9dcc4', '#f2ead9', '#d8e0e0'];
    const GROUND = 596;      // where the buildings meet the ground

    // --- the blocks ----------------------------------------------------
    let x = -20;
    while (x < W + 20) {
        const w = 44 + rand() * 78;
        const tall = rand();
        // Most blocks are mid-rise, a few are tall. The two landmarks are
        // drawn separately below and must stay clear of the pack, so the
        // procedural ceiling is kept well under them.
        let h = 70 + rand() * 140;
        if (tall > 0.90) h = 220 + rand() * 90;
        const top = GROUND - h;
        const fill = WALLS[Math.floor(rand() * WALLS.length)];

        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, mixHex(fill, '#ffffff', 0.18));
        g.addColorStop(0.6, fill);
        g.addColorStop(1, mixHex(fill, '#5b6b70', 0.16));
        ctx.fillStyle = g;
        ctx.fillRect(x, top, w, h);
        ctx.strokeStyle = 'rgba(96,88,76,0.55)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x, top, w, h);

        // Cornice / parapet.
        ctx.fillStyle = mixHex(fill, '#6b6255', 0.22);
        ctx.fillRect(x - 3, top - 7, w + 6, 7);

        // Window grid, thinned out toward the top so the block has a base.
        const cols = Math.max(2, Math.round(w / 22));
        const rows = Math.max(2, Math.round(h / 26));
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                if (rand() > 0.82) continue;
                const wx = x + (c + 0.5) * (w / cols) - 5;
                const wy = top + 16 + r * ((h - 24) / rows);
                if (wy > GROUND - 10) continue;
                ctx.fillStyle = rand() > 0.3
                    ? 'rgba(104,112,116,0.58)'
                    : 'rgba(176,150,108,0.52)';
                ctx.fillRect(wx, wy, 8, 11);
            }
        }

        // A TV mast on some roofs — a thin pole with two crossbars.
        if (rand() > 0.62 && h < 300) {
            const mx = x + w * (0.3 + rand() * 0.4);
            const mh = 34 + rand() * 40;
            ctx.strokeStyle = 'rgba(78,78,74,0.85)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(mx, top - 7);
            ctx.lineTo(mx, top - 7 - mh);
            ctx.stroke();
            for (const f of [0.42, 0.68]) {
                const y = top - 7 - mh * f;
                ctx.beginPath();
                ctx.moveTo(mx - 11, y);
                ctx.lineTo(mx + 11, y);
                ctx.stroke();
            }
        }

        x += w + 3 + rand() * 7;
    }

    // --- two landmark towers -------------------------------------------
    const tower = (cx, w, h, fill) => {
        const top = GROUND - h;
        const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
        g.addColorStop(0, mixHex(fill, '#ffffff', 0.24));
        g.addColorStop(0.55, fill);
        g.addColorStop(1, mixHex(fill, '#4d5f66', 0.22));
        ctx.fillStyle = g;
        ctx.fillRect(cx - w / 2, top, w, h);
        ctx.strokeStyle = 'rgba(88,96,98,0.6)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx - w / 2, top, w, h);

        const cols = Math.max(3, Math.round(w / 17));
        const rows = Math.max(6, Math.round(h / 21));
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const wx = cx - w / 2 + (c + 0.5) * (w / cols) - 4;
                const wy = top + 12 + r * ((h - 30) / rows);
                if (wy > GROUND - 8) continue;
                ctx.fillStyle = 'rgba(96,118,128,0.6)';
                ctx.fillRect(wx, wy, 8, 11);
            }
        }
        // A stepped crown, then a mast with two crossbars — the thing that
        // makes a landmark read as a landmark at this distance.
        ctx.fillStyle = mixHex(fill, '#ffffff', 0.3);
        ctx.fillRect(cx - w * 0.18, top - 18, w * 0.36, 18);
        ctx.strokeStyle = 'rgba(88,96,98,0.6)';
        ctx.lineWidth = 1.3;
        ctx.strokeRect(cx - w * 0.18, top - 18, w * 0.36, 18);

        ctx.strokeStyle = 'rgba(78,78,74,0.92)';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, top - 18);
        ctx.lineTo(cx, top - 96);
        ctx.stroke();
        ctx.lineWidth = 1.6;
        for (const f of [0.40, 0.68]) {
            const y = top - 18 - 78 * f;
            ctx.beginPath();
            ctx.moveTo(cx - 12, y);
            ctx.lineTo(cx + 12, y);
            ctx.stroke();
        }
    };
    tower(W * 0.235, 70, 452, '#cfd8dc');
    tower(W * 0.585, 58, 486, '#dbe2e2');

    // --- trees and the ground strip -------------------------------------
    for (let i = 0; i < 46; i++) {
        const tx = rand() * W;
        const r = 16 + rand() * 20;
        ctx.fillStyle = ['#6f9350', '#5f8340', '#7da35a'][Math.floor(rand() * 3)];
        ctx.beginPath();
        ctx.ellipse(tx, GROUND - 4 - rand() * 6, r, r * 0.86, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = '#e3ddcd';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = 'rgba(110,102,88,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    ctx.lineTo(W, GROUND);
    ctx.stroke();

    paperTooth(ctx, W, H, rand, 'rgba(120,120,110,0.030)');

    const texture = toTexture(canvas);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 4. The pixel bird                                                    */
/* ------------------------------------------------------------------ */

/**
 * A chunky bird in flight, drawn as pixel art and upscaled with smoothing
 * off, then given a watercolour fill.
 *
 * The mesh is a 1.5 × 1.5 plane scaled to BIRD_WIDTH (0.49) × BIRD_HEIGHT
 * (0.35), i.e. squashed to 1.4 : 1. The old texture was square, so the bird
 * was stretched 40 % wide. This canvas stays square — the scale does the
 * squashing — which is the shape the reference was drawn for.
 */
export function makeBirdTexture() {
    const key = 'gallery-bird';
    if (cache.has(key)) return cache.get(key);

    const OUT = 1024;
    const S = 64;                      // logical pixel grid, 1024 / 64 = 16
    const small = makeCanvas(S, S);
    const sc = small.getContext('2d');
    const rand = mulberry32(hashString(key));

    const BODY = [245, 236, 218];
    const BODY_SHADE = [222, 208, 182];
    const HEAD = [104, 126, 154];
    const WING = [122, 146, 174];
    const WING_LIGHT = [166, 190, 212];
    const BEAK = [240, 163, 60];
    const BEAK_DARK = [206, 124, 36];
    const EYE = [74, 54, 42];

    // Region tests, in paint order (later wins).
    const inEllipse = (x, y, cx, cy, rx, ry) => {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        return dx * dx + dy * dy <= 1;
    };
    const inCircle = (x, y, cx, cy, r) => inEllipse(x, y, cx, cy, r, r);

    for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
            // sample at the cell centre
            const x = px + 0.5;
            const y = py + 0.5;
            let c = null;

            // body
            if (inEllipse(x, y, 30, 38, 24, 20)) c = BODY;
            // tail wedge, lower-left
            if (x < 18 && y > 30 && y < 52 && (y - 30) > (18 - x) * -0.2 && (y - 30) < 22 + (18 - x) * 0.6) {
                c = WING;
            }
            // head
            if (inCircle(x, y, 38, 21, 17)) c = HEAD;
            // raised wing over the upper-left
            if (inEllipse(x, y, 17, 27, 17, 16)) c = WING;
            if (inEllipse(x, y, 20, 28, 12, 11)) c = WING_LIGHT;
            // the pale face
            if (inCircle(x, y, 43, 27, 14)) c = BODY;
            // eye
            if (x >= 41 && x <= 47 && y >= 17 && y <= 23) c = EYE;
            // beak — a wedge widening away from the face
            if (x >= 50 && x <= 63) {
                const spread = (x - 50) * 0.42;
                if (y >= 30 - spread && y <= 42 + spread * 0.2) c = BEAK;
                if (y >= 36 && y <= 38.5) c = BEAK_DARK;
            }

            if (!c) continue;

            // Watercolour: jitter each pixel a little so the flat regions
            // read as washes rather than fills.
            const j = (rand() - 0.5) * 22;
            const shade = y > 40 && c === BODY ? BODY_SHADE : c;
            sc.fillStyle = rgba(shade[0] + j, shade[1] + j, shade[2] + j, 1);
            sc.fillRect(px, py, 1, 1);
        }
    }

    // Upscale with smoothing off — hard pixel steps, exactly like the source.
    const canvas = makeCanvas(OUT, OUT);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, S, S, 0, 0, OUT, OUT);

    const texture = toTexture(canvas);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 5. The clothespin                                                    */
/* ------------------------------------------------------------------ */

/**
 * The wooden peg each card hangs from: line art only, on transparent ground.
 * The mesh is 0.3 × 0.2 (aspect 1.5); the old bitmap was 2.0, so it was
 * squashed 25 %. Authored here at 1.5.
 */
export function makeClothespinTexture() {
    const key = 'gallery-clothespin';
    if (cache.has(key)) return cache.get(key);

    const W = 384;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const INK = 'rgba(112,112,110,0.95)';
    const FILL = '#fbfaf7';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = INK;

    // The long jaw bar across the middle.
    const BAR_Y = 112;
    const BAR_H = 24;
    ctx.fillStyle = FILL;
    ctx.beginPath();
    ctx.moveTo(14, BAR_Y + 6);
    ctx.lineTo(W - 14, BAR_Y + 6);
    ctx.quadraticCurveTo(W - 6, BAR_Y + 6, W - 6, BAR_Y + BAR_H / 2 + 2);
    ctx.quadraticCurveTo(W - 6, BAR_Y + BAR_H - 2, W - 14, BAR_Y + BAR_H - 2);
    ctx.lineTo(14, BAR_Y + BAR_H - 2);
    ctx.quadraticCurveTo(6, BAR_Y + BAR_H - 2, 6, BAR_Y + BAR_H / 2 + 2);
    ctx.quadraticCurveTo(6, BAR_Y + 6, 14, BAR_Y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // The body block below. In the reference this is a narrow tapered block
    // about 40 % of the bar's width — a peg, not a bucket.
    const BW = 152;
    const BX = (W - BW) / 2;
    const BY = BAR_Y + BAR_H - 4;
    const BH = H - BY - 18;
    const TAPER = 9;
    ctx.fillStyle = FILL;
    ctx.beginPath();
    ctx.moveTo(BX, BY);
    ctx.lineTo(BX + BW, BY);
    ctx.lineTo(BX + BW - TAPER, BY + BH);
    ctx.lineTo(BX + TAPER, BY + BH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // The jaw split near the foot.
    ctx.beginPath();
    ctx.moveTo(BX + TAPER * 0.75, BY + BH - 26);
    ctx.lineTo(BX + BW - TAPER * 0.75, BY + BH - 26);
    ctx.stroke();

    // The spring: a thick coil arch standing on the bar. Drawn as a filled
    // annulus sector rather than two concentric strokes, so it reads as one
    // solid coil with a hole in it.
    const acx = W / 2;
    const acy = BAR_Y + 8;
    const R_OUT = 66;
    const R_IN = 44;
    ctx.beginPath();
    ctx.arc(acx, acy, R_OUT, Math.PI, 0, false);
    ctx.lineTo(acx + R_IN, acy);
    ctx.arc(acx, acy, R_IN, 0, Math.PI, true);
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.stroke();

    // The two little shoulders where the coil lands on the bar.
    for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(acx + s * R_OUT, acy);
        ctx.lineTo(acx + s * 78, acy);
        ctx.stroke();
    }

    paperTooth(ctx, W, H, rand, 'rgba(120,110,95,0.02)');

    const texture = toTexture(canvas);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* 6. The back of a hanging card                                        */
/* ------------------------------------------------------------------ */

/**
 * Two pencil frames ruled on a sheet of paper — the back of every hanging
 * card. The plane is 1.5 × 2 (aspect 0.75) and the old bitmaps were
 * 1024 × 2048 (aspect 0.5), so they were stretched 50 % wide. Authored here
 * at 0.75.
 *
 * `painted` picks the warm, hatched version the desktop path uses; the plain
 * pencil version is what touch devices get.
 */
export function makeCardBackTexture(painted = false) {
    const key = 'gallery-card-back-' + (painted ? 'painted' : 'sketch');
    if (cache.has(key)) return cache.get(key);

    const W = 768;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const INK = 'rgba(104,104,102,0.92)';
    const INK_FAINT = 'rgba(104,104,102,0.34)';
    const PAPER = painted ? '#f2e6cf' : '#fdfdfb';
    const PANEL = painted ? '#efe0c4' : '#fafaf7';

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    paperTooth(ctx, W, H, rand, painted ? 'rgba(150,110,60,0.05)' : 'rgba(120,110,95,0.035)');

    /**
     * A frame: an outer moulding of `band` px, a bevelled inner edge and a
     * recessed panel. `inner` is the list of openings cut into the panel.
     */
    const frame = (x, y, w, h, band) => {
        // Rough hatching inside the panel, when painted.
        if (painted) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + band, y + band, w - band * 2, h - band * 2);
            ctx.clip();
            ctx.strokeStyle = 'rgba(190,150,96,0.30)';
            ctx.lineWidth = 2;
            for (let i = -h; i < w; i += 9) {
                const jx = (rand() - 0.5) * 4;
                ctx.beginPath();
                ctx.moveTo(x + i + jx, y);
                ctx.lineTo(x + i + h * 0.55 + jx, y + h);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Moulding: a filled band with a light top-left and a dark
        // bottom-right, then the ruled lines that make it read as carved.
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, painted ? '#fdf4e2' : '#ffffff');
        g.addColorStop(0.5, PAPER);
        g.addColorStop(1, painted ? '#e2cda6' : '#eeeeea');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);

        ctx.fillStyle = PANEL;
        ctx.fillRect(x + band, y + band, w - band * 2, h - band * 2);

        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        pencilRect(ctx, x, y, w, h, rand, 1.1);
        ctx.lineWidth = 1.5;
        pencilRect(ctx, x + band, y + band, w - band * 2, h - band * 2, rand, 1.0);

        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 1.2;
        const bev = Math.max(5, band * 0.34);
        pencilRect(ctx, x + bev, y + bev, w - bev * 2, h - bev * 2, rand, 0.9);
        pencilRect(
            ctx,
            x + band - bev, y + band - bev,
            w - (band - bev) * 2, h - (band - bev) * 2,
            rand, 0.9
        );

        // A bright top-left / dark bottom-right on the bevel.
        ctx.strokeStyle = painted ? 'rgba(255,250,236,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + band - bev, y + h - band + bev);
        ctx.lineTo(x + band - bev, y + band - bev);
        ctx.lineTo(x + w - band + bev, y + band - bev);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120,104,80,0.28)';
        ctx.beginPath();
        ctx.moveTo(x + w - band + bev, y + band - bev);
        ctx.lineTo(x + w - band + bev, y + h - band + bev);
        ctx.lineTo(x + band - bev, y + h - band + bev);
        ctx.stroke();
    };

    // The big square frame up top.
    frame(38, 36, W - 76, 486, 24);

    // The wide landscape frame below.
    frame(38, 566, W - 76, 216, 20);

    // Four small frames sitting inside it.
    const iy = 620;
    const ih = 108;
    const iw = 108;
    const gap = (W - 76 - 40 - iw * 4) / 3;
    for (let i = 0; i < 4; i++) {
        const ix = 38 + 20 + i * (iw + gap);
        ctx.fillStyle = painted ? '#f6ead3' : '#ffffff';
        ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        pencilRect(ctx, ix, iy, iw, ih, rand, 0.9);
        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 1.1;
        pencilRect(ctx, ix + 7, iy + 7, iw - 14, ih - 14, rand, 0.8);
        if (painted) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(ix + 7, iy + 7, iw - 14, ih - 14);
            ctx.clip();
            ctx.strokeStyle = 'rgba(196,158,104,0.34)';
            ctx.lineWidth = 2;
            for (let k = -ih; k < iw; k += 8) {
                ctx.beginPath();
                ctx.moveTo(ix + k, iy);
                ctx.lineTo(ix + k + ih * 0.5, iy + ih);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    // A panel of hatching along the bottom edge, painted version only.
    if (painted) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(38, 806, W - 76, 172);
        ctx.clip();
        ctx.strokeStyle = 'rgba(196,158,104,0.28)';
        ctx.lineWidth = 2;
        for (let k = -172; k < W - 76; k += 9) {
            ctx.beginPath();
            ctx.moveTo(38 + k, 806);
            ctx.lineTo(38 + k + 96, 978);
            ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 1.4;
        pencilRect(ctx, 38, 806, W - 76, 172, rand, 1.0);
    }

    const texture = toTexture(canvas);
    cache.set(key, texture);
    return texture;
}
