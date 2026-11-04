/* =============================================================
   src/core/ui-strings.js
   Every banner, announcement and label string (from UX_COPY.md).

   All player-facing words live here so they can be checked in Node
   without a browser, and so copy changes touch one file. The text
   matches .studio/design/UX_COPY.md (the "Rec" choice in each row).

   Sections in this file
     1. Names (schemes, levels, tiers, outcomes)
     2. Static copy (UX_STRINGS: page, start, how to play, settings,
        strip, pause, game over, announcements)
     3. Number formatting (score, shot clock)
     4. Banners and outcome announcements
     5. Round summary, game over and best score
     6. Scheme help tables
     7. Canvas text alternative
     8. Visual equivalents for sounds

   Troubleshooting
   - A banner shows "undefined": the outcome id is not one of the six
     in types.js (goal, save, wide, post_out, poke, time).
   - "No shot" never appears: the caller must pass
     { isShortOfNet: true } with outcome 'wide' (game.js puts
     isShortOfNet on the 'outcome' event when the puck stopped short).
   - Numbers show without commas: formatScore uses Intl.NumberFormat
     with 'en-US'; check the caller isn't building the string itself.
   - An e2e test can't find a string: copy it from here, not from the
     mockup; this file is the source of truth for run-time text.
   ============================================================= */

import {
    ATTEMPTS_PER_ROUND, GOALS_TO_ADVANCE, POINTS_PER_GOAL, DEKE_BONUS_POINTS, SHOT_CLOCK_S, REBOUND_WINDOW_S
} from './constants.js';

/** @typedef {import('./types.js').Outcome} Outcome */
/** @typedef {import('./types.js').ControlScheme} ControlScheme */
/** @typedef {import('./types.js').StartingLevel} StartingLevel */
/** @typedef {import('./types.js').TierName} TierName */
/** @typedef {import('./types.js').RoundState} RoundState */
/** @typedef {import('./types.js').BestScore} BestScore */
/** @typedef {import('./types.js').GameState} GameState */

/* ---------- 1. Names ---------- */

/** Display name for each control scheme. */
export const SCHEME_NAMES = Object.freeze({
    hold_charge: 'Hold to charge',
    aim_mouse: 'Aim with mouse',
    one_button: 'One button'
});

/** Display name for each starting level (Ladder is the Rookie start). */
export const LEVEL_NAMES = Object.freeze({
    ladder: 'Ladder',
    pro: 'Pro',
    all_star: 'All-Star'
});

/** Display name for each goalie tier. */
export const TIER_NAMES = Object.freeze({
    rookie: 'Rookie',
    pro: 'Pro',
    all_star: 'All-Star'
});

/** The six attempt outcomes, in a fixed order (for tests and loops). */
export const OUTCOMES = Object.freeze(/** @type {Outcome[]} */ (['goal', 'save', 'wide', 'post_out', 'poke', 'time']));

/* ---------- 2. Static copy ---------- */

