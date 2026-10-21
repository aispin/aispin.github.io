import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useScene } from '../../context/SceneContext'
import { useSitePreferences } from '../../context/SitePreferences'
import { getLocalizedCollection } from '../../hooks/useContentData'
import {
    getTunnelState,
    getTunnelVersion,
    subscribeTunnel,
    tunnelRequest,
    tunnelTargetZ,
} from '../../state/careerTunnel'
import { UI } from '../../config/theme'
import { projectSub } from '../../utils/projectLink'
import CareerProjectModal, { ProjectThumb } from './CareerProjectModal'
import './CareerHud.scss'

/**
 * 时空隧道的 HUD（DOM 层）。
 *
 * 卡片在 WebGL 里、文字在 DOM 里 —— 3D 里的文字要么糊、要么得走 SDF。
 * demo 也是这么分的：canvas 只画背景与卡面文字，时间刻度/详情面板是 HTML。
 *
 * ⚠️ 外层 `pointer-events: none`，只有可点的元素自己打开 —— 否则这层会盖住
 *    右上角的导航/返回按钮。
 *
 * ⚠️ 标题只有**一个词**，放在**顶部正中**。原来是一组左上角的品牌块
 *    （图标 + 履历 + "滚动穿梭"），正好压在返回按钮上（`hud-cluster--left`
 *    在 top 18 / left 18，品牌块在 top 32 / left 40）—— 用户点不到返回。
 *    左上角从此留给按钮，标题挪到中间，也不再加副标题。
 */
const COPY = {
    zh: {
        hint: '滚动穿梭时间隧道',
        armed: '继续往回滚，退出房间',
        now: '至今',
        projects: '项目',
        empty: '这段履历没有收录独立项目。',
    },
    en: {
        hint: 'Scroll to travel through time',
        armed: 'Keep scrolling back to exit',
        now: 'Present',
        projects: 'Projects',
        empty: 'No standalone projects recorded for this role.',
    },
}

