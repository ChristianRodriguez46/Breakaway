/* =============================================================
   src/core/scoring.js
   Points for a goal and the "new best" test.

   Sections in this file
     1. Goal points (100, or 150 with the deke bonus)
     2. Best-score comparison

   Rules (ARCHITECTURE §7, TEST_PLAN Q7 and Q8)
   - A goal is POINTS_PER_GOAL (100). If the goalie bit on a deke
     earlier in the same attempt, add DEKE_BONUS_POINTS (50), once.
     The bonus carries into a rebound goal in that attempt.
   - A run score is a new best only when it is strictly greater than
     the stored best and greater than 0. A tie keeps the old best.

   Troubleshooting
   - Deke goals score 100: the caller didn't pass
     state.didGoalieBiteThisAttempt (set by the goalie's
     'goalie_bit' event in game.js).
   - A score of 0 shows "New best": isNewBest returns false for 0;
     check the caller uses it instead of its own comparison.
   ============================================================= */

import { POINTS_PER_GOAL, DEKE_BONUS_POINTS } from './constants.js';

/** @typedef {import('./types.js').BestScore} BestScore */

/* ---------- 1. Goal points ---------- */

/**
 * Points for one goal.
 * @param {boolean} didGoalieBite - The goalie bit on a deke earlier in this attempt.
 * @returns {number} 100, or 150 with the deke bonus.
 */
export function getGoalPoints(didGoalieBite) {
    return didGoalieBite ? POINTS_PER_GOAL + DEKE_BONUS_POINTS : POINTS_PER_GOAL;
}

/* ---------- 2. Best-score comparison ---------- */

/**
 * Whether a finished run beats the stored best for its slot.
 * @param {number} runScore
 * @param {BestScore|null} existing - The stored best, or null when the slot is empty.
 * @returns {boolean} True only when runScore > 0 and strictly greater than the stored score.
 */
export function isNewBest(runScore, existing) {
    if (!Number.isFinite(runScore) || runScore <= 0) return false;
    if (!existing) return true;
    return runScore > existing.score;
}
