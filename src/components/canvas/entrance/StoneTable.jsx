import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { makeStoneSlabTexture } from '../../../utils/entranceArt';

/**
 * StoneTable — 院子里的石条桌 + 两条石条凳
 * ======================================
 *
 * 位置由调用方给：用户 2026-10-09 定的是「树下，树跟前」。
 *
 * ---------------------------------------------------------------------------
 * 🔴 用户连报四次「桌面/凳面看起来往地面倾斜」—— 前三轮的修法都是错的
 * ---------------------------------------------------------------------------
 * 第三轮用户给了决定性的线索：「**为什么花箱没有这个问题**」。于是不再靠推理，
 * 直接量（`harness/probe-table-tilt.mjs`）：
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
 * ---------------------------------------------------------------------------
 * ❌ 试过、已撤销的三条错路（留档，别再走）
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
 * 3. **顶面改成正十六边形**（提交 905a952）：`thetaStart = π/16` 让**前棱/后棱
 *    精确平行于世界 X 轴**，那两条棱在屏幕上**确实是 0.00°**（`probe-poly-edge`
 *    实测，与花箱同尺）。**但用户 2026-10-10 第四轮反馈：「也是斜的，感觉和圆
 *    一模一样」—— 逐字准确。** 因为人眼读的是**轮廓的主轴**，不是某一条棱：
 *
 *      圆 32 边  轮廓主轴 −9.44°
 *      16 边形   轮廓主轴 −9.44°   ← 一个像素都没动
 *
 *    16 条棱里只有 2 条是 0.00°，而且只有 36~45 px 长；眼睛把整圈一拟合，读回来
 *    的还是那个转过的椭圆。**「有直边」不够，得「有足够长、且能主导轮廓的直边」。**
 *
 * ---------------------------------------------------------------------------
 * ✅ 现在的解法：改成矩形（用户 2026-10-10 定案：「改成和花箱一样的矩形看看」）
 * ---------------------------------------------------------------------------
 * 这一轮把花箱当成**标尺**量了（`probe-poly-edge.mjs` 的 controls 段），才把
 * 「多少度算看起来没事」定下来 —— 花箱顶沿 1.25 × 0.6（长宽比 **2.08**）：
 *
 *     花箱顶沿  轮廓主轴 **1.68°**   ← 用户认为「没问题」的那一件
 *     石桌面    轮廓主轴 **−9.44°**  ← 用户认为「斜」的那一件
 *
 * 也就是说：**花箱不斜不是因为它是什么材质、什么颜色，是因为它是矩形**，而且
 * 长宽比够大。矩形顶面被剪切之后是一个**平行四边形**，它的主轴由
 *
 *     tan(2θ) = 2·b²·s·t / (a² + b²·s² − b²·t²)      s = X/d, t = Y/d
 *     a, b = 顶面 X 向 / Z 向半宽
 *
 * 给出 —— **a/b 越大 θ 越小**，而且分母里 `a²` 直接把长边压成主轴。a → ∞ 时
 * θ → 0。16 边形没有这个机制：它外接圆不变，长宽比恒为 1。
 *
 * 本文件取 **桌面 1.20 × 0.54（2.22）**、**凳面 0.70 × 0.26（2.69）**，
 * 预测 2.39° / 2.59° / 1.40°，即**与花箱同一档**（1.68°）。
 *
 * ⚠️ 为什么不是「把桌子挪到画面中轴」：`X → 0` 确实让 φ → 0，但树干在
 * local x ≈ −2.82、桌子在 −2.78 —— 它就是「树跟前」那张桌子（EntranceDoors
 * 的注释），挪开就毁掉这个构图。**而且 `X` 只是分子里的一项：`X` 减半、`d`
 * 不变时 φ 也才减半**（−2.78 → −1.39 只到 4.9°）。改形状是唯一能一步到位的杠杆。
 *
 * ⚠️ **桌面/凳面/侧壁/雪盖必须一起改矩形**：侧壁留在圆柱上会读成「方板架在
 * 圆鼓上」。底座/柱身/束腰**保持圆**（车削石鼓）—— 它们是竖直的，横截面不参与
 * 「面平不平」的判读，改成方的纯属审美、治不了倾斜。
 */

