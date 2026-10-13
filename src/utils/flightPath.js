import * as THREE from 'three';
import * as I from '../config/island';
// ⚠️ `GRASS_Y` **不在** `island.js` 里 —— 它在 `entranceMetrics.js`
//    （`FLOOR_Y − OUTDOOR_DROP − 0.04`）。esbuild 打包时会为写错的导出名
//    报一句 "not exported"，别当噪声忽略掉：那会让 y 直接变 NaN。
import { GRASS_Y } from '../config/entranceMetrics';
// 🔴 离地高度**从起落架几何反解**，不写常数 —— 见下面 `GEAR_H` 的说明。
import { GEAR_H } from './airplane';

/**
 * flightPath — 小飞机的航线与跟随相机，**全是纯函数**。
 * ==================================================================
 *
 * WO-18。用户：「前院摆一架小飞机，**点击**在 `/flight` 路由下进入飞行模式。」
 * DR-M 定：查询参数 + 接管主站相机。用户追加：**「效果要保障」**。
 *
 * ---------------------------------------------------------------------------
 * 这份文件为什么不持有任何状态
 * ---------------------------------------------------------------------------
 * 抄 `sunset-flight-study/src/flight.js` 的那条设计（它的注释原话：
 * "Pure sampling supports pause, scrubbing, seeking, and a seamless loop"）：
 *
 *   **给一个时刻 `t`，直接算出那一刻的姿态。** 不积分、不累加、不 lerp 上一帧。
 *
 * 好处不是"优雅"，是可验证：
 *   · 探针可以**任取**若干 `t` 断言姿态 —— 不用"跑 N 帧再看"（那会被帧率、
 *     被 swiftshader 的慢速、被丢帧污染，见 memory「截图不可复现」那条）；
 *   · 暂停 / 拖拽进度 / 循环点无缝，全都是免费的；
 *   · `t` 一样 ⇒ 结果**逐位一样**，与帧率无关。
 *
 * 🔴 反面做法（我没采用）：`useFrame` 里 `angle += speed * dt`。
 *    那样 `t` 就变成了"跑了多久"，探针要断言轨迹就得先复现帧序列 —— 不可测。
 *
 * ---------------------------------------------------------------------------
 * 姿态是**从轨迹推出来的**，不是另外动画出来的
 * ---------------------------------------------------------------------------
 * 同参考实现：`forward = normalize(P(t+dt) − P(t−dt))`，
 * 再用 `makeBasis(right, up, forward)` 得到四元数。
 * **横滚（bank）由真实转向率反解**：`bank = clamp(−turnRate · k, ±max)`。
 * 所以"拐弯时会侧倾"是几何的后果，不是另配的一条动画曲线 —— 二者永远不会
 * 对不上（比如飞机在直线上却侧着飞）。
 *
 * ---------------------------------------------------------------------------
 * 相机：跟随 + 视口补偿
 * ---------------------------------------------------------------------------
 * 相机取飞机**动坐标系**里的一个偏移（`right / up / forward` 三轴分解），
 * 所以无论飞机怎么滚，地平线都是稳的（抄参考实现的 `redFrame` 那条注释）。
 * 视口窄时按 `aspect` **推远**（参考实现的 `frameCamera`，与本项目
 * memory「屏幕空间的效果尺寸必须跟视口走」是同一条教训）。
 */

/** 一圈的时长（秒）。`t` 对它取模 ⇒ 天然无缝循环。 */
export const FLIGHT_DURATION = 44;

/* -------------------------------------------------------------------------
 * 场地常量（真源都在 config/island.js，这里只做换算）
 * ---------------------------------------------------------------------- */

const ISLAND_X = I.ISLAND_CENTER[0];
const ISLAND_Z = I.ISLAND_CENTER[1];

/**
 * 🔴 离地高度**不在这里定义** —— 它是 `utils/airplane.js` 的起落架几何结果
 * （`−AXLE_Y + WHEEL_R`），从那儿 import。
 *
 * 为什么不留一个本地常数：停机位 = `GRASS_Y + GEAR_H`。这个数一旦和真实
 * 起落架对不上，飞机要么**陷进草地**要么**悬空** —— 而这两种错在截图里
 * 都只是"差一点点"，看起来像透视，判不出来。所以让它**就是**那个派生量。
 */

