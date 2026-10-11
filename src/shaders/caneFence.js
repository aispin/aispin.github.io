/**
 * 竹篱的竹竿着色器（立竹 + 横档共用一个材质）。
 * ==================================================================
 *
 * 为什么是一对自定义 shader 而不是 `meshStandardMaterial`
 * -------------------------------------------------------
 * ① **风摆**。竹篱是院子里唯一"活着"的硬质构件，全项目其它硬表面都是死的。
 *    摆幅由 uniform `uWind` 给（默认 0.05 —— 篱笆该比竹林（`BAMBOO_WIND`
 *    0.34）安静一个量级，它是被绑住的）。
 * ② `meshStandardMaterial` 在这个场景里**接近全黑**：`SceneLighting` 没开
 *    阴影、没有 envMap、没上 toneMapping，标准材质拿不到可用的间接光。
 *    这一点在 `shaders/entranceTextures.js` 顶部有更长的说明。
 *
 * 立竹和横档为什么能共用一套
 * --------------------------
 * 横档 = 转了 90° 的竹竿，几何上是同一根单位圆柱。真正的差别只有两点，
 * 都做成了**实例属性**：
 *
 *   · `aBend`  —— 1 = 立竹（顶端摆，且根部压暗），0 = 横档（绑死不摆）
 *   · `aNodes` —— 竹节道数，沿**竿身**等距排。立竹给 2（沿 0.45 的高度），
 *                 横档给 `length / 0.365`（沿长度排 10 道）
 *
 * 于是"竹节"这一条 shader 不需要知道自己在画立竹还是横档：`vH` 沿圆柱的
 * 局部 y 跑，横档被转了 90° 之后局部 y 正好就是它的长度方向，环自然顺着
 * 长度排 —— 正是竹子该有的样子。
 *
 * ⚠️ GLSL 块是 JS 模板字面量：**注释里出现反引号会把字符串截断**。
 *    本文件所有注释一律用「」代替反引号（项目硬规则）。
 *
 * ⚠️ 新增 uniform 必须同时出现在 `CaneFenceMesh` 的工厂函数里，否则换季
 *    时它会静默停在首季（见 `hooks/useSeasonUniforms.js` 的长注释）。
 *    本 shader 的色板（`uCulmA` / `uCulmB`）来自 `bambooSeasonUniforms()`，
 *    也就是**和竹林同一套四季竹色**。
 */

export const CANE_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
attribute float aBend;    // 1 = 立竹（顶端摆），0 = 横档（绑死不摆）
attribute float aNodes;   // 竹节道数（沿竿身）
uniform float uTime;
uniform float uWind;
varying float vTint;
varying float vH;
varying float vNodes;
varying float vBend;
varying float vDepth;

void main() {
    vec3 p = position;
    float h = clamp(p.y + 0.5, 0.0, 1.0);   // 0 根部 · 1 梢部（圆柱高 1）
    vec4 ip = vec4(p, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;
    // 两列不同频率叠加：单频会看出「整片一起齐步走」
    float sway = sin(uTime * 1.15 + aPhase) * 0.7 + sin(uTime * 0.71 + aPhase * 1.7) * 0.3;
    float bend = h * h * aBend;
    wp.x += sway * uWind * bend;
    wp.z += cos(uTime * 0.95 + aPhase * 1.3) * uWind * 0.55 * bend;
    vTint = aTint;
    vH = h;
    vNodes = aNodes;
    vBend = aBend;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const CANE_FRAG = /* glsl */ `
uniform vec3 uCulmA;
uniform vec3 uCulmB;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vTint;
varying float vH;
varying float vNodes;
varying float vBend;
varying float vDepth;

void main() {
    vec3 c = mix(uCulmA, uCulmB, vTint);
    // 竹节：沿竿身等距的一道道深色环。横档转了 90°，vH 于是沿**长度**跑，
    // 环也就顺着长度排 —— 正是竹子该有的样子，不需要为它单独写一套。
    float ring = abs(fract(vH * vNodes) - 0.5) * 2.0;
    c *= 0.86 + 0.14 * smoothstep(0.15, 0.75, ring);
    // 根部偏暗（埋在草里的那一截晒不到）。横档没有「根」，不该有这道渐变。
    c *= mix(1.0, 0.68 + 0.32 * vH, vBend);
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;
