import { NOISE_GLSL } from './entranceTextures';

/**
 * 柿子树的着色器 —— 树皮 / 叶 / 果。
 * ==================================================================
 *
 * 为什么自己写材质，不用 MeshStandardMaterial
 * ------------------------------------------
 * 全站的做法（见 `shaders/caneFence.js` 顶上的注释）：场景里没有 envMap、
 * 没有 tone mapping、`shadows: false`，标准材质拿不到可用的间接光，只会
 * 变成一块糊的塑料。而这里要的东西很少也很具体：
 *
 *   · **树皮**：竖向裂纹 + 一条细高光。用局部坐标的 fbm 在 `y` 方向压扁
 *     就能出竖向纹理（`vec2(x*5.5 + z*3.5, y*1.15)`），比任何贴图都省。
 *   · **叶**：一片一片的方向不同，所以明暗差异**必须来自法线**，否则整冠
 *     是同一个色 —— 那正是"看着不饱满"的来源。再加一条冠内遮蔽
 *     （`aShade`：越靠冠心越暗）把体积读出来。
 *   · **霾**：和 `BambooGrove` / `IslandGround` 同一套 —— 每帧从 `scene.fog`
 *     拷 `uHaze / uHazeNear / uHazeFar`，昼夜交替时树和天一起变。
 *
 * 🔴 颜色是**终值**，不是线性光
 * ----------------------------
 * 自定义 `ShaderMaterial` 的 fragment 输出**不过** tone mapping、也不做
 * 色彩空间转换（three 只在内置材质里插那两段 chunk），所以色板里的
 * 「sRGB 0..1」写多少屏幕就是多少 —— 与 `SEASON_FOXTAL` / `SEASON_PLANT`
 * 同一条规矩（见 `entranceTextures.js` 里 `SEASON_FOXTAIL` 上面那段说明）。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**，引用标识符
 *    一律用「」。改完跑 `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
 */

/* ------------------------------------------------------------------ */
/* 树皮                                                                */
/* ------------------------------------------------------------------ */

