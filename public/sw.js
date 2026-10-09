/* AISPIN service worker
 * 策略：
 *  - 精确预缓存核心外壳（首页、manifest、Maple Mono 字体、图标）
 *  - 导航请求：network-first，离线回退到缓存首页
 *  - 静态资源（同源 js/css/字体/图片）：stale-while-revalidate
 *  - 跨域（GitHub API 等）：不做缓存
 * 更新：版本号变化 -> 旧缓存清理 -> 页面通过 updatefound 感知（见 main.jsx）
 */
const VERSION = 'aispin-v5';
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
          cache.put('/', fresh.clone());
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
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
  }
});
