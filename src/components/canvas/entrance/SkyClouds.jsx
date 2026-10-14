import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { sharedGeometry } from '../../../engine/resources';
import { makeCloudVolumeTexture } from '../../../utils/cloudArt';
import { CLOUD_SPRITES, toShaderColor } from '../../../config/theme';
import {
    SKY_CLOUD_SPRITES, instancesForSlot, spriteForSlot, SKY_CLOUD_LAYERS,
} from '../../../config/skyClouds';
import { CLOUD_VERT, CLOUD_FRAG, CLOUD_SHAPE, CLOUD_IDENTITY } from '../../../shaders/skyClouds';

/**
 * SkyClouds — 天上那几朵云（WO-20 摆位 / WO-30 形体，2026-10-12 → 2026-10-13）。
 * ==================================================================
 *
 * 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」
 * 用户（第三轮）：「云朵搞逼真一点（是否上 glsl）」→ 拍板 (A)。
 *
 * 摆位在 `config/skyClouds.js`（确定性 + 层片展开），形体与上色在
 * `shaders/skyClouds.js`，云的**素描底**沿用本项目自己的 `utils/cloudArt.js`
 * （摄影室那八张水墨云）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 颜色**只有一个真源**：天空穹顶的 uniform
 * ---------------------------------------------------------------------------
 * 云顶 / 云底 / 朝阳色**不在这里另立色板**，而是每帧从天空穹顶的
 * `uZenith / uHorizon / uCloud / uGlow / uSunDir` 派生。理由是这套项目已经栽过
 * 一次："同一个事实存两份，迟早不同步"（甬路冻在首季那条）。
 *
 * 具体地说，如果这里自己算一遍季节色，那么：
 *   · `SceneLighting` 改一季的端点 ⇒ 云还是旧色；
 *   · 昼夜过渡（0.9 s）时天空在插值、云**不插** ⇒ 天黑了云还亮着。
 * 从穹顶读就没有这两个问题 —— 云和天**不可能**不同步。
 *
 * 🔴 查法：**按 `name` 查，不是按某个 uniform 查**。
 * 那条接口是 `SceneLighting.jsx` 里那个 `name="sky-dome"`。以前这里写的是
 * `o.material?.uniforms?.uStrata`（= 按"有没有某个 uniform"猜），于是文件头
 * 说的"这是显式接口"**在代码里并不成立** —— 改名不会报警，删掉 `uStrata`
 * 反而会静默失联。WO-30 改成按名字查，并在找不到时**只警告一次**。
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
 *
 * ---------------------------------------------------------------------------
 * WO-30：形体交给片元，代价是 0 新增 mesh / 0 新增 draw / 0 新增贴图
 * ---------------------------------------------------------------------------
 * 三刀（fbm 侵蚀剪影 / 太阳方向明暗 / 三层薄片）全在
 * `shaders/skyClouds.js` 与 `config/skyClouds.js` 里，这里只负责
 * **把每帧的真源喂进去**：
 *
 *   · `uSunCam` = 太阳方向换算到**面片局部空间**。面片局部基就是相机四元数
 *     （billboard 抄的就是它），所以这里也用**同一个** `camera.quaternion`
 *     去换算 —— 用 `camera.matrixWorld` 会差一帧，明暗就和朝向对不上。
 *   · `uDetail` = fbm 档数，跟着 `lowTier` 走。**低端机是真的少算**
 *     （GLSL 里是一致分支，不是乘 0）。
 */

