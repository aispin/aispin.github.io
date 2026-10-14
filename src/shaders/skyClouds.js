/**
 * 天空里的云（WO-20 上色 / WO-30 形体，2026-10-12 → 2026-10-13）。
 * ==================================================================
 *
 * 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」
 * 用户（第三轮）：「云朵搞逼真一点（是否上 glsl）」→ 拍板 (A)。
 *
 * 这一份做**形体 + 上色**。云的**摆位**来自 `config/skyClouds.js`
 * （含 WO-30 的层片展开），**素描底**来自 `utils/cloudArt.js`
 * （白身 + 墨线描边 + 腹灰）。
 *
 * ---------------------------------------------------------------------------
 * WO-30：(A) billboard + GLSL 形体 —— 三刀
 * ---------------------------------------------------------------------------
 * ① **fbm 侵蚀剪影**。原来云的边是 canvas 画好的**死边**（同一条曲线，
 *    一笔画到底），这是最大的"假"源。现在用噪声把**剪影阈值**推来推去。
 *
 *    🔴 这一步的地基是 `cover()`：素描的 alpha 是 **1 像素的硬跳变**，
 *    直接拿噪声去减它，阈值挪 0.3 在空间上只挪 0.3 像素 —— 什么都看不见。
 *    所以先模糊出一张**软高度场**（≈"离边缘多远"），阈值挪 0.3 就相当于
 *    把边挪了 0.3 × 模糊宽度。这是整件事唯一不能省的一步。
 *
 * ② **按太阳方向做明暗**。原来只有 `uv.y` 的竖向渐变。面片没有法线，
 *    所以用一颗**解析半球**当法线（`vUv` 归一化到 −1..1 再补 z 轴），
 *    太阳方向在 CPU 侧换算到**面片局部空间**（= 相机空间，因为面片每帧
 *    抄相机四元数），两者同基。
 *
 *    🔴 **别**改成"把 alpha 模糊成高度场、梯度当法线"。试过，不行：贴图
 *    alpha 里有**内部结构**（墨线弧、瓣轮廓），模糊之后那些弧主导了梯度 ⇒
 *    法线沿墨线乱翻，"有方向"退化成"有噪声"。实测 2026-10-14：朝阳半与
 *    背光半的平均差只有 2.5/255，而单像素最大 37/255。
 *    证据 `.workbuddy-ai/.tmp/wo30-sunmap/sun-dL.png`。
 *    解析半球与墨线无关，而且 **0 次贴图采样**、不需要 `dFdx/dFdy`
 *    （顺带消掉"导数必须在 discard 之前"那条约束）。
 *
 * ③ **一朵云叠 3 层薄片**出视差 —— 那是几何，在 `config/skyClouds.js`。
 *
 * 代价：只加**片元**计算，**0 新增 mesh / 0 新增 draw / 0 新增贴图**。
 *      每朵云的种子从**世界位置**派生 ⇒ 连 instance 属性都不用新增。
 *
 * 不做 (B) 真 raymarch：全屏每像素积分与本项目三级降级（HIGH/MEDIUM/LOW）
 * 正面冲突。
 *
 * ---------------------------------------------------------------------------
 * 为什么"上色"要写在着色器里，而不是用现成的 `utils/colorizeCloud`
 * ---------------------------------------------------------------------------
 * `colorizeCloud` 是把色调**烤进一张 canvas**（`destination-in` + `multiply`），
 * 一张素描 × 一个色调 = 一张新贴图。摄影室里用得起，因为那里的云**不换色**。
 *
 * 天空里的云不行：它的颜色要跟**昼夜过渡**一起变（0.9 秒内每帧都在动）。
 * 每帧重烤一张 512×h 的 canvas 是不可能的。
 *
 * 所以这里把素描当**灰度遮罩**用（`s.rgb` 就是"白身 1.0 / 墨线 0.06 /
 * 腹灰 0.7"），颜色在片元里现算 ⇒ **贴图只有三张、颜色每帧可动**。
 *
 * ---------------------------------------------------------------------------
 * 对齐了参考实现的三件事
 * ---------------------------------------------------------------------------
 * 参考实现（`sunset-world.js` 的 `createCloudMaterial`）让云"像画的"靠的是：
 *
 *   ① **分色**：`light = sunFacing*0.77 + n.y*0.24 + brush*0.20`，再按
 *      四个阈值切成四档（`uDeep/uShadow/uViolet/uLavender`）。
 *   ② **朝阳金边**：`silhouette = 1 - max(dot(n, eye))`，再按 `sunFacing`
 *      加权 —— 边亮、而且是**暖**的。
 *   ③ **距离霾**：`smoothstep(800, 6200, dist)` 化进 `uHaze`。
 *
 * 这里是平面面片（没有几何法线），所以：
 *   ① 改成**竖向渐变**（`uv.y` 顶亮底暗）+ WO-30 新增的**假法线 Lambert**
 *      —— 后者正是参考实现 `n.y*0.24` 那一项在平面上的对应物；
 *   ② 墨线**自带**（素描里就有），不需要描边 pass；
 *   ③ **照搬**，但霾的近远距离从 `scene.fog` 拷（本项目一贯做法，
 *      见 `shaders/airplane.js`），这样云和树/房子/飞机是同一层空气。
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
uniform vec3 uSunDir;
uniform vec3 uSunCam;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uOpacity;
uniform float uInk;
uniform float uGoldAmt;
uniform float uErode;
uniform float uEdge;
uniform float uNoiseScale;
uniform float uSoftR;
uniform float uDomeSpread;
uniform float uSunAmt;
uniform float uShadeAmt;
uniform float uDetail;

varying vec2 vUv;
varying vec3 vW;
varying float vDepth;

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
   🔴 归一化用的「norm」**就在这儿跟着档数加** —— 不在 JS 里另存一份权重表，
      否则改一个数字要改两处，迟早不同步（§28.1）。 */
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

