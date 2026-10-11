import { NOISE_GLSL } from './entranceTextures';

/**
 * 梦幻森林的着色器 —— 细树干 / 球形树冠。
 * ==================================================================
 *
 * 用户 2026-10-12：「竹林换成超现实幻想梦幻森林」，参考图三张：
 *   ① 一棵巨树占满画面，树冠是**发光的绿色圆球**，地面是荧光绿，两个人小到看不见；
 *   ② 细长树干上**顶着一个个完美的圆球**（有大有小、有的和树干脱开浮在旁边），
 *      背景一层层雾化的球冠，天是奶油色的；
 *   ③ 绿坡上的球形树，远景的树化成一团团浅绿的剪影，前景有水、有百合、有燕子。
 *
 * 三张图共同的三件事，也就是这个文件要做的三件事
 * -----------------------------------------------
 *  1. 🔴 **树冠是一个球**，不是一个"蓬松的叶团"。所以用 `SphereGeometry`，
 *     不要噪声位移、不要顶点打散 —— 一旦破掉轮廓的圆，"梦幻"就没了。
 *  2. 🔴 **球的外缘是发光的**（背光那一圈最亮）。参考图里球体读起来像里面
 *     有光，靠的就是这条 rim —— 只做 lambert 会得到一个墨绿的塑料球。
 *  3. **球面要有细颗粒**。纯色球 = 塑料球；撒一层 `fbm` 斑点才是"一球叶子"。
 *
 * 和 `BambooGrove` 的关系
 * -----------------------
 * 结构完全沿用（2 个 InstancedMesh、实例属性带风、每帧从 `scene.fog` 拷霾、
 * 顶点着色器里按实例原点做"贴脸就让开"）—— 那一套是验过的，没必要重造。
 * 换掉的是：形状（锥形管 → 细杆 + 球）、调色、以及杆的形态。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— 本文件的注释**不许出现反引号**，用「」。
 *    改完跑 `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
 */

/* ------------------------------------------------------------------ */
/* 树干                                                                */
/* ------------------------------------------------------------------ */

export const FOREST_TRUNK_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWind;
uniform float uHeight;
uniform vec3 uCamPos;
uniform float uFadeNear;
uniform float uFadeFar;
varying float vTint;
varying float vH;
varying float vDepth;

void main() {
    vec3 p = position;
    float h = clamp(p.y / uHeight + 0.5, 0.0, 1.0);   // 0 根部 · 1 梢部

    // ---- 贴脸就让开（沿用 BambooGrove 的 DR-H 那条）----
    // 按**实例原点**算，整根一起细；按顶点算会变成楔形。
    vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
        o = instanceMatrix * o;
    #endif
    vec3 ow = (modelMatrix * o).xyz;
    float keep = smoothstep(uFadeNear, uFadeFar, distance(ow, uCamPos));
    p.xz *= keep;

    vec4 ip = vec4(p, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;

    // 树越高摆得越慢：细高杆的频率本来就比竹子低
    float sway = sin(uTime * 0.55 + aPhase) * 0.7 + sin(uTime * 0.91 + aPhase * 1.7) * 0.3;
    float bend = h * h;
    wp.x += sway * uWind * bend;
    wp.z += cos(uTime * 0.47 + aPhase * 1.3) * uWind * 0.7 * bend;

    vTint = aTint;
    vH = h;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const FOREST_TRUNK_FRAG = /* glsl */ `
uniform vec3 uTrunkA;
uniform vec3 uTrunkB;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vTint;
varying float vH;
varying float vDepth;

void main() {
    vec3 c = mix(uTrunkA, uTrunkB, vTint);
    // 根部埋进草里那一截晒不到：压暗，往梢部渐亮
    c *= 0.62 + 0.38 * vH;
    // 细杆上那道竖向的浅浅的明暗（参考图里的树干有一侧偏亮）
    c *= 0.94 + 0.06 * sin(vH * 5.0);
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 球形树冠                                                            */
/* ------------------------------------------------------------------ */

export const FOREST_BALL_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWind;
uniform float uGroundY;
uniform float uSpan;        // 森林的竖向跨度，用来归一化"这一球多高"
uniform vec3 uCamPos;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying float vTint;
varying float vDepth;

void main() {
    vLocal = position;          // 球的单位局部坐标（半径 1）→ 拿去撒斑点
    vTint = aTint;

    vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
        o = instanceMatrix * o;
    #endif
    vec3 ow = (modelMatrix * o).xyz;
    float keep = smoothstep(uFadeNear, uFadeFar, distance(ow, uCamPos));

    // 🔴 贴脸让开要作用在**局部顶点**上（缩向球心），不能缩实例空间的原点 ——
    //    球心不在世界原点上，缩原点会把球推走而不是缩小。
    vec4 lp = vec4(position * keep, 1.0);
    #ifdef USE_INSTANCING
        lp = instanceMatrix * lp;
    #endif

    // 🔴 球是**刚体**：整球一起平移，不按顶点高度弯。按顶点弯的话球会变形，
    //    而"完美的圆"正是这套梦幻语汇的第一条。
    float rel = clamp((ow.y - uGroundY) / uSpan, 0.0, 1.0);
    float bend = rel * rel;
    float sway = sin(uTime * 0.55 + aPhase) * 0.7 + sin(uTime * 0.91 + aPhase * 1.7) * 0.3;
    lp.x += sway * uWind * bend;
    lp.z += cos(uTime * 0.47 + aPhase * 1.3) * uWind * 0.7 * bend;

    vec4 wp = modelMatrix * lp;
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const FOREST_BALL_FRAG = /* glsl */ `
uniform vec3 uBallLit;
uniform vec3 uBallDark;
uniform vec3 uBallRim;
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uSpeckle;
varying vec3 vN;
varying vec3 vW;
varying vec3 vLocal;
varying float vTint;
varying float vDepth;

${NOISE_GLSL}

void main() {
    vec3 n = normalize(vN);

    float lam = max(dot(n, normalize(uLightDir)), 0.0);
    float sky = 0.5 + 0.5 * n.y;

    vec3 c = mix(uBallDark, uBallLit, clamp(0.26 + 0.46 * sky + 0.64 * lam, 0.0, 1.3));

    // 球面的细颗粒：纯色球是塑料球，撒一层斑点才读成"一球叶子"。
    // 用单位局部坐标（半径 1）当 uv，所以颗粒跟着球走、不随世界位置漂移。
    // ⚠️ fbm 只接受 **vec2**（见 NOISE_GLSL）。球的局部坐标是 vec3，所以要
    //    自己折成两维 —— 用 (x+z, y) 而不是 xz：x z 在球的南北极会退化成一条线，
    //    斑点会在两极糊成一片。
    float speck = fbm(vec2(vLocal.x + vLocal.z, vLocal.y) * 5.5 + vTint * 13.0);
    c *= 1.0 - uSpeckle * 0.5 + uSpeckle * speck;

    // 🔴 外缘透光：背光那一圈最亮（参考图里球像自己在发光）。
    //    没有这一条，整棵树就是一堆墨绿的塑料球 —— 它是"梦幻"的**全部**来源。
    vec3 V = normalize(cameraPosition - vW);
    float rim = pow(1.0 - max(dot(n, V), 0.0), 2.6);
    c += uBallRim * rim * (0.30 + 0.70 * (1.0 - lam));

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;
