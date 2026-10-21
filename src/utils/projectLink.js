/**
 * 项目卡 / 项目详情共用的小工具。
 *
 * 为什么单独一个文件：`CareerHud`（列表缩略图）和 `CareerProjectModal`（头图、
 * 底部链接）都要用同一套规则，写两份必然漂。
 */

/**
 * 截图资源在哪。
 *
 * 🔴 站内的 `src/data/experiences.json` 和 demo 的 `experiences.json` 是**同一份
 * 内容**（`image` 都写成 `shots/xxx.jpg`，相对路径），只有取图的前缀不同：
 * demo 的页面就在 `public/demos/web3d/career/` 下，相对路径天然可用；站内页面在
 * 根路径，必须补上前缀。
 *
 * 一份图 1.7MB，两边共用、不复制 —— 所以这个常量是**唯一**的耦合点。
 */
export const SHOT_BASE = '/demos/web3d/career/'

/** `image` → 可直接给 <img src> 的地址。 */
export function shotUrl(image, id) {
    const name = image || (id ? `shots/${id}.png` : '')
    if (!name) return ''
    if (/^(https?:)?\/\//.test(name) || name.startsWith('/')) return name
    return SHOT_BASE + name
}

/** 截图可能存成 .png / .jpg / .jpeg —— 依次试，全失败才留占位。 */
export function shotCandidates(src) {
    if (!src) return []
    const m = /\.(png|jpe?g|webp)$/i.exec(src)
    if (!m) return [src]
    const base = src.slice(0, m.index)
    const out = [src]
    for (const ext of ['.png', '.jpg', '.jpeg']) {
        const s = base + ext
        if (!out.includes(s)) out.push(s)
    }
    return out
}

/** 竖图（手机 / 小程序截图）用 contain，横图用 cover。 */
export function isPortraitImage(img) {
    return img.naturalWidth / Math.max(1, img.naturalHeight) < 1.25
}

/**
 * 详情页底部那个链接的文案。
 *
 * 原来一律写「查看完整文档」，可 gantt / gitalk / 凹凸这几个 url 其实是
 * 在线 demo 和仓库 —— 点开发现不是文档，比没有链接更难受。
 */
const LINK_COPY = {
    github: { zh: '查看 GitHub ↗', en: 'View on GitHub ↗' },
    docs: { zh: '查看完整文档 ↗', en: 'Read the full write-up ↗' },
    demo: { zh: '查看在线 Demo ↗', en: 'Open the live demo ↗' },
}

const DOCS_HOSTS = /docs\.qq\.com|docs\.google\.com|notion\.so|yuque\.com|feishu\.cn|larksuite\.com|confluence/
const CODE_HOSTS = /github\.com|gitee\.com|gitlab\.com|bitbucket\.org|codepen\.io|codesandbox\.io/

export function linkKind(url) {
    const u = String(url || '').toLowerCase()
    if (!u) return null
    if (CODE_HOSTS.test(u)) return 'github'
    if (DOCS_HOSTS.test(u)) return 'docs'
    return 'demo'
}

export function linkLabel(url, lang = 'zh') {
    const kind = linkKind(url)
    if (!kind) return ''
    return LINK_COPY[kind][lang] ?? LINK_COPY[kind].zh
}

/** `2023-11-11` → `2023.11`。 */
export function fmtMonth(iso) {
    if (!iso) return ''
    const [y, m] = String(iso).split('-')
    return m ? `${y}.${m}` : y
}

/** 卡片副标题：`角色 · 2023.11 — 至今`。 */
export function projectPeriod(p, nowLabel = '至今') {
    const start = fmtMonth(p.startDate)
    const end = p.endDate ? fmtMonth(p.endDate) : nowLabel
    return [start, end].filter(Boolean).join(' — ')
}

export function projectSub(p, nowLabel = '至今') {
    return [p.role, projectPeriod(p, nowLabel)].filter(Boolean).join(' · ')
}
