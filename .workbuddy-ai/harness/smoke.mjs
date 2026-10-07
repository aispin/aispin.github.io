/**
 * smoke.mjs — does the app boot clean? Reports page errors, console errors,
 * failed requests, the rasters actually fetched, and key runtime state.
 *
 * Usage:
 *   node .workbuddy-ai/harness/smoke.mjs <url> [waitMs]
 *
 * Deliberately does NOT wait for the 3D scene: under SwiftShader a cold start
 * takes minutes, but a module-level crash (the kind that shows up as
 * `meshes: 0` forever) throws within the first seconds. So a short wait is
 * enough to tell "boots" from "does not boot".
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/?noloader=1'
const waitMs = Number(process.argv[3] || 40000)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()

const errs = []
const rasters = new Set()
let navs = 0
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })
page.on('requestfailed', r => errs.push('[reqfail] ' + r.url() + ' ' + (r.failure()?.errorText || '')))
page.on('response', r => {
  if (r.status() >= 400) errs.push('[http' + r.status() + '] ' + r.url())
  const u = r.url().replace(/^https?:\/\/[^/]+/, '')
  if (/\.(webp|png|jpe?g|gif|avif)(\?|$)/i.test(u)) rasters.add(u)
})
page.on('framenavigated', f => { if (f === page.mainFrame()) navs++ })

const t0 = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
console.log('domcontentloaded in', ((Date.now() - t0) / 1000).toFixed(1) + 's')
await new Promise(r => setTimeout(r, waitMs))

const state = await page.evaluate(() => ({
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  hasCanvas: !!document.querySelector('canvas'),
  meshes: (() => { if (!window.__scene) return null; let n = 0; window.__scene.traverse(o => { if (o.isMesh) n++ }); return n })(),
  paperVarBytes: (getComputedStyle(document.documentElement).getPropertyValue('--paper-texture') || '').length,
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
}))

console.log(JSON.stringify(state, null, 1))
console.log('NAVS', navs)
console.log('RASTERS distinct:', rasters.size)
;[...rasters].sort().forEach(u => console.log('  ' + u))
console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 15).forEach(e => console.log(e))
await browser.close()