/**
 * 停机位：**左院草地的中心**，与右院的樱花树对称。
 *
 * 樱花树在 `(6.27, 30.15)`（见 `EntranceDoors.jsx` 的 `SAKURA_POS` 注释：
 * 右院草地 x ∈ [1.53, 11]、z ∈ [22.15, 38.15] 的几何中心）。
 * 左院草地是 x ∈ [−11, −1.53]、z 相同 ⇒ 中心 = ((−11 + −1.53)/2, 30.15)
 * = (**−6.27**, 30.15)。x 与樱花树**严格对称**（±6.27）。
 *
 * ⚠️ 落地前用 `.tmp/wo17/obstacles.mjs` 扫过 x[−11,−3] z[26,38]：
 *    那块草地只有柿子树的冠（z ≤ 26.33）和石桌（z ≤ 26.28）⇒ z=30.15 是空的。
 *
 * 🔴 **这里只有位置，没有朝向。** 朝向由 `parkedPose()` 从**航线**推
 *    （见下面那段）。第一版这里写了个 `yaw: 0`（机头朝 +z），而航线在
 *    t=0 的切向其实偏航 62.4° —— 于是"点击进飞行"的那一帧飞机会**瞬间扭头
 *    62 度**。C2 当时只比了**位置**（差 0.000000），所以那条判据是绿的。
 */
export const PARKED = Object.freeze({
    position: new THREE.Vector3(-6.27, GRASS_Y + GEAR_H, 30.15),
});

/* -------------------------------------------------------------------------
 * 航线
 * ---------------------------------------------------------------------- */

/**
 * 航线 = 绕岛心的一圈，半径与高度都随相位"先出去、再回来"。
 *
 *   θ(u) = θ0 + 2π·u·DIR     —— 一整圈
 *   r(u) = R_NEAR + ΔR·sin(πu)^1.5   —— 起终都在 R_NEAR，中段最远
 *   y(u) = Y_NEAR + ΔY·sin(πu)^1.5
 *
 * 🔴 指数取 **1.5** 而不是 1：`sin(πu)` 在 u=0/1 附近是**线性**的，
 *    指数 >1 让 r 和 y 在端点处**导数为 0** ⇒ 起降那一下是"平"的
 *    （机头不会在触地瞬间还带着俯冲角）。这是"起降看着不别扭"的关键。
 *
 * ⚠️ 半径与高度**用同一个相位**（都乘 sin(πu)^1.5）：否则"最远点"和
 *    "最高点"会错开，航线看起来是拧的。
 */
const R_FAR = 34;
const Y_NEAR = GRASS_Y + GEAR_H;
const Y_FAR = 26;

/**
 * 🔴 `R_NEAR` **从停机位反解**，不写死。
 * 写死 13.5 的第一版差 0.0393 ⇒ `u=0` 不在停机位上 ⇒ 点击进飞行会**瞬移**。
 * 一个"必须等于某个派生量"的常量迟早会漂，所以让它**就是**那个派生量。
 */
export const R_NEAR = Math.hypot(PARKED.position.x - ISLAND_X, PARKED.position.z - ISLAND_Z);

/** 起点的极角：让 u=0 正好落在停机位。 */
const THETA0 = Math.atan2(PARKED.position.z - ISLAND_Z, PARKED.position.x - ISLAND_X);

/**
 * 绕行方向。`+1` = 逆时针（俯视，+θ），`-1` = 顺时针。
 * 选 −1：起飞瞬间的切向是 `(sinθ, −cosθ)`，在 θ0≈117.6° 上指向
 * **+x / +z**（右前方、朝着大门），比逆时针的"朝着屋子"合理。
 */
const DIR = -1;

const TAU = Math.PI * 2;

/** 相位 → 归一化时间（支持任意 t，含负数）。 */
function wrap(t) {
    return ((t % FLIGHT_DURATION) + FLIGHT_DURATION) % FLIGHT_DURATION;
}

/** 把 u 折进 [0,1)。`pathAt` 必须**先折再算**，理由见下面的 🔴。 */
function wrap01(u) {
    return ((u % 1) + 1) % 1;
}

/**
 * 相位的"鼓包" `sin(πu)^1.5` —— 半径、高度、**横滚**三者共用它。
 *
 * 🔴 指数取 **1.5** 而不是 1：`sin(πu)` 在 u=0/1 附近是**线性**的，
 *    指数 >1 让它在端点处**导数为 0** ⇒ 起降那一下是"平"的
 *    （机头不会在触地瞬间还带着俯冲角）。
 *
 * 🔴 半径 / 高度 / 横滚**必须共用同一个相位**：
 *    · 半径与高度错开 ⇒ "最远点"和"最高点"不在同一处，航线看起来是拧的；
 *    · 横滚不乘它 ⇒ **停在地上就已经侧倾 41°**（见 `poseAt` 那段）。
 */
function bulgeAt(uu) {
    return Math.pow(Math.sin(Math.PI * uu), 1.5);
}

