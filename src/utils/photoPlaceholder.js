/**
 * Procedural photo placeholders — drawn with the Canvas 2D API, uploaded as
 * THREE.CanvasTexture.
 *
 * Why this exists
 * ---------------
 * The gallery's hanging cards used to point at four static SVG files
 * (`/gallery-*.svg`). three.js allocates its WebGL textures as *immutable*
 * storage, so when the loader tries to push the decoded SVG bitmap a second
 * time the driver rejects it:
 *
 *     GL_INVALID_OPERATION: glTexImage2DRobustANGLE: Texture is immutable.
 *
 * The upload silently fails and the sampler returns black, which is why every
 * hanging card in the gallery rendered as a solid black rectangle.
 *
 * Rather than ship another raster file, each scene is drawn here at runtime:
 * no downloads, no decode step, crisp at any resolution, and it keeps the
 * project's "prefer procedural art over image assets" direction.
 *
 * Canvas size is 768x1024 (3:4) to exactly match the card plane's 1.5 x 2.
 */
import * as THREE from 'three'
import { hashString, mulberry32, withAlpha } from '../engine/art';

const W = 768
const H = 1024

const PAPER = '#FFF6E9'
const INK = '#5A4636'

/* ------------------------------------------------------------------ *
 * Small drawing helpers
 * ------------------------------------------------------------------ */

function sky(ctx, stops, bottom = H) {
  const g = ctx.createLinearGradient(0, 0, 0, bottom)
  for (const [pos, color] of stops) g.addColorStop(pos, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** Rolling hill filled down to the bottom edge, with a soft ink contour. */
function hill(ctx, baseY, amp, freq, phase, color, inkAlpha = 0.22, lw = 3) {
  ctx.beginPath()
  ctx.moveTo(-6, H + 6)
  ctx.lineTo(-6, baseY)
  for (let x = -6; x <= W + 6; x += 6) {
    const t = (x / W) * Math.PI * freq + phase
    const y = baseY + Math.sin(t) * amp + Math.sin(t * 2.3 + 1.1) * amp * 0.32
    ctx.lineTo(x, y)
  }
  ctx.lineTo(W + 6, H + 6)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  if (inkAlpha > 0) {
    ctx.strokeStyle = withAlpha(INK, inkAlpha)
    ctx.lineWidth = lw
    ctx.stroke()
  }
}

/** Soft radial glow used for sun / moon halos. */
function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r)
  g.addColorStop(0, withAlpha(color, alpha))
  g.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Soft haze band that melts a hard sea horizon into the sky. */
function horizonHaze(ctx, y, color = '#FFF6E9', alpha = 0.75, height = 92) {
  const g = ctx.createLinearGradient(0, y - height, 0, y + height * 0.5)
  g.addColorStop(0, withAlpha(color, alpha))
  g.addColorStop(0.5, withAlpha(color, alpha * 0.6))
  g.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, y - height, W, height * 1.5)
}

function disc(ctx, x, y, r, color, inkAlpha = 0.28) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  if (inkAlpha > 0) {
    ctx.strokeStyle = withAlpha(INK, inkAlpha)
    ctx.lineWidth = 3
    ctx.stroke()
  }
}

