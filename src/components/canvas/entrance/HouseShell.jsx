import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { sharedGeometry, blankInk } from '../../../engine/resources';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { SURFACE_VERT, SONG_WALL_FRAG, makeSurfaceUniforms } from '../../../shaders/entranceTextures';
import * as I from '../../../config/island';
import { GRASS_Y, FLOOR_Y } from '../../../config/entranceMetrics';

/**
 * HouseShell — 屋身（"老房子"本体）。
 * ==================================================================
 *
 * 这是 `CorridorShell` 的重写。旧版是**照走廊尺寸反推出来的壳**
 * （`HALL_HALF_W = 3.5 + 0.4`、`HALL_EAVE_Y = FLOOR_Y + 3.5 + 0.45`），
 * 用户否掉了这个做法：
 *
 *   「只需做一个老房子3D模型，不需要依据内部通道去还原。意思是房子的外观
 *     和房间内部的通道不绑定。因为我们内部实际上是无限循环的。」
 *
 * 所以这里每个数都按**建筑本身**定（见 `config/island.js` 的 HOUSE_* 段），
 * 走廊只是恰好从它里面穿过去。唯一保留的硬约束：屋身必须包住走廊的横截面
 * （半宽 3.5 / 顶高 FLOOR_Y + 3.5 = 1.75）。
 *
 * 🔴 形制（照用户给的参考图，`参考屋形即可`）
 * -------------------------------------------
 * **双坡顶，屋脊与院子边界平行（沿 x）**，两坡分别朝院子（+z）和背院（−z）；
 * 檐口向院子出挑、压在院子上方，檐下露椽头（椽头是参考图里最认得出的细节）。
 *
 * 为什么脊要沿 x 而不是沿走廊（z）：参考图的屋脊与「屋身 / 院子」那条分界线
 * **平行**，也就是屋面朝院子排水。沿 z 的话屋脊垂直于院子，山墙会正对门楼。
 *
 * 🔴 檐口高度 = **墙头**的高度，不是屋面外沿的高度
 * ------------------------------------------------
 * 出檐意味着屋面在墙平面之外继续往下走。所以：
 *   屋脊 → 墙头（= HOUSE_EAVE_Y）→ 出檐端（比墙头低 tan(pitch)·OVERHANG）
 * 是一条直线。`HOUSE_RIDGE_Y` 只由**墙长的一半**推出来（不含出檐）——
 * 把出檐算进升幅，屋面在墙头处就会高出一截，山墙的斜边接不上。
 *
 * 🔴 山墙是五边形，一个 plane 装不下
 * -----------------------------------
 * 山墙 = 矩形（草地 → 墙头）+ 上面的三角（墙头 → 屋脊）。`THREE.ShapeGeometry`
 * 的 uv **直接就是 shape 的原始坐标**（three 源码里那行注释写着 "world uvs"），
 * 所以把 shape 按**世界米**画，配 `uSize = [1, 1]` + `uOrigin = [s0, GRASS_Y]`
 * 就能直接喂给 `SONG_WALL_FRAG` —— 砖缝和其他墙用同一把尺子，接缝对得上。
 *
 * ⚠️ 屋面走 `SONG_WALL_FRAG`（`uCapFrac = 0` ⇒ 整面黑瓦）
 * ------------------------------------------------------
 * 第一版屋面用过 `meshStandardMaterial`，在这个场景里是**纯黑**（全站
 * `shadows={false}`、无环境贴图、无 toneMapping，标准材质吃不到光）。换成
 * 这个 shader 之后屋面和院墙的压顶是同一套瓦、同一套光照。
 * 关键是 UV 方向要对：`u` 沿屋脊、`v` 沿坡度 ⇒ 瓦垄 `fract(world.x / 0.285)`
 * 垂直于屋脊（沿坡跑），檐口 `above ≈ 0` 落在出檐那一侧。
 *
 * ⚠️ 什么时候挂
 * --------------
 * 只在 `!hasEntered || houseExitRequested` 时挂。`houseExitRequested` 那一段
 * 必须留着：退出动画是**从走廊里滑到院门外**，那一瞬间 `hasEntered` 还是 true，
 * 卸掉屋身就会在滑出去的过程中看见走廊的白板。
 */

/* ---- 墙 ------------------------------------------------------------- */

