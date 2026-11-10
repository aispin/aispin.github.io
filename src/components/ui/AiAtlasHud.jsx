import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useScene } from '../../context/SceneContext'
import { useSitePreferences } from '../../context/SitePreferences'
import { reducedMotion } from '../../hooks/useReducedMotion'
import { atlasStage } from '../../state/aiAtlas'
import {
    accentDim,
    accentOf,
    accentRGB,
    brief,
    paintPlate,
    shortName,
} from '../../utils/atlasArt'
import aiProjects from '../../data/aiProjects.json'
import aiAtlasEn from '../../data/aiAtlasEn.json'
import './AiAtlasHud.scss'

/**
 * AI 房间 —— 卡片墙的 **DOM 层**。
 *
 * 这一层是 `public/demos/web3d/ai-atlas/index.html` 那套东西的移植：24 张项目
 * 卡片排成一面**弧形展墙**，滚动时整面墙在深度里平移，点开就是该项目自己的
 * 落地页（全屏浮层，四边 24px）。环境（冷黑底 + 飘尘）由
 * `canvas/rooms/AiAtlas.jsx` 接管渲染，这里只画卡片与 HUD。
 *
 * ── 目标（用户 2026-11-09）──────────────────────────────────────────
 * 「在实用的基础上结合 3D 技术，用于展示项目卡片墙，如有 demoUrl，点击卡片
 *   iframe 全屏（边距 24px）展示。」
 * 于是先把"实用"钉死，再谈 3D：
 *   ① 信息密度按网格来 —— 4/5/3/2 列，一屏能看到 8~12 件，不靠翻页猜。
 *   ② 文字是**真 DOM**，不是贴图。任何 3D 方案只要让标题变糊，就不合格。
 *   ③ 点卡片 → 全屏 iframe。
 *
 * 3D 用在哪（每一处都必须服务于"这是一面墙"）
 * -------------------------------------------
 *   · **弧形墙**：每列按离视线的横向距离绕 Y 轴转一点、并退到后面，连起来
 *     就是一个包住观众的柱面。边缘的卡片自然侧过去、变远、变暗。
 *   · **滚动 = 在墙前移动**：卡片不是"列表滚动"，是整面墙在深度里平移；
 *     滚出视口的卡片先淡出再消失（配合上下压边），像走进雾里。
 *   · **指针视差**：整面墙随指针轻微转向（±1.1°），近处的卡片位移比远处大。
 *   · **卡片是立体的**：hover 时卡片沿 Z 轴抬 78px 朝你扑过来，不是放大。
 *   · 背景那团冷光跟着当前 hover 的卡片换色 —— 墙被这张卡照亮。通道是
 *     `state/aiAtlas.js`（DOM 写、WebGL 读）。
 *
 * ── 数据 ──────────────────────────────────────────────────────────────
 * 列表唯一真源是 `src/data/aiProjects.json`（`scripts/refresh-ai-projects.mjs`
 * 从 GitHub 刷新，24 条），这里只补英文描述（`aiAtlasEn.json`，键 = id）。
 * **不要**把 24 句长文案内联进 JSX —— 那份中文描述在 json 里已经有一份，
 * 抄进来就是两处会漂的真源。
 *
 * ── 主题 / 语言 ───────────────────────────────────────────────────────
 * 🔴 都跟随房子（`useSitePreferences()` 的 `theme` / `language`），本层
 *    **没有**自己的切换器 —— 房子顶部已经有一处，两个会互相打架。
 *    浅色不是深色反相：墙要比卡片深一档，否则 24 张卡糊成一片（见 SCSS）。
 *
 * ── 交互 ──────────────────────────────────────────────────────────────
 * 滚轮**不**走 `hooks/useWheelPager`：那个是"一格一页"（经折 / 实验环），
 * 而这面墙要的是**连续滚动**（原型就是累加 deltaY 的），两套语义没法共用。
 * 拖动同理自己实现，且不用 `setPointerCapture` —— 一旦捕获，随后的 click
 * 会派发到捕获元素上，卡片永远收不到点击。
 */

const pad2 = (n) => String(n + 1).padStart(2, '0')

