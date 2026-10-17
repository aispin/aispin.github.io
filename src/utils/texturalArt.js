/**
 * 「文字生成背景」—— 把一段文字平铺成一层柔和的肌理。
 *
 * 技法来自 `public/demos/web3d/career/index.html`（那个 Textural 演示里的
 * `texturalCanvas`）：一层底色 + 几团径向渐变 + 一层按网格平铺的大字，
 * 最后对**文字层**单独做一次模糊，再合成到底子上。
 *
 * 为什么抽成独立模块：房间的墙面、卡片，以及以后别的房间都想用同一套肌理；
 * 而"同一份输入两次跑出来必须一模一样"是本仓的硬要求（`engine/art.js` 的
 * 契约 1）。集中在一个文件里才守得住 —— 随机数只能有一个来源。
 *
 * 三条不能忘的约束（都是量出来的，不是猜的）：
 *
 *   1. 🔴 **不许用 `Math.random`**。种子一律走 `hashString(seedKey)` +
 *      `mulberry32`，而且**取数顺序固定**（先色团、再旋转、后平铺）。
 *      实测同输入两次生成逐字节相同。
 *   2. 🔴 **字体没加载完就画，画出来是错的，而且看起来是对的**。同一串
 *      「美团轻远科技」在 `system-ui` 下宽 240px、在 `MapleUI` 下 288px
 *      （差 20%）。`MapleUI` 是 `font-display: swap` 的 web font ⇒ 贴图若在
 *      它到达**之前**生成并被缓存，那一版就永久留下。⇒ 生成前先
 *      `await ensureFontsReady()`。
 *   3. 🔴 **canvas 2D 是惰性光栅化的**。本模块不读回像素，但**在外面量它的
 *      耗时**时，光在 `drawTexturalBackground` 外面掐表量到的是"把命令塞进
 *      队列"的时间（实测报 0.2ms，真值 356ms）。要读 1 个像素
 *      （`getImageData(0, 0, 1, 1)`）才逼它真的光栅化。
 *
 * 配色是**参数化**的：演示里是深色霓虹（底 `hsl(hue, 20%, 6%)`），而本仓的
 * 房间是暖白奶油 ⇒ 底色 / 色团 / 文字色三组都必须由调用方给，别写死。
 * 暖色的现成一组见 `WARM_TEXTURAL`。
 *
 * 实测成本（同一台机，含强制冲刷）：
 *   2048×1366 → 356 ms / 14.2 MB      1536×1024 → 220 ms / 8.0 MB
 *   1024×683  → 110 ms /  3.6 MB
 * ⇒ 墙面尺寸的贴图**不能**在用户进房间的那一刻同步生成，要塞进预热期，
 *   并且按性能档位选尺寸。
 */

import { createTextureCache, hashString, makeCanvas, mulberry32 } from '../engine/art';

/** 平铺模式。`hero` 只画一个巨大的字，另两个铺满。 */
export const TEXTURAL_MODES = ['tile', 'flow', 'hero'];

/**
 * 画布字体栈。与 `ContentRoom` 的 `CANVAS_FONT` 同源 —— 房间里的卡片就是这么
 * 画的，墙面肌理跟着走才不会出现两种字形。
 */
export const TEXTURAL_FONT =
    "'Maple Mono', 'MapleUI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/**
 * 默认配色 = **演示里那套深色霓虹**。
 *
 * 注意 `glyph.l`（0.92）比 `base.l`（0.06）**亮**：深底上画亮字。换成浅底
 * 就必须反过来（见 `WARM_TEXTURAL` 的 `glyph.l`），否则字看不见。
 */
const DEFAULTS = {
    mode: 'tile',
    hue: 32,
    /** 底色。`h: null` = 跟 `hue` 走。 */
    base: { h: null, s: 0.20, l: 0.06 },
    /** 色团：几团径向渐变，让底子不匀。 */
    blob: {
        count: 5,
        hueSpread: 90,
        s: 0.52,
        light: [0.10, 0.22],
        alpha: 0.55,
        radius: [0.35, 0.85],   // × max(w, h)
    },
    /** 文字层。 */
    glyph: {
        h: null, s: 0.30, l: 0.92,
        alpha: 0.075,
        scale: 1,               // 字号 = minSide / 8 × scale
        spacing: [2.1, 2.8],    // 网格步长 = 字宽 / 字号 × 这两个数
        maxChars: 12,
        rotate: 0.16,           // 整层旋转 ±rad
        flowAmp: 0.15,          // flow 模式的纵向波动
        font: TEXTURAL_FONT,
    },
    /** 模糊半径 = minSide × blur。0 = 不糊。 */
    blur: 0.035,
    /**
     * 模糊实现：`'auto'` 有 `ctx.filter` 就用它，否则降级成"缩小再放大"。
     * ⚠️ **属性在 ≠ 有效果** —— WebKit 历史上出现过 `filter` 存在但不生效。
     * 要确认真的糊了，只能用探针量像素（`harness/probe-textural-cost.mjs`）。
     */
    blurMode: 'auto',
};

