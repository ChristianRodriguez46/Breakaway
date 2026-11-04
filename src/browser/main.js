/* =============================================================
   src/browser/main.js
   Wires the pure core to the browser: settings, renderer, input,
   touch controls, audio, loop and UI. No exports.

   Sections in this file
     1. Startup: seed, storage, settings, motion
     2. Building the pieces (renderer, input, audio, loop, UI)
     3. One step and one frame
     4. Game events → sound, banner, announcements, screens
     5. Run flow: play, pause, resume, restart, quit, next round
     6. Settings changes and saved data
     7. Keyboard shortcuts, auto-pause, button wiring

   How it fits (ARCHITECTURE §1, docs/decisions.md): core/ never touches the
   DOM; this file is the only place that holds the GameState and
   moves it between screens. `?seed=<integer>` makes the run
   repeatable for tests (TEST_PLAN request 1).

   Troubleshooting
   - The game never starts after Play: look for a thrown error in the
     console from core/ (stepGame, createGameState).
   - Restart or Quit asks to confirm: only when runScore > 0, so a
     score is never thrown away by accident (UX_COPY §8).
   - Sound never plays: the AudioContext is made in the Play click
     (audio.unlock); M or the Sound setting may have muted it.
   ============================================================= */

import { createRng, parseSeedParam } from '../core/random.js';
import { createGameState, startRun, startNextRound, pauseGame, resumeGame } from '../core/rules.js';
import { stepGame } from '../core/game.js';
import { getTierForRound } from '../core/difficulty.js';
import { getBestScoreSlotKey, validateSettings } from '../core/settings.js';
import { POINTS_PER_GOAL } from '../core/constants.js';
import * as strings from '../core/ui-strings.js';
import { createStore, getLocalStorage } from './storage.js';
import { createRenderer, readRinkTokens } from './renderer.js';
import { createInput } from './input.js';
import { createTouchControls } from './touch-controls.js';
import { createAudio } from './audio.js';
import { createLoop } from './loop.js';
import { createUi } from './ui.js';

/** @typedef {import('../core/types.js').GameState} GameState */
/** @typedef {import('../core/types.js').GameEvent} GameEvent */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').BestScore} BestScore */
/** @typedef {import('../core/types.js').ControlScheme} ControlScheme */
/** @typedef {import('../core/types.js').MotionPreference} MotionPreference */

/** Phases where the loop runs. */
const LIVE_PHASES = new Set(['playing', 'rebound_window', 'result_banner']);
/** Sound for each game event that has one. */
const SOUND_EVENTS = new Set(['stickhandle', 'shot', 'post', 'save', 'goal', 'poke', 'rebound']);
const MOTION_NAMES = Object.freeze({ system: 'follow my device setting', reduce: 'reduce motion', full: 'full motion' });

/* ---------- 1. Startup ---------- */

/**
 * A random 32-bit seed from the browser's crypto source.
 * @returns {number}
 */
function randomSeed() {
    try {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        return buffer[0];
    } catch {
        return Math.floor(Math.random() * 0xffffffff) >>> 0;
    }
}

/**
 * Whether the device should get on-screen touch controls.
 * @returns {boolean}
 */
function isTouchDevice() {
    try {
        return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    } catch {
        return false;
    }
}

/**
 * Builds and starts the game. Runs once on DOMContentLoaded.
 * @returns {void}
 */
