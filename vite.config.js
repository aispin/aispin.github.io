import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression';
import { generateSeoHtml } from './seo-plugin.js';
import { buildDemosIndex } from './scripts/build-demos-index.mjs';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * `/me` 是独立于 3D 主站的第二个 entry（见 `src/me/index.html`）。
 *
 * 它和主站**不共用** index.html —— 两个页面视觉、依赖、体积都不同，
 * 共用入口会让 /me 白白背上 three.js。Vite 的多页构建把两者分别打包，
 * 这里只负责把 `/me`（不带斜杠）改写过去。
 *
 * 🔴 2026-10-12：源码从 `me/` 挪进了 `src/me/`（让每个业务域自己内聚一个目录，
 *    见 WORKPLAN 的 DR-N）。于是**源码路径不再等于产物路径**：
 *
 *      源码   `src/me/index.html`
 *      产物   `dist/me/index.html`      ⇒ URL `/me/`
 *
 *    ⇒ 这两个中间件**必须分开写**，不能共用一个目标：
 *      · dev     → 指到源码 `/src/me/index.html`（dev 从项目根服务）
 *      · preview → 指到产物 `/me/index.html`（preview 从 dist/ 服务）
 *    ⚠️ 这就是"源码与产物解耦"要付的代价：**路径不再是一份，两处都得对**。
 *      以前两者碰巧相同，所以一个常量就够用。
 */
const ME_PAGE_PATHS = new Set(['/me', '/me/']);
/** 源码里的 entry 位置（dev 用）。 */
const ME_ENTRY_SRC = resolve(rootDir, 'src/me/index.html');
/** 产物里的位置 —— URL `/me/`、CI 的 sanity-check 认的都是它。 */
const ME_ENTRY_OUT = '/me/index.html';

/**
 * 从模块 id 里取「包名」。
 *
 * ⚠️ 必须取**最后一个** `node_modules/` 之后的段，不能用
 * `id.includes('@react-three')` 这种子串判断。嵌套依赖的路径里同样含
 * "@react-three"：
 *
 *   node_modules/@react-three/fiber/node_modules/scheduler
 *
 * 子串规则会把它判成 r3f，于是 react 与 r3f 互相 import 成环。ES 模块允许
 * 循环引用，但这条环穿过了 CJS→ESM 的 interop 包装器（Rollup 的
 * `_interopDefault`），包装器会在 React 自己的 exports 对象还没建好时执行，
 * 生产环境直接白屏：
 *
 *   Cannot set properties of undefined (setting 'Activity')
 *
 * dev 不会暴露这个问题 —— dev 不打包，模块各自独立求值。
 */
function packageOf(id) {
  const after = id.slice(id.lastIndexOf('node_modules/') + 'node_modules/'.length);
  return after.startsWith('@')
    ? after.split('/').slice(0, 2).join('/')
    : after.split('/')[0];
}

const PUBLIC_DIR = resolve(rootDir, 'public');

/**
 * dev/preview 下把 `/foo/` 还原成 `/foo/index.html`。
 *
 * 为什么需要：Vite 用 sirv 提供 public/，而它是以 `extensions: []` 配置的 ——
 * 也就是说它**不会**把 `/demos/` 解析成 `/demos/index.html`。请求落空后继续
 * 往后走，被 appType:'spa' 的 htmlFallback 接住，重写成主站 index.html。
 * 结果就是 dev 下 `/demos/web3d/3d-ip-landing/` 打开的是 3D 主站而不是那个 demo，
 * 而生产环境（真静态服务器）却是对的 —— 典型的「只有 dev 坏」的坑。
 *
 * 生产构建不受影响：dist 里就是真的 `demos/xxx/index.html`，交给宿主解析。
 */
