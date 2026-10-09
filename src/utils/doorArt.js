/**
 * Procedural door art (zero image assets)
 *
 * The entrance doors used to ship two hand-drawn webp bitmaps whose wood grain,
 * recessed panels AND a pile of tech-logo stickers (JS / React / node / CSS3 …)
 * were all baked into the same image. That made the stickers impossible to
 * remove, restyle or localise.
 *
 * Everything is now drawn on an offscreen <canvas> and wrapped in a
 * THREE.CanvasTexture:
 *
 *   - the door face (wood grain, stiles, two recessed panels, lock plate),
 *   - the architrave / frame with its hinges,
 *   - the door slab edge and the door back,
 *   - the three studio motifs (music -> a mouse playing guitar, ai -> a robot
 *     with "AI" on its belly, code -> a terminal full of code). The entrance
 *     door no longer wears them as stickers — it carries the New Year kit from
 *     utils/gateArt.js instead — but the corridor room doors still wear them as
 *     taped paper notes (makeTapedNoteTexture).
 *
 * The motifs are drawn with a white die-cut border (classic sticker look) and a
 * soft drop shadow.
 *
 * Every texture is cached per key, so callers may call these on every render.
 */

import * as THREE from 'three';
import { cropToInk, downscaleCanvas, hashString, makeCanvas, mulberry32, rgba, roundRectPath } from '../engine/art';

const cache = new Map();

/**
 * 门类画布的降采样倍率（1 = 不缩）。
 *
 * 门类贴图是走廊态显存的 **60%**（512×1216 ×19 + 512×1310 ×5 ≈ 77 MB）。
 * 但**不能**把 `makeDoorFaceTexture` 里的 `W = 512` 直接改小 —— 那些画法是按
 * 画布像素坐标硬编码的（见 `engine/art.js:downscaleCanvas` 的注释）。
 * 所以走「照 512 画完，再整体缩一半」：显存降到 1/4（77 MB → 约 19 MB）。
 *
 * ⚠️ 这是**渲染决策**，不是免费的：门叶是能走到跟前看的。0.5 是量过 A/B 之后的
 * 取值 —— 见 WORKPLAN「贴图显存压缩」。要改先看那一段的截图。
 */
