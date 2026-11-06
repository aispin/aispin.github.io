import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useScene } from '../../context/SceneContext'
import { useSitePreferences } from '../../context/SitePreferences'
import { reducedMotion } from '../../hooks/useReducedMotion'
import useWheelPager from '../../hooks/useWheelPager'
import { loadArticleBody } from '../../utils/articleBody'
import './PostsHud.scss'

/**
 * 文稿房间 —— 「经折」的 **DOM 层**。
 *
 * 这一层是 `public/demos/web3d/posts-fold/index.html` 那套东西的移植：
 * 一条长纸，一折一篇，沿对角线退进暗处，当前这一折立起来面对你。
 * 环境（暖黑底）由 `canvas/rooms/PostsFold.jsx` 接管渲染，这里只画折页与 HUD。
 *
 * ── 为什么折页留在 DOM 里，而不是做成 three 的网格 ────────────────────
 * 折页上全是中文标题与正文。走 three 就得把字渲成纹理：缩放会糊、不能选中、
 * 读屏软件读不到。平面用 `translate3d / rotateY` 和 three 的 plane 视觉上几乎
 * 无差别，代价只是没有真光照（明暗是 `box-shadow` + 手绘渐变）。
 *
 * ── 数据 ──────────────────────────────────────────────────────────────
 * 唯一真源是 `content/articles/<locale>/<slug>.md`；构建期
 * `scripts/build-articles.mjs` 产出 `public/articles/index.json`（只有元数据）
 * 和每篇的静态页。这里 fetch 前者、按需 fetch 后者（见 `utils/articleBody.js`）。
 * **正文不在主包里** —— 18 篇曾经占主包 gzip 的 49%。
 *
 * ── 语言 ──────────────────────────────────────────────────────────────
 * 🔴 跟随房子（`useSitePreferences().language`），**没有**自己的语言切换器。
 * demo 版底部那颗 `#locale` 在房间里被整个摘掉了 —— 房子顶部已经有一处，
 * 两个切换器会互相打架。
 *
 * ── 交互 ──────────────────────────────────────────────────────────────
 * 滚轮判据走 `hooks/useWheelPager`（与 craft 房间逐字相同，全站一份）。
 * 拖动在这里自己实现：环是"跟着手指连续转"，折带是"拖够一格走一格"，
 * 两种语义没法共用。🔴 拖动**不能用** `setPointerCapture` —— 一旦捕获，
 * 浏览器会把随后的 click 派发到捕获元素上，`.fold` 的点击永远收不到
 * （demo 版"点了没反应"就是这个）。
 */

/* 折页尺寸。`--w` / `--h` 由 JS 写进 CSS 变量，因为折距必须用它算：
     折距 = W·cos(折角) 才是共边真折痕
   两边各写一份必然对不上，所以只留这一个来源。 */
const FOLD_W = 300
const FOLD_H = 420

/** 拖动多少像素走一格。太小会滑一下翻三篇，太大像拖不动。 */
const STEP_PX = 140
/** 位移超过这个值就认为是拖动，随后的 click 一律吞掉。 */
const CLICK_SLOP = 8

const pad2 = (n) => String(n + 1).padStart(2, '0')

/** `2025-08-26` → `2025.08.26`（折页上的日期是点分，和 demo 一致） */
const fmtDate = (iso) => String(iso || '').replace(/-/g, '.')

const clamp = (n, max) => Math.max(0, Math.min(Math.max(0, max), n))

/**
 * 给静态页的地址挂上"从哪来"。
 *
 * 阅读层右上角的「独立页面 ↗」是新标签打开的，`rel="noreferrer"` 让
 * `document.referrer` 一定是空 ⇒ 靠 referrer 认来源这条路走不通（和
 * `public/demos/_from.js` 里那段注释同一个原因）。所以显式传 `?from=posts`，
 * 由静态页里的 `FROM_ROOM_SCRIPT` 把左上角的返回键改回 `/posts`。
 *
 * 已经带了 query 的地址要接 `&`，hash 要留在最后。
 */
function withFrom(url) {
    if (!url) return url
    const cut = url.indexOf('#')
    const base = cut < 0 ? url : url.slice(0, cut)
    const hash = cut < 0 ? '' : url.slice(cut)
    return `${base}${base.includes('?') ? '&' : '?'}from=posts${hash}`
}

