import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useScene } from '../../context/SceneContext'
import { useSitePreferences } from '../../context/SitePreferences'
import './CraftHud.scss'

/**
 * 创意实验房间 —— 「实验环」的 **DOM 层**。
 *
 * 这一层是 `public/demos/web3d/ring-gallery/index.html` 那套东西的移植：
 * 25 块玻璃展板绕成一圈，滚动/拖动转动，正前方那块被"抽"出来，点它开浮层。
 * 环境（星云）由 `canvas/rooms/CraftRing.jsx` 接管渲染，这里只画展板和 HUD。
 *
 * ── 为什么展板留在 DOM 里，而不是做成 three 的网格 ────────────────────
 * 用户 2026-11-05 确认的是**那一版视觉**：玻璃质感、圆角、1px 内描边、
 * 文字抗锯齿、hover 高亮、倒三角 + 竖线的注解。搬成 canvas 贴图等于重画
 * 一遍，还要自己实现换行、字体、hover。DOM 一个像素都不用改。
 *
 * ── 圆柱投影（和 demo 逐字一致）──────────────────────────────────────
 *   θ = (i − cur) · step          这块板离正前方多少弧度
 *   x = f · tanθ                  等角映射，越靠边越稀
 *   s = 1 − 0.18·(|θ|/MAX)²       两端的板稍微收一点，假装有纵深
 *   a = 1 − (|θ|/MAX)²            同上，用透明度做空气透视
 * 相机在圆心 ⇒ 每块板到相机的距离都等于 f ⇒ 视觉宽度恒定。
 *
 * 🔴 索引**不夹边界**：环首尾相接，`target` 随便涨，`render()` 里每块板
 *    的角度对 2π 取模，转满一圈再把 cur/target 一起减掉 n（见 renormalize）。
 */

const GROUPS = [
    { id: 'text-effects', zh: '文字特效', en: 'TYPE FX', accent: '#5ee7ff' },
    { id: 'interactive', zh: '交互实验', en: 'INTERACTION', accent: '#a98bff' },
    { id: 'css-art', zh: '纯 CSS', en: 'CSS ART', accent: '#ff9f5a' },
    { id: 'web3d', zh: '3D 场景', en: '3D SCENES', accent: '#8ba3ff' },
    { id: 'skill-ui', zh: '界面', en: 'UI', accent: '#5ce3a8' },
    { id: 'misc', zh: '其它', en: 'MISC', accent: '#e8d9a8' },
]

const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]))

/** 环上不列自己：这个 demo 就是站内的静态版，列进去等于"环里再套一个环"。 */
const SELF_ID = 'web3d/ring-gallery'

/** 每个类别的图样（内联 SVG，画在标题后面）。 */
const MOTIFS = {
    'text-effects': `<svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="104" y="56" text-anchor="end" font-family="monospace" font-size="46" font-weight="700" fill="currentColor" opacity=".13">T</text><text x="104" y="56" text-anchor="end" font-family="monospace" font-size="28" font-weight="700" fill="currentColor" opacity=".2">T</text><text x="104" y="56" text-anchor="end" font-family="monospace" font-size="16" font-weight="700" fill="currentColor" opacity=".28">T</text></svg>`,
    interactive: `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1" xmlns="http://www.w3.org/2000/svg"><circle cx="86" cy="42" r="9" opacity=".34"/><circle cx="86" cy="42" r="18" opacity=".22"/><circle cx="86" cy="42" r="27" opacity=".14"/><path d="M82 36 L97 43 L89 45 Z" fill="currentColor" stroke="none" opacity=".55"/></svg>`,
    'css-art': `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1" xmlns="http://www.w3.org/2000/svg"><path d="M86 20 L100 46 L72 46 Z" opacity=".3"/><circle cx="86" cy="40" r="13" opacity=".22"/><rect x="79" y="33" width="14" height="14" opacity=".3"/></svg>`,
    web3d: `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width=".9" xmlns="http://www.w3.org/2000/svg"><g opacity=".26"><path d="M90 38 L60 78 M90 38 L76 78 M90 38 L90 78 M90 38 L104 78 M90 38 L120 78"/><path d="M62 78 H120 M62 72 H120 M64 66 H120 M68 60 H120 M74 54 H120"/></g></svg>`,
    'skill-ui': `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1" xmlns="http://www.w3.org/2000/svg"><g opacity=".26"><rect x="68" y="14" width="42" height="48" rx="2"/><path d="M68 24 H110"/><rect x="73" y="32" width="28" height="4" fill="currentColor" stroke="none"/><rect x="73" y="42" width="18" height="4" fill="currentColor" stroke="none"/></g></svg>`,
    misc: `<svg viewBox="0 0 120 80" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><g opacity=".2"><circle cx="76" cy="18" r="1.6"/><circle cx="88" cy="26" r="1.2"/><circle cx="100" cy="16" r="1.4"/><circle cx="82" cy="38" r="1.1"/><circle cx="96" cy="42" r="1.6"/><circle cx="108" cy="32" r="1.2"/><circle cx="78" cy="54" r="1.3"/><circle cx="92" cy="58" r="1.5"/><circle cx="106" cy="52" r="1.1"/><circle cx="86" cy="70" r="1.2"/></g></svg>`,
}

