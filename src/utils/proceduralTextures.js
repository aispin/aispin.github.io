/**
 * Procedural canvas textures (zero image assets)
 *
 * The site previously shipped grey-white hand-drawn bitmaps for room floors
 * and trim. These generators draw the same kind of surface on an offscreen
 * <canvas> and wrap it in a THREE.CanvasTexture, so:
 *   - nothing is downloaded,
 *   - the art is crisp at any resolution,
 *   - and existing MeshBasicMaterial patches (e.g. the paint-reveal
 *     onBeforeCompile used by the gallery) keep working untouched.
 *
 * Textures are cached per key — callers can call these every render.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32, rgba } from '../engine/art';

const cache = new Map();

function finishTexture(canvas, repeatX = 1, repeatY = 1) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.needsUpdate = true;
    return texture;
}

/* ------------------------------------------------------------------ */
/* Warm light-wood plank floor                                          */
/* ------------------------------------------------------------------ */

/**
 * Seamless warm-oak plank floor.
 *
 * The canvas covers TILE_W x TILE_H world units, so the caller should set
 * repeat to (1 / TILE_W, 1 / TILE_H) when the mesh UVs are in world units
 * (ShapeGeometry) — see GALLERY_FLOOR_TILE below.
 */
export const GALLERY_FLOOR_TILE = { w: 4, h: 2 };

export function woodFloorTexture(key = 'wood-floor') {
    const cached = cache.get(key);
    if (cached) return cached;

    const PX_PER_UNIT = 256;
    const W = GALLERY_FLOOR_TILE.w * PX_PER_UNIT; // 1024
    const H = GALLERY_FLOOR_TILE.h * PX_PER_UNIT; // 512
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Planks run along X; 4 rows of 0.5 world units = 128 px each
    const plankH = H / 4;
    const jointEvery = W / 2; // 2 world units -> seamless horizontally

    // Warm oak palette
    const tones = [
        [232, 214, 186],
        [222, 200, 166],
        [238, 224, 200],
        [214, 191, 156],
        [228, 208, 178],
    ];

    for (let row = 0; row < 4; row++) {
        const y0 = row * plankH;
        const stagger = row % 2 === 0 ? 0 : jointEvery / 2;

        // Paint each plank segment in this row
        for (let seg = -1; seg * jointEvery + stagger < W + jointEvery; seg++) {
            const x0 = seg * jointEvery + stagger;
            const w = jointEvery;
            const tone = tones[Math.floor(rand() * tones.length)];

            ctx.save();
            ctx.beginPath();
            ctx.rect(x0, y0, w, plankH);
            ctx.clip();

            // Base tone with a gentle vertical light falloff
            const grad = ctx.createLinearGradient(0, y0, 0, y0 + plankH);
            grad.addColorStop(0, rgba(tone[0] + 8, tone[1] + 8, tone[2] + 8));
            grad.addColorStop(0.55, rgba(tone[0], tone[1], tone[2]));
            grad.addColorStop(1, rgba(tone[0] - 14, tone[1] - 14, tone[2] - 14));
            ctx.fillStyle = grad;
            ctx.fillRect(x0, y0, w, plankH);

            // Wood grain: long, slightly wavy streaks along X
            const grainCount = 14 + Math.floor(rand() * 8);
            for (let g = 0; g < grainCount; g++) {
                const gy = y0 + rand() * plankH;
                const amp = 1.5 + rand() * 4;
                const freq = 0.006 + rand() * 0.012;
                const dark = rand() > 0.5;
                ctx.beginPath();
                ctx.moveTo(x0, gy);
                for (let x = x0; x <= x0 + w; x += 12) {
                    ctx.lineTo(x, gy + Math.sin(x * freq + g) * amp);
                }
                ctx.strokeStyle = dark
                    ? rgba(tone[0] - 34, tone[1] - 30, tone[2] - 26, 0.16 + rand() * 0.14)
                    : rgba(255, 248, 236, 0.16 + rand() * 0.14);
                ctx.lineWidth = 0.7 + rand() * 1.5;
                ctx.stroke();
            }

            // Occasional small knot / fleck
            if (rand() > 0.72) {
                const kx = x0 + 40 + rand() * (w - 80);
                const ky = y0 + 20 + rand() * (plankH - 40);
                const kr = 3 + rand() * 5;
                const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
                kg.addColorStop(0, rgba(tone[0] - 58, tone[1] - 50, tone[2] - 44, 0.55));
                kg.addColorStop(1, rgba(tone[0] - 30, tone[1] - 26, tone[2] - 22, 0));
                ctx.fillStyle = kg;
                ctx.beginPath();
                ctx.arc(kx, ky, kr, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();

            // Butt joint at the start of each plank segment (soft pencil line)
            ctx.beginPath();
            ctx.moveTo(x0, y0 + 1);
            ctx.lineTo(x0, y0 + plankH - 1);
            ctx.strokeStyle = rgba(150, 128, 100, 0.5);
            ctx.lineWidth = 1.6;
            ctx.stroke();
        }

        // Long seam between plank rows
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(W, y0);
        ctx.strokeStyle = rgba(146, 124, 96, 0.55);
        ctx.lineWidth = 2;
        ctx.stroke();
        // Light catch on the lower edge of the seam
        ctx.beginPath();
        ctx.moveTo(0, y0 + 2);
        ctx.lineTo(W, y0 + 2);
        ctx.strokeStyle = rgba(255, 250, 240, 0.5);
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    // Paper grain over the whole tile
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (rand() - 0.5) * 10;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);

    const texture = finishTexture(
        canvas,
        1 / GALLERY_FLOOR_TILE.w,
        1 / GALLERY_FLOOR_TILE.h
    );
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Warm off-white trim (baseboard / threshold)                          */
/* ------------------------------------------------------------------ */

/**
 * A 1-tile trim strip: warm off-white with a highlight along the top and a
 * shadow crease along the bottom, plus a faint grain. Tiles along X.
 */
export function trimTexture(key = 'trim') {
    const cached = cache.get(key);
    if (cached) return cached;

    const W = 512;
    const H = 32;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    // Vertical shading: bright near the top, shadowed at the bottom
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgba(252, 248, 240));
    grad.addColorStop(0.28, rgba(243, 236, 224));
    grad.addColorStop(0.8, rgba(226, 217, 202));
    grad.addColorStop(1, rgba(198, 188, 172));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Faint horizontal grain
    for (let i = 0; i < 40; i++) {
        const y = rand() * H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= W; x += 16) {
            ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 0.8);
        }
        ctx.strokeStyle = rgba(210, 200, 184, 0.18 + rand() * 0.16);
        ctx.lineWidth = 0.8 + rand();
        ctx.stroke();
    }

    // Crisp shadow line where the trim meets the floor
    ctx.fillStyle = rgba(150, 140, 124, 0.5);
    ctx.fillRect(0, H - 2, W, 2);

    const texture = finishTexture(canvas, 1, 1);
    cache.set(key, texture);
    return texture;
}
