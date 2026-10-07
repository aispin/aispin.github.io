/**
 * /me 的入口。
 *
 * 纯 DOM，不引 React —— 这个页面是静态内容页，没有状态要管到值得上框架，
 * 而它的姊妹页（3D 主站）已经把 React/three 的重量吃满了。两个 entry 分开
 * 打包，/me 的 bundle 只有几 KB。
 *
 * 内容全部由 meData.buildMeModel() 从 src/data/*.json 装配，这里只做三件事：
 *   1. 把 model 填进 DOM；
 *   2. 接线（主题、语言、倾斜、滚动进场、导航）；
 *   3. 挂背景流体与播放器。
 */
import './me.css'
import { buildMeModel } from './meData.js'
import { mountFluidBackground } from './fluidBg.js'
import { mountPlayer, fillThemeOptions } from './player.js'

/* 与主站共用的 localStorage 键，配色/语言跨页面接着走 */
const THEME_KEY = 'aispin-theme'
const LANG_KEY = 'aispin-language'

const root = document.documentElement

function readTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readLang() {
  return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh'
}

let lang = readLang()

/* ------------------------------------------------------------------ 图标 */

const ICONS = {
  code: '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16"/>',
  spark: '<path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z"/><circle cx="19" cy="5" r="1"/>',
  wave: '<path d="M3 12h3l2-5 3 10 2-7 2 4h6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/>',
  github: '<path d="M12 3a9 9 0 0 0-2.8 17.5c.5.1.7-.2.7-.5v-2c-2.5.5-3-1.2-3-1.2-.4-1-1-1.3-1-1.3-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.3-2-.2-4.1-1-4.1-4.5 0-1 .3-1.8.9-2.4-.1-.2-.4-1.1 0-2.3 0 0 .8-.3 2.5.9.7-.2 1.5-.3 2.3-.3s1.6.1 2.3.3c1.7-1.2 2.5-.9 2.5-.9.4 1.2.1 2.1 0 2.3.6.6.9 1.4.9 2.4 0 3.5-2.1 4.3-4.1 4.5.3.3.6.8.6 1.6v2.4c0 .3.2.6.7.5A9 9 0 0 0 12 3z"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  house: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
}

const svg = (paths, size = 20, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`

/* -------------------------------------------------- 作品卡的程序化配图 */
/* 三张图都是纯 SVG 画出来的，没有位图素材 —— 和主站同一条约定。 */

function workVisual(kind) {
  if (kind === 'orbit') {
    return `<svg viewBox="0 0 600 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="orbit">
      <defs><linearGradient id="wv-orbit" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--brand)" stop-opacity=".14"/>
        <stop offset="1" stop-color="var(--accent)" stop-opacity=".08"/>
      </linearGradient></defs>
      <rect width="600" height="340" fill="url(#wv-orbit)"/>
      <circle cx="300" cy="170" r="92" fill="none" stroke="var(--brand)" stroke-width="2" opacity=".5"/>
      <circle cx="300" cy="170" r="70" fill="none" stroke="var(--brand)" stroke-width="1" opacity=".3"/>
      <circle cx="300" cy="170" r="48" fill="none" stroke="var(--accent)" stroke-width="1" opacity=".28"/>
      <path d="M300 108 A62 62 0 0 1 357 190" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="357" cy="190" r="5" fill="var(--accent)"/>
      <rect x="276" y="158" width="48" height="26" rx="7" fill="var(--n-0)" opacity=".9"/>
      <rect x="287" y="167" width="26" height="3" rx="1.5" fill="var(--n-400)"/>
      <rect x="287" y="174" width="16" height="3" rx="1.5" fill="var(--n-300)"/>
    </svg>`
  }
  if (kind === 'chart') {
    return `<svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chart">
      <rect width="300" height="220" fill="var(--brand-bg)"/>
      <g stroke="var(--brand)" stroke-width="1.6" fill="none" stroke-linecap="round">
        <path d="M40 170 L80 130 L120 150 L160 90 L200 110 L240 60 L260 70"/>
      </g>
      <g fill="var(--brand)">
        <circle cx="80" cy="130" r="4"/><circle cx="160" cy="90" r="4"/><circle cx="240" cy="60" r="4"/>
      </g>
      <rect x="40" y="40" width="60" height="8" rx="4" fill="var(--brand)" opacity=".5"/>
      <rect x="40" y="54" width="40" height="8" rx="4" fill="var(--brand)" opacity=".25"/>
    </svg>`
  }
  // rings
  return `<svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="rings">
    <rect width="300" height="220" fill="var(--accent-bg)"/>
    <circle cx="150" cy="110" r="58" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <circle cx="150" cy="110" r="36" fill="none" stroke="var(--brand)" stroke-width="2.5"/>
    <circle cx="150" cy="110" r="14" fill="var(--brand)"/>
    <path d="M150 52 L150 40" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M150 180 L150 192" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M92 110 L80 110" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M220 110 L208 110" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`
}