function cloud(ctx, x, y, s, color, alpha = 0.92) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  const puffs = [
    [0, 0, 1.0], [0.72, 0.1, 0.74], [-0.74, 0.14, 0.68],
    [0.36, -0.34, 0.62], [-0.34, -0.28, 0.56],
  ]
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ctx.ellipse(x + dx * s, y + dy * s, r * s, r * s * 0.78, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function cottage(ctx, x, baseY, s, { wall = '#FFF6E9', roof = '#C97B5A', lit = '#FFD98E', dark = false } = {}) {
  const w = 150 * s
  const h = 96 * s
  const top = baseY - h
  // walls
  ctx.fillStyle = wall
  ctx.strokeStyle = withAlpha(INK, 0.55)
  ctx.lineWidth = 3.4 * s
  ctx.beginPath()
  ctx.rect(x - w / 2, top, w, h)
  ctx.fill()
  ctx.stroke()
  // roof
  ctx.beginPath()
  ctx.moveTo(x - w / 2 - 16 * s, top)
  ctx.lineTo(x, top - 62 * s)
  ctx.lineTo(x + w / 2 + 16 * s, top)
  ctx.closePath()
  ctx.fillStyle = roof
  ctx.fill()
  ctx.stroke()
  // chimney
  ctx.beginPath()
  ctx.rect(x + w * 0.22, top - 74 * s, 16 * s, 30 * s)
  ctx.fillStyle = roof
  ctx.fill()
  ctx.stroke()
  // door
  ctx.beginPath()
  ctx.rect(x - 15 * s, baseY - 44 * s, 30 * s, 44 * s)
  ctx.fillStyle = dark ? '#8A6A4F' : '#B07A52'
  ctx.fill()
  ctx.stroke()
  // window
  const wx = x + w * 0.26
  const wy = top + h * 0.3
  ctx.beginPath()
  ctx.rect(wx - 17 * s, wy - 15 * s, 34 * s, 30 * s)
  ctx.fillStyle = lit
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(wx, wy - 15 * s)
  ctx.lineTo(wx, wy + 15 * s)
  ctx.moveTo(wx - 17 * s, wy)
  ctx.lineTo(wx + 17 * s, wy)
  ctx.stroke()
}

function pine(ctx, x, baseY, s, leaf = '#7FA37A') {
  ctx.fillStyle = '#8A6A4F'
  ctx.strokeStyle = withAlpha(INK, 0.5)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.rect(x - 6 * s, baseY - 26 * s, 12 * s, 26 * s)
  ctx.fill()
  ctx.stroke()
  for (let i = 0; i < 3; i++) {
    const y = baseY - 22 * s - i * 40 * s
    const half = (76 - i * 18) * s
    ctx.beginPath()
    ctx.moveTo(x - half, y)
    ctx.lineTo(x, y - 60 * s)
    ctx.lineTo(x + half, y)
    ctx.closePath()
    ctx.fillStyle = leaf
    ctx.fill()
    ctx.stroke()
  }
}

function roundTree(ctx, x, baseY, s, leaf = '#8FB07E') {
  ctx.fillStyle = '#8A6A4F'
  ctx.strokeStyle = withAlpha(INK, 0.5)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.rect(x - 7 * s, baseY - 74 * s, 14 * s, 74 * s)
  ctx.fill()
  ctx.stroke()
  const blobs = [[0, -96, 62], [-46, -74, 44], [46, -76, 46], [0, -140, 46]]
  for (const [dx, dy, r] of blobs) {
    ctx.beginPath()
    ctx.arc(x + dx * s, baseY + dy * s, r * s, 0, Math.PI * 2)
    ctx.fillStyle = leaf
    ctx.fill()
    ctx.stroke()
  }
}

function birds(ctx, x, y, s, n = 3, spread = 46) {
  ctx.strokeStyle = withAlpha(INK, 0.62)
  ctx.lineWidth = 3 * s
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const bx = x + i * spread * s
    const by = y + Math.sin(i * 1.7) * 16 * s
    const r = 11 * s
    ctx.beginPath()
    ctx.moveTo(bx - r, by)
    ctx.quadraticCurveTo(bx - r * 0.5, by - r * 0.8, bx, by)
    ctx.quadraticCurveTo(bx + r * 0.5, by - r * 0.8, bx + r, by)
    ctx.stroke()
  }
}

function rain(ctx, rnd, n, slant = -0.26) {
  ctx.strokeStyle = withAlpha('#8FA8BD', 0.55)
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const x = rnd() * (W + 160) - 80
    const y = rnd() * H
    const len = 26 + rnd() * 44
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + slant * len, y + len)
    ctx.stroke()
  }
}

function stars(ctx, rnd, n) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * W
    const y = rnd() * H * 0.66
    const r = 1.2 + rnd() * 2.6
    ctx.globalAlpha = 0.35 + rnd() * 0.6
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = '#FFF4D2'
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function waveLines(ctx, baseY, rows, color, alpha) {
  ctx.strokeStyle = withAlpha(color, alpha)
  ctx.lineWidth = 3
  for (let r = 0; r < rows; r++) {
    const y = baseY + r * 30
    const amp = 5 + r * 1.2
    ctx.beginPath()
    for (let x = -6; x <= W + 6; x += 8) {
      ctx.lineTo(x, y + Math.sin((x / W) * Math.PI * 5 + r * 1.3) * amp)
    }
    ctx.stroke()
  }
}