/**
 * 航线上 u 处的位置。**唯一的几何真源** —— 姿态与相机都从它推。
 *
 * 🔴 **进来先折 `u`，不能直接用**。`bulge = sin(πu)^1.5` 在 `u<0` 时
 *    `sin(πu) < 0`，而**负数的 1.5 次幂 = NaN**。姿态用的是**中心差分**
 *    `P(u−δ)`，于是 `poseAt(0)` 会去取 `pathAt(−0.004)` ⇒ 位置看着正常
 *    （它取的是 `pathAt(0)`），但**四元数整条 NaN** ⇒ 相机位置 NaN。
 *    第一版就是这样：飞机能画出来，镜头却是 `NaN`。
 *    折进来之后 `P` 是**真正周期**的，接缝处的中心差分也才正确。
 */
export function pathAt(u) {
    const uu = wrap01(u);
    const a = THETA0 + TAU * uu * DIR;
    const bulge = bulgeAt(uu);
    const r = R_NEAR + (R_FAR - R_NEAR) * bulge;
    return new THREE.Vector3(
        ISLAND_X + r * Math.cos(a),
        Y_NEAR + (Y_FAR - Y_NEAR) * bulge,
        ISLAND_Z + r * Math.sin(a),
    );
}

/** 采样用的微分量（参考实现同值）。太小会掉进浮点噪声，太大姿态会钝。 */
const DIFFERENTIAL = 0.004;

const UP = new THREE.Vector3(0, 1, 0);
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);

/** 转向率 → 横滚的系数与上限。数值抄参考实现（它调过）。 */
const BANK_GAIN = 2.5;
const BANK_MAX = 0.72;

/**
 * 航线在归一化时间 `u` 处的**完整位姿**。
 *
 * 朝向由**中心差分**给出（`P(u+δ) − P(u−δ)`），横滚由**转向率**给出。
 * 两条都是从同一条曲线推的，所以不会互相打架。
 */
export function poseAt(u) {
    const uu = wrap01(u);
    const position = pathAt(uu);
    const before = pathAt(uu - DIFFERENTIAL);
    const after = pathAt(uu + DIFFERENTIAL);

    const forward = after.clone().sub(before).normalize();
    // 用世界 UP 而不是"上一帧的 up"：机头扬起时不会连带把右轴带歪。
    const right = new THREE.Vector3().crossVectors(UP, forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();

    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, up, forward),
    );

    /**
     * 水平面上的转向率（只用 x/z 分量）—— 俯仰不该被算成转弯。
     *
     * 🔴 单位是**弧度 / 秒**，不是"弧度 / 单位 u"。
     *    第一版漏了除 `FLIGHT_DURATION`，于是 `turnRate ≈ −2π`，
     *    乘上 `BANK_GAIN = 2.5` 得 −15.7 rad ⇒ **被 `BANK_MAX` 顶到饱和**，
     *    整圈都在 41.3° 的最大横滚上。参考实现那条公式里的时间单位是**秒**
     *    （它的 `DURATION = 72`），我照抄公式却换了参数化，单位就丢了。
     *    ⇒ 修好之后是 0.143 rad/s × 2.5 = 20.5°，这才是"绕大圈"该有的侧倾。
     */
    const incoming = position.clone().sub(before).normalize();
    const outgoing = after.clone().sub(position).normalize();
    const turnPerU = Math.atan2(
        incoming.z * outgoing.x - incoming.x * outgoing.z,
        incoming.x * outgoing.x + incoming.z * outgoing.z,
    ) / DIFFERENTIAL;
    const turnRate = turnPerU / FLIGHT_DURATION;

    /**
     * 🔴 横滚还要乘**离地系数**（与半径 / 高度同一个鼓包）。
     *
     * 转向率在整圈上几乎是常数（θ 线性），所以不乘它的话：
     *   · 飞机**停在草地上就已经侧倾 20.5°** —— 看起来像要翻；
     *   · 起飞滑跑那几秒也是侧着的。
     * 真实的飞机在地面是平的，转起来才压坡度。所以乘 `bulgeAt(uu)`：
     * 端点处 0（平）→ 中段最大。
     */
    const bank = THREE.MathUtils.clamp(-turnRate * BANK_GAIN, -BANK_MAX, BANK_MAX) * bulgeAt(uu);
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ROLL_AXIS, bank));

    return { position, quaternion: quaternion.normalize(), bank, turnRate };
}

/** 归一化时间 `u` 处的位姿（对外入口，吃秒）。 */
export function planePoseAt(t) {
    return poseAt(wrap(t) / FLIGHT_DURATION);
}

