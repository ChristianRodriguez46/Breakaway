// Integration tests for src/core/game.js: scripted full attempts through stepGame with the real
// skater, puck, rink, collision, goalie and rules modules (AC-5, AC-6, AC-8, AC-9, AC-10, AC-13).
//
// The scripts put the skater, puck or goalie where a case needs them, then let stepGame run.
// "Parking" the goalie puts it in 'recovering' at a chosen x, so it can't move for its recovery time;
// that keeps a case about the rules from depending on goalie tuning.
//
// Troubleshooting
// - "not implemented: ..." : a slice A module (skater, puck, rink, collision) is still a stub.
// - A goal case returns 'save': the parked goalie is in the shot's path; check parkGoalie's x.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepGame } from '../../src/core/game.js';
import { createGameState, startRun, pauseGame, resumeGame } from '../../src/core/rules.js';
import { carryPuck } from '../../src/core/puck.js';
import { getBannerText } from '../../src/core/ui-strings.js';
import { createRng } from '../../src/core/random.js';
import {
    FIXED_STEP_S, SHOT_CLOCK_S, REBOUND_WINDOW_S, BANNER_S, CENTER_X_FT, GOAL_LINE_Y_FT, LEFT_POST, CENTER_DOT
} from '../../src/core/constants.js';
import { SEED_A } from '../helpers/rng.js';

const UP = -Math.PI / 2;
const NO_INTENT = Object.freeze({
    moveX: 0, moveY: 0, isShootHeld: false, shootPressed: false, shootReleased: false, aimPoint: null, dekePressed: false, dekeSide: 0
});
const SHOOT = Object.freeze({ ...NO_INTENT, shootPressed: true });

/** A random function whose value the test can change mid-script; 0.5 gives zero shot spread. */
function dialRng(initial = 0.5) {
    const rng = () => rng.value;
    rng.value = initial;
    return rng;
}

function newRun(rng, scheme = 'one_button', startingLevel = 'ladder') {
    const state = createGameState({ scheme, startingLevel, rng });
    startRun(state, rng);
    return state;
}

/** Puts the skater at (x, y) with the puck, standing still, facing `facingRad`. */
function place(state, x, y, facingRad = UP) {
    const { skater } = state;
    skater.position = { x, y };
    skater.previousPosition = { x, y };
    skater.velocity = { x: 0, y: 0 };
    skater.facingRad = facingRad;
    skater.hasPuck = true;
    carryPuck(state.puck, skater);
}

/** Freezes the goalie at x (its own depth) in 'recovering' so it can't move for a while. */
function parkGoalie(state, x) {
    const g = state.goalie;
    g.position = { x, y: GOAL_LINE_Y_FT + state.round.tier.params.depthFt };
    g.previousPosition = { ...g.position };
    g.mode = 'recovering';
    g.modeTimeS = 0;
}

/** Steps with no input until an event of `type` arrives (or maxSteps). Returns { events, steps }. */
function runUntil(state, rng, type, maxSteps = 3000) {
    const events = [];
    for (let steps = 1; steps <= maxSteps; steps += 1) {
        const result = stepGame(state, NO_INTENT, rng);
        events.push(...result.events);
        if (result.events.some((e) => e.type === type)) return { events, steps };
    }
    return { events, steps: maxSteps };
}

const outcomeOf = (events) => events.find((e) => e.type === 'outcome');

/** Shoots from (x, y) straight up the ice and plays until the attempt ends. */
function shootAndResolve(state, rng, x, y, facingRad = UP) {
    place(state, x, y, facingRad);
    const first = stepGame(state, SHOOT, rng).events;
    const { events } = runUntil(state, rng, 'outcome');
    return [...first, ...events];
}

/** A scripted goal: goalie parked far left, shot from the slot. */
function scriptGoal(state, rng) {
    parkGoalie(state, CENTER_X_FT - 6.5);
    return shootAndResolve(state, rng, CENTER_X_FT + 0.5, 25);
}