/** `2026-10-03T06:14:53Z` → `2026.10`（卡片角上是点分年月，和 demo 一致） */
function fmtMonth(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})/)
    return m ? `${m[1]}.${m[2]}` : ''
}

/** 位移超过这个值就认为是拖动，随后的 click 一律吞掉。 */
const CLICK_SLOP = 8

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
}

/**
 * 卡片墙的数据。列表顺序 / 中文描述 / demoUrl / 语言 / 年月全部来自
 * `aiProjects.json`；英文描述来自 `aiAtlasEn.json`。
 */
const ITEMS = aiProjects.map((p, i) => ({
    id: p.id,
    no: i + 1,
    name: shortName(p.name || p.title || p.id),
    url: p.url || p.repository || '',
    demo: p.demoUrl || '',
    lang: p.language || 'skill',
    date: fmtMonth(p.updatedAt),
    zh: p.description || '',
    en: aiAtlasEn[p.id] || p.description || '',
}))

const COPY = {
    zh: {
        /* 房间名叫「AI」（2026-11-10 从「AI+」改过来）。墙上这行不再借比喻：
           原来写的是「图鉴 / ATLAS」，中文会被读成"图片鉴赏"，而且房间以后要装
           不是 skill 的项目/产品，任何"目录/图册"的说法都会先过期。 */
        brandMain: 'AI',
        brandSub: '',
        meta: (n) => `${n} 件 · 全部可运行`,
        hint: '滚动浏览 · 点卡片查看详情 · Esc 关闭',
        badgeDetail: '↗ 详情',
        badgeGitHub: '↗ GitHub',
        goDetail: '详情',
        ariaDetail: (n) => `查看详情：${n}`,
        ariaGitHub: (n) => `打开 GitHub：${n}`,
        close: '关闭',
        loading: '载入中…',
        newTab: '新标签打开 ↗',
    },
    en: {
        brandMain: 'AI',
        brandSub: '',
        meta: (n) => `${n} tools · all runnable`,
        hint: 'Scroll to browse · click a card for details · Esc to close',
        badgeDetail: '↗ Details',
        badgeGitHub: '↗ GitHub',
        goDetail: 'Details',
        ariaDetail: (n) => `Open details: ${n}`,
        ariaGitHub: (n) => `Open on GitHub: ${n}`,
        close: 'Close',
        loading: 'Loading…',
        newTab: 'Open in new tab ↗',
    },
}

/**
 * 给落地页挂上"从哪来"。静态页的返回键靠 `?from=` 改回 `/ai`
 * （`public/demos/_from.js` 的 `ROOMS.ai`）—— `rel="noreferrer"` 让
 * `document.referrer` 一定是空，靠 referrer 认来源这条路走不通。
 */
function withFrom(url) {
    if (!url) return url
    const cut = url.indexOf('#')
    const base = cut < 0 ? url : url.slice(0, cut)
    const hash = cut < 0 ? '' : url.slice(cut)
    return `${base}${base.includes('?') ? '&' : '?'}from=ai${hash}`
}

