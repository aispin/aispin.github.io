import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { syncMuteState } from '../utils/audioManager';
import { createPaperSfx, PAPER_SFX } from '../audio/paperSfx';

/**
 * 有素材的音效白名单 —— **现在是空的，这是有意的**。
 *
 * 以前这张表在 play() 里面，外面还挂了一个 `|| \`/sounds/${name}.mp3\`` 兜底 ——
 * 结果 'pencil' / 'tear' 这两个从来没有素材的名字被拼成 /sounds/pencil.mp3、
 * /sounds/tear.mp3 去请求，每次进站、每次传送都在控制台留 404。
 *
 * 2026-10-07 清空。原先的五条路径全部失去意义：
 *   szumwiatru / szummiasta   房间环境音已改为 Web Audio 现场合成
 *                             （src/audio/ambience.js，零素材）
 *   uchyleniedrzwi            走 <SpatialSfx url="..."> 直接挂，不经 play()
 *                             （原先是 drei 的 <PositionalAudio>，每个实例自带
 *                              一个 AudioListener；现改为全站共用一个，见
 *                              src/components/canvas/audio/SpatialSfx.jsx）
 *   otwarciedrzwi             同上
 *   zamknieciedrzwi           同上
 *
 * 全站现在只剩 'pencil' / 'tear' 两个名字会进 play()，都由
 * src/audio/paperSfx.js 合成。表留着是为了保留"未知名字要 warn 而不是发
 * 静默 404 请求"这条契约；真要有新素材，往这里加一条即可。
 */
const SOUND_PATHS = {};

const AudioContext = createContext({
    isMuted: false,
    toggleMute: () => { },
    ambienceOn: true,
    setAmbienceOn: () => { },
    toggleAmbience: () => { },
    play: () => { },
    enableAudio: () => { },
    audioEnabled: false,
    globalVolume: 0.5,
    setGlobalVolume: () => { },
});

export const useAudio = () => useContext(AudioContext);

