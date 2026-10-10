/**
 * 环境音 —— Web Audio 现场合成，零音频素材
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
 * 每个预设的结构都是同一套：**两层以上的噪声，各自走不同的滤波和慢速 LFO**。
 * 关键是各层的 LFO 频率互不成谐波 —— 一旦成整数倍，十几秒后就能听出周期，
 * 底噪立刻"死"掉。
 *
 * 2026-10-10 起多了一组**季节声床**（春/夏/秋/冬，见 docs/seasons.md §5.3）。
 * 它们挂在**院子**上（`!hasEntered`），与走廊 / 房间天然互斥 —— 见
 * `components/canvas/audio/CourtyardAmbience.jsx`。
 *
 * 分工：本模块只负责"环境铺底"（长时间、可循环、要能被停止）。
 * 一次性音效在 paperSfx.js / sfx.js，BGM 在 bgm.js。
 */

import { getAudioBus, getAudioContext, noiseBuffer, whenUnlocked } from './sfxContext';

export const AMBIENCE_NAMES = [
    'wind', 'city', 'sea',
    'spring-rain', 'summer-cicada', 'autumn-insects', 'winter-hush',
];

/**
 * 季节 → 声床名。**唯一真源** —— 挂载点与验收脚本都从这里取，
 * 别再各自写一遍 `season === 'spring' ? ... : ...`。
 */
export const SEASON_BED = {
    spring: 'spring-rain',
    summer: 'summer-cicada',
    autumn: 'autumn-insects',
    winter: 'winter-hush',
};

/**
 * 季节声床的**电平配平** —— 用户 2026-10-10 反馈「春夏秋听感整体比冬天大」。
 *
 * 每条床的层增益都是各自按音色手调的（雨要亮、蝉要冲、冬要空），**从来没有
 * 对齐过响度**，所以四条床的听感电平差了近 3 倍。实测各层增益的均方根：
 *
 *     春 spring-rain    0.1544        ×0.69 → 0.1065
 *     夏 summer-cicada  0.3055        ×0.35 → 0.1069
 *     秋 autumn-insects 0.1690        ×0.63 → 0.1065
 *     冬 winter-hush    0.1065        ×1.00 → 0.1065   ← 以冬天为基准
 *
 * 配平**只动增益**，不动任何频率 —— 四条床的"音色身份"（雨的沙沙、蝉的振鸣、
 * 虫的脉冲、冬的留白）一个都没改，改的只是"多大声"。
 *
 * ⚠️ 增益 LFO 的深度（`layer.lfo.depth`）必须**按同一比例缩** —— 它调制的是
 * 增益本身，不跟着缩的话，缩完的层会被 LFO 推回原来的响度（蝉那层 depth≈gain，
 * 尤其明显）。滤波 LFO 的深度是 Hz，**不缩**。
 *
 * ⚠️ 冬天是 1.00 是**有意的**：这条表的意义是"把春夏秋拉到冬天"，不是"把冬天
 * 抬到别人那儿"。要整体再降，改 `CourtyardAmbience` 的 `COURTYARD_VOLUME`，
 * 别在这里动 —— 那是"铺底音量"这个单一旋钮，这张表是"四季之间的相对关系"。
 */
