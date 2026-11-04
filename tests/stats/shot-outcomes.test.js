// Statistical check: identical scripted shots against each tier (TEST_PLAN ST.2, ST.3, ST.4, ST.8).
// 20 scripted shots (5 targets x 2 charge levels x 2 release distances), each repeated REPS times
// with its own sub-seed, played through stepGame. Same shots, different goalie tier.
//
// CALIBRATION RECORD (ST.9): the first run on finished code fills this in; the constants below are
// then set from it and are not loosened afterwards without a note in the iteration log.
//   not yet calibrated
//
// Troubleshooting
// - "Rookie goal rate outside the beatable band": the tiers drifted. Read the printed rates
//   before touching the band.
// - "not implemented": the named core module is still a stub.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_A, SEED_B, SEED_C } from '../helpers/rng.js';
import { TIER_PARAMS } from '../../src/core/constants.js';
import { TIER_NAMES, tierOf, runShotSet, fourSigma, describeRate, SHOT_SET } from './support.js';

const REPS = 60;
const MIN_SAVE_GAP = 0.03;
const MIN_GOAL_GAP = 0.10;
/** Sanity bands for the goal rate on the scripted set (ST.8). */
const ROOKIE_GOAL_BAND = Object.freeze([0.30, 0.90]);
const ALL_STAR_GOAL_BAND = Object.freeze([0.05, 0.60]);

const rates = (tierName, seed) => {
    const r = runShotSet(tierName, seed, REPS);
    return { ...r, saveRate: r.saves / r.total, goalRate: (r.outcomes.goal ?? 0) / r.total };
};

for (const seed of [SEED_A, SEED_B, SEED_C]) {
    describe(`scripted shots by tier, seed ${seed}`, () => {
        it('plays every scripted shot to a single known outcome', () => {
            const known = new Set(['goal', 'save', 'wide', 'post_out', 'poke', 'time']);
            for (const tierName of TIER_NAMES) {
                const r = rates(tierName, seed);
                assert.equal(r.total, SHOT_SET.length * REPS);
                for (const outcome of Object.keys(r.outcomes)) {
                    assert.ok(known.has(outcome), `${tierName}: unexpected outcome ${outcome}`);
                }
            }
        });

        it('All-Star saves more of the same scripted shots than Rookie', () => {
            const rookie = rates('rookie', seed);
            const pro = rates('pro', seed);
            const allStar = rates('all_star', seed);
            assert.ok(allStar.saveRate - pro.saveRate >= MIN_SAVE_GAP, `all-star ${allStar.saveRate} vs pro ${pro.saveRate}`);
            assert.ok(pro.saveRate - rookie.saveRate >= MIN_SAVE_GAP, `pro ${pro.saveRate} vs rookie ${rookie.saveRate}`);
            assert.ok(rookie.goalRate - allStar.goalRate >= MIN_GOAL_GAP,
                `goal rate rookie ${rookie.goalRate} vs all-star ${allStar.goalRate}`);
        });

        it('fast shots separate the tiers more than slow shots do', () => {
            const gap = (speed) => {
                const share = (tierName) => {
                    const rows = runShotSet(tierName, seed, REPS).byShot.filter((row) => row.shot.speed === speed);
                    return rows.reduce((sum, row) => sum + row.saves, 0) / rows.reduce((sum, row) => sum + row.total, 0);
                };
                return share('all_star') - share('rookie');
            };
            assert.ok(gap('fast') > gap('slow'), `fast gap ${gap('fast')} vs slow gap ${gap('slow')}`);
        });

        it('Rookie gives up goals on a beatable share of the scripted shots and All-Star does not stop everything', () => {
            const rookie = rates('rookie', seed).goalRate;
            const allStar = rates('all_star', seed).goalRate;
            assert.ok(rookie >= ROOKIE_GOAL_BAND[0] && rookie <= ROOKIE_GOAL_BAND[1], `rookie goal rate ${rookie}`);
            assert.ok(allStar >= ALL_STAR_GOAL_BAND[0] && allStar <= ALL_STAR_GOAL_BAND[1], `all-star goal rate ${allStar}`);
        });

        for (const tierName of TIER_NAMES) {
            it(`${tierName} goalie gives a rebound on about its rebound chance per save`, () => {
                const r = rates(tierName, seed);
                assert.ok(r.saveEvents >= 200, `${tierName}: only ${r.saveEvents} saves to measure rebounds on`);
                const expected = tierOf(tierName).params.reboundChance;
                const observed = r.reboundsAfterSave / r.saveEvents;
                assert.ok(Math.abs(observed - expected) <= fourSigma(expected, r.saveEvents),
                    describeRate(`${tierName} rebound rate`, observed, expected, r.saveEvents));
            });
        }

        it('Rookie gives more rebounds per save than All-Star', () => {
            assert.ok(TIER_PARAMS.rookie.reboundChance > TIER_PARAMS.all_star.reboundChance, 'tier table no longer orders rebounds');
            const rate = (tierName) => { const r = rates(tierName, seed); return r.reboundsAfterSave / r.saveEvents; };
            assert.ok(rate('rookie') > rate('all_star'), `rookie ${rate('rookie')} vs all-star ${rate('all_star')}`);
        });
    });
}