const COPY = {
    zh: {
        head: '文稿 · POSTS',
        kind: '经折',
        unit: '篇',
        hintPre: '滚轮 / 拖拽 翻阅 · 点击展开 · ',
        hintKey: '/',
        hintPost: ' 搜索',
        index: '目录 · INDEX',
        placeholder: '搜索标题 / 标签 / 日期',
        count: (n) => `${n} 篇`,
        countHit: (hit, all) => `${hit} / ${all}`,
        empty: (kw) => `没有匹配「${kw}」的文章`,
        cta: '阅读全文',
        close: 'ESC 关闭',
        permalink: '独立页面 ↗',
        prev: '← 上一篇',
        next: '下一篇 →',
        fin: '完',
        loading: '载入中…',
        fail: '正文没取到。静态页就在同一个地址，点右上角「独立页面」可以直接看。',
        words: (n) => `${n} 字`,
        noData: '文章还没生成 —— 跑一次 npm run build 就有了。',
    },
    en: {
        head: 'POSTS',
        kind: 'FOLD',
        unit: 'pieces',
        hintPre: 'Scroll / drag to turn · click to read · ',
        hintKey: '/',
        hintPost: ' search',
        index: 'INDEX',
        placeholder: 'Search title / tag / date',
        count: (n) => `${n} articles`,
        countHit: (hit, all) => `${hit} / ${all}`,
        empty: (kw) => `Nothing matches “${kw}”`,
        cta: 'READ',
        close: 'ESC TO CLOSE',
        permalink: 'Open page ↗',
        prev: '← Previous',
        next: 'Next →',
        fin: 'FIN',
        loading: 'Loading…',
        fail: 'Could not load the body. The static page is at the same URL — use “Open page”.',
        words: (n) => `${n} words`,
        noData: 'No articles yet — run npm run build once.',
    },
}

/**
 * 视口相关的那几个量。
 *
 * 数值全部照 demo：桌面折角 24° / 带子偏 30° / 焦点左移 −180px / 焦点 1.45×，
 * 窄屏 18° / 22° / −26px / 1.04×。
 *
 * 🔴 唯一新增的是 `zoom`：demo 的 300×420 折页在 1.45× 下是 609px 高，
 *    700px 高的窗口里会和底部控制条打架。缩**整条带子**（而不是缩 focusS）
 *    才能保住"焦点 1.45× 于邻页"这个层级关系。
 */
function computeCfg() {
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight
    const narrow = vw < 760
    return {
        narrow,
        alpha: narrow ? 18 : 24,
        yaw: narrow ? 22 : 30,
        focusX: narrow ? -26 : -180,
        focusS: narrow ? 1.04 : 1.45,
        fog: narrow ? 0.3 : 0.17,
        shift: narrow ? 0 : 4,
        zoom: Math.max(0.6, Math.min(1, vh / 820)),
    }
}

/** 一折的位姿。逐字翻译 demo 的 `render()`。 */
function foldPose(i, k, cfg) {
    const s = i - k
    const step = FOLD_W * Math.cos((cfg.alpha * Math.PI) / 180)
    let x = s * step
    let y = -s * 7
    let z = 0
    let yaw = i % 2 ? -cfg.alpha : cfg.alpha
    let rx = 0
    let sc = 1
    // 三个分支都会给它赋值，所以不给初值（`no-useless-assignment`）
    let op
    let focus = false
    let away = false

    if (s === 0) {
        yaw = -cfg.yaw
        rx = 3
        sc = cfg.focusS
        z = 70
        x = cfg.focusX
        op = 1
        focus = true
    } else if (s > 0) {
        op = Math.max(0, 1 - s * cfg.fog)
        x += 22 * (1 - op)
        away = i % 2 === 1
    } else {
        op = 0
        x -= 180
    }

    return {
        focus,
        away,
        op,
        transform: `translate3d(${x}px,${y}px,${z}px) rotateY(${yaw}deg) rotateX(${rx}deg) scale(${sc})`,
        // 景深三件套里的两件（第三件是 opacity）。焦点折不加滤镜。
        filter: focus ? 'none' : `blur(${Math.min(1.2 + Math.abs(s) * 0.9, 4).toFixed(2)}px) brightness(.86)`,
        // 离焦点越远越晚动 ⇒ 带子像被"抖"了一下，而不是整体平移
        delay: Math.min(Math.abs(s) * 26, 130),
    }
}