/**
 * 房间要用的**暖色**一组：奶油底 + 琥珀色团 + 比底子暗的字。
 *
 * 🔴 这组数字是**量出来**的，不是把演示那套搬过来调个色相 ——
 * 演示的参数在浅底上**完全看不见**：
 *   - 演示 `glyph.alpha` 只有 0.075，靠的是底色 `l=0.06` 与字色 `l=0.92`
 *     之间 **0.86** 的明度差把字"顶"出来；
 *   - 暖色底 `l=0.92` 配暗字，明度差只有 0.58 ⇒ 同样 0.075 的 alpha
 *     渲出来是一张**纯色**（实测像素范围 194~218，等于什么都没有）；
 *   - 而且演示的 `blur` 是 `0.05 × minSide`（1536 宽上就是 77px），
 *     放大到墙面尺寸时字被糊平。
 * ⇒ 浅底要把 **alpha 抬到 0.20**、**字色压到 l=0.34**、**blur 收到 0.012**，
 *   字才真的读得出来。用 `probe-textural-module.mjs` 的预览图验。
 */
export const WARM_TEXTURAL = {
    base: { h: 34, s: 0.30, l: 0.92 },
    blob: { count: 4, hueSpread: 26, s: 0.55, light: [0.72, 0.86], alpha: 0.50, radius: [0.45, 0.95] },
    // scale 0.85 + spacing 1.9/2.4 ⇒ 墙面宽上大约 3 列 —— 再多就碎成噪点，
    // 再少就只剩两三个大字、不像"一面墙"。blur 0.018 是"边缘化开但仍认得出字"
    // 的临界：0.012 太锐（像贴纸），0.05 直接糊平。
    glyph: { h: 28, s: 0.52, l: 0.34, alpha: 0.18, scale: 0.85, spacing: [1.9, 2.4] },
    blur: 0.018,
};

/** 浅底那一组（白纸 + 淡彩团 + 暗字），适合做卡片背景。 */
export const PAPER_TEXTURAL = {
    base: { h: 40, s: 0.28, l: 0.96 },
    blob: { count: 3, hueSpread: 40, s: 0.45, light: [0.84, 0.93], alpha: 0.45, radius: [0.40, 0.90] },
    glyph: { h: 30, s: 0.40, l: 0.38, alpha: 0.13, scale: 0.8, spacing: [1.9, 2.4] },
    blur: 0.016,
};

function mergeLayer(override, fallback) {
    return override === undefined || override === null ? fallback : { ...fallback, ...override };
}

/** 把调用方的 cfg 补齐成一份完整的、可用的配置。 */
function resolve(cfg) {
    const mode = TEXTURAL_MODES.includes(cfg.mode) ? cfg.mode : DEFAULTS.mode;
    const hue = Number.isFinite(cfg.hue) ? cfg.hue : DEFAULTS.hue;
    return {
        mode,
        hue,
        base: mergeLayer(cfg.base, DEFAULTS.base),
        blob: mergeLayer(cfg.blob, DEFAULTS.blob),
        glyph: mergeLayer(cfg.glyph, DEFAULTS.glyph),
        blur: cfg.blur === undefined ? DEFAULTS.blur : cfg.blur,
        blurMode: cfg.blurMode || DEFAULTS.blurMode,
        text: String(cfg.text || ''),
        // 种子只认 seedKey；没给就用「文字 + 模式」，同文字同模式永远同一张。
        seedKey: cfg.seedKey || `${cfg.text || ''}|${mode}`,
    };
}

let filterSupport = null;

