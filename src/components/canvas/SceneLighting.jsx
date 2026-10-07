import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { SCENE, LIGHTS, NIGHT, unmultiplyVeil } from '../../config/theme'
import { useSitePreferences } from '../../context/SitePreferences'

/**
 * SceneLighting — the whole scene's ambience in one place: background, fog, the
 * three-light rig and the night veil, cross-fading between the day palette and
 * NIGHT.
 *
 * WHY ONE COMPONENT OWNS ALL OF IT
 * --------------------------------
 * These are five separate scene properties, but night has to move them
 * *together* — a navy sky over a midday-lit wall reads as a bug, not as dusk.
 * Scattering them across App.jsx (background + fog) and Experience.jsx (lights)
 * would mean two effects racing on the same transition. Here it is one eased
 * scalar driving all of them.
 *
 * WHY NIGHT NEEDS A FULL-FRAME MULTIPLY AND NOT JUST DARKER LIGHTS
 * ---------------------------------------------------------------
 * See the long note on NIGHT in config/theme.js. Short version: 536 of 806
 * materials in this scene are unlit `MeshBasicMaterial`s painting baked canvas
 * art, and the facade is a `ShaderMaterial`. Dimming the rig leaves every one
 * of them untouched, so the site simply stayed daytime. The veil is the only
 * knob that reaches all three material kinds.
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

const DAY = {
    sky: new THREE.Color(SCENE.background),
    haze: new THREE.Color(SCENE.fogColor),
    ambient: new THREE.Color(LIGHTS.ambient.color),
    key: new THREE.Color(LIGHTS.key.color),
    fill: new THREE.Color(LIGHTS.fill.color),
    veil: new THREE.Color(1, 1, 1),
}

/** `scene.background` is multiplied by the veil afterwards, so the sky we
 *  actually want to see has to be un-multiplied first — otherwise it gets
 *  darkened twice and the horizon goes black. */
const NIGHT_SKY = new THREE.Color(unmultiplyVeil(NIGHT.sky, NIGHT.veil))
const NIGHT_HAZE = new THREE.Color(unmultiplyVeil(NIGHT.haze, NIGHT.veil))

const NIGHT_FROM = {
    sky: NIGHT_SKY,
    haze: NIGHT_HAZE,
    ambient: new THREE.Color(NIGHT.lights.ambient.color),
    key: new THREE.Color(NIGHT.lights.key.color),
    fill: new THREE.Color(NIGHT.lights.fill.color),
    veil: new THREE.Color(NIGHT.veil.r, NIGHT.veil.g, NIGHT.veil.b),
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

    const ambientRef = useRef()
    const keyRef = useRef()
    const fillRef = useRef()

    // A scratch colour reused every frame instead of allocating one per fade.
    const sky = useRef(new THREE.Color(SCENE.background))

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

        // Everything below writes straight into the three.js scene graph.
        // `react-hooks/immutability` flags that because `scene` comes out of a
        // hook — but the rule is about React state, and a scene graph is an
        // imperative object that exists precisely to be mutated. Routing it
        // through a ref would satisfy the linter while hiding what the code
        // does, so it is disabled here with the reason instead.
        /* eslint-disable react-hooks/immutability */

        // --- background + fog (owned here, see the header) ---
        sky.current.copy(DAY.sky).lerp(NIGHT_FROM.sky, k)
        scene.background = sky.current

        if (scene.fog) {
            scene.fog.color.copy(DAY.haze).lerp(NIGHT_FROM.haze, k)
            scene.fog.near = lerp(SCENE.fogNear, NIGHT.fogNear, k)
            scene.fog.far = lerp(SCENE.fogFar, NIGHT.fogFar, k)
        }
        /* eslint-enable react-hooks/immutability */

        // --- the veil ---
        veilUniforms.current.uTint.value.copy(DAY.veil).lerp(NIGHT_FROM.veil, k)

        // --- the rig ---
        const amb = ambientRef.current
        if (amb) {
            amb.color.copy(DAY.ambient).lerp(NIGHT_FROM.ambient, k)
            amb.intensity = lerp(LIGHTS.ambient.intensity, NIGHT.lights.ambient.intensity, k)
        }

        const key = keyRef.current
        if (key) {
            key.color.copy(DAY.key).lerp(NIGHT_FROM.key, k)
            key.intensity = lerp(LIGHTS.key.intensity, NIGHT.lights.key.intensity, k)
        }

        const fill = fillRef.current
        if (fill) {
            fill.color.copy(DAY.fill).lerp(NIGHT_FROM.fill, k)
            fill.intensity = lerp(LIGHTS.fill.intensity, NIGHT.lights.fill.intensity, k)
        }
    })

    return (
        <>
            {/* Fog is declared here rather than via App.jsx's old declarative
                <fog>, because this component resolves the theme on its first
                render — so the very first painted frame is already right. */}
            <fog attach="fog" args={[SCENE.fogColor, SCENE.fogNear, SCENE.fogFar]} />

            <ambientLight ref={ambientRef} color={LIGHTS.ambient.color} intensity={LIGHTS.ambient.intensity} />
            <directionalLight
                ref={keyRef}
                position={LIGHTS.key.position}
                intensity={LIGHTS.key.intensity}
                color={LIGHTS.key.color}
            />
            {!isLowTier && (
                <directionalLight
                    ref={fillRef}
                    position={LIGHTS.fill.position}
                    intensity={LIGHTS.fill.intensity}
                    color={LIGHTS.fill.color}
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
