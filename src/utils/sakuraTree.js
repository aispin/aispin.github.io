import * as THREE from 'three';

import { seededRand, randRange } from '../engine/art';
import {
    makeAcc,
    pushTri,
    growSkeleton,
    boxOfPoints,
    boxOfPositions,
    makeClusterGeometry,
    emitBlade,
    clusterExtent,
    scatterCluster,
    crownFromTips,
    makeRhoOf,
    packInstances,
    shadeOf,
} from './treeSkeleton';

/**
 * 樱花树（染井吉野）的 3D 骨架 / 花 / 叶 / 落樱 —— 纯数学。
 * ==================================================================
 *
 * WO-17。用户原话：「参考 `sakura-station-corner` 在前院种两棵樱花树」
 * → 2026-10-12 追加：「放**花箱前面草地的中间**（做**一棵**看效果，
 *   落樱参考真实樱花树的季节）」。
 *
 * 🔴 骨架**不是**这份文件写的
 * --------------------------
 * 锥形管 / 关节椭球 / 子枝起点回退 + 起始方向偏向父枝 —— 那三条
 * "树干衔接自然"的原则的实现**只有一份**，在 `utils/treeSkeleton.js`。
 * 这里只做两件事：给柿子树的机器换一套**形态参数**，再换一套**冠**。
 *
 * 和柿子树的差别（都是"樱花长什么样"决定的）
 * -----------------------------------------
 * | | 柿子树 | 樱花树 |
 * |---|---|---|
 * | 树形 | 主干高、冠偏圆 | **主干矮、冠像伞**（比高更宽） |
 * | 枝 | 上扬 | **横展**，梢头略垂（`UP_BIAS` 更小 / `OUT_BIAS` 更大） |
 * | 枝数 | 3 → 2~3 | 同 |
 * | 冠 | `PAD` 2.55 / 2.40（近圆）| **2.30 宽 / 1.95 高**（扁而阔）|
 * | 冠的朝向 | 随机（可能歪向墙） | **强制朝外**（`leanCrownForward`）|
 * | 春 | 嫩叶 | **满树花**（叶是夏秋的事）|
 * | 秋 | 挂果 | 叶转橙红（不挂果）|
 *
 * 🔴 四季：**花只在春天**
 * ----------------------
 * 这是"落樱参考真实樱花树的季节"的直接落地。真实的染井吉野：
 * 三月下旬到四月中开满花（**先花后叶**），五月起长叶，秋天叶转黄红，冬天秃。
 * 所以：
 *   · **春** → 花簇（`blossom`）+ 落樱（`petal`）；
 *   · **夏 / 秋** → 叶冠（`canopy` 用叶片几何）；
 *   · **冬** → 只有枝。
 * 三个 mesh **同一套实例矩阵**（花和叶占同一批位置，反正一次只显示一种），
 * 所以多出来的只有"一个几何体 + 一个 mesh"，不是两棵树。
 *
 * 代价（和柿子树同一把尺子）
 * -------------------------
 * 骨架 1 个几何体 + 花簇 1 + 叶冠 1 + 地面影 1 + 落樱 1 ⇒ **5 个 mesh**。
 * 同时**可见**的最多是 4 个（春：骨架 + 花 + 影 + 落樱）。
 * 用户给的预算是"mesh 增量 ≤ 6"，够了。
 *
 * ⚠️ 树是远景摆件，`frustumCulled` 不能开：实例矩阵是挂载后才写的，
 *    自动包围球会把整棵树剔掉（竹篱栽过的那个坑）。
 */

/* ------------------------------------------------------------------ */
/* 形态常量 —— 「改树」就改这一段                                       */
/* ------------------------------------------------------------------ */

/**
 * 树高（根 → 冠顶），世界单位。
 *
 * ⚠️ 屋身檐口是 `FLOOR_Y + 6.0` = **4.25**（世界 y），树根在 `GRASS_Y` = −2.09。
 *    柿子树 `PERSIMMON_H` = 5.25 ⇒ 冠顶 3.16，比檐口低 1.09。
 *    樱花树**比柿子树高一点点**（5.35 ⇒ 冠顶 3.26），两棵并排时樱花是"大一点的那棵"
 *    —— 和真实庭院里柿子树 / 樱花树的体量关系一致，也仍然远在檐口之下。
 *    判据：`harness/probe-tree-extent.mjs`（逐顶点量真实几何顶）。
 */
