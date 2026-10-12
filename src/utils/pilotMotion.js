import * as THREE from 'three';

/**
 * pilotMotion — 「玩家把飞机往哪边推」（WO-22，2026-10-12）。
 * ==================================================================
 *
 * 用户：「另外还需**可以控制它的方向**。」
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么是"**有界偏移**"，不是"自由航向"
 * ---------------------------------------------------------------------------
 * 最直觉的做法是让 `A/D` 直接改航向、`W/S` 直接改高度，然后积分出位置。
 * 那会把 `utils/flightPath.js` 的整个设计拆掉：
 *
 *   · 那份文件的核心契约是**纯函数** —— 给一个 `t`，位姿**逐位确定**
 *     （`pathAt` / `poseAt` / `cameraAt`）。"积分出位置"意味着位姿依赖
 *     **历史帧**，于是：探针不能再断言任意 `t` 的位姿、`?flight&t=N` 的
 *     定妆照不可复现、循环点不再无缝；
 *   · WO-18 已经立在那条契约上的判据（C1~C13、F1~F4、R1~R3）会**全部作废**。
 *
 * 所以抄参考实现（`pilot-motion.js`）的做法：**航线照旧是航线**，
 * 玩家的输入叠成一个**有界的偏移 + 姿态**。观感上完全就是"我在控制方向"
 * —— 推左它就往左拐、还压上坡度；松开自动回到航线上。
 *
 * 代价（诚实记一笔）：飞不出航线。松手就"自己回正"。
 * 对这个场景（一圈观光航线）那是**对的**，不是妥协。
 *
 * ---------------------------------------------------------------------------
 * 🔴 偏移必须在**屏幕空间**分解，不能用世界轴
 * ---------------------------------------------------------------------------
 * 本项目的镜头会换段：第 3 段（`at: 0.46`）的偏移是 `[-11, 2.8, 6]`
 * —— 相机在飞机**前方偏左**。如果用世界右轴分解偏移，那一段里"推左"
 * 会把飞机推到**画面的右边**（因为相机从前面看过来，左右是反的）。
 * 参考实现的注释把这条写得很清楚（`screenRotation` 那段）。
 *
 * 所以偏移用相机那一帧的 `right / up` 分解 —— 也就是"屏幕上往哪边推"。
 *
 * ---------------------------------------------------------------------------
 * 🔴 位移与帧率无关（解析式指数，不是"速度 × dt"）
 * ---------------------------------------------------------------------------
 * 一阶指数趋近有**解析解**：
 *
 *   x(t+dt) = target + (x − target)·e^(−k·dt)
 *
 * 代码里写成 `x += (target − x)·blend`，`blend = 1 − e^(−k·dt)`
 * （用 `-Math.expm1(-k*dt)` 求，小 dt 下比 `1 - Math.exp()` 精确得多）。
 * 它天然**可复合**：两步 `dt₁ + dt₂` 的结果逐位等于一步 `dt₁ + dt₂`。
 * 判据：同样一串输入，`1 × 0.1 s` 与 `10 × 0.01 s` 的结果必须一致。
 *
 * ⚠️ 别写成"先缓动速度、再把速度乘 dt 累进位置" —— 那在不同帧率下
 *    积分结果不同（参考实现专门为这条写过注释）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 与参考实现的**唯一实质偏离**：松手回正（2026-10-12 实测后定）
 * ---------------------------------------------------------------------------
 * 参考实现的 `integrateAxis` 是"**速率指令**"模型：
 *
 *   dv/dt = k(target − v)，target = input·SPEED，dx/dt = v
 *
 * 它的稳态**不是 0**：松手（target = 0）后 v 指数衰减到 0，而 x 收敛到
 * 一个**非零**残差 `x_release + v_release/k`。实测（把参考实现的
 * `PilotMotion` 单独打包跑，见 `.workbuddy-ai/.tmp/wo22/ref-pilot-check.mjs`）：
 *
 *   满舵 0.3 s（远没到墙）→ 松开 3 s → x = 2.9231 → **3.3941**（不回零）
 *   满舵 2.0 s（顶到墙）  → 松开 3 s → x = 20.0000（卡在墙上不动）
 *
 * 参考实现是**故意**这样的（HUD 明写「已到移动边界 · 反向移动 / G 回航」，
 * 而且 `G` 键绑了 `resetPilot`）—— 它是个"配平 / trim"模型：偏移一直挂着，
 * 想回来就反打、或按 G。
 *
 * 本项目**不能照抄**，因为镜头会**切段**：`flightPath.js` 的 4 段镜头
 * （`at: 0.00 / 0.22 / 0.46 / 0.74`）视线方向差得很远，而偏移是在**屏幕空间**
 * 分解的 ⇒ 挂着一份偏移跨过切点，飞机在画面上会**瞬移**（最大 ~2×LIMITS）。
 * 参考实现的镜头是连续绕飞的（它还专门写了 `retainScreenAnchor` 防这个），
 * 没有这个风险。
 *
 * 所以这里改成"**位置指令**"：目标就是 `input × LIMITS`，一阶指数趋近。
 *   · 按住：和参考实现一样"推到底就贴在边界上"（观感一致）；
 *   · 松手：约 `3/7 s ≈ 0.43 s` 回到航线 ⇒ 绝大多数时间偏移是 0，
 *     切点几乎不可能撞上瞬移；
 *   · 有界**可证**：`x` 是 `[x₀, LIMIT]` 的凸组合，归纳得 `|x| ≤ LIMIT`
 *     —— 连 clamp 都不需要（参考实现要 clamp + 速度归零，还得额外处理
 *     "顶在墙上攒速度"）。
 *
 * `POSITION_RESPONSE = 7` 是这么定的：一阶指数走到 95% 的时间是 `3/k`，
 * 令它等于参考实现"顶到边界"的时间 `LIMIT/SPEED = 7/16 = 0.44 s`。
 */

