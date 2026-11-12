/**
 * 音乐房间的**跨层通道**（DOM → WebGL）。
 *
 * 和 `state/aiAtlas.js` 同一个用法：DOM 层写、渲染层读，不经过 props
 * （唱盘 DOM 和暗房着色器分属两棵树，props 要穿三层）。
 *
 * 只有一个量：**唱片是不是在转**。暗房用它决定那道极慢的扫光要不要活起来 ——
 * 静止时画面完全不动，这是"暂停"应有的样子。
 */
export const musicStage = {
    /** 唱片在转（audio 没暂停） */
    spinning: false,
};

/** DOM 层调：引擎每次 play/pause 都同步过来 */
export function setSpinning(v) {
    musicStage.spinning = Boolean(v);
}
