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
 * 优先级 **`?season=` > 自动（当月）**。
 *
 * ⚠️ 2026-10-10：**不再读 localStorage** —— 季节改成**每次刷新重新判定**。
 *
 * 为什么砍掉存档：存档把「季节」变成了一个**粘性状态**。用户在面板里点过
 * 一次「冬」，此后无论几月打开都是冬天；验收时 `?season=` 只是**初始值**，
 * 一旦点过面板就被存档盖住，四季定妆照会拍到上一轮点过的季节。站点本来的
 * 设计意图是「**今天几月，院子就是哪一季**」（见 `config/seasons.js`），
 * 存档恰恰破坏了它 —— 所以它被整个删掉，而不是"默认值改一改"。
 *
 * ⚠️ 若将来有人想恢复存档，务必存的是**偏好**不是解析结果：选了「自动」就
 * 存 `'auto'`，将来跨月自己变；若把 `seasonIdOf()` 的结果存下来，一月打开
 * 就是"永远停在秋天"。
 */
function getInitialSeason() {
  if (typeof window === 'undefined') return SEASON_AUTO
  const forced = resolveSeason()
  if (forced.source === 'override') return forced.id
  return SEASON_AUTO
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
  // 翻 uniform）。写的是**解析后的**季节，所以选「自动」时也能看到实际值。
  //
  // 🔴 只写 dataset、**不写 localStorage**（见 `getInitialSeason` 的说明）。
  //    顺手 `removeItem` 清掉历史版本留下的 `aispin-season`：现在没人读它了，
  //    但老用户浏览器里那条存档会一直躺着，留着只会误导后来的人以为它还有用。
  useEffect(() => {
    localStorage.removeItem('aispin-season')
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
