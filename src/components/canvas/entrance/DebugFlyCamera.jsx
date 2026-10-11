import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { isFlyEnabled } from '../../../config/cameraMode';

/**
 * DebugFlyCamera — 自由飞行相机，`?fly` 才开（L1 的"背面清单"工具）。
 * ==================================================================
 *
 * 抄 tidewater 的分工（它的 `player/FlyCamera.js` 文件头就写着
 * "Free-fly **debug** camera"）：**面向访客的是受限轨道，自由飞行只给自己人**。
 *
 * 它的唯一用途是**把洞照出来**：整个院子原来只有朝前的一面（24 张单面 plane、
 * 竹篱就是一张纸），绕到背面会整片消失。有了这个相机，转一圈拍下来，
 * 哪些面需要补背面就是一张清单，而不是猜。
 *
 * ⚠️ **不给普通访客**：没有碰撞、没有地面、没有边界 ——
 *    能飞到岛外、飞到地下、飞进走廊内部。所以它只认 `?fly`。
 *
 * 操作：拖拽转视角 · WASD 前后左右 · Q/E 或 Space/C 升降 · Shift 快 6 倍。
 */

const SPEED = 8;

export function DebugFlyCamera() {
    const { camera, gl } = useThree();

    // URL 在一整次会话里不会变，所以这里**不需要 ref** ——
    // 用 `useRef(isFlyEnabled()).current` 反而会踩 `react-hooks/refs`
    // （render body 里不允许解引用 ref）。真要缓存就 useMemo。
    const onRef = useRef(isFlyEnabled());

    // 同理：这三个只是每帧复用的临时向量，规矩是 `useRef(x)` 存 ref 本身，
    // 只在 useFrame 里碰 `.current`。
    const scratch = useRef({
        yaw: 0, pitch: 0,
        dragging: false, lastX: 0, lastY: 0,
        keys: new Set(),
        vel: new THREE.Vector3(),
    });

    useEffect(() => {
        if (!onRef.current) return undefined;
        const st = scratch.current;
        const dom = gl.domElement;

        const down = (e) => { st.dragging = true; st.lastX = e.clientX; st.lastY = e.clientY; };
        const move = (e) => {
            if (!st.dragging) return;
            st.yaw -= (e.clientX - st.lastX) * 0.0032;
            st.pitch -= (e.clientY - st.lastY) * 0.0032;
            st.pitch = Math.max(-1.55, Math.min(1.55, st.pitch));
            st.lastX = e.clientX;
            st.lastY = e.clientY;
        };
        const up = () => { st.dragging = false; };
        const keydown = (e) => {
            if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            st.keys.add(e.code);
        };
        const keyup = (e) => st.keys.delete(e.code);
        const blur = () => st.keys.clear();

        dom.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', keydown);
        window.addEventListener('keyup', keyup);
        window.addEventListener('blur', blur);
        // 从当前机位接手，别跳一下
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        st.yaw = e.y;
        st.pitch = e.x;

        return () => {
            dom.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('keydown', keydown);
            window.removeEventListener('keyup', keyup);
            window.removeEventListener('blur', blur);
        };
    }, [gl, camera]);

    const fwd = useRef(new THREE.Vector3());
    const right = useRef(new THREE.Vector3());
    const move = useRef(new THREE.Vector3());

    useFrame((_, dt) => {
        if (!onRef.current) return;
        const st = scratch.current;
        camera.rotation.set(st.pitch, st.yaw, 0, 'YXZ');

        const fast = st.keys.has('ShiftLeft') || st.keys.has('ShiftRight');
        const speed = SPEED * (fast ? 6 : 1);
        camera.getWorldDirection(fwd.current);
        right.current.crossVectors(fwd.current, camera.up).normalize();
        move.current.set(0, 0, 0);
        if (st.keys.has('KeyW')) move.current.add(fwd.current);
        if (st.keys.has('KeyS')) move.current.sub(fwd.current);
        if (st.keys.has('KeyD')) move.current.add(right.current);
        if (st.keys.has('KeyA')) move.current.sub(right.current);
        if (st.keys.has('KeyE') || st.keys.has('Space')) move.current.y += 1;
        if (st.keys.has('KeyQ') || st.keys.has('KeyC')) move.current.y -= 1;
        if (move.current.lengthSq() > 0) move.current.normalize().multiplyScalar(speed);
        st.vel.lerp(move.current, 1 - Math.exp(-dt * 8));
        camera.position.addScaledVector(st.vel, dt);
    });

    return null;
}

export default DebugFlyCamera;
