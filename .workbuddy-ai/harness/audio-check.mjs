/**
 * audio-check.mjs — end-to-end check of the audio layer.
 *
 * Verifies four things that a screenshot cannot:
 *
 *   1. 手势之前不创建 AudioContext
 *      （Chrome 在无手势时创建会打 "The AudioContext was not allowed to start"
 *        警告，而且必然是 suspended —— 所以模块刻意延迟创建）
 *   2. 没有任何 /sounds/*.mp3 或 *.ogg 的 404（旧的 pencil/tear 404 已消失）
 *   3. 首屏不下载 1.8MB 的 BGM ogg（preload 从 auto 改成 none）
 *   4. 合成音效真的出声 —— 在 AudioContext.destination 前面挂一个 AnalyserNode
 *      做旁路采样，读 0.7s 内时域数据的最大 RMS。RMS>0 才算真的在发声。
 *
 * Usage:
 *   node .workbuddy-ai/harness/audio-check.mjs [url] [preGestureWaitMs]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/'
const preWait = Number(process.argv[3] || 7000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rel = (u) => u.replace(/^https?:\/\/[^/]+/, '')

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--disable-dev-shm-usage', '--autoplay-policy=document-user-activation-required'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()

// ---- instrumentation, installed before any app code runs ----
await page.evaluateOnNewDocument(() => {
  const log = { contexts: [] }
  window.__ac = log
  // ⚠️ 页面里可能同时存在**多个** AudioContext（合成音效用 src/audio/paperSfx.js 的，
  //    成就解锁的铃声用 AchievementsContext 自己 new 的那个）。所以旁路探针必须
  //    按 context 存一组，不能只留最后一个 —— 否则后建的会把前一个顶掉，
  //    测出来全是 0（这里踩过一次）。
  window.__probes = []

  const Orig = window.AudioContext || window.webkitAudioContext
  if (!Orig) return

  // Tap everything that reaches ctx.destination with an AnalyserNode.
  // ⚠️ connect() 定义在 AudioNode.prototype 上，不是 AudioContext.prototype ——
  //    挂错原型会静默失效（这里也踩过一次）。
  const origConnect = window.AudioNode.prototype.connect
  window.AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      const c = this.context
      if (c && dest === c.destination) {
        if (!c.__probe) {
          c.__probe = c.createAnalyser()
          c.__probe.fftSize = 2048
          origConnect.call(c.__probe, c.destination)   // 保证被图拉取
          window.__probes.push(c.__probe)
        }
        origConnect.call(this, c.__probe)
      }
    } catch { /* 旁路失败不影响被测代码 */ }
    return origConnect.call(this, dest, ...rest)
  }

  const Wrapped = function (...a) {
    const c = new Orig(...a)
    log.contexts.push({ state: c.state, t: Math.round(performance.now()) })
    return c
  }
  Wrapped.prototype = Orig.prototype
  Object.setPrototypeOf(Wrapped, Orig)
  window.AudioContext = Wrapped
  window.webkitAudioContext = Wrapped

  // 统计"启动了但从未 stop() 的 BufferSource"——用来抓泄漏的循环音效。
  // 自然结束的一次性音效在创建时就调了 stop(t)，所以也会被移除；
  // 真正残留在这里的就是永远不会停的循环。
  window.__src = { started: 0, stopped: 0, live: new Set() }
  const P = window.AudioBufferSourceNode.prototype
  const oStart = P.start
  const oStop = P.stop
  P.start = function (...a) { window.__src.started++; window.__src.live.add(this); return oStart.apply(this, a) }
  P.stop = function (...a) { window.__src.stopped++; window.__src.live.delete(this); return oStop.apply(this, a) }
})

