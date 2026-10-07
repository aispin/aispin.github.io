/**
 * 房间环境音 —— Web Audio 现场合成，零音频素材
 * ============================================================
 * 三个房间原本各挂一个几 MB 的 mp3：
 *
 *   About     szumwiatru.mp3     0.39 MB   风
 *   Gallery   szummiasta.mp3     2.49 MB   城市
 *   Contact   szummorza.mp3      1.62 MB   海
 *
 * 加起来 4.5 MB，而且都在**进房间那一刻**才下载 —— 正是访客刚要点东西、
 * 最不该卡的时候。这类"底噪"本质上是滤波噪声加慢速调制，用 Web Audio 合成
 * 出来听不出差别，还能顺手把它们做成真的无缝循环（mp3 循环点一定有接缝）。
 *
 * 三个预设的结构是同一套：**两层以上的噪声，各自走不同的滤波和慢速 LFO**。
 * 关键是各层的 LFO 频率互不成谐波 —— 一旦成整数倍，十几秒后就能听出周期，
 * 底噪立刻"死"掉。
 *
 * 分工：本模块只负责"环境铺底"（长时间、可循环、要能被停止）。
 * 一次性音效在 paperSfx.js，BGM 在 bgm.js。
 */

import { getAudioBus, getAudioContext, noiseBuffer, whenUnlocked } from './sfxContext';

export const AMBIENCE_NAMES = ['wind', 'city', 'sea'];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ============================================================
 * 预设
 * ============================================================ */

const PRESETS = {
    /* 风：低频"呼呼"的body + 高频的"嘶"，两层各自慢速起伏，
     * 再加上一条极慢的阵风 LFO 推低通截止点 —— 风的变化全在截止点上。 */
    wind: (ctx) => [
        {
            noise: ['brown', 4],
            filters: [
                { type: 'lowpass', freq: 480, Q: 0.6, lfo: { rate: 0.07, depth: 190 } },
            ],
            gain: 0.34,
            lfo: { rate: 0.051, depth: 0.15 },
        },
        {
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 1750, Q: 0.5 },
                { type: 'highpass', freq: 700 },
            ],
            gain: 0.055,
            lfo: { rate: 0.113, depth: 0.030 },
        },
        {
            /* 阵风：另一层棕噪，被一条 0.021 Hz 的 LFO 慢慢推开又合上 */
            noise: ['brown', 5],
            filters: [
                { type: 'bandpass', freq: 620, Q: 0.45, lfo: { rate: 0.021, depth: 300 } },
            ],
            gain: 0.13,
            lfo: { rate: 0.033, depth: 0.085 },
        },
    ],

    /* 城市：远处的车流隆隆（低频）+ 一条中频"嗡嗡"（空调/变压器）+ 偶尔
     * 掠过的更亮的层。三条 LFO 频率互质，叠起来就没有可辨识的周期。 */
    city: (ctx) => [
        {
            noise: ['brown', 4],
            filters: [
                { type: 'lowpass', freq: 220, Q: 0.8, lfo: { rate: 0.045, depth: 55 } },
            ],
            gain: 0.30,
            lfo: { rate: 0.027, depth: 0.10 },
        },
        {
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 420, Q: 0.7 },
                { type: 'highpass', freq: 180 },
            ],
            gain: 0.058,
            lfo: { rate: 0.081, depth: 0.022 },
        },
        {
            noise: ['brown', 5],
            filters: [
                { type: 'bandpass', freq: 900, Q: 0.5 },
            ],
            gain: 0.050,
            lfo: { rate: 0.017, depth: 0.040 },
        },
    ],

    /* 海：浪涌。低频那层用 0.085 Hz（约 12 秒一次）做大幅起伏；泡沫层用
     * **同频率但相位错开四分之一周期**，于是"嘶"声在浪退的时候最响 ——
     * 真实的海边就是浪峰先到、泡沫声随后。 */
    sea: (ctx) => [
        {
            noise: ['brown', 6],
            filters: [
                { type: 'lowpass', freq: 700, Q: 0.7, lfo: { rate: 0.085, depth: 260 } },
            ],
            gain: 0.26,
            lfo: { rate: 0.085, depth: 0.20, phase: 0 },
        },
        {
            noise: ['white', 5],
            filters: [
                { type: 'highpass', freq: 1200 },
            ],
            gain: 0.070,
            lfo: { rate: 0.085, depth: 0.062, phase: 0.25 },
        },
        {
            noise: ['brown', 6],
            filters: [
                { type: 'lowpass', freq: 130, Q: 0.7 },
            ],
            gain: 0.18,
            lfo: { rate: 0.041, depth: 0.06 },
        },
    ],
};

