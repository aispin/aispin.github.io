/**
 * shots.mjs — 一次启动浏览器，拍多张任意机位的图。
 *
 * 为什么不用 shot-at.mjs 循环：每启动一次 Chrome + 建场景要 ~50s，其中
 * 40s 是 SwiftShader 建场景。审「外墙 / 大门 / 草皮 / 家具」往往要 4-6 张
 * 图，逐个跑就是 5 分钟，一张图一张图地等会把节奏拖死。这个脚本只建一次
 * 场景，之后每张图只是改相机 + 等帧。
 *
 * 用法:
 *   node .workbuddy-ai/harness/shots.mjs <url> <plan.json>
 *
 * plan.json:
 *   [ { "out": "/tmp/a.png", "pos": [x,y,z], "target": [x,y,z],
 *       "snap": "gallery",          // 可选，硬切进房间（跳过开门动画）
 *       "teleport": "gallery",      // 可选，走完整传送流程
 *       "hideUI": "popup",          // 可选，"popup" 只藏底部成就条，
 *                                   //       "all" 连四角 HUD 一起藏
 *       "waitMs": 12000 } ]         // 可选，默认 12000
 *
 * ⚠️ 机位**只在当前场景状态下有效**。`enter: true` 之后入场场景会卸载，走廊
 * 变成无限循环空间 —— 这时候再把相机设到 z=24.6（大门的坐标）拍到的是走廊的
 * 另一段，不是大门。要拍大门就把它排在 `enter` 之前，或者单独跑一个计划。
 *
 * `pos` / `target` 可以省略：省略时把 `__shotSpec` 清空，用 app 自己的机位
 * （`snap` 之后机位停在房间门口，这正是想看的画面）。
 *
 * 相机被 useInfiniteCamera 每帧驱动，直接设一次会被覆盖掉。
 *
 * ⚠️ 别用「自己开一个 requestAnimationFrame 每帧写 camera.position」那招。
 * 它看起来能用 —— 读回 camera.position 确实是你写的值 —— 但**渲染出来的是
 * 控制器的机位**：R3F 的循环在自己的 rAF 回调里「先更新控制器、再 render」，
 * 我们的回调排在它后面，所以每次写都晚一帧，下一帧又被控制器盖掉。结果就是
 * 两张相隔 17 个单位的图一模一样，而脚本还在报 ✅。
 *
 * 正解是挂到渲染路径上：renderer.render() 开头会调用 camera.updateMatrixWorld()，
 * 补丁在那里写机位，就一定发生在矩阵被使用之前。lookAt() 不会回调
 * updateMatrixWorld（它走 updateWorldMatrix），所以没有递归风险。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const [url, planPath] = process.argv.slice(2)
if (!url || !planPath) {
  console.error('usage: shots.mjs <url> <plan.json>')
  process.exit(1)
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--hide-scrollbars', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

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
    { timeout: Number(process.env.SHOTS_WAIT_MS || 180000), polling: 1000 },
  )
} catch (e) {
  console.log('⚠️  等待场景超时，当前对象数 = ' + await countScene())
  // 场景挂不上时，最有用的信息是**页面报了什么错**（多半是运行时报错，
  // curl 编译检查看不出来）。先打出来再抛。
  console.log('=== 页面错误 (' + errs.length + ') ===')
  errs.slice(0, 12).forEach((x) => console.log('  ' + x))
  await browser.close()
  throw e
}
console.log('场景对象数 = ' + await countScene())

let prevDigest = null

// 把机位挂到渲染路径上（见文件头注释）。
//
// ⚠️ 只装一次是不够的：app 首绘后会**整页 reload**，`window.__cam` 会被换成
// 一个新对象，补丁随之消失。表现是脚本报的机位是对的、但图是默认机位 —— 也
// 就是「静默拍错」。所以用一个定时器持续守着：发现 camera 换了就重新装。
await page.evaluate(() => {
  if (window.__shotGuard) return
  window.__shotGuard = setInterval(() => {
    const cam = window.__cam
    if (!cam || cam.__shotPatched) return
    const orig = cam.updateMatrixWorld.bind(cam)
    cam.updateMatrixWorld = function (force) {
      const s = window.__shotSpec
      if (s) {
        this.position.set(s.pos[0], s.pos[1], s.pos[2])
        this.lookAt(s.target[0], s.target[1], s.target[2])
      }
      return orig(force)
    }
    cam.__shotPatched = true
  }, 200)
})

for (const shot of plan) {
  const waitMs = shot.waitMs ?? 12000

  if (shot.hideUI) {
    // 底部的成就条正好压在大门台阶上，拍台阶就看不见了。藏它是为了**看清**，
    // 不是为了掩盖问题 —— 所以按需藏，默认不藏。
    await page.evaluate((mode) => {
      const id = '__shotHideUI'
      let el = document.getElementById(id)
      if (!el) {
        el = document.createElement('style')
        el.id = id
        document.head.appendChild(el)
      }
      el.textContent = mode === 'all'
        ? '.achievement-popup, .navigation-ui { display: none !important; }'
        : '.achievement-popup { display: none !important; }'
    }, shot.hideUI)
    await sleep(600)
  }

  if (shot.enter) {
    await page.evaluate(() => window.__aispin?.enter?.())
    console.log('  已标记进入（markEntered）')
    await sleep(3000)
  }

  if (shot.snap) {
    // snap 只是把 camera.position 设了一次，而 useInfiniteCamera 每帧都在写它。
    // 所以「先 snap、再单独 evaluate 读回机位」是错的 —— 那一次 round-trip 之间
    // 控制器已经把它拉回自己的内部状态了（表现为「硬切了 gallery，图却还是走廊」）。
    // 必须在**同一个 evaluate 里** snap 完就立刻读出来写进 __shotSpec 冻住。
    const frozen = await page.evaluate((id) => {
      if (!window.__aispin || !window.__aispin.snap) return null
      window.__aispin.snap(id)
      const c = window.__cam
      if (!c) return null
      const dir = c.getWorldDirection(new c.position.constructor())
      const spec = {
        pos: [c.position.x, c.position.y, c.position.z],
        target: [c.position.x + dir.x * 10, c.position.y + dir.y * 10, c.position.z + dir.z * 10],
      }
      window.__shotSpec = spec
      return spec
    }, shot.snap)
    if (!frozen) throw new Error('snap 失败：没有调试桥')
    if (!Array.isArray(shot.pos)) {
      shot.pos = frozen.pos
      shot.target = frozen.target
      console.log('  硬切 ' + shot.snap + ' 并冻结机位 [' + frozen.pos.map((v) => v.toFixed(1)) + ']')
    } else {
      console.log('  硬切 ' + shot.snap)
    }
    await sleep(4000)
  }

  if (shot.teleport) {
    const ok = await page.evaluate((id) => {
      if (!window.__aispin || !window.__aispin.teleport) return 'no-bridge'
      window.__aispin.teleport(id)
      return 'ok'
    }, shot.teleport)
    console.log('  传送 ' + shot.teleport + ' → ' + ok)
    await sleep(6000)   // 传送是渐变，等它走完再定机位
  }

  const hasSpec = Array.isArray(shot.pos) && Array.isArray(shot.target)
  // snap 已经在页面里把 __shotSpec 写好了，这里不要再覆盖成 null。
  if (!shot.snap) {
    await page.evaluate((spec) => { window.__shotSpec = spec },
      hasSpec ? { pos: shot.pos, target: shot.target } : null)
  }

  await sleep(waitMs)

  // 确认机位真的生效。注意这个读回值本身不可靠（它只说明我们写过），
  // 所以下面额外比一次「渲染出来的画面」有没有变。
  const got = await page.evaluate(() => {
    const c = window.__cam
    return [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)]
  })
  const want = shot.pos
  const ok = !hasSpec || (Math.abs(got[0] - want[0]) < 0.5 && Math.abs(got[1] - want[1]) < 0.5 && Math.abs(got[2] - want[2]) < 0.5)

  const buf = await page.screenshot({ path: shot.out, timeout: 150000 })
  const digest = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
  const dup = digest === prevDigest
  prevDigest = digest
  console.log((ok && !dup ? '✅' : '⚠️ ') + ' ' + shot.out +
              '  请求=[' + want + ']  实际=[' + got + ']' +
              '  sha1=' + digest + (dup ? '  ❌ 与上一张逐字节相同 —— 机位没生效！' : ''))
}

console.log('=== ERRORS (' + errs.length + ') ===')
errs.slice(0, 10).forEach((e) => console.log('  ' + e))
await browser.close()
