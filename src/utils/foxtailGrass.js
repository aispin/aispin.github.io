/**
 * 狗尾巴草的**尺子**、**避让**与**实例清单**
 * （纯数据层：无 React、无场景、无副作用）。
 * ==================================================================
 *
 * 2026-10-11 用户：「窗下的竹篱笆换成狗尾巴草看看效果，门口两边都要，
 * 和墙宽一样。**注意不能和花箱穿透了**。」
 *
 * 为什么单开一个文件（而不是塞进组件）
 * ----------------------------------
 * 沿用竹篱那条分层（见 `utils/caneFence.js`）：尺子 / 清单 / 几何构建放
 * `utils/`，着色器放 `shaders/foxtailGrass.js`，组件只管挂载。
 * 一个组件文件同时导出尺子和组件会踩 `react-refresh/only-export-components`。
 *
 * 🔴 「不能穿透」是**量出来的**，而且是**按每片叶的真实包围盒判的**
 * -------------------------------------------------------------
 * ① 障碍物的位置是**探针量出来的**，不是读源码推的
 *    （`harness/probe-wallbase-strip.mjs`：遍历所有会被绘制的网格、算世界
 *    包围盒，把落在墙脚带里的全打出来 —— 那些位置分文件、分坐标系，
 *    靠读源码一个个推既慢又容易漏）。实测（spring，世界坐标）：
 *
 *      物件          x 范围            z 范围           y 范围
 *      台明 + 踏跺   −1.36 … 1.36     21.90 … 23.71   −2.05 … −1.75
 *      白狗          −1.88 … −1.09    22.46 … 23.19   −2.17 … −1.30
 *      荷花缸        3.30 … 3.90      22.32 … 22.93   −2.05 … −1.63
 *      花箱          4.38 … 5.62      22.10 … 22.70   −2.05 … −1.53
 *
 * ② **按片判，不按段判**。第一版是按 x 分段（把障碍物的 x 区间从墙里挖掉，
 *    每侧留 0.06）。错的：草叶是**斜着长**的，倾斜 ±0.42 rad、最高约 0.8 世界
 *    单位 ⇒ 叶尖最多向侧面伸 `0.8·sin(0.42) ≈ 0.33` —— 比 0.06 的余量大 5 倍。
 *    所以按段挖空要么**叶尖扎进花箱**，要么为了保险把余量放到 0.4（那样花箱
 *    和荷花缸之间的那一小丛草就没了，而且余量是个"靠猜"的数）。
 *
 *    正解：每片叶算一个**扫掠包围盒**（根部点 → 叶尖点，再按叶宽/厚外扩），
 *    和障碍物盒做三维相交测试，**相交就不生成**。于是：
 *      · 保证是结构性的 —— 不是"看起来没碰上"，是"根本不存在"；
 *      · 不需要任何手调的余量（`BLOCK_PAD` 只留 0.03 作为视觉呼吸）；
 *      · 草可以**贴着**花箱边生长（留半丛挨着，比一刀切好看）。
 *
 * ⚠️ 障碍物**挪了位置就必须回来改这张表** —— 探针一条命令重出：
 *    `node .workbuddy-ai/harness/probe-wallbase-strip.mjs <baseUrl>`
 */

import * as THREE from 'three';

import { randRange } from '../engine/art';

/* ------------------------------------------------------------------ */
/* 尺子                                                                 */
/* ------------------------------------------------------------------ */

/** 草带的**高度基准**（最高的那几片大约是这个数 × 1.6，抽穗的秆更高）。 */
export const GRASS_H = 0.50;

/** 一丛草的间距。越小越密 —— 22 单位铺满大约 145 丛。 */
export const GRASS_CLUMP_STEP = 0.145;

/**
 * 草带贴着墙的**进深范围**（局部 z）。墙的青砖面在局部 z = 0.15，
 * 所以 0.18 是"贴着墙但没埋进去"。
 */
export const GRASS_Z0 = 0.18;
export const GRASS_Z1 = 0.60;

/** 一条草带的两端（局部 x = 世界 x）。 */
export const GRASS_X_MIN = -10.5;
export const GRASS_X_MAX = 10.5;

