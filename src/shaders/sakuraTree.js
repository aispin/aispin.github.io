import { NOISE_GLSL } from './entranceTextures';

/**
 * 樱花树的着色器 —— 树皮 / 花簇 / 落樱。
 * ==================================================================
 *
 * 🔴 叶与地面影**不在这里**
 * ------------------------
 * 那两对着色逻辑与**树种无关**（叶就是一片零厚度的双面片：逐面法线 +
 * 冠内遮蔽 + 逆光透光；影就是一块带径向衰减的软斑），所以**只有一份**，
 * 住在 `shaders/persimmonTree.js` 里。这个文件在末尾把它们**转出去**，
 * 好让 `SakuraTree.jsx` 只 import 一个地方 —— 但源头仍是那一份。
 * 以后要独立，把那两对提到 `shaders/treeShared.js` 即可（纯搬家）。
 *
 * 和柿子树树皮的差别（这是"一看就是樱花"的关键）
 * ----------------------------------------------
 * 柿子树的裂纹是**竖向**的（`vec2(x*5.5 + z*3.5, y*1.15)`：绕树干高频、
 * 沿树干低频）。染井吉野反过来 —— 它的树皮是**横向皮孔**（横纹短划），
 * 所以这里把两个轴的权重**对调**：绕树干低频、沿树干高频。
 * 同一条 fbm，只是各向异性的方向不同，读出来就是另一种树。
 *
 * 🔴 颜色是**终值**，不是线性光（与柿子树的文件同一条规矩）：
 * 自定义 `ShaderMaterial` 的输出不过 tone mapping、不做色彩空间转换，
 * 色板里的「sRGB 0..1」写多少屏幕就是多少。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**，引用标识符
 *    一律用「」。改完跑 `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
 */

/* ------------------------------------------------------------------ */
/* 树皮（灰褐 + 横向皮孔）                                             */
/* ------------------------------------------------------------------ */