/** Every fixed string from UX_COPY.md, grouped by screen. Run-time values come from the functions below. */
export const UX_STRINGS = Object.freeze({
    page: Object.freeze({
        title: 'Breakaway | Christian Rodriguez',
        metaDescription: 'Skate in alone on an AI goalie and try to score. A browser hockey game built with JavaScript and Canvas.',
        skipLink: 'Skip to the game',
        heading: 'Breakaway',
        noJavaScript: 'Breakaway needs JavaScript to run. Turn it on in your browser settings, then reload this page.',
        canvasUnsupported: "Your browser can't draw the rink. Try a current version of Chrome, Edge, Firefox or Safari."
    }),
    start: Object.freeze({
        title: 'Breakaway',
        tagline: 'Skate in alone and beat the goalie. Score 3 of 5 to reach the next round.',
        playButton: 'Play',
        levelLegend: 'Starting level',
        levelOptions: Object.freeze({
            ladder: 'Ladder. Starts at Rookie and gets harder each round.',
            pro: 'Pro',
            all_star: 'All-Star'
        }),
        levelHelp: Object.freeze({
            ladder: 'Ladder: Rookie for rounds 1–2, Pro for 3–4, All-Star from round 5.',
            pro: 'Pro: Pro for rounds 1–2, then All-Star.',
            all_star: 'All-Star: All-Star from round 1, getting sharper each round.',
            rookie: 'Rookie: same as Ladder.'
        }),
        controlsLabel: 'Controls',
        changeControls: 'Change controls',
        emptyBest: 'No best yet for this setup. Play a run to set one.',
        howToPlayButton: 'How to play',
        settingsButton: 'Settings',
        storageBlocked: "Best scores can't be saved in this browser window, so they reset when you leave. Private browsing often causes this."
    }),
    howTo: Object.freeze({
        heading: 'How to play',
        rules: Object.freeze([
            'Each round gives you 5 attempts. Score 3 goals to reach the next round.',
            'Each attempt starts at center ice with the puck. You have 8 seconds to shoot.',
            'A goal is worth 100 points. Fake out the goalie with a deke first and the goal is worth 150.',
            'Some saves leave a rebound. Grab it and shoot again within 1.5 seconds.',
            'The goalie gets better as the rounds go on. The run ends when 3 goals are out of reach.'
        ]),
        aimKeyboardOnlyNote: 'This scheme needs a mouse or touch screen. Playing with a keyboard only? Choose Hold to charge or One button in Settings.',
        playButton: 'Play',
        backButton: 'Back to start'
    }),
    settings: Object.freeze({
        heading: 'Settings',
        controlsLegend: 'Controls',
        schemeOptions: Object.freeze({
            hold_charge: 'Hold to charge. Hold Space to wind up, release to shoot. Deke with Shift.',
            aim_mouse: 'Aim with mouse. Click where you want to shoot. Needs a mouse or touch screen.',
            one_button: 'One button. Tap Space to shoot. No dekes.'
        }),
        soundLegend: 'Sound',
        soundSwitch: 'Sound on',
        soundHint: 'Plays a goal horn, saves, posts and stick sounds. Press M during play to turn it on or off.',
        motionLegend: 'Motion',
        motionOptions: Object.freeze({
            system: 'Follow my device setting',
            reduce: 'Reduce motion. The goal light stays steady instead of flashing.',
            full: 'Full motion'
        }),
        savedDataLegend: 'Saved data',
        savedDataExplainer: 'Best scores and settings are saved in this browser on this device only. Nothing is sent anywhere.',
        resetButton: 'Reset saved data',
        resetConfirm: "Reset saved data? This clears your best scores and settings on this device. It can't be undone.",
        resetConfirmButton: 'Reset saved data',
        resetCancelButton: 'Keep my data',
        afterReset: 'Saved data cleared. Settings are back to their defaults.',
        backButton: 'Back to start'
    }),
    strip: Object.freeze({
        regionLabel: 'Scoreboard',
        shotClockLabel: 'Shot clock',
        pauseButton: 'Pause game',
        pauseTooltip: 'Pause (P)',
        muteOff: 'Turn sound off',
        muteOn: 'Turn sound on',
        bestEmpty: 'Best —',
        bestEmptyAccessible: 'No best yet',
        stick: 'Skate',
        stickHint: 'Drag to skate',
        shoot: 'Shoot',
        shootHoldHint: 'Hold, then release',
        deke: 'Deke',
        laptopHelpHeading: 'Controls',
        laptopHelpFootnote: 'Change controls in Settings on the start screen.'
    }),
    pause: Object.freeze({
        heading: 'Paused',
        resumeButton: 'Resume',
        restartButton: 'Restart run',
        quitButton: 'Quit to start screen',
        keepPlayingButton: 'Keep playing',
        quitRunButton: 'Quit run'
    }),
    gameOver: Object.freeze({
        heading: 'Run over',
        newBestPlate: 'New best',
        storageBlocked: "This score can't be saved in this browser window.",
        playAgainButton: 'Play again',
        backButton: 'Back to start'
    }),
    announce: Object.freeze({
        rebound: 'Rebound. Shoot again now.',
        clockWarning: '3 seconds.',
        paused: 'Paused.',
        resumed: 'Resumed.',
        autoPaused: 'Paused because you left the game.',
        soundOff: 'Sound off.',
        soundOn: 'Sound on.',
        resetDone: 'Saved data cleared.'
    }),
    canvas: Object.freeze({
        label: 'Hockey rink',
        staticDescription: 'Top-down view of a hockey rink from the end boards to center ice. The net and the goalie are at the top, the skater starts at the center-ice dot at the bottom.'
    })
});

