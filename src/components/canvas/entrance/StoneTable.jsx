import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { makeStoneSlabTexture } from '../../../utils/entranceArt';

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
 * 🔴 为什么是 `meshStandardMaterial`（**受光**）而不是 `meshBasicMaterial`
 * ---------------------------------------------------------------------------
 * 用户 2026-10-09 连着报两次「桌面、凳面看起来是倾斜的」，并给了正确的线索：
 * 「参考下兔子的花箱，它没有倾斜的感觉」。
 *
 * 花箱（`EntranceProps` 的 `WoodenPlanter`）用的是 `meshStandardMaterial` ——
 * **受光**。于是它的立面与曲面各自拿到不同的明暗，**圆柱侧面还会出现横向渐变**
 * （中间亮、两侧暗到轮廓）—— 这个渐变是"这是个圆柱"的最强线索。
 *
 * 而石桌第一版是 `meshBasicMaterial` + 一张 `STONE_FRAG` 顶面：**全都不受光**。
 * 一个不受光的圆柱 = 一条等宽纯色带 → 读成 2D 矩形；顶上再压一个纯色椭圆
 * → 整件东西读成"剪下来贴上去的"。而**一个没有厚度线索的椭圆，眼睛只能把它
 * 解释成一个斜着放的圆盘**。
 *
 * 所以"倾斜"根本不是几何问题 —— 圆盘在透视下本来就是椭圆，那是对的
 * （实测该椭圆的长短轴比 0.33，与相机高度/距离算出来的 0.29 吻合）。
 * 缺的是**光照**。改法：整件换成 `meshStandardMaterial`，和花箱/小狗/兔子同一套。
 *
 * ⚠️ 代价：失去 `STONE_FRAG` 的图案与它自带的 `uSnow`。冬天的雪改由一张
 * **略小的雪盖**表达（`SNOW_TOP` / `SNOW_R`，见下）。
 *
 * ⚠️ 顶面仍然单独出一张平面：一个 mesh 只有一个材质，而桌面那个圆柱的
 * **侧壁（厚度）要暗、顶面要亮** —— 这条明暗关系是 GateBase 立下的老规矩，
 * 和受不受光无关。
 */

/** 立柱/底座/桌沿：受光材质，比桌面暗一档 —— 靠明暗差读出高度。 */
const STONE_SIDE = '#8A8072';
/**
 * 桌面/凳面的颜色**烘在贴图里**（`makeStoneSlabTexture`，同族但提亮一档）。
 *
 * 🔴 顶面**必须有花纹** —— 见那个函数的说明：纯色椭圆在透视下没有可读的
 * 朝向线索，这正是"看起来倾斜"的根因。
 */
/** 冬天的雪盖。比台明/甬路那层"扫过的薄雪"更厚 —— 路扫过了，桌子没人扫。 */
const SNOW_TOP = '#E4E9EF';
/** 雪盖比桌面略小：露出一圈石头边，才读得出"雪**落在**石头上"而不是"桌子是白的"。 */
const SNOW_R = 0.93;

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
const TOP_H = 0.15;
const COLLAR_R = 0.15;
const COLLAR_H = 0.19;
const SHAFT_R = 0.115;
const SHAFT_H = 0.35;
const BASE_R = 0.26;
const BASE_H = 0.09;
/** 凳子：鼓形，座面比腰粗一点。真石凳高约 0.42 m、面径约 0.32 m。 */
const STOOL_R = 0.185;
const STOOL_TOP_H = 0.12;
const STOOL_BODY_R = 0.145;
const STOOL_BODY_H = 0.33;

export function StoneTable({ position }) {
    // 只有冬天需要雪盖 —— 其余季节它 `visible={false}`，一次 draw 都不发。
    const isWinter = useSeason() === 'winter';
    // 按 key 缓存，每次 render 调都是同一张
    const stoneTop = makeStoneSlabTexture();

    const tableTopY = BASE_H + SHAFT_H + COLLAR_H + TOP_H;      // 0.78（板厚算在里面）
    const stoolTopY = STOOL_BODY_H + STOOL_TOP_H;               // 0.45

    return (
        <group position={position}>
            {/* === 石桌 === */}
            <group>
                {/* 底座 */}
                <mesh position={[0, BASE_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', BASE_R, BASE_R * 1.06, BASE_H, 24)} attach="geometry" />
                    <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                </mesh>
                {/* 柱身 */}
                <mesh position={[0, BASE_H + SHAFT_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', SHAFT_R, SHAFT_R, SHAFT_H, 20)} attach="geometry" />
                    <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                </mesh>
                {/* 束腰（柱与桌面之间的那道托） */}
                <mesh position={[0, BASE_H + SHAFT_H + COLLAR_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', COLLAR_R, COLLAR_R * 0.82, COLLAR_H, 24)} attach="geometry" />
                    <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                </mesh>
                {/* 桌面（厚度）—— 侧壁压暗，顶面提亮，靠这条明暗差读出板厚 */}
                <mesh position={[0, tableTopY - TOP_H / 2, 0]}>
                    <primitive object={sharedGeometry('cylinder', TOP_R, TOP_R * 0.96, TOP_H, 32)} attach="geometry" />
                    <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                </mesh>
                {/* 桌面（顶面） */}
                <mesh position={[0, tableTopY + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <primitive object={sharedGeometry('circle', TOP_R * 0.99, 32)} attach="geometry" />
                    <meshStandardMaterial map={stoneTop} roughness={0.85} />
                </mesh>
                {/* 冬：雪盖 */}
                <mesh
                    visible={isWinter}
                    position={[0, tableTopY + 0.014, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                >
                    <primitive object={sharedGeometry('circle', TOP_R * SNOW_R, 32)} attach="geometry" />
                    <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                </mesh>
            </group>

            {/* === 两个小石凳 === */}
            {STOOLS.map((s, i) => (
                <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
                    <mesh position={[0, STOOL_BODY_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_BODY_R, STOOL_BODY_R * 1.05, STOOL_BODY_H, 20)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    <mesh position={[0, STOOL_BODY_H + STOOL_TOP_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_R, STOOL_R * 0.95, STOOL_TOP_H, 24)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    <mesh position={[0, stoolTopY + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', STOOL_R * 0.99, 24)} attach="geometry" />
                        <meshStandardMaterial map={stoneTop} roughness={0.85} />
                    </mesh>
                    <mesh
                        visible={isWinter}
                        position={[0, stoolTopY + 0.014, 0]}
                        rotation={[-Math.PI / 2, 0, 0]}
                    >
                        <primitive object={sharedGeometry('circle', STOOL_R * SNOW_R, 24)} attach="geometry" />
                        <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
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
