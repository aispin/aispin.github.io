import * as THREE from 'three';

/**
 * settleLerp —— 一个**真的会停**的 lerp
 * ============================================================
 * `THREE.MathUtils.lerp(a, b, t)` 是渐近的：每帧把差值乘上 (1 − t)，于是
 * 它无限逼近 b 却**永远不等于 b**。做视觉平滑这没问题，但有两个后果：
 *
 *   1. **场景永远没有真正静止过。** 相机停手之后 `camera.position.z`
 *      仍以每帧 ~1e-9 的量在爬，所有读相机位置的 `useFrame` 消费者
 *      （门的朝向、标题分裂、视差层）就跟着每帧再写一次矩阵。用户看不见，
 *      但"静止"这件事在浮点层面从来没发生过 —— 于是任何"等它停稳再断言"
 *      的验证都等不到，只能靠猜 sleep 时长（`verify-reduced-motion.mjs`
 *      就被这个坑了一轮：`reduce` 下仍有 89 个物体在动）。
 *   2. 关闭动态偏好时，「场景应该完全静止」这条**根本无法验证**。
 *
 * 这个版本在剩余误差小于 eps 时**直接赋值**，浮点状态精确收敛到目标值，
 * 下游矩阵变成逐位相同 —— 静止就是真的静止。
 *
 * eps 取值：
 *   SETTLE_POS   1e-4 —— 世界单位（约 0.1 mm）。肉眼无感，矩阵三位小数无感。
 *   SETTLE_ANGLE 1e-6 —— 弧度（约 0.00006°）。相机 lookAt 的目标点差 1e-6
 *                        只会让朝向差 1e-7 rad，远在任何可见/可测阈值之下。
 *
 * 注意 eps 是**绝对**误差：这些调用点跟踪的都是米级的位置和零点几弧度的
 * 角度，不存在"目标值大到 1e-6 相对误差也可观"的情况。
 *
 * 🔴 dt 补偿（WO-1，2026-10-11）
 * ============================================================
 * 上面那套只解决「会不会停」，没解决「停得多快」。调用点给的 `t` 是
 * **每帧**系数，于是收敛速度直接挂在帧率上：
 *
 *   · 1600×900 的 swiftshader 软件渲染只有个位数 fps ⇒ 拖一下要等好几秒
 *     才停住（截图脚本被这个坑过：`setPose` 只好加 `snap`）；
 *   · 240 Hz 的高刷屏上又快到几乎看不出平滑。
 *
 * 现在按「**每秒保留多少**」换算：`(1 − t)` 是 60 fps 下一帧残留的比例，
 * 那么一帧 `dt` 秒之后的残留应该是 `(1 − t) ^ (dt / (1/60))`。
 * ⇒ `k = 1 − (1 − t)^(dt/REF_DT)`。60 fps 时 `dt = REF_DT`，`k ≡ t`，
 * **逐位不变**（所有已验收的截图、探针都仍然成立）。
 *
 * ⚠️ `dt` 要**夹**到 `MAX_DT`：切到别的标签页再切回来、或者长任务卡了一下，
 *    `dt` 可能是好几秒 —— 不夹的话 `k` 直接顶到 1，画面会**瞬移**到目标。
 *    0.1 s（约 6 帧）是"最坏情况下一次跳 1 − (1−t)^6"，仍然是一次平滑的
 *    快速收敛，不是瞬移。
 *
 * ⚠️ `eps` 吸附与 dt 补偿**互不冲突**：吸附保证"真的会停"（浮点状态精确
 *    收敛），dt 补偿保证"停下来的**时长**和帧率无关"。两个都要。
 */
export const SETTLE_POS = 1e-4;
export const SETTLE_ANGLE = 1e-6;

/** 所有调用点给的 `t` 都是按这个帧长标的（60 fps）。 */
export const REF_DT = 1 / 60;
/** `dt` 的上限（秒）。见上面那段"要夹"的理由。 */
export const MAX_DT = 0.1;

/**
 * 把「60 fps 下的每帧系数」换成「这一帧的系数」。
 *
 * @param {number} t  60 fps 下的每帧插值系数（0..1）
 * @param {number} dt 这一帧的实际时长（秒）
 * @returns {number}
 */
export function dtCoeff(t, dt) {
    if (!(dt > 0) || dt === REF_DT) return t;
    const step = Math.min(dt, MAX_DT) / REF_DT;
    return 1 - Math.pow(1 - t, step);
}

/**
 * 平滑到 target；一旦足够近就直接跳到 target，让状态真正收敛。
 *
 * @param {number} current 当前值
 * @param {number} target  目标值
 * @param {number} t       60 fps 下的每帧插值系数（0..1）
 * @param {number} [eps]   收敛阈值，默认 SETTLE_POS
 * @param {number} [dt]    这一帧的实际时长（秒）。默认 `REF_DT` ⇒ 行为与
 *                         加 dt 补偿之前**逐位相同**（老调用点不动也对）。
 * @returns {number}
 */
export function settleLerp(current, target, t, eps = SETTLE_POS, dt = REF_DT) {
    const next = THREE.MathUtils.lerp(current, target, dtCoeff(t, dt));
    return Math.abs(target - next) < eps ? target : next;
}

export default settleLerp;