function boot() {
    const root = document.querySelector('.breakaway');
    const canvas = document.getElementById('rink');
    const container = document.getElementById('rink-cell');
    const touchRoot = document.getElementById('touch-controls');
    if (!(root instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement) ||
        !(container instanceof HTMLElement) || !(touchRoot instanceof HTMLElement)) return;

    const seedParam = parseSeedParam(window.location.search);
    const rng = createRng(seedParam ?? randomSeed());

    const storage = getLocalStorage();
    const store = createStore({ storage });
    /** @type {Settings} */
    let settings = store.loadSettings();
    let bestScores = store.loadBestScores();
    let isStorageBlocked = storage === null;

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    /** @returns {'reduce'|'full'} */
    const resolveMotion = () => {
        if (settings.motion_preference === 'system') return reducedQuery.matches ? 'reduce' : 'full';
        return settings.motion_preference;
    };

    /* ---------- 2. Building the pieces ---------- */

    const ui = createUi({ root, strings });
    ui.setMotion(resolveMotion());

    const renderer = createRenderer({ canvas, container, tokens: readRinkTokens(root), getMotion: resolveMotion });
    const input = createInput({
        target: window, canvas, scheme: settings.control_scheme,
        worldFromClient: (x, y) => renderer.worldFromClient(x, y)
    });
    const isTouch = isTouchDevice();
    ui.setTouchVisible(isTouch);
    const touch = isTouch
        ? createTouchControls({ root: touchRoot, scheme: settings.control_scheme, onIntentChange: (event) => input.applyTouch(event) })
        : null;

    const AudioContextClass = window.AudioContext ||
        /** @type {typeof AudioContext|undefined} */ (/** @type {any} */ (window).webkitAudioContext);
    const audio = createAudio({
        audioContextFactory: AudioContextClass ? () => new AudioContextClass() : null,
        isMuted: !settings.is_sound_on
    });

    /** @type {GameState} */
    let state = createGameState({ scheme: settings.control_scheme, startingLevel: settings.starting_level, rng });
    /** @type {HTMLElement|null} where focus goes back to on "Back to start" */
    let startReturnFocus = null;
    /** @type {'restart'|'quit'|null} */
    let pendingLeave = null;

    const loop = createLoop({
        step: doStep,
        render: doRender,
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (handle) => window.cancelAnimationFrame(handle),
        nowMs: () => performance.now(),
        isLive: () => LIVE_PHASES.has(state.phase)
    });

    /**
     * The stored best for the current scheme and level.
     * @returns {BestScore|null}
     */
    function currentBest() {
        return bestScores.scores[getBestScoreSlotKey(settings.control_scheme, settings.starting_level)] || null;
    }

    /* ---------- 3. One step and one frame ---------- */

    /**
     * One fixed step: read input, step the core, react to its events.
     * @returns {void}
     */
    function doStep() {
        const intent = input.readIntent();
        const { events } = stepGame(state, intent, rng);
        if (events.length) handleEvents(events);
    }

    /**
     * One frame: draw the rink and refresh the strip.
     * @param {number} alpha @returns {void}
     */
    function doRender(alpha) {
        renderer.setAimPoint(input.getAimPreview());
        renderer.draw(state, alpha);
        ui.updateStrip(state, currentBest());
    }

    /** Draws the current state once (menus, after a resize). @returns {void} */
    function drawStill() {
        renderer.draw(state, 1);
        ui.updateStrip(state, currentBest());
    }

    /* ---------- 4. Game events ---------- */

    /**
     * Reacts to the events of one step.
     * @param {GameEvent[]} events @returns {void}
     */
    function handleEvents(events) {
        const hadSaveContact = events.some((event) => event.type === 'save');
        for (const event of events) {
            if (SOUND_EVENTS.has(event.type)) audio.play(event.type);
            switch (event.type) {
                case 'goal':
                    renderer.showGoalLamp();
                    ui.showGoalMoment();
                    break;
                case 'rebound':
                    ui.showBanner('rebound');
                    ui.announce(strings.UX_STRINGS.announce.rebound);
                    break;
                case 'outcome': {
                    const outcome = event.outcome ?? 'save';
                    const points = event.points ?? 0;
                    ui.showBanner(outcome, {
                        isShortOfNet: Boolean(event.isShortOfNet),
                        hasDekeBonus: outcome === 'goal' && points > POINTS_PER_GOAL,
                        isReboundExpired: outcome === 'save' && !hadSaveContact,
                        points: outcome === 'goal' ? points : undefined
                    });
                    ui.announce(strings.getOutcomeAnnouncement(outcome, state.round, state.attemptIndex, state.round.goals, {
                        points: outcome === 'goal' ? points : POINTS_PER_GOAL,
                        runScore: state.runScore,
                        isShortOfNet: Boolean(event.isShortOfNet)
                    }));
                    ui.setCanvasLabel(strings.getCanvasLabel(state));
                    renderer.setAimPoint(null);
                    break;
                }
                case 'attempt_started':
                    onAttemptStarted();
                    break;
                case 'round_cleared':
                    onRoundCleared();
                    break;
                case 'run_over':
                    onRunOver();
                    break;
                default:
                    break;
            }
        }
    }

    /** A new attempt: clear the banner, reset edges, announce. @returns {void} */
    function onAttemptStarted() {
        ui.hideBanner();
        input.resetForAttempt();
        ui.announce(strings.getAttemptStartAnnouncement(state.attemptIndex));
        ui.setCanvasLabel(strings.getCanvasLabel(state));
    }

    /** Round cleared: show the summary. @returns {void} */
    function onRoundCleared() {
        input.setEnabled(false);
        ui.setPauseEnabled(false);
        ui.hideBanner();
        const nextTier = getTierForRound(state.startingLevel, state.round.number + 1).tierName;
        ui.renderSummary(state.round, true, nextTier, state.runScore);
        drawStill();
        ui.showScreen('summary');
        ui.announce(strings.getRoundAnnouncement(state.round, true, nextTier));
    }

    /** Run over: record the best (only here, Q9), show game over. @returns {void} */
    function onRunOver() {
        input.setEnabled(false);
        ui.setPauseEnabled(false);
        ui.hideBanner();
        const slotKey = getBestScoreSlotKey(state.scheme, state.startingLevel);
        const result = store.recordBestIfBeaten(slotKey, {
            score: state.runScore, roundsCleared: state.roundsCleared, goals: state.runGoals
        });
        if (result.isNewBest && store.didLastWriteFail) isStorageBlocked = true;
        bestScores = store.loadBestScores();
        const best = result.isNewBest && isStorageBlocked ? result.best : (bestScores.scores[slotKey] || result.best);
        ui.renderGameOver({ state, best, isNewBest: result.isNewBest, isStorageBlocked });
        drawStill();
        ui.showScreen('gameover');
        const lines = [strings.getRoundAnnouncement(state.round, false, null), strings.getGameOverAnnouncement(state)];
        if (result.isNewBest) lines.push(strings.getNewBestAnnouncement(state.runScore));
        ui.announce(lines.join(' '));
    }

    /* ---------- 5. Run flow ---------- */

    /** Starts a fresh run with the current settings. @returns {void} */
    function playNewRun() {
        audio.unlock();
        loop.stop();
        state = createGameState({ scheme: settings.control_scheme, startingLevel: settings.starting_level, rng });
        startRun(state, rng);
        input.setScheme(settings.control_scheme);
        enterPlay();
        onAttemptStarted();
        loop.start();
    }

    /** Shows the playing screen and turns input on. @returns {void} */
    function enterPlay() {
        ui.hideBanner();
        ui.showScreen('playing');
        input.setEnabled(true);
        ui.setPauseEnabled(true);
    }

    /**
     * Pauses a live run and opens the pause dialog.
     * @param {boolean} isAuto - Tab hidden or window blurred.
     * @param {HTMLElement|null} opener
     * @returns {void}
     */
    function pauseNow(isAuto, opener) {
        if (!LIVE_PHASES.has(state.phase)) return;
        pauseGame(state);
        loop.stop();
        input.setEnabled(false);
        drawStill();
        pendingLeave = null;
        ui.hideLeaveConfirm();
        ui.setPauseText(strings.getPausedText(state.shotClockS, isAuto));
        ui.showScreen('paused', { isQuiet: true });
        ui.openDialog('pause-dialog', opener);
        ui.announce(isAuto ? strings.UX_STRINGS.announce.autoPaused : strings.UX_STRINGS.announce.paused);
    }

    /** Closes the pause dialog and continues. @returns {void} */
    function resumeNow() {
        if (state.phase !== 'paused') return;
        ui.closeDialog('pause-dialog', { focusTarget: null });
        resumeGame(state);
        enterPlay();
        ui.announce(strings.UX_STRINGS.announce.resumed);
        loop.start();
    }

    /**
     * Restart or Quit from the pause dialog; confirms first when a score would be lost.
     * @param {'restart'|'quit'} action @returns {void}
     */
    function requestLeave(action) {
        if (state.runScore > 0) {
            pendingLeave = action;
            ui.showLeaveConfirm(action, strings.getLeaveRunConfirmText(action, state.runScore));
            return;
        }
        leave(action);
    }

    /**
     * Leaves the run without recording anything (Q9).
     * @param {'restart'|'quit'} action @returns {void}
     */
    function leave(action) {
        pendingLeave = null;
        ui.hideLeaveConfirm();
        ui.closeDialog('pause-dialog', { focusTarget: null });
        if (action === 'restart') {
            playNewRun();
        } else {
            goToStart(document.getElementById('play-button'));
        }
    }

    /**
     * Back to the start screen with a fresh, unstarted game.
     * @param {HTMLElement|null} focusTarget
     * @returns {void}
     */
    function goToStart(focusTarget) {
        loop.stop();
        input.setEnabled(false);
        ui.setPauseEnabled(false);
        ui.hideBanner();
        state = createGameState({ scheme: settings.control_scheme, startingLevel: settings.starting_level, rng });
        ui.renderStart({ scheme: settings.control_scheme, level: settings.starting_level, best: currentBest(), isStorageBlocked });
        ui.setCanvasLabel(strings.UX_STRINGS.canvas.staticDescription);
        drawStill();
        ui.showScreen('start', { focusTarget });
    }

    /** From the round summary into the next round. @returns {void} */
    function nextRound() {
        if (state.phase !== 'round_summary') return;
        const events = startNextRound(state, rng);
        enterPlay();
        handleEvents(events);
        loop.start();
    }

    /* ---------- 6. Settings changes and saved data ---------- */

    /**
     * Saves settings and remembers whether the write failed.
     * @returns {void}
     */
    function saveSettings() {
        if (!store.saveSettings(settings)) isStorageBlocked = true;
    }

    /**
     * Applies settings everywhere (after load, change or reset).
     * @returns {void}
     */
    function applySettings() {
        audio.setMuted(!settings.is_sound_on);
        ui.setMuted(!settings.is_sound_on);
        ui.setMotion(resolveMotion());
        input.setScheme(settings.control_scheme);
        if (touch) touch.setScheme(settings.control_scheme);
        ui.renderHelp(settings.control_scheme);
        ui.renderSettings(settings, reducedQuery.matches);
        ui.renderStart({ scheme: settings.control_scheme, level: settings.starting_level, best: currentBest(), isStorageBlocked });
        if (state.phase === 'start') {
            state = createGameState({ scheme: settings.control_scheme, startingLevel: settings.starting_level, rng });
            drawStill();
        }
    }

    /**
     * Turns sound on or off, saves it, and says so.
     * @param {boolean} isOn @returns {void}
     */
    function setSound(isOn) {
        settings = { ...settings, is_sound_on: isOn };
        saveSettings();
        applySettings();
        ui.announce(isOn ? strings.UX_STRINGS.announce.soundOn : strings.UX_STRINGS.announce.soundOff);
    }

    ui.bind({
        onPlay: playNewRun,
        onPlayAgain: playNewRun,
        onHowTo: () => {
            startReturnFocus = document.getElementById('howto-button');
            ui.showScreen('howto');
        },
        onSettings: () => {
            startReturnFocus = document.getElementById('settings-button');
            ui.setResetStatus(false);
            ui.renderSettings(settings, reducedQuery.matches);
            ui.showScreen('settings');
        },
        onBackToStart: () => {
            const target = state.phase === 'game_over' ? document.getElementById('play-button') : startReturnFocus;
            startReturnFocus = null;
            goToStart(target);
        },
        onLevelChange: (level) => {
            settings = { ...settings, starting_level: level };
            saveSettings();
            applySettings();
        },
        onSchemeChange: (scheme) => {
            settings = { ...settings, control_scheme: scheme };
            saveSettings();
            applySettings();
            ui.announce(`Controls set to ${strings.SCHEME_NAMES[scheme]}.`);
        },
        onSoundChange: setSound,
        onMotionChange: (preference) => {
            settings = { ...settings, motion_preference: preference };
            saveSettings();
            applySettings();
            ui.announce(`Motion set to ${MOTION_NAMES[preference]}.`);
        },
        onReset: (opener) => ui.openDialog('reset-dialog', opener),
        onResetCancel: () => ui.closeDialog('reset-dialog'),
        onResetConfirm: () => {
            store.resetAll();
            isStorageBlocked = storage === null || store.didLastWriteFail;
            settings = validateSettings(null);
            bestScores = store.loadBestScores();
            applySettings();
            ui.closeDialog('reset-dialog');
            ui.setResetStatus(true);
            ui.announce(strings.UX_STRINGS.announce.resetDone);
        },
        onPause: (opener) => pauseNow(false, opener),
        onMute: () => setSound(!settings.is_sound_on),
        onResume: resumeNow,
        onPauseDialogCancel: () => {
            if (pendingLeave) { pendingLeave = null; ui.hideLeaveConfirm(true); } else resumeNow();
        },
        onRestart: () => requestLeave('restart'),
        onQuit: () => requestLeave('quit'),
        onLeaveConfirm: () => leave(pendingLeave ?? 'quit'),
        onLeaveCancel: () => { pendingLeave = null; ui.hideLeaveConfirm(true); },
        onNextRound: nextRound
    });

    /* ---------- 7. Keyboard shortcuts, auto-pause ---------- */

    window.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const isDialogOpen = ui.isDialogOpen('pause-dialog') || ui.isDialogOpen('reset-dialog');
        if (event.code === 'KeyM' && !event.repeat) {
            if (ui.isDialogOpen('reset-dialog')) return;
            event.preventDefault();
            setSound(!settings.is_sound_on);
            return;
        }
        if (event.code === 'KeyP' || event.code === 'Escape') {
            if (event.repeat) return;
            if (LIVE_PHASES.has(state.phase) && !isDialogOpen) {
                event.preventDefault();
                pauseNow(false, null);
            } else if (event.code === 'KeyP' && state.phase === 'paused' && !pendingLeave) {
                event.preventDefault();
                resumeNow();
            } else if (event.code === 'Escape' && !isDialogOpen &&
                (root.dataset.screen === 'howto' || root.dataset.screen === 'settings')) {
                event.preventDefault();
                const target = startReturnFocus;
                startReturnFocus = null;
                goToStart(target);
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') pauseNow(true, null);
    });
    window.addEventListener('blur', () => pauseNow(true, null));

    const onMotionQuery = () => {
        ui.setMotion(resolveMotion());
        ui.renderSettings(settings, reducedQuery.matches);
    };
    if (typeof reducedQuery.addEventListener === 'function') reducedQuery.addEventListener('change', onMotionQuery);

    // First paint: start screen over the rink, without stealing focus from the skip link.
    applySettings();
    ui.setPauseEnabled(false);
    ui.setCanvasLabel(strings.UX_STRINGS.canvas.staticDescription);
    drawStill();
    ui.showScreen('start', { isQuiet: true });
    root.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
