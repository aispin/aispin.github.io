#!/usr/bin/env node
/**
 * pixabay-user —— 给一个 pixabay 用户，抓他的最新作品。
 *
 *   node src/cli.js -u aispin-40699950 --latest 12 -o data.json
 *   node src/cli.js -u https://pixabay.com/users/aispin-40699950/ --type photo
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildUser } from './index.js'

const HELP = `
pixabay-user —— 给一个 pixabay 用户，抓他的最新作品（照片 / 插画 / 视频）

用法
  pixabay-user -u <用户> [选项]

必填
  -u, --user <v>      用户页 URL，或 aispin-40699950 这样的「名字-id」

选项
  -l, --latest <n>    最新 N 件（默认 12）
  -p, --popular <n>   最热 N 件（默认 0 = 不抓）
  -t, --type <t>      all | photo | illustration | vector | video（默认 all）
  -o, --out <path>    输出文件，可重复；不给就打到 stdout
      --chrome <p>    指定 Chrome 可执行文件（默认自动找）
      --headful       显示浏览器窗口（调试用）
      --min           压缩输出（单行 JSON）
  -h, --help          看这个

输出结构
  { generatedAt, source, user, latestPhotos[], latestVideos[], popularPhotos[], total }
`

function parseArgs(argv) {
  const out = { latest: 12, popular: 0, type: 'all', out: [], files: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '-u': case '--user': out.user = next(); break
      case '-l': case '--latest': out.latest = Number(next()); break
      case '-p': case '--popular': out.popular = Number(next()); break
      case '-t': case '--type': out.type = next(); break
      case '-o': case '--out': out.out.push(next()); break
      case '--chrome': out.chrome = next(); break
      case '--headful': out.headful = true; break
      case '--min': out.min = true; break
      case '-h': case '--help': out.help = true; break
      default:
        if (a.startsWith('-')) throw new Error(`不认识的参数：${a}`)
        out.files.push(a)
    }
  }
  if (!out.user && out.files.length) out.user = out.files.shift()
  return out
}

let args
try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(1) }

if (args.help || !args.user) {
  console.log(HELP.trim())
  process.exit(args.help ? 0 : 1)
}

const log = (m) => console.error(m)

try {
  const data = await buildUser({
    user: args.user,
    latest: args.latest,
    popular: args.popular,
    type: args.type,
    chrome: args.chrome,
    headless: !args.headful,
    log,
  })

  const text = JSON.stringify(data, null, args.min ? 0 : 2)
  if (!args.out.length) {
    console.log(text)
  } else {
    for (const file of args.out) {
      const p = resolve(file)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text + '\n')
      log(`→ ${p}`)
    }
  }
  log(`✔ ${data.user.name || args.user}：照片 ${data.latestPhotos.length} / 视频 ${data.latestVideos.length}`)
} catch (err) {
  console.error(`✖ ${err.message}`)
  process.exit(1)
}