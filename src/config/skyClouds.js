/**
 * skyClouds — 天空里那几朵云**摆在哪**（WO-20，2026-10-12）。
 * ==================================================================
 *
 * 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么**不**照抄参考实现的云
 * ---------------------------------------------------------------------------
 * 参考实现（`sunset-world.js`）的云是 `MarchingCubes` 雕出来的 metaball 云团：
 * 40 个球、分辨率 44³、逐体素求并集 —— 一次烘焙 ≈ **340 万次距离计算**，
 * 四个变体。它敢这么做，是因为它有一次性 loading 屏；本项目的岛是**活的**，
 * 那几秒会直接卡死主线程。
 *
 * 2026-10-15 用户要求云"尽力对齐"对标（截图反馈）。之后对齐到更像参考的
 * **cel 读法**（多档光带/凹谷/朝阳边），不再保留**墨线**：黑色等宽边是旧版
 * 最大的不协调点；参考实现的云本来就**没有描边**。
 *
 * 算法 / 资产仍不照搬：保留本项目的程序化瓣形状 + SDF/平滑前表面法线，
 * 不引入 `MarchingCubes` 网格或参考项目的图片素材。 *
 * ---------------------------------------------------------------------------
 * 摆位
 * ---------------------------------------------------------------------------
 * 三圈同心环，绕岛心。半径 54 / 72 / 92 —— 三个约束一起定的：
 *
 *   ① **不许切进航线**。飞机最远飞到 `R_FAR = 34`，翼展 3.9
 *      ⇒ 最近那圈 54 减去云自身半宽（最大 36/2 = 18）还剩 36 > 34 + 2。**擦不到**。
 *   ② **必须在天空穹顶里面**。穹顶半径 138（`camera.far × 0.92`）
 *      ⇒ 最远 92 + 18 = 110 < 138。
 *   ③ **从院子里看得见**。相机在 `y ≈ 0.2`、fov 60（**竖向**，所以画面上沿
 *      只有 +30°）。云的高度角 = `atan(y / r)`：
 *        · 最近圈 y 17~27 @ r 54 → 17.5°~26.6°  ✅ 在画面内
 *        · 最远圈 y 26~44 @ r 92 → 15.8°~25.6°  ✅
 *      全都在 30° 以内 ⇒ 一抬头就在。
 *
 * ⚠️ 从院子里看这些云是**化在霾里**的（`fogFar` 只有 76~128，而云在
 *    50~110 之外）—— 这是**对的**，不是 bug：远处本来就该化进霾。而飞起来
 *    之后相机到最近那圈只有 20~30 单位，云就清楚了。两个视角都对。
 *
 * 🔴 摆位是**确定性**的（固定种子的 LCG），不用 `Math.random()` ——
 *    否则每次刷新云的位置都不一样，截图不可复现（见 memory 那条）。
 */

import { ISLAND_CENTER } from './island';

const TAU = Math.PI * 2;

