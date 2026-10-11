import { useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { Observer } from 'gsap/all';

gsap.registerPlugin(Observer);
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAchievements } from '../context/AchievementsContext';
import { reducedMotion } from './useReducedMotion';
import { settleLerp, SETTLE_ANGLE } from '../utils/settle';
import { INTERIOR_FRONT_Z } from '../config/island';

// Door positions for auto-glance
const DOOR_POSITIONS = [
    { z: -18, side: 'left' },
    { z: -32, side: 'right' },
    { z: -48, side: 'left' },
    { z: -62, side: 'right' },
];

/**
 * 🔴 后退的硬边界（2026-10-11，WO-6 的封口③）
 * ==========================================
 *
 * 走廊的**前端就是屋子的前门**（`INTERIOR_FRONT_Z` = 屋身前墙 = 22.15）。
 * 门外面是竹篱笆小院，所以往后退不能只是"停住"—— 那会停在门口，玩家看得见
 * 院子却出不去，读成一个死头。按 DR-G 的定案，退到门前**自动退出**：
 * 触发 `HouseExit`，相机滑出门、环绕视角重新挂上（语义是"退出去 = 回家"）。
 *
 * 为什么光有"触发"不够、还要一条硬夹：`HouseExit` 会等 `gsap` 的空档
 * （`RETRY_MS = 250`，最长等 6 秒），这段时间里相机会继续往后走 ——
 * 一直走到门外去，从门洞里**看得见院子**（那时走廊已经不算"人在里面"了）。
 * 所以目标 z 必须同时被夹住：
 *
 *     BACK_OUT_LIMIT_Z = 22.15 − 0.6 = 21.55   ← 停在**门内** 0.6
 *
 * 0.6 是够的：段 0 的顶棚第一块瓦片前沿正好在 22.15（见 `CorridorWalls`），
 * 覆盖 [12.15, 22.15]；地板是一整块 80 长的面，覆盖 [−57.85, 22.15]。
 * 相机停在 21.55 时**仍在两者的覆盖范围内**，抬头低头都不会看见外面。
 *
 * 触发与重新武装分开，是为了让"退出被拒"（`SceneContext.requestHouseExit`
 * 在门正忙时**拒绝**而不是排队）之后还能再试一次：走到 `BACK_OUT_REARM_Z`
 * （19.65）以内重新武装，再退回来就再触发一次。没有这条，被拒一次就永久
 * 卡在门口。
 *
 * ⚠️ 还有第三个数没出现在这里，因为它不是边界而是**闩**：
 *    `everInsideRef`（"相机起手在门内吗"）—— 门外的相机是合法起点，
 *    不能夹也不能触发退出。见 refs 声明处的长注释。
 */
const BACK_OUT_LIMIT_Z = INTERIOR_FRONT_Z - 0.6;
/** 退到这里就算"想出去"，触发 `onBackOut`。 */
const BACK_OUT_TRIGGER_Z = INTERIOR_FRONT_Z - 1.0;
/** 往前走回这里就重新武装（见上）。 */
const BACK_OUT_REARM_Z = INTERIOR_FRONT_Z - 2.5;

/**
 * useInfiniteCamera Hook
 * 
 * When disabled: does NOT touch camera at all (GSAP can control it)
 * When enabled: takes over camera control with scroll/parallax
 * Supports: desktop (mouse/wheel) + mobile (touch/gyroscope)
 */