/**
 * 整条草带往下埋多少。
 *
 * 摆件的基准是 `OUTDOOR_Y`（−2.05），而草坪是 `GRASS_Y`（−2.09）—— 差 4 cm。
 * 草是**从地里长出来**的东西，没有"底面"要看，所以直接埋掉这一段：
 * 两个基准之间怎么差都不可能露出一条缝。0.07 相对最矮的一片叶（0.25）也
 * 只是埋掉四分之一，不影响观感。
 */
export const GRASS_SINK = 0.07;

/* ------------------------------------------------------------------ */
/* 避让                                                                 */
/* ------------------------------------------------------------------ */

/** 视觉呼吸余量。**不是**用来兜"叶尖会伸多远"的 —— 那个由扫掠包围盒管。 */
const BLOCK_PAD = 0.03;

/**
 * 墙脚的障碍物，**局部**坐标（x = 世界 x；z = 世界 z − 22.0；y = 相对 `OUTDOOR_Y`）。
 *
 * ⚠️ 门口那块 (`台明 + 踏跺`) 的 y 上限给到了 1.2 —— 那不是台子的高度
 *    （台子只有 0.30），是**故意的**：门前那条通道上本来就不该长草，
 *    不管草长多高。写 0.30 的话，高于台子的草会被判成"不碰"，门前就长出草来了。
 */
const BLOCKERS = [
    { name: '台明 + 踏跺（门口）', x: [-1.36, 1.36], z: [-0.10, 1.75], y: [-0.10, 1.20] },
    { name: '白狗', x: [-1.88, -1.09], z: [0.46, 1.19], y: [-0.12, 0.85] },
    { name: '荷花缸', x: [3.30, 3.90], z: [0.32, 0.93], y: [-0.02, 0.45] },
    { name: '花箱', x: [4.38, 5.62], z: [0.10, 0.70], y: [-0.02, 0.55] },
];

/** 一组障碍物的名字（给判据打印用）。 */
export const FOXTAIL_BLOCKER_NAMES = BLOCKERS.map((b) => b.name);

/** 一个轴对齐盒和任一障碍物是否相交（带 `BLOCK_PAD` 呼吸余量）。 */
function hitsBlocker(box) {
    for (const b of BLOCKERS) {
        if (box.x1 > b.x[0] - BLOCK_PAD && box.x0 < b.x[1] + BLOCK_PAD
            && box.z1 > b.z[0] - BLOCK_PAD && box.z0 < b.z[1] + BLOCK_PAD
            && box.y1 > b.y[0] - BLOCK_PAD && box.y0 < b.y[1] + BLOCK_PAD) return true;
    }
    return false;
}

/* ------------------------------------------------------------------ */
/* 实例清单                                                             */
/* ------------------------------------------------------------------ */

/** 一片叶的宽（世界单位）与"厚/宽"比。 */
const BLADE_W = [0.013, 0.021];
const BLADE_T_FRAC = [0.45, 0.72];
/** 一丛几片叶。 */
const BLADES_PER_CLUMP = [4, 7];
/**
 * 抽穗的那根**秆**比叶高、比叶细 —— 狗尾巴草就是这样：穗长在一根专门抽出来的
 * 花茎上，高出叶丛。
 * ⚠️ 这两条是"读不读得出来是狗尾巴草"的关键：第一版让穗直接坐在最高的**叶尖**
 *    上，结果穗和叶一样高、又被叶子挡住，画面上只看到一片绿的尖端发白 ——
 *    像叶子褪色，不像穗。
 */
const SEED_STEM_H = 1.30;
const SEED_STEM_W = 0.72;
/** 一丛里长出穗的概率与穗的尺寸。 */
const SEED_CHANCE = 0.72;
const SEED_LEN = [0.15, 0.21];
/**
 * 穗的半径。直径 = 2r ⇒ 0.062…0.084，配 0.15…0.21 的长 ⇒ **长宽比 2.3~3.0**。
 * ⚠️ 这是"像狗尾巴"还是"像麦穗"的分界线：第一版取 0.026…0.036（长宽比 3.5~4.4），
 *    渲染出来是一根根细长的芒，读成麦子。真实的狗尾巴草穗是**短而胖**的。
 */
