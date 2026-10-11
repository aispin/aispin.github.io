import { useMemo } from 'react';

import {
    SURFACE_VERT, STONE_FRAG, makeSurfaceUniforms,
} from '../../../shaders/entranceTextures';
import { makeThresholdTexture } from '../../../utils/gateArt';
import {
    FLOOR_Y, OUTDOOR_Y, OUTDOOR_DROP,
    APRON_W, APRON_DEPTH, APRON_FRONT_Z, APRON_TOP_Y,
    STEP_W, STEP_DEPTH, STEP_TOP_Y,
    THRESHOLD_W, THRESHOLD_H, THRESHOLD_D, THRESHOLD_Z,
    PIVOT_W, PIVOT_H, PIVOT_D, PIVOT_X,
} from '../../../config/entranceMetrics';
import { sharedGeometry } from '../../../engine/resources';
// 台明 / 踏跺的顶面用 STONE_FRAG，冬天会落一层薄雪（见 shader 里的 uSnow），
// 所以这两块也要跟着季节走 —— 否则雪后的院子里只有门前那块石头是干的。
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';

/**
 * GateBase — 门座：台明 / 踏跺 / 门槛 / 门枕石
 * ============================================
 *
 * WHY THIS IS A SEPARATE COMPONENT
 * --------------------------------
 * 这几件东西是「一座宅子的门」和「一堵有门的墙」之间唯一的差别，而且它们
 * 互相咬合（台明的高度决定踏跺的踢面，门槛的宽度决定门枕石的位置），
 * 任何一件单独挪动都会让另外几件对不上。把它们放在一个文件里、尺寸全部
 * 从 config/entranceMetrics 派生，就不会再出现「改了门高忘了改横批」那类
 * drift —— EntranceDoors 已经 1200 行，它只需要说"这儿有座门座"。
 *
 * 换一个门、换一套尺寸，这个组件可以整体复用。
 *
 * ⚠️ 2026-10-11：**第五件「台基」删掉了**。它原来是 10 宽（`PLINTH_W =
 * FACADE_W`）、0.30 高、停在门脸之前 0.05 的一块青石勒脚，存在的理由是
 * 那面 10×6 的门脸**底下是空的** —— 门脸下沿在 FLOOR_Y，而室外地面在
 * OUTDOOR_Y，中间那 0.30 得有人填。
 *
 * 门脸并进屋身前墙之后这个理由消失了：屋身前墙自己就从 `GRASS_Y` 起画，
 * 而且 `SONG_WALL_FRAG` 的勒脚段（`plinthTop = 0.62`，用**世界坐标**
 * 算石缝）已经给了它一条连续的青石墙脚。再叠一块 10 宽的同款青石，只会
 * 在 22 宽的墙上留下一道**只有 10 宽的勒脚**，而且两块面的石缝相位差
 * 0.04（`OUTDOOR_Y` vs `GRASS_Y`）⇒ 接缝处石头对不上。
 *
 * 判据：`SONG_WALL_FRAG` 里 `plinthTop` 是**墙自己**的常数，与调用方无关，
 * 所以"墙有没有勒脚"不需要外部构件来回答。
 *
 * ---------------------------------------------------------------------------
 * 标高（这是这个组件存在的理由）
 * ---------------------------------------------------------------------------
 *
 *   FLOOR_Y        -1.75   室内地面 / 门扇底边 / 台明顶面
 *   STEP_TOP_Y     -1.90   踏跺顶面              （踢面 0.15）
 *   OUTDOOR_Y      -2.05   室外地面 / 甬路底      （踢面 0.15）
 *   GRASS_Y        -2.09   草坪
 *
 * 在改成这样之前，草坪只比室内低 2 cm —— 那个 2 cm 是为了防共面闪烁加的，
 * 不是给人走的。结果就是门前**没有台阶可上**，人从草地直接"走进去"，
 * 大门因此读起来像一堵插了门的墙。0.30 是两级真实的踏跺踢面高度。
 *
 * ---------------------------------------------------------------------------
 * 这个场景不打光，所以"立体"靠的是每面颜色不同
 * ---------------------------------------------------------------------------
 * 全站是 meshBasicMaterial（无光照），一个纯色 box 从正面看就是一个纯色
 * 矩形 —— 没有明暗就没有体积。所以每个石台的**顶面单独出一块 STONE_FRAG
 * 平面**（比侧面亮、且带石板纹理），侧面用压暗的纯色，靠这个明暗差读出
 * "这是一个可以踩上去的台子"。
 *
 * 台明/踏跺的顶面故意用和甬路同一套 STONE_FRAG（暖调石板），让"门前这一片
 * 铺装"是连续的；墙脚那条青石勒脚则由屋身前墙自己出（见上）。冷暖分开是
 * 有意的：青石是墙，石板是路。
 */
