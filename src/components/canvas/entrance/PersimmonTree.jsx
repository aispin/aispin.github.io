import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSeason } from '../../../hooks/useSeason';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { treeSeasonUniforms } from '../../../shaders/entranceTextures';
import {
    TREE_BARK_VERT, TREE_BARK_FRAG,
    TREE_LEAF_VERT, TREE_LEAF_FRAG,
    TREE_FRUIT_VERT, TREE_FRUIT_FRAG,
    TREE_SHADOW_VERT, TREE_SHADOW_FRAG,
} from '../../../shaders/persimmonTree';
import {
    PERSIMMON_H, TUFT_EXTENT, buildPersimmonTree, makeLeafTuftGeometry, makeFruitGeometry,
} from '../../../utils/persimmonTree';
import { seasonLightFor } from '../../../config/seasonLight';
import { toShaderColor } from '../../../config/theme';
import { WindChime } from './EntranceProps';

/**
 * PersimmonTree — 3D 柿子树（2026-10-12，WO-13）。
 * ==================================================================
 *
 * 用户原话：「柿子树完全重构，3D版，我给你 html demo，你参考做
 * （`public/demos/web3d/tree/index.html`）。我希望**树冠饱满一点**，
 * **树干的衔接自然一点**。」
 *
 * · 「衔接自然」= demo 的**关节椭球** + 子枝起点回退 / 起始方向偏向父枝。
 *   那三条的做法与理由写在 `utils/persimmonTree.js` 的文件头。
 * · 「树冠饱满」= 一半的叶团不是撒在末梢上，而是按"离冠壳多远"**在冠体积里
 *   撒的**；末梢那一半也加密了。此外每团叶 4 片、朝向散开 —— 明暗差异全靠
 *   法线，朝向单一的话整冠是同一个颜色，那才是最像"不饱满"的原因。
 *
 * 代价（这是重构里最要紧的一条约束）
 * ----------------------------------
 * demo 里每个枝条 / 每片叶 / 每颗果都是一个 `Mesh`，那棵树 3000+ 个 mesh。
 * 本项目基线只有 **704 mesh**，照抄会翻五倍。所以：
 *   · 骨架（枝 + 关节 ~8k 三角形）自己拼成**一个** BufferGeometry
 *   · 叶（~2200 团 × 8 三角形）一个 InstancedMesh
 *   · 果（34 颗）一个 InstancedMesh
 *   · 地面投影一片
 * ⇒ **一共 4 次 draw call、4 个 mesh**。风与霾每帧只算一遍（四个材质共用
 *   同一份 uniform 对象 —— 与 `BambooGrove` 同一条做法）。
 *
 * ⚠️ 树是**远景摆件**，`frustumCulled` 不能开：实例矩阵是挂载后才写的，
 *    自动包围球会把整棵树剔掉（竹篱栽过的那个坑）。
 */

/* ------------------------------------------------------------------ */
/* 每季的形态（尺寸以外的东西）                                         */
/*                                                                     */
/* `shadow` = 地面投影的**压扁系数**（沿地面进深方向），`dx` 是太阳方位   */
/* 的水平偏移。这两个数是从旧版 canvas 那棵树上量过来的（`TREE_SEASON`   */
/* 的 `shadow` / `shadowDx`，128 px = 1 世界单位），不是重新拍的 ——      */
/* 「影长是季节信号里最强的一条」这条设计没有变。                        */
/* ------------------------------------------------------------------ */

const TREE_LOOK = {
    spring: { leaves: true, fruit: false, shadow: 0.20, dx: -0.109, wind: 0.075, bark: 1.00 },
    summer: { leaves: true, fruit: false, shadow: 0.11, dx: 0.000, wind: 0.062, bark: 0.90 },
    autumn: { leaves: true, fruit: true, shadow: 0.17, dx: 0.000, wind: 0.070, bark: 1.00 },
    winter: { leaves: false, fruit: false, shadow: 0.30, dx: 0.172, wind: 0.090, bark: 1.20 },
};

const lookFor = (season) => TREE_LOOK[season] || TREE_LOOK.autumn;

/**
 * 树皮**法线扰动**的基准强度（乘上每季的 `bark` 系数）。
 *
 * 🔴 这一条是"树干不像粘土"的关键：原来 fbm 只拿去混颜色、法线一个像素没动，
 *    所以无论颜色叠几层，光照下这片表面仍然是光滑圆柱。
 * 单位是「局部空间梯度 × 该系数」加在法线上；实测 0.05 量级正好
 * ——大到能看出凹凸，又不会把法线推到自交（出现负光）。
 */
const BARK_BUMP = 0.085;

/** 叶的**透光**强度。0 = 不透（"硬纸片"），太大 = 像塑料发光片。 */
const LEAF_TRANS = 0.55;

/** 太阳方向（世界、归一化）。取那一季**白天**的主光位置 —— 影长是本项目
 *  手绘的，但明暗仍然跟着太阳高度角走（与 `SceneLighting` 同一把尺子）。 */
const lightDirCache = new Map();
function lightDirFor(season) {
    if (lightDirCache.has(season)) return lightDirCache.get(season);
    const p = seasonLightFor(season).day.key.position;
    const v = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    lightDirCache.set(season, v);
    return v;
}

/** 地面投影椭圆的半径（世界单位）。比树冠略小 —— 影子落在树脚下。 */
const SHADOW_R = 2.15;
/** 投影颜色与强度。旧 canvas 用的是 rgba(38,52,24,0.44)。 */
const SHADOW_TINT = [0.149, 0.204, 0.094];
const SHADOW_OPACITY = 0.42;

