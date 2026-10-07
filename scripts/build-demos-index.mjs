#!/usr/bin/env node
/**
 * 扫描 public/demos/，生成 demos 索引。
 *
 * 产出（都在 demos 根目录，均标注「自动生成，别手改」）：
 *   public/demos/demos.json    结构化数据
 *   public/demos/index.html    可浏览的列表页
 *
 * 顺带**补 README**：某个 demo 目录没有 README.md 时，用从 index.html 抓到的
 * 标题/描述自动生成一份，省得每次丢完原型还要手写。
 *
 * 什么算一个 demo
 * ---------------
 * 遍历 public/demos/ 下**深度 ≥1** 的每个目录，收集该目录**直接**含有的 .html：
 *   - 一个都没有 → 跳过（它的子目录会被单独扫到）
 *   - 有 index.html → 用 index.html 当入口，其余 .html 记为 variants
 *   - 没有 index.html → 用字典序第一个当入口，其余记为 variants
 * 另外，直接躺在 public/demos/ 下的单个 .html（如 door.html）也算一个单文件 demo。
 *
 * 用法:
 *   node scripts/build-demos-index.mjs        # 手动跑
 *   vite build / vite dev                     # 由 vite.config.js 的 buildStart 调
 *
 * ⚠️ 生成物写进 public/，dev 下 Vite 会立刻把它当静态资源供出去，所以改完
 * 原型不用重启 dev server，刷一下就有。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEMOS_DIR = join(ROOT, 'public', 'demos')
const SKIP_DIRS = new Set(['node_modules', '.git'])

/* ---------------------------------------------------------------- 扫描 */

function walkDirs(base) {
  /** 返回 base 下所有深度 >=1 的目录（相对 base 的路径） */
  const out = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()
    const abs = join(base, rel)
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
      const child = rel ? `${rel}/${e.name}` : e.name
      out.push(child)
      stack.push(child)
    }
  }
  return out.sort()
}

function htmlFilesIn(dirAbs) {
  if (!existsSync(dirAbs)) return []
  return readdirSync(dirAbs)
    .filter((f) => f.toLowerCase().endsWith('.html') && statSync(join(dirAbs, f)).isFile())
    .sort()
}

/** 从 HTML 里抠标题与描述。抓不到就返回 null，交给调用方兜底。 */
function readMeta(abs) {
  let html = ''
  try { html = readFileSync(abs, 'utf8') } catch { return { title: null, description: null } }

  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : null }
  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')

  let title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!title) title = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  // <h1> 里常包着 <span>，把标签剥掉
  if (title) title = decode(title.replace(/<[^>]+>/g, ' '))

  let description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
  if (!description) description = pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  if (!description) {
    const p = html.match(/<p[^>]*>([\s\S]{20,240}?)<\/p>/i)
    if (p) description = decode(p[1].replace(/<[^>]+>/g, ' '))
  }
  if (description) description = decode(description)

  return { title: title || null, description: description || null }
}

