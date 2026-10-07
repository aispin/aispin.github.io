import { useRef, useState, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

// Eagerly import all room components
import GalleryRoom from '../rooms/Gallery/GalleryRoom';
import ContactRoom from '../rooms/Contact/ContactRoom';
import ContentRoom from '../rooms/ContentRoom';
import { isContentDataLoaded } from '../../../hooks/useContentData';

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

    // Wait for rooms to render a few frames, then compile and unmount
    const warmupStart = useRef(performance.now());

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
                const warmupDuration = ((performance.now() - warmupStart.current) / 1000).toFixed(2);
                // console.info(`🔥 GPU/Shader Warmup Complete: ${warmupDuration}s ${isLowTier ? '(Bypassed for LOW tier)' : ''}`);
                
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
            // Use compileAsync to avoid blocking the main thread.
            //
            // IMPORTANT: three's compileAsync polls `materialProperties
            // .currentProgram` from inside its own setTimeout. If any material
            // is disposed while the poll is running (the live scene keeps
            // mounting/unmounting meshes, and the warm-up rooms unmount too),
            // that poll throws *outside* the promise chain — so `.catch()`
            // never fires and the warm-up would never finish, leaving the
            // preloader stranded at 100%. Race it against a hard timeout so
            // the loader always completes.
            let settled = false;
            const finishOnce = () => {
                if (settled) return;
                settled = true;
                finishWarmup();
            };
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
                    <ContentRoom roomId="about" showRoom={true} onReady={noop} />
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