export const SAKURA_H = 5.35;

const KEY = 'sakura-tree-3d-v1';

/** 每根枝条用几段折线画出来（越多越弯）。 */
const SEGS = 3;
const MAX_DEPTH = 4;

/** 主干：**比柿子树矮**（1.62 vs 2.05）—— 樱花很早就分枝。 */
const TRUNK_LEN = 1.62;
const TRUNK_R0 = 0.225;
const TRUNK_R1 = 0.152;

/** 每深一层：长度 / 半径的衰减。长度衰减**比柿子树慢**（冠更大）。 */
const LEN_FALLOFF = [0.80, 0.78, 0.74, 0.70];
const RAD_FALLOFF = 0.60;

/** 每层的向上偏置 —— 比柿子树小得多（樱花是伞形，不是圆锥）。 */
const UP_BIAS = [0.24, 0.14, 0.075, 0.035];
/** 每层的**向外**偏置 —— 比柿子树大（横展）。 */
const OUT_BIAS = [0.07, 0.40, 0.56, 0.50];
/**
 * 每层额外的 **+z** 偏置 —— 树**本地 −z 朝墙**。
 * 和柿子树同一个理由：冠要在镜头这一侧站得住，又不能扎进墙里。
 */
const FWD_BIAS = [0.02, 0.08, 0.13, 0.14];
/** 冠的进深压扁系数。比柿子树略松（0.58）：樱花冠更宽，压太狠会像纸片。 */
const DEPTH_SQUASH = 0.58;
/** 每层子枝相对父枝张开的角度（弧度）。比柿子树大 ⇒ 枝更"散"。 */
const SPREAD = [0.70, 0.80, 0.88, 0.90];

/** 关节椭球（见 `treeSkeleton` 文件头）。与柿子树同值。 */
const JOINT_SCALE = 1.10;
const JOINT_ELONG = 1.34;
const JOINT_SQUASH = 0.96;
const JOINT_INSET = 0.26;
const CHILD_INSET = 0.58;
const CHILD_DIR_BIAS = 0.32;

/** 每个末梢周围撒几团、散布半径（世界单位）。 */
const TUFTS_PER_TIP = 14;
const TIP_BALL = 0.46;
/** 冠体积里另外撒几团。 */
const FILL_TUFTS = 2500;
/**
 * 冠半径相对"末梢包围盒"的放大系数。
 * 🔴 **横向 / 竖向分开给**：枝梢包围盒竖向天生就扁，同一个系数会长出一个扁饼。
 *    这里横向比竖向大（2.30 vs 1.95）⇒ 伞形，正是樱花的样子。
 *
 * 取值是量出来的（`harness/probe-sakura.mjs`，逐顶点，与柿子树同一把尺子）：
 *
 * | 冠 | 柿子树 | 樱花树 |
 * | --- | --- | --- |
 * | 宽 | 5.50 | **6.21** |
 * | 厚 | 2.59 | **2.62** |
 * | 进深 | 3.38 | **3.07** |
 * | 宽 ÷ 厚 | 2.12 | **2.37** |
 *
 * 「比柿子树宽、比柿子树扁」正是伞形樱花要的关系。第一版取 2.72 ⇒ 冠宽
 * 7.35（比柿子树宽 34%），在 22 宽的屋面前是一棵**遮住半扇墙**的巨物 ——
 * 所以收回来。判据 C2 卡的是"宽 ÷ 厚 ≥ 1.6"，防的是反向塌成扁饼。
 */
const CROWN_PAD_X = 2.30;
const CROWN_PAD_Y = 1.95;
const CROWN_PAD_Z = 2.45;

/** 枝条的分段数 / 横截面边数。与柿子树同值。 */
const TUBULAR = [16, 12, 9, 8, 6];
const RADIAL = [10, 8, 6, 5, 4];

