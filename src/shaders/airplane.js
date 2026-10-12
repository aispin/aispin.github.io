/**
 * 小飞机的着色器（WO-18）。
 * ==================================================================
 *
 * 为什么自己写材质，不用 MeshStandardMaterial
 * ------------------------------------------
 * 与 `shaders/persimmonTree.js` 顶上那段是同一条理由：场景里没有 envMap、
 * 没有 tone mapping、`shadows: false`，标准材质拿不到可用的间接光，
 * 只会变成一块糊的塑料。而这里要的东西很少也很具体：
 *
 *   · **漆面**：一条奶油色分色带 + 蒙皮接缝 + 一点高光。制成品要有"接缝"，
 *     没有接缝的飞机读起来像一块肥皂。
 *   · **墨边**：掠射角压暗。全站的语汇是水墨，飞机也得有那条边。
 *   · **霾**：和 `BambooGrove` / `IslandGround` / 两棵树同一套 —— 每帧从
 *     `scene.fog` 拷 `uHaze / uHazeNear / uHazeFar`，昼夜交替时飞机和天一起变。
 *
 * 🔴 一个材质配所有零件（`part` 顶点属性）
 * ---------------------------------------
 * 机身 / 翼 / 杆 / 轮 / 桨毂 / 桨叶是**六种颜色**，但它们**共用同一个材质**
 * —— 差异全部走 `part` 顶点属性。理由是 draw call：六种颜色 = 六个材质 =
 * 六次 draw，而一个 mesh + 一个属性只要一次。桨单独一个 mesh（它得转），
 * 但**共用同一份 uniform**，所以它也不额外增加材质切换。
 *
 * ---------------------------------------------------------------------------
 * 🔴 颜色不跟季节走（这一点和全站其他东西**故意**不同）
 * ---------------------------------------------------------------------------
 * 柿子树 / 樱花树 / 狗尾巴草 / 森林都有 `SEASON_*` 色板 —— 因为**植物**会变。
 * 飞机的漆不会。跟着季节换漆色是"为了统一而统一"，反而错。
 *
 * 那季节变化体现在哪？**光**：`uLightDir` 由组件按
 * `seasonLightFor(season).day.key.position` 给，霾由 `scene.fog` 给。
 * 同一架飞机在春天的暖光下和冬夜的冷光下自然不一样 —— 这才是对的因果。
 *
 * 🔴 颜色是**终值**，不是线性光
 * ----------------------------
 * 自定义 `ShaderMaterial` 的 fragment 输出**不过** tone mapping、也不做
 * 色彩空间转换（three 只在内置材质里插那两段 chunk），所以色板里的
 * 「sRGB 0..1」写多少屏幕就是多少 —— 与 `SEASON_FOXTAIL` / `SEASON_PLANT`
 * 同一条规矩（见 `entranceTextures.js` 里那段说明）。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**，引用标识符
 *    一律用「」。改完跑 `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* 色板（sRGB 0..1，终值）                                              */
/*                                                                     */
/* 取色思路：这是一架**停在老院子里的旧玩具飞机**，不是航空展上的新机。    */
/* 所以漆是暗青绿（和青砖墙同一个色系、略暖），配奶油色分色带；           */
/* 翼尖和桨尖用一点朱红 —— 那个红和门上的春联是同一个语汇，                */
/* 一眼就能把"院子里的东西"和"屋里的东西"连起来。                        */
/* ------------------------------------------------------------------ */

/** 机翼/机身主漆：暗青绿。 */
export const PLANE_PAINT = [0.176, 0.267, 0.251];
/** 分色带 / 翼底：奶油白（比走廊的暖白略黄，因为它在室外）。 */
export const PLANE_CREAM = [0.855, 0.827, 0.729];
/** 翼尖 / 桨尖的朱红。 */
export const PLANE_ACCENT = [0.639, 0.216, 0.176];
/** 接缝 / 起落架：墨。 */
export const PLANE_INK = [0.129, 0.125, 0.118];
/** 轮胎：近黑（不是纯黑 —— 纯黑在自定义光照下是个洞）。 */
export const PLANE_TYRE = [0.106, 0.102, 0.098];
/** 桨叶：深胡桃木。 */
export const PLANE_BLADE = [0.243, 0.180, 0.125];

