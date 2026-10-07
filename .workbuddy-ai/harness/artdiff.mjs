/**
 * 跑 __artdiff.html 并把结果打出来。
 *
 *   node .workbuddy-ai/harness/artdiff.mjs [url]
 *
 * 这个页面不建 3D 场景，所以只要几秒 —— 和截图的 2.5 分钟不是一个量级。
 *
 * ⚠️ 用之前要先**现场搭**一次（用完就删，别留在仓库里）：
 *
 *   1. 把改造前的 `utils/*Art.js` 从归档里解出来，放进 `src/__artold/`：
 *        mkdir -p src/__artold /tmp/artold
 *        tar -xzf .workbuddy-ai/<改造前的归档>.tar.gz -C /tmp/artold src/utils
 *        for f in cloudArt entranceArt gateArt corridorArt galleryArt doorArt \
 *                 contactArt proceduralTextures techLogosArt photoPlaceholder; do
 *          cp /tmp/artold/src/utils/$f.js src/__artold/$f.js
 *        done
 *      （这些旧文件只 import 'three'，所以换个目录照样能跑。）
 *   2. 把 `src/__artold/__artdiff.js` 和根目录的 `__artdiff.html` 写回去
 *      （内容见本次提交的日志；核心就是把新旧两套同时 import，逐个导出函数
 *      用同一个 key 生成一次，逐像素哈希比对）。
 *   3. 跑完删掉 `src/__artold/` 和 `__artdiff.html` —— 根目录的 html 会变成
 *      Vite 的入口，留着会污染生产构建。
 */
import puppeteer from '/Users/lv/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const CHROME = '/Users/lv/.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const url = process.argv[2] || 'http://localhost:5199/__artdiff.html'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1200, height: 800 },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

try {
  await page.waitForFunction(() => !!window.__artdiffText, { timeout: 300000, polling: 500 })
} catch (e) {
  console.log('⚠️  超时。页面错误:')
  errs.slice(0, 10).forEach((x) => console.log('  ' + x))
  const t = await page.evaluate(() => document.getElementById('out')?.textContent || '')
  console.log(t)
  await browser.close()
  process.exit(1)
}

console.log(await page.evaluate(() => window.__artdiffText))
if (errs.length) {
  console.log('=== 页面错误 (' + errs.length + ') ===')
  errs.slice(0, 10).forEach((x) => console.log('  ' + x))
}
await browser.close()
