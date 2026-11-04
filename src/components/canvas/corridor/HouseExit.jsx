import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import gsap from 'gsap';

import { useScene } from '../../../context/SceneContext';
import { REST_POSE } from '../../../config/restPose';

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
 *
 * WHERE IT LANDS (2026-10-21)
 * Not at a constant. The glide ends at whatever pose the orbit camera is about
 * to take over with (`useOrbitCamera.poseNow()`), i.e. "the spot you were
 * standing on before you walked in". Landing anywhere else means `markExited()`
 * is followed by a one-frame teleport, which is exactly the「先拉远再跳回」the
 * site owner reported. See the long comment at the tween.
 */

/**
 * 退场滑行的**兜底**终点 —— 只在问不到轨道相机时用（见下面的 `getTarget`）。
 *
 * ⚠️ 就是**休息机位**（`config/restPose.js`）。它**不再**是常规终点：
 * 常规终点是"进门前那个机位"，由 `useOrbitCamera.poseNow()` 现算。
 */
const OUTSIDE = REST_POSE;
/** Matches the entrance fly-in duration so the two read as the same move. */
const GLIDE_SECONDS = 1.3;
/** How long to keep waiting for a door animation before forcing our way in. */
const RETRY_MS = 250;
const MAX_WAIT_MS = 6000;

/**
 * @param {object} props
 * @param {() => ({x:number,y:number,z:number,quaternion:import('three').Quaternion}|null)} [props.getTarget]
 *   滑行终点。**必须引用稳定**（`useCallback`）—— 它是下面那个 effect 的依赖，
 *   每次渲染都换引用会让 effect 重跑、cleanup 把滑行中的补间 kill 掉。
 */
const HouseExit = ({ getTarget }) => {
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

        /**
         * 🔴 终点 = **进门前那个机位**（用户 2026-10-21 定案）
         * ------------------------------------------------------------
         * 「退出大门后，镜头拉到很远，然后突然跳到门前。改为退出大门后镜头
         *   只需拉到进门前的位置。不需要先拉远再近」
         *
         * 旧版固定滑到 `REST_POSE`（z = 45，首屏那一点）。两个问题：
         *   ① 45 比进门前的 28.15 **更远** ⇒ 画面上是"先拉远"；
         *   ② 滑到 45 之后 `markExited()` 翻 `hasEntered`，轨道相机接手 ——
         *      它的状态里半径还是进场时的 18，第一帧就把相机拽回 28.15
         *      ⇒ "突然跳到门前"。16.85 个单位的瞬移，一帧完成。
         *
         * 所以终点不再写死：问 `useOrbitCamera.poseNow()` —— "你下一帧会
         * 把相机摆在哪"。滑到那儿，接手就是**零位移**，两个症状一起消失。
         *
         * ⚠️ 为什么终点必须"现算"而不是取一个常量：进门前的机位不是常量。
         *    进场自动滑行结束时是 `ORBIT_MIN_R`（28.15），但用户要是先拖着
         *    绕了一圈、滚远了再进屋，进门前就在别处 —— 退出该回到**他自己
         *    那一次**的机位。`poseNow()` 读的正是轨道状态，天然覆盖。
         *
         * ⚠️ `getTarget()` 返回 null 只发生在"轨道相机从没被激活过"时
         *    （`__aispin.enter()` / 直接改 URL 进走廊的 harness 路径）。
         *    那种情况下 `markExited()` 之后没有任何东西会再写相机，滑到
         *    `REST_POSE` 就是终态，不存在接手，也就没有跳。
         */
        const target = getTarget?.() ?? null;
        const goal = target
            ? new Vector3(target.x, target.y, target.z)
            : new Vector3(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z);
        /* 朝向：滑到"轨道相机接手时会有的那个四元数"。
         *
         * 旧版把 `rotation` 的 x/y/z 直接补间到 0（= 朝正前方）。那对走廊
         * 的取景是"差不多"，对轨道相机是"差 0.08°" —— 而这一版要的是**逐位
         * 相等**，所以改成四元数 slerp 到 `poseNow()` 给的那个。
         *
         * 兜底路径（无轨道目标）仍然 slerp 到单位四元数 = 旧的 (0,0,0)。
         * ⚠️ 用四元数而不是欧拉角，是因为"两个朝向之间最短的那条弧"只有
         *    四元数说得清；欧拉角逐轴插值在 y 跨 ±π 时会绕远路。
         */
        const q0 = camera.quaternion.clone();
        const q1 = target ? target.quaternion.clone() : new Quaternion();
        const rotProxy = { t: 0 };

        /**
         * ⚠️ 位置这条补间**必须继续 tween `camera.position` 本身**，不能像
         *    朝向那样补间代理对象 —— 全站有好几处靠
         *    `gsap.getTweensOf(camera.position).length > 0` 判断"相机的轴
         *    正被别人占着"（本组件自己的 `busy` 检查、`DoorSection` 的入口锁、
         *    `useOrbitCamera` 的让位）。改成代理就等于把这条约定废掉。
         */
        const tweenPos = gsap.to(camera.position, {
            x: goal.x,
            y: goal.y,
            z: goal.z,
            duration: GLIDE_SECONDS,
            ease: 'power2.inOut',
            onComplete: () => {
                runningRef.current = false;
                // Arrived outside: now it is safe to re-mount the entrance.
                markExited();
            },
        });

        const tweenRot = gsap.to(rotProxy, {
            t: 1,
            duration: GLIDE_SECONDS,
            ease: 'power2.inOut',
            onUpdate: () => {
                // 写 `quaternion` 会顺带更新 `rotation`（three 的 onChange 回调）。
                camera.quaternion.slerpQuaternions(q0, q1, rotProxy.t);
            },
        });

        return () => {
            tweenPos.kill();
            tweenRot.kill();
            // If this cleanup runs mid-glide we may be left holding the lock
            // with the flag still set — e.g. the effect re-runs because the
            // component re-rendered. Clearing it lets the next pass restart the
            // glide instead of hitting the `runningRef` guard and doing nothing
            // forever (which would make the back button silently dead).
            runningRef.current = false;
        };
    }, [houseExitRequested, camera, markExited, retryTick, getTarget]);

    return null;
};

export default HouseExit;