/** 零件编号 —— 必须与 `utils/airplane.js` 的 `PART` 一致。 */
const PART_FUSELAGE = 0;
const PART_WING = 1;
const PART_STRUT = 2;
const PART_TYRE = 3;
const PART_SPINNER = 4;
const PART_BLADE = 5;

/** 翼尖红条的起点（离翼尖多远开始），世界单位。与 `PLANE.SPAN` 联动。 */
const TIP_BAND = 0.34;

export const PLANE_VERT = /* glsl */ `
attribute float part;

varying vec3 vN;      // 世界法线（光照用）
varying vec3 vNL;     // **局部**法线（判"上表面 / 下表面"用）
varying vec3 vW;      // 世界位置
varying vec3 vL;      // **局部**位置 —— 蒙皮接缝必须跟着零件走
varying float vPart;
varying float vDepth;

void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vL = position;
    vNL = normalize(normal);
    // 均匀缩放，所以 mat3 直接取就行
    vN = normalize(mat3(modelMatrix) * normal);
    vPart = part;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const PLANE_FRAG = /* glsl */ `
uniform vec3 uPaint;
uniform vec3 uCream;
uniform vec3 uAccent;
uniform vec3 uInk;
uniform vec3 uTyre;
uniform vec3 uBlade;
uniform vec3 uLightDir;
uniform vec3 uKey;        // 主光颜色 —— 朝阳暖边往它推（见下面"边"那段）
uniform float uEdgeAmt;   // 朝阳暖边强度
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uTipBand;

varying vec3 vN;
varying vec3 vNL;
varying vec3 vW;
varying vec3 vL;
varying float vPart;
varying float vDepth;

/**
 * 一条**硬边**的接缝线：在 x 的整数格点处画一条宽 w 的暗线。
 *
 * 做法是"到最近整数格点的距离"再取反 —— 比 step(fract(x), w) 好，
 * 因为它不会在格点两侧出现宽度不对称（fract 在 1 处跳变，
 * 用 step 判会让线看起来偏向一侧）。
 */
float seamLine(float x, float w) {
    float f = fract(x);
    f = min(f, 1.0 - f);          // 到最近整数格点的距离，落在 [0, 0.5]
    return 1.0 - smoothstep(0.0, w, f);
}

