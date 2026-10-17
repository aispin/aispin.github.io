import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { unmultiplyVeil, toShaderColor } from '../../config/theme'
import { seasonLightFor } from '../../config/seasonLight'
import { useSitePreferences } from '../../context/SitePreferences'
import { useSeason } from '../../hooks/useSeason'

/**
 * SceneLighting — the whole scene's ambience in one place: background, fog, the
 * three-light rig and the veil, cross-fading between DAY and NIGHT.
 *
 * WHY ONE COMPONENT OWNS ALL OF IT
 * --------------------------------
 * These are separate scene properties, but night has to move them *together* —
 * a navy sky over a midday-lit wall reads as a bug, not as dusk. Scattering
 * them across App.jsx (background + fog) and Experience.jsx (lights) would mean
 * two effects racing on the same transition. Here it is one eased scalar
 * driving all of them.
 *
 * WHY NIGHT NEEDS A FULL-FRAME MULTIPLY AND NOT JUST DARKER LIGHTS
 * ---------------------------------------------------------------
 * See the long note on NIGHT in config/theme.js. Short version: hundreds of
 * materials in this scene are unlit `MeshBasicMaterial`s painting baked canvas
 * art, and the facade is a `ShaderMaterial`. Dimming the rig leaves every one
 * of them untouched, so the site simply stayed daytime. The veil is the only
 * knob that reaches all three material kinds.
 *
 * ── 季节（2026-10-09）────────────────────────────────────────────────
 *
 * 轴是**正交**的：`theme`（明暗）× `season`（春夏秋冬）= 8 态。
 *
 * 实现上**只换了端点**：`DAY` / `NIGHT_FROM` 两个模块级常量，变成
 * `endpointsFor(season)` 给出的那一季的两组。下面的插值机器
 * —— `t` 的 0.9s 缓动、首帧吸附、veil 的 lerp —— **一行都没动**。
 *
 * 2026-10-09：设置面板能选季节之后，季节不再是"一次会话内恒定"的。这里
 * **没有**升级成双线性插值（季节轴 × 昼夜轴），因为换季应当是**瞬间吸附**
 * 而不是一次黄昏 —— 见下面 `lastSeason` 的注释。所以插值机依然只有一维。
 *
 * 秋天直接引用 `theme.js` 的现有常量（见 config/seasonLight.js），
 * 所以 `?season=autumn` 与加季节之前**逐位一致**。
 *
 * WHY IT IS NOT INSIDE Experience.jsx
 * -----------------------------------
 * Experience is lazy-loaded. If the fog/background were declared there, the
 * first frames of the session would run with three's defaults (no fog, no
 * background) until the chunk resolved. They used to sit in App.jsx for that
 * reason, so this lives outside the chunk too — App.jsx mounts it directly.
 *
 * The DOM half of the switch already existed: SitePreferences has read
 * localStorage['aispin-theme'], fallen back to prefers-color-scheme and set
 * `documentElement.dataset.theme` since before any of this. The canvas simply
 * never listened. This is that listener.
 */

/** Seconds for a full day<->night cross-fade. Long enough to read as a dusk. */
const FADE_SECONDS = 0.9

/**
 * 某一季的两组端点，转成 three 的 Color。
 *
 * 按季节缓存 —— 虽然季节在一次会话里恒定（等于只算一次），但把它写成表
 * 更贴近意图：这是"每季算一次"，不是"每次渲染算一次"。
 */
const endpointCache = new Map()

