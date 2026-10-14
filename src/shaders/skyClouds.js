/**
 * 天空里的云（WO-20 上色 / WO-30 形体 / 2026-10-14 路线 C：SDF + 烘焙法线）。
 * ==================================================================
 *
 * 用户：「云朵搞逼真一点（是否上 glsl）」→ WO-30 拍板 (A) billboard + GLSL 片元。
 * 用户（2026-10-14）：「我们的目标是实现它的效果，甚至超越它」→ 拍板**路线 C**。
 *
 * ---------------------------------------------------------------------------
 * 路线 C（2026-10-14）：贴图从「素描」换成「距离场 + 逐瓣法线」
 * ---------------------------------------------------------------------------
 * 对齐参考实现（`sunset-flight-study/src/sunset-world.js` 的 `createCloudMaterial`，
 * 行 219-252）时发现：它让云"像画的"靠的是**真几何法线**（`MarchingCubes` 44³
 * metaball）驱动的四件事 —— 四档 cel 分色 / 凹谷遮蔽 `hollow` / 朝阳侧金边
 * `silhouette` / 笔触颗粒。它**根本没有描边**。
 *
 * 实测过直接搬它的几何：**一次烘焙 429 ms、4 万三角面**（`.workbuddy-ai/.tmp/ref/
 * bake-bench.mjs`），而且它的 44³ 是按**公里级**世界校的 —— 搬进我们半径 54~92
 * 的世界，大半三角形落在亚像素上。 ⇒ 不搬几何，改**把法线烘进贴图**：
 *
 *   · union-of-spheres 的法线是**解析**的：像素 p 上「z 最靠前的那个瓣」，
 *     法线 = `(dx, dy, sqrt(r²−d²)) / r`（`utils/cloudArt.js` 的
 *     `makeCloudVolumeTexture`）。**不是近似** —— WO-30 走过的弯路
 *     （alpha 模糊求梯度）是被墨线弧带偏的近似；这条与墨线无关
 *     （墨线根本不在贴图里了）。
 *   · 一张贴图同时给出**带符号距离场**（R）与法线（G/B）：
 *     侵蚀、墨线、抗锯齿边**全部**从距离场来 ⇒ 比 WO-30 的
 *     「3×3 模糊出软高度场」**少 9 次贴图采样**。
 *
 * 🔴 **颜色只有一个真源**（§5，不能破）：uTop / uBottom / uGold / uHaze 每帧从
 *    天空穹顶与 scene.fog 派生（见 `SkyClouds.jsx`）。参考实现是**黄昏紫**
 *    （uZenith #382647 / uHorizon #c87675），本项目是春季白天 —— **抄结构不抄颜色**。
 *
 * 🔴 三级降级照旧：`uDetail` 是 uniform ⇒ fbm 走**一致分支**，低端机真的少算。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**，
 *    引用标识符一律用「」。改完跑
 *    `python3 .workbuddy-ai/harness/check-glsl-backticks.py`
 *    和 `python3 .workbuddy-ai/harness/check-shader-uniforms.py`。
 */

export const CLOUD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
varying float vDepth;

void main() {
    vUv = uv;
    // 面片是 billboard（每帧由 CPU 写进 instanceMatrix），所以这里只做常规变换。
    // ⚠️ 「instanceMatrix」是 three 在 InstancedMesh 上**自动声明**的属性
    //    （WebGLProgram 的前缀里有「#ifdef USE_INSTANCING attribute mat4
    //    instanceMatrix;」），自定义 ShaderMaterial 一样能拿到。
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uGold;
uniform vec3 uSunCam;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uOpacity;
uniform float uInk;
uniform float uInkW;
uniform float uSdfRange;
uniform float uErode;
uniform float uEdge;
uniform float uNoiseScale;
uniform float uSunAmt;
uniform float uShadeAmt;
uniform float uGoldAmt;
uniform float uDetail;

varying vec2 vUv;
varying vec3 vW;
varying float vDepth;

/* 分色的三档（参考实现是四档 + uBandSoftness；我们只有两个体色 + 一个金）。
   阈值抄参考实现的 −0.15 / 0.235 两档。 */
const float BAND0 = -0.15;
const float BAND1 = 0.30;
const float BAND_SOFT = 0.09;
const float RIM_POWER = 2.2;

/* 值噪声 —— 与天空穹顶（「SceneLighting.jsx」的 SKY_FRAG）同一套。 */
float cloudHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x),
        mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0)), f.x), f.y);
}

/* fbm。🔴 档数走**一致分支**（「uDetail」是 uniform ⇒ 整个 draw 同一条路），
   所以低档是**真的少算**，不是"乘个 0 照样算"。
   🔴 归一化用的「norm」**就在这儿跟着档数加** —— 不在 JS 里另存一份权重表。 */
float cloudFbm(vec2 p) {
    float v = cloudNoise(p) * 0.53;
    float norm = 0.53;
    if (uDetail > 0.5) {
        v += cloudNoise(p * 2.07 + 17.4) * 0.27; norm += 0.27;
        v += cloudNoise(p * 4.13 + 31.8) * 0.14; norm += 0.14;
        if (uDetail > 1.5) { v += cloudNoise(p * 8.31 + 53.1) * 0.06; norm += 0.06; }
    }
    return v / norm;
}

