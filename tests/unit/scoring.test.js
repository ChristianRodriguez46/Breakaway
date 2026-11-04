// Unit tests for src/core/scoring.js (AC-10 scoring, AC-11 best scores; TEST_PLAN Q7, Q8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGoalPoints, isNewBest } from '../../src/core/scoring.js';
import { POINTS_PER_GOAL, DEKE_BONUS_POINTS } from '../../src/core/constants.js';

const best = (score) => ({ score, rounds_cleared: 1, goals: 4, achieved_at: '2026-10-01T00:00:00.000Z' });

test('a goal is 100, or 150 when the goalie bit on a deke', () => {
    assert.equal(getGoalPoints(false), POINTS_PER_GOAL);
    assert.equal(getGoalPoints(true), POINTS_PER_GOAL + DEKE_BONUS_POINTS);
    assert.equal(getGoalPoints(true), 150);
});

test('isNewBest: any positive score beats an empty slot', () => {
    assert.equal(isNewBest(100, null), true);
});

test('isNewBest: 0 is never a new best, even with an empty slot (Q8)', () => {
    assert.equal(isNewBest(0, null), false);
    assert.equal(isNewBest(0, best(0)), false);
});

test('isNewBest: strictly greater only; a tie keeps the old best', () => {
    assert.equal(isNewBest(500, best(500)), false);
    assert.equal(isNewBest(499, best(500)), false);
    assert.equal(isNewBest(501, best(500)), true);
});

test('isNewBest: non-numbers and negatives are not bests', () => {
    assert.equal(isNewBest(NaN, null), false);
    assert.equal(isNewBest(-100, null), false);
});
