import { useEffect, useRef, useState, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Eagerly import all room components
import GalleryRoom from '../rooms/Gallery/GalleryRoom';
import ContactRoom from '../rooms/Contact/ContactRoom';
import ContentRoom from '../rooms/ContentRoom';
import { isContentDataLoaded } from '../../../hooks/useContentData';

/**
 * WO-C5 —— 让 three 的 `compileAsync` 轮询永远撞不上"已被 dispose 的材质"。
 *
 * three 的 `compileAsync` 先 `compile()` 收一份 `Set<Material>`，然后**从自己的
 * `setTimeout` 里**每 10ms 轮询 `properties.get(material).currentProgram.isReady()`。
 * 只要这期间任何一个材质被 `dispose()`，renderer 的 `onMaterialDispose` 就把
 * `properties` 里那一条整个删掉 ⇒ 下一轮 `properties.get()` 返回的是个**空对象**
 * ⇒ `currentProgram` 是 `undefined` ⇒ `program.isReady()` 抛 TypeError。
 *
 * 🔴 这个异常抛在 promise 链**外**：`.catch()` 收不到，`try/catch` 也包不住
 * （它在 three 自己的 `setTimeout` 里）。而触发条件恰恰是常态 —— 进房间那一刻
 * 一大批东西卸载，材质就落在这 10ms 的窗口里。实测触发条件是**完整链路**：
 * 只挂载 0/5、挂载+`enter()` 0/6、`enter()+teleport()` 才冒。
 *
 * 所以把窗口期内的 `dispose()` 排进队列，等轮询结束再真的执行。材质晚释放几秒
 * 没有任何代价（GPU 资源，不是状态机）；不这么做，控制台每次进门都可能红一条。
 *
 * ⚠️ 必须**先还原原型、再 flush**，否则 flush 出去的 dispose 又会被排回队列。
 * ⚠️ 还原是幂等的，并且只在"原型上还是我这个桩"时才动 —— 免得和别的补丁打架。
 */
function deferMaterialDispose() {
    const proto = THREE.Material.prototype;
    const original = proto.dispose;
    const queued = [];
    const deferred = function deferredDispose() {
        queued.push(this);
    };
    proto.dispose = deferred;
    return function restoreDispose() {
        if (proto.dispose !== deferred) return;
        proto.dispose = original;
        const pending = queued.splice(0);
        for (const material of pending) material.dispose();
    };
}

/**
 * RoomWarmup Component
 * 
 * Mounts all 4 rooms off-screen during the preloader phase to force
 * shader compilation and texture upload to GPU. After a few frames,
 * it unmounts the rooms to free memory. This ensures the first room
 * entry has zero shader compilation stutter.
 * 
 * Positioned 500 units below the scene so nothing is visible.
 * Audio components won't be audible at this distance.
 */
const RoomWarmup = ({ onWarmupComplete, isLowTier }) => {
    const [isDone, setIsDone] = useState(false);
    const frameCount = useRef(0);
    const completeFired = useRef(false);
    const { gl, scene, camera } = useThree();

    // WO-C5：轮询窗口内的 dispose 延迟到结束后执行（见 deferMaterialDispose）。
    const restoreDisposeRef = useRef(null);
    useEffect(() => () => {
        // 兜底：组件被提前卸载时也要把原型还回去，否则 dispose 会永远被吞掉。
        restoreDisposeRef.current?.();
        restoreDisposeRef.current = null;
    }, []);

    // Wait for rooms to render a few frames, then compile and unmount

    useFrame(() => {
        if (isDone || completeFired.current) return;

        // Wait until Sanity data is loaded before starting warmup
        if (!isContentDataLoaded()) return;

        frameCount.current++;

        // For low tier, we skip warmup, but still wait 1 frame for entrance to mount
        const targetFrames = isLowTier ? 1 : 3;

        if (frameCount.current >= targetFrames) {
            completeFired.current = true;

            const finishWarmup = () => {
                
                requestAnimationFrame(() => {
                    setIsDone(true);
                    onWarmupComplete?.();
                });
            };

            // On low tier, bypass intense gl.compileAsync to save memory and avoid Context Lost
            if (isLowTier) {
                finishWarmup();
                return;
            }

            // Force compile all shaders in the scene (including warm-up rooms)
            // Use compileAsync to avoid blocking the main thread: `compile()`
            // only kicks the link off, `compileAsync` then waits for it, so the
            // first real frame never stalls on a link.
            //
            // 🔴 WO-C5：三件事叠在一起，缺一不可 ——
            //   ① 冻结 dispose（`deferMaterialDispose`）：轮询撞上已释放的材质
            //      会抛在 promise 链**外**，`.catch()` 收不到，也没法 try/catch。
            //   ② 6s 硬兜底：万一轮询永远不 resolve（驱动不报 ready），预热也
            //      必须结束，否则 preloader 永远停在 100%。
            //   ③ 先还原原型再 `finishWarmup`：卸载会触发一批 dispose，它们必须
            //      走回真实现。
            let settled = false;
            const finishOnce = () => {
                if (settled) return;
                settled = true;
                // 先还原原型再继续：`finishWarmup` 会触发卸载，那批 dispose 必须
                // 走回真实现（否则它们又被排进一个没人 flush 的队列 = 泄漏）。
                restoreDisposeRef.current?.();
                restoreDisposeRef.current = null;
                finishWarmup();
            };

            // 🔴 必须在 `compileAsync` **之前**装上：它内部第一轮轮询就在 10ms 后，
            // 而 `compile()` 本身可能已经触发卸载。
            restoreDisposeRef.current = deferMaterialDispose();
            const bail = setTimeout(finishOnce, 6000);

            const syncFallback = (err) => {
                clearTimeout(bail);
                if (err) console.warn('Async shader compilation failed, falling back to sync', err);
                try {
                    gl.compile(scene, camera);
                } catch {
                    /* sync compile is best-effort; never block the loader */
                }
                finishOnce();
            };

            if (typeof gl.compileAsync === 'function') {
                try {
                    gl.compileAsync(scene, camera, scene)
                        .then(() => {
                            clearTimeout(bail);
                            finishOnce();
                        })
                        .catch(syncFallback);
                } catch (err) {
                    syncFallback(err);
                }
            } else {
                syncFallback(null);
            }
        }
    });

    if (isDone) return null;

    // Do not mount rooms at all on low end devices to prevent WebGL Context Lost
    if (isLowTier) return null;

    // Dummy handlers to prevent errors (rooms expect these props)
    const noop = () => {};

    return (
        <group position={[0, -500, 0]}>
            {/* Mount all rooms in Suspense - positioned far below camera */}
            <Suspense fallback={null}>
                <group position={[-20, 0, 0]}>
                    <GalleryRoom showRoom={true} onReady={noop} isExiting={false} isWarmup={true} />
                </group>
            </Suspense>
            <Suspense fallback={null}>
                <group position={[20, 0, 0]}>
                    {/* 这里原来是 `roomId="career"`。career 已经换成接管渲染的
                        时空隧道（rooms/CareerTunnel.jsx），它自带 Scene，预热这份
                        副本既不会上传它的贴图，也没法替它预热 —— 换成一个仍然
                        走 ContentRoom 的房间，让 ContentRoom 那套着色器照常预热。 */}
                    <ContentRoom roomId="studio" showRoom={true} onReady={noop} />
                </group>
            </Suspense>
            <Suspense fallback={null}>
                <group position={[-20, 0, -50]}>
                    <ContactRoom showRoom={true} onReady={noop} isExiting={false} isWarmup={true} />
                </group>
            </Suspense>
        </group>
    );
};

export default RoomWarmup;