const GateBase = ({ worldZ = 0 }) => {
    // 台明：从门平面稍后一点一直伸到踏跺前缘
    const apronCenterZ = APRON_FRONT_Z - APRON_DEPTH / 2;
    const stepCenterZ = APRON_FRONT_Z + STEP_DEPTH / 2;

    // 顶面：uInLawn = 0 —— 这块石板不挨着草。抬高的石台不会长草边，
    // 石缝里也不会长苔；草边和石缝的苔都是"铺装与草坪相接"的解法，
    // 用在一块悬空的台面上就变成了错的。
    const apronTopUniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(
                APRON_W, APRON_DEPTH,
                [-APRON_W / 2, worldZ + apronCenterZ + APRON_DEPTH / 2],
                season
            ),
            uInLawn: { value: 0 },
        }),
        [apronCenterZ, worldZ]
    );

    const stepTopUniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(
                STEP_W, STEP_DEPTH,
                [-STEP_W / 2, worldZ + stepCenterZ + STEP_DEPTH / 2],
                season
            ),
            uInLawn: { value: 0 },
        }),
        [stepCenterZ, worldZ]
    );

    const thresholdTexture = useMemo(() => makeThresholdTexture(), []);

    return (
        <group>
            {/* === 台明 — 门前那块抬高的石台 === */}
            <mesh position={[0, OUTDOOR_Y + OUTDOOR_DROP / 2, apronCenterZ]}>
                <primitive object={sharedGeometry('box', APRON_W, OUTDOOR_DROP, APRON_DEPTH)} attach="geometry" />
                <meshBasicMaterial color={STONE_RISER} />
            </mesh>
            <mesh position={[0, APRON_TOP_Y + 0.004, apronCenterZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <primitive object={sharedGeometry('plane', APRON_W, APRON_DEPTH)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={STONE_FRAG}
                    uniforms={apronTopUniforms}
                />
            </mesh>

            {/* === 踏跺 — 一级台阶 === */}
            <mesh position={[0, OUTDOOR_Y + (OUTDOOR_DROP / 2) / 2, stepCenterZ]}>
                <primitive object={sharedGeometry('box', STEP_W, OUTDOOR_DROP / 2, STEP_DEPTH)} attach="geometry" />
                <meshBasicMaterial color={STONE_RISER} />
            </mesh>
            <mesh position={[0, STEP_TOP_Y + 0.004, stepCenterZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <primitive object={sharedGeometry('plane', STEP_W, STEP_DEPTH)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={STONE_FRAG}
                    uniforms={stepTopUniforms}
                />
            </mesh>

            {/* === 门枕石 — 门扇的转轴就坐在上面 === */}
            {[-1, 1].map((side) => (
                <group key={side} position={[side * PIVOT_X, 0, THRESHOLD_Z]}>
                    <mesh position={[0, FLOOR_Y + PIVOT_H / 2, 0]}>
                        <primitive object={sharedGeometry('box', PIVOT_W, PIVOT_H, PIVOT_D)} attach="geometry" />
                        <meshBasicMaterial color={PIVOT_SIDE} />
                    </mesh>
                    {/* 顶面比门槛高 7 cm —— 真实门枕石就是这样露在门槛之上的 */}
                    <mesh position={[0, FLOOR_Y + PIVOT_H + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('plane', PIVOT_W, PIVOT_D)} attach="geometry" />
                        <meshBasicMaterial color={PIVOT_TOP} />
                    </mesh>
                </group>
            ))}

            {/* === 门槛 — 要抬脚跨过去的那根梁 ===
                横跨门洞并伸进两侧门枕石里，所以它的顶面比台明高 17 cm，
                也是整个门座上唯一一个"你必须做动作才能通过"的构件。 */}
            <mesh position={[0, FLOOR_Y + THRESHOLD_H / 2, THRESHOLD_Z]}>
                <primitive object={sharedGeometry('box', THRESHOLD_W, THRESHOLD_H, THRESHOLD_D)} attach="geometry" />
                <meshBasicMaterial map={thresholdTexture} />
            </mesh>
        </group>
    );
};

/* 台明/踏跺的侧面：比顶面的石板暗一档，靠这个明暗差读出高度。 */
const STONE_RISER = '#8C7F6E';
/* 青石：冷调，比甬路的暖调石板明显偏灰蓝，这样"墙脚"和"路面"不会混成一片。 */
const PIVOT_SIDE = '#6A706C';
const PIVOT_TOP = '#8A9088';

export default GateBase;