/* ------------------------------------------------------------------ 渲染 */

const $ = (id) => document.getElementById(id)

function renderNav(model) {
  $('nav-brand-text').textContent = model.brand
  $('nav-links').innerHTML = model.nav
    .map((n) => `<a href="#${n.id}">${n.label}</a>`)
    .join('')
  $('lang-toggle').textContent = model.lang === 'zh' ? 'EN' : '中'
  $('lang-toggle').setAttribute('aria-label', model.lang === 'zh' ? 'Switch to English' : '切换到中文')
}

function renderHero(model) {
  const [first, ...rest] = [...model.brand]
  $('hero-name').innerHTML = `${first}<em>${rest.join('')}</em>`
  $('hero-badge-text').textContent = model.badge
  $('hero-roles').innerHTML = model.roles.items
    .map((r) => `<span>${r.title}</span>`)
    .join('<span class="sep">·</span>')
  $('hero-tagline').textContent = model.tagline
  $('hero-actions').innerHTML = `
    <a class="btn btn-pri" href="#works">${model.lang === 'zh' ? '查看作品' : 'See the work'}${svg(ICONS.arrow, 15)}</a>
    <a class="btn btn-sec" href="/">${svg(ICONS.house, 14)}${model.lang === 'zh' ? '走进 3D 房子' : 'Walk the 3D house'}</a>`
}

function renderRoles(model) {
  $('roles-eyebrow').textContent = model.roles.eyebrow
  $('roles-title').textContent = model.roles.title
  $('roles-desc').textContent = model.roles.desc
  $('role-grid').innerHTML = model.roles.items
    .map((r) => `
      <article class="role-card" data-tilt>
        <div class="role-icon">${svg(ICONS[r.icon] || ICONS.code, 22)}</div>
        <h3>${r.title}</h3>
        <p>${r.desc}</p>
        <div class="role-tags">${r.tags.map((t) => `<span class="role-tag">${t}</span>`).join('')}</div>
      </article>`)
    .join('')
}

function renderWorks(model) {
  $('works-eyebrow').textContent = model.works.eyebrow
  $('works-title').textContent = model.works.title
  $('works-desc').textContent = model.works.desc
  $('works-grid').innerHTML = model.works.items
    .map((w) => `
      <a class="work work--${w.span}" href="${w.url}" target="_blank" rel="noopener noreferrer">
        <div class="work-visual">${workVisual(w.visual)}</div>
        <div class="work-meta">
          <span class="work-type">${w.kind}</span>
          <h3>${w.title}</h3>
          <p>${w.description}${model.lang === 'zh' ? '。' : '.'}</p>
          <div class="work-foot">
            ${w.opensource ? `<span class="work-badge">${model.lang === 'zh' ? '开源' : 'Open source'}</span>` : ''}
            <span>${w.role}</span>
            <span>${w.period}</span>
          </div>
        </div>
      </a>`)
    .join('')
}

