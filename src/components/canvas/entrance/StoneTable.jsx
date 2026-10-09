import {
    SURFACE_VERT, STONE_FRAG, makeSurfaceUniforms,
} from '../../../shaders/entranceTextures';
import { sharedGeometry } from '../../../engine/resources';
// 桌面/凳面用 STONE_FRAG —— 和台明、踏跺、甬路**同一套**石板，冬天会自动落一层
// 薄雪（shader 里的 uSnow）。所以它们也必须跟着季节走，否则雪后的院子里
// 只有这三块石头是干的。
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';

/**
 * StoneTable — 院子里的石桌 + 两个小石凳
 * ======================================
 *
 * 位置由调用方给：用户 2026-10-09 定的是「树下，树跟前」。树干在 world
 * x ≈ -2.82（见 entranceArt 的 trunk 骨架与 128 px/单位的换算），所以整个
 * 组摆在它**前**面一点 —— 树是一张 billboard 平面（z = 23），摆在 z 更大
 * 的一侧就是"树跟前"，depthTest 会让桌子正确地挡住树干的下半截。
 *
 * ---------------------------------------------------------------------------
 * 为什么每块石头都要单独出一张顶面
 * ---------------------------------------------------------------------------
 * 这个场景基本不打光（见 GateBase 的同一段说明）：一个纯色 box 从正面看就是
 * 一个纯色矩形，没有明暗就没有体积。所以石桌/石凳都按 GateBase 的老办法：
 * **侧面用压暗的纯色、顶面单独铺一张 STONE_FRAG 平面**，靠这个明暗差读出高度。
 * 顺带把季节也带上了 —— STONE_FRAG 是唯一带 `uSnow` 的石材。
 *
 * ⚠️ `uInLawn = 0`：石桌石凳是**独立摆件**，不挨着草。开着你会在石缝里看到
 * 苔、四周还长出一圈沿阶草 —— 那是"铺装与草坪相接"的解法，用在一个圆桌面上
 * 就变成错的（角上会冒出一撮草）。
 *
 * 几何全部走 sharedGeometry（零贴图、可复用实例）。
 */

/** 石板侧面的颜色：比顶面（STONE_FRAG 的暖调石板）暗一档，撑出高度感。 */
const STONE_SIDE = '#7E7264';
/**
 * 石板纹的**粗化系数** —— 只影响图案尺度，不动 shader。
 *
 * `STONE_FRAG` 的石缝是按 `cellSize = 0.34`（**世界单位**）切的，而那个世界
 * 坐标是 `world = vUv * uSize`。所以把 `uSize` 按比例报小一点，落在这块平面
 * 上的石缝就变**大**、变少 —— 0.34 的格子铺在甬路上正好是石板，铺在一张
 * 0.92 宽的圆桌面上只有 2.7 格，读出来是"马赛克拼的"，不是"一块石头"。
 *
 * ⚠️ `uInLawn = 0` 时 `uSize` 只剩这一个用途（草边与沿阶草的宽度都被关掉了），
 * 所以这里"报一个不是真实尺寸的 uSize"是安全的 —— 换桌子尺寸时记得一起看。
 */
const PATTERN = 0.72;
/**
 * 桌子：面半径 / 总高。
 *
 * ⚠️ 尺度按 DOOR_HEIGHT 反推：2.55 世界单位 ≈ 2.2 m 的实木门扇，即
 * **1 世界单位 ≈ 0.863 m**。真石桌面高约 0.70 m、面径约 0.86 m，
 * 于是总高 ≈ 0.78 世界单位、面半径 ≈ 0.50。
 * 第一版按 0.58 做，结果**比旁边的狗还矮**（狗 1.20 × DOG_SCALE 0.58 = 0.70）
 * —— 那是张茶几，不是石桌。
 */
const TOP_R = 0.50;
const TOP_H = 0.08;
const COLLAR_R = 0.15;
const COLLAR_H = 0.19;
const SHAFT_R = 0.115;
const SHAFT_H = 0.42;
const BASE_R = 0.26;
const BASE_H = 0.09;
/** 凳子：鼓形，座面比腰粗一点。真石凳高约 0.42 m、面径约 0.32 m。 */
const STOOL_R = 0.185;
const STOOL_TOP_H = 0.07;
const STOOL_BODY_R = 0.145;
const STOOL_BODY_H = 0.38;

