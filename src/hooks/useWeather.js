import { useSyncExternalStore } from 'react';
import {
    WEATHER_CACHE_KEY,
    WEATHER_CACHE_TTL,
    WEATHER_DEFAULT_PLACE,
    isRainCode,
    rainIntensity,
} from '../config/weather';

/**
 * useWeather —— 真实天气，用来决定**院子下不下雨**
 * ================================================
 *
 * 需求原话（2026-10-10）：「找一个公开的天气预告接口，获取客户端的城市（默认深圳），
 * 依据天气预报来决定春夏秋是否下雨。如果冬天雪和雨叠加没有性能影响，冬天也加上。
 * 注意，冬天下雪是固定的。」
 *
 * 本文件只管**拉数据 + 存快照**；「季节 × 天气 → 下多少」的规则表在
 * `src/config/weather.js` 的 `weatherLevels()` —— 那里是纯函数，可单测。
 * 上游接口 / WMO 码分组 / 为什么用 IP 定位，注释都在那个文件里。
 *
 * ---------------------------------------------------------------------------
 * 拿不到就**静默回落到原设计**，绝不阻塞场景
 * ---------------------------------------------------------------------------
 * 这个站点是纯静态、无后端的。离线 / 被墙 / 限流都必须**无感**：
 *   · 全程 `AbortSignal.timeout`（定位 4s、天气 5s），失败就 `status: 'error'`；
 *   · `status: 'error'` 时**调用方**（`WeatherLayer`）回落到"春夏下雨、秋不下"的
 *     原设计 —— 也就是这个功能上线前的样子；
 *   · 成功结果进 `sessionStorage`，TTL 30 分钟 —— 同一次会话里切季节不会重复打接口。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 `useSyncExternalStore` 而不是 context / useState+useEffect
 * ---------------------------------------------------------------------------
 * 这是个**异步外部资源**：多个消费者（现在只有 `WeatherLayer`）必须看到**同一份**
 * 快照，而且**只允许发一次请求**。模块级 store + `useSyncExternalStore` 天然满足
 * 这两条，还省掉一个 Provider（不用动 `App.jsx` / `Experience.jsx` 的层级）。
 * 顺带避开了 `react-hooks/set-state-in-effect` 那条新规则。
 *
 * ⚠️ `getSnapshot` 必须返回**稳定引用**：只在 `set()` 里整体换对象，别就地改。
 */

/**
 * 超时。⚠️ 这两个值**实测调过一次**（2026-10-10）：
 *
 * 无头环境里 4 s 会**误判超时** —— 场景挂载那一刻主线程正被
 * SwiftShader 渲染 + 贴图生成堵着，`res.json()` 读 body 时超时窗口就到了，
 * 于是拿到 `TimeoutError: signal timed out`，静默回落到原设计。
 * ⇒ 抬到 **8 s**。
 *
 * 为什么敢放长：这条链**完全异步、不阻塞任何东西**。放长的唯一代价是
 * "被墙 / 离线时晚几秒才回落"，而回落后就是原设计（§10.2），用户无感。
 */
const PLACE_TIMEOUT = 8000;
const FORECAST_TIMEOUT = 8000;

/* -------------------------------------------------------------------------
 * store
 * ---------------------------------------------------------------------- */

let snapshot = {
    /** 'idle' | 'loading' | 'ready' | 'error' */
    status: 'idle',
    raining: false,
    intensity: 0,
    code: null,
    place: null,
    /** 'api' = 真拿到了；'cache' = 会话缓存；'fallback' = 没拿到，调用方回落 */
    source: null,
    /**
     * 失败原因（只在失败时非空）。**故意留在快照里**：不然排查"为什么回落了"
     * 只能看到 `status: 'error'`，分不清是超时、CORS 还是被墙。
     * dev 里可以直接 `window.__weather().error` 读出来。
     */
    error: null,
};

const listeners = new Set();
let started = false;

function set(next) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
}

function subscribe(listener) {
    listeners.add(listener);
    if (!started) {
        started = true;
        void load();
    }
    return () => { listeners.delete(listener); };
}