/** A scripted wide: shot straight up from well outside the posts. */
function scriptWide(state, rng) {
    return shootAndResolve(state, rng, CENTER_X_FT + 18, 30);
}

/** Plays out the result banner (about BANNER_S) and stops on the step that leaves it. */
function finishBanner(state, rng) {
    const events = [];
    let steps = 0;
    while (state.phase === 'result_banner' && steps < 1000) {
        events.push(...stepGame(state, NO_INTENT, rng).events);
        steps += 1;
    }
    assert.ok(Math.abs(steps - BANNER_S / FIXED_STEP_S) <= 1, `banner lasted ${steps} steps`);
    return events;
}

test('goal: shot past a parked goalie scores 100 and shows the banner', () => {
    const rng = dialRng();
    const state = newRun(rng);
    const events = scriptGoal(state, rng);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('shot'));
    assert.ok(types.includes('goal'));
    assert.deepEqual(outcomeOf(events), { type: 'outcome', outcome: 'goal', points: 100, isShortOfNet: false });
    assert.equal(state.phase, 'result_banner');
    assert.equal(state.runScore, 100);
    assert.equal(state.puck.mode, 'in_net');
});

test('save: shot into a parked goalie with no rebound roll is a save and the puck is frozen', () => {
    const rng = dialRng(0.99); // spread (0.99*2-1) is small at this range; rebound roll 0.99 fails
    const state = newRun(rng);
    parkGoalie(state, CENTER_X_FT);
    const events = shootAndResolve(state, rng, CENTER_X_FT, 25);
    assert.ok(events.some((e) => e.type === 'save'));
    assert.equal(outcomeOf(events).outcome, 'save');
    assert.equal(state.puck.mode, 'absorbed');
    assert.equal(state.hasUsedRebound, false);
});

test('rebound → goal: the deke bonus from earlier in the attempt is kept (Q7)', () => {
    const rng = dialRng();
    const state = newRun(rng);
    state.didGoalieBiteThisAttempt = true; // the goalie bit on a deke earlier in this attempt
    parkGoalie(state, CENTER_X_FT);
    place(state, CENTER_X_FT, 25);
    stepGame(state, SHOOT, rng);
    rng.value = 0; // rebound roll succeeds
    const { events } = runUntil(state, rng, 'rebound', 200);
    assert.ok(events.some((e) => e.type === 'save'));
    assert.equal(state.phase, 'rebound_window');
    assert.equal(state.reboundLeftS, REBOUND_WINDOW_S);
    assert.equal(state.puck.mode, 'loose');
    assert.equal(outcomeOf(events), undefined, 'a rebound is not an outcome');
    // Skate onto the loose puck and shoot past the goalie, now parked to the side.
    rng.value = 0.5;
    parkGoalie(state, CENTER_X_FT - 6.5);
    state.puck.position = { x: CENTER_X_FT + 0.5, y: 23 };
    state.puck.previousPosition = { ...state.puck.position };
    state.puck.velocity = { x: 0, y: 0 };
    state.skater.position = { x: CENTER_X_FT + 0.5, y: 25 };
    state.skater.previousPosition = { ...state.skater.position };
    state.skater.velocity = { x: 0, y: 0 };
    state.skater.facingRad = UP;
    const shot = stepGame(state, SHOOT, rng).events;
    assert.ok(shot.some((e) => e.type === 'shot'));
    assert.equal(state.phase, 'playing', 'the rebound shot closes the window');
    const rest = runUntil(state, rng, 'outcome').events;
    assert.deepEqual(outcomeOf(rest), { type: 'outcome', outcome: 'goal', points: 150, isShortOfNet: false });
    assert.equal(state.runScore, 150);
});