export const TREE_BARK_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;      // 树**局部**坐标 —— 树皮噪声要用它，不能用世界坐标
varying float vDepth;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vL = position;
    // 均匀缩放，所以 mat3 直接取就行；下面统一 normalize
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const TREE_BARK_FRAG = /* glsl */ `
uniform vec3 uBark;
uniform vec3 uBarkDark;
uniform vec3 uBarkHi;
uniform float uBarkBump;   // 法线扰动强度（0 = 关）
uniform vec3 uLightDir;
uniform float uRootY;      // 树根的世界 y（世界坐标，做接地变暗）
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
varying float vDepth;

${NOISE_GLSL}

// 树皮噪声：xz 压到高频、y 压到低频 ⇒ 条纹沿树干走。
// 抽成函数，因为下面要对它做**有限差分**（多采两次求梯度）。
float barkField(vec2 p) {
    return fbm(p);
}

void main() {
    vec3 n = normalize(vN);

    // 用**局部**坐标而不是世界坐标：整棵树挪个位置，纹理不该跟着走。
    // u 沿「绕树干一圈」的方向（xz 合成），v 沿树干方向。
    vec2 q = vec2(vL.x * 5.5 + vL.z * 3.5, vL.y * 1.15);
    float g = barkField(q);

    // 🔴🔴 法线扰动 —— 这一条才是"树皮不像粘土"的关键
    // ---------------------------------------------------------------
    // 原来只把 fbm 拿去混颜色，**法线一个像素都没动** ⇒ 无论颜色叠多少层，
    // 光照下这片表面仍然是光滑的圆柱，读起来就是"粘土"。
    // 真树的"糙"主要读自**法线**（微小起伏让同一片区域里明暗碎裂），不是颜色。
    //
    // 做法：有限差分求 fbm 对 (u,v) 的偏导，再按链式法则换回局部空间梯度：
    //     ∂G/∂x = ∂G/∂u · 5.5   ∂G/∂y = ∂G/∂v · 1.15   ∂G/∂z = ∂G/∂u · 3.5
    // 然后把梯度**投影到切平面**（减掉法线方向的分量）再扰 n ——
    // 这样只改"表面朝哪倾斜"，不会把法线推进表面里（那会出现负光）。
    vec3 gn = n;
    if (uBarkBump > 0.0) {
        const float E = 0.02;
        float du = (barkField(q + vec2(E, 0.0)) - g) / E;
        float dv = (barkField(q + vec2(0.0, E)) - g) / E;
        vec3 grad = vec3(du * 5.5, dv * 1.15, du * 3.5);
        grad -= n * dot(grad, n);
        gn = normalize(n - grad * uBarkBump);
    }

    // 细裂纹：再叠一层高频，让裂纹的边不干净（树皮的裂口是有毛刺的）
    float fine = barkField(q * 3.7 + vec2(11.3, 4.1));

    vec3 c = mix(uBark, uBarkDark, smoothstep(0.34, 0.80, g) * 0.78);
    // 裂纹之间的脊：细一条亮线，树皮才有"硬"的质感
    c = mix(c, uBarkHi, smoothstep(0.74, 0.96, g) * 0.42);
    // 高频层只做很轻的明暗抖动 ⇒ 表面"发毛"
    c *= 0.90 + 0.20 * fine;

    // 光照：主光 + 从上方来的天光。两盏都要，只有主光的话阴面是死的。
    // ⚠️ 用**扰动后**的 gn，不是 n。
    float lam = max(dot(gn, normalize(uLightDir)), 0.0);
    float sky = 0.5 + 0.5 * gn.y;
    c *= 0.36 + 0.42 * sky + 0.74 * lam;

    // 接地变暗：根部埋在草里，往上 1.6 单位渐亮
    c *= 0.58 + 0.42 * smoothstep(uRootY - 0.1, uRootY + 1.6, vW.y);

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 叶（InstancedMesh）                                                 */
/* ------------------------------------------------------------------ */

export const TREE_LEAF_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
attribute float aAccent;
attribute float aShade;
uniform float uTime;
uniform float uWind;
uniform float uTreeH;      // 树高（局部），把实例高度归一化
uniform float uTuftExtent; // 一团叶从自己的原点往外能探多远（叶尖归一化用）
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vAccent;
varying float vShade;
varying float vEdge;       // 0 = 叶基（贴着叶团原点）· 1 = 叶尖
varying float vDepth;

void main() {
    // 实例矩阵的平移列 = 这一簇叶挂在哪儿（树局部坐标）
    vec3 o = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float rel = clamp(o.y / uTreeH, 0.0, 1.0);   // 0 根部 · 1 冠顶

    vec3 lp = (instanceMatrix * vec4(position, 1.0)).xyz;

    // 🔴 叶尖 ↔ 叶基：叶团的**原点就在叶簇中心**，所以"这个顶点离原点多远"
    //    本身就是沿叶片的坐标。⇒ 不用新增 attribute，位置里已经带着它了。
    //    （叶基 ≈ 0.2·TUFT_EXTENT、叶尖 ≈ 1.0·TUFT_EXTENT，实测够分辨。）
    vEdge = clamp(length(position) / uTuftExtent, 0.0, 1.0);

    // 风：两列低频叠加（单频会看出"整树齐步走"）。幅度 ∝ rel²，所以
    // 冠底的叶几乎不动 —— 真树就是梢头摆得最凶。
    float s = sin(uTime * 0.83 + aPhase) * 0.7 + sin(uTime * 1.37 + aPhase * 2.3) * 0.3;
    float bend = rel * rel;
    lp.x += s * uWind * bend;
    lp.z += cos(uTime * 0.71 + aPhase * 1.6) * uWind * 0.7 * bend;
    lp.y -= abs(s) * uWind * 0.12 * bend;        // 摆出去时略沉，不然像整片平移

    vec3 nrm = mat3(instanceMatrix) * normal;
    vec4 wp = modelMatrix * vec4(lp, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * nrm);
    vTint = aTint;
    vAccent = aAccent;
    vShade = aShade;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const TREE_LEAF_FRAG = /* glsl */ `
uniform vec3 uLeafA;
uniform vec3 uLeafB;
uniform vec3 uAccent;
uniform float uAccentMix;
uniform float uLeafTrans;  // 透光强度（背光时叶会亮起来）
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vAccent;
varying float vShade;
varying float vEdge;
varying float vDepth;

