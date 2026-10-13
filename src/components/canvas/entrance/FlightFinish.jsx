import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { FINISH_VERT, FINISH_FRAG, FINISH_PARAMS, FINISH_IDENTITY } from '../../../shaders/flightFinish';
import { reducedMotion } from '../../../hooks/useReducedMotion';

/**
 * FlightFinish — 飞行视图的「单趟电影后期」（WO-29，2026-10-13）。
 * ==================================================================
 *
 * 用户：「飞行试图上「单趟电影后期」（颗粒 + 辉光）」。DR-Q 定 **(A) 只限飞行视图**。
 *
 * 做法（与参考实现 `anime-renderer.js` 同构）：**接管这一帧的渲染** ——
 *
 *   ① 场景先渲进一张 `WebGLRenderTarget`（而不是直接上画布）；
 *   ② 再渲一趟全屏 quad，在那里加辉光 / 饱和度 / 颗粒。
 *
 * 后期本体在 `shaders/flightFinish.js`（那边有色彩空间的完整推导）。
 *
 * ---------------------------------------------------------------------------
 * 怎么"接管"的：`useFrame(cb, 1)`
 * ---------------------------------------------------------------------------
 * R3F 的渲染循环里那一句是：
 *
 *     if (!state.internal.priority && state.gl.render) state.gl.render(scene, camera)
 *
 * 而 `useFrame(cb, renderPriority)` 在**注册时**把 `internal.priority`
 * 加上「priority > 0 ? 1 : 0」。所以只要有一个 `priority > 0` 的订阅者，
 * **R3F 自己那一句就不执行了** —— 渲染变成我们的事。这也正是
 * `useFrame(cb, 1)` 的语义（"手动渲染"）。
 *
 * ⚠️ 反过来，**卸载**时那个计数会减回去 ⇒ R3F 的自动渲染自动恢复。
 *    这正是"退出无残留"在**结构上**成立的原因（不需要写任何还原代码）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 零影响：不飞行时这个组件**根本不存在**
 * ---------------------------------------------------------------------------
 * `Experience.jsx` 里它的挂载条件是 `cameraMode === CAMERA_MODE.FLIGHT`
 * （与 `FlightCamera` 同一条）。不飞行 ⇒ 不挂载 ⇒ `internal.priority` 是 0
 * ⇒ 渲染管线**与改动前逐位相同**。这不是"我们小心地没碰东西"，而是
 * "那一段代码不在场"。
 *
 * ---------------------------------------------------------------------------
 * 🔴🔴 target 的三行配置 —— 缺一行就静默错色（本文件最要紧的地方）
 * ---------------------------------------------------------------------------
 * 症状：飞机一升空，**画面整体变暗变橙**（或者整体发灰），退出飞行又正常 ——
 * 看着不像 bug，像"天上光本来就不一样"。
 *
 * 根因是**两种材质写进 target 的量纲不一致**：
 *
 *   · **内置材质**（Basic / Standard）的 fragment shader 里插了
 *     `#include <colorspace_fragment>`。而 three 规定：渲进**非 XR** 的
 *     render target 时，着色器的输出色彩空间被**强制**成
 *     `LinearSRGBColorSpace`（`WebGLPrograms.getParameters` 与
 *     `WebGLRenderer.setProgram` 里
 *     `currentRenderTarget.isXRRenderTarget === true ? texture.colorSpace
 *      : LinearSRGBColorSpace` 那一行）⇒ 那段 chunk 成了空操作
 *     ⇒ **内置材质写进去的是线性值**。
 *   · **本项目的自定义 `ShaderMaterial` 一律不插那两个 chunk**（它们写的
 *     本来就是屏幕值，见 `config/theme.js` 的 `toShaderColor()`）
 *     ⇒ **写进去的是 sRGB 值**。
 *
 * 于是一张 target 里两种量纲混着。无论最后一趟编不编码，**必有一半是错的**。
 *
 * 解法是**让 target 表现得和画布一模一样**（而不是去改几百个材质）：
 *
 *   ① `texture.colorSpace = SRGBColorSpace`
 *        让内置材质照旧过 OETF（与画布一致）。
 *   ② `isXRRenderTarget = true`
 *        ①只有在 XR target 上才被 three 采纳 —— 这一行就是那把钥匙。
 *        （副作用恰好也是我们要的：tone mapping 那个分支同样只在
 *          `currentRenderTarget === null || isXRRenderTarget` 时才生效，
 *          所以 tone mapping 的行为也和画布一致。本项目没开 tone mapping，
 *          但这条不该靠"碰巧"。）
 *   ③ `texture.internalFormat = 'RGBA8'`
 *        🔴 **必须显式钉死**。只写①②的话，`WebGLTextures.getInternalFormat`
 *        会因为 `colorSpace === SRGB` 把存储选成 `SRGB8_ALPHA8`（硬件 sRGB），
 *        于是**硬件再编一次码**：着色器写 sRGB → 硬件又 OETF 一次 → 双重编码。
 *        显式给 `internalFormat` 会让 `getInternalFormat` 直接短路返回
 *        `gl.RGBA8` ⇒ 存储是普通 8 位 ⇒ 写进去什么、读出来就是什么。
 *        （MSAA 那条路上「多采样 renderbuffer」与「解析用贴图」两处都会走
 *          `getInternalFormat`，所以这一行把**两处一起**钉住了。）
 *
 * 结果：target 里就是**画布上的值**。所以那一趟把读到的值**当屏幕值**处理，
 * 并且**不再编码一次** —— 见 `shaders/flightFinish.js` 的片元（它故意不插
 * `#include <colorspace_fragment>`）。
 *
 * 判据：`harness/probe-flight-finish.mjs` 的 F1 —— 把这一趟的参数设成
 * 「什么都不做」（`FINISH_IDENTITY`），逐像素比对"经过 target 一趟"与
 * "R3F 直出"两张同帧画面。色彩空间写错的话这一条会**大**幅不过。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么是「效果 + ref」而不是「`useMemo` + 直接改」
 * ---------------------------------------------------------------------------
 * 这一套东西**每帧都要改**（`uTime`）。而 eslint 的
 * `react-hooks/immutability` 是 **error**：不允许修改 hook 的返回值。
 * 本项目一贯的做法是把它放进 ref，在 `useFrame` 里改 `ref.current` 的内容
 * （`SkyClouds` / `IslandGround` 的材质就是这么拿到的）。这里没有 JSX 可以挂
 * callback ref（quad 住在自己的 `THREE.Scene` 里，不在 React 树上），
 * 所以改成**在 layout effect 里建、存进 ref** —— 效果里写 ref 是允许的，
 * 而 `useFrame` 回调不是渲染期，读 ref 也允许。
 */

