/**
 * 狗尾巴草的着色器（叶片 + 穗共用一个材质）。
 * ==================================================================
 *
 * 2026-10-11 用户：「窗下的竹篱笆换成狗尾巴草看看效果，门口两边都要，
 * 和墙宽一样。注意不能和花箱穿透了。」
 *
 * 为什么不是贴图 / 不是平面
 * ------------------------
 * 这正是竹篱当年踩过的坑（见 `BambooFence.jsx` 顶上的长注释）：一张
 * alphaTest 平面正面看着没问题，**绕到侧面就是一张纸** —— 厚度为零，
 * 而且单面材质从背后直接被剔除，整片消失。院子现在能绕着看，所以草必须
 * 是**实体几何**：一根草叶 = 一个 3 棱的锥台，任何角度都看得到。
 *
 * 为什么另起一套而不是复用 `CANE_VERT/CANE_FRAG`
 * ----------------------------------------------
 * 竹竿那套里有两件草不需要的东西：**竹节环**（`fract(vH * aNodes)`）和
 * 「根部压暗 × aBend」的耦合。更要紧的是草要一个竹竿没有的概念：**穗**
 * （`aSeed`）—— 它既是另一种颜色，也是另一种**风摆方式**（见下）。
 * 硬塞进竹竿那套会把两边都变形，所以另起一对；但**风 / 雾 / 四季色板
 * 的接法完全照抄竹竿**，两者在画面里才是同一个世界的东西。
 *
 * 🔴 穗必须**刚性跟住叶尖**，否则风一吹就分家
 * ------------------------------------------
 * 竹竿的风摆是 `wp.x += sway · uWind · h²` —— 根部不动、梢部摆得最多。
 * 如果穗也照这个来，它的**根部**（h=0）就不动，而它踩着的叶尖（h=1）在动
 * ⇒ 风一吹，穗与叶尖之间会裂开一条缝。所以这里给穗一个**常量 bend = 1**：
 *
 *     float bend = mix(h * h, 1.0, aSeed);
 *
 * 整个穗整体平移同一个量，而 `aPhase` 与它那片叶**取同一个值** —— 于是
 * 穗永远坐在叶尖上。`aSeed` 因此一物两用：既选颜色，也选"是否刚性跟随"。
 *
 * ⚠️ GLSL 块是 JS 模板字面量：**注释里出现反引号会把字符串截断**（报错
 *    还和现场毫无关系）。本文件注释一律用「」。判据：
 *    `python3 .workbuddy-ai/harness/check-glsl-backticks.py`
 *
 * ⚠️ 新增 uniform 必须同时出现在 `FoxtailGrass.jsx` 的 `useSeasonUniforms`
 *    工厂里，否则换季时会**静默停在首季**（见 `hooks/useSeasonUniforms.js`）。
 */

export const FOXTAIL_VERT = /* glsl */ `
attribute float aPhase;   // 风摆相位（叶与它的穗**共用**同一个值，见文件头）
attribute float aTint;    // 0..1 个体色差
attribute float aSeed;    // 0 = 叶片，1 = 穗
uniform float uTime;
uniform float uWind;
varying float vTint;
varying float vH;
varying float vSeed;
varying float vDepth;

void main() {
    // ⚠️ 几何体的 y 是 **0..1**（根部在原点），不是圆柱默认的 −0.5..0.5 ——
    //    这样实例绕 z 倾斜时是**绕根部**转，草才会从地面往外散开，而不是
    //    以腰为轴摇摆（见 utils/foxtailGrass.js 的几何构建）。
    vec3 p = position;
    float h = clamp(p.y, 0.0, 1.0);

    vec4 ip = vec4(p, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;

    // 两列不同频率叠加：单频会看出「整片草一起齐步走」
    float sway = sin(uTime * 1.32 + aPhase) * 0.7 + sin(uTime * 0.83 + aPhase * 1.7) * 0.3;
    float bend = mix(h * h, 1.0, aSeed);
    wp.x += sway * uWind * bend;
    wp.z += cos(uTime * 1.07 + aPhase * 1.3) * uWind * 0.6 * bend;

    vTint = aTint;
    vH = h;
    vSeed = aSeed;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const FOXTAIL_FRAG = /* glsl */ `
uniform vec3 uBladeA;     // 叶：梢部（受光那一截）
uniform vec3 uBladeB;     // 叶：根部（晒不到，更暗更沉）
uniform vec3 uSeed;       // 穗
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vTint;
varying float vH;
varying float vSeed;
varying float vDepth;

void main() {
    // 叶片：根深梢浅 —— 这是草最好认的一条明暗规律，也是唯一能让"实心
    // 3 棱柱"读出「细长叶子」而不是「一根塑料签」的东西。
    // vTint 给每一根不同的深浅，否则一片同色会读成一块地毯。
    vec3 c = mix(uBladeB, uBladeA, vH * 0.78 + vTint * 0.22);

    // 穗：一次到位的浅色（狗尾巴草的穗本来就比叶淡、偏黄）。它只有 0.16
    // 世界单位长，在正面机位上是十几个像素 —— 所以这里不再做"绒毛"的细节，
    // 靠的是**形状**（一个低面数的纺锤体，见 geometry）与颜色。
    c = mix(c, uSeed * (0.90 + 0.10 * vH), vSeed);

    // 雾：与竹篱/竹林同一套（每帧从 scene.fog 抄进来）。
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));

    gl_FragColor = vec4(c, 1.0);
}
`;
