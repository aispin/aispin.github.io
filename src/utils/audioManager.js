/**
 * Simple Global Audio Manager for background music
 */

const BGM_URL = '/sounds/cfl_turningpages-belem-breeze-487596.ogg';

let bgMusicAudio = null;
let bgVolume = 0.3; // 记住音量：元素还没建出来时也要能存住
let isMuted = false;
let bgMusicStarted = false;

/**
 * 惰性创建 BGM 元素。
 *
 * ⚠️ 不要在这里（或 initAudio 里）就取音频：initAudio() 是 App 挂载时调的，
 * 旧代码用 `preload = 'auto'` + `load()`，于是**每个访客首屏就要下载 1.8 MB 的
 * ogg** —— 哪怕他从不点播放、哪怕音量是静音、哪怕选的是合成 BGM。
 * 改成 `preload = 'none'` 且只在真正 play() 时才取。
 */
const ensureBgMusicAudio = () => {
    if (bgMusicAudio) return bgMusicAudio;
    if (typeof window === 'undefined') return null;
    bgMusicAudio = new Audio();
    bgMusicAudio.preload = 'none';
    bgMusicAudio.src = BGM_URL;
    bgMusicAudio.loop = true;
    bgMusicAudio.volume = bgVolume;
    bgMusicAudio.muted = isMuted;
    return bgMusicAudio;
};

// Initialize background music
export const initAudio = () => {
    if (typeof window === 'undefined') return;

    // Sync muted state from localStorage (same key as AudioManager context)
    const savedMuted = localStorage.getItem('audio_muted');
    isMuted = savedMuted === 'true';

    // 只同步状态，不建元素、不下载 —— 见 ensureBgMusicAudio 的说明
};

export const playBackgroundMusic = () => {
    initAudio();
    bgMusicStarted = true;
    // 合成 BGM 源：Web Audio 生成式主题（需在用户手势内首次调用）
    if (bgmSource === 'synth') {
        if (isMuted) return;
        startSynthBgm();
        return;
    }
    const el = ensureBgMusicAudio();
    if (el && el.paused) {
        // Only play if not muted and it's currently paused
        el.play().catch((err) => {
            console.warn('Audio play failed/blocked by browser:', err);
        });
    }
};

export const pauseBackgroundMusic = () => {
    if (bgMusicAudio && !bgMusicAudio.paused) {
        bgMusicAudio.pause();
    }
};

export const toggleMute = () => {
    syncMuteState(!isMuted);
    return isMuted;
};

export const getIsMuted = () => isMuted;

export const setMusicVolume = (vol) => {
    const v = Math.max(0, Math.min(1, vol));
    bgVolume = v;

    // Auto-unmute if user drags slider up（元素可能还没建，所以状态先记下）
    if (v > 0 && isMuted) {
        isMuted = false;
        if (bgMusicAudio) bgMusicAudio.muted = false;
    }

    if (bgMusicAudio) {
        bgMusicAudio.volume = v;

        // Ensure playback continues if we unmute, ONLY if the music has actually been requested to start
        if (v > 0 && bgMusicAudio.paused && bgMusicStarted && bgmSource === 'mp3') {
            bgMusicAudio.play().catch(e => console.warn(e));
        }
    }
    // 合成 BGM 音量同步
    if (synth) {
        synth.setVolume(v);
    }
    // Dispatch event so UI sliders can stay in sync if changed programmatically
    window.dispatchEvent(new CustomEvent('musicVolumeChanged', { detail: v }));
};

export const getMusicVolume = () => bgVolume;

/* ============================================================
 * BGM 双源切换：MP3（原声文件） / 合成（Web Audio 生成式 BGM）
 * 源选择持久化在 localStorage['aispin_bgm_source']，默认 'mp3'。
 * ============================================================ */
import { createBgm } from '../audio/bgm.js';

let bgmSource = (() => {
    try {
        const s = localStorage.getItem('aispin_bgm_source');
        return s === 'synth' ? 'synth' : 'mp3';
    } catch {
        return 'mp3';
    }
})();

let synth = null;
const getSynth = () => {
    if (!synth) synth = createBgm();
    return synth;
};

const startSynthBgm = () => {
    const s = getSynth();
    if (s.playing) return;
    s.start({
        kind: 'theme',
        id: 'cheerful',
        voice: 'guitar',       // 温馨木吉他点点旋律，呼应吉他鼠标
        volume: getMusicVolume()
    });
};

const stopSynthBgm = () => {
    if (synth) synth.stop();
};

export const getBgmSource = () => bgmSource;

/** Switch BGM source; live-switches if music already playing (call within a user gesture) */
export const setBgmSource = (source) => {
    if (source !== 'mp3' && source !== 'synth') return;
    bgmSource = source;
    try { localStorage.setItem('aispin_bgm_source', source); } catch { /* noop */ }
    if (bgMusicStarted) {
        // stop both, then start the newly selected source
        if (bgMusicAudio) bgMusicAudio.pause();
        stopSynthBgm();
        playBackgroundMusic();
    }
    return bgmSource;
};

/**
 * 把 React 层的静音状态推到模块层（每次 isMuted 变化都调）。
 *
 * ⚠️ 这里**只**管 muted 标志，**绝不动 bgVolume**。
 *
 * 「静音」是标志位，「音量」归用户 —— 这两件事必须分开。曾经有代码用
 * 「把音量调成 0」来表达静音（AchievementPopup 的 setMusicVolume(0)），
 * 结果是「取消静音了却还是没声」：标志翻回来了，音量还停在 0，
 * 而没有任何东西会去恢复它。2026-10-08 用户报的「没音乐了」就是这个。
 */
export const syncMuteState = (muted) => {
    isMuted = muted;
    if (bgMusicAudio) {
        bgMusicAudio.muted = muted;
    }
    if (muted) {
        stopSynthBgm();
    } else if (bgMusicStarted) {
        // 取消静音：合成引擎要重新起（它的 start 需要用户手势，而点开关
        // 正好就是）；mp3 若被暂停过（切标签页 / 系统打断）也要续上。
        if (bgmSource === 'synth') startSynthBgm();
        else if (bgMusicAudio && bgMusicAudio.paused && bgVolume > 0) {
            bgMusicAudio.play().catch(() => { /* 等下一次用户手势 */ });
        }
    }
};
