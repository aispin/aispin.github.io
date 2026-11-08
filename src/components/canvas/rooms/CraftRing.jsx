import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useScene } from '../../../context/SceneContext'
import {
    createScreenQuad,
    drawTakeover,
    ensureQuadResolution,
    useDrawingBufferSize,
    useTakeoverStage,
} from './takeover'

/**
 * 创意实验房间 —— 「实验环」的**环境层**。
 *
 * 展板本身是 DOM（`ui/CraftHud.jsx`），这里只负责两件事：
 *   1. 把 `ring-gallery` 那张全屏 GLSL 星云（五倍频 fbm + 星点 + 环心冷光 +
 *      暗角）搬进主画布，着色器逐字照搬 —— 换配色仍然只改 FRAG 里三个 vec3。
 *   2. **接管渲染**，让走廊那套房子/树/天空在房间里一帧都不画。
 *
 * ── 为什么接管（和 `CareerTunnel` 同因，但结论更强） ────────────────────
 * 环是**满屏**的，DOM 层一旦不透明就把走廊整个盖住了。不接管的话，主场景
 * 每帧仍在满负荷渲染一栋没人看得见的房子 —— 纯白烧。接管之后每帧只有
 * 一次全屏 draw call。
 *
 * ⚠️ `useFrame(cb, 1)` 一旦注册，R3F 就不再自动渲染主场景。所以接管放在
 *    子组件 `RingRenderer` 里、且只在真正进房间时挂载 —— 预热副本绝不能
 *    挂第二份，两个接管会互相覆盖（`RoomWarmup` 里换成 posts 也是这个原因）。
 *
 * ── 进场 / 退场 ───────────────────────────────────────────────────────
 * 节奏在 `./takeover`（三个接管房间共用一份）。这一间**没有幕布**：星云
 * 自己就是满屏不透明的，`uOpacity` 从 0 升到 1 就等于"灯慢慢亮起来"，
 * 多铺一层纯色反而要在退场时把两层分开调度（旧版就是这么写的，两套曲线
 * 互相打架）。
 */

/* 逐字来自 public/demos/web3d/ring-gallery/index.html 的 FRAG。
   ⚠️ 改这里之前先看那张页面 —— 两边是同一个视觉，别各调各的。
   ⚠️ 唯一的改动是最后一行：`uOpacity` 乘进 alpha（进场淡入 / 退场淡出）。
   demo 那边是满屏不透明的背景，不需要这个 uniform。 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uOpacity;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    float t = uTime * 0.045;

    vec2 q = p * 1.35 + uMouse * 0.22;
    float n1 = fbm(q + vec2(t, -t * 0.65));
    float n2 = fbm(q * 2.05 - vec2(t * 0.8, t * 0.35));

    vec3 col = vec3(0.020, 0.027, 0.047);
    vec3 indigo = vec3(0.10, 0.16, 0.44);
    vec3 violet = vec3(0.30, 0.12, 0.46);

    col = mix(col, indigo, smoothstep(0.34, 0.96, n1) * 0.62);
    col = mix(col, violet, smoothstep(0.46, 1.02, n2) * 0.34);

    float core = 1.0 - smoothstep(0.0, 0.74, length(p - vec2(0.0, -0.02)));
    col += vec3(0.16, 0.22, 0.42) * core * core * 0.32;

    col *= 1.0 - smoothstep(0.30, 1.32, length(p)) * 0.88;

    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    float s = hash(cell);
    float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + s * 62.83);
    col += vec3(0.72, 0.80, 1.0) * smoothstep(0.9972, 1.0, s) * twinkle * 1.15;

    col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.006;

    /* 🔴 进场/退场必须靠 **uniform 乘进 alpha**，不能靠 material.opacity。
       ShaderMaterial 的 fragmentShader 是原样编译的，three 不会帮你把
       material.opacity 乘进 gl_FragColor —— 写死 1.0 的话，退场期间星云
       一直是不透明的，底下那趟走廊根本看不见，用户看到的是"点返回之后
       黑屏 4 秒，然后突然站在走廊里"。 */
    gl_FragColor = vec4(col, uOpacity);
}
`

/** 只在"真的进了房间"时挂载 —— 见文件头关于接管的说明。 */
function RingRenderer({ sceneRef, cameraRef, quadRef, stage }) {
    useFrame((state, delta) => {
        /* 🔴 用 `state.gl` 而不是 `useThree(s => s.gl)`：后者被 lint 判成
           "不可修改的值"（react-hooks/immutability），而这里要临时改 autoClear。 */
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

        mat.uniforms.uTime.value += d

        // 鼠标视差：慢速跟随，别跟着指针抖
        const mouse = mat.uniforms.uMouse.value
        const target = state.pointer
        mouse.x += (target.x - mouse.x) * 0.05
        mouse.y += (target.y - mouse.y) * 0.05

        /* 🔴 alpha 必须在**画之前**更新。放到另一个更高优先级的 useFrame 里
           会晚一帧，进场收尾那一下会闪。 */
        const alpha = stage.advance(d)
        mat.uniforms.uOpacity.value = alpha
        ensureQuadResolution(gl, mat)

        drawTakeover(gl, state, { scene, camera: cam, alpha })
    }, 1)

    return null
}

const CraftRing = ({ onReady, isExiting = false }) => {
    const { currentRoom, isTeleporting } = useScene()
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const quadRef = useRef(null)
    const stage = useTakeoverStage({
        isExiting,
        skipEntry: Boolean(isTeleporting) || currentRoom === 'craft',
    })
    const readySent = useRef(false)

    useEffect(() => {
        const screen = createScreenQuad({
            fragmentShader: FRAG,
            uniforms: {
                uTime: { value: 0 },
                uMouse: { value: new THREE.Vector2(0, 0) },
            },
        })
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

    /* 场景还没搭好时 RingRenderer 会照常画主场景（它自己判 null），
       所以这里不需要"搭好才挂载" —— 少一个 state 就少一轮渲染。 */
    return (
        <RingRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            stage={stage}
        />
    )
}

export default CraftRing