/* ---------- 3. Number formatting ---------- */

const SCORE_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Formats points with a thousands separator ("1,250").
 * @param {number} points @returns {string}
 */
export function formatScore(points) {
    return SCORE_FORMAT.format(Number.isFinite(points) ? points : 0);
}

/**
 * Formats the shot clock with one decimal, never negative ("6.4"). Rounds down so "0.0" shows
 * only when time is really up.
 * @param {number} seconds @returns {string}
 */
export function formatShotClock(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    // Small epsilon so 6.4 stored as 6.3999999 still shows 6.4.
    return (Math.floor(safe * 10 + 1e-6) / 10).toFixed(1);
}

/* ---------- 4. Banners and outcome announcements ---------- */

/** Banner title and sub line for each outcome (UX_COPY section 6). */
const BANNERS = Object.freeze({
    goal: { title: 'Goal!', detail: `+${POINTS_PER_GOAL}` },
    save: { title: 'Save', detail: 'The goalie stops it.' },
    wide: { title: 'Wide', detail: 'Missed the net.' },
    post_out: { title: 'Post and out', detail: 'So close.' },
    poke: { title: 'Poke check', detail: 'The goalie took the puck.' },
    time: { title: 'Time', detail: 'The shot clock ran out.' }
});

/**
 * Banner text for an attempt outcome.
 * @param {Outcome} outcome
 * @param {{ isShortOfNet?: boolean, hasDekeBonus?: boolean, isReboundExpired?: boolean, points?: number }} [options]
 *   isShortOfNet: a `wide` where the puck stopped before the net → "No shot".
 *   hasDekeBonus: a goal worth the deke bonus → "+150 with deke bonus".
 *   isReboundExpired: a `save` because the rebound window ran out → "No rebound shot in time."
 * @returns {{ title: string, detail: string }}
 */
export function getBannerText(outcome, { isShortOfNet = false, hasDekeBonus = false, isReboundExpired = false, points } = {}) {
    if (outcome === 'wide' && isShortOfNet) {
        return { title: 'No shot', detail: 'The puck stopped before the net.' };
    }
    if (outcome === 'goal') {
        const value = points ?? (hasDekeBonus ? POINTS_PER_GOAL + DEKE_BONUS_POINTS : POINTS_PER_GOAL);
        return { title: 'Goal!', detail: hasDekeBonus ? `+${formatScore(value)} with deke bonus` : `+${formatScore(value)}` };
    }
    if (outcome === 'save' && isReboundExpired) {
        return { title: 'Save', detail: 'No rebound shot in time.' };
    }
    const banner = BANNERS[outcome];
    return banner ? { ...banner } : { title: '', detail: '' };
}

/**
 * Banner for a rebound chance (not an attempt outcome).
 * @returns {{ title: string, detail: string }}
 */
export function getReboundBannerText() {
    return { title: 'Rebound', detail: `Shoot again, ${REBOUND_WINDOW_S} seconds.` };
}

