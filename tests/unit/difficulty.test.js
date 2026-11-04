// Unit tests for src/core/difficulty.js (AC-7 difficulty ladder; ARCHITECTURE §6–§7; TEST_PLAN Q1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTierForRound, applyImprovement } from '../../src/core/difficulty.js';
import {
    TIER_PARAMS, ALL_STAR_STEP, ALL_STAR_IMPROVEMENT_CAP, CHANCE_MAX
} from '../../src/core/constants.js';

const EPS = 1e-9;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < EPS, `${label}: ${actual} != ${expected}`);
const tiers = (level, rounds) => rounds.map((r) => getTierForRound(level, r).tierName);

test('Ladder: Rookie for rounds 1–2, Pro for 3–4, All-Star from 5', () => {
    assert.deepEqual(tiers('ladder', [1, 2, 3, 4, 5, 6, 12]), ['rookie', 'rookie', 'pro', 'pro', 'all_star', 'all_star', 'all_star']);
});

test('Pro start: Pro for rounds 1–2, then All-Star', () => {
    assert.deepEqual(tiers('pro', [1, 2, 3, 4]), ['pro', 'pro', 'all_star', 'all_star']);
});

test('All-Star start: All-Star from round 1', () => {
    assert.deepEqual(tiers('all_star', [1, 2, 3]), ['all_star', 'all_star', 'all_star']);
});

test('improvement is 0 until the first All-Star round, then grows by ALL_STAR_STEP', () => {
    assert.equal(getTierForRound('ladder', 4).improvement, 0);
    assert.equal(getTierForRound('ladder', 5).improvement, 0);
    near(getTierForRound('ladder', 6).improvement, ALL_STAR_STEP, 'ladder 6');
    near(getTierForRound('all_star', 3).improvement, 2 * ALL_STAR_STEP, 'all_star 3');
    near(getTierForRound('pro', 3).improvement, 0, 'pro 3 is the first All-Star round');
});

test('improvement is capped at ALL_STAR_IMPROVEMENT_CAP (reached at schedule index 9)', () => {
    near(getTierForRound('all_star', 6).improvement, ALL_STAR_IMPROVEMENT_CAP, 'index 9');
    near(getTierForRound('all_star', 7).improvement, ALL_STAR_IMPROVEMENT_CAP, 'index 10');
    near(getTierForRound('all_star', 500).improvement, ALL_STAR_IMPROVEMENT_CAP, 'index 503');
    assert.ok(getTierForRound('all_star', 5).improvement < ALL_STAR_IMPROVEMENT_CAP);
});

test('round 1 params equal the tier table exactly', () => {
    assert.deepEqual(getTierForRound('ladder', 1).params, { ...TIER_PARAMS.rookie });
    assert.deepEqual(getTierForRound('pro', 1).params, { ...TIER_PARAMS.pro });
    assert.deepEqual(getTierForRound('all_star', 1).params, { ...TIER_PARAMS.all_star });
});

test('roundNumber must be an integer >= 1 (RangeError)', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
        assert.throws(() => getTierForRound('ladder', bad), RangeError, `round ${bad}`);
    }
});

test('applyImprovement scales each parameter in the documented direction', () => {
    const base = TIER_PARAMS.all_star;
    const p = applyImprovement(base, 0.2);
    const k = 1.2;
    near(p.lateralSpeedFtPerS, base.lateralSpeedFtPerS * k, 'speed');
    near(p.saveReachFt, base.saveReachFt * k, 'save reach');
    near(p.diveReachFt, base.diveReachFt * k, 'dive reach');
    near(p.pokeChance, base.pokeChance * k, 'poke chance');
    near(p.dekeReadChance, Math.min(base.dekeReadChance * k, CHANCE_MAX), 'deke read');
    near(p.reactionDelayMs, base.reactionDelayMs / k, 'reaction');
    near(p.diveRecoveryMs, base.diveRecoveryMs / k, 'recovery');
    near(p.angleErrorFt, base.angleErrorFt * 0.8, 'angle error');
    near(p.reboundChance, base.reboundChance * 0.8, 'rebound');
    near(p.depthFt, base.depthFt, 'depth unchanged');
});

test('applyImprovement caps chances at CHANCE_MAX and never changes its input', () => {
    const base = { ...TIER_PARAMS.all_star, pokeChance: 0.9, dekeReadChance: 0.9 };
    const p = applyImprovement(base, 0.2);
    assert.equal(p.pokeChance, CHANCE_MAX);
    assert.equal(p.dekeReadChance, CHANCE_MAX);
    assert.equal(base.pokeChance, 0.9);
});

test('applyImprovement clamps the amount to 0…cap', () => {
    assert.deepEqual(applyImprovement(TIER_PARAMS.pro, -1), { ...TIER_PARAMS.pro });
    assert.deepEqual(applyImprovement(TIER_PARAMS.pro, 5), applyImprovement(TIER_PARAMS.pro, ALL_STAR_IMPROVEMENT_CAP));
});

test('each later round is never easier than the one before (Ladder, 12 rounds)', () => {
    for (let r = 2; r <= 12; r += 1) {
        const a = getTierForRound('ladder', r - 1).params;
        const b = getTierForRound('ladder', r).params;
        assert.ok(b.reactionDelayMs <= a.reactionDelayMs, `reaction round ${r}`);
        assert.ok(b.saveReachFt >= a.saveReachFt, `reach round ${r}`);
        assert.ok(b.dekeReadChance >= a.dekeReadChance, `read round ${r}`);
        assert.ok(b.reboundChance <= a.reboundChance, `rebound round ${r}`);
    }
});
