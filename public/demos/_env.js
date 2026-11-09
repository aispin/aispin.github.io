/* =============================================================================
 * `_env.js` —— 主题与语言：**读环境，不自己发明开关**。demos 之间共用一份。
 *
 * 为什么要有这个文件
 * ------------------
 * 原型在 `public/demos/` 里是**独立页面**，搬进 3D 房子以后却是房间的一部分：
 * 那时深/浅色和中文/英文都由房子统一控制（`SitePreferences.jsx` 写
 * `documentElement.dataset.theme` 和 `documentElement.lang`）。所以原型**不许**
 * 自带切换图标 —— 它只需要回答一个问题："我现在该长什么样？"
 *
 * 取值优先级
 * ----------
 *   ① `?theme=light|dark` / `?lang=zh|en`   —— 只给验收脚本用（无头浏览器改不了
 *      系统偏好，靠这个拍定妆照；也方便把地址发给别人看某一版）
 *   ② `<html data-theme>` / `<html data-lang>` 脚本执行前已存在 —— 宿主（房子）写的
 *   ③ 系统：`prefers-color-scheme` / `navigator.languages[0]`
 *
 * 只读 `data-*`，**不读 `lang` 属性**：`lang` 是本模块的**输出**（供
 * `_overlay.js` 这类不 import 的组件判断文案），如果它也当输入，就会自己喂自己
 * 一个"强制中文"，永远跟不上系统。
 *
 * 反过来，宿主改主意时要能跟上，所以盯三处：
 *   · `MutationObserver` 盯 `data-theme` / `data-lang`（房子改状态就是写这两个）
 *   · `matchMedia` 盯系统深浅色（用户没覆盖时立刻跟随）
 *   · 主站的 `aispin-language-change` 自定义事件（房子切语言时会派发）
 *
 * 用法
 * ----
 *   <script src="../../_env.js"></script>        // 放 <head>，赶在首帧前定色
 *   stageEnv.theme   // 'dark' | 'light'
 *   stageEnv.lang    // 'zh' | 'en'
 *   stageEnv.onChange(({ theme, lang }) => { ... })
 * ========================================================================== */
;(function (global) {
    'use strict'

    var doc = global.document
    var root = doc.documentElement
    var q = new URLSearchParams(global.location.search)
    var listeners = []

    function systemTheme() {
        return global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    function systemLang() {
        var tag =
            (global.navigator.languages && global.navigator.languages[0]) ||
            global.navigator.language ||
            ''
        if (!tag) return 'zh'
        return /^zh\b/i.test(tag) ? 'zh' : 'en'
    }

    /* 被"钉住"的值：URL 参数 > 宿主预写的 data-*。钉住之后系统偏好就不管用了，
       但宿主后来改 data-* 仍然算数（那时把它改成新值，见 observer）。 */
    var fixed = { theme: null, lang: null }
    var qt = q.get('theme')
    var ql = q.get('lang')
    if (qt === 'light' || qt === 'dark') fixed.theme = qt
    if (ql === 'zh' || ql === 'en') fixed.lang = ql
    if (!fixed.theme && (root.dataset.theme === 'light' || root.dataset.theme === 'dark')) {
        fixed.theme = root.dataset.theme
    }
    if (!fixed.lang && (root.dataset.lang === 'zh' || root.dataset.lang === 'en')) {
        fixed.lang = root.dataset.lang
    }

    function read() {
        return { theme: fixed.theme || systemTheme(), lang: fixed.lang || systemLang() }
    }

    var state = read()

    function apply(next) {
        var changed = next.theme !== state.theme || next.lang !== state.lang
        state = next
        /* 🔴 只在**真的变了**的时候写属性。`setAttribute` 即使写同一个值也会派发
           MutationRecord，而下面的 observer 又会调 `apply` —— 无脑重写就是
           自激死循环：切一次主题，页面直接卡死（无头浏览器被 SIGKILL，实测过）。
           加了这层判等之后，我们的写入触发的回调只会跑一轮空转。 */
        if (root.dataset.theme !== next.theme) root.dataset.theme = next.theme
        if (root.dataset.lang !== next.lang) root.dataset.lang = next.lang
        /* `lang` 是给 `_overlay.js` / 屏幕阅读器看的：它们不该自己猜系统语言 */
        root.lang = next.lang === 'zh' ? 'zh-CN' : 'en'
        root.style.colorScheme = next.theme
        if (changed) {
            for (var i = 0; i < listeners.length; i += 1) listeners[i](state)
        }
        return changed
    }

    /* 第一次写入：同步执行，首帧就是对的颜色，不会闪一下深色 */
    apply(state)

    /* ① 宿主改 data-* —— 采纳，并把该维度从"系统跟随"改成"钉住" */
    new MutationObserver(function (list) {
        var next = { theme: state.theme, lang: state.lang }
        for (var i = 0; i < list.length; i += 1) {
            if (list[i].attributeName === 'data-theme') {
                var t = root.dataset.theme
                if (t === 'light' || t === 'dark') {
                    next.theme = t
                    fixed.theme = t
                }
            } else {
                var l = root.dataset.lang
                if (l === 'zh' || l === 'en') {
                    next.lang = l
                    fixed.lang = l
                }
            }
        }
        apply(next)
    }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-lang'] })

    /* ② 系统深浅色切换 */
    var mq = global.matchMedia('(prefers-color-scheme: dark)')
    var onMq = function () {
        apply(read())
    }
    if (mq.addEventListener) mq.addEventListener('change', onMq)
    else if (mq.addListener) mq.addListener(onMq)

    /* ③ 主站切语言时派的那个事件（见 `SitePreferences.jsx`） */
    global.addEventListener('aispin-language-change', function (e) {
        var l = e.detail === 'en' ? 'en' : 'zh'
        fixed.lang = l
        apply({ theme: state.theme, lang: l })
    })

    global.stageEnv = {
        get theme() {
            return state.theme
        },
        get lang() {
            return state.lang
        },
        isLight: function () {
            return state.theme === 'light'
        },
        onChange: function (fn) {
            listeners.push(fn)
            return function () {
                listeners = listeners.filter(function (f) {
                    return f !== fn
                })
            }
        },
    }
})(typeof window !== 'undefined' ? window : this)
