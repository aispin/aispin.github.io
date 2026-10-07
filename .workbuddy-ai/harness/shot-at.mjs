/**
 * shot-at.mjs — 从任意机位给 3D 场景拍一张图。
 *
 * 为什么需要它：审「外墙 / 大门 / 花盆里的兔子 / 家具」这类**具体物件**时，
 * 默认机位（入口在 z=28 往 -Z 看）离得太远，物件只有几十像素，看不出比例和
 * 质感。审物件必须能把镜头推过去。
 *
 * 难点是相机被 useInfiniteCamera 每帧驱动，直接设一次会被覆盖掉。这里用
 * requestAnimationFrame 每帧写一次；R3F 的渲染循环也在 rAF 上，谁后跑谁生效，
 * 所以脚本会**先验证机位真的生效了**（读回 camera.position 比对），生效才截图，
 * 避免拍出一张「其实没动」的图还以为看的是特写。
 *
 * 用法:
 *   node .workbuddy-ai/harness/shot-at.mjs <url> <out.png> <px> <py> <pz> <tx> <ty> <tz> [waitMs]
 *   node .workbuddy-ai/harness/shot-at.mjs <url> <out.png> default [waitMs]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const [url, out, ...rest] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: shot-at.mjs <url> <out.png> <px> <py> <pz> <tx> <ty> <tz> [waitMs] | <url> <out.png> default [waitMs]')
  process.exit(1)
}
const useDefault = rest[0] === 'default'
const nums = rest.map(Number)
const [px, py, pz, tx, ty, tz] = nums
const waitMs = useDefault ? Number(rest[1] || 45000) : Number(rest[6] || 25000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

// 等场景真正建完（app 首绘后会整页 reload，__scene 会被换掉）。
// 阈值别设太高：整场约 900 个对象，但入口/走廊场景在 SwiftShader 下建得慢，
// n > 300 曾经连续两次把 300s 超时耗光。120 已经足够说明「场景挂上了」。
// 顺带把对象数打出来，超时时能一眼看出是「没挂上」还是「挂上了但太慢」。
const countScene = () => page.evaluate(() => {
  if (!window.__scene) return -1
  let n = 0
  window.__scene.traverse(() => n++)
  return n
})
try {
  await page.waitForFunction(
    () => {
      if (!window.__scene || !window.__cam) return false
      let n = 0
      window.__scene.traverse(() => n++)
      return n > 120
    },
    { timeout: 180000, polling: 1000 },
  )
} catch (e) {
  console.log('⚠️  等待场景超时，当前对象数 = ' + await countScene())
  throw e
}
console.log('场景对象数 = ' + await countScene())

if (!useDefault) {
  await page.evaluate(({ px, py, pz, tx, ty, tz }) => {
    if (window.__shotAtRaf) cancelAnimationFrame(window.__shotAtRaf)
    const cam = window.__cam
    const tick = () => {
      cam.position.set(px, py, pz)
      cam.lookAt(tx, ty, tz)
      window.__shotAtRaf = requestAnimationFrame(tick)
    }
    tick()
  }, { px, py, pz, tx, ty, tz })
}

// 让 SwiftShader 把这一帧画完
await sleep(waitMs)

// 先确认机位真的生效，否则这张图是骗人的
const got = await page.evaluate(() => {
  const c = window.__cam
  return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) }
})
if (!useDefault) {
  const dx = Math.abs(got.x - px), dy = Math.abs(got.y - py), dz = Math.abs(got.z - pz)
  const ok = dx < 0.5 && dy < 0.5 && dz < 0.5
  console.log((ok ? '✅' : '⚠️ ') + ' 机位 ' + (ok ? '已生效' : '未生效（被相机控制器覆盖）') +
              '  请求=[' + [px, py, pz] + ']  实际=[' + [got.x, got.y, got.z] + ']')
} else {
  console.log('默认机位 [' + [got.x, got.y, got.z] + ']')
}

await page.evaluate(() => { if (window.__shotAtRaf) cancelAnimationFrame(window.__shotAtRaf) })
await page.screenshot({ path: out, timeout: 150000 })
console.log('SHOT ' + out)
console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 8).forEach((e) => console.log('  ' + e))
await browser.close()
