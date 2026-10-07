/**
 * The crumpled-paper sheet the whole site is drawn on (zero image assets).
 *
 * `public/textures/paper-texture.webp` (1215 × 680, 20 KB) was the last
 * bitmap outside the gallery, and the most widely shared one: it is the
 * three.js scene background (App.jsx), and the surface behind the preloader,
 * the navigation UI, the achievements panel and the global overlay — four
 * SCSS files that referenced it with `url()`.
 *
 * It is generated here instead. One canvas serves both worlds:
 *
 *   - 3D gets a THREE.CanvasTexture (see `paperTexture()`),
 *   - CSS gets a data URL pushed into the `--paper-texture` custom property
 *     (see `installPaperVariables()`), which the four stylesheets read.
 *
 * The generator is deliberately cheap. The crease shading is computed on a
 * 192 × 192 field and then scaled up with the canvas' own bilinear filter —
 * the sheet is soft enough that no one can tell, and it costs a fortieth of
 * what a per-pixel pass at full size would.
 *
 * There is NO tiling requirement: every consumer either stretches the sheet
 * (`background-size: cover`, `scene.background`) or clamps it. So the noise
 * is free to be non-periodic.
 */

import * as THREE from 'three';

const SIZE = 768;          // output canvas, square
const FIELD = 192;         // crease field resolution before upscaling

let canvasCache = null;
let textureCache = null;

/* ------------------------------------------------------------------ */
/* Value noise                                                          */
/* ------------------------------------------------------------------ */