export const SAKURA_BARK_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;      // 树**局部**坐标 —— 树皮噪声要用它，不能用世界坐标
varying float vDepth;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vL = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const SAKURA_BARK_FRAG = /* glsl */ `
uniform vec3 uBark;
uniform vec3 uBarkDark;
uniform vec3 uBarkHi;
uniform float uBarkBump;
uniform vec3 uLightDir;
uniform float uRootY;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
varying float vDepth;

${NOISE_GLSL}

// 🔴 与柿子树**方向对调**：绕树干（x,z）低频、沿树干（y）高频 ⇒ 横纹。
float barkField(vec2 p) {
    return fbm(p);
}

void main() {
    vec3 n = normalize(vN);

    vec2 q = vec2(vL.x * 2.4 + vL.z * 1.8, vL.y * 6.2);
    float g = barkField(q);

    // 法线扰动 —— "树皮不像粘土"的关键（与柿子树同一条做法，见那边的长注释）。
    // 链式法则：d/dx = du * 2.4、d/dy = dv * 6.2、d/dz = du * 1.8。
    vec3 gn = n;
    if (uBarkBump > 0.0) {
        const float E = 0.02;
        float du = (barkField(q + vec2(E, 0.0)) - g) / E;
        float dv = (barkField(q + vec2(0.0, E)) - g) / E;
        vec3 grad = vec3(du * 2.4, dv * 6.2, du * 1.8);
        grad -= n * dot(grad, n);
        gn = normalize(n - grad * uBarkBump);
    }

    // 横向皮孔：把横纹再切一刀低频（绕树干那一路），横纹就断成**短划** ——
    // 真樱花的皮孔是一条条短横线，不是一圈圈闭合的环。这一层是"像樱花"
    // 而不是"像一根灰木头"的分界。
    float lent = barkField(vec2(q.x * 2.6 + 7.7, q.y * 0.85 + 2.3));

    vec3 c = mix(uBark, uBarkDark, smoothstep(0.34, 0.80, g) * 0.74);
    // 皮孔本身**比树皮亮**（那是新长出来的组织），所以往 uBarkHi 走
    c = mix(c, uBarkHi, smoothstep(0.58, 0.90, lent) * 0.52);
    // 高频层只做很轻的明暗抖动 ⇒ 表面"发毛"
    c *= 0.92 + 0.16 * barkField(q * 3.9 + vec2(3.1, 9.4));

    float lam = max(dot(gn, normalize(uLightDir)), 0.0);
    float sky = 0.5 + 0.5 * gn.y;
    c *= 0.38 + 0.42 * sky + 0.72 * lam;

    // 接地变暗：根部埋在草里，往上 1.6 单位渐亮
    c *= 0.58 + 0.42 * smoothstep(uRootY - 0.1, uRootY + 1.6, vW.y);

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 花簇（InstancedMesh）                                               */
/* ------------------------------------------------------------------ */

/**
 * 🔴 2026-10-13（WO-28）**樱花的花冠已改静止** —— 这里原来和柿子树一样有一段
 * 两频风摆（系数 0.55 / 0.40）：
 *
 *     float s = sin(uTime * 0.83 + aPhase) * 0.7 + sin(uTime * 1.37 + aPhase * 2.3) * 0.3;
 *     float bend = rel * rel;
 *     lp.x += s * uWind * 0.55 * bend;
 *     lp.z += cos(uTime * 0.71 + aPhase * 1.6) * uWind * 0.40 * bend;
 *
 * 用户 2026-10-13：「樱花树长的太像柿子树了……**树冠也停随风摆**」。
 * （柿子树先一步停掉是 WO-25，同一句需求的另一棵。）
 *
 * 为什么一起停：这句话本身没有再问"有没有性能损毁"，而柿子树那一轮已经量过
 * 这笔账 —— 风摆是顶点着色器里的几行位移，**0 额外顶点 / 0 额外三角形 /
 * 0 额外 draw / 0 额外 CPU**，唯一的边际代价就是每个顶点每帧那几次 `sin`/`cos`。
 * 判据与完整推演见 `shaders/persimmonTree.js` 的 `TREE_LEAF_VERT` 上面那段。
 *
 * ⚠️ **落樱（`SAKURA_PETAL_VERT`）不在这次改动范围内** —— 那是另一个几何体、
 *    另一套 `aSeed`/`aOrigin` 驱动的运动，而且是"樱花"这个意象本身。
 *    它仍然需要 `uTime`，所以 `SakuraTree.jsx` 里那个 `uTime` 写入**必须留**。
 *
 * ⚠️ 顺带说明：樱花的**叶冠**（夏/秋两季）用的是 `SAKURA_LEAF_VERT`，
 *    那份是从 `shaders/persimmonTree.js` **再导出**的同一个 `TREE_LEAF_VERT`
 *    ⇒ 它早在 WO-25 就已经没有风摆了。这里停的是**春季花冠**那一条。
 *
 * 判据：`.workbuddy-ai/harness/probe-tree-crown.mjs` 的 **C5**
 * （原来断言樱花**仍然有** `uWind`，是防误伤的护栏；现已反向）。
 */
export const SAKURA_BLOSSOM_VERT = /* glsl */ `
attribute float aTint;
attribute float aAccent;
attribute float aShade;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vAccent;
varying float vShade;
varying float vDepth;

