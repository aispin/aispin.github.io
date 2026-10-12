import * as THREE from 'three';

import { seededRand, randRange } from '../engine/art';
import {
    makeAcc,
    pushTri,
    emitEllipsoid,
    growSkeleton,
    boxOfPositions,
    boxOfPoints,
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
 * 柿子树的 3D 骨架 / 叶 / 果 —— 纯数学，不碰 three 的场景图。
 * ==================================================================
 *
 * 来历
 * ----
 * 原来那棵树是**一张 768×1024 的画布贴图**贴在 6×8 的平面上（billboard），
 * 画在 canvas 里、永远正对镜头。用户 2026-10-12 要求"完全重构，3D 版"，
 * 参考 `public/demos/web3d/tree/index.html`。
 *
 * 从那个 demo 里搬过来的**三件事**（它是这个文件真正的设计来源）
 * ------------------------------------------------------------
 *  1. **锥形管**（`taperedTube`）：每根枝条是一条 CatmullRom 曲线，半径从
 *     `r0` 线性收到 `r1`。管比圆柱自然得多。
 *  2. 🔴 **关节椭球**（`JOINT_*`）：这是"树干衔接自然"的**全部秘密**。
 *     两根圆柱以某个角度相接，接缝外侧必然裂开一个口子 —— 贴在父枝末端的
 *     一个**沿父枝方向拉长的椭球**正好把那个口子包住，看起来就像枝干自身
 *     的膨大（真树的枝杈本来也是鼓的）。参数上有一条硬约束：
 *     **椭球垂直于父枝的半径必须 ≥ 父枝末端半径**，否则包不住。
 *  3. **子枝起点回退 + 起始方向偏向父枝**（`CHILD_INSET` / `CHILD_DIR_BIAS`）：
 *     子枝从**关节内部**长出来，且出发时顺着父枝方向、再逐渐分开。少了这
 *     两条，枝杈会读成"用胶水粘上去的"。
 *
 * 和 demo 不一样的三处
 * --------------------
 *  · **确定性**：demo 用 `Math.random()`，这里一律 `seededRand`（项目契约 1：
 *    同一个 key 永远长同一棵树，截图之间才可比对）。
 *  · **树冠更饱满**：demo 只在**末梢**撒叶，冠内是空的（所以能看见枝干）。
 *    这里一半的叶团是**按"离冠壳多远"在冠体积里撒的**（`FILL_TUFTS`），
 *    并把末梢的叶团从 18~30 提到 `TUFTS_PER_TIP`。这是用户要的"饱满一点"。
 *  · **合并成 1 个几何体**：demo 每个枝条 / 每片叶 / 每颗果都是一个 `Mesh`，
 *    那棵树有 3000+ 个 mesh。本项目基线是 704 mesh，照抄会翻五倍。所以
 *    骨架（枝 + 关节）自己拼成**一个** BufferGeometry，叶和果各走
 *    InstancedMesh ⇒ **一共 3 次 draw call**。
 *
 * 尺寸归一化
 * ----------
 * 树先按**自己的一套单位**长出来，然后量出它的高度、等比缩放到
 * `PERSIMMON_H`，并把根挪到 `y = 0`。好处是上面那些形态常量（长度、半径、
 * 叶长…）可以按"树内部的比例"写，改总高不用碰它们。
 *
 * ⚠️ 尺度转换只做一次，而且**只对骨架的顶点**做（均匀缩放 + 平移，椭球不会
 *    变形、法线不用重算）；叶团和果是在**归一化之后的坐标系**里摆的，所以
 *    它们的尺寸常量（`LEAF_LEN` / `FRUIT_R`）就是世界单位。
 */

/* ------------------------------------------------------------------ */
/* 形态常量 —— 「改树」就改这一段                                       */
/* ------------------------------------------------------------------ */

/** 树高（根 → 冠顶），世界单位。⚠️ 屋身檐口是 `FLOOR_Y + 6.0`，树要略矮。 */
export const PERSIMMON_H = 5.25;

const KEY = 'persimmon-tree-3d-v1';

/** 每根枝条用几段折线画出来（越多越弯）。 */
const SEGS = 3;
const MAX_DEPTH = 4;

/** 主干：长度与两端半径（树内部单位）。 */
const TRUNK_LEN = 2.05;
const TRUNK_R0 = 0.215;
const TRUNK_R1 = 0.150;

/** 每深一层：长度 / 半径的衰减。 */
const LEN_FALLOFF = [0.76, 0.72, 0.68, 0.64];
const RAD_FALLOFF = 0.575;

/** 每层的向上偏置 —— 越往上越小，冠才不会长成一个尖锥。 */
const UP_BIAS = [0.30, 0.19, 0.11, 0.07];
/**
 * 每层的**向外**偏置（沿"离开主干轴"的方向）。
 * 🔴 这一条是"冠饱满"的另一半：只有向上偏置的话，所有末梢都挤在轴附近，
 *    冠是一个细锥，加多少叶都盖不住。
 */
const OUT_BIAS = [0.06, 0.32, 0.46, 0.44];
/**
 * 每层额外的 **+z** 偏置 —— 树**本地 −z 朝墙**。
 *
 * 🔴 为什么需要：树冠是一个球，而屋身的前墙 + 出檐只在 z ∈ [−1.85, +0.9] 这
 *    一圈里（相对树干原点）。冠要在镜头这一侧站得住，又不能扎进墙里 / 挑进
 *    檐下 —— 唯一不靠"缩尺寸"的办法就是让冠**朝外长**。真树贴着墙也是这样
 *    长的（朝光的那面旺）。
 */
const FWD_BIAS = [0.02, 0.09, 0.15, 0.16];
/**
 * 冠的**进深压扁系数**：归一化那一步顺带把 z 压到这么多。
 *
 * 上面那条偏置只把冠的重心推到前面，冠本身还是圆的；贴着墙的树冠在进深方向
 * 本来就比横向窄（它要往有光的地方摊开，不是往墙里长）。0.86 是人眼不会读成
 * "被压扁"的量级，但正好把冠的后缘从墙里拉出来。
 */
const DEPTH_SQUASH = 0.55;
/** 每层子枝相对父枝张开的角度（弧度）。 */
const SPREAD = [0.62, 0.72, 0.80, 0.84];

/** 关节椭球（见文件头）。`SQUASH` 必须 ≥ 1 / `SCALE` 才包得住父枝端面。 */
const JOINT_SCALE = 1.10;
const JOINT_ELONG = 1.34;
const JOINT_SQUASH = 0.96;
const JOINT_INSET = 0.26;
const CHILD_INSET = 0.58;
const CHILD_DIR_BIAS = 0.32;

/** 每个末梢周围撒几团叶、散布半径（世界单位）。 */
const TUFTS_PER_TIP = 16;
const TIP_BALL = 0.50;
/** 冠体积里另外撒几团叶 —— 这一半是"饱满"的来源。 */
const FILL_TUFTS = 2800;
/** 冠半径（**横向**）相对"末梢包围盒"的放大系数（叶要探出枝梢一点）。 */
const CROWN_PAD = 2.55;
/**
 * 冠半径（**竖向**）的放大系数 —— 刻意比横向大。
 *
 * 🔴 为什么：枝梢的包围盒在竖向上天生就扁（每层子枝都往上收），直接用同一个
 *    `CROWN_PAD` 会长出一个**扁饼**：实测 3.76 宽 × 2.05 高。而"饱满"要的
 *    是一个球。竖向单独放宽只改**叶**的分布，不动枝干骨架。
 */
const CROWN_PAD_Y = 2.40;

/** 叶团里最多几片叶、叶的尺寸（世界单位）。 */
export const LEAF_LEN = 0.24;
export const LEAF_WID = 0.145;
/**
 * 每片叶**形状抖动**的上下限（`leafVerts` 用）。
 *
 * 🔴 为什么要把这两个数写成常量、而不是直接写进 `leafVerts`：
 *    `TUFT_EXTENT`（下面）是**归一化分母的一部分** —— 它决定"树看起来多高"。
 *    抖动一旦放大，叶团能探出去的比 `TUFT_EXTENT` 预测的更远，
 *    冠顶就会**冲出 `PERSIMMON_H`**（WO-7 那条"树要略矮于屋身"的老账）。
 *    所以把界限提出来，`TUFT_EXTENT` 按**最大可能的那片叶**算（偏保守）。
 */
export const LEAF_LEN_JIT = [0.82, 1.18];
export const LEAF_WID_JIT = [0.80, 1.22];
/**
 * 一团叶**从自己的原点往外能探多远**（世界单位）。
 *
 * 🔴 归一化那一步要用它 —— 树顶不只是最高那团叶的**中心**，还要加上这团叶
 *    自己探出去的那一截（叶尖离原点的距离 + 那 4 片叶的固定偏移）。
 *    少了这一截，冠顶会比 `PERSIMMON_H` 高出一小段（第一版就是这么冲过檐口
 *    的：量到 4.28，而檐口只有 4.25）。
 * ⚠️ 按**抖动上限**算（`*_JIT[1]`）：保守只会让树矮一点点，安全。
 * ⚠️ 算的是**外接球**（不挑朝向）。
 */
export const TUFT_EXTENT = clusterExtent(
    LEAF_LEN, LEAF_WID, LEAF_LEN_JIT, LEAF_WID_JIT,
    // ⚠️ 0.14 是**显式给**的，不是算出来的：它对应 `LEAF_OFF` 里最大那个偏移
    //    （≈0.132）。改成"自动取 max|OFF|"会让这个数变成 0.132 ⇒ `TUFT_EXTENT`
    //    变小 ⇒ 归一化分母变小 ⇒ **整棵树换尺寸**。数字要动就整棵重拍。
    0.14
);

/** 果实：半径范围、挂在哪个高度带。 */
const FRUIT_R = [0.120, 0.170];
const FRUIT_COUNT = 46;
/**
 * 果沿"离冠心向外"推到**宿主叶团之外**多远 —— 以宿主叶团自己的探出量
 * （`TUFT_EXTENT × 该团缩放`）为单位。
 *
 * 🔴 为什么要"挂在宿主叶团上"而不是"按冠壳半径采样"：
 *   按半径采样时，果心与叶冠外表面是**两套独立的东西**，一旦半径写大一点，
 *    果心就整体跑到叶外面去了 —— 这正是「果子飘离树冠」的成因（实测 46/46 颗
 *    果心 rho 1.095~1.191，而叶团 rho 的 p99 只有 0.997）。
 *   改小又会全部埋进叶里（实测 0.95~1.00 时可见比例中位数 = 0）。
 *   ⇒ 把果**锚在一个真实存在的叶团上**，再沿径向外推一小段：
 *     果心在叶壳内（挂着）、果身探出叶面（看得见）。两头都由构造保证。
 * 判据：`harness/probe-fruit-attach.mjs`（C1 挂着 / C2 探出叶面）。
 */
const FRUIT_PUSH = 0.45;
/**
 * 宿主叶团的 rho 带。
 * 🔴 **要靠外**：宿主在 0.85 那一档时，`FRUIT_PUSH` 推出去也仍在密叶里（被埋）；
 *    只有挑 0.90 以上的"外圈团"，推出去才正好落在叶面上。
 *    实测宿主编带 [0.80,0.95] 时探出率 80%，[0.90,0.99] 明显更好。
 */
const FRUIT_HOST_RHO = [0.90, 0.99];
/**
 * 果心的 rho **硬上限**。
 *
 * 🔴 这一条是"结构保证"，不是"调参调出来的"：`rho` 是 `(点−冠心)` 的归一化范数
 *    ⇒ 把 `(点−冠心)` 整体乘 `RHO_MAX/rho`，新的 rho **正好**等于 `RHO_MAX`。
 *    所以只要过一遍这个收缩，"果心跑到叶冠外面"就**不可能发生** ——
 *    不再依赖 `FRUIT_PUSH` / 宿主带取什么值。
 *    判据 `harness/probe-fruit-attach.mjs` 的 C1 就是量它。
 */
const FRUIT_RHO_MAX = 0.99;

/* ------------------------------------------------------------------ */
/* 骨架的形态参数 —— 交给 `treeSkeleton.growSkeleton`                   */
/*                                                                     */
/* 🔴 「衔接自然」那三条原则（锥形管 / 关节椭球 / 子枝起点回退 + 起始   */
/*    方向偏向父枝）的实现**只有一份**，在 `utils/treeSkeleton.js`。    */
/*    这个文件只放柿子树自己的形态：树干多长多粗、每层怎么衰减、往哪偏。 */
/*    樱花树（`utils/sakuraTree.js`）用同一台机器、换一份参数。          */
/* ------------------------------------------------------------------ */

/** 枝条的分段数 / 横截面边数：越细的枝越省（近处只有主干和一级枝）。 */
const TUBULAR = [16, 12, 9, 8, 6];
const RADIAL = [10, 8, 6, 5, 4];

// ⚠️ 这里**不放** `rand` —— 随机数生成器由 `buildPersimmonTree` 每次新建后
//    传进来（见那里的说明）。放这儿会让第二次调用接着上一棵树的序列长。
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
    trunkJitter: 0.13,
    trunkLift: 0.085,
    branchJitter: 0.21,
    branchLift: 0.030,
    // ⚠️ depth === 0 时**不抽随机数**（固定 3 条）—— 这本身就是形态的一部分
    childCount: (depth, rand) => (depth === 0 ? 3 : 2 + (rand() < 0.45 ? 1 : 0)),
};

