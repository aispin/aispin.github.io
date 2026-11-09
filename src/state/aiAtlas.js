/**
 * AI 房间（图鉴 · ATLAS）—— DOM 层 → WebGL 层的**单向**信道。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 这间房的卡片墙是 DOM（文字要清晰、点击要命中），背景是一张 WebGL 着色器
 * （一团冷光 + 一层飘尘）。但有两件事只有 DOM 知道：
 *   · 当前 hover 的是哪张卡 ⇒ 背景那团冷光要换成它的色相（"墙被这张卡照亮"）
 *   · 滚到哪儿了 / 指针在哪儿 ⇒ 飘尘要跟着做视差（比卡片慢 ⇒ 在卡片后面）
 * 反过来 WebGL 没有可用的回流通道（也不该有）。所以用一个**可变的普通对象**
 * 传值：HUD 每帧写，渲染器每帧读。
 *
 * ── 为什么不用 React state ────────────────────────────────────────────
 * 这两组值都是 60Hz 变化的（指针移动、滚动跟随）。走 state 等于每帧
 * `setState` ⇒ 24 张卡重渲染 ⇒ 帧率直接掉到个位数。而它们**不影响 DOM 结构**，
 * 只影响一个 uniform，本来就不该进 React。
 *
 * ⚠️ 模块级单例：房间卸载后残留的旧值没有意义，所以 `AiAtlas` 挂载时重置一次
 *    （见 `resetAtlasStage`），免得"上次退出时 hover 在 07 号卡"的颜色带进来。
 */

/** 青绿带的默认色（`hsl(172 74% 62%)`）—— 还没 hover 任何卡时用它。 */
const DEFAULT_ACCENT = [0.36, 0.94, 0.78]

export const atlasStage = {
    /** 当前 hover 卡的色相，**已转成 0~1 的 rgb**（WebGL 的 uniform 只认这个）。 */
    accent: DEFAULT_ACCENT.slice(),
    /** 墙的滚动位移（px）。飘尘按 0.00022/px 上移 —— 比卡片慢，所以在后面。 */
    scroll: 0,
    /** 指针视差，−1~1。飘尘按 0.030 / 0.018 跟着偏。 */
    px: 0,
    py: 0,
}

export function resetAtlasStage() {
    atlasStage.accent[0] = DEFAULT_ACCENT[0]
    atlasStage.accent[1] = DEFAULT_ACCENT[1]
    atlasStage.accent[2] = DEFAULT_ACCENT[2]
    atlasStage.scroll = 0
    atlasStage.px = 0
    atlasStage.py = 0
}
