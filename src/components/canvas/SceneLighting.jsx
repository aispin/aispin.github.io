import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { unmultiplyVeil } from '../../config/theme'
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
 * 之所以能这么省，是因为季节在一次会话内**恒定**（`useSeason()` 每挂载解析
 * 一次，与门联同理）。所以不需要第二级缓动；将来若要加季节切换 UI，
 * 这里才要升级成双线性插值（季节轴 × 昼夜轴）。现在不做，是刻意不留死代码。
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

    const veilUniforms = useRef({ uTint: { value: new THREE.Color(1, 1, 1) } })

    // 0 = full day, 1 = full night. -1 means "nothing written yet": the first
    // frame snaps straight to the current theme rather than fading in from
    // daylight, so a page opened in dark mode is dark on frame one.
    const t = useRef(-1)

    useFrame((_, delta) => {
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
