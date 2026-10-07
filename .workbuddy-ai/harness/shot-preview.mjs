/**
 * shot-preview.mjs — one headless screenshot of a URL.
 *
 * Usage:
 *   node .workbuddy-ai/harness/shot-preview.mjs <url> <out.png> [width] [height] [waitMs]
 *
 * Positional args, NOT env vars — the sandbox's Bash tool does not pass
 * `echo "$VAR"` through usefully, so keep the interface argv-only.
 *
 * This is the fast half of the review loop: a root-level `__xxxpreview.html`
 * that imports an art module and draws its canvases into a contact sheet,
 * screenshotted here, costs about 5 s — against roughly 12 min for a full
 * in-app room screenshot. Delete the preview page afterwards.
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2]
const out = process.argv[3]
const W = Number(process.argv[4] || 1600)
const H = Number(process.argv[5] || 900)
const waitMs = Number(process.argv[6] || 4000)

if (!url || !out) {
  console.error('usage: shot-preview.mjs <url> <out.png> [W] [H] [waitMs]')
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: W, height: H },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, waitMs))
await page.screenshot({ path: out, timeout: 150000 })
console.log('SHOT', out, W + 'x' + H)
console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 10).forEach(e => console.log(e))
await browser.close()
