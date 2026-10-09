import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { SEASON_AUTO, isSeasonId, resolveSeason, seasonIdOf } from '../config/seasons'

const PreferencesContext = createContext(null)

function getInitialLanguage() {
  if (typeof window === 'undefined') return 'zh'
  const saved = localStorage.getItem('aispin-language')
  return saved === 'en' ? 'en' : 'zh'
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem('aispin-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 季节**偏好**：`'auto'`（按月份，默认）或一个季节 id。
 *
 * 优先级 **`?season=` > localStorage > 自动**。
 *
 * 调试参数排在存档前面，是因为 `?season=冬` 是"把这一页摆成冬天"的一次性
 * 命令，而存档是长期偏好 —— 命令必须能盖住它，否则四季定妆照会拍到上一轮
 * 在面板里点过的季节（`harness/shots-seasons.mjs` 正是靠这个）。
 *
 * ⚠️ 存的是**偏好**不是解析结果：选了「自动」就存 `'auto'`，将来跨月自己变。
 * 若把 `seasonIdOf()` 的结果存下来，一月打开就是"永远停在秋天"。
 */
function getInitialSeason() {
  if (typeof window === 'undefined') return SEASON_AUTO
  const forced = resolveSeason()
  if (forced.source === 'override') return forced.id
  const saved = localStorage.getItem('aispin-season')
  return saved === SEASON_AUTO || isSeasonId(saved) ? saved : SEASON_AUTO
}

export function SitePreferencesProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage)
  const [theme, setThemeState] = useState(getInitialTheme)
  const [season, setSeasonState] = useState(getInitialSeason)

  const setLanguage = (next) => setLanguageState(next === 'en' ? 'en' : 'zh')
  const toggleLanguage = () => setLanguageState(value => value === 'zh' ? 'en' : 'zh')
  const setTheme = (next) => setThemeState(next === 'dark' ? 'dark' : 'light')
  const toggleTheme = () => setThemeState(value => value === 'dark' ? 'light' : 'dark')
  const setSeason = (next) => setSeasonState(next === SEASON_AUTO || isSeasonId(next) ? next : SEASON_AUTO)

  useEffect(() => {
    localStorage.setItem('aispin-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    window.dispatchEvent(new CustomEvent('aispin-language-change', { detail: language }))
  }, [language])

  useEffect(() => {
    localStorage.setItem('aispin-theme', theme)
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'dark' ? '#211D1A' : '#FFF6E9'
  }, [theme])

  // 季节写在 <html data-season> 上，理由与 data-theme 完全相同：让"当前是哪
  // 一季"在 DOM 上可观测（样式表可用，无头验收也能一句话断言，不必去场景里
  // 翻 uniform）。写的是**解析后**的季节，所以选「自动」时也能看到实际值。
  useEffect(() => {
    localStorage.setItem('aispin-season', season)
    document.documentElement.dataset.season = season === SEASON_AUTO ? seasonIdOf() : season
  }, [season])

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, theme, setTheme, toggleTheme, season, setSeason }),
    [language, theme, season]
  )
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function useSitePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('useSitePreferences must be used inside SitePreferencesProvider')
  return value
}
