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

    /* ---- 光照：主光 + 天光 ---- */
    vec3 n = normalize(vN);
    vec3 L = normalize(uLightDir);
    float lam = max(dot(n, L), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    c *= 0.34 + 0.40 * sky + 0.78 * lam;

    /* ---- 高光：只有漆面 / 金属有，橡胶和墨杆没有 ---- */
    if (gloss > 0.0) {
        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(n, H), 0.0), 40.0) * gloss;
        c += vec3(spec) * 0.5;
    }

    /* ---- 墨边：掠射角压暗 ----
     * 和全站的水墨语汇一致。它同时替代了"描边 pass"（反向壳）
     * —— 在院子这个尺度上，飞机只有几百像素，反向壳的收益不值那一次 draw。 */
    vec3 V2 = normalize(cameraPosition - vW);
    float rim = 1.0 - abs(dot(n, V2));
    c *= 1.0 - 0.32 * pow(rim, 3.0);

    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
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
    };
}

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

