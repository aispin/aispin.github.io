import { useSyncExternalStore } from 'react';

/**
 * flightMode — 「小飞机飞行模式」的开关（WO-18，2026-10-12）。
 * ==================================================================
 *
 * 用户：「前院摆一架小飞机，**点击**在 `/flight` 路由下进入飞行模式。」
 * DR-M 定：走**查询参数** + 接管主站相机（不是新开一条路由）。
 *
 * 两条入口，一个状态：
 *   · `?flight`                —— URL 直接进（给探针 / 截图用，机位可复现）
 *   · 点击院子里那架小飞机      —— 访客的入口（`Airplane.jsx`）
 *
 * ---------------------------------------------------------------------------
 * 为什么是模块级 store + `useSyncExternalStore`（抄 `hooks/useWeather.js`）
 * ---------------------------------------------------------------------------
 * 同一个状态有**三个**消费者，而且它们不在同一棵子树里：
 *   · `Experience`（决定相机所有者是谁 —— 见 `config/cameraMode.js`）
 *   · `Airplane`（飞机自己要不要沿航线飞）
 *   · `FlightCamera`（跟随相机）
 *
 * 走 context 就得动 `App.jsx` / `Experience.jsx` 的层级去加 Provider；
 * 走 `useState` 抬到共同祖先，会把 `Experience` 整棵树每次开关都重渲一遍。
 * 模块级 store 两条都免了，而且**天然只有一个真源**（不会出现两个消费者
 * 各自记一份 active 而对不上）。
 *
 * ⚠️ `getSnapshot` 必须返回**稳定引用**：只在 `set()` 里整体换对象，别就地改。
 *
 * ---------------------------------------------------------------------------
 * 🔴 时间也是这个 store 的职责（这是"飞机与相机永不失步"的做法）
 * ---------------------------------------------------------------------------
 * 飞机的位置和相机的位置都由**同一个 `t`** 推出来（`utils/flightPath.js` 是
 * 纯函数：给 t 算位姿）。如果让两边各自记一个"我是什么时候开始的"，
 * 它们迟早差一帧 —— 而症状是"相机和飞机相对位置慢慢漂"，很难查。
 *
 * 所以 `enteredAt` 存在这里，两边都调 `flightTime()`。
 *
 * 另外支持 `?flight&t=12` **冻结**在某一秒：探针要断言"t=12 时相机在哪"，
 * 就必须能直接指定 t，而不是"跑 12 秒再看"（后者会被帧率、丢帧、
 * swiftshader 的慢速污染 —— 见 memory「截图不可复现」那条）。
 */

/** 进入飞行模式的方式（`source`）。分开记是为了排查"到底是谁开的"。 */
export const FLIGHT_SOURCE = Object.freeze({
    URL: 'url',
    CLICK: 'click',
});

/** 飞行模式是否被"点开"了。 */
let snapshot = {
    active: false,
    source: null,
    /** 进入时刻（`performance.now()` 毫秒）。`t = (now − enteredAt) / 1000`。 */
    enteredAt: 0,
    /** 非 null ⇒ **冻结**在这个秒数（`?flight&t=N`）。探针 / 定妆照用。 */
    frozenT: null,
};

const listeners = new Set();
let started = false;

function set(next) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
}

function getSnapshot() {
    return snapshot;
}

/**
 * URL 上有 `?flight` 吗。
 *
 * 与 `cameraMode.isFlyEnabled()` 同样**惰性求值**：模块级常量在模块被 import
 * 的那一刻就定死了，而 `Experience` 是 lazy chunk（在 preloader 之后才解析）
 * —— 那时 URL 早就有了，但测试环境里 `window` 可能还没准备好，读早了会炸。
 */
export function isFlightEnabled() {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('flight');
}

/** `?flight&t=N` 里的 N（没有就 null）。非有限数一律当没有。 */
function frozenTimeFromUrl() {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get('t');
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function subscribe(listener) {
    listeners.add(listener);
    if (!started) {
        started = true;
        // 惰性启动（与 useWeather 同一条做法）：第一次有人订阅时才读 URL。
        if (isFlightEnabled()) {
            set({
                active: true,
                source: FLIGHT_SOURCE.URL,
                enteredAt: now(),
                frozenT: frozenTimeFromUrl(),
            });
        }
    }
    return () => { listeners.delete(listener); };
}

/** 单调时钟（秒）。抽出来是为了让"时间从哪来"只有一处。 */
function now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

/**
 * 进入飞行模式。**重复调用是安全的**（已经在飞就不重置时钟 ——
 * 否则点两下会把航线从头开始，看起来像"卡了一下"）。
 */
export function enterFlight(source = FLIGHT_SOURCE.CLICK) {
    if (snapshot.active) return;
    set({ active: true, source, enteredAt: now(), frozenT: null });
}

/** 退出飞行模式。相机交还环绕相机；**不留残留**（见 `FlightCamera` 的注释）。 */
export function exitFlight() {
    if (!snapshot.active) return;
    set({ active: false, source: null, enteredAt: 0, frozenT: null });
}

/**
 * 当前飞行时间（秒）。`t` 只由这里产生 —— 飞机和相机都读它。
 *
 * `frozenT !== null` 时**恒定**（探针模式），否则从 `enteredAt` 起算。
 * 未进入飞行时返回 0（此时谁都不该用它）。
 */
export function flightTime() {
    if (snapshot.frozenT !== null) return snapshot.frozenT;
    return (now() - snapshot.enteredAt) / 1000;
}

/** React 绑定。返回**快照对象本身**（稳定引用），别在调用处展开成新对象。 */
export function useFlightMode() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Debug hook —— 和 `window.__scene` / `window.__cam` / `window.__weather` 同一套。
// harness 用它读状态来**断言**（否则只能靠"画面里飞机在不在"猜）。
// 只在 dev 挂，生产构建里没有。
if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__flight = () => snapshot;
}

export default useFlightMode;
