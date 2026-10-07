/**
 * Warm anime art direction — single source of truth.
 *
 * The original template ran on a cold paper-white palette (#fafafa) with every
 * light commented out (baked tinting only). That reads grey and flat for the
 * cosy anime direction, so the palette, the fog and a cheap two-light rig all
 * live here. Shadows stay off: the template dropped shadow maps on purpose and
 * we keep that win.
 */

export const PALETTE = {
  cream: '#FFF6E9',
  peach: '#FFD9C0',
  wood: '#C89B7B',
  matcha: '#A8C69F',
  sky: '#A8D0E6',
  lamp: '#FFD98E',
  ink: '#5A4636',
}

/** Canvas clear colour + fog. Slightly warmer than cream so depth reads warm. */
export const SCENE = {
  background: '#FFF1DF',
  fogColor: '#FFE7C6',
  fogNear: 18,
  fogFar: 60,
}

/**
 * Lighting rig. Kept deliberately cheap:
 * - one ambient wash so nothing goes muddy
 * - one warm key light (no shadows)
 * - one cool fill from the window side for the anime contrast
 */
export const LIGHTS = {
  ambient: { color: '#FFE9C9', intensity: 2.2 },
  key: { color: '#FFD08A', intensity: 0.9, position: [5, 10, 5] },
  fill: { color: '#BBD9EE', intensity: 0.35, position: [-5, 8, -10] },
  shadows: false,
}

/** Text inside the canvas. Never pure black. */
export const TEXT = {
  color: '#5A4636',
  /** troika accepts ttf/otf/woff — NOT woff2.
   *  maple-ui.woff = comprehensive CJK subset (every char that appears anywhere
   *  in src/) so troika NEVER hits the unicode-font-resolver CDN. That CDN is
   *  unreachable from China and offline, and a rejected resolver promise makes
   *  drei's <Text> hang forever — which suspends the whole R3F scene.
   *
   *  ⚠️ 它和 DOM 用的那个是**同一个文件**（见 styles/_fonts.scss）——
   *  build-scene-fonts.py 对两者用同一个字符集、同一种 woff 输出，
   *  所以产物逐字节相同。之前多出来的 maple-cn.woff（重复）和
   *  maple-3d.woff（旧的最小 scene 子集，正是上面那个 CDN 崩溃的成因）
   *  都已经删掉了，别再按旧文档去找它们。
   *  Regenerate with: python3 scripts/build-scene-fonts.py */
  font3d: '/fonts/maple-ui.woff',
  /**
   * Door plaques are drawn with the lantern occupying the top ~32px, so labels
   * sit lower. Widths are capped and the font size is derived from the plaque
   * so long words (ARCHIVE, CONTACT) never touch the frame.
   */
  plaque: {
    safeWidthRatio: 0.58,
    offsetY: -0.06,
  },
}

/**
 * The font faces used inside the canvas.
 *
 * IMPORTANT — troika takes exactly ONE font per <Text>:
 * `getTextRenderInfo()` normalises `args.font` with `toAbsoluteURL(args.font)`,
 * so passing an array of `{src}` descriptors stringifies to
 * "[object Object],[object Object]" and the load fails. Per-character font
 * fallback only exists through the unicode-font-resolver CDN, which is exactly
 * what we must avoid.
 *
 * Consequence: that ONE face has to cover everything the <Text> can render —
 * including data (project titles, awards, user input). Maple is the only face
 * in the project that does, so it is the only face left.
 *
 * 历史：这里曾同时挂着 CabinSketch（Latin-only）与 RubikScribble
 * （Latin-only）两个手写体，只用在少数硬编码的拉丁文案上。它们的字符集
 * 覆盖不了中文与符号，任何动态字符串落到它们身上都会触发上面那个 CDN
 * 崩溃；而它们带来的那点"手写感"在 3D 场景里几乎看不出来。
 * 2026-10-07 整体删除（归档在 .workbuddy-ai/removed-sketch-fonts-*.tar.gz），
 * 全部改用 maple。
 */
export const SCENE_FONTS = {
  /** CJK + full Latin + symbols — the only face; safe for any string. */
  maple: TEXT.font3d,
}

