/**
 * verify-batch123.mjs — 一次跑完第 1/2/3 批改动的回归验证
 * ============================================================
 *   #84  MarkdownBody 表格        -> .markdown-body 里真的出现 <table>
 *   #85  Preloader 进度条         -> 不再停在 90%，且最终到 100%
 *   #86  环境音程序化 + 删死音频  -> 冷启动不再请求 /sounds/szum*.mp3
 *   #87  manualChunks             -> 由构建脚本另行核对，这里只确认页面能起来
 *   #89  单一 AudioContext        -> AudioContext 构造次数 === 1
 *
 * 用法：
 *   node .workbuddy-ai/harness/verify-batch123.mjs [url]
 *
 * 已知坑（都在这里处理掉了）：
 *   - `waitUntil: 'networkidle0'` 在 Vite dev 页面永不触发（HMR websocket 长开）
 *   - app 首次绘制后会整页 reload 一次，`window.__scene` 会被清空，所以任何
 *     轮询谓词都要先判断对象存在
 *   - headless 里 setTimeout 被严重节流，采样间隔别指望精确
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { readFileSync } from 'node:fs'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const URL_BASE = process.argv[2] || 'http://localhost:5199/'

const results = []
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---- 把 OKR 文章从磁盘读进来（中文版，含 GFM 表格） ---- */
const articles = JSON.parse(
  readFileSync(new URL('../../src/data/articles.json', import.meta.url), 'utf8'),
)
const okr = articles.find((a) => a.slug === 'management-by-objectives' && a.id.startsWith('zh:'))
if (!okr) throw new Error('articles.json 里找不到中文版 management-by-objectives')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 900000,
  args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 900 })

/* 在页面脚本之前埋好 AudioContext 计数器 —— 必须早于任何模块求值 */
await page.evaluateOnNewDocument(() => {
  window.__ctxCount = 0
  const Orig = window.AudioContext || window.webkitAudioContext
  if (Orig) {
    class Counted extends Orig {
      constructor(...a) {
        super(...a)
        window.__ctxCount++
      }
    }
    window.AudioContext = Counted
    window.webkitAudioContext = Counted
  }
})

