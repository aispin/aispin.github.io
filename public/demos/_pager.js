/* =============================================================================
 * `_pager.js` —— 一格一页的输入层：滚轮 / 拖动（含触屏）/ 方向键。
 *
 * 为什么需要它
 * ------------
 * `wheel` 不是"一次手势 = 一个事件"。触控板的惯性会连发几十个逐渐衰减的事件，
 * 鼠标滚轮一次咔哒也可能拆成 3 个。所以"`deltaY` 超过阈值就翻一页"必然翻多，
 * "距上个事件超过 N 毫秒算新手势"在掉帧的机器上又会一路翻过去 —— 事件间隔
 * 等于主线程帧长，用时间判手势本身就不可靠。
 *
 * 判据（与 `src/components/ui/CraftHud.jsx` 逐字相同，那里已经跑了一年）
 * --------------------------------------------------------------------
 * 只看**幅度曲线的形状**，时间只留一个"真的松手了"的长阈值：
 *   ① 距上一事件 > PAUSE(600ms) 且幅度 > 3         ⇒ 手指离开过，是新手势
 *   ② 幅度从低谷回升到 low × RISE(1.8) + 2 以上     ⇒ 惯性衰减后的二次加速
 *   ③ 方向反转且幅度 > 4                          ⇒ 反向，必然是新意图
 *   ④ 幅度 ≥ NOTCH(60) 且不小于上一帧              ⇒ 离散的鼠标滚轮咔哒
 * 命中任一条 ⇒ 解锁，允许再走一格；累积量 ≥ STEP(26) 走一格，走完立刻上锁。
 *
 * 🔴 解锁（fresh）时**不清累积量**：慢慢划的时候事件间隔可能就超过 PAUSE，
 *    清了的话每一帧都从 0 开始攒，永远攒不满一格（"慢慢划翻不动"）。
 *
 * 用法
 * ----
 *   <script src="../../_pager.js"></script>
 *   const pager = createPager({
 *       target: document.querySelector('.stage'),   // 滚轮/拖动的命中区
 *       dragSelector: '.stage',                     // 拖动只在这个区域起手
 *       enabled: () => !modalOpen,                  // 弹层开着就交还输入
 *       onStep: (dir) => go(index + dir),           // dir = 1 下一页 / -1 上一页
 *       onDragStart: () => el.classList.add('is-dragging'),
 *       onDragEnd: () => el.classList.remove('is-dragging'),
 *   })
 *
 *   // 拖动结束浏览器会补一次 click —— 先问一句，别让"手滑"变成误点
 *   el.addEventListener('click', () => { if (pager.wasDragged()) return; … })
 *
 * ⚠️ 内部**不用** `setPointerCapture`：一旦捕获，浏览器会把随后的 click 派发到
 *    捕获元素上，子元素（.fold / .panel）的点击就永远收不到 —— 表现为"点不动"。
 *    改成 pointerdown 记起点、move/up 挂 window。
 * ========================================================================== */