/** Announcements for the five no-goal outcomes (UX_COPY section 10). */
const MISS_ANNOUNCEMENTS = Object.freeze({
    save: 'Save. No goal.',
    wide: 'Wide. No goal.',
    post_out: 'Post and out. No goal.',
    poke: 'Poke check. The goalie took the puck. No goal.',
    time: 'Time. The shot clock ran out. No goal.'
});

/**
 * The aria-live line after an attempt ends.
 * @param {Outcome} outcome
 * @param {RoundState|null} round - The current round (used for its points when no run score is given).
 * @param {number} attemptIndex - 0-based attempt that just ended (kept for the contract; not spoken).
 * @param {number} goals - Goals this round (kept for the contract; not spoken).
 * @param {{ points?: number, runScore?: number, isShortOfNet?: boolean }} [extra]
 *   points: what this goal was worth (150 means the deke bonus); runScore: the score after it.
 * @returns {string}
 */
export function getOutcomeAnnouncement(outcome, round, attemptIndex, goals, { points = POINTS_PER_GOAL, runScore, isShortOfNet = false } = {}) {
    if (outcome === 'goal') {
        const score = runScore ?? (round ? round.points : points);
        const lead = points > POINTS_PER_GOAL ? 'Goal with deke bonus.' : 'Goal.';
        return `${lead} Plus ${formatScore(points)}. Score ${formatScore(score)}.`;
    }
    if (outcome === 'wide' && isShortOfNet) return 'No shot. No goal.';
    return MISS_ANNOUNCEMENTS[outcome] ?? '';
}

/**
 * The aria-live line when an attempt starts ("Attempt 2 of 5. 8 seconds.").
 * @param {number} attemptIndex - 0-based. @returns {string}
 */
export function getAttemptStartAnnouncement(attemptIndex) {
    return `Attempt ${attemptIndex + 1} of ${ATTEMPTS_PER_ROUND}. ${SHOT_CLOCK_S} seconds.`;
}

/* ---------- 5. Round summary, game over and best score ---------- */

/**
 * Heading, line and button for the round summary (UX_COPY section 7).
 * @param {RoundState} round - The round that just ended.
 * @param {boolean} isCleared
 * @param {TierName|null} nextTierName - Next round's tier (only used when cleared).
 * @returns {{ title: string, detail: string, button: string }}
 */
export function getRoundSummaryText(round, isCleared, nextTierName) {
    const n = round.number;
    const played = round.attemptOutcomes.length;
    if (isCleared) {
        const isSameTier = nextTierName === round.tier.tierName;
        const next = isSameTier
            ? 'Same goalie, one more round.'
            : `Next up: ${TIER_NAMES[nextTierName ?? 'all_star']} goalie.`;
        return { title: `Round ${n} cleared`, detail: `${round.goals} of ${ATTEMPTS_PER_ROUND}. ${next}`, button: `Start round ${n + 1}` };
    }
    if (played < ATTEMPTS_PER_ROUND) {
        const left = ATTEMPTS_PER_ROUND - played;
        return {
            title: `Round ${n} over`,
            detail: `${round.goals} of ${played} so far with ${left} left. ${GOALS_TO_ADVANCE} goals are out of reach.`,
            button: 'See results'
        };
    }
    return { title: `Round ${n} failed`, detail: `${round.goals} of ${ATTEMPTS_PER_ROUND}. You needed ${GOALS_TO_ADVANCE}.`, button: 'See results' };
}

/**
 * The aria-live line for a round result.
 * @param {RoundState} round @param {boolean} isCleared @param {TierName|null} nextTierName @returns {string}
 */
export function getRoundAnnouncement(round, isCleared, nextTierName) {
    if (isCleared) {
        return `Round ${round.number} cleared. ${round.goals} of ${ATTEMPTS_PER_ROUND}. Next up, ${TIER_NAMES[nextTierName ?? round.tier.tierName]} goalie.`;
    }
    return `Round ${round.number} failed. ${round.goals} of ${ATTEMPTS_PER_ROUND}. Run over.`;
}