export const AudioProvider = ({ children }) => {
    // Persist mute preference
    const [isMuted, setIsMuted] = useState(() => {
        const saved = localStorage.getItem('audio_muted');
        return saved === 'true';
    });

    /**
     * 环境音（房间底噪 / 将来的季节声床）—— **与 BGM 完全独立**。
     *
     * 🔴 2026-10-09 用户报「环境音受 BGM 影响，听不到」。根因是房间那边传的是
     * `muted={isMuted}`，而 `isMuted` 是**音乐开关**：关掉音乐 = 环境音一起哑。
     * 而环境音的**音量**走的是 SFX 滑杆（`globalVolume`）—— 一个开关管两件事、
     * 音量又归另一处，必然打架。现在它有自己的开关（面板里音乐开关**下面**那个）。
     *
     * 默认 **true**：用户定的是「页面发生点击交互后就打开」。真正的"起播"由
     * Web Audio 的解锁闸门完成 —— `sfxContext` 的 `whenUnlocked` 监听
     * pointerdown / touchstart / keydown（只认第一次），所以这里只要为 true，
     * 第一次点击就会起来。在面板里关掉则**持久化**，之后点击也不会再自动开。
     */
    const [ambienceOn, setAmbienceOn] = useState(() => {
        const saved = localStorage.getItem('audio_ambience');
        return saved === null ? true : saved === 'true';
    });

    // Persist volume preference (0.0 to 1.0)
    const [globalVolume, setGlobalVolume] = useState(() => {
        const saved = localStorage.getItem('audio_volume');
        return saved !== null ? parseFloat(saved) : 0.5;
    });

    const [audioEnabled, setAudioEnabled] = useState(false);

    // Track active sounds to stop them later
    const activeSounds = useRef({});

    useEffect(() => {
        localStorage.setItem('audio_muted', isMuted);
        localStorage.setItem('audio_volume', globalVolume);

        // Keep the BGM module layer (mp3 element + synth engine) in sync with mute state
        syncMuteState(isMuted);

        // Update all active sounds
        Object.values(activeSounds.current).forEach(audio => {
            if (audio) {
                audio.muted = isMuted;
                // Scale effective volume by global volume
                // We stored the requested "base" volume on the object as _baseVolume
                const base = audio._baseVolume !== undefined ? audio._baseVolume : 1.0;
                let targetVol = base * globalVolume;
                audio.volume = Math.max(0, Math.min(1, targetVol));
            }
        });

    }, [isMuted, globalVolume]);

    const toggleMute = () => setIsMuted(prev => !prev);

    const toggleAmbience = useCallback(() => setAmbienceOn(prev => !prev), []);

    // 环境音开关持久化。**不放进上面那个大 effect** —— 那个负责的是 mp3 元素
    // 与 composite sounds 的静音/音量同步，跟环境音没关系。
    useEffect(() => {
        localStorage.setItem('audio_ambience', ambienceOn);
    }, [ambienceOn]);

    /**
     * 反向同步：模块层（BGM 滑杆）自己把音量抬起来时会顺手取消静音
     * （setMusicVolume 的老行为，见 utils/audioManager.js），但那只改了
     * 模块层的 isMuted。React 这边如果不跟着走，就会「开关显示静音中、
     * 声音却是响的」，两个控制各说各话 —— 下次任何一次重渲染都会用
     * 陈旧的 isMuted 再把它静回去。
     *
     * 只认 v > 0：把滑杆拖到 0 不等于静音（音量归用户，静音归开关）。
     */
    useEffect(() => {
        const onMusicVolume = (e) => {
            if (e.detail > 0) setIsMuted(false);
        };
        window.addEventListener('musicVolumeChanged', onMusicVolume);
        return () => window.removeEventListener('musicVolumeChanged', onMusicVolume);
    }, []);

    // Enhanced setter that auto-unmutes if user manually drags slider above 0
    const enhancedSetGlobalVolume = useCallback((vol) => {
        if (typeof vol === 'function') {
            setGlobalVolume(prev => {
                const newVol = vol(prev);
                if (newVol > 0) setIsMuted(false);
                return newVol;
            });
        } else {
            setGlobalVolume(vol);
            if (vol > 0) setIsMuted(false);
        }
    }, []);

    // Call this on first interaction
    const enableAudio = useCallback(() => {
        if (!audioEnabled) {
            // Create a dummy context or just flip the switch to say "we tried"
            // Real web audio unlock usually needs a context resume, 
            // but for HTML5 Audio elements, just a user interaction event is enough 
            // to "bless" the document for subsequent plays.
            setAudioEnabled(true);
        }
    }, [audioEnabled]);

    const play = useCallback((soundName, { loop = false, volume = 1.0 } = {}) => {
        // Stop whatever is already registered under this name
        const prev = activeSounds.current[soundName];
        if (prev) {
            if (typeof prev.stop === 'function') prev.stop();
            else prev.pause();
            delete activeSounds.current[soundName];
        }

        // Effective level = requested level scaled by the global slider
        const effective = Math.max(0, Math.min(1, volume * globalVolume));

        // ---- 合成音效：项目里没有素材，由 Web Audio 现场生成 ----
        if (PAPER_SFX.has(soundName)) {
            const handle = createPaperSfx(soundName, { loop, volume: effective, muted: isMuted });
            handle._baseVolume = volume;
            activeSounds.current[soundName] = handle;
            return handle;
        }

        // ---- 有素材的音效 ----
        const path = SOUND_PATHS[soundName];
        if (!path) {
            // 不再回退到 /sounds/<name>.mp3 —— 那只会把拼写错误变成一次静默 404
            if (import.meta.env.DEV) console.warn(`[Audio] unknown sound "${soundName}"`);
            return { stop() { }, fade() { } };
        }

        const audio = new Audio(path);

        // Store metadata
        audio.loop = loop;
        audio._baseVolume = volume; // Custom prop to remember intended relative mix

        // Apply current global state
        audio.muted = isMuted;
        audio.volume = effective;

        activeSounds.current[soundName] = audio;

        // Attempt to play
        const playPromise = audio.play();

        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // 自动播放被浏览器策略拦下，或文件缺失 —— 静默降级
            });
        }

        // Return a handle to stop it
        return {
            stop: () => {
                audio.pause();
                audio.currentTime = 0;
                delete activeSounds.current[soundName];
            },
            fade: () => {
                // For now just stop
                audio.pause();
                delete activeSounds.current[soundName];
            }
        };
    }, [isMuted, globalVolume]);

    return (
        <AudioContext.Provider value={{
            isMuted,
            toggleMute,
            // 环境音是**另一条线**：它自己的开关，不受 isMuted 影响。
            ambienceOn,
            setAmbienceOn,
            toggleAmbience,
            globalVolume,
            setGlobalVolume: enhancedSetGlobalVolume,
            play,
            enableAudio,
            audioEnabled
        }}>
            {children}
        </AudioContext.Provider>
    );
};
