/**
 * Procedural SFX — Web Audio synthesized one-shot effects (zero samples).
 *
 * playBark():      cartoon double "汪汪" — sawtooth pitch-drop body through a
 *                  sweeping bandpass (formant-ish), plus a short breath-noise
 *                  attack.
 * playWindChime(): metal wind chime — a cluster of inharmonic tubular-bell
 *                  partials on a pentatonic chord, struck slightly out of sync
 *                  so it shimmers like a real gust.
 * playSwallow():   燕子 — a tight burst of high, slightly falling chirps, each
 *                  with a rapid trill and a breathy onset.
 *
 * Respects the site's mute/volume preferences (audio_muted / audio_volume).
 */

let ctx = null;

function getCtx() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
    }
    return ctx;
}

function prefVolume() {
    try {
        if (localStorage.getItem('audio_muted') === 'true') return 0;
        const v = parseFloat(localStorage.getItem('audio_volume'));
        return isNaN(v) ? 0.5 : v;
    } catch {
        return 0.5;
    }
}

/** One "汪" burst: pitch-drop body + formant sweep + breath attack */
function barkAt(context, dest, t0, baseFreq, level) {
    // --- body: sawtooth with fast pitch drop ---
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.42, t0 + 0.15);

    // --- formant-ish bandpass sweep (mouth opening -> closing) ---
    const bp = context.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(950, t0);
    bp.frequency.exponentialRampToValueAtTime(340, t0 + 0.15);

    const body = context.createGain();
    body.gain.setValueAtTime(0.0001, t0);
    body.gain.exponentialRampToValueAtTime(level, t0 + 0.018);
    body.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);

    osc.connect(bp);
    bp.connect(body);
    body.connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.2);

    // --- breath noise attack (the "w" onset) ---
    const noiseLen = Math.floor(context.sampleRate * 0.06);
    const buf = context.createBuffer(1, noiseLen, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = context.createBufferSource();
    noise.buffer = buf;

    const hp = context.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;

    const nGain = context.createGain();
    nGain.gain.setValueAtTime(level * 0.35, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);

    noise.connect(hp);
    hp.connect(nGain);
    nGain.connect(dest);
    noise.start(t0);
    noise.stop(t0 + 0.07);
}

/**
 * Play a cartoon double bark "汪汪".
 * @param {number} volume 0..1 relative level (multiplied by user prefs)
 */
export function playBark(volume = 1) {
    if (typeof window === 'undefined') return;
    const pref = prefVolume();
    if (pref <= 0) return;

    const context = getCtx();
    if (context.state === 'suspended') {
        context.resume().catch(() => { });
    }

    const master = context.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume * pref));
    master.connect(context.destination);

    const t = context.currentTime + 0.02;
    barkAt(context, master, t, 430, 0.85);
    barkAt(context, master, t + 0.23, 375, 0.7);

    // release the node graph after the sound ends
    setTimeout(() => {
        master.disconnect();
    }, 1200);
}

/* ------------------------------------------------------------------ */
/* Wind chime                                                           */
/* ------------------------------------------------------------------ */

/**
 * Tubular-bell partial ratios. Real chime tubes are inharmonic — the upper
 * partials are NOT integer multiples of the fundamental, and that is exactly
 * what makes the sound read as struck metal instead of a plain sine beep.
 * Higher partials are quieter and die faster.
 */
const CHIME_PARTIALS = [
    { ratio: 1.00, gain: 1.00, decay: 2.40 },
    { ratio: 2.76, gain: 0.40, decay: 1.35 },
    { ratio: 5.40, gain: 0.18, decay: 0.80 },
    { ratio: 8.93, gain: 0.08, decay: 0.45 },
];

/** Pentatonic cluster — the chime's four tubes. D5 E5 G5 C6. */
const CHIME_NOTES = [587.33, 698.46, 783.99, 1046.50];

/** One tube strike: a stack of inharmonic sine partials through a bell envelope. */
function chimeStrike(context, dest, t0, freq, level) {
    CHIME_PARTIALS.forEach((p) => {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * p.ratio;

        const g = context.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * p.gain), t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.decay);

        osc.connect(g);
        g.connect(dest);
        osc.start(t0);
        osc.stop(t0 + p.decay + 0.05);
    });
}

/**
 * Play a wind-chime flourish.
 * @param {number} volume 0..1 relative level (multiplied by user prefs)
 */
