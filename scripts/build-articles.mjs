#!/usr/bin/env node
/**
 * build-articles.mjs — 把 `content/articles/<locale>/<slug>.md` 编译成
 *
 *   1. `public/articles/index.json`        —— 只有元数据，房间与 SEO 都读它
 *   2. `public/articles/<slug>/index.html` —— zh 静态页
 *   3. `public/articles/en/<slug>/`        —— en 静态页
 *   4. `public/articles/index.html`        —— 文章落地页
 *
 * ── 为什么正文不进主包 ────────────────────────────────────────────────
 * 之前 `src/data/articles.json` 被 `import.meta.glob(..., {eager:true})` 打进
 * 主包：18 篇正文占了 `main-*.js` 的 **46.7KB gzip（全包的 49%）**。一个只想
 * 看房子的人，先下载 46KB 的 Docker 教程。现在正文只存在于静态页里，房间
 * 需要时 `fetch` 那一页、抽出 `<article class="prose">`（`src/utils/articleBody.js`）
 * —— 静态页与阅读层因此**永远不可能不一致**，因为它们就是同一份 HTML。
 *
 * ── 三条硬规则（AI 代笔的前提）────────────────────────────────────────
 * 1. **确定性**：同一份 md 必须产出逐字节相同的 HTML。没有时间戳、没有
 *    `Math.random()`；「专属视觉」的随机数一律来自 slug 的哈希（`mulberry32`）。
 *    否则每次 build 都是一堆脏 diff。
 * 2. **质量门在构建期**：缺字段、日期不是 `YYYY-MM-DD`、slug 与文件名不符、
 *    正文过短、引用了不存在的本地图片、出现 `<script>` / `on*=` —— 一律
 *    **抛错并报出文件路径**。人不会逐篇读，所以机器必须在构建时把不合格的
 *    稿子拦下来。
 * 3. **一份渲染器**：这里是唯一的 markdown 渲染点。房间不再自己解析
 *    （旧的 `MarkdownBody.jsx` 不支持有序列表与嵌套列表，AI 一开始写
 *    「第一步 / 1. 2. 3.」就会渲染错）。
 *
 * 用法：node scripts/build-articles.mjs [--quiet]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = join(ROOT, 'content/articles')
const OUT_DIR = join(ROOT, 'public/articles')

const SITE = 'https://aispin.github.io'
const LOCALES = ['zh', 'en']
const LOCALE_LABEL = { zh: '中文', en: 'EN' }

/** 摘要 / 正文长度的下限 —— 低于它的稿子不该上线 */
const MIN_DESC = 12
const MIN_BODY = 200

/* ---------------------------------------------------------------- *
 * 主题：闭集。每篇按 slug 哈希选一个，**不**让模型自己写颜色。
 * 这样 100 篇文章仍然只有 5 套配色，改版只改这 5 处。
 * ---------------------------------------------------------------- */
const THEMES = {
  paper: { bg: '#f4eee2', paper: '#fbf7ee', ink: '#241f1a', soft: '#6d6257', accent: '#b23a2c', line: 'rgba(90,74,56,.18)', dot: 'rgba(90,74,56,.10)' },
  ink: { bg: '#141110', paper: '#1b1714', ink: '#e8e0d4', soft: '#8d8073', accent: '#c9553f', line: 'rgba(200,186,168,.16)', dot: 'rgba(200,186,168,.09)' },
  neon: { bg: '#07080f', paper: '#0d0f18', ink: '#e6f0ff', soft: '#7f8aa3', accent: '#5ee7ff', line: 'rgba(94,231,255,.20)', dot: 'rgba(94,231,255,.10)' },
  blueprint: { bg: '#0a1626', paper: '#0e1d31', ink: '#dbe8f7', soft: '#7d94b0', accent: '#63b3ff', line: 'rgba(99,179,255,.22)', dot: 'rgba(99,179,255,.12)' },
  ember: { bg: '#171009', paper: '#1f150c', ink: '#f2e3cd', soft: '#a08a6c', accent: '#e08a3c', line: 'rgba(224,138,60,.22)', dot: 'rgba(224,138,60,.11)' },
}
const THEME_IDS = Object.keys(THEMES)

