import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
 *     mesh.scale.set(视锥宽, 视锥高, 1)     ← 关键，见下面「vUv = 屏幕」
 *     mesh.position.copy(camera.position)
 *     mesh.quaternion.copy(camera.quaternion)
 *     mesh.translateZ(-DIST)
 *
 * `translateZ` 是在**已经摆正的局部坐标系**里沿 −Z 推 —— 相机朝哪边，
 * 平面就落在它前面多远，永远正对镜头。平面法线朝 +Z，正好迎向相机。
 *
 * ---------------------------------------------------------------------------
 * 🔴 `vUv` 必须**精确等于屏幕**（这是「雨只有右边几道光」的根因，§9.4n）
 * ---------------------------------------------------------------------------
 * 平面原来写死 11×6。但距离 2.6 处的可见范围是 `2·2.6·tan(fov/2) × aspect`
 * ≈ 3.0 × aspect 高 —— 竖屏只有 ~1.7 单位宽，**11 宽里只看得见 15%**。
 * 于是 shader 里 24 列的雨丝只剩两三条进画面，而且格高 2 单位 ≈ 屏幕高的
 * 2/3，一条"雨丝"跨掉半个屏幕，读起来就是**几道光**而不是雨。
 *
 * 改成每帧按视锥缩放之后，`vUv ∈ [0,1]²` 就**正好铺满屏幕**，
 * shader 里的格数 = 「屏幕上有几格」，横屏竖屏一致。
 * 代价：雨的倾角要按 aspect 换算（`RAIN_FRAG` 里除以 `uAspect`）。
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
 * 平面**按视锥尺寸缩放**，不是写死尺寸。
 *
 * 🔴 这是「雨只在屏幕右边几道光」的根因修复（§9.4n）。平面原来写死 11×6，
 * 而距离 2.6 处的可见范围只有 `2·2.6·tan(fov/2) × aspect`：
 *   · 横屏 16:9 ≈ 5.3 × 3.0 —— 11 宽里有 ~48% 看得见，勉强够；
 *   · **竖屏 9:16 ≈ 1.7 × 3.0 —— 只看得见 ~15% 的宽度**：24 列的雨丝
 *     只剩两三条落进画面，而且格高 2 单位 ≈ 屏幕高的 2/3，
 *     于是一条"雨丝"跨掉半个屏幕 —— 看起来就是一道光。
 * 缩放之后 `vUv` **精确等于屏幕**，shader 里的格数就是「屏幕上有几格」，
 * 与视口宽窄无关。
 *
 * 留 2% 余量：浮点上取整可能让平面边缘差一个像素、露一条缝。
 */
const MARGIN = 1.02;

export function WeatherLayer() {
    const season = useSeason();
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
        // 雨丝倾角要按屏幕宽高比换算（见 RAIN_FRAG）；初值给 1，避免第一帧除 0。
        uAspect: { value: 1 },
    }), []);

    useFrame((state) => {
        const m = ref.current;
        if (!m) return;
        const cam = state.camera;

        // ---- 1. 平面按视锥尺寸缩放 ⇒ vUv 精确等于屏幕（§9.4n）----
        // 相机 fov 是**垂直** fov，所以先算高再乘 aspect 得宽。
        const h = 2 * DIST * Math.tan((cam.fov * Math.PI) / 360) * MARGIN;
        m.scale.set(h * cam.aspect, h, 1);

        // ---- 2. 摆到相机正前方 ----
        m.position.copy(cam.position);
        m.quaternion.copy(cam.quaternion);
        m.translateZ(-DIST);

        // ---- 3. uniform ----
        // ⚠️ 走 `matRef.current.uniforms` 而不是直接改上面那个 `uniforms`：
        // 后者是**作为 prop 传出去的值**，`react-hooks` 的新规则
        // （react-compiler 那套）会报 "This value cannot be modified"。
        // 本仓库既有的写法也是这么干的（rooms/Gallery/PaperMaterial.jsx:207）。
        const mat = matRef.current;
        if (!mat) return;
        mat.uniforms.uTime.value = state.clock.elapsedTime;
        mat.uniforms.uAspect.value = cam.aspect;
    });

    // 秋：没有天象。整层不挂载 —— 0 个 mesh、0 次 draw。
    if (!mode) return null;

    return (
        <mesh ref={ref} renderOrder={999} frustumCulled={false}>
            {/* 单位平面 —— 尺寸每帧由 scale 给（视锥尺寸），见上面 useFrame */}
            <primitive object={sharedGeometry('plane', 1, 1)} attach="geometry" />
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
