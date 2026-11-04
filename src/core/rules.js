/* =============================================================
   src/core/rules.js
   Run, round and attempt state machine.

   A run is rounds of 5 attempts. Score 3 goals in a round to reach
   the next one; the run ends as soon as 3 goals are out of reach.
   ARCHITECTURE §7 has the phase diagram this file follows:

     start → playing ⇄ rebound_window
     playing / rebound_window → result_banner (an attempt ended)
     result_banner → playing (next attempt) | round_summary | game_over
     round_summary → playing (startNextRound)
     any live phase ⇄ paused (resumePhase remembers where it was)

   Sections in this file
     1. Small helpers (new round, reset an attempt)
     2. Creating and starting a run
     3. Deciding an attempt's outcome (resolveStepOutcome)
     4. Ending an attempt and moving on
     5. Pause and resume
     6. Markers and the "round lost" test

   Troubleshooting
   - The run ends after only 3 attempts: that's the early end; with
     0 goals after 3 attempts, 3 goals are out of reach.
   - A goal that touched the goalie first counts as a save: contacts
     are judged in time order and the first decisive one wins (Q15).
   - The clock hits 0 the same step as a goal and shows Time: the
     caller must pass contacts and isClockExpired together so physics
     can win (Q4).
   ============================================================= */

import {
    SHOT_CLOCK_S, BANNER_S, ATTEMPTS_PER_ROUND, GOALS_TO_ADVANCE, CONTROL_SCHEMES, STARTING_LEVELS
} from './constants.js';
import { getTierForRound } from './difficulty.js';
import { getGoalPoints } from './scoring.js';
import { createGoalie } from './goalie.js';
import { createSkater } from './skater.js';
import { createPuck } from './puck.js';

/** @typedef {import('./types.js').GameState} GameState */
/** @typedef {import('./types.js').RoundState} RoundState */
/** @typedef {import('./types.js').Outcome} Outcome */
/** @typedef {import('./types.js').Phase} Phase */
/** @typedef {import('./types.js').MarkerState} MarkerState */
/** @typedef {import('./types.js').GameEvent} GameEvent */
/** @typedef {import('./types.js').RandomFn} RandomFn */
/** @typedef {import('./types.js').ControlScheme} ControlScheme */
/** @typedef {import('./types.js').StartingLevel} StartingLevel */

/**
 * What else happened this step, besides puck contacts.
 * @typedef {object} StepFlags
 * @property {boolean} [didCrossGoalLineWide] - The puck crossed the goal line outside the posts.
 * @property {boolean} [didStop] - A shot or loose puck slowed below the stop speed.
 * @property {boolean} [didLeaveView] - The puck left the visible box.
 * @property {boolean} [didPoke] - The goalie poke-checked the carried puck.
 * @property {boolean} [isReboundExpired] - The rebound window ran out this step.
 * @property {boolean} [isClockExpired] - The shot clock reached 0 this step.
 */

/** Phases where the game is live and can be paused. */
const LIVE_PHASES = Object.freeze(/** @type {Phase[]} */ (['playing', 'rebound_window', 'result_banner']));

/* ---------- 1. Small helpers ---------- */

/**
 * A fresh round.
 * @param {StartingLevel} startingLevel @param {number} number @returns {RoundState}
 */
function createRound(startingLevel, number) {
    return { number, attemptOutcomes: [], goals: 0, points: 0, tier: getTierForRound(startingLevel, number) };
}

/**
 * Puts the skater, puck and goalie back for a new attempt and starts the clock. *Mutates* state.
 * @param {GameState} state @param {RandomFn} rng @returns {GameEvent[]} `attempt_started`.
 */
function resetAttempt(state, rng) {
    state.skater = createSkater();
    state.puck = createPuck(state.skater);
    state.goalie = createGoalie(state.round.tier, rng);
    state.shotClockS = SHOT_CLOCK_S;
    state.bannerLeftS = 0;
    state.reboundLeftS = 0;
    state.hasUsedRebound = false;
    state.didGoalieBiteThisAttempt = false;
    state.phase = 'playing';
    state.resumePhase = null;
    return [{ type: 'attempt_started' }];
}

/* ---------- 2. Creating and starting a run ---------- */

