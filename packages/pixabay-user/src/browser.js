/**
 * 一个够用就行的 CDP 客户端：起 Chrome、开标签页、导航、在页面里跑表达式、截图。
 *
 * 🔴 为什么不用 puppeteer
 * `packages/` 下的包要能被别的项目直接 `import`，不该拖一个 300MB 的浏览器依赖。
 * Node 22 自带 WebSocket，CDP 又只是"发 JSON、收 JSON"，一百行就够。
 *
 * 🔴 为什么必须自己起 Chrome（而不是 https.get 拿 HTML）
 * pixabay.com 前面是 Cloudflare。直接抓 = 403「Just a moment...」；
 * 用无头 Chrome + 下面那几条参数 = 200。
 *
 * 🔴 关键一条：UA 必须用 `Emulation.setUserAgentOverride` 设，
 * 不是 `Network.setUserAgentOverride` —— 后者只改请求头，`navigator.userAgent`
 * 还是 HeadlessChrome，Cloudflare 一眼就看出来（实测：前者 200，后者 403）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/* 反检测 + 稳定渲染。`--disable-blink-features=AutomationControlled` 去掉
   `navigator.webdriver`，其余几条是关掉"后台标签降频/首启弹窗"这类噪音。 */
const BASE_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-background-networking',
  '--disable-breakpad',
  '--disable-dev-shm-usage',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
  '--no-default-browser-check',
  '--password-store=basic',
  '--use-mock-keychain',
  /* 没有它，`Target.createTarget` 出来的页面会**直接崩**（Inspector.targetCrashed），
     后面每个 CDP 调用都超时。macOS 上也会踩到，不是 Linux 专属。 */
  '--no-sandbox',
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
]

/** 找到 Chrome 可执行文件。找不到就抛 —— 这包没有兜底下载。 */
export function findChrome(explicit) {
  if (explicit) return explicit
  const env = process.env.CHROME_PATH
  if (env) return env
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  throw new Error('找不到 Chrome，用 --chrome <path> 或 CHROME_PATH 指定')
}

async function waitForDevtools(proc, timeoutMs) {
  let buf = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome 没起来：${buf.slice(0, 400)}`)), timeoutMs)
    const onData = (d) => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    }
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 退出（${code}）：${buf.slice(0, 300)}`)) })
  })
}

/**
 * 起一个浏览器，返回一个带 `page` 的会话。用完必须 `close()`。
 * @returns {Promise<{page: Page, close: () => Promise<void>}>}
 */
export async function launch({ chrome, headless = true, width = 1440, height = 1000, timeout = 45000 } = {}) {
  const bin = findChrome(chrome)
  const profile = mkdtempSync(join(tmpdir(), 'pixabay-profile-'))
  const args = [...BASE_ARGS, `--user-data-dir=${profile}`, 'about:blank']
  if (!headless) args.splice(args.indexOf('--headless=new'), 1)
  const proc = spawn(bin, [...args, '--remote-debugging-port=0'], { stdio: ['ignore', 'pipe', 'pipe'] })

  let ws
  try {
    const wsUrl = await waitForDevtools(proc, timeout)
    ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      if (ws.readyState === 1) return res()
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('DevTools WebSocket 连不上')), { once: true })
    })

    let seq = 0
    const waiting = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg)
        waiting.delete(msg.id)
      }
    })
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP 超时：${method}`)) }, timeout)
        waiting.set(id, (m) => { clearTimeout(timer); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result) })
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

    /* 🔴 必须 Emulation.* —— Network.setUserAgentOverride 不改 navigator.userAgent，
       Cloudflare 看到 HeadlessChrome 就直接 403。 */
    await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'MacIntel', acceptLanguage: 'en-US,en' }, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)

    const page = {
      sessionId,
      send: (m, p) => send(m, p, sessionId),
      async goto(url) { await send('Page.navigate', { url }, sessionId) },
      /** 在页面里跑一段表达式，返回它的值。 */
      async eval(fnOrExpr, ...args) {
        const expression = typeof fnOrExpr === 'function'
          ? `(${fnOrExpr})(...${JSON.stringify(args)})`
          : fnOrExpr
        const r = await send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        }, sessionId)
        if (r.exceptionDetails) throw new Error(`页面里抛错：${r.exceptionDetails.text} ${r.result?.description || ''}`)
        return r.result?.value
      },
    }

    return {
      page,
      async close() {
        try { await send('Target.closeTarget', { targetId }) } catch { /* 关不掉也无所谓 */ }
        try { ws.close() } catch { /* ignore */ }
        proc.kill()
        /* profile 目录可能有锁文件，删不掉就算了 —— 在 tmp 里，系统会收 */
        try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
      },
    }
  } catch (err) {
    try { ws?.close() } catch { /* ignore */ }
    proc.kill()
    throw err
  }
}