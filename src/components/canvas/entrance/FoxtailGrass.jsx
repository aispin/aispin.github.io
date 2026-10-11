import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { foxtailSeasonUniforms } from '../../../shaders/entranceTextures';
import { FOXTAIL_VERT, FOXTAIL_FRAG } from '../../../shaders/foxtailGrass';
import { seededRand } from '../../../engine/art';
import {
    GRASS_SINK,
    buildFoxtailWall,
    makeBladeGeometry,
    makeSeedGeometry,
} from '../../../utils/foxtailGrass';

/**
 * FoxtailGrass — 屋身前墙脚下那一条**狗尾巴草草带**（2026-10-11）。
 * ==================================================================
 *
 * 用户：「窗下的竹篱笆换成狗尾巴草看看效果，门口两边都要，和墙宽一样。
 * 注意不能和花箱穿透了。」
 *
 * 它取代了原来的 `BambooFence`（那道 3.65 长、0.45 高的矮竹篱）。
 *
 * 🔴 为什么必须是实体几何，不能是 alphaTest 平面
 * ---------------------------------------------
 * 竹篱当年就是这个教训（那段长注释还在 `BambooFence.jsx` 里）：一张平面
 * 正面看着没问题，**绕到侧面就是字面意义上的一张纸** —— 厚度为零，而且
 * 单面材质从背后直接被剔除，整片消失。院子现在能绕着看，所以草叶是
 * **3 棱锥台**、穗是**纺锤体**，任何角度都站得住。
 *
 * 🔴 两个 InstancedMesh，不是 100+ 个 mesh
 * ---------------------------------------
 * 22 单位铺满大约 100 丛、560 片叶 + 90 个穗。分成叶与穗两条（**2 次
 * draw call**），共用**同一个 uniforms 对象**（于是 `useFrame` 只算一次风与雾）。
 * 这和 `CaneFenceMesh` 的思路一样，只是那里把 N 段拍平成一条清单，这里
 * 本来就是一条。
 *
 * 🔴 "不能和花箱穿透"是**算出来**的，不是画的时候躲一下
 * --------------------------------------------------
 * 障碍物（台明 / 白狗 / 荷花缸 / 花箱）的包围盒是**探针量出来的**
 * （`harness/probe-wallbase-strip.mjs`），生成器对每一片叶算一个**扫掠
 * 包围盒**（根部点 → 叶尖点，再按叶宽外扩）做三维相交测试，相交就**不生成**。
 * 所以草**不可能**长到花箱里：不是"看起来没碰上"，而是"那片叶根本不存在"。
 * 详见 `utils/foxtailGrass.js` 顶上那两段（为什么按片判而不是按段判）。
 *
 * ⚠️ 不写进 `config/entranceMetrics.js`：那是入口**竖向**几何的唯一真源，
 *    草是独立摆件（§7 硬约束），和竹篱同一待遇。
 */

export function FoxtailGrass({ position }) {
    const scene = useThree((state) => state.scene);
    const bladeRef = useRef();
    const seedRef = useRef();
    const matRef = useRef();

    /**
     * 实例清单。`buildFoxtailWall` 在**生成过程中**就把会碰到障碍物的叶片
     * 丢掉了（按每片叶的扫掠包围盒判，见 `utils/foxtailGrass.js`）——
     * 所以这里的两个数组**天生**不含穿透：不是渲染时躲开，是根本不存在。
     */
    const { blades, seeds } = useMemo(
        () => buildFoxtailWall(seededRand('foxtail-wall-v1')),
        []
    );

    const bladeGeo = useMemo(() => makeBladeGeometry(blades), [blades]);
    const seedGeo = useMemo(() => makeSeedGeometry(seeds), [seeds]);

    // 几何体是这里 new 的（带实例属性，不能共享、不能走 sharedGeometry），
    // 所以卸载时要自己释放 —— 否则换季/重挂会一路漏显存。
    useEffect(() => () => bladeGeo.dispose(), [bladeGeo]);
    useEffect(() => () => seedGeo.dispose(), [seedGeo]);

    /**
     * 四季色板。⚠️ 走 `useSeasonUniforms`（对象身份锁死），换季时只就地改
     * `.value`。换掉 uniforms 对象会让 three 缓存的 `uniformsList` 还指着旧
     * 对象 ⇒ 画面**静默冻在首季**（见 `hooks/useSeasonUniforms.js` 的长注释）。
     */
    const uniforms = useSeasonUniforms(
        (s) => ({
            ...foxtailSeasonUniforms(s),
            uTime: { value: 0 },
            // 草比竹篱还轻，摆幅取竹篱（0.05）的一半量级；竹篱本身又比竹林
            // （0.34）安静一个量级。
            uWind: { value: 0.032 },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        []
    );

    /**
     * 矩阵只在清单变化时写一次（风在 shader 里做）。
     *
     * 三个约定，缺一个草就长歪：
     *   · `e.set(0, yaw, tilt)` → R = Ry(yaw)·Rz(tilt)：**先**在叶片自己的
     *     平面里往外倒，**再**转到各自的朝向（和 `CaneFenceMesh` 同一套）；
     *   · 几何体的 y 是 **0..1**（根部在原点）⇒ 倾斜是绕根部转，草从地面
     *     散开而不会浮起来；
     *   · `GRASS_SINK` 把整条草带往下埋一点，地面高低差（草坪 / 台明只差
     *     4 cm，但探针量的是摆件基准）就不可能露出一条缝。
     */
    useEffect(() => {
        const write = (mesh, list) => {
            if (!mesh) return;
            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            const e = new THREE.Euler();
            const p = new THREE.Vector3();
            const sc = new THREE.Vector3();
            list.forEach((it, i) => {
                e.set(0, it.yaw, it.tilt);
                q.setFromEuler(e);
                p.set(it.x, (it.y || 0) - GRASS_SINK, it.z);
                sc.set(it.w, it.h, it.t);
                m.compose(p, q, sc);
                mesh.setMatrixAt(i, m);
            });
            mesh.count = list.length;
            mesh.instanceMatrix.needsUpdate = true;
        };
        write(bladeRef.current, blades);
        write(seedRef.current, seeds);
    }, [blades, seeds]);

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

    // `frustumCulled={false}`：实例矩阵是挂载后写的，three 的自动包围球会
    // 按"所有实例都在原点"算，一转身整片草就被剔掉（`CaneFenceMesh` 同理）。
    const common = {
        vertexShader: FOXTAIL_VERT,
        fragmentShader: FOXTAIL_FRAG,
        uniforms,
    };

    return (
        <group position={position}>
            <instancedMesh
                ref={bladeRef}
                name="foxtail-blades"
                args={[bladeGeo, null, blades.length]}
                frustumCulled={false}
            >
                <shaderMaterial ref={matRef} {...common} />
            </instancedMesh>

            {/* 穗单独一条：几何体不同（纺锤 vs 锥台），也便于单独数实例。 */}
            <instancedMesh
                ref={seedRef}
                name="foxtail-seeds"
                args={[seedGeo, null, seeds.length]}
                frustumCulled={false}
            >
                <shaderMaterial {...common} />
            </instancedMesh>
        </group>
    );
}

export default FoxtailGrass;
