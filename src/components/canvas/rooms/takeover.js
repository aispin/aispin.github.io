import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { reducedMotion } from '../../../hooks/useReducedMotion'

/**
 * 接管渲染房间的**公共件**：进场/退场节奏、全屏 quad、合成。
 *
 * `career` / `craft` / `posts` 三个房间都是「自带 Scene + Camera +
 * `useFrame(cb, 1)` 接管」的独立空间（见各自文件头）。它们踩的是同一个坑：
 *
 * ── 坑：满屏接管层把开门动画盖住了 ───────────────────────────────────
 * 接管层从第一帧就不透明 ⇒ 门扇转开 0.7s、相机穿过门厅 1.5s 全被盖在底下，
 * 用户看到的是"点一下就跳进房间"。2026-11-07 在 posts 上修好（三段式进场），
 * 2026-11-08 抽到这里，career / craft 同步。
 *
 * ── 唯一的量：alpha ──────────────────────────────────────────────────
 * `alpha = 1` 整屏是房间，`alpha = 0` 整屏是走廊。三段：
 *   · 进场 `0 → ENTRY_HOLD`：**只画走廊**（门在转、相机在飞），alpha 恒 0
 *   · 接着 `ENTRY_FADE`：房间按 alpha 叠上来（smoothstep，起手收尾都慢）
 *   · 退场 `0 → EXIT_HOLD` 按住，再用 `EXIT_FADE` 抹掉
 * 传送 / 深链 / 探针 `snap` 的门是瞬开的，等 1.35s 只会让人盯着走廊发呆
 * ⇒ `skipEntry`，第一帧 alpha 就是 1。
 *
 * 🔴 节奏必须和 `DoorSection` 对齐。`prefers-reduced-motion` 下那边把所有
 *    过场缩到 0.12×（`TRANSITION_SCALE`），这边不跟着缩的话，门早就开完了、
 *    房间还在原地等着 —— 于是又变回"站在门口干等一秒"。
 */

/**
 * 进场：门扇 0.7s + 相机穿过门厅 1.5s。按住 1.35s（= 门开完 + 飞了一半）
 * 再花 1.0s 把房间叠上来，正好落在相机落地（2.2s）前后 ——
 * 于是"跨过门槛的同时灯暗下来"，而不是"站在门口先黑一下"。
 */
const ENTRY_HOLD = 1.35
const ENTRY_FADE = 1.0

/**
 * 退场：先**按住** `EXIT_HOLD`，再用 `EXIT_FADE` 抹掉。
 * 按住那 0.45s 让"点了返回"立刻有反应（相机在底下开始往回走），抹完约
 * 2.2s —— 正好是门开始合上的时候，于是"门在身后关上"是看得见的。
 *
 * ⚠️ 这两个数和 `DoorSection.exitRoom()` 的 1.5s（退回门前）+ 1.0s（退回原位）
 *    + 0.6s（关门）是一套的。改那边要回来对一眼。
 */
const EXIT_HOLD = 0.45
const EXIT_FADE = 1.75

/** 起手慢、收尾慢、中段快 —— 叠得干净又不像"啪"地切。 */
const smooth = (t) => t * t * (3 - 2 * t)

/** 满屏正交相机的顶点着色器：`gl_FragCoord` 与屏幕像素一一对应。 */
const SCREEN_VERT = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/**
 * 一个房间的进场/退场时钟。
 *
 * ⚠️ 必须在**房间搭好之后**才开始调 `advance()`：它按帧累加，而 career 的
 *    场景要等字体就绪 + 8 张 canvas 光栅化（几百毫秒），`onReady`（门开）
 *    也在那一刻。若从挂载就开始计时，门还没开、房间已经淡进来一半了。
 *    各房间的渲染器都是"场景没搭好就早退"，所以只要把 `advance()` 放在
 *    那个 null 判断**之后**，时钟自然对齐门开。
 *
 * @param {object}  o
 * @param {boolean} o.isExiting  正在退场（`DoorSection` 的 isExiting）
 * @param {boolean} o.skipEntry  传送 / 深链 / 探针：门是瞬开的，第一帧就是房间
 */
export function useTakeoverStage({ isExiting, skipEntry }) {
    const exitingRef = useRef(isExiting)
    /* `skipEntry` 只在挂载那一帧决定一次（`useRef` 初值就是这么用的）：
       正常从走廊推门进来时 `currentRoom` 还是 null ⇒ 要等门开。 */
    const skipRef = useRef(Boolean(skipEntry))
    const alphaRef = useRef(skipEntry ? 1 : 0)
    /** 当前阶段已经跑了多少秒（不是 0~1 的进度）—— 两头都要"先按住再抹"。 */
    const elapsedRef = useRef(0)
    const modeRef = useRef(skipEntry ? 'hold' : 'enter')

    useEffect(() => { exitingRef.current = isExiting }, [isExiting])

    const advance = useCallback((delta) => {
        let mode = exitingRef.current ? 'exit' : (skipRef.current ? 'hold' : 'enter')
        /* 退场是**终态**：`DoorSection` 在退场结束那一帧把 `isExiting` 放掉
           并卸载房间，但万一顺序反了（先 false 再卸载），这里不能把房间重新
           淡回来 —— 那会在走廊上闪一下房间。 */
        if (modeRef.current === 'exit') mode = 'exit'
        if (mode !== modeRef.current) {
            // 进场 → 退场换的是另一套节奏，计时必须归零
            modeRef.current = mode
            elapsedRef.current = 0
        }
        if (mode === 'hold') {
            alphaRef.current = 1
            return 1
        }

        elapsedRef.current += delta
        const k = reducedMotion() ? 0.12 : 1
        const hold = (mode === 'exit' ? EXIT_HOLD : ENTRY_HOLD) * k
        const fade = (mode === 'exit' ? EXIT_FADE : ENTRY_FADE) * k
        const t = Math.min(Math.max((elapsedRef.current - hold) / fade, 0), 1)

        /* 退场取**小值**：万一进场还没走完就点了返回（alpha 才 0.3），
           直接写 `1 - smooth(t)` 会先"闪"一下全黑再开始退。取小值 ⇒ 从
           当前那个透明度接着往下走。 */
        alphaRef.current = mode === 'exit'
            ? Math.min(alphaRef.current, 1 - smooth(t))
            : smooth(t)
        return alphaRef.current
    }, [])

    return { advance }
}

