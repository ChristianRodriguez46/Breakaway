// Unit tests for src/core/rules.js (AC-6 outcomes, AC-8 rounds, AC-9 run end, AC-10 scoring, AC-13 pause).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGameState, startRun, resolveStepOutcome, finishAttempt, advanceAfterBanner, startNextRound,
    pauseGame, resumeGame, getMarkerStates, isRoundLost
} from '../../src/core/rules.js';
import { SHOT_CLOCK_S, BANNER_S, CENTER_DOT } from '../../src/core/constants.js';
import { constantRng } from '../helpers/rng.js';

const rng = constantRng(0.5);
const newRun = (startingLevel = 'ladder') => startRun(createGameState({ scheme: 'hold_charge', startingLevel, rng }), rng);
/** Ends the current attempt with `outcome` and moves past the banner. */
const play = (state, outcome) => {
    const events = finishAttempt(state, outcome);
    return { events, after: advanceAfterBanner(state, rng) };
};

test('createGameState: phase start, round 1 with its tier, nothing scored', () => {
    const s = createGameState({ scheme: 'aim_mouse', startingLevel: 'pro', rng });
    assert.equal(s.phase, 'start');
    assert.equal(s.scheme, 'aim_mouse');
    assert.equal(s.round.number, 1);
    assert.equal(s.round.tier.tierName, 'pro');
    assert.equal(s.runScore, 0);
    assert.equal(s.shotClockS, SHOT_CLOCK_S);
    assert.equal(s.resumePhase, null);
});

test('createGameState rejects unknown schemes and levels with TypeError', () => {
    assert.throws(() => createGameState({ scheme: 'joystick', startingLevel: 'ladder', rng }), TypeError);
    assert.throws(() => createGameState({ scheme: 'hold_charge', startingLevel: 'rookie', rng }), TypeError);
    assert.throws(() => createGameState({ scheme: 'hold_charge', startingLevel: 'ladder', rng: null }), TypeError);
});

test('startRun: round 1, attempt 1, playing, full clock, skater at center with the puck', () => {
    const s = newRun();
    assert.equal(s.phase, 'playing');
    assert.equal(s.attemptIndex, 0);
    assert.equal(s.shotClockS, SHOT_CLOCK_S);
    assert.deepEqual(s.skater.position, { ...CENTER_DOT });
    assert.equal(s.skater.hasPuck, true);
    assert.equal(s.puck.mode, 'carried');
    assert.equal(s.goalie.mode, 'set');
});

test('resolveStepOutcome: earliest decisive contact wins, by time not by list order', () => {
    const s = newRun();
    assert.equal(resolveStepOutcome(s, [{ kind: 'goal', tStep: 0.6 }, { kind: 'goalie', tStep: 0.4 }]), 'save');
    assert.equal(resolveStepOutcome(s, [{ kind: 'goalie', tStep: 0.7 }, { kind: 'goal', tStep: 0.2 }]), 'goal');
    assert.equal(resolveStepOutcome(s, [{ kind: 'board', tStep: 0.1 }]), null);
    assert.equal(resolveStepOutcome(s, []), null);
});

test('resolveStepOutcome: post then goal = goal, post then save = save (Q18), post then wide/stop = post_out', () => {
    const s = newRun();
    assert.equal(resolveStepOutcome(s, [{ kind: 'post', tStep: 0.1 }, { kind: 'goal', tStep: 0.5 }]), 'goal');
    assert.equal(resolveStepOutcome(s, [{ kind: 'post', tStep: 0.1 }, { kind: 'goalie', tStep: 0.5 }]), 'save');
    assert.equal(resolveStepOutcome(s, [{ kind: 'post', tStep: 0.1 }], { didStop: true }), 'post_out');
    s.puck.hasHitPost = true; // a post earlier in the attempt counts too
    assert.equal(resolveStepOutcome(s, [], { didCrossGoalLineWide: true }), 'post_out');
    assert.equal(resolveStepOutcome(s, [], { didLeaveView: true }), 'post_out');
});

