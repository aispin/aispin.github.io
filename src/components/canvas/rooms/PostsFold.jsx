import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useScene } from '../../../context/SceneContext'
import {
    createScreenQuad,
    drawTakeover,
    ensureQuadResolution,
    useDrawingBufferSize,
    useTakeoverStage,
} from './takeover'

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
 * ── 进场 / 退场 ───────────────────────────────────────────────────────
 * 三段式节奏在 `./takeover`（三个接管房间共用一份）：先让门开完、相机飞
 * 一半，再把暖黑底叠上来。门后那间屋子的**壳**在 `RoomInterior` 里补了，
 * 所以穿门那一下看到的是"一间暗屋"，而不是一片天空。
 */

/**
 * 逐字翻译 demo 的 CSS 渐变（底色 #0b0908 与 demo 的 body 渐变末端同色，
 * 进场不会闪）：
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

function FoldRenderer({ sceneRef, cameraRef, quadRef, stage }) {
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

        ensureQuadResolution(gl, quad.material)
        const alpha = stage.advance(Math.min(delta, 0.1))
        quad.material.uniforms.uOpacity.value = alpha
        drawTakeover(gl, state, { scene, camera: cam, alpha })
    }, 1)

    return null
}

const PostsFold = ({ onReady, isExiting = false }) => {
    const { currentRoom, isTeleporting } = useScene()
    const quadRef = useRef(null)
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    /* 正常从走廊推门进来时 `currentRoom` 还是 null ⇒ 要等门开；
       传送 / 深链 / 探针 snap 时门是瞬开的 ⇒ 不等。 */
    const stage = useTakeoverStage({
        isExiting,
        skipEntry: Boolean(isTeleporting) || currentRoom === 'posts',
    })
    const readySent = useRef(false)

    useEffect(() => {
        const screen = createScreenQuad({ fragmentShader: FRAG })
        sceneRef.current = screen.scene
        cameraRef.current = screen.camera
        quadRef.current = screen.quad

        if (!readySent.current) {
            readySent.current = true
            // 着色器编译是同步的，这一帧就能画 —— 门可以开了
            onReady?.()
        }

        return () => {
            screen.dispose()
            sceneRef.current = null
            cameraRef.current = null
            quadRef.current = null
        }
    }, [onReady])

    useDrawingBufferSize(quadRef)

    return (
        <FoldRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            stage={stage}
        />
    )
}

export default PostsFold
