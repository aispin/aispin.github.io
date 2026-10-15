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
 *   · 法线 = **平滑并集的前表面高度场**的梯度（`utils/cloudArt.js` 的
 *     `makeCloudVolumeTexture`）。2026-10-15（WO-32g）从"z 最靠前的那个瓣"
 *     换过来 —— 两者对**单个瓣**完全等价，但后者在瓣与瓣相交处法线**硬跳**，
 *     整朵云读成蜂窝（诊断 `.workbuddy-ai/.tmp/wo32g/lmap-*.png`）。
 *     ⚠️ WO-30 走过的弯路（把 alpha 模糊求梯度当法线）仍然不对：那求的是
 *     **素描**的梯度，会被画在里面的墨线弧带偏；现在求的是**几何**的梯度。
 *   · 一张贴图同时给出**带符号距离场**（R）与法线（G/B）：
 *     侵蚀、抗锯齿边**全部**从距离场来 ⇒ 比 WO-30 的
 *     「3×3 模糊出软高度场」**少 9 次贴图采样**。
 *
 * ---------------------------------------------------------------------------
 * WO-32g（2026-10-15）：去掉描边，对齐参考实现的"读法"
 * ---------------------------------------------------------------------------
 * 用户：「当前的云还是很假，有黑色明显的描边。和对标项目差别很大，需要继续优化。」
 * 三处改动（都记在代码里，这里只列索引）：
 *   ① **种子**从逐像素世界坐标改成**实例原点**（`CLOUD_VERT`）—— 原来那个
 *      是逐像素白噪声，把剪影糊成毛边、把墨线打成点阵（"黑色明显的描边"的真身）。
 *   ② **墨线整条删掉**（参考实现没有描边），形体改由「四档明度梯 + 凹谷 + 朝阳金边」
 *      读出来。
 *   ③ 明暗从"两档 ±16%"换成**四档乘性明度梯**；加宽软肩，避免硬色带。
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
varying vec3 vOrigin;
varying float vDepth;

