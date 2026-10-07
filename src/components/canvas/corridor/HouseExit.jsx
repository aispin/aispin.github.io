import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import gsap from 'gsap';

import { useScene } from '../../../context/SceneContext';

/**
 * HouseExit — walks the camera back out of the front door.
 *
 * WHY THIS IS A 3D COMPONENT
 * The back button lives in the DOM (NavigationUI), but only something inside
 * the canvas can move the camera. So the DOM side just flips
 * `houseExitRequested` in SceneContext and this component does the flying,
 * mirroring how <TeleportRoom /> handles the camera for teleports.
 *
 * WHY THE SCROLL HOOK HAS TO STAND DOWN
 * `useInfiniteCamera` writes `camera.position.z` every frame while scrolling is
 * enabled, and an exit is triggered precisely when scrolling IS enabled (you
 * are standing in the corridor). Without `!houseExitRequested` in the hook's
 * `scrollEnabled`, both would drive the same axis: the hook would lerp the
 * camera back toward the user's scroll target while this glide pushed it out,
 * and the camera would visibly stall or rubber-band. Experience.jsx passes that
 * flag through for exactly this reason.
 *
 * The entrance scene is deliberately NOT mounted until the glide finishes
 * (markExited is called on arrival, not on request). Mounting it up front would
 * put the closed front doors directly on the camera's flight path, and the
 * camera would clip straight through them on the way out.
 */

/** Where the camera sits outside, looking at the front door. */
const OUTSIDE = { x: 0, y: 0.2, z: 28 };
/** Matches the entrance fly-in duration so the two read as the same move. */
const GLIDE_SECONDS = 1.3;
/** How long to keep waiting for a door animation before forcing our way in. */
const RETRY_MS = 250;
const MAX_WAIT_MS = 6000;

const HouseExit = () => {
    const { houseExitRequested, markExited } = useScene();
    const { camera } = useThree();
    const runningRef = useRef(false);
    // Bumped by the retry timer purely to re-run the effect while it waits for a
    // door animation to release the camera. It has to be a dependency of the
    // effect — otherwise the timer fires, nothing re-renders the effect, and the
    // exit silently never starts.
    const [retryTick, setRetryTick] = useState(0);
    const waitedRef = useRef(0);

    useEffect(() => {
        if (!houseExitRequested) {
            runningRef.current = false;
            return;
        }
        // Already gliding.
        if (runningRef.current) return;

        /**
         * Do NOT start while someone else is driving the camera.
         *
         * DoorSection tweens `camera.position` for its own fly-in and fly-out.
         * This component used to call `gsap.killTweensOf(camera.position)` to
         * "take the axis over" — but killing that tween also discards its
         * `onComplete`, and those callbacks are where DoorSection clears its
         * entry lock, marks itself as inside, and hands the camera back. The
         * result was a door permanently stuck mid-animation: clicking it did
         * nothing, the room never appeared, and the back button (whose guard
         * reads the same lock) went dead.
         *
         * So we wait instead of pre-empting. A door animation is at most a few
         * seconds; we poll until the axis is free.
         */
        const busy = gsap.getTweensOf(camera.position).length > 0;
        if (busy && waitedRef.current < MAX_WAIT_MS) {
            waitedRef.current += RETRY_MS;
            const retry = setTimeout(() => setRetryTick((n) => n + 1), RETRY_MS);
            return () => clearTimeout(retry);
        }
        // Either free, or we have waited long enough that the door is not coming
        // back — take the camera anyway rather than leaving the user stranded.
        waitedRef.current = 0;
        runningRef.current = true;

        const proxy = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            rx: camera.rotation.x,
            ry: camera.rotation.y,
            rz: camera.rotation.z,
        };

        const tween = gsap.to(proxy, {
            x: OUTSIDE.x,
            y: OUTSIDE.y,
            z: OUTSIDE.z,
            rx: 0,
            ry: 0,
            rz: 0,
            duration: GLIDE_SECONDS,
            ease: 'power2.inOut',
            onUpdate: () => {
                camera.position.set(proxy.x, proxy.y, proxy.z);
                camera.rotation.set(proxy.rx, proxy.ry, proxy.rz);
            },
            onComplete: () => {
                runningRef.current = false;
                // Arrived outside: now it is safe to re-mount the entrance.
                markExited();
            },
        });

        return () => {
            tween.kill();
            // If this cleanup runs mid-glide we may be left holding the lock
            // with the flag still set — e.g. the effect re-runs because the
            // component re-rendered. Clearing it lets the next pass restart the
            // glide instead of hitting the `runningRef` guard and doing nothing
            // forever (which would make the back button silently dead).
            runningRef.current = false;
        };
    }, [houseExitRequested, camera, markExited, retryTick]);

    return null;
};

export default HouseExit;
