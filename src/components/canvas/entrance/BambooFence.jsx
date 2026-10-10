import { useSeason } from '../../../hooks/useSeason';
import { sharedGeometry } from '../../../engine/resources';
import { BAMBOO_FENCE_ASPECT, makeBambooFenceTexture } from '../../../utils/entranceArt';

/**
 * BambooFence — 沿墙的矮竹篱（§6.3，P3）
 * ======================================
 *
 * **一张程序化贴图 + 一块 alphaTest 平面，不做实体几何**（§6.3 明确要求，
 * 与树、藤蔓同款做法）。所以它只占 **1 个 mesh** —— 26 根立竹、2 道横档、
 * 34 片叶子全在贴图里。
 *
 * 季节：§6.3「季节只改**攀爬植物**的配色」。叶色烘在贴图里（缓存键含季节），
 * 色号复用花箱那丛的 `SEASON_PLANT` —— 同一个院子里两处绿植用两套绿会被看出来。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 位置：z 必须**大于门脸砖面的 0.15**，且**小于花箱的前脸 0.65**
 * ---------------------------------------------------------------------------
 * 门脸的青砖平面停在 z = 0.15，花箱箱体占 z ∈ [0.15, 0.65]、荷花缸占
 * z ∈ [0.095, 0.705]。取 **z = 0.24**：
 *   · 在砖面前面 ⇒ 看得见（不是被墙吞掉）；
 *   · 在花箱/缸的**内部** ⇒ 与它们重叠的那几段被不透明的箱体/缸体挡住，
 *     于是读成"竹篱沿墙一路铺过去，被花箱和缸打断" —— 这正是真院子的样子。
 * 平面**穿进**箱体内部是无害的：两者都在不透明 pass，深度测试直接把
 * 被挡住的那部分丢掉了（不是 transparent 排序问题）。
 *
 * ⚠️ 不写进 `config/entranceMetrics.js`：那是入口**竖向**几何的唯一真源，
 * 竹篱是独立摆件（§7 硬约束）。
 */

/** 篱高（世界单位）。真矮竹篱 ~0.4 m，按 1 单位 ≈ 0.863 m ⇒ 0.45 ≈ 0.39 m。 */
const FENCE_H = 0.45;
const FENCE_W = FENCE_H * BAMBOO_FENCE_ASPECT;

export function BambooFence({ position }) {
    const season = useSeason();
    const tex = makeBambooFenceTexture(season);

    return (
        <group position={position}>
            <mesh position={[0, FENCE_H / 2, 0]}>
                <primitive object={sharedGeometry('plane', FENCE_W, FENCE_H)} attach="geometry" />
                {/* alphaTest（不是 transparent）：硬边抠图走不透明 pass，
                    写深度 ⇒ 不会和花箱/缸互相排序。见 engine/resources.js
                    的 `cutoutMaterial` 契约 —— 这里用 standard 是为了吃到平光下的
                    明暗，和石桌顶面同一套路。 */}
                <meshStandardMaterial map={tex} alphaTest={0.5} roughness={0.9} />
            </mesh>
        </group>
    );
}

export default BambooFence;