/**
 * A new game on the start screen (phase 'start'). Round 1 is set up so the start screen can draw it.
 * @param {{ scheme: ControlScheme, startingLevel: StartingLevel, rng: RandomFn }} options
 * @returns {GameState}
 * @throws {TypeError} For an unknown scheme or starting level (a programmer error, not game input).
 */
export function createGameState({ scheme, startingLevel, rng }) {
    if (!CONTROL_SCHEMES.includes(scheme)) throw new TypeError(`createGameState: unknown scheme ${scheme}`);
    if (!STARTING_LEVELS.includes(startingLevel)) throw new TypeError(`createGameState: unknown startingLevel ${startingLevel}`);
    if (typeof rng !== 'function') throw new TypeError('createGameState: rng must be a function');
    const round = createRound(startingLevel, 1);
    const skater = createSkater();
    return {
        phase: 'start',
        resumePhase: null,
        scheme,
        startingLevel,
        round,
        attemptIndex: 0,
        shotClockS: SHOT_CLOCK_S,
        bannerLeftS: 0,
        reboundLeftS: 0,
        hasUsedRebound: false,
        didGoalieBiteThisAttempt: false,
        lastOutcome: null,
        wasLastShotShort: false,
        runScore: 0,
        runGoals: 0,
        roundsCleared: 0,
        skater,
        puck: createPuck(skater),
        goalie: createGoalie(round.tier, rng),
        stepCount: 0
    };
}

/**
 * Starts (or restarts) a run: round 1, attempt 1, phase 'playing'. *Mutates and returns* state.
 * Returns the state, not events: the caller announces this first attempt itself
 * (ui-strings getAttemptStartAnnouncement(0)). Later attempts get an `attempt_started`
 * event from advanceAfterBanner and startNextRound.
 * @param {GameState} state @param {RandomFn} rng @returns {GameState}
 */
export function startRun(state, rng) {
    state.round = createRound(state.startingLevel, 1);
    state.attemptIndex = 0;
    state.runScore = 0;
    state.runGoals = 0;
    state.roundsCleared = 0;
    state.lastOutcome = null;
    state.wasLastShotShort = false;
    state.stepCount = 0;
    resetAttempt(state, rng);
    return state;
}

/* ---------- 3. Deciding an attempt's outcome ---------- */

/**
 * The outcome decided this step, or null when the attempt goes on. Pure.
 * Precedence: the earliest decisive contact (goalie → save, goal → goal), then a poke, then a
 * wide crossing or a stopped/escaped puck (post_out if it hit a post this attempt), then the
 * rebound window running out (save), then the shot clock (time). Physics beats Time (Q4).
 * @param {GameState} state - Read for `puck.hasHitPost`.
 * @param {Array<{ kind: 'post'|'goalie'|'goal'|'board', tStep: number }>} contacts - In time order.
 * @param {StepFlags} [flags]
 * @returns {Outcome|null}
 */
export function resolveStepOutcome(state, contacts, flags = {}) {
    let hasHitPost = Boolean(state.puck && state.puck.hasHitPost);
    const ordered = [...(contacts ?? [])].sort((a, b) => a.tStep - b.tStep);
    for (const contact of ordered) {
        if (contact.kind === 'post') hasHitPost = true;
        if (contact.kind === 'goalie') return 'save';
        if (contact.kind === 'goal') return 'goal';
    }
    if (flags.didPoke) return 'poke';
    if (flags.didCrossGoalLineWide || flags.didStop || flags.didLeaveView) return hasHitPost ? 'post_out' : 'wide';
    if (flags.isReboundExpired) return 'save';
    if (flags.isClockExpired) return 'time';
    return null;
}

/* ---------- 4. Ending an attempt and moving on ---------- */

/**
 * Records an attempt's outcome and shows the result banner. *Mutates* state.
 * Goals add 100 points, or 150 when the goalie bit on a deke earlier in this attempt.
 * @param {GameState} state
 * @param {Outcome} outcome
 * @param {{ isShortOfNet?: boolean }} [options] - isShortOfNet: a 'wide' where the puck never reached the net.
 * @returns {GameEvent[]} 'goal' / 'wide' / 'time' (for sound and visuals) when they apply, then 'outcome'.
 */
