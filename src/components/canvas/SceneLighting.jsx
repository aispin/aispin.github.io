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
/* 走（否则走两步天空就歪了）、`depthWrite: false` + `renderOrder -1000` */
/* （永远最先画、且不写深度）。⚠️ 夜间的 veil 在 renderOrder 999，会把  */
/* 它一起乘 —— 和以前 `scene.background` 的待遇一致，不用额外处理。     */
/* ------------------------------------------------------------------ */

const SKY_RADIUS_SCALE = 0.92;

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
    uniform vec3 uSunDir;
    uniform float uGlowAmt;
    varying vec3 vDir;

    void main() {
        float h = vDir.y;

        // 天顶 → 地平线。「-0.06」而不是 0：让「就贴着地平线的那一圈」也已经
        // 是雾色，和地面完全化雾的那一段对齐。
        float t = smoothstep(-0.06, 0.55, h);
        vec3 c = mix(uHorizon, uZenith, t);

        // 太阳方位的地平线暖晕：一条很淡的横向亮带，只在太阳那一侧。
        // ⚠️ 变量名**不能叫 flat** —— three 在 WebGL2 下按 GLSL ES 3.00 编译，
        //    而「flat」在那里是**插值限定符关键字**，会报「'flat' : syntax error」
        //    并且整个 fragment shader 都不编译（背景直接退回 scene.background）。
        vec2 flatDir = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5);
        float d = max(dot(normalize(vec2(vDir.x, vDir.z) + 1e-5), flatDir), 0.0);
        c += uGlow * uGlowAmt * pow(d, 3.0) * smoothstep(0.42, -0.02, h);

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
        uSunDir: { value: new THREE.Vector3(5, 8.5, 5).normalize() },
        uGlowAmt: { value: 0.12 },
    })
    // 每帧复用的临时量（不分配）
    const sunScratch = useRef(new THREE.Vector3())

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

    useFrame((_, delta) => {
        // 🔴 穹顶跟相机走这一步**必须在下面那个"已稳定就 return"之前** ——
        //    否则每次昼夜过渡结束后天空就冻在最后一次的位置上，相机一走
        //    它就歪。
        if (skyRef.current) skyRef.current.position.copy(camera.position)

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

        // --- background + fog (owned here, see the header) ---
        sky.current.copy(D.sky).lerp(N.sky, k)
        scene.background = sky.current

        if (scene.fog) {
            scene.fog.color.copy(D.haze).lerp(N.haze, k)
            scene.fog.near = lerp(D.fogNear, N.fogNear, k)
            scene.fog.far = lerp(D.fogFar, N.fogFar, k)
        }
        /* eslint-enable react-hooks/immutability */

        // --- 天空穹顶 ---
        // ⚠️ 三个都要过 `toShaderColor`：先在线性空间插值（那是物理上对的），
        //    再转成屏幕值 —— 否则天会明显更暗更橙（见 `config/theme.js`）。
        const S = skyUniforms.current
        toShaderColor(S.uZenith.value.copy(D.sky).lerp(N.sky, k), S.uZenith.value)
        toShaderColor(S.uHorizon.value.copy(D.haze).lerp(N.haze, k), S.uHorizon.value)
        toShaderColor(S.uGlow.value.copy(D.key).lerp(N.key, k), S.uGlow.value)
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
                自动包围球会在搬之前把它剔掉。 */}
            <mesh ref={skyRef} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
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
