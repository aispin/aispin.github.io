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
    // mp3 的 `play()` 是**异步**的，只在调用点广播会让图标停在旧状态，
    // 所以元素自己也要报信。
    bgMusicAudio.addEventListener('playing', notifyMusicState);
    bgMusicAudio.addEventListener('pause', notifyMusicState);
    bgMusicAudio.addEventListener('ended', notifyMusicState);
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
        if (!isMuted) startSynthBgm();
        notifyMusicState();
        return;
    }
    const el = ensureBgMusicAudio();
    if (!el) { notifyMusicState(); return; }
    // ⚠️ 这里**故意不判 `el.paused`**（原本是 `if (el && el.paused)`）。
    //
    // 被自动播放策略拦下的元素，`paused` 在某些浏览器里会停在 false（意思是
    // "已请求播放"），拿它当守卫的话，手势补播调到这里就被挡回去 ——
    // **补播永远进不来**，正是 WO-03 验收不通过的那条路。
    //
    // 对已经在播的元素再调一次 play() 是无害的：立刻 resolve，不会叠第二路声音。
    // （`pauseBackgroundMusic` 全仓库无人调用，所以不存在"用户主动暂停后不该自动续播"的顾虑。）
    const p = el.play();
    if (p && typeof p.catch === 'function') {
        p.catch((err) => {
            // NotAllowedError = 还没等到用户手势。这是**预期内**的，不是故障：
            // 起播点现在是推门 / 取消静音，两者都自带手势；真被拒也只是没声音。
            if (err && err.name !== 'NotAllowedError') {
                console.warn('Audio play failed:', err);
            }
        });
    }
    notifyMusicState();
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
    // 拖滑杆抬音量会顺带取消静音（见上），所以开关状态也要广播
    notifyMusicState();
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
    if (s.playing) {
        // 已经在跑，但 AudioContext 可能还挂在 `suspended`（自动播放被策略拦下时
        // 就是这种状态：`playing` 已经是 true，却一个采样都出不来）。
        // 补播路径必须能把上下文唤醒 —— 否则 `if (s.playing) return` 会让补播变成空操作。
        if (!s.audible) s.unlock();
        return;
    }
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
let lastSyncedMute = null;

export const syncMuteState = (muted) => {
    // 上一轮的静音位。`null` = 还没同步过（React 挂载时那次 effect），
    // **那次不算"用户主动取消静音"** —— 否则加载完又会自动起播，
    // 正是这次要拿掉的旧行为。
    const userUnmuted = lastSyncedMute === true && muted === false;
    lastSyncedMute = muted;

    isMuted = muted;
    if (bgMusicAudio) {
        bgMusicAudio.muted = muted;
    }
    if (muted) {
        stopSynthBgm();
    } else if (userUnmuted) {
        // 用户在面板里**主动把静音关掉** → 当成一次明确的"我要听"，直接起播。
        // 必须走 playBackgroundMusic 而不是"续播"：加载即播已经拿掉了，
        // 所以此时 bgMusicStarted 可能还是 false，续播逻辑会什么都不做
        // —— 那就变成"开关拨开了却没声音"。
        playBackgroundMusic();
    } else if (bgMusicStarted) {
        // 同一个静音位被重复同步（例如拖滑杆也走这条）→ 只做必要的续播：
        // 合成引擎要重新起（它的 start 需要用户手势，而点开关正好就是）；
        // mp3 若被暂停过（切标签页 / 系统打断）也要续上。
        if (bgmSource === 'synth') startSynthBgm();
        else if (bgMusicAudio && bgMusicAudio.paused && bgVolume > 0) {
            bgMusicAudio.play().catch(() => { /* 等下一次用户手势 */ });
        }
    }
    notifyMusicState();
};

/* ============================================================
 * 音乐开关状态（给 UI 取态用，2026-10-08）
 * ============================================================ */

/**
 * 音乐现在是不是"开着"？
 *
 * ⚠️ 这**不是**"真有声音出来"。mp3 的 `play()` 是异步的，拿"真有声音"取态会让
 * 图标慢半拍；这里判的是"**已起播且没被静音**"——正好是用户理解的"声音开着"。
 *
 * 为什么需要它：首访必然被自动播放策略拒绝，所以站点一进来其实是**静音**的，
 * 右上角那个图标就不该画成"有声"。默认外观 = 静音态，等**推门**
 * （EntranceDoors 的 handleClick）或**面板里取消静音**之后再变成"有声"。
 */
export const isMusicOn = () => {
    if (isMuted) return false;
    if (bgmSource === 'synth') return !!(synth && synth.playing);
    return !!(bgMusicAudio && !bgMusicAudio.paused);
};

/** 把"音乐开关状态"广播给 UI（`SiteControls` 的图标靠它取态）。 */
const notifyMusicState = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('musicStateChanged', {
        detail: { on: isMusicOn(), muted: isMuted },
    }));
};