/** DOM/UI side. */
export const UI = {
  fontFamily: "'Maple Mono', 'MapleUI', monospace",
  cssFont: '/fonts/maple-ui.woff2',
  cssFontFallback: '/fonts/maple-ui.woff',
}

/**
 * Night rig — the same knobs as DAY, for when the user flips the dark mode
 * switch (the DOM side lives in context/SitePreferences.jsx; the switch has
 * always set `document.documentElement.dataset.theme`, it just never reached
 * the canvas).
 *
 * WHY THE LIGHTS ALONE ARE NOT ENOUGH — THE `veil`
 * ------------------------------------------------
 * Dimming the lights buys almost nothing here, which was the first thing this
 * tried. Measured in the running scene: **536 of 806 materials are
 * `MeshBasicMaterial`** — unlit, sampled straight from baked canvas art — and
 * the 青砖 facade is a `ShaderMaterial`. Neither reads a single light. So
 * turning the rig down moved only the ~144 `MeshStandardMaterial`s (the
 * entrance props: sign, window frame, planter, dog) and the whole wall stayed
 * exactly as bright as noon. It looked like a bug: a navy sky over a
 * midday-lit brick wall.
 *
 * So night is applied ONCE, as a full-frame multiply (`uTint`), which is the
 * only thing that can reach Basic, Standard and Shader materials alike — one
 * uniform, one draw call. The lights still come down (so the rooms darken too,
 * and contrast reads right) but they are the seasoning, not the meal.
 *
 * ⚠️ THE BACKGROUND IS MULTIPLIED TOO. `scene.background` is drawn into the
 * same framebuffer before the veil, so the colour below is the sky *before*
 * the veil — not what you see. To land on a visible sky of #2B3152 with the
 * veil at (0.40, 0.46, 0.66):  (0.169, 0.192, 0.322) / (0.40, 0.46, 0.66)
 * = (0.42, 0.42, 0.49) = #6B6B7D. Same story for `fogColor`.
 * (`premultiply()` below does this division for you — change either number
 *  and the other follows.)
 */
const NIGHT_VEIL = { r: 0.40, g: 0.46, b: 0.66 }

export const NIGHT = {
    /** Full-frame multiplier. Day is pure white = a no-op, so the veil can
     *  simply stay mounted and lerp between the two. */
    veil: NIGHT_VEIL,
    /** Sky, AFTER the veil — see the note above for why this is not the value
     *  that goes into `scene.background`. */
    sky: '#2B3152',
    /** Distant haze, likewise post-veil. */
    haze: '#232941',
    fogNear: 14,
    fogFar: 46,
    lights: {
        /** A high floor, not moonlight: this is the only thing lighting the rooms. */
        ambient: { color: '#7C8CC4', intensity: 1.05 },
        key: { color: '#AFC6F5', intensity: 0.55, position: [5, 10, 5] },
        fill: { color: '#6E82B8', intensity: 0.16, position: [-5, 8, -10] },
    },
}

/**
 * Invert the veil: "the sky I want to SEE" -> "the sky to put in
 * scene.background", since the veil multiplies it afterwards.
 *
 * Returns the hex string three's Color constructor wants.
 */
export function unmultiplyVeil(skyHex, veil = NIGHT_VEIL) {
    const m = skyHex.replace('#', '')
    const ch = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    const tone = [veil.r, veil.g, veil.b]
    return '#' + ch
        .map((c, i) => Math.round(Math.min(1, c / tone[i]) * 255).toString(16).padStart(2, '0'))
        .join('')
}

export const ROOMS = [
  { id: 'about', zh: '档案', en: 'ABOUT', door: 0 },
  { id: 'gallery', zh: '摄影', en: 'GALLERY', door: 1 },
  { id: 'studio', zh: '工作室', en: 'STUDIO', door: 2 },
  { id: 'posts', zh: '文稿', en: 'POSTS', door: 3 },
  { id: 'videos', zh: '视频', en: 'VIDEOS', door: 4 },
  { id: 'music', zh: '音乐', en: 'MUSIC', door: 5 },
  { id: 'ai', zh: 'AI+', en: 'AI+', door: 6 },
  { id: 'contact', zh: '联系', en: 'CONTACT', door: 7 },
]

