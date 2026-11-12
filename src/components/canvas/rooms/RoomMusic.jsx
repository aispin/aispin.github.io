import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useScene } from '../../../context/SceneContext'
import { useSitePreferences } from '../../../context/SitePreferences'
import { musicStage } from '../../../state/musicRoom'
import {
    createScreenQuad,
    drawTakeover,
    ensureQuadResolution,
    useDrawingBufferSize,
    useTakeoverStage,
} from './takeover'

/**
 * 音乐房间 —— 「唱盘」的**环境层**。
 *
 * 唱盘本身是 DOM + 2D canvas（`ui/MusicHud.jsx`，从
 * `public/demos/web3d/vinyl-player/index.html` 搬来）；这里只做两件事：
 *   1. 一张全屏 GLSL：**暗房**。一束从顶上打下来的暖光、空气里的浮尘、
 *      黑胶转起来时那点若有若无的沟槽反光、暗角。
 *   2. **接管渲染**，让走廊那套房子在房间里一帧都不画。
 *
 * ── 为什么接管 ────────────────────────────────────────────────────────
 * 和 `CraftRing` 同因：房间是满屏的，DOM 层一旦不透明就把走廊盖住了。
 * 不接管的话主场景每帧仍在满负荷渲染一栋没人看得见的房子（纯白烧）。
 *
 * ⚠️ `useFrame(cb, 1)` 一旦注册 R3F 就不再自动渲染主场景。接管放在子组件
 *    `VinylRenderer` 里、且只在真正进房间时挂载 —— 预热副本绝不能挂第二份
 *    （`RoomWarmup` 里改用 posts 也是这个原因）。
 *
 * ── 为什么唱盘不用 three 重建 ─────────────────────────────────────────
 * 唱盘的透视是 CSS `rotateX(52deg)` + `perspective:1600px`，指针 → 盘面坐标
 * 有一套闭式反解（`screenToPlane`），命中判定是自己算的（`nearArm`）。
 * 那套东西上周刚踩完坑（见 memory：`preserve-3d` 里 z-index 不排序、
 * `elementFromPoint` 与真实 pointer 命中是两条路径）。用 three 重建要全部
 * 重写一遍，收益只是"盘面是真网格"——而用户看不见这个区别。
 * 所以：**环境用 WebGL，物件用 DOM**，两边各管自己最擅长的那半。
 */

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uOpacity;
uniform float uLight;    /* 0 = 暗房（深色）, 1 = 明室（浅色） */
uniform float uSpin;     /* 0~1：唱片是否在转，决定沟槽反光的活跃度 */

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

    /* ── 墙 ──
       暗房是暖黑（不是纯黑：纯黑会让 DOM 里的唱盘像贴在虚空上）。
       浅色是暖纸，但比相纸暗一档。 */
    vec3 wallDark  = vec3(0.042, 0.036, 0.040);
    vec3 wallLight = vec3(0.930, 0.892, 0.840);
    vec3 col = mix(wallDark, wallLight, uLight);

    /* 墙面斑驳：暗房里是显影液的水渍；明室是纸张纤维 */
    float blot = noise(p * 2.2) * 0.5 + noise(p * 5.4) * 0.25;
    float fiber = noise(vec2(p.x * 44.0, p.y * 3.0)) * 0.5
                + noise(vec2(p.x * 120.0, p.y * 6.5)) * 0.25;
    float grain = mix(blot, blot * 0.55 + fiber * 0.45, uLight);
    col *= 1.0 + (grain - 0.375) * mix(0.30, 0.14, uLight);

    /* ── 顶灯 ──
       唱盘在画面下方 1/3，灯要照在盘上：灯心放在 (0, -0.10) 附近，
       所以光晕是**从上方斜着**落下来的一团，不是正中一个大圆。 */
    vec2 lampAt = vec2(0.0, 0.52);
    float d = length((p - lampAt) * vec2(0.86, 1.0));

    /* 光晕：两层不同半径，外层是"房间被照亮"，内层是"灯本身" */
    float halo = exp(-d * 2.5) * 0.55;
    float bulb = exp(-d * 13.0) * 0.85;

    /* 锥形：从灯往下张开，照亮唱盘那一片 */
    float ang = atan(p.x, (lampAt.y - p.y) + 0.001);
    float cone = exp(-ang * ang * 10.0) * exp(-max(0.0, lampAt.y - p.y) * 1.1);

    vec3 lampCol = mix(vec3(1.0, 0.66, 0.40), vec3(1.0, 0.94, 0.84), uLight);
    col += lampCol * (halo * 0.30 + bulb * 0.55 + cone * 0.16) * mix(1.0, 0.30, uLight);

    /* ── 沟槽反光 ──
       唱片在转的时候，墙面会有一点极慢的横向扫光 —— 这是"屋里有个东西在转"
       的唯一线索。静止时它也静止（uSpin = 0）。 */
    float sweep = sin((p.x * 3.2 + uTime * 0.35 * (0.15 + uSpin)) ) * 0.5 + 0.5;
    float sheen = smoothstep(0.55, 1.0, sweep) * uSpin
                * exp(-abs(p.y + 0.16) * 3.4) * mix(0.055, 0.020, uLight);
    col += vec3(0.92, 0.88, 0.84) * sheen;

    /* ── 浮尘 ──
       两组，只在灯的光晕里可见。尺度必须小（这一间比摄影房更暗，
       尘一大就成了"星空"）。 */
    float dust = 0.0;
    for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float sc = 44.0 + fk * 38.0;
        vec2 off = vec2(uTime * (0.010 + fk * 0.006), uTime * (0.026 + fk * 0.012));
        vec2 q = p * sc + off;
        vec2 cell = floor(q);
        vec2 f = fract(q) - 0.5;
        float rnd = hash(cell + fk * 23.0);
        if (rnd > 0.972) {
            float size = 0.26 + 0.18 * (rnd - 0.972) / 0.028;
            dust += smoothstep(size, 0.0, length(f)) * (0.3 + 0.7 * rnd);
        }
    }
    float lit = 0.05 + halo * 2.4 + bulb * 1.2 + cone * 0.8;
    col += mix(vec3(1.0, 0.86, 0.72), vec3(0.42, 0.34, 0.26), uLight) * dust * 0.16 * lit;

    /* ── 暗角 ──
       唱盘那一片要留亮，四角压下去。 */
    float vig = 1.0 - mix(0.66, 0.42, uLight) * smoothstep(0.32, 1.14, length(p * vec2(0.90, 1.0)));
    col *= vig;

    /* 胶片颗粒 */
    float g = hash(gl_FragCoord.xy + fract(uTime) * 57.0);
    col += (g - 0.5) * mix(0.024, 0.012, uLight);

    /* 🔴 进场/退场必须靠 **uniform 乘进 alpha**，不能靠 material.opacity：
       ShaderMaterial 是原样编译的，three 不会把 opacity 乘进 gl_FragColor。 */
    gl_FragColor = vec4(col, uOpacity);
}
`

/** 只在"真的进了房间"时挂载 —— 见文件头关于接管的说明。
 *
 *  🔴 **主题自己读，不走 props**（2026-11-12 修「music 房间没有 light 模式」）。
 *  原来 `RoomMusic({ theme = 'dark' })` 靠 `RoomInterior` 传，那边**从来没传过**
 *  ⇒ 永远 'dark' ⇒ 着色器里的暗房永远是暗的；而 DOM 层（`MusicHud.scss`）是
 *  真的跟着 `html[data-theme]` 变的 ⇒ 浅色下就成了「深色墙 + 深墨文字」，
 *  看起来像"这间房没有浅色模式"。
 *  现在和 `AiAtlas` 同一套做法：`useSitePreferences()` 在这里读，帧循环每帧同步。
 */
function VinylRenderer({ sceneRef, cameraRef, quadRef, stage }) {
    const { theme } = useSitePreferences()
    const lightRef = useRef(theme === 'light')
    useEffect(() => { lightRef.current = theme === 'light' }, [theme])

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
        /* 唱片转不转由 `state/musicRoom` 传过来（DOM 写、这里读）；
           慢速跟随，避免暂停时反光"啪"一下停住。 */
        const target = musicStage.spinning ? 1 : 0
        mat.uniforms.uSpin.value += (target - mat.uniforms.uSpin.value) * 0.06
        /* 明暗**也慢速跟随**（0.14）：直接赋 0/1 会让整面墙在两帧之间跳变，
           而 DOM 层那边的 `background-color` 是 0.5s 过渡 —— 两边节奏要对得上，
           否则切主题的一瞬间会看到"墙先跳、字后到"。 */
        const lightTarget = lightRef.current ? 1 : 0
        mat.uniforms.uLight.value += (lightTarget - mat.uniforms.uLight.value) * 0.14

        /* 🔴 alpha 必须在**画之前**更新。放到另一个更高优先级的 useFrame 里
           会晚一帧，进场收尾那一下会闪。 */
        const alpha = stage.advance(d)
        mat.uniforms.uOpacity.value = alpha
        ensureQuadResolution(gl, mat)

        drawTakeover(gl, state, { scene, camera: cam, alpha })
    }, 1)

    return null
}

/**
 * @param {object}  p
 * @param {Function} p.onReady    场景搭好、门可以开了
 * @param {boolean} p.isExiting   正在退场
 *
 * ⚠️ **不收 `theme`**：明暗由 `VinylRenderer` 自己从 `useSitePreferences()` 读。
 * 收 props 的那一版被 `RoomInterior` 漏传了，症状是"这间房只有暗色"。
 */
const RoomMusic = ({ onReady, isExiting = false }) => {
    const { currentRoom, isTeleporting } = useScene()
    const { theme } = useSitePreferences()
    const sceneRef = useRef(null)
    const cameraRef = useRef(null)
    const quadRef = useRef(null)
    const stage = useTakeoverStage({
        isExiting,
        skipEntry: Boolean(isTeleporting) || currentRoom === 'music',
    })
    const readySent = useRef(false)

    useEffect(() => {
        const screen = createScreenQuad({
            fragmentShader: FRAG,
            uniforms: {
                uTime: { value: 0 },
                uLight: { value: theme === 'light' ? 1 : 0 },
                uSpin: { value: 0 },
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
        // theme 只用来定初值，之后由帧循环同步（放进 deps 会重建 quad）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onReady])

    useDrawingBufferSize(quadRef)

    return (
        <VinylRenderer
            sceneRef={sceneRef}
            cameraRef={cameraRef}
            quadRef={quadRef}
            stage={stage}
        />
    )
}

export default RoomMusic