import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { sharedListener, attachListenerTo, detachListenerFrom } from '../../../engine/audioBus';

/**
 * 全站唯一的 `<AudioListener>` —— 挂在相机上，别的什么也不做。
 * 每个 Canvas 里渲染一次即可（见 Experience.jsx）。
 */
export function SpatialAudioListener() {
    const camera = useThree((s) => s.camera);
    useEffect(() => {
        attachListenerTo(camera);
        return () => detachListenerFrom(camera);
    }, [camera]);
    return null;
}

/**
 * `<PositionalAudio>` 的替代品 —— 与 drei 的 API 完全一致，唯一区别是
 * **共用全站那一个 AudioListener**。
 *
 * drei 的实现（node_modules/@react-three/drei/core/PositionalAudio.js）
 * 在每个实例里 `useState(() => new AudioListener())` 并且 `camera.add(listener)`，
 * 于是场景里 42 个音效节点 = 42 个 listener + 42 个直连 destination 的
 * GainNode + 42 个相机子对象。这个组件把那一层收敛成一份。
 *
 * 其余行为照抄 drei：`useLoader(AudioLoader, url)` 让同一个 URL 的
 * AudioBuffer 只解码一次并被所有实例共享。
 */
const SpatialSfx = forwardRef(({ url, distance = 1, loop = false, autoplay, ...props }, ref) => {
    const nodeRef = useRef(null);
    useImperativeHandle(ref, () => nodeRef.current, []);

    const buffer = useLoader(THREE.AudioLoader, url);
    const camera = useThree((s) => s.camera);

    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return;
        node.setBuffer(buffer);
        node.setRefDistance(distance);
        node.setLoop(loop);
        if (autoplay && !node.isPlaying) node.play();
    }, [buffer, camera, distance, loop, autoplay]);

    return <positionalAudio ref={nodeRef} args={[sharedListener()]} {...props} />;
});

SpatialSfx.displayName = 'SpatialSfx';

export default SpatialSfx;
