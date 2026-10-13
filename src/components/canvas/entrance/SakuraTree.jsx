import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSeason } from '../../../hooks/useSeason';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { sakuraSeasonUniforms } from '../../../shaders/entranceTextures';
import {
    SAKURA_BARK_VERT, SAKURA_BARK_FRAG,
    SAKURA_BLOSSOM_VERT, SAKURA_BLOSSOM_FRAG,
    SAKURA_LEAF_VERT, SAKURA_LEAF_FRAG,
    SAKURA_PETAL_VERT, SAKURA_PETAL_FRAG,
    SAKURA_SHADOW_VERT, SAKURA_SHADOW_FRAG,
} from '../../../shaders/sakuraTree';
import {
    LEAF_EXTENT, buildSakuraTree,
    makeBlossomGeometry, makeSakuraLeafGeometry, makePetalGeometry,
} from '../../../utils/sakuraTree';
import { seasonLightFor } from '../../../config/seasonLight';
import { toShaderColor } from '../../../config/theme';

/**
 * SakuraTree — 3D 樱花树（2026-10-12，WO-17）。
 * ==================================================================
 *
 * 用户原话：「参考 `sakura-station-corner` 在前院种两棵樱花树」
 * → 2026-10-12 追加决定：「放**花箱前面草地的中间**（做**一棵**看效果，
 *   落樱参考真实樱花树的季节）」。
 *
 * 骨架机器与柿子树**共用一份**（`utils/treeSkeleton.js`）—— 理由写在
 * `utils/sakuraTree.js` 的文件头：锥形管 / 关节椭球 / 子枝回退那三条原则
 * 只有一份实现，两棵树各自给一套**形态参数**。
 *
 * 代价（与柿子树同一把尺子）
 * -------------------------
 *   · 骨架（枝 + 关节）1 个 mesh
 *   · 花簇 1 个 InstancedMesh（**春**）
 *   · 叶冠 1 个 InstancedMesh（**夏 / 秋**）
 *   · 地面投影 1 片
 *   · 落樱 1 个 InstancedMesh（**只在春**，且**只在春挂载**）
 * ⇒ **5 个 mesh**，任一时刻**最多 4 个可见**。
 *
 * 🔴 花与叶**共用同一批实例矩阵**（同一批位置、同一套属性），一次只显示一种
 *    —— 所以多出来的只有"一个几何体 + 一个 mesh"，不是两棵树。
 *    两个几何体都要挂同一组实例属性，见下面的 `attachInstanceAttrs`。
 *
 * 🔴 落樱是**条件挂载**（`{isSpring && …}`），不是 `visible={false}`：
 *    用户的判据是「落樱只在 spring 有粒子」，条件挂载让这条**结构上**成立，
 *    而不是靠一个可能忘掉的布尔量（`LotusVat` 的四季内容物是同一条做法）。
 *
 * ⚠️ `frustumCulled` 不能开：实例矩阵是挂载后才写的，自动包围球会把整棵树
 *    剔掉（竹篱栽过的那个坑）。
 * ⚠️ **不要给 `yaw`**：`utils/sakuraTree.js` 的 `leanCrownForward()` 已经把
 *    "冠朝哪边"烤进几何了（冠必须朝 +z、背着前墙）。再转一次就白做了。
 */

/* ------------------------------------------------------------------ */
/* 每季的形态（尺寸以外的东西）                                         */
/*                                                                     */
/* `shadow` = 地面投影的压扁系数（沿地面进深方向），`dx` 是太阳方位的     */
/* 水平偏移。与柿子树同源同义（影长是季节信号里最强的一条）。            */
/*                                                                     */
/* 🔴 `canopy` 这一列是**樱花自己的规律**：春 → 花、夏秋 → 叶、冬 → 无。 */
/*    真实的染井吉野是**先花后叶**（三月下旬开到四月中满树花而不见叶，   */
/*    五月起长叶，秋天叶转橙红，冬天秃）。这就是用户那句「落樱参考真实   */
/*    樱花树的季节」的落地。                                           */
/* ------------------------------------------------------------------ */

const TREE_LOOK = {
    spring: { canopy: 'blossom', petal: true, shadow: 0.20, dx: -0.109, bark: 1.00 },
    summer: { canopy: 'leaf', petal: false, shadow: 0.11, dx: 0.000, bark: 0.90 },
    autumn: { canopy: 'leaf', petal: false, shadow: 0.17, dx: 0.000, bark: 1.00 },
    winter: { canopy: null, petal: false, shadow: 0.30, dx: 0.172, bark: 1.20 },
};

const lookFor = (season) => TREE_LOOK[season] || TREE_LOOK.autumn;