export function playWindChime(volume = 1) {
    if (typeof window === 'undefined') return;
    const pref = prefVolume();
    if (pref <= 0) return;

    const context = getCtx();
    if (context.state === 'suspended') {
        context.resume().catch(() => { });
    }

    // Soften the very top end so the metal never turns into a piercing click,
    // then trim the overall level (four ringing tubes stack up fast).
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    tone.Q.value = 0.4;

    const master = context.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume * pref * 0.34));
    tone.connect(master);
    master.connect(context.destination);

    const t = context.currentTime + 0.02;

    // The tubes are struck a few ms apart and slightly detuned, the way a real
    // chime swings into its neighbours instead of hitting them in unison.
    CHIME_NOTES.forEach((f, i) => {
        chimeStrike(context, tone, t + i * 0.032 + Math.random() * 0.018, f, 1 - i * 0.11);
    });

    // A softer upper-octave flutter so the tail shimmers rather than "bongs".
    CHIME_NOTES.slice(0, 3).forEach((f, i) => {
        chimeStrike(context, tone, t + 0.16 + i * 0.055 + Math.random() * 0.03, f * 1.5, 0.30);
    });

    setTimeout(() => {
        master.disconnect();
        tone.disconnect();
    }, 4000);
}

/* ------------------------------------------------------------------ */
/* Swallow                                                              */
/* ------------------------------------------------------------------ */

/**
 * One chirp. A swallow's note is a very short, high, slightly *falling* whistle
 * with a fast trill riding on it — the trill is what separates a bird from a
 * synth beep, so the pitch is driven by an LFO on top of the sweep.
 */
function swallowChirp(context, dest, t0, baseFreq, level) {
    // --- body: triangle falling ~15% over 45 ms ---
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.14, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.86, t0 + 0.045);

    // --- trill: ~5 wobbles inside the chirp ---
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(115, t0);
    const lfoGain = context.createGain();
    lfoGain.gain.setValueAtTime(baseFreq * 0.11, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // --- upper partial: the "tsi" edge ---
    const hi = context.createOscillator();
    hi.type = 'sine';
    hi.frequency.setValueAtTime(baseFreq * 1.94, t0);
    hi.frequency.exponentialRampToValueAtTime(baseFreq * 1.52, t0 + 0.045);
    const hiGain = context.createGain();
    hiGain.gain.setValueAtTime(0.0001, t0);
    hiGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.34), t0 + 0.006);
    hiGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);

    const bp = context.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.value = baseFreq * 1.15;

    const body = context.createGain();
    body.gain.setValueAtTime(0.0001, t0);
    body.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t0 + 0.005);
    body.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);

    osc.connect(bp);
    hi.connect(hiGain);
    hiGain.connect(bp);
    bp.connect(body);
    body.connect(dest);

    osc.start(t0); osc.stop(t0 + 0.07);
    hi.start(t0); hi.stop(t0 + 0.07);
    lfo.start(t0); lfo.stop(t0 + 0.07);

    // --- breath onset ---
    const noiseLen = Math.max(1, Math.floor(context.sampleRate * 0.02));
    const buf = context.createBuffer(1, noiseLen, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = context.createBufferSource();
    noise.buffer = buf;

    const hp = context.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;

    const nGain = context.createGain();
    nGain.gain.setValueAtTime(level * 0.2, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.022);

    noise.connect(hp);
    hp.connect(nGain);
    nGain.connect(dest);
    noise.start(t0);
    noise.stop(t0 + 0.03);
}

/**
 * Play a swallow twitter — a burst of 4–6 chirps drifting slightly downward.
 * @param {number} volume 0..1 relative level (multiplied by user prefs)
 */
export function playSwallow(volume = 1) {
    if (typeof window === 'undefined') return;
    const pref = prefVolume();
    if (pref <= 0) return;

    const context = getCtx();
    if (context.state === 'suspended') {
        context.resume().catch(() => { });
    }

    // Trim the very top so a burst of high chirps never turns into a hiss,
    // then back the level off (five chirps stack up fast).
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    tone.Q.value = 0.4;

    const master = context.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume * pref * 0.30));
    tone.connect(master);
    master.connect(context.destination);

    const t = context.currentTime + 0.02;
    const count = 4 + Math.floor(Math.random() * 3);
    let cursor = t;
    for (let i = 0; i < count; i++) {
        const base = 3000 + Math.random() * 950 - i * 85;
        swallowChirp(context, tone, cursor, base, 1 - i * 0.09);
        cursor += 0.055 + Math.random() * 0.025;
    }

    setTimeout(() => {
        master.disconnect();
        tone.disconnect();
    }, 1600);
}