test('rebound expiry: no shot within REBOUND_WINDOW_S is a save', () => {
    const rng = dialRng();
    const state = newRun(rng);
    parkGoalie(state, CENTER_X_FT);
    place(state, CENTER_X_FT, 25);
    stepGame(state, SHOOT, rng);
    rng.value = 0;
    runUntil(state, rng, 'rebound', 200);
    rng.value = 0.5;
    const clockAtRebound = state.shotClockS;
    const { events, steps } = runUntil(state, rng, 'outcome', 400);
    assert.equal(outcomeOf(events).outcome, 'save');
    assert.ok(Math.abs(steps - REBOUND_WINDOW_S / FIXED_STEP_S) <= 1, `ended after ${steps} steps`);
    assert.ok(state.shotClockS < clockAtRebound, 'the shot clock ran during the window (Q3)');
    assert.equal(getBannerText('save', { isReboundExpired: true }).detail, 'No rebound shot in time.');
});

test('wide: a shot that crosses the goal line outside the posts', () => {
    const rng = dialRng();
    const state = newRun(rng);
    const events = scriptWide(state, rng);
    assert.deepEqual(outcomeOf(events), { type: 'outcome', outcome: 'wide', points: 0, isShortOfNet: false });
    assert.equal(getBannerText('wide', { isShortOfNet: state.wasLastShotShort }).title, 'Wide');
});

test('"No shot": a puck that stops short of the net is wide with isShortOfNet', () => {
    const rng = dialRng();
    const state = newRun(rng);
    place(state, CENTER_X_FT, 40);
    stepGame(state, SHOOT, rng);
    state.puck.velocity = { x: 0, y: -3 }; // a dribbler
    const { events } = runUntil(state, rng, 'outcome', 600);
    assert.deepEqual(outcomeOf(events), { type: 'outcome', outcome: 'wide', points: 0, isShortOfNet: true });
    assert.equal(state.wasLastShotShort, true);
    assert.equal(getBannerText(state.lastOutcome, { isShortOfNet: state.wasLastShotShort }).title, 'No shot');
});

test('post and out: a shot off the post that doesn\'t go in', () => {
    const rng = dialRng();
    const state = newRun(rng);
    parkGoalie(state, CENTER_X_FT + 6.5);
    const events = shootAndResolve(state, rng, LEFT_POST.x, 25);
    assert.ok(events.some((e) => e.type === 'post'), 'post event for the sound and flash');
    assert.equal(outcomeOf(events).outcome, 'post_out');
});

test('poke check: carrying the puck right in front of a tracking goalie with the poke roll forced', () => {
    const rng = dialRng(0); // every roll succeeds
    const state = newRun(rng);
    state.goalie.mode = 'tracking';
    place(state, state.goalie.position.x, state.goalie.position.y + 4);
    const { events } = runUntil(state, rng, 'outcome', 120);
    assert.ok(events.some((e) => e.type === 'poke'));
    assert.equal(outcomeOf(events).outcome, 'poke');
    assert.equal(state.skater.hasPuck, false);
});

test('time: idle at center ice until the shot clock runs out', () => {
    const rng = dialRng();
    const state = newRun(rng);
    const { events, steps } = runUntil(state, rng, 'outcome', 2000);
    assert.equal(outcomeOf(events).outcome, 'time');
    assert.ok(events.some((e) => e.type === 'time'));
    assert.ok(Math.abs(steps - SHOT_CLOCK_S / FIXED_STEP_S) <= 1, `took ${steps} steps`);
    assert.equal(state.shotClockS, 0);
});

test('a goal in the same step the clock runs out is a goal, not Time (Q4)', () => {
    const rng = dialRng();
    const state = newRun(rng);
    parkGoalie(state, CENTER_X_FT - 6.5);
    state.skater.hasPuck = false;
    state.puck.mode = 'shot';
    state.puck.position = { x: CENTER_X_FT, y: GOAL_LINE_Y_FT };
    state.puck.previousPosition = { ...state.puck.position };
    state.puck.velocity = { x: 0, y: -100 };
    state.shotClockS = FIXED_STEP_S / 2;
    const { events } = stepGame(state, NO_INTENT, rng);
    assert.equal(outcomeOf(events).outcome, 'goal');
    assert.equal(state.shotClockS, 0);
});

