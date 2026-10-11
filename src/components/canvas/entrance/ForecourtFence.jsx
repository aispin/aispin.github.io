import { useMemo } from 'react';

import * as I from '../../../config/island';
import { GRASS_Y } from '../../../config/entranceMetrics';
import { seededRand } from '../../../engine/art';
import { buildFenceRun, caneCount } from '../../../utils/caneFence';
import CaneFenceMesh from './CaneFenceMesh';

/**
 * ForecourtFence — 门**外**那片竹篱笆小院的围篱（WO-6 第 ② 条）
 * ============================================================
 *
 * 用户 2026-10-11 定案：
 *
 *   「② 在前门外面再拓展一个开放的小院子（用竹篱笆），至于小院子放什么
 *      摆设，我们后话。」
 *
 * 所以这个组件**只做围合**，不摆任何东西 —— 石桌 / 花箱 / 缸 / 狗 / 柿子树
 * 都还挂在 `EntranceDoors` 上（那才是它们原来的位置，就在门口），
 * 院子里要加什么等用户下一轮说。
 *
 * ---------------------------------------------------------------------------
 * 围哪三面
 * ---------------------------------------------------------------------------
 *
 *                     z = 38.15  ┌── 门 ──┐      ← 正前那道（中间留口给甬路）
 *                               │  ↑    ↑  │
 *                       左篱笆 →│  前院    │← 右篱笆
 *                               │         │
 *                     z = 22.15 └─────────┘      ← 屋身前墙（**没有篱笆**）
 *
 * 内面**不围**：屋身的前墙本身就是那一边的边界。给内面再加一道篱笆，
 * 它会贴在墙根上，既没有意义，又会在墙的勒脚前面多出一层要排序的东西。
 *
 * ---------------------------------------------------------------------------
 * 正前方那道篱笆上必须留口
 * ---------------------------------------------------------------------------
 * 甬路（`EntranceDoors` 里那条 `pathWidth ≈ 3.06` 的石板路）从踏跺一直铺到
 * `FORECOURT_BACK_Z`。篱笆要是拉通，路就一头撞在篱笆上 —— 而且从大门往外
 * 看，视线正好被那道横着的篱笆截断。所以留 `|x| < FORECOURT_GATE_HALF_W`
 * （1.7，刚好包住 3.06 宽的路），并在两边各立一根**比篱笆高、比竹竿粗**
 * 的立柱：一根光秃秃的缺口读起来像"缺了一段"，两根立柱一夹就读成"门"。
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么不挂藤
 * ---------------------------------------------------------------------------
 * 原来那道**沿墙矮篱**（`BambooFence`，2026-10-11 已被用户换成狗尾巴草
 * `FoxtailGrass`）挂过一张藤贴图，做法是"3.65 宽 × 0.45 高的画布，里面一条
 * 从左下爬到右上的主藤"。这里的几段篱笆长 16 和 9.3，也就是 2.5~4.4 格 ——
 * 想贴满就得平铺，而平铺出来是**同一条藤并排重复 4 次**，起止点一模一样。
 *
 * 这正是本项目点名过的那种"复制粘贴"（见 `HouseShell` 的 `GableWall`：
 * 两侧山墙特意给不同的 `uOrigin.x`，就是为了避免左右砖缝一模一样）。
 * 所以这一层**不挂藤**：竹竿 + 横档本来就是一道真竹篱的全部。
 * 要藤的话应该另出一张按 16 : 0.62 画的贴图，那是新的一件活。
 *
 * ---------------------------------------------------------------------------
 * 尺寸 / 疏密全部从 config 派生
 * ---------------------------------------------------------------------------
 * 长度、位置、高度都读 `config/island.js` 的 `FORECOURT_*`；立竹疏密读
 * `utils/caneFence.js` 的 `CANE_STEP`（唯一的尺子）。
 * 这个文件里唯一手写的数是立柱的加粗加高倍数。
 */

/** 门口立柱：比篱笆高 28%、比竹竿粗一倍（0.032 vs 0.0135~0.0175）。 */
const POST_H = I.FORECOURT_FENCE_H * 1.28;
const POST_R = 0.032;

/** 一根立柱的实例项（局部 x = 0，摆放交给 `runs[].position`）。 */
function postItem(rand) {
    return {
        x: 0,
        y: POST_H / 2,
        z: 0,
        rotZ: 0,
        radius: POST_R,
        len: POST_H,
        bend: 1,
        nodes: 3,
        phase: rand() * Math.PI * 2,
        tint: rand(),
    };
}

export function ForecourtFence() {
    /**
     * 5 段围篱 + 2 根立柱，全部折进**一个** InstancedMesh。
     *
     * ⚠️ 种子与调用顺序固定：同一次刷新/每一台机器长出来的院子一模一样
     *    （项目契约 1：程序化必须是确定性的）。想换样子请换种子。
     */
    const runs = useMemo(() => {
        const rand = seededRand('forecourt-fence-v1');
        const H = I.FORECOURT_FENCE_H;
        const runs = [];

        // ---- 左右两道：沿 z，从屋身前墙一路到正前那道 --------------------
        // rotationY = π/2 ⇒ 局部 +x 转到世界 −z，所以长度直接用前院进深。
        for (const side of [-1, 1]) {
            runs.push({
                items: buildFenceRun({
                    rand,
                    length: I.FORECOURT_DEPTH,
                    height: H,
                    caneN: caneCount(I.FORECOURT_DEPTH),
                }),
                position: [side * I.FORECOURT_HALF_W, GRASS_Y, I.FORECOURT_CENTER_Z],
                rotationY: Math.PI / 2,
            });
        }

        // ---- 正前两翼：沿 x，中间那段留给甬路 ----------------------------
        const wingW = I.FORECOURT_HALF_W - I.FORECOURT_GATE_HALF_W;
        for (const side of [-1, 1]) {
            runs.push({
                items: buildFenceRun({
                    rand,
                    length: wingW,
                    height: H,
                    caneN: caneCount(wingW),
                }),
                position: [
                    side * (I.FORECOURT_GATE_HALF_W + wingW / 2),
                    GRASS_Y,
                    I.FORECOURT_BACK_Z,
                ],
                rotationY: 0,
            });
        }

        // ---- 门口两根立柱 ------------------------------------------------
        for (const side of [-1, 1]) {
            runs.push({
                items: [postItem(rand)],
                position: [side * I.FORECOURT_GATE_HALF_W, GRASS_Y, I.FORECOURT_BACK_Z],
                rotationY: 0,
            });
        }

        return runs;
    }, []);

    return <CaneFenceMesh runs={runs} />;
}

export default ForecourtFence;
