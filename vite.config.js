import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression';
import { generateSeoHtml } from './seo-plugin.js';
import { buildDemosIndex } from './scripts/build-demos-index.mjs';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * `/me` 是独立于 3D 主站的第二个 entry（见 me/index.html）。
 *
 * 它和主站**不共用** index.html —— 两个页面视觉、依赖、体积都不同，
 * 共用入口会让 /me 白白背上 three.js。Vite 的多页构建把两者分别打包，
 * 这里只负责把 `/me`（不带斜杠）改写到目录里的 index.html。
 */
const ME_PAGE_PATHS = new Set(['/me', '/me/']);

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

function rewriteMePage(req, _res, next) {
  const [pathname, query = ''] = req.url.split('?');

  if (ME_PAGE_PATHS.has(pathname)) {
    req.url = `/me/index.html${query ? `?${query}` : ''}`;
  }

  next();
}

function serveExtraPages() {
  const attach = (server) => {
    server.middlewares.use(rewriteMePage);
    server.middlewares.use(rewritePublicDirIndex);
  };

  return {
    name: 'serve-extra-pages',
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); }
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
  plugins: [
    serveExtraPages(),
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
        // 纯 DOM 的名片页，不引 three
        me: resolve(rootDir, 'me/index.html'),
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