function getSnapshot() {
    return snapshot;
}

/* -------------------------------------------------------------------------
 * 网络
 * ---------------------------------------------------------------------- */

function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
}

async function fetchPlace() {
    const res = await fetch('https://ipwho.is/', { signal: timeoutSignal(PLACE_TIMEOUT) });
    if (!res.ok) throw new Error(`ipwho ${res.status}`);
    const j = await res.json();
    if (!j || j.success === false) throw new Error('ipwho: lookup failed');
    const lat = Number(j.latitude);
    const lon = Number(j.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('ipwho: bad coords');
    return { name: j.city || j.region || WEATHER_DEFAULT_PLACE.name, lat, lon };
}

async function fetchForecast(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat}&longitude=${lon}`
        + '&current=weather_code'
        + '&daily=weather_code'
        + '&timezone=auto&forecast_days=1';
    const res = await fetch(url, { signal: timeoutSignal(FORECAST_TIMEOUT) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    return res.json();
}

/* -------------------------------------------------------------------------
 * 会话缓存
 * ---------------------------------------------------------------------- */

function readCache() {
    try {
        const raw = sessionStorage.getItem(WEATHER_CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || typeof c.at !== 'number') return null;
        if (Date.now() - c.at > WEATHER_CACHE_TTL) return null;
        return c;
    } catch {
        return null;
    }
}

function writeCache(v) {
    try {
        sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
            at: Date.now(),
            raining: v.raining,
            intensity: v.intensity,
            code: v.code,
            place: v.place,
        }));
    } catch { /* 隐私模式 / 配额满 —— 无所谓，下次再打接口 */ }
}

/* -------------------------------------------------------------------------
 * 加载
 * ---------------------------------------------------------------------- */

async function load() {
    const cached = readCache();
    if (cached) {
        set({ ...cached, status: 'ready', source: 'cache' });
        return;
    }

    set({ status: 'loading' });
    try {
        const place = await fetchPlace();
        const fc = await fetchForecast(place.lat, place.lon);
        // 用**当前**实况（`current.weather_code`）而不是今日预报：
        // 场景画的是"此刻的院子"，早上停了的雨不该整个下午都挂着。
        // 实况缺失时才退到今日预报码。
        const code = fc?.current?.weather_code ?? fc?.daily?.weather_code?.[0] ?? null;
        const next = {
            status: 'ready',
            raining: isRainCode(code),
            intensity: rainIntensity(code),
            code,
            place,
            source: 'api',
        };
        writeCache(next);
        set(next);
    } catch (err) {
        // 静默：调用方按 status 回落到原设计。**不报错、不 toast、不阻塞**。
        // ⚠️ 但原因要**留在快照里**（见上面 `error` 字段的注释）。
        set({
            status: 'error', raining: false, intensity: 0, code: null, source: 'fallback',
            error: err && err.name ? `${err.name}: ${err.message}` : String(err),
        });
    }
}

/** 强制重取（调试用；正常路径不会调）。 */
export function refreshWeather() {
    try { sessionStorage.removeItem(WEATHER_CACHE_KEY); } catch { /* ignore */ }
    started = true;
    void load();
}

/**
 * 当前天气快照。`status: 'idle' | 'loading'` 表示**还不知道** ——
 * 调用方此时**雨先别画**（见 `weatherLevels()`），免得"先下一场再收回去"。
 */
export function useWeather() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Debug hook —— 和 `window.__scene` / `window.__cam` 同一套（Experience.jsx:53）。
// harness 用它读快照来**断言**天气（否则只能靠"画面上有没有雨丝"猜）。
// 只在 dev 挂，生产构建里没有。
if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__weather = () => snapshot;
}

// 表在 `config/weather.js`，这里转出去方便调用方一处 import。
export { WEATHER_DEFAULT_PLACE, WEATHER_CACHE_KEY, WEATHER_CACHE_TTL, isRainCode, rainIntensity };

export default useWeather;