void main() {
    /* ---- 贴图 = 距离场 + 法线（见 makeCloudVolumeTexture 的通道布局）---- */
    vec4 t = texture2D(uMap, vUv);
    float sd = (t.r - 0.5) * uSdfRange;          // UV；云内为负
    vec2 np = (t.gb - 0.5) * 2.0;
    float nz = sqrt(max(0.0, 1.0 - min(dot(np, np), 1.0)));
    vec3 nrm = vec3(np, nz);

    /* 种子从**世界位置**派生：一朵云的三个层片位置不同 ⇒ 侵蚀花样不同，
       而同一朵云每帧相同 ⇒ 确定性、可复现，且**不需要**新增 instance 属性。 */
    vec2 seed = vec2(
        cloudHash(vW.xz + vW.y * 0.37),
        cloudHash(vW.zx + vW.y * 0.71 + 13.7)) * 37.0;
    float n = cloudFbm(vUv * uNoiseScale + seed);

    /* 光照标量 l 必须在 ① 之前算：墨线外缘 inkOuter 跟着受光 fade，
       而 alpha（①）本身要含到墨线外缘（见 ① 内注释）。 */
    float ndl = dot(nrm, normalize(uSunCam));
    float l = ndl * 0.77 + nrm.y * 0.24 + (n - 0.5) * 0.20;

    /* ---- ① 侵蚀剪影 ----------------------------------------------------
       🔴 与 WO-30 的本质差别：阈值挪的现在是**真距离**（UV）——
          不需要先模糊出软高度场（省掉那 9 次采样），阈值挪 Δ 就是把边挪 Δ。
       sde = 被噪声推过的带符号距离，墨线/金边都认它（跟着被侵蚀的边走）。
       🔴 覆盖度必须延伸到**墨线外缘**（cut + inkOuter）：墨线长在轮廓外侧，
          若 alpha 在 sde=0 就归零，外半条墨线根本没被画出来 —— 2026-10-14
          首拍实测只剩 2px 残边、最暗 120（旧素描的 alpha 是**含墨环**的）。
          受光侧线变细时轮廓跟着收（线是画的，"没有线的那段"轮廓就退回去）。 */
    float cut = (n - 0.5) * uErode;
    float sde = sd - cut;
    /* 受光侧让线**淡下去**（手绘的线在受光侧会"断"）——等宽死黑环 = 贴纸。
       ⚠️ 淡到 0.35 太狠（首拍墨线只剩 2px），0.5 是"受光侧还在、但明显让"。 */
    float inkFade = mix(1.0, 0.5, smoothstep(-0.34, 0.30, l));
    float inkOuter = uInkW * inkFade;
    float a = (1.0 - smoothstep(cut + inkOuter - uEdge, cut + inkOuter + uEdge, sd)) * uOpacity;
    if (a < 0.004) discard;

    /* ---- ② 体色（真源仍是穹顶，§5）------------------------------------- */
    vec3 c = mix(uBottom, uTop, vUv.y);

    /* ---- ③ 分色 + 明暗（真实逐瓣法线）----------------------------------
       权重抄参考实现：sunFacing*0.77 + n.y*0.24 + brush*0.20。
       🔴 分色是**把连续的 l 切成台阶**（软肩 BAND_SOFT），这就是"像画的"那一步；
          抬/压仍走**乘性**（§5：mix(c, uTop, ...) 在云顶无效，踩过）。
       （ndl / l 已在 ① 前算好 —— inkOuter 依赖 l。） */
    float b0 = smoothstep(BAND0 - BAND_SOFT, BAND0 + BAND_SOFT, l);
    float b1 = smoothstep(BAND1 - BAND_SOFT, BAND1 + BAND_SOFT, l);
    /* 🔴 档差必须**拉得开**：参考实现的 uDeep→uCoral 跨度极大，我们的体色
          都接近白 ⇒ 若只乘 ±0.16，实测整朵云被打到 255 一片平（2026-10-14
          首拍：云身 p50 = 255、内部 |dL| 只有 0.84）。暗档沉到 ~×0.49、
          亮档抬到 ~×1.11，才有"分色"可读。两处都乘 uSunAmt/uShadeAmt
          ⇒ identity（全 0）仍是平的，S4 的 A/B 契约不破。 */
    c *= 1.0 + b1 * (uSunAmt * 0.55) - (1.0 - b0) * (uShadeAmt * 3.2);

    /* 凹谷遮蔽（参考实现是显式的「hollow」项，别指望法线一项顺带做出来）。 */
    float hollow = (1.0 - smoothstep(-0.76, -0.08, nrm.y))
        * (1.0 - smoothstep(0.0, 0.42, l));
    c = mix(c, uBottom * 0.72, hollow * 0.5 * uShadeAmt);

    /* ---- ④ 朝阳侧金边（参考实现的「silhouette」项）----------------------
       🔴 billboard 空间里**视线恒为 +z** ⇒ dot(n, eye) 就是 n.z ——
          免费拿到"只在轮廓处高"的那个量。
       🔴 必须乘 smoothstep(−0.34, 0.30, l)：只有**朝阳那半边**的轮廓才亮；
          整圈亮就变成另一条墨线了。 */
    float sil = 1.0 - nrm.z;
    float sunEdge = pow(sil, RIM_POWER) * smoothstep(-0.34, 0.30, l);
    c = mix(c, uGold * 1.13, smoothstep(0.035, 0.64, sunEdge) * uGoldAmt);

    /* ---- ⑤ 墨线：距离场的等值带 ----------------------------------------
       🔴 同一朵云的三个层片、以及所有变体，用的都是**同一个相对宽度**
          （uInkW 是 UV 常数）—— 修掉 WO-32b 那个 0.020 vs 0.003 的
          位图时代残留。线的屏幕粗细 ∝ 云的屏上大小，那是"画被放大"，
          不是 bug。 */
    /* 🔴 带的外缘 = inkOuter（= ① 里 alpha 的延伸终点）⇒ 线正好落在被画
       出来的那一环里，外半条不会再次被裁掉。内缘仍认 sde=0（云身边缘）。 */
    float ink = smoothstep(-uEdge * 0.5, uEdge * 0.5, sde)
        * (1.0 - smoothstep(inkOuter - uEdge * 0.5, inkOuter + uEdge * 0.5, sde));
    ink *= inkFade;
    c *= mix(vec3(1.0), vec3(0.06), ink * uInk);

    // ⑥ 距离霾：和飞机 / 两棵树 / 竹林同一条 —— 每帧从 scene.fog 拷。
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));

    gl_FragColor = vec4(c, a);
}
`;

/**
 * 云的形状 / 形体参数。
 *
 * ⚠️ **颜色不在这里定死** —— `uTop` / `uBottom` / `uGold` / `uHaze` 都由
 *    `SkyClouds.jsx` 每帧从**天空穹顶的 uniform** 与 `scene.fog` 派生。
 *    这里只给形状参数。
 *
 * ⚠️ 「SDF_RANGE」必须与 `utils/cloudArt.js` 的 `makeCloudVolumeTexture`
 *    里的量程**一致** —— 同一个事实存两份迟早不同步，两边注释互相点名，
 *    改一个必须改另一个。
 */
export const CLOUD_SHAPE = Object.freeze({
    /** 整体不透明度。云不是实心的 —— 留一点让天光透过来。 */
    OPACITY: 0.92,
    /** 墨线强度（0..1，乘在等值带上；0.06 是底线，纯 0 的墨线是个洞）。 */
    INK: 0.94,
    /** 墨线带的宽度（UV，≈ 画布宽的 2%）。**所有变体同一个值** ⇒ 相对宽度恒定。
     *  ⚠️ 带的两肩是 `uEdge*0.5` —— 0.012 时带宽在屏上被软肩吃掉一半
     *     （首拍最暗只到 168、实测宽度只剩 2px）。 */
    INK_W: 0.020,
    /** 金边满强度时的 mix 量（参考实现 0.87）。 */
    GOLD_AMT: 0.87,

    /* ---- 距离场 / 侵蚀（都是 **UV** 单位）------------------------------ */
    /** 贴图里距离场的存储量程（与 makeCloudVolumeTexture 的 SDF_RANGE 一致）。 */
    SDF_RANGE: 0.10,
    /**
     * 剪影侵蚀强度（UV）—— 阈值被 fbm 推开的**幅度**。
     * 换算：`fbm` 的 std ≈ 0.15 ⇒ 边缘摆动 rms ≈ `0.15 × ERODE` UV
     * ≈ 0.0045 UV ≈ **2.3 px**（贴图 512 宽）。实测见探针 S2/S3。
     */
    ERODE: 0.03,
    /** 阈值的过渡宽度（UV ≈ 1.8 px）。太小 = 硬边，太大 = 整朵云糊掉。 */
    EDGE: 0.0035,
    /** fbm 的域尺度 —— 越大块越小。 */
    NOISE_SCALE: 12.0,

    /* ---- 明暗（乘性，见片元 ③）---------------------------------------- */
    /** 朝阳面提亮多少。 */
    SUN_AMT: 0.20,
    /** 背光面压暗多少（同时驱动凹谷遮蔽）。 */
    SHADE_AMT: 0.16,

    /**
     * fbm 档数（HIGH / LOW）。🔴 低档是**真的少算**（一致分支）。
     */
    DETAIL_HIGH: 3,
    DETAIL_LOW: 1,
});

/**
 * 「形体全关」的一组参数 —— 判据用它做 A/B 基线。
 *
 * ⚠️ 和 WO-29 的 `FINISH_IDENTITY` 同一个用法：**判据不许自带一份 config**
 *    （§28.1），所以基线也从这里取。
 *
 * 🔴 `DETAIL_HIGH` 保留：这条只关**形体**（侵蚀 + 明暗），不关噪声档数。
 */
export const CLOUD_IDENTITY = Object.freeze({
    ERODE: 0,
    SUN_AMT: 0,
    SHADE_AMT: 0,
});
