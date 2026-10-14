/**
 * Procedural cloud art (zero image assets)
 *
 * The About and Gallery rooms used to ship eight greyscale cloud sketches as
 * webp files under public/textures/clouds, tinted at runtime by
 * utils/colorizeCloud. The tinting stays where it was; the sketches are drawn
 * here instead.
 *
 * A cloud is a union of overlapping circles — a row of big lobes along the
 * bottom, smaller ones riding in their valleys, and (for the two low streak
 * clouds) a thin tail trailing off to the right. Three consequences of building
 * it that way:
 *
 *   - The outline is not traced by hand. The silhouette is stamped repeatedly
 *     around a circle and then punched back out with `destination-out`, which
 *     leaves a ring of even weight all the way round — including the concave
 *     joins, where tracing arcs by hand always shows a seam.
 *   - That dilation happens in *pixel* space, so the contour keeps an even
 *     weight even though the fit stretches the cloud to its canvas. Inflating
 *     the circles instead would have made the outline thicker vertically than
 *     horizontally.
 *   - Lobes are polygons carrying a relaxed random waver rather than true arcs,
 *     so the ring inherits the hand-drawn waver the old pencil sketches had.
 *     The waver is generated once per lobe and reused by both passes;
 *     regenerating it would make the ring pinch and swell.
 *
 * Everything is greyscale: white body, near-black outline, a soft grey wash
 * under the belly. `colorizeCloud` multiplies this over a tint, so the white
 * leaves the tint alone and the ink darkens it.
 *
 * Textures are cached per index, so callers may call these on every render.
 */

import * as THREE from 'three';
import { hashString, makeCanvas, mulberry32 } from '../engine/art';

const cache = new Map();

/**
 * One entry per sprite in config/theme.js CLOUD_SPRITES, in the same order.
 *
 *   base   how many big bumps the cloud has along its bottom
 *   top    smaller bumps riding in the gaps between them
 *   gap    centre-to-centre spacing of the bottom row, in units of its biggest
 *          radius. Below ~1.0 the bumps merge into one blob; around 1.3 the
 *          valleys between them are a third of a lobe deep, which is what the
 *          old sketches show.
 *   rMin   radius of the end bumps, as a fraction of the biggest one — this is
 *          what makes a cloud read as "wide and low" rather than "cauliflower"
 *   tail   how many lobes make up the trailing wisp (0 = no tail). They are
 *          stepped by a fraction of the local radius, so the wisp stays a
 *          smooth taper instead of a row of beads.
 *   ink    outline weight as a fraction of the canvas width. The old files were
 *          padded to power-of-two sizes, so the four 128px sprites were being
 *          upscaled roughly 4x on screen and read with a far heavier contour
 *          than the 512px ones. Measured off the originals: ~2.4% of the cloud
 *          width for the small sprites, ~0.7% for the large ones.
 *   shade  how dark the belly wash gets
 *
 * These only decide the *look* — the fit scales x and y separately, so a cloud
 * whose natural bbox is wider than its canvas gets stretched taller rather than
 * shrunk down with margin around it.
 */
const CLOUD_DEFS = [
    { base: 4, top: 3, gap: 1.05, rMin: 0.58, tail: 0, ink: 0.020, shade: 0.30 }, // 0  aspect 1.894
    { base: 4, top: 2, gap: 1.02, rMin: 0.78, tail: 0, ink: 0.020, shade: 0.30 }, // 1  aspect 2.459
    { base: 3, top: 2, gap: 1.1, rMin: 0.52, tail: 14, ink: 0.003, shade: 0.30 }, // 2  aspect 3.577
    { base: 4, top: 3, gap: 1.18, rMin: 0.52, tail: 0, ink: 0.003, shade: 0.30 }, // 3  aspect 1.794
    { base: 4, top: 3, gap: 1.05, rMin: 0.58, tail: 0, ink: 0.003, shade: 0.30 }, // 4  aspect 1.997
    { base: 4, top: 3, gap: 1.0, rMin: 0.62, tail: 0, ink: 0.020, shade: 0.30 }, // 5  aspect 1.905
    { base: 3, top: 2, gap: 1.1, rMin: 0.52, tail: 9, ink: 0.003, shade: 0.30 }, // 6  aspect 3.0
    { base: 4, top: 3, gap: 1.0, rMin: 0.58, tail: 0, ink: 0.020, shade: 0.30 }, // 7  aspect 1.875
];

