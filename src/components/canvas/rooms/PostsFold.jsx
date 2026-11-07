import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useScene } from '../../../context/SceneContext'
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
 * ── 进场：先让门开完，再暗下来 ────────────────────────────────────────
 * 🔴 2026-11-07 用户报「点房门没有开门的效果了」。原因是接管层在
 *    `shouldRenderRoom` 一翻真（相机刚对准门）就把满屏暖黑压上去了 ——
 *    门扇转开 0.7s、相机穿过门厅 1.5s，全被盖在黑底下，看起来像"点一下
 *    就跳进房间"。摄影房间（gallery）没这问题，因为它的屋子就在走廊场景里。
 *
 * 现在的节奏和 `DoorSection.openDoor()` 对齐：
 *   · `0 → ENTRY_HOLD`：**只画走廊**（门扇在转、相机在飞），
 *   · `ENTRY_HOLD → +ENTRY_FADE`：先画走廊，再把暖黑底按 alpha 叠上去，
 *   · 之后：只画房间。
 * 门后那间屋子的**壳**在 `RoomInterior` 里补了（暖黑色，见那边的注释），
 * 所以穿门那一下看到的是"一间暗屋"，而不是一片天空。
 *
 * 传送（地图 / 深链）和探针 `snap` 走的是瞬开门，等 1.35s 只会让人盯着
 * 走廊发呆 ⇒ 这两条路径 `skipEntry`，第一帧就是房间。
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

/**
 * 进场：门扇 0.7s + 相机穿过门厅 1.5s。按住 1.35s（= 门开完 + 飞了一半）
 * 再花 1.0s 把暖黑底叠上来，正好落在相机落地（2.2s）前后 ——
 * 于是"跨过门槛的同时灯暗下来"，而不是"站在门口先黑一下"。
 */
const ENTRY_HOLD = 1.35
const ENTRY_FADE = 1.0

/**
 * 退场：先**按住** `EXIT_HOLD`，再用 `EXIT_FADE` 把暖黑底抹掉。
 *
 * ⚠️ 这两个数和 `DoorSection.exitRoom()` 的 1.5s（退回门前）+ 1.0s（退回原位）
 *    + 0.6s（关门）是一套的。改那边要回来对一眼。
 */
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

const smooth = (t) => t * t * (3 - 2 * t)

function FoldRenderer({ sceneRef, cameraRef, quadRef, exitingRef, exitElapsedRef, entryRef, entryElapsedRef }) {
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

        /* 尺寸兜底：`uRes` 初值是 1×1，正常由那个 resize effect 同步。
           万一第一帧抢在 effect 前面（传送/深链时 alpha 直接是 1），
           这一帧就会用 1×1 算渐变 ⇒ 整屏一个色。 */
        if (mat.uniforms.uRes.value.x < 2) gl.getDrawingBufferSize(mat.uniforms.uRes.value)

        /* `prefers-reduced-motion` 下 DoorSection 把整段动画缩到 0.12×，
           这边必须跟着缩，否则门早就开完了、暖黑底还在原地等着。 */
        const k = reducedMotion() ? 0.12 : 1

        if (exitingRef.current) {
            exitElapsedRef.current += d
            const t = Math.min(Math.max((exitElapsedRef.current - EXIT_HOLD * k) / (EXIT_FADE * k), 0), 1)
            /* `Math.min` 而不是直接赋值：万一进场还没走完就点了返回
               （uOpacity 才 0.3），直接写 1 会先"闪"一下全黑再开始退。
               取小值 ⇒ 从当前那个透明度接着往下走。 */
            mat.uniforms.uOpacity.value = Math.min(mat.uniforms.uOpacity.value, 1 - smooth(t))
        } else if (entryRef.current.skip) {
            // 传送 / 探针：门是瞬开的，第一帧就该是房间
            mat.uniforms.uOpacity.value = 1
        } else {
            entryElapsedRef.current += d
            const t = Math.min(Math.max((entryElapsedRef.current - ENTRY_HOLD * k) / (ENTRY_FADE * k), 0), 1)
            mat.uniforms.uOpacity.value = smooth(t)
        }

        const a = mat.uniforms.uOpacity.value

        // 完全不透明：只画房间（稳态走的就是这条，最便宜）
        if (a >= 0.999) {
            gl.render(scene, cam)
            return
        }

        // 半透明 / 全透明：先画走廊（门、相机、屋子都在那儿），再叠房间
        gl.render(state.scene, state.camera)
        if (a <= 0.002) return

        const prev = gl.autoClear
        gl.autoClear = false
        gl.clearDepth()
        gl.render(scene, cam)
        gl.autoClear = prev
    }, 1)

    return null
}

const PostsFold = ({ onReady, isExiting = false }) => {
    const { currentRoom, isTeleporting } = useScene()
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const quadRef = useRef(null)
    /* 两个计时器都靠帧循环推，用 ref 转一道 —— 免得状态一变整个场景重建。
       `exitElapsedRef` / `entryElapsedRef` 存的是**已经跑了多少秒**（不是
       0~1 的进度），因为两头都要"先按住再抹"。 */
    const exitingRef = useRef(isExiting)
    const exitElapsedRef = useRef(0)
    const entryElapsedRef = useRef(0)
    /* 只在挂载那一帧决定一次（`useRef` 的初值就是这么用的）：
       正常从走廊推门进来时 `currentRoom` 还是 null ⇒ 要等门开；
       传送 / 深链 / 探针 snap 时门是瞬开的 ⇒ 不等。 */
    const entryRef = useRef({ skip: Boolean(isTeleporting) || currentRoom === 'posts' })
    const readySent = useRef(false)

    useEffect(() => { exitingRef.current = isExiting }, [isExiting])

    useEffect(() => {
        const scene = new THREE.Scene()
        /* 🔴 不设 `scene.background`：three 的 WebGLBackground 只要 background
           是 Color 就**强制清屏**（不看 autoClear），进场/退场那趟需要先画
           走廊再叠房间，一清就把走廊擦掉了。满屏 quad 自己就是背景。 */
        scene.background = null

        // 满屏正交相机 + 2×2 平面：gl_FragCoord 与屏幕像素一一对应
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const material = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uRes: { value: new THREE.Vector2(1, 1) },
                uOpacity: { value: 0 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
        quad.position.z = -0.5
        quad.frustumCulled = false
        scene.add(quad)

        sceneRef.current = scene
        cameraRef.current = camera
        quadRef.current = quad

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
            sceneRef.current = null
            cameraRef.current = null
            quadRef.current = null
            exitElapsedRef.current = 0
            entryElapsedRef.current = 0
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
            exitingRef={exitingRef}
            exitElapsedRef={exitElapsedRef}
            entryRef={entryRef}
            entryElapsedRef={entryElapsedRef}
        />
    )
}

export default PostsFold
