/**
 * 孤岛地面：草 / 沙滩 / 海 —— 一张平面、一个 shader、零位图。
 * ==================================================================
 *
 * 核心是一个**离岸距离场**（tidewater 的 `coastDistance()` 同款思路）：
 *
 *     sd = coast(xz) - r        // >0 陆地，<0 海，数值就是"离岸多远"
 *
 * 这一个数同时驱动：沙滩在哪、湿沙带到哪、草长到哪、浪刷到哪、竹林种到哪。
 * 没有高度场、没有地形网格、没有碰撞体 —— 岛是**平的**，靠 shader 把岸画出来。
 * 代价是不能在岛上爬山；收益是 1 个 mesh、1 次 draw、0 张贴图。
 *
 * 为什么敢这么做：见 `config/island.js` 顶部 —— 雾 fogFar 只有 36~66，
 * 岛外 36 单位就已经是纯雾色，远处根本没有"地形起伏"可看。
 *
 * 季节
 * ----
 * 草地那部分直接复用 `grassSurface()`（GRASS_GLSL），所以四季的草、花、
 * 落叶、积雪**自动跟着走**，一行都不用重新调。
 * 沙滩与海是新增的，另给一套四季色板 `ISLAND_SEASON`。
 *
 * ⚠️ 新增的每一个 uniform 都必须出现在 `islandSeasonUniforms()` 里，
 *    否则换季时它会静默停在首季（见 `hooks/useSeasonUniforms.js` 的长注释）。
 */

import { NOISE_GLSL, GRASS_GLSL } from './entranceTextures';

export const ISLAND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ISLAND_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;      // 平面尺寸
uniform vec2 uOrigin;    // vUv=(0,0) 的世界 XZ
uniform vec2 uCenter;    // 岛心 XZ
uniform float uGrassR;   // 草地半径
uniform float uSandR;    // 岸线半径
uniform float uGroundY;  // 这张平面的世界高度（算视线用）
uniform float uTime;

// 霾（= 季节雾色）—— 远处一律交给它，这就是"世界边界"
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;

uniform vec3 uSandA;
uniform vec3 uSandB;
uniform vec3 uWetSand;
uniform vec3 uFoam;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;

${NOISE_GLSL}
${GRASS_GLSL}

