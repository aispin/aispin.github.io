/**
 * CareerTunnel 的 HUD 状态桥。
 *
 * 隧道场景跑在 Canvas 里（它自己接管渲染），HUD 是 DOM —— 两边没有共同的
 * React 祖先，所以用一个模块级的小 store 通信，而不是把状态提到 App。
 *
 * ⚠️ **只在值真的变了才通知**：`progress` 每帧都在变，逐帧 setState 会让
 *    HUD 每帧重渲染一次（8 个按钮 + 一块玻璃面板）。这里把 progress 量化到
 *    1%，active 变了才发。
 */
const listeners = new Set()

const state = {
    active: 0,
    /** 0..1，量化到 1% */
    progress: 0,
    count: 0,
    /**
     * 已经退到隧道口、还在继续往回滚 ⇒ 攒够就出门。
     * 只用来换一句提示文案（"继续往回滚退出房间"），所以是布尔而不是距离。
     */
    armed: false,
}

/* `useSyncExternalStore` 只认**引用变化**。state 是同一个对象、只改字段，
   所以另外维护一个版本号当快照 —— 组件读 `getTunnelState()` 拿真实值。 */
let version = 0

function emit() {
    version += 1
    for (const fn of listeners) fn()
}

export function subscribeTunnel(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function getTunnelVersion() {
    return version
}

export function getTunnelState() {
    return state
}

export function setTunnelCount(count) {
    if (state.count === count) return
    state.count = count
    emit()
}

/** 每帧调用；内部自己去重。 */
export function setTunnelProgress(active, progress) {
    const p = Math.round(progress * 100) / 100
    if (state.active === active && state.progress === p) return
    state.active = active
    state.progress = p
    emit()
}

/** 「继续往回滚就退出」的预备态。只在跨过阈值时发一次。 */
export function setTunnelArmed(armed) {
    if (state.armed === armed) return
    state.armed = armed
    emit()
}

/** 点时间刻度跳转：由 HUD 写目标，隧道读。 */
export const tunnelRequest = { z: null }

/* ── 螺旋几何的唯一真源 ──────────────────────────────────────────────
   场景（CareerTunnel）和 HUD（CareerHud 的时间刻度）都要算"第 i 张卡在
   哪"，两边各写一份 8.5 / -5 / +4 迟早会漂 —— 判据方法论里最贵的一课就是
   "别让消费者自带一份 config"。所以这几个数只在这里定义。 */

/** 卡片沿 z 的间距。 */
export const TUNNEL_SPACING = 8.5

/** 相机停在卡片**前方**（z 更大一侧）多远。 */
export const TUNNEL_CAM_OFFSET = 4

/** 第 i 张卡的世界 z。 */
export const tunnelCardZ = (i) => -(i * TUNNEL_SPACING) - 5

/** 点第 i 张刻度时，相机该去的 z。 */
export const tunnelTargetZ = (i) => tunnelCardZ(i) + TUNNEL_CAM_OFFSET

/* ── 机位 ────────────────────────────────────────────────────────────
   两个 z 是不同的东西，别合并：

   · `TUNNEL_MOUTH_Z` 是**回退边界**（相机能退到的最外沿）。它必须留在第一张
     卡之外，否则"往回滚到口子再滚出去"那个手势没有落脚点。
   · `TUNNEL_ENTRY_Z` 是**开房间时的默认机位**。用户 2026-10-20：
     「打开页面时，默认镜头位置往大门靠（用当前第一次鼠标滚动时的位置）」。
     停在 6 的时候第一张卡在 11 单位外、只占屏幕 1/3，画面大半是空星空；
     停在第一张卡的**停靠位**上，卡正好转正、居中、占屏 70% —— 就是原来
     "滚一下之后"看到的那个构图。 */

/** 相机能退到的最外沿（隧道口）。 */
export const TUNNEL_MOUTH_Z = 6

/** 开房间时的默认机位：第一张卡的停靠位。 */
export const TUNNEL_ENTRY_Z = tunnelTargetZ(0)

