import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { installCursorVariables } from './utils/cursorArt'
import { installAppleTouchIcon } from './utils/appIcons'
import { installPaperVariables } from './utils/paperArt'

// --- 程序化外观资源（零图片文件）---
// 光标：32×32 像素画在运行时画成 data URL，注入 CSS 变量
// iOS 图标：canvas 现画一张 PNG data URL 挂到 <link rel="apple-touch-icon">
// 纸张：768×768 的揉皱纸纹，同一个 canvas 既喂 3D 场景背景，也以 data URL
//       注入 --paper-texture 供四个样式表使用（installPaperVariables 内部
//       延到下一帧再生成，避免拖慢首屏）
if (typeof document !== 'undefined') {
  installCursorVariables()
  installAppleTouchIcon()
  installPaperVariables()
}

// --- Console Signature for Awwwards Judges ---
if (typeof window !== 'undefined') {
  console.log(
    '%c AISPIN %c 3D 个人主页 %c',
    'background: #5A4636; color: #FFF6E9; padding: 5px 10px; font-weight: bold; border-radius: 3px 0 0 3px;',
    'background: #C89B7B; color: #FFF6E9; padding: 5px 10px; font-weight: bold; border-radius: 0 3px 3px 0;',
    'background: transparent'
  );
}

// --- PWA: service worker registration + update awareness ---
// 新版本就绪时向页面派发 'sw-update-ready'，由 SiteControls 展示更新提示。
//
// 🔴 **开发态一律注销 SW，绝不注册。**
// 原因：`public/sw.js` 的静态资源分支按扩展名匹配
// （`/\.(js|css|woff2?|png|…)$/`）走 stale-while-revalidate，而 Vite dev
// 服务的就是 `/src/shaders/entranceTextures.js` 这种**不带内容哈希**的模块
// —— 路径以 `.js` 结尾，正好命中。于是「改了源码，页面还是旧画面」：
// 组件（`.jsx`，不匹配）是新的，shader / 音频这些 `.js` 模块却是缓存里的旧版。
// 2026-10-10 用户报「过道两边的草冬天还是绿的」就是这一路：
// 地面色板在 `entranceTextures.js` 里，页面拿到的是**修好之前**的那份。
// 生产构建的产物带内容哈希，缓存它们是安全的，所以只有 dev 需要这份清理。
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              // 有旧 SW 接管中 + 新 SW 已安装待激活 => 可提示用户刷新
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('sw-update-ready', { detail: registration }));
              }
            });
          });
        })
        .catch(() => {
          /* SW 注册失败不影响主体验（如 file:// 或受限环境） */
        });
    });
  } else {
    // 清掉历史会话留下的 SW 与缓存 —— 否则旧模块会一直被优先命中。
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()))
      .catch(() => {});
    if (typeof caches !== 'undefined') {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {});
    }
  }
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
