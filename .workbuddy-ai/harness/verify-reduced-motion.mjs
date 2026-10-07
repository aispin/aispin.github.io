/**
 * verify-reduced-motion.mjs — #90 prefers-reduced-motion 的 A/B 验证
 * ============================================================
 * 用 Puppeteer 原生的 `emulateMediaFeatures` 真的把系统偏好切成 reduce，
 * 而不是靠站点自己的调试开关 —— 那样只测到"开关有没有被读"，测不到
 * "媒体查询有没有真的接上"。
 *
 * 探针：**统计场景图里世界矩阵正在变化的物体个数**。
 *   no-preference : 一批装饰物在动（涂鸦漂浮、ZEO 字母浮动、角色挥手…）
 *   reduce        : 稳态下应当归零
 *
 * 为什么不用像素差：试过，信噪比不够。两组稳态的相邻帧像素差都是 ~0.78，
 * 那是软件光栅化的噪声底，把真正的运动淹没了（还会被 webfont 换字整屏污染，
 * 一度量出"开了减少动态反而更动"的荒谬结论）。矩阵是确定性的，没有噪声底。
 *
 * 为什么不用鼠标视差做探针：`useMouseParallax` 实测是**零引用的死代码**，
 * 相机根本不会被它驱动，用它当探针会得到"两组都不动"的假阳性。
 * 教训：先确认探针在对照组里真的会动。
 *
 * ⚠️ 四轮踩坑换来的四条前置条件（少一条结论就不可信）
 * ------------------------------------------------------------
 * 1. **必须等场景真正建起来。** `window.__scene` 在 `Experience` 一挂载就被
 *    赋值，但那一刻场景里**只有它自己 1 个节点**，之后几秒才长出上千个。
 *    在这一秒里采样，"物体数 1、0 个在动"会假扮成"完全静止"，而
 *    "预热房间已卸载"也会被真空满足 —— 实测就是这样量出
 *    `物体数 1；在动 [0, 359, 495]` 的。
 * 2. **必须等预热房间卸载。** `RoomWarmup` 把 Gallery/Content/Contact 挂在
 *    y=-500 预热，卸载前它们的 useFrame 照跑。采样落在卸载之前，就会把
 *    264 个**屏幕外**物体的运动算进来（实测 1316 vs 1052 个物体）。
 * 3. **必须等相机真正停稳。** `snap()` 是一次 78 单位的瞬移，相机用 lerp
 *    平滑过去；headless 软件光栅只有 ~5-15fps，收敛要 ~30s。之前直接在
 *    snap 后 sleep 9s 采样，量到的是**传送的尾巴**（429 / 495 个"在动"），
 *    而稳态其实是 0。
 * 4. **"看起来静了"要连续 6 次才算数。** 渐近收敛的残余量降到 4 位小数
 *    以下时会**间歇性**地看起来没动 —— 实测连续 3 次 0 之后又冒出 60 个
 *    （门开间的缓动尾巴，四元数第 5 位）。要求连续 6 次（约 9s）才排得掉。
 * 5. **必须传真的函数给 page.evaluate。** 传字符串 `'(() => {...})()'`
 *    第一次调用只回来 1 个元素，于是"物体数 1 却有 652 个在动"。
 *
 * 用法：node .workbuddy-ai/harness/verify-reduced-motion.mjs [url]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const URL_BASE = process.argv[2] || 'http://localhost:5199/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 900000,
  args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage',
  ],
})

/** 采样：每个物体的 uuid + 世界矩阵（4 位小数，比 3 位更早发现漂移） */
function sampleScene() {
  const out = []
  window.__scene.traverse((o) => {
    if (!o.matrixWorld) return
    const e = o.matrixWorld.elements
    let s = ''
    for (let i = 0; i < 16; i++) s += e[i].toFixed(4) + ','
    out.push([o.uuid, s])
  })
  return out
}

/** 场景概况：uuid / 物体数 / 预热房间是否还挂着（RoomWarmup 在 y=-500） */
function sceneShape() {
  if (!window.__scene) return null
  let n = 0
  let warmup = false
  window.__scene.traverse((o) => {
    n++
    if (o.matrixWorld && o.matrixWorld.elements[13] < -400) warmup = true
  })
  return { uuid: window.__scene.uuid, n, warmup }
}