export function finishAttempt(state, outcome, { isShortOfNet = false } = {}) {
    const isShort = outcome === 'wide' && isShortOfNet;
    let points = 0;
    if (outcome === 'goal') {
        points = getGoalPoints(state.didGoalieBiteThisAttempt);
        state.round.goals += 1;
        state.round.points += points;
        state.runGoals += 1;
        state.runScore += points;
    }
    state.round.attemptOutcomes.push(outcome);
    state.lastOutcome = outcome;
    state.wasLastShotShort = isShort;
    state.phase = 'result_banner';
    state.resumePhase = null;
    state.bannerLeftS = BANNER_S;
    state.reboundLeftS = 0;
    /** @type {GameEvent[]} */
    const events = [];
    if (outcome === 'goal' || outcome === 'wide' || outcome === 'time') events.push({ type: outcome });
    events.push({ type: 'outcome', outcome, points, isShortOfNet: isShort });
    return events;
}

/**
 * After the banner: the next attempt, the round summary (after attempt 5 of a cleared round),
 * or game over as soon as 3 goals are out of reach. *Mutates* state.
 * @param {GameState} state @param {RandomFn} rng
 * @returns {GameEvent[]}
 */
export function advanceAfterBanner(state, rng) {
    if (state.phase !== 'result_banner') return [];
    const played = state.round.attemptOutcomes.length;
    if (isRoundLost(state.round.goals, played)) {
        state.phase = 'game_over';
        state.bannerLeftS = 0;
        return [{ type: 'round_failed' }, { type: 'run_over' }];
    }
    if (played >= ATTEMPTS_PER_ROUND) {
        state.roundsCleared += 1;
        state.phase = 'round_summary';
        state.bannerLeftS = 0;
        return [{ type: 'round_cleared' }];
    }
    state.attemptIndex = played;
    return resetAttempt(state, rng);
}

/**
 * From the round summary into attempt 1 of the next round (new tier from the schedule). *Mutates* state.
 * @param {GameState} state @param {RandomFn} rng
 * @returns {GameEvent[]} `attempt_started`, or [] outside 'round_summary'.
 */
export function startNextRound(state, rng) {
    if (state.phase !== 'round_summary') return [];
    state.round = createRound(state.startingLevel, state.round.number + 1);
    state.attemptIndex = 0;
    return resetAttempt(state, rng);
}

/* ---------- 5. Pause and resume ---------- */

/**
 * Pauses a live phase (playing, rebound window, result banner). No-op elsewhere. *Mutates* state.
 * @param {GameState} state @returns {GameEvent[]} `paused`, or [].
 */
export function pauseGame(state) {
    if (!LIVE_PHASES.includes(state.phase)) return [];
    state.resumePhase = state.phase;
    state.phase = 'paused';
    return [{ type: 'paused' }];
}

/**
 * Returns to the phase that was paused. No-op unless paused. *Mutates* state.
 * @param {GameState} state @returns {GameEvent[]} `resumed`, or [].
 */
export function resumeGame(state) {
    if (state.phase !== 'paused') return [];
    state.phase = state.resumePhase ?? 'playing';
    state.resumePhase = null;
    return [{ type: 'resumed' }];
}

/* ---------- 6. Markers and the "round lost" test ---------- */

/**
 * The five attempt markers for the score strip.
 * @param {RoundState} round @param {number} attemptIndex - 0-based current attempt.
 * @returns {MarkerState[]} Length 5: 'goal' / 'miss' for played attempts, 'current', then 'pending'.
 */
export function getMarkerStates(round, attemptIndex) {
    /** @type {MarkerState[]} */
    const markers = [];
    for (let i = 0; i < ATTEMPTS_PER_ROUND; i += 1) {
        const outcome = round.attemptOutcomes[i];
        if (outcome) markers.push(outcome === 'goal' ? 'goal' : 'miss');
        else if (i === attemptIndex) markers.push('current');
        else markers.push('pending');
    }
    return markers;
}

/**
 * Whether 3 goals are now out of reach this round.
 * @param {number} goals - Goals so far this round. @param {number} attemptsPlayed
 * @returns {boolean} True when goals + attempts left < GOALS_TO_ADVANCE.
 */
export function isRoundLost(goals, attemptsPlayed) {
    return goals + (ATTEMPTS_PER_ROUND - attemptsPlayed) < GOALS_TO_ADVANCE;
}
