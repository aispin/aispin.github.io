import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { makeStoneSlabTexture } from '../../../utils/entranceArt';

/**
 * StoneTable — 院子里的石桌 + 两个小石凳
 * ======================================
 *
 * 位置由调用方给：用户 2026-10-09 定的是「树下，树跟前」。
 *
 * ---------------------------------------------------------------------------
 * 🔴 用户连报三次「桌面/凳面看起来往地面倾斜」—— 前两轮的修法都是错的
 * ---------------------------------------------------------------------------
 * 第三轮用户给了决定性的线索：「**为什么花箱没有这个问题**」，并说
 * 「其他的应用也圆顶，但不会出现倾斜问题」。于是不再靠推理，直接量
 * （`harness/probe-table-tilt.mjs`）：
 *
 *   | 面        | 世界法线 | **屏幕椭圆长轴角**   |
 *   | 石桌面    | (0,1,0)  | **−9.06°**           |
 *   | 左/右凳面 | (0,1,0)  | **−11.61° / −9.72°** |
 *   | 花箱顶面  | (0,1,0)  | 远棱 **0.00°** / 近棱 **0.00°** |
 *
 * **几何是平的（法线精确 (0,1,0)）；歪的是「投影出来的椭圆」。** 水平圆的投影
 * 椭圆在偏离画面中轴时**必然**旋转，闭式解（相机无滚转、up=(0,1,0)）：
 *
 *     φ ≈ ½·atan2( 2X·Y , d² + X² − Y² )      X,Y,d = 盘心在**相机空间**的坐标
 *
 * 实测 −8.91° / −11.66° / −8.97° vs 上面的 −9.06 / −11.61 / −9.72 —— 对得上。
 * **所以渲染没错，错的是「我们以为平的东西会画成平的」。**
 *
 * 这不是 three.js 的毛病，换 Unity / Unreal / 一台真实相机完全一样 ——
 * 透视是 *projective* 变换（除以 Z）而不是 *affine*，投影椭圆的中心 ≠ 圆心的
 * 投影、长轴和原圆的任何一条直径都没关系。业界做法（Panini 柱面投影、
 * iPhone 广角自拍把边缘人脸往平行投影拉）与本次查证见 `memory/` 专题。
 *
 * 花箱为什么没事：顶面是矩形，远棱/近棱**平行于世界 X 轴**，而
 * `v = f·(y−y_cam)/(z_cam−z)` ⇒ **任何平行于 X 轴的世界直线，投影后恒为屏幕
 * 水平线**。所以它永远有两条精确 0.00° 的边可读。**是形状救了它。**
 *
 * ---------------------------------------------------------------------------
 * ❌ 试过、已撤销的两条错路（留档，别再走）
 * ---------------------------------------------------------------------------
 * 1. **改材质 / 贴图 / 厚度 / 倒角 / 放射缝 / 接触阴影** —— 8 个变体全量对照，
 *    倾角**一个都没变**（全是 −9.06°）。轮廓就是那个转过的椭圆，面里画什么
 *    都在里面。
 * 2. **视线轴反补**（`levelPlate()`，提交 fb01393）：把「顶面 + 板侧壁」当刚体
 *    绕「相机 → 盘心」这条轴反着转，长轴确实能从 −9.06° 拉回 **+0.42°**。
 *    数字漂亮，**但用户一眼判死：「整体观感假」。**
 *
 *    **为什么必输（这条最重要）**：它把**一个物体**从全场景共享的投影里单独
 *    摘出来改了。画面里其它所有东西（树、门、墙、甬路、花箱、小狗）都服从同一
 *    台相机的同一套投影，只有石桌不服从。人眼对「这一件东西不属于这个相机」
 *    极度敏感，读出来的不是「桌子歪」而是「这幅画里有一件东西是贴上去的」
 *    —— 那正是「假」。而且**谎的幅度 = 问题的幅度**：镜头推近，φ 从 9° 涨到
 *    15~20°，板子就得歪 20°，破绽同步放大。
 *
 *    ⇒ **逐物体地骗投影 = 死路。** 真要骗只能骗**整帧**（Panini 那类后处理），
 *    那样全场景仍然共享同一套投影。
 *
 * ---------------------------------------------------------------------------
 * ✅ 现在的解法：顶面改成正十六边形（用户 2026-10-10 定案）
 * ---------------------------------------------------------------------------
 * 圆 → 16 边形之后，**前棱/后棱精确平行于世界 X 轴**（推导见 `POLY_THETA`），
 * 于是它们在屏幕上**精确是水平的** —— 和花箱同一把尺子、0.00°。物理保持水平、
 * 全场景投影保持一致、凑多近都不露馅：**没有一处是在骗投影。**
 *
 * 代价：不再是**完美**的圆。16 边形内切于原圆，半径差只有
 * `1 − cos(π/16) = 1.9%`，轮廓仍读作圆桌；中式石作的鼓腿/桌面本来就常做多边形
 * 拼料，这个形状本身站得住。
 *
 * ⚠️ 板侧壁 / 凳身 / 雪盖**必须一起改**（同棱数 + 同 `thetaStart`）：否则顶面的
 * 直棱会落在一个圆的沿口里，读成「圆板里嵌了一块十六边形」。
 */

