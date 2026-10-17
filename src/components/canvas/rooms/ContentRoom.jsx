import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import gsap from 'gsap'
import { useScene } from '../../../context/SceneContext'
import { useSitePreferences } from '../../../context/SitePreferences'
import { getLocalizedCollection } from '../../../hooks/useContentData'
import { NOVELS, PALETTE, ROOM_COPY, SCENE_FONTS, TEXT } from '../../../config/theme'
import { setGuitarCursor } from '../../../utils/guitarCursor'
import { texturalCanvas } from '../../../utils/texturalArt'
import './ContentRoom.scss'
import { sharedGeometry } from '../../../engine/resources';

const ROOM_TITLES = {
  zh: { career: '履历', studio: '项目与实验室', posts: '文稿与随笔', videos: '短视频作品', music: '原创音乐', ai: 'AI Skills 与应用' },
  en: { career: 'Career', studio: 'Projects & labs', posts: 'Notes & writing', videos: 'Short videos', music: 'Original music', ai: 'AI skills & apps' },
}

const ROOM_LABELS = {
  zh: {
    experience: '工作经历', projects: '代表项目', skills: '关注方向', labs: '实验室',
    published: '发布于', read: '打开内容', play: '试听作品', repo: '查看项目', demo: '在线演示',
    comingSoon: '作品准备中', empty: '内容整理中，稍后再来看看。',
    page: '页', prev: '上一页', next: '下一页', novels: '小说', external: '站外',
  },
  en: {
    experience: 'Experience', projects: 'Selected projects', skills: 'Focus areas', labs: 'Labs',
    published: 'Published', read: 'Read more', play: 'Listen', repo: 'Repository', demo: 'Live demo',
    comingSoon: 'Coming soon', empty: 'This room is being prepared. Please come back soon.',
    page: 'page', prev: 'Previous', next: 'Next', novels: 'Novels', external: 'External',
  },
}

const ITEM_KIND = {
  articles: { platform: 'POST', layout: 'editorial' },
  projects: { platform: 'PROJECT', layout: 'editorial' },
  labs: { platform: 'LAB', layout: 'editorial' },
  music: { platform: 'MUSIC', layout: 'editorial' },
  videos: { platform: 'VIDEO', layout: 'editorial' },
  aiProjects: { platform: 'AI+', layout: 'editorial' },
  experience: { platform: 'EXPERIENCE', layout: 'editorial' },
}

/* ------------------------------------------------------------------ *
 * Card wall geometry — all in the room's local units.
 *
 * Sizing is driven by measurement, not guesswork. When you walk through a
 * door the camera parks ~7.3 units in front of the back wall (DoorSection
 * aligns it at the door's Z, DOOR_ALIGN_X off-centre, rotated by
 * DOOR_LOOK_ANGLE) with a 60° vertical fov. At that distance a head-on wall
 * shows only ~14.9 x 8.4 world units on a 1600x900 viewport, i.e. ~107 px
 * per world unit.
 *
 * The first pass of this grid was 19.9 x 10.25 units, which projected to
 * ~2000 x 1080 px — the whole wall overflowed on both axes. The numbers
 * below fit the real frustum with a small margin:
 *     grid  13.2 x 6.8 units  ->  ~1414 x 730 px  (88% x 81% of the frame)
 * Verify with: PROBE_REAL=1 node /tmp/probe_cards.mjs <room>
 *
 * 🔴 THE GRID IS PER-ROOM (2026-10-17). The career room shows exactly eight
 * experiences and must fit them on ONE page, so it runs a 4x2 grid with
 * taller cards. Everything else keeps the original 4x3 — changing the
 * default grid would have re-flowed five other rooms that nobody asked
 * about. `makeLayout()` derives width/height/header from whichever grid is
 * picked, so the two can never drift apart.
 * ------------------------------------------------------------------ */
const GRID_DEFAULT = {
  cols: 4,
  rows: 3,
  cardW: 3.05,
  cardH: 2.03,
  gapX: 0.34,
  gapY: 0.36,
  centerY: 0.6,
  z: -9.4,
}

/**
 * 4 x 2, and the cards are taller because each one now carries a date, a
 * company, a role line and three or four lines of body copy.
 *
 * The numbers are checked against the frustum above: the visible window is
 * 16.59 x 9.35 centred on wall-local y = +0.65, i.e. x ∈ [-8.3, 8.3],
 * y ∈ [-4.0, 5.3]. This grid spans x ±6.61 and y [-2.36, 3.06]; the header
 * title lands at 4.30 — inside, with ~1.0 units to spare.
 */
const GRID_CAREER = {
  cols: 4,
  rows: 2,
  cardW: 3.05,
  cardH: 2.45,
  gapX: 0.34,
  gapY: 0.44,
  centerY: 0.35,
  z: -9.4,
  /**
   * 🔴 Texture width, not a world size. A card is 3.05 units wide and lands on
   * roughly 344 screen px, so a 512 px texture is downscaled and its 20 px body
   * copy renders at ~13 px — too small to read. Authoring the same layout on a
   * 448 px texture lands the body at ~15 px and the title at ~24 px, which is
   * what the taller card needs. Nothing else moves.
   */
  texW: 448,
}