/** README 里第一个非标题段落，用来兜底描述。 */
function readmeDescription(abs) {
  if (!existsSync(abs)) return null
  const lines = readFileSync(abs, 'utf8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('!') || t.startsWith('|')) continue
    return t.replace(/[*_`[\]]/g, '').slice(0, 200)
  }
  return null
}

const titleize = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/* ------------------------------------------------------------ 收集 demo */

function collect() {
  const demos = []

  // ① 直接躺在 demos 根目录下的单文件
  for (const f of readdirSync(DEMOS_DIR)) {
    const abs = join(DEMOS_DIR, f)
    if (!statSync(abs).isFile() || !f.toLowerCase().endsWith('.html')) continue
    if (f === 'index.html') continue          // 那就是本脚本自己生成的列表页
    const meta = readMeta(abs)
    demos.push({
      id: f.replace(/\.html$/i, ''),
      title: meta.title || titleize(f.replace(/\.html$/i, '')),
      description: meta.description || '',
      url: `/demos/${f}`,
      dir: 'public/demos',
      entry: f,
      readme: false,
      variants: [],
    })
  }

  // ② 每个目录
  for (const rel of walkDirs(DEMOS_DIR)) {
    const abs = join(DEMOS_DIR, rel)
    const htmls = htmlFilesIn(abs)
    if (!htmls.length) continue

    const entry = htmls.includes('index.html') ? 'index.html' : htmls[0]
    const variants = htmls.filter((h) => h !== entry)

    const meta = readMeta(join(abs, entry))
    const readmeAbs = join(abs, 'README.md')
    const hasReadme = existsSync(readmeAbs)

    const fallbackName = basename(rel)
    demos.push({
      id: rel,
      title: meta.title || titleize(fallbackName),
      description: meta.description || readmeDescription(readmeAbs) || '',
      url: `/demos/${rel}/${entry === 'index.html' ? '' : entry}`,
      dir: `public/demos/${rel}`,
      entry,
      readme: hasReadme,
      variants: variants.map((v) => ({ name: v.replace(/\.html$/i, ''), url: `/demos/${rel}/${v}` })),
    })
  }

  return demos
}

/* --------------------------------------------------------- 补 README */

function writeMissingReadmes(demos) {
  let written = 0
  for (const d of demos) {
    if (d.readme) continue
    const abs = join(ROOT, d.dir, 'README.md')
    if (existsSync(abs)) continue
    // 单文件 demo 的 dir 就是 demos 根，别在根目录乱丢 README
    if (d.dir === 'public/demos') continue

    const lines = [
      `# ${d.title}`,
      '',
      '> 自动生成，请按需补充。',
      '',
    ]
    if (d.description) lines.push(d.description, '')
    lines.push(
      `- 入口：\`${d.entry}\``,
      `- 在线预览：\`${d.url}\``,
    )
    if (d.variants.length) {
      lines.push('', '## 其它页面', '')
      for (const v of d.variants) lines.push(`- [${v.name}](${v.name}.html)`)
    }
    lines.push('')
    writeFileSync(abs, lines.join('\n'), 'utf8')
    written++
    console.log(`  补 README: ${d.dir}/README.md`)
  }
  return written
}

/* ------------------------------------------------------------- 产出 */

/**
 * 跑一遍扫描并写出 demos.json + index.html。
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Array} 收集到的 demo 列表
 */
export function buildDemosIndex({ quiet = false } = {}) {
  if (!existsSync(DEMOS_DIR)) {
    if (!quiet) console.log('demos 索引: public/demos 不存在，跳过')
    return []
  }

  const demos = collect()
  const written = writeMissingReadmes(demos)

  const payload = {
    generatedAt: new Date().toISOString(),
    count: demos.length,
    demos,
  }

  writeFileSync(join(DEMOS_DIR, 'demos.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  writeFileSync(join(DEMOS_DIR, 'index.html'), renderIndex(demos), 'utf8')

  if (!quiet) {
    console.log(`demos 索引: ${demos.length} 个 demo（补了 ${written} 份 README）`)
    for (const d of demos) {
      const mark = d.readme ? '📄' : '  '
      const variants = d.variants.length ? `  (+${d.variants.length} variants)` : ''
      console.log(`  ${mark} ${d.url.padEnd(38)} ${d.title}${variants}`)
    }
  }

  return demos
}

/* --------------------------------------------------------- 列表页模板 */

export function renderIndex(list) {
  const cards = list.map((d) => {
    const variants = d.variants.length
      ? `\n        <div class="variants">${d.variants.map((v) => `<a href="${v.url}">${esc(v.name)}</a>`).join('')}</div>`
      : ''
    return `      <li class="card">
        <a class="main" href="${d.url}">
          <h2>${esc(d.title)}</h2>
          <p>${esc(d.description || '（还没有描述）')}</p>
          <code>${esc(d.url)}</code>
        </a>${variants}
      </li>`
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Demos · AISPIN</title>
<!-- 由 scripts/build-demos-index.mjs 自动生成，不要手改 -->
<style>
  :root {
    --paper: #f6efe3; --ink: #4a3b2e; --ink-soft: #8b7a67;
    --line: #ddd0bb; --card: #fffaf1; --accent: #a8563a;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #211d19; --ink: #e9e0d2; --ink-soft: #a2937f;
            --line: #3b342c; --card: #2a251f; --accent: #e08a63; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px 72px;
    background: var(--paper); color: var(--ink);
    font: 15px/1.7 'Maple Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  header { margin-bottom: 36px; }
  h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: .04em; }
  header p { margin: 0; color: var(--ink-soft); }
  header .meta { margin-top: 10px; font-size: 12px; color: var(--ink-soft); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 18px 20px; transition: transform .16s ease, border-color .16s ease;
  }
  .card:hover { transform: translateY(-2px); border-color: var(--accent); }
  .main { display: block; text-decoration: none; color: inherit; }
  .card h2 { margin: 0 0 6px; font-size: 17px; }
  .card p { margin: 0 0 10px; color: var(--ink-soft); font-size: 13.5px; }
  .card code { font-size: 12px; color: var(--accent); }
  .variants { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--line); display: flex; flex-wrap: wrap; gap: 8px; }
  .variants a {
    font-size: 12px; text-decoration: none; color: var(--ink-soft);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px;
  }
  .variants a:hover { color: var(--accent); border-color: var(--accent); }
  footer { margin-top: 44px; color: var(--ink-soft); font-size: 12px; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Demos</h1>
      <p>随手放的原型与试验页面。</p>
      <div class="meta">共 ${list.length} 个 · 索引由构建脚本自动生成 · <a href="/demos/demos.json">demos.json</a> · <a href="/">← 回主页</a></div>
    </header>
    <ul>
${cards}
    </ul>
    <footer>Generated by <code>scripts/build-demos-index.mjs</code></footer>
  </div>
</body>
</html>
`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* --------------------------------------------------------- 直接执行时 */

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) buildDemosIndex()
