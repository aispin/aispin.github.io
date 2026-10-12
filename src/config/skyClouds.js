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
 * 更根本的是：**本项目已经有自己的云了** —— `utils/cloudArt.js` 那八张
 * 程序化"水墨云"（白身 + 墨线描边 + 腹灰），摄影室（Gallery）一直在用。
 * 搬一套紫色 3D 云进来，等于在自家院子里挂别人的画。
 *
 * 所以这里对齐的是**做法**，不是资产：
 *   · 云的**形状**沿用 `cloudArt` 的素描（零位图、已有语汇）；
 *   · 云的**上色**改成着色器里按 `uv.y` 的竖向渐变（受光顶 / 背光底）
 *     + 朝阳暖边 + 走 `scene.fog` 的霾 —— 这三样正是参考实现让云"像画的"
 *     的地方（它的 cel 分色 + 金边 + distance haze）。
 *   · 颜色**不另立色板**：从**天空穹顶的 uniform** 派生（见 `SkyClouds.jsx`）
 *     ⇒ 换季 / 入夜时云和天**不可能**不同步。
 *
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