void main() {
    vUv = uv;
    // 面片是 billboard（每帧由 CPU 写进 instanceMatrix），所以这里只做常规变换。
    // ⚠️ 「instanceMatrix」是 three 在 InstancedMesh 上**自动声明**的属性
    //    （WebGLProgram 的前缀里有「#ifdef USE_INSTANCING attribute mat4
    //    instanceMatrix;」），自定义 ShaderMaterial 一样能拿到。
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    /* 🔴 实例原点 —— 整片面片**同一个值**（顶点 0 的平移列）。侵蚀的种子从这里派生。
       ──────────────────────────────────────────────────────────────────────
       2026-10-15 修掉的大坑（WO-32g）：种子原来是从「vW」（**逐像素**的世界位置）
       派生的：

           vec2 seed = vec2(cloudHash(vW.xz + vW.y * 0.37), …) * 37.0;

       而「cloudHash」是「fract(sin(dot(p, …)) * 43758.5)」—— 对 p 的位移 0.02 个
       世界单位（≈ 一个像素的足迹）就已经**完全去相关**。于是 seed 是**逐像素白噪声**，
       fbm 变成逐像素雪花：
         · 剪影从"被噪声侵蚀的手绘边"退化成**一条抖动的毛边**；
         · 墨线带（宽 0.010~0.020 UV）被白噪声打成**点阵** —— 用户在 2026-10-15
           截图里看到的"黑色明显的描边"就是这个（不是线粗，是线**碎了**）。
       实例原点是逐帧写进 instanceMatrix 的**常量** ⇒ 同一朵云每帧相同（确定性）、
       不同层片不同（层片沿径向外推，原点本来就不同）—— 原文的意图保住了，
       但种子终于**在面片内是常数**，fbm 才是一条连续的场。 */
    vOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
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
uniform float uSdfRange;
uniform float uErode;
uniform float uEdge;
uniform float uNoiseScale;
uniform float uVertBias;
uniform float uSunAmt;
uniform float uShadeAmt;
uniform float uGoldAmt;
uniform float uGrain;
uniform float uDetail;

varying vec2 vUv;
varying vec3 vW;
varying vec3 vOrigin;
varying float vDepth;

/* 四档明度梯的档位（参考实现是五档色阶 uDeep→uShadow→uViolet→uLavender→uCoral）。
   🔴 阈值**不能照抄**它的 −0.56 / −0.15 / 0.235 / 0.715：那是对着它 MarchingCubes
   真 3D 法线的 l 分布校的（sunFacing / n.y 全域 −1..1）。我们的法线烘在 billboard
   上 ⇒ n.z ≈ 1 居多 ⇒ l 整体偏高，照抄 ⇒ 大半身子落亮档。按**我们的 l 分布**
   （std ≈ 0.40）重新落位：−0.38 / −0.04 / +0.38 ≈ −0.95σ / −0.1σ / +0.95σ。 */
const float BAND0 = -0.38;
const float BAND1 = -0.04;
const float BAND2 = 0.38;
const float BAND_SOFT = 0.24;

/* 🔴 档差**只能是乘性明度**，不能是第二套色板（§5：颜色只有一个真源）。
   参考实现的档差靠 uDeep(#49345f) → uCoral(#d98180) 的色相跨度，我们的体色
   从穹顶派生、白天接近白 ⇒ 只乘 ±0.16 的话整朵云会糊成一片 255（WO-30 首拍
   实测：云身 p50 = 255、内部 |dL| 只有 0.84）。
   ⚠️ 向下能走很远、向上只能走一点点：体色本底 ~0.95（**屏幕值**），×1.10 就削平。
   ⇒ DEEP/MID/SOFT 是主力，LIT 只敢给 0.20。 */
const float DEEP_K = 1.00;   // ×(1 − uShadeAmt)        最暗：背光面 / 谷底
const float MID_K = 0.62;    // ×(1 − uShadeAmt·0.62)   暗
const float SOFT_K = 0.30;   // ×(1 − uShadeAmt·0.30)   中
const float LIT_K = 0.20;    // ×(1 + uSunAmt·0.20)     朝阳面
const float HOLLOW_K = 0.42; // 凹谷再压一档（参考实现的 hollow 项）
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

    /* 种子 = **整片一个常数**（由 vOrigin 派生，见 CLOUD_VERT 的注释）。
       一朵云的三个层片原点不同 ⇒ 侵蚀花样不同；同一朵云每帧相同 ⇒ 确定性、可复现，
       且**不需要**新增 instance 属性。 */
    vec2 seed = vec2(
        cloudHash(vOrigin.xz),
        cloudHash(vOrigin.zx + 13.7)) * 37.0;
    float n = cloudFbm(vUv * uNoiseScale + seed);

    /* ---- ① 侵蚀剪影 ----------------------------------------------------
       🔴 与 WO-30 的本质差别：阈值挪的现在是**真距离**（UV）——
          不需要先模糊出软高度场（省掉那 9 次采样），阈值挪 Δ 就是把边挪 Δ。
       🔴 2026-10-15（WO-32g）：**墨线整个去掉了**。
          用户：「云很假，有黑色明显的描边」，而对标实现（「createCloudMaterial」）
          **根本没有描边** —— 它靠「五档色阶 + 凹谷 + 朝阳金边」读出形体。
          我们这边同样的读法由 ③④ 承担。原本那条等宽深色环还有两个自身的问题：
          ① 种子是白噪声时它被打成点阵（见 CLOUD_VERT）；
          ② 参考实现自己的注释就点过这个坑 ——「dark, hollow-looking contour bands
             between every billow」= 等宽深色环 = 贴纸。
          ⚠️ 「uInkW」/「uInk」随之退役；「uEdge」现在是**唯一的**边缘软肩。 */
    float cut = (n - 0.5) * uErode;
    float a = (1.0 - smoothstep(cut - uEdge, cut + uEdge, sd)) * uOpacity;
    if (a < 0.004) discard;

    /* 光照标量 l（① 之后算 —— 它现在不再被任何 alpha 相关的东西用到，
       纯粹是 ③ 的分档输入）。权重抄参考实现：sunFacing*0.77 + n.y*0.24 + brush*0.20。
       ──────────────────────────────────────────────────────────────────────
       🔴 2026-10-15（WO-32g）：**必须减掉「sunCam.z」**，否则分档跟着视角滑。
       平板处（云身中段）「nrm ≈ (0,0,1)」⇒「ndl = sunCam.z」—— 一个**跟着视角走**
       的常数（镜头朝太阳 ≈ 1、背对 ≈ −1）。不减它，整朵云就整体滑进某一档：
       实测这个机位「sunCam.z = 0.458」⇒ **54% 的纹素挤在最高档**，云读出来
       是一片白（诊断「harness/wo32g-lmap.mjs」，图「.tmp/wo32g/lmap-*.png」）。
       减掉之后「l」的中心与视角无关，四档才真的落在"云自己的明暗分布"上
       —— 实测档覆盖从 8/13/26/54 变成 **25/20/31/24**。
       ⚠️ 这一步**同时**丢掉了"逆光时整朵云变暗" —— 但那一档亮度变化本来就该由
          **派生色**（uTop / uBottom 跟着穹顶走）负责，不是由分档负责。 */
    vec3 sunCam = normalize(uSunCam);
    float ndl = dot(nrm, sunCam);
    float l = (ndl - sunCam.z) * 0.77 + nrm.y * 0.24 + (n - 0.5) * 0.20;

    /* ---- ② 体色（真源仍是穹顶，§5）-------------------------------------
       🔴 WO-32e：竖向渐变**向底偏置**（pow > 1 ⇒ 中段身子更靠近云带色）。
          背景：霾 A/B 已证伪（「wo32e-haze-ab.mjs」：fog 26/118 → 全关，
          云足迹 p50 纹丝不动 232.4 —— 近云深度 30~60，霾系数本来就 ~0.1）
          ⇒ 「云=天」的成因就是**派生色本身贴着天空色**。
          uVertBias = 1 时与旧版逐位一致。 */
    vec3 c = mix(uBottom, uTop, pow(vUv.y, uVertBias));

    /* ---- ③ 四档明度梯（"像画的"那一步）--------------------------------
       🔴 分色是**把连续的 l 切成台阶**（软肩 BAND_SOFT），这就是参考实现
          「Soft shoulders between stable paint tones preserve stepped faces」。
       🔴 抬/压必须**乘性**（§5：mix(c, uTop, …) 在云顶无效，踩过）。
       🔴 两处振幅都乘 uSunAmt / uShadeAmt ⇒ identity（全 0）仍是平的，
          S4 的 A/B 契约不破。 */
    float t0 = smoothstep(BAND0 - BAND_SOFT, BAND0 + BAND_SOFT, l);
    float t1 = smoothstep(BAND1 - BAND_SOFT, BAND1 + BAND_SOFT, l);
    float t2 = smoothstep(BAND2 - BAND_SOFT, BAND2 + BAND_SOFT, l);
    float k = mix(1.0 - uShadeAmt * DEEP_K, 1.0 - uShadeAmt * MID_K, t0);
    k = mix(k, 1.0 - uShadeAmt * SOFT_K, t1);
    k = mix(k, 1.0 + uSunAmt * LIT_K, t2);
    c *= k;

    /* 凹谷遮蔽（参考实现是显式的「hollow」项，别指望法线一项顺带做出来）。
       ⚠️ 第二个因子用 **l**（已经减过 sunCam.z）而不是裸 ndl —— 裸 ndl 有同样的
       视角偏置，朝太阳看时它恒 > 0.42 ⇒ 凹谷整项被关掉（实测过）。 */
    float hollow = (1.0 - smoothstep(-0.76, -0.08, nrm.y))
        * (1.0 - smoothstep(0.0, 0.42, l));
    c *= mix(1.0, 1.0 - uShadeAmt * HOLLOW_K, hollow);

    /* ---- ④ 笔触颗粒（参考实现的「paint *= 0.965 + brush * 0.07」）-------
       参考实现里 brush 就是**同一张 fbm**（只是域不同）—— 复用 n，0 次额外采样。
       它同时是"纸面颗粒"，把 ③ 那几级台阶的边从"矢量硬边"变成"画上去的"。 */
    c *= 1.0 + (n - 0.5) * uGrain;

    /* ---- ⑤ 朝阳侧金边（参考实现的「silhouette」项）----------------------
       🔴 billboard 空间里**视线恒为 +z** ⇒ dot(n, eye) 就是 n.z ——
          免费拿到"只在轮廓处高"的那个量。
       🔴 必须乘 smoothstep(−0.34, 0.30, ndl)：只有**朝阳那半边**的轮廓才亮；
          整圈亮就变成另一条墨线了（墨线刚删掉，别再长出来）。
       🔴 参考实现是 uGold*1.13 —— 它的 uGold 是中间调橙金，×1.13 不削；
          我们的 uGold 取的是穹顶的 uGlow（白天近白，本底 ~0.95 raw）
          ⇒ 1.13 直接削平成 255（实测 9.5% 云像素）。系数回到 1.0。
       🔴 加性那一项（参考实现的「paint += uGold * pow(sunEdge, 1.5) * 0.18」）
          也必须乘 uGoldAmt —— 否则 identity 基线上还挂着一圈亮边。 */
    float sil = 1.0 - nrm.z;
    float sunEdge = pow(sil, RIM_POWER) * smoothstep(-0.34, 0.30, ndl);
    c = mix(c, uGold, smoothstep(0.035, 0.64, sunEdge) * uGoldAmt);
    c += uGold * pow(sunEdge, 1.5) * 0.18 * uGoldAmt;

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
    /** 金边满强度时的 mix 量（参考实现 0.87）。
     *  🔴 和 `TOP_GLOW_PULL` 同一条：**乘上 `uSunDisk`**。金边是"朝阳侧"的边，
     *     夜里 `uSunDisk = 0`（日轮也灭了）⇒ 没有太阳就没有朝阳侧，
     *     留一条亮边等于凭空多一个光源。实测夜里那圈只值 0.8/255（`wo32e-night-iso.mjs`
     *     的 ② `gold=0` 一栏）—— 视觉上几乎不损失，但语义上是错的。 */
    GOLD_AMT: 0.87,

    /* ---- 距离场 / 侵蚀（都是 **UV** 单位）------------------------------ */
    /** 贴图里距离场的存储量程（与 makeCloudVolumeTexture 的 SDF_RANGE 一致）。 */
    SDF_RANGE: 0.10,
    /**
     * 剪影侵蚀强度（UV）—— 阈值被 fbm 推开的**幅度**。
     * 换算：`fbm` 的 std ≈ 0.15 ⇒ 边缘摆动 rms ≈ `0.15 × ERODE` UV
     * ≈ 0.0045 UV ≈ **2.3 px**（贴图 512 宽）。实测见探针 S2/S3。
     * ⚠️ 这条换算**只有在种子是面片内常数时**才成立（见 CLOUD_VERT）：种子是
     *    逐像素白噪声时，边缘会糊成一条抖动毛边，量到的 rms 反而**更小**（极值统计），
     *    于是"看着更糟、读数更好"—— 2026-10-15 之前一直是这样。
     */
    ERODE: 0.03,
    /** 阈值的过渡宽度（UV ≈ 1.8 px）。太小 = 硬边，太大 = 整朵云糊掉。 */
    EDGE: 0.0035,
    /** fbm 的域尺度 —— 越大块越小。 */
    NOISE_SCALE: 12.0,

    /* ---- 明暗（乘性四档梯，见片元 ③）---------------------------------- */
    /** 朝阳面提亮多少（档差 ×(1 + SUN_AMT·LIT_K)，LIT_K = 0.20 ⇒ ×1.04）。
     *  ⚠️ 只能给这么点：体色本底 ~0.95（**屏幕值**）、shader 输出**不过色彩空间
     *  编码**（§19）⇒ raw >1 直接削平成 255。 */
    SUN_AMT: 0.20,
    /** 背光面压暗多少 —— **四档梯的主力**（档差 ×(1 − SHADE_AMT·K)，
     *  DEEP_K/MID_K/SOFT_K = 1.00/0.62/0.30 ⇒ ×0.66 / ×0.79 / ×0.90），
     *  同时驱动凹谷遮蔽（HOLLOW_K = 0.42 ⇒ 谷底再 ×0.86）。
     *  🔴 WO-32g 首轮 0.42 把云腹压成深灰，体积感变"硬"，不再像云；收至 0.34：
     *     有清楚的体积差，同时避免把腹部涂成实心暗块。 */
    SHADE_AMT: 0.34,
    /** 笔触颗粒（参考实现的 `paint *= 0.965 + brush * 0.07` = ±3.5%）。
     *  复用侵蚀那张 fbm ⇒ 0 次额外采样。它把四档台阶的边从"矢量硬边"
     *  变成"画上去的"。 */
    GRAIN: 0.055,

    /* ---- WO-32e 明度分离（在 SkyClouds.jsx 的**派生**处用）--------------
       霾 A/B 证伪后（见片元 ② 注释），「云=天」的正解是**派生时拉开出度**：
       云顶在「天顶+朝阳」之上再亮一档、云底在「云带色」之下再压一档。
       🔴 三个量都是**乘性**的 ⇒ 换季 / 入夜时云跟着穹顶走，不会变成新固定色。
       🔴 TOP_LIFT 必须克制：×1.10 线性 ≈ 屏幕 +2%，头顶亮带不会削到 255；
          BOTTOM_DROP 才是主力（云带色本来就只比天暗一档，再压才分得开）。 */
    /**
     * 云顶往**朝阳色**（uGlow）拉多少 —— 即"云顶被太阳照到"的量。
     *
     * 🔴 这一项**必须乘上天空自己的昼夜比例**（`uSunDisk` = 1 − k，见
     *    `SkyClouds.jsx` 的派生处），**不能是常数**。2026-10-14 实测（`wo32e-night-iso.mjs`
     *    的 ① 全季 uniform dump）：
     *
     *      白天  uZenith L 0.952 · uGlow L 0.835 ⇒ 拉 0.28 后 **比天顶暗** 0.033 ✓
     *      秋夜  uZenith L 0.425 · uGlow L 0.771 ⇒ 拉 0.28 后 **比天顶亮** 0.097 🔴
     *
     *    同一个常数，昼夜**反号** —— 因为 uGlow 是"主光色"，白天它比近白的天顶暗、
     *    夜里它比深蓝的天顶亮得多。常数 0.28 于是让秋夜出现「云比天亮着」。
     *    天空自己用 uGlow 只有 `uGlowAmt` 那么点（白天 0.12 / 夜里 0.045）⇒
     *    云这边按同一个昼夜比例缩，白天逐位不变、夜里收到 0。
     *
     *    （旁证：天空的云带 `uStrata` 昼夜比 = 0.12/0.34 = 0.353，与 `uGlowAmt` 的
     *      0.045/0.12 = 0.375 几乎相同 —— 天自己那两个"额外的光"都是夜掉到 1/3。
     *      我们直接取 `uSunDisk` 这个**现成的、从 0 到 1 的**标量，比再除一次比值稳。）
     */
    TOP_GLOW_PULL: 0.28,
    /** 云顶派生色的线性提亮（原来硬编码 1.04）。⚠️ shader 输出**不过色彩空间
     *  编码**（§19）⇒ raw >1 直接削平成 255：TOP_LIFT 1.10 实测 17.5%、1.02 仍
     *  10.1% 云像素削平（uTop 本底 ~0.97 raw × SUN 1.11 就过 1）。收 0.94，
     *  「云顶亮一档」交给 SUN 乘子（×1.11）去顶 —— 0.94×1.11=1.04 恰好不削。 */
    TOP_LIFT: 0.99,
    /** 云底派生色的线性压暗。⚠️ 屏幕直觉在这里失效：×0.74 线性 ≈ 屏幕只暗
     *  ~13%（实测 uniform-check：p50 纹丝不动）—— linear mixing 还会把
     *  中段推亮。要拉开 ≥25 必须 0.5 一档。 */
    BOTTOM_DROP: 0.86,
    /** 竖向渐变向底偏置的指数（uVertBias；1 = 与旧版一致，>1 = 中段偏暗）。 */
    VERTICAL_BIAS: 1.0,

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
