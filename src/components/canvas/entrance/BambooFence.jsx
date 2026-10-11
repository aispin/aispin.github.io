import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSeason } from '../../../hooks/useSeason';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { sharedGeometry } from '../../../engine/resources';
import { bambooSeasonUniforms } from '../../../shaders/islandTextures';
import { seededRand, randRange } from '../../../engine/art';
import { BAMBOO_FENCE_ASPECT, makeBambooFenceTexture } from '../../../utils/entranceArt';

/**
 * BambooFence — 沿墙的矮竹篱（§6.3，P3）
 * ======================================
 *
 * 2026-10-11 改版：**竹竿和横档从贴图变成实体几何**（L2 的 WO-2）。
 *
 * 为什么改
 * --------
 * 原来是"一张程序化贴图 + 一块 alphaTest 平面"。正面看没问题，但院子
 * 能绕着看之后，绕到侧面它就是**字面意义上的一张纸** —— 厚度为零，
 * 而且单面材质从背后直接被剔除，整片消失。这是 L1「背面清单」里点名
 * 的一个洞。
 *
 * 现在：
 *   · **竹竿 + 横档** = 1 个 `InstancedMesh`（26 根立竹 + 2 道横档 = 28 个实例，
 *     1 次 draw call）。全项目原来零处 InstancedMesh，所以这里顺手把
 *     "竹竿怎么实例化"这条路修通（竹林 `BambooGrove` 用同款思路）。
 *   · **藤 + 叶** = 仍然一张 alphaTest 平面。理由：藤本来就是薄东西，
 *     一张纸对它是对的；而且 §6.3 规定"季节只改**攀爬植物**的配色"，
 *     叶色烘在贴图里最省事。贴图改成只画藤（`vineOnly`）。
 *
 * 一个 InstancedMesh 装下立竹和横档
 * ---------------------------------
 * 横档 = 转 90° 的竹竿，本来就能共用一个圆柱。真正的差别只有两点：
 *   · 横档**不摆**（绑在立竹上），立竹顶端摆；
 *   · 横档的竹节沿**长度**排（10 道），立竹的竹节沿**高度**排（2 道）。
 * 所以把这两件事做成**实例属性** `aBend` / `aNodes`，一个材质就够，
 * 不必为横档再开一个 InstancedMesh + 一份材质。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 位置：z 必须**大于门脸砖面的 0.15**，且**小于花箱的前脸 0.65**
 * ---------------------------------------------------------------------------
 * 门脸的青砖平面停在 z = 0.15，花箱箱体占 z ∈ [0.15, 0.65]、荷花缸占
 * z ∈ [0.095, 0.705]。取 **z = 0.24**：
 *   · 在砖面前面 ⇒ 看得见（不是被墙吞掉）；
 *   · 在花箱/缸的**内部** ⇒ 与它们重叠的那几段被不透明的箱体/缸体挡住，
 *     于是读成"竹篱沿墙一路铺过去，被花箱和缸打断" —— 这正是真院子的样子。
 * 平面**穿进**箱体内部是无害的：两者都在不透明 pass，深度测试直接把
 * 被挡住的那部分丢掉了（不是 transparent 排序问题）。
 *
 * ⚠️ 不写进 `config/entranceMetrics.js`：那是入口**竖向**几何的唯一真源，
 * 竹篱是独立摆件（§7 硬约束）。
 */

/** 篱高（世界单位）。真矮竹篱 ~0.4 m，按 1 单位 ≈ 0.863 m ⇒ 0.45 ≈ 0.39 m。 */
const FENCE_H = 0.45;
const FENCE_W = FENCE_H * BAMBOO_FENCE_ASPECT;

/** 立竹根数（与旧贴图一致，换了几何不该顺手改疏密）。 */
const CANE_N = 26;
/** 横档高度（占篱高的比例）。 */
const RAIL_Y = [0.30, 0.72];

/** 一根竹竿 = 单位圆柱（半径 1、高 1、5 边），实例矩阵负责半径/高度。 */
const CANE_SEGMENTS = 5;
const CANE_HEIGHT_SEGMENTS = 3;

/* ------------------------------------------------------------------ */
/* 着色器：竹竿（立竹 + 横档共用）                                      */
/* ------------------------------------------------------------------ */

const CANE_VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
attribute float aBend;    // 1 = 立竹（顶端摆），0 = 横档（绑死不摆）
attribute float aNodes;   // 竹节道数（沿竿身）
uniform float uTime;
uniform float uWind;
varying float vTint;
varying float vH;
varying float vNodes;
varying float vBend;
varying float vDepth;