const useInfiniteCamera = ({
    segmentLength = 80,
    scrollSpeed = 0.02,
    parallaxIntensity = 0.3,
    smoothing = 0.035, // Lower = longer deceleration, smoother feel
    glanceIntensity = 0.15,
    scrollEnabled = true,
    parallaxEnabled = true,
    onBackOut = null // 退到前门 ⇒ 请求退出（见 BACK_OUT_* 那段注释）
} = {}) => {
    const { camera } = useThree();

    // Camera tracking
    const targetZ = useRef(28);
    const currentZ = useRef(28);
    const parallax = useRef({ x: 0, y: 0 });
    const targetParallax = useRef({ x: 0, y: 0 });
    const glanceOffset = useRef(0);
    const targetGlance = useRef(0); // For door hover glance
    const currentSegment = useRef(0);
    const scrollEnabledRef = useRef(scrollEnabled);
    const parallaxEnabledRef = useRef(parallaxEnabled);
    const justEnabled = useRef(false);
    const { unlockAchievement } = useAchievements();

    // Mobile touch tracking
    const touchStart = useRef({ x: 0, y: 0 });
    const swipeGlance = useRef(0); // Horizontal swipe-based camera rotation
    const targetSwipeGlance = useRef(0);
    const useGyroscope = useRef(false);

    // Camera override - when true, external code (like DoorSection) controls camera
    const cameraOverride = useRef(false);
    // Skip first frame after re-enabling to prevent camera jump
    const skipFrameAfterEnable = useRef(false);
    // Smooth blend-in counter (frames remaining to blend from saved rotation)
    const blendInFrames = useRef(0);
    const savedRotation = useRef({ x: 0, y: 0, z: 0 });

    // Limits for swipe glance (in radians, ~15 degrees each way)
    const MAX_SWIPE_GLANCE = 0.26;

    // Store last known mouse position (normalized -1 to 1)
    const lastMousePos = useRef({ x: 0, y: 0 });

    /**
     * 🔴 后退边界用**两个**闩，不是一个 —— 它们答的是不同的问题：
     *
     *   `everInsideRef` —— 「相机**起手**就在门内吗？」只有为 true 时，后退才受
     *      门前那道夹的限制。相机起点在**门外**是**合法状态**：
     *      · `window.__aispin.enter()`（12 个 harness 用它跳过推门动画）
     *      · `?orbit` 与环绕相机的交接
     *      两者都停在 z = 28（门前 5.85）。无条件 `min(currentZ, LIMIT)` 会把
     *      这台相机一把拽到 21.55 —— **6.45 单位的瞬移**，而且下一帧就满足
     *      `> BACK_OUT_TRIGGER_Z` ⇒ 误触发一次退出（相机又滑回 28 并 markExited）。
     *      所以它**只**在 scroll 打开的那一帧按相机的实际位置初始化
     *      （见下面的 layout effect），而不是写死 true。
     *
     *   `backOutAskedRef` —— 「这一次'想出去'已经喊过了吗？」喊过一次就不再喊，
     *      直到玩家走回 `BACK_OUT_REARM_Z` 以内重新武装。见 BACK_OUT_* 注释。
     *
     * ⚠️ 两个闩**不能合并**：合并之后，退出被拒（`doorBusy`）时闩会一起复位，
     *    玩家就能一路退出门外 —— 那正是「墙会消失」那一类 bug 的入口。
     */
    const everInsideRef = useRef(false);
    const backOutAskedRef = useRef(false);

    /**
     * How far the camera should glance toward the nearest door at a given Z.
     *
     * Declared up here, above every effect that uses it: it used to sit near the
     * bottom of the hook, which meant the enable/disable layout effect and the
     * per-frame callback both captured a binding that was still in its temporal
     * dead zone on the first render.
     */
    const calculateGlance = useCallback((z, segment) => {
        const zOffset = INTERIOR_FRONT_Z - (segment * segmentLength);
        let bestStrength = 0;
        let bestDir = 0;

        const START_DIST = 15;
        const PEAK_DIST = 8;
        const END_DIST = -2;

        for (const door of DOOR_POSITIONS) {
            const doorGlobalZ = zOffset + door.z;
            const dist = z - doorGlobalZ;

            let strength = 0;
            if (dist > PEAK_DIST && dist < START_DIST) {
                strength = (START_DIST - dist) / (START_DIST - PEAK_DIST);
            } else if (dist <= PEAK_DIST && dist > END_DIST) {
                strength = (dist - END_DIST) / (PEAK_DIST - END_DIST);
            }

            if (strength > 0) {
                const easedStrength = strength * (2 - strength);
                const dir = door.side === 'left' ? -1 : 1;
                if (easedStrength > bestStrength) {
                    bestStrength = easedStrength;
                    bestDir = dir;
                }
            }
        }

        return bestDir * bestStrength * glanceIntensity * 3.5;
    }, [segmentLength, glanceIntensity]);

    // Update enabled refs
    useLayoutEffect(() => {
        const wasScrollEnabled = scrollEnabledRef.current;
        scrollEnabledRef.current = scrollEnabled;
        parallaxEnabledRef.current = parallaxEnabled;

        // When scroll becomes enabled, sync with current camera position
        if (scrollEnabled && !wasScrollEnabled) {
            // KILL GSAP TWEENS: Ensure no lingering entrance animations interfere
            gsap.killTweensOf(camera.position);
            gsap.killTweensOf(camera.rotation);
            gsap.killTweensOf(camera.savedState); // Just in case

            justEnabled.current = true;

            // SAVE current camera rotation for smooth blend-in
            // This prevents the instant lookAt() from snapping the camera
            savedRotation.current = {
                x: camera.rotation.x,
                y: camera.rotation.y,
                z: camera.rotation.z
            };

            // Start blend-in phase (30 frames ≈ 0.5 sec at 60fps)
            blendInFrames.current = 30;

            targetZ.current = camera.position.z;
            currentZ.current = camera.position.z;

            // 后退边界的两把闩跟着相机**实际位置**初始化 —— 见上面 refs 的注释。
            // 走正常流程进来时相机落在 `INTERIOR_FRONT_Z − 3.65` = 18.5
            // （`EntranceDoors.ENTRANCE_LANDING_INSET`），远在 19.65 以内 ⇒
            // `everInside` 为 true，后退立刻受门前那道夹限制。
            // 而 `__aispin.enter()` / `?orbit` 交接时相机在 28 ⇒ 为 false，
            // 门外的相机不会被拽、也不会误触发退出。
            everInsideRef.current = camera.position.z < BACK_OUT_REARM_Z;
            backOutAskedRef.current = false;

            // Sync parallax with CURRENT camera position ONLY if we just enabled
            // To prevent snapping when achievements update the component
            if (!wasScrollEnabled) {
                parallax.current = { x: camera.position.x, y: camera.position.y - 0.2 };
                targetParallax.current = { x: camera.position.x, y: camera.position.y - 0.2 };
            }

            // Initialize glanceOffset with the CORRECT value for current position
            // This makes camera immediately look at the door (if near one) instead of looking forward first
            const initialGlance = calculateGlance(currentZ.current, Math.floor((INTERIOR_FRONT_Z - currentZ.current) / segmentLength));
            glanceOffset.current = initialGlance;
            targetGlance.current = initialGlance;

            // Reset swipe glance (mobile)
            swipeGlance.current = 0;
            targetSwipeGlance.current = 0;

            // Recalculate segment
            currentSegment.current = Math.floor((INTERIOR_FRONT_Z - currentZ.current) / segmentLength);
        }
    }, [scrollEnabled, parallaxEnabled, camera, parallaxIntensity]);

    // Handle wheel scroll (desktop)
    const handleWheel = useCallback((e) => {
        if (!scrollEnabledRef.current) return;

        e.preventDefault();
        const delta = e.deltaY * scrollSpeed;
        // 往后退（+z）夹在门内 —— 见 BACK_OUT_LIMIT_Z 的注释。
        targetZ.current = Math.min(targetZ.current - delta, BACK_OUT_LIMIT_Z);
        unlockAchievement('corridor_explore');
    }, [scrollSpeed, unlockAchievement]);

    // Handle keyboard navigation (A1 accessibility)
    const handleKeyDown = useCallback((e) => {
        if (!scrollEnabledRef.current) return;

        // Don't interfere when user is typing in inputs or textareas
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const keyScrollMap = {
            'ArrowDown': 100,
            'ArrowUp': -100,
            'PageDown': 400,
            'PageUp': -400,
            ' ': 200,           // Spacebar
        };

        const delta = keyScrollMap[e.key];
        if (delta !== undefined) {
            e.preventDefault();
            // 往后退（+z）夹在门内 —— 见 BACK_OUT_LIMIT_Z 的注释。
            targetZ.current = Math.min(targetZ.current - delta * scrollSpeed, BACK_OUT_LIMIT_Z);
            unlockAchievement('corridor_explore');
        }

        // Arrow Left/Right → subtle camera glance
        if (parallaxEnabledRef.current) {
            if (e.key === 'ArrowLeft') {
                targetSwipeGlance.current = Math.max(-MAX_SWIPE_GLANCE, targetSwipeGlance.current - 0.08);
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                targetSwipeGlance.current = Math.min(MAX_SWIPE_GLANCE, targetSwipeGlance.current + 0.08);
                e.preventDefault();
            }
        }
    }, [scrollSpeed, MAX_SWIPE_GLANCE, unlockAchievement]);

    // Handle mouse parallax (desktop) - ALWAYS tracks mouse position
    // but only applies to targetParallax when enabled
    const handleMouseMove = useCallback((e) => {
        // Always track mouse position for smooth transition when enabled
        const normalizedX = (e.clientX / window.innerWidth) * 2 - 1;
        const normalizedY = (e.clientY / window.innerHeight) * 2 - 1;
        lastMousePos.current = { x: normalizedX, y: normalizedY };

        // Only apply parallax when enabled
        if (!parallaxEnabledRef.current) return;

        targetParallax.current.x = normalizedX * parallaxIntensity;
        targetParallax.current.y = -normalizedY * parallaxIntensity * 0.5;
    }, [parallaxIntensity]);

    // Handle touch start (mobile)
    const handleTouchStart = useCallback((e) => {
        // Always track touch start for potential parallax
        touchStart.current.x = e.touches[0].clientX;
        touchStart.current.y = e.touches[0].clientY;
    }, []);

    // Handle touch move (mobile scroll + horizontal glance)
    const handleTouchMove = useCallback((e) => {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        // Vertical scroll - only when scroll enabled
        if (scrollEnabledRef.current) {
            const deltaY = (touchStart.current.y - currentY) * scrollSpeed * 1.5;
            // 往后退（+z）夹在门内 —— 见 BACK_OUT_LIMIT_Z 的注释。
            targetZ.current = Math.min(targetZ.current - deltaY, BACK_OUT_LIMIT_Z);
            unlockAchievement('corridor_explore');
        }

        // Horizontal swipe -> camera glance (works with parallax enabled)
        if (parallaxEnabledRef.current) {
            const deltaX = (touchStart.current.x - currentX) * 0.003; // Subtle multiplier
            targetSwipeGlance.current += deltaX;

            // Clamp to limits (±15 degrees)
            targetSwipeGlance.current = Math.max(-MAX_SWIPE_GLANCE, Math.min(MAX_SWIPE_GLANCE, targetSwipeGlance.current));
        }

        touchStart.current.x = currentX;
        touchStart.current.y = currentY;
    }, [scrollSpeed, MAX_SWIPE_GLANCE]);

    // Handle device orientation (gyroscope for mobile parallax)
    const handleDeviceOrientation = useCallback((e) => {
        if (!parallaxEnabledRef.current || !useGyroscope.current) return;

        // Desktop browsers sometimes fire this event with null values immediately when attached
        if (e.gamma === null && e.beta === null) return;

        // gamma: left-to-right tilt (-90 to 90)
        // beta: front-to-back tilt (-180 to 180), 45 is roughly "holding phone naturally"
        const gamma = e.gamma || 0;
        const beta = e.beta || 0;

        // Clamp values and convert to parallax
        const clampedGamma = Math.max(-45, Math.min(45, gamma));
        const clampedBeta = Math.max(0, Math.min(90, beta)) - 45; // Center around 45 degrees

        targetParallax.current.x = (clampedGamma / 45) * parallaxIntensity;
        targetParallax.current.y = -(clampedBeta / 45) * parallaxIntensity * 0.5;
    }, [parallaxIntensity]);

    // Request gyroscope permission (iOS 13+)
    const requestGyroscopePermission = useCallback(async () => {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    useGyroscope.current = true;
                    window.addEventListener('deviceorientation', handleDeviceOrientation);
                }
            } catch {
                // console.log('Gyroscope permission denied');
            }
        } else {
            // Non-iOS or older browsers - just add listener
            useGyroscope.current = true;
            window.addEventListener('deviceorientation', handleDeviceOrientation);
        }
    }, [handleDeviceOrientation]);

    // (Removed manual doorHover listener - replaced with auto-glance in useFrame)

    useEffect(() => {
        // Desktop non-scroll events
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('keydown', handleKeyDown);

        // GSAP Observer for unified scroll/touch handling
        const scrollObserver = Observer.create({
            target: window,
            type: "wheel,touch,pointer",
            onWheel: (e) => {
                handleWheel(e.event);
            },
            onPress: (e) => {
                if (e.event.touches && e.event.touches.length > 0) {
                    handleTouchStart(e.event);
                }
            },
            onDrag: (e) => {
                if (e.event.touches && e.event.touches.length > 0) {
                    handleTouchMove(e.event);
                }
            }
        });

        // Try to enable gyroscope (will work on Android, need permission on iOS)
        requestGyroscopePermission();

        return () => {
            scrollObserver.kill();
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('deviceorientation', handleDeviceOrientation);
        };
    }, [handleWheel, handleMouseMove, handleKeyDown, handleTouchStart, handleTouchMove, handleDeviceOrientation, requestGyroscopePermission]);

    // Main camera update loop
    useFrame(() => {
        // If camera override is active, let external code control the camera
        if (cameraOverride.current) {
            return;
        }

        // Skip first frame after re-enabling to prevent camera jump
        // This allows the camera to stay exactly where exit animation left it
        if (skipFrameAfterEnable.current) {
            skipFrameAfterEnable.current = false;
            return;
        }

        const scrollActive = scrollEnabledRef.current;
        const parallaxActive = parallaxEnabledRef.current;

        // If nothing is enabled, do nothing
        if (!scrollActive && !parallaxActive) {
            return;
        }

        // prefers-reduced-motion —— 见 hooks/useReducedMotion.js 的判据：
        // **停用户没要求的运动，留用户主动发起的运动。**
        //
        //   停  鼠标视差（相机跟着指针晃）、自动回头看门（glanceOffset）。
        //        这两个都是相机**自己**在转/在晃，和用户想不想走无关。
        //   留  滚轮 / 键盘 / 触摸推动的前进（targetZ）。那是用户明确要求的。
        const reduced = reducedMotion();

        // Smooth parallax - always update when parallax is enabled
        if (parallaxActive) {
            if (reduced) {
                // 直接把视差钉死在走廊中轴：目标值本身仍然会被 mousemove 写入，
                // 但相机不再消费它，所以"相机跟着鼠标晃"这件事整个消失。
                parallax.current.x = 0;
                parallax.current.y = 0;
                swipeGlance.current = 0;
            } else {
                const parallaxSmoothing = justEnabled.current ? 0.02 : smoothing * 0.8;
                parallax.current.x = settleLerp(parallax.current.x, targetParallax.current.x, parallaxSmoothing);
                parallax.current.y = settleLerp(parallax.current.y, targetParallax.current.y, parallaxSmoothing);

                // Smooth swipe glance (mobile horizontal swipe)
                swipeGlance.current = settleLerp(swipeGlance.current, targetSwipeGlance.current, 0.08, SETTLE_ANGLE);
            }
        }

        // After a bit, normal smoothing
        if (justEnabled.current && Math.abs(parallax.current.x - targetParallax.current.x) < 0.01) {
            justEnabled.current = false;
        }

        // Z movement and door glance - only when scroll is enabled
        if (scrollActive) {
            // Smooth Z movement. settleLerp 而不是裸 lerp：渐近的 lerp 永远
            // 到不了 targetZ，相机停手之后位置还会以 1e-9/帧 的量爬下去，
            // 于是所有读相机位置的 useFrame 消费者（门的朝向、标题分裂）
            // 永远在写矩阵 —— 场景"从来没有静止过"。见 utils/settle.js。
            currentZ.current = settleLerp(currentZ.current, targetZ.current, smoothing);

            // 🔴 门前那道夹。**只在"相机起手就在门内"时才生效** ——
            // 相机起点在门外（`__aispin.enter()` / `?orbit` 交接，z = 28）是
            // 合法状态，无条件夹会把它拽到 21.55（6.45 单位瞬移）并立刻误
            // 触发退出。见上面 refs 的注释。
            //
            // 夹的是**两个**值：`currentZ` 是双保险（三条输入路径都夹过
            // `targetZ`，但那是"约定"不是"事实"），`targetZ` 是真正的闸门 ——
            // 没有它，被拒一次之后 `currentZ` 会继续朝门外的 target 爬。
            if (everInsideRef.current) {
                if (currentZ.current > BACK_OUT_LIMIT_Z) currentZ.current = BACK_OUT_LIMIT_Z;
                if (targetZ.current > BACK_OUT_LIMIT_Z) targetZ.current = BACK_OUT_LIMIT_Z;

                // 退到门前 ⇒ 请求退出（封口③）。喊一次就够，走回
                // `BACK_OUT_REARM_Z` 以内重新武装 —— 见 BACK_OUT_* 注释。
                if (currentZ.current < BACK_OUT_REARM_Z) {
                    backOutAskedRef.current = false;
                } else if (currentZ.current > BACK_OUT_TRIGGER_Z && !backOutAskedRef.current) {
                    backOutAskedRef.current = true;
                    onBackOut?.();
                }
            }

            if (reduced) {
                // 关掉"自动回头看门"：走廊每经过一扇门，相机就会自己转过去
                // 看一眼再转回来。这是最典型的"用户没要求的镜头运动"。
                targetGlance.current = 0;
                glanceOffset.current = 0;
            } else {
                // Auto-glance proximity check
                targetGlance.current = calculateGlance(currentZ.current, currentSegment.current);

                // Dynamic smoothing: slow to look (0.03), fast to release (0.08)
                // This stops the camera from "dragging" after passing the door
                const isReleasing = Math.abs(targetGlance.current) < Math.abs(glanceOffset.current);
                const lerpSpeed = isReleasing ? 0.08 : 0.03;

                glanceOffset.current = settleLerp(glanceOffset.current, targetGlance.current, lerpSpeed, SETTLE_ANGLE);
            }

            // Apply Z position to camera (only when scroll enabled).
            // Vector3.set() writes all three axes in one go — three.js then
            // recomputes the matrix once per frame instead of three times, and
            // the mutation stays behind a method call rather than reaching into
            // a property of a hook-owned object.
            camera.position.set(parallax.current.x, 0.2 + parallax.current.y, currentZ.current);

            // Look direction with glance + swipe glance
            const lookX = parallax.current.x * 0.3 + glanceOffset.current * 3 + swipeGlance.current * 4;

            // BLEND-IN PHASE: Smoothly transition from saved rotation to lookAt
            if (blendInFrames.current > 0) {
                // Calculate what lookAt WOULD set the rotation to
                camera.lookAt(lookX, 0.13 + parallax.current.y, currentZ.current - 10);
                const targetRotation = {
                    x: camera.rotation.x,
                    y: camera.rotation.y,
                    z: camera.rotation.z
                };

                // Calculate blend factor (0 = saved, 1 = target)
                const blendFactor = 1 - (blendInFrames.current / 30);

                // Lerp from saved rotation to target.
                // Euler.set() keeps the camera's YXZ order and notifies three.js
                // once instead of three times per frame.
                camera.rotation.set(
                    THREE.MathUtils.lerp(savedRotation.current.x, targetRotation.x, blendFactor),
                    THREE.MathUtils.lerp(savedRotation.current.y, targetRotation.y, blendFactor),
                    THREE.MathUtils.lerp(savedRotation.current.z, targetRotation.z, blendFactor)
                );

                blendInFrames.current--;
            } else {
                // Normal mode - apply lookAt directly
                camera.lookAt(lookX, 0.13 + parallax.current.y, currentZ.current - 10);
            }

            // Update segment tracking
            const segment = Math.floor((INTERIOR_FRONT_Z - currentZ.current) / segmentLength);
            if (segment !== currentSegment.current) {
                currentSegment.current = segment;
            }
        } else if (parallaxActive) {
            // Parallax-only mode (during GSAP animation)
            // Apply parallax as offset to current camera position, and adjust lookAt
            // Don't override camera.position.z - GSAP controls it
            camera.position.set(parallax.current.x, 0.2 + parallax.current.y, camera.position.z);

            // Look direction with parallax offset
            const lookX = parallax.current.x * 0.3 + swipeGlance.current * 4;
            camera.lookAt(lookX, 0.13 + parallax.current.y, camera.position.z - 10);
        }
    });

    // Function to enable/disable camera override
    const setCameraOverride = useCallback((active) => {
        cameraOverride.current = active;
        if (!active) {
            // When releasing override, sync our state with current camera position
            const z = camera.position.z;
            targetZ.current = z;
            currentZ.current = z;

            // Recalculate current segment immediately
            const initSegment = Math.floor((INTERIOR_FRONT_Z - z) / segmentLength);
            currentSegment.current = initSegment;

            // Sync parallax
            parallax.current = { x: camera.position.x, y: camera.position.y - 0.2 };
            targetParallax.current = { x: camera.position.x, y: camera.position.y - 0.2 };

            // Calculate "Ideal" glance for this position
            const initialGlance = calculateGlance(z, initSegment);

            // SOFT RESUME LOGIC:
            // Check if our current physical rotation matches the "ideal" glance.
            // If we just exited a room via teleport, we might be looking STRAIGHT (0),
            // but the "ideal" glance wants us to look at the door (nonzero).
            // Mismatch causes a SNAP.
            // Fix: If there's a mismatch, initialize glanceOffset to match REALITY, not IDEAL.

            // 1. Get current physical "glance" equivalent from rotation
            // rotation.y ≈ parallax + glance * 3 + swipe * 4
            // We assume parallax is synced above, swipe is 0.
            // So: currentRotationY ≈ (parallax.x * 0.3) + (glance * 3)
            // glance ≈ (currentRotationY - parallax.x * 0.3) / 3

            // Note: We use the camera's actual rotation.
            // We also need to account for the lookAt logic which isn't a pure rotation addition,
            // but for small angles, this approximation is sufficient to prevent the snap.
            const currentRotationY = camera.rotation.y;
            const parallaxContribution = parallax.current.x * 0.3;
            const derivedGlance = (currentRotationY - parallaxContribution) / 3;

            // 2. Check difference
            const diff = Math.abs(derivedGlance - initialGlance);

            // 3. If difference is significant (e.g. > 0.05 rads approx 3 deg), use DERIVED
            // This happens when we exit looking straight (0) but should be looking at door
            if (diff > 0.02) {
                // Initialize with current PHYSICAL state so we start from where we ARE
                glanceOffset.current = derivedGlance;
                // Target is still the IDEAL state, so we will smooth to it
                targetGlance.current = initialGlance;
            } else {
                // We are close enough, just snap to ideal to be precise
                glanceOffset.current = initialGlance;
                targetGlance.current = initialGlance;
            }

            // Skip the first frame to prevent camera jump
            // This ensures useFrame doesn't immediately override exit animation position
            skipFrameAfterEnable.current = true;

            // Reset swipe glance
            swipeGlance.current = 0;
            targetSwipeGlance.current = 0;
        }
    }, [camera, calculateGlance, segmentLength]);

    return {
        getCurrentSegment: () => currentSegment.current,
        getCameraZ: () => currentZ.current,
        setCameraOverride, // Allow external code to take over camera
        requestGyroscopePermission // Expose for UI button (iOS needs user interaction)
    };
};

export default useInfiniteCamera;