const PostsHud = () => {
    const { currentRoom, exitRequested } = useScene()
    const { language } = useSitePreferences()
    const t = COPY[language] || COPY.zh

    const visible = currentRoom === 'posts'

    const [raw, setRaw] = useState([])
    const [kRaw, setKRaw] = useState(0)
    const [cfg, setCfg] = useState(computeCfg)
    const [dragging, setDragging] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [q, setQ] = useState('')
    const [mAct, setMAct] = useState(0)
    const [open, setOpen] = useState(false)
    const [body, setBody] = useState({ url: '', html: '' })

    const rootRef = useRef(null)
    const dustRef = useRef(null)
    const bodyRef = useRef(null)
    const inputRef = useRef(null)
    const listRef = useRef(null)

    /* 浮层开着时交还输入（滚轮 / 拖动 / 方向键都不该翻页）。
       用 ref 而不是把 state 塞进监听器的依赖：监听器只挂一次，
       每开一次阅读层就重挂一遍 window 监听没有意义。 */
    const modalRef = useRef(false)
    const dragMoved = useRef(0)
    const lenRef = useRef(0)

    /* ── 数据 ──────────────────────────────────────────────────────────
       走 fetch 而不是 import：`index.json` 是构建产物，public/ 下的文件
       也不该被当模块打包（会多出一份副本）。 */
    useEffect(() => {
        if (!visible || raw.length) return undefined
        let alive = true
        fetch('/articles/index.json')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!alive || !Array.isArray(data)) return
                setRaw(data)
            })
            .catch(() => { /* 取不到就空房，别把房间搞崩 */ })
        return () => { alive = false }
    }, [visible, raw.length])

    /* 只取当前语言；按日期倒序 —— 经折是一条"从新到旧"的长卷 */
    const list = useMemo(() => {
        const rows = raw.filter((a) => a && a.locale === language && a.url)
        rows.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
        return rows
    }, [raw, language])

    /* 语言一换篇数就变（zh 10 / en 8）⇒ 当前序号可能越界。
       在**读的时候**夹一次，而不是用 effect 去 setState（那会多渲染一轮）。 */
    const k = Math.min(kRaw, Math.max(0, list.length - 1))
    const cur = list[k] || null

    useLayoutEffect(() => { lenRef.current = list.length }, [list.length])
    useLayoutEffect(() => { modalRef.current = open || menuOpen }, [open, menuOpen])

    /* ── 翻页 ─────────────────────────────────────────────────────────── */
    const step = useCallback((dir) => {
        setKRaw((prev) => clamp(prev + dir, lenRef.current - 1))
    }, [])
    const goTo = useCallback((i) => {
        setKRaw(clamp(i, lenRef.current - 1))
    }, [])

    /* ── 视口 ─────────────────────────────────────────────────────────── */
    useEffect(() => {
        if (!visible) return undefined
        const onResize = () => setCfg(computeCfg())
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [visible])

    /* ── 进场淡入 ─────────────────────────────────────────────────────── */
    useEffect(() => {
        const el = rootRef.current
        if (!el || !visible) return undefined
        el.classList.remove('is-in')
        const raf = requestAnimationFrame(() => el.classList.add('is-in'))
        return () => cancelAnimationFrame(raf)
    }, [visible])

    /* 模态层抬到 1500（见 SCSS 里 `.is-modal` 的说明）。
       ⚠️ 用 classList 而不是 className 里的动态片段：`is-in` 是上面那个
       effect 手动加的，React 只在**自己算出的字符串变了**时才写 className，
       模板里多一个随 state 变的片段就会把 `is-in` 一起抹掉，整间房 opacity
       归零（craft 房间 2026-11-05 实测过）。 */
    useEffect(() => {
        rootRef.current?.classList.toggle('is-modal', Boolean(open || menuOpen))
    }, [open, menuOpen])

    /* ── 尘埃 ───────────────────────────────────────────────────────────
       64 颗慢慢往左上飘的纸屑。单独一张 canvas 而不是往 three 里加粒子：
       它在 DOM 层上面（z 高于折页），盖在纸上才有"纸屑飘过灯下"的感觉。
       减少动态偏好下只画一遍 —— 不留一个永不停的 rAF。 */
    useEffect(() => {
        if (!visible) return undefined
        const cv = dustRef.current
        if (!cv) return undefined
        const cx = cv.getContext('2d')
        if (!cx) return undefined

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        let w = 0
        let h = 0
        let motes = []
        let raf = 0
        let last = performance.now()
        const still = reducedMotion()

        const seed = () => {
            motes = Array.from({ length: 64 }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 0.5 + Math.random() * 1.4,
                a: 0.05 + Math.random() * 0.18,
                // px/秒（demo 里是 px/帧，按 60fps 折算过来的）
                vy: -(3 + Math.random() * 9),
                vx: -(1.2 + Math.random() * 4),
            }))
        }

        const resize = () => {
            w = window.innerWidth
            h = window.innerHeight
            cv.width = Math.round(w * dpr)
            cv.height = Math.round(h * dpr)
            cv.style.width = `${w}px`
            cv.style.height = `${h}px`
            cx.setTransform(dpr, 0, 0, dpr, 0, 0)
            seed()
        }

        const paint = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000)
            last = now
            cx.clearRect(0, 0, w, h)
            for (const p of motes) {
                p.x += p.vx * dt
                p.y += p.vy * dt
                if (p.y < -12) { p.y = h + 12; p.x = Math.random() * w }
                if (p.x < -12) p.x = w + 12
                cx.fillStyle = `rgba(240,232,218,${p.a})`
                cx.beginPath()
                cx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
                cx.fill()
            }
            if (!still) raf = requestAnimationFrame(paint)
        }

        resize()
        paint(performance.now())
        if (!still) raf = requestAnimationFrame(paint)
        window.addEventListener('resize', resize)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('resize', resize)
        }
    }, [visible])

    /* ── 输入：滚轮 ───────────────────────────────────────────────────── */
    useWheelPager({ active: visible, blockedRef: modalRef, onStep: step })

    /* ── 输入：拖动 ─────────────────────────────────────────────────────
       不设 `setPointerCapture`（见文件头）。pointerdown 记起点，
       move/up 挂 window —— 这样 `.fold` 的 click 照旧能收到。 */
    useEffect(() => {
        if (!visible) return undefined
        let drag = null

        const onDown = (e) => {
            if (modalRef.current || e.button !== 0) return
            if (!e.target.closest?.('.stage')) return
            drag = { x: e.clientX, y: e.clientY, done: 0 }
            dragMoved.current = 0
            setDragging(true)
        }
        const onMove = (e) => {
            if (!drag) return
            const dx = e.clientX - drag.x
            const dy = e.clientY - drag.y
            dragMoved.current = Math.max(dragMoved.current, Math.hypot(dx, dy))
            /* 主轴：横向的带子按 dx；手机上竖着滑也认（往上滑 = 下一折） */
            const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy
            let d = along - drag.done
            while (Math.abs(d) >= STEP_PX) {
                step(d > 0 ? -1 : 1)      // 往左 / 往上 = 下一折
                drag.done += d > 0 ? STEP_PX : -STEP_PX
                d = along - drag.done
            }
        }
        const onUp = () => {
            if (!drag) return
            drag = null
            setDragging(false)
        }

        window.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
            window.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
        }
    }, [visible, step])

    /* ── 输入：键盘 ─────────────────────────────────────────────────────
       🔴 捕获阶段：`DoorSection` 也监听 Escape（用来退出房间），不拦的话
       关阅读层会连带把房间也退了。方向键交给 useWheelPager 那一层，
       这里只管 Escape / `/` / ⌘K / Enter。 */
    useEffect(() => {
        if (!visible) return undefined
        const onKey = (e) => {
            const tag = e.target?.tagName?.toLowerCase?.() || ''
            const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable

            if (e.key === 'Escape') {
                if (open) { e.stopPropagation(); setOpen(false); return }
                if (menuOpen) { e.stopPropagation(); setMenuOpen(false); return }
                return
            }
            if (open || menuOpen) return
            if (typing) return

            if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
                e.preventDefault()
                setMenuOpen(true)
                setQ('')
                setMAct(k)
                return
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                step(1)
                e.preventDefault()
                return
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                step(-1)
                e.preventDefault()
                return
            }
            if (e.key === 'Enter' && cur) {
                e.preventDefault()
                setOpen(true)
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [visible, open, menuOpen, k, cur, step])

    /* 目录打开时把焦点交给搜索框。等面板滑下来再聚焦 —— 太早聚焦，
       移动端键盘会顶上来把面板挤掉一半。 */
    useEffect(() => {
        if (!menuOpen) return undefined
        const id = setTimeout(() => inputRef.current?.focus(), 120)
        return () => clearTimeout(id)
    }, [menuOpen])

    /* ── 阅读层：正文 ───────────────────────────────────────────────────
       与静态页共用同一份 HTML（`utils/articleBody.js` 从静态页里挖
       `<article class="prose">`），不再有第二套 parser。 */
    useEffect(() => {
        if (!open || !cur) return undefined
        let alive = true
        loadArticleBody(cur.url).then((html) => {
            if (alive) setBody({ url: cur.url, html })
        })
        return () => { alive = false }
    }, [open, cur])

    /* 换一篇回到开头，否则会继承上一篇的滚动位置 */
    useEffect(() => {
        if (open && bodyRef.current) bodyRef.current.scrollTop = 0
    }, [open, k])

    const html = open && cur && body.url === cur.url ? body.html : ''
    const loading = Boolean(open && cur && body.url !== cur.url)

    /* ── 目录 ─────────────────────────────────────────────────────────── */
    const hits = useMemo(() => {
        const kw = q.trim().toLowerCase()
        const rows = list.map((a, i) => ({ a, i }))
        if (!kw) return rows
        return rows.filter(({ a }) => (
            `${a.title} ${(a.tags || []).join(' ')} ${a.publishedAt}`.toLowerCase().includes(kw)
        ))
    }, [list, q])

    const act = Math.min(mAct, Math.max(0, hits.length - 1))

    useEffect(() => {
        if (!menuOpen) return
        listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
    }, [menuOpen, act])

    const pickRow = useCallback((i) => {
        setMenuOpen(false)
        goTo(i)
    }, [goTo])

    const onMenuKey = (e) => {
        if (!hits.length) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setMAct((act + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            pickRow(hits[act].i)
        }
    }

    /* ── 折页点击 ─────────────────────────────────────────────────────── */
    const onPick = (i) => {
        // 拖完松手浏览器会补一次 click —— 不拦就会"手滑点错"变成翻页或弹窗
        if (dragMoved.current > CLICK_SLOP) { dragMoved.current = 0; return }
        if (i === k) setOpen(true)
        else goTo(i)
    }

    if (!visible) return null

    return (
        <div
            className={`posts-room${exitRequested ? ' is-exiting' : ''}`}
            ref={rootRef}
            style={{ '--w': `${FOLD_W}px`, '--h': `${FOLD_H}px` }}
        >
            <canvas className="dust" ref={dustRef} aria-hidden="true" />

            <div className={`stage${dragging ? ' is-dragging' : ''}`}>
                <div
                    className="ribbon"
                    style={{ '--sx': `${cfg.shift}%`, '--zoom': cfg.zoom }}
                >
                    {list.map((a, i) => {
                        const pose = foldPose(i, k, cfg)
                        return (
                            <button
                                key={a.id || a.slug}
                                type="button"
                                className={`fold${pose.focus ? ' is-focus' : ''}${pose.away ? ' is-away' : ''}`}
                                style={{
                                    transform: pose.transform,
                                    opacity: pose.op,
                                    filter: pose.filter,
                                    transitionDelay: `${pose.delay}ms, 0ms`,
                                    pointerEvents: pose.op < 0.05 ? 'none' : 'auto',
                                }}
                                onClick={() => onPick(i)}
                                tabIndex={pose.focus ? 0 : -1}
                                aria-hidden={pose.op < 0.05 ? 'true' : undefined}
                                aria-label={`${a.title} — ${fmtDate(a.publishedAt)}`}
                            >
                                <span className="pad">
                                    <span className="idx"><i />{pad2(i)}</span>
                                    <span className="title">{a.title}</span>
                                    <span className="excerpt">{a.description}</span>
                                    <span className="meta">
                                        <span><b>{fmtDate(a.publishedAt)}</b></span>
                                        <span>{(a.tags || []).join(' · ')}</span>
                                        <span>{t.words(a.words)}</span>
                                    </span>
                                    <span className="cta"><span />{t.cta}</span>
                                </span>
                                <span className="ghost" aria-hidden="true">{pad2(i)}</span>
                                <span className="folio" aria-hidden="true">{pad2(i)} / {pad2(list.length - 1)}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="beam" aria-hidden="true" />
            <div className="scrim" aria-hidden="true" />

            <div className="hud">
                <div className="hud__tl">
                    <h1>{t.head}</h1>
                    <p>{t.kind} · <b>{list.length || '—'}</b> {t.unit}</p>
                </div>

                <div className="hud__bc">
                    <span className="hud__pos">
                        {list.length ? `${pad2(k)} / ${pad2(list.length - 1)}` : '— / —'}
                    </span>
                    <span className="hud__sep" aria-hidden="true" />
                    <button
                        type="button"
                        className="menu-btn"
                        aria-expanded={menuOpen}
                        aria-controls="posts-menu"
                        aria-label={t.index}
                        onClick={() => {
                            if (menuOpen) { setMenuOpen(false); return }
                            setMenuOpen(true)
                            setQ('')
                            setMAct(k)
                        }}
                    >
                        <svg
                            viewBox="0 0 16 16" width="14" height="14" fill="none"
                            stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <circle cx="6.9" cy="6.9" r="4.5" />
                            <path d="M10.2 10.2 14 14" />
                        </svg>
                    </button>
                </div>

                <div className="hud__bl">
                    {t.hintPre}<b>{t.hintKey}</b>{t.hintPost}
                </div>
            </div>

            {/* 目录：从顶部滑下来的一整条，带搜索。翻一百篇也不靠一格一格滚。 */}
            <div
                className={`menu${menuOpen ? ' is-open' : ''}`}
                id="posts-menu"
                aria-hidden={!menuOpen}
                inert={!menuOpen}
                onKeyDown={onMenuKey}
            >
                <div className="menu__scrim" onClick={() => setMenuOpen(false)} />
                <section className="menu__panel" role="dialog" aria-modal="true" aria-label={t.index}>
                    <div className="menu__head">
                        <span className="menu__label">{t.index}</span>
                        <input
                            className="menu__q"
                            ref={inputRef}
                            type="search"
                            value={q}
                            onChange={(e) => { setQ(e.target.value); setMAct(0) }}
                            placeholder={t.placeholder}
                            autoComplete="off"
                            spellCheck="false"
                        />
                        <span className="menu__count">
                            {q.trim() ? t.countHit(hits.length, list.length) : t.count(list.length)}
                        </span>
                    </div>
                    <ul className="menu__list" ref={listRef}>
                        {hits.length ? hits.map(({ a, i }, n) => (
                            <li
                                key={a.id || a.slug}
                                className={`row${i === k ? ' is-current' : ''}${n === act ? ' is-active' : ''}`}
                                onClick={() => pickRow(i)}
                            >
                                <span className="row__n">{pad2(i)}</span>
                                <span className="row__t">{a.title}</span>
                                <span className="row__d">{fmtDate(a.publishedAt)}</span>
                            </li>
                        )) : (
                            <li className="menu__empty">
                                {list.length ? t.empty(q.trim()) : t.noData}
                            </li>
                        )}
                    </ul>
                </section>
            </div>

            {/* 阅读层：撑满视窗高度（上下各 24px），页眉固定、正文自己滚。 */}
            <div
                className={`reader${open ? ' is-open' : ''}`}
                aria-hidden={!open}
                inert={!open}
                onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
            >
                <article className="sheet">
                    <div className="sheet__bar">
                        <span className="sheet__pos">
                            {cur ? `${pad2(k)} / ${pad2(list.length - 1)} · ${fmtDate(cur.publishedAt)}` : ''}
                        </span>
                        <span className="sheet__spacer" />
                        {cur && (
                            <a
                                className="sheet__link"
                                href={withFrom(cur.url)}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {t.permalink}
                            </a>
                        )}
                        <button type="button" className="close" onClick={() => setOpen(false)}>
                            {t.close}
                        </button>
                    </div>

                    <div className="sheet__body" ref={bodyRef}>
                        {cur && (
                            <>
                                <h2>{cur.title}</h2>
                                <div className="sub">
                                    {/* tags 可能为空（比如「如何使用 Canvas…」那篇）
                                        —— 直接 join 会剩下一个孤零零的「· 689 字」 */}
                                    {[(cur.tags || []).join(' · '), t.words(cur.words)]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </div>
                                <hr />
                                {html ? (
                                    <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
                                ) : (
                                    <p className="sub">{loading ? t.loading : t.fail}</p>
                                )}
                                <div className="sheet__foot">
                                    <button
                                        type="button"
                                        className="nav"
                                        disabled={k === 0}
                                        onClick={() => step(-1)}
                                    >
                                        {t.prev}
                                    </button>
                                    <span className="fin">{t.fin}</span>
                                    <button
                                        type="button"
                                        className="nav"
                                        disabled={k >= list.length - 1}
                                        onClick={() => step(1)}
                                    >
                                        {t.next}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </article>
            </div>
        </div>
    )
}

export default PostsHud