test('after the banner the next attempt starts at center ice with a full clock', () => {
    const rng = dialRng();
    const state = newRun(rng);
    scriptWide(state, rng);
    const events = finishBanner(state, rng);
    assert.ok(events.some((e) => e.type === 'attempt_started'));
    assert.equal(state.phase, 'playing');
    assert.equal(state.attemptIndex, 1);
    assert.equal(state.shotClockS, SHOT_CLOCK_S);
    assert.deepEqual(state.skater.position, { ...CENTER_DOT });
    assert.equal(state.puck.mode, 'carried');
});

test('round cleared: 3 goals and 2 misses, then the round summary', () => {
    const rng = dialRng();
    const state = newRun(rng);
    const plan = [scriptGoal, scriptWide, scriptGoal, scriptWide, scriptGoal];
    let last = [];
    for (const script of plan) {
        script(state, rng);
        last = finishBanner(state, rng);
    }
    assert.deepEqual(state.round.attemptOutcomes, ['goal', 'wide', 'goal', 'wide', 'goal']);
    assert.ok(last.some((e) => e.type === 'round_cleared'));
    assert.equal(state.phase, 'round_summary');
    assert.equal(state.roundsCleared, 1);
    assert.equal(state.runScore, 300);
    assert.deepEqual(stepGame(state, SHOOT, rng).events, [], 'nothing runs on the summary screen');
});

test('early run end: three misses end the run before attempt 4', () => {
    const rng = dialRng();
    const state = newRun(rng);
    let last = [];
    for (let i = 0; i < 3; i += 1) {
        scriptWide(state, rng);
        last = finishBanner(state, rng);
    }
    assert.deepEqual(last.filter((e) => e.type !== 'stickhandle').map((e) => e.type), ['round_failed', 'run_over']);
    assert.equal(state.phase, 'game_over');
    assert.equal(state.round.attemptOutcomes.length, 3);
});

test('pause freezes the clock and the world; resume continues from the same state', () => {
    const rng = dialRng();
    const state = newRun(rng);
    for (let i = 0; i < 100; i += 1) stepGame(state, { ...NO_INTENT, moveY: -1 }, rng);
    pauseGame(state);
    const snapshot = JSON.stringify(state);
    for (let i = 0; i < 600; i += 1) {
        assert.deepEqual(stepGame(state, { ...NO_INTENT, moveY: -1, shootPressed: true }, rng).events, []);
    }
    assert.equal(JSON.stringify(state), snapshot);
    resumeGame(state);
    const clock = state.shotClockS;
    stepGame(state, NO_INTENT, rng);
    assert.ok(state.shotClockS < clock);
    assert.ok(Math.abs(clock - state.shotClockS - FIXED_STEP_S) < 1e-9);
});

test('same seed and inputs replay identically (all randomness through the injected rng)', () => {
    const play = () => {
        const rng = createRng(SEED_A);
        const state = newRun(rng, 'hold_charge');
        const log = [];
        for (let i = 0; i < 1500; i += 1) {
            const intent = { ...NO_INTENT, moveY: i < 200 ? -1 : 0, moveX: i % 300 < 150 ? 0.5 : -0.5,
                dekePressed: i === 180, dekeSide: 1, shootPressed: i === 210, isShootHeld: i >= 210 && i < 260, shootReleased: i === 260 };
            const { events } = stepGame(state, intent, rng);
            log.push(state.phase, state.puck.position.x.toFixed(6), state.goalie.position.x.toFixed(6), ...events.map((e) => e.type));
        }
        return log;
    };
    assert.deepEqual(play(), play());
});
