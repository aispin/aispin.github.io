/**
 * ink-mural-check.mjs — 验证走廊水墨画的「动态化」真的接上了。
 *
 * 三件事，都必须过：
 *   1. 没有 GLSL 编译错误（ShaderMaterial 是首次渲染才编译，所以要真的
 *      走到走廊里，光加载首页不够）。
 *   2. 场景里存在带 uTime 的材质，且 uTime 在**推进** —— 直接读 uniform
 *      的值，不靠肉眼看动画。
 *   3. 多个材质共用**同一个** uniform 对象（值必须完全一致），否则接缝处
 *      竹叶会不同步。
 *
 * 用法: node .workbuddy-ai/harness/ink-mural-check.mjs [url]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/?noloader=1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 720 },
})
const page = await browser.newPage()

const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error') errs.push('[console] ' + t)
  // three 的着色器错误是 console.error，单独抓出来更醒目
  if (/THREE\.WebGLProgram|Shader Error|ERROR: 0:/.test(t)) errs.push('[GLSL] ' + t.slice(0, 900))
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

// 等场景建完（app 首绘后会整页 reload，__scene 会被换掉，所以要守卫）
await page.waitForFunction(
  () => window.__scene && (() => { let n = 0; window.__scene.traverse(() => n++); return n > 300 })(),
  { timeout: 300000, polling: 1000 },
)

// 直接 snap 进走廊：墨水墙只在走廊里渲染，不进去就永远不会编译
const snapped = await page.evaluate(() => {
  if (!window.__aispin?.snap) return 'no-bridge'
  window.__aispin.snap('gallery')
  return 'ok'
})
console.log('snap 到走廊:', snapped)
await sleep(20000)   // SwiftShader 下等材质真正画出来

const readClock = () => page.evaluate(() => {
  const vals = []
  let mats = 0
  window.__scene.traverse((o) => {
    const m = o.material
    // Only ink walls. The corridor's framed paintings carry a uTime too, but
    // they run on their own clock (PaintingCanvas) — sweeping them in makes
    // the "all in sync" assertion fail for no reason. `bamboo()` is unique to
    // INK_WALL_FRAG, so it identifies the material unambiguously.
    if (m && m.uniforms && m.uniforms.uTime && /float bamboo\(/.test(m.fragmentShader || '')) {
      mats++
      vals.push(m.uniforms.uTime.value)
    }
  })
  return { mats, vals }
})

const a = await readClock()
await sleep(4000)
const b = await readClock()

console.log('\n带 uTime 的材质数:', a.mats, '/', b.mats)
console.log('第一次采样 uTime:', a.vals.slice(0, 6))
console.log('四秒后 uTime  :', b.vals.slice(0, 6))

const advanced = b.vals.length > 0 && b.vals.every((v, i) => v > a.vals[i])
const inSync = b.vals.length > 0 && new Set(b.vals).size === 1

console.log('\n判定:')
console.log('  ' + (a.mats > 0 ? '✅' : '❌') + ' 存在带 uTime 的墨水墙材质 — ' + a.mats + ' 个')
console.log('  ' + (advanced ? '✅' : '❌') + ' uTime 在推进（不是静止的）')
console.log('  ' + (inSync ? '✅' : '❌') + ' 所有材质共用同一个时钟（值一致，接缝不会不同步）')
console.log('  ' + (errs.length === 0 ? '✅' : '❌') + ' 无错误 — ' + errs.length + ' 条')
errs.slice(0, 8).forEach((e) => console.log('     ' + e))

await page.screenshot({ path: '/tmp/ink-mural.png' })
console.log('\n截图: /tmp/ink-mural.png')
await browser.close()
process.exit(a.mats > 0 && advanced && inSync && errs.length === 0 ? 0 : 1)
