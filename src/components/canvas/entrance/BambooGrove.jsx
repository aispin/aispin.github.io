import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { seededRand, randRange } from '../../../engine/art';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { bambooSeasonUniforms } from '../../../shaders/islandTextures';
import * as I from '../../../config/island';

/**
 * BambooGrove — 竹林：2 个 InstancedMesh，零贴图（L3a）。
 * ==================================================================
 *
 * 借 tidewater 的三件事
 * --------------------
 *   1. **散布用掩码**：竹子只长在"离岛心 16~25"这一圈（= 院子外、沙滩内），
 *      和岛的离岸距离场是同一个数 —— 不会种到海里，也不会挡住门。
 *   2. **确定性随机**：位置来自 `seededRand('bamboo')`，刷新一次和一百次
 *      长得一模一样（项目契约 1）。tidewater 的 `Scatter.js` 同理。
 *   3. **一根竹子一个实例，不是一根一个 mesh**：全项目原来**零处**
 *      InstancedMesh，420 根竹子若逐个建 mesh 会直接把基线（704 mesh）
 *      翻一倍。现在只加 2 个 mesh、2 次 draw。
 *
 * 风摆
 * ----
 * 在顶点着色器里做：位移 ∝ 高度的平方（根部不动、梢部摆得最多），
 * 相位来自每实例的属性 `aPhase`。CPU 每帧只改一个 `uTime`。
 *
 * ⚠️ 为什么不用 `MeshStandardMaterial`
 * ------------------------------------
 * 竹子要 400+ 根还带风，走标准材质就要给每根建独立材质才能有风，
 * 或者走 `onBeforeCompile` 打补丁（那是"改别人的 shader"，脆弱）。
 * 这里自己写一个 20 行的 ShaderMaterial，风、竹节、季节、霾全在里面，
 * 反而更短也更可控。
 * ⚠️ 霾（`uHaze*`）每帧从 `scene.fog` 拷 —— 见 IslandGround 那条注释。
 */

/* ------------------------------------------------------------------ */
/* 着色器                                                              */
/* ------------------------------------------------------------------ */

const CULM_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWind;
uniform float uHeight;
varying float vTint;
varying float vH;
varying float vDepth;