/**
 * 停机位姿 —— **就是航线在 t=0 的位姿**，不是另写一个朝向。
 *
 * 🔴 为什么必须"就是"：进飞行模式是**硬切**（不插值，见 `cameraAt` 那段）。
 *    如果停机朝向与航线起点差一个角度，点击那一帧飞机会**瞬间扭头**。
 *    第一版 `PARKED` 里写了个 `yaw: 0`（机头朝 +z），而航线在 t=0 的切向
 *    偏航 **62.4°** —— 于是"点一下飞机就转了 62 度"。
 *
 *    探针 C2 当时是绿的，因为它只比了**位置**。所以现在 C2 同时比
 *    位置与四元数（见 `probe-flight-path.mjs`）。
 *
 * 代价：停机时飞机是**斜着停的**（机头朝起飞方向、朝右前方 62°）。
 * 那其实是自然的 —— 停机位就是起飞位。
 */
export function parkedPose() {
    return poseAt(0);
}

/* -------------------------------------------------------------------------
 * 跟随相机
 * ---------------------------------------------------------------------- */

/**
 * 相机「镜头」。**是编辑意义上的镜头切换**（参考实现的做法）：
 * 每段是一组偏移 + 一个**虚拟镜头**。段与段之间是**硬切**，不是插值 ——
 * 插值会让镜头从飞机左边飘到右边，看起来像在漂移。
 *
 * ---------------------------------------------------------------------------
 * 🔴 `lens` 是**虚拟**的：它被换算成"推远多少"，而不是写进相机的 fov
 * ---------------------------------------------------------------------------
 * 参考实现是直接改 `camera.fov` 的。这里**不**那么做，两条理由：
 *
 * 1. **不留残留**（DR-M 的硬要求）。改 `fov` 就是动了相机的投影矩阵，
 *    退出时**必须**记得写回 —— 而"记得写回"是一条纪律，纪律会忘；
 *    忘了的症状是"退出飞行后整个院子的透视变了"，看着不像 bug。
 *    换算成推拉距离之后，投影矩阵**从头到尾没被碰过** ⇒ 残留这件事
 *    结构上不存在。
 * 2. **帧率外的第二个好处**：本项目 `react-hooks/immutability` 是 error
 *    （见 `eslint.config.js`：它抓"改 hook 返回值"），而相机是
 *    `useThree()` 返回的。项目里改相机一律走**方法**（`position.set` /
 *    `lookAt` / `rotation.set`），没有一处给它的属性直接赋值。
 *
 * 换算：视口里物体的成像尺寸 ∝ `1 / (D · tan(fov/2))`。所以
 * `D′ = D · tan(fovBase/2) / tan(lens/2)` —— 镜头越窄推得越远，
 * 成像尺寸**逐位不变**。
 *
 * ⚠️ 代价（诚实记一笔）：推拉**不等于**换镜头。真长焦会压缩纵深，
 *    推远只是"离得远一点"。所以这里 `lens` 只取 50~60 这一段**温和**的值
 *    （成像尺寸一样，但背景的透视压缩拿不回来），主要的变化交给
 *    `offset` —— 那才是每段镜头真正不同的地方。
 *
 * ⚠️ 数值不能取太小：推远是**真的**把相机挪走，而雾的 `fogNear` 是 20。
 *    偏移最大的第 4 段（`|[0, 7.5, -12]| ≈ 14.2`）乘 1.24 就是 17.5 —— 
 *    刚好还在雾前面。再窄一档飞机就要开始化进雾里了。
 */
const SHOTS = [
    // 起飞：贴近、跟在后面偏低，看得见机尾和院子（最广，所以推得最少）
    // `drift` 是**这一段之内**缓慢滑过的量（见下面那段），`roll` 是滚转角（弧度）。
    { at: 0.00, offset: [0.0, 2.6, -7.5], drift: [0.8, 0.35, -1.1], roll: 0.018, lens: 60 },
    // 爬升：右后方拉远，露出整条航线
    { at: 0.22, offset: [7.5, 3.4, -10.5], drift: [-1.3, 0.5, -0.9], roll: -0.030, lens: 54 },
    // 外圈：左前方，能看见机身侧面 + 岛
    { at: 0.46, offset: [-11.0, 2.8, 6.0], drift: [0.9, 0.6, 1.4], roll: 0.036, lens: 58 },
    // 回来：高后方俯视，院子重新进画面（最窄，推得最多）
    { at: 0.74, offset: [0.0, 7.5, -12.0], drift: [1.2, -0.7, -1.6], roll: -0.024, lens: 50 },
];

