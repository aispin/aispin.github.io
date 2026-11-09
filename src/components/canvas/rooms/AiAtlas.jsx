import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useScene } from '../../../context/SceneContext'
import { useSitePreferences } from '../../../context/SitePreferences'
import { reducedMotion } from '../../../hooks/useReducedMotion'
import { atlasStage, resetAtlasStage } from '../../../state/aiAtlas'
import { hash32, mulberry32 } from '../../../utils/atlasArt'
import {
    createScreenQuad,
    drawTakeover,
    ensureQuadResolution,
    useDrawingBufferSize,
    useTakeoverStage,
} from './takeover'

/**
 * AI 房间 —— 「图鉴 · ATLAS」的**环境层**。
 *
 * 卡片墙、HUD、iframe 浮层全是 DOM（`ui/AiAtlasHud.jsx`），这里只做两件事：
 *   1. 画那块冷黑底（竖向底色 + 一团跟着 hover 换色的冷光 + 暗角 + 颗粒），
 *      逐字对齐 `public/demos/web3d/ai-atlas/index.html` 的 FS。
 *   2. 撒一层**慢慢飘的尘**（点云），替掉更早那版 `sin(p.y*420)` 的横向扫描线
 *      （用户 2026-11-09：「把卡片后面的条纹背景改成之前那个版本的粒子飘动背景」）。
 *   3. **接管渲染**，让走廊那套房子/树/天空在房间里一帧都不画。
 *
 * ── 为什么背景在 WebGL，卡片在 DOM ──────────────────────────────────
 * 24 张卡要的是**文字清晰 + 点击命中**，这正是 DOM 的强项；用 three 就得把每张
 * 卡光栅化成纹理（字发虚、DPR 难对齐、点击要自己做拾取），换来的只是一个 CSS
 * 本来就能算的透视。所以分工是：几何交给 CSS，光交给 WebGL。
 *
 * ── 为什么粒子也在 WebGL ────────────────────────────────────────────
 * 原型里它就是 WebGL 点云（2400 点）。搬成 DOM canvas 会多一张满屏 canvas 每帧
 * 重绘，而且**拿不到同一份 dpr / 同一条时间轴**（滚动、指针都要从 HUD 传进来，
 * 那就已经是跨层了）。放在这里则与底色共用一次 `gl.render`，一个 draw call。
 *
 * 🔴 尘的颜色/混合模式跟主题走：深色 additive（点是光），浅色 normal（点是纸上
 *    的墨）。additive 在奶油纸上会直接烧白，不能一套用到底。
 *
 * ⚠️ `useFrame(cb, 1)` 一旦注册，R3F 就不再自动渲染主场景。所以接管放在子组件
 *    `AtlasRenderer` 里，且只在真正进房间时挂载 —— 预热副本绝不能挂第二份
 *    （`RoomWarmup` 里挂的是 videos，见那边的注释）。
 *
 * ── 进场 / 退场 ───────────────────────────────────────────────────────
 * 三段式节奏在 `./takeover`（四个接管房间共用一份）：先让门开完、相机飞一半，
 * 再把冷黑底叠上来。门后那间屋子的**壳**在 `RoomInterior` 里补了。
 */

/**
 * 逐字翻译 demo 的 FS。`uLight` 不是简单地反相 —— 浅色下"暗角"要改成极轻的
 * 压边（把整块压暗 82% 会变成一圈脏边），颗粒也要减半，否则纸上全是噪点。
 *
 * ⚠️ 这里**没有**横向扫描线。它曾经用来防 banding，2026-11-09 按用户要求换成
 *    飘尘（见下面的 `VS_DUST`）。防 banding 只靠颗粒。别把它加回来 ——
 *    两条叠在一起会打架。
 */