function endpointsFor(season) {
    if (endpointCache.has(season)) return endpointCache.get(season)

    const L = seasonLightFor(season)
    const d = L.day
    const n = L.night

    const out = {
        day: {
            // WO-33c：每季的**乘性**气氛染色（线性空间）。秋天是恒等白。
            tint: new THREE.Color(d.tint),
            sky: new THREE.Color(d.sky),
            haze: new THREE.Color(d.haze),
            ambient: new THREE.Color(d.ambient.color),
            key: new THREE.Color(d.key.color),
            fill: new THREE.Color(d.fill.color),
            veil: new THREE.Color(1, 1, 1),
            fogNear: d.fogNear,
            fogFar: d.fogFar,
            ambientI: d.ambient.intensity,
            keyI: d.key.intensity,
            fillI: d.fill.intensity,
            keyPos: d.key.position,
            fillPos: d.fill.position,
        },
        night: {
            // WO-33c：夜里的染色**更淡**（暗色上一个比例会读得更重）。
            tint: new THREE.Color(n.tint),
            /** `scene.background` is multiplied by the veil afterwards, so the
             *  sky we actually want to see has to be un-multiplied first —
             *  otherwise it gets darkened twice and the horizon goes black.
             *  **每季用自己的 veil 反算**（冬夜的 veil 比秋夜亮，因为雪把天光
             *  反上来）。 */
            sky: new THREE.Color(unmultiplyVeil(n.sky, n.veil)),
            haze: new THREE.Color(unmultiplyVeil(n.haze, n.veil)),
            ambient: new THREE.Color(n.ambient.color),
            key: new THREE.Color(n.key.color),
            fill: new THREE.Color(n.fill.color),
            veil: new THREE.Color(n.veil.r, n.veil.g, n.veil.b),
            fogNear: n.fogNear,
            fogFar: n.fogFar,
            ambientI: n.ambient.intensity,
            keyI: n.key.intensity,
            fillI: n.fill.intensity,
            keyPos: n.key.position,
            fillPos: n.fill.position,
        },
    }

    endpointCache.set(season, out)
    return out
}

/** White -> the night tint. Multiplied into every pixel of the frame. */
const VEIL_VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        // Straight to clip space: the quad is a screen-space overlay, so the
        // mesh's own position/rotation must not be allowed to move it.
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

const VEIL_FRAG = /* glsl */`
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
        gl_FragColor = vec4(uTint, 1.0);
    }
`

const lerp = (a, b, t) => a + (b - a) * t

/* ------------------------------------------------------------------ */
/* 天空穹顶（2026-10-12，WO-14 / DR-A 答"要"）                          */
/*                                                                     */
/* 为什么需要一个真的穹顶，而不是只把 `scene.background` 换个颜色        */
/* ------------------------------------------------------------------ */
/* 雾拉远之后（`seasonLight.js`：fogFar 36~66 → 76~128），**地平线会露   */
/* 出来** —— 而 `scene.background` 是一个**平色**，平色在"天"和"海"上    */
/* 抹的是同一个颜色，地平线就无从谈起。                                   */
/*                                                                     */
/* 于是：地平线 = 雾色（和"远方全部化进霾里"的地面**逐位接上**），         */
/* 天顶 = 那一季的天空色，中间一条渐变；再按主光方位加一点暖晕。          */
/*                                                                     */
/* 🔴 地平线以下**必须**是雾色，不能压暗、不能加别的渐变                  */
/* ------------------------------------------------------------------ */
/* 地面是一张有限大的平面，在 `camera.far` 处被裁掉；裁不掉的那一段早就  */
/* 完全化进雾里了（`fogFar` ≤ 128 < 150）。所以"地面被裁掉之后露出来的    */
/* 那一块"必须正好等于雾色，否则地平线上会出现一条**硬边**。             */
/* 想要"海平线"的观感，靠的是"雾色 vs 天顶色"这个差 —— 而不是在地平线   */
/* 下面再压一道暗色（那会立刻露馅）。                                    */
/*                                                                     */
/* 其余三条：半径必须 < `camera.far`（138 = 150 × 0.92）、每帧跟着相机   */
/* 走（否则走两步天空就歪了）、`depthWrite: false`。⚠️ 夜间的 veil 在    */
/* renderOrder 999，会把它一起乘 —— 和以前 `scene.background` 的待遇一 */
/* 致，不用额外处理。                                                    */
/*                                                                     */
/* 🔴 WO-19：`renderOrder` 从 **-1000 改成 +1**（从"最先画"改成"最后画"） */
/* ------------------------------------------------------------------ */
/* 加云带之前，天空是一个 3 次 smoothstep —— 便宜到"先画后画无所谓"。     */
/* 现在它多了 3 次 fbm（≈ 36 次 hash），而天空是**不写深度**的全屏层：    */
/* 先画的话，房子盖住的那 40% 像素**照样跑完整段 fbm**，纯浪费。          */
/*                                                                     */
/* 改成"最后画 + `depthTest: true`"之后，早深度剔除会把被挡住的那部分     */
/* 直接丢掉（不透明物体的 renderOrder 只在**不透明队列内部**排序，所以    */
/* 它依然排在所有透明物之前，veil / 天象的合成顺序一点没变）。            */
/* 地平线以下仍由 `t` 的 `-0.06` 兜住，与"地面化雾"逐位接上。             */
/* ------------------------------------------------------------------ */