/**
 * Lobes in an abstract space where the base line is y = 0 and the cloud grows
 * upwards (negative y). The bbox is fitted to the canvas afterwards, so only
 * the proportions here matter.
 */
function buildLobes(def, rand) {
    const lobes = [];
    const R = 1; // the biggest lobe's radius — the unit everything else uses
    const span = (def.base - 1) * def.gap;

    // bottom row — the widest lobes, their undersides making the base line
    for (let i = 0; i < def.base; i++) {
        const t = def.base === 1 ? 0.5 : i / (def.base - 1);
        // sin() is never allowed to reach 0, or the end lobes vanish
        const hump = Math.sin(Math.PI * (0.14 + 0.72 * t));
        const r = R * (def.rMin + (1 - def.rMin) * hump) * (0.92 + rand() * 0.16);
        lobes.push({ x: t * span, y: -r * 0.84, r });
    }

    // top row — smaller, sitting in the valleys of the row below
    for (let i = 0; i < def.top; i++) {
        const t = (i + 0.5) / def.top;
        const r = R * (0.72 + rand() * 0.14);
        lobes.push({ x: t * span, y: -(R * 1.06 + r * 0.9), r });
    }

    // tail — the low streak clouds peter out into a thin wisp
    if (def.tail) {
        const r0 = R * 0.5;
        const r1 = R * 0.17;
        let x = span;
        let prev = r0;
        for (let i = 1; i <= def.tail; i++) {
            const k = i / def.tail;
            const r = r0 + (r1 - r0) * k;
            x += 0.38 * (prev + r);
            prev = r;
            lobes.push({ x, y: -r * 0.84 - R * 0.07 * k, r });
        }
    }

    return lobes;
}

/** One waver offset per lobe, already relaxed into a slow wave. */
function makeWavers(lobes, amp, rand) {
    const n = 34;
    return lobes.map(() => {
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
        return { jx, jy };
    });
}

/**
 * Fill every lobe as ONE path, each grown by `inflate` (in lobe units).
 *
 * It matters that this is a single path: the nonzero winding rule then gives
 * the union for free, and — more importantly — the path is still current
 * afterwards, so a caller can `ctx.clip()` straight after to get the whole
 * silhouette. Filling lobe by lobe leaves only the last circle in the path,
 * which silently clips the belly wash to one lobe.
 */
function fillLobes(ctx, lobes, wavers, inflate = 0) {
    const n = 34;
    ctx.beginPath();
    for (let li = 0; li < lobes.length; li++) {
        const lobe = lobes[li];
        const { jx, jy } = wavers[li];
        const r = lobe.r + inflate;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const px = lobe.x + Math.cos(a) * r + jx[i];
            const py = lobe.y + Math.sin(a) * r + jy[i];
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }
    ctx.fill();
}

/**
 * A greyscale cloud sketch. `index` picks the shape (and its ink weight);
 * `aspect` is the sprite's artwork aspect from config/theme.js — the files were
 * padded to power-of-two sizes, so it cannot be read back off the canvas.
 */
