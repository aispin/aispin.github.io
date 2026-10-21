import { useEffect, useRef, useState } from 'react'
import { useSitePreferences } from '../../context/SitePreferences'
import { UI } from '../../config/theme'
import { setTunnelLocked } from '../../state/careerTunnel'
import {
    isPortraitImage,
    linkLabel,
    projectPeriod,
    shotCandidates,
    shotUrl,
} from '../../utils/projectLink'
import './CareerProjectModal.scss'

/**
 * 项目详情（全屏）。
 *
 * 从 `public/demos/web3d/career/index.html` 搬过来的：那边是命令式 DOM 拼的，
 * 这里用 React 重写，**判据完全一致** ——
 *
 *  · 头图高度跟图片自身的宽高比走（`clamp(300, cw * natH / natW, 540)`），
 *    不设固定 2.88:1 的框。竖图（< 1.25:1）改 `contain` + 同图模糊垫底 + 520 高。
 *  · 截图扩展名不写死，`.png` → `.jpg` → `.jpeg` 依次试。
 *  · 底部链接文案按 URL 类型换（GitHub / 文档 / 在线 Demo）。
 *
 * 🔴 打开期间必须 `setTunnelLocked(true)`：隧道的 wheel / touch / keydown 都挂在
 *    window 上，不锁的话在弹窗里滚一下，后面的时空隧道跟着滑（demo 那个 bug）。
 */

const COPY = {
    zh: {
        now: '至今',
        empty: '项目截图待补',
        openSource: '开源项目',
        sections: {
            description: '背景',
            tasks: '任务',
            challenges: '挑战',
            actions: '行动',
            results: '结果',
        },
        close: '关闭',
    },
    en: {
        now: 'Present',
        empty: 'Screenshot coming soon',
        openSource: 'Open source',
        sections: {
            description: 'Background',
            tasks: 'Tasks',
            challenges: 'Challenges',
            actions: 'Actions',
            results: 'Results',
        },
        close: 'Close',
    },
}

/** 竖图缩略图用 contain（留完整形状），横图 cover。
 *  ⚠️ 调用方必须 `key={project.id}`：换项目要整个重挂，这里不写"重置"的 effect
 *  —— 那种 effect 就是 lint 里的 `set-state-in-effect`，而且多一轮渲染。 */
export const ProjectThumb = ({ project }) => {
    const [src, setSrc] = useState(() => shotUrl(project?.image, project?.id))
    const [idx, setIdx] = useState(0)
    const [portrait, setPortrait] = useState(false)
    const [ok, setOk] = useState(false)

    return (
        <span className={`career-hud__proj-thumb${portrait ? ' is-fit' : ''}`}>
            {!ok && <span className="career-hud__proj-thumb-ph">截图</span>}
            {src && (
                <img
                    src={src}
                    alt=""
                    decoding="async"
                    /* 🔴 不要 `loading="lazy"`：这张图在加载完之前是
                       `opacity: 0` 的，而 lazy 只对**将要进入视口**的图生效 ——
                       藏在透明里的图在 Chrome 里会一直不加载，缩略图就永远停在
                       占位文字上（实测踩过）。这里最多 5 张、每张 < 60KB，直接加载。
                       用 opacity 而不是 display:none 也是同一个原因：不占位的
                       元素 lazy 同样不触发。 */
                    style={ok ? undefined : { opacity: 0 }}
                    onLoad={(e) => {
                        setPortrait(isPortraitImage(e.currentTarget))
                        setOk(true)
                    }}
                    onError={() => {
                        const list = shotCandidates(shotUrl(project?.image, project?.id))
                        const next = idx + 1
                        if (next < list.length) {
                            setIdx(next)
                            setSrc(list[next])
                        }
                    }}
                />
            )}
        </span>
    )
}