/**
 * `ctx.filter` 能不能用。
 *
 * ⚠️ 这是**属性探测**，不是效果探测。它只能排除"明确没有这个属性"的浏览器；
 * "属性在但被忽略"的情况它抓不到。所以 `blurMode` 留了手动覆盖的口子。
 */
function hasFilter(ctx) {
    if (filterSupport === null) {
        try {
            filterSupport = 'filter' in ctx;
        } catch {
            filterSupport = false;
        }
    }
    return filterSupport;
}

/**
 * 把 `glyph` 层柔化后合成到 `ctx` 上。
 *
 * 分两条路：
 *   - `ctx.filter`：质量好，Safari 17+ 才有；
 *   - **缩小再放大**：双线性插值天然就是一次模糊，零依赖、所有浏览器都有。
 *     代价是四角会略"糊成块"，做背景看不出来。
 */
function compositeBlurred(ctx, layer, W, H, blurPx, blurMode) {
    const useFilter = blurMode === 'filter' || (blurMode === 'auto' && hasFilter(ctx));
    if (useFilter) {
        ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctx.drawImage(layer, 0, 0);
        ctx.filter = 'none';
        return 'filter';
    }
    const k = Math.max(2, Math.round(blurPx * 2));
    const small = makeCanvas(Math.ceil(W / k), Math.ceil(H / k));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(layer, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, W, H);
    return 'downscale';
}

/**
 * 生成一张「文字生成背景」canvas。
 *
 * 纯同步、纯确定性 —— 同一个 `seedKey` + 同一份 cfg + 同一个字体状态，
 * 两次调用逐字节相同。
 *
 * @param {number} w
 * @param {number} h
 * @param {object} cfg 见 `DEFAULTS`；常用项 `text` / `mode` / `hue` /
 *                     `seedKey` / `blur` / 三组颜色。要暖色就
 *                     `{ ...WARM_TEXTURAL, text, seedKey }`。
 * @returns {HTMLCanvasElement}
 */
