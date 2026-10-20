import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSitePreferences } from '../../../context/SitePreferences'
import { useScene } from '../../../context/SceneContext'
import { usePerformance } from '../../../context/PerformanceContext'
import { getLocalizedCollection } from '../../../hooks/useContentData'
import { ensureFontsReady, texturalCanvas } from '../../../utils/texturalArt'
import { setTunnelArmed, setTunnelCount, setTunnelProgress, tunnelRequest, tunnelCardZ, tunnelTargetZ, TUNNEL_SPACING, TUNNEL_CAM_OFFSET, TUNNEL_MOUTH_Z, TUNNEL_ENTRY_Z } from '../../../state/careerTunnel'

/**
 * 履历房间 —— 「时空隧道」。
 *
 * 这是 `public/demos/web3d/career/index.html` 那套东西的移植，不是"参考它的配色"：
 * 卡片沿螺旋排进一条深空隧道，滚动＝在时间里穿行。原来那个 4×2 贴墙网格
 * 与它是两种空间，用户 2026-10-20 明确要的是这一种。
 *
 * ── 为什么要**接管渲染**，而不是把这堆东西塞进主场景 ────────────────────
 * 主场景结尾有一个全屏乘性夜幕（`SceneLighting` 的 uTint，renderOrder 999）。
 * 任何画在它之前的像素都会被乘暗：深空会被压成黑，卡片会按季节/昼夜变暗，
 * 而"太空"不该有白天和夜晚。接管渲染 = 在夜幕之后另起一趟，隧道因此
 * **昼夜/季节完全恒定**，也不需要为 veil 做任何补偿。
 *
 * ⚠️ `useFrame(cb, 1)` 一旦注册，R3F 就**不再**自动渲染主场景。所以接管
 *    放在子组件 `TunnelRenderer` 里、且只在真正进房间时挂载 —— 预热副本
 *    （`RoomWarmup` 会挂一份）绝不能注册它，否则两份接管互相覆盖。
 */

/* 与 demo 逐字相同的一几何组数（世界单位）。改这几个数要重新看螺旋是否咬合。
   `SPACING` / 卡片 z / 相机落点由 state/careerTunnel 统一提供 —— HUD 的
   时间刻度也要算同一个位置。 */
const CARD_W = 3.4
const CARD_H = 4.8
const RADIUS = 3.2
const TURN = 1.15 // 每张卡转过的弧度

const FOG_COLOR = 0x06070c

/* 贴图尺寸按档位分：8 张 680×960 的 canvas 在 LOW 档是纯浪费。
   🔴 canvas 是**惰性光栅化**的，真正的成本在第一次读像素/上传时（§42）。 */
const TEX = {
    HIGH: { w: 680, h: 960 },
    MEDIUM: { w: 560, h: 790 },
    LOW: { w: 440, h: 620 },
}

const hash32 = (s) => {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619) >>> 0
    }
    return h >>> 0
}

/* demo 的每张卡手写了一条风格：单字（创/淘/微/浙）、色相、模式、模糊、字阶。
   这里改成按序循环 —— 数据是 8 条履历，手写 8 条不值当，但**不能让八张
   看起来是同一张的复制品**，所以模式轮转、色相按黄金角散开。 */
const CARD_MODES = ['tile', 'flow', 'tile', 'hero']

function cardStyleFor(item, i) {
    const title = [...String(item.title || '')]
    return {
        // demo 用公司名的首字当水印字（创/淘/微/浙）
        text: title[0] || '履',
        hue: (i * 137.508 + 212) % 360,
        mode: CARD_MODES[i % CARD_MODES.length],
        blur: 0.35 + (i % 3) * 0.05,
        scale: 1 + (i % 2) * 0.1,
        intensity: 0.65,
    }
}

function mulberry32(seed) {
    let a = seed >>> 0
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), 1 | t)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** 按宽度折行，最多 `maxLines` 行，超出加省略号。 */
function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    const chars = [...String(text || '')]
    let line = ''
    let count = 0
    let cy = y
    for (let i = 0; i < chars.length; i += 1) {
        const test = line + chars[i]
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, x, cy)
            line = chars[i]
            count += 1
            cy += lh
            if (maxLines && count >= maxLines - 1) {
                let rest = chars.slice(i).join('')
                while (rest.length && ctx.measureText(`${rest}…`).width > maxW) rest = rest.slice(0, -1)
                ctx.fillText(`${rest}…`, x, cy)
                return
            }
        } else {
            line = test
        }
    }
    if (line) ctx.fillText(line, x, cy)
}