;(function (global) {
    'use strict'

    var DEFAULTS = {
        /* 滚轮：一格的累积量（像素）。触控板一次轻扫约 30~60，鼠标一格约 100 */
        wheelStep: 26,
        wheelPause: 600,
        wheelRise: 1.8,
        wheelNotch: 60,
        /* 拖动：多少像素走一格。太小会滑一下翻三页，太大像拖不动 */
        stepPx: 140,
        /* 位移超过这个值就认为是拖动，随后的 click 一律吞掉 */
        clickSlop: 8,
        keys: true,
    }

    function createPager(options) {
        var o = Object.assign({}, DEFAULTS, options || {})
        var target = o.target || document
        var enabled = o.enabled || function () { return true }
        var onStep = o.onStep || function () {}

        /* ── 滚轮 ────────────────────────────────────────────────────── */
        var acc = 0
        var locked = false
        var lastAbs = 0
        var lastDir = 0
        var lastAt = -1e9
        var low = Infinity
        var stepAbs = 0

        function onWheel(e) {
            if (!enabled()) return
            e.preventDefault()

            /* deltaMode：0 = 像素，1 = 行，2 = 页。Firefox 用行，
               不换算的话阈值形同虚设（一行 ≈ 16px） */
            var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? global.innerHeight : 1
            var dy = e.deltaY * unit
            var abs = Math.abs(dy)
            if (!abs) return

            var now = performance.now()
            var dir = dy > 0 ? 1 : -1
            var armed = low <= stepAbs * 0.7
            var fresh =
                (now - lastAt > o.wheelPause && abs > 3) ||   // ① 手指离开过
                (armed && abs > low * o.wheelRise + 2) ||     // ② 从低谷回升
                (lastDir !== 0 && dir !== lastDir && abs > 4) || // ③ 反向
                (abs >= o.wheelNotch && abs >= lastAbs)       // ④ 离散档

            lastAt = now
            lastAbs = abs
            lastDir = dir
            if (abs < low) low = abs

            if (fresh) {
                locked = false
                low = abs
                stepAbs = abs
                /* 🔴 这里不清 acc，理由见文件头 */
            }
            if (locked) return

            acc += dy
            if (Math.abs(acc) >= o.wheelStep) {
                onStep(acc > 0 ? 1 : -1)
                acc = 0
                locked = true
                stepAbs = abs
                low = abs
            }
        }

        /* ── 拖动（pointer 事件同时覆盖鼠标、触屏、触控笔）───────────── */
        var drag = null
        var moved = 0

        function onDown(e) {
            if (!enabled()) return
            if (e.button !== undefined && e.button !== 0) return
            if (o.dragSelector && !(e.target.closest && e.target.closest(o.dragSelector))) return
            drag = { x: e.clientX, y: e.clientY, done: 0 }
            moved = 0
            if (o.onDragStart) o.onDragStart()
        }

        function onMove(e) {
            if (!drag) return
            var dx = e.clientX - drag.x
            var dy = e.clientY - drag.y
            moved = Math.max(moved, Math.sqrt(dx * dx + dy * dy))

            /* 主轴：横向的带子按 dx；手机上竖着滑也认（往上滑 = 下一折） */
            var along = Math.abs(dx) >= Math.abs(dy) ? dx : dy
            var d = along - drag.done
            while (Math.abs(d) >= o.stepPx) {
                onStep(d > 0 ? -1 : 1)          // 往左 / 往上 = 下一页
                drag.done += d > 0 ? o.stepPx : -o.stepPx
                d = along - drag.done
            }
        }

        function onUp() {
            if (!drag) return
            var dist = moved
            drag = null
            if (o.onDragEnd) o.onDragEnd(dist)
        }

        /* ── 方向键 ──────────────────────────────────────────────────── */
        function onKey(e) {
            if (!o.keys || !enabled()) return
            if (e.metaKey || e.ctrlKey || e.altKey) return
            var t = e.target
            var tag = t && t.tagName ? t.tagName.toLowerCase() : ''
            if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                onStep(1)
                e.preventDefault()
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                onStep(-1)
                e.preventDefault()
            }
        }

        /* 触屏：不设 touch-action，浏览器会先吃掉手势去滚动页面 */
        if (target && target.style) target.style.touchAction = 'none'

        target.addEventListener('wheel', onWheel, { passive: false })
        global.addEventListener('pointerdown', onDown)
        global.addEventListener('pointermove', onMove)
        global.addEventListener('pointerup', onUp)
        global.addEventListener('pointercancel', onUp)
        global.addEventListener('keydown', onKey)

        return {
            /** 上一次手势算不算"拖动"（会把标记清掉，只答一次） */
            wasDragged: function () {
                if (moved > o.clickSlop) { moved = 0; return true }
                return false
            },
            destroy: function () {
                target.removeEventListener('wheel', onWheel)
                global.removeEventListener('pointerdown', onDown)
                global.removeEventListener('pointermove', onMove)
                global.removeEventListener('pointerup', onUp)
                global.removeEventListener('pointercancel', onUp)
                global.removeEventListener('keydown', onKey)
            },
        }
    }

    global.createPager = createPager
})(typeof window !== 'undefined' ? window : this)