/** 树皮法线扰动的基准强度（乘每季的 `bark` 系数）。与柿子树同值同义。 */
const BARK_BUMP = 0.085;
/** 叶的透光强度。 */
const LEAF_TRANS = 0.55;
/**
 * 花瓣的透光强度 —— **比叶还高**。
 * 花瓣只有一层细胞，逆光时几乎整片亮起来；用叶的 0.55 会读成"厚塑料片"。
 */
const BLOSSOM_TRANS = 0.62;

/** 地面投影椭圆的半径（世界单位）。比柿子树略大 —— 樱花冠更宽。 */
const SHADOW_R = 2.35;
const SHADOW_TINT = [0.149, 0.204, 0.094];
const SHADOW_OPACITY = 0.42;

/** 落樱的运动参数（全在顶点着色器里算，见 `shaders/sakuraTree.js`）。 */
const PETAL_SPIN = 1.6;
const PETAL_SWAY = 0.35;

/** 太阳方向（世界、归一化）—— 与柿子树同一把尺子。 */
const lightDirCache = new Map();
function lightDirFor(season) {
    if (lightDirCache.has(season)) return lightDirCache.get(season);
    const p = seasonLightFor(season).day.key.position;
    const v = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    lightDirCache.set(season, v);
    return v;
}

/**
 * 把花 / 叶**共用**的那四个实例属性挂到一个几何体上。
 *
 * 🔴 为什么两个几何体都要挂一遍：`InstancedBufferAttribute` 是**挂在几何体上**
 *    的，不是挂在 mesh 上。花与叶是两个几何体 ⇒ 各挂一份（指向**同一批数组**，
 *    不复制数据）。
 */
function attachInstanceAttrs(geo, canopy) {
    // ⚠️ WO-28 起**不挂 `aPhase`** —— 那个属性只被花冠的风摆用，花冠改静止之后
    //    它是死的。`packInstances` 仍然产出 `phase`（柿子树的叶团也共用那份）。
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(canopy.tint, 1));
    geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(canopy.accent, 1));
    geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(canopy.shade, 1));
    return geo;
}