/** 详细采样：额外带祖先链和世界坐标，用来定位"到底是谁还在动" */
function sampleSceneDetailed() {
  const out = []
  window.__scene.traverse((o) => {
    if (!o.matrixWorld) return
    const e = o.matrixWorld.elements
    let s = ''
    for (let i = 0; i < 16; i++) s += e[i].toFixed(4) + ','
    const chain = []
    let p = o
    while (p && p !== window.__scene && chain.length < 6) {
      chain.push(p.type + ':' + (p.name || '-'))
      p = p.parent
    }
    const v = o.getWorldPosition(new (Object.getPrototypeOf(o.position).constructor)())
    out.push([o.uuid, s, chain.join(' < '), [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100).join(',')])
  })
  return out
}

function countMovers(prev, next) {
  const m = new Map(prev.map(([uuid, mat]) => [uuid, mat]))
  let n = 0
  for (const [uuid, mat] of next) {
    const before = m.get(uuid)
    if (before !== undefined && before !== mat) n++
  }
  return n
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 等场景"建完并且站稳"：连续 5 次（约 6s）uuid 不变、物体数不变、预热已卸载。
 * 三条都要 —— 只看"预热已卸载"会被空场景真空满足（见文件头第 1 条）。
 */
async function waitForStableScene(page, timeoutMs = 180000) {
  const t0 = Date.now()
  let lastUuid = null
  let lastN = -1
  let same = 0
  while (Date.now() - t0 < timeoutMs) {
    const s = await page.evaluate(sceneShape)
    if (s && s.uuid === lastUuid && s.n === lastN && !s.warmup && s.n > 300) {
      same++
      if (same >= 5) return s
    } else {
      same = 0
    }
    if (s) {
      lastUuid = s.uuid
      lastN = s.n
    }
    await sleep(1200)
  }
  return null
}

/** 跑一轮：切偏好 -> 进走廊 -> 等场景稳 -> 等静止 -> 测量 */
async function run(preference) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: preference },
  ])

  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction('!!window.__aispin && !!window.__scene', { timeout: 180000, polling: 500 })

  const flag = await page.evaluate(() => ({
    native: window.__reducedMotion ? window.__reducedMotion.native() : null,
    get: window.__reducedMotion ? window.__reducedMotion.get() : null,
  }))

  await page.evaluate(() => { window.__aispin.enter() })
  await sleep(1500)
  await page.evaluate(() => { window.__aispin.snap('posts') })
  await page.evaluate(() => document.fonts.ready)

  const shape = await waitForStableScene(page)

  // 等静止：**连续 6 次**采样 0 变化才算数。
  //
  // 为什么是 6 不是 3：`snap()` 之后的收敛是渐近的，残余量降到 4 位小数以下
  // 会**间歇性**地看起来"没动"（门开间的缓动尾巴正是这样，实测连续 3 次 0
  // 之后又冒出 60 个）。要求 6 次（约 9s）连续，才排得掉这种假静止。
  // 另外：uuid 或物体数一变就把计数清零，否则整页重建期间那几次"空场景
  // 0 变化"会被当成静稳。
  let prev = await page.evaluate(sampleScene)
  let quiet = 0
  const settleStart = Date.now()
  while (Date.now() - settleStart < 180000 && quiet < 6) {
    await sleep(1500)
    const cur = await page.evaluate(sampleScene)
    const n = countMovers(prev, cur)
    quiet = n === 0 && cur.length === prev.length ? quiet + 1 : 0
    prev = cur
  }
  const settleSeconds = (Date.now() - settleStart) / 1000

  // 把相机状态一起记下来，失败时能一眼看出是"还没停稳"还是"真的在动"
  const camAtMeasure = await page.evaluate(() => {
    const c = window.__cam
    return c ? [c.position.x, c.position.y, c.position.z].map((n) => Math.round(n * 1e6) / 1e6) : null
  })

  // 测量：4 次采样 -> 3 个相邻差值
  const samples = [prev]
  for (let i = 0; i < 3; i++) {
    await sleep(1500)
    samples.push(await page.evaluate(sampleScene))
  }
  const moving = []
  for (let i = 1; i < samples.length; i++) moving.push(countMovers(samples[i - 1], samples[i]))

  const total = Math.max(...samples.map((s) => s.length))

  // 失败时抓一次现场，指出是谁还在动
  let culprits = []
  if (Math.max(...moving) > 0) {
    const a = await page.evaluate(sampleSceneDetailed)
    await sleep(1500)
    const b = await page.evaluate(sampleSceneDetailed)
    const m = new Map(a.map(([u, v]) => [u, v]))
    const byChain = new Map()
    for (const row of b) {
      const before = m.get(row[0])
      if (before !== undefined && before !== row[1]) {
        if (!byChain.has(row[2])) byChain.set(row[2], [])
        byChain.get(row[2]).push(row)
      }
    }
    culprits = [...byChain.entries()]
      .sort((x, y) => y[1].length - x[1].length)
      .slice(0, 3)
      .map(([chain, v]) => ({ chain, n: v.length, sample: v[0][3] }))
  }

  await page.close()
  return {
    flag, moving, total, errs, quiet, settleSeconds, culprits, camAtMeasure,
    warmupGone: shape ? !shape.warmup : false,
    settled: !!shape,
    shape,
  }
}