/**
 * @typedef {Pick<GameState, 'round'|'runScore'|'runGoals'|'roundsCleared'>} RunSummary
 * A GameState works as is.
 */

/**
 * Game-over heading, line and stat rows (UX_COPY section 9).
 * @param {RunSummary} run
 * @returns {{ title: string, detail: string, rows: Array<{ label: string, value: string }> }}
 */
export function getGameOverText(run) {
    const { round } = run;
    return {
        title: UX_STRINGS.gameOver.heading,
        detail: `Round ${round.number} failed. ${round.goals} of ${ATTEMPTS_PER_ROUND}.`,
        rows: [
            { label: 'Final score', value: formatScore(run.runScore) },
            { label: 'Rounds cleared', value: String(run.roundsCleared) },
            { label: 'Goals', value: String(run.runGoals) }
        ]
    };
}

/** The aria-live line at game over. @param {RunSummary} run @returns {string} */
export function getGameOverAnnouncement(run) {
    return `Final score ${formatScore(run.runScore)}. Rounds cleared ${run.roundsCleared}. Goals ${run.runGoals}.`;
}

/** The aria-live line for a new best. @param {number} score @returns {string} */
export function getNewBestAnnouncement(score) {
    return `New best: ${formatScore(score)}.`;
}

/**
 * Game-over line about the stored best.
 * @param {number} runScore @param {BestScore|null} best - The best after recording this run.
 * @param {boolean} isNewBest @param {ControlScheme} scheme @param {StartingLevel} level
 * @returns {string}
 */
export function getGameOverBestText(runScore, best, isNewBest, scheme, level) {
    if (isNewBest) return `Your best for ${SCHEME_NAMES[scheme]}, ${LEVEL_NAMES[level]}.`;
    if (!best) return UX_STRINGS.start.emptyBest;
    return `Best ${formatScore(best.score)}. ${formatScore(Math.max(0, best.score - runScore))} to go.`;
}

/**
 * The start-screen best line for the chosen scheme and level.
 * @param {BestScore|null} best @param {ControlScheme} scheme @param {StartingLevel} level
 * @returns {string} "No best yet…" or "Best for Hold to charge, Ladder: 1,250. Reached round 3, 9 goals."
 */
export function getStartBestText(best, scheme, level) {
    if (!best) return UX_STRINGS.start.emptyBest;
    const goalsWord = best.goals === 1 ? 'goal' : 'goals';
    return `Best for ${SCHEME_NAMES[scheme]}, ${LEVEL_NAMES[level]}: ${formatScore(best.score)}. ` +
        `Reached round ${best.rounds_cleared + 1}, ${best.goals} ${goalsWord}.`;
}

/**
 * The paused-dialog line.
 * @param {number} shotClockS @param {boolean} [isAuto] - Paused because the tab was hidden or blurred.
 * @returns {string}
 */
export function getPausedText(shotClockS, isAuto = false) {
    const line = `Shot clock stopped at ${formatShotClock(shotClockS)} seconds.`;
    return isAuto ? `${UX_STRINGS.announce.autoPaused} ${line}` : line;
}

/**
 * Inline confirm for Restart or Quit when a score would be lost.
 * @param {'restart'|'quit'} action @param {number} runScore @returns {string}
 */
export function getLeaveRunConfirmText(action, runScore) {
    const lead = action === 'restart' ? 'Restart this run?' : 'Quit to the start screen?';
    return `${lead} Your score of ${formatScore(runScore)} won't be saved.`;
}

/* ---------- 6. Scheme help tables ---------- */

const PAUSE_ROW = Object.freeze({ action: 'Pause', keys: 'P or Esc', touch: 'Pause button' });
const SOUND_ROW = Object.freeze({ action: 'Sound on or off', keys: 'M', touch: 'Sound button' });
const SKATE_ROW = Object.freeze({ action: 'Skate', keys: 'Arrow keys or W A S D', touch: 'Drag the stick on the left' });

