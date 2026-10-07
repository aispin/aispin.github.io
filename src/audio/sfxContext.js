/**
 * 共享音频基础设施 —— 全站**只允许存在一个 AudioContext**
 * ============================================================
 * 站里所有"合成"出来的声音都从这里取 context 和总线：
 *
 *   paperSfx.js    铅笔沙沙 / 撕纸（Preloader、传送转场）
 *   ambience.js    房间环境音（风 / 城市 / 海）
 *   AchievementsContext   成就解锁铃声
 *
 * 之前每个模块各建各的：纸面音效一个、成就铃声一个（实测 `ctxs: 2`）。
 * Chrome 对同时存在的 AudioContext 数量有硬上限（约 6 个），而且两套各自
 * 管音量、各自被自动播放策略拦一次，谁也管不到谁。合成音效本来就没有
 * "各自的输出设备"这种需求，一个 context + 一条 master 总线就够。
 *
 * ⚠️ 用户手势
 * ------------------------------------------------------------
 * Chrome 在"用户手势之前"创建 AudioContext 会打控制台警告，而且那时
 * context 必然是 suspended（根本发不出声）。所以：
 *   - getAudioContext() 只在真的需要出声时调用（不要放在模块顶层）；
 *   - 需要"手势前排队、手势后补播"的用 whenUnlocked()。
 *
 * 只认真正能带来 user activation 的事件。`wheel` / `scroll` **不算**，
 * 所以不在列表里 —— 这是很容易踩的一个坑。
 */

import { AudioContext as ThreeAudioContext } from 'three';

const AC = () =>
    typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;

let ctx = null;
let master = null;
let unlocked = false;

/** 手势到达前排队的一次性动作（返回取消函数） */
const pending = new Set();

function build() {
    /* three 自带一个全局 AudioContext 单例（`AudioContext.getContext()`），
     * drei 的 `<AudioListener>` 会调它 —— 那是全站唯一一处我们管不到的原生
     * context 创建点。与其在它旁边再开一个，不如把它接管过来：
     * 已经有就复用，没有就让它建，然后 setContext 钉死。
     * 这样无论谁先跑，最终都只有一个原生 context。 */
    let shared = null;
    try {
        shared = ThreeAudioContext.getContext();   // 不存在时会自己建一个
    } catch {
        shared = null;                              // 非浏览器环境 / 无 Web Audio
    }
    if (!shared) {
        const Ctor = AC();
        if (!Ctor) return null;
        shared = new Ctor();
    }
    try {
        ThreeAudioContext.setContext(shared);       // 钉住，防止 three 再自建
    } catch {
        /* 老版本 three 没有 setContext —— 退化成两个 context，不影响发声 */
    }

    ctx = shared;
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return ctx;
}

/** 唯一的 AudioContext。会按需创建，但请尽量在用户手势之后第一次调用。 */
export function getAudioContext() {
    return ctx || build();
}

/** 所有合成声部都应该接到这条总线上（而不是直接接 destination）。 */
export function getAudioBus() {
    const c = getAudioContext();
    return c ? master : null;
}

export function isUnlocked() {
    return unlocked;
}

/**
 * 页面已经收到过用户手势就直接执行，否则排队等第一个手势。
 * 返回取消函数 —— 组件卸载时记得调用，否则卸载后还会被补播一次。
 */
export function whenUnlocked(fn) {
    if (unlocked) {
        fn();
        return () => { };
    }
    pending.add(fn);
    return () => pending.delete(fn);
}

if (typeof window !== 'undefined') {
    const EVENTS = ['pointerdown', 'touchstart', 'keydown'];
    const unlock = () => {
        unlocked = true;
        EVENTS.forEach((e) => window.removeEventListener(e, unlock));
        const c = getAudioContext();
        if (c && c.state === 'suspended') c.resume().catch(() => { });
        for (const fn of pending) {
            try {
                fn();
            } catch {
                /* 一个声部失败不该拖垮其余的 */
            }
        }
        pending.clear();
    };
    EVENTS.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
}

/* ============================================================
 * 噪声缓冲：按 (秒数, 类型) 缓存 —— 生成一次反复用，别每个声部都算
 * ============================================================ */

const NOISE = new Map();

/**
 * @param {AudioContext} context
 * @param {number} seconds
 * @param {'white'|'brown'} kind  brown 是积分白噪（-6dB/oct），低频更厚，
 *        听感像风/海/城市底噪；white 适合做"嘶"的高频层
 */
export function noiseBuffer(context, seconds, kind = 'white') {
    const key = `${context.sampleRate}:${seconds}:${kind}`;
    const hit = NOISE.get(key);
    if (hit) return hit;

    const len = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buf = context.createBuffer(1, len, context.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'brown') {
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            d[i] = last * 3.5;
        }
    } else {
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    NOISE.set(key, buf);
    return buf;
}

/* ============================================================
 * DEV 调试钩子 —— 与 App.jsx 的 window.__aispin 同风格，生产构建会被摇掉。
 * ============================================================ */
if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__sfxBus = {
        state: () => {
            let threeCtx = null;
            try { threeCtx = ThreeAudioContext.getContext(); } catch { /* noop */ }
            return {
                hasContext: !!ctx,
                ctxState: ctx ? ctx.state : null,
                unlocked,
                pending: pending.size,
                // 与 three 的全局单例是不是同一个对象 —— 应为 true
                threeShares: !!ctx && threeCtx === ctx,
            };
        },
    };
}
