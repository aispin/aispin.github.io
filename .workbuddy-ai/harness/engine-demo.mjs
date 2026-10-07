/**
 * 跑三个 engine 模块的 demo() 自检 + 一条**现场**断言。
 *
 * 这些自检断言的是**契约**（确定性、抠图不该透明、图元同尺寸同对象…），
 * 不是「能不能跑」。它们只有几行，但正是逻辑坏掉时第一个失败的地方。
 *
 * ---------------------------------------------------------------------------
 * 踩过的坑（都让检查报过假警）
 * ---------------------------------------------------------------------------
 * 1. `__engineArtDemo` 是**模块导入时**就注册的，比 React 挂载早得多。
 *    所以 `waitForFunction(() => !!window.__engineArtDemo)` 一返回就 evaluate，
 *    会卡在「React 渲染完了但 useEffect 还没跑」的缝里。
 *    → 必须 waitForFunction 等**结果本身**（listener 挂上了），不能等信号。
 *
 * 2. three **没有** `isAudioListener` / `isPositionalAudio` 标志位
 *    （0.182 的 build 里 grep 到 0 次，只设了 `this.type = 'AudioListener'`）。
 *    照 drei 的习惯写 `o.isAudioListener` 会永远数到 0。
 *
 * 3. listener 挂在**相机**下，相机不一定在 scene 图里。
 *    只 traverse `window.__scene` 同样永远数不到。
 *
 * 4. 要等很久（实测 ~31s），不是 harness 慢，是**页面主线程被 RoomWarmup 的
 *    gl.compile() 占住了**。实测时间线：
 *        t=2.4s    __audioBus 注册、sharedListener() 已被 SpatialSfx 渲染时调用
 *        t=2.4~25s 主线程饥饿（200ms 的采样循环被拉长成 3-4s 一跳）
 *        t=31s     React 的 effect 终于跑到，listener 挂上，之后稳定
 *    所以超时给 180s，3s soak 完全不够。
 *
 * 5. **所有断言必须放在同一个 evaluate 里。** 分成多个 evaluate 时踩到过
 *    两次读数互相矛盾（history 全 1、紧接着的 evaluate 全 0）—— 跨 evaluate
 *    拿到的不一定是同一个执行上下文/同一个模块实例。放在一起，
 *    再把 uuid 打出来，就没有解释空间了。
 *
 * 6. 🔴 **最坑的一条：断言自己把被测对象拆了。** `audioBus.demo()` 第一版
 *    没还原现场 —— 它把全站单例 listener 临时挪到一台一次性相机上测挂载，
 *    测完 `detach` 就让它 parent=null 了。于是：
 *        waitForFunction 看到 parentIsCamera=true（demo 还没跑）
 *        → evaluate 里跑 demo() → listener 被摘掉
 *        → 之后所有断言全 false，看起来像"挂上又掉了"的竞态
 *    日志才把它戳穿（attach → detach → 没有第三次 attach）。
 *    → 教训：`demo()` / 自检**不许有副作用**，动过的全局状态必须还原。
 *      修在 src/engine/audioBus.js。
 *
 * 用法: node .workbuddy-ai/harness/engine-demo.mjs [url]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/?noloader=1'

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell', protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1000, height: 700 },
})
const page = await browser.newPage()
const errs = []
let navs = 0
const T0 = Date.now()
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) { navs++; console.log('   🔄 文档加载 #' + navs + ' @ ' + (Date.now() - T0) + 'ms') }
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

// ① 等模块注册完
await page.waitForFunction(
  () => !!window.__engineArtDemo && !!window.__engineResourcesDemo && !!window.__engineAudioBusDemo,
  { timeout: 180000, polling: 500 })

// ② 等 listener 真的挂到相机上（见坑 1 / 坑 4）
let attachWait = 'ok'
try {
  await page.waitForFunction(
    () => !!(window.__audioBus && window.__audioBus.stats().parentIsCamera),
    { timeout: 180000, polling: 250 })
} catch { attachWait = '超时（180s 内没挂上）' }

// ③ 全部断言塞进**同一个** evaluate（见坑 5）
const res = await page.evaluate(async () => {
  const out = []

  // --- 三个 demo() ---
  for (const name of ['__engineArtDemo', '__engineResourcesDemo', '__engineAudioBusDemo']) {
    const fn = window[name]
    if (typeof fn !== 'function') { out.push([name, 'skip', '未注册']); continue }
    try { out.push([name, 'ok', fn()]) }
    catch (e) { out.push([name, 'FAIL', e.message]) }
  }

  // --- 连采 15 次，证明挂载是**稳定**的，不是闪一下就掉 ---
  const hist = []
  for (let i = 0; i < 15; i++) {
    const b = window.__audioBus
    const l = b && b.listener()
    hist.push((l && window.__cam && l.parent === window.__cam) ? '1' : '0')
    await new Promise((r) => setTimeout(r, 200))
  }

  // --- 现场快照（同一个上下文里紧接着取，uuid 全打出来）---
  const scene = window.__scene
  const cam = window.__cam
  const bus = window.__audioBus
  const listener = bus ? bus.listener() : null

  let inScene = 0
  let inCam = 0
  if (scene) scene.traverse((o) => { if (o.type === 'AudioListener') inScene++ })
  if (cam) cam.traverse((o) => { if (o.type === 'AudioListener') inCam++ })

  const attached = !!listener && !!cam && listener.parent === cam
  const stats = bus ? bus.stats() : null
  const ok = attached && stats && stats.parentIsCamera === true && hist.every((h) => h === '1')

  out.push(['场景里的 AudioListener', ok ? 'ok' : 'FAIL',
    '实例=' + (listener ? 1 : 0) +
    '  attached=' + attached +
    '  stats=' + (stats ? stats.parentIsCamera : null) +
    '  scene内=' + inScene + '  相机子树内=' + inCam +
    '  相机子对象=' + (cam ? cam.children.length : -1)])
  out.push(['   ↳ uuid', 'info',
    'cam=' + (cam ? cam.uuid.slice(0, 8) : '-') +
    '  listener=' + (listener ? listener.uuid.slice(0, 8) : '-') +
    '  listener.parent=' + (listener && listener.parent ? listener.parent.uuid.slice(0, 8) + '/' + listener.parent.type : '-')])
  out.push(['listener 挂载稳定性', hist.every((h) => h === '1') ? 'ok' : 'FAIL',
    '15 次采样: ' + hist.join('')])

  return out
})

let bad = 0
for (const [name, status, msg] of res) {
  const icon = status === 'ok' ? '✅' : status === 'skip' ? '➖' : status === 'info' ? '   ' : '❌'
  if (status === 'FAIL') bad++
  console.log(icon + ' ' + name.padEnd(24) + ' ' + msg)
}
if (attachWait !== 'ok') { console.log('   ⏱  等待 listener 挂载: ' + attachWait); bad++ }
console.log('   文档加载次数 = ' + navs + '（本 app 首绘后会自己 reload 一次，2 是正常的）')
if (errs.length) { console.log('=== 页面错误 ==='); errs.slice(0, 8).forEach((x) => console.log('  ' + x)) }
await browser.close()
process.exit(bad ? 1 : 0)
