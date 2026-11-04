// Shared harness for the statistical AI-tier suite (TEST_PLAN section 6). Not a test file.
// Everything that depends on how the core modules are called lives here, so if a contract
// detail changes there is one file to fix.
//
// Sections
//   1. Seeds and tolerance math
//   2. Tier helpers
//   3. Goalie-level trials (deke bite, poke check)
//   4. Game-level scripted shots (save, rebound, goal rates)
//
// Troubleshooting
// - "not implemented: ..." : the core module named in the message is still a stub; the suite
//   cannot run until that slice lands.
// - A trial reports "deke roll never happened": the goalie did not emit goalie_bit or goalie_read
//   for a deke at the fixed spot. Check SETTLE_STEPS and the spot in dekeTrial().
import { createRng } from '../../src/core/random.js';
import { getTierForRound } from '../../src/core/difficulty.js';
import { createGoalie, updateGoalie } from '../../src/core/goalie.js';
import { createSkater } from '../../src/core/skater.js';
import { createPuck, carryPuck } from '../../src/core/puck.js';
import { createGameState, startRun } from '../../src/core/rules.js';
import { stepGame } from '../../src/core/game.js';
import {
    FIXED_STEP_S, CENTER_X_FT, GOAL_LINE_Y_FT, CHARGE_FULL_S, POKE_CHECK_INTERVAL_S
} from '../../src/core/constants.js';
import { countingRng } from '../helpers/rng.js';

/* ---------- 1. Seeds and tolerance math ---------- */

/** Mixes a base seed, a stream number and a trial number into a well-spread 32-bit seed. */
export function subSeed(baseSeed, stream, trial) {
    let h = Math.imul(baseSeed + 1, 0x9e3779b1);
    h = Math.imul(h ^ (stream + 0x7f4a7c15), 0x85ebca6b);
    h = Math.imul(h ^ (trial + 0x165667b1), 0xc2b2ae35);
    return (h ^ (h >>> 15)) >>> 0;
}

/** Four-sigma half-width for an observed rate with true probability p over n trials. */
export function fourSigma(p, n) {
    return 4 * Math.sqrt(p * (1 - p) / n);
}

/** Standard error of a rate. */
export function sigma(p, n) {
    return Math.sqrt(p * (1 - p) / n);
}

/** One-line description of a rate check, used in assertion messages. */
export function describeRate(label, observed, expected, n) {
    return `${label}: observed ${observed.toFixed(4)}, expected ${expected.toFixed(4)} +/- ${fourSigma(expected, n).toFixed(4)} over ${n} trials`;
}

/* ---------- 2. Tier helpers ---------- */

export const TIER_NAMES = Object.freeze(['rookie', 'pro', 'all_star']);
const START_LEVEL_FOR_TIER = Object.freeze({ rookie: 'ladder', pro: 'pro', all_star: 'all_star' });

/** TierForRound for round 1 of the start level that begins at this tier (improvement 0). */
export function tierOf(tierName) {
    return getTierForRound(START_LEVEL_FOR_TIER[tierName], 1);
}

/* ---------- 3. Goalie-level trials ---------- */

const NO_INTENT = Object.freeze({
    moveX: 0, moveY: 0, isShootHeld: false, shootPressed: false,
    shootReleased: false, aimPoint: null, dekePressed: false, dekeSide: 0
});

function place(skater, x, y) {
    skater.position = { x, y };
    skater.previousPosition = { x, y };
    skater.velocity = { x: 0, y: 0 };
}

/** Skater past the blue line with the puck, so the goalie is tracking. */
function carryingSkater(x, y) {
    const skater = createSkater();
    place(skater, x, y);
    const puck = createPuck(skater);
    carryPuck(puck, skater);
    return { skater, puck };
}

const SETTLE_STEPS = 30;

/**
 * One deke against a fresh goalie. Returns 'bite', 'read' or throws when the goalie rolled neither.
 * @param {string} tierName @param {number} seed
 */
export function dekeTrial(tierName, seed) {
    const rng = createRng(seed);
    const tier = tierOf(tierName);
    const goalie = createGoalie(tier, rng);
    const { skater, puck } = carryingSkater(CENTER_X_FT + 6, 40);
    for (let i = 0; i < SETTLE_STEPS; i += 1) {
        updateGoalie(goalie, { puck, skater, isShotThisStep: false, didDekeThisStep: false }, tier, rng, FIXED_STEP_S);
    }
    skater.dekeSide = 1;
    skater.dekeTimeLeftS = 0.18;
    const { events } = updateGoalie(goalie, { puck, skater, isShotThisStep: false, didDekeThisStep: true }, tier, rng, FIXED_STEP_S);
    const types = events.map((e) => e.type);
    const bit = types.includes('goalie_bit');
    const read = types.includes('goalie_read');
    if (bit === read) {
        throw new Error(`deke roll never happened or happened twice (events: ${JSON.stringify(types)}, mode: ${goalie.mode})`);
    }
    return bit ? 'bite' : 'read';
}

/** Steps in the window used to measure one poke roll: shorter than the roll interval, longer than the lunge. */
export const POKE_WINDOW_STEPS = Math.floor((POKE_CHECK_INTERVAL_S * 0.9) / FIXED_STEP_S);
/** Most random draws one 1-second approach may use (a per-step draw would be 120). */
export const MAX_DRAWS_PER_APPROACH = 16;

/**
 * One approach: the skater, carrying the puck, appears 4 ft in front of a settled goalie and stays there.
 * Returns whether the goalie poke-checked within the window and how many random numbers were drawn.
 */
