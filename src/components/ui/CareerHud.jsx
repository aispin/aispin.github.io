import { useMemo, useSyncExternalStore } from 'react'
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
import './CareerHud.scss'

/**
 * 时空隧道的 HUD（DOM 层）。
 *
 * 卡片在 WebGL 里、文字在 DOM 里 —— 3D 里的文字要么糊、要么得走 SDF。
 * demo 也是这么分的：canvas 只画背景与卡面文字，时间刻度/详情面板是 HTML。
 *
 * ⚠️ 外层 `pointer-events: none`，只有可点的元素自己打开 —— 否则这层会盖住
 *    右下角的导航/返回按钮。
 */
const COPY = {
    zh: { kicker: '滚动穿梭', hint: '滚动穿梭时间隧道', now: '至今' },
    en: { kicker: 'Scroll to travel', hint: 'Scroll to travel through time', now: 'Present' },
}

const CareerHud = () => {
    const { currentRoom } = useScene()
    const { language } = useSitePreferences()
    useSyncExternalStore(subscribeTunnel, getTunnelVersion, getTunnelVersion)
    const { active, progress } = getTunnelState()

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
            }
        })
    }, [language])

    if (currentRoom !== 'career' || items.length === 0) return null

    const cur = items[Math.min(active, items.length - 1)]

    return (
        <div className="career-hud" style={{ fontFamily: UI.fontFamily }}>
            <div className="career-hud__brand">
                <span className="career-hud__mark">履</span>
                <span>
                    {language === 'zh' ? '履历' : 'Career'}
                    <small>{COPY[language].kicker}</small>
                </span>
            </div>

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

            <div className="career-hud__info">
                <div className="career-hud__date">{cur.range}</div>
                <div className="career-hud__title">{cur.title}</div>
                <div className="career-hud__sub">{cur.subtitle}</div>
                <div className="career-hud__desc">{cur.summary}</div>
            </div>

            <div className="career-hud__hint">{COPY[language].hint}</div>
            <div className="career-hud__bar" style={{ width: `${progress * 100}%` }} />
        </div>
    )
}

export default CareerHud