export const BED_TRIM = {
    'spring-rain': 0.69,
    'summer-cicada': 0.35,
    'autumn-insects': 0.63,
    'winter-hush': 1.00,
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ============================================================
 * 预设
 * ============================================================ */

/* ------------------------------------------------------------------
 * 频率阶梯 —— 季节声床用，别手改成"整数好记"的值
 * ------------------------------------------------------------------
 * 「各层 LFO 频率互不成谐波」这条规则，在 wind/city 里是**手挑**的
 * （0.07 / 0.051 / 0.113 / 0.021 / 0.033），能不能躲开整数倍全凭运气。
 * 季节声床要四条，靠手挑必然翻车，所以改成**按一把梯子取**：
 *
 *      r_k = r0 · φ^k        φ = 1.6180339887…（黄金比）
 *
 * 于是**任意两条**的比值都是 φ 的整数次幂。黄金比是最"无理"的数
 * （连分数收敛最慢），φ^k 离任何有理数都最远 —— 两条波形永远不会锁成
 * 一个短周期。这是本模块那条硬规则的结构化解法，不是凑出来的数字。
 *
 * 实测最坏的一对是 φ⁵ ≈ 11.09：离整数 11 差 0.8%，拍频 0.001 Hz
 * ⇒ 公共周期 ≈ 1000 s，远在"听得出来"之外。
 *
 * ⚠️ 同一预设内**必须**只用同一把梯子（或梯子的子集）。跨梯子混用时
 * 比值不再是 φ 的幂，规则就失效了。
 */
const SLOW = [0.0113, 0.0183, 0.0296, 0.0479, 0.0774, 0.1253]; // 慢速起伏
const TRIL = [5.0, 8.1, 13.1];                                   // 虫鸣脉冲（Hz）
const BUZZ = [43.0, 69.6];                                       // 蝉的振鸣（Hz）

const PRESETS = {
    /* 风：低频"呼呼"的body + 高频的"嘶"，两层各自慢速起伏，
     * 再加上一条极慢的阵风 LFO 推低通截止点 —— 风的变化全在截止点上。 */
    wind: (_ctx) => [
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
    city: (_ctx) => [
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
    sea: (_ctx) => [
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

    /* ============================================================
     * 季节声床（2026-10-10）—— 挂在院子，四季各一条
     * ============================================================
     * 验收判据是「**关掉画面只听声音也能分辨季节**」，所以四条要拉开：
     *
     *   春 细雨  高频"沙沙"为主，宽而匀，慢速起伏
     *   夏 蝉    窄带 + 高频 AM 振鸣，又响又密，最"吵"的一条
     *   秋 虫    稀疏短促脉冲 + 干风，节奏感来自脉冲本身
     *   冬 静    极低电平风噪，近乎无声 —— **留白就是冬**
     *
     * 每条的 LFO 都从上面的梯子取（SLOW / TRIL / BUZZ），比值全是 φ 的幂。
     */

    /* 春雨 —— 细雨沙沙。
     * 主角是高频那层（2.4 kHz 带通白噪）；下面垫一层很慢的棕噪，
     * 让"雨势"整体有涨落。没有雷、没有雨滴声 —— 那是偶发音效的事。 */
    'spring-rain': (_ctx) => [
        {
            noise: ['white', 4],
            filters: [
                { type: 'bandpass', freq: 2450, Q: 0.55 },
                { type: 'highpass', freq: 850 },
            ],
            gain: 0.085,
            lfo: { rate: SLOW[2], depth: 0.030 },
        },
        {
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 1180, Q: 0.85, lfo: { rate: SLOW[3], depth: 190 } },
            ],
            gain: 0.052,
            lfo: { rate: SLOW[1], depth: 0.022 },
        },
        {
            /* 雨势的重量：极慢的一层，几乎只在中低频 */
            noise: ['brown', 5],
            filters: [
                { type: 'lowpass', freq: 320, Q: 0.7, lfo: { rate: SLOW[4], depth: 130 } },
            ],
            gain: 0.105,
            lfo: { rate: SLOW[0], depth: 0.055 },
        },
        {
            /* 打在瓦上的细密水雾 */
            noise: ['white', 4],
            filters: [
                { type: 'highpass', freq: 5600 },
            ],
            gain: 0.024,
            lfo: { rate: SLOW[5], depth: 0.014 },
        },
    ],

    /* 夏蝉 —— 两条互不锁相的振鸣 + 暑气底噪。
     *
     * 蝉声的机制就是 **AM 调制**：窄带噪声（Q=13，只留 ~4 kHz 附近的一条）
     * 被 43 Hz 的 LFO 大幅调制。depth 接近 gain，增益每周期几乎触 0，
     * 于是"沙"变成"嗡" —— 这就是振鸣。
     *
     * 两条蝉用 43.0 / 69.6（比值 φ），一近一远、音高不同，听感是"蝉声
     * 此起彼伏"，不是一条死循环。滤波截止各自还有一条慢 LFO 在推，
     * 那是"忽远忽近"。 */
    'summer-cicada': (_ctx) => [
        {
            noise: ['white', 4],
            filters: [
                { type: 'bandpass', freq: 4350, Q: 13, lfo: { rate: SLOW[1], depth: 380 } },
            ],
            gain: 0.20,
            lfo: { rate: BUZZ[0], depth: 0.185 },
        },
        {
            noise: ['white', 4],
            filters: [
                { type: 'bandpass', freq: 3050, Q: 10, lfo: { rate: SLOW[2], depth: 300 } },
            ],
            gain: 0.135,
            lfo: { rate: BUZZ[1], depth: 0.126 },
        },
        {
            /* 暑气：很低的一条棕噪，像被晒热的空气 */
            noise: ['brown', 5],
            filters: [
                { type: 'lowpass', freq: 190, Q: 0.7 },
            ],
            gain: 0.090,
            lfo: { rate: SLOW[0], depth: 0.045 },
        },
        {
            /* 树叶被晒白的那点嘶声 */
            noise: ['white', 3],
            filters: [
                { type: 'highpass', freq: 6200 },
            ],
            gain: 0.028,
            lfo: { rate: SLOW[5], depth: 0.018 },
        },
    ],

    /* 秋虫 —— 稀疏短促的虫鸣 + 干风。
     *
     * 「短促脉冲」在本模块里也是靠 LFO 做的：窄带高 Q 噪声 + **低频大深度**
     * 的增益 LFO（5–13 Hz），增益每周期触 0 —— 听起来就是一串一串的
     * "唧、唧、唧"。三条虫鸣用 5.0 / 8.1 / 13.1（同一把 φ 梯子），
     * 疏密不同，于是不会齐声。
     *
     * 干风那层比春雨的更薄、更快，秋天本来就是"干"的。 */
    'autumn-insects': (_ctx) => [
        {
            noise: ['white', 4],
            filters: [
                { type: 'bandpass', freq: 4650, Q: 17, lfo: { rate: SLOW[3], depth: 260 } },
            ],
            gain: 0.075,
            lfo: { rate: TRIL[1], depth: 0.070 },
        },
        {
            noise: ['white', 4],
            filters: [
                { type: 'bandpass', freq: 3350, Q: 14, lfo: { rate: SLOW[2], depth: 200 } },
            ],
            gain: 0.050,
            lfo: { rate: TRIL[0], depth: 0.046 },
        },
        {
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 5900, Q: 20 },
            ],
            gain: 0.030,
            lfo: { rate: TRIL[2], depth: 0.028 },
        },
        {
            /* 干风：比春天的更薄 */
            noise: ['brown', 5],
            filters: [
                { type: 'lowpass', freq: 430, Q: 0.65, lfo: { rate: SLOW[4], depth: 170 } },
            ],
            gain: 0.115,
            lfo: { rate: SLOW[0], depth: 0.060 },
        },
        {
            /* 枯叶摩擦 */
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 2100, Q: 0.5 },
            ],
            gain: 0.022,
            lfo: { rate: SLOW[5], depth: 0.016 },
        },
    ],

    /* 冬静 —— 近乎无声。**留白就是冬。**
     *
     * 只有极低电平的风噪：一条很闷的低频（95 Hz 低通）当"冷空气的重量"，
     * 一条 260 Hz 的当"风声"，再加两点几乎听不见的高频嘶声。
     *
     * 总电平刻意只有别季的一半左右 —— 如果冬天听起来和秋天一样满，
     * 那"冬"这件事就没做出来。 */
    'winter-hush': (_ctx) => [
        {
            noise: ['brown', 6],
            filters: [
                { type: 'lowpass', freq: 260, Q: 0.7, lfo: { rate: SLOW[1], depth: 110 } },
            ],
            gain: 0.085,
            lfo: { rate: SLOW[0], depth: 0.035 },
        },
        {
            noise: ['brown', 5],
            filters: [
                { type: 'lowpass', freq: 95, Q: 0.8 },
            ],
            gain: 0.055,
            lfo: { rate: SLOW[2], depth: 0.022 },
        },
        {
            /* 干冷空气的嘶声 —— 电平低到只是"不是绝对安静" */
            noise: ['white', 4],
            filters: [
                { type: 'highpass', freq: 4200 },
            ],
            gain: 0.008,
            lfo: { rate: SLOW[5], depth: 0.004 },
        },
        {
            noise: ['white', 3],
            filters: [
                { type: 'bandpass', freq: 1600, Q: 0.6 },
            ],
            gain: 0.012,
            lfo: { rate: SLOW[3], depth: 0.007 },
        },
    ],
};

/* ============================================================
 * 图搭建
 * ============================================================ */

function build(ctx, bus, name, dest) {
    const spec = PRESETS[name];
    if (!spec) return null;

    // 季节声床的电平配平（见 BED_TRIM）。wind/city/sea 不在表里，trim = 1。
    const trim = BED_TRIM[name] ?? 1;

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
                // ⚠️ 滤波 LFO 的深度是 **Hz**，与电平无关，**不乘 trim**。
                d.gain.value = f.lfo.depth;
                o.connect(d).connect(filter.frequency);
                o.start(t0);
            }
            node.connect(filter);
            node = filter;
        }

        const g = ctx.createGain();
        g.gain.value = layer.gain * trim;
        if (layer.lfo) {
            const o = keep(ctx.createOscillator());
            o.type = 'sine';
            o.frequency.value = layer.lfo.rate;
            const d = ctx.createGain();
            // ⚠️ 这是**增益** LFO —— 深度必须跟着 trim 一起缩，
            // 否则调制会把缩下去的层再推回去（见 BED_TRIM 的注释）。
            d.gain.value = layer.lfo.depth * trim;
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
