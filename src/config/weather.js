/**
 * weather —— 天气 → 天象强度的**唯一真源**
 * ==================================================
 *
 * 这个文件是**纯函数 + 常量**，不 import react、不发请求 —— 所以可以被
 * 无头脚本直接 `import` 做矩阵测试（见 `.workbuddy-ai/harness/weather-levels-test.mjs`）。
 * 拉数据的那部分在 `src/hooks/useWeather.js`，它从这里取表。
 *
 * ---------------------------------------------------------------------------
 * 上游（都**不需要 key**，且都带 `access-control-allow-origin: *`，实测）
 * ---------------------------------------------------------------------------
 *   · 定位 —— `https://ipwho.is/`（按 IP 猜城市，**不弹权限框**）
 *   · 天气 —— `https://api.open-meteo.com/v1/forecast`（WMO weather code）
 *
 * 🔴 **为什么用 IP 定位、不用 `navigator.geolocation`**：后者会弹系统权限框。
 * 对一个作品集站点来说，一进门就弹"允许获取位置"是**劝退**；而天气只需要
 * **城市级**精度，IP 定位完全够。所以这里刻意不碰 `navigator.geolocation`。
 * （`ipapi.co` 试过，被 Cloudflare 拦成 "Just a moment..."，**不能用**。）
 *
 * ---------------------------------------------------------------------------
 * 🔴 WMO weather code → 「下不下雨」的**分组**（Open-Meteo 文档）
 * ---------------------------------------------------------------------------
 *   0 晴 · 1–3 多云 · 45/48 雾                       → 不是雨
 *   51–57 毛毛雨 · 61–67 雨 · 80–82 阵雨 · 95–99 雷雨  → **是雨**
 *   71–77 雪 · 85–86 阵雪                            → **不是雨**（雪是另一条线，
 *                                                     而且本项目的雪只由季节定）
 *
 * ⚠️ 别把 71–77 归进"是雨"：那样冬天预报下雪时会**同时**下雨 + 下雪。
 */

/** 默认地点：深圳（用户 2026-10-10 指定）。IP 定位失败时用它。 */
export const WEATHER_DEFAULT_PLACE = { name: '深圳', lat: 22.54, lon: 114.06 };

/** 会话缓存键 / 有效期。天气不会分钟级变，别把免费接口打爆。 */
export const WEATHER_CACHE_KEY = 'aispin-weather-v1';
export const WEATHER_CACHE_TTL = 30 * 60 * 1000;

/**
 * 这个 WMO 码**是不是在下雨**。
 * @param {number|null|undefined} code
 * @returns {boolean}
 */
export function isRainCode(code) {
    if (code == null) return false;
    return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

/**
 * 雨**多大**（0..1），喂给 shader 的 `uRain`。
 * 毛毛雨细一点、雷雨拉满 —— 同一套雨丝，只改不透明度与数量感。
 * @param {number|null|undefined} code
 * @returns {number} 0..1
 */
export function rainIntensity(code) {
    if (code == null) return 0;
    if (code >= 95) return 1.0;                                      // 雷雨
    if (code >= 80 && code <= 82) return code === 82 ? 0.95 : 0.7;   // 阵雨
    if (code >= 61 && code <= 67) return code === 65 || code === 67 ? 1.0 : 0.8; // 雨
    if (code >= 51 && code <= 57) return 0.5;                        // 毛毛雨
    return 0;
}

/**
 * 🔴 **季节 × 天气 → 两层强度**。这是整个特性的规则表，别的文件不许再写一遍。
 *
 * 规则（用户 2026-10-10）：
 *   · 春 / 夏 / 秋 —— **预报说了算**：预报在下雨才下，不下就不下；
 *   · 冬 —— **落雪固定**（与预报无关），**另加**一场雨（若预报在下雨）。
 *
 * 拿不到天气时的回落（"静默降级"，见下）：
 *   · `status: 'error'`  → 回落到**原设计**：春 ✔ 夏 ✔ 秋 ✘ 冬 ✘（雨）；
 *   · `status: 'idle' | 'loading'` → 雨**先不画**。宁可晚半秒出现，
 *     也不要「先下一场再收回去」。
 *   ⚠️ 这两条**不一样**：error 是"确定拿不到"→ 用老行为兜底；
 *     loading 是"还不知道"→ 什么都不画，等它。
 *
 * 未知季节（`useSeason()` 不该返回）→ **不下雪**、雨**仍跟预报**，
 * 与春夏秋同一条线 —— 将来加第 5 个季节不用动这张表。
 *
 * @param {string} season 'spring' | 'summer' | 'autumn' | 'winter'
 * @param {{status?:string, raining?:boolean, intensity?:number}} weather
 * @returns {{snow:number, rain:number, active:boolean}}
 */
export function weatherLevels(season, weather) {
    // 雪：只由季节定。冬天固定下雪 —— 连 loading 期间都照下。
    const snow = season === 'winter' ? 1 : 0;

    // "这个功能上线前"的雨：春 ✔ 夏 ✔ 秋 ✘ 冬 ✘。
    const fallbackRain = season === 'spring' || season === 'summer' ? 1 : 0;

    let rain;
    if (weather?.status === 'ready') {
        rain = weather.raining ? weather.intensity : 0;
    } else if (weather?.status === 'error') {
        rain = fallbackRain;
    } else {
        rain = 0; // idle / loading：还不知道 —— 先不画
    }

    return { snow, rain, active: snow > 0.001 || rain > 0.001 };
}