// ⚠️ 这里**不放** `rand` —— 随机数生成器由 `buildSakuraTree` 每次新建后传进来。
const SPEC = {
    segs: SEGS,
    maxDepth: MAX_DEPTH,
    trunkLen: TRUNK_LEN,
    trunkR0: TRUNK_R0,
    trunkR1: TRUNK_R1,
    lenFalloff: LEN_FALLOFF,
    radFalloff: RAD_FALLOFF,
    upBias: UP_BIAS,
    outBias: OUT_BIAS,
    fwdBias: FWD_BIAS,
    spread: SPREAD,
    tubular: TUBULAR,
    radial: RADIAL,
    jointScale: JOINT_SCALE,
    jointElong: JOINT_ELONG,
    jointSquash: JOINT_SQUASH,
    jointInset: JOINT_INSET,
    childInset: CHILD_INSET,
    childDirBias: CHILD_DIR_BIAS,
    childRadiusJit: [0.84, 0.98],
    childLenJit: [0.03, 0.05],
    // 樱花枝比柿子树**更歪**（老樱花树的枝是出了名的拧）
    trunkJitter: 0.15,
    trunkLift: 0.080,
    branchJitter: 0.24,
    branchLift: 0.026,
    // ⚠️ depth === 0 时**不抽随机数**（固定 3 条）
    childCount: (depth, rand) => (depth === 0 ? 3 : 2 + (rand() < 0.45 ? 1 : 0)),
};

/* ------------------------------------------------------------------ */
/* 花簇                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一朵花的半径（世界单位）。
 *
 * 取值是**算过**的：整棵树 5.35 高，镜头通常站在 3~8 单位外。
 * 一朵花直径 2×0.052 = 0.104 ⇒ 站在 5 单位处、900 px 高的画面上约
 * `0.104 / 5 × (900/2/tan30°) ≈ 16 px` —— 五片花瓣在这个尺寸上读得出来。
 * 再小就退化成"粉色噪点"，再大就不像樱花了（真花直径约 3 cm，
 * 换算到本场景的尺度正好是这个量级）。
 */
const FLOWER_R = 0.052;
/** 每团几朵花。3 朵 × 5 瓣 = 15 个四边形 = 30 个三角。 */
const BLOSSOM_ROT = [
    [0.42, 0.00, 0.30],
    [-0.95, 2.60, -0.55],
    [1.30, 4.70, 0.90],
];
const BLOSSOM_OFF = [
    [0.00, 0.00, 0.00],
    [0.055, 0.035, -0.045],
    [-0.05, 0.055, 0.05],
];
/** 花簇里"花心之外"的那一截（= `BLOSSOM_OFF` 里最大那个偏移，≈0.088）。 */
const BLOSSOM_PAD = 0.088;
/** 一团花从自己的原点往外能探多远（世界单位）。 */
export const BLOSSOM_EXTENT = FLOWER_R * 1.06 + BLOSSOM_PAD;

/* ------------------------------------------------------------------ */
/* 叶冠（夏 / 秋）                                                     */
/* ------------------------------------------------------------------ */

/** 樱花叶：**比柿子叶长而窄**（真樱花叶就是长卵形、有锯齿）。 */
export const SAKURA_LEAF_LEN = 0.255;
export const SAKURA_LEAF_WID = 0.132;
const SAKURA_LEAF_LEN_JIT = [0.84, 1.16];
const SAKURA_LEAF_WID_JIT = [0.82, 1.20];

const LEAF_PIECE = {
    len: SAKURA_LEAF_LEN,
    wid: SAKURA_LEAF_WID,
    lenJit: SAKURA_LEAF_LEN_JIT,
    widJit: SAKURA_LEAF_WID_JIT,
    ridgeJit: [0.030, 0.070],
    asymJit: [-0.13, 0.13],
    curlJit: [-0.30, 0.60],
};

const LEAF_ROT = [
    [0.88, 0.20, 0.62],
    [-0.66, 2.30, -0.48],
    [0.44, 4.15, 0.78],
    [-0.56, 5.45, -0.60],
    [1.18, 1.25, -0.30],
    [-1.10, 3.50, 0.24],
];
const LEAF_OFF = [
    [-0.045, 0.005, 0.045],
    [0.055, 0.045, -0.035],
    [-0.035, 0.095, -0.055],
    [0.045, 0.135, 0.045],
    [0.075, 0.075, 0.055],
    [-0.065, 0.115, -0.025],
];
/** 叶团从自己的原点往外能探多远。`0.15` = `LEAF_OFF` 里最大偏移。 */
export const LEAF_EXTENT = clusterExtent(
    SAKURA_LEAF_LEN, SAKURA_LEAF_WID, SAKURA_LEAF_LEN_JIT, SAKURA_LEAF_WID_JIT, 0.15
);

