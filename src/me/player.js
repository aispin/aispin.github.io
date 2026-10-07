/**
 * /me 页面的「程序化氛围曲」播放器。
 *
 * 音频部分**不新写合成器** —— 直接用仓库里已有的生成式 BGM 引擎
 * （src/audio/bgm.js，vendored 自 iskill-generative-bgm v1.2.1）。
 * 那个引擎本来就是零素材、纯 Web Audio 实时合成的，正好是这里想要的：
 * 页面上标榜「没有一个音频文件」，就不能靠 mp3 撑场面。
 *
 * canvas 上的柱子是**装饰性节拍可视化**，不是真实频谱 ——
 * 引擎没有暴露 bus 节点，接不了 AnalyserNode，而 vendored 文件约定不改。
 * 所以它按主题的 BPM 打拍，只在播放时动。UI 文案里没有把它说成频谱。
 */
import { createBgm } from '../audio/bgm.js'

/** 可选的三个主题（引擎内置，id 必须对得上 bgm.js 的 THEME_DEFS）。 */
export const THEMES = [
  { id: 'morning', zh: '晨光', en: 'Morning light', note: { zh: '明亮的五声', en: 'bright pentatonic' } },
  { id: 'campfire', zh: '篝火', en: 'Campfire', note: { zh: '木吉他物理建模', en: 'Karplus-Strong guitar' } },
  { id: 'bedtime', zh: '睡前', en: 'Bedtime', note: { zh: '八音盒摇篮曲', en: 'music-box lullaby' } },
]

const BPM = { morning: 96, campfire: 84, bedtime: 64 }

/** 确定性 PRNG，保证每次刷新柱子形状一致。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BAR_COUNT = 96
const WAVE = (() => {
  const rnd = mulberry32(0x5A17)
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const t = i / BAR_COUNT
    const env = Math.sin(t * Math.PI) ** 0.6
    const a = Math.sin(i * 0.42) * 0.3
    const b = Math.sin(i * 1.13) * 0.2
    const c = Math.sin(i * 2.7) * 0.11
    return Math.max(0.12, Math.min(1, (0.45 + a + b + c) * env + rnd() * 0.14))
  })
})()

/**
 * @param {object} refs
 * @param {HTMLCanvasElement} refs.canvas
 * @param {HTMLElement} refs.wrap
 * @param {HTMLButtonElement} refs.button
 * @param {HTMLElement} refs.elapsedEl
 * @param {HTMLSelectElement} [refs.themeSelect]
 */
export function mountPlayer({ canvas, wrap, button, elapsedEl, themeSelect }) {
  const bgm = createBgm()
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  let themeId = THEMES[1].id          // 默认篝火：木吉他最像「音乐人」
  let playing = false
  let raf = 0
  let startedAt = 0
  let elapsed = 0

  function fit() {
    const r = wrap.getBoundingClientRect()
    if (!r.width) return
    canvas.width = Math.floor(r.width * dpr)
    canvas.height = Math.floor(r.height * dpr)
    canvas.style.width = `${r.width}px`
    canvas.style.height = `${r.height}px`
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  // rAF 会传一个时间戳，但这里用的是播放器自己的 `elapsed`（暂停时要冻结相位，
  // 所以不能直接吃 rAF 的时钟），因此不接收参数。
  function draw() {
    raf = requestAnimationFrame(draw)
    const w = canvas.width
    const h = canvas.height
    if (!w || !h) return
    ctx.clearRect(0, 0, w, h)

    const barW = Math.max(1, Math.floor((w / BAR_COUNT) * 0.62))
    const gap = Math.max(1, Math.floor(w / BAR_COUNT - barW))
    const totalW = BAR_COUNT * (barW + gap) - gap
    const startX = (w - totalW) / 2

    const colIdle = cssVar('--n-300')
    const colPlay = cssVar('--brand')
    const colHead = cssVar('--accent')

    // 播放时按 BPM 走一个 0..1 的相位，柱子整体起伏 + 逐根错拍
    const beat = playing ? (elapsed * (BPM[themeId] || 90)) / 60 : 0
    const phase = beat % 1

    for (let i = 0; i < BAR_COUNT; i++) {
      const pos = i / BAR_COUNT
      let amp = WAVE[i]

      if (playing) {
        // 整体脉冲：每拍一次呼吸
        amp *= 0.78 + 0.22 * Math.sin(Math.PI * phase)
        // 错拍：从左向右的波
        amp *= 0.86 + 0.14 * Math.sin(pos * Math.PI * 4 - beat * Math.PI * 2)
        // 播放头附近高亮一根
        const head = (beat * 0.12) % 1
        if (Math.abs(pos - head) < 0.012) amp = Math.min(1, amp * 1.5)
      } else {
        // 静止时也留 78% —— 之前 55% 让整条波形细得像一条虚线，
        // 在 44px 高的槽里几乎看不见，看着像坏了。
        amp *= 0.78
      }

      const barH = Math.max(3, Math.min(1, amp * 1.3) * h * 0.9)
      const x = startX + i * (barW + gap)
      const y = (h - barH) / 2

      ctx.fillStyle = playing ? colPlay : colIdle
      if (playing) {
        const head = (beat * 0.12) % 1
        if (Math.abs(pos - head) < 0.012) ctx.fillStyle = colHead
      }

      const r = Math.min(barW / 2, 1.5)
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, r)
      else ctx.rect(x, y, barW, barH)
      ctx.fill()
    }
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60)
    const s = String(Math.floor(sec % 60)).padStart(2, '0')
    return `${m}:${s}`
  }

  function tick() {
    if (playing) {
      elapsed = (performance.now() - startedAt) / 1000
      if (elapsedEl) elapsedEl.textContent = fmt(elapsed)
    }
  }

  function setPlaying(next) {
    playing = next
    button.classList.toggle('playing', playing)
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    if (playing) {
      startedAt = performance.now() - elapsed * 1000
      bgm.start({ kind: 'theme', id: themeId, volume: 0.5 })
    } else {
      bgm.stop()
    }
  }

  function onButton() {
    setPlaying(!playing)
  }

  function onSelect(e) {
    themeId = e.target.value
    if (playing) bgm.start({ kind: 'theme', id: themeId, volume: 0.5 })
  }

  const timer = setInterval(tick, 250)

  window.addEventListener('resize', fit)
  button.addEventListener('click', onButton)
  themeSelect?.addEventListener('change', onSelect)

  fit()
  if (elapsedEl) elapsedEl.textContent = fmt(0)
  raf = requestAnimationFrame(draw)

  return {
    dispose() {
      clearInterval(timer)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      button.removeEventListener('click', onButton)
      themeSelect?.removeEventListener('change', onSelect)
      bgm.dispose()
    },
  }
}

/** 把 THEMES 填进 <select>（文案跟随语言）。 */
export function fillThemeOptions(select, lang) {
  select.innerHTML = ''
  for (const t of THEMES) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = `${lang === 'zh' ? t.zh : t.en} · ${lang === 'zh' ? t.note.zh : t.note.en}`
    select.append(opt)
  }
  select.value = THEMES[1].id
}