/* ---------------------------------------------------------------- *
 * 确定性随机
 * ---------------------------------------------------------------- */
function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------------------- *
 * frontmatter（只支持本仓用到的子集：标量、行内数组、双引号字符串）
 * 不引 js-yaml：多一个依赖只为一个 9 行的解析器不划算。
 * ---------------------------------------------------------------- */
function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) throw new Error(`${file}: 缺 frontmatter（文件必须以 --- 开头）`)
  const meta = {}
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf(':')
    if (at < 0) throw new Error(`${file}: frontmatter 行无法解析 → ${raw}`)
    const key = line.slice(0, at).trim()
    let value = line.slice(at + 1).trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
    } else if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      try { meta[key] = JSON.parse(value) } catch { meta[key] = value.slice(1, -1) }
    } else {
      meta[key] = unquote(value)
    }
  }
  return { meta, body: text.slice(m[0].length) }
}

function unquote(s) {
  const t = String(s)
  if (t.length > 1 && ((t[0] === "'" && t.at(-1) === "'") || (t[0] === '"' && t.at(-1) === '"'))) {
    return t.slice(1, -1)
  }
  return t
}

/* ---------------------------------------------------------------- *
 * 渲染
 * ---------------------------------------------------------------- */
const md = new MarkdownIt({
  html: true,        // 正文里有 <img> / 表格里的 <br/>，关掉会当场把图变成源码
  linkify: true,
  typographer: false,
})

// 外链一律新窗口 + noopener（正文里散落着几十个站外引用）
const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

/**
 * 字数：CJK 按字、拉丁按词，**代码块不算**。
 *
 * 不用 `body.length` —— 一篇 84% 是代码的教程会显示成「3,661 字」，读者点进去
 * 发现正文只有两屏。中文按字、英文按词，两边都说得通。
 */