/** 墙高：从草地（GRASS_Y）到墙头（檐口）。 */
const WALL_H = I.HOUSE_EAVE_Y - GRASS_Y;
const WALL_CENTER_Y = GRASS_Y + WALL_H / 2;
/** 屋身中心 z。 */
const HOUSE_CENTER_Z = (I.INTERIOR_FRONT_Z + I.HOUSE_BACK_Z) / 2;

/* ---- 屋面 ----------------------------------------------------------- */

/** 坡度方向的水平投影：屋脊 → 出檐端。 */
const ROOF_RUN = I.HOUSE_LEN / 2 + I.HOUSE_OVERHANG;
const ROOF_RISE = I.HOUSE_RIDGE_Y - I.HOUSE_EAVE_TIP_Y;
const ROOF_SLOPE = Math.hypot(ROOF_RUN, ROOF_RISE);
const ROOF_TILT = Math.atan2(ROOF_RISE, ROOF_RUN);
const ROOF_CENTER_Y = (I.HOUSE_RIDGE_Y + I.HOUSE_EAVE_TIP_Y) / 2;
/** 屋面在 x 方向拉满屋身宽度（硬山：屋面与山墙齐平，不悬出）。 */
const ROOF_WIDTH = I.HOUSE_HALF_W * 2;
/** 两坡各自的中心 z（屋脊 → 出檐端的中点）。 */
const ROOF_FRONT_CENTER_Z = (HOUSE_CENTER_Z + I.INTERIOR_FRONT_Z + I.HOUSE_OVERHANG) / 2;
const ROOF_BACK_CENTER_Z = (HOUSE_CENTER_Z + I.HOUSE_BACK_Z - I.HOUSE_OVERHANG) / 2;

/* ---- 门洞 ----------------------------------------------------------- */

/**
 * 门洞 = 走廊的横截面（半宽 3.5 / 净高 3.5）。
 *
 * 高度取 **3.5（走廊净高）**是有意的：墙头比走廊顶高 0.4，而
 * `COURT_WALL_CAP_FRAC = 0.905` 的压顶正好从墙顶往下 9.5% 处开始
 * （0.4 / 4.28 ≈ 9.3%）—— 于是**黑瓦压顶的下沿正好落在门洞上沿**，
 * 门洞不会把压顶切开。
 */
const DOOR_HALF_W = 3.8;
const DOOR_H = 3.5;
const DOOR_CENTER_Y = FLOOR_Y + DOOR_H / 2;
/** ⚠️ 模块级常量：内联数组会每次渲染换引用（本项目为这个付过学费）。 */
const DOOR_HOLE = [0, DOOR_CENTER_Y, DOOR_HALF_W, DOOR_H / 2];
const NO_HOLE = [0, 9999, 0, 0];

/* ---- 椽头 ----------------------------------------------------------- */

/** 椽头间距（世界单位）。 */
const RAFTER_STEP = 0.55;
const RAFTER_COUNT = Math.round(ROOF_WIDTH / RAFTER_STEP) + 1;
const RAFTER_W = 0.14;
const RAFTER_H = 0.20;
const RAFTER_D = 0.34;

/**
 * 一面墙的 uniform。
 * `capFrac > 1` = 这面墙没有黑瓦压顶（墙顶直接接屋面，再压一道瓦会变成
 * "墙头又长出一条屋脊"）。
 */
function wallUniformsFactory(width, height, originX, originY, capFrac, hole) {
    return (season) => ({
        ...makeSurfaceUniforms(width, height, [originX, originY], season),
        uHoleDoor: { value: hole },
        uHoleWindow: { value: NO_HOLE },
        uInk: { value: blankInk() },
        uInkStrength: { value: 0 },
        uCapFrac: { value: capFrac },
    });
}