/**
 * 归一化用的"一团能探多远" = 花簇和叶冠里**更大的那个**。
 * 🔴 必须取 max：归一化只跑一次，而两个冠共用同一批实例位置 ——
 *    按小的那个算，换季时冠顶会**跳一下**（花团小、叶团大）。
 */
export const CANOPY_EXTENT = Math.max(BLOSSOM_EXTENT, LEAF_EXTENT);

/* ------------------------------------------------------------------ */
/* 落樱                                                                */
/* ------------------------------------------------------------------ */

/**
 * 落樱的花瓣尺寸。
 * ⚠️ **是整朵花的大小**（0.052），不是"一朵花的一片瓣"的 1/5 ——
 *    飘落时看到的是单片花瓣，单片花瓣本来就和整朵花差不多长
 *    （樱花单瓣长约 1.5 cm，整朵直径约 3 cm）。
 */
const PETAL_LEN = 0.056;
const PETAL_WID = 0.050;
/** 落樱的数量。稀疏是关键 —— 下成暴雪就不是樱花了。 */
const PETAL_COUNT = 240;

/* ------------------------------------------------------------------ */
/* 几何体                                                              */
/* ------------------------------------------------------------------ */

/** 一朵花 = 5 片花瓣（每片一个四边形 = 2 个三角）。 */
function emitFlower(mat, out, rand) {
    const R = FLOWER_R * randRange(rand, 0.86, 1.14);
    const a0 = randRange(rand, 0, Math.PI * 2);
    // 花瓣外缘上翘 ⇒ 花不是一张平片，侧看有厚度
    const tilt = randRange(rand, 0.10, 0.32);
    const PETALS = 5;
    const at = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(mat);
        return { x: v.x, y: v.y, z: v.z };
    };
    // 逐面法线：花瓣之间要有硬边，不然五瓣糊成一个粉团
    const tri = (a, b, c) => {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const p = (q) => ({ px: q.x, py: q.y, pz: q.z, nx, ny, nz });
        pushTri(out, p(a), p(b), p(c));
    };
    for (let j = 0; j < PETALS; j++) {
        const a = a0 + (j / PETALS) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // 花瓣的横向（垂直于它自己的伸展方向）
        const px = -sa;
        const pz = ca;
        // 花瓣是**扇形**：内缘窄（贴着花心）、外缘宽
        const wIn = R * 0.19;
        const wOut = R * 0.42;
        const inX = ca * R * 0.16;
        const inZ = sa * R * 0.16;
        const outX = ca * R * 1.00;
        const outZ = sa * R * 1.00;
        const innerL = at(inX - px * wIn, 0, inZ - pz * wIn);
        const innerR = at(inX + px * wIn, 0, inZ + pz * wIn);
        const outerR = at(outX + px * wOut, R * tilt, outZ + pz * wOut);
        const outerL = at(outX - px * wOut, R * tilt, outZ - pz * wOut);
        tri(innerL, innerR, outerR);
        tri(innerL, outerR, outerL);
    }
}

/** 一团花 = 3 朵朝向各异的花。 */
export function makeBlossomGeometry() {
    return makeClusterGeometry({
        rot: BLOSSOM_ROT,
        off: BLOSSOM_OFF,
        rand: seededRand('sakura-blossom-flowers-v1'),
        emit: emitFlower,
        piece: null,
    });
}

/** 一团叶 = 6 片朝向各异的叶（樱花叶）。 */
export function makeSakuraLeafGeometry() {
    return makeClusterGeometry({
        rot: LEAF_ROT,
        off: LEAF_OFF,
        rand: seededRand('sakura-leaf-blades-v1'),
        emit: emitBlade,
        piece: LEAF_PIECE,
    });
}

/**
 * 一片飘落的花瓣：一个四边形（2 个三角），内窄外宽、外缘微微上翘。
 *
 * 🔴 为什么是 2 个三角而不是 1 个：三角形花瓣的尖角在翻飞时会读成"碎纸屑"，
 *    四边形有个圆钝的外缘，转起来才像花瓣。
 */