const SKY_RADIUS_SCALE = 0.92

/* ------------------------------------------------------------------ */
/* 云带 + 日轮（2026-10-12，WO-19）                                     */
/*                                                                     */
/* 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」*/
/*                                                                     */
/* 对齐的是参考实现 `sunset-world.js` 里 `createSky()` 的**做法**：       */
/*   ① 在"经度 × 高度"的二维噪声域里铺一层 **FBM 云带**，再用低频 warp  */
/*      把拉长的条纹打散（否则是等距的直尺纹）；                        */
/*   ② **日轮 + 指数光晕**（`exp(-ang²/σ)`），不是一个模糊的亮斑。       */
/*                                                                     */
/* 🔴 但**色板一个字都不抄**。参考实现是固定夕阳（`#382647` 天顶 /        */
/*    `#c87675` 地平线 / `#ffbd71` 金），本项目是**四季 × 昼夜 8 态**，   */
/*    色板必须仍然由 `seasonLight.js` 的端点驱动（`uZenith` /            */
/*    `uHorizon` / `uGlow` 本来就是），云带色从**地平线色**派生。         */
/*                                                                     */
/* 🔴 云带要**克制**。本项目的四组白天天空全是高调浅色（`#EAF3E6` /      */
/*    `#FFF6E0` / `#E9EEF3`），照抄案例的深紫云会变成暴风雨。所以：       */
/*    云带色 = 地平线色**压暗一档 + 偏冷**，混合量 `uStrata` 只有         */
/*    0.34（白天）/ 0.12（夜里）—— 读起来是「薄云」，不是「乌云」。      */
/* ------------------------------------------------------------------ */

/**
 * 云带色相对地平线色的**线性**缩放：整体压暗、且蓝分量留得最高（偏冷）。
 *
 * ⚠️ 是**线性**空间的乘子，不是屏幕值。线性 0.80 ≈ 屏幕 0.90 —— 所以
 *    "0.80" 看着很猛，实际只是浅浅一档。
 */
/*
 * 🔴 WO-32f：原来这两个数**做出来了但看不见**。实测（`shots.mjs` 同机位、
 *    `eval` 把 `uStrata` 与 `uSunDisk` 清零做 A/B，天空带 1400×360）：
 *      · 云带对天空的逐像素贡献：**中位 1/255、均值 2.57、最大 11/255**
 *      · 开着带时"逐列均值 std" 只有 **0.99/255** —— 验收要的"横向亮度结构"
 *        在这个量级上读不出来，天空看起来就是一条纯色渐变。
 *    原因不是没画，而是**两头都太轻**：`uStrata` 0.34 × 云色只比地平线暗 9%
 *    （浅色在 sRGB 曲线上本来就压不出差）⇒ 乘积之后只剩个位数。
 *    ⇒ 同时加深云色 + 提高混合量，把它推到"看得见但仍读作薄云"的档位。
 */
const SKY_CLOUD_DARKEN = new THREE.Color(0.62, 0.67, 0.79)

/** 云带混合量（白天 / 夜里）。夜里几乎只剩一层很淡的月色薄云。 */
const SKY_STRATA_DAY = 0.72
const SKY_STRATA_NIGHT = 0.22;

