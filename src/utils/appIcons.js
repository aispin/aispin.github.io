/**
 * appIcons — 运行时生成的应用图标。
 *
 * 仓库里不再有 favicon.png / apple-touch-icon.png / pwa-*.png。
 * - 现代浏览器读 public/favicon.svg（SVG 本身即代码）
 * - manifest 里同样是 SVG
 * - iOS 的 apple-touch-icon 不支持 SVG，所以这里用 canvas 现画一张 PNG
 *   data URL 再挂到 <link> 上。字节仍是浏览器在内存里编出来的，磁盘上
 *   没有任何图片文件。
 */

const PALETTE = {
  paper: '#FFF6E9',
  edge: '#E3CFAF',
  ink: '#5A4636',
  dot: '#C89B7B',
}

/**
 * 把 AISPIN 字标画进 canvas。
 * 几何以 512×512 为基准等比缩放，和 public/favicon.svg 保持一致。
 * @param {number} size 输出边长（像素）
 * @param {boolean} rounded 是否画圆角（favicon 用）/ 满铺（iOS 图标用）
 */
function paintIcon(size, rounded = true) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const k = size / 512
  const rr = (x, y, w, h, r) => {
    const rad = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rad, y)
    ctx.arcTo(x + w, y, x + w, y + h, rad)
    ctx.arcTo(x + w, y + h, x, y + h, rad)
    ctx.arcTo(x, y + h, x, y, rad)
    ctx.arcTo(x, y, x + w, y, rad)
    ctx.closePath()
  }

  // 底色
  ctx.fillStyle = PALETTE.paper
  if (rounded) {
    rr(0, 0, size, size, 104 * k)
    ctx.fill()
  } else {
    ctx.fillRect(0, 0, size, size)
  }

  // 描边
  ctx.strokeStyle = PALETTE.edge
  ctx.lineWidth = 7 * k
  if (rounded) {
    rr(10 * k, 10 * k, 492 * k, 492 * k, 94 * k)
  } else {
    rr(14 * k, 14 * k, 484 * k, 484 * k, 92 * k)
  }
  ctx.stroke()

  // A：两条斜腿 + 横梁
  ctx.strokeStyle = PALETTE.ink
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.lineWidth = 46 * k
  ctx.beginPath()
  ctx.moveTo(256 * k, 150 * k)
  ctx.lineTo(176 * k, 356 * k)
  ctx.moveTo(256 * k, 150 * k)
  ctx.lineTo(336 * k, 356 * k)
  ctx.stroke()

  ctx.lineWidth = 42 * k
  ctx.beginPath()
  ctx.moveTo(206 * k, 292 * k)
  ctx.lineTo(306 * k, 292 * k)
  ctx.stroke()

  // 圆点
  ctx.fillStyle = PALETTE.dot
  ctx.beginPath()
  ctx.arc(368 * k, 368 * k, 27 * k, 0, Math.PI * 2)
  ctx.fill()

  return canvas.toDataURL('image/png')
}

/**
 * 注入 apple-touch-icon（iOS 不支持 SVG，只能给它位图）。
 * 在 main.jsx 启动时调用一次。
 */
export function installAppleTouchIcon(size = 180) {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[rel="apple-touch-icon"]')) return
  const href = paintIcon(size, false)
  if (!href) return
  const link = document.createElement('link')
  link.rel = 'apple-touch-icon'
  link.setAttribute('sizes', `${size}x${size}`)
  link.href = href
  document.head.appendChild(link)
}

export { paintIcon }