export function makeCloudTexture(index = 0, aspect = 1.9) {
    const key = `cloud-${index}`;
    if (cache.has(key)) return cache.get(key);

    const def = CLOUD_DEFS[index % CLOUD_DEFS.length];
    const W = 512;
    const H = Math.max(1, Math.round(W / aspect));
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(key));

    const lobes = buildLobes(def, rand);

    // Fit the union's bbox to the canvas with a 2% margin. The two axes are
    // scaled independently: the clouds are hand-drawn, and stretching a lobe by
    // the 10-20% it takes to fill the frame is invisible, whereas fitting
    // uniformly would leave a visibly undersized cloud whenever the natural
    // bbox and the target aspect disagree.
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const l of lobes) {
        x0 = Math.min(x0, l.x - l.r);
        x1 = Math.max(x1, l.x + l.r);
        y0 = Math.min(y0, l.y - l.r);
        y1 = Math.max(y1, l.y + l.r);
    }
    const pad = 0.075;
    const kx = (W * (1 - 2 * pad)) / (x1 - x0);
    const ky = (H * (1 - 2 * pad)) / (y1 - y0);
    const ox = (W - (x0 + x1) * kx) / 2;
    const oy = (H - (y0 + y1) * ky) / 2;

    // the waver and the ink weight both have to be expressed in lobe units,
    // because everything below is drawn inside the fit's transform
    const wavers = makeWavers(lobes, 0.055 / Math.min(kx, ky), rand);

    const fitted = (g) => {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.translate(ox, oy);
        g.scale(kx, ky);
    };

    /* ---- outline ---------------------------------------------------------
     * The ring is a pixel-space dilation, not an inflated redraw. Stamping the
     * silhouette around a circle of radius `inkPx` grows it by exactly that in
     * both axes, so the contour stays an even weight even though the fit above
     * stretched the cloud; inflating in lobe units would have made the outline
     * kx/ky thicker vertically than horizontally.
     */
    const mask = makeCanvas(W, H);
    const mg = mask.getContext('2d');
    fitted(mg);
    mg.fillStyle = '#0f0f0f';
    fillLobes(mg, lobes, wavers, 0);

    const inkPx = def.ink * W;
    const ring = makeCanvas(W, H);
    const rg = ring.getContext('2d');
    const STEPS = 20;
    for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        rg.drawImage(mask, Math.cos(a) * inkPx, Math.sin(a) * inkPx);
    }
    rg.globalCompositeOperation = 'destination-out';
    rg.drawImage(mask, 0, 0);
    rg.globalCompositeOperation = 'source-over';

    ctx.drawImage(ring, 0, 0);
    fitted(ctx);

    /* ---- body ------------------------------------------------------------ */
    ctx.fillStyle = '#ffffff';
    fillLobes(ctx, lobes, wavers, 0);

    /* ---- belly wash ------------------------------------------------------ */
    ctx.save();
    fillLobes(ctx, lobes, wavers, 0);
    ctx.clip();
    // A broad, very light wash over the whole belly plus a darker band right
    // along the base — the old sketches shade the underside of every lobe, not
    // just the bottom edge. The stops are picked so the band dark enough to
    // read as grey covers roughly 5% of the cloud, matching the originals.
    const wash = ctx.createLinearGradient(0, y0, 0, y1);
    wash.addColorStop(0, 'rgba(0, 0, 0, 0)');
    wash.addColorStop(0.6, `rgba(0, 0, 0, ${def.shade * 0.1})`);
    wash.addColorStop(0.84, `rgba(0, 0, 0, ${def.shade * 0.36})`);
    wash.addColorStop(1, `rgba(0, 0, 0, ${def.shade})`);
    ctx.fillStyle = wash;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}

export default makeCloudTexture;

/**
 * SDF + 逐瓣法线，烘进一张 DataTexture（2026-10-14，路线 C）。
 * =====================================================================
 *
 * 为什么要有第二张生成器：`makeCloudTexture` 的产物是**素描**（R=G=B=灰度、
 * A=硬跳变的覆盖度），摄影室（GalleryClouds + colorizeCloud）靠"乘色调"用它。
 * 天空的云（路线 C）要的是**数据**：R=带符号距离场、G/B=法线 —— 两者**不能共用
 * 一张贴图**，否则摄影室直接坏。所以这里**另起一个函数**，`makeCloudTexture`
 * 一行不动。
 *
 * 🔴 形状与素描**逐位相同**：同一把种子（`cloud-<index>`）、同一个 `buildLobes`、
 *    同一套 fit（pad 0.075、两轴独立）—— 只是把"画出来"换成"算出来"。
 *    判据 S2/S3 的 A/B 都建立在"剪影没被换掉"上。
 *
 * 🔴 法线为什么是**解析精确**的：union-of-spheres 投到 billboard 平面上，
 *    每个像素的可见表面就是「z 最靠前的那个瓣」的球面，其法线 =
 *    `(dx, dy, sqrt(r²−d²)) / r`（d = 像素到瓣心的距离）。这不是近似 ——
 *    WO-30 走过的弯路（把 alpha 模糊求梯度当法线）是被墨线弧带偏的**近似**，
 *    这条是**解析**的，与墨线无关（墨线现在根本不在贴图里，见下）。
 *
 * 通道布局（**没有**墨线、**没有**腹灰 —— 那两样挪到片元里，见 `shaders/skyClouds.js`）：
 *   R = 带符号距离场，`0.5 + sdf/SDF_RANGE`（云内为负 → < 0.5）
 *   G = 法线 x（0.5 = 0）
 *   B = 法线 y（0.5 = 0）；z 在片元里补：`sqrt(1 − x² − y²)`
 *   A = 255（不用 —— 覆盖度由 R 的距离场给，比硬 alpha 抗锯齿得多）
 *
 * 🔴 **别**把这张贴图设成 sRGB：R/G/B 是**数据**不是颜色
 *    （`THREE.NoColorSpace`，DataTexture 的默认值）。
 *
 * 🔴 RGB 要**延伸进云外的像素**（外面填 (0,0,1) 法线）：双线性过滤会采到
 *    云外的纹素，若那里是 0 会得到一条黑边（参考实现 `painted-clouds.js`
 *    的注释原话："RGB extends through transparent texels, preventing a
 *    dark outline after filtering"）。
 */