/* 软覆盖度：3×3 二项核模糊，把「画好的硬边」变成一张软高度场。
   🔴 见文件头 ① —— 没有这一步，侵蚀在数学上成立、在像素上为零。
   ⚠️ 用**整块 3×3**（而不是十字）：十字核的坡度是分段常数、拐点上有折角，
      拿它当法线会出现可见的色带。二项核出来的高度场是光滑的。 */
float cover(vec2 uv, float r) {
    return 0.0625 * (
        1.0 * (texture2D(uMap, uv + vec2(-r, -r)).a + texture2D(uMap, uv + vec2(r, -r)).a
             + texture2D(uMap, uv + vec2(-r, r)).a + texture2D(uMap, uv + vec2(r, r)).a)
        + 2.0 * (texture2D(uMap, uv + vec2(-r, 0.0)).a + texture2D(uMap, uv + vec2(r, 0.0)).a
             + texture2D(uMap, uv + vec2(0.0, -r)).a + texture2D(uMap, uv + vec2(0.0, r)).a)
        + 4.0 * texture2D(uMap, uv).a);
}

void main() {
    // 素描：白身 + 墨线 + 腹灰。**当灰度遮罩用**，颜色下面现算。
    vec4 s = texture2D(uMap, vUv);

    /* ---- 软高度场（只服务剪影）-----------------------------------------
       🔴 这一步的地基：素描 alpha 是 **1 像素的硬跳变**，直接拿噪声去减它，
          阈值挪 0.3 在空间上只挪 0.3 像素 —— 什么都看不见。所以先模糊出
          一张软高度场，阈值挪 0.3 就相当于把边挪了 0.3 × 模糊宽度。
       明暗**不用**它（见 ③）—— 那张场里带墨线的内部结构。 */
    float soft = cover(vUv, uSoftR);

    /* ---- ① fbm 侵蚀剪影 ------------------------------------------------
       种子从**世界位置**派生：一朵云的三个层片位置不同 ⇒ 侵蚀花样不同，
       而同一朵云每帧相同 ⇒ 确定性、可复现。**不需要**新的 instance 属性。 */
    vec2 seed = vec2(
        cloudHash(vW.xz + vW.y * 0.37),
        cloudHash(vW.zx + vW.y * 0.71 + 13.7)) * 37.0;
    float n = cloudFbm(vUv * uNoiseScale + seed);

    // 阈值被噪声推来推去 ⇒ 边缘不再是画好的死边。
    float cut = 0.5 + (n - 0.5) * uErode;
    float a = smoothstep(cut - uEdge, cut + uEdge, soft) * uOpacity;
    if (a < 0.004) discard;

    /* ---- ② 分色：底暗顶亮 ----------------------------------------------
       云是被**上面**的太阳照亮的，所以这个替换与参考实现的"按法线分档"
       在观感上等价。 */
    vec3 c = mix(uBottom, uTop, vUv.y);

    /* ---- ③ 太阳方向明暗（WO-30 新增）----------------------------------
       🔴 法线用**解析半球**，不从贴图里求。
          vUv 先归一化到 −1..1（圆心 = 面片中心），再补 z 轴凑成单位
          向量 —— 就是一颗铺在面片上的半球，「uDomeSpread」控制它鼓到多大
          （「|p|」什么时候到 1）。
          面片局部基 = 相机基（billboard 每帧抄的就是相机四元数），所以这个
          法线与「uSunCam」（CPU 侧同一套基算的）**同基**。
          ⚠️ 别在这里写 dFdx/dFdy —— 用解析式就完全没有"导数必须在
          discard 之前"那条约束了。
       🔴 抬 / 压走**乘性**，不写 mix(c, uTop, ...)。
          因为 c 自己就是 mix(uBottom, uTop, vUv.y) —— 在云顶那一片
          c ≈ uTop，于是 mix(c, uTop, sunAmt) 在那儿**几乎无效**，
          而"朝阳的那一侧"恰恰经常落在云顶。乘性调制对 c 的任何取值
          都有效，而且**不引入第二个色源** —— 调的就是已经派生的 c 本身。 */
    vec2 p = (vUv - 0.5) * 2.0 * uDomeSpread;
    vec3 nrm = normalize(vec3(p, sqrt(max(0.0, 1.0 - min(dot(p, p), 1.0)))));
    float ndl = dot(nrm, normalize(uSunCam));
    float lit = max(ndl, 0.0) * uSunAmt;
    float dark = max(-ndl, 0.0) * uShadeAmt;
    c *= 1.0 + lit - dark;

    /* ---- ④ 朝阳暖边 -----------------------------------------------------
       · 顶边染金（「pow(uv.y, 2.2)」—— 只在最上面那一小条）
       · 整朵云再按"它在太阳那一侧吗"整体加暖（对应参考实现的
         「sunward」那一项，它同样是把云整体往暖色推） */
    vec3 toCloud = normalize(vW - cameraPosition);
    float sunFacing = max(dot(toCloud, uSunDir), 0.0);
    c = mix(c, uGold, pow(vUv.y, 2.2) * uGoldAmt);
    c = mix(c, uGold, pow(sunFacing, 2.0) * uGoldAmt * 0.62);

    // 墨线：「s.rgb」是灰度，乘上去就把描边和腹灰带回来了。
    // uInk 略小于 1 —— 纯 0 的墨线在自定义光照下是个洞。
    c *= mix(vec3(1.0), s.rgb, uInk);

    // ⑤ 距离霾：和飞机 / 两棵树 / 竹林**同一条** —— 每帧从 scene.fog 拷。
    //    这保证换季、入夜时云和世界一起变，不会出现"云还亮着、地已经黑了"。
    //    ⚠️ 层片就是靠这一项拉开"近清楚、远化掉"的 —— 见 config/skyClouds.js。
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));

    gl_FragColor = vec4(c, a);
}
`;

/**
 * 云的形状 / 形体参数。
 *
 * ⚠️ **颜色不在这里定死** —— `uTop` / `uBottom` / `uGold` / `uHaze` 都由
 *    `SkyClouds.jsx` 每帧从**天空穹顶的 uniform** 与 `scene.fog` 派生。
 *    这里只给形状参数（不透明度 / 墨线强度 / 暖边强度 / 侵蚀 / 太阳明暗）。
 */
export const CLOUD_SHAPE = Object.freeze({
    /** 整体不透明度。云不是实心的 —— 留一点让天光透过来。 */
    OPACITY: 0.92,
    /** 墨线强度（乘 `s.rgb` 的混合比）。 */
    INK: 0.94,
    /** 暖边强度。 */
    GOLD_AMT: 0.30,

    /* ---- WO-30：形体三刀 ---------------------------------------------- */
    /**
     * 剪影侵蚀强度 —— 阈值被 fbm 推开的**幅度**（0..1）。
     *
     * 换算：软高度场从 0 爬到 1 的宽度 ≈ `2 × SOFT_R`（UV），所以阈值挪 Δ
     * 相当于把边挪 `Δ × 2 × SOFT_R`。`fbm` 的取值集中在 0.5 附近
     * （std ≈ 0.15）⇒ 边缘摆动的 rms ≈ `0.15 × ERODE/2 × 2 × SOFT_R`
     * ≈ 0.023 UV ≈ **12 像素**（贴图空间 512 宽）。
     * 再大就开始"毛边"，再小读不出"不是画的"。**实测见探针 S2/S3。**
     */
    ERODE: 0.22,
    /** 阈值的过渡宽度。太小 = 硬边（回到老样子），太大 = 整朵云糊掉。 */
    EDGE: 0.035,
    /** fbm 的域尺度 —— 越大块越小。12 ⇒ 最小一级约 1/12 到 1/100 UV。 */
    NOISE_SCALE: 12.0,
    /** 软高度场的采样半径（UV）。**只服务剪影**。见 `ERODE` 的换算。 */
    SOFT_R: 0.045,
    /**
     * 明暗用的**解析半球**鼓到多大：`|p| = |(vUv − 0.5) × 2 × DOME_SPREAD|`
     * 到 1 就是半球的**边缘**（那儿法线水平、明暗最强）。
     *
     * 取 2.0：素描里那朵云大约占贴图一半宽高（半宽 ≈ 0.25 UV）
     * ⇒ `0.25 × 2 × 2.0 = 1.0`，正好让**云的轮廓**落在半球边缘上。
     * 调小 = 只有中间一小块被照亮（像打在球顶上的光斑）；
     * 调大 = 整个身子都接近"正对镜头"，明暗变平。
     */
    DOME_SPREAD: 2.0,
    /** 朝阳面提亮多少（**乘性**：`c *= 1 + lit - dark`，见片元 ③）。 */
    SUN_AMT: 0.20,
    /** 背光面压暗多少（同上）。 */
    SHADE_AMT: 0.16,

    /**
     * fbm 档数（HIGH / LOW）。
     *
     * 🔴 低档是**真的少算**（`uDetail` 是 uniform，走一致分支），
     *    不是"乘个 0 照样算完"。归一化用的「norm」在 GLSL 里跟着档数一起加，
     *    所以低档不会整体变暗。
     */
    DETAIL_HIGH: 3,
    DETAIL_LOW: 1,
});

/**
 * 「形体全关」的一组参数 —— 判据用它做 A/B 基线。
 *
 * ⚠️ 和 WO-29 的 `FINISH_IDENTITY` 同一个用法：**判据不许自带一份 config**
 *    （§28.1），所以基线也从这里取，别在探针里写死数字。
 *
 * 🔴 `DETAIL_HIGH` 保留：这条只关**形体**（侵蚀 + 太阳明暗），
 *    不关噪声档数 —— 档数是性能开关，不是外观开关。
 */
export const CLOUD_IDENTITY = Object.freeze({
    ERODE: 0,
    SUN_AMT: 0,
    SHADE_AMT: 0,
});