const CareerHud = () => {
    const { currentRoom, exitRequested } = useScene()
    const { language } = useSitePreferences()
    useSyncExternalStore(subscribeTunnel, getTunnelVersion, getTunnelVersion)
    const { active, progress, armed } = getTunnelState()

    const items = useMemo(() => {
        return getLocalizedCollection('experiences', language).map((item) => {
            const start = (item.startDate || '').slice(0, 7).replace('-', '.')
            const end = item.endDate
                ? item.endDate.slice(0, 7).replace('-', '.')
                : COPY[language].now
            return {
                id: item.id,
                title: item.company,
                subtitle: [item.position, item.department].filter(Boolean).join(' · '),
                summary: (item.responsibilities || []).join(' '),
                start,
                range: `${start} — ${end}`,
                /* 项目已经挂在履历上了（`experiences.json` 的 `projects[]`），
                   这里不再单独读一份 projects.json —— 同一个事实只存一处。 */
                projects: Array.isArray(item.projects) ? item.projects : [],
            }
        })
    }, [language])

    const cur = items.length ? items[Math.min(active, items.length - 1)] : null

    /* 打开的那条项目。null = 弹窗关着。
       隧道锁在 CareerProjectModal 里自己管（挂载即锁、卸载即解）。 */
    const [openProject, setOpenProject] = useState(null)
    const closeProject = useCallback(() => setOpenProject(null), [])

    /* ── 自己画的滚动条 ────────────────────────────────────────────────
       Chromium 155（这台机器）把 `::-webkit-scrollbar` 也按 **overlay** 处理：
       `offsetWidth - clientWidth` 恒为 0，不滚的时候一个像素都不画 ——
       用户要的"带滚动条"就落空了。所以轨道和滑块都自己画，位置从
       `scrollTop / (scrollHeight - clientHeight)` 推。 */
    const descRef = useRef(null)
    const thumbRef = useRef(null)
    const trackRef = useRef(null)

    const syncThumb = useCallback(() => {
        const el = descRef.current
        const th = thumbRef.current
        const tr = trackRef.current
        if (!el || !th || !tr) return
        const range = el.scrollHeight - el.clientHeight
        const overflow = range > 1
        tr.style.opacity = overflow ? '1' : '0'
        tr.style.pointerEvents = overflow ? 'auto' : 'none'
        if (!overflow) return
        const trackH = tr.clientHeight
        const h = Math.min(trackH, Math.max(24, Math.round(trackH * (el.clientHeight / el.scrollHeight))))
        th.style.height = `${h}px`
        th.style.transform = `translateY(${(trackH - h) * (el.scrollTop / range)}px)`
    }, [])

    /* 换人 / 换语言 / 改窗口大小都要重量一次（内容高度全变了）。 */
    useLayoutEffect(() => { syncThumb() }, [syncThumb, cur?.id])

    useEffect(() => {
        const onResize = () => syncThumb()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [syncThumb])

    /** 拖滑块。用 window 上的 pointermove（不要 setPointerCapture：滑块很窄，
        指针一歪就丢事件）。 */
    const onThumbDown = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        const el = descRef.current
        const th = thumbRef.current
        const tr = trackRef.current
        if (!el || !th || !tr) return
        const startY = e.clientY
        const startTop = el.scrollTop
        const maxTop = Math.max(1, tr.clientHeight - th.offsetHeight)
        const range = Math.max(1, el.scrollHeight - el.clientHeight)
        const move = (ev) => {
            el.scrollTop = startTop + ((ev.clientY - startY) / maxTop) * range
        }
        const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
    }, [])

    if (currentRoom !== 'career' || !cur) return null

    return (
        <>
            <div
                className={`career-hud${exitRequested ? ' is-exiting' : ''}`}
                style={{ fontFamily: UI.fontFamily }}
            >
                <div className="career-hud__heading">{language === 'zh' ? '履历' : 'Career'}</div>

                {/* 左栏：时间刻度 + 项目卡（与 demo 的 `.left-col` 同构）。
                    原来刻度是**单独绝对定位在屏幕中间**的，加不了项目列表；
                    改成整栏从上往下排。 */}
                <div className="career-hud__left">
                    <div className="career-hud__timeline">
                        {items.map((item, i) => (
                            <button
                                key={item.id || i}
                                type="button"
                                className={i === active ? 'on' : ''}
                                onClick={() => { tunnelRequest.z = tunnelTargetZ(i) }}
                            >
                                {item.start}
                            </button>
                        ))}
                    </div>

                    <div className="career-hud__projects">
                        <div className="career-hud__projects-head">
                            <span>{COPY[language].projects}</span>
                            <b>{cur.projects.length}</b>
                        </div>
                        {/* `key` 换人时重挂：否则从 5 个项目那段切到 1 个项目那段，
                            列表会继承上一段的滚动位置（和正文区同一个坑）。 */}
                        <div className="career-hud__projects-list" key={cur.id}>
                            {cur.projects.length === 0 && (
                                <div className="career-hud__projects-empty">{COPY[language].empty}</div>
                            )}
                            {cur.projects.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className="career-hud__proj"
                                    onClick={() => setOpenProject(p)}
                                >
                                    <ProjectThumb project={p} />
                                    <span className="career-hud__proj-meta">
                                        <span className="career-hud__proj-name">{p.name}</span>
                                        <span className="career-hud__proj-sub">
                                            {projectSub(p, COPY[language].now)}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="career-hud__info">
                    <div className="career-hud__date">{cur.range}</div>
                    <div className="career-hud__title">{cur.title}</div>
                    <div className="career-hud__sub">{cur.subtitle}</div>
                    {/* 工作内容可滚（长履历原来被硬切）。`key` 换人时重挂一次，
                        否则从第 3 张切到第 5 张会**继承上一张的滚动位置**。
                        滚动条是**自己画的**（见 CareerHud.scss 的说明：Chromium 的
                        `::-webkit-scrollbar` 在这台机器上退化成 overlay，不滚就不显形）。 */}
                    <div className="career-hud__desc-box">
                        <div
                            className="career-hud__desc"
                            key={cur.id}
                            ref={descRef}
                            onScroll={syncThumb}
                        >
                            {cur.summary}
                        </div>
                        <div className="career-hud__scroll" ref={trackRef} aria-hidden="true">
                            <div
                                className="career-hud__thumb"
                                ref={thumbRef}
                                onPointerDown={onThumbDown}
                            />
                        </div>
                    </div>
                </div>

                <div className={`career-hud__hint${armed ? ' is-armed' : ''}`}>
                    {armed ? COPY[language].armed : COPY[language].hint}
                </div>
                <div className="career-hud__bar" style={{ width: `${progress * 100}%` }} />
            </div>

            {/* 🔴 弹窗必须**放在 `.career-hud` 外面**：那个 div 有 z-index: 900，
                会建一个层叠上下文 —— 放在里面的话 z-index 1500 只在 900 里面
                生效，反而被右上角那排控件（1000/1001）压住。 */}
            {openProject && (
                <CareerProjectModal key={openProject.id} project={openProject} onClose={closeProject} />
            )}
        </>
    )
}

export default CareerHud