/** 单张卡面：demo 的 `drawCard`，尺寸按 `w/680` 等比缩放。 */
function drawCareerCard(item, w, h, style) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const k = w / 680

    // 1. 肌理打底。参数与 demo 的 `texturalCanvas` 逐项对齐：
    //    底 l=0.06、色团 5 团 l 10~22% α0.55、单字 α0.075。
    //    🔴 demo 的模糊是 `minSide × 0.035 × cfg.blur`（blur 0.35~0.5）
    //    ⇒ 折算到本模块的 `blur`（也是 × minSide）是 0.0122~0.0175。
    // 🔴 色相只有**一个**入口：`hue`。`base.h` / `glyph.h` 只覆盖各自那一层，
    //    **色团认的是 `cfg.hue`**（`resolve()` 里 `hue` 缺省 = 32）。
    //    只写 `base.h` 会得到「蓝底 + 橙团」—— 实测 212 号的卡渲成 (60,37,27)
    //    的砖红。别写 `h`，写 `hue`。
    const bg = texturalCanvas(
        `tunnel|${item.id}|${w}x${h}|${style.mode}|${Math.round(style.hue)}`,
        w, h,
        {
            hue: style.hue,
            base: { s: 0.2, l: 0.06 },
            blob: { count: 5, hueSpread: 90, s: 0.52, light: [0.1, 0.22], alpha: 0.55, radius: [0.35, 0.85] },
            glyph: {
                s: 0.3, l: 0.92,
                alpha: 0.075 * (style.intensity / 0.6),
                scale: style.scale,
                spacing: [2.1, 2.8],
            },
            text: style.text,
            mode: style.mode,
            // 缓存只认 key、种子只认 seedKey，两个都要带上 id 才不是八张一样的底。
            seedKey: `tunnel|${item.id}|${style.mode}`,
            blur: 0.035 * style.blur,
        },
    )
    ctx.drawImage(bg, 0, 0)

    // 2. 顶部日期
    ctx.save()
    ctx.fillStyle = 'rgba(139,163,255,0.85)'
    ctx.font = `700 ${Math.round(15 * k)}px system-ui, "PingFang SC", sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(item.kicker, 40 * k, 70 * k)
    ctx.restore()

    // 3. 底部渐变遮罩
    const g = ctx.createLinearGradient(0, h * 0.35, 0, h)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.78)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // 4. 文字
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    ctx.fillStyle = '#fff'
    ctx.font = `800 ${Math.round(44 * k)}px system-ui, "PingFang SC", sans-serif`
    ctx.fillText(item.title, 40 * k, h - 210 * k)

    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.font = `600 ${Math.round(19 * k)}px system-ui, "PingFang SC", sans-serif`
    wrapText(ctx, item.subtitle, 40 * k, h - 172 * k, w - 80 * k, 26 * k, 2)

    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = `400 ${Math.round(16 * k)}px system-ui, "PingFang SC", sans-serif`
    wrapText(ctx, item.summary, 40 * k, h - 110 * k, w - 80 * k, 24 * k, 3)

    // 5. 内描边
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 2 * k
    ctx.strokeRect(1, 1, w - 2, h - 2)

    return canvas
}

function useExperiences(language) {
    return useMemo(() => {
        return getLocalizedCollection('experiences', language).map((item) => {
            const start = (item.startDate || '').slice(0, 7).replace('-', '.')
            const end = item.endDate
                ? item.endDate.slice(0, 7).replace('-', '.')
                : (language === 'zh' ? '至今' : 'Present')
            return {
                id: item.id,
                title: item.company,
                subtitle: [item.position, item.department].filter(Boolean).join(' · '),
                summary: (item.responsibilities || []).join(' '),
                kicker: `${start} — ${end}`,
                start,
            }
        })
    }, [language])
}

/** 只在"真的进了房间"时挂载 —— 见文件头关于接管的说明。 */
function TunnelRenderer({ sceneRef, cameraRef, controlsRef, fadeRef, exitingRef }) {
    const size = useThree((s) => s.size)

    useEffect(() => {
        const cam = cameraRef.current
        if (!cam) return
        cam.aspect = size.width / size.height
        cam.updateProjectionMatrix()
    }, [size, cameraRef])

    useFrame((state, delta) => {
        const scene = sceneRef.current
        const cam = cameraRef.current
        const controls = controlsRef.current
        if (!scene || !cam || !controls) {
            // 隧道还没搭好（字体没就绪 / 首帧）：**照常画主场景**。
            // 直接 return 会把上一帧留在 framebuffer 上，看着像卡住。
            state.gl.render(state.scene, state.camera)
            return
        }

        controls.step(delta)

        const gl = state.gl
        const fade = fadeRef.current

        if (!exitingRef.current) {
            // ── 在隧道里：整屏归隧道，幕布压在最后把"硬切"变成一次呼吸 ──
            gl.render(scene, cam)
            if (fade && fade.material.opacity > 0.002) {
                const prev = gl.autoClear
                gl.autoClear = false
                gl.render(fade.scene, fade.camera)
                gl.autoClear = prev
            }
            return
        }

        // ── 退场：**先把走廊画出来**，再把隧道整体溶掉叠在上面 ──────────
        //
        // 以前这里只画隧道、幕布一路拉满到隧道底色 ⇒ 用户点后退看到的是
        // 一片黑，等门关完才"啪"地换成走廊。那不是卡顿，是**整段退场
        // 动画根本没被渲染**（接管期间主场景一帧都没画）。
        //
        // 现在三趟：走廊（自带清屏）→ 空间底色（把走廊压住）→ 卡片/星点。
        // 后两者的透明度由 frameRef 按同一个 t 从 1 降到 0 ⇒ 隧道像一层
        // 墨在走廊上化开，门在底下关、相机在底下退。
        gl.render(state.scene, state.camera)

        const prev = gl.autoClear
        gl.autoClear = false
        // 🔴 走廊那一趟把深度缓冲也写满了。隧道有自己的相机和世界坐标，
        //    接着用这份深度去测，卡片会被走廊的墙/地面按错误的 z 剔掉。
        //    clearDepth() 不受 autoClear 影响（three 里它就是一次 gl.clear）。
        gl.clearDepth()
        if (fade && fade.material.opacity > 0.002) gl.render(fade.scene, fade.camera)
        gl.render(scene, cam)
        gl.autoClear = prev
    }, 1)

    return null
}

const CareerTunnel = ({ warmup = false, onReady, isExiting = false }) => {
    const { language } = useSitePreferences()
    const { tier } = usePerformance()
    const { requestExit } = useScene()
    const gl = useThree((s) => s.gl)
    const experiences = useExperiences(language)

    const [fontsReady, setFontsReady] = useState(false)
    useEffect(() => {
        let alive = true
        ensureFontsReady().then(() => { if (alive) setFontsReady(true) })
        return () => { alive = false }
    }, [])

    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const cardsRef = useRef([])
    /* 幕布：一趟正交覆盖屏，颜色 = 隧道底色。接管渲染是**瞬时**的 ——
       门还关着的那一帧就整个换成星空了，硬切很难看。进场从底色淡入、
       退场淡回底色，中间那一下就成了"呼吸"而不是"啪"。 */
    const fadeRef = useRef(null)
    /* 场景搭好后由 build effect 填进来的"每帧动作"。单独放一个 ref，是为了
       让下面的 `controls.step` 只**读**它 —— 每帧要改的东西不能挂在 useMemo
       的返回值上（`react-hooks/immutability` 会直接报 error）。 */
    const frameRef = useRef(null)

    // 退场动画期间把幕布拉上。用 ref 转一道，免得 build effect 因为 isExiting
    // 变化整个重建场景。
    const exitingRef = useRef(isExiting)
    useEffect(() => { exitingRef.current = isExiting }, [isExiting])

    // 门要等隧道搭好再开 —— 否则门先开到一片空白，几百毫秒后星空才"啪"地出现。
    // 只发一次：换语言/换档位会重建场景，但门已经开了，不需要再喊。
    const readySent = useRef(false)
    const sendReady = useCallback(() => {
        if (readySent.current) return
        readySent.current = true
        onReady?.()
    }, [onReady])

    // 滚动状态：目标 / 当前，与 demo 同一个手感（指数趋近，但按帧时间归一）。
    // ⚠️ 用 layout effect 建、存 ref —— 这个对象每帧都被改。
    const controlsRef = useRef(null)
    useLayoutEffect(() => {
        const n = Math.max(experiences.length, 1)
        // 开房间直接停在**第一张卡的停靠位**（原来是隧道口 6，第一张卡在 11
        // 单位外、画面大半是空星空）。`zStart` 仍是回退边界，所以要分开：
        // 初始 camZ ≠ zStart 时，"往回滚退出"的手势才不会被一进来就触发。
        const zStart = TUNNEL_MOUTH_Z
        const zEnd = tunnelTargetZ(n - 1)
        const st = { camZ: TUNNEL_ENTRY_Z, targetZ: TUNNEL_ENTRY_Z, zStart, zEnd }
        const clamp = (z) => Math.max(zEnd, Math.min(zStart, z))
        controlsRef.current = {
            st,
            clamp,
            step: (delta) => {
                if (tunnelRequest.z !== null) {
                    st.targetZ = clamp(tunnelRequest.z)
                    tunnelRequest.z = null
                }
                // 指数趋近 + 帧时间归一：60fps 与 30fps 手感一致
                st.camZ += (st.targetZ - st.camZ) * (1 - Math.exp(-8 * delta))
                frameRef.current?.(st.camZ, delta)
            },
        }
    }, [experiences.length])


    useEffect(() => {
        setTunnelCount(experiences.length)
        return () => setTunnelCount(0)
    }, [experiences.length])

    // ---- 场景一次性搭建（字体就绪后）----
    useEffect(() => {
        if (!fontsReady || experiences.length === 0) return undefined

        const tex = TEX[tier] || TEX.HIGH
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(FOG_COLOR)
        scene.fog = new THREE.FogExp2(FOG_COLOR, 0.028)

        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 300)
        // 与 controls 的初始机位一致 —— 差一帧也会被幕布挡住，但没必要让它先
        // 在 6 上渲一帧再跳过来。
        camera.position.set(0, 0, TUNNEL_ENTRY_Z)

        // ---- 幕布（一趟正交覆盖屏）----
        const fadeScene = new THREE.Scene()
        const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const fadeMaterial = new THREE.MeshBasicMaterial({
            color: FOG_COLOR,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
            // 🔴 这块屏原来摆在 z=0，而正交相机也在 z=0、near=0 —— 它正好落在
            //    **近平面上**，被裁掉，于是一帧都没画出来过（进场那个"呼吸"
            //    其实一直是硬切）。挪到相机前方半格就好。
            //    ⚠️ 别用 DoubleSide 救：透明双面会被拆成**两趟**画，
            //    alpha 变成 1-(1-a)²，淡入淡出的曲线整个被拉歪。
            toneMapped: false,
        })
        const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial)
        fadeQuad.position.z = -0.5
        fadeQuad.frustumCulled = false
        fadeScene.add(fadeQuad)
        fadeRef.current = { scene: fadeScene, camera: fadeCamera, material: fadeMaterial }
        let fadeOpacity = 1

        const cards = []
        const geometries = []
        const materials = []
        const textures = []
        // demo 设了 anisotropy = maxAnisotropy。卡面是**斜着看**的（螺旋 + 30%
        // 面向相机），各向异性过滤关掉的话远处那张卡的正文直接糊成一片。
        const maxAniso = gl.capabilities.getMaxAnisotropy?.() ?? 1

        experiences.forEach((item, i) => {
            const style = cardStyleFor(item, i)
            const canvas = drawCareerCard(item, tex.w, tex.h, style)
            const texture = new THREE.CanvasTexture(canvas)
            texture.colorSpace = THREE.SRGBColorSpace
            texture.anisotropy = maxAniso
            texture.minFilter = THREE.LinearFilter
            texture.magFilter = THREE.LinearFilter
            textures.push(texture)

            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide,
                fog: true,
                // 🔴 R3F 的 Canvas 默认把 gl.toneMapping 设成 ACESFilmic。主场景
                // 的颜色是**在 ACES 下调出来**的，但隧道不是 —— demo 的渲染器
                // 是默认的 NoToneMapping。不关掉的话卡面被 ACES 的输入矩阵一混：
                // 实测 (12,15,18) 的深蓝底渲成 (3,17,22) 的青，亮度只剩 1/5。
                // 关在这一个材质上（`toneMapped=false` 会生成不带 TONE_MAPPING
                // 的 program 变体），不用去动全局 gl，也不影响主场景。
                toneMapped: false,
            })
            materials.push(material)

            const geometry = new THREE.PlaneGeometry(CARD_W, CARD_H)
            geometries.push(geometry)

            const mesh = new THREE.Mesh(geometry, material)
            const angle = i * TURN
            const z = tunnelCardZ(i)
            mesh.position.set(Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS * 0.55, z)
            mesh.lookAt(0, 0, z)
            mesh.rotateZ(Math.sin(angle) * 0.15)
            scene.add(mesh)
            cards.push({
                mesh,
                baseZ: z,
                baseX: mesh.position.x,
                phase: i * 1.7,
                baseY: mesh.position.y,
                /* build 时的完整朝向（含 `rotateZ` 那 8.6° 的侧倾）。
                   焦点卡的朝向是从**这个**姿态插值到"正对镜头"，所以得存一份。
                   存欧拉角不够：卡在螺旋上有高度差（y 最多 ±1.76），
                   `lookAt(0,0,z)` 会把高/低处的卡几乎放平（俯仰 ~78°），而
                   "偏航 → 俯仰"两轴分别插值凑不出精确的 lookAt（残差 ~2°，
                   还会把侧倾留到最后）。四元数 slerp 一步到位。 */
                restQ: mesh.quaternion.clone(),
            })
        })

        // ---- 光点（隧道内）----
        const rnd = mulberry32(hash32('career-tunnel'))
        const dotCount = tier === 'LOW' ? 260 : 600
        const dotPos = new Float32Array(dotCount * 3)
        const dotColors = new Float32Array(dotCount * 3)
        const tmpColor = new THREE.Color()
        for (let i = 0; i < dotCount; i += 1) {
            const a = rnd() * Math.PI * 2
            const r = RADIUS * (0.9 + rnd() * 0.3)
            dotPos[i * 3] = Math.cos(a) * r
            dotPos[i * 3 + 1] = Math.sin(a) * r * 0.55
            dotPos[i * 3 + 2] = -rnd() * (experiences.length + 4) * TUNNEL_SPACING
            tmpColor.setHSL(0.6 + rnd() * 0.15, 0.8, 0.6 + rnd() * 0.3)
            dotColors[i * 3] = tmpColor.r
            dotColors[i * 3 + 1] = tmpColor.g
            dotColors[i * 3 + 2] = tmpColor.b
        }
        const dotGeom = new THREE.BufferGeometry()
        dotGeom.setAttribute('position', new THREE.BufferAttribute(dotPos, 3))
        dotGeom.setAttribute('color', new THREE.BufferAttribute(dotColors, 3))
        const dotMat = new THREE.PointsMaterial({
            size: 0.06, vertexColors: true, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
            toneMapped: false,
        })
        const dots = new THREE.Points(dotGeom, dotMat)
        scene.add(dots)

        // ---- 远景星尘 ----
        const farCount = tier === 'LOW' ? 200 : 400
        const farPos = new Float32Array(farCount * 3)
        for (let i = 0; i < farCount; i += 1) {
            farPos[i * 3] = (rnd() - 0.5) * 60
            farPos[i * 3 + 1] = (rnd() - 0.5) * 40
            farPos[i * 3 + 2] = -rnd() * 260
        }
        const farGeom = new THREE.BufferGeometry()
        farGeom.setAttribute('position', new THREE.BufferAttribute(farPos, 3))
        const farMat = new THREE.PointsMaterial({
            color: 0x8ba3ff, size: 0.08, transparent: true, opacity: 0.5,
            depthWrite: false, fog: false, toneMapped: false,
        })
        const far = new THREE.Points(farGeom, farMat)
        scene.add(far)

        sceneRef.current = scene
        cameraRef.current = camera
        cardsRef.current = cards
        // 场景搭完才开门（8 张 680×960 的 canvas 惰性光栅化是几百毫秒的活，
        // 这段时间必须藏在还关着的门后面）。
        sendReady()

        // 每帧的位移/朝向/进度（由 controls.step 调用，只读这个 ref）
        const { st } = controlsRef.current
        // 🔴 卡片不是固定的朝向 —— demo 每帧把 rotation.y 往"面向相机"拉 30%，
        //    这**是这张脸能读的前提**：`lookAt(0,0,z)` 让卡面朝隧道轴，而相机
        //    也在轴上、顺着轴看 ⇒ 不修正的话每张卡都是 74°+ 的侧脸，文字全糊。
        //    demo 写死 0.98/0.02 是逐帧的（掉帧就变慢），这里按帧时间归一：
        //    -ln(0.98) × 60 ≈ 1.212 是 60fps 下等价的连续速率。
        const BILLBOARD_K = 1.212
        /* 侧角：demo 那个 30%。非焦点的卡保持它，隧道才有螺旋纵深。 */
        const SIDE_TURN = 0.3
        /* 焦点半径（世界单位）＝ 0.62 个卡片间距。中点（d=4.25）处权重只剩
           0.10 ⇒ 两张卡都还在 30% 的侧脸上；靠近的最后 1/4 步里才快速爬到
           0.65+。取整步会让相邻两张卡同时半转，看起来像整条隧道在扭。 */
        const FOCUS_RANGE = TUNNEL_SPACING * 0.62
        /* 焦点卡的额外收敛速率（叠在 BILLBOARD_K 上）。 */
        const FOCUS_K = 2.4
        /* 焦点卡**停在相机前方多远**（世界单位）。卡是 3.4×4.8、fov 58°，所以
           6.2 ⇒ 卡高占屏 ~70%。停靠位只有 4 ⇒ 会占 108%，上下被裁掉。 */
        const FOCUS_DIST = 6.2
        /* 焦点卡的水平落位。相机在隧道轴上、卡在半径 3.2 的螺旋上 ⇒ 让卡
           "原地转正"必然被推到画面右侧并裁掉（水平半视角 44.6°，卡中心就
           在 28° 上）。所以转正的同时要把它**拉回轴心**，落点略偏左：右侧
           22% 是信息面板、左侧 10% 是时间刻度，画面可用区的中线在 44%。 */
        const FOCUS_X = -0.55
        /* 🔴 「谁在焦点」只有一个量：相机离**这张卡的停靠位**有多远。
           `tunnelTargetZ(i)` 是 HUD 点刻度时相机要去的 z，也是相机停稳时的 z
           ⇒ 停稳时 d 恒为 0、权重恒为 1、卡面偏角恒为 0°。
           之前这里写 `|baseZ - (camZ - 6)|`（6 是拍脑袋的"看向前方 6 格"），
           相机其实停在卡前 4（TUNNEL_CAM_OFFSET）⇒ 停稳时 d=2、权重只有
           0.83，焦点卡永远差 10° 转不正；顺带 HUD 的高亮也比中点早 2 格翻页。
           改成同一个真源之后，"HUD 说第 3 张、转正的是第 4 张"这类漂移在
           结构上就不可能发生。 */
        const focusDist = (cardZ, camZ) => Math.abs(camZ - (cardZ + TUNNEL_CAM_OFFSET))
        // 进场：幕布 1→0（k=8 ⇒ 0.45s 时约 3%），卡片始终不透明 —— 星空从
        //       底色里浮出来。
        // 退场：exitT 0→1（k=6.5 ⇒ 0.46s 到 95%）。幕布按 a 降、卡片按 a² 降 ——
        //       两者都得降（只降幕布会露出一张张悬在走廊上的卡；只降卡片会被
        //       幕布压成一片纯色），但**卡片必须先走**，否则深灰卡片会残留在
        //       已经亮起来的走廊上。
        const FADE_IN_K = 8
        const DISSOLVE_K = 6.5
        /* 退场时幕布**不拉满**：0.92 就够压住走廊，留 8% 让第一帧和上一帧
           （纯星空）几乎无缝 —— 拉满再降会闪一下。 */
        const EXIT_VEIL = 0.92
        let exitT = 0
        /* 每帧复用的两个临时对象（逐帧 new 会制造 GC 抖动）。 */
        const lookDummy = new THREE.Object3D()
        const qTarget = new THREE.Quaternion()
        frameRef.current = (camZ, delta) => {
            camera.position.set(0, 0, camZ)
            camera.lookAt(0, 0, camZ - 10)
            dots.position.z = camZ * 0.5
            far.position.z = camZ * 0.15

            if (exitingRef.current) {
                exitT += (1 - exitT) * (1 - Math.exp(-DISSOLVE_K * delta))
                const a = 1 - exitT
                fadeMaterial.opacity = a * EXIT_VEIL
                // 卡片/星点用 a²，幕布用 a：**幕布是最后消失的那层**。
                // 同为线性的话，卡片会以 20~30% 的深灰矩形悬在已经亮起来的
                // 走廊上（逐帧截图 f52/f64 就是这个症状），看着像残影而不是
                // 化开。让内容先走、底色后走，观感才是一层墨被抹掉。
                const c = a * a
                materials.forEach((m) => { m.opacity = c })
                dotMat.opacity = c * 0.7
                farMat.opacity = c * 0.5
                // three 的 WebGLBackground 只要 background 是 Color 就**强制清屏**
                // （不看 autoClear）⇒ 退场这一趟必须让开，否则走廊被纯色擦掉。
                if (scene.background) scene.background = null
            } else {
                fadeOpacity += (0 - fadeOpacity) * (1 - Math.exp(-FADE_IN_K * delta))
                fadeMaterial.opacity = fadeOpacity
            }

            let closest = 0
            let best = Infinity
            const t = performance.now() * 0.0008
            cards.forEach((c, i) => {
                const d = focusDist(c.baseZ, camZ)
                if (d < best) { best = d; closest = i }
                const bob = c.baseY + Math.sin(t + c.phase) * 0.08

                /* ── 朝向：滚到哪张，哪张转正 ─────────────────────────────
                   ① **落位**：焦点卡从螺旋上被"抽"到相机正前方 —— 轴心偏左
                      (FOCUS_X)、y 归零、z 后退到 FOCUS_DIST。不抽的话，卡在
                      半径 3.2 的螺旋上原地转正，必然糊在画面右侧被裁掉。
                   ② **朝向**：一次性 `lookAt(相机)` 拿到精确的四元数（含俯仰；
                      卡在螺旋上有 ±1.76 的高度差，只转偏航会让焦点卡变成一块
                      斜躺在地上的巨大平面 —— 第一次改就是这样），再从这个
                      build 姿态 slerp 过去。

                   插值参数 `SIDE_TURN + (1-SIDE_TURN)·focus`：
                     focus=0 → 0.30，与 demo 逐帧拉 30% 同效（非焦点卡保持侧脸，
                               螺旋纵深不塌）；
                     focus=1 → 1.00，正对镜头、居中、完整可见。

                   ⚠️ 用四元数而不是分别改 rotation.x/rotation.y：欧拉 XYZ 是
                   `Rx·Ry`，凑不出精确的 lookAt（实测残差 2°），而且 build 时
                   `rotateZ` 那 8.6° 的侧倾会一直留到最后。

                   ⚠️ 收敛速度也跟着权重走（FOCUS_K）。只调目标角不调速度的话，
                   焦点卡的转向会拖到 0.8s，读起来是"慢慢扭"而不是"转过来"。 */
                const x = Math.max(0, 1 - d / FOCUS_RANGE)
                const focus = x * x * (3 - 2 * x)
                c.mesh.position.x = c.baseX + (FOCUS_X - c.baseX) * focus
                c.mesh.position.y = bob + (0 - bob) * focus
                c.mesh.position.z = c.baseZ - (FOCUS_DIST - TUNNEL_CAM_OFFSET) * focus

                lookDummy.position.copy(c.mesh.position)
                lookDummy.lookAt(camera.position)
                qTarget.copy(c.restQ).slerp(lookDummy.quaternion, SIDE_TURN + (1 - SIDE_TURN) * focus)
                const k = 1 - Math.exp(-(BILLBOARD_K + FOCUS_K * focus) * delta)
                c.mesh.quaternion.slerp(qTarget, k)
            })
            const progress = (st.zStart - camZ) / (st.zStart - st.zEnd)
            setTunnelProgress(closest, Math.max(0, Math.min(1, progress)))
        }

        return () => {
            frameRef.current = null
            scene.traverse((o) => {
                if (o.isMesh || o.isPoints) {
                    o.geometry?.dispose?.()
                }
            })
            geometries.forEach((g) => g.dispose())
            materials.forEach((m) => m.dispose())
            textures.forEach((t) => t.dispose())
            dotGeom.dispose(); dotMat.dispose(); farGeom.dispose(); farMat.dispose()
            fadeQuad.geometry.dispose(); fadeMaterial.dispose()
            fadeRef.current = null
            sceneRef.current = null
            cameraRef.current = null
            cardsRef.current = []
        }
    }, [fontsReady, experiences, tier, sendReady, gl])

    // 没有履历数据时不能把门锁死：8s 兜底虽然会开，但没必要让人干等。
    useEffect(() => {
        if (fontsReady && experiences.length === 0) sendReady()
    }, [fontsReady, experiences.length, sendReady])

    // ---- 输入 ----
    useEffect(() => {
        // 出门动画期间松手：滚轮不该和"倒着退出房间"抢目标位置。
        if (warmup || isExiting) return undefined

        /* ── 往后退到隧道口，再退就出门 ────────────────────────────────
           只认**被 clamp 吃掉的那部分**滚轮量：人在隧道中段往上甩一记，
           targetZ 会立刻被夹到 zStart，但那不算"已经到头了" —— 相机还在
           几十个单位外。所以两个条件同时成立才计数：
             ① 这一下滚轮确实被夹住了（说明已经顶到头）
             ② 相机真的到了口子上（camZ 距 zStart < 2.5）
           ② 是防误触的关键：漏了它，从深处往上一甩就会当场被踢出房间。
           停顿 400ms 清零，免得慢慢蹭也能攒够。 */
        const EXIT_ARM = 60   // 到这儿换提示文案
        const EXIT_AT = 300   // 鼠标滚轮 ≈ 3 格 / 触控板一次长划
        const IDLE_MS = 400
        let pull = 0
        let lastAt = 0
        let fired = false

        const resetPull = () => {
            pull = 0
            setTunnelArmed(false)
        }
        const addPull = (amount) => {
            const now = performance.now()
            if (now - lastAt > IDLE_MS) pull = 0
            lastAt = now
            pull += amount
            setTunnelArmed(pull > EXIT_ARM)
            if (pull < EXIT_AT) return false
            resetPull()
            if (fired) return false
            fired = true
            requestExit()
            return true
        }

        // 事件里现读 controlsRef —— 换语言会让它整体换一个对象（zEnd 跟着条数走），
        // 把旧对象闭进监听器里会拿错 clamp 边界。
        // 返回 true 表示这一下被夹住了（已经顶到隧道口）。
        const nudge = (dz) => {
            const c = controlsRef.current
            if (!c) return false
            const want = c.st.targetZ + dz
            c.st.targetZ = c.clamp(want)
            return Math.abs(want - c.st.targetZ) > 1e-6
        }
        const atMouth = () => {
            const c = controlsRef.current
            return !!c && c.st.camZ > c.st.zStart - 2.5
        }

        /* 滚轮/手指落在 HUD 那块可滚面板上时，**这一下先归面板**。
           监听器挂在 window 上（要接住整屏的滚动），而面板自己的
           `overflow-y: auto` 要靠浏览器原生滚动才生效 —— 只要这里不
           preventDefault、也不 nudge，面板就自己滚。
           ⚠️ 只在**面板真的还能往这个方向滚**时让路：6/8 条履历的正文
           一屏放得下，一律吞掉滚轮会让人以为页面卡住。滚到头顶/底部之后
           这一下交回隧道。 */
        const panelTakesWheel = (target, deltaY) => {
            if (!(target instanceof Element)) return false
            const panel = target.closest('.career-hud__info')
            if (!panel) return false
            const el = panel.querySelector('.career-hud__desc')
            if (!el) return false
            const range = el.scrollHeight - el.clientHeight
            if (range <= 1) return false
            // deltaY < 0 = 往上滚（看更前面的内容）
            return deltaY < 0 ? el.scrollTop > 0 : el.scrollTop < range - 1
        }

        const onWheel = (e) => {
            if (panelTakesWheel(e.target, e.deltaY)) return
            e.preventDefault()
            const back = e.deltaY < 0
            const clipped = nudge(-e.deltaY * 0.008)
            if (back) {
                if (clipped && atMouth()) addPull(-e.deltaY)
                else if (!clipped) resetPull()
            } else {
                resetPull()
            }
        }
        let touchY = 0
        const onTouchStart = (e) => { touchY = e.touches[0].clientY }
        const onTouchMove = (e) => {
            // 手指在面板里：交给面板原生滚动（同 onWheel 的判据）
            if (panelTakesWheel(e.target, -(e.touches[0].clientY - touchY))) return
            const dy = e.touches[0].clientY - touchY
            touchY = e.touches[0].clientY
            const clipped = nudge(-dy * 0.03)
            // 手指往下划 = 往后退（视口往上走）
            if (dy > 0) {
                if (clipped && atMouth()) addPull(dy * 4)
                else if (!clipped) resetPull()
            } else {
                resetPull()
            }
        }
        const onKey = (e) => {
            const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
            if (back) nudge(TUNNEL_SPACING * 0.8)
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nudge(-TUNNEL_SPACING * 0.8)
            resetPull()
        }

        window.addEventListener('wheel', onWheel, { passive: false })
        window.addEventListener('touchstart', onTouchStart, { passive: true })
        window.addEventListener('touchmove', onTouchMove, { passive: true })
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('wheel', onWheel)
            window.removeEventListener('touchstart', onTouchStart)
            window.removeEventListener('touchmove', onTouchMove)
            window.removeEventListener('keydown', onKey)
            // 卸载/开始退场时把"预备退出"的提示收回去，否则 HUD 会停在那句话上。
            setTunnelArmed(false)
        }
    }, [warmup, isExiting, requestExit])

    if (warmup) return null

    return (
        <TunnelRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            controlsRef={controlsRef}
            fadeRef={fadeRef}
            exitingRef={exitingRef}
        />
    )
}

export default CareerTunnel
