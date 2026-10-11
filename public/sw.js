/* AISPIN service worker
 * 策略：
 *  - 精确预缓存核心外壳（首页、manifest、Maple Mono 字体、图标）
 *  - 导航请求：network-first，离线回退到缓存首页
 *  - 静态资源（同源 js/css/字体/图片）：stale-while-revalidate
 *  - 跨域（GitHub API 等）：不做缓存
 * 更新：版本号变化 -> 旧缓存清理 -> 页面通过 updatefound 感知（见 main.jsx）
 *
 * ⚠️ 开发态**不注册**本 SW（见 `src/main.jsx`）：stale-while-revalidate 是按
 *    **扩展名**匹配的，而 Vite dev 服务的是 `/src/**.js` 这种**不带内容哈希**
 *    的模块 —— 正好命中，于是「改了代码、页面还是旧画面」。生产产物带哈希，
 *    缓存它们是安全的。
 *
 * 🔴 `respondWith` 的**硬契约**：无论走哪条分支，最终**必须**交出一个
 *    `Response`。交 `undefined` / 一个 reject 掉的 promise，浏览器会报
 *    「The FetchEvent … resulted in a network error response: the promise was
 *    rejected」+「Failed to convert value to 'Response'」—— 两条都**看不出**
 *    真正的原因（服务器没起来 / 离线 + 该资源没进过缓存）。
 *    ⇒ 每个分支的兜底都要显式写 `Response.error()`，**不能靠"大概有缓存"**。
 *    2026-10-11 停掉 `vite preview` 后刷新，控制台一次刷出两条，就是这里漏的。
 */
const VERSION = 'aispin-v7';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/app-icon-maskable.svg',
  // maple-ui.woff 同时是 DOM 字体和 3D 场景字体（theme.js font3d），
  // 两者共用同一个文件 —— 原先多预缓存的 maple-3d.woff 从没被任何代码引用，
  // 白白让每次 PWA 安装多下 72 KB。
  '/fonts/maple-ui.woff2',
  '/fonts/maple-ui.woff',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 只处理同源请求，跨域（GitHub API / 图床等）直接放行
  if (url.origin !== self.location.origin) return;

  // 导航请求：network-first，离线回退首页（SPA 无多页）
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(RUNTIME);
          // fire-and-forget：不挂 catch 的话，配额满 / 不可缓存的状态码
          // 会让它变成一条 "Uncaught (in promise)"，看着像 SW 崩了。
          cache.put('/', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(PRECACHE);
          return (await cache.match('/')) || (await cache.match(request)) || Response.error();
        }
      })()
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate
  if (/\.(js|css|woff2?|png|jpe?g|webp|svg|ico|json)$/i.test(url.pathname) || url.pathname.startsWith('/textures/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          // 🔴 这里原来写的是 `.catch(() => cached)`。`cached` 是 undefined 时
          //    整个 promise 就 resolve 成 undefined ⇒ `respondWith(undefined)`
          //    ⇒ 浏览器报「Failed to convert value to 'Response'」。
          //    **必须自己造一个 `Response.error()`**（type='error'、status=0），
          //    那才是「网络错误」的规范表示。
          .catch(() => cached || Response.error());
        return cached || network;
      })()
    );
  }
});