const SEED_R = [0.031, 0.042];

/**
 * 一片叶/一个穗的**扫掠包围盒**（局部坐标）。
 *
 * 倾斜的实例是绕**根部**转的（几何体的 y 是 0..1），所以叶尖必须按
 * `Rz(tilt)` 再 `Ry(yaw)` 那套算 —— 和实例矩阵里的 `compose` 是同一个变换，
 * 少一步这里判出来的盒子就是错的（而错的方向恰好是"放行"）。
 */
function sweptBox(x, y, z, h, yaw, tilt, halfW, halfT) {
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    const tipx = x - h * st * Math.cos(yaw);
    const tipy = y + h * ct;
    const tipz = z + h * st * Math.sin(yaw);
    return {
        x0: Math.min(x, tipx) - halfW, x1: Math.max(x, tipx) + halfW,
        y0: Math.min(y, 0), y1: Math.max(tipy, 0),
        z0: Math.min(z, tipz) - halfT, z1: Math.max(z, tipz) + halfT,
    };
}

/**
 * **整条草带**的实例清单（局部坐标：x 沿墙、z 是离砖面的进深、y 从地面往上）。
 *
 * 🔴 随机序列的**消耗顺序是契约的一部分**：改了顺序 = 换一片草。想换样子请换
 *    **种子**，不要重排这里（同 `buildFenceRun` 的约定）。
 *    被避让规则**丢掉**的那些叶子也照样消耗了随机数（先抽再判），
 *    否则挪一下花箱会让整面墙的草全部重排。
 *
 * 确定性：同一种子刷新一百次长得一模一样（项目契约 1）。
 *
 * @param {() => number} rand  `seededRand(seed)` 的返回值
 */
export function buildFoxtailWall(rand) {
    const blades = [];
    const seeds = [];
    const span = GRASS_X_MAX - GRASS_X_MIN;
    const n = Math.max(1, Math.round(span / GRASS_CLUMP_STEP));
    const step = span / n;

    for (let i = 0; i < n; i++) {
        // 丛心：等距 + 抖动。纯等距会读成"刷子"，抖过头又会有空洞。
        const cx = GRASS_X_MIN + (i + 0.5) * step + (rand() - 0.5) * step * 0.55;
        const cz = GRASS_Z0 + rand() * (GRASS_Z1 - GRASS_Z0);
        const k = BLADES_PER_CLUMP[0]
            + Math.floor(rand() * (BLADES_PER_CLUMP[1] - BLADES_PER_CLUMP[0] + 1));

        // 花茎：本丛里被挑中的那**一片**叶，抽穗前先拉高收细。
        // `stem` 只在它自己通过了避让判定之后才成立 —— 否则穗会长在空气里。
        let stem = null;
        let stemH = -1;

        for (let j = 0; j < k; j++) {
            const h = GRASS_H * (0.52 + rand() * 0.72);
            const w = randRange(rand, BLADE_W[0], BLADE_W[1]);
            const b = {
                x: cx + (rand() - 0.5) * 0.13,
                z: cz + (rand() - 0.5) * 0.10,
                h,
                yaw: rand() * Math.PI * 2,
                // 朝**外**倒：草是一簇散开的，不是一排直立的牙签。
                // 倾斜是绕**根部**转的（几何体的 y 是 0..1），所以不会浮起来。
                tilt: randRange(rand, -0.42, 0.42),
                w,
                t: w * randRange(rand, BLADE_T_FRAC[0], BLADE_T_FRAC[1]),
                phase: rand() * Math.PI * 2,
                tint: rand(),
            };
            const willBeStem = rand() < SEED_CHANCE && h > stemH;
            if (willBeStem) { b.h *= SEED_STEM_H; b.w *= SEED_STEM_W; }

            const box = sweptBox(b.x, 0, b.z, b.h, b.yaw, b.tilt, b.w / 2, b.t / 2);
            if (hitsBlocker(box)) continue;   // 会碰到障碍物 ⇒ 这片叶不存在

            blades.push(b);
            if (willBeStem) { stem = b; stemH = h; }
        }

        // 穗：长在那根花茎的尖上。
        if (stem) {
            const w = randRange(rand, SEED_R[0], SEED_R[1]);
            const len = randRange(rand, SEED_LEN[0], SEED_LEN[1]);
            const st = Math.sin(stem.tilt);
            const ct = Math.cos(stem.tilt);
            const sy = Math.sin(stem.yaw);
            const cy = Math.cos(stem.yaw);
            // 叶尖 = Rz(tilt) 把 (0,h,0) 转成 (−h·sin, h·cos, 0)，再 Ry(yaw)。
            // × 0.97 让穗**咬**进叶尖一点，接口不留缝。
            const sx = stem.x - stem.h * st * cy;
            const syy = stem.h * ct * 0.97;
            const sz = stem.z + stem.h * st * sy;
            const box = sweptBox(sx, syy, sz, len, stem.yaw, stem.tilt, w, w);
            if (!hitsBlocker(box)) {
                seeds.push({
                    x: sx, y: syy, z: sz,
                    yaw: stem.yaw,
                    tilt: stem.tilt,
                    w,
                    h: len,
                    // 🔴 与它那片叶**同一个相位** —— shader 里穗走"刚性跟随"
                    //    （bend 恒为 1），相位不同就会看到穗在叶尖上乱飘。
                    phase: stem.phase,
                    tint: rand(),
                });
            }
        }
    }

    return { blades, seeds };
}

