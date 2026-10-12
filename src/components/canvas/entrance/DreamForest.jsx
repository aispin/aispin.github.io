import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { seededRand, randRange } from '../../../engine/art';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { forestSeasonUniforms } from '../../../shaders/entranceTextures';
import {
    FOREST_TRUNK_VERT, FOREST_TRUNK_FRAG,
    FOREST_BALL_VERT, FOREST_BALL_FRAG,
} from '../../../shaders/dreamForest';
import * as I from '../../../config/island';
import { toShaderColor } from '../../../config/theme';

/**
 * DreamForest — 超现实幻想梦幻森林（WO-15，2026-10-12）。
 * ==================================================================
 *
 * 用户原话：「竹林换成超现实幻想梦幻森林」，参考图三张（巨树 + 发光的绿球冠、
 * 细杆顶着圆球、雾化的一层层球）。形制与三条判据写在
 * `src/shaders/dreamForest.js` 的文件头。
 *
 * 「换成」= 那道竹林**真的没了**
 * ---------------------------------
 * `BambooGrove.jsx` 整个删除；`config/island.js` 里 `BAMBOO_*` 一整套改名成
 * `FOREST_*`（改的是**值**和**名字**，不是另开一套并存的常量 —— 留着一个叫
 * BAMBOO 的常量指着一片不存在的竹林比魔数更坑）。
 *
 * 沿用 `BambooGrove` 的四件事（都验过，没必要重造）
 * ------------------------------------------------
 *   1. **2 个 InstancedMesh**：杆 1 个、球 1 个。170 棵树若逐个建 mesh 会把
 *      基线（704 mesh）直接翻倍。
 *   2. **确定性散布**：位置来自 `seededRand('dream-forest-v1')`，刷新一次和
 *      一百次长得一模一样（项目契约 1）。
 *   3. **风在顶点着色器里**：CPU 每帧只改一个 `uTime`；霾（`uHaze*`）每帧从
 *      `scene.fog` 拷，所以昼夜交替时林子和天一起变。
 *   4. 🔴 **贴脸就让开**（DR-H 的 H1）：环绕轨道和森林环**必然相交**。杆按实例
 *      原点缩横截面（和竹子一样）；**球要缩向球心**（`position * keep` 之后再
 *      乘实例矩阵）—— 球心不在世界原点上，缩原点会把球推走而不是缩小。
 *
 * 🔴 两条"和竹子不一样"的地方
 * ---------------------------
 *   · **球冠要单独过一遍走廊横截面**（`FOREST_CORRIDOR_X/Y`）。竹子是直上直下
 *     的杆，按 |x| 一刀切就够；球冠半径最大 3.2，站在 x=5.2 的树球冠能伸到
 *     x=2.0 —— 那就是"一颗绿球挂在走廊里"。
 *   · **球是刚体**：整球平移，不按顶点高度弯（按顶点弯会把圆拉扁，而"完美的
 *     圆"是这套梦幻语汇的第一条）。
 */

/* ------------------------------------------------------------------ */
/* 散布                                                                */
/* ------------------------------------------------------------------ */

/** 杆的基准高度（instanceMatrix 的 y 缩放以它为单位）。 */
const BASE_H = 1;