/** 固定的 LCG（与 `utils/cloudArt.js` 的 `mulberry32` 同族，这里内联以免跨模块耦合）。 */
function lcg(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * 云用哪几张素描（**sprite 下标**，不是槽位）。
 *
 * 取 `config/theme.js` 的 `CLOUD_SPRITES` 里**最宽最低**的三张
 * （aspect 1.894 / 3.577 / 3.0）—— 天空里的云要"横着铺开"，
 * 那几张矮胖/带拖尾的正合适。
 *
 * 🔴 「sprite 下标」与「槽位」是**两个不同的东西**，别混：
 *    · **sprite 下标** = 用哪张素描（0~7，`CLOUD_SPRITES` 的下标）；
 *    · **槽位**（`slot`）= 第几个 `InstancedMesh`（0~2）。
 *    混用会让 `placementsForSlot(6)` 返回空数组 —— 探针 P1 抓到的
 *    就是这个（当时 14 朵云只算出 9 朵，另外 5 朵**根本不会被渲染**）。
 */
export const SKY_CLOUD_SPRITES = Object.freeze([0, 2, 6]);

/** 槽位 → sprite 下标。**唯一的**换算处。 */
export function spriteForSlot(slot) {
    return SKY_CLOUD_SPRITES[slot % SKY_CLOUD_SPRITES.length];
}

/**
 * 三圈环。`y` / `scale` 是**世界单位**（云面片的宽 / 高由 `aspect` 反解）。
 *
 * ⚠️ `scale` 是面片的**宽度**，不是半径。最远圈 36 宽的云在 92 单位外
 *    张开 `2·atan(18/92) ≈ 22°` —— 在 900 像素高的画面上约 330 像素，够大。
 */
const RINGS = [
    { radius: 54, count: 5, y: [17, 27], scale: [15, 24], phase: 0.31 },
    { radius: 72, count: 5, y: [22, 36], scale: [18, 30], phase: 0.93 },
    { radius: 92, count: 4, y: [26, 44], scale: [22, 36], phase: 1.77 },
];

/**
 * 岛心 —— **从 `config/island.js` 取，不写死**。
 *
 * 🔴 第一版这里写的是 `(0, 0)`，而真值是 `[0, 18.15]`（= 屋身后端与院墙后端
 *    的中点）—— 于是整个云环**偏了 18 个单位**（都挤在屋后那一侧）。
 *    `flightPath.js` 的 `R_NEAR` 也是从同一个常量反解的，别处一律照做。
 */
const ISLAND_X = ISLAND_CENTER[0];
const ISLAND_Z = ISLAND_CENTER[1];

function buildPlacements() {
    const rand = lcg(0x5c10d5);
    const out = [];
    let slot = 0;
    for (const ring of RINGS) {
        for (let i = 0; i < ring.count; i += 1) {
            // 均匀铺 + 抖动：纯均匀会看出"一圈等距的糖葫芦"。
            const angle = (i / ring.count) * TAU + ring.phase + (rand() - 0.5) * 0.42;
            const radius = ring.radius + (rand() - 0.5) * 9;
            const lerp = (a, b, t) => a + (b - a) * t;
            out.push({
                x: ISLAND_X + Math.cos(angle) * radius,
                y: lerp(ring.y[0], ring.y[1], rand()),
                z: ISLAND_Z + Math.sin(angle) * radius,
                scale: lerp(ring.scale[0], ring.scale[1], rand()),
                /** 绕视线轴的微小滚转 —— 免得所有云底边都水平对齐。 */
                spin: (rand() - 0.5) * 0.10,
                /** 槽位（第几个 InstancedMesh），**不是** sprite 下标。 */
                slot: slot % SKY_CLOUD_SPRITES.length,
            });
            slot += 1;
        }
    }
    return out;
}

/**
 * 全部云的摆位。**只算一次**（模块级），之后是只读的。
 *
 * 每个槽位一组实例 ⇒ 每个槽位 **1 次 draw**，三张素描共 **3 次**。
 */
export const SKY_CLOUD_PLACEMENTS = Object.freeze(
    buildPlacements().map((p) => Object.freeze(p)),
);

/**
 * 某个**槽位**的全部摆位 —— `SkyClouds.jsx` 用它建 InstancedMesh。
 *
 * ⚠️ 名字里是 **slot** 不是 variant：这个参数是"第几个 InstancedMesh"，
 *    与"用哪张素描（`sprite`）"是**两件事**（换算只有 `spriteForSlot` 一处）。
 *    第一版把两者混起来写，导致 14 朵里 5 朵**从没画出来**且无报错（探针 P1）。
 */
export function placementsForSlot(slot) {
    return SKY_CLOUD_PLACEMENTS.filter((p) => p.slot === slot);
}

export const SKY_CLOUD_COUNT = SKY_CLOUD_PLACEMENTS.length;

/* ------------------------------------------------------------------------- */
/* 层片（WO-30，2026-10-13）                                                  */
/* ------------------------------------------------------------------------- */
/*
 * 用户：「云朵搞逼真一点（是否上 glsl）」→ 拍板 (A) 保留 billboard，
 * 把「形体」交给 GLSL 片元。其中第三条是**一朵云叠 2~3 层薄片出视差**。
 *
 * 🔴 为什么层片要有**深度差**，不能只是同一位置叠三张
 * ---------------------------------------------------------------------------
 * 三张完全共面的面片在屏幕上是同一张图，叠了等于没叠。视差来自
 * 「不同深度 + 相机移动」：三张沿**背离岛心的径向**拉开 0 / 3.2 / 6.8，
 * 相机一动它们就互相错开；飞行时相机到最近那圈只有 20~30 单位，错开很明显。
 *
 * 🔴 为什么层片要**朝外拉 + 略微放大**
 * ---------------------------------------------------------------------------
 * 后画的层被前面的挡住就白画了。所以越远的那层越**大**：它的轮廓会从
 * 前面那层后面探出来。而它同时也在雾里更远 ⇒ 由 `uHazeFar` 那一项自动
 * 洗得更淡 —— **不需要**给每个实例单独的不透明度（那要新增 instance 属性）。
 * 「大而淡」正是体积感的读法：一个清楚的核 + 一圈化在空气里的边。
 *
 * ⚠️ 层片是**真的几何**，所以 P2（不切航线）/ P3（穹顶内）/ P4（地面上）/
 *    P5（抬头看得见）必须对**展开后的实例表**再断言一遍 —— 只验 14 条
 *    逻辑摆位等于给一个假绿（§28）。`probe-sky-clouds.mjs` 就是这么改的。
 */

/** 每朵云叠几层。2 太少（视差读不出来），4 以上收益递减而实例数线性涨。 */
export const SKY_CLOUD_LAYERS = 3;

/**
 * 每层相对逻辑摆位的偏移（**世界单位**）与缩放。
 *
 * `out` 沿「岛心 → 云」的径向朝外；`up` 世界 +Y；`tan` 切向（水平、垂直于径向）
 * —— 切向那一点点是为了让三层的轮廓**不完全重合**，否则内层的边整条藏在
 * 外层后面，叠了几层看起来还是一层。
 *
 * `up` 刻意取得很小（≤ 0.5）：云的高度角本来就贴着竖向 fov 的上沿
 * （见文件头 ③），抬多了会跑出画面，那是 P5 在守的线。
 */
const LAYERS = [
    { out: 0.0, up: 0.00, tan: 0.00, scale: 1.00, spin: 0.000 },
    { out: 3.2, up: 0.22, tan: 0.80, scale: 1.07, spin: 0.050 },
    { out: 6.8, up: 0.44, tan: -1.05, scale: 1.14, spin: -0.040 },
];

/**
 * 把 14 条逻辑摆位展开成 `SKY_CLOUD_LAYERS × 14` 条**真实实例**。
 *
 * ⚠️ 展开是**纯函数**、**确定性**的（只用到常量表），所以每次算出来逐位相同；
 *    并且**只算一次**（模块级），之后只读。
 */
function expandLayers() {
    const out = [];
    for (const p of SKY_CLOUD_PLACEMENTS) {
        // 径向单位向量（岛心 → 云），以及它的切向（水平旋转 90°）。
        const dx = p.x - ISLAND_X;
        const dz = p.z - ISLAND_Z;
        const r = Math.hypot(dx, dz) || 1;
        const ux = dx / r;
        const uz = dz / r;
        const tx = -uz;
        const tz = ux;
        for (let k = 0; k < SKY_CLOUD_LAYERS; k += 1) {
            const L = LAYERS[k % LAYERS.length];
            out.push(Object.freeze({
                x: p.x + ux * L.out + tx * L.tan,
                y: p.y + L.up,
                z: p.z + uz * L.out + tz * L.tan,
                scale: p.scale * L.scale,
                spin: p.spin + L.spin,
                /** 槽位（第几个 InstancedMesh）。**不是** sprite 下标。 */
                slot: p.slot,
                /** 逻辑云的下标 + 第几层 —— 只有判据用，渲染不读。 */
                cloud: SKY_CLOUD_PLACEMENTS.indexOf(p),
                layer: k,
            }));
        }
    }
    return out;
}

/** 全部**真实实例**（含层片）。只算一次，之后只读。 */
export const SKY_CLOUD_INSTANCES = Object.freeze(expandLayers());

/**
 * 某个**槽位**的全部真实实例 —— `SkyClouds.jsx` 用它建 `InstancedMesh`。
 *
 * ⚠️ 这里返回的是**展开后**的表：每槽位 `14 / 3 × SKY_CLOUD_LAYERS` 条。
 *    一个槽位仍然只有 **1 次 draw**（`InstancedMesh` 的意义就在这）。
 */
export function instancesForSlot(slot) {
    return SKY_CLOUD_INSTANCES.filter((p) => p.slot === slot);
}

export const SKY_CLOUD_INSTANCE_COUNT = SKY_CLOUD_INSTANCES.length;
