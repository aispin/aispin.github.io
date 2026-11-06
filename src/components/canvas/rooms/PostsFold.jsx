import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { reducedMotion } from '../../../hooks/useReducedMotion'

/**
 * 文稿房间 —— 「经折」的**环境层**。
 *
 * 折页、HUD、阅读层全是 DOM（`ui/PostsHud.jsx`），这里只做两件事：
 *   1. 画那张暖黑底（两团径向光 + 暗角），逐字对齐
 *      `public/demos/web3d/posts-fold/index.html` 里 body 的 CSS 渐变。
 *   2. **接管渲染**，让走廊那套房子/树/天空在房间里一帧都不画。
 *
 * ── 为什么接管 ────────────────────────────────────────────────────────
 * 和 `CraftRing` / `CareerTunnel` 同因：房间是满屏的，DOM 层一不透明就把
 * 走廊盖住了；不接管的话主场景每帧仍在满负荷渲染一栋没人看得见的房子。
 * 接管之后每帧只有一次全屏 draw call（比星云那间还便宜 —— 这里没有 fbm）。
 *
 * ⚠️ `useFrame(cb, 1)` 一旦注册，R3F 就不再自动渲染主场景。所以接管放在
 *    子组件 `FoldRenderer` 里，且只在真正进房间时挂载 —— 预热副本绝不能挂
 *    第二份（`RoomWarmup` 里挂的是 posts，见那边的注释）。
 *
 * ── 退场 ──────────────────────────────────────────────────────────────
 * 节奏与 `CraftRing` 完全一致（`EXIT_HOLD` / `EXIT_FADE`），因为它必须和
 * `DoorSection.exitRoom()` 的 1.5s + 1.0s + 0.6s 对上：按住 0.45s 让"点了
 * 返回"立刻有反应，抹完约 2.2s —— 正好是门开始合上的时候，于是"门在身后
 * 关上"是看得见的。
 *
 * 🔴 alpha 走 `uOpacity` uniform，不能用 `material.opacity`：ShaderMaterial
 *    的 fragmentShader 原样编译，three 不会把 opacity 乘进 gl_FragColor。
 *    （这条是 2026-11-06 在 craft 上踩出来的，别在新房间重犯。）
 */

/** 底色。与 demo 的 body 渐变末端同色，进场不会闪。 */
const BASE = 0x0b0908

const EXIT_HOLD = 0.45
const EXIT_FADE = 1.75

const VERT = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/**
 * 逐字翻译 demo 的 CSS 渐变：
 *   radial-gradient(60% 46% at 76% 58%, rgba(126,86,52,.13), transparent 70%)
 *   radial-gradient(1200px 820px at 26% 18%, #241d18, #171311 46%, #0b0908 100%)
 * 用两段 smoothstep 拼出"近处暖、远处黑"，再加一层暗角。
 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uOpacity;

void main() {
    // 以屏幕短边归一：换分辨率时构图不变
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    vec2 uv = gl_FragCoord.xy / uRes;          // 0..1，y 向上

    // ① 主光：26% 18%（CSS 的 y 向下，这里翻过来）
    vec2 c1 = vec2(0.26, 1.0 - 0.18);
    float d1 = length((uv - c1) * vec2(1.0, 1.15));
    vec3 col = mix(vec3(0.141, 0.114, 0.094), vec3(0.090, 0.075, 0.067), smoothstep(0.0, 0.46, d1));
    col = mix(col, vec3(0.043, 0.035, 0.031), smoothstep(0.46, 1.0, d1));

    // ② 次光：76% 58% 的暖棕，只加 13%
    vec2 c2 = vec2(0.76, 1.0 - 0.58);
    float d2 = length((uv - c2) * vec2(0.62, 0.46));
    col += vec3(0.49, 0.34, 0.20) * (1.0 - smoothstep(0.0, 0.70, d2)) * 0.13;

    // ③ 暗角
    float v = smoothstep(0.55, 1.25, length(p));
    col *= 1.0 - v * 0.45;

    gl_FragColor = vec4(col, uOpacity);
}
`

function FoldRenderer({ sceneRef, cameraRef, quadRef, fadeRef, exitingRef, exitElapsedRef }) {
    useFrame((state, delta) => {
        /* 用 `state.gl` 而不是 `useThree(s => s.gl)`：后者被 lint 判成
           "不可修改的值"，而这里要临时改 autoClear。 */
        const gl = state.gl
        const scene = sceneRef.current
        const cam = cameraRef.current
        const quad = quadRef.current
        if (!scene || !cam || !quad) {
            // 还没搭好：照常画主场景。直接 return 会把上一帧留在 framebuffer 上。
            gl.render(state.scene, state.camera)
            return
        }

        const d = Math.min(delta, 0.1)
        const mat = quad.material
        const fade = fadeRef.current

        if (exitingRef.current) {
            exitElapsedRef.current += d
            /* `prefers-reduced-motion` 下 DoorSection 把整段退场缩到 0.12×，
               这边必须跟着缩，否则门早就关完了、暖黑底还盖着走廊两秒。 */
            const k = reducedMotion() ? 0.12 : 1
            const t = Math.min(Math.max((exitElapsedRef.current - EXIT_HOLD * k) / (EXIT_FADE * k), 0), 1)
            mat.uniforms.uOpacity.value = 1 - t * t * (3 - 2 * t)
            if (fade) fade.material.opacity = 0
            // three 的 WebGLBackground 只要 background 是 Color 就强制清屏
            // （不看 autoClear）⇒ 退场这一趟必须让开，否则走廊被纯色擦掉
            if (scene.background) scene.background = null
        } else if (fade) {
            fade.material.opacity += (0 - fade.material.opacity) * (1 - Math.exp(-8 * d))
            mat.uniforms.uOpacity.value = 1
        }

        if (!exitingRef.current) {
            gl.render(scene, cam)
            if (fade && fade.material.opacity > 0.002) {
                const prev = gl.autoClear
                gl.autoClear = false
                gl.render(fade.scene, fade.camera)
                gl.autoClear = prev
            }
            return
        }

        // ── 退场：先画走廊，再把暖黑底整体溶掉 ──
        gl.render(state.scene, state.camera)
        if (mat.uniforms.uOpacity.value < 0.002) return

        const prev = gl.autoClear
        gl.autoClear = false
        gl.clearDepth()
        gl.render(scene, cam)
        gl.autoClear = prev
    }, 1)

    return null
}

