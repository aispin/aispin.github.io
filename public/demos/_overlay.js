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
.so-x{
  position:absolute;right:${MARGIN + 10}px;top:${MARGIN + 10}px;z-index:3;
  appearance:none;cursor:pointer;
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
@media (max-width:640px){
  .so-name{display:none}
  /* 手机上页面自己的顶栏（语言/主题/仓库）就在右上角，关闭按钮压上去会挡操作 ——
     挪到右下角，拇指也够得着 */
  .so-x{right:${MARGIN + 8}px;bottom:${MARGIN + 8}px;top:auto;padding:8px 12px}
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
            '<button class="so-x" type="button">关闭 <kbd>Esc</kbd></button>' +
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
