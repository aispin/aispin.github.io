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
 */
export const SETTLE_POS = 1e-4;
export const SETTLE_ANGLE = 1e-6;

/**
 * 平滑到 target；一旦足够近就直接跳到 target，让状态真正收敛。
 *
 * @param {number} current 当前值
 * @param {number} target  目标值
 * @param {number} t       每帧插值系数（0..1）
 * @param {number} [eps]   收敛阈值，默认 SETTLE_POS
 * @returns {number}
 */
export function settleLerp(current, target, t, eps = SETTLE_POS) {
    const next = THREE.MathUtils.lerp(current, target, t);
    return Math.abs(target - next) < eps ? target : next;
}

export default settleLerp;