/**
 * Card-face texture width. Height follows each card's world aspect so the
 * artwork is never stretched: the default 3.05 x 2.03 card lands on 512 x 340,
 * the career card on 448 x 360 (see `GRID_CAREER.texW` for why it is not 512).
 *
 * ⚠️ Declared BEFORE `makeLayout()` on purpose — `LAYOUTS` is built at module
 * evaluation time and reads this, so putting it lower is a TDZ crash
 * ("Cannot access 'CARD_TEX_LONG' before initialization") that blanks the
 * whole scene.
 */
const CARD_TEX_LONG = 512

/**
 * Header band above the wall. Derived from the grid so the two never collide
 * when the grid is retuned. The pager sits on the title row, right-aligned,
 * because there is no room below the grid once it fills the frame.
 */
function makeLayout(grid) {
  const gridW = grid.cols * grid.cardW + (grid.cols - 1) * grid.gapX
  const gridH = grid.rows * grid.cardH + (grid.rows - 1) * grid.gapY
  const gridTop = grid.centerY + gridH / 2
  const texW = grid.texW || CARD_TEX_LONG
  return {
    grid,
    gridW,
    gridH,
    gridTop,
    perPage: grid.cols * grid.rows,
    texW,
    /** Texture height follows the card's world aspect — never stretched. */
    texH: Math.round((texW * grid.cardH) / grid.cardW),
    header: {
      titleY: gridTop + 1.24,
      descY: gridTop + 0.57,
      titleSize: 0.68,
      descSize: 0.26,
      /** Keep the centred title clear of the right-aligned pager. */
      titleMaxWidth: gridW - 6.2,
      pagerX: gridW / 2 - 1.7,
      pagerY: gridTop + 1.09,
      /**
       * The pager sits on the SAME z as the header text, not on the card plane.
       * It is 3.7 units above the camera axis, so the 0.5-unit depth difference
       * to GRID.z would scale that offset by ~7% (~30px) and shove the tab off
       * the top of the screen. Matching the header plane keeps "same y => same
       * screen y".
       */
      pagerZ: grid.z - 0.5,
    },
  }
}

const LAYOUTS = {
  default: makeLayout(GRID_DEFAULT),
  career: makeLayout(GRID_CAREER),
}

const layoutFor = (roomId) => LAYOUTS[roomId] || LAYOUTS.default

/**
 * Headless layout probes read `window.__room`. The write lives in a module
 * helper on purpose: assigning to a global straight from the component body
 * makes `react-hooks/immutability` read it as "the component is modifying a
 * value defined outside itself" and fail the build with a hard error.
 *
 * 🔴 Two instances are alive at once: `RoomWarmup` mounts a hidden copy of every
 * room 500 units below the scene, and it is still mounted when the real room
 * appears (it self-destructs on `isDone`, which can land *after* `teleport` —
 * notably when three's `compileAsync` poll throws and the 6s bail takes over).
 * So the cleanup must only remove **its own** function: an unconditional
 * `delete window.__room` lets the warm-up copy wipe the live room's probe, and
 * the probe then reports "room not mounted" while the room is perfectly fine.
 */
function installRoomProbe(fn) {
  window.__room = fn
  return fn
}

function removeRoomProbe(fn) {
  if (window.__room === fn) delete window.__room
}

/** One accent per room; cards mix their ink/bloom/rule variants from it. */
const ACCENT = {
  career: '#E0A46A',
  studio: '#7FB3A0',
  posts: '#D9908F',
  videos: '#8FA8D9',
  music: '#C39BD9',
  ai: '#D9BE79',
}

const CANVAS_FONT = "'Maple Mono', 'MapleUI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

