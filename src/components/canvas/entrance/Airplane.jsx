import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import {
    PLANE_VERT, PLANE_FRAG, PLANE_SHADOW_VERT, PLANE_SHADOW_FRAG,
    airplanePalette, PLANE_INK,
} from '../../../shaders/airplane';
import { buildAirplane, PLANE } from '../../../utils/airplane';
import { PARKED, planePoseAt, parkedPose } from '../../../utils/flightPath';
import { GRASS_Y } from '../../../config/entranceMetrics';
import { seasonLightFor } from '../../../config/seasonLight';
import { toShaderColor } from '../../../config/theme';
import { setGuitarCursor } from '../../../utils/guitarCursor';
import { enterFlight, useFlightMode, flightTime } from '../../../config/flightMode';

/**
 * Airplane — 前院那架小飞机（WO-18，2026-10-12）。
 * ==================================================================
 *
 * 用户：「前院摆一架小飞机，**点击**在 `/flight` 路由下进入飞行模式。」
 *
 * 停机位在 `utils/flightPath.js` 的 `PARKED`（**左院草地的中心**，与右院
 * 那棵樱花树严格对称 ±6.27）—— 那才是航线的起点，所以位置的真源在
 * 航线文件里，不在这个组件里。
 *
 * 代价（与樱花树同一把尺子）
 * -------------------------
 *   · 机身 + 翼 + 尾 + 起落架 1 个 mesh
 *   · 桨 1 个 mesh（**它得转**，所以不能并进机身）
 *   · 地面投影 1 片
 * ⇒ **3 个 mesh**，3 次 draw call。材质**只有一个**（六个零件靠 `part`
 *   顶点属性分色），所以没有材质切换开销。
 *
 * 🔴 为什么桨单独一个 mesh：它得转。塞进机身就只能靠着色器转，而
 *    "整片几何在顶点着色器里绕 z 转"会连带把法线也转错（法线不跟着顶点
 *    着色器里的位置变换走）—— 那就得手写一套法线旋转。多一次 draw call
 *    换掉一整类 bug，值。
 *
 * ⚠️ `frustumCulled` 不能开：实例矩阵 / 每帧改位姿的对象，自动包围球
 *    会把整个飞机剔掉（竹篱栽过的那个坑，与樱花树同一条）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 一个诚实的副作用：**默认机位看不见它**
 * ---------------------------------------------------------------------------
 * 休息机位在 `(0, 0.2, 28.15)`、朝 −z 看屋门，而停机位在 z = 30.15
 * —— **在相机身后 2 个单位**。所以刚进来时看不到飞机（樱花树同理）。
 *
 * 这不是 bug，是几何的必然：前院 z ∈ [22.15, 38.15]，而相机站在
 * 离前墙只有 6 单位的地方、fov 只有 60 ⇒ 视线之外的前院本来就占了大半。
 * 想看见它得**转一下**（环绕相机的拖拽），而"院子要转着看"正是
 * DR-B 定下来的交互本身。所以这里是"转过去发现"，不是"摆在眼前"。
 *
 * 真要摆在眼前，只能把它挪到甬路上（正对相机脚下）—— 那会挡住进门的路，
 * 而且和"前院"这个设定冲突。**不改**。
 */

/** 桨的转速（弧度 / 秒）：停着慢转（院子里的风），飞起来快转。 */
const PROP_IDLE_RATE = 1.1;
const PROP_FAST_RATE = 34;

/** 地面投影的半径与不透明度。比樱花树（2.35）小 —— 飞机比树冠小得多。 */
const SHADOW_R = 1.55;
const SHADOW_OPACITY = 0.40;
/** 升到多高时投影完全消失（世界单位）。 */
const SHADOW_FADE_H = 5.0;

/** 太阳方向（世界、归一化）—— 与两棵树同一把尺子。 */
const lightDirCache = new Map();
function lightDirFor(season) {
    if (lightDirCache.has(season)) return lightDirCache.get(season);
    const p = seasonLightFor(season).day.key.position;
    const v = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    lightDirCache.set(season, v);
    return v;
}

