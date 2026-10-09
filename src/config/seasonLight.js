/**
 * 四季的光照端点 —— 8 组（4 季 × 昼/夜）。
 *
 * 设计要点
 * --------
 * 1. **秋天直接引用 `theme.js` 的现有常量**，不重写一份。
 *    这个院子本来就是秋天（柿子树挂着红果），所以 `autumn` 必须**逐位等于现状** ——
 *    引用而不是抄写，是让它**不可能漂移**的唯一办法。这也是最便宜的回归锚点：
 *    `?season=autumn` 的光照应当与改动前完全一致。
 *
 * 2. 昼夜的插值机器**一行都不用改**。季节在一次会话内是恒定的
 *    （`useSeason()` 每挂载解析一次，与门联同理，不挂午夜定时器），
 *    所以这里只是把「2 个端点」换成「8 个端点」，插值仍是那一个 0..1 的标量 k：
 *
 *        sky = SEASON_LIGHT[season].day.sky.lerp( SEASON_LIGHT[season].night.sky, k )
 *
 *    ⚠️ 将来若要加季节切换 UI，这里才需要升级成**双线性插值**（季节轴 × 昼夜轴），
 *    并给季节轴单独一条缓动。现在不加，是刻意不做死代码。
 *
 * 3. `night.sky` / `night.haze` 按**「想看到的样子」**书写 ——
 *    全屏 veil 会在之后把它们乘一遍。`unmultiplyVeil(sky, veil)` 负责反算，
 *    **每季用自己的 veil**（该函数已支持传入 veil 参数）。
 *
 * 4. 太阳高度角进 `key.position`。它改的是**明暗（Lambert 项）**，
 *    不是影长 —— 本项目 `LIGHTS.shadows = false`，影长是画在贴图里的
 *    （见 `utils/entranceArt.js` 里树的 `ctx.scale(1, squash)`）。
 *    两者都要，别混为一谈。
 */
import { SCENE, LIGHTS, NIGHT } from './theme';

/** 秋天的白天 = 现状，逐字引用。 */
const AUTUMN_DAY = {
    sky: SCENE.background,
    haze: SCENE.fogColor,
    fogNear: SCENE.fogNear,
    fogFar: SCENE.fogFar,
    ambient: { ...LIGHTS.ambient },
    key: { ...LIGHTS.key },
    fill: { ...LIGHTS.fill },
};

/** 秋天的夜晚 = 现状，逐字引用。 */
const AUTUMN_NIGHT = {
    veil: { ...NIGHT.veil },
    sky: NIGHT.sky,
    haze: NIGHT.haze,
    fogNear: NIGHT.fogNear,
    fogFar: NIGHT.fogFar,
    ambient: { ...NIGHT.lights.ambient },
    key: { ...NIGHT.lights.key },
    fill: { ...NIGHT.lights.fill },
};

/**
 * 每一季两组端点，结构完全相同。
 *
 * `fogNear/Far` 也在表里：季节的空气感一半靠雾 —— 春天湿润（雾稍近）、
 * 夏天通透（雾最远）、冬天雪雾（雾最近）。
 */
