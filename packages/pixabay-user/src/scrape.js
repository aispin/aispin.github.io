/**
 * 抓 pixabay 用户页上的作品。
 *
 * 页面结构（2026-11 实测）：
 *   /users/<name>-<id>/                     默认「全部」，包含 photos / illustrations
 *   /users/<name>-<id>/?order=latest        按最新
 *   → 每张卡片是 `<a data-id="8426798" href="/photos/xxx-8426798/"><img src=…>`
 *     卡片链接上就有 id 与类型（/photos/、/illustrations/、/videos/），
 *     详情信息（标题、描述、日期、原图）在**详情页的 ld+json** 里。
 *
 * 所以：列表页拿 id + 类型 + 缩略图（一页就够），再按需打开详情页补字段。
 */

const ORIGIN = 'https://pixabay.com'
const TYPE_OF = { photos: 'photo', illustrations: 'illustration', vectors: 'vector', videos: 'video' }

/** 等 Cloudflare 的挑战页过去。**它是会自己过的**（无头 Chrome 也过），
 *  只要别在"Just a moment"那一帧就读 DOM。
 *
 *  `ready` 是"这个页面算就绪"的判据，不同类型页不一样：
 *    · 列表页 → 有卡片（`a[data-id]`）
 *    · 详情页 → 有 `ld+json` 的 ImageObject/VideoObject（**不能**只看 img ——
 *      骨架屏里也有图，会读到空字段，踩过：某一件的日期/尺寸全是 null）
 */
