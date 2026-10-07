/**
 * 纸面音效 —— Web Audio 现场合成，零音频素材
 * ============================================================
 * 站点里有两个音效名一直没有对应素材：
 *
 *   'pencil'  Preloader 进度条期间的铅笔沙沙声（循环）
 *   'tear'    Preloader 撕纸离场 / PaperTransition 传送转场
 *
 * 旧实现（AudioManager.jsx 里的 `soundPaths[name] || \`/sounds/${name}.mp3\``）
 * 会把它们请求成 /sounds/pencil.mp3、/sounds/tear.mp3 —— 结果是从未真的响过，
 * 而且每次进站、每次传送都在控制台留一条 404。
 *
 * 这里沿用站点一贯做法（见 src/audio/bgm.js）改用 Web Audio 合成：
 *   铅笔 = 带通白噪 + 两个互不成谐波的 LFO（来回笔触的强弱起伏）
 *   撕纸 = 白噪 + 带通中心频率上扬 + 分段脉冲包络（纤维一根根崩断的颗粒感）
 *
 * 注意与 src/audio/sfx.js 的分工：那边是入口场景的"叫声类"音效（狗/风铃/燕子），
 * 由点击直接触发、自带 AudioContext、不参与全局静音同步。这里是**可被停止的
 * 循环/转场音效**，返回的句柄要交给 AudioManager 统一管理，所以单独成模块。
 *
 * ⚠️ 用户手势
 * ------------------------------------------------------------
 * Chrome 在"用户手势之前"创建 AudioContext 会往控制台打一条警告，而且那时
 * context 必然是 suspended（根本发不出声）。所以本模块在手势之前**不创建
 * context**：一次性音效直接放弃（等价于它今天"404 后静音"的表现），
 * 循环音效挂起，等第一个手势到达再补播。
 *
 * context / 输出总线 / 手势门控全部来自 sfxContext.js —— 全站共用一个
 * AudioContext（成就铃声也走那里），不再是各模块各建一个。
 */

import { getAudioBus, getAudioContext, isUnlocked, noiseBuffer, whenUnlocked } from './sfxContext';

/** 由本模块合成的音效名。2026-10-07 起这是 play() 唯一会命中的集合 ——
 *  AudioManager 的 SOUND_PATHS 已清空（房间环境音改成 ambience.js 合成，
 *  开关门音走 <PositionalAudio url> 直挂），所以"其余名字走素材"那句不再成立。 */
export const PAPER_SFX = new Set(['pencil', 'tear']);

/* 当前 context 与输出总线。由 sfxContext 提供，这里只是缓存引用，
 * 让下面几个声部函数不必每个都带一个 ctx 参数。 */
let ctx = null;
let out = null;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function ensureCtx() {
    ctx = getAudioContext();
    out = getAudioBus();
    return ctx && out ? ctx : null;
}

/* ============================================================
 * 手势前排队：name -> 取消函数（由 sfxContext.whenUnlocked 返回）
 * ============================================================ */

const armedLoops = new Map();

/* ============================================================
 * 噪声缓冲 —— 交给 sfxContext.noiseBuffer，全站共用同一份缓存
 * ============================================================ */

const noise = (seconds, kind = 'white') => noiseBuffer(ctx, seconds, kind);

/* ============================================================
 * 两个声部
 * ============================================================ */

/** 铅笔在纸上划：中高频带通白噪 + 双 LFO 强弱起伏。返回拆解函数。 */
function pencilVoice(dest) {
    const src = ctx.createBufferSource();
    src.buffer = noise(2.5, 'white');
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 0.7;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 560;

    // 3.6Hz 是笔触来回的节奏，8.9Hz 加一点碎屑感。两个频率互不成谐波，
    // 2.5 秒的循环就不容易被听出周期。
    const body = ctx.createGain();
    body.gain.value = 0.6;
    const lfos = [
        [3.6, 0.3],
        [8.9, 0.1],
    ].map(([f, depth]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = depth;
        o.connect(g).connect(body.gain);
        o.start();
        return o;
    });

    src.connect(bp);
    bp.connect(hp);
    hp.connect(body);
    body.connect(dest);
    src.start();

    return () => {
        try { src.stop(); } catch { /* 已停止 */ }
        lfos.forEach((o) => { try { o.stop(); } catch { /* 已停止 */ } });
    };
}