/** 一面矩形墙。侧墙 / 前后墙只差宽、朝向和压顶，所以共用一个组件。 */
function ShellWall({ width, height, position, rotationY, originX, originY, capFrac, hole = NO_HOLE }) {
    const uniforms = useSeasonUniforms(
        wallUniformsFactory(width, height, originX, originY, capFrac, hole),
        [width, height, originX, originY, capFrac]
    );
    return (
        <mesh position={position} rotation={[0, rotationY, 0]}>
            <primitive object={sharedGeometry('plane', width, height)} attach="geometry" />
            <shaderMaterial
                vertexShader={SURFACE_VERT}
                fragmentShader={SONG_WALL_FRAG}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

/**
 * 山墙（五边形：矩形 + 三角）。
 *
 * shape 的坐标就是 uv，所以直接按**世界米**画：x 沿墙的水平轴（这里 = 屋身
 * 进深方向）、y 是离草地的高度。配 `uSize = [1, 1]` 就等价于一个
 * 「世界米 UV 的平面」。
 *
 * ⚠️ 三角的两个斜边必须与屋面的坡度**完全重合**：底角在墙头
 * （`eaveH = HOUSE_EAVE_Y - GRASS_Y`）、顶点在屋脊
 * （`ridgeH = HOUSE_RIDGE_Y - GRASS_Y`），而屋面在墙平面处的高度正好是
 * `HOUSE_EAVE_Y`。这就是 `HOUSE_RIDGE_Y` 不能把出檐算进去的原因。
 */
function GableWall({ side }) {
    const geometry = useMemo(
        () => {
            const shape = new THREE.Shape();
            shape.moveTo(0, WALL_H);
            shape.lineTo(I.HOUSE_LEN, WALL_H);
            shape.lineTo(I.HOUSE_LEN / 2, I.HOUSE_RIDGE_Y - GRASS_Y);
            shape.closePath();
            return new THREE.ShapeGeometry(shape);
        },
        []
    );

    // 两侧给不同的 uOrigin.x，砖缝噪声才不会左右一模一样（那会立刻被看成复制粘贴）。
    const originX = side > 0 ? 0 : 50;
    const uniforms = useSeasonUniforms(
        wallUniformsFactory(1, 1, originX, GRASS_Y, 1.5, NO_HOLE),
        [originX]
    );

    return (
        <mesh
            position={[side * I.HOUSE_HALF_W, GRASS_Y, side > 0 ? I.INTERIOR_FRONT_Z : I.HOUSE_BACK_Z]}
            rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
            geometry={geometry}
        >
            <shaderMaterial
                vertexShader={SURFACE_VERT}
                fragmentShader={SONG_WALL_FRAG}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

/**
 * 一片屋面。
 *
 * 三层嵌套是必要的，顺序不能乱：
 *   ① 内层 `Rx(−π/2)` 把平面放平（平面法线 +z → +y），于是平面的**高**
 *      跑到世界 ±z（坡度方向）、**宽**留在世界 x（屋脊方向）；
 *   ② 外层 `Rx(±ROOF_TILT)` 绕 x 倾斜，把出檐那一端压下去。
 * `side = +1` 是朝院子那一坡，`side = −1` 是背院那一坡。
 *
 * 🔴 `flipV`：两坡的"出檐端"在局部坐标里是**相反**的 —— 朝院那一坡的出檐端
 * 落在局部 −y，背院那一坡落在局部 +y。不翻的话背院那一坡的檐口细节
 * （`SONG_WALL_FRAG` 的 `above ≈ 0`）会长到屋脊上去。翻的方式是绕局部 x
 * 转 π：只把 v 轴反过来，u 不动（瓦垄沿 u 是对称的，看不出差别）。
 */
function RoofSlope({ side }) {
    const uniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(ROOF_WIDTH, ROOF_SLOPE, [0, 0], season),
            uHoleDoor: { value: NO_HOLE },
            uHoleWindow: { value: NO_HOLE },
            uInk: { value: blankInk() },
            uInkStrength: { value: 0 },
            // 0 ⇒ 整面都是黑瓦（压顶从 0 高度就开始）
            uCapFrac: { value: 0 },
        }),
        []
    );

    return (
        <group
            position={[
                0,
                ROOF_CENTER_Y,
                side > 0 ? ROOF_FRONT_CENTER_Z : ROOF_BACK_CENTER_Z,
            ]}
            rotation={[side * ROOF_TILT, 0, 0]}
        >
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh rotation={[side > 0 ? 0 : Math.PI, 0, 0]}>
                    {/* 宽 = 屋脊方向（x），高 = 坡度方向 */}
                    <primitive object={sharedGeometry('plane', ROOF_WIDTH, ROOF_SLOPE)} attach="geometry" />
                    <shaderMaterial
                        vertexShader={SURFACE_VERT}
                        fragmentShader={SONG_WALL_FRAG}
                        uniforms={uniforms}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </group>
        </group>
    );
}

/** 正脊：压在屋脊上的一条。盒子够用 —— 0.3 宽的平条在环绕距离上就是一道脊。 */
function RidgeCap() {
    const geometry = useMemo(() => new THREE.BoxGeometry(ROOF_WIDTH, 0.24, 0.34), []);
    return (
        <mesh
            position={[0, I.HOUSE_RIDGE_Y + 0.08, HOUSE_CENTER_Z]}
            geometry={geometry}
        >
            <meshBasicMaterial color="#41474a" />
        </mesh>
    );
}

/**
 * 檐下椽头 —— 参考图里最认得出的那排"牙"。
 *
 * 用一个 InstancedMesh 装两条檐（前后各 RAFTER_COUNT 个），
 * 所以 82 个椽头只花 1 次 draw call。
 * ⚠️ 实例几何体**不能**走 `sharedGeometry`（实例矩阵会写坏共享几何体的
 * 包围盒），所以这里自己 new 一个。
 */
function RafterEnds() {
    const ref = useRef();
    const geometry = useMemo(() => new THREE.BoxGeometry(RAFTER_W, RAFTER_H, RAFTER_D), []);

    useLayoutEffect(() => {
        const mesh = ref.current;
        if (!mesh) return;
        const m = new THREE.Matrix4();
        let i = 0;
        for (const eaveZ of [I.INTERIOR_FRONT_Z + I.HOUSE_OVERHANG, I.HOUSE_BACK_Z - I.HOUSE_OVERHANG]) {
            for (let k = 0; k < RAFTER_COUNT; k++) {
                const x = -I.HOUSE_HALF_W + (ROOF_WIDTH / (RAFTER_COUNT - 1)) * k;
                m.makeTranslation(x, I.HOUSE_EAVE_TIP_Y - RAFTER_H / 2 - 0.02, eaveZ - Math.sign(eaveZ - HOUSE_CENTER_Z) * RAFTER_D * 0.3);
                mesh.setMatrixAt(i++, m);
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
    }, [geometry]);

    return (
        <instancedMesh
            ref={ref}
            args={[geometry, undefined, RAFTER_COUNT * 2]}
            frustumCulled={false}
        >
            <meshBasicMaterial color="#4a4f52" />
        </instancedMesh>
    );
}

export function HouseShell() {
    return (
        <group>
            {/* 前墙（= 院子的后罩墙），中间开走廊的门洞 */}
            <ShellWall
                width={I.HOUSE_HALF_W * 2}
                height={WALL_H}
                position={[0, WALL_CENTER_Y, I.INTERIOR_FRONT_Z]}
                rotationY={0}
                originX={-I.HOUSE_HALF_W}
                originY={GRASS_Y}
                capFrac={I.COURT_WALL_CAP_FRAC}
                hole={DOOR_HOLE}
            />

            {/* 后端封口。远在雾里，但少了它从 50° 俯角能看到屋身内部。 */}
            <ShellWall
                width={I.HOUSE_HALF_W * 2}
                height={WALL_H}
                position={[0, WALL_CENTER_Y, I.HOUSE_BACK_Z]}
                rotationY={Math.PI}
                originX={I.HOUSE_HALF_W}
                originY={GRASS_Y}
                capFrac={1.5}
            />

            {/* 两侧长墙：沿 z 拉通，只砌到墙头 —— 上面那截三角由山墙补 */}
            <ShellWall
                width={I.HOUSE_LEN}
                height={WALL_H}
                position={[I.HOUSE_HALF_W, WALL_CENTER_Y, HOUSE_CENTER_Z]}
                rotationY={Math.PI / 2}
                originX={I.INTERIOR_FRONT_Z}
                originY={GRASS_Y}
                capFrac={1.5}
            />
            <ShellWall
                width={I.HOUSE_LEN}
                height={WALL_H}
                position={[-I.HOUSE_HALF_W, WALL_CENTER_Y, HOUSE_CENTER_Z]}
                rotationY={-Math.PI / 2}
                originX={I.HOUSE_BACK_Z}
                originY={GRASS_Y}
                capFrac={1.5}
            />

            <GableWall side={1} />
            <GableWall side={-1} />

            <RoofSlope side={1} />
            <RoofSlope side={-1} />
            <RidgeCap />
            <RafterEnds />
        </group>
    );
}

export default HouseShell;
