// Statistical check: how often the goalie bites on a deke, by tier (TEST_PLAN ST.1, AC-5, AC-7).
// Fixed seeds, so the result is identical on every run; the tolerance (4 sigma) lets a legitimate
// refactor reorder random draws while a real tuning error still fails.
//
// CALIBRATION RECORD (ST.9): fill in the observed rates here after the first run on finished code.
//   not yet calibrated
//
// Troubleshooting: "deke roll never happened" means the goalie emitted neither goalie_bit nor
// goalie_read for the deke; see dekeTrial() in support.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_A, SEED_B, SEED_C } from '../helpers/rng.js';
import { TIER_PARAMS } from '../../src/core/constants.js';
import {
    TIER_NAMES, tierOf, dekeTrial, subSeed, fourSigma, describeRate, assertTiersSeparable
} from './support.js';

const TRIALS = 2000;
const MIN_TIER_GAP = 0.05;
const cache = new Map();

/** Bite rate for a tier at a base seed (memoized across the checks in this file). */
function biteRate(tierName, baseSeed) {
    const key = `${tierName}|${baseSeed}`;
    if (!cache.has(key)) {
        const stream = TIER_NAMES.indexOf(tierName);
        let bites = 0;
        for (let i = 0; i < TRIALS; i += 1) {
            if (dekeTrial(tierName, subSeed(baseSeed, stream, i)) === 'bite') bites += 1;
        }
        cache.set(key, bites / TRIALS);
    }
    return cache.get(key);
}

for (const seed of [SEED_A, SEED_B, SEED_C]) {
    describe(`deke bite rates, seed ${seed}`, () => {
        for (const tierName of TIER_NAMES) {
            it(`${tierName} goalie bites on about 1 minus its read chance`, () => {
                const expected = 1 - tierOf(tierName).params.dekeReadChance;
                const observed = biteRate(tierName, seed);
                assert.ok(Math.abs(observed - expected) <= fourSigma(expected, TRIALS),
                    describeRate(`${tierName} bite rate`, observed, expected, TRIALS));
            });
        }

        it('goalie bites on deke more often at Rookie than All-Star', () => {
            const rookie = biteRate('rookie', seed);
            const allStar = biteRate('all_star', seed);
            assert.ok(rookie - allStar >= MIN_TIER_GAP, `rookie ${rookie} vs all-star ${allStar}`);
        });

        it('bite rates fall from Rookie to Pro to All-Star with a visible gap', () => {
            const rookie = biteRate('rookie', seed);
            const pro = biteRate('pro', seed);
            const allStar = biteRate('all_star', seed);
            assert.ok(rookie - pro >= MIN_TIER_GAP, `rookie ${rookie} vs pro ${pro}`);
            assert.ok(pro - allStar >= MIN_TIER_GAP, `pro ${pro} vs all-star ${allStar}`);
        });
    });
}

describe('deke bite tier design', () => {
    it('the configured read chances are far enough apart for the trial count to tell tiers apart', () => {
        const { rookie, pro, all_star: allStar } = TIER_PARAMS;
        assertTiersSeparable(assert, 'rookie vs pro read chance', pro.dekeReadChance, rookie.dekeReadChance, MIN_TIER_GAP, TRIALS);
        assertTiersSeparable(assert, 'pro vs all-star read chance', allStar.dekeReadChance, pro.dekeReadChance, MIN_TIER_GAP, TRIALS);
    });
});