function rewritePublicDirIndex(req, _res, next) {
  const [pathname, query = ''] = req.url.split('?');

  if (pathname.endsWith('/') && pathname !== '/') {
    const rel = decodeURIComponent(pathname.slice(1));
    const candidate = resolve(PUBLIC_DIR, rel, 'index.html');
    // 防目录穿越：解析后的路径必须仍在 public/ 之内
    if (candidate.startsWith(PUBLIC_DIR + '/') && existsSync(candidate)) {
      req.url = `/${rel}index.html${query ? `?${query}` : ''}`;
    }
  }

  next();
}

/** 造一个「把 `/me` 改写到 `target`」的中间件。dev 与 preview 的目标不同。 */
function makeRewriteMePage(target) {
  return (req, _res, next) => {
    const [pathname, query = ''] = req.url.split('?');

    if (ME_PAGE_PATHS.has(pathname)) {
      req.url = `${target}${query ? `?${query}` : ''}`;
    }

    next();
  };
}

function serveExtraPages() {
  return {
    name: 'serve-extra-pages',
    // dev：还没打包，指到**源码**路径
    configureServer(server) {
      server.middlewares.use(makeRewriteMePage('/src/me/index.html'));
      server.middlewares.use(rewritePublicDirIndex);
    },
    // preview：服务的是 dist/，指到**产物**路径
    configurePreviewServer(server) {
      server.middlewares.use(makeRewriteMePage(ME_ENTRY_OUT));
      server.middlewares.use(rewritePublicDirIndex);
    }
  };
}

/**
 * 把 HTML entry 的**产物路径**与**源码路径**解耦。
 *
 *   源码 `src/me/index.html`（和它的模块住在一起）
 *   产物 `dist/me/index.html`（URL `/me/`）
 *
 * 为什么需要它：Vite 让「产物路径 = 源码相对 root 的路径」⇒
 * `src/me/index.html` 会落到 `dist/src/me/index.html`，URL 就变成 `/src/me/`。
 *
 * ⚠️ 必须用 `writeBundle`（文件已落盘）而不是 `generateBundle`：
 *    Vite 是在**它自己的 post 阶段**才把 HTML 塞进 bundle 的，普通插件的
 *    `generateBundle` 跑在那之前 —— 那时 `bundle['src/me/index.html']` 还**不存在**，
 *    于是静默什么都不做（第一版就是这么写的，产物照样落在 dist/src/me/）。
 *    而 `vite-compression` 用的是 `closeBundle`（扫盘再压），`writeBundle` 在它之前，
 *    顺序刚好。
 * ⚠️ 之所以可以安全改名：HTML 里的资源引用是**绝对路径**（`/assets/…`，
 *    `base` 是默认的 `/`）。哪天 base 改成相对的，这个插件立刻失效。
 */
function flattenHtmlEntries(map) {
  return {
    name: 'flatten-html-entries',
    writeBundle(options, _bundle) {
      const outDir = options.dir || resolve(process.cwd(), 'dist');
      for (const [from, to] of Object.entries(map)) {
        const src = resolve(outDir, from);
        if (!existsSync(src)) continue;
        const dst = resolve(outDir, to);
        mkdirSync(dirname(dst), { recursive: true });
        renameSync(src, dst);
        console.log(`[flatten] ${from} -> ${to}`);

        // 顺手清掉改名后留下的**空**目录（否则 dist/src/ 会跟着上传）
        // ⚠️ 只用非递归 rmdirSync + 先确认是空的 —— 不要在这里做任何递归删除。
        for (let dir = dirname(src); dir !== outDir && dir.startsWith(outDir + '/'); dir = dirname(dir)) {
          try {
            if (readdirSync(dir).length) break;
            rmdirSync(dir);
          } catch {
            break;
          }
        }
      }
    }
  };
}

/**
 * 构建/启动前重扫 public/demos/，刷新 demos.json 与列表页，并补缺失的 README。
 *
 * 放在 buildStart 而不是写进 npm script，是因为它必须**早于** Vite 把
 * public/ 拷进 dist —— 否则 dist 里躺着的还是上一次的索引。
 */
