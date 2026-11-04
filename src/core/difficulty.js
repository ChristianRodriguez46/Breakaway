/* =============================================================
   src/core/difficulty.js
   Which goalie tier each round faces, and All-Star scaling.

   Sections in this file
     1. The schedule (starting level + round number → tier)
     2. All-Star improvement (makes the goalie sharper per round)

   The schedule (ARCHITECTURE §7)
     index i = STARTING_LEVEL_OFFSETS[level] + roundNumber - 1
     i 0–1 Rookie, i 2–3 Pro, i >= 4 All-Star.
     All-Star improvement = min(ALL_STAR_STEP x (i - 4), ALL_STAR_IMPROVEMENT_CAP).
   Ladder is the Rookie start: same schedule, same best-score slot.

   Improvement (ARCHITECTURE §6) with k = 1 + improvement:
     speeds and reaches            x k
     poke and deke-read chances    x k, capped at CHANCE_MAX
     reaction delay, recovery      / k
     angle error, rebound chance   x (1 - improvement)
   Depth (how far out the goalie stands) does not change.

   Troubleshooting
   - RangeError "roundNumber": rounds start at 1 and must be integers.
   - All-Star stops getting harder after a few rounds: that's the
     cap (reached at schedule index 9), on purpose.
   ============================================================= */

import {
    TIER_PARAMS, STARTING_LEVEL_OFFSETS, PRO_FIRST_INDEX, ALL_STAR_FIRST_INDEX,
    ALL_STAR_STEP, ALL_STAR_IMPROVEMENT_CAP, CHANCE_MAX
} from './constants.js';

/** @typedef {import('./types.js').StartingLevel} StartingLevel */
/** @typedef {import('./types.js').TierName} TierName */
/** @typedef {import('./types.js').TierParams} TierParams */
/** @typedef {import('./types.js').TierForRound} TierForRound */

/* ---------- 1. The schedule ---------- */

/**
 * The goalie tier for a round.
 * @param {StartingLevel} startingLevel - Unknown values are treated as 'ladder'.
 * @param {number} roundNumber - 1-based integer.
 * @returns {TierForRound} A new object; `params` already has the improvement applied.
 * @throws {RangeError} When roundNumber is not an integer >= 1.
 */
export function getTierForRound(startingLevel, roundNumber) {
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
        throw new RangeError(`getTierForRound: roundNumber must be an integer >= 1, got ${roundNumber}`);
    }
    const offset = STARTING_LEVEL_OFFSETS[startingLevel] ?? 0;
    const index = offset + roundNumber - 1;
    /** @type {TierName} */
    let tierName = 'rookie';
    if (index >= ALL_STAR_FIRST_INDEX) tierName = 'all_star';
    else if (index >= PRO_FIRST_INDEX) tierName = 'pro';
    const improvement = tierName === 'all_star'
        ? Math.min(ALL_STAR_STEP * (index - ALL_STAR_FIRST_INDEX), ALL_STAR_IMPROVEMENT_CAP)
        : 0;
    return { tierName, improvement, params: applyImprovement(TIER_PARAMS[tierName], improvement) };
}

/* ---------- 2. All-Star improvement ---------- */

/**
 * Returns a sharper copy of a tier's parameters. The input is not changed.
 * @param {TierParams} params
 * @param {number} improvement - 0 means unchanged; clamped to 0…ALL_STAR_IMPROVEMENT_CAP.
 * @returns {TierParams}
 */
export function applyImprovement(params, improvement) {
    const amount = Number.isFinite(improvement) ? Math.min(Math.max(improvement, 0), ALL_STAR_IMPROVEMENT_CAP) : 0;
    const k = 1 + amount;
    const chance = (value) => Math.min(value * k, CHANCE_MAX);
    return {
        reactionDelayMs: params.reactionDelayMs / k,
        lateralSpeedFtPerS: params.lateralSpeedFtPerS * k,
        angleErrorFt: params.angleErrorFt * (1 - amount),
        depthFt: params.depthFt,
        saveReachFt: params.saveReachFt * k,
        diveReachFt: params.diveReachFt * k,
        diveRecoveryMs: params.diveRecoveryMs / k,
        pokeRangeFt: params.pokeRangeFt * k,
        pokeChance: chance(params.pokeChance),
        dekeReadChance: chance(params.dekeReadChance),
        reboundChance: params.reboundChance * (1 - amount)
    };
}
