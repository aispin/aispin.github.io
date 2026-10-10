import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { WEATHER_VERT, SNOW_FRAG, RAIN_FRAG } from '../../../shaders/entranceTextures';

/**
 * WeatherLayer — 季生天象：雨幕 / 落雪（§6.4，C 档）
 * ==================================================
 *
 * 天象是三分法里**唯一允许"在 / 不在"**的一档（§2 C）。对照表：
 *
 *   春 雨 ✔   ·  夏 雷雨 ✔   ·  秋 ✘   ·  冬 落雪 ✔
 *
 * 所以本组件**整个条件挂载**：秋天 `return null`，一个 mesh 都不进场景图。
 *
 * ---------------------------------------------------------------------------
 * 怎么"挂在相机前"
 * ---------------------------------------------------------------------------
 * 不用 `<primitive object={camera}>` 去改父子关系（那会动到 three 的渲染图，
 * 且相机是被 `useInfiniteCamera` 每帧驱动的，改挂载顺序风险大）。这里每帧：
 *
 *     mesh.position.copy(camera.position)
 *     mesh.quaternion.copy(camera.quaternion)
 *     mesh.translateZ(-DIST)
 *
 * `translateZ` 是在**已经摆正的局部坐标系**里沿 −Z 推 —— 相机朝哪边，
 * 平面就落在它前面多远，永远正对镜头。平面法线朝 +Z，正好迎向相机。
 *
 * ⚠️ 顺序：`useInfiniteCamera` 也在自己的 useFrame 里写相机。若本组件的
 * useFrame 排在它前面，用的就是**上一帧**的机位 —— 2.6 单位的差距在
 * 一帧的位移里可以忽略（相机是缓动的），肉眼看不出来。
 *
 * ---------------------------------------------------------------------------
 * 为什么 `depthTest: false` + 高 renderOrder
 * ---------------------------------------------------------------------------
 * 天象**必须画在所有东西前面**：雨雪不会落在墙后面。平面虽然在相机前
 * 2.6 单位、天然就比场景近，但相机是可以走进门洞的（那时平面可能穿过门框），
 * 关掉深度测试 + 排在最后画，行为就和"贴了一层玻璃"完全一致。
 * 它本身 `depthWrite: false`，不会污染深度。
 *
 * 季节切换时用 `key={mode}` 强制**重建材质** —— 雪和雨是两段不同的
 * fragment shader，不是同一个 shader 换个 uniform。
 */

/** 平面离相机的距离。太近会有"贴脸"感，太远会被雾吃掉。 */
const DIST = 2.6;
/**
 * 平面尺寸：只要**盖住整个视锥**即可（多出来的部分在屏幕外，不产生像素）。
 * 垂直 fov 60° ⇒ 距离 d 处可见高 = 2·d·tan30° = 1.155·d ≈ 3.0。
 * 取 6 是两倍余量；宽 11 覆盖到 21:9（2.33）和更宽的屏。
 */
const PLANE_W = 11;
const PLANE_H = 6;

export function WeatherLayer() {
    const season = useSeason();
    const { camera } = useThree();
    const ref = useRef();
    const matRef = useRef();

    const mode = season === 'winter' ? 'snow'
        : (season === 'spring' || season === 'summer') ? 'rain'
            : null;

    // 身份稳定 —— 绝不在渲染里新建 uniforms 对象（R3F 的 applyProps 会整个替换
    // `material.uniforms`，那正是 WO-8「甬路冻在首季」的机制）。
    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uOpacity: { value: 1 },
    }), []);

    useFrame((state) => {
        // ⚠️ 走 `matRef.current.uniforms` 而不是直接改上面那个 `uniforms`：
        // 后者是**作为 prop 传出去的值**，`react-hooks` 的新规则
        // （react-compiler 那套）会报 "This value cannot be modified"。
        // 本仓库既有的写法也是这么干的（rooms/Gallery/PaperMaterial.jsx:207）。
        const mat = matRef.current;
        if (mat) mat.uniforms.uTime.value = state.clock.elapsedTime;

        const m = ref.current;
        if (!m) return;
        m.position.copy(camera.position);
        m.quaternion.copy(camera.quaternion);
        m.translateZ(-DIST);
    });

    // 秋：没有天象。整层不挂载 —— 0 个 mesh、0 次 draw。
    if (!mode) return null;

    return (
        <mesh ref={ref} renderOrder={999} frustumCulled={false}>
            <primitive object={sharedGeometry('plane', PLANE_W, PLANE_H)} attach="geometry" />
            <shaderMaterial
                ref={matRef}
                key={mode}
                vertexShader={WEATHER_VERT}
                fragmentShader={mode === 'snow' ? SNOW_FRAG : RAIN_FRAG}
                uniforms={uniforms}
                transparent
                depthWrite={false}
                depthTest={false}
                fog={false}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

export default WeatherLayer;
