import { createContext, useContext, useEffect, useMemo, useState } from 'react'

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

export function SitePreferencesProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage)
  const [theme, setThemeState] = useState(getInitialTheme)

  const setLanguage = (next) => setLanguageState(next === 'en' ? 'en' : 'zh')
  const toggleLanguage = () => setLanguageState(value => value === 'zh' ? 'en' : 'zh')
  const toggleTheme = () => setThemeState(value => value === 'dark' ? 'light' : 'dark')

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

  const value = useMemo(() => ({ language, setLanguage, toggleLanguage, theme, toggleTheme }), [language, theme])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function useSitePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('useSitePreferences must be used inside SitePreferencesProvider')
  return value
}