const AiAtlasHud = () => {
    const { currentRoom, exitRequested } = useScene()
    const { language, theme } = useSitePreferences()
    const t = COPY[language] || COPY.zh
    const light = theme === 'light'

    const visible = currentRoom === 'ai'

    const [openItem, setOpenItem] = useState(null)
    const [frameReady, setFrameReady] = useState(false)
    const [dragging, setDragging] = useState(false)

    const rootRef = useRef(null)
    const wallRef = useRef(null)
    const stageRef = useRef(null)
    const thumbRef = useRef(null)
    const panelRef = useRef(null)
    const frameRef = useRef(null)
    const cardRefs = useRef([])

    /* 布局（视口相关）。写 ref 不写 state：它每帧被读，进 React 就等于每帧
       重渲染 24 张卡。`dirtyRef` 只负责"下一帧重写一遍卡片样式"。 */
    const geoRef = useRef({ W: 0, H: 0, cardW: 0, cardH: 0, contentH: 0, maxScroll: 0, cards: [] })
    const scrollRef = useRef({ y: 0, target: 0, mx: 0, my: 0, tx: 0, ty: 0 })
    const dirtyRef = useRef(true)
    const lastYRef = useRef(-1)
    const movedRef = useRef(0)
    const dragRef = useRef(null)
    const modalRef = useRef(false)
    const hoverRef = useRef(null)
    const rectRef = useRef(null)
    const closeTimer = useRef(0)

    useLayoutEffect(() => { modalRef.current = Boolean(openItem) }, [openItem])

    /* ── 布局 ─────────────────────────────────────────────────────────── */
    const measure = useCallback(() => {
        const W = window.innerWidth
        const H = window.innerHeight
        const small = W < 720
        const cols = W >= 1700 ? 5 : W >= 1180 ? 4 : W >= 860 ? 3 : 2
        const gap = small ? 12 : 22
        /* 右边要多留一条：房子右上角那排控件（`.hud-cluster--right`）是
           `right: 12px` + 46px 宽，窄屏上正好压在最后一列卡片上
           （badge / 编号 / 名字全被盖住，那一片还点不动）。实测 390 宽时
           控件左边缘在 332，而 54 的留白让卡片右边缘跑到 336.1 —— 差 4px
           就是肉眼看到的"卡片钻到按钮底下"。60 = 12 + 46 + 2px 呼吸，
           实测卡片右边缘 330.1、控件左边缘 332 ⇒ 留 1.9px 空隙。
           桌面 76px 本来就够，不用动。 */
        const padL = small ? 14 : 76
        const padR = small ? 60 : 76
        /* 卡片宽度封顶：1920 上按比例算会到 370，一屏只剩两行、信息密度掉下来。
           封顶后把整面墙**居中**（左右留白相等），比硬撑满更像一面展墙。 */
        const cardW = Math.min((W - padL - padR - gap * (cols - 1)) / cols, 320)
        const gridW = cols * cardW + (cols - 1) * gap
        const left = small ? padL : Math.round((W - gridW) / 2)
        /* 窄屏的卡片比例比桌面高：155 宽的卡按 1.07 算只有 166 高，而
           名字两行 + 描述两行 + 页脚就要 120 多 ⇒ 内容会顶出卡片
           （demo 版在手机上就是这样，字压在页脚上）。1.34 配合 SCSS 里
           那条 ≤720 的排版（隐藏编号行、描述 11px）刚好放得下。 */
        const cardH = Math.round(cardW * (small ? 1.34 : 1.07))
        const topPad = small ? 86 : 130
        const bottomPad = small ? 92 : 124

        const rows = Math.ceil(ITEMS.length / cols)
        const contentH = topPad + rows * (cardH + gap) - gap + bottomPad
        const maxScroll = Math.max(0, contentH - H)

        /* 曲率半径：屏幕越宽，墙越"平"一点；窄屏几乎不弯（否则文字会歪） */
        const R = Math.max(W * 1.05, 1150)

        const cards = ITEMS.map((_, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            const x = left + col * (cardW + gap)
            const y = topPad + row * (cardH + gap)
            const cx = x + cardW / 2
            const cy = y + cardH / 2
            const dx = cx - W / 2
            /* 柱面：横向偏得越多，转得越多、退得越远。1.12 是"看得出来但不晕"的系数 */
            return {
                x,
                y,
                cx,
                cy,
                rot: -(dx / R) * (180 / Math.PI) * 1.12,
                z: -(R - Math.sqrt(Math.max(0, R * R - dx * dx))) * 1.12,
            }
        })

        geoRef.current = { W, H, cardW, cardH, contentH, maxScroll, cards }

        /* 静态几何直接写进 DOM（不经过 React —— 见文件头）。
           ⚠️ 卡片上**不能**再有 React 的 `style` prop：一旦有，任何一次重渲染
           （切语言 / 切主题）都会把帧循环写上去的 transform / opacity 抹掉。 */
        cardRefs.current.forEach((el, i) => {
            const c = cards[i]
            if (!el || !c) return
            el.style.width = `${cardW}px`
            el.style.height = `${cardH}px`
            el.style.left = `${c.x}px`
            el.style.top = `${c.y}px`
        })

        const S = scrollRef.current
        S.target = clamp(S.target, 0, maxScroll)
        S.y = clamp(S.y, 0, maxScroll)
        dirtyRef.current = true
    }, [])

    /* ── 每帧：滚动跟随 / 视差 / 卡片位姿 ─────────────────────────────── */
    const updateThumb = useCallback(() => {
        const thumb = thumbRef.current
        if (!thumb) return
        const track = thumb.parentElement?.clientHeight || 0
        const { contentH, H, maxScroll } = geoRef.current
        const frac = contentH > H ? H / contentH : 1
        const h = Math.max(28, Math.round(track * frac))
        const p = maxScroll > 0 ? scrollRef.current.y / maxScroll : 0
        thumb.style.height = `${h}px`
        thumb.style.top = `${Math.round((track - h) * p)}px`
    }, [])

    useEffect(() => {
        if (!visible) return undefined
        let raf = 0
        let last = performance.now()
        const still = reducedMotion()

        const tick = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000)
            last = now
            const S = scrollRef.current
            const G = geoRef.current

            /* 滚动：目标值由输入给，这里只做跟随（松手后的余速就是这条曲线） */
            const k = still ? 30 : 9
            S.y += (S.target - S.y) * (1 - Math.exp(-k * dt))
            if (Math.abs(S.target - S.y) < 0.08) S.y = S.target

            /* 指针视差 */
            const pk = still ? 40 : 4
            S.mx += (S.tx - S.mx) * (1 - Math.exp(-pk * dt))
            S.my += (S.ty - S.my) * (1 - Math.exp(-pk * dt))

            const par = still ? 0 : 1
            if (wallRef.current) {
                wallRef.current.style.transform =
                    `translate3d(${(S.mx * 15 * par).toFixed(2)}px,${(S.my * 8 * par).toFixed(2)}px,0) ` +
                    `rotateY(${(S.mx * 1.1 * par).toFixed(3)}deg) ` +
                    `rotateX(${(-S.my * 0.7 * par).toFixed(3)}deg)`
            }

            /* 卡片：只有滚动变了才写样式（静止时不碰 DOM） */
            if (dirtyRef.current || Math.abs(S.y - lastYRef.current) > 0.02) {
                lastYRef.current = S.y
                dirtyRef.current = false
                const { H, cardH, cards } = G
                for (let i = 0; i < cards.length; i += 1) {
                    const c = cards[i]
                    const el = cardRefs.current[i]
                    if (!el) continue
                    /* 🔴 衰减要按"卡片边缘"算，不能按卡片中心：按中心算的话，
                       卡片还有一半在屏幕里、中心已经出界 ⇒ 整张被隐藏，
                       看起来就是"下面突然空了"。 */
                    const top = c.cy - cardH / 2 - S.y
                    const bot = c.cy + cardH / 2 - S.y
                    const off = Math.max(0, top - H, -bot)
                    const fade = 1 - smoothstep(0, 0.28, off / H)
                    if (fade <= 0.012) {
                        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
                        continue
                    }
                    if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
                    el.style.opacity = fade.toFixed(3)
                    el.style.transform =
                        `translate3d(0,${(-S.y).toFixed(2)}px,${c.z.toFixed(2)}px) ` +
                        `rotateY(${c.rot.toFixed(3)}deg)`
                }
                updateThumb()
            }

            /* 背景那层要的四个量（见 `state/aiAtlas.js`） */
            atlasStage.scroll = S.y
            atlasStage.px = S.mx
            atlasStage.py = S.my

            raf = requestAnimationFrame(tick)
        }

        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [visible, updateThumb])

    /* ── 进场淡入 + 视口变化 ───────────────────────────────────────────── */
    useEffect(() => {
        const el = rootRef.current
        if (!el || !visible) return undefined
        el.classList.remove('is-in')
        const raf = requestAnimationFrame(() => el.classList.add('is-in'))
        return () => cancelAnimationFrame(raf)
    }, [visible])

    useEffect(() => {
        if (!visible) return undefined
        measure()
        const onResize = () => measure()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [visible, measure])

    /* ── 主题 / 语言：重涂封面与色相 ───────────────────────────────────────
       卡片 DOM 由 React 渲染（文案变了要重渲染），但 `--c` / 封面是命令式的。
       放在同一处，避免"切了主题但封面还是深色底"这种半截状态。 */
    useEffect(() => {
        if (!visible) return
        cardRefs.current.forEach((el, i) => {
            const it = ITEMS[i]
            if (!el || !it) return
            el.style.setProperty('--c', accentOf(it.id, light))
            el.style.setProperty('--c-dim', accentDim(it.id, light))
            const cv = el.querySelector('canvas')
            if (cv) paintPlate(cv, it.id, light)
        })
        atlasStage.accent = accentRGB(hoverRef.current || 'atlas', light)
    }, [visible, light, language])

    /* ── 输入：滚轮 ───────────────────────────────────────────────────── */
    useEffect(() => {
        if (!visible) return undefined
        const onWheel = (e) => {
            /* 浮层开着时滚轮属于浮层（里面的页面自己滚）。
               🔴 必须提前 return —— 下面的 preventDefault 是无条件的。 */
            if (modalRef.current) return
            e.preventDefault()
            const G = geoRef.current
            const S = scrollRef.current
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? G.H : 1
            S.target = clamp(S.target + e.deltaY * unit, 0, G.maxScroll)
        }
        window.addEventListener('wheel', onWheel, { passive: false })
        return () => window.removeEventListener('wheel', onWheel)
    }, [visible])

    /* ── 输入：拖动 + 指针视差 ───────────────────────────────────────────
       不设 `setPointerCapture`（见文件头）。pointerdown 记起点，
       move/up 挂 window —— 这样卡片的 click 照旧能收到。 */
    useEffect(() => {
        if (!visible) return undefined

        const onDown = (e) => {
            if (modalRef.current || e.button !== 0) return
            if (!e.target.closest?.('.ai-atlas .stage')) return
            dragRef.current = { y: e.clientY, start: scrollRef.current.target }
            movedRef.current = 0
            setDragging(true)
        }
        const onMove = (e) => {
            if (e.pointerType !== 'touch') {
                scrollRef.current.tx = (e.clientX / window.innerWidth) * 2 - 1
                scrollRef.current.ty = (e.clientY / window.innerHeight) * 2 - 1
            }
            const drag = dragRef.current
            if (!drag) return
            const dy = e.clientY - drag.y
            movedRef.current = Math.max(movedRef.current, Math.abs(dy))
            const G = geoRef.current
            scrollRef.current.target = clamp(drag.start - dy, 0, G.maxScroll)
        }
        const onUp = () => {
            if (!dragRef.current) return
            dragRef.current = null
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
    }, [visible])

    /* ── 浮层：打开 / 关闭 ─────────────────────────────────────────────── */
    const closeOverlay = useCallback(() => {
        const panel = panelRef.current
        const r = rectRef.current
        if (panel) {
            if (r) {
                /* 关闭：反向缩回卡片。先清干净量尺寸，再带着过渡去目标 ——
                   顺序反了就是硬跳。 */
                panel.style.transition = 'none'
                panel.style.transform = 'none'
                const pr = panel.getBoundingClientRect()
                if (pr.width) {
                    const sx = r.width / pr.width
                    const sy = r.height / pr.height
                    const dx = r.left + r.width / 2 - (pr.left + pr.width / 2)
                    const dy = r.top + r.height / 2 - (pr.top + pr.height / 2)
                    void panel.offsetWidth
                    panel.style.transition = 'transform .38s cubic-bezier(.4,0,.6,1),opacity .28s ease'
                    panel.style.transformOrigin = '50% 50%'
                    panel.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`
                }
            }
            panel.style.opacity = '0'
        }
        clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(() => setOpenItem(null), 380)
    }, [])

    const openCard = useCallback((it, el) => {
        if (it.demo) {
            rectRef.current = el?.getBoundingClientRect() || null
            clearTimeout(closeTimer.current)
            setFrameReady(false)
            setOpenItem(it)
        } else if (it.url) {
            window.open(it.url, '_blank', 'noopener,noreferrer')
        }
    }, [])

    /* 打开时做一次 FLIP：先把面板缩到卡片矩形，再展开 —— 视线不用重新找目标。
       `useLayoutEffect` 保证在浏览器绘制之前就把起始变换写上去，否则第一帧
       会先"全屏闪一下"再缩回去。 */
    useLayoutEffect(() => {
        if (!openItem) return
        const panel = panelRef.current
        if (!panel) return
        const r = rectRef.current

        panel.style.transition = 'none'
        panel.style.transform = 'none'
        panel.style.opacity = '0'
        const pr = panel.getBoundingClientRect()
        if (r && pr.width) {
            const sx = r.width / pr.width
            const sy = r.height / pr.height
            const dx = r.left + r.width / 2 - (pr.left + pr.width / 2)
            const dy = r.top + r.height / 2 - (pr.top + pr.height / 2)
            panel.style.transformOrigin = '50% 50%'
            panel.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`
            void panel.offsetWidth
        }
        requestAnimationFrame(() => {
            panel.style.transition = 'transform .5s cubic-bezier(.22,1,.28,1),opacity .32s ease'
            panel.style.transform = 'none'
            panel.style.opacity = '1'
        })
    }, [openItem])

    useEffect(() => () => clearTimeout(closeTimer.current), [])

    /* 浮层开着时把整层抬到 1500（见 SCSS 里 `.is-modal` 的说明）。
       ⚠️ 用 classList 而不是 className 里的动态片段：`is-in` 是上面那个
       effect 手动加的，模板里多一个随 state 变的片段就会把它一起抹掉，
       整间房 opacity 归零（posts 房间 2026-11-06 实测过）。 */
    useEffect(() => {
        rootRef.current?.classList.toggle('is-modal', Boolean(openItem))
    }, [openItem])

    const onFrameLoad = useCallback(() => {
        setFrameReady(true)
        /* 落地页左上角那个「← Demos / ← 首页」胶囊在浮层里是**多余的**：它会把
           iframe 自己导出去，用户就困在浮层里了。同源可以直接塞一条样式藏掉；
           跨源（比如从 localhost 打开线上页面）会抛，catch 掉即可。 */
        try {
            const doc = frameRef.current?.contentDocument
            if (doc?.head && !doc.getElementById('atlas-embed-style')) {
                const style = doc.createElement('style')
                style.id = 'atlas-embed-style'
                style.textContent = '.lab-back,.back,.backlink{display:none !important}'
                doc.head.appendChild(style)
            }
        } catch { /* 跨源就随它去 */ }
    }, [])

    /* ── 输入：键盘 ─────────────────────────────────────────────────────
       🔴 捕获阶段：`DoorSection` 也监听 Escape（用来退出房间），不拦的话
       关浮层会连带把房间也退了。 */
    useEffect(() => {
        if (!visible) return undefined
        const onKey = (e) => {
            if (openItem) {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    closeOverlay()
                }
                return
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const G = geoRef.current
            const S = scrollRef.current
            const page = G.H * 0.62
            if (e.key === 'ArrowDown') { S.target = clamp(S.target + 120, 0, G.maxScroll); e.preventDefault() }
            else if (e.key === 'ArrowUp') { S.target = clamp(S.target - 120, 0, G.maxScroll); e.preventDefault() }
            else if (e.key === 'PageDown') { S.target = clamp(S.target + page, 0, G.maxScroll); e.preventDefault() }
            else if (e.key === 'PageUp') { S.target = clamp(S.target - page, 0, G.maxScroll); e.preventDefault() }
            else if (e.key === 'Home') { S.target = 0; e.preventDefault() }
            else if (e.key === 'End') { S.target = G.maxScroll; e.preventDefault() }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [visible, openItem, closeOverlay])

    /* ── 卡片 ─────────────────────────────────────────────────────────── */
    const onPick = useCallback((it, el) => {
        // 拖完松手浏览器会补一次 click —— 不拦就会"手滑点错"变成弹窗
        if (movedRef.current > CLICK_SLOP) { movedRef.current = 0; return }
        openCard(it, el)
    }, [openCard])

    const onHover = useCallback((id) => {
        hoverRef.current = id
        atlasStage.accent = accentRGB(id, light)
    }, [light])

    const onFocusCard = useCallback((i) => {
        const G = geoRef.current
        const c = G.cards[i]
        if (!c) return
        scrollRef.current.target = clamp(c.cy - G.H / 2, 0, G.maxScroll)
    }, [])

    const meta = useMemo(() => t.meta(ITEMS.length), [t])

    if (!visible) return null

    return (
        <div
            className={`ai-atlas${exitRequested ? ' is-exiting' : ''}`}
            ref={rootRef}
        >
            <div className={`stage${dragging ? ' is-drag' : ''}`} ref={stageRef}>
                <div className="wall" ref={wallRef}>
                    {ITEMS.map((it, i) => {
                        const hasDemo = Boolean(it.demo)
                        const desc = brief(language === 'en' ? it.en : it.zh, language)
                        const full = language === 'en' ? it.en : it.zh
                        return (
                            <div
                                key={it.id}
                                className="card"
                                ref={(el) => { cardRefs.current[i] = el }}
                                role="button"
                                tabIndex={0}
                                data-id={it.id}
                                title={full}
                                aria-label={hasDemo ? t.ariaDetail(it.name) : t.ariaGitHub(it.name)}
                                onClick={(e) => onPick(it, e.currentTarget)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        onPick(it, e.currentTarget)
                                    }
                                }}
                                onFocus={() => onFocusCard(i)}
                                onPointerEnter={() => onHover(it.id)}
                            >
                                <div className="card__in">
                                    <div className="card__plate">
                                        <canvas width="480" height="264" aria-hidden="true" />
                                        <span className="card__badge">
                                            {hasDemo ? t.badgeDetail : t.badgeGitHub}
                                        </span>
                                    </div>
                                    <div className="card__body">
                                        <div className="card__top">
                                            <span className="card__no">{pad2(i)}</span>
                                            <span>{it.lang}</span>
                                        </div>
                                        <h3 className="card__name">{it.name}</h3>
                                        <p className="card__desc">{desc}</p>
                                        <div className="card__foot">
                                            <span>{it.date}</span>
                                            <span className="card__go">
                                                {hasDemo ? t.goDetail : 'GitHub'} →
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* 上下压边：卡片滚到边上就化进背景里（配合帧循环里的透明度衰减） */}
            <div className="veil veil--top" aria-hidden="true" />
            <div className="veil veil--bot" aria-hidden="true" />

            {/* 标题在**顶部中间**：左上角是返回键、右上角是房子的控件栈，
                这里不许占位。 */}
            <header className="brand">
                <h1 className="brand__name">
                    {t.brandMain}
                    {t.brandSub ? <><i>/</i>{t.brandSub}</> : null}
                </h1>
                <div className="brand__meta">{meta}</div>
            </header>

            <div className="hint">{t.hint}</div>

            <div className="scrollbar" aria-hidden="true">
                <i ref={thumbRef} />
            </div>

            {/* 全屏浮层：四边 24px。关闭胶囊放在一条和落地页顶栏（62px）同高的
                右侧条带里垂直居中 —— 和顶栏的文字齐平，不是"挂在下面"。 */}
            {openItem && (
                <div
                    className={`so${frameReady ? ' is-ready' : ''}`}
                    role="dialog"
                    aria-modal="true"
                    aria-label={openItem.name}
                >
                    <div className="so__scrim" onClick={closeOverlay} />
                    <div className="so__panel" ref={panelRef}>
                        <iframe
                            className="so__frame"
                            ref={frameRef}
                            src={withFrom(openItem.demo)}
                            title={openItem.name}
                            allow="fullscreen; clipboard-write"
                            onLoad={onFrameLoad}
                        />
                        <div className="so__bar" />
                        <a
                            className="so__name"
                            href={withFrom(openItem.demo)}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <b>{openItem.name}</b><i>↗</i>
                        </a>
                        <div className="so__xwrap">
                            <button type="button" className="so__x" onClick={closeOverlay}>
                                {t.close} <kbd>Esc</kbd>
                            </button>
                        </div>
                        <span className="so__loading">{t.loading}</span>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AiAtlasHud