void main() {
    int p = int(vPart + 0.5);
    vec3 c;
    float gloss = 0.0;

    if (p == 0) {
        /* ---- 机身 ---- */
        c = uPaint;
        // 机腹分色带：局部 y 越低越奶油。用 smoothstep 而不是 step，
        // 分色线的边缘才不是锯齿。
        c = mix(c, uCream, smoothstep(-0.03, -0.15, vL.y));
        // 环向蒙皮接缝（沿机身长度）
        c = mix(c, uInk, seamLine((vL.z + 1.4) * 2.1, 0.055) * 0.34);
        // 纵向蒙皮线：绕机身每 60 度一条
        float ang = atan(vL.y, vL.x) * 3.0 / 3.14159265;
        c = mix(c, uInk, seamLine(ang, 0.06) * 0.17);
        // 机头那一段加深一点，读起来像"发动机罩"
        c *= 1.0 - 0.12 * smoothstep(0.9, 1.3, vL.z);
        gloss = 0.55;
    } else if (p == 1) {
        /* ---- 翼面 / 尾翼 ---- */
        // 上表面漆、下表面奶油。判据用**局部法线**的 y：世界法线会随
        // 飞机的横滚一起转，"上表面"就判反了。
        c = mix(uCream, uPaint, smoothstep(-0.20, 0.20, vNL.y));
        // 翼尖红条（只画在水平翼上：垂尾的展向是 y，不吃这条）
        float tip = smoothstep(1.6 - uTipBand, 1.6, abs(vL.x));
        c = mix(c, uAccent, tip);
        // 翼面上的一道细接缝（翼梁位置）
        c = mix(c, uInk, seamLine((vL.z + 0.55) * 6.0, 0.05) * 0.12);
        gloss = 0.5;
    } else if (p == 2) {
        /* ---- 起落架撑杆 ---- */
        c = uInk;
        gloss = 0.25;
    } else if (p == 3) {
        /* ---- 轮胎 ---- */
        c = uTyre;
        // 胎侧略亮：轮轴沿局部 x，所以侧壁的法线几乎沿 ±x。没有这一笔，
        // 轮子在自定义光照下就是一个黑球，读不出"轮"。
        c *= 0.82 + 0.42 * pow(abs(vNL.x), 2.0);
        gloss = 0.18;
    } else if (p == 4) {
        /* ---- 桨毂（整流罩）---- */
        c = uCream;
        // 罩子后半段压深，读起来有个"箍"
        c = mix(c, uInk, smoothstep(0.06, 0.14, vL.z) * 0.35);
        gloss = 0.85;
    } else {
        /* ---- 桨叶 ---- */
        float rho = length(vL.xy);
        c = mix(uBlade, uCream, smoothstep(0.46, 0.52, rho));
        c = mix(c, uAccent, smoothstep(0.53, 0.565, rho));
        gloss = 0.35;
    }

    /* ---- 光照：**三档 cel 分色**（WO-21）----
     * 参考实现「cel-material.js」的做法：「smoothstep(0.10,0.135,ndl)」与
     * 「smoothstep(0.59,0.625,ndl)」—— 两条**极窄**的过渡带，把光照切成
     * 暗 / 本色 / 亮三档。窄是关键：宽过渡带又变回平滑的 CG 塑料，
     * 而"手绘的三个色阶"正是案例比我们"像画的"的头号原因。
     *
     * 三档的系数是按**原来那条连续公式**（「0.34 + 0.40*sky + 0.78*lam」）
     * 配的，所以整体明度没变 —— 改的是"过渡变成了台阶"。
     */
    vec3 n = normalize(vN);
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(cameraPosition - vW);
    float lam = dot(n, L);
    float sky = 0.5 + 0.5 * n.y;
    float shadowBand = smoothstep(0.10, 0.135, lam);
    float lightBand = smoothstep(0.59, 0.625, lam);
    float level = mix(0.52, 0.95, shadowBand);
    level = mix(level, 1.45, lightBand);
    c *= level * (0.80 + 0.30 * sky);

    /* ---- 高光：只有漆面 / 金属有，橡胶和墨杆没有 ---- */
    if (gloss > 0.0) {
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(n, H), 0.0), 40.0) * gloss;
        c += vec3(spec) * 0.5;
    }

    /* ---- 边：**背阳侧压暗、朝阳侧染暖**（WO-21）----
     * 原来只有"掠射角压暗"（全站的水墨语汇）。案例的边是**金**的 ——
     * 那才是让飞机"被夕阳包住"的那一笔。两者不是二选一，而是同一条边的
     * 两侧：用一个「sunSide」把两种行为分开，就不会互相抵消。
     *   · 「sunSide」高（朝着太阳的那一圈）⇒ 往「uKey」暖色推；
     *   · 「sunSide」低（背阳的那一圈）⇒ 压暗，保留水墨边。
     */
    float rim = pow(1.0 - abs(dot(n, V)), 3.0);
    float sunSide = smoothstep(-0.12, 0.55, lam);
    c *= 1.0 - 0.26 * rim * (1.0 - sunSide);
    c = mix(c, uKey * 1.12, rim * sunSide * uEdgeAmt);

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 描边壳（WO-21）                                                      */
/*                                                                     */
/* 参考实现 `cel-material.js` 的 `createOutlineMaterial`：同一份几何     */
/* **再画一遍**，`BackSide` + 沿**视空间法线**外扩。看到的只是"壳比本体  */
/* 多探出来的那一圈" —— 一条均匀的墨线。                                 */
/*                                                                     */
/* 🔴 为什么只**飞行中**挂                                                     */
/* ------------------------------------------------------------------ */
/* 停机时飞机在画面里只有百来像素，一次额外的 draw 换不来可见的收益 ——      */
/* 这是 WO-18 当时**故意**不做描边的理由，那条理由现在仍然成立。            */
/* 但飞起来之后飞机是主角（几百像素、还会侧倾），墨线是"读起来像画的"       */
/* 那一笔 —— 值那一次 draw。所以边界就是 `active`。                       */
/*                                                                     */
/* 🔴 厚度乘 `(-mv.z)`                                                    */
/* ------------------------------------------------------------------ */
/* 参考实现写的是**恒定世界厚度**（0.022）。那是可以的，因为它的相机距离   */
/* 变化不大。本项目的镜头有推拉（`dolly` 1.0~1.24），而且飞机还会飞远 ——    */
/* 恒定世界厚度在远处会细到看不见。乘上视空间深度 ⇒ 世界厚度 ∝ 距离        */
/* ⇒ **屏幕上的线宽恒定**。                                                */
/* ------------------------------------------------------------------ */

