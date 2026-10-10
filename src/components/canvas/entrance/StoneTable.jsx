import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
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
 *   | 面        | 世界法线    | **屏幕椭圆长轴角** |
 *   | 石桌面    | (0,1,0)    | **−9.06°**        |
 *   | 左/右凳面 | (0,1,0)    | **−11.61° / −9.72°** |
 *   | 花箱顶面  | (0,1,0)    | 远棱 **0.00°** / 近棱 **0.00°** |
 *
 * **几何是平的（法线精确 (0,1,0)）；歪的是"投影出来的椭圆"。** 水平圆的投影
 * 椭圆在偏离画面中轴时**必然**旋转，闭式解（相机无滚转、up=(0,1,0)）：
 *
 *     φ ≈ ½·atan2( 2X·Y , d² + X² − Y² )      X,Y,d = 盘心在**相机空间**的坐标
 *
 * 实测 −8.91° / −11.66° / −8.97° vs 上面的 −9.06 / −11.61 / −9.72 —— 对得上，
 * **所以渲染没错，错的是"我们以为平的东西会画成平的"。**
 *
 * 花箱为什么没事：它的顶面是矩形，远棱/近棱**平行于世界 X 轴**，而
 * `v = f·(y−y_cam)/(z_cam−z)` ⇒ **任何平行于 X 轴的世界直线，投影后恒为屏幕水平线**。
 * 所以它永远有两条精确 0.00° 的边可读。**是形状救了它，不是它没这个旋转。**
 *
 * 前两轮白改的原因：受光材质、石面贴图、加厚、倒角、放射缝、接触阴影 ——
 * **一个都改不了这个角**（8 个变体全量对照过，全是 −9.06°），因为**轮廓**就是那个
 * 转过的椭圆，面里画什么都在里面。
 *
 * ---------------------------------------------------------------------------
 * ✅ 解法：**视线轴反补**（用户明确要求保留圆顶）
 * ---------------------------------------------------------------------------
 * 把整块"桌面"绕**相机→盘心这条视线轴**反着转 φ。对小物件，绕视线轴转 δ
 * 近似等于把它的图像整体转 δ，所以长轴就摆平了。实测：
 *
 *     石桌面 −9.06° → **−1.29°**，凳面 −9.72° → **−0.39°**，−11.61° → **−2.86°**
 *
 * 两条实现上的要害：
 *
 * 1. **必须每帧从当前相机重算，不能烘一个常数。** 用户是把镜头推近看的，
 *    而 φ 随「相机高度/距离」变化（推近 → 更大）。烘死会让"推近就露馅"。
 * 2. **顶面 + 板侧壁要作为**一个刚体**一起转。** 只转顶面圆盘的话，圆盘会从
 *    圆柱的顶盖里穿出来（半径 0.495 上、9° 的倾斜就是 ±0.078 的高低差）。
 *    包成 `<group>` 一起转，整块板子仍是"平顶圆柱"，侧壁的可见高度只是沿着
 *    板轴平移，不会出现一边宽一边窄的楔形。
 *
 * ⚠️ **代价（必须写明白）**：桌面**物理上不再是水平的**，斜约 φ。本场景本来就是
 * 固定机位摆出来的（树是 billboard、动画都是烘的），所以这个代价自洽；但如果
 * 以后入口机位会大范围绕行，会看到"桌子永远保持水平"这件不可能的事。
 * 底座和凳身**不**参与 —— 它们坐在地上，转了就会翘起一角露缝。
 */

/**
 * 立柱/底座/板侧壁：压暗。
 *
 * 🔴 为什么要单独压暗：场景是 `AmbientLight 2.2` 压过 `DirectionalLight 0.9`
 * 的**平光** —— 顶面 2.93、侧壁 2.2~2.72，**只差 8%**。这个差值下"顶面"和
 * "侧壁"糊成一坨同色，整件东西读成**一张 2D 剪影**，于是眼睛只剩轮廓可看，
 * 而轮廓就是一个转过的椭圆。把它们拉开（和花箱的 `WOOD` / `WOOD_DARK`
 * 同一套路）之后，物件才读得成"实心石鼓 + 受光顶面"。
 */
const STONE_SIDE = '#7A7266';
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

/* ------------------------------------------------------------------ */
/* 视线轴反补                                                          */
/* ------------------------------------------------------------------ */