test('resolveStepOutcome: wide without a post; poke; rebound expiry is a save', () => {
    const s = newRun();
    assert.equal(resolveStepOutcome(s, [], { didCrossGoalLineWide: true }), 'wide');
    assert.equal(resolveStepOutcome(s, [], { didStop: true }), 'wide');
    assert.equal(resolveStepOutcome(s, [], { didPoke: true }), 'poke');
    assert.equal(resolveStepOutcome(s, [], { isReboundExpired: true }), 'save');
});

test('resolveStepOutcome: a physics outcome in the same step beats Time (Q4)', () => {
    const s = newRun();
    assert.equal(resolveStepOutcome(s, [], { isClockExpired: true }), 'time');
    assert.equal(resolveStepOutcome(s, [{ kind: 'goal', tStep: 0.99 }], { isClockExpired: true }), 'goal');
    assert.equal(resolveStepOutcome(s, [{ kind: 'goalie', tStep: 0.99 }], { isClockExpired: true }), 'save');
    assert.equal(resolveStepOutcome(s, [], { didStop: true, isClockExpired: true }), 'wide');
    assert.equal(resolveStepOutcome(s, [], { didPoke: true, isClockExpired: true }), 'poke');
});

test('finishAttempt: a goal adds 100, records the outcome, shows the banner', () => {
    const s = newRun();
    const events = finishAttempt(s, 'goal');
    assert.equal(s.phase, 'result_banner');
    assert.equal(s.bannerLeftS, BANNER_S);
    assert.deepEqual(s.round.attemptOutcomes, ['goal']);
    assert.equal(s.round.goals, 1);
    assert.equal(s.runScore, 100);
    assert.equal(s.runGoals, 1);
    assert.deepEqual(events, [{ type: 'goal' }, { type: 'outcome', outcome: 'goal', points: 100, isShortOfNet: false }]);
});

test('finishAttempt: deke bonus +50 once when the goalie bit this attempt (Q7)', () => {
    const s = newRun();
    s.didGoalieBiteThisAttempt = true;
    const events = finishAttempt(s, 'goal');
    assert.equal(s.runScore, 150);
    assert.equal(events.at(-1).points, 150);
    advanceAfterBanner(s, rng);
    assert.equal(s.didGoalieBiteThisAttempt, false, 'the bonus resets for the next attempt');
    finishAttempt(s, 'goal');
    assert.equal(s.runScore, 250);
});

test('finishAttempt: misses score nothing; isShortOfNet only sticks to wide', () => {
    const s = newRun();
    const events = finishAttempt(s, 'wide', { isShortOfNet: true });
    assert.equal(s.runScore, 0);
    assert.equal(s.wasLastShotShort, true);
    assert.deepEqual(events.at(-1), { type: 'outcome', outcome: 'wide', points: 0, isShortOfNet: true });
    advanceAfterBanner(s, rng);
    const saveEvents = finishAttempt(s, 'save', { isShortOfNet: true });
    assert.equal(saveEvents.at(-1).isShortOfNet, false);
    assert.equal(s.wasLastShotShort, false);
});

test('advanceAfterBanner: next attempt resets the attempt and emits attempt_started', () => {
    const s = newRun();
    finishAttempt(s, 'save');
    s.shotClockS = 2;
    const events = advanceAfterBanner(s, rng);
    assert.deepEqual(events, [{ type: 'attempt_started' }]);
    assert.equal(s.attemptIndex, 1);
    assert.equal(s.phase, 'playing');
    assert.equal(s.shotClockS, SHOT_CLOCK_S);
    assert.equal(s.hasUsedRebound, false);
    assert.equal(s.lastOutcome, 'save');
});

