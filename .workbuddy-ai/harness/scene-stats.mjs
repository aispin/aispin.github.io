/**
 * scene-stats.mjs — 把场景的真实开销打出来，给「性能」维度的评审当证据。
 *
 * 不看渲染器猜，看数字：对象/三角面/材质/贴图各多少、多少是可见的、
 * 贴图显存大概占多少、自定义 shader 有几个。
 *
 * 用法: node .workbuddy-ai/harness/scene-stats.mjs <url> [enter]
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2]
const doEnter = process.argv[3] === 'enter'
if (!url) { console.error('usage: scene-stats.mjs <url> [enter]'); process.exit(1) }

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

// 统计每帧真实 draw call 数。renderer.info 拿不到（R3F 没把 renderer 挂在
// 任何能摸到的地方），但 draw call 最终都要落到 WebGL 的 draw* 上，所以直接
// 数它们最实在。必须在页面脚本之前注入。
await page.evaluateOnNewDocument(() => {
  window.__draw = { calls: 0, lastFrame: 0, frames: 0, peak: 0 }
  const patch = (proto) => {
    if (!proto) return
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = proto[fn]
      if (!orig) continue
      proto[fn] = function (...a) { window.__draw.calls++; return orig.apply(this, a) }
    }
  }
  patch(window.WebGL2RenderingContext?.prototype)
  patch(window.WebGLRenderingContext?.prototype)
  // 每个 rAF 边界结算一次「上一帧」的 draw call 数
  const tick = () => {
    const d = window.__draw
    d.lastFrame = d.calls
    if (d.calls > d.peak) d.peak = d.calls
    d.calls = 0
    d.frames++
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => {
  if (!window.__scene || !window.__cam) return false
  let n = 0; window.__scene.traverse(() => n++); return n > 120
}, { timeout: 180000, polling: 1000 })

if (doEnter) { await page.evaluate(() => window.__aispin?.enter?.()); await sleep(4000) }
await sleep(6000)   // 让 RoomWarmup / 传送全部落定

const stats = await page.evaluate(() => {
  const s = window.__scene
  const byType = {}
  let visibleMeshes = 0, meshes = 0, tris = 0, visibleTris = 0
  const mats = new Map()          // uuid -> {type, name, shader:bool}
  const texes = new Map()         // uuid -> {w,h,bytes,kind}
  const geos = new Set()
  const inFrustum = []

  const countTri = (g) => {
    if (!g) return 0
    if (g.index) return g.index.count / 3
    const pos = g.attributes?.position
    return pos ? pos.count / 3 : 0
  }

  s.traverse((o) => {
    const t = o.type
    byType[t] = (byType[t] || 0) + 1
    if (!o.isMesh && !o.isPoints && !o.isLine) return
    meshes++
    if (o.visible) visibleMeshes++
    if (o.geometry) { geos.add(o.geometry.uuid); const n = countTri(o.geometry); tris += n; if (o.visible) visibleTris += n }

    const list = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of list) {
      if (!m) continue
      if (!mats.has(m.uuid)) {
        mats.set(m.uuid, {
          type: m.type,
          shader: !!m.fragmentShader,
          transparent: !!m.transparent,
          alphaTest: m.alphaTest || 0,
          opacity: m.opacity,
          vertexColors: !!m.vertexColors,
          side: m.side,
        })
      }
      for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap']) {
        const tx = m[key]
        if (!tx || !tx.uuid || texes.has(tx.uuid)) continue
        const img = tx.image
        const w = img?.width || img?.videoWidth || 0
        const h = img?.height || img?.videoHeight || 0
        // RGBA8 + mipmaps ≈ w*h*4*1.333
        texes.set(tx.uuid, {
          w, h,
          bytes: Math.round(w * h * 4 * 1.333),
          kind: tx.constructor?.name || 'Texture',
        })
      }
    }
  })

  // renderer.info —— R3F v9 把 root store 挂在 canvas 元素上
  let info = null
  try {
    const cvs = document.querySelector('canvas')
    const store = cvs?.__r3f?.root?.getState?.() || cvs?.__r3f?.store?.getState?.()
    const r = store?.gl || store?.renderer
    if (r?.info) {
      info = {
        render: { ...r.info.render },
        memory: { ...r.info.memory },
        programs: r.info.programs?.length ?? null,
      }
    }
  } catch (e) { info = { error: String(e) } }

  const texList = [...texes.values()]
  const matList = [...mats.values()]
  const draw = window.__draw ? { ...window.__draw } : null

  // 几何体/材质的复用度：1:1 说明完全没共享，每个 mesh 一套 buffer + 一次
  // 状态切换。
  const geoUse = {}
  s.traverse((o) => { if (o.geometry) geoUse[o.geometry.uuid] = (geoUse[o.geometry.uuid] || 0) + 1 })
  const geoCounts = Object.values(geoUse)

  return {
    byType,
    meshes, visibleMeshes,
    tris: Math.round(tris), visibleTris: Math.round(visibleTris),
    geometries: geos.size,
    geoShared: geoCounts.filter((n) => n > 1).length,
    geoMaxReuse: geoCounts.length ? Math.max(...geoCounts) : 0,
    materials: matList.length,
    matTypes: matList.reduce((a, m) => (a[m.type] = (a[m.type] || 0) + 1, a), {}),
    shaderMaterials: matList.filter((m) => m.shader).length,
    // 真正需要 transparent 的只有「靠 opacity 淡入淡出」的那些；带 alphaTest
    // 的抠图只要 alphaTest 就够了，挂上 transparent 会把它推进透明队列：
    // 不写深度、不能 early-z、每帧还要排序。
    transparentMaterials: matList.filter((m) => m.transparent).length,
    alphaTestCutouts: matList.filter((m) => m.transparent && m.alphaTest > 0).length,
    opacityFades: matList.filter((m) => m.transparent && !(m.alphaTest > 0) && m.opacity < 1).length,
    doubleSided: matList.filter((m) => m.side === 2).length,
    textures: texList.length,
    textureBytes: texList.reduce((a, t) => a + t.bytes, 0),
    textureTop: texList.sort((a, b) => b.bytes - a.bytes).slice(0, 10)
      .map((t) => `${t.w}x${t.h} ${(t.bytes / 1048576).toFixed(1)}MB ${t.kind}`),
    draw,
    info,
  }
})

const MB = (b) => (b / 1048576).toFixed(1) + ' MB'
console.log('=== 场景统计 ===')
console.log('对象类型        ', JSON.stringify(stats.byType))
console.log('Mesh 总数/可见  ', stats.meshes + ' / ' + stats.visibleMeshes)
console.log('三角面 总/可见  ', stats.tris.toLocaleString() + ' / ' + stats.visibleTris.toLocaleString())
console.log('Geometry 数     ', stats.geometries, ' 被复用(>1 mesh)的:', stats.geoShared, ' 最大复用:', stats.geoMaxReuse)
console.log('材质 数         ', stats.materials, JSON.stringify(stats.matTypes))
console.log('  自定义 shader ', stats.shaderMaterials)
console.log('  透明材质      ', stats.transparentMaterials)
console.log('    ├ 抠图(alphaTest>0，其实不需要 transparent)', stats.alphaTestCutouts)
console.log('    └ 淡入淡出(真需要)', stats.opacityFades)
console.log('  双面材质      ', stats.doubleSided)
console.log('贴图 数         ', stats.textures, '  显存约 ' + MB(stats.textureBytes))
stats.textureTop.forEach((t) => console.log('    ' + t))
if (stats.draw) {
  console.log('draw call / 帧  ', stats.draw.lastFrame, ' 峰值', stats.draw.peak, ' 采样帧数', stats.draw.frames)
}
console.log('renderer.info   ', JSON.stringify(stats.info))
console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 8).forEach((e) => console.log('  ' + e))
await browser.close()