export function Airplane() {
    const scene = useThree((state) => state.scene);
    const flight = useFlightMode();
    const active = flight.active;

    const plane = useMemo(() => buildAirplane(), []);

    const groupRef = useRef();
    const propRef = useRef();
    const matRef = useRef();
    const shadowRef = useRef();
    const shadowMatRef = useRef();

    /**
     * 停机位姿 —— 🔴 **就是航线在 t=0 的位姿**（`parkedPose()`），
     * 不是这里另算一个朝向。
     *
     * 第一版这里写的是 `setFromAxisAngle(Y, PARKED.yaw)`，而 `PARKED.yaw = 0`
     * （机头朝 +z）与航线在 t=0 的真实切向（偏航 62.4°）**差了 62 度** ⇒
     * 点一下飞机就瞬间扭头。现在朝向只有一个真源：航线。
     */
    const parked = useMemo(() => parkedPose(), []);

    // 所有材质共用一份 uniform 对象（与两棵树同一条做法）：地面投影
    // 多出来的 uTint / uOpacity 只有它那对着色器声明，其余 program 里没有，
    // three 上传时会直接跳过。
    const uniforms = useSeasonUniforms(
        (s) => ({
            ...airplanePalette(),
            uLightDir: { value: lightDirFor(s) },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
            uTint: { value: PLANE_INK },
            uOpacity: { value: SHADOW_OPACITY },
        }),
        [],
    );

    useFrame((state) => {
        const g = groupRef.current;
        const prop = propRef.current;
        let px = PARKED.position.x;
        let py = PARKED.position.y;
        let pz = PARKED.position.z;

        if (active) {
            // 🔴 `t` 来自 store 的 `flightTime()`，**和相机读的是同一个**
            //    （见 config/flightMode.js 顶上那段）—— 两边各记一个开始时刻
            //    迟早会差一帧，症状是"相机与飞机相对位置慢慢漂"。
            const t = flightTime();
            const pose = planePoseAt(t);
            px = pose.position.x; py = pose.position.y; pz = pose.position.z;
            if (g) {
                g.position.copy(pose.position);
                g.quaternion.copy(pose.quaternion);
            }
            // 桨角是 t 的**函数**，不是累加量 —— 冻结 t（`?flight&t=N`）时
            // 桨也停在确定的角度上，截图才可复现。
            if (prop) prop.rotation.z = t * PROP_FAST_RATE;
        } else {
            if (g) {
                // 🔴 停机位姿与航线 t=0 **逐位相同**（`parked = parkedPose()`），
                //    所以"点击进飞行"那一帧不会瞬移、也不会扭头。
                g.position.copy(parked.position);
                g.quaternion.copy(parked.quaternion);
            }
            if (prop) prop.rotation.z = state.clock.elapsedTime * PROP_IDLE_RATE;
        }

        // ---- 地面投影：跟着飞机在地面上的投影走，随高度淡出并放大 ----
        const sm = shadowRef.current;
        if (sm) {
            const alt = Math.max(0, py - PARKED.position.y);
            const k = 1 - Math.min(1, alt / SHADOW_FADE_H);
            sm.visible = k > 0.01;
            sm.position.set(px, GRASS_Y + 0.006, pz);
            const s = SHADOW_R * (1 + alt * 0.07);
            sm.scale.set(s * 2, s * 2, 1);
            // ⚠️ 走**材质 ref** 拿 uniform，不要用上面 `useSeasonUniforms()`
            //    的返回值直接写 —— 那是 hook 的返回值，`react-hooks/immutability`
            //    （error）会拦下来。从 ref 拿到的 three 对象才是"外部系统"。
            //    （与 `SakuraTree` 写 `barkMatRef.current.uniforms.uTime` 同一条。）
            const smm = shadowMatRef.current;
            if (smm) smm.uniforms.uOpacity.value = SHADOW_OPACITY * k;
        }

        // ---- 霾：每帧从 scene.fog 拷（昼夜交替时飞机和天一起变）----
        const m = matRef.current;
        if (m) {
            const fog = scene.fog;
            if (fog) {
                toShaderColor(fog.color, m.uniforms.uHaze.value);
                m.uniforms.uHazeNear.value = fog.near;
                m.uniforms.uHazeFar.value = fog.far;
            }
        }
    });

    const handleClick = (e) => {
        // 与 `EntranceDoors.handleClick` 同一条做法：别让这一下继续冒泡去推门。
        e.stopPropagation();
        setGuitarCursor('auto');
        enterFlight();
    };

    return (
        <>
            <group name="airplane" ref={groupRef} position={PARKED.position.toArray()}>
                <mesh name="airplane-body" geometry={plane.body} frustumCulled={false}>
                    <shaderMaterial
                        ref={matRef}
                        vertexShader={PLANE_VERT}
                        fragmentShader={PLANE_FRAG}
                        uniforms={uniforms}
                    />
                </mesh>

                {/* 桨：独立的 mesh，绕局部 z 转。位置就是机头（`hubZ`）。 */}
                <group ref={propRef} position={[0, 0, plane.hubZ]}>
                    <mesh name="airplane-prop" geometry={plane.prop} frustumCulled={false}>
                        <shaderMaterial
                            vertexShader={PLANE_VERT}
                            fragmentShader={PLANE_FRAG}
                            uniforms={uniforms}
                        />
                    </mesh>
                </group>

                {/* 命中盒：不可见的盒子，只负责"点得到"。
                    ⚠️ 比飞机本身大一圈 —— 它在画面里只有百来个像素，
                       贴着几何做的命中盒会点不动（这是本项目一贯的做法，
                       见 `EntranceProps` 里鸟窝 / 兔子那两个命中盒）。
                    ⚠️ 飞行中**不挂**：那时再点一下没有任何意义，
                       而且相机会在航线外侧，命中盒可能挡住别的交互。 */}
                {!active && (
                    <mesh
                        name="airplane-hitbox"
                        position={[0, 0.05, 0]}
                        onClick={handleClick}
                        onPointerEnter={() => setGuitarCursor('pointer')}
                        onPointerLeave={() => setGuitarCursor('auto')}
                    >
                        <boxGeometry args={[PLANE.SPAN + 0.7, 1.55, PLANE.LEN + 0.7]} />
                        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                    </mesh>
                )}
            </group>

            {/* 地面投影。**不在飞机那个 group 里** —— 那个 group 会跟着横滚
                一起转，投影跟着转就歪了。它是地面上的东西，不属于机身。 */}
            <mesh
                ref={shadowRef}
                name="airplane-shadow"
                rotation={[-Math.PI / 2, 0, 0]}
                renderOrder={1}
                raycast={() => null}
            >
                <planeGeometry args={[1, 1]} />
                <shaderMaterial
                    ref={shadowMatRef}
                    vertexShader={PLANE_SHADOW_VERT}
                    fragmentShader={PLANE_SHADOW_FRAG}
                    uniforms={uniforms}
                    transparent
                    depthWrite={false}
                />
            </mesh>
        </>
    );
}

export default Airplane;
