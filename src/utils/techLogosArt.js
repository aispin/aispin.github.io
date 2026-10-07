/**
 * Tech-stack logo art (procedural, drawn from SVG path data)
 *
 * The ten tech marks that used to be webp bitmaps on the GALLERY card backs are
 * redrawn here as vector paths, one square canvas each, so the corridor can lay
 * them on the floor behind ZEO — he has conquered the stack and walks over it.
 *
 * Every mark is authored as an SVG `d` string and replayed through `Path2D`, so
 * the geometry stays resolution-independent and the repo carries no bitmaps.
 * The shapes are deliberately stylised — brand hues pulled a little warmer and
 * desaturated so they sit on the light-oak GLSL floor instead of floating above
 * it, plus a shared ink outline in the site's drawing voice.
 *
 * ONE CANVAS PER MARK, deliberately. An earlier revision stamped all ten onto a
 * single wide canvas and laid that down as one plane; it read as a sheet of
 * paper on the floor, and the mark that fell inside the avatar's silhouette
 * painted straight over him. A square canvas per mark lets the host place each
 * one individually (own position, own rotation, own draw order) and keeps every
 * patch the same resolution no matter how far apart they are scattered.
 *
 * Conventions follow utils/doorArt.js / utils/entranceArt.js / utils/corridorArt.js:
 *   - deterministic `mulberry32` PRNG, so the art never flickers between reloads;
 *   - textures are cached under a key, so callers may build them every render;
 *   - the canvas aspect matches the plane aspect, so nothing is stretched.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32 } from '../engine/art';

const cache = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toTexture(canvas, key) {
    if (cache.has(key)) return cache.get(key);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}

/** Rounded rect built by hand so we never depend on ctx.roundRect. */
function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Replay a `d` string, optionally through a DOMMatrix, as a Path2D. */
function path(d, matrix) {
    const p = new Path2D(d);
    if (!matrix) return p;
    const out = new Path2D();
    out.addPath(p, matrix);
    return out;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/** Shared outline + caption ink — the site's warm charcoal. */
const INK = '#41372c';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ------------------------------------------------------------------ */
/* The ten marks — each authored in a 100 x 100 design box             */
/* ------------------------------------------------------------------ */

/** HTML5 / CSS3 share the same shield; only the digit and hue differ. */
function shieldMark(ctx, hue, digit) {
    const outer = path('M6 5 H94 L86 83 L50 96 L14 83 Z');
    const inner = path('M22 20 H78 L72 73 L50 81 L28 73 Z');

    ctx.fillStyle = hue;
    ctx.fill(outer);
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke(outer);

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fill(inner);
    ctx.lineWidth = 2.8;
    ctx.stroke(inner);

    ctx.fillStyle = hue;
    ctx.font = `800 46px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(digit, 50, 54);
}

function jsMark(ctx, hue) {
    roundRect(ctx, 6, 6, 88, 88, 15);
    ctx.fillStyle = hue;
    ctx.fill();
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = INK;
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.font = `800 40px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('JS', 90, 88);
}

function reactMark(ctx, hue) {
    ctx.save();
    ctx.translate(50, 50);
    ctx.strokeStyle = hue;
    ctx.lineWidth = 6.4;
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, 46, 17.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
    ctx.fillStyle = hue;
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
}

/**
 * Tailwind — two stacked "wave" blades. The source paths are the official
 * 54 x 32.4 silhouette; DOMMatrix scales them into the 100 box so the stroke
 * width stays in design units (scaling the context would scale the pen too).
 */
function tailwindMark(ctx, hue) {
    const scale = 100 / 54;
    const m = new DOMMatrix().translate(0, 20).scale(scale);
    const top = path(
        'M27 0c-7.2 0-11.7 3.6-13.5 10.8 2.7-3.6 5.85-4.95 9.45-4.05 2.05.51 3.52 2 5.15 3.65C30.74 13.09 33.8 16.2 40.5 16.2c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.05-.51-3.52-2-5.15-3.65C36.76 3.11 33.69 0 27 0z',
        m
    );
    const bot = path(
        'M13.5 16.2C6.3 16.2 1.8 19.8 0 27c2.7-3.6 5.85-4.95 9.45-4.05 2.05.51 3.52 2 5.15 3.65C20.24 29.29 23.31 32.4 30 32.4c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.05-.51-3.52-2-5.15-3.65C26.26 19.31 23.19 16.2 13.5 16.2z',
        m
    );
    ctx.fillStyle = hue;
    ctx.fill(bot);
    ctx.fill(top);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke(bot);
    ctx.stroke(top);
}

function wordpressMark(ctx, hue) {
    ctx.beginPath();
    ctx.arc(50, 50, 44, 0, Math.PI * 2);
    ctx.fillStyle = hue;
    ctx.fill();
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = INK;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(23, 33);
    ctx.lineTo(38, 70);
    ctx.lineTo(50, 43);
    ctx.lineTo(62, 70);
    ctx.lineTo(77, 33);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}

function elementorMark(ctx, hue) {
    const stem = path('M20 20 H36 V80 H20 Z');
    const top = path('M46 20 H82 V36 H46 Z');
    const bot = path('M46 64 H82 V80 H46 Z');
    ctx.fillStyle = hue;
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    for (const p of [stem, top, bot]) {
        ctx.fill(p);
        ctx.stroke(p);
    }
}

function phpMark(ctx, hue) {
    ctx.beginPath();
    ctx.ellipse(50, 50, 47, 28, 0, 0, Math.PI * 2);
    ctx.fillStyle = hue;
    ctx.fill();
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = INK;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 33px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('php', 50, 52);
}

/** Netlify — a square in perspective with one half folded. */
function netlifyMark(ctx, hue) {
    const left = path('M50 6 L94 50 L50 50 Z');
    const right = path('M50 6 L94 50 L50 94 L6 50 Z');

    ctx.fillStyle = hue;
    ctx.fill(right);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fill(left);
    ctx.restore();

    ctx.lineWidth = 3.4;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke(right);
}

/** Firebase — the faceted flame. */
function firebaseMark(ctx, hue) {
    const blade = path('M28 88 L47 8 L59 46 L43 88 Z');
    const right = path('M43 88 L59 46 L90 88 Z');
    const flap = path('M59 46 L47 8 L79 22 Z');

    ctx.lineWidth = 3.2;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';

    ctx.fillStyle = hue;
    ctx.fill(blade);
    ctx.stroke(blade);

    ctx.fillStyle = hue;
    ctx.fill(right);
    ctx.stroke(right);

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill(flap);
    ctx.stroke(flap);
}

/**
 * The stack, in the order it is stamped onto the floor. `hue` values are the
 * brand colours pulled toward the site's warm palette (they sit on a light-oak
 * GLSL floor, so full-saturation brand colours would read as floating stickers).
 */
const STACK = [
    { id: 'html', hue: '#c9603a', draw: (c, h) => shieldMark(c, h, '5') },
    { id: 'css', hue: '#4c78ad', draw: (c, h) => shieldMark(c, h, '3') },
    { id: 'js', hue: '#cfa32f', draw: jsMark },
    { id: 'react', hue: '#4e9aab', draw: reactMark },
    { id: 'tailwind', hue: '#3e97ad', draw: tailwindMark },
    { id: 'wordpress', hue: '#6b7789', draw: wordpressMark },
    { id: 'elementor', hue: '#b45a85', draw: elementorMark },
    { id: 'php', hue: '#6b79a0', draw: phpMark },
    { id: 'netlify', hue: '#3aa393', draw: netlifyMark },
    { id: 'firebase', hue: '#dda435', draw: firebaseMark },
];

/* ------------------------------------------------------------------ */
/* Floor tiles                                                         */
/* ------------------------------------------------------------------ */

/** Canvas edge in pixels. One texture per mark, so 384 stays cheap. */
const TILE_PX = 384;
/** Fraction of the tile the mark itself occupies. The rest is margin, which
 *  keeps a rotated tile from bleeding into the neighbouring plank. */
const INNER = 0.80;

/**
 * World size of one tile. The GLSL floor (WOOD_FLOOR_FRAG) lays planks in
 * 0.62-wide strips, so a 0.60 tile with an 80 % mark sits on a single board
 * instead of straddling a seam.
 */
export const TECH_STACK_TILE = 0.60;

/**
 * Where each tile lies on the corridor floor, in the avatar group's local
 * space. `x` is across the corridor; `back` is how many world units BEHIND the
 * avatar's own Z the tile centre sits (positive = further from the camera).
 *
 * `x` is snapped to plank centres. The floor shader puts the first seam on
 * x = 0, so centres fall on 0.31 + 0.62k: ±0.31, ±0.93, ±1.55, ±2.17.
 *
 * Why nothing sits on ±0.31: the camera looks straight down the corridor at a
 * 4–6° grazing angle, so the floor climbs toward the horizon — which is exactly
 * where the avatar's body is. A centre-line tile *behind* him therefore paints
 * onto his torso no matter how far back it goes. Measured against his real
 * silhouette (alpha bbox: ±0.41 world, not the ±0.54 of his plane) the ±0.93
 * column clears him for any depth this layout uses, and ±1.55 clears him with
 * room to spare; the trail alternates between the two so it never grids up.
 */
const LAYOUT = [
    { id: 'html', x: -0.93, back: 1.05, rot: -6, s: 1.00 },
    { id: 'css', x: 1.55, back: 1.34, rot: 8, s: 0.97 },
    { id: 'js', x: -1.55, back: 2.06, rot: 5, s: 0.99 },
    { id: 'react', x: 0.93, back: 2.24, rot: -7, s: 0.96 },
    { id: 'tailwind', x: -0.93, back: 3.04, rot: -5, s: 0.98 },
    { id: 'wordpress', x: 1.55, back: 3.22, rot: 9, s: 0.95 },
    { id: 'elementor', x: -1.55, back: 4.02, rot: 7, s: 0.96 },
    { id: 'php', x: 0.93, back: 4.20, rot: -6, s: 0.97 },
    { id: 'netlify', x: -0.93, back: 4.94, rot: 5, s: 0.94 },
    { id: 'firebase', x: 1.55, back: 5.16, rot: -8, s: 0.95 },
];

/** Public copy, so the host iterates exactly the slots the art was authored for. */
export const TECH_STACK_LAYOUT = LAYOUT.map((slot) => ({ ...slot }));

/**
 * One mark, centred on its own square canvas.
 *
 * Like the corridor's other art the tile carries a single tight contact shadow
 * and nothing else — no caption plate (at 0.5 world units a label is just
 * noise, and the ten labels were the bulk of the "messy" read) and no
 * full-canvas wash (that produced the pale rectangle the first pass had).
 */
function drawTile(ctx, mark, rand) {
    const S = TILE_PX * INNER;
    const c = TILE_PX / 2;

    // Contact shadow — a low blob just under the mark so it reads as lying on
    // the plank rather than hovering over it.
    ctx.save();
    ctx.filter = `blur(${Math.round(TILE_PX * 0.022)}px)`;
    ctx.fillStyle = 'rgba(58,42,26,0.24)';
    ctx.beginPath();
    ctx.ellipse(c + S * 0.02, c + S * 0.40, S * 0.38, S * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The mark. A couple of percent of non-uniform squash per tile so the ten
    // read as ten rubbings rather than one computer-placed set.
    const sx = 1 + (rand() - 0.5) * 0.03;
    const sy = 1 + (rand() - 0.5) * 0.03;
    ctx.save();
    ctx.translate(c, c * 0.98);
    ctx.scale((S / 100) * sx, (S / 100) * sy);
    ctx.translate(-50, -50);
    mark.draw(ctx, mark.hue);
    ctx.restore();
}

/**
 * The square texture for one mark, cached under its id so callers may build it
 * every render. Returns null for an unknown id.
 */
export function makeTechLogoTexture(id) {
    const key = `tech-logo-${id}`;
    if (cache.has(key)) return cache.get(key);

    const mark = STACK.find((s) => s.id === id);
    if (!mark) return null;

    const canvas = makeCanvas(TILE_PX, TILE_PX);
    const rand = mulberry32(hashString(key));
    drawTile(canvas.getContext('2d'), mark, rand);

    return toTexture(canvas, key);
}