const SCHEME_HELP = Object.freeze({
    hold_charge: {
        summary: 'Hold Space to wind up, let go to shoot. Shift fakes the goalie.',
        rows: [
            SKATE_ROW,
            { action: 'Shoot', keys: "Hold Space to charge, release to shoot where you're facing. A longer hold shoots harder but less accurately.", touch: 'Hold Shoot, release to shoot' },
            { action: 'Deke', keys: 'Shift', touch: 'Deke button' },
            PAUSE_ROW, SOUND_ROW
        ]
    },
    aim_mouse: {
        summary: 'Click to shoot at the pointer. Shots are accurate but always the same speed.',
        rows: [
            SKATE_ROW,
            { action: 'Shoot', keys: 'Click where you want the puck to go', touch: 'Tap the rink where you want the puck to go' },
            { action: 'Deke', keys: 'Shift or right-click', touch: 'Deke button' },
            PAUSE_ROW, SOUND_ROW
        ]
    },
    one_button: {
        summary: "Tap Space to shoot where you're facing. No charging, no dekes.",
        rows: [
            SKATE_ROW,
            { action: 'Shoot', keys: "Tap Space to shoot where you're facing", touch: 'Shoot button' },
            { action: 'Deke', keys: 'Not in this scheme', touch: 'Not in this scheme' },
            PAUSE_ROW, SOUND_ROW
        ]
    }
});

/**
 * The controls table for one scheme (How to play and the laptop help panel).
 * @param {ControlScheme} scheme
 * @returns {{ name: string, summary: string, rows: Array<{ action: string, keys: string, touch: string }> }}
 */
export function getSchemeHelp(scheme) {
    const help = SCHEME_HELP[scheme] ?? SCHEME_HELP.hold_charge;
    const name = SCHEME_NAMES[scheme] ?? SCHEME_NAMES.hold_charge;
    return { name, summary: help.summary, rows: help.rows.map((row) => ({ ...row })) };
}

/* ---------- 7. Canvas text alternative ---------- */

/**
 * The canvas description for the current state (updated at attempt start and end, not per frame).
 * @param {GameState} state @returns {string}
 */
export function getCanvasLabel(state) {
    const base = UX_STRINGS.canvas.staticDescription;
    if (state.phase === 'result_banner' && state.lastOutcome) {
        const title = getBannerText(state.lastOutcome).title.replace(/!$/, '');
        const nextAttempt = state.attemptIndex + 2;
        const tail = nextAttempt <= ATTEMPTS_PER_ROUND ? ` The skater is back at center ice for attempt ${nextAttempt}.` : '';
        return `${base} ${title}.${tail}`;
    }
    if (state.phase === 'playing' || state.phase === 'rebound_window' || state.phase === 'paused') {
        const tier = TIER_NAMES[state.round.tier.tierName];
        return `${base} Round ${state.round.number}, attempt ${state.attemptIndex + 1} of ${ATTEMPTS_PER_ROUND}. ` +
            `The skater has the puck at center ice. The ${tier} goalie is in the crease. Shot clock ${SHOT_CLOCK_S} seconds.`;
    }
    return base;
}

/* ---------- 8. Visual equivalents for sounds ---------- */

/** What the player sees for each sound, so muted or deaf players miss nothing (AC-14). */
export const VISUAL_EQUIVALENTS = Object.freeze({
    stickhandle: 'The puck moves side to side on the stick.',
    shot: 'The puck leaves the stick with a short motion trail.',
    post: 'The post flashes and the puck bounces off it.',
    save: 'The Save banner shows and the goalie holds or kicks out the puck.',
    goal: 'The goal light turns on above the net and the Goal banner shows.',
    poke: 'The goalie lunges and the Poke check banner shows.'
});