void main() {
    // 🔴 自定义 ShaderMaterial 不自动套 instanceMatrix（与柿子树的果同一条教训）。
    //    ⚠️ lp 必须是 **vec3** —— 下面要写 vec4(lp, 1.0)。第一版照抄了果
    //    （先声明 vec4 lp 再乘矩阵）却留着叶的 vec4(lp, 1.0)，于是
    //    vec4(vec4, float) 报「too many arguments」，**整个 program 不链接**：
    //    画面上那棵树只剩枝、一朵花都没有，而 DOM 里那个 mesh 好端端地
    //    visible: true、count 也对 —— 症状是"看着光秃"，不是报错。
    vec3 lp = position;
    #ifdef USE_INSTANCING
        lp = (instanceMatrix * vec4(lp, 1.0)).xyz;
    #endif

    vec3 nrm = normal;
    #ifdef USE_INSTANCING
        nrm = mat3(instanceMatrix) * nrm;
    #endif
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

export const SAKURA_BLOSSOM_FRAG = /* glsl */ `
uniform vec3 uBlossomA;
uniform vec3 uBlossomB;
uniform vec3 uBlossomCore;
uniform float uBlossomTrans;
uniform float uAccentMix;
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vAccent;
varying float vShade;
varying float vDepth;

void main() {
    // 花瓣是零厚度的片、双面渲染 ⇒ 背面必须翻法线，否则背面永远黑。
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;

    vec3 c = mix(uBlossomA, uBlossomB, vTint);
    // 一部分花簇偏深粉 ⇒ 整冠有**斑驳**。远看时"一朵花"只有几个像素，
    // 能读出来的不是单朵花的细节，而是**簇与簇之间的色差**。
    c = mix(c, uBlossomCore, vAccent * uAccentMix);

    vec3 L = normalize(uLightDir);
    // 🔴 花瓣的**逐面法线**是这份几何体最重要的东西：5 片花瓣朝向各不相同，
    //    所以同一朵花上就有明暗差 —— 那才是"一团花"而不是"一个粉点"。
    float lam = max(dot(n, L), 0.0);
    float wrap = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0);
    float sky = 0.5 + 0.5 * n.y;
    float ao = 1.0 - 0.34 * vShade;

    // 起手 0.58：花瓣本来就薄、就透，暗面不该压到近黑
    c *= (0.58 + 0.30 * sky + 0.26 * lam + 0.20 * wrap) * ao;

    // 逆光透光：花瓣比叶还薄，逆光时几乎整片亮起来
    vec3 V = normalize(cameraPosition - vW);
    float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
    c += c * trans * uBlossomTrans;

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 落樱（InstancedMesh，运动全在顶点着色器里）                          */
/*                                                                     */
/* 🔴 为什么不在 `useFrame` 里写实例矩阵：240 片花瓣每帧 240 次        */
/*    `compose()` 是纯 CPU 开销，而这个运动**完全可解析**（匀速下落 +   */
/*    两个正弦横摆 + 自转），搬到顶点着色器里就是零 CPU ——             */
/*    与"风在着色器里"同一条做法。`useFrame` 只写一个 `uTime`。        */
/* ------------------------------------------------------------------ */

export const SAKURA_PETAL_VERT = /* glsl */ `
attribute vec3 aOrigin;    // 出发点（x,z 用冠里的位置；y 由时间算）
attribute vec2 aSeed;      // 每片自己的相位，避免"整片一起落"
attribute float aTint;
uniform float uTime;
uniform float uTopY;       // 冠顶（局部）
uniform float uFallH;      // 落差：落到 uTopY - uFallH 时已经在草下面
uniform float uSpin;
uniform float uSway;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vDepth;

void main() {
    // 下落 + 回卷。回卷发生在**草面以下**，所以看不见那一下跳变。
    float t = uTime * 0.52 + aSeed.x * 41.0;
    vec3 p = aOrigin;
    p.y = uTopY - mod(t, uFallH);

    // 横摆：两个不同频率叠加（单频会看出"整片花瓣一起左右摇"）
    p.x += sin(uTime * 0.62 + aSeed.x * 6.2831) * uSway;
    p.z += cos(uTime * 0.41 + aSeed.y * 6.2831) * uSway * 0.8;

    // 翻飞：绕两个轴自转，花瓣才会"一闪一闪"
    float a1 = uTime * uSpin + aSeed.y * 6.2831;
    float a2 = uTime * uSpin * 0.73 + aSeed.x * 4.1;
    float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2);
    mat3 rz = mat3(c1, s1, 0.0, -s1, c1, 0.0, 0.0, 0.0, 1.0);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, c2, s2, 0.0, -s2, c2);
    mat3 rot = rz * rx;

    vec4 wp = modelMatrix * vec4(p + rot * position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * (rot * normal));
    vTint = aTint;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const SAKURA_PETAL_FRAG = /* glsl */ `
uniform vec3 uPetalA;
uniform vec3 uPetalB;
uniform vec3 uLightDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying float vDepth;

void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;

    vec3 c = mix(uPetalA, uPetalB, vTint);
    vec3 L = normalize(uLightDir);
    float lam = max(dot(n, L), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    // 花瓣薄到近乎透明：起手就高，且**不做接地/冠内遮蔽** —— 它是飘在空中
    c *= 0.80 + 0.20 * sky + 0.24 * lam;

    // 逆光：飘落的花瓣十有八九是逆着光看的，这一项不能省
    vec3 V = normalize(cameraPosition - vW);
    float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0);
    c += c * trans * 0.42;

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 叶 / 地面影 —— **两棵树共用**，源头在 `shaders/persimmonTree.js`      */
/*                                                                     */
/* 转出去是为了让组件只 import 一个地方；着色逻辑与树种无关，所以没有    */
/* 第二份（多一份就会漂移 —— 见 memory 里"一份会漂移的副本"那条）。      */
/* ------------------------------------------------------------------ */

export {
    TREE_LEAF_VERT as SAKURA_LEAF_VERT,
    TREE_LEAF_FRAG as SAKURA_LEAF_FRAG,
    TREE_SHADOW_VERT as SAKURA_SHADOW_VERT,
    TREE_SHADOW_FRAG as SAKURA_SHADOW_FRAG,
} from './persimmonTree';