const SKY_VERT = /* glsl */`
    varying vec3 vDir;
    void main() {
        // 局部坐标归一化就是方向（球心在原点，且整球跟着相机走）
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

const SKY_FRAG = /* glsl */`
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uGlow;
    uniform vec3 uCloud;
    uniform vec3 uSunDir;
    uniform float uGlowAmt;
    uniform float uStrata;
    uniform float uSunDisk;
    uniform float uTime;
    varying vec3 vDir;

    const float TAU = 6.28318530718;
    const float INV_TAU = 0.15915494309;

    /* 云带横向坐标的周期，单位 = 噪声格点数。必须是**整数**。
       取值和原来几乎一样：原「经度 × 1.6」= 10.05 格/圈、「经度 × 5.8」= 36.44 格/圈。 */
    const float WASH_W = 10.0;
    const float CLOUD_W = 36.0;

    /* 值噪声 —— 与参考实现同一套（hash → noise → 3 阶 fbm）。
       🔴 WO-32h：横向格点**必须周期化**，wrap = 横向周期（整数格点数）。
       为什么：云带的横向坐标是**经度**，而经度在 ±π 处跳一整圈 —— 不周期化的话
       两侧采到的是完全不同的噪声值，屏幕上就是一条贯穿地平线的**竖直接缝**
       （实测单列跳变 7.2/255，左右邻居只有 0.1，隔离比 85 倍）。
       周期化之后 noise(x + wrap) == noise(x) 逐位成立 ⇒ 接缝在数学上不存在。
       只做横向周期：绕一圈正好走满**一个**周期，所以看不出平铺。 */
    float skyHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    /* 🔴 WO-32i：**梯度噪声**（Perlin），不再是「hash 值 + smoothstep 插值」的值噪声。
       ──────────────────────────────────────────────────────────────────────────
       值噪声只在**格点**上有值，格内靠 smoothstep 插值，而 smoothstep 在两端
       **导数恰好为 0** ⇒ 每条格线两侧都摊平成一段十几像素的平板。
       天空是一整片平滑渐变，人眼对 Mach band 极敏感 ⇒ 那些平板被读成
       **一条条竖直直线**，用户说的「明显的拼接痕迹」就是它。

       实测（「harness/probe-sky-tess.mjs」只渲染天穹、把「wash」直接渲成灰度）：
         · 剖面在 x=390..407 连续 **17 px 一模一样**（97,97,97,…）；
         · 最大相邻跳变只有 **2/255** —— 没有台阶，只是"不弯了"；
         · 球面 32×16 → 128×64 → 256×128，折痕位置**一格没动** ⇒ 与顶点插值无关；
         · 「CLOUD_W」36 → 37 也没动 ⇒ 不是"格点在哪"的问题，是**插值曲线本身**。
       所以换插值曲线治不了（quintic 更平、linear 更硬），必须换噪声族：
       梯度噪声格内是**线性梯度**，格线处导数不为 0 ⇒ 平板不存在。

       ⚠️ 周期化约定全部保留：四个角的下标**都要 mod**（只 mod 「i.x」的话，
          「i.x + 1」会在 wrap 处越界，接缝又回来了）。
       ⚠️ 值域归一：Perlin 原始 std ≈ 0.195、值噪声 ≈ 0.18 ⇒ ×0.92 + 0.5
          之后分布与原来几乎一致，「smoothstep(0.38, 0.79, …)」这些阈值不用重调。 */
    vec2 skyGrad(float ix, float iy) {
        float a = skyHash(vec2(ix, iy)) * TAU;
        return vec2(cos(a), sin(a));
    }
    float skyNoise(vec2 p, float wrap) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float x0 = mod(i.x, wrap);
        float x1 = mod(i.x + 1.0, wrap);
        // quintic fade：C2 连续，二阶导也不跳（Mach band 对二阶导同样敏感）
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float n00 = dot(skyGrad(x0, i.y), f);
        float n10 = dot(skyGrad(x1, i.y), f - vec2(1.0, 0.0));
        float n01 = dot(skyGrad(x0, i.y + 1.0), f - vec2(0.0, 1.0));
        float n11 = dot(skyGrad(x1, i.y + 1.0), f - vec2(1.0, 1.0));
        return clamp(mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 0.92 + 0.5,
            0.0, 1.0);
    }
    /* 倍频必须是**整数** 2 / 4，周期也跟着乘 —— 否则第二个八度接不上
       （原为 2.07 / 4.13，非整数就周期化不了）。 */
    float skyFbm(vec2 p, float wrap) {
        return skyNoise(p, wrap) * 0.57
            + skyNoise(p * 2.0 + 17.4, wrap * 2.0) * 0.28
            + skyNoise(p * 4.0 + 31.8, wrap * 4.0) * 0.15;
    }

    void main() {
        // 插值出来的方向长度略偏离 1，而下面要算 acos(dot(...)) —— 归一化一下。
        vec3 dir = normalize(vDir);
        float h = dir.y;

        // 天顶 → 地平线。「-0.06」而不是 0：让「就贴着地平线的那一圈」也已经
        // 是雾色，和地面完全化雾的那一段对齐。
        float t = smoothstep(-0.06, 0.55, h);
        vec3 c = mix(uHorizon, uZenith, t);

        // 太阳方位的地平线暖晕：一条很淡的横向亮带，只在太阳那一侧。
        // ⚠️ 变量名**不能叫 flat** —— three 在 WebGL2 下按 GLSL ES 3.00 编译，
        //    而「flat」在那里是**插值限定符关键字**，会报「'flat' : syntax error」
        //    并且整个 fragment shader 都不编译（背景直接退回 scene.background）。
        vec2 flatDir = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5);
        float d = max(dot(normalize(vec2(dir.x, dir.z) + 1e-5), flatDir), 0.0);
        float sunDot = max(dot(dir, uSunDir), 0.0);
        c += uGlow * uGlowAmt * pow(d, 3.0) * smoothstep(0.42, -0.02, h);

        // ---- 云带：只算地平线以上（一致分支，地面那一半整个跳过）----
        if (h > 0.0) {
            // 横向坐标 = **经度的圈数**（[-0.5, 0.5)，跨 ±π 是连续的），再乘一个
            // 整数周期。见 skyNoise 的注 —— 整数是周期化的前提。
            float lon = atan(dir.z, dir.x) * INV_TAU;
            // 低频双轴 curl：把拉长的条带打散，否则是等距的直尺纹。
            vec2 washSpace = vec2(lon * WASH_W, h * 5.2);
            vec2 warp = vec2(
                skyFbm(washSpace + vec2(9.2, 3.1), WASH_W),
                skyFbm(washSpace + vec2(23.8, 11.7), WASH_W)
            ) - 0.5;
            vec2 p = vec2(lon * CLOUD_W, h * 17.0);
            p += warp * vec2(1.7, 3.6);
            // ⚠️ 横向相位也必须是**整数**谐波（原来 2.3，非整数在 ±π 处对不上）。
            p.y += sin(lon * TAU * 2.0 + warp.x * 4.0) * 0.72;
            p += uTime * vec2(0.035, 0.018);
            float wash = skyFbm(p, CLOUD_W);
            float streak = smoothstep(0.38, 0.79, wash);
            // 云只贴地平线那一带：再高就散掉。
            float skyMask = smoothstep(-0.01, 0.08, h)
                * (1.0 - smoothstep(0.55, 0.92, h));
            // 破边：**复用** wash，不再多算一次 fbm（省 3 次噪声求值）。
            float broken = smoothstep(0.30, 0.72, wash + warp.x * 0.9);
            c = mix(c, uCloud,
                streak * skyMask * (0.28 + broken * 0.72) * uStrata);
            // 朝阳那一侧的云边染金（很窄的一条）。
            float warmLip = smoothstep(0.44, 0.53, wash)
                * (1.0 - smoothstep(0.53, 0.61, wash));
            c = mix(c, uGlow,
                warmLip * skyMask * pow(sunDot, 3.5) * 0.20 * uStrata);
        }

        // ---- 日轮 + 光晕 ----
        // 两段光晕：紧的一圈 + 很宽的一圈。宽的那圈是为了「太阳在画面外时
        // 也看得见它在哪」—— 本项目太阳高度角 30°~66°，而 fov 是 60°（竖向），
        // 高日角的太阳经常落在画面之上。
        float ang = acos(clamp(sunDot, 0.0, 1.0));
        c += uGlow * exp(-ang * ang / 0.0060) * 0.22 * uSunDisk;
        c += uGlow * exp(-ang * ang / 0.1000) * 0.10 * uSunDisk;
        // 日轮本体。角半径 ~1.7°（真太阳 0.53°）—— 写实尺寸在 900 像素高的
        // 画面里只有 8 个像素，读不出是个"轮"。
        float disk = 1.0 - smoothstep(0.0295, 0.0335, ang);
        c = mix(c, uGlow * 1.35 + vec3(0.10, 0.07, 0.035), disk * uSunDisk);

        gl_FragColor = vec4(c, 1.0);
    }
