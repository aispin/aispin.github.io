/**
 * 季节 —— **唯一真源**。
 *
 * 为什么单独一个文件
 * ------------------
 * 这张月份表**本来就在 `config/couplets.js` 里**（`SEASON_BY_MONTH` + `seasonOf`），
 * 但它当时只服务于门联文案。四季院子要用同一张表（今天挂秋联，院子就该是秋天），
 * 所以把它提出来：**表只有一份，门联和院子都从这里取。**
 *
 * 本项目最贵的一课就是「同一张表写两遍，迟早在某个文件里漂移」——
 * 入口竖向几何（`entranceMetrics.js`）和这条月份表都是这么翻车的。
 *
 * 季节怎么分：**按月份（气象季节）**，不是按节气。
 * 3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬。
 * 不按节气算，是因为门联的日常联本来就只在「不是节气、也不是节日」的日子出现，
 * 按月份切分更直白，也不会在立春/立夏那几天出现「某一季只挂一天」。
 *
 * id 取英文：它要进贴图缓存键（`entrance:tree:${id}`）和 URL 参数（`?season=winter`），
 * 中文只用于显示与调试（`?season=冬` 也认）。
 */

/** 顺序即一年。数组顺序被 `resolveSeason` 与调试面板依赖。 */
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];

export const SEASONS = {
    spring: { id: 'spring', zh: '春', en: 'Spring', months: [3, 4, 5] },
    summer: { id: 'summer', zh: '夏', en: 'Summer', months: [6, 7, 8] },
    autumn: { id: 'autumn', zh: '秋', en: 'Autumn', months: [9, 10, 11] },
    winter: { id: 'winter', zh: '冬', en: 'Winter', months: [12, 1, 2] },
};

/**
 * 月份 → 季节。索引 = `Date.getMonth()`（0 = 一月）。
 *
 * ⚠️ 这张表**只在这里出现一次**。`couplets.js` 已经改为从本文件引入，
 * 别再往那边抄一份。
 */
const BY_MONTH = [
    'winter', 'winter', // 1  2
    'spring', 'spring', 'spring', // 3  4  5
    'summer', 'summer', 'summer', // 6  7  8
    'autumn', 'autumn', 'autumn', // 9 10 11
    'winter', // 12
];

/** 某个日期属于哪一季，返回 id（'spring' | …）。 */
export const seasonIdOf = (date = new Date()) => BY_MONTH[date.getMonth()];

/** 某个日期属于哪一季，返回中文单字（'春' | '夏' | '秋' | '冬'）。 */
export const seasonZhOf = (date = new Date()) => SEASONS[seasonIdOf(date)].zh;

/**
 * `?season=` 调试覆盖。传 id（`winter`）或中文名（`冬`）都认，大小写不敏感。
 *
 * 与 `?couplet=` **同构**（那个也同时认 id 与中文名）—— 验收时要一眼看懂，
 * 就得让两个调试参数长得一样。
 *
 * 没有它就没法验收：要看别的季节得等到那一季，或者改系统时间。
 *
 * @param {string} [search] 默认读 location.search
 * @returns {{ id: string, source: 'override'|'auto' }}
 */
export function resolveSeason(search = (typeof window !== 'undefined' ? window.location.search : '')) {
    const raw = new URLSearchParams(search).get('season');
    if (raw) {
        const lower = raw.toLowerCase();
        const hit = SEASON_IDS.find((id) => id === lower)
            || SEASON_IDS.find((id) => SEASONS[id].zh === raw);
        if (hit) return { id: hit, source: 'override' };
    }
    return { id: seasonIdOf(), source: 'auto' };
}