void main() {
    vec3 p = position;
    float h = clamp(p.y / uHeight + 0.5, 0.0, 1.0);   // 0 根部 · 1 梢部

    vec4 ip = vec4(p, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;

    // 两列不同频率叠加：单频会看出"整片竹林齐步走"
    float sway = sin(uTime * 1.05 + aPhase) * 0.7 + sin(uTime * 0.63 + aPhase * 1.7) * 0.3;
    float bend = h * h;                                // 根部不动
    wp.x += sway * uWind * bend;
    wp.z += cos(uTime * 0.9 + aPhase * 1.3) * uWind * 0.55 * bend;

    vTint = aTint;
    vH = h;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

const CULM_FRAG = /* glsl */ `
uniform vec3 uCulmA;
uniform vec3 uCulmB;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vTint;
varying float vH;
varying float vDepth;

void main() {
    vec3 c = mix(uCulmA, uCulmB, vTint);
    // 竹节：沿竿身等距的一道道深色环
    float ring = abs(fract(vH * 9.0) - 0.5) * 2.0;
    c *= 0.86 + 0.14 * smoothstep(0.15, 0.75, ring);
    // 根部偏暗（埋在草里的那一截晒不到）
    c *= 0.68 + 0.32 * vH;
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

const BLADE_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWind;
varying vec2 vUvB;
varying float vTint;
varying float vDepth;

void main() {
    vUvB = uv;
    vec4 ip = vec4(position, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;
    // 叶片挂在竿梢，跟着竿一起摆（同一相位）
    float sway = sin(uTime * 1.05 + aPhase) * 0.7 + sin(uTime * 0.63 + aPhase * 1.7) * 0.3;
    wp.x += sway * uWind;
    wp.z += cos(uTime * 0.9 + aPhase * 1.3) * uWind * 0.55;
    vTint = aTint;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

/**
 * 叶片形状：**程序化的披针形**，没有贴图。
 * `x` 是到中脉的距离，`y` 是沿叶长的比例 —— 两头收尖、中段最宽。
 */
const BLADE_FRAG = /* glsl */ `
uniform vec3 uBlade;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying vec2 vUvB;
varying float vTint;
varying float vDepth;

void main() {
    float y = clamp(vUvB.y, 0.0, 1.0);
    float x = abs(vUvB.x - 0.5) * 2.0;
    float w = sin(3.14159265 * pow(y, 0.75));   // 两头尖、中段宽
    if (x > w) discard;                          // 硬边抠图，不进透明队列
    vec3 c = uBlade * (0.78 + 0.22 * vTint);
    c *= 0.72 + 0.28 * y;                        // 叶尖更亮
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 散布                                                                */
/* ------------------------------------------------------------------ */

/** 竿的基准高度（instanceMatrix 的 y 缩放以它为单位）。 */
const BASE_H = 1;

function buildGrove(count) {
    // ⚠️ 种子 v1 → v2 的来历：v1 的竹林会**长在廊屋的屋面上**（老几何下
    //    走廊带 |x| < 6.5 且 z < 6）。散布序列变了，所以换种子名 —— 复用 v1
    //    会让"改了什么"这件事在 diff 里看不出来。
    // ⚠️ 2026-10-11 **没有**再升 v3：见下面排除带的注释 —— 那条判定现在
    //    一次都不会命中，改成显式 z 窗口**不改动任何一根竹子的位置**，
    //    所以沿用 v2，已验收的截图仍然有效。
    const rand = seededRand('bamboo-grove-v2');
    const culms = [];
    // 拒绝采样：抽到的位置落在建筑带里就重抽。守卫上限防死循环。
    let guard = 0;
    while (culms.length < count && guard++ < count * 8) {
        // 环带均匀采样：sqrt 让面积均匀，不然竹子全挤在内圈
        const t = Math.sqrt(rand());
        const r = I.BAMBOO_R_MIN + t * (I.BAMBOO_R_MAX - I.BAMBOO_R_MIN);
        const a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = I.ISLAND_CENTER[1] + Math.sin(a) * r;
        const h = randRange(rand, I.BAMBOO_H_MIN, I.BAMBOO_H_MAX);
        const radius = randRange(rand, 0.045, 0.085);
        const lean = randRange(rand, -0.06, 0.06);
        const spin = rand() * Math.PI * 2;
        const phase = rand() * Math.PI * 2;
        const tint = rand();
        // 让开"建筑带"：屋身 + 前院。竹叶从屋面 / 从院子里长出来会一眼假。
        //
        // ⚠️ 2026-10-11：这里原来写的是 `z < I.HOUSE_CLEAR_Z`。院子删掉之后
        //    `HOUSE_CLEAR_Z` 从 `config/island.js` 里一起没了 ⇒ 这个比较变成
        //    `z < undefined` = **恒为 false**，整条排除带静默失效。现在改成
        //    一个**显式的 z 窗口**，两端都从 config 读，以后再改屋身进深 /
        //    院深都不会再脱钩。
        //
        // 🔴 但请注意：**这条判定当前一次都不会命中**。带子 = `|x| < 12` 且
        //    `z ∈ [−2.85, 39.15]`；环带 `r ≥ BAMBOO_R_MIN = 24`，而带子相对
        //    岛心 (0, 18.15) 能取到的**最大**半径是角点 (±12, ±21) 的 24.19 ——
        //    所以两者只在一个贴着角点的极薄月牙里重叠（实测拒绝率 0.000%）。
        //    也就是说 `BAMBOO_R_MIN = 24` 这个数**本身**就是按这条带子定的
        //    （见 `config/island.js` 的 `HOUSE_CLEAR_HALF_W` 注释）。
        //    留它在这里是**不变量**，不是有效逻辑：谁要是把 `BAMBOO_R_MIN`
        //    调小，这条判定立刻接手，竹子不会突然穿屋。
        if (
            Math.abs(x) < I.HOUSE_CLEAR_HALF_W
            && z > I.HOUSE_BACK_Z - 1
            && z < I.HOUSE_CLEAR_BACK_Z
        ) continue;
        culms.push({ x, z, h, radius, lean, spin, phase, tint });
    }
    return culms;
}

export function BambooGrove({ lowTier = false }) {
    const culmRef = useRef();
    const bladeRef = useRef();
    // 材质 ref：每帧写 uniform 必须**穿过**它（`mat.uniforms.uTime.value`），
    // 不能直接改 `culmUniforms.uTime.value`。`useSeasonUniforms` 返回的对象
    // 被 React Compiler 判定为不可变，`react-hooks/immutability` 会报错；
    // 而 three 的材质实例不在 React 的数据流里，穿过 ref 改它天经地义。
    const culmMatRef = useRef();
    const bladeMatRef = useRef();
    const scene = useThree((state) => state.scene);

    const count = lowTier ? I.BAMBOO_COUNT_LOW : I.BAMBOO_COUNT_HIGH;
    const culms = useMemo(() => buildGrove(count), [count]);
    const bladesPer = lowTier ? 0 : I.BAMBOO_BLADES_PER_CULM;

    // ---- 几何体：带实例属性，所以**不能**用 sharedGeometry（改属性会连坐）
    const culmGeo = useMemo(() => {
        const g = new THREE.CylinderGeometry(0.75, 1, BASE_H, 6, 4, false);
        const phase = new Float32Array(count);
        const tint = new Float32Array(count);
        culms.forEach((c, i) => { phase[i] = c.phase; tint[i] = c.tint; });
        g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        return g;
    }, [culms, count]);

    const bladeCount = count * Math.max(bladesPer, 0);
    const bladeGeo = useMemo(() => {
        // 一片叶 = 一个 0.62 × 0.11 的平面，pivot 在叶柄（底边中点）
        const g = new THREE.PlaneGeometry(0.62, 0.11);
        g.translate(0, 0.055, 0);
        if (bladeCount > 0) {
            const phase = new Float32Array(bladeCount);
            const tint = new Float32Array(bladeCount);
            for (let i = 0; i < bladeCount; i++) {
                phase[i] = culms[i % count].phase;
                tint[i] = culms[i % count].tint;
            }
            g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
            g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        }
        return g;
    }, [bladeCount, count, culms]);

    // ---- 实例矩阵：一次性写死，之后不再动（风在 shader 里）
    const place = (mesh, items, perItem, write) => {
        if (!mesh) return;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        let k = 0;
        for (const c of items) {
            for (let j = 0; j < perItem; j++) {
                write(m, q, e, pos, scl, c, j);
                mesh.setMatrixAt(k++, m);
            }
        }
        mesh.count = k;
        mesh.instanceMatrix.needsUpdate = true;
    };

    const culmUniforms = useSeasonUniforms(
        (season) => ({
            ...bambooSeasonUniforms(season),
            uTime: { value: 0 },
            uWind: { value: I.BAMBOO_WIND },
            uHeight: { value: BASE_H },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        []
    );
    const bladeUniforms = useSeasonUniforms(
        (season) => ({
            ...bambooSeasonUniforms(season),
            uTime: { value: 0 },
            uWind: { value: I.BAMBOO_WIND * 1.4 },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        []
    );

    // 矩阵只在挂载 / 数量变化时写一次。
    // ⚠️ 这里是 `useEffect` 不是 `useMemo`：它不返回任何值，写的是 three
    //    的实例矩阵（副作用）。写成 useMemo 会被 `react-hooks/void-use-memo`
    //    判为错误 —— "记忆化一个没有返回值、只为了副作用的计算"本身就是
    //    在骗编译器。
    useEffect(() => {
        place(culmRef.current, culms, 1, (m, q, e, pos, scl, c) => {
            e.set(c.lean, c.spin, c.lean * 0.7);
            q.setFromEuler(e);
            pos.set(c.x, I.GROUND_Y + c.h / 2, c.z);
            scl.set(c.radius, c.h, c.radius);
            m.compose(pos, q, scl);
        });
        if (bladesPer > 0) {
            place(bladeRef.current, culms, bladesPer, (m, q, e, pos, scl, c, j) => {
                const a = c.spin + j * 2.2;
                e.set(-0.5 - j * 0.25, a, c.lean);
                q.setFromEuler(e);
                pos.set(c.x + Math.cos(a) * 0.12, I.GROUND_Y + c.h - 0.35 - j * 0.28, c.z + Math.sin(a) * 0.12);
                scl.set(1, 1, 1);
                m.compose(pos, q, scl);
            });
        }
    }, [culms, bladesPer]);

    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const cm = culmMatRef.current;
        const bm = bladeMatRef.current;
        if (!cm) return;
        cm.uniforms.uTime.value = t;
        const fog = scene.fog;
        if (fog) {
            cm.uniforms.uHaze.value.copy(fog.color);
            cm.uniforms.uHazeNear.value = fog.near;
            cm.uniforms.uHazeFar.value = fog.far;
        }
        if (!bm) return;
        bm.uniforms.uTime.value = t;
        if (fog) {
            bm.uniforms.uHaze.value.copy(fog.color);
            bm.uniforms.uHazeNear.value = fog.near;
            bm.uniforms.uHazeFar.value = fog.far;
        }
    });

    return (
        <group>
            <instancedMesh
                ref={culmRef}
                args={[culmGeo, null, count]}
                frustumCulled={false}
            >
                <shaderMaterial
                    ref={culmMatRef}
                    vertexShader={CULM_VERT}
                    fragmentShader={CULM_FRAG}
                    uniforms={culmUniforms}
                />
            </instancedMesh>

            {bladeCount > 0 && (
                <instancedMesh
                    ref={bladeRef}
                    args={[bladeGeo, null, bladeCount]}
                    frustumCulled={false}
                >
                <shaderMaterial
                    ref={bladeMatRef}
                    vertexShader={BLADE_VERT}
                    fragmentShader={BLADE_FRAG}
                    uniforms={bladeUniforms}
                    side={THREE.DoubleSide}
                />
                </instancedMesh>
            )}
        </group>
    );
}

export default BambooGrove;
