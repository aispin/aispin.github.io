import { useMemo } from 'react';
import * as THREE from 'three';

import { useSeason } from '../../../hooks/useSeason';
import { sharedGeometry } from '../../../engine/resources';
import { seededRand } from '../../../engine/art';
import { BAMBOO_FENCE_ASPECT, makeBambooFenceTexture } from '../../../utils/entranceArt';
import {
    WALL_FENCE_H,
    FENCE_TILE_W,
    CANE_N_PER_TILE,
    buildFenceRun,
} from '../../../utils/caneFence';
import CaneFenceMesh from './CaneFenceMesh';

/**
 * BambooFence — 屋身前墙脚那道矮竹篱（§6.3，P3）
 * ============================================
 *
 * 2026-10-11 改版：**竹竿和横档从贴图变成实体几何**（L2 的 WO-2）。
 *
 * 为什么改
 * --------
 * 原来是「一张程序化贴图 + 一块 alphaTest 平面」。正面看没问题，但院子
 * 能绕着看之后，绕到侧面它就是**字面意义上的一张纸** —— 厚度为零，
 * 而且单面材质从背后直接被剔除，整片消失。这是 L1「背面清单」里点名
 * 的一个洞。
 *
 * 现在：
 *   · **竹竿 + 横档** = `InstancedMesh`（1 次 draw call）。全项目原来零处
 *     InstancedMesh，所以这里顺手把「竹竿怎么实例化」这条路修通（竹林
 *     `BambooGrove` 用同款思路）。
 *   · **藤 + 叶** = 仍然一张 alphaTest 平面。理由：藤本来就是薄东西，
 *     一张纸对它是对的；而且 §6.3 规定「季节只改**攀爬植物**的配色」，
 *     叶色烘在贴图里最省事。贴图改成只画藤（`vineOnly`）。
 *
 * 🔴 竹竿那一层已经**抽出去共用了**（WO-6）
 * -----------------------------------------
 * 门外的竹篱笆小院（`ForecourtFence`）要的是同一种篱笆，只是更长。所以：
 *
 *   · 尺子 / 实例清单 / 几何体 → `utils/caneFence.js`
 *   · 着色器                   → `shaders/caneFence.js`
 *   · 把 N 段画成一个 InstancedMesh → `CaneFenceMesh.jsx`
 *
 * **本文件只剩「沿墙那一道」**：长度固定一格贴图（`FENCE_TILE_W` = 3.65）、
 * 高度 `WALL_FENCE_H` = 0.45、贴在墙脚，外加一张藤。疏密由 `CANE_STEP` 定，
 * 与院墙同一把尺子。
 *
 * ⚠️ 位置：z 必须**大于门脸砖面的 0.15**，且**小于花箱的前脸 0.65**
 * ---------------------------------------------------------------------------
 * 屋身前墙的青砖平面停在 z = 0.15（局部），花箱箱体占 z ∈ [0.15, 0.65]、
 * 荷花缸占 z ∈ [0.095, 0.705]。取 **z = 0.24**：
 *   · 在砖面前面 ⇒ 看得见（不是被墙吞掉）；
 *   · 在花箱/缸的**内部** ⇒ 与它们重叠的那几段被不透明的箱体/缸体挡住，
 *     于是读成「竹篱沿墙一路铺过去，被花箱和缸打断」 —— 这正是真院子的样子。
 * 平面**穿进**箱体内部是无害的：两者都在不透明 pass，深度测试直接把
 * 被挡住的那部分丢掉了（不是 transparent 排序问题）。
 *
 * ⚠️ 不写进 `config/entranceMetrics.js`：那是入口**竖向**几何的唯一真源，
 * 竹篱是独立摆件（§7 硬约束）。
 */

export function BambooFence({ position }) {
    const season = useSeason();

    // 一段 3.65 长的矮篱 —— 正好一格藤贴图那么宽。
    // ⚠️ 种子和下面的参数**不能动**：这道篱笆的样子已经验收过（疏密、
    //    高度抖动、色调），换种子等于换一道篱笆。
    const runs = useMemo(
        () => [{
            items: buildFenceRun({
                rand: seededRand('bamboo-fence-v1'),
                length: FENCE_TILE_W,
                height: WALL_FENCE_H,
                caneN: CANE_N_PER_TILE,
            }),
            position: [0, 0, 0],
            rotationY: 0,
        }],
        []
    );

    // 藤：只画攀爬植物，贴在竹竿**前面** 3 cm。
    // alphaTest（不是 transparent）：硬边抠图走不透明 pass，写深度 ⇒
    // 不会和花箱/缸互相排序（见 engine/resources.js 的 cutoutMaterial 契约）。
    const vineTex = makeBambooFenceTexture(season, { vineOnly: true });

    return (
        <group position={position}>
            <CaneFenceMesh runs={runs} />

            {/* `DoubleSide`：藤本来就是薄东西，一张纸对它是对的 —— 但**单面**
                的纸从背后会被剔除、整片消失。alphaTest 走的是不透明 pass、
                写深度，双面不会引入排序问题（见 engine/resources.js 的
                cutoutMaterial 契约），所以这里直接开双面。 */}
            <mesh position={[0, WALL_FENCE_H / 2, 0.03]}>
                <primitive object={sharedGeometry('plane', FENCE_TILE_W, WALL_FENCE_H)} attach="geometry" />
                <meshStandardMaterial map={vineTex} alphaTest={0.5} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

export default BambooFence;
