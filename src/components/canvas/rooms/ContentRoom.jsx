import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import gsap from 'gsap'
import { useScene } from '../../../context/SceneContext'
import { useSitePreferences } from '../../../context/SitePreferences'
import { getLocalizedCollection, getSiteData } from '../../../hooks/useContentData'
import { NOVELS, PALETTE, ROOM_COPY, SCENE_FONTS, TEXT } from '../../../config/theme'
import { setGuitarCursor } from '../../../utils/guitarCursor'
import './ContentRoom.scss'
import { sharedGeometry } from '../../../engine/resources';

const ROOM_TITLES = {
  zh: { about: '个人档案', studio: '项目与实验室', posts: '文稿与随笔', videos: '短视频作品', music: '原创音乐', ai: 'AI Skills 与应用' },
  en: { about: 'About me', studio: 'Projects & labs', posts: 'Notes & writing', videos: 'Short videos', music: 'Original music', ai: 'AI skills & apps' },
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
 * ------------------------------------------------------------------ */
const GRID = {
  cols: 4,
  rows: 3,
  cardW: 3.05,
  cardH: 2.03,
  gapX: 0.34,
  gapY: 0.36,
  centerY: 0.6,
  z: -9.4,
}
const PER_PAGE = GRID.cols * GRID.rows
const GRID_W = GRID.cols * GRID.cardW + (GRID.cols - 1) * GRID.gapX
const GRID_H = GRID.rows * GRID.cardH + (GRID.rows - 1) * GRID.gapY
const GRID_TOP = GRID.centerY + GRID_H / 2

/**
 * Header band above the wall. Derived from the grid so the two never collide
 * when the grid is retuned. The pager sits on the title row, right-aligned,
 * because there is no room below the grid once it fills the frame.
 */
const HEADER = {
  titleY: GRID_TOP + 1.24,
  descY: GRID_TOP + 0.57,
  titleSize: 0.68,
  descSize: 0.26,
  /** Keep the centred title clear of the right-aligned pager. */
  titleMaxWidth: GRID_W - 6.2,
  pagerX: GRID_W / 2 - 1.7,
  pagerY: GRID_TOP + 1.09,
  /**
   * The pager sits on the SAME z as the header text, not on the card plane.
   * It is 3.7 units above the camera axis, so the 0.5-unit depth difference to
   * GRID.z would scale that offset by ~7% (~30px) and shove the tab off the top
   * of the screen. Matching the header plane keeps "same y => same screen y".
   */
  pagerZ: GRID.z - 0.5,
}

const CARD_TEX_W = 512
const CARD_TEX_H = 340

const ACCENT = {
  about: '#E0A46A',
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
  openOverlay({
    title: item.title || item.name || item.label || 'AISPIN',
    description: toPlainText(summary || rawBody).slice(0, 260),
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
 * ------------------------------------------------------------------ */
const CARD_INK = [58, 46, 35]          // #3A2E23 — the title ink
const CARD_INK_SOFT = [92, 74, 57]     // body copy
const CARD_INK_FAINT = [146, 118, 88]  // meta, index

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
 *   { ...item, index, accent, external, tag, labels }
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
 */
export function drawCardTexture(card) {
  const { index = 0, accent = '#E0A46A', external = false, tag, labels = {} } = card || {}
  const W = CARD_TEX_W
  const H = CARD_TEX_H
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const accentRgb = hexToRgb(accent)
  // Readable on cream: the room accents are pastels, so the kicker and the
  // arrow use a version pulled most of the way toward ink.
  const accentInk = mixRgb(accentRgb, CARD_INK, 0.46)

  const PAD = 44                     // content left edge, clear of the ribbon
  const RIGHT = W - 34               // content right edge
  const CONTENT_W = RIGHT - PAD

  ctx.textBaseline = 'alphabetic'

  // ---- paper ---------------------------------------------------------
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

  // ---- fibre ---------------------------------------------------------
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

  // ---- edge ----------------------------------------------------------
  // A hairline rather than the old 3px muddy border, with a highlight inside
  // it along the top and left — which is the edge that catches the light.
  ctx.save()
  roundRect(ctx, 6, 6, W - 12, H - 12, 16)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.80)'
  ctx.lineWidth = 2
  roundRect(ctx, 7.5, 7.5, W - 15, H - 15, 15)
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = 'rgba(74, 58, 44, 0.26)'
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
  const KICK_Y = 66
  ctx.font = `600 14px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(accentInk, 0.95)
  const kickW = drawSpaced(ctx, String(card.platform || '').toUpperCase(), PAD, KICK_Y, 2.6)

  // The index is a quiet monospace count, not a filled badge.
  ctx.font = `500 14px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(CARD_INK_FAINT, 0.85)
  drawSpaced(ctx, String(index + 1).padStart(2, '0'), RIGHT, KICK_Y, 2.2, 'right')

  // ---- hairline ------------------------------------------------------
  ctx.strokeStyle = 'rgba(74, 58, 44, 0.15)'
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
  ctx.fillStyle = rgbaOf(CARD_INK, 1)
  ctx.font = `700 31px ${CANVAS_FONT}`
  const titleLines = wrapLines(ctx, title, CONTENT_W, 2)
  const TITLE_Y = 124
  const TITLE_LEAD = 38
  titleLines.forEach((line, i) => ctx.fillText(line, PAD, TITLE_Y + i * TITLE_LEAD))

  // ---- body ----------------------------------------------------------
  const body = toPlainText(card.description || card.summary || card.excerpt || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220)
  ctx.fillStyle = rgbaOf(CARD_INK_SOFT, 0.86)
  ctx.font = `400 20px ${CANVAS_FONT}`
  const bodyTop = TITLE_Y + titleLines.length * TITLE_LEAD + 4
  const bodyLines = wrapLines(ctx, body, CONTENT_W, 3)
  bodyLines.forEach((line, i) => ctx.fillText(line, PAD, bodyTop + i * 28))

  // ---- footer --------------------------------------------------------
  const FOOT_Y = H - 34

  ctx.fillStyle = rgbaOf(accentRgb, 0.95)
  ctx.beginPath()
  ctx.arc(PAD + 4, FOOT_Y - 5, 3.5, 0, Math.PI * 2)
  ctx.fill()

  const meta = [card.company || card.platform, card.publishedAt || card.startDate || card.date]
    .filter(Boolean)
    .join(' · ')
  ctx.font = `500 15px ${CANVAS_FONT}`
  ctx.fillStyle = rgbaOf(CARD_INK_FAINT, 0.95)
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

function Card({ card, position, onActivate }) {
  const meshRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const baseZ = position[2]

  const { id, index, accent, external, tag, title, description, platform, labels } = card
  const texture = useMemo(
    () => drawCardTexture(card),
    // Redraw whenever anything painted on the card changes — switching language
    // swaps title/description/tag while the id stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, index, accent, external, tag, title, description, platform, labels],
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
      <primitive object={sharedGeometry('plane', GRID.cardW, GRID.cardH)} attach="geometry" />
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

function BackWall({ color, title, description }) {
  return (
    <group position={[0, 0, -10]}>
      <mesh position={[0, 0, -0.15]}>
        <primitive object={sharedGeometry('plane', 24, 16)} attach="geometry" />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -7.55, 0.04]}>
        <primitive object={sharedGeometry('box', 24, 0.25, 0.12)} attach="geometry" />
        <meshBasicMaterial color={PALETTE.wood} />
      </mesh>
      <mesh position={[0, 7.6, 0.05]}>
        <primitive object={sharedGeometry('box', 24, 0.14, 0.1)} attach="geometry" />
        <meshBasicMaterial color={PALETTE.wood} />
      </mesh>
      <Text
        position={[0, HEADER.titleY, 0.1]}
        font={SCENE_FONTS.maple}
        fontSize={HEADER.titleSize}
        color={TEXT.color}
        maxWidth={HEADER.titleMaxWidth}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
      >
        {title}
      </Text>
      {description ? (
        <Text
          position={[0, HEADER.descY, 0.1]}
          font={SCENE_FONTS.maple}
          fontSize={HEADER.descSize}
          color="#8E6B50"
          maxWidth={GRID_W}
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
  const { language } = useSitePreferences()
  const groupRef = useRef(null)
  const [page, setPage] = useState(0)

  const t = language === 'zh' ? ROOM_LABELS.zh : ROOM_LABELS.en
  const title = (language === 'zh' ? ROOM_TITLES.zh : ROOM_TITLES.en)[roomId] || roomId.toUpperCase()
  const roomDescription = (ROOM_COPY[roomId] || {})[language] || ''
  const accent = ACCENT[roomId] || ACCENT.studio

  const rows = useMemo(() => {
    if (roomId === 'about') {
      const profile = getSiteData()
      const experiences = getLocalizedCollection('experiences', language)
      const projects = getLocalizedCollection('projects', language).slice(0, 4)
      const intro = language === 'zh' ? profile.summary : profile.summaryEn
      return [
        { id: 'intro', title: language === 'zh' ? '你好，我是黄泽昊' : 'Hello, I am Levin Wong', description: intro, category: 'profile' },
        ...experiences.slice(0, 5).map((item) => ({
          id: item.id,
          title: `${item.company} · ${item.position}`,
          description: (item.responsibilities || []).join(' '),
          date: `${item.startDate || ''}${item.endDate ? ` — ${item.endDate}` : ''}`,
          category: 'experience',
        })),
        ...projects.map((item) => ({ ...item, title: item.name, category: 'project' })),
        { id: 'skills', title: t.skills, description: (profile.skills || []).join(' · '), category: 'profile' },
      ]
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
  }, [roomId, language, t.skills])

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE))

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
      grid: { w: GRID_W, h: GRID_H, cols: GRID.cols, rows: GRID.rows, perPage: PER_PAGE },
      page,
      pageCount,
      count: rows.length,
      wall: null,
    }
    window.__room = () => {
      const wall = new THREE.Vector3(0, GRID.centerY, -10)
      if (groupRef.current) groupRef.current.localToWorld(wall)
      const normal = new THREE.Vector3(0, 0, 1)
      if (groupRef.current) {
        normal.applyQuaternion(groupRef.current.getWorldQuaternion(new THREE.Quaternion()))
      }
      return { ...api, wall: wall.toArray(), normal: normal.toArray() }
    }
    return () => { delete window.__room }
  }, [roomId, page, pageCount, rows.length])

  const visible = useMemo(() => {
    const start = page * PER_PAGE
    return rows.slice(start, start + PER_PAGE).map((item, i) => ({ ...item, index: start + i }))
  }, [rows, page])

  // --- activation -----------------------------------------------------------
  // Defined before the effects that reference them, so the screen-reader mirror
  // below reuses the exact same activation path as a click on a card.
  const kindFor = useCallback((item) => {
    if (item.category === 'novel') return 'articles'
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
        color={roomId === 'about' ? '#FFF6E9' : '#FFF1DF'}
        title={title}
        description={roomDescription}
      />

      {/* About-room set dressing, pushed to the outer edges so it never sits
          on top of the card grid. */}
      {roomId === 'about' && (
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
          const col = i % GRID.cols
          const row = Math.floor(i / GRID.cols)
          const x = -GRID_W / 2 + GRID.cardW / 2 + col * (GRID.cardW + GRID.gapX)
          const y = GRID.centerY + GRID_H / 2 - GRID.cardH / 2 - row * (GRID.cardH + GRID.gapY)
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
                // which lives on ITEM_KIND rather than on the row itself.
                platform: (ITEM_KIND[kindFor(item)] || ITEM_KIND.projects).platform,
                labels: t,
              }}
              position={[x, y, GRID.z]}
              onActivate={activate}
            />
          )
        })}
      </group>

      {rows.length === 0 && (
        <Text
          position={[0, GRID.centerY, GRID.z]}
          font={SCENE_FONTS.maple}
          fontSize={0.7}
          color="#8E6B50"
          anchorX="center"
          anchorY="middle"
        >
          {roomId === 'videos' ? t.comingSoon : t.empty}
        </Text>
      )}

      {/* === PAGER === (sits on the header row, right-aligned: the grid fills
          the frame, so there is no usable strip below it) */}
      {pageCount > 1 && (
        <group position={[HEADER.pagerX, HEADER.pagerY, HEADER.pagerZ]}>
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
