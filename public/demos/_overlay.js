/* =============================================================================
 * `_overlay.js` —— 全屏 iframe 浮层（四边 24px 边距），demos 之间共用一份。
 *
 * 为什么抽出来
 * ------------
 * 「点一张卡 / 一个按钮 → 全屏跑这个项目的落地页」这件事，AI 房间会有两个 demo
 * 都要用（活体那只、卡片墙那只）。边距、关闭方式、加载态、Esc、焦点归位这些
 * 细节如果各写一遍，两边一定长得不一样 —— 而它们出现在同一个房间里。
 *
 * 尺寸约定
 * --------
 * 面板 `inset: 24px`：**24 是这个组件的唯一常量**，别再让调用方传。
 * iframe 铺满整个面板（不设顶栏），项目页拿到的就是完整的可视区；关闭按钮和
 * 标题做成浮在页面上的两颗胶囊，压住的通常是页面自己的页头，代价最小。
 *
 * 关闭胶囊的落点
 * --------------
 * 详情页自己的顶栏是 62px 高（`--topbar-h`）的 sticky 条，所以胶囊放在一条
 * 同高的右侧条带里**垂直居中**，和顶栏的文字齐平。别的模板可以用
 * `createStageOverlay({ head: 56 })` 改条带高度（→ CSS 变量 `--so-head`）。
 *
 * 主题 / 语言
 * -----------
 * 都**不**由调用方传：读 `<html data-theme>` 与 `<html lang>`（宿主/房子写的，
 * 见 `_env.js`）。没有 `data-theme="light"` 就是深色皮 —— 所以一个还没接主题的
 * 页面拿到的仍是原来的深色浮层，不会被系统浅色误伤。
 *
 * FLIP
 * ----
 * 从卡片打开时把面板先缩到卡片矩形、再展开 —— 视线不用重新找目标。
 * 关闭时反向缩回去（`close()` 复用同一个 rect）。没给 rect（比如从按钮打开）
 * 就只做淡入。
 *
 * 用法
 * ----
 *   <script src="../../_overlay.js"></script>
 *   const overlay = createStageOverlay({ accent: '#5ef0c8' })
 *   overlay.open('https://aispin.github.io/x/', { title: 'x', rect: card.getBoundingClientRect() })
 *   overlay.close()          // Esc / 点遮罩 / 点关闭 都会自己调
 *   overlay.isOpen()
 * ========================================================================== */