export function makeCloudVolumeTexture(index = 0, aspect = 1.9) {
    const key = `cloud-vol-${index}`;
    if (cache.has(key)) return cache.get(key);

    const def = CLOUD_DEFS[index % CLOUD_DEFS.length];
    const W = 512;
    const H = Math.max(1, Math.round(W / aspect));
    // 与素描同一把种子 ⇒ 同一套瓣 ⇒ 同一个剪影
    const rand = mulberry32(hashString(`cloud-${index}`));
    const lobes = buildLobes(def, rand);

    // 与 makeCloudTexture 完全相同的 fit
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const l of lobes) {
        x0 = Math.min(x0, l.x - l.r);
        x1 = Math.max(x1, l.x + l.r);
        y0 = Math.min(y0, l.y - l.r);
        y1 = Math.max(y1, l.y + l.r);
    }
    const pad = 0.075;
    const kx = (W * (1 - 2 * pad)) / (x1 - x0);
    const ky = (H * (1 - 2 * pad)) / (y1 - y0);
    const ox = (W - (x0 + x1) * kx) / 2;
    const oy = (H - (y0 + y1) * ky) / 2;
    // lobe 单位 → 像素：两轴独立缩放差 ≤ 20%，取几何平均近似各向同性
    const kpx = Math.sqrt(kx * ky);

    /** 距离场的存储量程（UV）。±0.05 ⇒ 墨线（~0.012）与侵蚀（±0.015）都在量程内。 */
    const SDF_RANGE = 0.10;
    const data = new Uint8Array(W * H * 4);
    let p = 0;
    // 🔴 DataTexture 的 `flipY` 是 false ⇒ 数据第 0 行 = v=0 = 面片**底部**。
    //    素描画布的第 0 行是云**顶**（fit 不翻转）⇒ 这里自底向上填。
    for (let row = 0; row < H; row += 1) {
        const cy = H - 1 - row;
        const ly = (cy + 0.5 - oy) / ky;
        for (let cx = 0; cx < W; cx += 1) {
            const lx = (cx + 0.5 - ox) / kx;
            let sdf = Infinity;   // lobe 单位
            let bestZ = -1;       // 最靠前的瓣的 z（lobe 单位）
            let nx = 0;
            let ny = 0;
            for (let i = 0; i < lobes.length; i += 1) {
                const lobe = lobes[i];
                const dx = lx - lobe.x;
                const dy = ly - lobe.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                const sd = d - lobe.r;
                if (sd < sdf) sdf = sd;
                if (d < lobe.r) {
                    const z = Math.sqrt(lobe.r * lobe.r - d * d);
                    if (z > bestZ) {
                        bestZ = z;
                        nx = dx / lobe.r;
                        // 🔴 canvas 的 y 向下，而片元/「uSunCam」里 y 是**屏幕上**为正
                        //    ⇒ 这里必须翻符号。2026-10-14 漏了这一下：S4 反向
                        //    （朝阳半反而更暗，corr −0.312），uSunCam 又被 y 主导。
                        ny = -dy / lobe.r;
                    }
                }
            }
            const sdfUV = (sdf * kpx) / W;
            // 云外没有可见表面 ⇒ 法线回退 (0,0,1)（正对镜头）。
            // 🔴 距离场**照常写** —— 紧贴轮廓外侧那一两像素 bestZ<0 但 sdf 很小，
            //    若一并填成"最远"，抗锯齿边就断在那儿（量具 S2 会量到一条断层）。
            if (bestZ < 0) {
                nx = 0;
                ny = 0;
            }
            data[p] = Math.round(Math.max(0, Math.min(1, 0.5 + sdfUV / SDF_RANGE)) * 255);
            data[p + 1] = Math.round((nx * 0.5 + 0.5) * 255);
            data[p + 2] = Math.round((ny * 0.5 + 0.5) * 255);
            data[p + 3] = 255;
            p += 4;
        }
    }

    const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    texture.name = `cloud-vol-${index}`;
    // 🔴 数据贴图：**不**做 sRGB（默认就是 NoColorSpace，这里写明是防有人顺手改）
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
}
