import { useMemo } from 'react';
import * as THREE from 'three';

import {
    SURFACE_VERT, SONG_WALL_FRAG, STONE_FRAG, makeSurfaceUniforms,
} from '../../../shaders/entranceTextures';
import { makeThresholdTexture } from '../../../utils/gateArt';
import {
    FLOOR_Y, OUTDOOR_Y, OUTDOOR_DROP,
    APRON_W, APRON_DEPTH, APRON_FRONT_Z, APRON_TOP_Y,
    STEP_W, STEP_DEPTH, STEP_TOP_Y,
    THRESHOLD_W, THRESHOLD_H, THRESHOLD_D, THRESHOLD_Z,
    PIVOT_W, PIVOT_H, PIVOT_D, PIVOT_X,
    PLINTH_W, PLINTH_H, PLINTH_Z,
} from '../../../config/entranceMetrics';
import { sharedGeometry } from '../../../engine/resources';

/**
 * GateBase — 门座：台基 / 台明 / 踏跺 / 门槛 / 门枕石
 * ==================================================
 *
 * WHY THIS IS A SEPARATE COMPONENT
 * --------------------------------
 * 这五件东西是「一座宅子的门」和「一堵有门的墙」之间唯一的差别，而且它们
 * 互相咬合（台明的高度决定踏跺的踢面，门槛的宽度决定门枕石的位置），
 * 任何一件单独挪动都会让另外几件对不上。把它们放在一个文件里、尺寸全部
 * 从 config/entranceMetrics 派生，就不会再出现「改了门高忘了改横批」那类
 * drift —— EntranceDoors 已经 1200 行，它只需要说"这儿有座门座"。
 *
 * 换一个门、换一套尺寸，这个组件可以整体复用。
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
 * 铺装"是连续的；台基用 SONG_WALL_FRAG 的勒脚（冷调青石），因为它是墙脚
 * 而不是地面。冷暖分开是有意的：青石是墙，石板是路。
 */
const GateBase = ({ worldZ = 0 }) => {
    // 台明：从门平面稍后一点一直伸到踏跺前缘
    const apronCenterZ = APRON_FRONT_Z - APRON_DEPTH / 2;
    const stepCenterZ = APRON_FRONT_Z + STEP_DEPTH / 2;

    // 台基用墙的 shader，但关掉压顶（uCapFrac > 1 = 这面"墙"没有瓦顶），
    // 于是 0.30 高的整块面都落在勒脚那一段里，直接就是青石。
    const plinthUniforms = useMemo(() => ({
        ...makeSurfaceUniforms(PLINTH_W, PLINTH_H, [-PLINTH_W / 2, OUTDOOR_Y]),
        // 台基上没有门窗洞，把洞推到很远 —— 否则门洞的 discard 会在石台中间
        // 挖掉一块。
        uHoleDoor: { value: [0, 9999, 0, 0] },
        uHoleWindow: { value: [0, 9999, 0, 0] },
        uInk: { value: blankInk() },
        uInkStrength: { value: 0 },
        uCapFrac: { value: 2.0 },
    }), []);

    // 顶面：uInLawn = 0 —— 这块石板不挨着草。抬高的石台不会长草边，
    // 石缝里也不会长苔；草边和石缝的苔都是"铺装与草坪相接"的解法，
    // 用在一块悬空的台面上就变成了错的。
    const apronTopUniforms = useMemo(() => ({
        ...makeSurfaceUniforms(
            APRON_W, APRON_DEPTH,
            [-APRON_W / 2, worldZ + apronCenterZ + APRON_DEPTH / 2]
        ),
        uInLawn: { value: 0 },
    }), [apronCenterZ, worldZ]);

    const stepTopUniforms = useMemo(() => ({
        ...makeSurfaceUniforms(
            STEP_W, STEP_DEPTH,
            [-STEP_W / 2, worldZ + stepCenterZ + STEP_DEPTH / 2]
        ),
        uInLawn: { value: 0 },
    }), [stepCenterZ, worldZ]);

    const thresholdTexture = useMemo(() => makeThresholdTexture(), []);

    return (
        <group>
            {/* === 台基 — 整面墙脚下的青石勒脚 === */}
            <mesh position={[0, OUTDOOR_Y + PLINTH_H / 2, PLINTH_Z]}>
                <primitive object={sharedGeometry('plane', PLINTH_W, PLINTH_H)} attach="geometry" />
                <shaderMaterial
                    vertexShader={SURFACE_VERT}
                    fragmentShader={SONG_WALL_FRAG}
                    uniforms={plinthUniforms}
                />
            </mesh>

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

/**
 * 1x1 全透明贴图，喂给台基那套 SONG_WALL_FRAG 的 uInk。
 * sampler2D 不能传 null，而台基根本不需要水墨（uInkStrength = 0），
 * 为它生成一张 3.9 MB 的墙绘贴图是纯浪费。
 */
let _blankInk = null;
function blankInk() {
    if (_blankInk) return _blankInk;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    _blankInk = new THREE.CanvasTexture(c);
    _blankInk.colorSpace = THREE.SRGBColorSpace;
    return _blankInk;
}

export default GateBase;