/* ============================================================
 * 图搭建
 * ============================================================ */

function build(ctx, bus, name, dest) {
    const spec = PRESETS[name];
    if (!spec) return null;

    const started = [];   // 需要 stop() 的 source / oscillator
    const t0 = ctx.currentTime;

    const keep = (node) => { started.push(node); return node; };

    for (const layer of spec(ctx)) {
        const [kind, seconds] = layer.noise;
        const src = keep(ctx.createBufferSource());
        src.buffer = noiseBuffer(ctx, seconds, kind);
        src.loop = true;

        let node = src;
        for (const f of layer.filters) {
            const filter = ctx.createBiquadFilter();
            filter.type = f.type;
            filter.frequency.value = f.freq;
            if (f.Q != null) filter.Q.value = f.Q;
            if (f.lfo) {
                const o = keep(ctx.createOscillator());
                o.type = 'sine';
                o.frequency.value = f.lfo.rate;
                const d = ctx.createGain();
                d.gain.value = f.lfo.depth;
                o.connect(d).connect(filter.frequency);
                o.start(t0);
            }
            node.connect(filter);
            node = filter;
        }

        const g = ctx.createGain();
        g.gain.value = layer.gain;
        if (layer.lfo) {
            const o = keep(ctx.createOscillator());
            o.type = 'sine';
            o.frequency.value = layer.lfo.rate;
            const d = ctx.createGain();
            d.gain.value = layer.lfo.depth;
            o.connect(d).connect(g.gain);
            // 相位错开：同频 LFO 起播时间往后挪，就得到错开的相位
            o.start(t0 + (layer.lfo.phase || 0) / layer.lfo.rate);
        }
        node.connect(g);
        g.connect(dest);
        src.start(t0);
    }

    return () => {
        started.forEach((n) => { try { n.stop(); } catch { /* 已停止 */ } });
    };
}

/* ============================================================
 * 公开 API —— 句柄字段刻意与 HTMLAudioElement / paperSfx 对齐
 * （muted / volume / _baseVolume），便于统一接管静音与音量。
 * ============================================================ */

const noopHandle = () => ({
    _baseVolume: 1, muted: false, volume: 0, ready: false,
    stop() { }, fade() { },
});

/**
 * 播放一个环境音。返回句柄（stop / fade / muted / volume / ready）。
 *
 * 与 paperSfx 一样：**用户手势之前不创建 AudioContext**，只排队等解锁。
 * 所以返回的句柄可能是"尚未发声"的占位对象 —— 用 `ready` 判断。
 */
export function createAmbience(name, { volume = 1, muted = false } = {}) {
    if (!PRESETS[name]) return noopHandle();

    let live = null;          // { teardown, gain }
    let curVol = volume;
    let curMuted = muted;
    let stopped = false;
    let cancelArmed = null;   // whenUnlocked 的取消函数

    const spawn = () => {
        const ctx = getAudioContext();
        const bus = getAudioBus();
        if (!ctx || !bus) return;

        const gain = ctx.createGain();
        // 从 0 淡入：直接给满值会在进房间那一刻"啪"一下
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(curMuted ? 0 : clamp01(curVol), ctx.currentTime + 1.2);
        gain.connect(bus);

        const teardown = build(ctx, bus, name, gain);
        if (!teardown) {
            try { gain.disconnect(); } catch { /* noop */ }
            return;
        }
        live = { teardown, gain };
        handle.ready = true;
    };

    const apply = () => {
        if (!live || stopped) return;
        const ctx = getAudioContext();
        live.gain.gain.setTargetAtTime(curMuted ? 0 : clamp01(curVol), ctx.currentTime, 0.05);
    };

    const handle = {
        _baseVolume: volume,
        ready: false,
        get muted() { return curMuted; },
        set muted(v) { curMuted = !!v; apply(); },
        get volume() { return curVol; },
        set volume(v) { curVol = v; apply(); },
        stop() {
            if (stopped) return;
            stopped = true;
            handle.ready = false;
            if (cancelArmed) { cancelArmed(); cancelArmed = null; }
            if (!live) return;
            const ctx = getAudioContext();
            live.gain.gain.cancelScheduledValues(ctx.currentTime);
            live.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
            // 等淡出跑完再拆，否则尾音被硬切会有"啪"的一声
            setTimeout(() => {
                try { live.teardown(); } catch { /* noop */ }
                try { live.gain.disconnect(); } catch { /* noop */ }
                live = null;
            }, 260);
        },
        fade() { this.stop(); },
    };

    // 手势前排队；stop() 会撤掉排队，避免组件卸载之后又被补播一次
    cancelArmed = whenUnlocked(spawn);

    return handle;
}
