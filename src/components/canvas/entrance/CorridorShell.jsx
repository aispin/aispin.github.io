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
 * ⚠️ 屋面也走 `SONG_WALL_FRAG`（`uCapFrac = 0` ⇒ 整面都是黑瓦）
 * ------------------------------------------------------------
 * 第一版屋面用的是一块深色 `meshStandardMaterial`，结果**从背面看是占满
 * 下半屏的一大块纯黑**：标准材质在这个场景里吃不到足够的光（全站
 * `shadows={false}`、没有环境贴图），而墙用的是自带环境项的 shader ——
 * 一块黑屋面挨着一面灰砖墙，立刻露馅。
 *
 * 换成 `SONG_WALL_FRAG` 之后屋面和院墙的压顶是**同一套瓦、同一套光照**。
 * 关键是 UV 要对上（这两条不成立就会把瓦当画到屋脊上）：
 *   · `uSize = [ROOF_LEN, ROOF_SLOPE]`，`u` 沿**屋脊方向**、`v` 沿**坡度方向**；
 *   · shader 的瓦垄 `fract(world.x / 0.285)` ⇒ 垄沿坡度跑 ✅（`world.x = u·ROOF_LEN`）；
 *   · shader 的檐口在 `above ≈ 0`，而 `above = v·ROOF_SLOPE` ⇒ 檐口落在**檐口那一侧** ✅。
 * 所以 `RoofSlope` 里那三层嵌套 group 的旋转顺序是**有约束的**，不是随便写的：
 * 它保证 `u` 沿屋脊、`v` 沿坡度。改旋转之前先把上面两条推一遍。
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
function wallUniformsFactory(width, originX) {
    return (season) => ({
        ...makeSurfaceUniforms(width, WALL_H, [originX, GRASS_Y], season),
        uHoleDoor: { value: [0, 9999, 0, 0] },
        uHoleWindow: { value: [0, 9999, 0, 0] },
        uInk: { value: blankInk() },
        uInkStrength: { value: 0 },
        uCapFrac: { value: 1.5 },
    });
}

/**
 * 一面壳墙。侧墙（`rotationY = ±π/2`，沿 z 拉通）和后端封口墙
 * （`rotationY = 0`，沿 x 拉通）只差宽和朝向，所以共用一个组件。
 */
function ShellWall({ width, position, rotationY, originX }) {
    const uniforms = useSeasonUniforms(wallUniformsFactory(width, originX), [width, originX]);
    return (
        <mesh position={position} rotation={[0, rotationY, 0]}>
            <primitive object={sharedGeometry('plane', width, WALL_H)} attach="geometry" />
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
 * 一片屋面。嵌套三层 group 是为了让"先铺平、再转 90°、最后倾斜"三步互不干扰
 * —— 三个欧拉角写在一个 rotation 里，顺序一错就翻面。
 *
 * 🔴 旋转顺序同时决定了 UV 落在哪个方向（见文件头）：
 *    `spin = ±π/2` + `Rx(−π/2)` 之后，平面的**宽**（= ROOF_LEN）跑到世界 −z
 *    （屋脊方向）、**高**（= ROOF_SLOPE）跑到 ±x（坡度方向）。
 *    左右两坡的 `spin` 相反，是为了让两边的 `v=0`（檐口）都落在**外侧**。
 */
function RoofSlope({ side }) {
    // side = +1 右坡（檐口在 +x）、−1 左坡
    const spin = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const uniforms = useSeasonUniforms(
        (season) => ({
            ...makeSurfaceUniforms(ROOF_LEN, ROOF_SLOPE, [0, 0], season),
            uHoleDoor: { value: [0, 9999, 0, 0] },
            uHoleWindow: { value: [0, 9999, 0, 0] },
            uInk: { value: blankInk() },
            uInkStrength: { value: 0 },
            // 0 ⇒ 整面都是黑瓦（压顶从墙的 0 高度就开始）
            uCapFrac: { value: 0 },
        }),
        []
    );
    return (
        <group
            position={[side * ROOF_CENTER_X, ROOF_CENTER_Y, HALL_CENTER_Z]}
            rotation={[0, 0, -side * ROOF_TILT]}
        >
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh rotation={[0, 0, spin]}>
                    {/* 宽 = 屋脊方向（z），高 = 坡度方向 */}
                    <primitive object={sharedGeometry('plane', ROOF_LEN, ROOF_SLOPE)} attach="geometry" />
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

export function CorridorShell() {
    return (
        <group>
            {/* 两侧长墙：绕 Y 90°，沿 z 拉通 */}
            <ShellWall
                width={HALL_LEN}
                position={[I.HALL_HALF_W, WALL_CENTER_Y, HALL_CENTER_Z]}
                rotationY={Math.PI / 2}
                originX={I.COURT_BACK_Z}
            />
            <ShellWall
                width={HALL_LEN}
                position={[-I.HALL_HALF_W, WALL_CENTER_Y, HALL_CENTER_Z]}
                rotationY={Math.PI / 2}
                originX={I.HALL_BACK_Z}
            />

            {/* 后端封口。远在雾里，但少了它从 50° 俯角能看到壳的内部。
                ⚠️ 它只砌到**檐口**（WALL_H），所以墙顶和屋脊之间会留一个三角形
                缺口 —— 那个缺口由屋面自己盖住：屋面在 z 方向比墙身多出檐 0.7
                （ROOF_LEN 那两份额外长度），缺口正好在出檐底下。 */}
            <ShellWall
                width={I.HALL_HALF_W * 2}
                position={[0, WALL_CENTER_Y, I.HALL_BACK_Z]}
                rotationY={0}
                originX={-I.HALL_HALF_W}
            />

            <RoofSlope side={1} />
            <RoofSlope side={-1} />
        </group>
    );
}

export default CorridorShell;
