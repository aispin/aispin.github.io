import React from 'react'
import '../../styles/MarkdownBody.scss'

/* ------------------------------------------------------------------ *
 * Inline HTML.
 *
 * The article bodies come from an external source (originally HTML), so
 * they carry a little raw markup mixed into the markdown:
 *
 *   <img src="...">   the Docker article's diagrams — 6 per language
 *   <br/>             used as a line break inside table cells
 *
 * React escapes raw HTML in a text node, so before this was handled both
 * of the above were rendered as *visible literal text*: the Docker
 * article showed a wall of `&lt;img src="..." /&gt;` characters and the
 * OKR article showed `&lt;br/&gt;` between every clause.
 *
 * Note the deliberate requirement that an <img> carry a `src`. The
 * canvas article talks *about* the `<img>` element in prose ("you can
 * show it in an <img> element"), and that mention has to stay text.
 * ------------------------------------------------------------------ */
const INLINE_PATTERN = new RegExp(
  [
    // <img src="..."> with a real source
    String.raw`(?<img><img\b[^>]*?\bsrc\s*=\s*["'](?<src>[^"']+)["'][^>]*?\/?>)`,
    // <br> / <br/> / <br />
    String.raw`(?<br><br\s*\/?>)`,
    // [label](https://url)
    String.raw`(?<link>\[(?<lt>[^\]]+)\]\((?<lu>https?:\/\/[^\s)]+)\))`,
    // **bold** before *em* so the asterisks do not get split apart
    String.raw`(?<b>\*\*(?<bt>[^*]+)\*\*)`,
    // `code` — \x60 is a backtick, which keeps this line free of a
    // literal backtick and therefore readable inside a template string
    String.raw`(?<code>\x60(?<ct>[^\x60]+)\x60)`,
    String.raw`(?<em>\*(?<et>[^*]+)\*)`,
  ].join('|'),
  'g',
)

/* Pull `src` / `alt` out of a raw <img ...> tag. Both attributes are
 * optional in the source, so each lookup has a fallback. */
const IMG_SRC = /\bsrc\s*=\s*["']([^"']+)["']/i
const IMG_ALT = /\balt\s*=\s*["']([^"']*)["']/i

function imageElement(tag, key) {
  const src = tag.match(IMG_SRC)?.[1]
  if (!src) return null
  const alt = tag.match(IMG_ALT)?.[1] ?? ''
  return <img key={key} className="markdown-image" src={src} alt={alt} loading="lazy" decoding="async" />
}

