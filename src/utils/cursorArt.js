/**
 * cursorArt — 程序化光标。
 *
 * 整站的自定义光标（一把吉他）不再是 png 素材，而是一段 32×32 的像素画
 * 源码：每行一个字符串，每个字符对应调色板里的一个颜色，'.' 表示透明。
 * 运行时把它画进离屏 canvas，再 toDataURL() 交给 CSS 的 cursor 使用。
 *
 * 为什么用 data URL 而不是 SVG：
 *   Chrome / Safari 至今不支持 SVG 光标（只有 Firefox 支持），所以光标是
 *   全站唯一必须交给浏览器位图的地方。这里仍然满足「零图片文件」——
 *   位图由代码在运行时生成，仓库里没有任何 .png / .jpg。
 */

/* ------------------------------------------------------------------ *
 * 调色板：与站内暖色系（奶油纸 / 墨棕 / 木橙 / 浅木）保持一致
 * ------------------------------------------------------------------ */
const C = {
  cream: [255, 246, 233],
  ink: [90, 70, 54],
  wood: [224, 141, 82],
  tan: [232, 200, 168],
  dark: [74, 56, 42],
}

const rgba = ([r, g, b], alpha = 255) => `rgba(${r},${g},${b},${alpha / 255})`

/* ------------------------------------------------------------------ *
 * 像素画：吉他（默认）+ 拨片（可点击）
 * ------------------------------------------------------------------ */

// 竖向吉他：琴头 / 琴颈 / 琴身 / 琴弦
const GUITAR_DEFAULT = {
  palette: { b: C.ink, c: C.wood, a: C.cream, d: C.tan },
  rows: [
    '............bbb.................',
    '..........cbbbbbc...............',
    '.........cccbbbccc..............',
    '.........cccbbbccc..............',
    '..........c.aaa.c...............',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '............aaa.................',
    '........bbbbaaabbbb.............',
    '...........caaac................',
    '...........caaac................',
    '........dddcaaacdd..............',
    '........dddcaaacdd..............',
    '............aaa.................',
    '............aaa.................',
    '......bbbbbbaaabbbbbb...........',
    '............aaa.................',
    '.........bbbaaabbb..............',
    '.........bbbbbbbbb..............',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ],
}

// 斜向拨片：悬停 / 可点击态
const GUITAR_POINTER = {
  palette: { a: C.ink, b: C.wood, c: C.cream, d: C.tan, e: C.dark },
  rows: [
    'b....bb.........................',
    '......bbaaa..b..................',
    '......bbaaaabbb.................',
    '......bbaaaabbb.................',
    '......bbbaaa.b..................',
    'b....bbbbacca...................',
    'bbbbbb.b.acca...................',
    '.bbbb....aacc...................',
    '.........aacc...................',
    '..........acc...................',
    '..........acca..................',
    '..........aacc..................',
    '...........acc..................',
    '...........acc..................',
    '...........acca.................',
    '..........aaaccaa...............',
    '........aaaaaccaaaa.............',
    '..........aaaccba...............',
    '...........bbccebb..............',
    '.........ddbeeccebd.............',
    '.........ddbbeccbbd.............',
    '.............bcc................',
    '...........aaaccaaa.............',
    '........aaaaaaaccaaaaa..........',
    '........aaaaaaaccaaaaa..........',
    '...........aaaaccaaa............',
    '............aaaa................',
    '............a...................',
    '................................',
    '................................',
    '................................',
    '................................',
  ],
}

export const CURSOR_ART = {
  default: GUITAR_DEFAULT,
  pointer: GUITAR_POINTER,
}

// 热点：琴头 / 拨片尖，单位是 32px 画布上的像素
export const CURSOR_HOTSPOT = { default: [13, 2], pointer: [13, 2] }

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

const cache = new Map()

function paintCursor(art, scale) {
  const size = art.rows.length
  const canvas = document.createElement('canvas')
  canvas.width = size * scale
  canvas.height = size * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  for (let y = 0; y < size; y++) {
    const row = art.rows[y]
    for (let x = 0; x < size; x++) {
      const colour = art.palette[row[x]]
      if (!colour) continue // '.' 以及任何未登记的字符 => 透明
      ctx.fillStyle = rgba(colour)
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }

  return canvas.toDataURL('image/png')
}

/**
 * 取得某一种光标的 data URL（按名称与倍率缓存）。
 * @param {'default'|'pointer'} name
 * @param {number} scale 生成倍率，1 = 32×32
 */
export function getCursorUrl(name = 'default', scale = 1) {
  if (typeof document === 'undefined') return ''
  const art = CURSOR_ART[name] || CURSOR_ART.default
  const key = `${name}@${scale}`
  if (!cache.has(key)) cache.set(key, paintCursor(art, scale))
  return cache.get(key)
}

/** 完整的 CSS cursor 值，含热点与兜底关键字。 */
export function getCursorValue(name = 'default', fallback = 'auto') {
  const url = getCursorUrl(name)
  if (!url) return fallback
  const [hx, hy] = CURSOR_HOTSPOT[name] || CURSOR_HOTSPOT.default
  return `url("${url}") ${hx} ${hy}, ${fallback}`
}

/**
 * 把光标注入 CSS 变量，供 SCSS 静态规则使用（_base.scss）。
 * 在 main.jsx 启动时调用一次。
 */
export function installCursorVariables() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--zeo-cursor-default', getCursorValue('default', 'auto'))
  root.style.setProperty('--zeo-cursor-pointer', getCursorValue('pointer', 'pointer'))
}