const TEX_SCALE = 0.5;

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function toTexture(canvas, key, { clamp = true, repeat = null, scale = 1, crop = false } = {}) {
    // 降采样 / 裁剪都是**画完之后的独立一步**，所以缓存键要把参数带上 ——
    // 否则同一个 key 先被请求大图、后被请求小图时会拿到错的尺寸。
    const ck = `${key}|${scale}${crop ? '|c' : ''}`;
    if (cache.has(ck)) return cache.get(ck);
    let src = canvas;
    let uv = null;
    if (crop) {
        uv = cropToInk(canvas);
        src = uv.canvas;
    }
    if (scale !== 1) src = downscaleCanvas(src, scale);
    const texture = new THREE.CanvasTexture(src);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (clamp) {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    } else {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    // 裁过就把 UV 缩回原画布里的那一块；没裁才用调用方给的 repeat。
    if (uv && (uv.repeat[0] !== 1 || uv.repeat[1] !== 1)) {
        texture.offset.set(uv.offset[0], uv.offset[1]);
        texture.repeat.set(uv.repeat[0], uv.repeat[1]);
    } else if (repeat) {
        texture.repeat.set(repeat[0], repeat[1]);
    }
    texture.needsUpdate = true;
    cache.set(ck, texture);
    return texture;
}

/**
 * Hand-drawn rectangle: a closed path whose points wobble by ±amp so the
 * stroke never reads as a CAD-perfect box.
 */
function sketchRectPath(ctx, x, y, w, h, amp, rand, r = 0) {
    const jit = () => (rand() - 0.5) * amp;
    const seg = 12;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    // top edge (left -> right)
    ctx.moveTo(x + rr + jit(), y + jit());
    ctx.lineTo(x + w - rr + jit(), y + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + w + jit(), y + jit(), x + w + jit(), y + rr + jit());
    else ctx.lineTo(x + w + jit(), y + jit());
    // right edge
    ctx.lineTo(x + w + jit(), y + h - rr + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + w + jit(), y + h + jit(), x + w - rr + jit(), y + h + jit());
    else ctx.lineTo(x + w + jit(), y + h + jit());
    // bottom edge (right -> left)
    ctx.lineTo(x + rr + jit(), y + h + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + jit(), y + h + jit(), x + jit(), y + h - rr + jit());
    else ctx.lineTo(x + jit(), y + h + jit());
    // left edge
    ctx.lineTo(x + jit(), y + rr + jit());
    if (rr > 0) ctx.quadraticCurveTo(x + jit(), y + jit(), x + rr + jit(), y + jit());
    else ctx.lineTo(x + jit(), y + jit());
    ctx.closePath();
    void seg;
}

/** Stroke the same sketchy rect twice for the doubled pencil line look. */
function inkSketchRect(ctx, x, y, w, h, { amp = 2.4, r = 0, color = '#2a2320', width = 4.5, double = true }, rand) {
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

/* ------------------------------------------------------------------ */
/* Wood                                                                 */
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

/**
 * Vertical wood grain over a rect. `palette` decides the tone; `seedRand`
 * keeps it deterministic.
 */
function drawWoodPanel(ctx, x, y, w, h, palette, rand, { vertical = true, streakCount = 0 } = {}) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const [br, bg, bb] = palette.face;
    const [lr, lg, lb] = palette.light;
    const [dr, dg, db] = palette.grain;

    // Base wash: slightly lighter at the top so the slab reads as lit from above
    const grad = vertical
        ? ctx.createLinearGradient(x, y, x, y + h)
        : ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, rgba(br + 10, bg + 10, bb + 10));
    grad.addColorStop(0.5, rgba(br, bg, bb));
    grad.addColorStop(1, rgba(br - 16, bg - 16, bb - 16));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Grain streaks
    const n = streakCount || Math.round((vertical ? w : h) / 6);
    for (let i = 0; i < n; i++) {
        const t = i / n;
        const dark = rand() > 0.42;
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

    // Occasional knot
    if (rand() > 0.66) {
        const kx = x + w * (0.2 + rand() * 0.6);
        const ky = y + h * (0.2 + rand() * 0.6);
        const kr = Math.min(w, h) * (0.02 + rand() * 0.035);
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 3);
        kg.addColorStop(0, rgba(dr - 18, dg - 14, db - 10, 0.6));
        kg.addColorStop(0.45, rgba(dr, dg, db, 0.28));
        kg.addColorStop(1, rgba(dr, dg, db, 0));
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * 1.5, kr * 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

/** Fine paper-grain noise, applied once over a finished canvas. */
function paperGrain(ctx, w, h, rand, amount = 8) {
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
/* Door face                                                            */
/* ------------------------------------------------------------------ */

// Authored aspect of the door-leaf canvas. It is mapped onto a 0.90 x 2.55
// leaf (see EntranceDoors), i.e. stretched ~11% vertically — under the
// threshold where the handle's brass rose stops reading as a circle, and it
// buys a more traditional 1:2.83 leaf for free. HANDLE_ASPECT follows it, so
// the handle art and the leaf always agree.
export const DOOR_FACE_ASPECT = 512 / 1310;

/**
 * Door leaf: warm wood slab, a darker outer stile/rail band and two recessed
 * panels. The LEFT leaf also carries the gate's single lock plate (see the
 * note on it below — the right leaf must not get one).
 *
 * @param {'left'|'right'} side  which leaf (the right leaf is mirrored)
 * @param {'sketch'|'painted'} variant
 */
export function makeDoorFaceTexture(side = 'left', variant = 'painted') {
    const key = `door-face-${side}-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 1310;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    const [sr, sg, sb] = pal.stile;

    // ---- outer stile / rail band -------------------------------------
    ctx.fillStyle = rgba(sr, sg, sb);
    ctx.fillRect(0, 0, W, H);
    drawWoodPanel(ctx, 0, 0, W, H, { ...pal, face: pal.stile }, rand, { vertical: true });

    const BAND = 40;
    const ix = BAND;
    const iy = BAND;
    const iw = W - BAND * 2;
    const ih = H - BAND * 2;

    // ---- inner field (the lighter door face) -------------------------
    drawWoodPanel(ctx, ix, iy, iw, ih, pal, rand, { vertical: true });
    // Crisp shading where the field meets the band
    ctx.fillStyle = rgba(sr - 40, sg - 34, sb - 26, 0.35);
    ctx.fillRect(ix, iy, 5, ih);
    ctx.fillStyle = rgba(sr + 26, sg + 22, sb + 16, 0.4);
    ctx.fillRect(ix + iw - 4, iy, 4, ih);

    // ---- panels ------------------------------------------------------
    const panels = [
        { x: 55, y: 109, w: 402, h: 573 },
        { x: 55, y: 775, w: 402, h: 453 },
    ];

    panels.forEach((p, index) => {
        // Recessed field: a touch darker, with a shadow inside the top/left
        ctx.save();
        roundRectPath(ctx, p.x, p.y, p.w, p.h, 10);
        ctx.clip();
        drawWoodPanel(ctx, p.x, p.y, p.w, p.h, {
            ...pal,
            face: [
                Math.round(pal.face[0] * 0.9),
                Math.round(pal.face[1] * 0.9),
                Math.round(pal.face[2] * 0.9),
            ],
        }, rand, { vertical: true });
        // Inner shadow (top + left) => the panel reads as recessed
        const sh = ctx.createLinearGradient(p.x, p.y, p.x, p.y + 60);
        sh.addColorStop(0, rgba(sr - 60, sg - 50, sb - 40, 0.55));
        sh.addColorStop(1, rgba(sr - 60, sg - 50, sb - 40, 0));
        ctx.fillStyle = sh;
        ctx.fillRect(p.x, p.y, p.w, 60);
        const sh2 = ctx.createLinearGradient(p.x, p.y, p.x + 46, p.y);
        sh2.addColorStop(0, rgba(sr - 60, sg - 50, sb - 40, 0.42));
        sh2.addColorStop(1, rgba(sr - 60, sg - 50, sb - 40, 0));
        ctx.fillStyle = sh2;
        ctx.fillRect(p.x, p.y, 46, p.h);
        // Bottom/right highlight
        const hl = ctx.createLinearGradient(p.x, p.y + p.h - 40, p.x, p.y + p.h);
        hl.addColorStop(0, rgba(255, 250, 240, 0));
        hl.addColorStop(1, rgba(255, 250, 240, 0.4));
        ctx.fillStyle = hl;
        ctx.fillRect(p.x, p.y + p.h - 40, p.w, 40);
        ctx.restore();

        // Ink outline (double stroke) + a fine inner bevel line
        inkSketchRect(ctx, p.x, p.y, p.w, p.h, {
            amp: 2.6,
            r: 10,
            color: pal.ink,
            width: pal.inkWidth,
        }, rand);
        inkSketchRect(ctx, p.x + 12, p.y + 12, p.w - 24, p.h - 24, {
            amp: 1.6,
            r: 8,
            color: rgba(sr - 70, sg - 60, sb - 50, 0.5),
            width: 2,
            double: false,
        }, rand);
        void index;
    });

    // ---- lock plate + keyhole — LEFT LEAF ONLY ------------------------
    // One lock, on the gate's centre line. The plate lands on the left leaf's
    // inner edge, ~0.044 left of the seam, which is where the eye reads "the
    // middle of the 大门" — and where a real double gate carries its lock.
    //
    // ⚠️ Do NOT draw this on the right leaf. The mirror flip at the end of
    // this function reverses X, so "inner edge" (plateX = 4, the left of the
    // canvas) comes out at the HINGE jamb after the flip. That is how the
    // gate ended up with two keyholes — one at the seam, one out at the right
    // stile. The user's report was exactly that: "钥匙孔出现了两个，保留中间
    // 那个即可". The left leaf's is the middle one, so it is the one that stays.
    if (side === 'left') {
        const plateW = 42;
        const plateX = W - plateW - 4;
        const plateY = 617;
        const plateH = 174;

        ctx.save();
        roundRectPath(ctx, plateX, plateY, plateW, plateH, 8);
        const pg = ctx.createLinearGradient(plateX, 0, plateX + plateW, 0);
        pg.addColorStop(0, rgba(sr + 22, sg + 18, sb + 12));
        pg.addColorStop(0.55, rgba(sr - 6, sg - 6, sb - 6));
        pg.addColorStop(1, rgba(sr - 34, sg - 30, sb - 24));
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.restore();
        inkSketchRect(ctx, plateX, plateY, plateW, plateH, {
            amp: 2,
            r: 8,
            color: pal.ink,
            width: pal.inkWidth * 0.8,
        }, rand);

        // Keyhole
        const kcx = plateX + plateW / 2;
        ctx.fillStyle = rgba(38, 28, 20, 0.92);
        ctx.beginPath();
        ctx.arc(kcx, plateY + 62, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(kcx - 6, plateY + 66);
        ctx.lineTo(kcx + 6, plateY + 66);
        ctx.lineTo(kcx + 9, plateY + 108);
        ctx.lineTo(kcx - 9, plateY + 108);
        ctx.closePath();
        ctx.fill();
    }

    // ---- outer ink border -------------------------------------------
    inkSketchRect(ctx, 6, 6, W - 12, H - 12, {
        amp: 3,
        r: 12,
        color: pal.ink,
        width: pal.inkWidth * 1.1,
    }, rand);

    // ---- mirror for the right leaf ----------------------------------
    let out = canvas;
    if (side === 'right') {
        const flip = makeCanvas(W, H);
        const fctx = flip.getContext('2d');
        fctx.translate(W, 0);
        fctx.scale(-1, 1);
        fctx.drawImage(canvas, 0, 0);
        out = flip;
    }

    paperGrain(out.getContext('2d'), W, H, rand, 7);

    const texture = toTexture(out, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Door frame (architrave + hinges)                                     */
/* ------------------------------------------------------------------ */

export const DOOR_FRAME_ASPECT = 718 / 877; // ≈ 0.8186

/**
 * Architrave: a wood frame with a transparent centre so the doors show
 * through, plus three hinge plates down each side.
 *
 * `aspect` (width / height) is passed in rather than read from
 * DOOR_FRAME_ASPECT, because the frame's height is set by the door it has to
 * surround, not by the old bitmap. Everything below is expressed as a
 * fraction of W and H, so any aspect draws correctly.
 *
 * `headFrac` is the share of the canvas height taken by the 上槛 (head rail).
 * It defaults to the same thin moulding as the other three rails, which is
 * right for a frame that merely surrounds its opening — but WRONG for the
 * entrance gate, whose frame is 0.30 taller than its leaves with the whole
 * 0.30 above them. Sized as a moulding, the head rail sat at the very top of
 * the canvas, leaving the brick's door cut-out (which is 0.06 taller than the
 * leaves) unfilled: the corridor's white wall showed through as a bright band
 * straight across the top of the doors. The caller that has that geometry
 * passes `(frameHeight - doorHeight) / frameHeight` so the rail spans leaf-top
 * to frame-top. See EntranceDoors.
 */
export function makeDoorFrameTexture(
    variant = 'painted',
    aspect = DOOR_FRAME_ASPECT,
    headFrac = 0.024,
) {
    const key = `door-frame-${variant}-${aspect.toFixed(4)}-${headFrac.toFixed(4)}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / aspect);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    const sideBand = Math.round(W * 0.042);  // ≈ 21 px
    const headBand = Math.round(H * headFrac); // 上槛 — caller-sized
    const sillBand = Math.round(H * 0.024);  // 下槛 — always a thin moulding

    // Four rails
    const rails = [
        [0, 0, W, headBand],
        [0, H - sillBand, W, sillBand],
        [0, headBand, sideBand, H - headBand - sillBand],
        [W - sideBand, headBand, sideBand, H - headBand - sillBand],
    ];
    rails.forEach(([x, y, w, h]) => {
        drawWoodPanel(ctx, x, y, w, h, { ...pal, face: pal.stile }, rand, {
            vertical: w > h,
            streakCount: Math.max(6, Math.round(Math.max(w, h) / 14)),
        });
        inkSketchRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, {
            amp: 1.8,
            color: pal.ink,
            width: pal.inkWidth * 0.75,
            double: false,
        }, rand);
    });

    // Hinges: three plates down each side, with a screw dot at each end
    const hingeH = Math.round(H * 0.075);
    [0.14, 0.47, 0.80].forEach((t) => {
        const hy = Math.round(H * t);
        [sideBand * 0.5, W - sideBand * 0.5].forEach((hx) => {
            const hw = sideBand * 0.62;
            ctx.save();
            roundRectPath(ctx, hx - hw / 2, hy, hw, hingeH, 3);
            const hg = ctx.createLinearGradient(hx - hw / 2, 0, hx + hw / 2, 0);
            hg.addColorStop(0, rgba(96, 84, 70));
            hg.addColorStop(0.5, rgba(150, 138, 120));
            hg.addColorStop(1, rgba(88, 76, 62));
            ctx.fillStyle = hg;
            ctx.fill();
            ctx.strokeStyle = pal.ink;
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.fillStyle = rgba(60, 52, 42, 0.85);
            ctx.beginPath();
            ctx.arc(hx, hy + hingeH * 0.22, 2.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(hx, hy + hingeH * 0.78, 2.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    });

    paperGrain(ctx, W, H, rand, 6);

    const texture = toTexture(canvas, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Door slab edge + door back                                           */
/* ------------------------------------------------------------------ */

/** The thin wood strip on the slab's cut edge (tiles along its length). */
export function makeDoorEdgeTexture(variant = 'painted') {
    const key = `door-edge-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 128;
    const H = 512;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    drawWoodPanel(ctx, 0, 0, W, H, { ...pal, face: pal.stile }, rand, { vertical: true });
    // Shadowed outer edges so the slab reads as thick
    const g1 = ctx.createLinearGradient(0, 0, W, 0);
    g1.addColorStop(0, rgba(40, 28, 18, 0.35));
    g1.addColorStop(0.2, rgba(40, 28, 18, 0));
    g1.addColorStop(0.8, rgba(40, 28, 18, 0));
    g1.addColorStop(1, rgba(40, 28, 18, 0.35));
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    const texture = toTexture(canvas, key, { clamp: false, repeat: [1, 1] });
    cache.set(key, texture);
    return texture;
}

/** The inside face of the door (no lock plate, no stickers). */
export function makeDoorBackTexture(variant = 'painted') {
    const key = `door-back-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = 1310;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    // Flatter, slightly cooler back
    const back = { ...pal, face: pal.stile };
    drawWoodPanel(ctx, 0, 0, W, H, back, rand, { vertical: true });

    const BAND = 46;
    drawWoodPanel(ctx, BAND, BAND, W - BAND * 2, H - BAND * 2, pal, rand, { vertical: true });
    inkSketchRect(ctx, BAND, BAND, W - BAND * 2, H - BAND * 2, {
        amp: 2.4,
        color: pal.ink,
        width: pal.inkWidth * 0.85,
    }, rand);

    // Two simple panels (framed, not recessed)
    [[75, 130, 362, 520], [75, 730, 362, 440]].forEach(([x, y, w, h]) => {
        inkSketchRect(ctx, x, y, w, h, { amp: 2.2, r: 8, color: pal.ink, width: pal.inkWidth * 0.7 }, rand);
    });

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Stickers                                                             */
/* ------------------------------------------------------------------ */

const INK = '#2b2521';

function inkStroke(ctx, width = 5) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
}

/* ---- music: a little mouse playing guitar ------------------------- */

function drawMouseArt(ctx) {
    const ink = (w) => {
        ctx.strokeStyle = INK;
        ctx.lineWidth = w;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
    };

    // ---- tail (a simple lazy curl, drawn behind everything) -----------
    ctx.strokeStyle = '#c9a79c';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(118, 356);
    ctx.quadraticCurveTo(38, 380, 40, 306);
    ctx.quadraticCurveTo(42, 262, 78, 264);
    ctx.stroke();

    // ---- ears (behind the head) --------------------------------------
    [[104, 78], [238, 78]].forEach(([ex, ey]) => {
        ctx.beginPath();
        ctx.arc(ex, ey, 47, 0, Math.PI * 2);
        ctx.fillStyle = '#dfe3ea';
        ctx.fill();
        ink(6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey + 4, 26, 0, Math.PI * 2);
        ctx.fillStyle = '#f2b0b0';
        ctx.fill();
    });

    // ---- feet ---------------------------------------------------------
    [[128, 374], [216, 374]].forEach(([fx, fy]) => {
        ctx.beginPath();
        ctx.ellipse(fx, fy, 36, 19, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#f4efe8';
        ctx.fill();
        ink(5.5);
        ctx.stroke();
    });

    // ---- body ---------------------------------------------------------
    ctx.beginPath();
    ctx.ellipse(170, 285, 93, 97, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d7dbe2';
    ctx.fill();
    ink(7);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(164, 300, 58, 64, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f8f6f2';
    ctx.fill();
    ctx.strokeStyle = 'rgba(43,37,33,0.32)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ---- head ---------------------------------------------------------
    ctx.beginPath();
    ctx.arc(170, 140, 79, 0, Math.PI * 2);
    ctx.fillStyle = '#e4e8ef';
    ctx.fill();
    ink(7);
    ctx.stroke();

    // eyes
    [[139, 136], [201, 136]].forEach(([ex, ey]) => {
        ctx.beginPath();
        ctx.ellipse(ex, ey, 13, 16, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#23201e';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex + 5, ey - 6, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    });
    // nose + mouth
    ctx.beginPath();
    ctx.arc(170, 180, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#e88b8b';
    ctx.fill();
    ink(4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(170, 191);
    ctx.lineTo(170, 201);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(158, 202, 12, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(182, 202, 12, 0, Math.PI);
    ctx.stroke();

    // whiskers
    ctx.strokeStyle = 'rgba(43,37,33,0.65)';
    ctx.lineWidth = 2.8;
    [-1, 1].forEach((s) => {
        for (let i = 0; i < 3; i++) {
            const y = 174 + (i - 1) * 16;
            ctx.beginPath();
            ctx.moveTo(170 + s * 28, y);
            ctx.quadraticCurveTo(170 + s * 62, y - 10 + i * 5, 170 + s * 88, y - 16 + i * 14);
            ctx.stroke();
        }
    });

    // ---- guitar: neck up-and-right, body across the mouse's lap -------
    ctx.save();
    ctx.translate(206, 302);
    ctx.rotate(0.62);

    // neck
    ctx.beginPath();
    ctx.moveTo(-12, -30);
    ctx.lineTo(-12, -206);
    ctx.lineTo(14, -206);
    ctx.lineTo(14, -30);
    ctx.closePath();
    ctx.fillStyle = '#8a5a2b';
    ctx.fill();
    ink(6);
    ctx.stroke();

    // frets
    ctx.strokeStyle = 'rgba(43,37,33,0.6)';
    ctx.lineWidth = 2.4;
    for (let i = 1; i <= 5; i++) {
        const y = -206 + i * 30;
        ctx.beginPath();
        ctx.moveTo(-9, y);
        ctx.lineTo(11, y);
        ctx.stroke();
    }
    // strings
    ctx.strokeStyle = 'rgba(255,252,244,0.8)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-6 + i * 5, -206);
        ctx.lineTo(-6 + i * 5, -26);
        ctx.stroke();
    }

    // headstock + pegs
    ctx.beginPath();
    roundRectPath(ctx, -16, -240, 36, 40, 9);
    ctx.fillStyle = '#6d431f';
    ctx.fill();
    ink(6);
    ctx.stroke();
    [-1, 1].forEach((s) => {
        for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(s * 26 + 2, -228 + i * 17, 6.5, 0, Math.PI * 2);
            ctx.fillStyle = '#e8ddc6';
            ctx.fill();
            ink(3.4);
            ctx.stroke();
        }
    });

    // body: figure-eight, sound hole, bridge
    ctx.beginPath();
    ctx.arc(0, -56, 50, 0, Math.PI * 2);
    ctx.arc(0, 40, 66, 0, Math.PI * 2);
    ctx.fillStyle = '#cf8231';
    ctx.fill();
    ink(7);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 6, 19, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2410';
    ctx.fill();
    ctx.strokeStyle = '#f0d9a8';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    roundRectPath(ctx, -22, 58, 44, 13, 4);
    ctx.fillStyle = '#5d3a18';
    ctx.fill();
    ink(4);
    ctx.stroke();

    ctx.restore();

    // ---- arms ---------------------------------------------------------
    // right paw on the neck
    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(222, 250);
    ctx.quadraticCurveTo(272, 222, 292, 178);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(222, 250);
    ctx.quadraticCurveTo(272, 222, 292, 178);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(294, 172, 19, 0, Math.PI * 2);
    ctx.fillStyle = '#f4efe8';
    ctx.fill();
    ink(5);
    ctx.stroke();

    // left paw strumming over the sound hole
    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(146, 296);
    ctx.quadraticCurveTo(186, 320, 224, 330);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(146, 296);
    ctx.quadraticCurveTo(186, 320, 224, 330);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(230, 332, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#f4efe8';
    ctx.fill();
    ink(5);
    ctx.stroke();

    // ---- floating notes ----------------------------------------------
    [[392, 122], [442, 168]].forEach(([nx, ny], i) => {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.ellipse(nx, ny, 14, 10, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(nx + 13, ny);
        ctx.lineTo(nx + 13, ny - 44 - i * 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nx + 13, ny - 44 - i * 8);
        ctx.quadraticCurveTo(nx + 40, ny - 36 - i * 8, nx + 36, ny - 14 - i * 8);
        ctx.stroke();
    });
}

/* ---- ai: a robot with "AI" on its belly --------------------------- */

function drawRobotArt(ctx) {
    const ink = (w) => {
        ctx.strokeStyle = INK;
        ctx.lineWidth = w;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
    };
    const cx = 220;

    // antenna
    ink(9);
    ctx.beginPath();
    ctx.moveTo(cx, 100);
    ctx.lineTo(cx, 52);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, 48, 21, 0, Math.PI * 2);
    ctx.fillStyle = '#6fd8cf';
    ctx.fill();
    ink(6);
    ctx.stroke();

    // side ears
    [-1, 1].forEach((s) => {
        ctx.beginPath();
        roundRectPath(ctx, cx + s * 118 - 20, 138, 40, 62, 14);
        ctx.fillStyle = '#cbd6e2';
        ctx.fill();
        ink(6);
        ctx.stroke();
    });

    // head
    ctx.beginPath();
    roundRectPath(ctx, cx - 118, 92, 236, 150, 46);
    ctx.fillStyle = '#eaf0f7';
    ctx.fill();
    ink(7);
    ctx.stroke();

    // visor
    ctx.beginPath();
    roundRectPath(ctx, cx - 96, 122, 192, 84, 32);
    ctx.fillStyle = '#232a38';
    ctx.fill();
    ink(6);
    ctx.stroke();

    // eyes
    [-1, 1].forEach((s) => {
        const ex = cx + s * 53;
        ctx.beginPath();
        roundRectPath(ctx, ex - 17, 142, 34, 40, 15);
        ctx.fillStyle = '#64e6d8';
        ctx.fill();
        ctx.beginPath();
        roundRectPath(ctx, ex - 9, 152, 18, 21, 8);
        ctx.fillStyle = '#c8fff9';
        ctx.fill();
    });

    // mouth grille
    ctx.strokeStyle = 'rgba(43,37,33,0.5)';
    ctx.lineWidth = 3.4;
    for (let i = 0; i < 3; i++) {
        const y = 218 + i * 9;
        ctx.beginPath();
        ctx.moveTo(cx - 38, y);
        ctx.lineTo(cx + 38, y);
        ctx.stroke();
    }

    // body
    ctx.beginPath();
    roundRectPath(ctx, cx - 128, 252, 256, 190, 44);
    ctx.fillStyle = '#dfe7f0';
    ctx.fill();
    ink(7);
    ctx.stroke();

    // belly screen carrying the letters "AI"
    ctx.beginPath();
    roundRectPath(ctx, cx - 92, 276, 184, 118, 26);
    ctx.fillStyle = '#fbfdff';
    ctx.fill();
    ink(6);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, cx - 92, 276, 184, 118, 26);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,170,210,0.24)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 6; i++) {
        const y = 276 + (i * 118) / 6;
        ctx.beginPath();
        ctx.moveTo(cx - 92, y);
        ctx.lineTo(cx + 92, y);
        ctx.stroke();
    }
    ctx.restore();
    ctx.font = `bold 84px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#243044';
    ctx.fillText('AI', cx, 336);

    // arms + hands
    [-1, 1].forEach((s) => {
        ctx.beginPath();
        roundRectPath(ctx, cx + s * 158 - 26, 288, 52, 112, 26);
        ctx.fillStyle = '#cbd6e2';
        ctx.fill();
        ink(6.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 158, 416, 29, 0, Math.PI * 2);
        ctx.fillStyle = '#eaf0f7';
        ctx.fill();
        ink(6);
        ctx.stroke();
    });

    // legs + feet (clear of the belly screen)
    [-1, 1].forEach((s) => {
        ctx.beginPath();
        roundRectPath(ctx, cx + s * 58 - 28, 444, 56, 68, 20);
        ctx.fillStyle = '#cbd6e2';
        ctx.fill();
        ink(6.5);
        ctx.stroke();
        ctx.beginPath();
        roundRectPath(ctx, cx + s * 62 - 38, 502, 76, 32, 16);
        ctx.fillStyle = '#eaf0f7';
        ctx.fill();
        ink(6);
        ctx.stroke();
    });
}

/* ---- code: a terminal window full of code ------------------------- */

function drawTerminalArt(ctx, W, H) {
    // window
    ctx.beginPath();
    roundRectPath(ctx, 8, 8, W - 16, H - 16, 30);
    ctx.fillStyle = '#1b2030';
    ctx.fill();
    inkStroke(ctx, 9);
    ctx.stroke();

    // title bar (square bottom corners)
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, 8, 8, W - 16, H - 16, 30);
    ctx.clip();
    ctx.fillStyle = '#2b3346';
    ctx.fillRect(8, 8, W - 16, 68);
    ctx.restore();
    ctx.strokeStyle = 'rgba(43,37,33,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(10, 76);
    ctx.lineTo(W - 10, 76);
    ctx.stroke();

    // traffic lights
    [[0, '#e8656a'], [1, '#e8b45f'], [2, '#6fc98a']].forEach(([i, color]) => {
        ctx.beginPath();
        ctx.arc(48 + i * 38, 42, 13, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(43,37,33,0.7)';
        ctx.lineWidth = 3.4;
        ctx.stroke();
    });

    // code lines — coloured runs, drawn with real glyphs so it reads as code
    const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    const lines = [
        [['> ', '#7ee787'], ['npm run build', '#c9d1d9']],
        [['const ', '#ff7b72'], ['studio', '#d2a8ff'], [' = {', '#c9d1d9']],
        [['  music', '#7ee787'], [': ', '#c9d1d9'], ["'zeo'", '#a5d6ff'], [',', '#c9d1d9']],
        [['  ai', '#7ee787'], [': ', '#c9d1d9'], ['true', '#ff7b72'], [',', '#c9d1d9']],
        [['  code', '#7ee787'], [': ', '#c9d1d9'], ["'</>'", '#a5d6ff'], [',', '#c9d1d9']],
        [['}', '#c9d1d9']],
    ];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const fs = Math.round(H * 0.062);
    ctx.font = `${fs}px ${mono}`;
    const x0 = 40;
    const y0 = 108;
    const lead = fs * 1.42;
    lines.forEach((runs, li) => {
        let x = x0;
        runs.forEach(([text, color]) => {
            ctx.fillStyle = color;
            ctx.fillText(text, x, y0 + li * lead);
            x += ctx.measureText(text).width;
        });
    });

    // block cursor
    const last = lines.length - 1;
    ctx.fillStyle = 'rgba(201,209,217,0.85)';
    ctx.fillRect(x0 + ctx.measureText('}').width + 6, y0 + last * lead - fs * 0.55, fs * 0.6, fs * 1.15);
}

/* ---- public API ---------------------------------------------------- */

/**
 * Sticker artwork, reused by the taped-note variant below.
 *
 * NOTE: `makeStickerTexture` / `stickerAspect` were removed when the entrance
 * door swapped its music / AI / code stickers for the New Year kit (门神 / 倒福
 * / 门环 / 春联 — see utils/gateArt.js). The artwork itself survives because the
 * corridor room doors still wear it as taped paper notes.
 */
const STICKER_ART = {
    music: { w: 520, h: 430, draw: drawMouseArt },
    ai: { w: 440, h: 570, draw: drawRobotArt },
    code: { w: 520, h: 420, draw: drawTerminalArt },
};

/** Raw (undecorated) sticker artwork, reused by the taped-note variant. */
function stickerArtCanvas(kind) {
    const spec = STICKER_ART[kind];
    if (!spec) throw new Error(`Unknown sticker kind: ${kind}`);
    const canvas = makeCanvas(spec.w, spec.h);
    spec.draw(canvas.getContext('2d'), spec.w, spec.h);
    return canvas;
}

/* ------------------------------------------------------------------ */
/* Taped note — the sticker variant used on the corridor room doors     */
/* ------------------------------------------------------------------ */

/**
 * A square paper note stuck to a door with two strips of tape, carrying one
 * of the three studio motifs. This is what replaced the hand-drawn icon
 * notes that used to be baked into `drzwi*.webp`.
 *
 * @param {'music'|'ai'|'code'} kind
 */
export function makeTapedNoteTexture(kind) {
    const key = `taped-note-${kind}`;
    if (cache.has(key)) return cache.get(key);

    const S = 320;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const px = 40;
    const py = 40;
    const pw = 240;
    const ph = 240;

    // Paper with a soft shadow
    ctx.save();
    ctx.shadowColor = 'rgba(46, 34, 20, 0.34)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.beginPath();
    roundRectPath(ctx, px, py, pw, ph, 6);
    ctx.fillStyle = '#fdfaf1';
    ctx.fill();
    ctx.restore();

    // Paper edge + a faint fibre texture
    ctx.strokeStyle = 'rgba(74, 60, 44, 0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, px, py, pw, ph, 6);
    ctx.clip();
    for (let i = 0; i < 90; i++) {
        const y = py + rand() * ph;
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px + pw, y + (rand() - 0.5) * 3);
        ctx.strokeStyle = rgba(150, 132, 108, 0.06 + rand() * 0.06);
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();

    // Artwork, fitted inside the paper with a margin
    const art = stickerArtCanvas(kind);
    const margin = 30;
    const boxW = pw - margin * 2;
    const boxH = ph - margin * 2;
    const scale = Math.min(boxW / art.width, boxH / art.height);
    const dw = art.width * scale;
    const dh = art.height * scale;
    ctx.drawImage(art, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);

    // Two strips of tape, top-left and bottom-right
    const drawTape = (cx, cy, angle) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.rect(-48, -17, 96, 34);
        const g = ctx.createLinearGradient(0, -17, 0, 17);
        g.addColorStop(0, 'rgba(232, 222, 196, 0.92)');
        g.addColorStop(0.5, 'rgba(244, 237, 216, 0.86)');
        g.addColorStop(1, 'rgba(226, 214, 186, 0.9)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(140, 124, 98, 0.35)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-48, -8);
        ctx.lineTo(48, -8);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    };
    drawTape(px + 26, py + 26, -0.72);
    drawTape(px + pw - 26, py + ph - 26, -0.72);

    const texture = toTexture(canvas, key);
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Corridor room door (drzwi*)                                          */
/* ------------------------------------------------------------------ */

export const ROOM_DOOR_ASPECT = 0.421; // matches doorWidth / doorHeight

/** Deterministic small integer from a string, for per-door variety. */
export function seedFromString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 9973;
    return h;
}

/**
 * Vertical-plank room door leaf. No stickers — those are separate meshes.
 *
 * `seed` shifts the wood tone and the number of boards so the eight room
 * doors are not carbon copies of each other (the old per-room bitmaps did
 * that job; now it costs nothing).
 */
export function makeRoomDoorTexture(variant = 'painted', seed = 0) {
    const key = `room-door-${variant}-${seed}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / ROOM_DOOR_ASPECT); // 1216
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const base = WOOD[variant] || WOOD.painted;

    const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const shift = (c, d) => [clamp255(c[0] + d[0]), clamp255(c[1] + d[1]), clamp255(c[2] + d[2])];
    const tint = [
        ((seed * 37) % 19) - 9,
        ((seed * 53) % 17) - 8,
        ((seed * 29) % 15) - 7,
    ];
    const pal = {
        ...base,
        face: shift(base.face, tint),
        stile: shift(base.stile, tint),
    };

    drawWoodPanel(ctx, 0, 0, W, H, pal, rand, { vertical: true, streakCount: 150 });

    // Board seams: 3..5 planks, door-dependent
    const boards = 3 + (seed % 3);
    for (let i = 1; i < boards; i++) {
        const x = (W / boards) * i;
        ctx.strokeStyle = rgba(pal.stile[0] - 46, pal.stile[1] - 40, pal.stile[2] - 32, 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.strokeStyle = rgba(255, 246, 230, 0.32);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x + 2.4, 0);
        ctx.lineTo(x + 2.4, H);
        ctx.stroke();
    }

    // Top rail lighter, bottom rail darker (matches the hand-drawn original)
    ctx.fillStyle = rgba(255, 246, 228, 0.16);
    ctx.fillRect(0, 0, W, 46);
    ctx.fillStyle = rgba(46, 30, 14, 0.16);
    ctx.fillRect(0, H - 52, W, 52);
    ctx.strokeStyle = rgba(pal.stile[0] - 50, pal.stile[1] - 44, pal.stile[2] - 34, 0.45);
    ctx.lineWidth = 2.6;
    [46, H - 52].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    });

    // Outer ink outline
    inkSketchRect(ctx, 5, 5, W - 10, H - 10, {
        amp: 3,
        r: 8,
        color: pal.ink,
        width: pal.inkWidth,
        double: false,
    }, rand);

    paperGrain(ctx, W, H, rand, 7);
    const texture = toTexture(canvas, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/** Room door architrave — transparent centre, three hinges down the left. */
export function makeRoomDoorFrameTexture(variant = 'painted') {
    const key = `room-door-frame-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / 0.5); // the frame plane is square-ish (0.5 ratio)
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    const sideBand = 30;
    const topBand = 26;
    const rails = [
        [0, 0, W, topBand],
        [0, H - topBand, W, topBand],
        [0, topBand, sideBand, H - topBand * 2],
        [W - sideBand, topBand, sideBand, H - topBand * 2],
    ];
    rails.forEach(([x, y, w, h]) => {
        drawWoodPanel(ctx, x, y, w, h, { ...pal, face: pal.stile }, rand, {
            vertical: w > h,
            streakCount: Math.max(8, Math.round(Math.max(w, h) / 16)),
        });
        inkSketchRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, {
            amp: 1.8,
            color: pal.ink,
            width: pal.inkWidth * 0.7,
            double: false,
        }, rand);
    });

    // Three hinge plates down the left stile
    const hingeH = 54;
    [0.10, 0.44, 0.78].forEach((t) => {
        const hy = Math.round(H * t);
        const hw = sideBand * 0.66;
        const hx = sideBand * 0.5;
        ctx.save();
        roundRectPath(ctx, hx - hw / 2, hy, hw, hingeH, 3);
        const hg = ctx.createLinearGradient(hx - hw / 2, 0, hx + hw / 2, 0);
        hg.addColorStop(0, rgba(96, 84, 70));
        hg.addColorStop(0.5, rgba(150, 138, 120));
        hg.addColorStop(1, rgba(88, 76, 62));
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = rgba(60, 52, 42, 0.85);
        [0.22, 0.5, 0.78].forEach((s) => {
            ctx.beginPath();
            ctx.arc(hx, hy + hingeH * s, 2.1, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    });

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/** Inside face of a room door. */
export function makeRoomDoorBackTexture(variant = 'painted') {
    const key = `room-door-back-${variant}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / ROOM_DOOR_ASPECT);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = WOOD[variant] || WOOD.painted;

    drawWoodPanel(ctx, 0, 0, W, H, { ...pal, face: pal.stile }, rand, {
        vertical: true,
        streakCount: 140,
    });
    inkSketchRect(ctx, 6, 6, W - 12, H - 12, {
        amp: 2.6,
        r: 8,
        color: pal.ink,
        width: pal.inkWidth * 0.8,
        double: false,
    }, rand);

    paperGrain(ctx, W, H, rand, 6);
    const texture = toTexture(canvas, key, { scale: TEX_SCALE });
    cache.set(key, texture);
    return texture;
}

/* ------------------------------------------------------------------ */
/* Lever handles                                                        */
/* ------------------------------------------------------------------ */

/**
 * The entrance doors used to ship four hand-drawn handle bitmaps
 * (left / right x sketch / painted). They are drawn here now.
 *
 * The handle rides on a plane the size of the whole door leaf, so the canvas
 * has the leaf's aspect and the rose sits at the same normalised spot the old
 * bitmaps used — (0.8795, 0.5413) on the left leaf, mirrored on the right.
 * Every number below was measured off those bitmaps rather than eyeballed, so
 * the silhouette lands within a pixel of the original.
 */
export const HANDLE_ASPECT = DOOR_FACE_ASPECT;

/** Rose centre, normalised leaf coords (left leaf). */
const HANDLE_PIVOT = { u: 0.8795, v: 0.5413 };

/**
 * All in the 512 x 1310 leaf space. The lever is a *tapered* bar: the old
 * drawings have it noticeably thinner at the tip than where it meets the rose,
 * which is most of what makes the shape read as a lever rather than a lollipop.
 */
const HANDLE_GEO = {
    roseR: 24,       // rose (escutcheon) radius
    ringR: 14.5,     // machined ring inside the rose
    barL: 106,       // pivot -> far end of the lever
    tipHalf: 12.5,   // lever half-thickness at the far end
    rootHalf: 18.5,  // ... and where it meets the rose
    tipMid: 6.2,     // lever centre line at the far end (below the rose centre)
    rootMid: 1.3,    // ... and at the pivot
};

const HANDLE_PALETTE = {
    sketch: {
        hi: [255, 253, 250],
        body: [252, 248, 240],
        low: [238, 229, 214],
        // the handle original is drawn in a harder black than the door face
        ink: '#191512',
        inkW: 4.3,
        hatch: 'rgba(43, 37, 33, 0.18)',
        hatchW: 1.2,
        amp: 1.8,
        shade: 0.4, // the pencil original is nearly flat white
    },
    painted: {
        hi: [250, 222, 152],
        body: [222, 174, 84],
        low: [132, 84, 24],
        ink: '#2b1d0b',
        inkW: 3.6,
        hatch: 'rgba(74, 52, 19, 0.32)',
        hatchW: 2.4,
        amp: 0.6,
        shade: 1,
    },
};

/**
 * Silhouette of the lever: a tapered bar joined to the rose. Returned as one
 * point ring so the ink outline never cuts across where the two shapes meet,
 * and so the fill and the stroke always agree on the same wobble.
 *
 * The wobble is low-frequency on purpose: jittering every sample independently
 * turns the contour into a caterpillar, because at this radius the samples sit
 * barely a pixel apart. So the offsets are drawn first and then relaxed with a
 * few 1-2-1 passes, which leaves a slow hand-drawn wave instead of fuzz.
 */
function handleOutline(px, py, geo, amp, rand) {
    const { roseR, barL, tipHalf, rootHalf, tipMid, rootMid } = geo;
    // the bar's edges, as functions of `d` = how far left of the pivot we are
    const mid = (d) => rootMid + (d / barL) * (tipMid - rootMid);
    const half = (d) => rootHalf + (d / barL) * (tipHalf - rootHalf);
    const top = (d) => mid(d) - half(d);
    const bot = (d) => mid(d) + half(d);

    // where each edge leaves the rose (bisection: both are monotone over [0, barL])
    const cross = (edge) => {
        let lo = 0;
        let hi = barL;
        for (let i = 0; i < 40; i++) {
            const m = (lo + hi) / 2;
            if (m * m + edge(m) ** 2 < roseR ** 2) lo = m;
            else hi = m;
        }
        return (lo + hi) / 2;
    };
    const dTop = cross(top);
    const dBot = cross(bot);
    const aTop = Math.atan2(top(dTop), -dTop);
    const aBot = Math.atan2(bot(dBot), -dBot);

    const pts = [];
    const push = (x, y) => pts.push([x, y]);
    const arc = (cx, cy, rad, a0, a1, steps) => {
        for (let i = 0; i <= steps; i++) {
            const a = a0 + (a1 - a0) * (i / steps);
            push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
    };
    const edgeTo = (x0, x1, fn) => {
        for (let i = 1; i <= 12; i++) {
            const x = x0 + (x1 - x0) * (i / 12);
            push(x, py + fn(px - x));
        }
    };

    // top edge, right -> left; round the far cap; bottom edge back; then the
    // long way round the rose (canvas y is down, so angles increase clockwise)
    push(px - dTop, py + top(dTop));
    edgeTo(px - dTop, px - barL + tipHalf, top);
    arc(px - barL + tipHalf, py + tipMid, tipHalf, Math.PI * 1.5, Math.PI * 0.5, 12);
    edgeTo(px - barL + tipHalf, px - dBot, bot);
    arc(px, py, roseR, aBot, aTop, 26);

    if (!amp) return pts;

    const n = pts.length;
    let jx = [];
    let jy = [];
    for (let i = 0; i < n; i++) {
        jx.push((rand() - 0.5) * amp);
        jy.push((rand() - 0.5) * amp);
    }
    for (let pass = 0; pass < 3; pass++) {
        const nx = jx.slice();
        const ny = jy.slice();
        for (let i = 0; i < n; i++) {
            const a = (i - 1 + n) % n;
            const b = (i + 1) % n;
            nx[i] = (jx[a] + jx[i] * 2 + jx[b]) * 0.25;
            ny[i] = (jy[a] + jy[i] * 2 + jy[b]) * 0.25;
        }
        jx = nx;
        jy = ny;
    }
    return pts.map(([x, y], i) => [x + jx[i], y + jy[i]]);
}

function tracePath(ctx, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
}

/** A lever handle. `side` mirrors it; `painted` swaps pencil for brass. */
export function makeHandleTexture(side = 'left', painted = false) {
    const key = `handle-${side}-${painted ? 'painted' : 'sketch'}`;
    if (cache.has(key)) return cache.get(key);

    const W = 512;
    const H = Math.round(W / HANDLE_ASPECT); // 1310
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));
    const pal = HANDLE_PALETTE[painted ? 'painted' : 'sketch'];
    const geo = HANDLE_GEO;
    const col = (c, a = 1) => rgba(c[0], c[1], c[2], a);

    ctx.save();
    if (side === 'right') {
        // the right leaf is an exact mirror of the left one
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
    }

    const px = HANDLE_PIVOT.u * W;
    const py = HANDLE_PIVOT.v * H;
    // the band the lever's cylinder shading spans — its widest, at the rose
    const topY = py + geo.rootMid - geo.rootHalf;
    const botY = py + geo.rootMid + geo.rootHalf;
    const pts = handleOutline(px, py, geo, pal.amp, rand);

    /* ---- body ------------------------------------------------------ */
    ctx.save();
    tracePath(ctx, pts);
    ctx.clip();

    const base = ctx.createLinearGradient(
        px - geo.barL, py - geo.roseR, px + geo.roseR, py + geo.roseR,
    );
    base.addColorStop(0, col(pal.hi));
    base.addColorStop(0.45, col(pal.body));
    base.addColorStop(1, col(pal.low));
    ctx.fillStyle = base;
    ctx.fillRect(px - geo.barL - 4, py - geo.roseR - 4, geo.barL + geo.roseR + 8, geo.roseR * 2 + 8);

    // the lever reads as a cylinder: lit along its upper third, dark under
    const sh = pal.shade;
    const bar = ctx.createLinearGradient(0, topY, 0, botY);
    bar.addColorStop(0, col(pal.low, 0.9 * sh));
    bar.addColorStop(0.22, col(pal.hi, 0.95 * sh));
    bar.addColorStop(0.52, col(pal.body, 0.3 * sh));
    bar.addColorStop(0.84, col(pal.low, 0.8 * sh));
    bar.addColorStop(1, col(pal.low, 0.95 * sh));
    ctx.fillStyle = bar;
    ctx.fillRect(px - geo.barL - 2, topY - 1, geo.barL + 2, botY - topY + 2);

    // the rose catches the light on its upper left
    const rose = ctx.createRadialGradient(
        px - geo.roseR * 0.35, py - geo.roseR * 0.4, geo.roseR * 0.05,
        px, py, geo.roseR * 1.05,
    );
    rose.addColorStop(0, col(pal.hi, 0.85 * sh));
    rose.addColorStop(0.55, col(pal.body, 0.12 * sh));
    rose.addColorStop(1, col(pal.low, 0.7 * sh));
    ctx.fillStyle = rose;
    ctx.fillRect(px - geo.roseR - 2, py - geo.roseR - 2, geo.roseR * 2 + 4, geo.roseR * 2 + 4);
    ctx.restore();

    /* ---- outline --------------------------------------------------- */
    ctx.strokeStyle = pal.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath(ctx, pts);
    ctx.lineWidth = pal.inkW;
    ctx.stroke();
    if (!painted) {
        // the pencil original drew its contour twice
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = pal.inkW * 0.6;
        ctx.translate(0.9, 1.2);
        tracePath(ctx, pts);
        ctx.stroke();
        ctx.restore();
    }

    /* ---- rose detail ----------------------------------------------- */
    // two concentric ink circles with an empty centre — the old drawings never
    // put a screw head in the middle, the white ring is what sells it
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = pal.inkW * 0.9;
    ctx.beginPath();
    ctx.arc(px, py, geo.ringR, 0, Math.PI * 2);
    ctx.stroke();

    /* ---- lever detail ---------------------------------------------- */
    // a line along the lower third plus a few ticks — the original used
    // these to suggest the bevel on the lever's underside
    const tipX = px - geo.barL;
    const ly = py + geo.tipMid + geo.tipHalf * 0.34;
    ctx.strokeStyle = pal.hatch;
    ctx.lineWidth = pal.hatchW;
    ctx.beginPath();
    ctx.moveTo(tipX + 9, ly);
    ctx.lineTo(px - geo.barL * 0.42, ly);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
        const x = px - geo.barL * 0.34 + i * 11;
        ctx.beginPath();
        ctx.moveTo(x, ly);
        ctx.lineTo(x + 6, ly);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(tipX + 9, py + geo.tipMid - geo.tipHalf * 0.55);
    ctx.lineTo(tipX + 17, py + geo.tipMid - geo.tipHalf * 0.55);
    ctx.stroke();

    paperGrain(ctx, W, H, rand, painted ? 7 : 6);

    ctx.restore();

    const texture = toTexture(canvas, key, { crop: true });
    cache.set(key, texture);
    return texture;
}
