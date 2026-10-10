import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { useWeather } from '../../../hooks/useWeather';
import { weatherLevels } from '../../../config/weather';
import { WEATHER_VERT, WEATHER_FRAG } from '../../../shaders/entranceTextures';

/**
 * WeatherLayer — 季生天象：雨幕 / 落雪（§6.4，C 档）
 * ==================================================
 *
 * 天象是三分法里**唯一允许"在 / 不在"**的一档（§2 C）。原来是一张固定对照表：
 *
 *   春 雨 ✔   ·  夏 雷雨 ✔   ·  秋 ✘   ·  冬 落雪 ✔
 *
 * 现在**雨这一层改由真实天气预报驱动**（2026-10-10，见 `hooks/useWeather.js`）：
 *
 *   · 春 / 夏 / 秋 —— 预报在下雨才下，不下就不下；
 *   · 冬 —— **落雪是固定的**（不受预报影响），另外**若预报在下雨就再叠一场雨**。
 *
 * 「冬天雪 + 雨叠一层」没有性能代价：两层合成在**同一个 fragment shader**里
 * （`WEATHER_FRAG` 的 `uSnow` / `uRain`），还是 1 个 mesh、1 次 draw、
 * 1 次全屏填充。`if (uRain > 0.001)` 是**一致分支**，不下雨时 GPU 整个跳过。
 *
 * ---------------------------------------------------------------------------
 * 🔴 拿不到天气 → **静默回落到原设计**，绝不阻塞场景
 * ---------------------------------------------------------------------------
 * 纯静态站、无后端，离线 / 被墙 / 限流都必须无感。三个状态各有明确行为：
 *
 *   status='ready'   → 预报说了算（`raining ? intensity : 0`）；
 *   status='error'   → 回落**原设计**：春/夏下雨、秋/冬不下雨；
 *   status='idle'/'loading' → **先不画**。宁可晚 0.5 秒出现，也不要
 *                      「先下一场再收回去」——`useWeather` 的文档里写了这条。
 *
 * ⚠️ 冬天落雪**与 weather 无关**，`loading` 期间照下（`uSnow` 只由 season 决定）。
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
 * 代价：雨的倾角要按 aspect 换算（`WEATHER_FRAG` 里除以 `uAspect`）。
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
    const weather = useWeather();
    const ref = useRef();
    const matRef = useRef();

    // ---- 季节 × 天气 → 两层强度（0..1）----
    // 🔴 规则表**只有一份**，在 `config/weather.js` 的 `weatherLevels()`：
    //   雪只由季节定（冬天固定下雪，与预报无关）；雨在四季都由预报定，
    //   拿不到预报时按 status 回落（error → 原设计；loading → 先不画）。
    //   写成纯函数是为了能单测（`.workbuddy-ai/harness/weather-levels-test.mjs`）。
    const { snow: uSnow, rain: uRain, active } = weatherLevels(season, weather);

    // 身份稳定 —— 绝不在渲染里新建 uniforms 对象（R3F 的 applyProps 会整个替换
    // `material.uniforms`，那正是 WO-8「甬路冻在首季」的机制）。
    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        // 雨丝倾角要按屏幕宽高比换算（见 WEATHER_FRAG）；初值给 1，避免第一帧除 0。
        uAspect: { value: 1 },
        // 两层的强度每帧从 `level` 这个 ref 里取 —— 见下面的 useEffect。
        uSnow: { value: 0 },
        uRain: { value: 0 },
    }), []);

    // 🔴 渲染期**不许写值**（react-compiler 那套规则会报 "cannot be modified"），
    // 所以用 effect 把"本帧该用多少强度"交给一个 ref，再由 useFrame 搬进 uniform。
    const level = useRef({ snow: uSnow, rain: uRain });
    useEffect(() => {
        level.current.snow = uSnow;
        level.current.rain = uRain;
    }, [uSnow, uRain]);

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
        mat.uniforms.uSnow.value = level.current.snow;
        mat.uniforms.uRain.value = level.current.rain;
    });

    // 两层都空：整层不挂载 —— 0 个 mesh、0 次 draw。
    if (!active) return null;

    return (
        <mesh ref={ref} renderOrder={999} frustumCulled={false}>
            {/* 单位平面 —— 尺寸每帧由 scale 给（视锥尺寸），见上面 useFrame */}
            <primitive object={sharedGeometry('plane', 1, 1)} attach="geometry" />
            <shaderMaterial
                ref={matRef}
                vertexShader={WEATHER_VERT}
                fragmentShader={WEATHER_FRAG}
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