function flowers(ctx, rnd, count, yMin, yMax, palette) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * W
    const y = yMin + rnd() * (yMax - yMin)
    const s = 0.7 + rnd() * 0.8
    ctx.strokeStyle = withAlpha('#6E8F63', 0.85)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + 24 * s)
    ctx.stroke()
    const color = palette[Math.floor(rnd() * palette.length)]
    ctx.beginPath()
    ctx.arc(x, y, 7 * s, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
}

/** Faint paper grain + warm vignette so every scene sits on the same stock. */
function finish(ctx, rnd, { vignette = 0.1 } = {}) {
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const a = rnd() * 0.05
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(90,70,54,${a * 0.8})`
    ctx.fillRect(x, y, 1.6, 1.6)
  }
  if (vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78)
    g.addColorStop(0, 'rgba(90,70,54,0)')
    g.addColorStop(1, `rgba(90,70,54,${vignette})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
}

/* ------------------------------------------------------------------ *
 * Scenes — one per photography card
 * ------------------------------------------------------------------ */

function sceneMorning(ctx, rnd) {
  sky(ctx, [[0, '#FFE9C6'], [0.42, '#FFF1DF'], [1, '#FFF6E9']], H * 0.86)
  glow(ctx, 540, 250, 300, '#FFD98E', 0.55)
  disc(ctx, 540, 250, 74, '#FFDE9C', 0.22)
  cloud(ctx, 210, 200, 62, '#FFFDF6', 0.9)
  cloud(ctx, 640, 372, 46, '#FFFDF6', 0.78)
  hill(ctx, 610, 34, 2.0, 0.4, '#BBD3E0')
  hill(ctx, 700, 30, 1.6, 2.1, '#A8C69F')
  hill(ctx, 806, 26, 1.4, 3.4, '#8FB07E')
  roundTree(ctx, 150, 872, 1.15, '#7FA37A')
  cottage(ctx, 470, 892, 1.15, { roof: '#C97B5A', lit: '#FFD98E' })
  ctx.strokeStyle = withAlpha(INK, 0.3)
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(430, H)
  ctx.quadraticCurveTo(470, 936, 508, 902)
  ctx.stroke()
  finish(ctx, rnd, { vignette: 0.08 })
}

function sceneGarden(ctx, rnd) {
  sky(ctx, [[0, '#EAF3E2'], [0.45, '#F7F4E4'], [1, '#FFF6E9']], H * 0.8)
  glow(ctx, 168, 190, 220, '#FFF0B8', 0.5)
  disc(ctx, 168, 190, 46, '#FFF0B8', 0.2)
  cloud(ctx, 520, 168, 52, '#FFFDF6', 0.85)
  hill(ctx, 560, 40, 2.2, 1.2, '#B7CE9E')
  hill(ctx, 664, 34, 1.8, 2.9, '#9DBE86')
  hill(ctx, 786, 30, 1.5, 4.3, '#7FA36C')
  roundTree(ctx, 596, 812, 1.35, '#6E9160')
  roundTree(ctx, 168, 856, 0.9, '#84A772')
  // garden arch
  ctx.strokeStyle = withAlpha(INK, 0.5)
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.arc(384, 800, 120, Math.PI, Math.PI * 2)
  ctx.moveTo(264, 800)
  ctx.lineTo(264, 950)
  ctx.moveTo(504, 800)
  ctx.lineTo(504, 950)
  ctx.stroke()
  flowers(ctx, rnd, 46, 812, 1000, ['#E8A0A8', '#F2C97D', '#D9A6C4', '#FFF0C2', '#C98A7A'])
  finish(ctx, rnd, { vignette: 0.09 })
}