`

const SceneLighting = ({ isLowTier = false }) => {
    const { theme } = useSitePreferences()
    const night = theme === 'dark'
    const season = useSeason()

    const EP = useMemo(() => endpointsFor(season), [season])

    const ambientRef = useRef()
    const keyRef = useRef()
    const fillRef = useRef()

    // A scratch colour reused every frame instead of allocating one per fade.
    const sky = useRef(new THREE.Color(EP.day.sky))

    const scene = useThree((state) => state.scene)
    const camera = useThree((state) => state.camera)

    const veilUniforms = useRef({ uTint: { value: new THREE.Color(1, 1, 1) } })

    // 天空穹顶：几何体只有一份，颜色每帧（其实是每次昼夜/换季过渡时）写一次。
    const skyRef = useRef()
    const skyUniforms = useRef({
        uZenith: { value: new THREE.Color(EP.day.sky) },
        uHorizon: { value: new THREE.Color(EP.day.haze) },
        uGlow: { value: new THREE.Color(EP.day.key) },
        // 云带色 = 地平线色压暗偏冷（线性空间乘）。初值按当前昼夜给。
        uCloud: { value: new THREE.Color(EP.day.haze).multiply(SKY_CLOUD_DARKEN) },
        uSunDir: { value: new THREE.Vector3(5, 8.5, 5).normalize() },
        uGlowAmt: { value: 0.12 },
        // 云带强度 / 日轮强度 —— 都跟昼夜因子 k 走（见下面的 lerp）。
        uStrata: { value: night ? SKY_STRATA_NIGHT : SKY_STRATA_DAY },
        uSunDisk: { value: night ? 0 : 1 },
        // 云带的漂移相位。**每帧都要写**（在下面那个"已稳定就 return"之前），
        // 所以它不能进那段只在过渡期跑的逻辑。
        uTime: { value: 0 },
    })
    // 每帧复用的临时量（不分配）
    const sunScratch = useRef(new THREE.Vector3())
    const cloudScratch = useRef(new THREE.Color())
    /** WO-33c：当帧的季节气氛染色（在线性空间插值出来的那一份）。 */
    const tintScratch = useRef(new THREE.Color(1, 1, 1))

    // 0 = full day, 1 = full night. -1 means "nothing written yet": the first
    // frame snaps straight to the current theme rather than fading in from
    // daylight, so a page opened in dark mode is dark on frame one.
    const t = useRef(-1)

    /**
     * 换季：把插值机归零，让它**立刻**按新季节重写一遍。
     *
     * 背景 / 雾 / 三盏灯都只在**插值过程中**被写，稳定后下面那个 `return` 会
     * 直接跳过整段。而 `endpointsFor(season)` 换的是端点，不是结果 —— 不归零
     * 的话，深色模式下换季会停在旧季节的天空、雾与色温里（白天换季更隐蔽：
     * 端点表整个换了，但画面只在下一次切昼夜时才更新）。
     *
     * 归零 = 瞬间吸附，不插值。这是有意的：换季是"换一副牌"，不是"傍晚来临"，
     * 0.9s 的缓动在这里会读成一次诡异的黄昏。
     */
    const lastSeason = useRef(season)

    useFrame((state, delta) => {
        // 🔴 穹顶跟相机走这一步**必须在下面那个"已稳定就 return"之前** ——
        //    否则每次昼夜过渡结束后天空就冻在最后一次的位置上，相机一走
        //    它就歪。
        if (skyRef.current) skyRef.current.position.copy(camera.position)

        // 云带的漂移相位同理：**必须每帧写**（它就是"云在动"本身）。
        skyUniforms.current.uTime.value = state.clock.elapsedTime

        if (lastSeason.current !== season) {
            lastSeason.current = season
            t.current = -1
        }

        const target = night ? 1 : 0
        if (t.current < 0) {
            t.current = target
        } else if (t.current !== target) {
            const step = delta / FADE_SECONDS
            t.current = target > t.current
                ? Math.min(target, t.current + step)
                : Math.max(target, t.current - step)
        } else {
            // Settled. Everything below is already in place — a 0.9 s fade
            // should not cost a pile of colour lerps every frame for the rest
            // of the session.
            return
        }

        const k = t.current
        const D = EP.day
        const N = EP.night

        // Everything below writes straight into the three.js scene graph.
        // `react-hooks/immutability` flags that because `scene` comes out of a
        // hook — but the rule is about React state, and a scene graph is an
        // imperative object that exists precisely to be mutated. Routing it
        // through a ref would satisfy the linter while hiding what the code
        // does, so it is disabled here with the reason instead.
        /* eslint-disable react-hooks/immutability */

        // --- 当帧的季节染色（WO-33c）---
        // 🔴 天穹 / 雾 / 云必须乘**同一份**，否则水平线处露缝（地平线色 = 雾色）。
        //    秋天是恒等白 ⇒ `?season=autumn` 逐位不变。
        const TINT = tintScratch.current.copy(D.tint).lerp(N.tint, k)

        // --- background + fog (owned here, see the header) ---
        sky.current.copy(D.sky).lerp(N.sky, k).multiply(TINT)
        scene.background = sky.current

        if (scene.fog) {
            scene.fog.color.copy(D.haze).lerp(N.haze, k).multiply(TINT)
            scene.fog.near = lerp(D.fogNear, N.fogNear, k)
            scene.fog.far = lerp(D.fogFar, N.fogFar, k)
        }
        /* eslint-enable react-hooks/immutability */

        // --- 天空穹顶 ---
        // ⚠️ 三个都要过 `toShaderColor`：先在线性空间插值（那是物理上对的），
        //    再转成屏幕值 —— 否则天会明显更暗更橙（见 `config/theme.js`）。
        const S = skyUniforms.current
        // ⚠️ 三个都要过 `toShaderColor`，而且**先乘 TINT 再转**（染的是线性色）。
        toShaderColor(S.uZenith.value.copy(D.sky).lerp(N.sky, k).multiply(TINT), S.uZenith.value)
        toShaderColor(S.uHorizon.value.copy(D.haze).lerp(N.haze, k).multiply(TINT), S.uHorizon.value)
        toShaderColor(S.uGlow.value.copy(D.key).lerp(N.key, k).multiply(TINT), S.uGlow.value)
        // 云带色：**从地平线色派生**（线性空间压暗 + 偏冷），不是另立一个色板。
        // 这样换季 / 入夜时云和天永远同源，不会出现"紫色的云挂在青色的天上"。
        // WO-33c：TINT 也一起乘 —— 云的季节色相就是从这里来的（§5 单一真源不变）。
        toShaderColor(
            cloudScratch.current.copy(D.haze).lerp(N.haze, k).multiply(SKY_CLOUD_DARKEN).multiply(TINT),
            S.uCloud.value
        )
        // 太阳方位：把两端的灯位插值之后再归一化
        sunScratch.current.set(D.keyPos[0], D.keyPos[1], D.keyPos[2]).normalize()
        const nx = N.keyPos[0], ny = N.keyPos[1], nz = N.keyPos[2]
        const nl = Math.hypot(nx, ny, nz) || 1
        sunScratch.current.lerp(
            new THREE.Vector3(nx / nl, ny / nl, nz / nl),
            k
        ).normalize()
        skyUniforms.current.uSunDir.value.copy(sunScratch.current)
        // 白天光晕强一点（太阳在那儿），夜里几乎只剩一点天光
        skyUniforms.current.uGlowAmt.value = lerp(0.12, 0.045, k)
        // 云带：白天是薄云，夜里只剩一层很淡的月色。
        skyUniforms.current.uStrata.value = lerp(SKY_STRATA_DAY, SKY_STRATA_NIGHT, k)
        // 日轮：**夜里直接灭掉** —— 没有太阳就不该画一个太阳。
        skyUniforms.current.uSunDisk.value = 1 - k

        // --- the veil ---
        veilUniforms.current.uTint.value.copy(D.veil).lerp(N.veil, k)

        // --- the rig ---
        const amb = ambientRef.current
        if (amb) {
            amb.color.copy(D.ambient).lerp(N.ambient, k)
            amb.intensity = lerp(D.ambientI, N.ambientI, k)
        }

        const key = keyRef.current
        if (key) {
            key.color.copy(D.key).lerp(N.key, k)
            key.intensity = lerp(D.keyI, N.keyI, k)
        }

        const fill = fillRef.current
        if (fill) {
            fill.color.copy(D.fill).lerp(N.fill, k)
            fill.intensity = lerp(D.fillI, N.fillI, k)
        }
    })

    return (
        <>
            {/* Fog is declared here rather than via App.jsx's old declarative
                <fog>, because this component resolves the theme on its first
                render — so the very first painted frame is already right. */}
            <fog attach="fog" args={[EP.day.haze.getHex(), EP.day.fogNear, EP.day.fogFar]} />

            {/* 天空穹顶。`frustumCulled={false}` 必需 —— 它每帧被搬到相机位置，
                自动包围球会在搬之前把它剔掉。
                ⚠️ `renderOrder = 1` + `depthTest` 是 WO-19 改的（原为 -1000 且
                   不开深度测试）：云带的 fbm 不便宜，而天空不写深度 ⇒ 先画的
                   话"被房子挡住的那些像素"照样白算一遍。改成最后画之后靠早深度
                   剔除丢掉它们。不透明物体的 renderOrder 只在不透明队列内部
                   排序 ⇒ veil / 天象的合成顺序完全没变。 */}
            <mesh ref={skyRef} name="sky-dome" renderOrder={1} frustumCulled={false} raycast={() => null}>
                <sphereGeometry args={[camera.far * SKY_RADIUS_SCALE, 32, 16]} />
                <shaderMaterial
                    vertexShader={SKY_VERT}
                    fragmentShader={SKY_FRAG}
                    uniforms={skyUniforms.current}
                    side={THREE.BackSide}
                    depthWrite={false}
                />
            </mesh>

            <ambientLight
                ref={ambientRef}
                color={EP.day.ambient.getHex()}
                intensity={EP.day.ambientI}
            />
            {/* 太阳高度角按季节给：夏至最高（影子最短）、冬至最低。
                它改的是**明暗**（Lambert 项），不是影长 —— 影长画在树的贴图里，
                因为本项目 `LIGHTS.shadows = false`。 */}
            <directionalLight
                ref={keyRef}
                position={EP.day.keyPos}
                intensity={EP.day.keyI}
                color={EP.day.key.getHex()}
            />
            {!isLowTier && (
                <directionalLight
                    ref={fillRef}
                    position={EP.day.fillPos}
                    intensity={EP.day.fillI}
                    color={EP.day.fill.getHex()}
                />
            )}

            {/* The night veil. `transparent: true` is load-bearing, not cosmetic:
                it puts the quad in three's transparent pass, which runs after
                the opaque pass. Paired with the top `renderOrder`, that means
                it lands on top of the opaque scene AND on top of every other
                transparent (the ink wash, the avatar's cut-out margin, the
                window glow) — all of which live at renderOrder 0.

                `premultipliedAlpha` is NOT optional: three's WebGLState only
                installs MultiplyBlending's blend func when it is set, and
                otherwise logs "MultiplyBlending requires
                material.premultipliedAlpha = true" and renders the quad
                OPAQUE — a full-screen flat rectangle, which is exactly what
                happened the first time. With it set the func is
                blendFuncSeparate(ZERO, SRC_COLOR, ZERO, SRC_ALPHA), so RGB
                becomes dst * tint and alpha is irrelevant to the colour.

                It writes no depth and tests none, so it can never occlude
                anything; and at day the tint is pure white, i.e. a no-op —
                which is why it can simply stay mounted and be lerped. */}
            <mesh renderOrder={999} frustumCulled={false} raycast={() => null}>
                <planeGeometry args={[2, 2]} />
                <shaderMaterial
                    vertexShader={VEIL_VERT}
                    fragmentShader={VEIL_FRAG}
                    uniforms={veilUniforms.current}
                    blending={THREE.MultiplyBlending}
                    premultipliedAlpha
                    transparent
                    depthTest={false}
                    depthWrite={false}
                />
            </mesh>
        </>
    )
}

export default SceneLighting
