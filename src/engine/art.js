/**
 * engine/art — 零图片资源场景的「绘画基底」
 *
 * ============================================================================
 * 这个文件解决的是**同一段代码被抄了十遍**的问题。
 * ============================================================================
 *
 * 改造前，`utils/` 下 10 个 `*Art.js` 每个都自带一份逐字相同的
 * `mulberry32` / `hashString` / `makeCanvas` / `toTexture`，以及自己的
 * `const cache = new Map()`。改一个 bug 要改十处，加一个能力（比如
 * `alphaBBox`）只有一份文件有。
 *
 * ---------------------------------------------------------------------------
 * 三条契约（新写一个程序化贴图时必须守）
 * ---------------------------------------------------------------------------
 *
 * 1. **确定性**：同一个 key 永远产出同一张图。生成器里**禁止 `Math.random()`**，
 *    只用 `seededRand(key)`。
 *    理由不只是「可复现」——它让纹理缓存成立，也让无头截图之间可比对
 *    （两次跑出来的画面必须逐字节相同，否则没法判断改动是不是有意的）。
 *
 * 2. **缓存即查找**：生成器可以在 render body 里直接调用。
 *    缓存命中就是一次 Map 查找，不需要 `useMemo` 包一层。
 *
 * 3. **宽高比契约**：生成器**必须按它落到的那个平面的真实宽高比作画**，
 *    并把它导出成 `*_ASPECT` 常数，由调用方去定平面尺寸。
 *    别照抄原始素材的像素比例 —— 原图经常和平面宽高比不一致（那是拉伸）。
 *    需要「线稿 / 上色两层」的（门、木桶），必须出**两张同宽高比的 canvas**。
 *
 * ---------------------------------------------------------------------------
 * 一个典型的生成器长这样
 * ---------------------------------------------------------------------------
 *
 *   import { createTextureCache, makeCanvas, seededRand, fitToCanvas, rgba } from '../engine/art';
 *
 *   const cache = createTextureCache('mydoor');
 *   export const MY_DOOR_ASPECT = 512 / 1310;   // 按它落到的平面量出来的
 *
 *   export function makeMyDoorTexture(key = 'door') {
 *       return cache(key, () => {
 *           const W = 512, H = 1310;
 *           const canvas = makeCanvas(W, H);
 *           const ctx = canvas.getContext('2d');
 *           const rand = seededRand(key);
 *           ...作画...
 *           return canvas;
 *       });
 *   }
 *
 * `fitToCanvas` 是「画大再框小」：在超尺寸 scratch canvas 上随便画，
 * 事后用实际墨迹外接框等比缩进目标尺寸。凡是形状带随机尖刺的（草、火焰、
 * 墨点）都应该这么画，否则尖刺会顶到画布边被切平。
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* 确定性随机                                                          */
/* ------------------------------------------------------------------ */

/** FNV-1a。把任意字符串键压成一个 32 位种子。 */
export function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** 确定性 PRNG。同一个 seed 永远给出同一串数。 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rand() {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 最常用的入口：给一个字符串键，拿一个确定性 rand()。
 * 用它的生成器自动满足契约 1，也就自动可以被缓存。
 */
export function seededRand(key) {
    return mulberry32(hashString(key));
}

/** 常用派生：从同一个 rand 里取 [lo, hi) 的浮点 / 整数。 */
export const randRange = (rand, lo, hi) => lo + rand() * (hi - lo);
export const randInt = (rand, lo, hi) => Math.floor(lo + rand() * (hi - lo + 1));
/** 从数组里确定性取一个元素。 */
export const pick = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];

/* ------------------------------------------------------------------ */
/* canvas                                                              */
/* ------------------------------------------------------------------ */

/** 建一张离屏 canvas。尺寸取整并至少 1px。 */
export function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
}