void main() {
    // 叶是零厚度的片，双面渲染 ⇒ 背面要把法线翻过来，否则背面永远是黑的。
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;

    vec3 c = mix(uLeafA, uLeafB, vTint);
    c = mix(c, uAccent, vAccent * uAccentMix);

    // 沿叶片的渐变：叶尖偏亮、叶基偏深。
    // 一片叶**自己内部**就有明暗，才不会读成"一整片同色的纸"。
    c *= 0.92 + 0.18 * vEdge;

    vec3 L = normalize(uLightDir);

    // 主光（叶面朝向不同 ⇒ 明暗不同 ⇒ 整冠读出体积）
    float lam = max(dot(n, L), 0.0);
    // ⚠️ 再加一份 **wrap**：叶是薄而半透的，明暗交界不该是一刀切。
    float wrap = clamp((dot(n, L) + 0.30) / 1.30, 0.0, 1.0);
    // 天空光：朝上的叶面更亮
    float sky = 0.5 + 0.5 * n.y;
    // 冠内遮蔽：冠心的叶晒不到（aShade 由生成器按「离冠壳多远」给）
    float ao = 1.0 - 0.30 * vShade;

    // 起手就是 0.52：叶本来就是**透光**的，暗面不该压到近黑
    c *= (0.52 + 0.34 * sky + 0.30 * lam + 0.18 * wrap) * ao;

    // 🔴🔴 **透光（backlight）** —— 真叶最容易被认出"薄"的一条
    // ------------------------------------------------------------------
    // 光从叶**背后**穿过来时，整片叶会亮起来。这一项与叶面法线基本无关
    // （光穿过的是叶肉，不是被叶面反射），只与「视线」和「光向」的夹角有关。
    // 少了它，叶就永远是"两面都不透光的硬片" —— 那就是「像纸片」的根。
    // 「cameraPosition」是 three 给所有材质的**内置 uniform**（不用自己声明）。
    vec3 V = normalize(cameraPosition - vW);
    float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
    // 叶尖比叶基更透（叶脉在基部更厚）
    c += c * trans * uLeafTrans * (0.55 + 0.45 * vEdge);

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 果（果身 + 蒂，同一个几何体）                                       */
/* ------------------------------------------------------------------ */

export const TREE_FRUIT_VERT = /* glsl */ `
attribute float aPart;     // 0 = 果身，1 = 蒂
varying vec3 vN;
varying vec3 vW;
varying float vPart;
varying float vDepth;
void main() {
    // 🔴 **自定义 ShaderMaterial 不会自动套 instanceMatrix** —— 内置材质里
    //    那段 chunk 得自己写。漏了它的后果很隐蔽：40 颗柿子**全部叠在树根
    //    那一点**上，读成一个橙色的大球（用户看到的就是"树底一个橙球、
    //    树上没有柿子"），而且**一声不吭**、没有编译错误。
    vec4 lp = vec4(position, 1.0);
    #ifdef USE_INSTANCING
        lp = instanceMatrix * lp;
    #endif
    vec4 wp = modelMatrix * lp;
    vW = wp.xyz;
    vec3 nrm = mat3(instanceMatrix) * normal;
    vN = normalize(mat3(modelMatrix) * nrm);
    vPart = aPart;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const TREE_FRUIT_FRAG = /* glsl */ `
uniform vec3 uFruit;
uniform vec3 uFruitDark;
uniform vec3 uCalyx;
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vPart;
varying float vDepth;

void main() {
    vec3 n = normalize(vN);
    float lam = max(dot(n, normalize(uLightDir)), 0.0);
    float sky = 0.5 + 0.5 * n.y;

    // 果子是圆的，所以明暗分得开；阴面往 uFruitDark 走（柿子的暗部偏赭，
    // 不是把橙色单纯乘暗 —— 乘暗会变脏）。
    vec3 f = mix(uFruitDark, uFruit, clamp(0.30 + 0.40 * sky + 0.72 * lam, 0.0, 1.35));
    // 果顶一圈细高光：柿子表面有蜡感
    f += vec3(0.16, 0.10, 0.04) * pow(lam, 6.0);

    vec3 c = mix(f, uCalyx * (0.55 + 0.45 * sky + 0.45 * lam), vPart);
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 地面投影                                                            */
/*                                                                     */
/* 本项目 `LIGHTS.shadows = false` —— 影长是**画**出来的，不是灯算的。   */
/* 原来那棵 billboard 树把影子画进贴图里（`ctx.scale(1, squash)`），换   */
/* 3D 之后没有那张贴图了，所以改成一个贴地的椭圆软斑：一片带径向衰减的    */
/* 透明面片。影长依旧是**季节信号里最强的一条**（夏至最短）、太阳方位的  */
/* 水平偏移也照旧（`shadowDx`）。                                       */
/* ------------------------------------------------------------------ */

export const TREE_SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TREE_SHADOW_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
void main() {
    // uv 是 0..1，中心 0.5 ⇒ 半径归一化到 1
    float r = length((vUv - 0.5) * 2.0);
    float a = smoothstep(1.0, 0.05, r);
    // 平方一次：边缘收得更快，不然软斑像一坨墨
    a *= a;
    gl_FragColor = vec4(uTint, a * uOpacity);
}
`;