/* ------------------------------------------------------------------ */
/* 几何体                                                               */
/* ------------------------------------------------------------------ */

/**
 * 把实例属性挂到几何体上。
 *
 * ⚠️ 带实例属性的几何**不能**走 `sharedGeometry`：实例属性会被就地改写，
 *    共享出去会把所有使用者一起弄坏（`engine/resources.js` 的警告）。
 */
function withInstanceAttrs(g, items, isSeed) {
    const n = items.length;
    const phase = new Float32Array(n);
    const tint = new Float32Array(n);
    const seed = new Float32Array(n);
    items.forEach((it, i) => {
        phase[i] = it.phase;
        tint[i] = it.tint;
        seed[i] = isSeed ? 1 : 0;
    });
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    return g;
}

/**
 * 一片叶：**3 棱的锥台**，y ∈ [0, 1]（根部在原点）。
 *
 * 为什么是 3 棱实体而不是一张平面：见 `FoxtailGrass.jsx` 顶上那段（竹篱
 * 当年就是栽在"零厚度平面绕到侧面就消失"上）。3 棱是"任何角度都看得见"
 * 的最省的做法；顶半径 0.10 让它收成一个尖。
 *
 * ⚠️ `translate(0, 0.5, 0)` 之后 y ∈ [0,1]，于是实例的 tilt 是**绕根部**
 *    转的 —— 草从地面往外散开，而不是以腰为轴摇摆。shader 里的
 *    `h = clamp(p.y, 0, 1)` 与这条约定绑死，改一个必须改另一个。
 */
export function makeBladeGeometry(items) {
    const g = new THREE.CylinderGeometry(0.10, 1, 1, 3, 3, false);
    g.translate(0, 0.5, 0);
    return withInstanceAttrs(g, items, false);
}

/** 确定性的 0..1 噪声（给穗的顶点抖动用；不需要 `engine/art` 的种子体系）。 */
const hash01 = (n) => {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
};

/**
 * 一个穗：低面数的**纺锤体**，y ∈ [0, 1]。
 *
 * 顶点被**径向抖动**过（±14%）—— 这是"毛茸茸"唯一的来源：狗尾巴草的穗
 * 之所以认得出，靠的是**参差的轮廓**，不是颜色。穗只有 0.16…0.23 世界单位
 * 长，在正面机位上二十来个像素，所以轮廓比任何内部细节都重要。
 *
 * 抖动是**烘在几何体里**的（所有实例共用同一份）—— 但每个实例的 yaw 随机，
 * 于是看不出重复。
 */
export function makeSeedGeometry(items) {
    const g = new THREE.SphereGeometry(0.5, 6, 5);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.multiplyScalar(0.86 + 0.28 * hash01(i * 1.618 + 3.7));
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.translate(0, 0.5, 0);
    return withInstanceAttrs(g, items, true);
}