/**
 * 每段镜头**内部**的缓慢漂移与轻微滚转（WO-21，对齐参考实现）。
 *
 * ---------------------------------------------------------------------------
 * 为什么"段内漂移"值得加
 * ---------------------------------------------------------------------------
 * 参考实现 `flight.js` 的每一段都带一个 `drift`，并按
 * `sin(progress·π − π/2)` 在段内从 `offset − drift` 滑到 `offset + drift`
 * —— 于是**没有一个镜头是完全静止的**。差别的量级很小（相对 offset 约
 * 10%），但"静止的镜头"和"极慢地滑动的镜头"在观感上差很多：前者像
 * 游戏里的固定机位，后者像有人在掌机。
 *
 * 两端都回到 0（`sin(0−π/2) = −1`、`sin(π−π/2) = +1` —— 是**端点对称**的
 * 往返，不是"从 0 开始漂"）⇒ 换段时位置不会跳。
 *
 * ---------------------------------------------------------------------------
 * 🔴 滚转只能用**方法**写（`rotateZ`），不能碰 `camera.up` 或投影矩阵
 * ---------------------------------------------------------------------------
 * 滚转写在 `quaternion` 上 ⇒ 退出飞行时 `FlightCamera` 那一次
 * `quaternion.copy(saved)` 就把它一起还原了 ⇒ 残留判据（R2）不受影响。
 * 而且它只跟 `u` 有关、**与 `aspect` 无关** ⇒ 视口不变性（F3）照样成立。
 */
function shotProgress(uu, index) {
    const start = SHOTS[index].at;
    const end = index + 1 < SHOTS.length ? SHOTS[index + 1].at : 1;
    const span = end - start;
    return span > 1e-9 ? (uu - start) / span : 0;
}

/**
 * 换段过渡（WO-23，2026-10-13）。
 * ==================================================================
 *
 * 用户：「飞机先修复飞行过程中**生硬拼接转场**的问题。」
 *
 * ---------------------------------------------------------------------------
 * 原来是什么样（量出来的）
 * ---------------------------------------------------------------------------
 * 原来在 4 段的边界上**直接换 offset** —— 也就是硬切。一圈里 4 步的位移
 * 比中位数大 **8960×**：
 *
 *   u=0.22  一步挪 9.45 单位 · 视线转 30.7°
 *   u=0.46  一步挪 **26.37** 单位 · 视线转 **113.1°**
 *   u=0.74  一步挪 23.43 单位 · 视线转 87.9°
 *   u=1.00  一步挪 12.34 单位 · 视线转 12.7°
 *
 * 相机最快 35960 单位/s = 飞机自己速度的 7403×。
 * 判据 `probe-flight-camera-smooth.mjs`（纯函数上取导数，不用浏览器）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 参考实现**是故意切的**，本项目不能照抄
 * ---------------------------------------------------------------------------
 * `flight.js` 的原文是「Deliberate editorial cuts every 12 seconds」，
 * 而且它给每一段配了标题卡（「01 掠海 / 02 追逐 / 03 交错 …」）——
 * **切**是它叙事的一部分：切完观众看到一行标题，就知道"换场景了"。
 *
 * 本项目没有标题卡，也没有"换场景"这回事（一圈观光航线而已），
 * 所以硬切在观感上就只剩"画面被甩了一下"。
 *
 * ---------------------------------------------------------------------------
 * 改法：边界两侧各留一个窗口，按 `smoothstep` 混合相邻两段
 * ---------------------------------------------------------------------------
 * `SHOT_BLEND` 是窗口的**半宽**（以"一圈的几分之几"计），所以一次换段
 * 的总时长 = `2 × SHOT_BLEND × FLIGHT_DURATION` = 4.4 s。
 *
 * 取 0.05 的两条约束（都要满足）：
 *   · **窗口不许重叠**：`2 × SHOT_BLEND < 最短段长`（0.22）—— 否则一段里
 *     会同时和前后两段混，"哪一段"就说不清了；
 *   · **每段要留出"纯"时间**：最短那段（0.22 = 9.68 s）去掉两端窗口后
 *     还剩 5.3 s 是纯粹的固定机位 —— 段落感还在。
 *
 * 混合的是**段配置**（offset / lens / roll），不是世界坐标 ——
 * 于是相机全程"挂在飞机身上"，读起来是**绕过去**，而不是"闪现到别处"。
 * 用 `smoothstep` 而不是线性：它两端导数为 0，所以进出过渡都不"拐硬弯"。
 *
 * ⚠️ 段内的 `drift`（"镜头不静止"）与 `roll` 照旧 —— 它们本来就是
 *    段的两端归零的（`sin(progress·π)`），与过渡窗口天然接得上。
 */
const SHOT_BLEND = 0.05;