/**
 * 十六边形构件的棱数 —— 桌面/座面/板侧壁/凳身/雪盖统一用它。
 *
 * ⚠️ 必须是 **4 的倍数**：只有这时「一条棱的中点落在世界 ±Z 方向」与「顶点
 * 关于世界 XZ 轴对称」才能同时成立（推导见 `POLY_THETA`）。
 * 12 边形也满足，棱更长更好读，但「圆」的感觉更弱 —— 现取 16。
 */
const POLY_SIDES = 16;

/**
 * 让一条棱**精确平行于世界 X 轴**所需的 `thetaStart`。
 *
 * 两个图元的参数化不一样，但巧合地共用同一个值：
 *
 *   CircleGeometry：`x = r·cos θ, y = r·sin θ`，再被 mesh 绕 X 转 −π/2 →
 *     世界 `(r cos θ, 0, −r sin θ)`。棱平行于 X ⇔ 两端点**世界 z 相等** ⇔
 *     `sin θ_k = sin θ_{k+1}`；相邻点差 `2π/n` ⇒ `θ_k + θ_{k+1} = π`。取
 *     `thetaStart = π/n` 时顶点表是 **π/n 的奇数倍**，`θ = 7π/16` 正在其中。
 *   CylinderGeometry：`x = r·sin θ, z = r·cos θ`。棱平行于 X ⇔
 *     `cos θ_k = cos θ_{k+1}` ⇔ 需要一对 `θ = ±α`；`thetaStart = π/n` 时顶点表
 *     同样是 π/n 的奇数倍，**关于 0 对称** ⇒ 成立。
 *
 * 两者取同一值时，**顶面的顶点与柱面顶沿的顶点落在同一批世界方位角上**
 * （都是 π/n 的奇数倍）—— 这才是顶面能严丝合缝坐进板侧壁里的原因。
 *
 * 而且这么取之后，**离相机最近的那条棱的中点正好在世界 +Z 方向**，也就是画面
 * 里最近的那条边 —— 它正是被读到「平」的那条线。
 */
const POLY_THETA = Math.PI / POLY_SIDES;

/**
 * 立柱/底座/板侧壁：压暗。
 *
 * 🔴 为什么要单独压暗：场景是 `AmbientLight 2.2` 压过 `DirectionalLight 0.9`
 * 的**平光** —— 顶面 2.93、侧壁 2.2~2.72，**只差 8%**。这个差值下「顶面」和
 * 「侧壁」糊成一坨同色，整件东西读成**一张 2D 剪影**。把它们拉开（和花箱的
 * `WOOD` / `WOOD_DARK` 同一套路）之后，物件才读得成「实心石鼓 + 受光顶面」。
 *
 * ⚠️ 这一条**治不了**倾斜（第 1 条错路就是它），它治的是「剪纸感」。
 */
const STONE_SIDE = '#7A7266';
/** 冬天的雪盖。比台明/甬路那层「扫过的薄雪」更厚 —— 路扫过了，桌子没人扫。 */
const SNOW_TOP = '#E4E9EF';
/** 雪盖比桌面略小：露出一圈石头边，才读得出「雪**落在**石头上」而不是「桌子是白的」。 */
const SNOW_R = 0.93;