/* 焦距由**展位间距**反算，而不是写死视角：固定 FOV 在窄视口上会崩
   （手机 390px 时相邻展位只隔 83px，板宽最小 150px ⇒ 五块叠一起）。
      spacing = pw × 1.16（16% 的缝）  f = spacing / tan(step)
      MAX_ANGLE = atan(半屏宽 × 0.92 / f)
   于是"一屏看见几块"是自然结果：桌面 4 块，手机 1 块。 */
const GAP_RATIO = 1.16

/* 滚轮判据 —— 与 demo 逐字相同，详见 ring-gallery 里那段长注释。
   一句话：判据只用**幅度曲线的形状**，时间只留一个"真的松手了"的长阈值。
   事件间隔 = 主线程帧长，用间隔判手势在掉帧的机器上会一划翻十几格。 */
const WHEEL_STEP = 26
const WHEEL_PAUSE = 600
const WHEEL_RISE = 1.8
const WHEEL_NOTCH = 60

const COPY = {
    zh: {
        eyebrow: '创意实验',
        tagline: '做过的实验，与还能跑起来的小东西',
        hint: '滚动 / 拖动 转动 · 点击展板进入',
        back: '← 退出房间',
        close: '关闭',
        newTab: '新标签打开 ↗',
        loading: '载入中…',
        empty: '没取到 demos.json，环上暂时是空的。',
    },
    en: {
        eyebrow: 'CRAFT',
        tagline: 'Experiments I have shipped, and toys that still run',
        hint: 'Scroll / drag to turn · click a panel to run it',
        back: '← Leave room',
        close: 'Close',
        newTab: 'Open in new tab ↗',
        loading: 'Loading…',
        empty: 'Could not load demos.json — the ring is empty for now.',
    },
}

function groupIdOf(id) {
    const cut = id.indexOf('/')
    if (cut < 0) return 'misc'
    const head = id.slice(0, cut)
    return GROUP_BY_ID.has(head) ? head : 'misc'
}

function buildLab(rawDemos) {
    const buckets = new Map(GROUPS.map((g) => [g.id, []]))
    for (const demo of rawDemos || []) {
        if (!demo || !demo.id) continue
        if (demo.id === SELF_ID) continue
        buckets.get(groupIdOf(demo.id)).push(demo)
    }
    const items = []
    const groups = []
    for (const g of GROUPS) {
        const bucket = buckets.get(g.id)
        if (!bucket.length) continue
        groups.push({ ...g, start: items.length, count: bucket.length })
        for (const demo of bucket) {
            items.push({
                id: demo.id,
                title: demo.title || demo.id,
                description: demo.description || '',
                url: demo.url || `/demos/${demo.id}/`,
                group: g.id,
                groupZh: g.zh,
                groupEn: g.en,
                accent: g.accent,
            })
        }
    }
    return { items, groups }
}

/** 折成离当前最近的等价索引 —— 从第 3 个跳到第 22 个不该倒着转 19 格。 */
function nearestIndex(target, current, count) {
    const n = Math.max(count, 1)
    const j = ((target % n) + n) % n
    return j + n * Math.round((current - j) / n)
}

/**
 * 展板。**用 memo 包住**：环的帧循环直接改 `.panel` 的 transform / opacity，
 * React 一旦因为"换了一块"重渲染这里，就会把 style 重写成只剩 `--c`，
 * 手写上去的 transform 全部丢失（展板瞬间全叠到中心）。
 */
