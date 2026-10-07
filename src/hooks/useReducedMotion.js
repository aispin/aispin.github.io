import { useEffect, useState } from 'react';

/**
 * prefers-reduced-motion —— 3D 场景侧的唯一开关
 * ============================================================
 * DOM/CSS 那半边一直有支持（Toast.scss / AchievementPopup.scss /
 * HudControls.scss 里都有 @media (prefers-reduced-motion: reduce)），
 * 但整条走廊、入口院子、房间内部完全没有 —— 而这个站**绝大部分运动
 * 都在 canvas 里**。开着"减少动态效果"的访客（前庭功能障碍、偏头痛、
 * 晕动症）进站后看到的仍然是满屏漂浮。
 *
 * 什么该停、什么不该停
 * ------------------------------------------------------------
 * 这里的判断标准是**"这个运动是不是用户自己驱动的"**：
 *
 *   停   鼠标视差（相机跟着鼠标晃）、悬浮/呼吸/摇摆、云飘、涂鸦抖动、
 *        粒子上升、自动进场飞镜。这些是纯装饰，停掉不损失任何信息。
 *   不停 滚轮/键盘推动的走廊前进、点击门后的传送、纸张转场。
 *        那是用户主动发起的、有目的的运动，去掉反而让界面失灵。
 *
 * 用法
 * ------------------------------------------------------------
 *   const reduced = useReducedMotion();          // React 组件
 *   useFrame(() => { if (reducedMotion()) return; ... })
 *
 * `reducedMotion()` 是给 useFrame 回调用的裸函数版 —— 每帧读一次
 * matchMedia 太浪费，所以模块级缓存 + 只在媒体查询变化时更新。
 */

const QUERY = '(prefers-reduced-motion: reduce)';

const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/* 模块级单例：所有订阅者共享一个 MediaQueryList */
let mql = null;
let current = false;
const listeners = new Set();

function ensure() {
  if (!supported) return null;
  if (!mql) {
    mql = window.matchMedia(QUERY);
    current = mql.matches;
    const onChange = (e) => {
      current = e.matches;
      listeners.forEach((fn) => fn(current));
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange); // Safari < 14
  }
  return mql;
}

/**
 * 非 React 代码（useFrame 回调、gsap 时间线、事件处理器）读这个。
 * 刻意不叫 useXxx —— 它没有 hooks 语义，也不会订阅。
 */
export function reducedMotion() {
  ensure();
  return current;
}

/** React 组件用这个：会随系统设置变化实时重渲染。 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    ensure();
    return current;
  });

  useEffect(() => {
    ensure();
    // 订阅时先对齐一次：模块可能在本次渲染之后才收到 change
    if (reduced !== current) setReduced(current);
    listeners.add(setReduced);
    return () => listeners.delete(setReduced);
    // 只在挂载时订阅一次，后续由 change 事件推送
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return reduced;
}

/* DEV 调试钩子：headless 里没法真的改系统设置，靠它强制开关。
   window.__reducedMotion.force(true)  —— 之后所有读取都返回 true。 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__reducedMotion = {
    get: () => reducedMotion(),
    native: () => (supported ? window.matchMedia(QUERY).matches : null),
    force: (v) => {
      current = !!v;
      listeners.forEach((fn) => fn(current));
    },
  };
}