function inlineNodes(text, keyPrefix) {
  const nodes = []
  let cursor = 0
  let match
  let index = 0
  const nextKey = () => `${keyPrefix}-${index++}`

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const g = match.groups
    if (g.img) {
      nodes.push(imageElement(g.img, nextKey()))
    } else if (g.br) {
      nodes.push(<br key={nextKey()} />)
    } else if (g.link) {
      nodes.push(<a key={nextKey()} href={g.lu} target="_blank" rel="noopener noreferrer">{g.lt}</a>)
    } else if (g.b) {
      nodes.push(<strong key={nextKey()}>{g.bt}</strong>)
    } else if (g.code) {
      nodes.push(<code key={nextKey()}>{g.ct}</code>)
    } else if (g.em) {
      nodes.push(<em key={nextKey()}>{g.et}</em>)
    }
    cursor = INLINE_PATTERN.lastIndex
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/* A line that is nothing but one image gets block treatment: its own row,
 * centred, instead of being wrapped in a <p> with the surrounding text. */
const STANDALONE_IMG = /^\s*(<img\b[^>]*?\/?>)\s*$/i
const STANDALONE_BR = /^\s*<br\s*\/?>\s*$/i

/* ------------------------------------------------------------------ *
 * GFM tables.
 *
 * The OKR article is written as a `| Objective | Key Result |` table, and
 * without this it rendered as a run of paragraphs full of literal pipe
 * characters — the reader got `|` where a table should be.
 *
 * A row only becomes a table when the line under it is a delimiter rule.
 * That check is what keeps a prose line which merely contains a pipe from
 * being swallowed: without it, "he said | then left" would open a table.
 * ------------------------------------------------------------------ */
// | --- | :-- | ---: | :---: |  — at least two cells, so a bare `---` setext
// underline or a horizontal rule can never match.
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/
const TABLE_ALIGN = /^(:?)-+(:?)$/

/* Split a row on unescaped pipes, dropping the optional outer ones. `\|` is
 * the one escape that matters in practice — a pipe inside a cell. */
function splitTableRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/* `:--` left, `--:` right, `:--:` centre, `---` unset. */
function alignmentsFrom(ruleLine) {
  return splitTableRow(ruleLine).map((cell) => {
    const m = cell.match(TABLE_ALIGN)
    if (!m) return null
    const [, left, right] = m
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

export default function MarkdownBody({ markdown = '' }) {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const blocks = []
  let paragraph = []
  let list = []
  let code = []
  let inCode = false
  let table = []          // rows of raw cell strings, header first
  let tableAlign = null   // per-column text-align, from the delimiter row
  let inTable = false

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(<p key={`p-${blocks.length}`}>{inlineNodes(paragraph.join(' '), `p-${blocks.length}`)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inlineNodes(item, `li-${blocks.length}-${index}`)}</li>)}</ul>)
    list = []
  }
  const flushCode = () => {
    if (!code.length) return
    blocks.push(<pre key={`pre-${blocks.length}`}><code>{code.join('\n')}</code></pre>)
    code = []
  }
  const flushTable = () => {
    if (!table.length) return
    const [head, ...body] = table
    const key = `table-${blocks.length}`
    const align = (i) => (tableAlign && tableAlign[i] ? { textAlign: tableAlign[i] } : undefined)
    blocks.push(
      <div className="markdown-table-wrap" key={key}>
        <table>
          <thead>
            <tr>
              {head.map((cell, i) => <th key={i} style={align(i)}>{inlineNodes(cell, `${key}-h-${i}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => <td key={i} style={align(i)}>{inlineNodes(cell, `${key}-${r}-${i}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    table = []
    tableAlign = null
    inTable = false
  }

  lines.forEach((raw, index) => {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      flushTable()
      if (inCode) flushCode()
      inCode = !inCode
      return
    }
    if (inCode) {
      code.push(raw)
      return
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      flushTable()
      return
    }

    // ---- tables ----
    // Only a row whose next line is a delimiter rule opens a table; see
    // TABLE_RULE. Inside one, a delimiter row is structural and carries no
    // cells, any other row extends it, and anything else closes it and is
    // then handled normally below.
    const isRule = TABLE_RULE.test(line)
    const cells = line.includes('|') ? splitTableRow(line) : null
    const opensTable = !!cells && cells.length >= 2
      && lines[index + 1] !== undefined && TABLE_RULE.test(lines[index + 1])

    if (inTable) {
      if (isRule) return
      if (cells && cells.length >= 2) { table.push(cells); return }
      flushTable()
    } else if (opensTable) {
      flushParagraph()
      flushList()
      inTable = true
      tableAlign = alignmentsFrom(lines[index + 1])
      table.push(cells)
      return
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = Math.min(4, heading[1].length)
      const Tag = `h${level}`
      blocks.push(<Tag key={`h-${index}`}>{inlineNodes(heading[2], `h-${index}`)}</Tag>)
      return
    }
    const image = line.match(STANDALONE_IMG)
    if (image) {
      const element = imageElement(image[1], `img-${index}`)
      if (element) {
        flushParagraph()
        flushList()
        blocks.push(element)
        return
      }
    }
    if (STANDALONE_BR.test(line)) {
      flushParagraph()
      flushList()
      blocks.push(<br key={`br-${index}`} />)
      return
    }
    const item = line.match(/^\s*[-*+]\s+(.+)$/)
    if (item) {
      flushParagraph()
      list.push(item[1])
      return
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(<blockquote key={`q-${index}`}>{inlineNodes(quote[1], `q-${index}`)}</blockquote>)
      return
    }
    flushList()
    paragraph.push(line)
  })

  flushTable()
  flushParagraph()
  flushList()
  if (inCode) flushCode()
  return <div className="markdown-body">{blocks}</div>
}