void main() {
    vec3 p = position;
    float h = clamp(p.y + 0.5, 0.0, 1.0);   // 0 根部 · 1 梢部（圆柱高 1）
    vec4 ip = vec4(p, 1.0);
    #ifdef USE_INSTANCING
        ip = instanceMatrix * ip;
    #endif
    vec3 wp = (modelMatrix * ip).xyz;
    // 两列不同频率叠加：单频会看出"整片一起齐步走"
    float sway = sin(uTime * 1.15 + aPhase) * 0.7 + sin(uTime * 0.71 + aPhase * 1.7) * 0.3;
    float bend = h * h * aBend;
    wp.x += sway * uWind * bend;
    wp.z += cos(uTime * 0.95 + aPhase * 1.3) * uWind * 0.55 * bend;
    vTint = aTint;
    vH = h;
    vNodes = aNodes;
    vBend = aBend;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

const CANE_FRAG = /* glsl */ `
uniform vec3 uCulmA;
uniform vec3 uCulmB;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
varying float vTint;
varying float vH;
varying float vNodes;
varying float vBend;
varying float vDepth;

void main() {
    vec3 c = mix(uCulmA, uCulmB, vTint);
    // 竹节：沿竿身等距的一道道深色环。横档转了 90°，vH 于是沿**长度**跑，
    // 环也就顺着长度排 —— 正是竹子该有的样子，不需要为它单独写一套。
    float ring = abs(fract(vH * vNodes) - 0.5) * 2.0;
    c *= 0.86 + 0.14 * smoothstep(0.15, 0.75, ring);
    // 根部偏暗（埋在草里的那一截晒不到）。横档没有"根"，不该有这道渐变。
    c *= mix(1.0, 0.68 + 0.32 * vH, vBend);
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));
    gl_FragColor = vec4(c, 1.0);
}
`;

/** 实例散布。确定性：同一种子刷新一百次长得一模一样（项目契约 1）。 */
function buildFence() {
    const rand = seededRand('bamboo-fence-v1');
    const items = [];

    // ---- 立竹：等距 + 微抖（纯等距会读成"栅栏"）----------------------
    const step = FENCE_W / CANE_N;
    for (let i = 0; i < CANE_N; i++) {
        const x = -FENCE_W / 2 + i * step + (rand() - 0.5) * step * 0.16;
        const hFrac = 0.94 + rand() * 0.06;
        items.push({
            x,
            y: FENCE_H * hFrac * 0.5,
            z: 0,
            rotZ: 0,
            radius: randRange(rand, 0.0135, 0.0175),
            len: FENCE_H * hFrac,
            bend: 1,
            nodes: 2,
            phase: rand() * Math.PI * 2,
            tint: rand(),
        });
    }

    // ---- 横档：转 90°，贯穿整个宽度 -----------------------------------
    for (const frac of RAIL_Y) {
        items.push({
            x: 0,
            y: FENCE_H * frac,
            z: 0,
            rotZ: Math.PI / 2,
            radius: 0.019,
            len: FENCE_W,
            bend: 0,
            nodes: 10,
            phase: rand() * Math.PI * 2,
            tint: rand(),
        });
    }

    return items;
}

export function BambooFence({ position }) {
    const season = useSeason();
    const meshRef = useRef();
    const matRef = useRef();
    const scene = useThree((state) => state.scene);

    const items = useMemo(() => buildFence(), []);

    // 带实例属性的几何**不能**走 sharedGeometry：实例属性会被就地改写，
    // 共享出去会把所有使用者一起弄坏（engine/resources.js 的警告）。
    const geo = useMemo(() => {
        const g = new THREE.CylinderGeometry(1, 1, 1, CANE_SEGMENTS, CANE_HEIGHT_SEGMENTS, false);
        const n = items.length;
        const phase = new Float32Array(n);
        const tint = new Float32Array(n);
        const bend = new Float32Array(n);
        const nodes = new Float32Array(n);
        items.forEach((it, i) => {
            phase[i] = it.phase;
            tint[i] = it.tint;
            bend[i] = it.bend;
            nodes[i] = it.nodes;
        });
        g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        g.setAttribute('aBend', new THREE.InstancedBufferAttribute(bend, 1));
        g.setAttribute('aNodes', new THREE.InstancedBufferAttribute(nodes, 1));
        return g;
    }, [items]);

    const uniforms = useSeasonUniforms(
        (s) => ({
            ...bambooSeasonUniforms(s),
            uTime: { value: 0 },
            uWind: { value: 0.05 },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        []
    );

    // 矩阵只在挂载时写一次（风在 shader 里）。
    // ⚠️ 用 `useEffect` 不是 `useMemo`：写的是 three 的实例矩阵（副作用），
    //    返回 void。见 BambooGrove 里那条同样的注释。
    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        items.forEach((it, i) => {
            e.set(0, 0, it.rotZ);
            q.setFromEuler(e);
            pos.set(it.x, it.y, it.z);
            scl.set(it.radius, it.len, it.radius);
            m.compose(pos, q, scl);
            mesh.setMatrixAt(i, m);
        });
        mesh.count = items.length;
        mesh.instanceMatrix.needsUpdate = true;
    }, [items]);

    useFrame((state) => {
        const mat = matRef.current;
        if (!mat) return;
        mat.uniforms.uTime.value = state.clock.elapsedTime;
        const fog = scene.fog;
        if (fog) {
            mat.uniforms.uHaze.value.copy(fog.color);
            mat.uniforms.uHazeNear.value = fog.near;
            mat.uniforms.uHazeFar.value = fog.far;
        }
    });

    // 藤：只画攀爬植物，贴在竹竿**前面** 3 cm。
    // alphaTest（不是 transparent）：硬边抠图走不透明 pass，写深度 ⇒
    // 不会和花箱/缸互相排序（见 engine/resources.js 的 cutoutMaterial 契约）。
    const vineTex = makeBambooFenceTexture(season, { vineOnly: true });

    return (
        <group position={position}>
            <instancedMesh
                ref={meshRef}
                args={[geo, null, items.length]}
                frustumCulled={false}
            >
                <shaderMaterial
                    ref={matRef}
                    vertexShader={CANE_VERT}
                    fragmentShader={CANE_FRAG}
                    uniforms={uniforms}
                />
            </instancedMesh>

            {/* `DoubleSide`：藤本来就是薄东西，一张纸对它是对的 —— 但**单面**
                的纸从背后会被剔除、整片消失。alphaTest 走的是不透明 pass、
                写深度，双面不会引入排序问题（见 engine/resources.js 的
                cutoutMaterial 契约），所以这里直接开双面。 */}
            <mesh position={[0, FENCE_H / 2, 0.03]}>
                <primitive object={sharedGeometry('plane', FENCE_W, FENCE_H)} attach="geometry" />
                <meshStandardMaterial map={vineTex} alphaTest={0.5} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

export default BambooFence;
