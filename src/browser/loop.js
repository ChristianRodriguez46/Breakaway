/* =============================================================
   src/browser/loop.js
   requestAnimationFrame loop with a fixed-step accumulator.

   Sections in this file
     1. createLoop: start, stop, isRunning

   How it works (ARCHITECTURE §4, docs/decisions.md): each animation frame
   adds the real time since the last frame (capped at
   MAX_FRAME_DT_S) to an accumulator, runs step() once for every
   FIXED_STEP_S in it (at most MAX_STEPS_PER_FRAME times, then drops
   the rest so a slow device runs slow instead of freezing), and
   calls render(alpha) once with how far we are into the next step.

   Everything it touches is injected (requestFrame, cancelFrame,
   nowMs, isLive), so tests can drive it with a fake clock.
   main.js passes functions that read window.requestAnimationFrame
   at call time, not at import time (TEST_PLAN request 4).

   Troubleshooting
   - The game runs at double speed on a 120 Hz screen: something is
     calling step() per frame instead of per FIXED_STEP_S.
   - A big jump after switching tabs: start() must reset the
     timestamp; the first frame after start adds no time.
   - Frames keep running while paused (AC-18): isLive() must return
     false outside playing, rebound_window and result_banner.
   ============================================================= */

import { FIXED_STEP_S, MAX_FRAME_DT_S, MAX_STEPS_PER_FRAME } from '../core/constants.js';

/* ---------- 1. createLoop ---------- */

/**
 * Creates the fixed-step game loop.
 * @param {{ step: () => void, render: (alpha: number) => void,
 *   requestFrame: (callback: (timeMs: number) => void) => number,
 *   cancelFrame: (handle: number) => void, nowMs: () => number,
 *   isLive: () => boolean }} deps
 * @returns {{ start(): void, stop(): void, readonly isRunning: boolean }}
 */
export function createLoop({ step, render, requestFrame, cancelFrame, nowMs, isLive }) {
    let isRunning = false;
    /** @type {number|null} */
    let handle = null;
    let lastMs = 0;
    let accumulatorS = 0;

    /**
     * One animation frame: advance fixed steps, render, and schedule the next frame
     * only while the game is live.
     * @returns {void}
     */
    function onFrame() {
        handle = null;
        if (!isRunning) return;
        const now = nowMs();
        const frameDtS = Math.max(0, (now - lastMs) / 1000);
        lastMs = now;
        accumulatorS += Math.min(frameDtS, MAX_FRAME_DT_S);

        let steps = 0;
        while (accumulatorS >= FIXED_STEP_S && steps < MAX_STEPS_PER_FRAME) {
            step();
            accumulatorS -= FIXED_STEP_S;
            steps += 1;
            if (!isLive()) break;
        }
        if (steps >= MAX_STEPS_PER_FRAME && accumulatorS >= FIXED_STEP_S) {
            accumulatorS = 0; // spiral-of-death guard: drop the extra time
        }
        render(Math.min(1, accumulatorS / FIXED_STEP_S));

        if (isLive()) {
            handle = requestFrame(onFrame);
        } else {
            isRunning = false;
            accumulatorS = 0;
        }
    }

    /**
     * Starts the loop (no-op when already running). The first frame adds no time.
     * @returns {void}
     */
    function start() {
        if (isRunning) return;
        isRunning = true;
        lastMs = nowMs();
        accumulatorS = 0;
        handle = requestFrame(onFrame);
    }

    /**
     * Stops the loop and cancels any pending frame.
     * @returns {void}
     */
    function stop() {
        isRunning = false;
        accumulatorS = 0;
        if (handle !== null) {
            cancelFrame(handle);
            handle = null;
        }
    }

    return {
        start,
        stop,
        get isRunning() { return isRunning; }
    };
}