const _center = new THREE.Vector3();
const _camSpace = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _camMat = new THREE.Matrix4();
const _probe = new THREE.Vector3();
/** 量椭圆用的采样点（圆周 8 等分，固定 → 结果是相机位置的连续函数，不会抖） */
const RING = 8;
const _ring = Array.from({ length: RING }, () => [0, 0]);

/** 反补角的上下限：机位贴到盘面上时闭式解会发散，夹住它（也防止整块板翻过去）。 */
const MAX_TILT = 0.42;   // ≈ 24°
/** 数值测增益用的扰动步长（弧度，≈1°）。 */
const GAIN_STEP = 0.01745;

/**
 * 量一块圆盘在当前朝向下的**投影椭圆长轴角**（弧度）。
 *
 * 坐标系是 NDC（+x 右、+y **上**）—— 和闭式解同号，所以两者可以直接相加。
 * 取圆周四等分点（`RING` 个）投到屏幕后做 PCA：点等参数分布，协方差矩阵的
 * 特征向量就是椭圆的主轴方向。8 个点足够把残差压到 0.3° 以内，也很便宜。
 */
function screenAxisAngle(plate, camera, radius) {
    plate.updateWorldMatrix(true, false);
    let cx = 0, cy = 0;
    for (let i = 0; i < RING; i++) {
        const a = (i / RING) * Math.PI * 2;
        _probe.set(Math.cos(a) * radius, 0, Math.sin(a) * radius)
            .applyMatrix4(plate.matrixWorld)
            .project(camera);
        _ring[i][0] = _probe.x;
        _ring[i][1] = _probe.y;
        cx += _probe.x;
        cy += _probe.y;
    }
    cx /= RING; cy /= RING;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < RING; i++) {
        const dx = _ring[i][0] - cx;
        const dy = _ring[i][1] - cy;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= RING; syy /= RING; sxy /= RING;
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    // 主轴方向 = 较大特征值对应的特征向量
    const ax = Math.abs(sxy) > 1e-12 ? l1 - syy : 1;
    const ay = Math.abs(sxy) > 1e-12 ? sxy : 0;
    return Math.atan2(ay, ax);
}

/**
 * 把一块**平顶圆板**绕「相机→板心」这条轴反着转，让它在当前机位下的
 * 投影椭圆长轴回到水平。
 *
 * `plate` 的原点必须落在**顶面圆心**（见下面的 `<group>`），这样旋转中心
 * 就是圆心，顶面只在原地"摆正"、不会平移。`radius` 是顶面半径，只用来投
 * 采样点。
 *
 * 两个阶段：
 *  1. **闭式解** `φ = ½·atan2(2XY, d²+X²−Y²)`（推导见文件头）当初始值；
 *  2. **一步牛顿校正**。闭式解是在"物件张角很小"下推的，实测**大盘会短 ~13%**
 *     （石桌面残差 −1.22°，小凳面只有 −0.16°）—— 残差随圆盘在画面上的大小走，
 *     说明是丢掉的高阶项。这里不猜系数：把板子多转 1° 再量一次，**数值估出
 *     ∂a/∂δ**，然后一步解到 0。自校准，没有魔数。
 *
 * ⚠️ 绝对赋值，不是叠加 —— 叠加会每帧累积，几秒内就把板子转飞。
 */
function levelPlate(plate, camera, radius) {
    if (!plate || !plate.parent) return;
    plate.getWorldPosition(_center);

    // 相机空间：+x 右、+y 上、−z 前。**不能用现成的 matrixWorldInverse** ——
    // 它由渲染器在上一帧算好，而 `useInfiniteCamera` 可能排在我们之后改相机。
    camera.updateMatrixWorld();
    _camMat.copy(camera.matrixWorld).invert();
    _camSpace.copy(_center).applyMatrix4(_camMat);

    const X = _camSpace.x;
    const Y = _camSpace.y;
    const d = -_camSpace.z;
    if (!(d > 0.25)) return;                        // 贴脸/穿帮时不猜

    // 世界轴 → 父空间（凳子的父 group 带 yaw；入口总组将来也可能带旋转）
    _axis.copy(_center).sub(camera.position).normalize();
    plate.parent.getWorldQuaternion(_parentQ);
    _axis.applyQuaternion(_parentQ.invert());

    const delta0 = THREE.MathUtils.clamp(
        0.5 * Math.atan2(2 * X * Y, d * d + X * X - Y * Y), -MAX_TILT, MAX_TILT);
    plate.quaternion.setFromAxisAngle(_axis, delta0);

    // —— 牛顿校正 ——
    const a0 = screenAxisAngle(plate, camera, radius);
    plate.quaternion.setFromAxisAngle(_axis, delta0 + GAIN_STEP);
    const slope = (screenAxisAngle(plate, camera, radius) - a0) / GAIN_STEP;

    const delta = Math.abs(slope) > 0.2
        ? THREE.MathUtils.clamp(delta0 - a0 / slope, -MAX_TILT, MAX_TILT)
        : delta0;                                   // 斜率不可信就退回闭式解
    plate.quaternion.setFromAxisAngle(_axis, delta);
}