/**
 * 桌面：X 向长边 / Z 向短边 / 板厚。
 *
 * ⚠️ 尺度按 DOOR_HEIGHT 反推：2.55 世界单位 ≈ 2.2 m 的实木门扇，即
 * **1 世界单位 ≈ 0.863 m**。真石条桌长约 1.0~1.2 m、宽约 0.45 m，
 * 于是 1.20 × 0.54 世界单位 ≈ **1.04 m × 0.47 m**，总高 0.78 ≈ 0.67 m。
 *
 * 🔴 **长宽比是这里的全部意义**（见文件头 tan(2θ)）：2.22 是为了把轮廓主轴
 * 压到 2.4°（花箱 2.08 → 1.68°）。想更平就加大比值，但**别缩小 Z 向**——
 * 0.54 已经是「坐得下人」的桌宽下限，再窄就不像桌子了。
 */
const TOP_W = 1.20;
const TOP_D = 0.54;
const TOP_H = 0.15;

/**
 * 立柱/底座/束腰/石板侧壁：压暗。
 *
 * 🔴 为什么要单独压暗：场景是 `AmbientLight 2.2` 压过 `DirectionalLight 0.9`
 * 的**平光** —— 顶面 2.93、侧壁 2.2~2.72，**只差 8%**。这个差值下「顶面」和
 * 「侧壁」糊成一坨同色，整件东西读成**一张 2D 剪影**。把它们拉开（和花箱的
 * `WOOD` / `WOOD_DARK` 同一套路）之后，物件才读得成「实心石作 + 受光顶面」。
 *
 * ⚠️ 这一条**治不了**倾斜（第 1 条错路就是它），它治的是「剪纸感」。
 */
const STONE_SIDE = '#7A7266';
/** 冬天的雪盖。比台明/甬路那层「扫过的薄雪」更厚 —— 路扫过了，桌子没人扫。 */
const SNOW_TOP = '#E4E9EF';
/**
 * 雪盖比顶面**每边缩进**这么多：露出一圈石头边，才读得出「雪**落在**石头上」
 * 而不是「桌子是白的」。（原来是「半径 × 0.93」，矩形改成按边缩进。）
 */
const SNOW_INSET = 0.05;

const COLLAR_R = 0.15;
const COLLAR_H = 0.19;
const SHAFT_R = 0.115;
const SHAFT_H = 0.35;
const BASE_R = 0.26;
const BASE_H = 0.09;

/**
 * 石条凳：X 向长边 / Z 向短边。
 *
 * ⚠️ 凳面比桌面**更细长**（0.70 / 0.26 = **2.69** vs 桌面的 2.22）—— 这不是
 * 审美，是量出来的：凳子更矮（`Y_cam` 更大）又更偏轴（左边那张在世界 x −3.76，
 * 离相机中轴 3.76 个单位），`t = Y/d` 比桌面大得多，同一个长宽比会给出更大的 θ。
 * 实测预测：凳面 2.69 才追平桌面的 2.22。
 */
const BENCH_W = 0.70;
const BENCH_D = 0.26;
const BENCH_TOP_H = 0.12;
const BENCH_BODY_W = 0.54;
const BENCH_BODY_D = 0.20;
const BENCH_BODY_H = 0.33;

/**
 * 两条凳子的位置 —— 分列桌子左右（沿世界 X，和桌面长边同向）。
 *
 * ⚠️ `±0.98` 是**间隙算出来的**，不是拍的：桌面半宽 0.60 + 凳面半长 0.35 = 0.95，
 * 再加 3 cm 让得过，取 0.98。改桌/凳尺寸必须重算这个数。
 *
 * 🔴 **不转 yaw**（原来写过 0.22 / −0.15，已删）。绕 Y 转 φ 会把「长边平行于
 * 世界 X 轴」这个性质转掉，屏幕倾角变成
 *
 *     Δ ≈ atan( Y_cam·sin φ / (D·cos φ − X_cam·sin φ) )
 *
 * 凳面离相机只有 4.3 个单位（`Y_cam/D ≈ −0.43`），比「相机在 z=28」那种直觉
 * 大 **47 倍** —— 12.6° 的 yaw 就会还回去 4.4°。用 z 上的那点错位（+0.06 / −0.05）
 * 来避免「复制品」感就够了。
 */
