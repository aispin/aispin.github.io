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

    /**
     * ⚠️ 卸载时必须把节点从 Web Audio 图里摘掉 —— 这是实测出来的**泄漏**。
     *
     * 每个 `THREE.Audio` 在构造函数里就无条件做了一条直通 destination 的连线：
     *     this.gain = context.createGain();
     *     this.gain.connect( listener.getInput() );
     * 而 `THREE.Audio` **没有 `dispose()`**，R3F 卸载对象时调的是
     * `object.dispose?.()` —— 对 Audio 就是空操作。于是每次卸载都留下一对
     * PannerNode + GainNode 永远挂在输出链上，**只增不减**。
     *
     * ---------------------------------------------------------------------
     * 🔴 为什么**不能**用 `node.disconnect()`（第一版就栽在这里）
     * ---------------------------------------------------------------------
     * three 的 `Audio.disconnect()` 第一行是：
     *     if ( this._connected === false ) return;
     * 而 `_connected` 只在 `connect()` 里被置 true，构造函数却把它初始化成
     * **false** —— 尽管构造函数**确实**接了线。所以对「从没 `play()` 过」的节点
     * （走廊里那 42 个全是 `isPlaying === false`），`node.disconnect()` 直接
     * 返回、什么都不做。实测：改完再跑 churn，数字一个都没变，就是这么发现的。
     * → **直接摘原生节点**，绕开那个标志位。
     *
     * ---------------------------------------------------------------------
     * StrictMode
     * ---------------------------------------------------------------------
     * 开发模式下 effect 会 mount → cleanup → mount，cleanup 会把线摘掉，
     * 第二次进来必须接回去，否则 dev 里所有位置音效全哑。用一个标志位记住
     * 「线是我们摘的」，只在那种情况下才重接（不去依赖「重复 connect 是 no-op」
     * 这条规范细节）。生产模式下标志位始终是 undefined，走的永远是"构造函数
     * 已经接好了"这条路。
     *
     * ⚠️ **不要碰 `node.buffer`**：它来自 `useLoader(THREE.AudioLoader, url)` 的
     * 缓存，是多个节点共享的同一份 AudioBuffer（实测 42 个节点只解码出 3 个
     * buffer，共 1.12 MB）。清掉它会把别人正在用的缓冲一起弄没。
     */
    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return undefined;

        // 只有「上一次是我们的 cleanup 摘的线」才需要重接
        if (node.__sfxWired === false) {
            try {
                node.panner.connect(node.gain);
                node.gain.connect(node.listener.getInput());
            } catch { /* 已经连着 */ }
            node.__sfxWired = true;
        }

        return () => {
            try { node.panner.disconnect(); } catch { /* 已断开 */ }
            try { node.gain.disconnect(); } catch { /* 已断开 */ }
            node.__sfxWired = false;
        };
    }, []);

    return <positionalAudio ref={nodeRef} args={[sharedListener()]} {...props} />;
});

SpatialSfx.displayName = 'SpatialSfx';

export default SpatialSfx;