function toPlainText(markdown = '') {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function openItem(openOverlay, item, kind, labels) {
  const config = ITEM_KIND[kind] || ITEM_KIND.projects
  const summary = item.description || item.summary || item.excerpt || ''
  const rawBody = item.body || ''
  // Career rows put the role/department on `subtitle` (the card renders it as
  // its own line); the overlay has no such slot, so it leads the description.
  const lead = toPlainText(summary || rawBody)
  openOverlay({
    title: item.title || item.name || item.label || 'AISPIN',
    description: [item.subtitle, lead].filter(Boolean).join(' · ').slice(0, 260),
    body: rawBody,
    url: item.url || item.demoUrl || item.repository || '',
    date: item.publishedAt || item.startDate || '',
    platformConfig: { label: config.platform },
    layout: config.layout,
    actionLabel: kind === 'music' ? labels.play : kind === 'aiProjects' ? labels.repo : labels.read,
  })
}

/* ------------------------------------------------------------------ *
 * Procedural card art (canvas 2D -> CanvasTexture).
 * No image assets: everything is drawn at runtime, so the room has zero
 * texture downloads and stays crisp at any resolution.
 * ------------------------------------------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/* ------------------------------------------------------------------ *
 * Colour helpers.
 *
 * Every card carries ONE accent, and the design needs it in three roles: as
 * ink (the kicker, which has to stay readable on cream), as a tint (the bloom
 * behind the paper), and as a rule. Rather than shipping a second palette,
 * each variant is mixed from the single accent at draw time.
 *
 * Two faces exist (2026-10-17):
 *   · `paper` — the original cream catalogue card. Unchanged, byte for byte;
 *     every room except career still uses it.
 *   · `textural` — the demo's technique: a generated text field as the card's
 *     paper, then the same furniture on top. Light and dark variants.
 * ------------------------------------------------------------------ */
const CARD_LIGHT = {
  ink: [58, 46, 35],          // #3A2E23 — the title ink
  inkSoft: [92, 74, 57],      // body copy
  inkFaint: [146, 118, 88],   // meta, index
  edge: 'rgba(74, 58, 44, 0.26)',
  rule: 'rgba(74, 58, 44, 0.15)',
  highlight: 'rgba(255, 255, 255, 0.80)',
  /** Pull the accent toward ink so the kicker stays readable on cream. */
  accentMix: 0.46,
  accentMixTo: [58, 46, 35],
}

/**
 * Dark face. The ink has to invert; the accent does NOT — the room accents are
 * pastels, which are already legible on a dark ground, so they are lifted a
 * little toward white instead of being pulled toward ink.
 *
 * ⚠️ These values are what the card looks like BEFORE the full-frame night veil
 * (SceneLighting multiplies the whole frame by ~(0.40, 0.46, 0.66)). A card
 * authored at L=0.16 therefore lands near L=0.07 on screen — which is the
 * demo's own ground. Authoring it at the demo's L=0.06 directly would come out
 * almost black.
 *
 * 🔴 THE VEIL IS A HARD CEILING ON DARK-MODE CONTRAST, and it is worth knowing
 * the number before tuning anything else here. Because the veil multiplies the
 * finished frame, **no colour drawn into a card texture can ever be brighter on
 * screen than the veil itself**: pure white lands at (102, 117, 168), i.e.
 * L = 0.184. Against a card face at (35, 31, 29) that caps the achievable
 * contrast at **3.64 : 1** — WCAG AA (4.5 : 1) for body copy is *unreachable* in
 * dark mode without changing the veil, no matter what the palette says.
 * So the ink below is deliberately pushed to ~white: it buys 2.2 : 1 → ~3.2 : 1,
 * which is the most that exists. Anything that needs more than that is a veil
 * decision (see WORKPLAN), not a palette decision.
 */
const CARD_DARK = {
  ink: [250, 246, 238],
  inkSoft: [234, 230, 222],
  inkFaint: [176, 177, 183],
  edge: 'rgba(255, 255, 255, 0.16)',
  rule: 'rgba(255, 255, 255, 0.14)',
  highlight: 'rgba(255, 255, 255, 0.10)',
  accentMix: 0.20,
  accentMixTo: [255, 255, 255],
}

/**
 * Textural faces for the card ground — the demo's generator with two palettes.
 *
 * Light: cream base, amber blobs, ink glyphs. Alpha has to be much higher than
 * the demo's 0.075 because the demo leans on a 0.86 lightness gap between
 * ground and glyph; on cream that gap is only ~0.58 and the same alpha renders
 * as a flat colour (measured: pixel range 194..218).
 */
const TEXTURAL_CARD_LIGHT = {
  base: { h: 34, s: 0.36, l: 0.945 },
  blob: { count: 4, hueSpread: 28, s: 0.58, light: [0.66, 0.84], alpha: 0.52, radius: [0.45, 0.95] },
  glyph: { h: 28, s: 0.52, l: 0.38, alpha: 0.20, scale: 0.9, spacing: [1.9, 2.4] },
  blur: 0.02,
}

/** Dark: the demo's own hue family, lifted for the veil (see CARD_DARK). */
const TEXTURAL_CARD_DARK = {
  base: { h: 232, s: 0.22, l: 0.16 },
  blob: { count: 4, hueSpread: 60, s: 0.58, light: [0.24, 0.42], alpha: 0.55, radius: [0.45, 0.95] },
  glyph: { h: 220, s: 0.28, l: 0.92, alpha: 0.11, scale: 0.9, spacing: [1.9, 2.4] },
  blur: 0.02,
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function rgbaOf(rgb, alpha = 1) {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`
}

/**
 * Draws text with manual letter-spacing. `ctx.letterSpacing` exists but is
 * newer than the rest of the canvas API this room uses, and a card is not
 * worth a feature test — measuring and stepping by hand is three lines.
 * Returns the width it drew.
 */
function drawSpaced(ctx, text, x, y, spacing, align = 'left') {
  // drawSpaced places every glyph itself, so the canvas alignment must not
  // also apply — otherwise each character lands right-aligned at its own pen.
  ctx.textAlign = 'left'
  const chars = Array.from(text)
  let total = 0
  for (const c of chars) total += ctx.measureText(c).width + spacing
  total -= spacing
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x
  for (const c of chars) {
    ctx.fillText(c, cx, y)
    cx += ctx.measureText(c).width + spacing
  }
  return total
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(text)
  const lines = []
  let line = ''
  for (let i = 0; i < chars.length; i++) {
    const next = line + chars[i]
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = chars[i]
      if (lines.length === maxLines) {
        // Ellipsise the final line
        let last = lines[maxLines - 1]
        while (last && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1)
        }
        lines[maxLines - 1] = `${last}…`
        return lines
      }
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

/**
 * `card` is the flat object the Card component builds:
 *   { ...item, index, accent, external, tag, labels, style }
 * so the title/body/meta lookups below read straight off it (with the usual
 * item-ish aliases, because the source collections are not uniform).
 *
 * The layout is a catalogue card, not a poster: a kicker row, a title, a
 * hairline, body copy and a footer. The previous pass had a filled index
 * circle, a 12px colour bar down the whole left edge and a dashed divider,
 * which together made every card read as a placeholder — three competing
 * decorations and no hierarchy. Here the accent is spent on exactly three
 * things (a slim ribbon, the kicker, the footer arrow) and everything else is
 * ink on paper.
 *
 * `style` (optional) switches the ground:
 *   { texW, texH, textural, dark, glyphText, texKey, bodyLines }
 * Omit it and you get the original paper card, unchanged.
 *
 * ⚠️ Font sizes do NOT scale with `texH`. The texture is always 512 px across
 * a 3.05-unit card (168 px per world unit), so a 31 px title is the same
 * physical size on every card — a taller card simply gets more paper, not
 * bigger type.
 */
export function drawCardTexture(card) {
  const { index = 0, accent = '#E0A46A', external = false, tag, labels = {}, style } = card || {}
  const W = style?.texW || CARD_TEX_LONG
  const H = style?.texH || Math.round((CARD_TEX_LONG * GRID_DEFAULT.cardH) / GRID_DEFAULT.cardW)
  const dark = Boolean(style?.dark)
  const T = dark ? CARD_DARK : CARD_LIGHT
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const accentRgb = hexToRgb(accent)
  // On cream the room accents (pastels) have to be pulled most of the way
  // toward ink before the kicker is readable. On the dark face they are already
  // legible and get lifted slightly toward white instead.
  const accentInk = mixRgb(accentRgb, T.accentMixTo, T.accentMix)

  const PAD = 44                     // content left edge, clear of the ribbon
  const RIGHT = W - 34               // content right edge
  const CONTENT_W = RIGHT - PAD

  ctx.textBaseline = 'alphabetic'

  // ---- ground --------------------------------------------------------
  if (style?.textural) {
    // The demo's technique: a generated text field IS the card's paper.
    // Cached per (theme, glyph, size) — see utils/texturalArt.
    const ground = texturalCanvas(
      style.texKey || `card|${W}x${H}|${style.glyphText || ''}`,
      W, H,
      {
        ...(dark ? TEXTURAL_CARD_DARK : TEXTURAL_CARD_LIGHT),
        text: style.glyphText || '',
        mode: 'tile',
        seedKey: style.texKey || `card|${style.glyphText || ''}`,
      },
    )
    ctx.drawImage(ground, 0, 0)
    // A touch of the card's own accent, so eight cards do not read as eight
    // copies of one texture. Same role as the paper card's corner bloom.
    const bloom = ctx.createRadialGradient(W * 0.14, H * 0.08, 0, W * 0.14, H * 0.08, W * 0.72)
    bloom.addColorStop(0, rgbaOf(accentRgb, dark ? 0.10 : 0.09))
    bloom.addColorStop(1, rgbaOf(accentRgb, 0))
    ctx.fillStyle = bloom
    ctx.fillRect(0, 0, W, H)
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#FFFDF8')
    grad.addColorStop(0.60, '#FCF6EA')
    grad.addColorStop(1, '#F6EBD7')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    // A warm bloom off the top-left corner, so the card is lit rather than flat.
    const bloom = ctx.createRadialGradient(W * 0.14, H * 0.08, 0, W * 0.14, H * 0.08, W * 0.66)
    bloom.addColorStop(0, rgbaOf(accentRgb, 0.13))
    bloom.addColorStop(1, rgbaOf(accentRgb, 0))
    ctx.fillStyle = bloom
    ctx.fillRect(0, 0, W, H)

    // ---- fibre -------------------------------------------------------
    // Seeded per card so a re-render (language switch, page flip) is identical.
    let seed = (index + 1) * 9301 + 49297
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd() * W
      const y = rnd() * H
      ctx.fillStyle = rnd() > 0.45
        ? `rgba(150, 122, 92, ${0.03 + rnd() * 0.05})`
        : `rgba(255, 255, 255, ${0.22 + rnd() * 0.42})`
      ctx.fillRect(x, y, 1 + rnd() * 3, 1)
    }
  }

  // ---- edge ----------------------------------------------------------
  // A hairline rather than the old 3px muddy border, with a highlight inside
  // it along the top and left — which is the edge that catches the light.
  ctx.save()
  roundRect(ctx, 6, 6, W - 12, H - 12, 16)
  ctx.clip()
  ctx.strokeStyle = T.highlight
  ctx.lineWidth = 2
  roundRect(ctx, 7.5, 7.5, W - 15, H - 15, 15)
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = T.edge
  ctx.lineWidth = 1.4
  roundRect(ctx, 6, 6, W - 12, H - 12, 16)
  ctx.stroke()

  // ---- accent ribbon -------------------------------------------------
  // Inset top and bottom so it reads as a ribbon laid on the card, not a
  // colour bar bleeding off the edge.
  ctx.fillStyle = rgbaOf(accentRgb, 0.92)
  roundRect(ctx, 22, 30, 4.5, H - 60, 2.25)
  ctx.fill()

  // ---- kicker row ----------------------------------------------------
  // `kicker` overrides `platform` — the career cards put the date range here.
  const KICK_Y = 66
  ctx.font = `600 14px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(accentInk, 0.95)
  const kickW = drawSpaced(ctx, String(card.kicker || card.platform || '').toUpperCase(), PAD, KICK_Y, 2.6)

  // The index is a quiet monospace count, not a filled badge.
  ctx.font = `500 14px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(T.inkFaint, 0.85)
  drawSpaced(ctx, String(index + 1).padStart(2, '0'), RIGHT, KICK_Y, 2.2, 'right')

  // ---- hairline ------------------------------------------------------
  ctx.strokeStyle = T.rule
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, 82.5)
  ctx.lineTo(RIGHT, 82.5)
  ctx.stroke()

  // ---- tag pill (novel genre, "External", …) -------------------------
  // Sits on the kicker row, immediately after the platform.
  const pillText = tag || (external ? (labels.external || 'External') : '')
  if (pillText) {
    ctx.font = `500 13px ${CANVAS_FONT}`
    const tw = ctx.measureText(pillText).width + 20
    const px = PAD + kickW + 14
    if (px + tw < RIGHT - 44) {
      roundRect(ctx, px, KICK_Y - 15, tw, 21, 10.5)
      ctx.fillStyle = rgbaOf(accentRgb, 0.20)
      ctx.fill()
      ctx.fillStyle = rgbaOf(accentInk, 0.90)
      ctx.textAlign = 'center'
      ctx.fillText(pillText, px + tw / 2, KICK_Y + 0.5)
    }
  }

  // ---- title ---------------------------------------------------------
  const title = card.title || card.name || card.label || 'AISPIN'
  ctx.textAlign = 'left'
  ctx.fillStyle = rgbaOf(T.ink, 1)
  ctx.font = `700 31px ${CANVAS_FONT}`
  const titleLines = wrapLines(ctx, title, CONTENT_W, 2)
  const TITLE_Y = 124
  const TITLE_LEAD = 38
  titleLines.forEach((line, i) => ctx.fillText(line, PAD, TITLE_Y + i * TITLE_LEAD))

  // ---- subtitle (career: role · department) ---------------------------
  let cursorY = TITLE_Y + titleLines.length * TITLE_LEAD
  if (card.subtitle) {
    ctx.fillStyle = rgbaOf(accentInk, 0.92)
    ctx.font = `600 19px ${CANVAS_FONT}`
    const subLines = wrapLines(ctx, String(card.subtitle), CONTENT_W, 1)
    subLines.forEach((line, i) => ctx.fillText(line, PAD, cursorY + 2 + i * 26))
    cursorY += 2 + subLines.length * 26
  }

  // ---- body ----------------------------------------------------------
  const body = toPlainText(card.description || card.summary || card.excerpt || '')
    .replace(/\s+/g, ' ')
    .slice(0, 260)
  ctx.fillStyle = rgbaOf(T.inkSoft, dark ? 0.92 : 0.86)
  ctx.font = `400 20px ${CANVAS_FONT}`
  const bodyTop = cursorY + 6
  const bodyLines = wrapLines(ctx, body, CONTENT_W, style?.bodyLines || 3)
  bodyLines.forEach((line, i) => ctx.fillText(line, PAD, bodyTop + i * 28))

  // ---- footer --------------------------------------------------------
  const FOOT_Y = H - 34

  ctx.fillStyle = rgbaOf(accentRgb, 0.95)
  ctx.beginPath()
  ctx.arc(PAD + 4, FOOT_Y - 5, 3.5, 0, Math.PI * 2)
  ctx.fill()

  const meta = card.footer
    || [card.company || card.platform, card.publishedAt || card.startDate || card.date]
      .filter(Boolean)
      .join(' · ')
  ctx.font = `500 15px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(T.inkFaint, 0.95)
  ctx.textAlign = 'left'
  ctx.fillText(meta.slice(0, 30), PAD + 18, FOOT_Y)

  // The action, in a ring rather than as a bare glyph.
  const ringR = 15
  const ringX = RIGHT - ringR
  const ringY = FOOT_Y - 5
  ctx.strokeStyle = rgbaOf(accentInk, 0.75)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = rgbaOf(accentInk, 0.95)
  ctx.font = `600 17px ${CANVAS_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(external ? '↗' : '→', ringX + 0.5, ringY + 0.5)
  ctx.textBaseline = 'alphabetic'

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

/* ------------------------------------------------------------------ */

function Card({ card, position, cardW, cardH, onActivate }) {
  const meshRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const baseZ = position[2]

  const { id, index, accent, external, tag, title, description, platform, labels, style } = card
  const texture = useMemo(
    () => drawCardTexture(card),
    // Redraw whenever anything painted on the card changes — switching language
    // swaps title/description/tag while the id stays the same, and switching
    // theme swaps the whole ground.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, index, accent, external, tag, title, description, platform, labels,
      card.subtitle, card.kicker, card.footer,
      style?.dark, style?.textural, style?.texW, style?.texH, style?.glyphText, style?.bodyLines],
  )
  useEffect(() => () => texture.dispose(), [texture])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    gsap.to(mesh.position, { z: hovered ? baseZ + 0.42 : baseZ, duration: 0.28, ease: 'power2.out' })
    gsap.to(mesh.scale, {
      x: hovered ? 1.045 : 1,
      y: hovered ? 1.045 : 1,
      z: 1,
      duration: 0.28,
      ease: 'power2.out',
    })
  }, [hovered, baseZ])

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        setGuitarCursor('pointer')
      }}
      onPointerOut={() => {
        setHovered(false)
        setGuitarCursor('auto')
      }}
      onClick={(e) => {
        e.stopPropagation()
        onActivate(card)
      }}
    >
      <primitive object={sharedGeometry('plane', cardW, cardH)} attach="geometry" />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  )
}

function PagerTab({ position, label, onClick, disabled }) {
  const ref = useRef(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    gsap.to(ref.current.scale, {
      x: hovered && !disabled ? 1.12 : 1,
      y: hovered && !disabled ? 1.12 : 1,
      z: 1,
      duration: 0.22,
      ease: 'power2.out',
    })
  }, [hovered, disabled])

  return (
    <group position={position}>
      <mesh
        ref={ref}
        onPointerOver={(e) => {
          e.stopPropagation()
          if (disabled) return
          setHovered(true)
          setGuitarCursor('pointer')
        }}
        onPointerOut={() => {
          setHovered(false)
          setGuitarCursor('auto')
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (disabled) return
          onClick()
        }}
      >
        <primitive object={sharedGeometry('plane', 0.95, 0.95)} attach="geometry" />
        <meshBasicMaterial color={disabled ? '#E4D6C2' : hovered ? '#FFD98E' : '#F5E4C8'} />
      </mesh>
      <Text
        font={SCENE_FONTS.maple}
        position={[0, 0, 0.02]}
        fontSize={0.42}
        color={disabled ? '#B9A48C' : TEXT.color}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  )
}

function BackWall({ color, title, description, header, gridW, dark }) {
  // The header text sits on the wall, so it has to flip with the wall — the
  // warm-brown ink is invisible on a night wall.
  const titleColor = dark ? '#EFE8DC' : TEXT.color
  const descColor = dark ? '#C6BCAE' : '#8E6B50'
  const trim = dark ? '#6B5A4C' : PALETTE.wood
  return (
    <group position={[0, 0, -10]}>
      <mesh position={[0, 0, -0.15]}>
        <primitive object={sharedGeometry('plane', 24, 16)} attach="geometry" />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -7.55, 0.04]}>
        <primitive object={sharedGeometry('box', 24, 0.25, 0.12)} attach="geometry" />
        <meshBasicMaterial color={trim} />
      </mesh>
      <mesh position={[0, 7.6, 0.05]}>
        <primitive object={sharedGeometry('box', 24, 0.14, 0.1)} attach="geometry" />
        <meshBasicMaterial color={trim} />
      </mesh>
      <Text
        position={[0, header.titleY, 0.1]}
        font={SCENE_FONTS.maple}
        fontSize={header.titleSize}
        color={titleColor}
        maxWidth={header.titleMaxWidth}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
      >
        {title}
      </Text>
      {description ? (
        <Text
          position={[0, header.descY, 0.1]}
          font={SCENE_FONTS.maple}
          fontSize={header.descSize}
          color={descColor}
          maxWidth={gridW}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
        >
          {description}
        </Text>
      ) : null}
    </group>
  )
}

export default function ContentRoom({ roomId, showRoom, onReady }) {
  const { openOverlay } = useScene()
  const { language, theme } = useSitePreferences()
  const groupRef = useRef(null)
  const [page, setPage] = useState(0)

  const L = layoutFor(roomId)
  const { grid, perPage, gridW, gridH, header, texW, texH } = L
  const dark = theme === 'dark'

  const t = language === 'zh' ? ROOM_LABELS.zh : ROOM_LABELS.en
  const title = (language === 'zh' ? ROOM_TITLES.zh : ROOM_TITLES.en)[roomId] || roomId.toUpperCase()
  const roomDescription = (ROOM_COPY[roomId] || {})[language] || ''
  const accent = ACCENT[roomId] || ACCENT.studio

  /**
   * Chinese company names, keyed by id. The card's textural ground tiles ONE
   * glyph (the demo tiles 微 / 浙), and it must be the same glyph in both
   * languages — otherwise every language switch throws away eight generated
   * textures and pays for them again.
   */
  const zhCompany = useMemo(() => {
    const map = new Map()
    for (const item of getLocalizedCollection('experiences', 'zh')) map.set(item.id, item.company)
    return map
  }, [])

  const rows = useMemo(() => {
    if (roomId === 'career') {
      // Every role, newest first. `experiences.json` already stores them in
      // reverse-chronological order and has no `endDate` for the current one.
      return getLocalizedCollection('experiences', language).map((item) => {
        const start = (item.startDate || '').slice(0, 7).replace('-', '.')
        const end = item.endDate
          ? item.endDate.slice(0, 7).replace('-', '.')
          : (language === 'zh' ? '至今' : 'Present')
        return {
          id: item.id,
          category: 'experience',
          title: item.company,
          subtitle: [item.position, item.department].filter(Boolean).join(' · '),
          kicker: `${start} — ${end}`,
          description: (item.responsibilities || []).join(' '),
          footer: item.location || '',
          // Read by the card renderer; kept off `description` so the overlay
          // body stays the plain responsibilities text.
          company: item.company,
          role: item.position,
          startDate: item.startDate,
          endDate: item.endDate,
          location: item.location,
        }
      })
    }
    if (roomId === 'studio') {
      return [
        ...getLocalizedCollection('projects', language).map((item) => ({ ...item, title: item.name, category: 'project' })),
        ...getLocalizedCollection('labs', language).map((item) => ({ ...item, category: 'lab' })),
      ]
    }
    if (roomId === 'posts') {
      // The novels used to hang in the corridor as drei <Html transform>
      // plaques, which re-wrote a matrix3d transform + repainted a 260px
      // box-shadow card every frame. They live here as plain procedural cards.
      const novelCards = (NOVELS.items || []).map((novel) => ({
        id: novel.id,
        title: language === 'zh' ? novel.zh : novel.en,
        description: language === 'zh' ? novel.descZh : novel.descEn,
        url: NOVELS.href,
        external: true,
        tag: language === 'zh' ? novel.tagZh : novel.tagEn,
        accent: novel.accent,
        category: 'novel',
      }))
      return [...getLocalizedCollection('articles', language), ...novelCards]
    }
    if (roomId === 'videos') return getLocalizedCollection('videos', language)
    if (roomId === 'music') return getLocalizedCollection('music', language)
    if (roomId === 'ai') return getLocalizedCollection('aiProjects', language)
    return []
  }, [roomId, language])

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage))

  // Reset to the first page when the room or the language changes. Adjusting
  // state during render (rather than in an effect) avoids the cascading
  // re-render the react-hooks lint rule warns about.
  const pageKey = `${roomId}:${language}`
  const [lastPageKey, setLastPageKey] = useState(pageKey)
  if (lastPageKey !== pageKey) {
    setLastPageKey(pageKey)
    setPage(0)
  }

  useEffect(() => {
    if (showRoom) onReady?.()
  }, [showRoom, onReady])

  // Debug hook for headless layout probes (?noloader). Reports the wall's world
  // position so a probe can park the camera head-on and measure the grid.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const api = {
      roomId,
      grid: { w: gridW, h: gridH, cols: grid.cols, rows: grid.rows, perPage },
      page,
      pageCount,
      count: rows.length,
      wall: null,
    }
    const probe = installRoomProbe(() => {
      const wall = new THREE.Vector3(0, grid.centerY, -10)
      if (groupRef.current) groupRef.current.localToWorld(wall)
      const normal = new THREE.Vector3(0, 0, 1)
      if (groupRef.current) {
        normal.applyQuaternion(groupRef.current.getWorldQuaternion(new THREE.Quaternion()))
      }
      return { ...api, wall: wall.toArray(), normal: normal.toArray() }
    })
    return () => removeRoomProbe(probe)
  }, [roomId, page, pageCount, rows.length, grid, gridW, gridH, perPage])

  const visible = useMemo(() => {
    const start = page * perPage
    return rows.slice(start, start + perPage).map((item, i) => ({ ...item, index: start + i }))
  }, [rows, page, perPage])

  // --- activation -----------------------------------------------------------
  // Defined before the effects that reference them, so the screen-reader mirror
  // below reuses the exact same activation path as a click on a card.
  const kindFor = useCallback((item) => {
    if (item.category === 'novel') return 'articles'
    if (item.category === 'experience') return 'experience'
    if (roomId === 'posts') return 'articles'
    if (roomId === 'studio') return item.category === 'lab' ? 'labs' : 'projects'
    if (roomId === 'music') return 'music'
    if (roomId === 'videos') return 'videos'
    if (roomId === 'ai') return 'aiProjects'
    return 'projects'
  }, [roomId])

  const activate = useCallback((item) => {
    if (item.external && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    openItem(openOverlay, item, kindFor(item), t)
  }, [kindFor, openOverlay, t])

  const step = useCallback((delta) => {
    setPage((prev) => Math.min(pageCount - 1, Math.max(0, prev + delta)))
  }, [pageCount])

  // Screen-reader mirror of the card wall. Built with plain DOM (not a React
  // portal) because a portal inside the R3F reconciler is not safe. Keeps the
  // room readable and openable for assistive tech now that the DOM panel is gone.
  useEffect(() => {
    if (!showRoom || typeof document === 'undefined') return undefined
    const host = document.createElement('div')
    host.className = 'content-room-a11y'
    host.setAttribute('role', 'region')
    host.setAttribute('aria-label', title)

    const heading = document.createElement('h2')
    heading.textContent = title
    host.appendChild(heading)

    if (roomDescription) {
      const intro = document.createElement('p')
      intro.textContent = roomDescription
      host.appendChild(intro)
    }

    const list = document.createElement('ul')
    rows.forEach((item, i) => {
      const li = document.createElement('li')
      const label = item.title || item.name || item.label || 'AISPIN'
      const summary = toPlainText(item.description || item.summary || '').slice(0, 160)
      if (item.external && item.url) {
        const link = document.createElement('a')
        link.href = item.url
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.textContent = summary ? `${label} — ${summary}` : label
        li.appendChild(link)
      } else {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = summary ? `${label} — ${summary}` : label
        button.addEventListener('click', () => activate(rows[i]))
        li.appendChild(button)
      }
      list.appendChild(li)
    })
    host.appendChild(list)
    document.body.appendChild(host)

    return () => host.remove()
  }, [showRoom, title, roomDescription, rows, activate])

  if (!showRoom) return null

  return (
    <group ref={groupRef} position={[0, -0.5, -2]}>
      <BackWall
        color={roomId === 'career'
          ? (dark ? '#1A1C22' : '#FFF6E9')
          : (dark ? '#191A20' : '#FFF1DF')}
        title={title}
        description={roomDescription}
        header={header}
        gridW={gridW}
        dark={dark}
      />

      {/* Career-room set dressing, pushed to the outer edges so it never sits
          on top of the card grid. */}
      {roomId === 'career' && (
        <group position={[0, 0, 0]}>
          <group position={[-10.9, -4.6, -8.2]}>
            <mesh><primitive object={sharedGeometry('box', 1.9, 2.4, 0.7)} attach="geometry" /><meshStandardMaterial color={PALETTE.wood} roughness={0.9} /></mesh>
            <mesh position={[0, 0.1, 0.38]}><primitive object={sharedGeometry('box', 1.5, 1.9, 0.06)} attach="geometry" /><meshStandardMaterial color="#E7C7A5" roughness={1} /></mesh>
          </group>
          <mesh position={[10.9, 2.7, -8.3]}>
            <primitive object={sharedGeometry('torus', 0.95, 0.1, 8, 32)} attach="geometry" />
            <meshStandardMaterial color={PALETTE.lamp} emissive={PALETTE.lamp} emissiveIntensity={0.25} />
          </mesh>
          <pointLight position={[10.9, 2.7, -7.8]} color={PALETTE.lamp} intensity={1.2} distance={14} />
          <mesh position={[10.9, -6.4, -8.3]}>
            <primitive object={sharedGeometry('cone', 0.7, 1.4, 8)} attach="geometry" />
            <meshStandardMaterial color={PALETTE.matcha} roughness={1} />
          </mesh>
        </group>
      )}

      {/* === CARD WALL === */}
      <group position={[0, 0, 0]}>
        {visible.map((item, i) => {
          const col = i % grid.cols
          const row = Math.floor(i / grid.cols)
          const x = -gridW / 2 + grid.cardW / 2 + col * (grid.cardW + grid.gapX)
          const y = grid.centerY + gridH / 2 - grid.cardH / 2 - row * (grid.cardH + grid.gapY)
          return (
            <Card
              key={item.id || `${roomId}-${page}-${i}`}
              card={{
                ...item,
                index: item.index,
                accent: item.accent || accent,
                external: Boolean(item.external),
                tag: item.tag,
                // The card's kicker row shows the platform ("POST", "AI+", …),
                // which lives on ITEM_KIND rather than on the row itself. The
                // career rows carry their own `kicker` (the date range), which
                // takes precedence inside the renderer.
                platform: (ITEM_KIND[kindFor(item)] || ITEM_KIND.projects).platform,
                labels: t,
                style: {
                  texW,
                  texH,
                  // DR-4: the demo puts the text field on the CARD, not on the
                  // wall, so that is what the career room does.
                  textural: roomId === 'career',
                  dark,
                  // One glyph per card, taken from the Chinese company name so
                  // the ground survives a language switch unchanged.
                  glyphText: (zhCompany.get(item.id) || item.company || '履').slice(0, 1),
                  texKey: `card|${dark ? 'dark' : 'light'}|${item.id}|${texW}x${texH}`,
                  bodyLines: grid.rows === 2 ? 4 : 3,
                },
              }}
              cardW={grid.cardW}
              cardH={grid.cardH}
              position={[x, y, grid.z]}
              onActivate={activate}
            />
          )
        })}
      </group>

      {rows.length === 0 && (
        <Text
          position={[0, grid.centerY, grid.z]}
          font={SCENE_FONTS.maple}
          fontSize={0.7}
          color={dark ? '#C6BCAE' : '#8E6B50'}
          anchorX="center"
          anchorY="middle"
        >
          {roomId === 'videos' ? t.comingSoon : t.empty}
        </Text>
      )}

      {/* === PAGER === (sits on the header row, right-aligned: the grid fills
          the frame, so there is no usable strip below it) */}
      {pageCount > 1 && (
        <group position={[header.pagerX, header.pagerY, header.pagerZ]}>
          <PagerTab position={[-1, 0, 0]} label="◀" onClick={() => step(-1)} disabled={page === 0} />
          <Text
            font={SCENE_FONTS.maple}
            position={[0, 0, 0.02]}
            fontSize={0.4}
            color="#8E6B50"
            anchorX="center"
            anchorY="middle"
          >
            {`${page + 1} / ${pageCount}`}
          </Text>
          <PagerTab position={[1, 0, 0]} label="▶" onClick={() => step(1)} disabled={page >= pageCount - 1} />
        </group>
      )}
    </group>
  )
}