const pageErrors = []
const badResponses = []
const requestedUrls = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()) })
page.on('request', (r) => requestedUrls.push(r.url()))
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`) })

console.log(`\n加载 ${URL_BASE} …`)
await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 120000 })

/* ============================================================
 * #85 Preloader 进度条采样
 * ============================================================ */
console.log('\n[#85] Preloader 进度条')
const samples = []
const t0 = Date.now()
let sawNinetyPark = false
let ninetyRunStart = 0
let reached100 = false
let wentBackwards = false
let prevN = 0
// headless 是软件 GL + 冷缓存，资产阶段能跑 40s+，别用真机的时间尺度衡量
const BUDGET_MS = 150000

while (Date.now() - t0 < BUDGET_MS) {
  const s = await page.evaluate(() => {
    const el = document.querySelector('.preloader__percentage span')
    return { text: el ? el.innerText : null, mounted: !!window.__aispin }
  })
  const n = s.text ? parseInt(s.text, 10) : null
  samples.push({ t: Date.now() - t0, n, ready: s.mounted })
  if (n === 100) { reached100 = true; break }
  if (n !== null && n < prevN - 1) wentBackwards = true
  if (n !== null) prevN = n
  // “停在 90” = 数值恰好 90 且持续 > 1.5 s
  if (n === 90) {
    if (!ninetyRunStart) ninetyRunStart = Date.now()
    else if (Date.now() - ninetyRunStart > 1500) sawNinetyPark = true
  } else ninetyRunStart = 0
  await new Promise((r) => setTimeout(r, 120))
}

const seen = [...new Set(samples.map((x) => x.n).filter((x) => x !== null))]
const maxN = Math.max(...seen)
ok('进度条出现过多个不同数值（不是常数）', seen.length >= 4, `不同值 ${seen.length} 个，最大 ${maxN}%`)
ok('没有停在 90%', !sawNinetyPark, sawNinetyPark ? '曾卡在 90% 超过 1.5s' : '未卡住')
ok('进度单调不回退', !wentBackwards, wentBackwards ? '出现回退' : '单调')
ok('爬升持续到 99 附近（未提前饱和）', maxN >= 95, `最高 ${maxN}%`)
ok('最终到达 100%', reached100,
  reached100 ? `用时 ${samples[samples.length - 1].t}ms` : `${BUDGET_MS / 1000}s 内最高只到 ${maxN}%（headless 场景构建极慢，见备注）`)
console.log('     采样轨迹:', samples.map((x) => x.n).filter((x, i, a) => x !== a[i - 1]).join(' → '))

/* 等 app 自己那一次 reload 过去 */
await page.waitForFunction('!!window.__aispin && !!window.__scene', { timeout: 90000, polling: 500 })
await new Promise((r) => setTimeout(r, 2500))

/* ============================================================
 * #84 MarkdownBody 表格
 * ============================================================ */
console.log('\n[#84] MarkdownBody 表格')
const overlay = {
  title: okr.title,
  description: (okr.description || '').slice(0, 260),
  body: okr.body,
  url: '',
  date: okr.publishedAt || '',
  platformConfig: { label: 'POST' },
  // 必须是 'editorial' —— GlobalOverlay 只在 content.layout === 'editorial'
  // 时渲染 MarkdownBody，其余 layout 走的是纯 description 的 <p>。
  layout: 'editorial',
  actionLabel: 'Read',
}
// GlobalOverlay 可能挂在加载完成之后，所以重试而不是一次定生死
let overlayMounted = false
for (let i = 0; i < 60 && !overlayMounted; i++) {
  await page.evaluate((c) => { window.__aispin?.openOverlay?.(c) }, overlay)
  overlayMounted = await page.evaluate(() => !!document.querySelector('.markdown-body'))
  if (!overlayMounted) await new Promise((r) => setTimeout(r, 500))
}
await new Promise((r) => setTimeout(r, 400))

const tableInfo = await page.evaluate(() => {
  const body = document.querySelector('.markdown-body')
  if (!body) return { found: false }
  const tables = body.querySelectorAll('table')
  const t = tables[0]
  const ths = t ? [...t.querySelectorAll('thead th')].map((e) => e.innerText.trim()) : []
  const trs = t ? t.querySelectorAll('tbody tr') : []
  // 表格之外是否还残留字面管道符
  const textOutside = [...body.querySelectorAll('p, li, blockquote')]
    .map((e) => e.innerText).join('\n')
  const wrap = body.querySelector('.markdown-table-wrap')
  return {
    found: true,
    tableCount: tables.length,
    headers: ths,
    bodyRows: trs.length,
    firstRowCells: trs[0] ? [...trs[0].querySelectorAll('td')].length : 0,
    hasWrap: !!wrap,
    wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
    literalPipesInProse: (textOutside.match(/\|/g) || []).length,
    // 行内 **加粗** 与 <br/> 有没有被吃掉
    hasStrong: !!t?.querySelector('strong'),
    hasBr: !!t?.querySelector('br'),
  }
})

ok('渲染出 <table>', tableInfo.found && tableInfo.tableCount === 1, `table 数 = ${tableInfo.tableCount}`)
ok('表头列正确', tableInfo.headers?.length === 5, JSON.stringify(tableInfo.headers))
ok('表体行数正确', tableInfo.bodyRows === 5, `${tableInfo.bodyRows} 行，每行 ${tableInfo.firstRowCells} 格`)
ok('外层有横向滚动容器', tableInfo.hasWrap && tableInfo.wrapOverflowX === 'auto', `overflow-x: ${tableInfo.wrapOverflowX}`)
ok('正文里没有残留字面管道符', tableInfo.literalPipesInProse === 0, `残留 ${tableInfo.literalPipesInProse} 个`)
ok('单元格内 **加粗** 生效', tableInfo.hasStrong === true)
ok('单元格内 <br/> 生效', tableInfo.hasBr === true)

/* ============================================================
 * #89 单一 AudioContext
 * ============================================================ */
console.log('\n[#89] AudioContext')
await page.evaluate(() => {
  // 模拟一次真实手势，触发解锁路径
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 1200))
const audio = await page.evaluate(() => ({
  count: window.__ctxCount,
  bus: window.__sfxBus ? window.__sfxBus.state() : null,
}))
ok('全站只构造了一个 AudioContext', audio.count === 1, `构造次数 = ${audio.count}`)
ok('three 的全局单例与站点共享同一个 context', audio.bus?.threeShares === true,
  `threeShares = ${audio.bus?.threeShares}, bus = ${JSON.stringify(audio.bus)}`)

/* ============================================================
 * #86 死音频不再被请求
 * ============================================================ */
console.log('\n[#86] 死音频请求')
const deadSnd = requestedUrls.filter((u) => /szumwiatru|szummiasta|szummorza|szummonitorow|baloonpoop/.test(u))
ok('冷启动未请求已删除的环境音', deadSnd.length === 0, deadSnd.length ? deadSnd.join(', ') : '零请求')
const any404 = badResponses.filter((r) => !r.includes('favicon'))
ok('没有 4xx/5xx 响应', any404.length === 0, any404.length ? any404.slice(0, 5).join(' | ') : '干净')

/* ============================================================
 * 页面错误
 * ============================================================ */
console.log('\n[errors]')
const realErrors = pageErrors.filter((e) => !/Download the React DevTools/.test(e))
ok('无未捕获页面错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '干净')

await browser.close()

/* ---- 汇总 ---- */
const failed = results.filter((r) => !r.pass)
console.log(`\n${'='.repeat(56)}`)
console.log(`结果: ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('未通过:')
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`))
  process.exit(1)
}
console.log('全部通过 ✅')
