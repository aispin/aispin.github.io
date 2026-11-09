/**
 * AI 房间（图鉴 · ATLAS）的程序化美术：色相、封面「信号图」、文案截断。
 *
 * 全部逐字搬自 `public/demos/web3d/ai-atlas/index.html` —— 用户 2026-11-09
 * 确认的就是那一版视觉，包括每个常量的具体数值。改这里请**先改 demo**，
 * 否则站内和 `/demos/web3d/ai-atlas/` 会长得不一样。
 *
 * 🔴 零位图：封面是 canvas 按 id 哈希画出来的，24 张各不相同。站规红线。
 */

/** FNV-1a。同一个 id 永远同一个种子 —— 刷新页面封面不该变。 */
export function hash32(s) {
    let h = 2166136261
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

/** 确定性伪随机（mulberry32）。 */
export function mulberry32(a) {
    return function next() {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** hsl → [r,g,b]，0~1。给 WebGL 的 uniform 用（它不认识 CSS 颜色串）。 */
export function hsl2rgb(h, s, l) {
    const hue = (((h % 360) + 360) % 360) / 360
    const sat = s / 100
    const lit = l / 100
    const a = sat * Math.min(lit, 1 - lit)
    const f = (n) => {
        const k = (n + hue * 12) % 12
        return lit - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    }
    return [f(0), f(8), f(4)]
}

/**
 * 每件一个色相：152°–204° 的青绿带，和站点其他房间同族，但每张卡认得出自己。
 *
 * 🔴 明度/饱和度和主题绑：62% 的亮青在纸上等于没颜色，浅色必须压到 33%
 *    才读得出，否则 24 张卡的编号、箭头、hover 边框会一起消失。
 */
export const hueOf = (id) => 152 + (hash32(`${id}|hue`) % 53)

export const accentOf = (id, light) =>
    `hsl(${hueOf(id)} ${light ? '58% 33%' : '74% 62%'})`

export const accentDim = (id, light) =>
    `hsl(${hueOf(id)} ${light ? '58% 33%' : '74% 62%'} / ${light ? '.32' : '.42'})`

export const accentRGB = (id, light) => hsl2rgb(hueOf(id), light ? 58 : 74, light ? 33 : 62)

/**
 * 24 张「信号图」：六种母题 × 每件自己的种子。
 *
 * 它们不是装饰 —— 是同族的证据：同一套底、同一套四角刻度、同一条基线，
 * 只有中间那张图不一样。所以任何一张单看都像"图鉴里的一页"。
 *
 * @param {HTMLCanvasElement} cv  480×264 的离屏/行内画布
 * @param {string} id
 * @param {boolean} light
 */
export function paintPlate(cv, id, light) {
    const W = cv.width
    const H = cv.height
    const g = cv.getContext('2d')
    if (!g) return
    const hue = hueOf(id)
    const rnd = mulberry32(hash32(`${id}|plate`))
    /* 纸上的线要更深、更实：同一条 0.09 的线在深底上看得见，在奶油纸上就没了。
       所以浅色用更深的墨 + 把 alpha 提上来（boost），母题的相对层次不变。 */
    const ink = light ? 26 : 64
    const sat = light ? 52 : 78
    const boost = light ? 2.1 : 1
    const acc = (a) => `hsla(${hue},${sat}%,${ink}%,${Math.min(1, a * boost)})`

    const bg = g.createLinearGradient(0, 0, W * 0.7, H)
    bg.addColorStop(0, light ? '#fcf4e6' : '#0b1017')
    bg.addColorStop(1, light ? '#f1e2cc' : '#070a0f')
    g.fillStyle = bg
    g.fillRect(0, 0, W, H)

    const halo = g.createRadialGradient(W * 0.74, H * 0.16, 0, W * 0.74, H * 0.16, W * 0.78)
    halo.addColorStop(0, `hsla(${hue},${light ? 56 : 76}%,${light ? 42 : 58}%,${light ? 0.14 : 0.18})`)
    halo.addColorStop(1, 'hsla(0,0%,0%,0)')
    g.fillStyle = halo
    g.fillRect(0, 0, W, H)

    g.lineCap = 'round'
    const kind = hash32(`${id}|kind`) % 6

    if (kind === 0) {
        /* 同心环 */
        const cx = W * 0.5
        const cy = H * 0.56
        for (let i = 0; i < 7; i += 1) {
            g.beginPath()
            g.arc(cx, cy, 24 + i * 21 + rnd() * 5, 0, Math.PI * 2)
            g.strokeStyle = acc(i % 3 === 0 ? 0.3 : 0.09)
            g.lineWidth = 1
            g.stroke()
        }
        g.beginPath()
        g.arc(cx, cy, 24 + 21 * 3, -0.95, 0.85)
        g.strokeStyle = acc(0.72)
        g.lineWidth = 2
        g.stroke()
    } else if (kind === 1) {
        /* 波形 */
        for (let i = 0; i < 13; i += 1) {
            const y = 18 + (i * (H - 36)) / 12
            const amp = 3 + rnd() * 9
            const f = 0.011 + rnd() * 0.018
            const ph = rnd() * 6.283
            g.beginPath()
            for (let x = 0; x <= W; x += 4) {
                const yy = y + Math.sin(x * f + ph) * amp * Math.sin((x / W) * Math.PI)
                if (x === 0) g.moveTo(x, yy)
                else g.lineTo(x, yy)
            }
            g.strokeStyle = acc(i % 4 === 0 ? 0.46 : 0.11)
            g.lineWidth = i % 4 === 0 ? 1.5 : 1
            g.stroke()
        }
    } else if (kind === 2) {
        /* 点阵 */
        const cols = 26
        const rows = 13
        for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
                const n = rnd()
                const x = ((c + 0.5) * W) / cols
                const y = ((r + 0.5) * H) / rows
                g.beginPath()
                g.arc(x, y, n > 0.88 ? 2.1 : n > 0.55 ? 1.15 : 0.65, 0, 6.283)
                g.fillStyle = n > 0.88 ? acc(0.7) : acc(0.1 + n * 0.1)
                g.fill()
            }
        }
    } else if (kind === 3) {
        /* 斜排线 */
        for (let i = -H; i < W; i += 8 + rnd() * 6) {
            g.beginPath()
            g.moveTo(i, 0)
            g.lineTo(i + H, H)
            g.strokeStyle = acc(0.11 + rnd() * 0.1)
            g.lineWidth = 1
            g.stroke()
        }
        g.save()
        g.translate(W * 0.64, H * 0.5)
        g.rotate(-0.86)
        g.fillStyle = acc(0.21)
        g.fillRect(-9, -H, 18, H * 2)
        g.restore()
    } else if (kind === 4) {
        /* 辐条 */
        const cx = W * 0.5
        const cy = H * 0.54
        for (let i = 0; i < 36; i += 1) {
            const a = (i / 36) * 6.283
            const r0 = 16
            const r1 = 46 + (i % 6 === 0 ? 44 : 16) + rnd() * 9
            g.beginPath()
            g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
            g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
            g.strokeStyle = i % 6 === 0 ? acc(0.5) : acc(0.17)
            g.lineWidth = 1
            g.stroke()
        }
        g.beginPath()
        g.arc(cx, cy, 90, 0, 6.283)
        g.strokeStyle = acc(0.3)
        g.lineWidth = 1
        g.stroke()
    } else {
        /* 频谱柱 */
        const n = 30
        for (let i = 0; i < n; i += 1) {
            const w = (W / n) * 0.46
            const x = ((i + 0.5) * W) / n
            const h = 6 + rnd() * rnd() * H * 0.66
            g.fillStyle = i % 7 === 0 ? acc(0.58) : acc(0.19)
            g.fillRect(x - w / 2, H - 16 - h, w, h)
        }
    }

    /* 同族标记：一条基线 + 四角刻度 —— 24 张都长这个样，才像一册图鉴 */
    g.strokeStyle = light ? 'rgba(120,92,66,.24)' : 'rgba(150,190,220,.13)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(0, H - 0.5)
    g.lineTo(W, H - 0.5)
    g.stroke()
    const corners = [
        [13, 13, 1, 1],
        [W - 13, 13, -1, 1],
        [13, H - 13, 1, -1],
        [W - 13, H - 13, -1, -1],
    ]
    for (const [x, y, dx, dy] of corners) {
        g.beginPath()
        g.moveTo(x, y + dy * 9)
        g.lineTo(x, y)
        g.lineTo(x + dx * 9, y)
        g.stroke()
    }
}

/**
 * 卡片只放得下两行，而英文原句常 200+ 字符。按**第一个从句**截断，让可见的
 * 两行是一个完整的意思（"Photos plus video into a 15–60s cut or a JianYing
 * draft"），而不是切在单词中间；全文挂在 `title` 上，悬停可看。
 */
export function brief(s, lang) {
    if (lang !== 'en') return s
    const m = String(s).match(/^(.{40,}?)(?::\s| — |\.\s|;\s)/)
    return m ? m[1] : s
}

/** 卡片标题去掉 `iskill-` 前缀 —— 24 张卡都带它，留着等于没信息。 */
export const shortName = (name) => String(name || '').replace(/^iskill-/, '')