function sceneRain(ctx, rnd) {
  sky(ctx, [[0, '#C9D7E2'], [0.5, '#DCE5EC'], [1, '#EFF3F6']], H * 0.84)
  cloud(ctx, 200, 168, 76, '#F4F8FB', 0.95)
  cloud(ctx, 590, 236, 62, '#EDF3F8', 0.9)
  cloud(ctx, 396, 120, 50, '#F8FBFD', 0.8)
  hill(ctx, 620, 26, 1.7, 1.0, '#A9BCC9')
  hill(ctx, 742, 22, 1.4, 3.0, '#93A9B8')
  // The wall the window is set into, so the frame reads as part of a building.
  ctx.fillStyle = '#E6DCCA'
  ctx.strokeStyle = withAlpha(INK, 0.3)
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.rect(96, 372, 576, 556)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = withAlpha('#C9BCA4', 0.5)
  ctx.fillRect(96, 928, 576, 10)
  // window frame
  ctx.fillStyle = '#FFF6E9'
  ctx.strokeStyle = withAlpha(INK, 0.6)
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.rect(196, 440, 376, 366)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(384, 440)
  ctx.lineTo(384, 806)
  ctx.moveTo(196, 623)
  ctx.lineTo(572, 623)
  ctx.stroke()
  // glass tint
  ctx.fillStyle = withAlpha('#9FB6C9', 0.34)
  ctx.fillRect(200, 444, 181, 176)
  ctx.fillRect(387, 444, 182, 176)
  ctx.fillRect(200, 626, 181, 176)
  ctx.fillRect(387, 626, 182, 176)
  // curtains drawn back on both sides
  ctx.fillStyle = withAlpha('#F6E7D4', 0.8)
  ctx.beginPath()
  ctx.moveTo(200, 444)
  ctx.quadraticCurveTo(262, 600, 232, 802)
  ctx.lineTo(200, 802)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(568, 444)
  ctx.quadraticCurveTo(510, 600, 540, 802)
  ctx.lineTo(568, 802)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = withAlpha(INK, 0.35)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(232, 802)
  ctx.quadraticCurveTo(262, 600, 200, 444)
  ctx.moveTo(540, 802)
  ctx.quadraticCurveTo(510, 600, 568, 444)
  ctx.stroke()
  // sill
  ctx.fillStyle = '#D8CBB4'
  ctx.strokeStyle = withAlpha(INK, 0.5)
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.rect(172, 806, 424, 26)
  ctx.fill()
  ctx.stroke()
  rain(ctx, rnd, 210)
  // puddle on the ground below
  ctx.fillStyle = withAlpha('#9FB6C9', 0.55)
  ctx.beginPath()
  ctx.ellipse(384, 972, 240, 26, 0, 0, Math.PI * 2)
  ctx.fill()
  finish(ctx, rnd, { vignette: 0.12 })
}

function sceneSeaside(ctx, rnd) {
  sky(ctx, [[0, '#BFE0EE'], [0.38, '#E4F1F4'], [0.62, '#FFF3DF'], [1, '#FFF6E9']], H * 0.72)
  glow(ctx, 250, 300, 260, '#FFD98E', 0.5)
  disc(ctx, 250, 300, 62, '#FFE3A8', 0.22)
  cloud(ctx, 560, 210, 58, '#FFFDF6', 0.92)
  cloud(ctx, 168, 402, 40, '#FFFDF6', 0.75)
  // sea
  ctx.fillStyle = '#8FC0D6'
  ctx.fillRect(0, 470, W, 250)
  horizonHaze(ctx, 470, '#EAF4F7', 0.85)
  waveLines(ctx, 512, 6, '#5F93AE', 0.5)
  // sand
  hill(ctx, 706, 16, 1.3, 0.6, '#E8D5AE')
  // grass tufts on the dune
  for (let i = 0; i < 30; i++) {
    const x = rnd() * W
    const y = 720 + rnd() * 120
    ctx.strokeStyle = withAlpha('#8FA36A', 0.8)
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - 6, y - 22)
    ctx.moveTo(x, y)
    ctx.lineTo(x + 2, y - 26)
    ctx.moveTo(x, y)
    ctx.lineTo(x + 9, y - 20)
    ctx.stroke()
  }
  birds(ctx, 470, 336, 0.9, 3, 52)
  // footprints
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = withAlpha('#C9AE84', 0.75)
    ctx.beginPath()
    ctx.ellipse(120 + i * 78, 858 + i * 22, 15, 9, -0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  finish(ctx, rnd, { vignette: 0.08 })
}