function renderMusic(model) {
  $('music-eyebrow').textContent = model.music.eyebrow
  $('music-title').textContent = model.music.title
  $('music-desc').textContent = model.music.desc
  $('player-title').textContent = model.music.proceduralTitle
  $('player-meta').textContent = model.music.proceduralMeta
  $('track-list-head').textContent = model.music.listTitle
  $('track-list').innerHTML = model.tracks
    .map((t, i) => `
      <a class="track" href="${t.url}" target="_blank" rel="noopener noreferrer">
        <span class="track-idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="track-name">${t.title}</span>
        <span class="track-album">${t.album} · ${t.platform}</span>
        <span class="track-date">${t.date}</span>
      </a>`)
    .join('')
  fillThemeOptions($('theme-select'), model.lang)
}

function renderContact(model) {
  $('contact-eyebrow').textContent = model.contact.eyebrow
  $('contact-title').textContent = model.contact.title
  $('contact-desc').textContent = model.contact.desc
  $('foot-links').innerHTML = model.links
    .map((l) => `<a class="foot-link" href="${l.href}" target="_blank" rel="noopener noreferrer">${svg(ICONS[l.icon], 14)}${l.label}</a>`)
    .join('')
  $('stats').innerHTML = model.stats
    .map((s) => `<div class="stat"><b>${s.value}</b><span>${s.label}</span></div>`)
    .join('')
  $('foot-copy').textContent = `© ${new Date().getFullYear()} ${model.brand} · ${model.footerNote}`
}

/* --------------------------------------------------------------- 交互层 */

/** 卡片 3D 倾斜 + 光斑跟随（只对有指针设备的元素生效）。 */
function attachTilt(scope) {
  scope.querySelectorAll('[data-tilt]').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      card.style.setProperty('--rx', `${(x / r.width) * 100}%`)
      card.style.setProperty('--ry', `${(y / r.height) * 100}%`)
      const rx = (y / r.height - 0.5) * -8
      const ry = (x / r.width - 0.5) * 8
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`
    })
    card.addEventListener('pointerleave', () => { card.style.transform = '' })
  })
}

/** Hero 名字视差。 */
function attachNameParallax() {
  const name = $('hero-name')
  if (!name) return
  let raf = 0
  window.addEventListener('pointermove', (e) => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      name.style.setProperty('--mx', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3))
      name.style.setProperty('--my', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3))
    })
  }, { passive: true })
}

/** 滚动进场。语言切换会重排 DOM，所以每次 render 后重新挂一次。 */
function attachReveal() {
  if (!('IntersectionObserver' in window)) return
  const targets = document.querySelectorAll('.role-card, .work, .player, .track, .section-head, .stats')
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.style.opacity = '1'
      e.target.style.transform = 'translateY(0)'
      io.unobserve(e.target)
    })
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })

  targets.forEach((el) => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(24px)'
    el.style.transition = 'opacity .7s cubic-bezier(.2,.7,.3,1), transform .7s cubic-bezier(.2,.7,.3,1)'
    io.observe(el)
  })
}

/* ------------------------------------------------------------------ 启动 */

function applyTheme(theme) {
  root.dataset.theme = theme
  localStorage.setItem(THEME_KEY, theme)
  window.dispatchEvent(new CustomEvent('themechange'))
}

function render() {
  const model = buildMeModel(lang)
  renderNav(model)
  renderHero(model)
  renderRoles(model)
  renderWorks(model)
  renderMusic(model)
  renderContact(model)
  document.title = `${model.brand} — ${model.roles.items.map((r) => r.title).join(' · ')}`
  root.lang = lang === 'zh' ? 'zh-CN' : 'en'
  attachTilt(document)
  attachReveal()
}

function boot() {
  root.dataset.theme = readTheme()

  const fluid = mountFluidBackground($('gl'))
  const player = mountPlayer({
    canvas: $('wave'),
    wrap: $('wave-wrap'),
    button: $('play-btn'),
    elapsedEl: $('elapsed'),
    themeSelect: $('theme-select'),
  })

  $('theme-toggle').addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
  })

  $('lang-toggle').addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh'
    localStorage.setItem(LANG_KEY, lang)
    render()
  })

  render()
  attachNameParallax()

  // 热更新 / 离开页面时释放 rAF、AudioContext 与 GL context
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      fluid.dispose()
      player.dispose()
    })
  }
}

boot()