function buildDemosIndexPlugin() {
  return {
    name: 'build-demos-index',
    buildStart() {
      try {
        buildDemosIndex();
      } catch (err) {
        // 索引生成失败不该拦住整站构建 —— demos 只是附属页面。
        this.warn(`demos 索引生成失败：${err.message}`);
      }
    }
  };
}

// GitHub Pages SPA fallback: 复制 index.html 为 404.html，
// 任意深链（如 /?room=ai）都会先落到 SPA 入口。
function emit404Fallback() {
  return {
    name: 'emit-404-fallback',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
      const src = resolve(outDir, 'index.html');
      if (existsSync(src)) {
        copyFileSync(src, resolve(outDir, '404.html'));
        console.log('[404] copied index.html -> dist/404.html');
      }
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  /**
   * 🔴 dev 端口**固定 5199**，不再用默认的 5173。
   *
   * 2026-10-20 用户：「5173 被另外一个仓库占用了。本次固定 5199 做为 dev 端口」。
   * 本机 5173 上常驻的是另一个仓（`proj/xsin.github.io/apps/web`），于是裸 `vite`
   * 会**静默顺延**到 5174 —— 同一份源码跑出两个 dev server，探针打在 A 上、
   * 页面开在 B 上（2026-10-10 与 10-15 各踩过一次，第二次是用户发现的）。
   *
   * `strictPort` 才是这件事的关键：端口被占就**报错退出**，绝不悄悄换号。
   * 少了它，`port` 只是个"首选值"，该有的静默仍然会有。
   *
   * 🔴 preview 也一起钉住（原本想让它留在默认 4173）。同一个病 2026-10-20 又
   *    犯了一次：4173 上跑着 `proj/ai-bobby/apps/website` 的 preview，于是
   *    `npm run preview` 静默换号、而冒烟脚本还在打 4173 —— 它**一直在测别人的
   *    站点**（等 `window.__aispin` 等到超时，报的是"页面没起来"，看着像本仓
   *    白屏）。端口不是"顺便记一下"的东西：`<本仓>:<端口>` 的对应关系一旦被
   *    别的仓借走，所有硬编码 URL 的探针都会静默指错。
   *
   *    现在这一对是固定的：**5199 = 源码（dev） / 4199 = 产物（preview）**。
   */
  server: {
    port: 5199,
    strictPort: true,
  },
  preview: {
    port: 4199,
    strictPort: true,
  },

  plugins: [
    serveExtraPages(),
    // 源码 src/me/index.html → 产物 dist/me/index.html（见函数注释）
    flattenHtmlEntries({ 'src/me/index.html': 'me/index.html' }),
    react(),
    viteCompression(),
    generateSeoHtml(),
    buildDemosIndexPlugin(),
    emit404Fallback(),
  ],

  build: {
    rollupOptions: {
      input: {
        // 3D 主站
        main: resolve(rootDir, 'index.html'),
        // 纯 DOM 的名片页，不引 three。源码与它的模块同住 src/me/（见 ME_ENTRY_SRC）
        me: ME_ENTRY_SRC,
      },
      output: {
        // Without this, three / gsap / react-dom all landed in the one entry
        // chunk, which cancelled out the React.lazy split in Experience.jsx:
        // the lazy chunk still existed, but its payload was already sitting
        // in the eager bundle, so nothing was actually deferred.
        //
        // ⚠️ 包名一律走 packageOf()（见文件顶部），不要用子串判断 ——
        // 嵌套依赖会让子串判断误分类，进而造出环，生产白屏。
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          const pkg = packageOf(id);
          if (pkg.startsWith('@react-three/')) return 'r3f';
          if (pkg === 'three') return 'three';
          if (pkg === 'gsap') return 'gsap';
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react';
          return 'vendor';
        },
      },
    },
  },
})