function sceneEvening(ctx, rnd) {
  sky(ctx, [[0, '#E7A07A'], [0.28, '#F2B27A'], [0.52, '#F7D5A8'], [1, '#FFF1DF']], H * 0.82)
  glow(ctx, 384, 560, 330, '#FFCE8A', 0.6)
  disc(ctx, 384, 560, 78, '#FFC97D', 0.24)
  cloud(ctx, 196, 236, 56, '#F6C39A', 0.7)
  cloud(ctx, 588, 320, 44, '#F2B98F', 0.6)
  hill(ctx, 660, 30, 1.8, 1.6, '#9C8AA0')
  hill(ctx, 760, 26, 1.5, 3.2, '#7C7391')
  cottage(ctx, 384, 902, 1.35, { wall: '#F3E4D2', roof: '#8E5F63', lit: '#FFD98E', dark: true })
  pine(ctx, 168, 900, 1.0, '#5F7A63')
  pine(ctx, 600, 890, 0.8, '#5F7A63')
  // warm path
  ctx.fillStyle = withAlpha('#E8C79A', 0.85)
  ctx.beginPath()
  ctx.moveTo(360, 902)
  ctx.lineTo(408, 902)
  ctx.lineTo(510, H)
  ctx.lineTo(258, H)
  ctx.closePath()
  ctx.fill()
  birds(ctx, 540, 430, 0.85, 3, 48)
  finish(ctx, rnd, { vignette: 0.12 })
}