function buildForest(count) {
    const rand = seededRand('dream-forest-v1');
    const trees = [];
    const balls = [];
    let guard = 0;
    while (trees.length < count && guard++ < count * 8) {
        // 环带均匀采样：sqrt 让面积均匀，不然全挤在内圈
        const t = Math.sqrt(rand());
        const r = I.FOREST_R_MIN + t * (I.FOREST_R_MAX - I.FOREST_R_MIN);
        const a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = I.ISLAND_CENTER[1] + Math.sin(a) * r;

        // 建筑带（屋身 + 前院）：竖直的杆长在屋面 / 院子里会一眼假
        if (
            Math.abs(x) < I.HOUSE_CLEAR_HALF_W
            && z > I.HOUSE_BACK_Z - 1
            && z < I.HOUSE_CLEAR_BACK_Z
        ) continue;

        // 🔴 屋身**之前**一棵都不要（2026-10-12，用户第 2 条：「幻想森林只出现
        //    在老房子周边及后面。前面不需要。」）。切在屋身前墙那条线上 ⇒
        //    留下的是屋身两侧 + 屋后，前院外面那一片整个清掉。
        //    判据：`harness/probe-forest-corridor.mjs` 的"前面"那一条。
        if (z > I.FOREST_FRONT_LIMIT_Z) continue;

        // 🔴 走廊的横截面：**任何 z 都不许有**（2026-10-11 用户报的
        //    「进门后……竹子出现了」）。走廊往 −z 是无限的，所以这必须是
        //    一条垂直于它的横截面判据，不能写成沿线的一段 z 区间。
        if (Math.abs(x) < I.CORRIDOR_CLEAR_HALF_W) continue;

        const h = randRange(rand, I.FOREST_H_MIN, I.FOREST_H_MAX);
        const radius = randRange(rand, I.FOREST_TRUNK_R_MIN, I.FOREST_TRUNK_R_MAX);
        const lean = randRange(rand, -0.05, 0.05);
        const spin = rand() * Math.PI * 2;
        const phase = rand() * Math.PI * 2;
        const tint = rand();
        const ballR = randRange(rand, I.FOREST_BALL_R_MIN, I.FOREST_BALL_R_MAX);
        trees.push({ x, z, h, radius, lean, spin, phase, tint });

        /**
         * 把一个球推到走廊横截面之外。
         * 走廊是 |x| ≤ `FOREST_CORRIDOR_X` 且 y ≤ `FOREST_CORRIDOR_Y` 那条管子；
         * 球只要**整体**落在这条管子之外就行（往外推，不缩小 —— 缩球会看出破形）。
         */
        const clearBall = (bx, by, br) => {
            const intrudes = Math.abs(bx) - br < I.FOREST_CORRIDOR_X && by - br < I.FOREST_CORRIDOR_Y;
            if (!intrudes) return bx;
            const sign = bx < 0 ? -1 : 1;
            return sign * (I.FOREST_CORRIDOR_X + br + 0.25);
        };

        // 主球：坐在杆顶（咬进去一点，接口不留缝）
        const topY = h - ballR * 0.42;
        const bx = clearBall(x + lean * h * 0.5, topY, ballR);
        balls.push({ x: bx, y: topY, z, r: ballR, phase, tint });

        // 浮球：参考图里那种"和树干脱开、悬在旁边"的小球
        if (rand() < I.FOREST_FLOAT_CHANCE) {
            const fr = ballR * randRange(rand, 0.42, 0.68);
            const fa = rand() * Math.PI * 2;
            const fd = ballR * randRange(rand, 0.9, 1.5);
            const fx = x + Math.cos(fa) * fd;
            const fy = h * randRange(rand, 0.52, 0.92);
            const fz = z + Math.sin(fa) * fd;
            balls.push({
                x: clearBall(fx, fy, fr), y: fy, z: fz, r: fr,
                phase: phase + randRange(rand, 0.4, 1.6),
                tint: rand(),
            });
        }
    }
    return { trees, balls };
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

export function DreamForest({ lowTier = false }) {
    const trunkRef = useRef();
    const ballRef = useRef();
    // 材质 ref：每帧写 uniform 必须**穿过**它（`mat.uniforms.uTime.value`）。
    // `useSeasonUniforms` 返回的对象被 React Compiler 判定为不可变，直接改
    // 会踩 `react-hooks/immutability`；而 three 的材质实例不在 React 的数据流里。
    const trunkMatRef = useRef();
    const ballMatRef = useRef();
    const scene = useThree((state) => state.scene);

    const count = lowTier ? I.FOREST_COUNT_LOW : I.FOREST_COUNT_HIGH;
    const { trees, balls } = useMemo(() => buildForest(count), [count]);

    // ---- 几何体：带实例属性，所以**不能**用 sharedGeometry（改属性会连坐）
    const trunkGeo = useMemo(() => {
        // 顶细根粗（0.68），细高杆才有"从地里抽出来"的感觉
        const g = new THREE.CylinderGeometry(0.68, 1, BASE_H, 6, 4, false);
        const phase = new Float32Array(count);
        const tint = new Float32Array(count);
        trees.forEach((c, i) => { phase[i] = c.phase; tint[i] = c.tint; });
        g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        return g;
    }, [trees, count]);

    const ballCount = balls.length;
    const ballGeo = useMemo(() => {
        // 🔴 10×7 = 140 个三角形。再细没必要：球是**平滑法线**，轮廓已经够圆，
        //    而 170 棵 × 每棵 1~2 个球的三角形数是这一条新增里最贵的一笔。
        const g = new THREE.SphereGeometry(1, 10, 7);
        if (ballCount > 0) {
            const phase = new Float32Array(ballCount);
            const tint = new Float32Array(ballCount);
            balls.forEach((b, i) => { phase[i] = b.phase; tint[i] = b.tint; });
            g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
            g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        }
        return g;
    }, [balls, ballCount]);

    // ---- 实例矩阵：一次性写死，之后不再动（风在 shader 里）
    useEffect(() => {
        const tm = trunkRef.current;
        if (tm) {
            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            const e = new THREE.Euler();
            const pos = new THREE.Vector3();
            const scl = new THREE.Vector3();
            trees.forEach((c, i) => {
                e.set(c.lean, c.spin, c.lean * 0.7);
                q.setFromEuler(e);
                pos.set(c.x, I.GROUND_Y + c.h / 2, c.z);
                scl.set(c.radius, c.h, c.radius);
                m.compose(pos, q, scl);
                tm.setMatrixAt(i, m);
            });
            tm.count = trees.length;
            tm.instanceMatrix.needsUpdate = true;
        }
        const bm = ballRef.current;
        if (bm) {
            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            const pos = new THREE.Vector3();
            const scl = new THREE.Vector3();
            balls.forEach((b, i) => {
                pos.set(b.x, b.y, b.z);
                scl.set(b.r, b.r, b.r);
                m.compose(pos, q.identity(), scl);
                bm.setMatrixAt(i, m);
            });
            bm.count = balls.length;
            bm.instanceMatrix.needsUpdate = true;
        }
    }, [trees, balls]);

    // ---- 材质：杆与球共用一套 uniform 对象（季节 + 时间 + 霾 + 相机）
    const uniforms = useSeasonUniforms(
        (season) => ({
            ...forestSeasonUniforms(season),
            uTime: { value: 0 },
            uWind: { value: I.FOREST_WIND },
            uHeight: { value: BASE_H },
            uGroundY: { value: I.GROUND_Y },
            uSpan: { value: I.FOREST_H_MAX },
            uLightDir: { value: new THREE.Vector3(5, 8.5, 5).normalize() },
            uSpeckle: { value: 0.58 },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
            // DR-H 的 H1：贴脸就让开。每帧在 useFrame 里写 uCamPos。
            uCamPos: { value: new THREE.Vector3() },
            uFadeNear: { value: I.FOREST_FADE_NEAR },
            uFadeFar: { value: I.FOREST_FADE_FAR },
        }),
        []
    );

    useFrame((state) => {
        // 两个材质引用的是**同一份 uniform 对象**，所以这里只写一遍就够了。
        const tm = trunkMatRef.current;
        if (!tm) return;
        tm.uniforms.uTime.value = state.clock.elapsedTime;
        tm.uniforms.uCamPos.value.copy(state.camera.position);
        const fog = scene.fog;
        if (fog) {
            toShaderColor(fog.color, tm.uniforms.uHaze.value);
            tm.uniforms.uHazeNear.value = fog.near;
            tm.uniforms.uHazeFar.value = fog.far;
        }
    });

    return (
        // `name` 是给 harness 用的（与 `house-shell` / `infinite-corridor` 同一套）：
        // 排查"进场/退场时画面上多出来什么"时，探针要能把屏幕上的每一格归属到
        // 某个**顶层 group**。
        <group name="dream-forest">
            <instancedMesh
                ref={trunkRef}
                args={[trunkGeo, null, count]}
                frustumCulled={false}
            >
                <shaderMaterial
                    ref={trunkMatRef}
                    vertexShader={FOREST_TRUNK_VERT}
                    fragmentShader={FOREST_TRUNK_FRAG}
                    uniforms={uniforms}
                />
            </instancedMesh>

            {ballCount > 0 && (
                <instancedMesh
                    ref={ballRef}
                    args={[ballGeo, null, ballCount]}
                    frustumCulled={false}
                >
                    <shaderMaterial
                        ref={ballMatRef}
                        vertexShader={FOREST_BALL_VERT}
                        fragmentShader={FOREST_BALL_FRAG}
                        uniforms={uniforms}
                    />
                </instancedMesh>
            )}
        </group>
    );
}

export default DreamForest;