/**
 * DEV 专用的调试开关。
 *
 * `direct` —— 这一帧**不接管**，直接用 R3F 那一句渲到画布上。
 * 探针靠它拿"没有这一趟"的参考帧，**不需要另开一个页面**（另开页面的话
 * 时钟、相机、季节都要重新对齐，比的是两个东西）。生产构建里是 `null`，
 * `DEBUG && DEBUG.direct` 会被摇掉。
 */
const DEBUG = import.meta.env.DEV ? { direct: false } : null;

/**
 * 建这一趟需要的全部 GPU 资源。**纯构造**，没有 React。
 *
 * @param {import('three').WebGLRenderer} gl
 */
function buildRig(gl) {
    const ctx = gl.getContext();

    /**
     * ⚠️ **多采样数跟着画布走**，不要自己写 4。
     *
     * 这一趟之后画布上就没有 MSAA 了（场景渲进了 target），所以 target 的
     * 采样数就是飞行时**唯一的**抗锯齿来源。而探针 F1 要比对"经过 target"
     * 与"直出画布"两张同帧画面 —— 两边采样数不一致的话，几何边缘会有几千个
     * 像素对不上，把一个**色彩空间**判据淹掉。
     * `SAMPLES` 是默认帧缓冲的**真实**采样数（不是"我们请求的"）。
     */
    const canvasSamples = Math.min(
        ctx.getParameter(ctx.SAMPLES) || 0,
        gl.capabilities.maxSamples || 0,
    );

    const target = new THREE.WebGLRenderTarget(1, 1, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        // ①②③ —— 见文件头。顺序无所谓，但**三行缺一不可**。
        colorSpace: THREE.SRGBColorSpace,
        internalFormat: 'RGBA8',
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // 场景里有透明物（云 / 叶 / 天象）⇒ 要深度缓冲，遮挡关系才不会被
        // "最后画的那个"决定。
        depthBuffer: true,
        stencilBuffer: false,
        samples: canvasSamples,
    });
    target.texture.name = 'flight-finish-scene';
    target.isXRRenderTarget = true;

    const material = new THREE.ShaderMaterial({
        name: 'flight-finish',
        uniforms: {
            tScene: { value: target.texture },
            uTime: { value: 0 },
            uGrain: { value: FINISH_PARAMS.GRAIN },
            uBloom: { value: FINISH_PARAMS.BLOOM },
            uBloomKnee: { value: FINISH_PARAMS.KNEE },
            uSat: { value: FINISH_PARAMS.SAT },
            // ⚠️ 用 Vector3 而不是 Color：Color 从数组 / 十六进制构造时会过
            //    `ColorManagement`（sRGB→线性），而这里要的是**屏幕值空间
            //    的乘数**，转换一次反而错了。
            uTint: { value: new THREE.Vector3(...FINISH_PARAMS.TINT) },
            uResolution: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: FINISH_VERT,
        fragmentShader: FINISH_FRAG,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry, material);
    quad.frustumCulled = false;
    const screen = new THREE.Scene();
    screen.add(quad);
    const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return { target, material, geometry, screen, screenCamera, canvasSamples };
}

export function FlightFinish() {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const size = useThree((state) => state.size);
    const dpr = useThree((state) => state.viewport.dpr);

    /** 全部资源住在这里（见文件头「为什么是效果 + ref」）。 */
    const rigRef = useRef(null);

    useLayoutEffect(() => {
        rigRef.current = buildRig(gl);
        return () => {
            const rig = rigRef.current;
            rigRef.current = null;
            if (!rig) return;
            // ⚠️ 先解绑再释放：万一卸载发生在两趟之间，画布上留着一个已释放的
            //    target，下一帧（R3F 自动渲染）就会渲进空气。
            gl.setRenderTarget(null);
            rig.target.dispose();
            rig.material.dispose();
            rig.geometry.dispose();
        };
    }, [gl]);

    /**
     * 尺寸：**以绘制缓冲为准**，不是 CSS 尺寸。
     *
     * `size` 是 CSS 像素、`dpr` 是像素比，而真正要分配的是
     * `drawingBufferWidth/Height`。自己乘一遍会踩 `Math.floor` 的取整差
     * （差 1 px 时那一趟整体偏半个像素，看着"糊了一点点"）。
     * 所以直接问渲染器，只在 `size` / `dpr` 变化时重问。
     */
    useLayoutEffect(() => {
        const rig = rigRef.current;
        if (!rig) return;
        const v = new THREE.Vector2();
        gl.getDrawingBufferSize(v);
        const w = Math.max(1, Math.round(v.x));
        const h = Math.max(1, Math.round(v.y));
        rig.target.setSize(w, h);
        // `uResolution` 是**片元里换算像素步长**用的（辉光沿 8 个方向各走
        // 5 px / 16 px），必须是同一个尺寸，否则辉光半径会随窗口缩放漂。
        rig.material.uniforms.uResolution.value.set(w, h);
    }, [gl, size, dpr]);

    useFrame((state) => {
        const rig = rigRef.current;

        // 兜底：layout effect 早于下一帧，正常跑不到这里；真跑到了就直出，
        // 至少不让画面空着。
        if (!rig) {
            gl.setRenderTarget(null);
            gl.render(scene, state.camera);
            return;
        }

        const u = rig.material.uniforms;
        // 颗粒的"闪"是纯装饰 ⇒ 减少动态效果时把时钟钉在 0：
        // 纸张底噪（按像素固定的那层）还在，只是不再随时间跳。
        // 判据见 hooks/useReducedMotion.js（"停用户没要求的运动"）。
        u.uTime.value = reducedMotion() ? 0 : state.clock.elapsedTime;

        if (DEBUG && DEBUG.direct) {
            // 参考帧：这一句与 R3F 自己那句**完全同一句**
            // （`state.gl.render(state.scene, state.camera)`）。
            gl.setRenderTarget(null);
            gl.render(scene, state.camera);
            return;
        }

        // 存档 / 还原 render target：万一将来有人在这一帧之前挂了别的 target，
        // 我们不能把它踢掉（参考实现同样处理）。
        const previous = gl.getRenderTarget();
        gl.setRenderTarget(rig.target);
        gl.render(scene, state.camera);
        gl.setRenderTarget(previous);
        // 第二趟：全屏 quad。⚠️ 它渲进的是**画布**（`previous`），
        //    而这个材质**故意不编码色彩空间** —— 见文件头。
        gl.render(rig.screen, rig.screenCamera);
    }, 1); // 🔴 priority = 1 ⇒ R3F 不再自己渲染（见文件头）

    // DEV 钩子 —— 与 `window.__scene` / `__cam` / `__flight` 同一套。
    // 探针靠它把这一趟设成「什么都不做」（`FINISH_IDENTITY`）并拿参考帧。
    // ⚠️ 暴露的是**真源本身**（`material.uniforms` / `FINISH_PARAMS`），
    //    不是另抄一份期望值 —— hard-rules §28。
    useEffect(() => {
        if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
        const rig = rigRef.current;
        if (!rig) return undefined;
        window.__flightFinish = {
            material: rig.material,
            target: rig.target,
            scene: rig.screen,
            camera: rig.screenCamera,
            /** 参数真源（探针不许自己写一份）。 */
            params: FINISH_PARAMS,
            /** 「什么都不做」的那一组（探针 F1 的恒等往返用）。 */
            identity: FINISH_IDENTITY,
            /** target 的多采样数（应当等于画布的 `SAMPLES`）。 */
            samples: rig.canvasSamples,
            /** `{ direct: bool }` —— 见文件头。 */
            debug: DEBUG,
        };
        return () => { delete window.__flightFinish; };
    }, [gl]);

    return null;
}

export default FlightFinish;