/**
 * 桌子：面半径 / 总高。
 *
 * ⚠️ 尺度按 DOOR_HEIGHT 反推：2.55 世界单位 ≈ 2.2 m 的实木门扇，即
 * **1 世界单位 ≈ 0.863 m**。真石桌面高约 0.70 m、面径约 0.86 m，
 * 于是总高 ≈ 0.78 世界单位、面半径 ≈ 0.50。
 *
 * ⚠️ 半径是**外接圆**半径（顶点所在圆）。16 边形内切圆半径 = 0.9808 × 这个值，
 * 差 1.9% —— 按外接圆给，物件的视觉尺寸就和改形状之前一致。
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

/**
 * 两张凳子的相对位姿 —— 分列桌子左右。
 *
 * 间距让得过：桌沿 0.50 + 凳沿 0.185 = 0.685 才会相碰，这里放到 0.88，
 * 中间留出能过脚的一道缝。
 *
 * 🔴 **`yaw` 必须为 0，这是量出来的，不是审美选择。**
 * 绕 Y 转 φ 会把「棱平行于世界 X 轴」这个性质转掉，屏幕倾角变成
 *
 *     Δ ≈ atan( Y_cam·sin φ / (D·cos φ − X_cam·sin φ) )
 *
 * 一开始我按「相机在 z=28、桌子在 z≈0」估成 0.12°（`Y/D ≈ 0.009`）——**错了**：
 * 凳子其实离相机只有 **4.3 个单位**（`D` 小一个数量级），而座面比相机低
 * 1.84 个单位 ⇒ `Y_cam/D ≈ −0.43`，比估计大了 **47 倍**。
 * 实测：φ = 12.6° ⇒ **4.38° / 3.90°**（`harness/probe-poly-edge.mjs`）。
 *
 * 也就是说「转角让两张凳子不像复制品」这个初衷，代价正好是**把刚拿到的
 * 0.00° 线索又还回去一半**。这个交易不划算 —— 两张凳子相距 1.76 世界单位
 * （屏幕上约 320px），而每张只有 67px 宽，棱线方向对不对得上一眼根本看不出来。
 * 于是改用 z 上的那点错位（+0.06 / −0.05）来避免「复制品」感。
 */
const STOOLS = [
    { x: 0.88, z: 0.06, yaw: 0 },
    { x: -0.88, z: -0.05, yaw: 0 },
];

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
                {/* 底座 —— 24 棱。**不改 16**：它的横截面不会被当成"面"看，
                    保持圆润的剪影更像车削出来的鼓腿。 */}
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

                {/* 桌面 —— 十六边形石鼓：板侧壁 + 顶面 + 冬雪。
                    group 原点落在**顶面圆心**，各子件按原来的相对高度摆。 */}
                <group position={[0, tableTopY + 0.004, 0]}>
                    {/* 板侧壁（厚度）—— 顶面亮、侧壁暗，靠这条明暗差读出板厚 */}
                    <mesh position={[0, -TOP_H / 2 - 0.004, 0]}>
                        <primitive object={sharedGeometry('cylinder', TOP_R, TOP_R * 0.96, TOP_H, POLY_SIDES, 1, false, POLY_THETA)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 顶面 —— 受光 + 石面贴图；颜色全部由贴图给 */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', TOP_R * 0.99, POLY_SIDES, POLY_THETA)} attach="geometry" />
                        <meshStandardMaterial map={stoneTop} roughness={0.85} />
                    </mesh>
                    {/* 冬：雪盖 */}
                    <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', TOP_R * SNOW_R, POLY_SIDES, POLY_THETA)} attach="geometry" />
                        <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                    </mesh>
                </group>
            </group>

            {/* === 两个小石凳 === */}
            {STOOLS.map((s, i) => (
                <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
                    {/* 凳身：坐在地上。同棱数同 thetaStart，棱线才和座面对得上 */}
                    <mesh position={[0, STOOL_BODY_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_BODY_R, STOOL_BODY_R * 1.05, STOOL_BODY_H, POLY_SIDES, 1, false, POLY_THETA)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 座面 */}
                    <group position={[0, stoolTopY + 0.004, 0]}>
                        <mesh position={[0, -STOOL_TOP_H / 2 - 0.004, 0]}>
                            <primitive object={sharedGeometry('cylinder', STOOL_R, STOOL_R * 0.95, STOOL_TOP_H, POLY_SIDES, 1, false, POLY_THETA)} attach="geometry" />
                            <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                        </mesh>
                        <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('circle', STOOL_R * 0.99, POLY_SIDES, POLY_THETA)} attach="geometry" />
                            <meshStandardMaterial map={stoneTop} roughness={0.85} />
                        </mesh>
                        <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('circle', STOOL_R * SNOW_R, POLY_SIDES, POLY_THETA)} attach="geometry" />
                            <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                        </mesh>
                    </group>
                </group>
            ))}
        </group>
    );
}

export default StoneTable;