export function StoneTable({ position, worldZ = 0 }) {
    // 桌面那一张平面的世界原点：只决定噪声取到的相位。这张桌面是**独立石板**
    // （周围是草，不是铺装），所以相位是任意的 —— 不必像台明那样和大平面接缝。
    const topUniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(TOP_R * 2 * PATTERN, TOP_R * 2 * PATTERN, [-TOP_R, worldZ + TOP_R], season),
            uInLawn: { value: 0 },
        }),
        [worldZ]
    );
    const stoolUniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(STOOL_R * 2 * PATTERN, STOOL_R * 2 * PATTERN, [-STOOL_R, worldZ + STOOL_R], season),
            uInLawn: { value: 0 },
        }),
        [worldZ]
    );

    const tableTopY = BASE_H + SHAFT_H + COLLAR_H + TOP_H;      // 0.58
    const stoolTopY = STOOL_BODY_H + STOOL_TOP_H;               // 0.355

    return (
        <group position={position}>
            {/* === 石桌 === */}
            <group>
                {/* 底座 */}
                <mesh position={[0, BASE_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', BASE_R, BASE_R * 1.06, BASE_H, 24)} attach="geometry" />
                    <meshBasicMaterial color={STONE_SIDE} />
                </mesh>
                {/* 柱身 */}
                <mesh position={[0, BASE_H + SHAFT_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', SHAFT_R, SHAFT_R, SHAFT_H, 20)} attach="geometry" />
                    <meshBasicMaterial color={STONE_SIDE} />
                </mesh>
                {/* 束腰（柱与桌面之间的那道托） */}
                <mesh position={[0, BASE_H + SHAFT_H + COLLAR_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', COLLAR_R, COLLAR_R * 0.82, COLLAR_H, 24)} attach="geometry" />
                    <meshBasicMaterial color={STONE_SIDE} />
                </mesh>
                {/* 桌面（厚度） */}
                <mesh position={[0, tableTopY - TOP_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', TOP_R, TOP_R * 0.96, TOP_H, 32)} attach="geometry" />
                    <meshBasicMaterial color={STONE_SIDE} />
                </mesh>
                {/* 桌面（顶面）—— 带石板纹理 + 冬天的薄雪 */}
                <mesh position={[0, tableTopY + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <primitive object={sharedGeometry('circle', TOP_R * 0.99, 32)} attach="geometry" />
                    <shaderMaterial
                        vertexShader={SURFACE_VERT}
                        fragmentShader={STONE_FRAG}
                        uniforms={topUniforms}
                    />
                </mesh>
            </group>

            {/* === 两个小石凳 === */}
            {STOOLS.map((s, i) => (
                <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
                    <mesh position={[0, STOOL_BODY_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_BODY_R, STOOL_BODY_R * 1.05, STOOL_BODY_H, 20)} attach="geometry" />
                        <meshBasicMaterial color={STONE_SIDE} />
                    </mesh>
                    <mesh position={[0, STOOL_BODY_H + STOOL_TOP_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_R, STOOL_R * 0.95, STOOL_TOP_H, 24)} attach="geometry" />
                        <meshBasicMaterial color={STONE_SIDE} />
                    </mesh>
                    <mesh position={[0, stoolTopY + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', STOOL_R * 0.99, 24)} attach="geometry" />
                        <shaderMaterial
                            vertexShader={SURFACE_VERT}
                            fragmentShader={STONE_FRAG}
                            uniforms={stoolUniforms}
                        />
                    </mesh>
                </group>
            ))}
        </group>
    );
}

/**
 * 两张凳子的相对位姿 —— 分列桌子左右。
 *
 * 间距让得过：桌沿 0.50 + 凳沿 0.185 = 0.685 才会相碰，这里放到 0.88，
 * 中间留出能过脚的一道缝；两张凳子的 z 与转角各差一点，免得读成
 * 一次建模复制出来的。
 */
const STOOLS = [
    { x: 0.88, z: 0.06, yaw: 0.22 },
    { x: -0.88, z: -0.05, yaw: -0.15 },
];

export default StoneTable;