void main() {
    vec2 world = vUv * uSize;
    // -PI/2 旋转过的地面平面：v 轴与世界 +Z 反向
    vec2 gw = uOrigin + world * vec2(1.0, -1.0);
    vec3 wp = vec3(gw.x, uGroundY, gw.y);

    vec2 d = gw - uCenter;
    float r = length(d);
    float ang = atan(d.y, d.x);

    // ---- 岸线：低频把岛拉成不规则形，高频挖出小湾 --------------------
    float wobble = (noise2(vec2(cos(ang), sin(ang)) * 2.2 + 7.0) - 0.5) * 7.0
                 + (noise2(gw * 0.30 + 21.0) - 0.5) * 3.0;
    float coast = uSandR + wobble;
    float sd = coast - r;                 // >0 陆地，<0 海
    float depth = -sd;

    // 草地边界（另一条噪声，与岸线不同步 —— 否则沙滩宽度处处相等，很假）
    float grassEdge = uGrassR + (noise2(gw * 0.42 + 4.0) - 0.5) * 5.0;

    // ---- 海 ----------------------------------------------------------
    vec3 water = mix(uWaterShallow, uWaterDeep, smoothstep(0.5, 14.0, depth));

    // 掠射角 → 反射天光（越平看海越亮）。这是"海"最省事的一条，
    // 不用真反射、不用 cubemap，颜色和季节雾色同源，所以永远不跳。
    vec3 V = normalize(cameraPosition - wp);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    water = mix(water, uHaze, clamp(fres * 0.75, 0.0, 0.85));

    // 两列行波 + 一点点角向抖动，免得看出同心圆
    float w1 = sin(r * 0.55 - uTime * 0.9 + noise2(gw * 0.7) * 2.0);
    float w2 = sin(ang * 9.0 + r * 0.9 - uTime * 1.4);
    water *= 0.94 + 0.06 * w1 + 0.04 * w2;

    float foamLine = smoothstep(0.55, 0.95, w1) * smoothstep(1.7, 0.0, depth);
    vec3 col = mix(water, uFoam, foamLine * 0.55);

    // ---- 沙滩（含湿沙带）--------------------------------------------
    float sandN = noise2(gw * 3.1) * 0.5 + noise2(gw * 9.0) * 0.5;
    vec3 sand = mix(uSandA, uSandB, sandN);

    // 湿沙：浪刚爬上去的那一条，逐波来回 —— 就是 tidewater 的 swash，
    // 只不过它跑的是浅水方程，这里是一条随 r 与时间移动的带子。
    float swash = 2.6 + 1.5 * sin(uTime * 0.62 - r * 0.42);
    float wet = smoothstep(swash, swash - 1.1, sd);
    sand = mix(sand, uWetSand, wet * 0.72);

    // 冬：沙上一层薄雪（沙存不住雪，所以只给一半覆盖度）
    sand = mix(sand, SNOW_COL, uSnow * snowCoverage(gw) * 0.45);

    float land = smoothstep(-0.35, 0.35, sd);
    col = mix(col, sand, land);

    // ---- 草 ----------------------------------------------------------
    float grassMask = smoothstep(grassEdge + 0.8, grassEdge - 0.8, r);
    col = mix(col, grassSurface(gw), grassMask * land);

    // ---- 霾：远处全部交给季节雾色 ------------------------------------
    float fog = smoothstep(uHazeNear, uHazeFar, length(cameraPosition - wp));
    col = mix(col, uHaze, fog);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 沙滩 / 海 的四季色板                                                */
/*                                                                     */
/* 与 `SEASON_GROUND` 同一条规矩：**sRGB 0..1**，色板中点 ≈ 屏幕色。    */
/* ------------------------------------------------------------------ */

export const ISLAND_SEASON = {
    /* 春：水温还凉 —— 偏青绿；沙是湿的（春雨），湿沙带更明显。 */
    spring: {
        uSandA: [0.831, 0.784, 0.690],
        uSandB: [0.753, 0.706, 0.612],
        uWetSand: [0.549, 0.510, 0.439],
        uFoam: [0.960, 0.973, 0.984],
        uWaterShallow: [0.322, 0.549, 0.573],
        uWaterDeep: [0.145, 0.325, 0.404],
    },
    /* 夏：通透的青蓝，浅滩最亮 —— 这是"能看见海"的一季。 */
    summer: {
        uSandA: [0.878, 0.831, 0.722],
        uSandB: [0.804, 0.749, 0.635],
        uWetSand: [0.588, 0.541, 0.455],
        uFoam: [0.973, 0.984, 0.996],
        uWaterShallow: [0.286, 0.596, 0.612],
        uWaterDeep: [0.094, 0.310, 0.451],
    },
    /* 秋：天高气爽 —— 海更深更冷，沙偏灰。 */
    autumn: {
        uSandA: [0.796, 0.760, 0.678],
        uSandB: [0.722, 0.686, 0.608],
        uWetSand: [0.522, 0.494, 0.427],
        uFoam: [0.945, 0.957, 0.969],
        uWaterShallow: [0.263, 0.478, 0.510],
        uWaterDeep: [0.086, 0.247, 0.353],
    },
    /* 冬：**冷灰的海** —— 与雪地是同一族冷色，不要出现热带蓝。 */
    winter: {
        uSandA: [0.769, 0.761, 0.749],
        uSandB: [0.694, 0.686, 0.678],
        uWetSand: [0.478, 0.478, 0.478],
        uFoam: [0.933, 0.945, 0.957],
        uWaterShallow: [0.361, 0.412, 0.463],
        uWaterDeep: [0.176, 0.227, 0.286],
    },
};

/** 某一季的岛色板 → uniform 对象。未知季节落到秋天。 */
export function islandSeasonUniforms(season = 'autumn') {
    const p = ISLAND_SEASON[season] || ISLAND_SEASON.autumn;
    return {
        uSandA: { value: p.uSandA },
        uSandB: { value: p.uSandB },
        uWetSand: { value: p.uWetSand },
        uFoam: { value: p.uFoam },
        uWaterShallow: { value: p.uWaterShallow },
        uWaterDeep: { value: p.uWaterDeep },
    };
}

/* ------------------------------------------------------------------ */
/* 竹林的四季色板                                                      */
/* ------------------------------------------------------------------ */
/* 竹子是**常绿**的（和外墙那株常春藤同规矩）：冬天只变暗变闷，
 * **不许变白也不许枯成黄草** —— 枯了那是芦苇，不是竹。
 * 四季的差异全在"嫩 / 浓 / 转黄 / 发闷"四个方向上，幅度都压在 ±20% 内。 */

export const BAMBOO_SEASON = {
    spring: { culmA: [0.451, 0.639, 0.298], culmB: [0.573, 0.741, 0.373], blade: [0.494, 0.706, 0.318] },
    summer: { culmA: [0.239, 0.451, 0.220], culmB: [0.353, 0.573, 0.278], blade: [0.271, 0.514, 0.239] },
    autumn: { culmA: [0.404, 0.494, 0.216], culmB: [0.510, 0.588, 0.259], blade: [0.435, 0.549, 0.227] },
    winter: { culmA: [0.310, 0.373, 0.298], culmB: [0.408, 0.451, 0.361], blade: [0.337, 0.412, 0.318] },
};

/** 某一季的竹色板 → uniform 对象。未知季节落到秋天。 */
export function bambooSeasonUniforms(season = 'autumn') {
    const p = BAMBOO_SEASON[season] || BAMBOO_SEASON.autumn;
    return {
        uCulmA: { value: p.culmA },
        uCulmB: { value: p.culmB },
        uBlade: { value: p.blade },
    };
}