const FRAG_BG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uAccent;
uniform float uLight;
uniform float uOpacity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // 以屏幕短边归一：换分辨率时构图不变
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

    // 竖向底色：上浅下深的"房间"
    vec3 cA = mix(vec3(0.020, 0.026, 0.037), vec3(0.969, 0.929, 0.871), uLight);
    vec3 cB = mix(vec3(0.008, 0.011, 0.017), vec3(0.937, 0.882, 0.796), uLight);
    vec3 col = mix(cA, cB, smoothstep(-0.55, 0.62, p.y));

    // 一团冷光：位置跟着视口中心偏上，卡片 hover 时换色
    float d = length(p * vec2(0.82, 1.0) - vec2(0.0, 0.06));
    col += uAccent * mix(0.085, 0.055, uLight) * smoothstep(0.95, 0.0, d);
    col += uAccent * mix(0.050, 0.035, uLight) * smoothstep(0.42, 0.0, length(p - vec2(0.0, 0.14)));

    // 暗角
    col *= 1.0 - smoothstep(0.5, 1.3, length(p)) * mix(0.82, 0.13, uLight);

    // 颗粒（兼防 banding）
    col += (hash(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * mix(0.012, 0.008, uLight);

    gl_FragColor = vec4(col, uOpacity);
}
`

/**
 * 飘尘的顶点着色器。配方取自 `ai-symbiosis` 的浮尘（`VS_DOT` 的 uKind===1 分支）：
 * 每个点自己的相位闪烁、近大远小、按深度吃视差。
 *
 * 区别是这里**不做 3D 相机**：点铺在一个"屏高 = 1"的平面上（和背景着色器的 p
 * 同一套坐标），只留一个 depth 做假透视 —— 卡片墙是平的，粒子要是真立体反而会
 * 跟墙打架。
 *
 * 环绕用 mod：折返点都落在视口外（x 折 ±0.60·aspect、y 折 ±0.56，可见区只有
 * ±0.5），所以看不见"跳"。滚动时整层按 0.00022/px 上移（比卡片慢 ⇒ 在卡片后面）。
 *
 * ⚠️ `position` 是 three 给 ShaderMaterial 自动声明的（`x, y, depth`），
 *    不要在这里再写一遍 `attribute vec3 position;` —— 重复声明会编译失败。
 */
const VERT_DUST = `
precision highp float;
attribute vec2 aRnd;
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform float uPx;
uniform vec2 uPtr;
varying float vA;

void main() {
    float aspect = uRes.x / max(uRes.y, 1.0);
    float depth = position.z;            // 0 近 · 1 远
    float near = 1.0 - depth;

    // 每个点自己的漂移速度：近的快（视差），方向各不相同
    float vx = 0.010 + aRnd.x * 0.020;
    float vy = 0.006 + aRnd.y * 0.014;

    // position.xy 是"占视口的比例"：x∈[-0.5,0.5] 乘 aspect 正好铺满一屏
    float x = position.x * aspect + uTime * vx + uPtr.x * 0.030 * (0.25 + near);
    float y = position.y - uTime * vy + uScroll * 0.00022 * (0.2 + near) - uPtr.y * 0.018 * (0.25 + near);

    float xw = aspect * 0.60;
    float yw = 0.56;
    x = mod(x + xw, xw * 2.0) - xw;
    y = mod(y + yw, yw * 2.0) - yw;

    gl_Position = vec4(x / (aspect * 0.5), y / 0.5, 0.0, 1.0);

    float scale = 0.45 + near * 0.55;
    gl_PointSize = (1.6 + aRnd.y * 3.0) * scale * uPx;

    // 闪 + 边缘衰减（边缘衰减是为了不让人看见"点从边上冒出来"）
    float flick = 0.60 + 0.40 * sin(uTime * (0.7 + aRnd.x * 2.2) + aRnd.y * 41.0);
    float ex = 1.0 - smoothstep(xw * 0.75, xw, abs(x));
    float ey = 1.0 - smoothstep(yw * 0.72, yw, abs(y));
    vA = (0.16 + 0.78 * pow(near, 1.4)) * flick * ex * ey;
}
`

const FRAG_DUST = `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;

void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = pow(1.0 - smoothstep(0.0, 0.5, d), 2.2);
    gl_FragColor = vec4(uColor, a * vA * uOpacity);
}
`

/** 点云上限。桌面 1440×900 算下来会顶到上限，手机约 2200 —— 都在这个数里。 */
const DUST_MAX = 2400

/** 每个点的种子：位置全部由种子算死，不随视口重排（resize 只改 uRes）。 */
function makeDustGeometry() {
    const geometry = new THREE.BufferGeometry()
    const pos = new Float32Array(DUST_MAX * 3)
    const rnd = new Float32Array(DUST_MAX * 2)
    /* 和原型同一套种子（`mulberry32(hash32('atlas|dust'))`），所以同一张卡
       后面的尘和 demo 里逐点一致。 */
    const next = mulberry32(hash32('atlas|dust'))
    for (let i = 0; i < DUST_MAX; i += 1) {
        pos[i * 3 + 0] = next() - 0.5
        pos[i * 3 + 1] = next() - 0.5
        pos[i * 3 + 2] = next()
        rnd[i * 2 + 0] = next()
        rnd[i * 2 + 1] = next()
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 2))
    geometry.setDrawRange(0, DUST_MAX)
    return geometry
}

/**
 * 粒子颜色：深色把卡片色相往白里提一点（additive 下才亮得起来），
 * 浅色往墨里压（normal 混合，点是纸上的墨）。
 */
function dustColor(acc, light) {
    return light
        ? [acc[0] * 0.42 + 0.03, acc[1] * 0.42 + 0.02, acc[2] * 0.42 + 0.02]
        : [acc[0] + (1 - acc[0]) * 0.45, acc[1] + (1 - acc[1]) * 0.45, acc[2] + (1 - acc[2]) * 0.45]
}

function AtlasRenderer({ sceneRef, cameraRef, quadRef, dustRef, stage }) {
    const { theme } = useSitePreferences()
    const lightRef = useRef(theme === 'light')
    useEffect(() => { lightRef.current = theme === 'light' }, [theme])

    /** 着色器自己的时钟。不用 `state.clock` —— 那一个从页面加载起算，
        飘尘的相位会随"用户什么时候进来"变；这里从挂载起算，进场第一帧就是 0。 */
    const tRef = useRef(0)

    useFrame((state, delta) => {
        /* 用 `state.gl` 而不是 `useThree(s => s.gl)`：后者被 lint 判成
           "不可修改的值"，而 `drawTakeover` 要临时改 autoClear。 */
        const gl = state.gl
        const scene = sceneRef.current
        const cam = cameraRef.current
        const quad = quadRef.current
        const dust = dustRef.current
        if (!scene || !cam || !quad) {
            // 还没搭好：照常画主场景。直接 return 会把上一帧留在 framebuffer 上。
            gl.render(state.scene, state.camera)
            return
        }

        const dt = Math.min(delta, 0.1)
        ensureQuadResolution(gl, quad.material)
        const alpha = stage.advance(dt)

        const res = quad.material.uniforms.uRes.value
        const light = lightRef.current
        const still = reducedMotion()
        /* reduced-motion：整层钉住不动（不漂、不闪），但仍然看得见。
           `uTime = 0` 而不是 `+= 0` —— 后者每帧还在累加，只是不画。 */
        tRef.current = still ? 0 : tRef.current + dt

        const bu = quad.material.uniforms
        bu.uOpacity.value = alpha
        bu.uTime.value = tRef.current
        bu.uLight.value = light ? 1 : 0
        bu.uAccent.value.set(atlasStage.accent[0], atlasStage.accent[1], atlasStage.accent[2])

        if (dust) {
            const du = dust.material.uniforms
            if (du.uRes.value.x !== res.x || du.uRes.value.y !== res.y) {
                du.uRes.value.copy(res)
                /* 点数按面积给：手机上 500 出头就够，桌面给满。用**绘制缓冲**
                   尺寸（不是 CSS 像素），否则 2x 屏上密度只有一半。 */
                const n = Math.max(260, Math.min(DUST_MAX, Math.round((res.x * res.y) / 600)))
                dust.geometry.setDrawRange(0, n)
            }
            const col = dustColor(atlasStage.accent, light)
            du.uColor.value.set(col[0], col[1], col[2])
            du.uTime.value = tRef.current
            du.uScroll.value = atlasStage.scroll
            du.uPtr.value.set(atlasStage.px, atlasStage.py)
            du.uPx.value = gl.getPixelRatio()
            du.uOpacity.value = alpha
            /* 混合模式跟主题走。`blending` 只是渲染状态（不进 program），
               但也没必要每帧写一次 —— 只在真的变了的时候写。 */
            const want = light ? THREE.NormalBlending : THREE.AdditiveBlending
            if (dust.material.blending !== want) dust.material.blending = want
        }

        drawTakeover(gl, state, { scene, camera: cam, alpha })
    }, 1)

    return null
}

const AiAtlas = ({ onReady, isExiting = false }) => {
    const { currentRoom, isTeleporting } = useScene()
    const quadRef = useRef(null)
    const dustRef = useRef(null)
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    /* 正常从走廊推门进来时 `currentRoom` 还是 null ⇒ 要等门开；
       传送 / 深链 / 探针 snap 时门是瞬开的 ⇒ 不等。 */
    const stage = useTakeoverStage({
        isExiting,
        skipEntry: Boolean(isTeleporting) || currentRoom === 'ai',
    })
    const readySent = useRef(false)

    useEffect(() => {
        /* 上一轮退出时可能 hover 在 07 号卡上 —— 不清的话这间房一开门就是
           那个色相的冷光，像"还没进来就已经在跟某张卡互动"。 */
        resetAtlasStage()

        const screen = createScreenQuad({
            fragmentShader: FRAG_BG,
            /* ⚠️ 这三个必须在**建 quad 的时候**就给：`createScreenQuad` 只自带
               `uRes` / `uOpacity`，帧循环里 `uniforms.uTime.value` 撞上
               undefined 会抛 "Cannot set properties of undefined"（整间房黑屏）。
               `uAccent` 用 Vector3 而不是 Color —— three 的 vec3 uniform 读
               `v.x/v.y/v.z`，Color 只有 `r/g/b`，传进去会变成 NaN。 */
            uniforms: {
                uTime: { value: 0 },
                uAccent: { value: new THREE.Vector3(0.36, 0.94, 0.78) },
                uLight: { value: 0 },
            },
        })
        sceneRef.current = screen.scene
        cameraRef.current = screen.camera
        quadRef.current = screen.quad

        const geometry = makeDustGeometry()
        const material = new THREE.ShaderMaterial({
            vertexShader: VERT_DUST,
            fragmentShader: FRAG_DUST,
            uniforms: {
                uRes: { value: new THREE.Vector2(1, 1) },
                uTime: { value: 0 },
                uScroll: { value: 0 },
                uPx: { value: 1 },
                uPtr: { value: new THREE.Vector2(0, 0) },
                /* 同上：vec3 uniform 要 Vector3，`Color.set(r,g,b)` 是**没有**的
                   （Color.set 只吃 Color / 字符串 / 十六进制数）。 */
                uColor: { value: new THREE.Vector3(1, 1, 1) },
                uOpacity: { value: 0 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
        const points = new THREE.Points(geometry, material)
        points.frustumCulled = false
        /* 底先画、尘后画。两块都是 transparent ⇒ three 本来也会按 renderOrder
           升序排，但显式写死，免得以后有人往这个 scene 里加东西时顺序漂。 */
        screen.quad.renderOrder = 0
        points.renderOrder = 1
        screen.scene.add(points)
        dustRef.current = points

        if (!readySent.current) {
            readySent.current = true
            // 着色器编译是同步的，这一帧就能画 —— 门可以开了
            onReady?.()
        }

        return () => {
            screen.scene.remove(points)
            geometry.dispose()
            material.dispose()
            screen.dispose()
            sceneRef.current = null
            cameraRef.current = null
            quadRef.current = null
            dustRef.current = null
        }
    }, [onReady])

    useDrawingBufferSize(quadRef)

    return (
        <AtlasRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            dustRef={dustRef}
            stage={stage}
        />
    )
}

export default AiAtlas