export function makePetalGeometry() {
    const acc = makeAcc();
    const L = PETAL_LEN;
    const W = PETAL_WID;
    const lift = -L * 0.10;   // 外缘往后仰一点 ⇒ 有弧面
    const v = [
        { px: -W * 0.22, py: 0, pz: 0 },
        { px: W * 0.22, py: 0, pz: 0 },
        { px: W * 0.50, py: L, pz: lift },
        { px: -W * 0.50, py: L, pz: lift },
    ];
    const tri = (a, b, c) => {
        const ux = b.px - a.px, uy = b.py - a.py, uz = b.pz - a.pz;
        const vx = c.px - a.px, vy = c.py - a.py, vz = c.pz - a.pz;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const p = (q) => ({ px: q.px, py: q.py, pz: q.pz, nx, ny, nz });
        pushTri(acc, p(a), p(b), p(c));
    };
    tri(v[0], v[1], v[2]);
    tri(v[0], v[2], v[3]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    return geo;
}

/* ------------------------------------------------------------------ */
/* 主构建                                                              */
/* ------------------------------------------------------------------ */

let cached = null;

/**
 * 把一棵**已经长好**的树绕 y 轴转一下，让"冠往哪边歪"指向 **+z**。
 *
 * 🔴 为什么必须有这一步（不是审美，是结构）
 * -----------------------------------------
 * `treeSkeleton` 的 `grow()` 在 depth 0 给**三条一级枝共用同一个** `outward`
 * 方向（那是从 demo 搬来的做法），而那个方向是**一次随机抽取**。于是整棵树的
 * 枝全部朝**同一个方位**扇开 —— 抽到哪个方位就是哪个方位，树冠整体偏出去
 * 半个冠半径。实测第一版：末梢包围盒中心在 `z = −1.12`（树**本地 −z 朝墙**）
 * ⇒ 冠心落在 `z = −0.648`，而冠自己的 z 半径只有 1.25 ——
 * **冠有一半扎在墙里**，另一半才在外面。
 *
 * `FWD_BIAS` 本来就是为这件事准备的（"让冠朝外长"），但它每层只有 0.02~0.14，
 * 压不过 `branchJitter = 0.24` 的随机游走 ⇒ 冠偏哪边基本是掷硬币。
 * 靠"改一个 seed 试到不歪"是不行的：种子一换就翻面，而且**不报错**。
 *
 * 所以：**先把歪的方向量出来，再把它转到 +z**。
 *   · 树根仍在原点（绕 y 轴转，原点不动）⇒ 栽种点不变；
 *   · 整体刚性旋转 ⇒ 枝、关节、末梢的相对关系逐位不变（不是重新长一遍）；
 *   · 旋转角由几何算出来，不是常数 ⇒ 换 seed 也照样朝外。
 *
 * ⚠️ 这一步把"冠朝哪边"**烤进几何**了，所以组件**不要再给 yaw**
 *    （再转就把这一步白做了）。前院那面墙的法线就是 +z，正对。
 *
 * @param {*} state `growSkeleton` 的产物（**就地**改）
 * @returns {number} 用掉的旋转角（报数用）
 */
function leanCrownForward(state) {
    const tipBox = boxOfPoints(state.tips.map((t) => t.p));
    const offX = (tipBox.x0 + tipBox.x1) / 2;
    const offZ = (tipBox.z0 + tipBox.z1) / 2;
    if (Math.hypot(offX, offZ) < 1e-4) return 0;
    // 绕 y 转 θ 把 (offX, offZ) 送到 (0, +R)：x' = x·cosθ + z·sinθ ⇒ θ = atan2(−offX, offZ)
    const theta = Math.atan2(-offX, offZ);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const rot = (v) => {
        const x = v.x * c + v.z * s;
        v.z = -v.x * s + v.z * c;
        v.x = x;
    };
    for (let i = 0; i < state.acc.pos.length; i += 3) {
        const x = state.acc.pos[i] * c + state.acc.pos[i + 2] * s;
        state.acc.pos[i + 2] = -state.acc.pos[i] * s + state.acc.pos[i + 2] * c;
        state.acc.pos[i] = x;
    }
    for (const t of state.tips) { rot(t.p); rot(t.d); }
    // 挂件候选（樱花树用不到，但**不能留着不转** —— 那是一个"位置对不上"的陷阱）
    for (const h of state.hangCandidates) { rot(h.p); rot(h.dir); }
    return theta;
}

/**
 * 建树。**确定性**：同一个 key 永远长同一棵树（契约 1）。
 *
 * @returns {{
 *   bark: import('three').BufferGeometry,
 *   canopy: { matrices, phase, tint, accent, shade, count },
 *   petal: { origins: Float32Array, seeds: Float32Array, tints: Float32Array,
 *            count: number, topY: number, fallH: number },
 *   crown: { c, r },
 * }}
 */
export function buildSakuraTree() {
    if (cached) return cached;

    const rand = seededRand(KEY);

    // 1. 骨架（树内部单位）—— 机器在 `treeSkeleton`，这里只给形态参数。
    const state = growSkeleton({ ...SPEC, rand });
    const rawBox = boxOfPositions(state.acc.pos);

    // 1b. 🔴 把"冠歪向哪边"转到 +z（朝镜头 / 背墙）—— 见 `leanCrownForward`
    leanCrownForward(state);

    // ---- 2. 冠：先全在 raw 空间里摆，尺度最后一步再定 ----------------
    const tipsRaw = state.tips.map((t) => ({ p: t.p.clone(), d: t.d.clone().normalize() }));
    const rawTipBox = boxOfPoints(tipsRaw.map((t) => t.p));
    const { c: crownC, r: crownR } = crownFromTips(rawTipBox, CROWN_PAD_X, CROWN_PAD_Y, CROWN_PAD_Z);
    const rhoOf = makeRhoOf(crownC, crownR);

    const spotsRaw = scatterCluster({
        tips: tipsRaw,
        crownC,
        crownR,
        rand,
        perTip: TUFTS_PER_TIP,
        tipBall: TIP_BALL,
        tipBallYSquash: 0.85,
        fill: FILL_TUFTS,
        shellChance: 0.30,
        shellRange: [0.86, 1.0],
    });

    // 每团的缩放**先定下来**（冠顶要用它，且必须在后面所有抽数之前）
    const scales = new Float32Array(spotsRaw.length);
    for (let i = 0; i < spotsRaw.length; i++) scales[i] = randRange(rand, 0.74, 1.30);

    // ---- 3. 归一化：按"连花带冠的高度"定尺度 -------------------------
    let topRaw = rawTipBox.y0;
    for (let i = 0; i < spotsRaw.length; i++) {
        const t = spotsRaw[i].y + CANOPY_EXTENT * scales[i];
        if (t > topRaw) topRaw = t;
    }
    const k = SAKURA_H / (topRaw - rawBox.y0);

    const toFinal = (p) => new THREE.Vector3(p.x * k, (p.y - rawBox.y0) * k, p.z * k * DEPTH_SQUASH);

    for (let i = 0; i < state.acc.pos.length; i += 3) {
        state.acc.pos[i] = state.acc.pos[i] * k;
        state.acc.pos[i + 1] = (state.acc.pos[i + 1] - rawBox.y0) * k;
        state.acc.pos[i + 2] = state.acc.pos[i + 2] * k * DEPTH_SQUASH;
    }

    // ---- 4. 花 / 叶共用的实例矩阵（同一批位置，一次只显示一种）--------
    const shade = shadeOf(spotsRaw, rhoOf);
    const spots = spotsRaw.map(toFinal);
    const canopy = packInstances({ spots, rand, scales, shade });

    // ---- 5. 落樱的起点：撒在冠里（外圈偏多，花是从外圈掉下来的）--------
    const origins = new Float32Array(PETAL_COUNT * 3);
    const seeds = new Float32Array(PETAL_COUNT * 2);
    const tints = new Float32Array(PETAL_COUNT);
    const topY = SAKURA_H;
    // 落到草地**以下**再回卷 ⇒ 回卷那一刻花瓣已经在草下面，看不见跳变。
    const fallH = topY + 0.5;
    for (let i = 0; i < PETAL_COUNT; i++) {
        const h = spots[Math.floor(rand() * spots.length)];
        origins[i * 3] = h.x;
        origins[i * 3 + 1] = topY;
        origins[i * 3 + 2] = h.z;
        seeds[i * 2] = rand();
        seeds[i * 2 + 1] = rand();
        tints[i] = rand();
    }

    const bark = new THREE.BufferGeometry();
    bark.setAttribute('position', new THREE.Float32BufferAttribute(state.acc.pos, 3));
    bark.setAttribute('normal', new THREE.Float32BufferAttribute(state.acc.nrm, 3));
    bark.computeBoundingSphere();

    cached = {
        bark,
        canopy,
        petal: { origins, seeds, tints, count: PETAL_COUNT, topY, fallH },
        crown: { c: toFinal(crownC), r: new THREE.Vector3(crownR.x * k, crownR.y * k, crownR.z * k * DEPTH_SQUASH) },
    };
    return cached;
}
