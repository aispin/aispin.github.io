/**
 * /me 页面的数据装配层。
 *
 * 为什么是「装配」而不是「定义」：页面上没有一个事实是写死在这里的。
 * 编辑性文案来自 src/data/me.json，身份来自 profile.json，作品来自
 * projects.json，曲目来自 music.json。这里只负责把这几份数据接起来，
 * 保证同一个事实在仓库里只存一份。
 *
 * ⚠️ 这里**不能** import src/hooks/useContentData.js —— 那个模块为了给
 * R3F 房间预加载贴图，顶层就 import 了 @react-three/drei 和 three。
 * /me 是一个纯 DOM 页面，走那条路会把整个 three.js 拖进这个 entry。
 * 所以 JSON 一律直接 import。
 */
import me from '../data/me.json'
import profile from '../data/profile.json'
import site from '../data/site.json'
import projects from '../data/projects.json'
import music from '../data/music.json'
import aiProjects from '../data/aiProjects.json'

/** 取双语字段：`{ zh, en }` → 当前语言；普通字符串原样返回。 */
export function pick(value, lang) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return value[lang] ?? value.zh ?? value.en ?? ''
}

/** 在 projects.json 里按 id 找一条（同一 id 有 zh/en 两条，取当前语言的）。 */
function findProject(id, lang) {
  const rows = projects.filter((p) => p.id === id)
  return rows.find((p) => p.locale === lang) ?? rows.find((p) => p.locale === 'zh') ?? rows[0] ?? null
}

/** 把 ISO 日期切成 "2023.11" 这种紧凑写法。 */
function shortDate(iso) {
  if (!iso) return ''
  const [y, m] = String(iso).split('-')
  return m ? `${y}.${m}` : y
}

export function buildMeModel(lang = 'zh') {
  /* ---- 身份 ---- */
  const name = pick({ zh: profile.name, en: profile.nameEn }, lang) || me.brand
  const location = pick({ zh: profile.location, en: profile.locationEn }, lang)

  /* ---- 导航 ---- */
  const nav = me.nav.map((item) => ({ id: item.id, label: pick(item, lang) }))

  /* ---- 身份卡 ---- */
  const roles = {
    eyebrow: pick(me.roles.eyebrow, lang),
    title: pick(me.roles.title, lang),
    desc: pick(me.roles.desc, lang),
    items: me.roles.items.map((r) => ({
      key: r.key,
      icon: r.icon,
      title: pick(r.title, lang),
      desc: pick(r.desc, lang),
      tags: r.tags,
    })),
  }

  /* ---- 作品：把 projectId 解析成真实项目 ---- */
  const works = {
    eyebrow: pick(me.works.eyebrow, lang),
    title: pick(me.works.title, lang),
    desc: pick(me.works.desc, lang),
    items: me.works.items
      .map((slot) => {
        const p = findProject(slot.projectId, lang)
        if (!p) return null
        return {
          id: p.id,
          span: slot.span,
          visual: slot.visual,
          kind: pick(slot.kind, lang),
          title: p.name,
          // 卡片上只放一句话；项目全文留给 3D 房间里的工作室。
          description: String(p.description || '').replace(/^[^\p{L}\p{N}]+/u, '').split(/[。.]/)[0].slice(0, 90),
          url: p.url || '',
          role: p.role || '',
          period: [shortDate(p.startDate), shortDate(p.endDate)].filter(Boolean).join(' – '),
          opensource: Boolean(p.opensource),
        }
      })
      .filter(Boolean),
  }

  /* ---- 音乐：真实曲目 + 程序化演奏器 ---- */
  const tracks = music.map((t) => ({
    id: t.id,
    title: t.title,
    album: t.album,
    platform: t.platform,
    date: shortDate(t.publishedAt),
    url: `https://music.163.com/#/song?id=${(String(t.file).match(/id=(\d+)/) || [])[1] || ''}`,
  }))

  /* ---- 联系 ---- */
  const links = [
    { icon: 'mail', label: lang === 'zh' ? '邮件' : 'Email', href: `mailto:${profile.email}` },
    { icon: 'github', label: 'GitHub', href: profile.github },
    { icon: 'music', label: lang === 'zh' ? '音乐主页' : 'Music', href: tracks[0]?.url || profile.github },
  ]

  /* ---- 页脚统计（全部是真实数字，不是占位） ---- */
  const stats = [
    { value: String(aiProjects.length), label: lang === 'zh' ? '开源 AI 技能' : 'open-source AI skills' },
    { value: String(tracks.length), label: lang === 'zh' ? '发行曲目' : 'released tracks' },
    { value: String(projects.filter((p) => p.locale === lang).length), label: lang === 'zh' ? '项目记录' : 'projects logged' },
  ]

  return {
    lang,
    brand: me.brand,
    name,
    location,
    badge: pick(me.badge, lang),
    tagline: pick(me.heroTagline, lang),
    nav,
    roles,
    works,
    tracks,
    music: {
      eyebrow: pick(me.music.eyebrow, lang),
      title: pick(me.music.title, lang),
      desc: pick(me.music.desc, lang),
      proceduralTitle: pick(me.music.proceduralTitle, lang),
      proceduralMeta: pick(me.music.proceduralMeta, lang),
      listTitle: pick(me.music.listTitle, lang),
    },
    contact: {
      eyebrow: pick(me.contact.eyebrow, lang),
      title: pick(me.contact.title, lang),
      desc: pick(me.contact.desc, lang),
    },
    links,
    stats,
    footerNote: pick(me.footerNote, lang),
    siteUrl: site.siteUrl,
  }
}