/** 复用的临时量（每帧不分配）。 */
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export function SkyClouds({ lowTier = false }) {
    const scene = useThree((state) => state.scene);

    // 每个**槽位**一个 InstancedMesh（⇒ 每槽位 1 次 draw，三张素描共 3 次）。
    // 🔴 `slot`（第几个 InstancedMesh）与 `sprite`（用哪张素描）**不是一回事**
    //    —— 混用会让 `placementsForSlot(6)` 返回空数组（探针 P1 抓到的）。
    // 🔴 WO-30 起，实例数是**层展开后**的（每槽位 × `SKY_CLOUD_LAYERS`）——
    //    仍然只有 3 次 draw，因为还是 3 个 InstancedMesh。
    const groups = useMemo(
        () => SKY_CLOUD_SPRITES.map((_, slot) => {
            const sprite = spriteForSlot(slot);
            return {
                slot,
                sprite,
                aspect: CLOUD_SPRITES[sprite].aspect,
                instances: instancesForSlot(slot),
                texture: makeCloudVolumeTexture(sprite, CLOUD_SPRITES[sprite].aspect),
            };
        }),
        [],
    );

    const meshRefs = useRef([]);
    const matRefs = useRef([]);

    /**
     * 🔴 2026-10-14 踩到并修掉的大坑：uniforms 对象**必须是稳定引用**。
     *
     * `<shaderMaterial uniforms={{...}} />` 里的字面量**每次 React render 都是新对象**，
     * R3F 会把它赋给 `material.uniforms`（换掉整个对象）。而 three 在**编译那一刻**
     * 把 `materialProperties.uniformsList` 绑到当时的**描述符对象**上 —— 之后每帧
     * `u.uTop.value.copy(...)` 写的是**新描述符**，GPU 收到的还是编译时那份。
     *
     * 症状（这一轮查了很久）：改 GLSL 常量（会重新编译）**立刻见效**；改任何
     * 「每帧 feed 的派生值」（uTop / uBottom / uGold / uSunCam / uHaze / uDetail）
     * **逐位不变**。判据：给材质 `needsUpdate = true` 后云立刻变色（28201 px 变红）。
     *
     * ⇒ 用 `useMemo` 建一次、只喂值不改对象。这样 R3F 即使重新赋值，描述符还是同一批。
     */
    const uniformSets = useMemo(() => groups.map((g) => ({
        uMap: { value: g.texture },
        uTop: { value: new THREE.Color(1, 1, 1) },
        uBottom: { value: new THREE.Color(0.8, 0.82, 0.85) },
        uGold: { value: new THREE.Color(1, 0.92, 0.75) },
        // 面片局部空间的太阳方向 —— 每帧由相机四元数换算。
        uSunCam: { value: new THREE.Vector3(0.6, 0.6, 0.5).normalize() },
        uHaze: { value: new THREE.Color(0.9, 0.92, 0.9) },
        uHazeNear: { value: 20 },
        uHazeFar: { value: 100 },
        uOpacity: { value: CLOUD_SHAPE.OPACITY },
        uInk: { value: CLOUD_SHAPE.INK },
        // 路线 C：距离场 + 法线贴图（见 makeCloudVolumeTexture）
        uSdfRange: { value: CLOUD_SHAPE.SDF_RANGE },
        uInkW: { value: CLOUD_SHAPE.INK_W },
        uErode: { value: CLOUD_SHAPE.ERODE },
        uEdge: { value: CLOUD_SHAPE.EDGE },
        uNoiseScale: { value: CLOUD_SHAPE.NOISE_SCALE },
        // WO-32e：竖向渐变向底偏置（1 = 与旧版一致）。
        uVertBias: { value: CLOUD_SHAPE.VERTICAL_BIAS },
        uSunAmt: { value: CLOUD_SHAPE.SUN_AMT },
        uShadeAmt: { value: CLOUD_SHAPE.SHADE_AMT },
        // ⚠️ 这里只是初值 —— 每帧会被 `GOLD_AMT * uSunDisk` 覆盖（见 useFrame）。
        uGoldAmt: { value: CLOUD_SHAPE.GOLD_AMT },
        uDetail: { value: CLOUD_SHAPE.DETAIL_HIGH },
    })), [groups]);

    // 天空穹顶（颜色真源）。只查一次 —— 见文件头。
    const skyRef = useRef(null);
    /** 找不到穹顶时只喊一次 —— 每帧喊会把 console 刷爆。 */
    const warnedRef = useRef(false);
    /** 穹顶在、但 `uSunDisk` 没了（改名）时也喊一次 —— 同上。 */
    const warnedSunDiskRef = useRef(false);

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
        ax: new THREE.Vector3(),
        ay: new THREE.Vector3(),
        az: new THREE.Vector3(),
        /** WO-32a：每帧重排用的下标缓冲（复用，不分配）。 */
        order: [],
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
            writeInstances(mesh, g.instances, identity, g.aspect, s);
            mesh.computeBoundingSphere();
        });
        // 只跑一次：摆位是常量，`spin` 也是常量，`scratch` / `identity` 是 ref/局部量。
    }, [groups]);

    useFrame((state) => {
        const s = scratch.current;

        // ---- 颜色真源：天空穹顶（按 `name` 查一次）----
        if (!skyRef.current) {
            scene.traverse((o) => {
                if (!skyRef.current && o.name === 'sky-dome') skyRef.current = o;
            });
            if (!skyRef.current && !warnedRef.current) {
                warnedRef.current = true;
                console.warn('[clouds] 找不到 name="sky-dome" ⇒ 云会停在初始色（见 SkyClouds 文件头）');
            }
        }
        const sky = skyRef.current?.material?.uniforms;

        // ---- 每帧写 billboard 矩阵 ----
        // 相机四元数直接抄过来 ⇒ 面片永远正对镜头（和 GalleryClouds 同一条）。
        // 🔴 WO-32a：同时按「到相机的距离」**远 → 近**写 —— 见 writeInstances。
        const cam = state.camera.position;
        for (let gi = 0; gi < groups.length; gi += 1) {
            const mesh = meshRefs.current[gi];
            if (!mesh) continue;
            writeInstances(mesh, groups[gi].instances, state.camera.quaternion,
                groups[gi].aspect, s, cam.x, cam.y, cam.z);
        }

        // ---- uniform ----
        const fog = scene.fog;
        // fbm 档数跟着性能分级走：低端机少算两级噪声。
        const detail = lowTier ? CLOUD_SHAPE.DETAIL_LOW : CLOUD_SHAPE.DETAIL_HIGH;
        // 🔴 WO-32e：云的「受光量」= 天空自己的昼夜比例。
        //    `uSunDisk` 就是 SceneLighting 里的 `1 − k`（k = 0 白天 / 1 夜），
        //    白天**恰好 1**、夜里**恰好 0**，而且昼夜过渡那 0.9 s 它自己在插值
        //    ⇒ 云跟着一起淡出，不需要在这里再写一份端点（§5：同一事实不存两份）。
        //    白天 = 1 ⇒ pull 0.28 / gold 0.87 **逐位不变**；夜里 = 0 ⇒ 两项都收 0。
        //    为什么必须这样：见 CLOUD_SHAPE.TOP_GLOW_PULL 的注释（同一常数昼夜反号）。
        let glowScale = 1;

        if (sky) {
            // 🔴 按名字查的接口还有一个（见文件头）：改名要**报警**，不能静默退回 1
            //    —— 退回 1 就是"永远当白天"，秋夜「云比天亮着」会原样复发。
            if (sky.uSunDisk === undefined) {
                if (!warnedSunDiskRef.current) {
                    warnedSunDiskRef.current = true;
                    console.warn('[clouds] 穹顶没有 uSunDisk ⇒ 云的受光量退回"永远白天"（见 SkyClouds 派生处）');
                }
                glowScale = 1;
            } else {
                glowScale = sky.uSunDisk.value;
            }
            // 云顶 = 天顶色偏朝阳（云被上面的太阳照亮），再提一档；
            // 云底 = 云带色（天空里那条云的颜色）偏天顶。
            // ⚠️ 都在**屏幕值**空间里插值 —— 不是物理正确的做法，
            //    但云和天同源，这个近似看不出来。
            // 🔴 WO-32e：插值完再**乘性分离**（TOP_LIFT / BOTTOM_DROP）——
            //    霾 A/B 已证伪（近云深度 30~60，霾系数 ~0.1，动雾没用），
            //    「云=天」的成因是派生色贴着天空色。乘性 ⇒ 换季/入夜自动跟随。
            s.top.copy(sky.uZenith.value)
                .lerp(sky.uGlow.value, CLOUD_SHAPE.TOP_GLOW_PULL * glowScale)
                .multiplyScalar(CLOUD_SHAPE.TOP_LIFT);
            s.bottom.copy(sky.uCloud.value).lerp(sky.uZenith.value, 0.22).multiplyScalar(CLOUD_SHAPE.BOTTOM_DROP);
            // 太阳方向换算到**面片局部空间**：面片局部基 = 相机四元数。
            // 用同一个 `state.camera.quaternion`，别用 `matrixWorld`（差一帧）。
            const q = state.camera.quaternion;
            s.ax.copy(AXIS_X).applyQuaternion(q);
            s.ay.copy(AXIS_Y).applyQuaternion(q);
            s.az.copy(AXIS_Z).applyQuaternion(q);
        }

        for (const mat of matRefs.current) {
            if (!mat) continue;
            const u = mat.uniforms;
            u.uDetail.value = detail;
            // 金边同样是"朝阳侧"的量 ⇒ 跟 uSunDisk 一起收（见 CLOUD_SHAPE.GOLD_AMT）。
            u.uGoldAmt.value = CLOUD_SHAPE.GOLD_AMT * glowScale;
            if (sky) {
                u.uTop.value.copy(s.top);
                u.uBottom.value.copy(s.bottom);
                u.uGold.value.copy(sky.uGlow.value);
                // 太阳方向换算到**面片局部空间**：面片局部基 = 相机四元数。
                // 用同一个 `state.camera.quaternion`，别用 `matrixWorld`（差一帧）。
                const sd = sky.uSunDir.value;
                u.uSunCam.value.set(sd.dot(s.ax), sd.dot(s.ay), sd.dot(s.az));
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

    // 判据的抓手（只 dev）。和 `FlightFinish` 的 `__flightFinish` 同一个套路：
    // 「剪影不再是死边」那条判据要在**真渲染的像素**上量，而不是在 JS 里
    // 再实现一遍侵蚀（那等于拿副本当真源，§28.1）。
    useEffect(() => {
        if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
        window.__skyClouds = {
            materials: matRefs.current,
            meshes: meshRefs.current,
            shape: CLOUD_SHAPE,
            identity: CLOUD_IDENTITY,
            layers: SKY_CLOUD_LAYERS,
        };
        return () => { delete window.__skyClouds; };
    }, []);

    return (
        <>
            {groups.map((g, gi) => (
                <instancedMesh
                    key={g.slot}
                    name={`sky-cloud-${g.slot}`}
                    ref={(el) => { meshRefs.current[gi] = el; }}
                    args={[geometry, undefined, g.instances.length]}
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
                        /* 🔴 稳定引用 —— 见上面 uniformSets 的注释（不这样写，
                           每帧 feed 的 uniform 到不了 GPU）。 */
                        uniforms={uniformSets[gi]}
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
 * 🔴 WO-32a（2026-10-14）：写入顺序是**到相机距离的远 → 近**。
 *
 * 为什么必须做：`InstancedMesh` **内部永远按实例下标画** ——
 * three 的 `reversePainterSortStable` 只在**对象之间**按 z 排
 * （`groupOrder → renderOrder → z 降序 → id`），**实例之间不排**；
 * 而透明材质这里 `depthWrite = false` ⇒ 谁后画谁在上。
 * `instancesForSlot()` 给的下标顺序是「环 0（近）→ 环 2（远）」、
 * 「layer 0（前）→ layer 2（后）」—— 直接按它画，就是**最远、最大、
 * 最糊的那层最后画、盖在前面那层之上**（实测：云内部出现 60px 宽的
 * 次级暗带，整个身子被拉向雾色 = 天空色）。
 *
 * ⚠️ 必须**每帧**重排，不能在 config 里排一次：`?flight` 飞出云环之外后，
 * "朝外" 相对相机就翻转了，静态顺序会再反一次。
 * 代价：15~42 个下标排一次序，每帧微秒级；矩阵本来就每帧重写。
 *
 * ⚠️ `h` 由 `aspect` 反解 —— **不能用贴图自己的宽高比**：贴图是按
 *    `makeCloudTexture(index, aspect)` 画进那个比例的画布的，所以
 *    `CLOUD_SPRITES[i].aspect` 才是真值（`GalleryClouds` 里也是这么写的，
 *    那份注释写得很清楚）。
 */
function writeInstances(mesh, instances, cameraQuaternion, aspect, s, camX, camY, camZ) {
    const ord = s.order;
    if (ord.length !== instances.length) {
        ord.length = instances.length;
        for (let i = 0; i < ord.length; i += 1) ord[i] = i;
    } else {
        for (let i = 0; i < ord.length; i += 1) ord[i] = i;
    }
    ord.sort((a, b) => {
        const pa = instances[a];
        const pb = instances[b];
        const da = (pa.x - camX) * (pa.x - camX) + (pa.y - camY) * (pa.y - camY)
            + (pa.z - camZ) * (pa.z - camZ);
        const db = (pb.x - camX) * (pb.x - camX) + (pb.y - camY) * (pb.y - camY)
            + (pb.z - camZ) * (pb.z - camZ);
        return db - da; // 远的排前面（先画）
    });
    for (let k = 0; k < ord.length; k += 1) {
        const p = instances[ord[k]];
        const h = p.scale / (aspect || 1.8);
        s.q.copy(cameraQuaternion).multiply(s.spin.setFromAxisAngle(AXIS_Z, p.spin));
        s.m.compose(
            s.pos.set(p.x, p.y, p.z),
            s.q,
            s.scl.set(p.scale, h, 1),
        );
        mesh.setMatrixAt(k, s.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
}

export default SkyClouds;