/* ------------------------------------------------------------------ */
/* 叶 / 果的几何体                                                     */
/* ------------------------------------------------------------------ */

/**
 * 柿子树这片叶的**形状参数** —— 折起来的 4 个三角（有中脉）。
 *
 * 画法本身在 `treeSkeleton.emitBlade`（「为什么不是 2 个三角的平菱形」
 * 那段说明也在那里，两棵树共用）。这里只给柿子叶的尺寸与抖动幅度。
 *
 * 🔴 `LEAF_LEN_JIT` / `LEAF_WID_JIT` 提成常量而不是写死进调用处：
 *    `TUFT_EXTENT`（上面）是**归一化分母的一部分** —— 它决定"树看起来多高"。
 *    抖动一旦放大，叶团能探出去的比 `TUFT_EXTENT` 预测的更远，冠顶就会
 *    **冲出 `PERSIMMON_H`**（WO-7 那条"树要略矮于屋身"的老账）。
 */
const LEAF_PIECE = {
    len: LEAF_LEN,
    wid: LEAF_WID,
    lenJit: LEAF_LEN_JIT,
    widJit: LEAF_WID_JIT,
    ridgeJit: [0.035, 0.075],
    asymJit: [-0.11, 0.11],
    curlJit: [-0.35, 0.55],
};

