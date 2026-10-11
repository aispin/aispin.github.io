import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sharedGeometry } from '../../../engine/resources';
import { useSeasonUniforms } from '../../../hooks/useSeasonUniforms';
import { makeSurfaceUniforms } from '../../../shaders/entranceTextures';
import { toShaderColor } from '../../../config/theme';
import { ISLAND_VERT, ISLAND_FRAG, islandSeasonUniforms } from '../../../shaders/islandTextures';
import * as I from '../../../config/island';

/**
 * IslandGround — 草地 / 沙滩 / 海，一张平面。
 * ==================================================================
 *
 * 它**取代了** `EmptyCorridor` 原来那块草坪：那块草是 25×40 的瓦片，
 * 和这张地面共面（都踩在 GRASS_Y 上），两块一起挂会 z-fight ——
 * 项目里已经为"两块共面的地面"付过一次学费（见 EmptyCorridor 里那段
 * 「走廊地板会闪绿」的注释）。所以那个文件删掉了，地面只有这一个主人。
 *
 * 三个和旧草坪不一样的地方
 * ------------------------
 *   1. **世界稳定**：不再按 40 单位切段循环，而是一整张 120×120 的平面，
 *      shader 里靠 `uOrigin` 算真实世界 XZ。绕着走时草不会"跟着相机流"。
 *   2. **有岸**：离岸距离场把岛边画出来（见 `shaders/islandTextures.js`）。
 *   3. **吃霾**：末尾按距离混向 `uHaze`，而 `uHaze` 每帧从 `scene.fog` 拷，
 *      所以昼夜交替时海和天是一起变的，不会"天黑了海还是正午蓝"。
 *
 * ⚠️ `uHaze*` 为什么每帧拷贝而不是写在季节色板里
 * ----------------------------------------------
 * 雾是**昼夜插值**出来的（`SceneLighting` 每帧改 `scene.fog`），季节表里
 * 只有 day / night 两组端点。抄 `scene.fog` 是唯一能跟住中间态的办法。
 */

// vUv=(0,0) 落在平面的哪一角：-PI/2 旋转后，局部 (-W/2,-H/2) → 世界 (cx-W/2, cz+H/2)
const ORIGIN = [I.ISLAND_CENTER[0] - I.GROUND_SIZE / 2, I.ISLAND_CENTER[1] + I.GROUND_SIZE / 2];

export function IslandGround() {
    const matRef = useRef();
    const haze = useRef(new THREE.Color(0.85, 0.87, 0.86));
    const scene = useThree((state) => state.scene);

    const uniforms = useSeasonUniforms(
        (season) => ({
            // 草的那部分复用现成的地面色板（四季的草/花/落叶/积雪全部自动跟上）
            ...makeSurfaceUniforms(I.GROUND_SIZE, I.GROUND_SIZE, ORIGIN, season),
            ...islandSeasonUniforms(season),
            uCenter: { value: I.ISLAND_CENTER },
            uGrassR: { value: I.ISLAND_GRASS_R },
            uSandR: { value: I.ISLAND_SAND_R },
            uGroundY: { value: I.GROUND_Y },
            uTime: { value: 0 },
            uHaze: { value: haze.current },
            uHazeNear: { value: 20 },
            uHazeFar: { value: 60 },
        }),
        []
    );

    useFrame((state) => {
        const mat = matRef.current;
        if (!mat) return;
        mat.uniforms.uTime.value = state.clock.elapsedTime;
        const fog = scene.fog;
        if (fog) {
            // 🔴 自定义 shader 不过色彩空间编码 ⇒ 雾色必须转成屏幕值，
            //    否则"完全化雾的远海"比真正的雾（内置材质那条）更暗更橙，
            //    地平线上会留一道**看得出**的接缝。见 config/theme.js。
            toShaderColor(fog.color, mat.uniforms.uHaze.value);
            mat.uniforms.uHazeNear.value = fog.near;
            mat.uniforms.uHazeFar.value = fog.far;
        }
    });

    return (
        <mesh
            position={[I.ISLAND_CENTER[0], I.GROUND_Y, I.ISLAND_CENTER[1]]}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            <primitive object={sharedGeometry('plane', I.GROUND_SIZE, I.GROUND_SIZE)} attach="geometry" />
            <shaderMaterial
                ref={matRef}
                vertexShader={ISLAND_VERT}
                fragmentShader={ISLAND_FRAG}
                uniforms={uniforms}
            />
        </mesh>
    );
}

export default IslandGround;