const BENCHES = [
    { x: 0.98, z: 0.06 },
    { x: -0.98, z: -0.05 },
];

export function StoneTable({ position }) {
    // 只有冬天需要雪盖 —— 其余季节它 `visible={false}`，一次 draw 都不发。
    const isWinter = useSeason() === 'winter';
    // 按 key 缓存，每次 render 调都是同一张
    const stoneTop = makeStoneSlabTexture();

    const tableTopY = BASE_H + SHAFT_H + COLLAR_H + TOP_H;      // 0.78（板厚算在里面）
    const benchTopY = BENCH_BODY_H + BENCH_TOP_H;               // 0.45

    return (
        <group position={position}>
            {/* === 石条桌 === */}
            <group>
                {/* 底座 —— 24 棱。**保持圆**：它的横截面不会被当成"面"看，
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

                {/* 桌面 —— 矩形石板：板侧壁 + 顶面 + 冬雪。
                    group 原点落在**顶面中心**，各子件按原来的相对高度摆。 */}
                <group position={[0, tableTopY + 0.004, 0]}>
                    {/* 板侧壁（厚度）—— 顶面亮、侧壁暗，靠这条明暗差读出板厚。
                        🔴 顶面比侧壁高 0.004：不让两个面共面（z-fighting）。 */}
                    <mesh position={[0, -TOP_H / 2 - 0.004, 0]}>
                        <primitive object={sharedGeometry('box', TOP_W, TOP_H, TOP_D)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 顶面 —— 受光 + 石面贴图；颜色全部由贴图给。
                        ⚠️ `plane` 绕 X 转 −π/2 之后：局部 x → 世界 X，局部 y → 世界 **−Z**，
                        所以 `plane(TOP_W, TOP_D)` 正好是「X 向长、Z 向短」。
                        ⚠️ 贴图会被拉伸成 2.22:1（贴图本身是各向同性的方图）。这个尺度下
                        512² 的细石粒投到屏幕上只有 0.1~0.35 px/texel，拉伸不可见，
                        所以不额外 clone + 设 repeat（那要动 wrapS/T，容易出静默 bug）。 */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('plane', TOP_W * 0.995, TOP_D * 0.995)} attach="geometry" />
                        <meshStandardMaterial map={stoneTop} roughness={0.85} />
                    </mesh>
                    {/* 冬：雪盖 */}
                    <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('plane', TOP_W - SNOW_INSET * 2, TOP_D - SNOW_INSET * 2)} attach="geometry" />
                        <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                    </mesh>
                </group>
            </group>

            {/* === 两条石条凳 === */}
            {BENCHES.map((b, i) => (
                <group key={i} position={[b.x, 0, b.z]}>
                    {/* 凳身：坐在地上。也是矩形，长边同向 —— 否则凳面和凳身对不上 */}
                    <mesh position={[0, BENCH_BODY_H / 2, 0]}>
                        <primitive object={sharedGeometry('box', BENCH_BODY_W, BENCH_BODY_H, BENCH_BODY_D)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 凳面 */}
                    <group position={[0, benchTopY + 0.004, 0]}>
                        <mesh position={[0, -BENCH_TOP_H / 2 - 0.004, 0]}>
                            <primitive object={sharedGeometry('box', BENCH_W, BENCH_TOP_H, BENCH_D)} attach="geometry" />
                            <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                        </mesh>
                        <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('plane', BENCH_W * 0.995, BENCH_D * 0.995)} attach="geometry" />
                            <meshStandardMaterial map={stoneTop} roughness={0.85} />
                        </mesh>
                        <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('plane', BENCH_W - SNOW_INSET * 2, BENCH_D - SNOW_INSET * 2)} attach="geometry" />
                            <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                        </mesh>
                    </group>
                </group>
            ))}
        </group>
    );
}

export default StoneTable;
