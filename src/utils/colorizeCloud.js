import * as THREE from 'three'

/**
 * colorizeCloud — paint a greyscale cloud sketch with canvas 2D.
 *
 * The cloud sketches are pure black-and-white line art (measured ink saturation
 * ~0), which is why they used to render as flat grey planes. Rather than baking
 * a coloured copy of each, the tint is composited at runtime, so the palette
 * stays in code and nothing extra is downloaded. The sketch now comes from
 * utils/cloudArt.js instead of eight webp files, but the compositing below is
 * unchanged — it only ever cared about alpha and luminance.
 *
 * Three passes on one canvas:
 *   1. a vertical two-stop gradient fills the plane,
 *   2. `destination-in` clips that gradient to the sketch's alpha, so the
 *      transparent paper around the cloud stays cut out,
 *   3. `multiply` lays the sketch back on top — its near-white fill leaves the
 *      tint alone, its ink outline and hatching darken it into a drawn edge.
 *
 * Results are cached per (sprite, tint) because every cloud in a chunk shares
 * the same handful of sprites; the cache is tiny and never needs eviction.
 */

const cache = new Map()
const TEX_WIDTH = 512

export function colorizeCloud(source, tint) {
  const image = source?.image
  if (!image || !image.width) return source

  const key = `${image.src || source.uuid}|${tint.top}|${tint.bottom}`
  const cached = cache.get(key)
  if (cached) return cached

  const height = Math.max(1, Math.round(TEX_WIDTH / (image.width / image.height)))
  const canvas = document.createElement('canvas')
  canvas.width = TEX_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // 1 — the tint itself
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, tint.top)
  gradient.addColorStop(1, tint.bottom)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, TEX_WIDTH, height)

  // 2 — keep the tint only where the sketch has ink
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0, TEX_WIDTH, height)

  // 3 — multiply the line art back over it
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(image, 0, 0, TEX_WIDTH, height)
  ctx.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  cache.set(key, texture)
  return texture
}

export default colorizeCloud