const PostsFold = ({ onReady, isExiting = false }) => {
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const quadRef = useRef(null)
    const fadeRef = useRef(null)
    /* 幕布与底图的透明度都靠帧循环推，用 ref 转一道 —— 免得 isExiting 一变
       整个场景重建。`exitElapsedRef` 存的是**退场已经跑了多少秒**（不是 0~1
       的进度），因为退场要"先按住再抹"。 */
    const exitingRef = useRef(isExiting)
    const exitElapsedRef = useRef(0)
    const readySent = useRef(false)

    useEffect(() => { exitingRef.current = isExiting }, [isExiting])

    useEffect(() => {
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(BASE)

        // 满屏正交相机 + 2×2 平面：gl_FragCoord 与屏幕像素一一对应
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const material = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uRes: { value: new THREE.Vector2(1, 1) },
                uOpacity: { value: 1 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
        quad.position.z = -0.5
        quad.frustumCulled = false
        scene.add(quad)

        // 幕布：一层纯色，进场时压在底图上面淡出
        const fadeScene = new THREE.Scene()
        const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const fadeMaterial = new THREE.MeshBasicMaterial({
            color: BASE,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        })
        const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial)
        fadeQuad.position.z = -0.5
        fadeQuad.frustumCulled = false
        fadeScene.add(fadeQuad)

        sceneRef.current = scene
        cameraRef.current = camera
        quadRef.current = quad
        fadeRef.current = { scene: fadeScene, camera: fadeCamera, material: fadeMaterial }

        if (!readySent.current) {
            readySent.current = true
            // 着色器编译是同步的，这一帧就能画 —— 门可以开了
            onReady?.()
        }

        return () => {
            scene.traverse((o) => {
                if (o.geometry) o.geometry.dispose()
                if (o.material) o.material.dispose()
            })
            fadeQuad.geometry.dispose()
            fadeMaterial.dispose()
            sceneRef.current = null
            cameraRef.current = null
            quadRef.current = null
            fadeRef.current = null
            exitElapsedRef.current = 0
        }
    }, [onReady])

    // 尺寸：uRes 用**绘制缓冲**尺寸（不是 CSS 像素），否则 2x 屏上渐变的
    // 过渡带会出现明显的色带
    const gl = useThree((s) => s.gl)
    useEffect(() => {
        const quad = quadRef.current
        if (!quad) return undefined
        const sync = () => {
            const size = new THREE.Vector2()
            gl.getDrawingBufferSize(size)
            quad.material.uniforms.uRes.value.copy(size)
        }
        sync()
        window.addEventListener('resize', sync)
        return () => window.removeEventListener('resize', sync)
    }, [gl])

    return (
        <FoldRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            fadeRef={fadeRef}
            exitingRef={exitingRef}
            exitElapsedRef={exitElapsedRef}
        />
    )
}

export default PostsFold
