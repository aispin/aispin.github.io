/**
 * chunk-graph.mjs — 构建产物的 chunk 依赖图 + 环检测。
 *
 * 为什么需要它：手写 `manualChunks` 很容易造出**环**。ES 模块允许循环引用，
 * 但循环一旦穿过 CJS→ESM 的 interop 包装器（Rollup 的 `_interopDefault`
 * 之类），包装器就会在目标模块的 exports 还没建好时执行 —— 生产环境直接白屏，
 * 而且**dev 完全正常**（dev 不打包，模块各自独立求值），所以只能靠这道检查兜住。
 *
 * 真实案例（2026-10-07）：`vite.config.js` 用 `id.includes('@react-three')`
 * 判断包名，把嵌套的 `node_modules/@react-three/fiber/node_modules/scheduler`
 * 也判成了 r3f，于是 react ⇄ r3f 成环，生产报
 * `Cannot set properties of undefined (setting 'Activity')`。
 *
 * 用法：
 *   node .workbuddy-ai/harness/chunk-graph.mjs [distDir]
 *   退出码 0 = 无环；1 = 有环（可直接接进 CI）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = process.argv[2] || 'dist'
const assets = join(distDir, 'assets')

const js = readdirSync(assets).filter((f) => f.endsWith('.js'))
if (!js.length) {
  console.error('没有在 ' + assets + ' 找到 .js —— 先跑 npm run build')
  process.exit(1)
}

const graph = new Map()
for (const f of js) {
  const src = readFileSync(join(assets, f), 'utf8')
  const deps = new Set()
  const re = /from\s*["']\.\/([^"']+)["']/g
  let m
  while ((m = re.exec(src))) deps.add(m[1])
  graph.set(f, [...deps])
}

const short = (f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '')
const size = (f) => readFileSync(join(assets, f)).length

console.log('=== chunk 依赖图 ===')
for (const f of js) {
  const kb = (size(f) / 1024).toFixed(1).padStart(8)
  console.log('  ' + short(f).padEnd(14) + kb + ' KB  ->  ' + (graph.get(f).map(short).join(', ') || '(无)'))
}

// 直接双向环（两两互相 import）
const cycles = new Set()
for (const a of js) for (const b of graph.get(a)) if (graph.has(b) && graph.get(b).includes(a)) {
  cycles.add([short(a), short(b)].sort().join(' <-> '))
}

// 深度环：DFS 找任意长度的回边
const found = new Set()
const state = new Map()
const stack = []
function dfs(node) {
  state.set(node, 1)
  stack.push(node)
  for (const dep of graph.get(node) || []) {
    if (!graph.has(dep)) continue
    if (state.get(dep) === 1) {
      const i = stack.indexOf(dep)
      found.add(stack.slice(i).map(short).concat(short(dep)).join(' -> '))
    } else if (!state.get(dep)) dfs(dep)
  }
  stack.pop()
  state.set(node, 2)
}
for (const f of js) if (!state.get(f)) dfs(f)

console.log('\n=== 环检测 ===')
if (!cycles.size && !found.size) {
  console.log('  ✅ 无环')
} else {
  for (const c of cycles) console.log('  🔴 双向环: ' + c)
  for (const c of found) console.log('  🔴 环路:   ' + c)
}

// 额外体检：react chunk 是否被拆得只剩一小片（说明规则误分类）
const reactChunk = js.find((f) => /^react-/.test(f))
if (reactChunk) {
  const kb = size(reactChunk) / 1024
  console.log('\n=== react chunk 体积体检 ===')
  console.log('  ' + short(reactChunk) + ' = ' + kb.toFixed(1) + ' KB')
  if (kb < 120) console.log('  ⚠️ 偏小：react+react-dom+scheduler 正常应 > 150 KB，规则可能误分类')
}

console.log('\n结果: ' + (cycles.size || found.size ? '发现环 ❌' : '通过 ✅'))
process.exit(cycles.size || found.size ? 1 : 0)