export function drawTexturalBackground(w, h, cfg = {}) {
    const c = resolve(cfg);
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const minSide = Math.min(W, H);

    const base = makeCanvas(W, H);
    const ctx = base.getContext('2d');

    // 随机数的**唯一**来源。下面每一次 rnd() 的顺序都是契约的一部分。
    const rnd = mulberry32(hashString(c.seedKey));

    // ---- ① 底色 ----------------------------------------------------------
    const baseH = c.base.h === null || c.base.h === undefined ? c.hue : c.base.h;
    ctx.fillStyle = `hsl(${baseH}, ${c.base.s * 100}%, ${c.base.l * 100}%)`;
    ctx.fillRect(0, 0, W, H);

    // ---- ② 色团 ----------------------------------------------------------
    // ⚠️ 取数顺序（cx, cy, r, hue, light）与演示一致，别顺手重排 ——
    //    重排会让所有既有 seedKey 的成品全变一遍。
    const blobs = Math.max(0, Math.round(c.blob.count));
    for (let i = 0; i < blobs; i++) {
        const cx = rnd() * W;
        const cy = rnd() * H;
        const r = Math.max(W, H) * (c.blob.radius[0] + rnd() * (c.blob.radius[1] - c.blob.radius[0]));
        const bh = c.hue + (rnd() - 0.5) * c.blob.hueSpread;
        const bl = (c.blob.light[0] + rnd() * (c.blob.light[1] - c.blob.light[0])) * 100;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `hsla(${bh}, ${c.blob.s * 100}%, ${bl}%, ${c.blob.alpha})`);
        grad.addColorStop(1, `hsla(${bh}, ${c.blob.s * 100}%, ${bl}%, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // ---- ③ 文字层（单独一张画布）------------------------------------------
    // 单独一张是为了让模糊**只糊文字**：直接糊合成结果会把底色的色团也糊掉，
    // 边缘还会因为 alpha 混白而发灰。
    const layer = makeCanvas(W, H);
    const lctx = layer.getContext('2d');
    const raw = c.text.slice(0, Math.max(1, c.glyph.maxChars));
    const fs = (minSide / 8) * c.glyph.scale;
    const glyphH = c.glyph.h === null || c.glyph.h === undefined ? c.hue : c.glyph.h;
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.fillStyle = `hsla(${glyphH}, ${c.glyph.s * 100}%, ${c.glyph.l * 100}%, ${c.glyph.alpha})`;
    lctx.font = `700 ${fs}px ${c.glyph.font}`;

    if (c.mode === 'hero') {
        // 一个字撑满整张：字号按字数反推，让它横向铺满 115%。
        const big = (minSide * 1.15) / Math.max(raw.length, 1);
        lctx.font = `700 ${big}px ${c.glyph.font}`;
        lctx.fillText(raw, W / 2, H / 2);
    } else {
        const tw = Math.max(lctx.measureText(raw).width, fs * 0.6);
        const gx = Math.max(1, tw * c.glyph.spacing[0]);
        const gy = Math.max(1, fs * c.glyph.spacing[1]);
        lctx.save();
        lctx.translate(W / 2, H / 2);
        lctx.rotate((rnd() * 2 - 1) * c.glyph.rotate);
        // 行列都多铺 6 圈：整层旋转过，不多铺角上会缺一块。
        const cols = Math.ceil(W / gx) + 6;
        const rows = Math.ceil(H / gy) + 6;
        for (let j = -rows; j <= rows; j++) {
            for (let i = -cols; i <= cols; i++) {
                const offset = (Math.abs(j) % 2) * gx * 0.5;   // 隔行错半格
                const dy = c.mode === 'flow'
                    ? Math.sin(i * 0.6 + j * 0.4) * gy * c.glyph.flowAmp
                    : 0;
                lctx.fillText(raw, i * gx + offset, j * gy + dy);
            }
        }
        lctx.restore();
    }

    // ---- ④ 合成 ----------------------------------------------------------
    const blurPx = minSide * c.blur;
    if (blurPx > 0.5) {
        compositeBlurred(ctx, layer, W, H, blurPx, c.blurMode);
    } else {
        ctx.drawImage(layer, 0, 0);
    }

    return base;
}

/**
 * 带缓存的**画布**版本（不是 Texture）。
 *
 * 给"要把这张图当底子、再在上面画别的东西"的调用方用 —— 房间卡片就是：
 * 一张卡的纹理 = 文字肌理 + 卡面排版，每次重画（切语言、翻页）都想复用
 * 底子，而不是把 8 张肌理重新生成一遍。
 *
 * `key` 必须唯一标识这张图（含配色档、尺寸、种子）。缓存按插入顺序淘汰，
 * 上限 `TEXTURAL_CANVAS_LIMIT` 张 —— 卡片的 key 是有限的（房间 × 档 × 卡），
 * 不会无限增长。
 */
const canvasCache = new Map()
const TEXTURAL_CANVAS_LIMIT = 32

export function texturalCanvas(key, w, h, cfg = {}) {
    const hit = canvasCache.get(key)
    if (hit) return hit
    const canvas = drawTexturalBackground(w, h, cfg)
    if (canvasCache.size >= TEXTURAL_CANVAS_LIMIT) {
        const oldest = canvasCache.keys().next().value
        canvasCache.delete(oldest)
    }
    canvasCache.set(key, canvas)
    return canvas
}

/** 释放画布缓存（改生成器 / 换档位 / 探针里要量冷启动时用）。 */
export function clearTexturalCanvasCache() {
    canvasCache.clear()
}

/**
 * 带缓存的版本。`key` 必须**唯一标识**这一张图（含语言、色相、尺寸）——
 * 缓存只认 key，不认 cfg。
 *
 * 返回的 Texture 已经是 `SRGBColorSpace`（本仓场景不打光，贴图当颜色用）。
 */
const cache = createTextureCache('textural', { anisotropy: 8 });

export function texturalTexture(key, w, h, cfg = {}) {
    return cache(key, () => drawTexturalBackground(w, h, cfg));
}

/** 释放这个模块缓存的所有纹理（改完生成器或换档位时用）。 */
export function clearTexturalCache() {
    cache.clear();
}

/** 当前缓存了几张。给探针和性能面板用。 */
export function texturalCacheSize() {
    return cache.map.size;
}

/**
 * 等字体就绪。**生成贴图前先 await 这个**，否则会拿到按 fallback 字体量的
 * 字宽，把一张"看起来对、其实字形全错"的图永久缓存下来（见文件头约束 2）。
 *
 * 没有 `document`（SSR / 探针在 node 里跑）时直接返回 false，不抛。
 */
export async function ensureFontsReady() {
    if (typeof document === 'undefined' || !document.fonts) return false;
    try {
        await document.fonts.ready;
        return true;
    } catch {
        return false;
    }
}