export const PLANE_OUTLINE_VERT = /* glsl */ `
uniform float uThickness;
varying float vDepth;

void main() {
    // 法线矩阵会抵消掉继承来的非均匀缩放 ⇒ 每个壳的**世界**宽度一致
    // （参考实现「outlineVertex」那条注释）。
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 乘 (-mv.z)：世界厚度 ∝ 距离 ⇒ 屏幕上恒定线宽。见上面那段。
    mv.xyz += viewNormal * uThickness * (-mv.z);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const PLANE_OUTLINE_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vDepth;

void main() {
    // 描边也要吃霾 —— 否则飞远之后"飞机化进雾里、墨线还浮着"。
    vec3 c = mix(uInk, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/** 色板打包成 uniform 对象（组件里 spread 进 `useSeasonUniforms` 的产物）。 */
export function airplanePalette() {
    return {
        uPaint: { value: PLANE_PAINT },
        uCream: { value: PLANE_CREAM },
        uAccent: { value: PLANE_ACCENT },
        uInk: { value: PLANE_INK },
        uTyre: { value: PLANE_TYRE },
        uBlade: { value: PLANE_BLADE },
        uTipBand: { value: TIP_BAND },
        /** 主光颜色（**是光，不是漆** ⇒ 跟季节走，见文件头那段）。 */
        uKey: { value: new THREE.Color(1, 0.96, 0.88) },
        /** 朝阳暖边的强度。 */
        uEdgeAmt: { value: EDGE_AMOUNT },
        /** 描边壳厚度（× 视空间深度 ⇒ 屏幕线宽恒定）。 */
        uThickness: { value: OUTLINE_THICKNESS },
    };
}

/** 朝阳暖边的强度 —— 与参考实现的 `edgeHighlight = 0.23` 同量级。 */
const EDGE_AMOUNT = 0.34;

/**
 * 描边壳厚度。
 *
 * ⚠️ 它乘的是视空间深度 ⇒ 实际是"屏幕高度的百分之多少"。0.0045 在
 *    fov 60 / 900 像素高的画面上 ≈ `0.0045 / (2·tan30°) × 900 ≈ 3.5` 像素。
 */
const OUTLINE_THICKNESS = 0.0045;

/* ------------------------------------------------------------------ */
/* 地面投影                                                            */
/*                                                                     */
/* 一片 1×1 的平面，靠 `scale` 摊成椭圆；软边由片元的径向衰减给。        */
/* 与两棵树的投影同一条做法（它们各写了一份，因为颜色/形状参数不同）——   */
/* 共同点是：**都是 `renderOrder = 1` + `depthWrite: false`**，           */
/* 否则会和草地 z-fight（见 memory 的透明排序那条）。                    */
/* ------------------------------------------------------------------ */

export const PLANE_SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLANE_SHADOW_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // 两个方向给不同的指数：机影是**沿机身长轴拉长**的椭圆，不是圆。
    // 只用一个 length(p) 会得到一个正圆，读起来像"下面有个井盖"。
    float r = length(vec2(p.x, p.y * 1.35));
    float a = (1.0 - smoothstep(0.15, 1.0, r)) * uOpacity;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uTint, a);
}
`;