export const SEASON_LIGHT = {
    /* ---- 春：清透、微冷、空气里有水汽。太阳中等高度。 ---- */
    spring: {
        day: {
            sky: '#EAF3E6',
            haze: '#DCE9D9',
            fogNear: 20,
            fogFar: 66,
            ambient: { color: '#E9F0DE', intensity: 2.25 },
            key: { color: '#FFF4D6', intensity: 0.92, position: [5, 8.5, 5] },
            fill: { color: '#C8DEEA', intensity: 0.38, position: [-5, 8, -10] },
        },
        night: {
            veil: { r: 0.42, g: 0.46, b: 0.62 },
            sky: '#2E3550',
            haze: '#252C42',
            fogNear: 15,
            fogFar: 48,
            ambient: { color: '#7E8EC6', intensity: 1.05 },
            key: { color: '#B2C8F5', intensity: 0.55, position: [5, 8.5, 5] },
            fill: { color: '#7084BA', intensity: 0.16, position: [-5, 8, -10] },
        },
    },

    /* ---- 夏：强烈、高对比、饱和。太阳最高（影子最短、最硬）。 ---- */
    summer: {
        day: {
            sky: '#FFF6E0',
            haze: '#FFE8C2',
            fogNear: 16,
            fogFar: 58,
            ambient: { color: '#FFEAC0', intensity: 2.35 },
            key: { color: '#FFD684', intensity: 1.18, position: [4, 12.5, 4] },
            fill: { color: '#BADAF0', intensity: 0.30, position: [-5, 9, -10] },
        },
        night: {
            veil: { r: 0.36, g: 0.42, b: 0.60 },
            sky: '#262C48',
            haze: '#1F2540',
            fogNear: 15,
            fogFar: 48,
            ambient: { color: '#7A88C0', intensity: 1.00 },
            key: { color: '#A8C0F2', intensity: 0.50, position: [4, 12.5, 4] },
            fill: { color: '#6C7FB4', intensity: 0.15, position: [-5, 9, -10] },
        },
    },

    /* ---- 秋：现状。这一列是引用，不是数据。 ---- */
    autumn: { day: AUTUMN_DAY, night: AUTUMN_NIGHT },

    /* ---- 冬：太阳最低、冷、雪雾近。
     *      夜里 veil 反而更亮 —— 雪把天光反上来，这是冬夜与秋夜最直观的区别。 ---- */
    winter: {
        day: {
            sky: '#E9EEF3',
            haze: '#DEE5EB',
            fogNear: 12,
            fogFar: 42,
            ambient: { color: '#E0E8F0', intensity: 2.00 },
            key: { color: '#FFF1DE', intensity: 0.72, position: [6, 4.5, 5] },
            fill: { color: '#B4C6DA', intensity: 0.30, position: [-5, 6, -10] },
        },
        night: {
            veil: { r: 0.54, g: 0.60, b: 0.76 },
            sky: '#3E4A66',
            haze: '#333D56',
            fogNear: 10,
            fogFar: 36,
            ambient: { color: '#8C9CCE', intensity: 1.15 },
            key: { color: '#C0D4F8', intensity: 0.58, position: [6, 4.5, 5] },
            fill: { color: '#7A8CC0', intensity: 0.18, position: [-5, 6, -10] },
        },
    },
};

/** 取某一季的两组端点；未知 id 落到秋天（与门联的兜底同思路）。 */
export const seasonLightFor = (season) => SEASON_LIGHT[season] || SEASON_LIGHT.autumn;

/* ------------------------------------------------------------------ */
/* 季节灯光系数 —— 灯笼与窗内暖光共用                                    */
/*                                                                      */
/* 为什么需要它                                                        */
/* ------------                                                        */
/* 这两处是场景里唯一**主动发光**的东西：它们不能"跟着天黑变暗"（亮着的窗 */
/* 就是窗存在的理由），所以它们靠把 `color` 推过 1.0 去抵消全屏 veil。   */
/* 于是 veil 越亮，同一份过驱值落到眼里就越亮 —— 冬夜的 veil 是          */
/* 0.54/0.60/0.76（雪把天光反上来），比秋天的 0.40/0.46/0.66 亮 ~30%，   */
/* 窗会直接削顶。削顶就是把暖色烧成白，而一扇白窗等于没有窗。            */
/*                                                                      */
/* 所以系数取 veil 亮度的**倒数**，归一到秋天（= 1，逐位不变）。         */
/* 这是**推导**出来的，不是手调的：谁改了哪一季的 veil，灯自己会跟上。   */
/*                                                                      */
/* ⚠️ 只乘在"过驱量"上（`1 + A * k * s`），不乘那个 1。                 */
/* 因为那个 1 是**白天**的窗（veil 是纯白、等于没乘），乘了会让冬天的    */
/* 窗在白天就暗掉 23%。代价是夜里只能补到 ~9% 而不是 0% —— 这点残差    */
/* 恰好落在"冬夜窗看起来略亮一点"的方向上，不必再修。                   */
/* ------------------------------------------------------------------ */
const veilLuma = (v) => 0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b;
const AUTUMN_LUMA = veilLuma(AUTUMN_NIGHT.veil);

export function seasonGlowFor(season) {
    const night = (SEASON_LIGHT[season] || SEASON_LIGHT.autumn).night;
    return AUTUMN_LUMA / veilLuma(night.veil);
}