const notes = []
const audioReqs = []
const httpBad = []
let navs = 0
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) {
    navs++
    page.evaluate((n) => { window.__navCount = n }, navs).catch(() => { })
  }
})
page.on('console', (m) => { if (m.type() !== 'log') notes.push(m.type() + ': ' + m.text()) })
page.on('pageerror', (e) => notes.push('pageerror: ' + e.message))
page.on('request', (r) => { const u = rel(r.url()); if (/\.(ogg|mp3|wav|m4a|webm)$/i.test(u)) audioReqs.push(u) })
page.on('response', (r) => { if (r.status() >= 400) httpBad.push('http' + r.status() + ' ' + rel(r.url())) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(preWait)

/* ============================ 1. pre-gesture ============================ */
const pre = await page.evaluate(() => ({
  contexts: window.__ac.contexts.length,
  sfx: window.__paperSfx ? window.__paperSfx.state() : null,
}))
console.log('--- 手势之前 ---')
console.log('AudioContext 创建次数:', pre.contexts)
console.log('paperSfx state:', JSON.stringify(pre.sfx))
console.log('已发出的音频请求:', audioReqs.length ? audioReqs.join(', ') : '(无)')

const badSounds = audioReqs.filter((u) => /pencil|tear/.test(u))
const bgmFetched = audioReqs.filter((u) => /cfl_turningpages/.test(u))
console.log('pencil/tear 请求:', badSounds.length ? badSounds.join(', ') : '(无) ✓')
console.log('BGM ogg 请求:', bgmFetched.length ? bgmFetched.join(', ') : '(无) ✓')

/* ============================ 2. 手势解锁 ============================ */
await page.mouse.click(800, 450)
await sleep(1200)
const post = await page.evaluate(() => ({
  contexts: window.__ac.contexts.map((c) => c.state),
  probes: (window.__probes || []).length,
  sfx: window.__paperSfx ? window.__paperSfx.state() : null,
}))
console.log('\n--- 首个手势之后 ---')
console.log('AudioContext 状态:', JSON.stringify(post.contexts))
console.log('probes attached:', post.probes)
console.log('paperSfx state:', JSON.stringify(post.sfx))

/* ============================ 3. 合成音效真的出声 ============================ */
const measure = (name, ms) => page.evaluate((name, ms) => {
  const probes = window.__probes || []
  const diag = {
    probes: probes.length,
    navs: window.__navCount ?? -1,
    sfx: window.__paperSfx ? window.__paperSfx.state() : null,
    ctxs: window.__ac ? window.__ac.contexts.length : -1,
  }
  // 生产构建里 __paperSfx 调试钩子会被摇掉，合成音效那两段就跳过
  if (!window.__paperSfx) return { skip: 'no __paperSfx (生产构建)', diag }
  if (!probes.length) return { err: 'no probe', diag }
  const c = probes[0].context
  const t0 = c.currentTime
  const h = window.__paperSfx.create(name, { volume: 1 })
  const bufs = probes.map((p) => new Float32Array(p.fftSize))
  let max = 0
  let frames = 0
  // 同步自旋采样：音频图在独立线程渲染，主线程被 3D 场景拖住时
  // setTimeout 会被严重节流（实测 900ms 只跑到 2 帧），自旋不受影响。
  const wall = performance.now()
  while (performance.now() - wall < ms) {
    for (let k = 0; k < probes.length; k++) {
      const buf = bufs[k]
      probes[k].getFloatTimeDomainData(buf)
      let s = 0
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
      const r = Math.sqrt(s / buf.length)
      if (r > max) max = r
    }
    frames++
  }
  const advanced = c.currentTime - t0
  h.stop()
  return { rms: Number(max.toFixed(6)), frames, advanced: Number(advanced.toFixed(3)), state: c.state, diag }
}, name, ms)

console.log('\n--- 合成音效时域采样（destination 旁路） ---')
for (const [name, ms] of [['pencil', 700], ['tear', 500]]) {
  const r = await measure(name, ms)
  if (r.skip) { console.log(`${name.padEnd(7)} 跳过 — ${r.skip}`); continue }
  const ok = r.rms > 0.0005
  console.log(`${name.padEnd(7)} max RMS = ${r.rms}  frames=${r.frames}  ctx 前进 ${r.advanced}s (${r.state})  ${ok ? '✓ 有信号' : '✗ 静音'}`)
  console.log('        diag', JSON.stringify(r.diag))
}

/* ============================ 5. 句柄要听 AudioManager 的静音/音量 ============================ */
// AudioManager 的 useEffect 直接写 handle.muted / handle.volume，
// 所以合成句柄必须真的响应这两个字段，否则全局静音对合成音效无效。
const handleTest = await page.evaluate((ms) => {
  if (!window.__paperSfx) return { skip: 'no __paperSfx (生产构建)' }
  const probes = window.__probes || []
  const bufs = probes.map((p) => new Float32Array(p.fftSize))
  const spin = (dur, skip = 0) => {
    const wall0 = performance.now()
    while (performance.now() - wall0 < skip) { /* 跳过淡入/淡出过渡 */ }
    let max = 0
    const t0 = performance.now()
    while (performance.now() - t0 < dur) {
      for (let k = 0; k < probes.length; k++) {
        const buf = bufs[k]
        probes[k].getFloatTimeDomainData(buf)
        let s = 0
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
        const r = Math.sqrt(s / buf.length)
        if (r > max) max = r
      }
    }
    return Number(max.toFixed(6))
  }
  // 先量一段"什么都不新建"的底噪，确认此刻没有别的音效在响
  const baseline = spin(ms)
  const h = window.__paperSfx.create('pencil', { volume: 0.6, muted: true })
  const muted = spin(ms)
  h.muted = false
  const unmuted = spin(ms, 150)
  h.volume = 0            // 全局音量拉到 0 时 AudioManager 就是这么写的
  const zeroVol = spin(ms, 150)
  h.stop()
  return { baseline, muted, unmuted, zeroVol, live: window.__src.live.size, started: window.__src.started, stopped: window.__src.stopped }
}, 400)
console.log('\n--- 句柄静音/音量契约 ---')
if (handleTest.skip) {
  console.log('跳过 —', handleTest.skip)
} else {
  // 底噪 = 测试当下已经在响的东西（例如 Preloader 的铅笔声，加载还没结束就不该停）。
  // 所以断言必须相对底噪，不能绝对为 0。
  const floor = Math.max(handleTest.baseline * 1.15, 0.002)
  console.log('底噪(不新建)  → RMS', handleTest.baseline, '| BufferSource 启动', handleTest.started, '停止', handleTest.stopped, '残留', handleTest.live)
  console.log('muted=true  → RMS', handleTest.muted, handleTest.muted <= floor ? '✓ 静音' : '✗ 还在响')
  console.log('muted=false → RMS', handleTest.unmuted, handleTest.unmuted > floor * 1.5 ? '✓ 恢复' : '✗ 没声')
  console.log('volume=0    → RMS', handleTest.zeroVol, handleTest.zeroVol <= floor ? '✓ 静音' : '✗ 还在响')
}

/* ============================ 6. BGM 惰性加载仍然能播 ============================ */
// 通过 Vite 的模块图拿真正的 audioManager 实例（同一 URL → 同一个模块对象），
// 这样测的是真代码，不是复制品。⚠️ 生产构建里没有 /src/ 模块，只能跳过。
audioReqs.length = 0
const bgm = await page.evaluate(async () => {
  let m
  try {
    m = await import('/src/utils/audioManager.js')
  } catch {
    return { skip: '生产构建里没有 /src/ 模块图' }
  }
  const src = m.getBgmSource()
  m.playBackgroundMusic()
  await new Promise((r) => setTimeout(r, 2500))
  return { src, volume: m.getMusicVolume(), muted: m.getIsMuted() }
})
console.log('\n--- 打开入口大门后（playBackgroundMusic） ---')
if (bgm.skip) {
  console.log('跳过 —', bgm.skip)
} else {
  console.log('bgmSource:', bgm.src, '| volume:', bgm.volume, '| muted:', bgm.muted)
  console.log('新发出的音频请求:', audioReqs.length ? [...new Set(audioReqs)].join(', ') : '(无)')
  console.log(/cfl_turningpages/.test(audioReqs.join(',')) ? '✓ BGM 按需取到了' : '✗ BGM 没有请求')
}

/* ============================ 7. 汇总 ============================ */
const acWarn = notes.filter((n) => /AudioContext was not allowed/i.test(n))
console.log('\n=== 音频请求总计 (' + audioReqs.length + ') ===')
;[...new Set(audioReqs)].sort().forEach((u) => console.log('  ' + u))
console.log('=== HTTP>=400 (' + httpBad.length + ') ===')
httpBad.slice(0, 10).forEach((u) => console.log('  ' + u))
console.log('=== AudioContext 警告 (' + acWarn.length + ') ===')
acWarn.forEach((u) => console.log('  ' + u))
console.log('=== 控制台非 log 消息 (' + notes.length + ') ===')
notes.slice(0, 15).forEach((u) => console.log('  ' + u))

await browser.close()
