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
 *
 * 🔴 2026-10-12（用户又贴了一次控制台日志）——**同一个报错文本，两个不同的病**。
 *    贴出来的四条里，两条是"服务器没起来"，另两条暴露了**预缓存形同虚设**：
 *
 *      · `manifest.webmanifest: ERR_CONNECTION_REFUSED`
 *        ⇒ `PRECACHE_URLS` 里明明有它（第 28 行），但下面的静态分支正则
 *          **没有 `webmanifest`** ⇒ SW 根本不接管 ⇒ 走裸网络 ⇒ 连接被拒。
 *          **"在预缓存清单里"和"会被 fetch 处理器接管"是两件事。**
 *      · `assets/main-*.js` → `Response.error()`
 *        ⇒ 静态分支只 `caches.open(RUNTIME)`，**从来没读过 `PRECACHE`**。
 *          于是 install 时辛辛苦苦下的 favicon / maskable 图标 / 字体，
 *          离线时**一个都取不出来**（只有 `/` 因为导航分支读了 PRECACHE 才有效）。
 *          整个"精确预缓存核心外壳"的策略，实际只兑现了首页一张 HTML。
 *
 *    ⚠️ 还有一个**不属于 SW** 的坑，一并记在这里，因为它和这套缓存纠缠在一起：
 *       `vite preview` 是 SPA，**对不存在的哈希会回退 `index.html`（text/html）**。
 *       于是"旧标签页 + 新构建"的表现是：哈希已经不在了，请求却拿到 200 + HTML
 *       ⇒ 模块脚本 MIME 不对 ⇒ 同样报 `Failed to load resource`。
 *       实测：`curl /assets/main-VgyU1IVL.js`（旧哈希）→ **200 + text/html**。
 *       两者都靠**普通刷新**治：导航分支是 network-first，刷一下就拿到新 HTML。
 *
 * 🔴 2026-10-13（**第三次**贴同一个报错）—— 上面那句"靠普通刷新治"**不成立**，
 *    因为导航分支的回退读错了缓存。这次终于把链路走完了：
 *
 *      · 现象：`localhost:4173/assets/main-CiidtBUP.js`
 *              `→ network error response: the promise was resolved with an
 *                 error response object`（**resolved**，不是 rejected
 *              ⇒ 走的是 `Response.error()` 那条分支，**不是** v6 的 undefined 病）
 *      · 那个哈希**不在** `dist/`（现在是 `main-Bm67gdII.js`），
 *        只在归档 `.workbuddy-ai/dist-prev-1791784813/`（= 2026-10-12 13:02 那次构建）
 *        ⇒ 请求的是**旧构建的产物**。
 *      · 为什么会去要旧构建的产物：导航分支的 catch 只读 `PRECACHE`，
 *        而 `PRECACHE` 的 `/` 是 **install 时刻**的 HTML（冻结）。
 *        写 `RUNTIME`、读 `PRECACHE` —— 修法见下面 catch 里的注释。
 *      · 为什么 `fetch` 会失败：**`vite preview` 没在跑**（4173 三个回环地址全 000）。
 *
 *    ⇒ 两条独立的修，缺一不可：
 *      ① 回退顺序改成 RUNTIME → PRECACHE（本文件）；
 *      ② **本地 origin 干脆不注册 SW**（`src/main.jsx`）—— `vite preview`
 *         服务的是生产构建，`import.meta.env.PROD` 为真，所以本地预览也挂 SW，
 *         这才是这个报错反复出现的地基。
 */
const VERSION = 'aispin-v9';
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
          // 🔴 顺序必须是 **RUNTIME → PRECACHE**，和下面的静态分支一致。
          //    2026-10-13 之前这里只读 `PRECACHE`，而上面 `cache.put` 写的是
          //    `RUNTIME` —— **写一处、读另一处**。后果：预缓存里的 `/` 是
          //    `install` **那一刻**抓的 HTML，之后**永不更新**；于是服务器没起来
          //    时，SW 交出的是"安装当天的旧构建"HTML，它引用的
          //    `assets/main-<旧哈希>.js` 早就不在盘上了 ⇒ 浏览器刷出一串
          //    「The FetchEvent for … resulted in a network error response」。
          //    `RUNTIME` 的 `/` 是每次成功导航覆盖的，那才是"最新那份"。
          const runtime = await caches.open(RUNTIME);
          const precache = await caches.open(PRECACHE);
          return (
            (await runtime.match('/')) ||
            (await precache.match('/')) ||
            (await precache.match(request)) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate
  // ⚠️ 这个正则和 `PRECACHE_URLS` 是**两套独立的名单**，必须自己对齐：
  //    清单里的东西如果这里不匹配，SW 就不接管它，预缓存白做。
  //    `webmanifest` 就是这么漏掉的（见文件头的 2026-10-12 记录）。
  if (/\.(js|css|woff2?|png|jpe?g|webp|svg|ico|json|webmanifest)$/i.test(url.pathname) || url.pathname.startsWith('/textures/')) {
    event.respondWith(
      (async () => {
        const runtime = await caches.open(RUNTIME);
        const precache = await caches.open(PRECACHE);
        // 🔴 **两个缓存都要看**。原来只查 `RUNTIME`，而 `RUNTIME` 是"被请求过
        //    且成功过"才写入的 ⇒ install 期的预缓存（favicon / maskable 图标 /
        //    字体）离线时一个都取不出来，等于预缓存只兑现了首页一张 HTML。
        //    顺序：RUNTIME 优先（它是较新的那份），落空再问 PRECACHE。
        const cached = (await runtime.match(request)) || (await precache.match(request));
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              runtime.put(request, response.clone()).catch(() => {});
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
