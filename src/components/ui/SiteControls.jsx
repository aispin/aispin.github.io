import { useCallback, useEffect, useState } from 'react'
import { useSitePreferences } from '../../context/SitePreferences'
import { useAudio } from '../../context/AudioManager'
import '../../styles/SiteControls.scss'

/**
 * SiteControls — the single control column in the top-right corner.
 *
 * Five buttons, top to bottom, dropping in one after another once the page has
 * loaded: map, language, colour theme, audio settings, achievements.
 *
 * Everything lives here so the corner is ONE column with ONE button style.
 * Before this, map/language/theme were here while audio/achievements sat in
 * NavigationUI behind `hasEntered` — a second cluster in the same corner, in a
 * different (torn-paper) style, that only showed up after entering the house.
 *
 * The panels those last two buttons open are still owned by NavigationUI: the
 * audio card is part of its layout and <AchievementsPanel /> is its child. The
 * button and the panel talk over window events, which is the pattern already
 * used for the map — SiteControls asks with `hudToggle`, NavigationUI answers
 * with `hudState` so the button can show its pressed state.
 */

/** Panel ids, in the order they appear as buttons. */
const PANEL_IDS = ['map', 'audio', 'achievements']

export default function SiteControls() {
  const { language, toggleLanguage, theme, toggleTheme } = useSitePreferences()
  const { isMuted } = useAudio()
  const [updateReady, setUpdateReady] = useState(null)
  const [openPanel, setOpenPanel] = useState(null)

  // PWA 更新感知：main.jsx 在新 SW 安装完成后派发 'sw-update-ready'
  useEffect(() => {
    const onUpdate = (event) => setUpdateReady(event.detail)
    window.addEventListener('sw-update-ready', onUpdate)
    return () => window.removeEventListener('sw-update-ready', onUpdate)
  }, [])

  // Mirror whichever panel is open so the matching button can style itself
  useEffect(() => {
    const onState = (event) => setOpenPanel(event.detail || null)
    window.addEventListener('hudState', onState)
    return () => window.removeEventListener('hudState', onState)
  }, [])

  const applyUpdate = () => {
    if (!updateReady?.waiting) {
      window.location.reload()
      return
    }
    // 通知新 SW 立即接管，接管完成后刷新页面
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    }, { once: true })
    updateReady.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  const togglePanel = useCallback(
    (id) => window.dispatchEvent(new CustomEvent('hudToggle', { detail: id })),
    []
  )

  // Staggered drop-in: each button starts a little after the one above it, so
  // the column pulls down out of the top edge instead of appearing all at once.
  const dropDelay = (index) => ({ animationDelay: `${index * 70}ms` })

  const zh = language === 'zh'

  return (
    <>
      {updateReady && (
        <div className="site-controls__update-wrap">
          <button
            type="button"
            className="hud-btn site-controls__update"
            style={dropDelay(0)}
            onClick={applyUpdate}
            aria-label={zh ? '发现新版本，点击刷新' : 'New version available, click to refresh'}
          >
            {zh ? '↻ 新版本' : '↻ Update'}
          </button>
        </div>
      )}
      <div
        className="hud-cluster hud-cluster--right site-controls"
        aria-label={zh ? '站点设置' : 'Site preferences'}
      >
        {/* 1 · Map */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'map' ? 'is-open' : ''}`}
          style={dropDelay(0)}
          onClick={() => togglePanel('map')}
          aria-label={zh ? '打开地图菜单' : 'Open map menu'}
          aria-expanded={openPanel === 'map'}
        >
          <span className="site-controls__burger" aria-hidden="true">
            <span /><span /><span />
          </span>
        </button>

        {/* 2 · Language */}
        <button
          type="button"
          className="hud-btn hud-btn--text"
          style={dropDelay(1)}
          onClick={toggleLanguage}
          aria-label={zh ? 'Switch to English' : '切换到中文'}
        >
          {zh ? 'EN' : '中文'}
        </button>

        {/* 3 · Colour theme */}
        <button
          type="button"
          className="hud-btn"
          style={dropDelay(2)}
          onClick={toggleTheme}
          aria-label={zh ? '切换明暗模式' : 'Toggle color theme'}
        >
          {theme === 'dark' ? '☼' : '☾'}
        </button>

        {/* 4 · Audio settings */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'audio' ? 'is-open' : ''}`}
          style={dropDelay(3)}
          onClick={() => togglePanel('audio')}
          aria-label={zh ? '音频设置' : 'Audio settings'}
          aria-expanded={openPanel === 'audio'}
        >
          {isMuted ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M15 9a5 5 0 0 1 0 6" />
              <path d="M18 5a9 9 0 0 1 0 14" />
            </svg>
          )}
        </button>

        {/* 5 · Achievements */}
        <button
          type="button"
          className={`hud-btn ${openPanel === 'achievements' ? 'is-open' : ''}`}
          style={dropDelay(4)}
          onClick={() => togglePanel('achievements')}
          aria-label={zh ? '成就' : 'Achievements'}
          aria-expanded={openPanel === 'achievements'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 21h8M12 17v4M7 4h10M5 4h14v5a7 7 0 0 1-7 7 7 7 0 0 1-7-7z" />
            <path d="M5 9H3V6h2" />
            <path d="M19 9h2V6h-2" />
          </svg>
        </button>
      </div>
    </>
  )
}