test('round cleared: 3 goals in 5 attempts plays all 5, then round_summary; next round raises the tier', () => {
    const s = newRun();
    for (const outcome of ['goal', 'save', 'goal', 'goal']) {
        play(s, outcome);
        assert.equal(s.phase, 'playing', `still playing after ${outcome}`);
    }
    const { after } = play(s, 'wide');
    assert.deepEqual(after, [{ type: 'round_cleared' }]);
    assert.equal(s.phase, 'round_summary');
    assert.equal(s.roundsCleared, 1);
    assert.equal(startNextRound(s, rng)[0].type, 'attempt_started');
    assert.equal(s.round.number, 2);
    assert.equal(s.round.goals, 0);
    assert.equal(s.attemptIndex, 0);
    assert.equal(s.runScore, 300, 'run score carries over');
    play(s, 'goal'); play(s, 'goal'); play(s, 'goal'); play(s, 'save'); play(s, 'save');
    startNextRound(s, rng);
    assert.equal(s.round.number, 3);
    assert.equal(s.round.tier.tierName, 'pro');
});

test('early run end: game over as soon as 3 goals are out of reach', () => {
    const s = newRun();
    play(s, 'save');
    play(s, 'wide');
    const { after } = play(s, 'time');
    assert.deepEqual(after.map((e) => e.type), ['round_failed', 'run_over']);
    assert.equal(s.phase, 'game_over');
    assert.equal(s.round.attemptOutcomes.length, 3);
});

test('a round failed on attempt 5 also ends the run', () => {
    const s = newRun();
    play(s, 'goal'); play(s, 'goal'); play(s, 'save'); play(s, 'save');
    assert.equal(s.phase, 'playing');
    play(s, 'save');
    assert.equal(s.phase, 'game_over');
});

test('advanceAfterBanner and startNextRound are no-ops in the wrong phase', () => {
    const s = newRun();
    assert.deepEqual(advanceAfterBanner(s, rng), []);
    assert.deepEqual(startNextRound(s, rng), []);
    assert.equal(s.phase, 'playing');
});

test('pause and resume: only from live phases; resume returns to the paused phase', () => {
    const s = newRun();
    assert.deepEqual(pauseGame(s), [{ type: 'paused' }]);
    assert.equal(s.phase, 'paused');
    assert.equal(s.resumePhase, 'playing');
    assert.deepEqual(pauseGame(s), [], 'already paused');
    assert.deepEqual(resumeGame(s), [{ type: 'resumed' }]);
    assert.equal(s.phase, 'playing');
    assert.deepEqual(resumeGame(s), [], 'not paused');
    s.phase = 'rebound_window';
    pauseGame(s);
    resumeGame(s);
    assert.equal(s.phase, 'rebound_window');
    finishAttempt(s, 'save');
    pauseGame(s);
    assert.equal(s.resumePhase, 'result_banner');
    resumeGame(s);
    for (const phase of ['start', 'round_summary', 'game_over']) {
        s.phase = phase;
        assert.deepEqual(pauseGame(s), []);
        assert.equal(s.phase, phase);
    }
});

test('getMarkerStates: goal/miss for played, current, then pending; always 5', () => {
    const round = { number: 1, attemptOutcomes: ['goal', 'poke'], goals: 1, points: 100, tier: null };
    assert.deepEqual(getMarkerStates(round, 2), ['goal', 'miss', 'current', 'pending', 'pending']);
    assert.deepEqual(getMarkerStates({ ...round, attemptOutcomes: [] }, 0), ['current', 'pending', 'pending', 'pending', 'pending']);
    const full = { ...round, attemptOutcomes: ['goal', 'save', 'wide', 'post_out', 'time'] };
    assert.deepEqual(getMarkerStates(full, 4), ['goal', 'miss', 'miss', 'miss', 'miss']);
});

test('isRoundLost: goals + attempts left < 3', () => {
    assert.equal(isRoundLost(0, 2), false);
    assert.equal(isRoundLost(0, 3), true);
    assert.equal(isRoundLost(1, 3), false);
    assert.equal(isRoundLost(1, 4), true);
    assert.equal(isRoundLost(2, 4), false);
    assert.equal(isRoundLost(2, 5), true);
    assert.equal(isRoundLost(3, 5), false);
});