export function PersimmonTree({ position = [0, 0, 0], yaw = 0, rootY = 0 }) {
    const season = useSeason();
    const look = lookFor(season);
    const scene = useThree((state) => state.scene);

    const tree = useMemo(() => buildPersimmonTree(), []);

    const barkMatRef = useRef();
    const leafMatRef = useRef();
    const fruitMatRef = useRef();
    const leafRef = useRef();
    const fruitRef = useRef();

    // ---- 几何体：带实例属性，所以**不能**用 sharedGeometry（会连坐）
    const leafGeo = useMemo(() => {
        const g = makeLeafTuftGeometry();
        const L = tree.leaf;
        g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(L.phase, 1));
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(L.tint, 1));
        g.setAttribute('aAccent', new THREE.InstancedBufferAttribute(L.accent, 1));
        g.setAttribute('aShade', new THREE.InstancedBufferAttribute(L.shade, 1));
        return g;
    }, [tree]);

    const fruitGeo = useMemo(() => makeFruitGeometry(), []);

    // ---- 四个材质共用一份 uniform 对象（见文件头）。useFrame 只写一遍。
    const uniforms = useSeasonUniforms(
        (s) => ({
            ...treeSeasonUniforms(s),
            uLightDir: { value: lightDirFor(s) },
            uRootY: { value: rootY },
            uTreeH: { value: PERSIMMON_H },
            uTime: { value: 0 },
            uWind: { value: lookFor(s).wind },
            // WO-19：树皮法线扰动 + 叶的透光/叶尖坐标（都是纯程序化，零位图）
            uBarkBump: { value: BARK_BUMP * lookFor(s).bark },
            uTuftExtent: { value: TUFT_EXTENT },
            uLeafTrans: { value: LEAF_TRANS },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        [rootY]
    );

    const shadowUniforms = useSeasonUniforms(
        () => ({
            uTint: { value: SHADOW_TINT },
            uOpacity: { value: SHADOW_OPACITY },
        }),
        []
    );

    // 实例矩阵只在挂载时写一次（风在着色器里）。
    // ⚠️ 是 `useEffect` 不是 `useMemo`：它不返回值，写的是 three 的实例矩阵。
    useEffect(() => {
        const lm = leafRef.current;
        if (lm) {
            lm.instanceMatrix.array.set(tree.leaf.matrices);
            lm.instanceMatrix.needsUpdate = true;
            lm.count = tree.leaf.count;
        }
        const fm = fruitRef.current;
        if (fm) {
            fm.instanceMatrix.array.set(tree.fruit.matrices);
            fm.instanceMatrix.needsUpdate = true;
            fm.count = tree.fruit.count;
        }
    }, [tree]);

    useFrame((state) => {
        // 🔴 三个材质**引用的是同一份 uniform 对象**（见文件头），所以这里
        //    只写一次就够了 —— 不是漏了 leaf / fruit。
        const bm = barkMatRef.current;
        if (!bm) return;
        bm.uniforms.uTime.value = state.clock.elapsedTime;
        const fog = scene.fog;
        if (fog) {
            toShaderColor(fog.color, bm.uniforms.uHaze.value);
            bm.uniforms.uHazeNear.value = fog.near;
            bm.uniforms.uHazeFar.value = fog.far;
        }
    });

    const anchor = tree.chimeAnchor;

    return (
        <group name="persimmon-tree" position={position} rotation={[0, yaw, 0]}>
            {/* ---- 骨架：枝 + 关节，一个几何体 ---- */}
            <mesh geometry={tree.bark} frustumCulled={false}>
                <shaderMaterial
                    ref={barkMatRef}
                    vertexShader={TREE_BARK_VERT}
                    fragmentShader={TREE_BARK_FRAG}
                    uniforms={uniforms}
                />
            </mesh>

            {/* ---- 叶（冬季整棵不挂：`visible` 是项目既有的"隐藏"写法）---- */}
            <instancedMesh
                ref={leafRef}
                args={[leafGeo, null, tree.leaf.count]}
                visible={look.leaves}
                frustumCulled={false}
            >
                <shaderMaterial
                    ref={leafMatRef}
                    vertexShader={TREE_LEAF_VERT}
                    fragmentShader={TREE_LEAF_FRAG}
                    uniforms={uniforms}
                    side={THREE.DoubleSide}
                />
            </instancedMesh>

            {/* ---- 果（只有秋天挂）---- */}
            <instancedMesh
                ref={fruitRef}
                args={[fruitGeo, null, Math.max(tree.fruit.count, 1)]}
                visible={look.fruit}
                frustumCulled={false}
            >
                <shaderMaterial
                    ref={fruitMatRef}
                    vertexShader={TREE_FRUIT_VERT}
                    fragmentShader={TREE_FRUIT_FRAG}
                    uniforms={uniforms}
                />
            </instancedMesh>

            {/* ---- 地面投影（贴地椭圆软斑，见 shaders 里那段注释）---- */}
            <mesh
                position={[look.dx, 0.006, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={[SHADOW_R * 2, SHADOW_R * 2 * look.shadow, 1]}
                renderOrder={1}
                raycast={() => null}
            >
                <planeGeometry args={[1, 1]} />
                <shaderMaterial
                    vertexShader={TREE_SHADOW_VERT}
                    fragmentShader={TREE_SHADOW_FRAG}
                    uniforms={shadowUniforms}
                    transparent
                    depthWrite={false}
                />
            </mesh>

            {/* ---- 风铃挂在**真实的一级枝**上（挂点由生成器挑出来）---- */}
            <WindChime position={[anchor.x, anchor.y, anchor.z]} />
        </group>
    );
}

export default PersimmonTree;