function countUnits(text) {
  const t = text.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ')
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (t.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length
  return cjk + latin
}

/** 纯文本长度（判断"正文过短"用） */
const plainLength = (s) => s
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[#>*`_~\-|[\]()!]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim().length

/** `2023-11-02` → `2023.11.02` */
const dotDate = (iso) => iso.replace(/-/g, '.')

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * hero：一条**折带**的程序化 SVG。
 *
 * 与房间是同一个空间语言（一折一篇、沿对角线退进暗处），但静态页不需要
 * WebGL —— 折带本身就是几块平行四边形。所有抖动都来自 `seed`，
 * 同一篇永远得到同一张图（构建确定性）。
 */
function heroSvg(theme, seed, width = 1200, height = 340) {
  const rnd = mulberry32(seed)
  const c = THEMES[theme]

  /* 折带本体：14 折，每折 74 宽、210 高，基线只微微起伏（±14）。
     ⚠️ 振幅别调大：第一版用了 ±46 + 250 高 + 只有 9 折，画出来是一排
        "灰山"，不是纸。折带的辨识度来自**折痕密度**（窄而多），不是高度。 */
  const N = 14
  const STEP = 74
  const PANEL_H = 200
  const WAVE = 13
  const START_X = 372
  const BASE_Y = height * 0.34
  const phase = rnd() * Math.PI * 2
  const drift = (i) => Math.sin(i * 0.55 + phase) * WAVE

  const panels = []
  for (let i = 0; i < N; i++) {
    const x0 = START_X + i * STEP
    const y0 = BASE_Y + drift(i)
    const y1 = BASE_Y + drift(i + 1)
    const back = i % 2 === 1
    // 越往右越淡，折带像退进纸里；背面（奇折）再压一半
    const fall = 1 - i / (N + 3)
    const op = (back ? 0.13 : 0.26) * fall + 0.03

    panels.push(
      `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${(x0 + STEP).toFixed(1)} ${y1.toFixed(1)} ` +
      `L${(x0 + STEP).toFixed(1)} ${(y1 + PANEL_H).toFixed(1)} L${x0.toFixed(1)} ${(y0 + PANEL_H).toFixed(1)} Z" ` +
      `fill="${c.ink}" fill-opacity="${op.toFixed(3)}"/>`,
      // 折痕：正面亮、背面暗，是这条带子唯一"硬"的线
      `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${x0.toFixed(1)} ${(y0 + PANEL_H).toFixed(1)}" ` +
      `stroke="${back ? c.ink : c.accent}" stroke-opacity="${(back ? 0.12 : 0.42) * fall + 0.04}" stroke-width="1"/>`,
    )
  }
  // 上沿：一条连续的折线。纸的"边"全靠它 —— 没有这条线，一排半透明色块
  // 读起来还是"山"。
  const edge = []
  for (let i = 0; i <= N; i++) {
    edge.push(`${i ? 'L' : 'M'}${(START_X + i * STEP).toFixed(1)} ${(BASE_Y + drift(i)).toFixed(1)}`)
  }
  panels.push(`<path d="${edge.join(' ')}" fill="none" stroke="${c.accent}" stroke-opacity=".34" stroke-width="1.2"/>`)

  // 收尾那一折的边
  const endX = START_X + N * STEP
  const endY = BASE_Y + drift(N)
  panels.push(
    `<path d="M${endX} ${endY} L${endX} ${endY + PANEL_H}" stroke="${c.accent}" stroke-opacity=".2" stroke-width="1"/>`,
  )

  // 尘埃
  const dots = []
  for (let i = 0; i < 26; i++) {
    const x = rnd() * width
    const y = rnd() * height
    const r = 0.5 + rnd() * 1.2
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${c.accent}" fill-opacity="${(0.05 + rnd() * 0.14).toFixed(3)}"/>`)
  }

  return `<svg class="hero__art" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="glow" cx="74%" cy="34%" r="52%">
      <stop offset="0%" stop-color="${c.accent}" stop-opacity=".13"/>
      <stop offset="100%" stop-color="${c.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${c.bg}" stop-opacity="1"/>
      <stop offset="34%" stop-color="${c.bg}" stop-opacity=".72"/>
      <stop offset="62%" stop-color="${c.bg}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.bg}" stop-opacity="0"/>
      <stop offset="84%" stop-color="${c.bg}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${c.bg}" stop-opacity=".85"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${panels.join('')}
  ${dots.join('')}
  <rect width="${width}" height="${height}" fill="url(#veil)"/>
  <rect width="${width}" height="${height}" fill="url(#fade)"/>
</svg>`
}

/* ---------------------------------------------------------------- *
 * 页面模板
 * ---------------------------------------------------------------- */

/** 所有静态页共用的一段 CSS（内联，单文件，零请求） */
const BASE_CSS = `
@font-face{font-family:'MapleUI';src:url('/fonts/maple-ui.woff2') format('woff2');font-weight:400 500;font-display:swap}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:'MapleUI',ui-monospace,'PingFang SC',monospace;
  -webkit-font-smoothing:antialiased;line-height:1.8}
a{color:inherit}
.wrap{max-width:760px;margin:0 auto;padding:0 32px}

/* 顶栏：滚到哪儿都在 */
.bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;
  padding:14px 32px;font-size:10.5px;letter-spacing:.2em;
  background:color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line)}
.bar__back{text-decoration:none;color:var(--soft);display:inline-flex;align-items:center;gap:7px;
  transition:color .2s ease}
.bar__back:hover{color:var(--ink)}
.bar__sep{flex:1}
.bar__lang{display:flex;gap:2px}
.bar__lang a,.bar__lang span{text-decoration:none;padding:5px 10px;border-radius:999px;color:var(--soft)}
.bar__lang a:hover{color:var(--ink);background:color-mix(in srgb, var(--ink) 7%, transparent)}
.bar__lang [aria-current]{color:var(--ink);background:color-mix(in srgb, var(--ink) 8%, transparent)}

/* hero */
.hero{position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.hero__art{position:absolute;inset:0;width:100%;height:100%;display:block}
/* ⚠️ 只写 padding-top/bottom：.wrap 与 .hero__in 同为单类选择器，这里若用
   简写 padding 会把 .wrap 的左右内边距清零（手机标题被裁掉左边就是这个）。
   注意：这段 CSS 在 JS 模板字符串里，注释中不能出现反引号。 */
.hero__in{position:relative;z-index:2;padding-top:70px;padding-bottom:50px;min-height:clamp(240px,34vw,340px);
  display:flex;flex-direction:column;justify-content:center}
.hero__kicker{font-size:10px;letter-spacing:.34em;color:var(--accent);display:flex;align-items:center;gap:10px}
.hero__kicker i{display:block;width:26px;height:1px;background:currentColor;opacity:.6;font-style:normal}
.hero h1{margin-top:22px;font-size:clamp(28px,4.4vw,42px);line-height:1.5;font-weight:500;
  letter-spacing:.01em;max-width:22ch;text-wrap:balance}
.hero__meta{margin-top:22px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:10.5px;
  letter-spacing:.14em;color:var(--soft)}
.hero__meta b{font-weight:400;color:var(--ink)}

/* 正文 */
.prose{padding:52px 0 24px;font-size:15px;line-height:2.05;color:var(--ink)}
.prose>*+*{margin-top:18px}
.prose h2{margin-top:44px;font-size:21px;line-height:1.7;font-weight:500;letter-spacing:.01em}
.prose h3{margin-top:34px;font-size:16.5px;line-height:1.7;font-weight:500;color:var(--ink)}
.prose h4{margin-top:26px;font-size:14.5px;font-weight:500;color:var(--soft)}
.prose p{color:color-mix(in srgb, var(--ink) 88%, var(--soft))}
.prose ul,.prose ol{padding-left:1.4em}
.prose li+li{margin-top:6px}
.prose li::marker{color:var(--accent)}
.prose a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--accent) 40%, transparent)}
.prose a:hover{border-bottom-color:var(--accent)}
.prose strong{font-weight:500;color:var(--ink)}
.prose code{font-family:inherit;font-size:.92em;padding:.12em .4em;border-radius:3px;
  background:color-mix(in srgb, var(--ink) 8%, transparent)}
.prose pre{overflow:auto;padding:18px 20px;border-radius:4px;font-size:12.5px;line-height:1.85;
  background:color-mix(in srgb, var(--ink) 7%, transparent);border:1px solid var(--line)}
.prose pre code{padding:0;background:none}
.prose blockquote{padding:2px 0 2px 18px;border-left:2px solid var(--accent);color:var(--soft)}
.prose blockquote p{color:var(--soft)}
.prose img{display:block;max-width:100%;height:auto;border-radius:3px;
  border:1px solid var(--line);background:var(--paper)}
.prose hr{border:0;border-top:1px solid var(--line);margin:40px 0}
.prose table{width:100%;border-collapse:collapse;font-size:12.5px;line-height:1.7;
  display:block;overflow-x:auto;white-space:normal}
.prose th,.prose td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
.prose th{background:color-mix(in srgb, var(--ink) 6%, transparent);font-weight:500}

/* 文末 */
.foot{margin-top:56px;padding:26px 0 70px;border-top:1px solid var(--line);
  display:flex;align-items:center;justify-content:space-between;gap:18px;
  font-size:10.5px;letter-spacing:.16em}
.foot a{text-decoration:none;color:var(--soft);padding:8px 12px;border-radius:999px;
  transition:color .2s ease,background .2s ease;max-width:46%}
.foot a:hover{color:var(--ink);background:color-mix(in srgb, var(--ink) 7%, transparent)}
.foot__fin{color:var(--soft);opacity:.7}
.foot__spacer{flex:1}
@media(max-width:640px){
  .wrap{padding:0 22px}
  .bar{padding:12px 22px}
  .hero__in{padding-top:46px;padding-bottom:34px;min-height:230px}
  /* 窄屏折带会铺满整行、从标题底下穿过：压到 45%，只当纸纹用 */
  .hero__art{opacity:.45}
  .prose{font-size:14.5px;line-height:2}
  .foot a{max-width:48%}
}
`

/* ---------------------------------------------------------------- *
 * `?from=posts` 回路
 *
 * 房间（`/posts`）的阅读层右上角有个「独立页面 ↗」，它带 `?from=posts`
 * 在新标签里打开这一页。于是这页左上角的返回键要指回**房间**，而不是
 * 文章索引页 —— 否则用户从房间里点出去，就再也回不到那条经折上了。
 *
 * 为什么是内联脚本而不是构建期写死：同一份静态页要同时服务「从索引页来」
 * 和「从房间来」两种入口，地址栏是唯一的信息源。这段脚本**只读 query、
 * 只改一个 href**，不碰正文（正文的 `<script>` 禁令不受影响）。
 * ---------------------------------------------------------------- */
const FROM_ROOM_SCRIPT = `<script>
(function () {
  try {
    if (new URLSearchParams(location.search).get('from') !== 'posts') return;
    var a = document.querySelector('.bar__back');
    if (!a) return;
    a.setAttribute('href', '/posts');
    a.textContent = document.documentElement.lang === 'en' ? '\u2190 Writing' : '\u2190 文稿';
  } catch (e) { /* 老浏览器：保持指向 /articles/ */ }
})();
</script>`

const pageShell = ({ theme, lang, title, description, canonical, extraHead = '', body }) => {
  const c = THEMES[theme]
  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/fonts/maple-ui.woff2" as="font" type="font/woff2" crossorigin>
${extraHead}<style>
:root{--bg:${c.bg};--paper:${c.paper};--ink:${c.ink};--soft:${c.soft};--accent:${c.accent};--line:${c.line}}
${BASE_CSS}</style>
</head>
<body>
${body}
${FROM_ROOM_SCRIPT}
</body>
</html>
`
}

/* ---------------------------------------------------------------- *
 * 主流程
 * ---------------------------------------------------------------- */
function readArticles() {
  const out = []
  const errors = []

  for (const locale of LOCALES) {
    const dir = join(SRC_DIR, locale)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.md')) continue
      const file = join(dir, name)
      const rel = `content/articles/${locale}/${name}`
      let parsed
      try {
        parsed = parseFrontmatter(readFileSync(file, 'utf8'), rel)
      } catch (err) {
        errors.push(err.message)
        continue
      }
      const { meta, body } = parsed
      const slug = name.replace(/\.md$/, '')
      const fail = (msg) => errors.push(`${rel}: ${msg}`)

      if (!meta.title) fail('缺 title')
      if (!meta.description) fail('缺 description')
      else if (String(meta.description).length < MIN_DESC) fail(`description 太短（< ${MIN_DESC}）`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) fail(`date 必须是 YYYY-MM-DD，实际 ${JSON.stringify(meta.date)}`)
      if (meta.slug && meta.slug !== slug) fail(`slug「${meta.slug}」与文件名「${slug}」不一致`)
      if (meta.lang && meta.lang !== locale) fail(`lang「${meta.lang}」与目录「${locale}」不一致`)

      // 正文：长度 + 危险标记（正文是我们自己写的，但仍然过一道闸）
      const plain = plainLength(body)
      if (plain < MIN_BODY) fail(`正文太短（${plain} < ${MIN_BODY} 字）`)
      if (/<script\b/i.test(body)) fail('正文里出现 <script>')
      if (/\son[a-z]+\s*=/i.test(body)) fail('正文里出现内联事件处理器（on*=）')

      // 本地图片必须真的存在
      for (const m of body.matchAll(/<img[^>]+src="(\/[^"]+)"/g)) {
        const p = join(ROOT, 'public', m[1])
        if (!existsSync(p)) fail(`引用了不存在的图片 ${m[1]}`)
      }

      const seed = hash32(slug)
      out.push({
        id: `${locale}:${slug}`,
        locale,
        slug,
        title: meta.title,
        description: meta.description,
        date: meta.date,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        author: meta.author || 'ZISPIN',
        theme: THEME_IDS[seed % THEME_IDS.length],
        seed,
        words: countUnits(body),
        minutes: Math.max(1, Math.round(countUnits(body) / 400)),
        body,
      })
    }
  }

  if (errors.length) {
    const err = new Error(`文章校验失败（${errors.length} 条）：\n  ` + errors.join('\n  '))
    err.articles = errors
    throw err
  }
  return out
}

/** zh 在 `/articles/<slug>/`，en 在 `/articles/en/<slug>/` */
const urlOf = (a) => (a.locale === 'zh' ? `/articles/${a.slug}/` : `/articles/en/${a.slug}/`)

/* ---------------------------------------------------------------- *
 * sitemap.xml 的文章段
 *
 * `public/sitemap.xml` 是**手维护**的（八个房间各一条，带人写的 priority），
 * 所以这里只替换 `<!-- articles:begin -->` 与 `<!-- articles:end -->` 之间
 * 那一段，别的一行都不碰。整段内容只由 md 决定（日期就是 lastmod），
 * 同一份稿子跑多少次结果都一样 ⇒ 不会造出脏 diff。
 * ---------------------------------------------------------------- */
const SITEMAP = join(ROOT, 'public/sitemap.xml')
const SM_BEGIN = '<!-- articles:begin'
const SM_END = '<!-- articles:end -->'

function writeSitemap(all) {
  if (!existsSync(SITEMAP)) return 0

  const rows = [
    { loc: '/articles/', lastmod: all[0]?.date, changefreq: 'weekly', priority: '0.9' },
    ...all.map((a) => ({ loc: urlOf(a), lastmod: a.date, changefreq: 'yearly', priority: '0.7' })),
  ]

  const block = rows
    .map((r) => [
      '  <url>',
      `    <loc>${SITE}${r.loc}</loc>`,
      r.lastmod ? `    <lastmod>${r.lastmod}</lastmod>` : null,
      `    <changefreq>${r.changefreq}</changefreq>`,
      `    <priority>${r.priority}</priority>`,
      '  </url>',
    ].filter(Boolean).join('\n'))
    .join('\n')

  const src = readFileSync(SITEMAP, 'utf8')
  const from = src.indexOf(SM_BEGIN)
  const to = src.indexOf(SM_END)
  if (from < 0 || to < 0) return 0   // 没标记就不动 —— 宁可少几条也别毁掉整份 sitemap

  // 标记行本身保留，只换中间
  const head = src.slice(0, from)
  const openTag = src.slice(from, src.indexOf('\n', from) + 1)
  const out = `${head}${openTag}${block}\n  ${src.slice(to)}`
  if (out !== src) writeFileSync(SITEMAP, out, 'utf8')
  return rows.length
}

function build() {
  const all = readArticles()

  // 按 slug 配对，好让页面上能挂另一语言的链接
  const bySlug = new Map()
  for (const a of all) {
    if (!bySlug.has(a.slug)) bySlug.set(a.slug, {})
    bySlug.get(a.slug)[a.locale] = a
  }

  // 新→旧。同一天按 slug 排，保证顺序稳定（sort 在 V8 是稳定的，但别依赖它）
  all.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1))

  const orderOf = new Map(all.map((a, i) => [a.id, i]))

  // ── 1. 元数据 ────────────────────────────────────────────────────
  const meta = all.map((a) => ({
    id: a.id,
    locale: a.locale,
    slug: a.slug,
    title: a.title,
    description: a.description,
    publishedAt: a.date,
    tags: a.tags,
    author: { name: a.author },
    theme: a.theme,
    words: a.words,
    minutes: a.minutes,
    url: urlOf(a),
    // 只留 url：原来直接把另一语言的对象整个塞进来（含 body），
    // index.json 当场涨到 252KB —— 元数据文件不该带正文。
    pair: Object.fromEntries(
      Object.entries(bySlug.get(a.slug)).map(([loc, x]) => [loc, urlOf(x)]),
    ),
  }))
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')

  // ── 1b. sitemap 的文章段（见 writeSitemap）────────────────────────
  const sitemapRows = writeSitemap(all)

  // ── 2. 单篇静态页 ────────────────────────────────────────────────
  let pages = 0
  for (const a of all) {
    const i = orderOf.get(a.id)
    const siblings = all.filter((x) => x.locale === a.locale)
    const pos = siblings.findIndex((x) => x.id === a.id)
    const newer = siblings[pos - 1]
    const older = siblings[pos + 1]
    const pair = bySlug.get(a.slug)
    const other = pair[a.locale === 'zh' ? 'en' : 'zh']

    const t = {
      zh: { back: '← 文稿', read: '阅读', min: '分钟', words: '字', prev: '← 上一篇', next: '下一篇 →', fin: '完' },
      en: { back: '← Writing', read: 'read', min: 'min', words: 'words', prev: '← Previous', next: 'Next →', fin: 'Fin' },
    }[a.locale]

    const body = `
<header class="bar">
  <a class="bar__back" href="/articles/">${t.back}</a>
  <span class="bar__sep"></span>
  <div class="bar__lang">
    ${pair.zh ? (a.locale === 'zh'
      ? `<span aria-current="page">中文</span>`
      : `<a href="${urlOf(pair.zh)}">中文</a>`) : ''}
    ${pair.en ? (a.locale === 'en'
      ? `<span aria-current="page">EN</span>`
      : `<a href="${urlOf(pair.en)}">EN</a>`) : ''}
  </div>
</header>

<section class="hero">
  ${heroSvg(a.theme, a.seed)}
  <div class="wrap hero__in">
    <div class="hero__kicker"><i></i>${String(i + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}</div>
    <h1>${escapeHtml(a.title)}</h1>
    <div class="hero__meta">
      <span><b>${dotDate(a.date)}</b></span>
      ${a.tags.length ? `<span>${a.tags.map(escapeHtml).join(' · ')}</span>` : ''}
      <span>${a.words.toLocaleString('en-US')} ${t.words} · ${a.minutes} ${t.min}</span>
    </div>
  </div>
</section>

<main class="wrap">
  <article class="prose">${md.render(a.body)}</article>
  <nav class="foot">
    ${older ? `<a href="${urlOf(older)}">${t.prev}<br><span style="opacity:.65">${escapeHtml(older.title).slice(0, 40)}</span></a>` : '<span class="foot__spacer"></span>'}
    <span class="foot__fin">${t.fin}</span>
    ${newer ? `<a href="${urlOf(newer)}" style="text-align:right">${t.next}<br><span style="opacity:.65">${escapeHtml(newer.title).slice(0, 40)}</span></a>` : '<span class="foot__spacer"></span>'}
  </nav>
</main>
`

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: a.title,
      description: a.description,
      datePublished: a.date,
      inLanguage: a.locale === 'zh' ? 'zh-CN' : 'en',
      url: SITE + urlOf(a),
      mainEntityOfPage: SITE + urlOf(a),
      author: { '@type': 'Person', name: a.author, url: SITE },
      keywords: a.tags.join(', '),
    }

    const html = pageShell({
      theme: a.theme,
      lang: a.locale,
      title: `${a.title} — AISPIN`,
      description: a.description,
      canonical: SITE + urlOf(a),
      extraHead: `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n`,
      body,
    })

    const dir = join(OUT_DIR, a.locale === 'zh' ? a.slug : join('en', a.slug))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), html, 'utf8')
    pages++
  }

  // ── 3. 落地页 ────────────────────────────────────────────────────
  const rows = (locale) => all
    .filter((a) => a.locale === locale)
    .map((a, i) => `
    <li class="row">
      <a href="${urlOf(a)}">
        <span class="row__n">${String(i + 1).padStart(2, '0')}</span>
        <span class="row__t">${escapeHtml(a.title)}</span>
        <span class="row__d">${dotDate(a.date)}</span>
      </a>
    </li>`).join('')

  const zhCount = all.filter((a) => a.locale === 'zh').length
  const enCount = all.filter((a) => a.locale === 'en').length

  const landing = pageShell({
    theme: 'paper',
    lang: 'zh',
    title: '文稿 · Writing — AISPIN',
    description: `AISPIN 的文稿：${zhCount} 篇中文、${enCount} 篇英文，关于工程实践、研发管理与产品思维。一折一篇，点开即读。`,
    canonical: SITE + '/articles/',
    body: `
<header class="bar">
  <a class="bar__back" href="/">← AISPIN</a>
  <span class="bar__sep"></span>
  <div class="bar__lang"><span aria-current="page">中文</span><a href="#en">EN</a></div>
</header>

<section class="hero" style="--h:300px">
  ${heroSvg('paper', 20261106, 1200, 340)}
  <div class="wrap hero__in">
    <div class="hero__kicker"><i></i>WRITING · POSTS</div>
    <h1>文稿</h1>
    <div class="hero__meta"><span><b>${zhCount + enCount}</b> 篇</span><span>中文 ${zhCount} · EN ${enCount}</span></div>
  </div>
</section>

<main class="wrap">
  <ul class="list" id="zh">${rows('zh')}</ul>
  <h2 class="list__h" id="en">English</h2>
  <ul class="list">${rows('en')}</ul>
  <nav class="foot"><a href="/posts">走进房间读 ↗</a><span class="foot__fin">经折</span><span class="foot__spacer"></span></nav>
</main>
`,
  })

  // 落地页要多一段列表样式
  const landingCss = `
.list{list-style:none;padding:26px 0 8px}
.list__h{margin-top:44px;font-size:11px;letter-spacing:.3em;color:var(--accent);font-weight:400}
.row a{display:grid;grid-template-columns:44px 1fr auto;gap:16px;align-items:baseline;
  padding:14px 12px;text-decoration:none;border-bottom:1px solid var(--line);
  transition:background .18s ease}
.row a:hover{background:color-mix(in srgb, var(--ink) 5%, transparent)}
.row__n{font-size:10px;letter-spacing:.14em;color:var(--soft);font-variant-numeric:tabular-nums}
.row__t{font-size:15px;line-height:1.7}
.row__d{font-size:10.5px;letter-spacing:.1em;color:var(--soft);white-space:nowrap}
@media(max-width:640px){.row a{grid-template-columns:30px 1fr;gap:4px 12px}.row__d{grid-column:2;font-size:10px}}
`
  writeFileSync(
    join(OUT_DIR, 'index.html'),
    landing.replace('</style>', landingCss + '</style>'),
    'utf8',
  )

  if (!process.argv.includes('--quiet')) {
    console.log(`📄 文章 ${all.length} 篇（zh ${zhCount} / en ${enCount}）→ ${pages} 个静态页 + index.json + 落地页` +
      (sitemapRows ? ` + sitemap ${sitemapRows} 条` : ''))
  }
  return { count: all.length, pages, sitemapRows }
}

export { build as buildArticles, THEMES, THEME_IDS }

// 直接跑（node scripts/build-articles.mjs）时执行；被 vite 插件 import 时不跑
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    build()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
