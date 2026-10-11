import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { bambooSeasonUniforms } from '../../../shaders/islandTextures';
import { CANE_VERT, CANE_FRAG } from '../../../shaders/caneFence';
import { makeCaneGeometry } from '../../../utils/caneFence';

/**
 * CaneFenceMesh — 把 N 段直篱笆画成**一个** InstancedMesh。
 * ==================================================================
 *
 * 为什么不一段一个 InstancedMesh
 * ------------------------------
 * 门外那片院子有 5 段（左右 + 正面两翼 + 门口两根立柱），分开画就是
 * 5 次 draw + 5 份材质 + 5 个 `useFrame`。摆放折进实例矩阵是**免费的** ——
 * 竹竿本来就是单位圆柱，矩阵里多乘一个 yaw 而已。
 *
 * 摆放怎么进矩阵
 * --------------
 * 每段篱笆的实例清单是**局部**的（x 沿篱笆、z 恒 0），这里把它拍平成一条
 * 全局清单，每项带上所属那段的 `position` / `rotationY`，再写矩阵：
 *
 *     e.set(0, yaw, rotZ)      // Euler 默认 XYZ 序，x = 0 ⇒ R = Ry(yaw)·Rz(rotZ)
 *     pos.set(ox + it.x·cos(yaw), oy + it.y, oz − it.x·sin(yaw))
 *
 * 即**先**绕局部 z 把横档放平（立竹 `rotZ = 0` 时是恒等），**再**整体转向。
 * `it.z` 恒为 0，所以位置只要把 x 按 yaw 转一次。
 *
 * ⚠️ `runs` 必须是**稳定引用**（调用方用 `useMemo(..., [])` 建）。它一变，
 *    下面的 `flat` / `geo` 就会重建（dispose + 重新上传）。
 */

/**
 * @param {{ items: Array, position?: number[], rotationY?: number }[]} runs
 */
export function CaneFenceMesh({ runs }) {
    const meshRef = useRef();
    const matRef = useRef();
    const scene = useThree((state) => state.scene);

    /** 拍平成一条实例清单：每项带上它所属那一段的摆放。 */
    const flat = useMemo(() => {
        const out = [];
        for (const run of runs) {
            const yaw = run.rotationY || 0;
            const [ox, oy, oz] = run.position || [0, 0, 0];
            for (const it of run.items) out.push({ it, ox, oy, oz, yaw });
        }
        return out;
    }, [runs]);

    const geo = useMemo(() => makeCaneGeometry(flat.map((f) => f.it)), [flat]);

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
    //    返回 void。见 `BambooGrove` 里那条同样的注释。
    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        flat.forEach(({ it, ox, oy, oz, yaw }, i) => {
            const cy = Math.cos(yaw);
            const sy = Math.sin(yaw);
            e.set(0, yaw, it.rotZ);
            q.setFromEuler(e);
            pos.set(ox + it.x * cy, oy + it.y, oz - it.x * sy);
            scl.set(it.radius, it.len, it.radius);
            m.compose(pos, q, scl);
            mesh.setMatrixAt(i, m);
        });
        mesh.count = flat.length;
        mesh.instanceMatrix.needsUpdate = true;
    }, [flat]);

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

    return (
        <instancedMesh
            ref={meshRef}
            args={[geo, null, flat.length]}
            frustumCulled={false}
        >
            <shaderMaterial
                ref={matRef}
                vertexShader={CANE_VERT}
                fragmentShader={CANE_FRAG}
                uniforms={uniforms}
            />
        </instancedMesh>
    );
}

export default CaneFenceMesh;