/** 横 / 纵的最大偏移（世界单位）。航线半径 13.5~34，所以 7 已经很明显了。 */
export const PILOT_LIMITS = Object.freeze({ x: 7, y: 4.5 });

/** 相机跟随的比例（0 = 不跟，1 = 完全跟）。参考实现用 0.55。 */
export const PILOT_CAMERA_FOLLOW = 0.55;

/**
 * 偏移 / 姿态的响应速率（1/秒）。越大越"跟手"。
 * `POSITION_RESPONSE` 的取值理由见文件头那段"松手回正"。
 */
const POSITION_RESPONSE = 7;
const ATTITUDE_RESPONSE = 18;

/** 满舵时的横滚 / 俯仰（弧度）。参考实现 0.52 / 0.24。 */
const BANK_PER_AXIS = 0.52;
const PITCH_PER_AXIS = 0.24;

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

function clampAxis(v) {
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** 相机那一帧的屏幕空间基（右 / 上）。见文件头那段"为什么不能用世界轴"。 */
function screenBasis(position, target, out) {
    const forward = target.clone().sub(position);
    if (forward.lengthSq() < 1e-12) forward.set(0, 0, -1);
    forward.normalize();
    // 右 = 前 × 世界UP（用世界 UP 而不是相机的 up ⇒ 不受滚转影响；
    // 滚转是我们自己加上去的装饰，不该让操控跟着歪）。
    out.right.crossVectors(forward, UP);
    if (out.right.lengthSq() < 1e-12) out.right.set(1, 0, 0);
    out.right.normalize();
    out.up.crossVectors(out.right, forward).normalize();
    return out;
}

/**
 * 驾驶模型。**模块级单例** —— 和 `config/flightMode.js` 同一条理由：
 * 位姿与相机是**两个**消费者，各自持一份状态迟早会不同步。
 *
 * 更新（`update`）由 `Airplane` 每帧调一次；相机只**读**（`applyCamera`）。
 * ⚠️ 所以 `Airplane` 必须排在 `FlightCamera` 前面挂载（`Experience.jsx`
 *    里就是这样，而且有注释说明）。
 */
class PilotMotion {
    constructor() {
        this.reset();
        this.basis = {
            right: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
        };
        this.offset = new THREE.Vector3();
    }

    reset() {
        this.x = 0;
        this.y = 0;
        this.bank = 0;
        this.pitch = 0;
        this.engaged = false;
    }

    /** 有没有"在操控"（含回正过程中的残余）。HUD / toast 用。 */
    get active() {
        return this.engaged
            || [this.x, this.y, this.bank, this.pitch]
                .some((v) => Math.abs(v) > 1e-6);
    }

    /** 当前偏移（诊断 / 探针用）。 */
    offsetVector() {
        return this.offset.set(this.x, this.y, 0);
    }

    /**
     * 积分一步。
     *
     * @param {number} dt 秒（`useFrame` 的 delta）
     * @param {{x:number,y:number}} input 轴（`bindPilotInput` 的 `sample`）
     */
    update(dt, input = { x: 0, y: 0 }) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const step = Math.min(dt, 0.1);
        let x = clampAxis(input?.x);
        let y = clampAxis(input?.y);
        // 斜推不能比直推快（对角线归一化）。
        const len = Math.hypot(x, y);
        if (len > 1) { x /= len; y /= len; }
        if (len > 0) this.engaged = true;

        // 位置：一阶指数趋近 `input × LIMITS`（解析解，见文件头）。
        // 目标本身就在 ±LIMITS 内 ⇒ 位置永远不越界，不需要 clamp。
        const position = -Math.expm1(-POSITION_RESPONSE * step);
        this.x += (x * PILOT_LIMITS.x - this.x) * position;
        this.y += (y * PILOT_LIMITS.y - this.y) * position;

        const attitude = -Math.expm1(-ATTITUDE_RESPONSE * step);
        this.bank += (x * BANK_PER_AXIS - this.bank) * attitude;
        // 机头是 +z ⇒ 绕局部 x 的**负**旋转是抬头（参考实现那条注释）。
        this.pitch += (-y * PITCH_PER_AXIS - this.pitch) * attitude;
    }

    /**
     * 把操控叠到航线位姿上。
     *
     * @param {{position: THREE.Vector3, quaternion: THREE.Quaternion}} pose 航线位姿
     * @param {{position: THREE.Vector3, target: THREE.Vector3}} frame 航线相机帧
     */
    applyPose(pose, frame) {
        if (!this.active) return pose;
        const b = screenBasis(frame.position, frame.target, this.basis);
        const position = pose.position
            .clone()
            .addScaledVector(b.right, this.x)
            .addScaledVector(b.up, this.y);
        const quaternion = pose.quaternion.clone();
        if (this.bank !== 0 || this.pitch !== 0) {
            quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD, this.bank));
            quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(RIGHT, this.pitch));
            quaternion.normalize();
        }
        return { ...pose, position, quaternion, piloted: true };
    }

    /**
     * 相机跟着偏移走一部分（`PILOT_CAMERA_FOLLOW`）。
     *
     * 位置与目标**一起**平移 ⇒ 视线方向不变 ⇒ 飞机在画面上的**位置**基本
     * 不动，只是背景在动。那正是"操控的是飞机、不是镜头"的读感。
     * 不完全跟（0.55）是为了留一点"它在画面里挪了"的反馈。
     */
    applyCamera(frame) {
        if (!this.active) return frame;
        const b = screenBasis(frame.position, frame.target, this.basis);
        const shift = b.right.clone().multiplyScalar(this.x * PILOT_CAMERA_FOLLOW)
            .addScaledVector(b.up, this.y * PILOT_CAMERA_FOLLOW);
        return {
            ...frame,
            position: frame.position.clone().add(shift),
            target: frame.target.clone().add(shift),
        };
    }
}

/** 单例。见类注释里"为什么是模块级"。 */
export const pilot = new PilotMotion();

export default pilot;