export function pokeTrial(tierName, seed) {
    const base = createRng(seed);
    const rng = countingRng(base);
    const tier = tierOf(tierName);
    const goalie = createGoalie(tier, rng);
    const far = carryingSkater(CENTER_X_FT, 60);
    for (let i = 0; i < SETTLE_STEPS; i += 1) {
        updateGoalie(goalie, { puck: far.puck, skater: far.skater, isShotThisStep: false, didDekeThisStep: false }, tier, rng, FIXED_STEP_S);
    }
    const drawsBefore = rng.calls;
    const near = carryingSkater(goalie.position.x, goalie.position.y + 4);
    let didPoke = false;
    for (let i = 0; i < POKE_WINDOW_STEPS && !didPoke; i += 1) {
        const { events } = updateGoalie(goalie, { puck: near.puck, skater: near.skater, isShotThisStep: false, didDekeThisStep: false }, tier, rng, FIXED_STEP_S);
        didPoke = events.some((e) => e.type === 'poke');
    }
    return { didPoke, draws: rng.calls - drawsBefore };
}

/* ---------- 4. Game-level scripted shots ---------- */

/** Five lateral targets (feet from the post center line), two charge levels, two release distances. */
export const SHOT_SET = Object.freeze(
    [-2.2, -1.1, 0, 1.1, 2.2].flatMap((targetDx) =>
        ['slow', 'fast'].flatMap((speed) =>
            [30, 24].map((releaseY) => Object.freeze({ targetDx, speed, releaseY }))))
);

/** Steps the skater holds the shoot control for each charge level. */
const HOLD_STEPS = Object.freeze({ slow: 0, fast: Math.round(0.75 * CHARGE_FULL_S / FIXED_STEP_S) });
const MAX_ATTEMPT_STEPS = Math.ceil(10 / FIXED_STEP_S);
const SHOT_SETTLE_STEPS = 48;

/**
 * Plays one scripted shot from a standstill against a goalie of the given tier.
 * @returns {{ outcome: string|null, eventTypes: string[] }}
 */
export function shotTrial(tierName, shot, seed) {
    const rng = createRng(seed);
    const state = createGameState({ scheme: 'hold_charge', startingLevel: START_LEVEL_FOR_TIER[tierName], rng });
    startRun(state, rng);
    place(state.skater, CENTER_X_FT, shot.releaseY);
    state.skater.facingRad = Math.atan2(9 - shot.releaseY, shot.targetDx);
    carryPuck(state.puck, state.skater);

    const eventTypes = [];
    const run = (intent) => {
        const result = stepGame(state, intent, rng);
        for (const event of result.events) eventTypes.push(event.type);
    };
    for (let i = 0; i < SHOT_SETTLE_STEPS; i += 1) run(NO_INTENT);
    run({ ...NO_INTENT, shootPressed: true, isShootHeld: true });
    for (let i = 0; i < HOLD_STEPS[shot.speed]; i += 1) run({ ...NO_INTENT, isShootHeld: true });
    run({ ...NO_INTENT, shootReleased: true });
    for (let i = 0; i < MAX_ATTEMPT_STEPS && (state.phase === 'playing' || state.phase === 'rebound_window'); i += 1) {
        run(NO_INTENT);
    }
    return { outcome: state.lastOutcome, eventTypes };
}

const memo = new Map();

/**
 * Runs the whole shot set `reps` times for a tier and seed (memoized, so several checks share one run).
 * saveEvents counts attempts where the goalie made a save at any point (including a save that gave a rebound).
 * @returns {{ total: number, outcomes: Record<string, number>, saves: number, saveEvents: number, reboundsAfterSave: number,
 *   byShot: Array<{ shot: object, total: number, saves: number, goals: number }> }}
 */
export function runShotSet(tierName, baseSeed, reps) {
    const key = `${tierName}|${baseSeed}|${reps}`;
    if (memo.has(key)) return memo.get(key);
    const tierIndex = TIER_NAMES.indexOf(tierName);
    const outcomes = {};
    let total = 0;
    let saves = 0;
    let reboundsAfterSave = 0;
    let saveEvents = 0;
    const byShot = SHOT_SET.map((shot) => ({ shot, total: 0, saves: 0, goals: 0 }));
    SHOT_SET.forEach((shot, shotIndex) => {
        for (let rep = 0; rep < reps; rep += 1) {
            const { outcome, eventTypes } = shotTrial(tierName, shot, subSeed(baseSeed, tierIndex * 100 + shotIndex, rep));
            outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
            total += 1;
            byShot[shotIndex].total += 1;
            if (outcome === 'save') { saves += 1; byShot[shotIndex].saves += 1; }
            if (outcome === 'goal') byShot[shotIndex].goals += 1;
            if (eventTypes.includes('save')) {
                saveEvents += 1;
                if (eventTypes.includes('rebound')) reboundsAfterSave += 1;
            }
        }
    });
    const result = { total, outcomes, saves, saveEvents, reboundsAfterSave, byShot };
    memo.set(key, result);
    return result;
}

/* ---------- 5. Ordering checks ---------- */

/**
 * Fails with a design message when two configured probabilities are too close for N trials to tell apart
 * (TEST_PLAN section 6: tiers that cannot be told apart are a design bug).
 * @param {import('node:assert')} assert @param {string} label
 */
export function assertTiersSeparable(assert, label, harder, easier, minGap, n) {
    const worstSigma = Math.max(sigma(harder, n), sigma(easier, n));
    const needed = minGap + 8 * worstSigma;
    assert.ok(Math.abs(harder - easier) > needed,
        `${label}: configured values ${harder} and ${easier} differ by ${Math.abs(harder - easier).toFixed(3)}, ` +
        `less than ${needed.toFixed(3)} needed to tell them apart with ${n} trials; widen the tiers or raise N`);
}
