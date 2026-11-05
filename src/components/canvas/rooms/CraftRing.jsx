import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

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
 * ── 进出场 ─────────────────────────────────────────────────────────────
 * 幕布（一层纯色正交覆盖屏）压在星云上面：进场 1→0（k=8，约 0.45s 落 3%），
 * 星空像从底色里浮出来，而不是"啪"地切过去。
 * 退场反过来：先画走廊，再把星云按 a² 溶掉（幕布此时不参与，否则会把
 * 已经亮起来的走廊又盖成纯色）。
 */

/** 底色。与 ring-gallery 的 `--bg` / body 兜底渐变同一个色，进场不会闪。 */
const BASE = 0x05070c

const VERT = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/* 逐字来自 public/demos/web3d/ring-gallery/index.html 的 FRAG。
   ⚠️ 改这里之前先看那张页面 —— 两边是同一个视觉，别各调各的。 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;

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

    gl_FragColor = vec4(col, 1.0);
}
`

/** 只在"真的进了房间"时挂载 —— 见文件头关于接管的说明。 */
function RingRenderer({ sceneRef, cameraRef, quadRef, fadeRef, exitingRef, dissolveRef }) {
    useFrame((state, delta) => {
        /* 🔴 用 `state.gl` 而不是 `useThree(s => s.gl)`：后者被 lint 判成
           "不可修改的值"（react-hooks/immutability），而这里要临时改 autoClear。 */
        const gl = state.gl
        const scene = sceneRef.current
        const cam = cameraRef.current
        const quad = quadRef.current
        if (!scene || !cam || !quad) {
            // 还没搭好：照常画主场景。直接 return 会把上一帧留在 framebuffer 上。
            state.gl.render(state.scene, state.camera)
            return
        }

        const d = Math.min(delta, 0.1)
        const mat = quad.material
        const fade = fadeRef.current

        mat.uniforms.uTime.value += d

        // 鼠标视差：慢速跟随，别跟着指针抖
        const mouse = mat.uniforms.uMouse.value
        const target = state.pointer
        mouse.x += (target.x - mouse.x) * 0.05
        mouse.y += (target.y - mouse.y) * 0.05

        /* 两条曲线都按帧时间归一，掉帧不会变慢：
           进场：幕布 1→0（k=8 ⇒ 0.45s 时约 3%）
           退场：星云 alpha 1→0（k=6.5 ⇒ 0.46s 到 95%）
           🔴 必须在**画之前**更新。放到另一个更高优先级的 useFrame 里会晚一帧，
              幕布收尾那一下会闪。 */
        if (exitingRef.current) {
            dissolveRef.current += (1 - dissolveRef.current) * (1 - Math.exp(-6.5 * d))
            const a = 1 - dissolveRef.current
            // a² 让内容先走、底色后走，观感是"一层墨被抹掉"而不是残影
            mat.opacity = a * a
            if (fade) fade.material.opacity = 0
            // three 的 WebGLBackground 只要 background 是 Color 就强制清屏
            // （不看 autoClear）⇒ 退场这一趟必须让开，否则走廊被纯色擦掉
            if (scene.background) scene.background = null
        } else if (fade) {
            fade.material.opacity += (0 - fade.material.opacity) * (1 - Math.exp(-8 * d))
            mat.opacity = 1
        }

        if (!exitingRef.current) {
            // ── 在房间里：整屏归星云，幕布压在最后 ──
            gl.render(scene, cam)
            if (fade && fade.material.opacity > 0.002) {
                const prev = gl.autoClear
                gl.autoClear = false
                gl.render(fade.scene, fade.camera)
                gl.autoClear = prev
            }
            return
        }

        // ── 退场：先把走廊画出来，再把星云整体溶掉叠在上面 ──────────
        gl.render(state.scene, state.camera)

        const prev = gl.autoClear
        gl.autoClear = false
        // 走廊那一趟把深度缓冲写满了；星云是满屏正交、本来就不测深度，
        // 但清一次更稳（和 CareerTunnel 同一条教训）。
        gl.clearDepth()
        gl.render(scene, cam)
        gl.autoClear = prev
    }, 1)

    return null
}

const CraftRing = ({ onReady, isExiting = false }) => {
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const quadRef = useRef(null)
    const fadeRef = useRef(null)
    /* 幕布与星云的透明度都靠帧循环推，用 ref 转一道 —— 免得 isExiting 一变
       整个场景重建。 */
    const exitingRef = useRef(isExiting)
    const dissolveRef = useRef(0)
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
                uTime: { value: 0 },
                uMouse: { value: new THREE.Vector2(0, 0) },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
        quad.position.z = -0.5
        quad.frustumCulled = false
        scene.add(quad)

        // 幕布：一层纯色，进场时压在星云上面淡出
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
            dissolveRef.current = 0
        }
    }, [onReady])

    // 尺寸：uRes 用**绘制缓冲**尺寸（不是 CSS 像素），否则 2x 屏上星点是虚的
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

    /* 场景还没搭好时 RingRenderer 会照常画主场景（它自己判 null），
       所以这里不需要"搭好才挂载" —— 少一个 state 就少一轮渲染。 */
    return (
        <RingRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            fadeRef={fadeRef}
            exitingRef={exitingRef}
            dissolveRef={dissolveRef}
        />
    )
}

export default CraftRing