/** `smoothstep` 夹到 [0,1]。 */
function smoothstep01(t) {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

/**
 * 一段镜头在 `uu` 处的配置（**已经乘过 drift 与 roll 包络的终值**）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 邻段的 `progress` 必须**显式钉在它的那一端**，不能靠"夹到 [0,1]"
 * ---------------------------------------------------------------------------
 * 第一版让 `progress = clamp(raw, 0, 1)` 交给公式自己夹，**在环绕处是错的**：
 *
 *   · 上一段（`prev`）在非环绕时 `raw < 0` ⇒ 夹到 0（**起点**）——
 *     可我们要的是它的**末端**；
 *   · 下一段（`next`）在环绕时（第 4 段 → 第 1 段）`raw > 1` ⇒ 夹到 1
 *     （**末端**）—— 可我们要的是它的**起点**。
 *
 * 于是相机在一圈接回起点的那一步上仍是硬切（探针量到 `u=1` 一步挪
 * 3.75 单位、视线转 9.55°）。夹取的方向对**本段**是对的、对**邻段**是错的 ——
 * 因为邻段此刻并不"在播"，它只是被借来当边界上的那一端。
 *
 * @param {number} index 段号
 * @param {number} uu 归一化时间
 * @param {0|1|null} endpoint `null` = 本段（用真实 progress）；
 *   `1` = 上一段（钉在它的末端）；`0` = 下一段（钉在它的起点）
 * @param {object} out 写回的目标（不返回新对象，见下）
 */
function shotConfig(index, uu, endpoint, out) {
    const shot = SHOTS[index];
    const raw = shotProgress(uu, index);
    const p = endpoint === null ? Math.max(0, Math.min(1, raw)) : endpoint;
    const drift = Math.sin(p * Math.PI - Math.PI / 2);
    out.ox = shot.offset[0] + shot.drift[0] * drift;
    out.oy = shot.offset[1] + shot.drift[1] * drift;
    out.oz = shot.offset[2] + shot.drift[2] * drift;
    out.lens = shot.lens;
    out.roll = shot.roll * Math.sin(p * Math.PI);
    return out;
}

/** 三个模块级暂存（`cameraAt` 每帧调，见 `shotConfig` 的注释）。 */
const CFG_A = { ox: 0, oy: 0, oz: 0, lens: 60, roll: 0 };
const CFG_B = { ox: 0, oy: 0, oz: 0, lens: 60, roll: 0 };
const CFG_OUT = { ox: 0, oy: 0, oz: 0, lens: 60, roll: 0 };

/**
 * `uu` 处生效的段配置：段中间就是本段；落在边界窗口里则是相邻两段的混合。
 *
 * ---------------------------------------------------------------------------
 * 🔴 权重必须是"**窗口外沿 = 0、边界上 = 0.5**"
 * ---------------------------------------------------------------------------
 * 第一版写成 `k = smoothstep01((left + W) / (2W))`，也就是"边界 0.5、
 * 外沿 1" —— **方向反了**。后果不是"没效果"，而是把跳变**搬进了段内**：
 * 在窗口外沿那一点，`k` 从 0 突跳到 1，于是相机从"本段 progress≈0.79 的
 * 配置"一步跨到"邻段 progress=0 的配置" —— 跳变一点没少，只是从边界挪到了
 * `u = 0.41 / 0.69`（探针里看得一清二楚：最大一步仍是中位数的 9064×）。
 *
 * 正确的形状：设 `w = 0.5 · smoothstep01((W − d) / W)`，`d` 是"离边界的距离"。
 *   · `d = W`（窗口外沿）⇒ w = 0
 *   · `d = 0`（边界上）  ⇒ w = 0.5
 * 而且 `smoothstep` 两端导数为 0 ⇒ 窗口外沿的导数也是 0 ⇒ 进出窗口都**不拐硬弯**。
 * 边界两侧的两个分支在 `d = 0` 处都给出 0.5，所以跨过边界也连续。
 *
 * @returns {{cfg: object, from: number, to: number, k: number}}
 *   `k` = `to` 段的权重（1 = 纯 `to`）；`from === to` ⇒ 没在过渡。
 */
function blendedConfig(uu, shotIndex) {
    const start = SHOTS[shotIndex].at;
    const end = shotIndex + 1 < SHOTS.length ? SHOTS[shotIndex + 1].at : 1;
    const past = uu - start;    // 离"进入本段的那个边界"多远
    const left = end - uu;      // 离"离开本段的那个边界"多远

    /** 邻居在混合里的权重（0 = 完全不掺，0.5 = 边界上各一半）。 */
    const neighborWeight = (d) => 0.5 * smoothstep01((SHOT_BLEND - d) / SHOT_BLEND);

    const mix = (a, b, k) => {
        CFG_OUT.ox = a.ox + (b.ox - a.ox) * k;
        CFG_OUT.oy = a.oy + (b.oy - a.oy) * k;
        CFG_OUT.oz = a.oz + (b.oz - a.oz) * k;
        CFG_OUT.lens = a.lens + (b.lens - a.lens) * k;
        CFG_OUT.roll = a.roll + (b.roll - a.roll) * k;
        return CFG_OUT;
    };

    if (past < SHOT_BLEND) {
        // 刚进入本段：还在从上一段滑过来。`past = 0` ⇒ 本段占 0.5。
        const prev = (shotIndex - 1 + SHOTS.length) % SHOTS.length;
        const w = neighborWeight(past);
        const a = shotConfig(prev, uu, 1, CFG_A);
        const b = shotConfig(shotIndex, uu, null, CFG_B);
        return { cfg: mix(a, b, 1 - w), from: prev, to: shotIndex, k: 1 - w };
    }
    if (left < SHOT_BLEND) {
        // 快要离开本段：开始往下一段滑。`left = 0` ⇒ 本段占 0.5。
        const next = (shotIndex + 1) % SHOTS.length;
        const w = neighborWeight(left);
        const a = shotConfig(shotIndex, uu, null, CFG_A);
        const b = shotConfig(next, uu, 0, CFG_B);
        return { cfg: mix(a, b, w), from: shotIndex, to: next, k: w };
    }
    return { cfg: shotConfig(shotIndex, uu, null, CFG_OUT), from: shotIndex, to: shotIndex, k: 1 };
}

/** 场景相机的 fov（`App.jsx` 的 `fov: 60`）。镜头换算的基准。 */
export const FLIGHT_BASE_FOV = 60;

/** 虚拟镜头 → 推远倍率。见 `SHOTS` 上面那段推导。 */
function lensDolly(lens) {
    return Math.tan((FLIGHT_BASE_FOV * Math.PI) / 360) / Math.tan((lens * Math.PI) / 360);
}

/**
 * 跟随相机的**最低高度**（离草地）。正常航段碰不到它，只有镜头表被改坏时才兜底。
 * 判据 C8 会断言**它从未被触发** —— 所以这不是"用来救场的"，是"用来报警的"。
 */
const CAM_FLOOR_Y = GRASS_Y + 1.5;

/**
 * 归一化时间 `u` 处的相机位姿。
 *
 * 🔴 **不吃 `aspect`** —— 这一点与环绕相机（DR-I）**故意不同**，理由：
 *
 *   · DR-I 要解决的是"**横向**装不下一栋 25.8 宽的屋身"。那是横向内容，
 *     视口变窄确实要拉远。
 *   · 这里被拍的是一个**居中**的小目标（飞机），而 `fov` 是**竖向**的
 *     ⇒ 视口变窄只是**左右各裁掉一点**。
 *
 *     ⚠️ 精确一点说（第一版这里写成"高度一个像素都不变"，不对）：
 *        `x_ndc = (x_cam / −z_cam) / (tan(fov/2) · aspect)`、
 *        `y_ndc = (y_cam / −z_cam) / tan(fov/2)` —— **`x_ndc` 里带 `aspect`**，
 *        所以横向量度（机身轴向、翼展）的 NDC 会随视口变，**像素数也会随
 *        视口像素数变**。真正与 `aspect` 无关的只有 `y_ndc`。
 *        ⇒ 判据必须用 `y_ndc`（"占画面高的比例"），不能用机身 NDC 长度、
 *          更不能用像素。见 `probe-flight-camera.mjs` 的 F3。
 *
 *     所以按 aspect 推远在这里不是"补偿"，是**净损失**：手机竖屏
 *     （aspect 0.46）会把相机推到 14.2 × 2.9 ≈ 41 单位，而冬夜 `fogFar`
 *     只有 36 —— 飞机直接化进雾里。
 *
 *   （memory 那条「屏幕空间的效果尺寸必须跟视口走」说的是**全屏平面**
 *     写死世界尺寸的问题，不是跟随相机。别混。）
 */
export function cameraAt(u) {
    /**
     * 🔴 归一化**不要**写成 `((u % 1) + 1) % 1` —— 它会丢一个比特。
     *
     * `0.22 + 1` 这个 double 略小于 `1.22`，再 `% 1` 得到
     * `0.21999999999999997` ⇒ **恰好落在换段边界上**的输入
     * （`?flight&t=9.68` 就是 `u = 0.22`）会被判进**前一段**。
     * 症状极隐蔽：只有探针在"跨边界那一步"上取错采样点时才看得见
     * （`probe-flight-camera-smooth.mjs` 第一版就栽在这上面）。
     */
    let uu = u % 1;
    if (uu < 0) uu += 1;
    // 找当前镜头：`at` 是升序的，取最后一个 ≤ uu 的（越界回落到最后一段）。
    let shotIndex = 0;
    for (let i = 0; i < SHOTS.length; i += 1) if (uu >= SHOTS[i].at) shotIndex = i;

    const pose = poseAt(uu);
    const { position, quaternion } = pose;

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

    /**
     * 🔴 相机偏移用**水平化的**前向，不用机身纵轴。
     *
     * 第一版直接拿机身的 `forward`（含俯仰）分解偏移，结果起飞滑跑段镜头被
     * 拖到**草地高度**（实测最低 y = −1.0153，飞机本身才 −1.037）——
     * 因为 `oz = −7.5`（在机身后方）乘上抬头的 `forward.y > 0` 是**往下**带，
     * 恰好把 `oy = +2.6` 抵消掉。等于说"飞机姿态在偷偷决定镜头高度"。
     *
     * 改成水平前向之后 `camPos.y ≡ 飞机 y + oy`：镜头相对飞机的高度是**常数**，
     * 不随机头俯仰漂。机身怎么滚、怎么抬，地平线都稳（`camUp` 用世界 UP）。
     */
    const forwardH = new THREE.Vector3(forward.x, 0, forward.z);
    // 兜底：万一 `forward` 恰好竖直（本航线最大爬升角约 24°，不会发生）。
    if (forwardH.lengthSq() < 1e-12) forwardH.set(0, 0, 1);
    forwardH.normalize();
    // 水平右轴 = UP × 水平前向 ⇒ **必然是水平的**，不受横滚影响。
    const rightH = new THREE.Vector3().crossVectors(UP, forwardH).normalize();

    /**
     * 段内漂移 + 换段过渡（WO-23）。
     *
     * `blend.cfg` 是**生效的段配置** —— 段中间就是本段，落在边界窗口里则是
     * 相邻两段的 `smoothstep` 混合。见 `blendedConfig` 上面那一大段。
     *
     * ⚠️ 混合的是**配置**而不是世界坐标：`ox/oy/oz` 是"飞机本地系里的偏移"，
     *    所以混合过程中相机始终挂在飞机身上，只是缓缓绕过去。
     *    直接混世界坐标的话，飞机在这 4.4 秒里自己也在动，两者叠加会糊。
     */
    const blend = blendedConfig(uu, shotIndex);
    const cfg = blend.cfg;
    const progress = shotProgress(uu, shotIndex);
    // 诊断用的"本段自己的 drift"（过渡窗口里它仍是本段的值，不是混合值）。
    const drift = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI - Math.PI / 2);
    const ox = cfg.ox;
    const oy = cfg.oy;
    const oz = cfg.oz;

    const dolly = lensDolly(cfg.lens);
    const camPos = position
        .clone()
        .addScaledVector(rightH, ox * dolly)
        .addScaledVector(UP, oy * dolly)
        .addScaledVector(forwardH, oz * dolly);

    if (camPos.y < CAM_FLOOR_Y) camPos.y = CAM_FLOOR_Y;

    return {
        position: camPos,
        // 看向飞机**前方一点**而不是飞机本身：纯看飞机会让机头永远怼在画面中心，
        // 看不出"在往哪飞"。这里用**含俯仰的** forward，所以爬升/俯冲时镜头会跟着抬低，
        // 观众能读出"在往上爬"。
        target: position.clone().addScaledVector(forward, 4.0),
        /**
         * 滚转角（弧度）。段的两端为 0、中间最大（`sin(progress·π)`）。
         * `FlightCamera` 用 `camera.rotateZ(roll)` 写 —— **是方法**，
         * 不碰投影矩阵，退出时随 `quaternion` 一起还原。
         * 过渡窗口里它是相邻两段的混合值（两段在边界上都 ≈ 0 ⇒ 仍然连续）。
         */
        roll: cfg.roll,
        /** 生效的名义镜头（诊断用；相机本身的 fov 不变，见上面）。过渡中是混合值。 */
        lens: cfg.lens,
        /** 生效的推远倍率（诊断用）。 */
        dolly,
        /** 本段自己的段内漂移量（诊断用）：−1 → +1。 */
        drift,
        /** 当前段号。 */
        shot: shotIndex,
        /** 过渡：`blend` = `to` 段的权重（1 = 纯 `to`）；`from === to` ⇒ 没在过渡。 */
        blend: blend.k,
        blendFrom: blend.from,
        blendTo: blend.to,
    };
}

/** 对外入口：吃秒。 */
export function flightCameraAt(t) {
    return cameraAt(wrap(t) / FLIGHT_DURATION);
}

/** 给 HUD / 探针用：这一圈有几段镜头。 */
export const FLIGHT_SHOT_COUNT = SHOTS.length;