export function SakuraTree({ position = [0, 0, 0], rootY = 0 }) {
    const season = useSeason();
    const look = lookFor(season);
    const scene = useThree((state) => state.scene);

    const tree = useMemo(() => buildSakuraTree(), []);

    const barkMatRef = useRef();
    const blossomRef = useRef();
    const leafRef = useRef();
    const petalRef = useRef();

    const blossomGeo = useMemo(() => attachInstanceAttrs(makeBlossomGeometry(), tree.canopy), [tree]);
    const leafGeo = useMemo(() => attachInstanceAttrs(makeSakuraLeafGeometry(), tree.canopy), [tree]);

    const petalGeo = useMemo(() => {
        const g = makePetalGeometry();
        const P = tree.petal;
        g.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(P.origins, 3));
        g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(P.seeds, 2));
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(P.tints, 1));
        return g;
    }, [tree]);

    // ---- 所有材质共用一份 uniform 对象（与柿子树同一条做法）--------------
    // 多出来的 uTopY / uFallH / uSpin / uSway 只有落樱那对着色器声明，
    // 其余材质的 program 里没有它们，three 上传时会直接跳过。
    const uniforms = useSeasonUniforms(
        (s) => ({
            ...sakuraSeasonUniforms(s),
            uLightDir: { value: lightDirFor(s) },
            uRootY: { value: rootY },
            uTime: { value: 0 },
            uBarkBump: { value: BARK_BUMP * lookFor(s).bark },
            uTuftExtent: { value: LEAF_EXTENT },
            uLeafTrans: { value: LEAF_TRANS },
            uBlossomTrans: { value: BLOSSOM_TRANS },
            uTopY: { value: tree.petal.topY },
            uFallH: { value: tree.petal.fallH },
            uSpin: { value: PETAL_SPIN },
            uSway: { value: PETAL_SWAY },
            uHaze: { value: new THREE.Color(0.85, 0.87, 0.86) },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        [rootY, tree]
    );

    const shadowUniforms = useSeasonUniforms(
        () => ({ uTint: { value: SHADOW_TINT }, uOpacity: { value: SHADOW_OPACITY } }),
        []
    );

    // 实例矩阵只在挂载时写一次（风与落樱都在着色器里）。
    // ⚠️ 是 `useEffect` 不是 `useMemo`：它不返回值，写的是 three 的实例矩阵。
    // ⚠️ deps 里必须有 `season`：落樱那个 mesh 是**按季挂载**的，换季时它才刚
    //    建出来，不重跑这个 effect 的话它的实例矩阵拿不到（花瓣全叠在原点）。
    // ⚠️ 花 / 叶是**两个** InstancedMesh，共用同一批矩阵 ⇒ 两个都要写。
    useEffect(() => {
        for (const ref of [blossomRef, leafRef]) {
            const m = ref.current;
            if (!m) continue;
            m.instanceMatrix.array.set(tree.canopy.matrices);
            m.instanceMatrix.needsUpdate = true;
            m.count = tree.canopy.count;
        }
        const pm = petalRef.current;
        if (pm) {
            // 落樱**不用**实例矩阵 —— 位置全在顶点着色器里按 aOrigin + 时间算。
            // 但 InstancedMesh 的矩阵会乘进去，所以必须留成单位阵。
            // （不依赖构造函数的默认值：那是 three 的实现细节，写明白更稳。）
            const identity = new THREE.Matrix4();
            for (let i = 0; i < tree.petal.count; i++) pm.setMatrixAt(i, identity);
            pm.instanceMatrix.needsUpdate = true;
            pm.count = tree.petal.count;
        }
    }, [tree, season]);

    useFrame((state) => {
        // 🔴 所有材质引用的是**同一份** uniform 对象，所以这里只写一次。
        //
        // ⚠️ WO-28 起 `uTime` 的**唯一消费者是落樱**（`SAKURA_PETAL_VERT`）——
        //    花冠的风摆已经删掉了。这一行**不能跟着删**：删了落樱就冻在天上。
        //    （柿子树的 `useFrame` 里那一行 `uTime` 是**真的**删了，因为那边
        //    连落樱都没有。两棵树的处理不同，理由就在这里。）
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

    return (
        <group name="sakura-tree" position={position}>
            {/* ---- 骨架：枝 + 关节，一个几何体 ---- */}
            <mesh name="sakura-bark" geometry={tree.bark} frustumCulled={false}>
                <shaderMaterial
                    ref={barkMatRef}
                    vertexShader={SAKURA_BARK_VERT}
                    fragmentShader={SAKURA_BARK_FRAG}
                    uniforms={uniforms}
                />
            </mesh>

            {/* ---- 冠：春挂花簇几何体，夏秋挂叶团几何体，冬不挂 ----
                两个 `instancedMesh` 都在，靠 `visible` 切换（几何体不同 ⇒
                不能靠换 attribute）。冬季两个都不可见 ⇒ 一次 draw 都不发。 */}
            <instancedMesh
                ref={blossomRef}
                name="sakura-blossom"
                args={[blossomGeo, null, tree.canopy.count]}
                visible={look.canopy === 'blossom'}
                frustumCulled={false}
            >
                <shaderMaterial
                    vertexShader={SAKURA_BLOSSOM_VERT}
                    fragmentShader={SAKURA_BLOSSOM_FRAG}
                    uniforms={uniforms}
                    side={THREE.DoubleSide}
                />
            </instancedMesh>

            <instancedMesh
                ref={leafRef}
                name="sakura-leaf"
                args={[leafGeo, null, tree.canopy.count]}
                visible={look.canopy === 'leaf'}
                frustumCulled={false}
            >
                <shaderMaterial
                    vertexShader={SAKURA_LEAF_VERT}
                    fragmentShader={SAKURA_LEAF_FRAG}
                    uniforms={uniforms}
                    side={THREE.DoubleSide}
                />
            </instancedMesh>

            {/* ---- 地面投影 ---- */}
            <mesh
                name="sakura-shadow"
                position={[look.dx, 0.006, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={[SHADOW_R * 2, SHADOW_R * 2 * look.shadow, 1]}
                renderOrder={1}
                raycast={() => null}
            >
                <planeGeometry args={[1, 1]} />
                <shaderMaterial
                    vertexShader={SAKURA_SHADOW_VERT}
                    fragmentShader={SAKURA_SHADOW_FRAG}
                    uniforms={shadowUniforms}
                    transparent
                    depthWrite={false}
                />
            </mesh>

            {/* ---- 落樱：**只有春天存在**（条件挂载，不是 visible）---- */}
            {look.petal && (
                <instancedMesh
                    ref={petalRef}
                    name="sakura-petal"
                    args={[petalGeo, null, tree.petal.count]}
                    frustumCulled={false}
                >
                    <shaderMaterial
                        vertexShader={SAKURA_PETAL_VERT}
                        fragmentShader={SAKURA_PETAL_FRAG}
                        uniforms={uniforms}
                        side={THREE.DoubleSide}
                    />
                </instancedMesh>
            )}
        </group>
    );
}

export default SakuraTree;