/** 撕纸：白噪 + 带通中心频率上扬 + 分段脉冲包络。返回拆解函数。 */
function tearVoice(dest) {
    const DUR = 0.42;
    const t0 = ctx.currentTime + 0.005;

    const src = ctx.createBufferSource();
    src.buffer = noise(0.6, 'white');
    src.loop = true;

    // 中心频率 620Hz → 3900Hz：纸被撕开时纤维越崩越细，听感"往上走"
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.85;
    bp.frequency.setValueAtTime(620, t0);
    bp.frequency.exponentialRampToValueAtTime(3900, t0 + DUR * 0.9);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 420;

    // 包络切成 10 段微脉冲：一根根纤维崩断，而不是一条平滑的"嘶——"
    const env = ctx.createGain();
    const STEPS = 10;
    const step = DUR / STEPS;
    env.gain.setValueAtTime(0, t0);
    for (let i = 0; i < STEPS; i++) {
        const t = t0 + step * i;
        const a = (1 - (i / STEPS) * 0.55) * (0.6 + Math.random() * 0.4);
        env.gain.linearRampToValueAtTime(a, t + step * 0.28);
        env.gain.linearRampToValueAtTime(a * 0.34, t + step * 0.92);
    }
    env.gain.linearRampToValueAtTime(0, t0 + DUR + 0.03);

    src.connect(bp);
    bp.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(t0);
    src.stop(t0 + DUR + 0.06);

    return () => {
        try { src.stop(); } catch { /* 已停止 */ }
    };
}

/* ============================================================
 * 句柄：字段刻意与 HTMLAudioElement 对齐（muted / volume / _baseVolume），
 * 这样 AudioManager.jsx 里那套"全局静音 + 音量"同步逻辑不用分叉。
 * ============================================================ */

const noopHandle = () => ({ _baseVolume: 1, muted: false, volume: 0, stop() { }, fade() { } });

function build(name, { volume, muted }) {
    const c = ensureCtx();
    if (!c) return noopHandle();
    if (c.state === 'suspended') c.resume().catch(() => { });

    const gainNode = c.createGain();
    gainNode.gain.value = muted ? 0 : clamp01(volume);
    gainNode.connect(out);

    const teardown =
        name === 'pencil' ? pencilVoice(gainNode) :
            name === 'tear' ? tearVoice(gainNode) :
                null;

    if (!teardown) {
        try { gainNode.disconnect(); } catch { /* noop */ }
        return noopHandle();
    }

    let curVol = volume;
    let curMuted = muted;
    let stopped = false;

    const apply = () => {
        if (stopped) return;
        gainNode.gain.setTargetAtTime(curMuted ? 0 : clamp01(curVol), c.currentTime, 0.015);
    };

    return {
        _baseVolume: volume,
        get muted() { return curMuted; },
        set muted(v) { curMuted = !!v; apply(); },
        get volume() { return curVol; },
        set volume(v) { curVol = v; apply(); },
        stop() {
            if (stopped) return;
            stopped = true;
            try { gainNode.gain.cancelScheduledValues(c.currentTime); } catch { /* noop */ }
            gainNode.gain.setTargetAtTime(0, c.currentTime, 0.02);
            // 等淡出跑完再断线，否则尾音被硬切会有"啪"的一声
            setTimeout(() => {
                try { teardown(); } catch { /* noop */ }
                try { gainNode.disconnect(); } catch { /* noop */ }
            }, 90);
        },
        fade() { this.stop(); },
    };
}

/* ============================================================
 * 公开 API
 * ============================================================ */

/**
 * 播放一个纸面音效。返回句柄（stop / fade / muted / volume）。
 * 手势之前调用不会创建 AudioContext：一次性音效放弃，循环音效排队等解锁。
 */
export function createPaperSfx(name, { loop = false, volume = 1, muted = false } = {}) {
    if (isUnlocked()) return build(name, { volume, muted });

    // ---- 手势之前：不建 context，循环的挂起等解锁 ----
    let live = null;
    let curVol = volume;
    let curMuted = muted;
    let dropped = false;
    let cancelArmed = null;

    const placeholder = {
        _baseVolume: volume,
        get muted() { return live ? live.muted : curMuted; },
        set muted(v) { curMuted = !!v; if (live) live.muted = v; },
        get volume() { return live ? live.volume : curVol; },
        set volume(v) { curVol = v; if (live) live.volume = v; },
        stop() {
            dropped = true;
            if (cancelArmed) { cancelArmed(); cancelArmed = null; }
            armedLoops.delete(name);
            if (live) { live.stop(); live = null; }
        },
        fade() { this.stop(); },
    };

    if (loop) {
        // whenUnlocked 返回取消函数；stop() 在解锁前被调用时要撤掉排队，
        // 否则组件已经卸载了还会被补播一次。
        cancelArmed = whenUnlocked(() => {
            if (dropped) return;
            live = build(name, { volume: curVol, muted: curMuted });
            live._baseVolume = placeholder._baseVolume;
        });
        armedLoops.set(name, cancelArmed);
    }

    return placeholder;
}

/* ============================================================
 * DEV 调试钩子 —— 与 App.jsx 的 window.__aispin 同风格，生产构建会被摇掉。
 * 无头验证脚本用它直接驱动合成器、读 AudioContext 状态。
 * ============================================================ */
if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__paperSfx = {
        create: createPaperSfx,
        names: [...PAPER_SFX],
        state: () => ({
            gestureSeen: isUnlocked(),
            ctxState: ctx ? ctx.state : null,
            armed: [...armedLoops.keys()],
        }),
    };
}