function hash2i(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ (seed | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash2i(ix, iy, seed);
    const b = hash2i(ix + 1, iy, seed);
    const c = hash2i(ix, iy + 1, seed);
    const d = hash2i(ix + 1, iy + 1, seed);
    const top = a + (b - a) * ux;
    const bot = c + (d - c) * ux;
    return top + (bot - top) * uy;
}

function fbm(x, y, seed, octaves = 4) {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        v += amp * valueNoise(x * f, y * f, seed + i * 1013);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return v / norm;
}

/**
 * A crease field: fbm run through `1 - |2n - 1|`, which turns the smooth
 * hills of the noise into sharp ridges — the folds of a crumpled sheet. Two
 * scales are stacked so a fine crumple rides on top of a coarse one.
 */
function crease(x, y, seed) {
    const coarse = 1 - Math.abs(2 * fbm(x * 2.6, y * 2.6, seed, 4) - 1);
    const fine = 1 - Math.abs(2 * fbm(x * 6.1, y * 6.1, seed + 4241, 3) - 1);
    return { coarse, fine };
}

/* ------------------------------------------------------------------ */
/* The sheet                                                            */
/* ------------------------------------------------------------------ */

function paperCanvas() {
    if (canvasCache) return canvasCache;

    // --- 1. the crease field, at FIELD resolution --------------------
    const field = document.createElement('canvas');
    field.width = FIELD;
    field.height = FIELD;
    const fc = field.getContext('2d');
    const img = fc.createImageData(FIELD, FIELD);
    const d = img.data;

    for (let j = 0; j < FIELD; j++) {
        for (let i = 0; i < FIELD; i++) {
            const u = i / FIELD;
            const v = j / FIELD;
            const { coarse, fine } = crease(u, v, 90210);

            // Folded paper is mostly flat with occasional creases, so the
            // ridged term is raised to a high power to keep the creases
            // narrow. The whole range is deliberately shallow: the reference
            // sheet lives between about 224 and 251 of 255, and anything
            // wider stops reading as paper and starts reading as fog.
            let shade = 1
                - 0.062 * Math.pow(coarse, 3.2)
                - 0.024 * Math.pow(fine, 2.4);

            // A slow, broad undulation underneath, plus a gentle corner
            // falloff so the sheet is not perfectly even.
            shade *= 0.978 + 0.030 * fbm(u * 1.7, v * 1.7, 555, 3);
            shade *= 1 - 0.012 * Math.hypot(u - 0.32, v - 0.30);

            const k = Math.max(0, Math.min(1, shade));
            const p = (j * FIELD + i) * 4;
            // Base tone #FCFCFA, kept very slightly warm.
            d[p] = Math.round(252 * k);
            d[p + 1] = Math.round(252 * k);
            d[p + 2] = Math.round(250 * k);
            d[p + 3] = 255;
        }
    }
    fc.putImageData(img, 0, 0);

    // --- 2. upscale it, letting the canvas interpolate ---------------
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(field, 0, 0, FIELD, FIELD, 0, 0, SIZE, SIZE);

    // --- 3. a handful of long fold lines -----------------------------
    // The noise alone reads as "mottled"; these straight-ish creases are
    // what make it read as "folded".
    // x0, y0, x1, y1, bow. The bow is a fraction of the chord pushed
    // sideways at the midpoint — without it the folds read as ruled lines.
    // Two roughly horizontal, two roughly vertical, one diagonal — the
    // creases of a sheet folded a couple of times. More than this and the
    // lines start crossing each other into a web, which reads as cracked
    // plaster rather than paper.
    const folds = [
        [0.02, 0.30, 1.01, 0.17, 0.14],
        [0.04, 0.75, 1.00, 0.63, -0.12],
        [0.40, -0.04, 0.24, 1.04, 0.18],
        [0.85, 0.02, 0.71, 1.02, -0.13],
        [0.19, 0.05, 0.79, 0.61, -0.10],
    ];

    // Each fold is built from three concentric strokes of decreasing width
    // and increasing darkness, which gives the soft-edged ridge of a real
    // crease. A single stroke at any width reads as a scratch.
    const GROOVE = [[30, 0.013], [17, 0.019], [8, 0.026]];
    const LIP = [[22, 0.045], [11, 0.062]];

    ctx.save();
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1, bow] of folds) {
        const ax = x0 * SIZE;
        const ay = y0 * SIZE;
        const bx = x1 * SIZE;
        const by = y1 * SIZE;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const mx = (ax + bx) / 2 + (-dy / len) * len * bow;
        const my = (ay + by) / 2 + (dx / len) * len * bow;

        // The lip sits perpendicular to the fold, so groove and highlight
        // are side by side rather than one burying the other.
        const nx = (-dy / len) * 6;
        const ny = (dx / len) * 6;

        for (const [w, a] of GROOVE) {
            ctx.strokeStyle = 'rgba(150,146,136,' + a + ')';
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(mx, my, bx, by);
            ctx.stroke();
        }
        for (const [w, a] of LIP) {
            ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(ax + nx, ay + ny);
            ctx.quadraticCurveTo(mx + nx, my + ny, bx + nx, by + ny);
            ctx.stroke();
        }
    }
    ctx.restore();

    // --- 4. fine grain ------------------------------------------------
    // A small tile repeated by the canvas pattern machinery — 16 k pixels of
    // work instead of 590 k.
    const T = 128;
    const tile = document.createElement('canvas');
    tile.width = T;
    tile.height = T;
    const tc = tile.getContext('2d');
    const timg = tc.createImageData(T, T);
    const td = timg.data;
    for (let j = 0; j < T; j++) {
        for (let i = 0; i < T; i++) {
            const n = hash2i(i + 1, j + 1, 7777);
            const p = (j * T + i) * 4;
            if (n > 0.5) {
                td[p] = 255; td[p + 1] = 255; td[p + 2] = 255;
                td[p + 3] = Math.round((n - 0.5) * 60);
            } else {
                td[p] = 132; td[p + 1] = 128; td[p + 2] = 118;
                td[p + 3] = Math.round((0.5 - n) * 52);
            }
        }
    }
    tc.putImageData(timg, 0, 0);

    ctx.save();
    ctx.globalAlpha = 0.34;
    const pattern = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    canvasCache = canvas;
    return canvas;
}

/* ------------------------------------------------------------------ */
/* Consumers                                                            */
/* ------------------------------------------------------------------ */

/**
 * The sheet as a three.js texture, for `scene.background` and any material
 * that wants it. Cached — safe to call from a render body.
 */
export function paperTexture() {
    if (textureCache) return textureCache;
    const texture = new THREE.CanvasTexture(paperCanvas());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    textureCache = texture;
    return texture;
}

/**
 * Publish the sheet to CSS as `--paper-texture`, which the four stylesheets
 * read instead of `url('/textures/paper-texture.webp')`.
 *
 * Deferred to the next frame on purpose: the preloader is the first thing on
 * screen and its paper is a near-white wash, so a one-frame delay is
 * invisible — whereas blocking first paint to fold a sheet of paper is not.
 */
export function installPaperVariables() {
    if (typeof document === 'undefined') return;
    const run = () => {
        const canvas = paperCanvas();
        // WebP keeps the data URL around a fifth of the PNG's size. Safari
        // before 14 silently returns a PNG, which still works.
        let url = canvas.toDataURL('image/webp', 0.86);
        if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
        document.documentElement.style.setProperty('--paper-texture', 'url(' + url + ')');
        if (typeof window !== 'undefined') {
            window.__paperBytes = url.length;
        }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}
