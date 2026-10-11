import * as THREE from 'three';
import { sharedGeometry, blankInk } from '../../../engine/resources';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { SURFACE_VERT, SONG_WALL_FRAG, makeSurfaceUniforms } from '../../../shaders/entranceTextures';
import * as I from '../../../config/island';
import { FLOOR_Y, FACADE_W } from '../../../config/entranceMetrics';

/**
 * CourtyardWalls — 把院子围起来（L2）。
 * ==================================================================
 *
 * 原来"院子"只有门楼那一张 10×6 的 facade —— 从正面看是一堵墙，绕过去
 * 就什么都没有（背面剔除，整片消失）。现在补上四面院墙：
 *
 *     前（+z，门楼这一面）：左右两片，中间留给门楼（FACADE_W = 10）
 *     后（−z，后罩墙）    ：整片
 *     左 / 右             ：沿 z 拉通
 *
 * 全部走现成的 `SONG_WALL_FRAG`（青砖 + 黑瓦压顶），**零新贴图**。
 *
 * 🔴 为什么必须 `DoubleSide`
 * --------------------------
 * 入场那段飞行是**从院子里穿过去**的（z 28 → 11，穿过门洞落在走廊里）。
 * 如果墙只有朝外的一面，飞行过程中墙会整片消失 —— 那正是 L1"背面清单"
 * 要抓的那类洞。双面意味着从里从外都看得见砖。
 *
 * 洞与藤蔓
 * --------
 * `SONG_WALL_FRAG` 会按 `uHoleDoor` / `uHoleWindow` 在墙上挖洞。院墙没有门窗，
 * 所以把洞推到 9999 之外（照抄 `GateBase` 的台基那条）。
 * 藤蔓 `uInkStrength = 0` + 一张 1×1 空白贴图 —— 常春藤只爬门楼那面。
 */

/** 前墙在门楼两侧各留一片，宽度 = (院子宽 − facade 宽) / 2。 */
const FRONT_PANEL_W = (I.COURT_HALF_W * 2 - FACADE_W) / 2;
const FRONT_PANEL_OFFSET = FACADE_W / 2 + FRONT_PANEL_W / 2;

/**
 * 一面墙的 uniform。`uOrigin` 是**世界 XY 的左下角** —— 每面墙给不同的值，
 * 砖缝的噪声才不会四面墙一模一样（那会立刻被看成"复制粘贴"）。
 */
function wallUniformsFactory(width, height, originX, originY) {
    return (season) => ({
        ...makeSurfaceUniforms(width, height, [originX, originY], season),
        uHoleDoor: { value: [0, 9999, 0, 0] },
        uHoleWindow: { value: [0, 9999, 0, 0] },
        uInk: { value: blankInk() },
        uInkStrength: { value: 0 },
        uCapFrac: { value: I.COURT_WALL_CAP_FRAC },
    });
}

/** 一面墙：位置 + 绕 Y 的旋转 + 尺寸 + 噪声原点。 */
function Wall({ position, rotationY, width, originX }) {
    const uniforms = useSeasonUniforms(
        wallUniformsFactory(width, I.COURT_WALL_H, originX, FLOOR_Y),
        [width, originX]
    );

    return (
        <mesh position={position} rotation={[0, rotationY, 0]}>
            <primitive object={sharedGeometry('plane', width, I.COURT_WALL_H)} attach="geometry" />
            <shaderMaterial
                vertexShader={SURFACE_VERT}
                fragmentShader={SONG_WALL_FRAG}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

export function CourtyardWalls() {
    const wallCenterY = FLOOR_Y + I.COURT_WALL_H / 2;
    const sideLen = I.COURT_DEPTH;

    return (
        <group>
            {/* 前墙左右两片（中间是门楼） */}
            <Wall
                position={[-FRONT_PANEL_OFFSET, wallCenterY, I.COURT_FRONT_Z]}
                rotationY={0}
                width={FRONT_PANEL_W}
                originX={-I.COURT_HALF_W}
            />
            <Wall
                position={[FRONT_PANEL_OFFSET, wallCenterY, I.COURT_FRONT_Z]}
                rotationY={0}
                width={FRONT_PANEL_W}
                originX={FACADE_W / 2}
            />

            {/* 后罩墙：绕 Y 转 180°，让它朝 −z（院子外面） */}
            <Wall
                position={[0, wallCenterY, I.COURT_BACK_Z]}
                rotationY={Math.PI}
                width={I.COURT_HALF_W * 2}
                originX={I.COURT_HALF_W}
            />

            {/* 左墙（x = −11）：绕 Y −90° ⇒ 法线朝 −x */}
            <Wall
                position={[-I.COURT_HALF_W, wallCenterY, I.COURT_CENTER_Z]}
                rotationY={-Math.PI / 2}
                width={sideLen}
                originX={I.COURT_BACK_Z}
            />

            {/* 右墙（x = +11）：绕 Y +90° ⇒ 法线朝 +x */}
            <Wall
                position={[I.COURT_HALF_W, wallCenterY, I.COURT_CENTER_Z]}
                rotationY={Math.PI / 2}
                width={sideLen}
                originX={I.COURT_FRONT_Z}
            />
        </group>
    );
}

export default CourtyardWalls;
