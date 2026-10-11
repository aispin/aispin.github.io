import * as THREE from 'three';
import { sharedGeometry, blankInk } from '../../../engine/resources';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { SURFACE_VERT, SONG_WALL_FRAG, makeSurfaceUniforms } from '../../../shaders/entranceTextures';
import * as I from '../../../config/island';
import { GRASS_Y } from '../../../config/entranceMetrics';

/**
 * CorridorShell — 走廊的外壳（青砖墙 + 黑瓦顶）。
 * ==================================================================
 *
 * 为什么需要它（这是 L1「背面清单」抓到的头号洞）
 * ------------------------------------------------
 * 走廊是"无限"的：从院子里（z ≈ 10）一路铺到 z = −70。`CorridorWalls`
 * 的每一面都是 **DoubleSide**（人在里面时得看得见），于是**从外面看就是
 * 一大片没有细节的白板**。院子能绕着看之前没人发现 —— 相机永远在正面，
 * 门楼把后面挡得严严实实。
 *
 * 实测证据（`.workbuddy-ai/harness/probe-island-slab.mjs`，侧面机位打射线）：
 *   命中 `PlaneGeometry{ w:30,h:3.5 }` @ world(3.5, 0, −5)   ← 走廊右壁
 *        `PlaneGeometry{ w:16,h:3.5 }` @ world(−3.5, 0, 2)   ← 走廊左壁
 *        `PlaneGeometry{ w:12,h:3.5 }` @ world(−3.5, 0, 16)  ← 走廊左壁
 *   三面都 `side: 2`（DoubleSide）。
 *
 * 做法：给它穿一层壳。从外面看是院子后面的一座廊屋；从里面看，走廊自己
 * 的墙（x = ±3.5）比壳（x = ±3.9）更靠里且不透明，把壳完全挡住。
 *
 * 🔴 尺寸的硬约束（改之前先读）
 * ----------------------------
 *   · 半宽必须 > 3.5（走廊半宽），否则壳切进走廊里 —— 取 3.9；
 *   · 檐口必须 > FLOOR_Y + 3.5 = 1.75（走廊顶），否则天花板穿出屋面 —— 取 2.2；
 *   · 屋面必须**盖住**壳的墙顶，否则从 50° 仰角往下看会看见墙和屋顶的缝。
 *
 * ⚠️ 为什么屋面不用 `SONG_WALL_FRAG`
 * ----------------------------------
 * 那个 shader 的"黑瓦压顶"是按 **vUv.y**（平面的 v 方向）铺的。屋面的 v
 * 方向是**坡度方向**，不是竖直方向 —— 直接套会把"瓦当/滴水"画在屋脊上。
 * 所以屋面用一块深色的标准材质：相机最近也在 10 单位外，还隔着雾，
 * 一块素色屋面和一块带纹的屋面在这段距离上读起来是一样的。
 * 壳的**墙**照旧用 `SONG_WALL_FRAG`（青砖），和院墙同一套砖。
 *
 * ⚠️ 什么时候挂
 * --------------
 * 只在 `!hasEntered || houseExitRequested` 时挂 —— 人在走廊里/房间里时
 * 它完全被走廊的墙挡着，白挂 5 个 mesh。`houseExitRequested` 那一段
 * 必须留着：退出动画是**从走廊里滑到院门外**，那一瞬间 `hasEntered`
 * 还是 true，卸掉壳就会在滑出去的过程中看见走廊的白板。
 */

/** 墙的进深：从后罩墙到 HALL_BACK_Z。 */
const HALL_LEN = I.COURT_BACK_Z - I.HALL_BACK_Z;
const HALL_CENTER_Z = (I.COURT_BACK_Z + I.HALL_BACK_Z) / 2;
/** 墙高：从地面（GRASS_Y）到檐口。 */
const WALL_H = I.HALL_EAVE_Y - GRASS_Y;
const WALL_CENTER_Y = GRASS_Y + WALL_H / 2;

/** 屋面：从檐口（±EAVE_X, EAVE_Y）升到屋脊（0, RIDGE_Y）。 */
const EAVE_X = I.HALL_HALF_W + I.HALL_OVERHANG;
const ROOF_RISE = I.HALL_RIDGE_Y - I.HALL_EAVE_Y;
const ROOF_SLOPE = Math.hypot(EAVE_X, ROOF_RISE);
const ROOF_TILT = Math.atan2(ROOF_RISE, EAVE_X);
const ROOF_CENTER_X = EAVE_X / 2;
const ROOF_CENTER_Y = (I.HALL_EAVE_Y + I.HALL_RIDGE_Y) / 2;
/** 屋面在 z 方向比墙身多出檐（前后各一份）。 */
const ROOF_LEN = HALL_LEN + I.HALL_OVERHANG * 2;

/**
 * 一面壳墙的 uniform。`uCapFrac > 1` = 这面墙没有黑瓦压顶 ——
 * 墙顶直接接屋面，再压一道瓦会变成"墙头又长出一条屋脊"。
 */
function wallUniformsFactory(originX) {
    return (season) => ({
        ...makeSurfaceUniforms(HALL_LEN, WALL_H, [originX, GRASS_Y], season),
        uHoleDoor: { value: [0, 9999, 0, 0] },
        uHoleWindow: { value: [0, 9999, 0, 0] },
        uInk: { value: blankInk() },
        uInkStrength: { value: 0 },
        uCapFrac: { value: 1.5 },
    });
}

function ShellWall({ x, originX }) {
    const uniforms = useSeasonUniforms(wallUniformsFactory(originX), [originX]);
    return (
        <mesh
            position={[x, WALL_CENTER_Y, HALL_CENTER_Z]}
            rotation={[0, Math.PI / 2, 0]}
        >
            <primitive object={sharedGeometry('plane', HALL_LEN, WALL_H)} attach="geometry" />
            <shaderMaterial
                vertexShader={SURFACE_VERT}
                fragmentShader={SONG_WALL_FRAG}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

/** 一片屋面。嵌套三层 group 是为了让"先铺平、再转 90°、最后倾斜"三步互不干扰 —— 三个欧拉角写在一个 rotation 里，顺序一错就翻面。 */
function RoofSlope({ side }) {
    // side = +1 右坡（檐口在 +x）、−1 左坡
    const spin = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    return (
        <group
            position={[side * ROOF_CENTER_X, ROOF_CENTER_Y, HALL_CENTER_Z]}
            rotation={[0, 0, -side * ROOF_TILT]}
        >
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh rotation={[0, 0, spin]}>
                    {/* 宽 = 屋脊方向（z），高 = 坡度方向 */}
                    <primitive object={sharedGeometry('plane', ROOF_LEN, ROOF_SLOPE)} attach="geometry" />
                    <meshStandardMaterial
                        color="#343a3d"
                        roughness={0.88}
                        metalness={0}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </group>
        </group>
    );
}

export function CorridorShell() {
    return (
        <group>
            <ShellWall x={I.HALL_HALF_W} originX={I.COURT_BACK_Z} />
            <ShellWall x={-I.HALL_HALF_W} originX={I.HALL_BACK_Z} />

            {/* 后端封口。远在雾里，但少了它从 50° 俯角能看到壳的内部。 */}
            <mesh position={[0, WALL_CENTER_Y, I.HALL_BACK_Z]} rotation={[0, Math.PI, 0]}>
                <primitive object={sharedGeometry('plane', I.HALL_HALF_W * 2, WALL_H)} attach="geometry" />
                <meshStandardMaterial color="#4a5052" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>

            <RoofSlope side={1} />
            <RoofSlope side={-1} />
        </group>
    );
}

export default CorridorShell;