console.log('\n[A] prefers-reduced-motion: no-preference（对照组，应当有物体在动）')
const normal = await run('no-preference')
console.log(`    媒体查询读到 native=${normal.flag.native}  get()=${normal.flag.get}`)
console.log(`    场景已稳定=${normal.settled}（物体数 ${normal.shape ? normal.shape.n : '-'}，预热已卸载=${normal.warmupGone}）  静稳耗时=${normal.settleSeconds.toFixed(0)}s  测量时相机=[${normal.camAtMeasure}]`)
console.log(`    场景图物体数 ${normal.total}；相邻采样间在动的物体数 = [${normal.moving.join(', ')}]`)
if (normal.errs.length) console.log('    pageerror:', normal.errs.slice(0, 3).join(' | '))

console.log('\n[B] prefers-reduced-motion: reduce（实验组，应当全部静止）')
const reduced = await run('reduce')
console.log(`    媒体查询读到 native=${reduced.flag.native}  get()=${reduced.flag.get}`)
console.log(`    场景已稳定=${reduced.settled}（物体数 ${reduced.shape ? reduced.shape.n : '-'}，预热已卸载=${reduced.warmupGone}）  静稳耗时=${reduced.settleSeconds.toFixed(0)}s  测量时相机=[${reduced.camAtMeasure}]`)
console.log(`    场景图物体数 ${reduced.total}；相邻采样间在动的物体数 = [${reduced.moving.join(', ')}]`)
if (reduced.errs.length) console.log('    pageerror:', reduced.errs.slice(0, 3).join(' | '))
if (reduced.culprits.length) {
  console.log('    仍在动的物体：')
  for (const c of reduced.culprits) console.log(`      ${c.n} 个  ${c.chain}  e.g. pos=${c.sample}`)
}

await browser.close()

const results = []
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const nMax = Math.max(...normal.moving)
const rMax = Math.max(...reduced.moving)

console.log('\n判定:')
ok('no-preference 时站点读到 false', normal.flag.native === false && normal.flag.get === false,
  `native=${normal.flag.native} get()=${normal.flag.get}`)
ok('reduce 时媒体查询与站点读数都为 true', reduced.flag.native === true && reduced.flag.get === true,
  `native=${reduced.flag.native} get()=${reduced.flag.get}`)
ok('两组都等到场景建完并站稳', normal.settled && reduced.settled && normal.warmupGone && reduced.warmupGone,
  `no-preference=${normal.settled}/${normal.warmupGone} reduce=${reduced.settled}/${reduced.warmupGone}`)
ok('对照组确实有装饰物在动（探针有效）', nMax > 0, `最多 ${nMax} 个物体在变`)
ok('reduce 时装饰物全部静止', rMax === 0,
  rMax === 0 ? '零物体在变' : `仍有 ${rMax} 个物体在变`)
ok('两组都没有未捕获错误', normal.errs.length === 0 && reduced.errs.length === 0,
  [...normal.errs, ...reduced.errs].slice(0, 3).join(' | ') || '干净')

const failed = results.filter((r) => !r.pass)
console.log(`\n${'='.repeat(56)}`)
console.log(`结果: ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`))
  process.exit(1)
}
console.log('全部通过 ✅')