async function settle(page, { timeout = 30000, ready = 'list' } = {}) {
  const probe = ready === 'detail'
    ? `(async () => {
        for (let i = 0; i < 40; i++) {
          for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const j = JSON.parse(s.textContent)
              if (j && (j['@type'] === 'ImageObject' || j['@type'] === 'VideoObject')) {
                if (j.headline || j.datePublished) return true
              }
            } catch {}
          }
          await new Promise((r) => setTimeout(r, 150))
        }
        return false
      })()`
    : `(async () => {
        for (let i = 0; i < 20; i++) {
          if (document.querySelector('a[data-id]')) return true
          await new Promise((r) => setTimeout(r, 150))
        }
        return false
      })()`

  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const title = await page.eval('document.title')
    if (title && !/just a moment|security verification/i.test(title)) {
      if (await page.eval(probe)) return true
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('pixabay 页面一直没就绪（可能被 Cloudflare 拦住）')
}

/** 从列表页读卡片：只要 id / 类型 / 详情页路径 / 缩略图。 */
const READ_CARDS = `(() => {
  const seen = new Map()
  for (const a of document.querySelectorAll('a[data-id]')) {
    const href = a.getAttribute('href') || ''
    const m = href.match(/^\\/(photos|illustrations|vectors|videos)\\/([a-z0-9-]+)-(\\d+)\\/$/)
    if (!m) continue
    const img = a.querySelector('img')
    seen.set(m[3], {
      id: m[3],
      type: m[1],
      slug: m[2],
      href,
      thumb: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || '',
      alt: (img && img.getAttribute('alt')) || '',
    })
  }
  return [...seen.values()]
})()`

/** 详情页的 ld+json 里有正经的标题/描述/日期/原图 —— 比 DOM 类名稳得多。 */
const READ_DETAIL = `(() => {
  const out = {}
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent)
      if (j && (j['@type'] === 'ImageObject' || j['@type'] === 'VideoObject')) Object.assign(out, j)
    } catch { /* 有的块不是 JSON，跳过 */ }
  }
  const og = (p) => (document.querySelector('meta[property="og:' + p + '"]') || {}).content || ''
  /* 媒体自己的 tag 形如 /photos/search/mountain/；全站导航那种 dropdownMenuItem
     指向的是「热门分类」，混进来就变成 Fall/Thanksgiving/Christmas 了。
     🔴 这段在模板字符串里：注释里不许出现反引号，否则模板提前结束。 */
  /* 🔴 这里不能用正则字面量：整段在模板字符串里，反斜杠会被先吃掉一层，
     正则提前结束（实测报 "Unexpected token ']'"）。用字符串判断。 */
  const TYPE_SEG = ['photos', 'illustrations', 'vectors', 'videos']
  const isTagLink = (a) => {
    const href = a.getAttribute('href') || ''
    const parts = href.split('/').filter(Boolean)   // photos / search / mountain
    if (parts.length !== 3 || parts[1] !== 'search') return false
    if (!TYPE_SEG.includes(parts[0])) return false
    return !String(a.className || '').includes('dropdownMenuItem')
  }
  const tags = [...document.querySelectorAll('a')].filter(isTagLink).map((a) => a.textContent.trim())
  return {
    json: out,
    ogTitle: og('title'),
    ogDescription: og('description'),
    ogImage: og('image'),
    tags: [...new Set(tags)].slice(0, 12),
  }
})()`

/** 详情页里视频的直链（页面里没有 ld+json 时兜底）。 */
const READ_VIDEO_SRC = `(() => {
  const v = document.querySelector('video')
  if (!v) return null
  const sources = [...v.querySelectorAll('source')].map((s) => s.getAttribute('src')).filter(Boolean)
  return { src: v.getAttribute('src') || sources[0] || '', poster: v.getAttribute('poster') || '', all: sources }
})()`

function pickSize(url, size) {
  if (!url) return ''
  if (!size) return url
  /* CDN 的图片是 `<name>_640.jpg` / `<name>__340.jpg` / `<name>_1280.png`。
     🔴 下划线**可能是一个也可能是两个**（`__340` 是"原图缩到 340"那一档）。
     只替换最后一个 `_<数字>` 会得到 `__640` —— CDN 直接 403（实测）。 */
  const next = url.replace(/_{1,2}(\d{3,4})(?=\.(?:jpe?g|png|webp))/i, `_${size}`)
  return next
}

/** 只把 URL 的扩展名换成 .jpg —— 有些 PNG 转 JPG 更小，但**不一定存在**（403）。
 *  所以只做探测用，默认不用。 */
export function jpgVariant(url) {
  return url.replace(/\.(png|webp)$/i, '.jpg')
}

function isoDate(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** 把详情页那坨读成我们要的形状。 */
function normalize(kind, card, detail, extra) {
  const j = detail.json || {}
  const videos = extra?.video || null
  const type = j['@type'] === 'VideoObject' ? 'video' : (TYPE_OF[card.type] || 'photo')

  const img = j.contentUrl || detail.ogImage || card.thumb
  const stat = (action) => {
    const list = Array.isArray(j.interactionStatistic) ? j.interactionStatistic : [j.interactionStatistic]
    const hit = list.find((s) => s && String(s.interactionType || '').endsWith(action))
    return hit ? hit.userInteractionCount : null
  }

  return {
    id: String(card.id),
    type,
    /* 页面给的标题带类型后缀（"… photo" / "… illustration"），是给 SEO 用的，
       展示时不要 —— 类型已经单独一个字段了。 */
    title: (j.headline || detail.ogTitle || card.alt || '')
      .replace(/\s+(photo|illustration|vector|video)$/i, '')
      .trim(),
    description: (j.description || detail.ogDescription || '').trim(),
    publishedAt: isoDate(j.datePublished),
    /* 页面上的 tag（Mountain / Landscape / Snow…）。ld+json 里没有，只能读 DOM。 */
    tags: detail.tags || [],
    width: j.width || null,
    height: j.height || null,
    /* 原图/预览图。Pixabay 允许**临时热链**展示，长期用要自己存 —— 见 README。 */
    image: img,
    preview: pickSize(card.thumb, 640) || img,
    /* 详情页 URL，站内"在 Pixabay 上看"用 */
    url: `${ORIGIN}${card.href}`,
    page: `${ORIGIN}${card.href}`,
    views: stat('ViewAction'),
    downloads: stat('DownloadAction'),
    likes: stat('LikeAction'),
    exif: Array.isArray(j.exifData)
      ? Object.fromEntries(j.exifData.filter((e) => e?.name).map((e) => [e.name, e.value]))
      : {},
    video: type === 'video'
      ? { src: videos?.src || j.contentUrl || '', poster: videos?.poster || j.thumbnailUrl || '' }
      : undefined,
  }
}

/**
 * 抓一个用户的作品。
 *
 * @param {object} opts
 * @param {string} opts.user   用户页 URL 或 `aispin-40699950` 这样的 slug/链接尾巴
 * @param {number} [opts.latest=12]  最新 N 件
 * @param {number} [opts.popular=0]  最热 N 件（0 = 不抓）
 * @param {'all'|'photo'|'illustration'|'vector'|'video'} [opts.type='all']
 * @param {number} [opts.detailLimit] 最多打开多少个详情页（默认跟 latest+popular 走）
 */
export async function scrapeUser(page, opts) {
  const { user, latest = 12, popular = 0, type = 'all', log = () => {} } = opts
  const base = /^https?:/.test(user) ? user : `${ORIGIN}/users/${user}/`

  /* 「最新」：page 自带 order 参数，一个列表页就够（用户作品量级是几十，不是几万） */
  const listUrl = `${base}?order=latest`
  log(`→ ${listUrl}`)
  await page.goto(listUrl)
  await settle(page)

  const profile = await page.eval(`(() => {
    const h1 = document.querySelector('h1')
    /* 头像：用户页上引用的是 cdn.pixabay.com/user/... 那几张；
       最先出现的那张就是页主（后面那些是作品作者的小头像）。 */
    const avatarEl = [...document.querySelectorAll('img')]
      .find((i) => /cdn\\.pixabay\\.com\\/user\\//.test(i.getAttribute('src') || ''))
    /* 简介：页面上有个 "Show more"，剪掉它 */
    const bioEl = [...document.querySelectorAll('div, p')]
      .find((e) => e.children.length === 0 && /\\S{40,}/.test(e.textContent) && /[\\u4e00-\\u9fa5]/.test(e.textContent))
    const clean = (t) => (t || '').replace(/\\s*Show more\\s*$/i, '').trim()
    return {
      name: h1 ? h1.textContent.trim() : '',
      avatar: avatarEl ? avatarEl.getAttribute('src') : '',
      bio: clean(bioEl && bioEl.textContent),
    }
  })()`)

  let cards = await page.eval(READ_CARDS)
  log(`  列表拿到 ${cards.length} 件（照片/插画/矢量/视频混在一起）`)

  if (type !== 'all') cards = cards.filter((c) => TYPE_OF[c.type] === type)
  /* 列表页的顺序就是「最新」—— 别自己按 id 排序，id 大的不一定新（老作品改过一次就往前挪） */
  const wanted = cards.slice(0, Math.max(latest, popular, 1) * 2)

  const picked = []
  const seen = new Set()
  for (const c of wanted) {
    if (picked.length >= latest + popular) break
    if (seen.has(c.id)) continue
    seen.add(c.id)
    picked.push(c)
  }

  log(`  要打开 ${picked.length} 个详情页`)
  const items = []
  for (const card of picked) {
    const url = `${ORIGIN}${card.href}`
    try {
      await page.goto(url)
      await settle(page, { ready: 'detail' })
      const detail = await page.eval(READ_DETAIL)
      const video = card.type === 'videos' ? await page.eval(READ_VIDEO_SRC) : null
      items.push(normalize(card.type, card, detail, { video }))
    } catch (err) {
      log(`   ! 跳过 ${card.id}：${err.message}`)
    }
  }

  /* 「最新」按发布日期倒序（详情页才有日期），同日期按抓到的原顺序 */
  const byDate = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.publishedAt || '').localeCompare(a.it.publishedAt || '') || a.i - b.i)
    .map((x) => x.it)

  const photos = byDate.filter((i) => i.type !== 'video')
  const videos = byDate.filter((i) => i.type === 'video')

  return {
    generatedAt: new Date().toISOString(),
    source: { url: base, scrapedWith: 'headless chrome (CDP), no api key' },
    user: { ...profile, url: base },
    latestPhotos: photos.slice(0, latest),
    latestVideos: videos.slice(0, latest),
    popularPhotos: popular ? photos.slice(-popular).reverse() : [],
    total: { photos: photos.length, videos: videos.length, listed: cards.length },
  }
}