/**
 * 全屏 quad（自带 Scene + 正交相机），`uRes` / `uOpacity` 两个 uniform 是
 * 三个房间的公共约定：
 *   · `uRes`     绘制缓冲尺寸，着色器拿它做"按屏幕短边归一"的构图
 *   · `uOpacity` 叠在 `gl_FragColor.a` 上 —— 🔴 **不能**用 `material.opacity`：
 *                ShaderMaterial 的 fragmentShader 是原样编译的，three 不会
 *                把 opacity 乘进去。
 */
export function createScreenQuad({ fragmentShader, uniforms = {} }) {
    const scene = new THREE.Scene()
    /* 🔴 不设 `scene.background`：three 的 WebGLBackground 只要 background
       是 Color 就**强制清屏**（不看 autoClear），过渡那趟需要先画走廊再叠
       房间，一清就把走廊擦掉了。满屏 quad 自己就是背景。 */
    scene.background = null

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const material = new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT,
        fragmentShader,
        uniforms: {
            uRes: { value: new THREE.Vector2(1, 1) },
            uOpacity: { value: 0 },
            ...uniforms,
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
    })

    // 2×2 平面：`gl_FragCoord` 与屏幕像素一一对应
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    // 正交相机 near=0 / far=1：摆 z=0 会正好落在近平面上被裁掉
    quad.position.z = -0.5
    quad.frustumCulled = false
    scene.add(quad)

    return {
        scene,
        camera,
        quad,
        material,
        dispose() {
            quad.geometry.dispose()
            material.dispose()
        },
    }
}

/**
 * 把 `uRes` 同步成**绘制缓冲**尺寸（不是 CSS 像素）。
 * 用 CSS 像素的话，2x 屏上渐变的过渡带会出色带、星点会发虚。
 *
 * ⚠️ 初值是 1×1，正常由这里同步；万一第一帧抢在 effect 前面（传送/深链时
 *    alpha 直接是 1），那一帧就会拿 1×1 算渐变 ⇒ 整屏一个色。所以渲染器里
 *    还有一条兜底（见 `ensureQuadResolution`）。
 */
export function useDrawingBufferSize(quadRef) {
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
    }, [gl, quadRef])
}

/** 上面那条兜底：`uRes` 还是初值时当场量一次。 */
export function ensureQuadResolution(gl, material) {
    if (material.uniforms.uRes.value.x < 2) gl.getDrawingBufferSize(material.uniforms.uRes.value)
}

/**
 * 一层纯色正交覆盖屏 —— **房间的底色**，只用于过渡。
 *
 * career 的隧道场景自带 `scene.background`（Color），而过渡期间那个属性必须
 * 让开（它会强制清屏、把走廊擦掉）⇒ 底色改由这块屏来给。它画在房间内容
 * **之前**，所以不遮卡片，位置等价于 `background`。
 */
export function createVeil(color) {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        // 🔴 和主场景的 ACES 色调映射脱钩：接管层的颜色不过色调映射，
        //    这块屏要是过了，同一个底色会暗一大截，接缝处闪一下。
        toneMapped: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.position.z = -0.5
    quad.frustumCulled = false
    scene.add(quad)

    return {
        scene,
        camera,
        material,
        dispose() {
            quad.geometry.dispose()
            material.dispose()
        },
    }
}

/**
 * 画一帧：走廊 →（幕布）→ 房间。
 *
 * @param {THREE.WebGLRenderer} gl
 * @param {object} state        R3F 的 useFrame state（主场景在 `state.scene`）
 * @param {object} room
 * @param {THREE.Scene}  room.scene
 * @param {THREE.Camera} room.camera
 * @param {number} room.alpha   0~1，见文件头
 * @param {object} [room.veil]  `createVeil()` 的返回值；房间自己铺满全屏时可省
 * @param {THREE.Color} [room.base] 稳态时要还给 `scene.background` 的底色
 */
export function drawTakeover(gl, state, { scene, camera, alpha, veil, base }) {
    // ── 稳态：整屏归房间，一趟就够（最便宜） ──────────────────────────
    if (alpha >= 0.999) {
        if (base && !scene.background) scene.background = base
        gl.render(scene, camera)
        return
    }

    /* 🔴 过渡期间房间的 `background` 必须让开 —— 见 `createScreenQuad` 里
       那条注释：Color 型的 background 不看 autoClear，直接清屏。 */
    if (scene.background) scene.background = null

    // 先画走廊（门在转、相机在飞、门后那间屋子壳都在那儿）
    gl.render(state.scene, state.camera)
    if (alpha <= 0.002) return

    const prev = gl.autoClear
    gl.autoClear = false
    /* 🔴 走廊那一趟把深度缓冲写满了。房间有自己的相机和世界坐标，接着用
       这份深度去测，卡片/网格会被走廊的墙和地面按错误的 z 剔掉。 */
    gl.clearDepth()
    if (veil) {
        veil.material.opacity = alpha
        gl.render(veil.scene, veil.camera)
    }
    gl.render(scene, camera)
    gl.autoClear = prev
}
