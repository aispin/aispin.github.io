import { useEffect, useRef } from 'react';
import { createAmbience } from '../../../audio/ambience';

/**
 * 房间环境音 —— 取代 drei 的 `<PositionalAudio url="...">`
 * ============================================================
 * 用法与原来几乎一样，只是把 `url` 换成预设名：
 *
 *   - <PositionalAudio url="/sounds/szummiasta.mp3" ... />   // 2.49 MB
 *   + <AmbientSource name="city" volume={effectiveVolume} /> // 0 字节
 *
 * ⚠️ 有意不做空间化（positional）。原来的 `PositionalAudio` 会把环境音
 * 按听者距离衰减、按方向声像 —— 但这是一条**铺满整个房间的底噪**，不是
 * 摆在某处的一个声源。走过去听到音量变化反而是错的，而且 drei 那套需要
 * 一个真实的 HTMLAudioElement，正好是我们要摆脱的东西。房间边界本身
 * 已经由"进房间才挂载、离开就卸载"来表达了。
 *
 * 音量与静音由父组件传进来（房间那边已经把 globalVolume / isMuted 算成了
 * effectiveVolume），变化时通过句柄的 setter 平滑过渡，不重建音频图。
 */
export default function AmbientSource({ name, volume = 1, muted = false }) {
    const handleRef = useRef(null);

    useEffect(() => {
        const handle = createAmbience(name, { volume, muted });
        handleRef.current = handle;
        return () => {
            handle.stop();
            handleRef.current = null;
        };
        // 只在换预设时重建；音量/静音走下面的 effect
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name]);

    useEffect(() => {
        const h = handleRef.current;
        if (!h) return;
        h.volume = volume;
        h.muted = muted;
    }, [volume, muted]);

    return null;
}
