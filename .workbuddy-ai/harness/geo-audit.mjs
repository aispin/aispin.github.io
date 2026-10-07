/**
 * geo-audit.mjs — 量「几何体到底浪费在哪」。
 *
 * 为什么不能只看 `renderer.info.memory.geometries`：它只给一个总数（735），
 * 不告诉你是**同一个尺寸被建了 40 次**，还是**40 个真的不同**。两者的修法
 * 完全不同 —— 前者加共享缓存就解决，后者无解。所以这里按
 * 「几何体类型 + 全部 parameters + 顶点数 + 有没有 uv / 世界坐标 uv」做签名
 * 分组，看每个签名底下挂了多少个**不同的** geometry 对象。
 *
 * 入场场景和走廊场景是两套挂载（enter 之后入场会卸载），重复的成因不同，
 * 所以一次浏览器会话里**两个都量**。
 *
 * 用法:
 *   node .workbuddy-ai/harness/geo-audit.mjs [url]
 *
 * 结果同时写到 /tmp/opt/geo-audit.json，方便改前改后 diff。
 */
import fs from 'node:fs'
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/?noloader=1'
const outPath = process.argv[3] || '/tmp/opt/geo-audit.json'

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 720 },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(
  () => { if (!window.__scene) return false; let n = 0; window.__scene.traverse(() => n++); return n > 120 },
  { timeout: 180000, polling: 1000 })

const measure = () => page.evaluate(() => {
  const sig = (g) => {
    let s = g.type || 'Unknown'
    if (g.parameters) {
      const keys = Object.keys(g.parameters).sort()
      s += '(' + keys.map((k) => k + '=' + JSON.stringify(g.parameters[k])).join(',') + ')'
    }
    const pos = g.attributes && g.attributes.position
    s += '#' + (pos ? pos.count : 0)
    if (g.attributes && g.attributes.uv) s += '+uv'
    if (g.attributes && g.attributes.vViewZ) s += '+worlduv'
    return s
  }

  const bySig = new Map()    // sig -> { geoms:Set, meshes:number }
  const geomMesh = new Map() // geometry.uuid -> 引用它的 mesh 数
  let meshes = 0
  let instanced = 0
  window.__scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return
    if (o.isInstancedMesh) instanced++
    meshes++
    const g = o.geometry
    if (!g) return
    geomMesh.set(g.uuid, (geomMesh.get(g.uuid) || 0) + 1)
    const s = sig(g)
    let e = bySig.get(s)
    if (!e) { e = { geoms: new Set(), meshes: 0 }; bySig.set(s, e) }
    e.geoms.add(g.uuid)
    e.meshes++
  })

  const rows = [...bySig.entries()].map(([s, e]) => ({
    sig: s, distinct: e.geoms.size, meshes: e.meshes,
  }))
  rows.sort((a, b) => (b.distinct - a.distinct) || (b.meshes - a.meshes))

  const reusable = rows.filter((r) => r.distinct > 1)
  return {
    meshes, instanced, totalGeoms: geomMesh.size, signatures: rows.length,
    reusableSigs: reusable.length,
    wasted: reusable.reduce((n, r) => n + r.distinct - 1, 0),
    top: rows.slice(0, 25).map((r) => [r.distinct, r.meshes, r.sig]),
    sharedGeoms: [...geomMesh.values()].filter((v) => v > 1).length,
    maxReuse: Math.max(0, ...geomMesh.values()),
  }
})

function report(title, out) {
  console.log('===== ' + title + ' =====')
  console.log('mesh 数              = ' + out.meshes + (out.instanced ? '（含 InstancedMesh ' + out.instanced + '）' : ''))
  console.log('distinct geometry 数 = ' + out.totalGeoms)
  console.log('不同签名数           = ' + out.signatures + '   ← 理想几何体数')
  console.log('可复用的签名         = ' + out.reusableSigs)
  console.log('因此多出来的对象     = ' + out.wasted)
  console.log('被复用的 geometry    = ' + out.sharedGeoms + '   最大复用次数 = ' + out.maxReuse)
  console.log('--- 浪费最多的签名 top 25  (distinct = 建了几个对象) ---')
  // ⚠️ 别用 %-4d 这种 C 风格宽度语法 —— node 的 console.log 只认 %d/%s，
  // 认不出的说明符会把整行打成 NaN。
  for (const [d, m, s] of out.top) {
    console.log('  distinct=' + String(d).padEnd(4) + ' meshes=' + String(m).padEnd(5) + ' ' + s.slice(0, 118))
  }
  console.log()
}

const entranceOut = await measure()
report('入场场景（未 enter）', entranceOut)

await page.evaluate(() => window.__aispin?.enter?.())
await new Promise((r) => setTimeout(r, 6000))
const corridorOut = await measure()
report('走廊场景（enter 之后）', corridorOut)

fs.mkdirSync('/tmp/opt', { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({ entrance: entranceOut, corridor: corridorOut }, null, 2))
console.log('已写入 ' + outPath)

if (errs.length) { console.log('=== 页面错误 ==='); errs.slice(0, 8).forEach((x) => console.log('  ' + x)) }
await browser.close()
