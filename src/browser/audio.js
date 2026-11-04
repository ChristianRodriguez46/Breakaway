/* =============================================================
   src/browser/audio.js
   Synthesized game sounds with the Web Audio API (no sound files).

   Sections in this file
     1. Sound recipes
     2. createAudio: unlock, play, setMuted

   How it fits (ARCHITECTURE §11): browsers only allow audio after a
   user gesture, so the AudioContext is created in unlock(), which
   main.js calls from the Play button's click. Until then play()
   does nothing. Every sound has a visual equivalent on screen
   (ui-strings.js VISUAL_EQUIVALENTS), so muting loses no
   information.

   Troubleshooting
   - No sound at all: unlock() was never called from a click, or the
     game is muted (M, or the Sound setting), or the tab is muted.
   - Stick sounds stutter: they are throttled to
     STICKHANDLE_SOUNDS_PER_S_MAX per second on purpose.
   - "The AudioContext was not allowed to start" in the console: a
     context was created outside a gesture; only unlock() makes one.
   ============================================================= */

import { STICKHANDLE_SOUNDS_PER_S_MAX } from '../core/constants.js';

/* ---------- 1. Sound recipes ---------- */

/** Master volume, kept low: these are short UI-style sounds. */
const MASTER_GAIN = 0.35;

/**
 * Plays a short oscillator note with an attack/decay envelope.
 * @param {AudioContext} ctx @param {AudioNode} out
 * @param {{ type: OscillatorType, from: number, to?: number, durationS: number, gain: number, delayS?: number, detune?: number }} note
 * @returns {void}
 */
function tone(ctx, out, { type, from, to = from, durationS, gain, delayS = 0, detune = 0 }) {
    const start = ctx.currentTime + delayS;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + durationS);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, durationS / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
    osc.connect(amp).connect(out);
    osc.start(start);
    osc.stop(start + durationS + 0.02);
}

/**
 * Plays a burst of filtered noise.
 * @param {AudioContext} ctx @param {AudioNode} out @param {AudioBuffer} buffer
 * @param {{ durationS: number, gain: number, filterHz: number, filterType?: BiquadFilterType }} burst
 * @returns {void}
 */
function noise(ctx, out, buffer, { durationS, gain, filterHz, filterType = 'bandpass' }) {
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterHz;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
    source.connect(filter).connect(amp).connect(out);
    source.start(start);
    source.stop(start + durationS + 0.02);
}

/**
 * One second of white noise, made once per context.
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function makeNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0; // cheap LCG; sound only, not game randomness
        data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
}

/**
 * The recipe for each sound event.
 * @type {Record<string, (ctx: AudioContext, out: AudioNode, buffer: AudioBuffer) => void>}
 */
const RECIPES = {
    stickhandle: (ctx, out, buffer) => noise(ctx, out, buffer, { durationS: 0.04, gain: 0.25, filterHz: 2400 }),
    shot: (ctx, out, buffer) => {
        noise(ctx, out, buffer, { durationS: 0.12, gain: 0.7, filterHz: 1800 });
        tone(ctx, out, { type: 'triangle', from: 320, to: 120, durationS: 0.08, gain: 0.3 });
    },
    post: (ctx, out) => {
        tone(ctx, out, { type: 'sine', from: 2350, durationS: 0.5, gain: 0.35 });
        tone(ctx, out, { type: 'sine', from: 3520, durationS: 0.3, gain: 0.15 });
    },
    save: (ctx, out, buffer) => {
        tone(ctx, out, { type: 'sine', from: 140, to: 60, durationS: 0.18, gain: 0.7 });
        noise(ctx, out, buffer, { durationS: 0.08, gain: 0.3, filterHz: 500, filterType: 'lowpass' });
    },
    goal: (ctx, out) => {
        tone(ctx, out, { type: 'sawtooth', from: 220, durationS: 1.2, gain: 0.22 });
        tone(ctx, out, { type: 'sawtooth', from: 220, durationS: 1.2, gain: 0.22, detune: 14 });
        tone(ctx, out, { type: 'sawtooth', from: 277, durationS: 1.2, gain: 0.12, detune: -8 });
    },
    poke: (ctx, out, buffer) => {
        noise(ctx, out, buffer, { durationS: 0.06, gain: 0.4, filterHz: 3200 });
        tone(ctx, out, { type: 'square', from: 600, to: 300, durationS: 0.06, gain: 0.12 });
    },
    rebound: (ctx, out) => tone(ctx, out, { type: 'triangle', from: 500, to: 260, durationS: 0.1, gain: 0.25 })
};

/* ---------- 2. createAudio ---------- */

/**
 * Creates the sound player.
 * @param {{ audioContextFactory: (() => AudioContext)|null, nowMs?: () => number, isMuted?: boolean }} options
 * @returns {{ unlock(): void, play(eventType: string): void, setMuted(isMuted: boolean): void,
 *   readonly isMuted: boolean }}
 */
export function createAudio({ audioContextFactory, nowMs = () => performance.now(), isMuted = false }) {
    /** @type {AudioContext|null} */
    let ctx = null;
    /** @type {GainNode|null} */
    let master = null;
    /** @type {AudioBuffer|null} */
    let noiseBuffer = null;
    let muted = isMuted;
    let lastStickMs = -Infinity;
    const stickGapMs = 1000 / STICKHANDLE_SOUNDS_PER_S_MAX;

    /**
     * Creates (or resumes) the AudioContext. Call from a user gesture.
     * @returns {void}
     */
    function unlock() {
        try {
            if (!ctx && audioContextFactory) {
                ctx = audioContextFactory();
                master = ctx.createGain();
                master.gain.value = MASTER_GAIN;
                master.connect(ctx.destination);
                noiseBuffer = makeNoiseBuffer(ctx);
            }
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch {
            ctx = null; // no Web Audio: the game stays silent
        }
    }

    /**
     * Plays the sound for a game event type (ignored when muted, locked or unknown).
     * @param {string} eventType - 'stickhandle', 'shot', 'post', 'save', 'goal', 'poke', 'rebound'.
     * @returns {void}
     */
    function play(eventType) {
        if (muted || !ctx || !master || !noiseBuffer) return;
        const recipe = RECIPES[eventType];
        if (!recipe) return;
        if (eventType === 'stickhandle') {
            const now = nowMs();
            if (now - lastStickMs < stickGapMs) return;
            lastStickMs = now;
        }
        try {
            recipe(ctx, master, noiseBuffer);
        } catch {
            /* a closed context: stay silent */
        }
    }

    /**
     * Mutes or unmutes.
     * @param {boolean} nextIsMuted
     * @returns {void}
     */
    function setMuted(nextIsMuted) {
        muted = nextIsMuted;
    }

    return {
        unlock, play, setMuted,
        get isMuted() { return muted; }
    };
}
