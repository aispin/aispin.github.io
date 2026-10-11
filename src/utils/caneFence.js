/**
 * 竹篱的**尺子**与**实例清单**（纯数据层：无 React、无场景、无副作用）。
 * ==================================================================
 *
 * 2026-10-11（WO-6）：门外那片竹篱笆小院（`ForecourtFence`）要的是同一种
 * 篱笆，只是更长。所以竹竿这一层整体抽出来共用，本文件是它的**唯一真源**：
 *
 *   · `CANE_STEP`     —— 立竹间距
 *   · `caneCount()`   —— 给定长度该放几根
 *   · `buildFenceRun()` —— 一段**直**篱笆的实例清单（局部坐标）
 *   · `makeCaneGeometry()` —— 把清单变成带实例属性的几何体
 *
 * ⚠️ 2026-10-11：墙脚那道矮竹篱**已经不存在了** —— 用户把它换成了狗尾巴草
 *    （`FoxtailGrass`），篱笆、贴图、高度常量一起删。所以本文件现在只服务
 *    `ForecourtFence` 一个调用方；"两种篱笆共用一把尺子"那句话也随之作废，
 *    但 `CANE_STEP` 的**值**必须冻住（见它自己的注释）。
 *
 * 为什么拆成独立文件
 * ------------------
 * 原来这些都长在一个组件文件里（`BambooFence.jsx`，已删）。一个组件文件同时
 * 导出 shader、尺子、构建函数和组件，会踩 `react-refresh/only-export-components`
 * （dev 的 HMR 粒度问题，见 `eslint.config.js` 的长注释）。那个规则留了
 * `allowExportNames` 白名单，但它是给「Provider + useXxx 同文件」「房间
 * TWEAK HERE 参数」这类**小而内聚**的例外用的；这里是一整个库 + 一个组件。
 * 拆法沿用项目既有分层：GLSL → `shaders/`（本文件的着色器在
 * `shaders/caneFence.js`），程序化美术/几何辅助 → `utils/`。
 */

import * as THREE from 'three';

import { randRange } from '../engine/art';

/* ------------------------------------------------------------------ */
/* 尺子                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 立竹间距。**唯一真源** —— 不要再在别处除一遍。
 *
 * 🔴 这个数是**冻结**的：`3.65 / 26 ≈ 0.1404`。
 *
 * 3.65 原来是「沿墙那道矮竹篱」一格藤贴图的宽度（`0.45 × 8.111`）。
 * 2026-10-11 用户把墙脚那道矮篱换成了**狗尾巴草**（`FoxtailGrass`），
 * 于是那道篱笆、它的贴图、它的高度常量**一起删掉了**。
 *
 * 但这个间距**不能跟着动**：门外那片竹篱笆小院（`ForecourtFence`）已经
 * 按它验收过 —— 改一个数就是换一片院子。所以这里把数**直接写死**并留下
 * 出处，而不是继续挂在两个已经不存在的东西上。
 *
 * ⚠️ 真正的坑是"留着一个叫 `WALL_FENCE_H` 的常量指着一道没有的篱笆"：
 *    下一个人会去找那道墙。所以宁可让 3.65 和 26 直接出现在这一行。
 */
export const CANE_STEP = 3.65 / 26;

/** 横档高度（占篱高的比例）。 */
export const RAIL_Y = [0.30, 0.72];

/**
 * 横档上竹节的间距（世界单位）。立竹是 `nodes: 2`（沿 0.45 的高度两道），
 * 横档按长度排 —— 0.365 是 3.65 长配 10 道折回来的，保持原样。
 */
const RAIL_NODE_STEP = 0.365;

/** 一根竹竿 = 单位圆柱（半径 1、高 1、5 边），实例矩阵负责半径/高度。 */
const CANE_SEGMENTS = 5;
const CANE_HEIGHT_SEGMENTS = 3;

/** 给定一段篱笆的长度，该放几根立竹。 */
export const caneCount = (length) => Math.max(2, Math.round(length / CANE_STEP));

/* ------------------------------------------------------------------ */
/* 实例清单                                                             */
/* ------------------------------------------------------------------ */

/**
 * 一段**直**篱笆的实例清单。坐标是**局部**的：x 沿篱笆、y 从篱笆脚往上、
 * z 恒为 0（篱笆是零厚度的，厚度由竹竿半径给）。摆放（世界位置 + 朝向）
 * 由 `CaneFenceMesh` 的 `runs[].position / rotationY` 负责。
 *
 * 🔴 随机序列的**消耗顺序**是契约的一部分：每根立竹消耗 5 个 `rand()`
 * （x 抖动 / 高度抖动 / 半径 / 相位 / 色调），每道横档 2 个（相位 / 色调）。
 * 改动顺序 = 换一道篱笆。想换样子请换**种子**，不要重排这里。
 *
 * 确定性：同一种子刷新一百次长得一模一样（项目契约 1）。
 *
 * @param {() => number} rand   `seededRand(seed)` 的返回值
 * @param {number} length       篱笆长度（世界单位）
 * @param {number} height       篱笆高度（世界单位）
 * @param {number} caneN        立竹根数（用 `caneCount(length)`）
 */
export function buildFenceRun({ rand, length, height, caneN }) {
    const items = [];

    // ---- 立竹：等距 + 微抖（纯等距会读成「栅栏」）----------------------
    const step = length / caneN;
    for (let i = 0; i < caneN; i++) {
        const x = -length / 2 + i * step + (rand() - 0.5) * step * 0.16;
        const hFrac = 0.94 + rand() * 0.06;
        items.push({
            x,
            y: height * hFrac * 0.5,
            z: 0,
            rotZ: 0,
            radius: randRange(rand, 0.0135, 0.0175),
            len: height * hFrac,
            bend: 1,
            nodes: 2,
            phase: rand() * Math.PI * 2,
            tint: rand(),
        });
    }

    // ---- 横档：转 90°，贯穿整个宽度 -----------------------------------
    for (const frac of RAIL_Y) {
        items.push({
            x: 0,
            y: height * frac,
            z: 0,
            rotZ: Math.PI / 2,
            radius: 0.019,
            len: length,
            bend: 0,
            nodes: Math.max(2, Math.round(length / RAIL_NODE_STEP)),
            phase: rand() * Math.PI * 2,
            tint: rand(),
        });
    }

    return items;
}

/**
 * 带实例属性的几何体。
 *
 * ⚠️ 带实例属性的几何**不能**走 `sharedGeometry`：实例属性会被就地改写，
 * 共享出去会把所有使用者一起弄坏（`engine/resources.js` 的警告）。
 */
export function makeCaneGeometry(items) {
    const g = new THREE.CylinderGeometry(1, 1, 1, CANE_SEGMENTS, CANE_HEIGHT_SEGMENTS, false);
    const n = items.length;
    const phase = new Float32Array(n);
    const tint = new Float32Array(n);
    const bend = new Float32Array(n);
    const nodes = new Float32Array(n);
    items.forEach((it, i) => {
        phase[i] = it.phase;
        tint[i] = it.tint;
        bend[i] = it.bend;
        nodes[i] = it.nodes;
    });
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    g.setAttribute('aBend', new THREE.InstancedBufferAttribute(bend, 1));
    g.setAttribute('aNodes', new THREE.InstancedBufferAttribute(nodes, 1));
    return g;
}
