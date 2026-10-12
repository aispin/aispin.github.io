import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { sharedGeometry } from '../../../engine/resources';
import { makeCloudTexture } from '../../../utils/cloudArt';
import { CLOUD_SPRITES, toShaderColor } from '../../../config/theme';
import {
    SKY_CLOUD_SPRITES, placementsForSlot, spriteForSlot,
} from '../../../config/skyClouds';
import { CLOUD_VERT, CLOUD_FRAG, CLOUD_SHAPE } from '../../../shaders/skyClouds';

/**
 * SkyClouds — 天上那几朵云（WO-20，2026-10-12）。
 * ==================================================================
 *
 * 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」
 *
 * 摆位在 `config/skyClouds.js`（确定性），上色在 `shaders/skyClouds.js`，
 * 云的**形状**沿用本项目自己的 `utils/cloudArt.js`（摄影室那八张水墨云）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 颜色**只有一个真源**：天空穹顶的 uniform
 * ---------------------------------------------------------------------------
 * 云顶 / 云底 / 朝阳色**不在这里另立色板**，而是每帧从天空穹顶的
 * `uZenith / uHorizon / uCloud / uGlow` 派生。理由是这套项目已经栽过一次：
 * "同一个事实存两份，迟早不同步"（甬路冻在首季那条）。
 *
 * 具体地说，如果这里自己算一遍季节色，那么：
 *   · `SceneLighting` 改一季的端点 ⇒ 云还是旧色；
 *   · 昼夜过渡（0.9 s）时天空在插值、云**不插** ⇒ 天黑了云还亮着。
 * 从穹顶读就没有这两个问题 —— 云和天**不可能**不同步。
 *
 * 代价：穹顶的材质要能被找到。所以给那个 mesh 挂了 `name="sky-dome"`
 * （见 `SceneLighting.jsx`），这里只查一次。**这是显式接口，不是巧合。**
 *
 * ---------------------------------------------------------------------------
 * 为什么是 billboard（面片），不是 3D 云团
 * ---------------------------------------------------------------------------
 * 参考实现的云是 `MarchingCubes` 雕的 metaball：一次烘焙 ≈ 340 万次距离
 * 计算 × 4 变体 —— 它有一次性的 loading 屏，本项目没有。而且本项目
 * **已经有自己的云**（水墨素描：白身 + 墨线 + 腹灰），搬一套紫色 3D 云
 * 进来等于在自家院子里挂别人的画。见 `config/skyClouds.js` 顶上那段。
 *
 * billboard 的做法与 `WeatherLayer` / `GalleryClouds` 一致：
 * `quaternion.copy(camera.quaternion)` ⇒ 永远正对镜头、不会侧翻成一条线。
 * 这里多一层：**每帧把矩阵写进 `InstancedMesh`**，所以一个变体只要 1 次 draw。
 *
 * ⚠️ `frustumCulled` **保持默认（开）**，但必须在写完实例矩阵之后
 *    调一次 `computeBoundingSphere()` —— 否则自动包围球是按"所有实例都在
 *    原点"算的，一转身整组云就被剔掉。
 *    （`InstancedMesh.computeBoundingSphere` 取的是"实例中心均值 + 最大
 *      `|p−中心| + 几何半径`"，而 billboard 的旋转**不改变**实例中心
 *      （它就是 `p`），所以算一次就够，不用每帧重算。）
 */

