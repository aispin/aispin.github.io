import { useEffect } from 'react'

/**
 * 一格一页的**滚轮**判据 —— 全站唯一一份。
 *
 * 为什么需要它
 * ------------
 * `wheel` 不是"一次手势 = 一个事件"。触控板的惯性会连发几十个逐渐衰减的
 * 事件，鼠标滚轮一次咔哒也可能拆成 3 个。所以"`deltaY` 超过阈值就翻一页"
 * 必然翻多，而"距上个事件超过 N 毫秒算新手势"在掉帧的机器上又会一路翻过去
 * —— 事件间隔等于主线程帧长，用时间判手势本身就不可靠。
 *
 * 判据只看**幅度曲线的形状**，时间只留一个"真的松手了"的长阈值：
 *   ① 距上一事件 > PAUSE(600ms) 且幅度 > 3         ⇒ 手指离开过，是新手势
 *   ② 幅度从低谷回升到 low × RISE(1.8) + 2 以上     ⇒ 惯性衰减后的二次加速
 *   ③ 方向反转且幅度 > 4                          ⇒ 反向，必然是新意图
 *   ④ 幅度 ≥ NOTCH(60) 且不小于上一帧              ⇒ 离散的鼠标滚轮咔哒
 * 命中任一条 ⇒ 解锁，允许再走一格；累积量 ≥ STEP(26) 走一格，走完立刻上锁。
 *
 * 🔴 解锁（fresh）时**不清累积量**：慢慢划的时候事件间隔可能就超过 PAUSE，
 *    清了的话每一帧都从 0 开始攒，永远攒不满一格（"慢慢划翻不动"）。
 *
 * ── 为什么抽出来 ──────────────────────────────────────────────────────
 * 这套判据在 `CraftHud`（实验环）里跑了一年，2026-11-06 搬进
 * `public/demos/_pager.js` 给 demo 用，现在文稿房间也要。三处各写一份必然
 * 走样（demo 版第一版就是自己写的 `deltaY > 42`，一划翻三篇）。所以收成这个
 * hook：**只做滚轮**。拖动是每个房间自己实现 —— 环是"跟着手指连续转"，
 * 折带是"拖够一格走一格"，两种语义没法共用一套代码。
 *
 * 用法
 * ----
 *   useWheelPager({
 *       active,                       // 房间在不在（不在就别挂监听）
 *       blockedRef,                   // ref<boolean>，浮层开着时为 true ⇒ 交还输入
 *       onStep: (dir) => go(k + dir), // dir = 1 下一格 / -1 上一格
 *   })
 *
 * ⚠️ `preventDefault()` 是无条件的（房间是满屏的，滚轮不该滚页面），
 *    所以**必须在 blocked 时提前 return** —— 否则阅读层里的正文就滚不动了。
 */

const WHEEL_STEP = 26
const WHEEL_PAUSE = 600
const WHEEL_RISE = 1.8
const WHEEL_NOTCH = 60

export default function useWheelPager({ active, blockedRef, onStep }) {
    useEffect(() => {
        if (!active) return undefined

        let acc = 0
        let locked = false
        let lastAbs = 0
        let lastDir = 0
        let lastAt = -1e9
        let low = Infinity
        let stepAbs = 0

        const onWheel = (e) => {
            if (blockedRef?.current) return
            e.preventDefault()

            // deltaMode：0 = 像素，1 = 行，2 = 页。Firefox 用行，
            // 不换算的话阈值形同虚设（一行 ≈ 16px）
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
            const dy = e.deltaY * unit
            const abs = Math.abs(dy)
            if (!abs) return

            const now = performance.now()
            const dir = dy > 0 ? 1 : -1
            const armed = low <= stepAbs * 0.7
            const fresh =
                (now - lastAt > WHEEL_PAUSE && abs > 3) ||       // ① 手指离开过
                (armed && abs > low * WHEEL_RISE + 2) ||         // ② 从低谷回升
                (lastDir !== 0 && dir !== lastDir && abs > 4) ||  // ③ 反向
                (abs >= WHEEL_NOTCH && abs >= lastAbs)           // ④ 离散档

            lastAt = now
            lastAbs = abs
            lastDir = dir
            if (abs < low) low = abs

            if (fresh) {
                locked = false
                low = abs
                stepAbs = abs
                // 🔴 这里**不清** acc，理由见文件头
            }
            if (locked) return

            acc += dy
            if (Math.abs(acc) >= WHEEL_STEP) {
                onStep(acc > 0 ? 1 : -1)
                acc = 0
                locked = true
                stepAbs = abs
                low = abs
            }
        }

        window.addEventListener('wheel', onWheel, { passive: false })
        return () => window.removeEventListener('wheel', onWheel)
    }, [active, blockedRef, onStep])
}