/**
 * One-line room subtitle shown under the wall title. Kept distinct from
 * ROOMS[].zh / ROOM_TITLES so the header never just repeats itself.
 */
export const ROOM_COPY = {
  about: { zh: '一路走来的经历与在意的方向', en: 'Where I have been, and what I care about' },
  gallery: { zh: '摄影作品', en: 'Photography' },
  studio: { zh: '做过的东西，与还在做实验的念头', en: 'Things I have built, and ideas still in the lab' },
  posts: { zh: '随笔、笔记，以及站外连载的小说', en: 'Notes, essays and novels published elsewhere' },
  videos: { zh: '短片与日常记录', en: 'Short films and everyday records' },
  music: { zh: '自己写的曲子与配乐', en: 'Tunes and scores I wrote myself' },
  ai: { zh: '自己做的 Skills、工具与应用', en: 'Skills, tools and apps I built' },
  contact: { zh: '联系与社交账号', en: 'Contact and social links' },
}

/**
 * Novels — previously a corridor wall hanging (drei <Html transform>, which
 * repainted a matrix3d-transformed DOM card every frame and stuttered). They
 * are now plain cards inside the posts room and link out to the novels site.
 */
export const NOVELS = {
  id: 'novels',
  zh: '小说',
  en: 'NOVELS',
  href: 'https://zeobooks.app.workbuddy.host',
  items: [
    {
      id: 'afterglow',
      zh: '夏日残响',
      en: 'Afterglow',
      descZh: '夏日尽头的那段回声：一个关于毕业、告别与未寄出的信的长篇连载。',
      descEn: 'An echo from the end of summer — a serial about graduation, goodbyes and an unsent letter.',
      tagZh: '长篇连载',
      tagEn: 'Serial',
      accent: '#E08D52',
    },
    {
      id: 'tea-tales',
      zh: '茶馆夜话',
      en: 'Tea Tales',
      descZh: '深夜茶馆里的短篇集，每一杯茶换一个故事。',
      descEn: 'A short-story collection set in a late-night teahouse — one cup, one tale.',
      tagZh: '短篇集',
      tagEn: 'Short stories',
      accent: '#5F9978',
    },
  ],
}

/**
 * Sky clouds — used by the Gallery room (GalleryClouds) and the Contact room.
 * (The About room used to keep its own copy via SkyChunk.jsx; that whole
 * directory was dead code and was deleted on 2026-10-07 — `about` renders
 * through ContentRoom like every other room.)
 *
 * The eight sprites are drawn at runtime (utils/cloudArt.js) and painted by
 * `utils/colorizeCloud` (canvas 2D), so nothing is shipped as an image. The
 * table survives only as the *shape and aspect* each index maps to: `aspect` is
 * the ORIGINAL artwork's aspect ratio, which the generator needs because a
 * cloud is fitted to its frame rather than filling it edge to edge.
 */
export const CLOUD_SPRITES = [
  { aspect: 1.894 },
  { aspect: 2.459 },
  { aspect: 3.577 },
  { aspect: 1.794 },
  { aspect: 1.997 },
  { aspect: 1.905 },
  { aspect: 3 },
  { aspect: 1.875 },
]

/**
 * One tint per sprite, so a cloud shape always reads as the same colour.
 * Warm at the top, cooler/dustier at the bottom — enough of a gradient to look
 * painted without fighting the flat anime lighting.
 */
export const CLOUD_TINTS = [
  { top: '#FFFDF6', bottom: '#F0DCC2' }, // warm cream
  { top: '#FFFFFF', bottom: '#CFE2F3' }, // pale sky
  { top: '#FFF7F9', bottom: '#F3CBD5' }, // blush
  { top: '#FFFDF2', bottom: '#F3DEB4' }, // butter
  { top: '#FAF8FF', bottom: '#DACFEC' }, // lilac
  { top: '#F9FDF9', bottom: '#CFE4D3' }, // mint
  { top: '#FFFCF5', bottom: '#EBD5C3' }, // sand
  { top: '#FFFFFF', bottom: '#DCE1EE' }, // cool white
]

/** Tint for a sprite index — stable, and never out of range. */
export function cloudTintFor(spriteIndex) {
  return CLOUD_TINTS[Math.abs(spriteIndex) % CLOUD_TINTS.length]
}
