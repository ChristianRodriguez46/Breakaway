// Statistical check: poke-check success by tier (TEST_PLAN ST.5, AC-6.21, AC-6.24).
// Each trial puts a puck carrier 4 ft in front of a settled goalie for slightly less than one
// poke-roll interval, so exactly one roll can happen; the success rate then matches the tier's
// pokeChance. The draws check proves the goalie rolls per interval, not per step.
//
// CALIBRATION RECORD (ST.9): fill in the observed rates here after the first run on finished code.
//   not yet calibrated
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_A, SEED_B, SEED_C } from '../helpers/rng.js';
import { TIER_PARAMS } from '../../src/core/constants.js';
import {
    TIER_NAMES, tierOf, pokeTrial, subSeed, fourSigma, describeRate, assertTiersSeparable,
    MAX_DRAWS_PER_APPROACH
} from './support.js';

const TRIALS = 2000;
const MIN_TIER_GAP = 0.05;
const cache = new Map();

function pokeStats(tierName, baseSeed) {
    const key = `${tierName}|${baseSeed}`;
    if (!cache.has(key)) {
        const stream = 50 + TIER_NAMES.indexOf(tierName);
        let pokes = 0;
        let mostDraws = 0;
        for (let i = 0; i < TRIALS; i += 1) {
            const { didPoke, draws } = pokeTrial(tierName, subSeed(baseSeed, stream, i));
            if (didPoke) pokes += 1;
            mostDraws = Math.max(mostDraws, draws);
        }
        cache.set(key, { rate: pokes / TRIALS, mostDraws });
    }
    return cache.get(key);
}

for (const seed of [SEED_A, SEED_B, SEED_C]) {
    describe(`poke check rates, seed ${seed}`, () => {
        for (const tierName of TIER_NAMES) {
            it(`${tierName} goalie poke-checks on about its poke chance per roll`, () => {
                const expected = tierOf(tierName).params.pokeChance;
                const { rate } = pokeStats(tierName, seed);
                assert.ok(Math.abs(rate - expected) <= fourSigma(expected, TRIALS),
                    describeRate(`${tierName} poke rate`, rate, expected, TRIALS));
            });

            it(`${tierName} goalie draws a bounded number of random numbers per approach`, () => {
                const { mostDraws } = pokeStats(tierName, seed);
                assert.ok(mostDraws <= MAX_DRAWS_PER_APPROACH, `${tierName}: ${mostDraws} draws in one approach`);
            });
        }

        it('poke checks succeed more often at All-Star than at Pro than at Rookie', () => {
            const rookie = pokeStats('rookie', seed).rate;
            const pro = pokeStats('pro', seed).rate;
            const allStar = pokeStats('all_star', seed).rate;
            assert.ok(pro - rookie >= MIN_TIER_GAP, `pro ${pro} vs rookie ${rookie}`);
            assert.ok(allStar - pro >= MIN_TIER_GAP, `all-star ${allStar} vs pro ${pro}`);
        });
    });
}

describe('poke check tier design', () => {
    it('the configured poke chances are far enough apart for the trial count to tell tiers apart', () => {
        const { rookie, pro, all_star: allStar } = TIER_PARAMS;
        assertTiersSeparable(assert, 'rookie vs pro poke chance', pro.pokeChance, rookie.pokeChance, MIN_TIER_GAP, TRIALS);
        assertTiersSeparable(assert, 'pro vs all-star poke chance', allStar.pokeChance, pro.pokeChance, MIN_TIER_GAP, TRIALS);
    });
});
