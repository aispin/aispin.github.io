/**
 * 文章正文的取用层 —— 房间阅读层与静态页共用同一份产物。
 *
 * ── 为什么不 import ──────────────────────────────────────────────────
 * 正文原本以 `src/data/articles.json` 的形式被 `import.meta.glob(…, {eager})`
 * 打进主包，18 篇占了主包 gzip 的 **49%**（46.7KB / 94.7KB）。而一个人点开
 * 房间时，真正要读的只有 1 篇。所以正文改成构建期产物
 * （`scripts/build-articles.mjs` → `public/articles/<slug>/index.html`），
 * 进阅读层时按需 fetch。
 *
 * ── 为什么从 HTML 里"挖"正文，而不是再产出一份片段 ────────────────
 * 静态页和阅读层必须是**同一份渲染结果**（DR-G 的硬线：一份渲染器）。
 * 再产一份 JSON 片段等于同一段 markdown 渲两遍，迟早不一致；而且构建期
 * 的校验（禁 script / 禁 on* / 图片必须存在）只作用在静态页那一份上。
 * 所以这里直接把静态页 parse 出来，取 `<article class="prose">`。
 *
 * ⚠️ 产出的 HTML 是**构建期已 sanitize** 的：`build-articles.mjs` 里
 *    `<script>`、行内 `on*=` 一律让构建失败。所以 `dangerouslySetInnerHTML`
 *    在这里是安全的 —— 别在运行时再往里塞任何用户输入。
 */

/** url → Promise<html>。同一篇翻来翻去只 fetch 一次。 */
const cache = new Map()

export function loadArticleBody(url) {
  if (!url) return Promise.resolve('')

  const hit = cache.get(url)
  if (hit) return hit

  const p = fetch(url)
    .then((res) => (res.ok ? res.text() : ''))
    .then((html) => {
      if (!html) return ''
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const el = doc.querySelector('article.prose')
      return el ? el.innerHTML : ''
    })
    .catch(() => {
      /* 取不到就显示空正文，不要把整个阅读层搞崩 */
      cache.delete(url)
      return ''
    })

  cache.set(url, p)
  return p
}

/** 预热（悬停折页时调一次，点开就不用等）。失败无所谓。 */
export function prefetchArticleBody(url) {
  if (url) loadArticleBody(url)
}