;(function (global) {
    'use strict'

    var MARGIN = 24

    /* 详情页自己的顶栏高度。iskill-promo-page 那套模板是 `--topbar-h: 62px` 的
       sticky 条，贴在面板顶边；关闭胶囊要跟它**垂直居中**，就得知道这个数。 */
    var HEAD = 62

    var CSS = `
.so-root{position:fixed;inset:0;z-index:80;display:none}
.so-root.is-open{display:block}
.so-scrim{
  position:absolute;inset:0;background:rgba(3,6,10,.84);
  -webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);
  opacity:0;transition:opacity .3s ease;
}
.so-root.is-in .so-scrim{opacity:1}
.so-panel{
  position:absolute;inset:${MARGIN}px;
  border-radius:14px;overflow:hidden;
  background:#070a0f;
  border:1px solid rgba(150,200,225,.22);
  box-shadow:0 60px 160px -60px #000,0 0 90px -40px var(--so-accent,#5ef0c8);
  opacity:0;will-change:transform,opacity;
}
.so-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b0e13;display:block}
/* 载入条：2px，压在面板顶边，load 之后淡出 */
.so-bar{
  position:absolute;left:0;top:0;height:2px;width:100%;z-index:2;
  background:linear-gradient(90deg,transparent,var(--so-accent,#5ef0c8),transparent);
  background-size:42% 100%;background-repeat:no-repeat;
  animation:so-sweep 1.1s linear infinite;
  transition:opacity .45s ease;
}
.so-panel.is-ready .so-bar{opacity:0}
@keyframes so-sweep{0%{background-position:-50% 0}100%{background-position:150% 0}}
/* 关闭胶囊：放在一条**和详情页顶栏同高**的右侧条带里垂直居中。
   以前是 top:34px（相对面板），落点 58px、中心 71px，比顶栏中心（24+31=55）
   低了 16px —— 看着像"挂在下面"。现在条带从面板顶边起算 62px，中心恰好对齐。
   条带自己不吃指针（pointer-events:none），只有按钮吃。 */
.so-xwrap{
  position:absolute;right:${MARGIN + 10}px;top:0;height:var(--so-head,${HEAD}px);z-index:3;
  display:flex;align-items:center;pointer-events:none;
}
.so-x{
  appearance:none;cursor:pointer;pointer-events:auto;
  display:inline-flex;align-items:center;gap:7px;
  padding:7px 13px;border-radius:999px;
  border:1px solid rgba(150,200,225,.24);
  background:rgba(6,10,15,.78);color:#aab6c6;
  font:400 11px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.1em;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  transition:color .2s ease,border-color .2s ease,background .2s ease,opacity .3s ease;
  opacity:.72;
}
.so-x:hover{color:#eef3f8;border-color:rgba(150,200,225,.45);background:rgba(6,10,15,.92);opacity:1}
.so-x kbd{font:inherit;opacity:.6}
.so-name{
  position:absolute;left:${MARGIN + 10}px;bottom:${MARGIN + 10}px;z-index:3;
  display:inline-flex;align-items:center;gap:8px;max-width:52%;
  padding:7px 13px;border-radius:999px;
  border:1px solid rgba(150,200,225,.18);
  background:rgba(6,10,15,.72);color:#8d99ab;
  font:400 11px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.06em;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  opacity:.6;transition:opacity .3s ease;
}
.so-name:hover{opacity:1}
.so-name b{font-weight:500;color:#eef3f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.so-name i{font-style:normal;opacity:.55;white-space:nowrap}

/* ── 浅色：跟着宿主（房子）写在 <html data-theme="light"> 上的主题走 ──────
   浮层自己也有一圈可见的皮（24px 缝、两颗胶囊），深色皮贴在奶油色墙面上会很脏。 */
html[data-theme="light"] .so-scrim{background:rgba(255,246,233,.82)}
html[data-theme="light"] .so-panel{
  background:#fffbf3;border-color:rgba(120,92,66,.22);
  box-shadow:0 60px 160px -60px rgba(90,70,52,.55),0 0 90px -40px var(--so-accent,#5ef0c8);
}
html[data-theme="light"] .so-frame{background:#fff6e9}
html[data-theme="light"] .so-x{
  border-color:rgba(120,92,66,.22);background:rgba(255,250,242,.82);color:#6f6257;
}
html[data-theme="light"] .so-x:hover{
  color:#211d1a;border-color:rgba(120,92,66,.45);background:rgba(255,252,246,.96);
}
html[data-theme="light"] .so-name{
  border-color:rgba(120,92,66,.18);background:rgba(255,250,242,.78);color:#6f6257;
}
html[data-theme="light"] .so-name b{color:#211d1a}

@media (max-width:640px){
  .so-name{display:none}
  /* 手机上页面自己的顶栏（语言/主题/仓库）就在右上角，关闭按钮压上去会挡操作 ——
     挪到右下角，拇指也够得着。条带高度自然失效，改成贴底。 */
  .so-xwrap{right:${MARGIN}px;top:auto;bottom:${MARGIN}px;height:auto}
  .so-x{padding:8px 12px}
}
`

    function injectCSS() {
        if (document.getElementById('so-css')) return
        var s = document.createElement('style')
        s.id = 'so-css'
        s.textContent = CSS
        document.head.appendChild(s)
    }

    function createStageOverlay(opts) {
        opts = opts || {}
        injectCSS()

        var root = document.createElement('div')
        root.className = 'so-root'
        root.setAttribute('role', 'dialog')
        root.setAttribute('aria-modal', 'true')
        root.innerHTML =
            '<div class="so-scrim"></div>' +
            '<div class="so-panel">' +
            '<iframe class="so-frame" title="项目页面" allow="fullscreen; clipboard-write"></iframe>' +
            '<div class="so-bar"></div>' +
            '<a class="so-name" target="_blank" rel="noopener"><b></b><i>↗</i></a>' +
            '<div class="so-xwrap"><button class="so-x" type="button"></button></div>' +
            '</div>'
        document.body.appendChild(root)

        var panel = root.querySelector('.so-panel')
        var frame = root.querySelector('.so-frame')
        var scrim = root.querySelector('.so-scrim')
        var nameBox = root.querySelector('.so-name')
        var nameEl = nameBox.querySelector('b')
        var closeBtn = root.querySelector('.so-x')

        var open = false
        var lastRect = null
        var lastFocus = null
        var closeTimer = 0

        if (opts.accent) root.style.setProperty('--so-accent', opts.accent)
        if (opts.head) root.style.setProperty('--so-head', opts.head + 'px')

        /* 文案跟着文档语言走（`_env.js` 把结果写在 <html lang> 上），
           所以调用方不用传 lang，浮层也不会出现"英文页面 + 关闭"的混搭。 */
        function syncLabel() {
            var en = /^en\b/i.test(document.documentElement.lang || '')
            closeBtn.innerHTML = (en ? 'Close' : '关闭') + ' <kbd>Esc</kbd>'
            closeBtn.setAttribute('aria-label', en ? 'Close' : '关闭')
        }
        syncLabel()

        function setRect(r) {
            /* 面板自身尺寸（未变换时）—— 先清干净再量 */
            panel.style.transition = 'none'
            panel.style.transform = 'none'
            panel.style.opacity = '0'
            var pr = panel.getBoundingClientRect()
            if (!r || !pr.width) return false
            var sx = r.width / pr.width
            var sy = r.height / pr.height
            var dx = r.left + r.width / 2 - (pr.left + pr.width / 2)
            var dy = r.top + r.height / 2 - (pr.top + pr.height / 2)
            panel.style.transformOrigin = '50% 50%'
            panel.style.transform =
                'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')'
            /* 强制落定这一帧，否则下一帧的 transition 会从"无变换"起步 = 直接跳过去 */
            void panel.offsetWidth
            return true
        }

        function expand() {
            /* 下一帧再解锁 transition，否则起始变换会和过渡一起被丢掉 */
            requestAnimationFrame(function () {
                panel.style.transition =
                    'transform .5s cubic-bezier(.22,1,.28,1),opacity .32s ease'
                panel.style.transform = 'none'
                panel.style.opacity = '1'
                root.classList.add('is-in')
            })
        }

        function openWith(url, o) {
            o = o || {}
            clearTimeout(closeTimer)
            if (open) {
                /* 已经开着（比如连续点两件）—— 直接换页，不再做 FLIP */
                frame.src = url
                panel.classList.remove('is-ready')
                nameEl.textContent = o.title || ''
                nameBox.href = url
                return
            }
            open = true
            lastFocus = document.activeElement
            lastRect = o.rect || null
            if (o.accent) root.style.setProperty('--so-accent', o.accent)
            syncLabel()

            nameEl.textContent = o.title || ''
            nameBox.href = url
            frame.src = url
            panel.classList.remove('is-ready')
            root.classList.add('is-open')

            frame.onload = function () {
                panel.classList.add('is-ready')
                /* 同源时把 Esc 接进子文档 —— 否则点进页面里就按不出来了。
                   跨源（比如从 localhost 打开）会抛 SecurityError，忽略即可。 */
                try {
                    frame.contentWindow.addEventListener('keydown', function (e) {
                        if (e.key === 'Escape') close()
                    })
                } catch {
                    /* 跨源：父页面自己的 Esc 仍然有效，只是鼠标在页面里时要先点一下外面 */
                }
            }

            if (!setRect(lastRect)) {
                panel.style.transition = 'opacity .3s ease'
                panel.style.transform = 'none'
                panel.style.opacity = '1'
                requestAnimationFrame(function () {
                    root.classList.add('is-in')
                })
            } else {
                expand()
            }
            closeBtn.focus({ preventScroll: true })
        }

        function close() {
            if (!open) return
            open = false
            root.classList.remove('is-in')
            if (lastRect) collapseTo(lastRect)
            else panel.style.transition = 'opacity .28s ease'
            panel.style.opacity = '0'
            closeTimer = setTimeout(function () {
                root.classList.remove('is-open')
                panel.style.transition = 'none'
                panel.style.transform = 'none'
                panel.style.opacity = '0'
                frame.src = 'about:blank'
                if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true })
            }, 400)
        }

        /* 关闭：反向缩回卡片。先清干净量尺寸，再带着过渡去目标 —— 顺序反了就是硬跳 */
        function collapseTo(r) {
            panel.style.transition = 'none'
            panel.style.transform = 'none'
            var pr = panel.getBoundingClientRect()
            if (!pr.width) return
            var sx = r.width / pr.width
            var sy = r.height / pr.height
            var dx = r.left + r.width / 2 - (pr.left + pr.width / 2)
            var dy = r.top + r.height / 2 - (pr.top + pr.height / 2)
            void panel.offsetWidth
            panel.style.transition =
                'transform .38s cubic-bezier(.4,0,.6,1),opacity .28s ease'
            panel.style.transformOrigin = '50% 50%'
            panel.style.transform =
                'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')'
        }

        closeBtn.addEventListener('click', close)
        scrim.addEventListener('click', close)
        root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                e.stopPropagation()
                close()
            }
        })
        global.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && open) {
                e.stopPropagation()
                close()
            }
        })

        return {
            open: openWith,
            close: close,
            isOpen: function () {
                return open
            },
        }
    }

    global.createStageOverlay = createStageOverlay
})(typeof window !== 'undefined' ? window : this)
