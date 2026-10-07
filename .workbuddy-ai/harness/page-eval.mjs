/**
 * page-eval.mjs — load a page, wait for `window.__ready === true`, then print
 * the result of an expression plus any page errors.
 *
 * Usage:
 *   node .workbuddy-ai/harness/page-eval.mjs <url> '<expression>' [timeoutMs]
 *
 * The expression is awaited, so `document.fonts.ready` style promises work.
 *
 * Two traps this handles on purpose:
 *   - `waitUntil: 'networkidle0'` never fires on a Vite dev page (the HMR
 *     websocket stays open), so this uses 'domcontentloaded' + a predicate.
 *   - anything you poll must guard on the object existing; the app reloads
 *     itself once after first paint, which clears `window.__scene`.
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2]
const expr = process.argv[3] || 'window.__info'
const timeout = Number(process.argv[4] || 60000)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
await page.waitForFunction('window.__ready === true', { timeout, polling: 500 })
const out = await page.evaluate(`(async () => (${expr}))()`)
console.log(JSON.stringify(out, null, 1))
console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 10).forEach(e => console.log(e))
await browser.close()