/** `rgba(255, 0, 0, 0.5)`，分量自动取整。比模板字符串少踩一个坑。 */
export function rgba(r, g, b, a = 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/** 16 进制色 → `rgba(...)`，用于给已有的 hex 调色板加透明度。 */
export function withAlpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

/** 把 canvas 洗成「比原色暗 k 倍 / 亮 k 倍」，用于快速造同色系变体。 */
export function shade(hex, k) {
    const n = parseInt(hex.replace('#', ''), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
        Math.max(0, Math.min(255, Math.round(v * k)))
    );
    return rgba(c[0], c[1], c[2]);
}

/* ------------------------------------------------------------------ */
/* 路径                                                                */
/* ------------------------------------------------------------------ */

/**
 * 圆角矩形路径（只 beginPath，不 fill / stroke，交给调用方决定）。
 *
 * 四角用 `quadraticCurveTo` 收 —— 严格说那是抛物线而不是圆弧，但这是项目里
 * 32 处已经定下来的形状，改成 `arcTo` 会让所有贴图的圆角都变一点点。
 * 圆角半径自动收敛到 `min(r, w/2, h/2)`，所以传一个很大的 r 也不会画崩。
 *
 * ⚠️ `utils/techLogosArt.js` 里有一个同名的 `roundRect`，它用的是 `arcTo`
 * （真圆弧）。两者**不是**同一个图元，别合并 —— 合并必然要改一处的形状。
 */
export function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* 量墨迹                                                              */
/* ------------------------------------------------------------------ */

/**
 * canvas 里实际有墨的像素外接框（alpha > 8 才算）。
 * 返回 {x0, y0, x1, y1}，闭区间；整张全透明时返回整幅。
 */
export function alphaBBox(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            if (d[(row + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    return { x0, y0, x1, y1 };
}

/**
 * 「画大再框小」—— 把一张随便画大了的 scratch canvas，按**实际墨迹外接框**
 * 等比缩进 outW x outH 的新 canvas。
 *
 * 为什么需要：凡是形状带随机尖刺的（草叶、火焰、墨点、随机枝桠），
 * 尖刺可能捅到画布边缘被切平。与其把每个尺寸都调保守，不如先在超尺寸
 * canvas 上随便画，再让这个函数事后把它框正。
 *
 * `pad` 是四周留白（占目标尺寸的比例）。`align` 决定留白怎么分。
 */
export function fitToCanvas(src, outW, outH, { pad = 0.04, align = 'center', bg = null } = {}) {
    const bb = alphaBBox(src);
    const bw = bb.x1 - bb.x0 + 1;
    const bh = bb.y1 - bb.y0 + 1;
    const out = makeCanvas(outW, outH);
    const ctx = out.getContext('2d');
    if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, out.width, out.height);
    }
    const k = Math.min((out.width * (1 - pad * 2)) / bw, (out.height * (1 - pad * 2)) / bh);
    const dw = bw * k;
    const dh = bh * k;
    const dx = align === 'left' ? pad * out.width : (out.width - dw) / 2;
    const dy = align === 'top' ? pad * out.height : (out.height - dh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, bb.x0, bb.y0, bw, bh, dx, dy, dw, dh);
    return out;
}

/* ------------------------------------------------------------------ */
/* 降采样                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把一张**已经画完**的 canvas 等比缩到 `scale` 倍（0 < scale < 1），返回新 canvas。
 * `scale >= 1` 时原样返回（不复制）。
 *
 * 为什么是「照原尺寸画完再整体缩」，而不是「直接把画布尺寸调小」：
 * 门类美术是**按画布像素坐标硬编码**的 —— `const BAND = 40`、`plateX = W - plateW - 4`、
 * 一堆 `ctx.arc(W / 2, ...)`、笔画宽度全是裸数字。改 `W` 不会等比缩放这些笔触，
 * 只会把整幅画改错（40px 的边带在 256 宽上就变成两倍宽）。所以降分辨率的唯一
 * 正确做法是「照原尺寸画，再整体缩」—— 这也是「宽高比契约」的推论：
 * 画布尺寸是**画法的一部分**，不是可以随便调的旋钮。
 *
 * 逐级缩、每级最多缩一半：一次 `drawImage` 缩太多，浏览器只能用有限的低通核，
 * 高频木纹/噪点会走样（aliasing）。分成两级等效于更接近 box filter，代价是一次
 * 额外的 canvas 分配 —— 生成器都在 `createTextureCache` 后面，只跑一次。
 */
export function downscaleCanvas(src, scale) {
    if (!(scale > 0) || scale >= 1) return src;
    const steps = [];
    let rest = scale;
    while (rest < 0.5) {
        steps.push(0.5);
        rest /= 0.5;
    }
    steps.push(rest);
    let cur = src;
    for (const st of steps) {
        const w = Math.max(1, Math.round(cur.width * st));
        const h = Math.max(1, Math.round(cur.height * st));
        const next = makeCanvas(w, h);
        const ctx = next.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, w, h);
        cur = next;
    }
    return cur;
}

/**
 * 把 canvas 裁到「有墨的范围 + pad」，返回 `{ canvas, offset, repeat }`。
 *
 * 为什么需要：有些贴图是**整扇门大小**的透明平面，但只在角落里画一个零件 ——
 * 门把就是这种（`corridorArt` 的 `makeRoomDoorHandleTexture`：512×1216 里
 * 杠杆只占 170×100，**97% 是空白**）。空白照样上传、照样占显存。
 * 裁掉之后**每纹素密度不变**（所以画质零损失），显存掉到 1/20 以上。
 *
 * ⚠️ 裁完必须把 UV 缩回去，否则零件会跑到门中间。这里最容易写错的一点是：
 * `offset` / `repeat` 是**相对裁剪后那张小图**算的，不是相对原图 ——
 * 我们要的是「平面的 uv 落在 [x0, x0+bw] 这一块时，采到小图的 0..1」，
 * 也就是 `uv' = (uv·原图尺寸 − x0) / bw`，即 `repeat = 原图/bw`、`offset = −x0/bw`。
 * 写成 `repeat = bw/原图` 会让零件被放大到铺满整扇门（踩过）。
 * 又：three 的 UV 原点在**左下**、canvas 在**左上**，所以 y 那一项还要翻过来。
 *
 * `pad` 给边缘留几个像素，避免 mipmap 低层级把 clamp 边吃到墨迹上。
 */
export function cropToInk(src, pad = 8) {
    const bb = alphaBBox(src);
    const x0 = Math.max(0, bb.x0 - pad);
    const y0 = Math.max(0, bb.y0 - pad);
    const x1 = Math.min(src.width - 1, bb.x1 + pad);
    const y1 = Math.min(src.height - 1, bb.y1 + pad);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // 本来就画满了（木纹这类满幅贴图）就别复制一份。
    if (bw >= src.width && bh >= src.height) {
        return { canvas: src, offset: [0, 0], repeat: [1, 1] };
    }
    const out = makeCanvas(bw, bh);
    out.getContext('2d').drawImage(src, x0, y0, bw, bh, 0, 0, bw, bh);
    return {
        canvas: out,
        offset: [-x0 / bw, -(src.height - y1 - 1) / bh],
        repeat: [src.width / bw, src.height / bh],
    };
}

/* ------------------------------------------------------------------ */
/* 纹理                                                                */
/* ------------------------------------------------------------------ */

/**
 * 所有 makeTexture 造出来的贴图都登记在这里，方便开发时一次性释放。
 *
 * ⚠️ 声明必须在 `makeTexture` **之前** —— 虽然实际调用发生在运行时（那时
 * 已经初始化完了），但把 `const` 放在使用者下面是一种「靠时序侥幸成立」的写法，
 * 改一次调用时机就会踩 TDZ。
 */
const liveTextures = new Set();

/**
 * canvas → THREE.CanvasTexture。
 *
 * 默认 `SRGBColorSpace` + `ClampToEdgeWrapping`，因为本项目的场景是不打光的
 * （meshBasicMaterial 直出颜色），贴图必须当颜色用而不是当数据用。
 * 平铺的表面（地板砖、木纹）显式传 `wrap: 'repeat'` 与 `repeat: [x, y]`。
 */
export function makeTexture(canvas, { wrap = 'clamp', repeat, anisotropy = 4 } = {}) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    if (wrap === 'repeat') {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        if (repeat) texture.repeat.set(repeat[0], repeat[1]);
    } else {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    texture.needsUpdate = true;
    liveTextures.add(texture);
    return texture;
}

/**
 * 建一个带命名空间的纹理缓存。
 *
 *   const cache = createTextureCache('corridor');
 *   export const makeX = (key = 'x') => cache(key, () => { ...; return canvas });
 *
 * - 命名空间会拼进 key，所以不同模块之间不可能撞车（这一点很重要：
 *   改造前每个模块各有一个私有 Map，合并成一个共享 Map 会立刻撞车）。
 * - factory 可以返回 canvas，也可以返回已经建好的 Texture（比如自己设过
 *   filter 的），两者都接受。
 * - 命中就是一次 Map 查找，所以生成器可以在 render body 里直接调用。
 *
 * ⚠️ 现状：`utils/` 下 7 个 `*Art.js` 各自还留着一份私有的 `toTexture`
 * + `cache.has/get/set` 三连（约 90 处调用点）。**故意没合并** —— 它们的
 * 差异是「配置」而不是「重复」（anisotropy 4 与 8、clamp 与 repeat、
 * 要不要 rotation、有没有 mipmap filter），而且 key 已经被各自手写成
 * `'entrance:ladybird'` 这种带命名空间的形式，合并的收益远小于动 90 处
 * 调用点的风险。要合并的话从 `toTexture` 的调用点开始，别从 cache 开始。
 */
export function createTextureCache(namespace, texOpts = {}) {
    const map = new Map();
    const cache = (key, factory) => {
        const full = `${namespace}:${key}`;
        const hit = map.get(full);
        if (hit) return hit;
        const out = factory();
        const texture = out && out.isTexture ? out : makeTexture(out, texOpts);
        texture.name = full;
        map.set(full, texture);
        liveTextures.add(texture);
        return texture;
    };
    cache.namespace = namespace;
    cache.map = map;
    cache.clear = () => {
        for (const t of map.values()) {
            liveTextures.delete(t);
            t.dispose();
        }
        map.clear();
    };
    return cache;
}

/** 释放所有缓存过的纹理。开发时改生成器后调，避免旧图留在显存里。 */
export function disposeAllTextures() {
    for (const t of liveTextures) t.dispose();
    liveTextures.clear();
}

/** 当前缓存住的纹理张数 / 估算显存占用（字节）。给性能面板和测试用。 */
export function textureStats() {
    let bytes = 0;
    for (const t of liveTextures) {
        const img = t.image;
        if (img && img.width) bytes += img.width * img.height * 4 * 1.333;
    }
    return { count: liveTextures.size, bytes };
}

/* ------------------------------------------------------------------ */
/* 自检                                                                */
/* ------------------------------------------------------------------ */

/**
 * 最小的可运行检查。逻辑坏掉时第一个失败的就是这里。
 * 跑法：node --input-type=module -e "import('./src/engine/art.js').then(m=>m.demo())"
 * （需要 document，所以实际在浏览器控制台里跑：`__engineArtDemo()`）
 */
export function demo() {
    const assert = (c, m) => {
        if (!c) throw new Error('art.demo: ' + m);
    };

    // 契约 1：同一个 key 必须给出同一串数
    const a = seededRand('same');
    const b = seededRand('same');
    const c = seededRand('other');
    assert(a() === b(), 'seededRand 不满足确定性');
    assert(a() !== c(), '不同 key 给出了同一个序列（种子没起作用）');

    // hashString 必须落在 uint32
    for (const s of ['', 'x', '外墙-青砖', 'a'.repeat(200)]) {
        const h = hashString(s);
        assert(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, 'hashString 越界: ' + s);
    }

    // alphaBBox 必须只框住有墨的部分
    const cv = makeCanvas(40, 20);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(10, 5, 10, 8);
    const bb = alphaBBox(cv);
    assert(bb.x0 === 10 && bb.y0 === 5 && bb.x1 === 19 && bb.y1 === 12, 'alphaBBox 框错了: ' + JSON.stringify(bb));

    // fitToCanvas 必须等比且不越界
    const fitted = fitToCanvas(cv, 100, 100, { pad: 0.1 });
    const fb = alphaBBox(fitted);
    assert(fb.x0 >= 9 && fb.x1 <= 90 && fb.y0 >= 9 && fb.y1 <= 90, 'fitToCanvas 溢出了: ' + JSON.stringify(fb));
    const srcAspect = 10 / 8;
    const dstAspect = (fb.x1 - fb.x0 + 1) / (fb.y1 - fb.y0 + 1);
    assert(Math.abs(srcAspect - dstAspect) < 0.25, 'fitToCanvas 没保持宽高比');

    return '✅ engine/art 自检通过';
}

if (typeof window !== 'undefined') window.__engineArtDemo = demo;