/* ------------------------------------------------------------------ */

export function StoneTable({ position }) {
    // 只有冬天需要雪盖 —— 其余季节它 `visible={false}`，一次 draw 都不发。
    const isWinter = useSeason() === 'winter';
    // 按 key 缓存，每次 render 调都是同一张
    const stoneTop = makeStoneSlabTexture();

    const camera = useThree((s) => s.camera);
    // [桌面, 凳0, 凳1] —— 一个 useFrame 处理三块，避免在 map 里调 hook
    const plates = useRef([]);
    useFrame(() => {
        const list = plates.current;
        for (let i = 0; i < PLATES.length; i++) {
            if (list[i]) levelPlate(list[i], camera, PLATES[i].r);
        }
    });

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

                {/* 桌面 —— **刚体**（板侧壁 + 顶面 + 冬雪一起转）。
                    group 的原点必须在**顶面圆心**：levelPlate 绕 group 原点转，
                    原点在圆心时顶面只"摆正"、不平移。 */}
                <group ref={(el) => (plates.current[0] = el)} position={[0, tableTopY + 0.004, 0]}>
                    {/* 板侧壁（厚度）—— 顶面亮、侧壁暗，靠这条明暗差读出板厚 */}
                    <mesh position={[0, -TOP_H / 2 - 0.004, 0]}>
                        <primitive object={sharedGeometry('cylinder', TOP_R, TOP_R * 0.96, TOP_H, 32)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 顶面 —— 受光 + 石面贴图；颜色全部由贴图给 */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', TOP_R * 0.99, 32)} attach="geometry" />
                        <meshStandardMaterial map={stoneTop} roughness={0.85} />
                    </mesh>
                    {/* 冬：雪盖 */}
                    <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', TOP_R * SNOW_R, 32)} attach="geometry" />
                        <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                    </mesh>
                </group>
            </group>

            {/* === 两个小石凳 === */}
            {STOOLS.map((s, i) => (
                <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
                    {/* 凳身：坐在地上，**不**参与反补（转了会翘起一角） */}
                    <mesh position={[0, STOOL_BODY_H / 2, 0]}>
                        <primitive object={sharedGeometry('cylinder', STOOL_BODY_R, STOOL_BODY_R * 1.05, STOOL_BODY_H, 20)} attach="geometry" />
                        <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                    </mesh>
                    {/* 座面：同样作为刚体一起反补 */}
                    <group ref={(el) => (plates.current[i + 1] = el)} position={[0, stoolTopY + 0.004, 0]}>
                        <mesh position={[0, -STOOL_TOP_H / 2 - 0.004, 0]}>
                            <primitive object={sharedGeometry('cylinder', STOOL_R, STOOL_R * 0.95, STOOL_TOP_H, 24)} attach="geometry" />
                            <meshStandardMaterial color={STONE_SIDE} roughness={0.92} />
                        </mesh>
                        <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('circle', STOOL_R * 0.99, 24)} attach="geometry" />
                            <meshStandardMaterial map={stoneTop} roughness={0.85} />
                        </mesh>
                        <mesh visible={isWinter} position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                            <primitive object={sharedGeometry('circle', STOOL_R * SNOW_R, 24)} attach="geometry" />
                            <meshStandardMaterial color={SNOW_TOP} roughness={0.95} />
                        </mesh>
                    </group>
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

/** 要反补的三块板（顺序必须和 `<group ref>` 的下标一致）。半径按顶面圆盘算。 */
const PLATES = [
    { r: TOP_R * 0.99 },
    { r: STOOL_R * 0.99 },
    { r: STOOL_R * 0.99 },
];

export default StoneTable;