const RingPanels = memo(function RingPanels({ items, panelRefs, onPick }) {
    return (
        <>
            {items.map((item, i) => (
                <button
                    key={item.id}
                    type="button"
                    className="panel"
                    data-i={String(i)}
                    style={{ '--c': item.accent }}
                    ref={(el) => { panelRefs.current[i] = el }}
                    onClick={() => onPick(i)}
                    aria-label={`${item.title} — ${item.groupZh}`}
                >
                    <span className="panel__clip">
                        <span className="panel__glow" />
                        <span className="panel__bar" />
                        <span className="panel__sweep" />
                        <span className="panel__idx">{String(i + 1).padStart(2, '0')}</span>
                        <span
                            className="panel__motif"
                            style={{ color: item.accent }}
                            dangerouslySetInnerHTML={{ __html: MOTIFS[item.group] || MOTIFS.misc }}
                        />
                        <span className="panel__title">{item.title}</span>
                        <span className="panel__cat">{item.groupEn}</span>
                    </span>
                    <span className="panel__caret" aria-hidden="true" />
                </button>
            ))}
        </>
    )
})

const CraftHud = () => {
    const { currentRoom, requestExit, exitRequested } = useScene()
    const { language } = useSitePreferences()
    const t = COPY[language] || COPY.zh

    const [items, setItems] = useState([])
    const [groups, setGroups] = useState([])
    const [active, setActive] = useState(0)
    const [openItem, setOpenItem] = useState(null)
    const [frameReady, setFrameReady] = useState(false)

    const visible = currentRoom === 'craft'

    const rootRef = useRef(null)
    const stageRef = useRef(null)
    const stemRef = useRef(null)
    const detailRef = useRef(null)
    const frameRef = useRef(null)
    const panelRefs = useRef([])

    /* 环的运行时状态。每帧都在改，所以放 ref —— 进 React state 会让
       25 块板每帧重渲染一次。 */
    const stRef = useRef({ cur: -0.55, target: 0, shown: -1, pw: 240, ph: 158, focal: 1000, step: 0, maxAngle: 0.54 })
    const viewerOpenRef = useRef(false)
    const itemsRef = useRef([])
    /* 拖动状态：帧循环要读（拖动中途不做索引归一化），点击要读（拖完松手
       浏览器会补一次 click，不拦就会误开浮层）。 */
    const draggingRef = useRef(false)
    const dragMovedRef = useRef(0)
    /* 🔴 必须是 `useLayoutEffect`：下面量尺寸那个 layout effect 依赖它**已经**
       更新过。用 `useEffect` 的话，items 从 0 → 25 那一帧里 layout effect 先跑、
       passive effect 后跑，`measure()` 读到的是空数组 ⇒ n=1 ⇒ step=2π ⇒
       `tan(2π) ≈ −2.4e-16` ⇒ focal 变成 −1e18 ⇒ maxAngle ≈ −5e-16 ⇒
       **25 块板全被判成"太偏"藏起来**，整环凭空消失（2026-11-05 实测，
       画面上只剩 HUD 文字）。 */
    useLayoutEffect(() => { itemsRef.current = items }, [items])
    useEffect(() => { viewerOpenRef.current = Boolean(openItem) }, [openItem])

    /* 进场淡入：挂载后**下一帧**才加 .is-in，否则插入即终态、CSS 过渡不跑。
       ⚠️ 用 classList 而不是 state —— 在 effect 里同步 setState 会多渲染一轮，
          eslint 的 set-state-in-effect 会直接报出来。 */
    useEffect(() => {
        const el = rootRef.current
        if (!el || !visible) return undefined
        el.classList.remove('is-in')
        const raf = requestAnimationFrame(() => el.classList.add('is-in'))
        return () => cancelAnimationFrame(raf)
    }, [visible])

    /* ── 数据 ──────────────────────────────────────────────────────────
       走 fetch 而不是 import：demos.json 是构建脚本生成的，public/ 下的
       文件也不该被当模块打包（会多出一份副本）。 */
    useEffect(() => {
        if (!visible || items.length) return undefined
        let alive = true
        fetch('/demos/demos.json', { cache: 'no-cache' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!alive || !data) return
                const built = buildLab(data.demos || [])
                setItems(built.items)
                setGroups(built.groups)
            })
            .catch(() => { /* 取不到就空环，不要把房间搞崩 */ })
        return () => { alive = false }
    }, [visible, items.length])

    /* ── 尺寸 ────────────────────────────────────────────────────────── */
    const measure = useCallback(() => {
        const root = rootRef.current
        if (!root) return
        const vw = window.innerWidth
        const vh = window.innerHeight
        const narrow = vw < 860

        // 窄视口一屏只放一块，所以板子可以宽到 76%；宽屏按比例收，再用高度封顶
        const pw = Math.round(Math.max(150, Math.min(
            narrow ? 300 : 280,
            Math.min(narrow ? vw * 0.76 : vw * 0.175, vh * (narrow ? 0.34 : 0.32)),
        )))
        const ph = Math.round(pw * 0.66)

        const st = stRef.current
        const n = itemsRef.current.length
        const spacing = pw * GAP_RATIO

        st.pw = pw
        st.ph = ph
        /* n < 2 时**不碰** step / focal / maxAngle：n=1 ⇒ step=2π ⇒ tan(2π)≈0
           ⇒ focal 变成天文数字、maxAngle ≈ 0 ⇒ 每块板都判成"太偏"。数据还没
           到的那一帧就是这样，宁可留上一次的值。 */
        if (n >= 2) {
            const step = (Math.PI * 2) / n
            st.step = step
            // 相机在圆心 ⇒ 每块板到相机的距离都等于 f ⇒ 视觉宽度恰好等于板宽
            st.focal = spacing / Math.tan(step)
            // 可见半角：屏宽的 92%（留 4% 给两端的淡出）
            st.maxAngle = Math.min(Math.atan((vw * 0.46) / st.focal), Math.PI / 2 - 0.02)
        }

        root.style.setProperty('--pw', `${pw}px`)
        root.style.setProperty('--ph', `${ph}px`)
        root.style.setProperty('--stripY', `${Math.round(ph / 2 + 26)}px`)
    }, [])

    /* ── 每帧重排 ─────────────────────────────────────────────────────── */
    const render = useCallback(() => {
        const st = stRef.current
        const n = itemsRef.current.length
        if (!n) return

        const nearest = Math.round(st.cur)
        const activeIdx = ((nearest % n) + n) % n
        const f = st.focal
        const maxAngle = st.maxAngle

        for (let i = 0; i < n; i += 1) {
            const el = panelRefs.current[i]
            if (!el) continue

            let rel = (i - st.cur) * st.step
            // 归一到 (-π, π]
            rel %= Math.PI * 2
            if (rel > Math.PI) rel -= Math.PI * 2
            if (rel <= -Math.PI) rel += Math.PI * 2

            const hidden = Math.abs(rel) > maxAngle
            if (hidden) {
                if (!el.classList.contains('is-hidden')) {
                    el.classList.add('is-hidden')
                    el.style.opacity = '0'
                    el.style.pointerEvents = 'none'
                    el.setAttribute('aria-hidden', 'true')
                    el.tabIndex = -1
                }
                continue
            }
            if (el.classList.contains('is-hidden')) {
                el.classList.remove('is-hidden')
                el.style.pointerEvents = ''
                el.setAttribute('aria-hidden', 'false')
                el.tabIndex = 0
            }

            const isFocus = i === activeIdx
            const tt = Math.abs(rel) / maxAngle
            const ease = tt * tt

            const x = f * Math.tan(rel) * (isFocus ? 0.84 : 1)
            const y = -ease * 16 - (isFocus ? 6 : 0)
            const s = (1 - 0.18 * ease) * (isFocus ? 1.12 : 1)
            const a = isFocus ? 1 : 1 - ease * 0.82

            el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`
            el.style.opacity = a.toFixed(3)
            el.classList.toggle('is-focus', isFocus)
        }

        if (st.shown !== activeIdx) {
            st.shown = activeIdx
            setActive(activeIdx)
        }
    }, [])

    /* ── 竖线 ──────────────────────────────────────────────────────────
       两端都是**现算**的：上端是焦点板下沿（板的位置每帧由 transform 写，
       还带 1.12 的缩放），下端是说明文字的顶边（高度随文案变）。
       只在换展位 / 停稳 / resize 时跑 —— 这里读 getBoundingClientRect
       会强制同步布局，每帧跑就是白扔性能。 */
    const syncStem = useCallback(() => {
        const el = panelRefs.current[stRef.current.shown]
        const stem = stemRef.current
        const detail = detailRef.current
        if (!el || !stem || !detail) return

        const pr = el.getBoundingClientRect()
        const dr = detail.getBoundingClientRect()
        const top = pr.bottom + 13          // 倒三角 10px + 3px 空隙
        const h = dr.top - top - 6

        // 空间不够（极扁的窗口）就别画了，一根 0 高的线只会闪一下
        if (h < 18) { stem.classList.remove('is-on'); return }
        stem.style.top = `${top.toFixed(0)}px`
        stem.style.height = `${h.toFixed(0)}px`
        stem.classList.add('is-on')
    }, [])

    /* ── 帧循环 ───────────────────────────────────────────────────────── */
    useEffect(() => {
        if (!visible || !items.length) return undefined
        let raf = 0
        let last = performance.now()
        const tick = (now) => {
            raf = requestAnimationFrame(tick)
            const dt = Math.min(0.05, (now - last) / 1000)
            last = now
            const st = stRef.current
            if (Math.abs(st.target - st.cur) < 0.0005) {
                if (st.cur !== st.target) { st.cur = st.target; render() }
                // 转满一圈把 cur/target 一起减掉 n：角度本来就对 2π 取模，
                // 画面一模一样，只是把数字拉回 0 附近，免得转久了浮点抖。
                const n = itemsRef.current.length
                if (n && !draggingRef.current) {
                    const k = Math.round(st.cur / n)
                    if (k) { st.cur -= k * n; st.target -= k * n }
                }
                return
            }
            st.cur += (st.target - st.cur) * (1 - Math.exp(-9 * dt))
            render()
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [visible, items.length, render])

    /* 数据到了 → 量尺寸 → 画一帧；换语言/换视口同理 */
    useLayoutEffect(() => {
        if (!visible || !items.length) return
        const st = stRef.current
        st.cur = -0.55      // 进场从"半个展位之外"滑到位，比硬出现有生气
        st.target = 0
        st.shown = -1
        measure()
        render()
        syncStem()
    }, [visible, items.length, measure, render, syncStem])

    useLayoutEffect(() => {
        if (!visible) return undefined
        const onResize = () => { measure(); render(); syncStem() }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [visible, measure, render, syncStem])

    /* 换了一块：先把竖线按**当前**位置画一版（视觉上不断），停稳后再校一次 */
    useEffect(() => {
        if (!visible) return undefined
        syncStem()
        const settle = setTimeout(syncStem, 700)
        return () => clearTimeout(settle)
    }, [active, visible, syncStem])

    /* ── 输入 ────────────────────────────────────────────────────────── */
    const nudge = useCallback((delta) => { stRef.current.target += delta }, [])
    const jumpTo = useCallback((index) => {
        stRef.current.target = nearestIndex(index, stRef.current.target, itemsRef.current.length)
    }, [])

    const openViewer = useCallback((item) => {
        if (!item) return
        setOpenItem(item)
        setFrameReady(false)
    }, [])
    const closeViewer = useCallback(() => {
        setOpenItem(null)
        setFrameReady(false)
    }, [])

    /* 滚轮：一次手势只走一格，手势一结束立刻能翻下一格。
       判据见文件头 —— 只用幅度曲线的形状，时间只留一个 600ms 的"松手了"。 */
    useEffect(() => {
        if (!visible) return undefined
        let acc = 0
        let locked = false
        let lastAbs = 0
        let lastDir = 0
        let lastAt = -1e9
        let low = Infinity
        let stepAbs = 0

        const onWheel = (e) => {
            if (viewerOpenRef.current) return
            e.preventDefault()

            // deltaMode：0 = 像素，1 = 行，2 = 页。Firefox 用行，不换算阈值形同虚设
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
            const dy = e.deltaY * unit
            const abs = Math.abs(dy)
            if (!abs) return

            const now = performance.now()
            const dir = dy > 0 ? 1 : -1
            const armed = low <= stepAbs * 0.7
            const fresh =
                (now - lastAt > WHEEL_PAUSE && abs > 3) ||             // ① 手指离开过
                (armed && abs > low * WHEEL_RISE + 2) ||               // ② 从低谷回升
                (lastDir !== 0 && dir !== lastDir && abs > 4) ||        // ③ 反向
                (abs >= WHEEL_NOTCH && abs >= lastAbs)                 // ④ 离散档

            lastAt = now
            lastAbs = abs
            lastDir = dir
            if (abs < low) low = abs

            if (fresh) {
                locked = false
                low = abs
                stepAbs = abs
                // 🔴 这里**不清** acc：慢慢划的时候事件间隔可能就超过 PAUSE，
                //    清了的话每帧都从 0 开始，永远攒不到一格。
            }
            if (locked) return
            acc += dy
            if (Math.abs(acc) >= WHEEL_STEP) {
                nudge(acc > 0 ? 1 : -1)
                acc = 0
                locked = true
                stepAbs = abs
                low = abs
            }
        }

        window.addEventListener('wheel', onWheel, { passive: false })
        return () => window.removeEventListener('wheel', onWheel)
    }, [visible, nudge])

    /* 拖动转环。
       ⚠️ 不用 `setPointerCapture`：一旦捕获，浏览器会把随后的 click 派发到
       捕获元素（stage）上，`.panel` 的点击就永远收不到 —— 表现为"展板点不动"。
       改成 pointerdown 记起点、pointermove/up 挂 window。 */
    useEffect(() => {
        if (!visible) return undefined
        let startX = 0
        let startTarget = 0
        let stepPx = 140

        const onDown = (e) => {
            if (viewerOpenRef.current || e.button !== 0) return
            if (!e.target.closest('.stage')) return
            draggingRef.current = true
            dragMovedRef.current = 0
            startX = e.clientX
            startTarget = stRef.current.target
            stepPx = Math.max(90, stRef.current.pw * 0.55)
            stageRef.current?.classList.add('is-dragging')
        }
        const onMove = (e) => {
            if (!draggingRef.current) return
            const total = e.clientX - startX
            dragMovedRef.current = Math.abs(total)
            stRef.current.target = startTarget - total / stepPx
        }
        const endDrag = () => {
            if (!draggingRef.current) return
            draggingRef.current = false
            stageRef.current?.classList.remove('is-dragging')
            // 松手吸附到最近一格 —— 停在半个展位上会让正文和展板对不上
            if (dragMovedRef.current > 8) stRef.current.target = Math.round(stRef.current.target)
        }

        window.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', endDrag)
        window.addEventListener('pointercancel', endDrag)
        return () => {
            window.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', endDrag)
            window.removeEventListener('pointercancel', endDrag)
        }
    }, [visible])

    /* 点展板：焦点板直接打开，其他先转过来（直接开会把"手滑点错"变成弹窗） */
    const onPick = useCallback((i) => {
        if (viewerOpenRef.current) return
        // 拖完松手浏览器会补一次 click，不拦就会误开浮层
        if (dragMovedRef.current > 8) { dragMovedRef.current = 0; return }
        const n = itemsRef.current.length
        const nearest = Math.round(stRef.current.cur)
        const activeIdx = ((nearest % n) + n) % n
        if (i === activeIdx) openViewer(itemsRef.current[i])
        else jumpTo(i)
    }, [jumpTo, openViewer])

    useEffect(() => {
        if (!visible) return undefined
        const onKey = (e) => {
            if (viewerOpenRef.current) {
                // 🔴 捕获阶段拦住：DoorSection 也监听 Escape（用来退出房间），
                //    不拦的话关浮层会连带把房间也退了。
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    closeViewer()
                }
                return
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { nudge(1); e.preventDefault() }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { nudge(-1); e.preventDefault() }
            else if (e.key === 'Enter') {
                const n = itemsRef.current.length
                if (!n) return
                const nearest = Math.round(stRef.current.cur)
                openViewer(itemsRef.current[((nearest % n) + n) % n])
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [visible, nudge, openViewer, closeViewer])

    const onFrameLoad = useCallback(() => {
        setFrameReady(true)
        /* demo 页左上角那个「← Demos」胶囊在浮层里是**多余的**：它会把 iframe
           自己导到索引页，用户就困在浮层里了。同源可以直接塞一条样式藏掉；
           跨源会抛，catch 掉即可。 */
        try {
            const doc = frameRef.current?.contentDocument
            if (doc && doc.head && !doc.getElementById('craft-embed-style')) {
                const style = doc.createElement('style')
                style.id = 'craft-embed-style'
                style.textContent = '.lab-back,.back{display:none !important}'
                doc.head.appendChild(style)
            }
        } catch { /* 跨源就随它去 */ }
    }, [])

    const chips = useMemo(() => groups, [groups])

    if (!visible) return null

    const cur = items[active]
    const g = cur ? GROUP_BY_ID.get(cur.group) : null
    const hasDesc = Boolean(cur?.description)

    return (
        <div
            className={`craft-room${exitRequested ? ' is-exiting' : ''}`}
            ref={rootRef}
            style={cur ? { '--accent': cur.accent } : undefined}
        >
            <div className="platform" aria-hidden="true" />
            <div className="strip" aria-hidden="true" />

            <div className="stage" id="craft-stage" ref={stageRef}>
                <RingPanels items={items} panelRefs={panelRefs} onPick={onPick} />
            </div>

            <div className="hud">
                {/* 箭头和文字分开：窄视口下标题居中会顶到这个胶囊，
                    媒体查询里只留箭头（图标化），标题就不被压了。 */}
                <button className="hud__back" type="button" onClick={requestExit}>
                    <span className="hud__back-arrow" aria-hidden="true">←</span>
                    <span className="hud__back-label">{t.back.replace(/^←\s*/, '')}</span>
                </button>

                <header className="hud__head">
                    <div className="hud__eyebrow">{t.eyebrow}</div>
                    <p className="hud__tagline">{t.tagline}</p>
                    <div className="hud__count">
                        {items.length ? `${String(active + 1).padStart(2, '0')} / ${items.length}` : '— / —'}
                    </div>
                </header>

                <nav className="hud__rail" aria-label={language === 'zh' ? '类别' : 'Categories'}>
                    <div className="hud__rail-head">{language === 'zh' ? '类别' : 'CATEGORY'}</div>
                    {chips.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            className={`chip${cur && cur.group === c.id ? ' is-active' : ''}`}
                            style={{ '--c': c.accent }}
                            onClick={() => jumpTo(c.start)}
                        >
                            <span className="chip__dot" />
                            <span className="chip__name">{language === 'zh' ? c.zh : c.en}</span>
                            <span className="chip__n">{c.count}</span>
                        </button>
                    ))}
                </nav>

                {/* 从焦点板垂下来的那根线，长度由 syncStem 按两端的实际位置算 */}
                <div className="hud__stem" ref={stemRef} aria-hidden="true" />

                <section className="hud__detail" ref={detailRef} aria-live="polite">
                    {cur ? (
                        <>
                            <div className="hud__meta">
                                <span className="hud__idx">{String(active + 1).padStart(2, '0')}</span>
                                <span className="hud__sep" aria-hidden="true" />
                                <span className="hud__cat">{g ? g.en : ''}</span>
                            </div>
                            {/* 标题**不重复**：卡片上已经写着它了，这里再写一遍，
                                视觉上立刻变成"另一张卡" —— 正是要消掉的那种感觉。 */}
                            <h2 className="hud__title" hidden={hasDesc}>{cur.title}</h2>
                            <p className="hud__desc" hidden={!hasDesc}>{hasDesc ? cur.description : ''}</p>
                        </>
                    ) : (
                        <h2 className="hud__title">{items.length ? t.loading : t.empty}</h2>
                    )}
                </section>

                <div className="hud__hint">{t.hint}</div>
            </div>

            <div
                className={`viewer${openItem ? ' is-open' : ''}${frameReady ? ' is-ready' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={openItem?.title || ''}
                style={openItem ? { '--accent': openItem.accent } : undefined}
            >
                <div className="viewer__scrim" onClick={closeViewer} />
                <div className="viewer__card">
                    <div className="viewer__bar">
                        <span
                            className="viewer__dot"
                            style={openItem ? { background: openItem.accent, boxShadow: `0 0 10px ${openItem.accent}` } : undefined}
                        />
                        <span className="viewer__title">{openItem?.title || ''}</span>
                        <span className="viewer__cat">{openItem ? GROUP_BY_ID.get(openItem.group)?.en : ''}</span>
                        <span className="viewer__spacer" />
                        {openItem && (
                            <a className="viewer__act" href={openItem.url} target="_blank" rel="noreferrer">
                                {t.newTab}
                            </a>
                        )}
                        <button className="viewer__close" type="button" onClick={closeViewer} aria-label={t.close}>×</button>
                    </div>
                    <div className="viewer__body">
                        {openItem && (
                            <iframe
                                ref={frameRef}
                                src={openItem.url}
                                title={openItem.title}
                                onLoad={onFrameLoad}
                            />
                        )}
                        <div className="viewer__loading">{t.loading}</div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default CraftHud