/** 一「团」叶 = **6** 片朝向各异的叶（朝向表是固定的，所以形态确定）。 */
const LEAF_ROT = [
    [0.95, 0.00, 0.55],
    [-0.72, 2.10, -0.40],
    [0.38, 4.05, 0.85],
    [-0.50, 5.30, -0.68],
    [1.25, 1.05, -0.22],
    [-1.05, 3.35, 0.30],
];
const LEAF_OFF = [
    [-0.05, 0.00, 0.04],
    [0.06, 0.04, -0.03],
    [-0.03, 0.09, -0.06],
    [0.04, 0.13, 0.05],
    [0.08, 0.07, 0.06],
    [-0.07, 0.11, -0.02],
];

/**
 * 一「团」叶 = **6** 片朝向各异的叶。
 *
 * 🔴 为什么是**一团**而不是一片：`InstancedMesh` 的实例数就是 draw 之外最贵的
 *    一笔开销（每个实例一份矩阵 + 4 个属性）。把 6 片叶烘进一个几何体，同样的
 *    覆盖度只要六分之一的实例，而三角形的总数一模一样。
 *
 * 🔴 6 片的朝向必须**散开**（尤其不能都躺在同一个平面里）：整团的明暗差异
 *    完全来自法线，朝向单一时整冠会是同一个颜色 —— 那正是"看着不饱满"。
 *
 * ⚠️ 2026-10-12 勘误：这段注释原来写「4 片」，而 `ROT` 一直是 **6** 项。
 *    代码和注释对不上（同 `hard-rules §28` 那条家族）。
 */