/** 复用的临时量（每帧不分配）。 */
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export function SkyClouds() {
    const scene = useThree((state) => state.scene);

    // 每个**槽位**一个 InstancedMesh（⇒ 每槽位 1 次 draw，三张素描共 3 次）。
    // 🔴 `slot`（第几个 InstancedMesh）与 `sprite`（用哪张素描）**不是一回事**
    //    —— 混用会让 `placementsForSlot(6)` 返回空数组（探针 P1 抓到的）。
    const groups = useMemo(
        () => SKY_CLOUD_SPRITES.map((_, slot) => {
            const sprite = spriteForSlot(slot);
            return {
                slot,
                sprite,
                aspect: CLOUD_SPRITES[sprite].aspect,
                placements: placementsForSlot(slot),
                texture: makeCloudTexture(sprite, CLOUD_SPRITES[sprite].aspect),
            };
        }),
        [],
    );

    const meshRefs = useRef([]);
    const matRefs = useRef([]);

    // 天空穹顶（颜色真源）。只查一次 —— 见文件头。
    const skyRef = useRef(null);

    // 每帧复用的临时量
    const scratch = useRef({
        m: new THREE.Matrix4(),
        q: new THREE.Quaternion(),
        spin: new THREE.Quaternion(),
        pos: new THREE.Vector3(),
        scl: new THREE.Vector3(),
        top: new THREE.Color(),
        bottom: new THREE.Color(),
        gold: new THREE.Color(),
        haze: new THREE.Color(),
    });

    /** 几何：所有变体共用一张单位平面（尺寸每帧由实例矩阵给）。 */
    const geometry = sharedGeometry('plane', 1, 1);

    // 先把实例矩阵写一遍（否则第一帧全堆在原点），再算一次包围球。
    useLayoutEffect(() => {
        const s = scratch.current;
        const identity = new THREE.Quaternion();
        groups.forEach((g, gi) => {
            const mesh = meshRefs.current[gi];
            if (!mesh) return;
            writeInstances(mesh, g.placements, identity, g.aspect, s);
            mesh.computeBoundingSphere();
        });
        // 只跑一次：摆位是常量，`spin` 也是常量，`scratch` / `identity` 是 ref/局部量。
    }, [groups]);

    useFrame((state) => {
        const s = scratch.current;

        // ---- 颜色真源：天空穹顶（查一次）----
        if (!skyRef.current) {
            scene.traverse((o) => {
                if (!skyRef.current && o.material?.uniforms?.uStrata) skyRef.current = o;
            });
        }
        const sky = skyRef.current?.material?.uniforms;

        // ---- 每帧写 billboard 矩阵 ----
        // 相机四元数直接抄过来 ⇒ 面片永远正对镜头（和 GalleryClouds 同一条）。
        for (let gi = 0; gi < groups.length; gi += 1) {
            const mesh = meshRefs.current[gi];
            if (!mesh) continue;
            writeInstances(mesh, groups[gi].placements, state.camera.quaternion, groups[gi].aspect, s);
        }

        // ---- uniform ----
        const fog = scene.fog;
        for (const mat of matRefs.current) {
            if (!mat) continue;
            const u = mat.uniforms;
            if (sky) {
                // 云顶 = 天顶色偏朝阳（云被上面的太阳照亮），再提一档；
                // 云底 = 云带色（天空里那条云的颜色）偏天顶。
                // ⚠️ 都在**屏幕值**空间里插值 —— 不是物理正确的做法，
                //    但云和天同源，这个近似看不出来。
                s.top.copy(sky.uZenith.value).lerp(sky.uGlow.value, 0.28).multiplyScalar(1.04);
                s.bottom.copy(sky.uCloud.value).lerp(sky.uZenith.value, 0.22);
                u.uTop.value.copy(s.top);
                u.uBottom.value.copy(s.bottom);
                u.uGold.value.copy(sky.uGlow.value);
                u.uSunDir.value.copy(sky.uSunDir.value);
            }
            if (fog) {
                // 霾和飞机 / 两棵树 / 竹林同一条：每帧从 scene.fog 拷，
                // 昼夜交替时云和世界一起变。
                toShaderColor(fog.color, s.haze);
                u.uHaze.value.copy(s.haze);
                u.uHazeNear.value = fog.near;
                u.uHazeFar.value = fog.far;
            }
        }
    });

    return (
        <>
            {groups.map((g, gi) => (
                <instancedMesh
                    key={g.slot}
                    name={`sky-cloud-${g.slot}`}
                    ref={(el) => { meshRefs.current[gi] = el; }}
                    args={[geometry, undefined, g.placements.length]}
                    /* 🔴 显式 -1：three 对**透明**物排序时取的是 `matrixWorld`
                       的平移，而 InstancedMesh 自己的变换是单位矩阵 ⇒ 不显式
                       指定的话，这三组云会被当成"在原点"，排序纯属碰运气。
                       云是全场最远的东西，所以让它**最先**画（透明队列内部）。 */
                    renderOrder={-1}
                    raycast={() => null}
                >
                    <shaderMaterial
                        ref={(el) => { matRefs.current[gi] = el; }}
                        vertexShader={CLOUD_VERT}
                        fragmentShader={CLOUD_FRAG}
                        uniforms={{
                            uMap: { value: g.texture },
                            uTop: { value: new THREE.Color(1, 1, 1) },
                            uBottom: { value: new THREE.Color(0.8, 0.82, 0.85) },
                            uGold: { value: new THREE.Color(1, 0.92, 0.75) },
                            uSunDir: { value: new THREE.Vector3(0.6, 0.6, 0.5).normalize() },
                            uHaze: { value: new THREE.Color(0.9, 0.92, 0.9) },
                            uHazeNear: { value: 20 },
                            uHazeFar: { value: 100 },
                            uOpacity: { value: CLOUD_SHAPE.OPACITY },
                            uInk: { value: CLOUD_SHAPE.INK },
                            uGoldAmt: { value: CLOUD_SHAPE.GOLD_AMT },
                        }}
                        transparent
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </instancedMesh>
            ))}
        </>
    );
}

/**
 * 把一个变体的全部实例写成 billboard 矩阵。
 *
 * `M = T(p) · R(camera) · Rz(spin) · S(w, h, 1)`
 *
 * ⚠️ `h` 由 `aspect` 反解 —— **不能用贴图自己的宽高比**：贴图是按
 *    `makeCloudTexture(index, aspect)` 画进那个比例的画布的，所以
 *    `CLOUD_SPRITES[i].aspect` 才是真值（`GalleryClouds` 里也是这么写的，
 *    那份注释写得很清楚）。
 */
function writeInstances(mesh, placements, cameraQuaternion, aspect, s) {
    for (let i = 0; i < placements.length; i += 1) {
        const p = placements[i];
        const h = p.scale / (aspect || 1.8);
        s.q.copy(cameraQuaternion).multiply(s.spin.setFromAxisAngle(AXIS_Z, p.spin));
        s.m.compose(
            s.pos.set(p.x, p.y, p.z),
            s.q,
            s.scl.set(p.scale, h, 1),
        );
        mesh.setMatrixAt(i, s.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
}

export default SkyClouds;