const CareerProjectModal = ({ project, onClose }) => {
    const { language } = useSitePreferences()
    const copy = COPY[language] ?? COPY.zh

    const cardRef = useRef(null)
    const heroRef = useRef(null)

    /* 初值直接从 props 取 —— 换项目由调用方的 `key` 重挂，不需要"重置"的 effect。 */
    const [idx, setIdx] = useState(0)
    const [src, setSrc] = useState(() => shotUrl(project?.image, project?.id))
    const [nat, setNat] = useState(null)
    const [portrait, setPortrait] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [cw, setCw] = useState(980)

    /* 弹窗开着：锁隧道 + Esc 关闭。
       🔴 用**捕获**阶段并 stopPropagation：走廊那边也有一个 window 上的
       `Escape`（DoorSection，用来退出房间），不拦下来会连房间一起退掉。 */
    useEffect(() => {
        setTunnelLocked(true)
        const onKey = (e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            onClose()
        }
        window.addEventListener('keydown', onKey, true)
        return () => {
            window.removeEventListener('keydown', onKey, true)
            setTunnelLocked(false)
        }
    }, [onClose])

    /* 头图宽度跟着卡片走；窗口变了要重算（高度是按宽度算出来的）。 */
    useEffect(() => {
        const measure = () => {
            if (heroRef.current) setCw(heroRef.current.clientWidth || 980)
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [loaded])

    if (!project) return null

    const period = projectPeriod(project, copy.now)
    const sub = [project.role, project.opensource ? copy.openSource : ''].filter(Boolean).join(' · ')
    const href = project.url
    const label = href ? linkLabel(href, language) : ''

    const heroHeight = nat
        ? Math.round(Math.min(540, Math.max(300, (cw * nat.h) / nat.w)))
        : null

    const sections = ['description', 'tasks', 'challenges', 'actions', 'results']
        .map((key) => ({ key, title: copy.sections[key], body: project[key] }))
        .filter((s) => (Array.isArray(s.body) ? s.body.length : Boolean(s.body)))

    return (
        <div
            className="career-project"
            role="dialog"
            aria-modal="true"
            aria-label={project.name}
            style={{ fontFamily: UI.fontFamily }}
        >
            <div className="career-project__backdrop" onClick={onClose} />
            <div className="career-project__card" ref={cardRef}>
                <button
                    type="button"
                    className="career-project__close"
                    onClick={onClose}
                    aria-label={copy.close}
                >
                    ×
                </button>

                <div
                    className={`career-project__hero${portrait ? ' is-fit' : ''}${loaded ? '' : ' is-empty'}`}
                    ref={heroRef}
                    style={{
                        ...(heroHeight && !portrait ? { height: `${heroHeight}px` } : null),
                        ...(portrait && src ? { '--shot': `url("${src}")` } : null),
                    }}
                >
                    {!loaded && <span className="career-project__hero-ph">{copy.empty}</span>}
                    {src && (
                        <img
                            src={src}
                            alt={project.name}
                            style={loaded ? undefined : { opacity: 0 }}
                            onLoad={(e) => {
                                const img = e.currentTarget
                                setNat({ w: img.naturalWidth, h: img.naturalHeight })
                                setPortrait(isPortraitImage(img))
                                setLoaded(true)
                            }}
                            onError={() => {
                                const list = shotCandidates(shotUrl(project.image, project.id))
                                const next = idx + 1
                                if (next < list.length) {
                                    setIdx(next)
                                    setSrc(list[next])
                                }
                            }}
                        />
                    )}
                </div>

                <div className="career-project__body">
                    <div className="career-project__date">{period}</div>
                    <h2 className="career-project__title">{project.name}</h2>
                    {sub && <div className="career-project__sub">{sub}</div>}

                    {sections.map((s) => (
                        <div className="career-project__sec" key={s.key}>
                            <h4>{s.title}</h4>
                            {Array.isArray(s.body) ? (
                                <ul>
                                    {s.body.map((t, i) => <li key={i}>{t}</li>)}
                                </ul>
                            ) : (
                                <p>{s.body}</p>
                            )}
                        </div>
                    ))}

                    {href && (
                        <a
                            className="career-project__link"
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {label}
                        </a>
                    )}
                </div>
            </div>
        </div>
    )
}

export default CareerProjectModal