export function makeLeafTuftGeometry() {
    return makeClusterGeometry({
        rot: LEAF_ROT,
        off: LEAF_OFF,
        // 每片叶的形状抖动 —— **固定 key** ⇒ 6 片叶的形状是确定的
        //（契约 1：两次跑出来必须逐字节相同，否则判据之间不可比）。
        rand: seededRand('persimmon-leaf-blades-v1'),
        emit: emitBlade,
        piece: LEAF_PIECE,
    });
}

/**
 * 一颗柿子 = 果身（压扁的球）+ 果蒂（小锥）。`aPart` 区分两者，
 * 所以一个 InstancedMesh 就能画出"带蒂的柿子"。
 */
export function makeFruitGeometry() {
    const acc = makeAcc(true);
    // 果身：半径 1，y 方向压到 0.88（柿子比球扁）
    emitEllipsoid(acc, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1, 0.88, 1, 6, 7, 0);

    // 果蒂：4 片小萼 + 一根短柄，都在果顶
    const APEX_Y = 1.02;
    const RING_Y = 0.62;
    const RING_R = 0.55;
    const LOBES = 5;
    const ring = [];
    for (let j = 0; j < LOBES; j++) {
        const a = (j / LOBES) * Math.PI * 2;
        ring.push({
            px: Math.cos(a) * RING_R, py: RING_Y, pz: Math.sin(a) * RING_R,
            nx: Math.cos(a) * 0.9, ny: 0.42, nz: Math.sin(a) * 0.9, part: 1,
        });
    }
    const apex = { px: 0, py: APEX_Y, pz: 0, nx: 0, ny: 1, nz: 0, part: 1 };
    for (let j = 0; j < LOBES; j++) {
        const k = (j + 1) % LOBES;
        pushTri(acc, apex, ring[k], ring[j]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(acc.part, 1));
    return geo;
}

/* ------------------------------------------------------------------ */
/* 主构建                                                             */
/* ------------------------------------------------------------------ */

let cached = null;

/**
 * 建树。**确定性**：同一个 key 永远长同一棵树，所以结果可以缓存、也所以
 * 无头截图之间可比对。
 *
 * @returns {{
 *   bark: import('three').BufferGeometry,
 *   leaf: { matrices: Float32Array, phase: Float32Array, tint: Float32Array,
 *           accent: Float32Array, shade: Float32Array, count: number },
 *   fruit: { matrices: Float32Array, count: number },
 *   chimeAnchor: import('three').Vector3,
 *   crown: { c: import('three').Vector3, r: import('three').Vector3 },
 * }}
 */
export function buildPersimmonTree() {
    if (cached) return cached;

    const rand = seededRand(KEY);

    // 1. 骨架（树内部单位）—— 机器在 `treeSkeleton`，这里只给形态参数。
    //    ⚠️ `rand` 每次**新建**再传进去：SPEC 是模块级的，如果随机数生成器
    //    挂在 SPEC 上，第二次调用就会接着上一棵树的序列往下长（另一棵树）。
    const state = growSkeleton({ ...SPEC, rand });

    // 骨架自己的包围盒（raw）。归一化要以"根在哪儿"为基准，所以先量出来。
    const rawBox = boxOfPositions(state.acc.pos);

    // ---- 2. 叶团（**先全在 raw 空间里摆**，尺度最后一步再定）----------
    //
    // 为什么归一化挪到最后：`PERSIMMON_H` 要表达的是**连叶带冠的可见高度**
    // （WO-7 的约束"房子比树略高一"问的就是这个），而叶团会把冠顶再顶出去
    // 一大截（末梢包围盒 ×`CROWN_PAD` + 叶团自身的半径）。先按骨架归一化、
    // 再撒叶，量出来的"树顶"就比 `PERSIMMON_H` 高一截 —— 第一版正是如此，
    // 冠顶冲到 4.61（檐口才 4.25）。
    const tipsRaw = state.tips.map((t) => ({ p: t.p.clone(), d: t.d.clone().normalize() }));
    const rawTipBox = boxOfPoints(tipsRaw.map((t) => t.p));

    const { c: crownC, r: crownR } = crownFromTips(rawTipBox, CROWN_PAD, CROWN_PAD_Y, CROWN_PAD);

    /** 点在冠里的归一化半径：0 = 冠心、1 = 冠壳。叶的遮蔽就按它给。 */
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
        // 冠体积均匀（cbrt），但**三成**刻意贴到外壳上 ——
        // 纯均匀撒会留下一个"毛边很薄"的冠，轮廓不够实。
        shellChance: 0.30,
        shellRange: [0.86, 1.0],
    });

    // 每团叶的缩放**先定下来**：树顶要用它（见下面的 TUFT_EXTENT），
    // 而且必须在"算果"**之前**抽 —— 抽晚了整棵树的随机序列会整体错位。
    const leafScale = new Float32Array(spotsRaw.length);
    for (let i = 0; i < spotsRaw.length; i++) leafScale[i] = randRange(rand, 0.78, 1.28);

    // ---- 3. 果：**锚在外圈的真实叶团上**（见 `FRUIT_PUSH` 的说明）--------
    //
    // 历史（两条都踩过，别再回头）：
    //   · 挑 rho > 0.74 的叶团再把果往下挪 ⇒ 果全在叶团**里面**，
    //     被不透明的叶挡得一个都看不见（"柿子树没有柿子"）。
    //   · 改成按冠壳半径采样、半径写 1.10~1.20（壳**外**）⇒ 果心整体跑到叶外，
    //     就是用户报的「果子飘离树冠」（实测 46/46 违规）。
    //   · 收回 0.95~1.00（壳**内**）⇒ 反过来全被埋（可见比例中位数 0）。
    // ⇒ 正解是**锚宿主**：果跟着某一团叶走，两个方向都被构造保证。
    const fruitHosts = [];
    for (let i = 0; i < spotsRaw.length; i++) {
        const rho = rhoOf(spotsRaw[i]);
        if (rho < FRUIT_HOST_RHO[0] || rho > FRUIT_HOST_RHO[1]) continue;
        // 柿子结在朝上的那面：把宿主限制在不下垂的方向（纯视觉，冠底挂果看不见）
        if (spotsRaw[i].y < crownC.y - crownR.y * 0.15) continue;
        fruitHosts.push({ p: spotsRaw[i], s: leafScale[i] });
    }

    const fruitRaw = [];
    for (let i = 0; i < FRUIT_COUNT; i++) {
        const h = fruitHosts[Math.floor(rand() * fruitHosts.length)];
        // 从冠心指向宿主的**径向**（椭球不是球，但方向够用）
        const dx = h.p.x - crownC.x;
        const dy = h.p.y - crownC.y;
        const dz = h.p.z - crownC.z;
        const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
        const push = TUFT_EXTENT * h.s * FRUIT_PUSH;

        const p = new THREE.Vector3(
            h.p.x + dx * inv * push,
            h.p.y + dy * inv * push,
            h.p.z + dz * inv * push
        );

        // 结构保证：把果心收进冠壳内（见 FRUIT_RHO_MAX 的说明）。
        // rho 是"归一化范数" ⇒ 把 (p − crownC) 整体缩放，rho 同步等比缩放。
        const rho = rhoOf(p);
        if (rho > FRUIT_RHO_MAX) {
            const k2 = FRUIT_RHO_MAX / rho;
            p.set(
                crownC.x + (p.x - crownC.x) * k2,
                crownC.y + (p.y - crownC.y) * k2,
                crownC.z + (p.z - crownC.z) * k2
            );
        }

        fruitRaw.push({
            p,
            // ⚠️ 半径是**世界单位**，不吃下面的归一化（柿子就是这么大）
            r: randRange(rand, FRUIT_R[0], FRUIT_R[1]),
        });
    }

    // ---- 4. 风铃挂点：在一级枝里挑一条"夠远、朝镜头、高度合适"的 -----
    let anchorRaw;
    if (state.hangCandidates.length) {
        const best = state.hangCandidates
            .slice()
            .sort((a, b) => (b.z + b.far * 0.5) - (a.z + a.far * 0.5))[0];
        anchorRaw = best.p.clone();
    } else {
        anchorRaw = new THREE.Vector3(0.6, TRUNK_LEN * 0.7, 0.3);
    }

    // ---- 5. 归一化：**按"连叶带冠的高度"**定尺度，一次性落到最终空间 -----
    //
    // 树顶 = 最高的那一团叶的中心 + 叶团自身的半径（`TUFT_R`）。
    // 于是 `PERSIMMON_H` 就真的是"树看起来多高"，屋身檐口只要比它大一点点。
    let topRaw = rawTipBox.y0;
    for (let i = 0; i < spotsRaw.length; i++) {
        const t = spotsRaw[i].y + TUFT_EXTENT * leafScale[i];
        if (t > topRaw) topRaw = t;
    }
    const spanRaw = topRaw - rawBox.y0;
    const k = PERSIMMON_H / spanRaw;

    const toFinal = (p) => new THREE.Vector3(p.x * k, (p.y - rawBox.y0) * k, p.z * k * DEPTH_SQUASH);

    for (let i = 0; i < state.acc.pos.length; i += 3) {
        const x = state.acc.pos[i];
        const y = state.acc.pos[i + 1] - rawBox.y0;
        const z = state.acc.pos[i + 2];
        state.acc.pos[i] = x * k;
        state.acc.pos[i + 1] = y * k;
        state.acc.pos[i + 2] = z * k * DEPTH_SQUASH;
    }

    // ---- 6. 叶 / 果的实例矩阵（最终空间）-----------------------------
    // ⚠️ `shade` 用 **raw** 坐标算（`rhoOf` 的分母是 raw 空间的冠心/冠壳），
    //    而实例矩阵用最终坐标 —— 两者不能混。见 `treeSkeleton.packInstances`。
    const shade = shadeOf(spotsRaw, rhoOf);
    const spots = spotsRaw.map(toFinal);
    const leaf = packInstances({ spots, rand, scales: leafScale, shade });

    const fMats = new Float32Array(fruitRaw.length * 16);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (let i = 0; i < fruitRaw.length; i++) {
        const f = fruitRaw[i];
        scl.set(f.r, f.r, f.r);
        m.compose(toFinal(f.p), q.identity(), scl);
        m.toArray(fMats, i * 16);
    }

    const bark = new THREE.BufferGeometry();
    bark.setAttribute('position', new THREE.Float32BufferAttribute(state.acc.pos, 3));
    bark.setAttribute('normal', new THREE.Float32BufferAttribute(state.acc.nrm, 3));
    bark.computeBoundingSphere();

    cached = {
        bark,
        leaf,
        fruit: { matrices: fMats, count: fruitRaw.length },
        chimeAnchor: toFinal(anchorRaw),
        crown: { c: toFinal(crownC), r: new THREE.Vector3(crownR.x * k, crownR.y * k, crownR.z * k * DEPTH_SQUASH) },
    };
    return cached;
}