function sceneGreen(ctx, rnd) {
  sky(ctx, [[0, '#D7E8E0'], [0.42, '#EAF3E6'], [1, '#FFF6E9']], H * 0.8)
  glow(ctx, 384, 200, 300, '#FFF6C8', 0.45)
  // rainbow
  const rb = ['#E8A0A8', '#F2C97D', '#A8C69F', '#9FB6C9', '#C2A6D6']
  rb.forEach((c, i) => {
    ctx.beginPath()
    ctx.arc(384, 700, 400 - i * 26, Math.PI * 1.06, Math.PI * 1.94)
    ctx.strokeStyle = withAlpha(c, 0.42)
    ctx.lineWidth = 22
    ctx.stroke()
  })
  hill(ctx, 620, 34, 2.1, 0.9, '#B9D3A0')
  hill(ctx, 722, 28, 1.7, 2.6, '#95BA7E')
  hill(ctx, 826, 24, 1.4, 4.1, '#789F64')
  // puddle reflecting the sky
  ctx.fillStyle = withAlpha('#BBD3E0', 0.72)
  ctx.beginPath()
  ctx.ellipse(384, 906, 210, 46, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = withAlpha('#7FA3B8', 0.55)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.ellipse(384, 906, 210, 46, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(360, 902, 130, 24, 0, 0, Math.PI * 2)
  ctx.stroke()
  // sprout
  ctx.strokeStyle = withAlpha('#5F8A4E', 0.95)
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(384, 866)
  ctx.lineTo(384, 774)
  ctx.stroke()
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(384, 806)
    ctx.quadraticCurveTo(384 + dir * 46, 776, 384 + dir * 62, 812)
    ctx.quadraticCurveTo(384 + dir * 34, 818, 384, 806)
    ctx.fillStyle = '#8CBB72'
    ctx.fill()
    ctx.stroke()
  }
  flowers(ctx, rnd, 34, 828, 990, ['#F2C97D', '#E8A0A8', '#FFF0C2', '#D9A6C4'])
  finish(ctx, rnd, { vignette: 0.08 })
}

function sceneNight(ctx, rnd) {
  sky(ctx, [[0, '#2C3A58'], [0.45, '#3D4F70'], [0.72, '#5C6E88'], [1, '#8A94A4']], H * 0.8)
  stars(ctx, rnd, 120)
  glow(ctx, 556, 208, 200, '#FFF4D2', 0.42)
  disc(ctx, 556, 208, 58, '#FFF6DC', 0.2)
  // town silhouette
  ctx.fillStyle = '#3A4761'
  const buildings = [
    [40, 150, 96], [150, 96, 120], [258, 190, 84], [356, 130, 104],
    [474, 216, 92], [580, 160, 118], [706, 120, 78],
  ]
  for (const [x, bh, bw] of buildings) {
    const top = 660 - bh
    ctx.beginPath()
    ctx.rect(x, top, bw, 660 - top)
    ctx.fill()
  }
  // lit windows
  for (const [x, bh, bw] of buildings) {
    const top = 660 - bh
    for (let r = 0; r < Math.floor(bh / 42); r++) {
      for (let c = 0; c < Math.floor(bw / 34); c++) {
        if (rnd() < 0.42) continue
        ctx.fillStyle = rnd() > 0.4 ? '#FFD98E' : '#F7C27A'
        ctx.fillRect(x + 12 + c * 34, top + 16 + r * 42, 15, 20)
      }
    }
  }
  hill(ctx, 700, 22, 1.6, 1.4, '#2E3A52', 0.18)
  // road with lamp posts
  ctx.fillStyle = withAlpha('#4A5570', 0.9)
  ctx.beginPath()
  ctx.moveTo(340, 700)
  ctx.lineTo(428, 700)
  ctx.lineTo(540, H)
  ctx.lineTo(228, H)
  ctx.closePath()
  ctx.fill()
  for (const [lx, ly] of [[300, 782], [474, 782]]) {
    ctx.strokeStyle = withAlpha('#20283A', 0.95)
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(lx, ly)
    ctx.lineTo(lx, ly - 84)
    ctx.stroke()
    glow(ctx, lx, ly - 88, 74, '#FFD98E', 0.5)
    disc(ctx, lx, ly - 88, 11, '#FFE8AE', 0.35)
  }
  finish(ctx, rnd, { vignette: 0.2 })
}

function sceneCoast(ctx, rnd) {
  sky(ctx, [[0, '#CFE4EE'], [0.34, '#E8F1F3'], [0.58, '#FFF6E4'], [1, '#FFF6E9']], H * 0.7)
  cloud(ctx, 214, 172, 72, '#FFFDF6', 0.94)
  cloud(ctx, 588, 262, 56, '#FFFDF6', 0.86)
  cloud(ctx, 384, 108, 44, '#FFFDF6', 0.72)
  // sea
  ctx.fillStyle = '#7FB3C8'
  ctx.fillRect(0, 440, W, 300)
  horizonHaze(ctx, 440, '#EAF4F7', 0.85)
  waveLines(ctx, 486, 8, '#4F86A0', 0.5)
  // sail boat
  ctx.fillStyle = '#FFF6E9'
  ctx.strokeStyle = withAlpha(INK, 0.6)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(560, 372)
  ctx.lineTo(560, 452)
  ctx.lineTo(618, 452)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(552, 452)
  ctx.lineTo(644, 452)
  ctx.lineTo(624, 478)
  ctx.lineTo(572, 478)
  ctx.closePath()
  ctx.fillStyle = '#C97B5A'
  ctx.fill()
  ctx.stroke()
  hill(ctx, 742, 18, 1.4, 0.8, '#E3D2A8')
  // wind-bent grass
  for (let i = 0; i < 70; i++) {
    const x = rnd() * (W + 40) - 20
    const y = 760 + rnd() * 250
    const bend = 16 + rnd() * 22
    const hgt = 30 + rnd() * 42
    ctx.strokeStyle = withAlpha('#8FA36A', 0.72 + rnd() * 0.24)
    ctx.lineWidth = 2.2 + rnd() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + bend * 0.4, y - hgt * 0.6, x + bend, y - hgt)
    ctx.stroke()
  }
  birds(ctx, 168, 300, 1.0, 4, 46)
  finish(ctx, rnd, { vignette: 0.08 })
}

const SCENES = {
  morning: sceneMorning,
  garden: sceneGarden,
  rain: sceneRain,
  seaside: sceneSeaside,
  evening: sceneEvening,
  green: sceneGreen,
  night: sceneNight,
  coast: sceneCoast,
}

export const PHOTO_VARIANTS = Object.keys(SCENES)

const cache = new Map()

/**
 * Returns a cached CanvasTexture for the given scene variant.
 * Unknown variants fall back to `morning` so a typo can never blank a card.
 */
export function photoPlaceholderTexture(variant) {
  const key = SCENES[variant] ? variant : 'morning'
  const cached = cache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)
  SCENES[key](ctx, mulberry32(hashString(key)))

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  cache.set(key, texture)
  return texture
}
