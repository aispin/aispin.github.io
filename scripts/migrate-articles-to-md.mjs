#!/usr/bin/env node
/**
 * migrate-articles-to-md.mjs — 把 `src/data/articles.json` 拆成
 * `content/articles/<locale>/<slug>.md`。
 *
 * 一次性迁移工具，留在仓库里当**迁移记录**：以后再有人问「那 18 篇的正文
 * 去哪了」，答案就是这里 —— 逐字搬过去，一个字都没改。
 *
 * 它做的事只有三件：
 *   1. 日期归一。原文有四种写法（`2023/11/2`、`2023/11/22`、
 *      `2024-08-10 17:44`、`2025-08-26`），统一成 `YYYY-MM-DD`。
 *      🔴 这是 AI 代笔的前提：格式不统一，模型会照着抄，脏格式会一代代传下去。
 *   2. 正文原样写进 `.md`（`body` 本来就是 markdown）。
 *   3. 其余字段进 YAML frontmatter。
 *
 * 用法：node scripts/migrate-articles-to-md.mjs [--force]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC = join(ROOT, 'src/data/articles.json')
const OUT = join(ROOT, 'content/articles')

/** `2023/11/2` · `2023/11/22` · `2024-08-10 17:44` · `2025-08-26` ⇒ `YYYY-MM-DD` */
function normaliseDate(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** YAML 标量：只在需要时加引号，避免 `title: 使用 Express.js…` 被解析成对象 */
function yamlString(value) {
  const s = String(value ?? '')
  if (s === '') return "''"
  // 含 `: ` / 以特殊字符开头 / 含引号 ⇒ 用双引号并转义
  if (/[:#\[\]{}&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s)
  }
  return s
}

const force = process.argv.includes('--force')
const articles = JSON.parse(readFileSync(SRC, 'utf8'))

let written = 0
let skipped = 0
const badDates = []

for (const a of articles) {
  const date = normaliseDate(a.publishedAt)
  if (!date) { badDates.push(`${a.locale}:${a.slug} ← ${JSON.stringify(a.publishedAt)}`); continue }

  const dir = join(OUT, a.locale)
  const file = join(dir, `${a.slug}.md`)
  if (existsSync(file) && !force) { skipped++; continue }
  mkdirSync(dir, { recursive: true })

  const tags = Array.isArray(a.tags) && a.tags.length
    ? `[${a.tags.map((t) => yamlString(t)).join(', ')}]`
    : '[]'

  const fm = [
    '---',
    `title: ${yamlString(a.title)}`,
    `description: ${yamlString(a.description)}`,
    `date: ${date}`,
    `tags: ${tags}`,
    `lang: ${a.locale}`,
    `slug: ${a.slug}`,
    // 两语言同 slug = 同一篇。显式写出来，将来 slug 想分叉也不用改约定。
    `pair: ${a.slug}`,
    `author: ${yamlString(a.author?.name || 'ZISPIN')}`,
    '---',
    '',
  ].join('\n')

  // 正文尾部统一留一个换行，避免 diff 里出现 `\ No newline at end of file`
  const body = String(a.body || '').replace(/\s+$/, '') + '\n'
  writeFileSync(file, fm + body, 'utf8')
  written++
}

console.log(`写入 ${written} 篇，跳过 ${skipped} 篇（已存在，--force 覆盖）`)
if (badDates.length) {
  console.error('日期解析失败：')
  for (const b of badDates) console.error('  ' + b)
  process.exitCode = 1
}
