/**
 * font-check.mjs — verify a webfont is declared, LOADED, and actually USED,
 * and that Chrome's "preloaded but not used" warning is gone.
 *
 * Usage:
 *   node .workbuddy-ai/harness/font-check.mjs <url> [waitMs] [family]
 * e.g.
 *   node .workbuddy-ai/harness/font-check.mjs http://localhost:5199/?noloader=1 25000 MapleUI
 *
 * Why the width comparison matters: `document.fonts.check()` returns true even
 * for a family that does not exist (there is simply nothing to load), and a
 * declared-but-unused face still shows up in `document.fonts`. Measuring the
 * same string with and without the family is the only cheap way to prove the
 * glyphs really came from our file.
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/?noloader=1'
const waitMs = Number(process.argv[3] || 25000)
const family = process.argv[4] || 'MapleUI'

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()

const preloadWarnings = []
const fontResponses = []
page.on('console', (m) => {
  const t = m.text()
  if (/preload/i.test(t) && /not used|appropriate/i.test(t)) preloadWarnings.push(t)
})
page.on('response', (r) => {
  const u = r.url()
  if (/\.(woff2?|ttf|otf)(\?|$)/.test(u)) fontResponses.push({ url: u.replace(/^https?:\/\/[^/]+/, ''), status: r.status() })
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, waitMs))

const info = await page.evaluate(async (fam) => {
  try { await document.fonts.ready } catch { /* ignore */ }

  const faces = [...document.fonts].map(f => ({ family: f.family, weight: f.weight, status: f.status }))

  const measure = (font, text) => {
    const s = document.createElement('span')
    s.textContent = text
    s.style.font = font
    s.style.position = 'absolute'
    s.style.visibility = 'hidden'
    s.style.whiteSpace = 'pre'
    document.body.appendChild(s)
    const w = s.getBoundingClientRect().width
    s.remove()
    return Math.round(w * 100) / 100
  }
  const TEXT = 'MapleUI 字体测试 ABC 123'
  const wFamily = measure(`500 13px '${fam}', monospace`, TEXT)
  const wMono = measure('500 13px monospace', TEXT)

  const clean = (s) => s.replace(/['"]/g, '')
  return {
    faces,
    declared: faces.some(f => clean(f.family) === fam),
    status: faces.find(f => clean(f.family) === fam)?.status ?? 'absent',
    check: document.fonts.check(`500 13px '${fam}'`),
    widthWithFamily: wFamily,
    widthWithMonospace: wMono,
    differs: wFamily !== wMono,
  }
}, family)

console.log('--- font responses ---')
fontResponses.forEach(r => console.log('  ', r.status, r.url))
console.log('--- preload warnings ---')
console.log(preloadWarnings.length ? preloadWarnings.join('\n') : '  none ✓')
console.log('--- document.fonts ---')
info.faces.forEach(f => console.log('  ', f.family, f.weight, f.status))
console.log('--- verdict (' + family + ') ---')
console.log('  declared           :', info.declared)
console.log('  status             :', info.status)
console.log('  check()            :', info.check)
console.log('  width family vs mono:', info.widthWithFamily, 'vs', info.widthWithMonospace,
            '->', info.differs ? 'DIFFERENT (face really used) ✓' : 'SAME (face NOT used) ✗')

await browser.close()
