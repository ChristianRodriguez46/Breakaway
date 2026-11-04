// Unit tests for src/core/goalie.js (AC-5 goalie AI, AC-7 tiers; ARCHITECTURE §6).
// Skater and puck are plain objects here, so these tests don't depend on skater.js or puck.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoalie, getGoalieCapsule, updateGoalie } from '../../src/core/goalie.js';
import { getTierForRound } from '../../src/core/difficulty.js';
import {
    FIXED_STEP_S, CENTER_X_FT, GOAL_LINE_Y_FT, BLUE_LINE_Y_FT, GOALIE_BODY_RADIUS_FT, BITE_SHIFT_FT,
    BITE_FREEZE_S, POKE_CHECK_INTERVAL_S, POKE_DURATION_S, CREASE_RADIUS_FT, CREASE_EXIT_MAX_FT
} from '../../src/core/constants.js';
import { constantRng, sequenceRng, countingRng } from '../helpers/rng.js';

const ROOKIE = getTierForRound('ladder', 1);
const PRO = getTierForRound('pro', 1);
const EPS = 1e-6;

/** A skater carrying the puck at (x, y), facing up the ice; the puck 2 ft in front. */
function scene(x, y, { puckMode = 'carried', velocity = { x: 0, y: 0 } } = {}) {
    const skater = {
        position: { x, y }, previousPosition: { x, y }, velocity: { x: 0, y: 0 }, facingRad: -Math.PI / 2,
        hasPuck: puckMode === 'carried', dekeTimeLeftS: 0, dekeCooldownS: 0, dekeSide: 1, chargeHeldS: 0, isCharging: false
    };
    const puck = {
        position: { x, y: y - 2 }, previousPosition: { x, y: y - 2 }, velocity: { ...velocity }, mode: puckMode, hasHitPost: false
    };
    return { skater, puck };
}

function step(goalie, s, tier, rng, extra = {}) {
    return updateGoalie(goalie, { puck: s.puck, skater: s.skater, isShotThisStep: false, didDekeThisStep: false, ...extra }, tier, rng, FIXED_STEP_S);
}

/** Moves the puck along its velocity for one step (no collisions), like a shot in flight. */
function flyPuck(puck) {
    puck.previousPosition = { ...puck.position };
    puck.position = { x: puck.position.x + puck.velocity.x * FIXED_STEP_S, y: puck.position.y + puck.velocity.y * FIXED_STEP_S };
}

test('createGoalie: set, centered at its depth, one random draw for the angle error', () => {
    const rng = countingRng(sequenceRng([0.75]));
    const g = createGoalie(ROOKIE, rng);
    assert.equal(rng.calls, 1);
    assert.equal(g.mode, 'set');
    assert.equal(g.position.x, CENTER_X_FT);
    assert.equal(g.position.y, GOAL_LINE_Y_FT + ROOKIE.params.depthFt);
    assert.ok(Math.abs(g.angleOffsetFt - 0.5 * ROOKIE.params.angleErrorFt) < EPS);
    assert.equal(g.reachFt, ROOKIE.params.saveReachFt);
    assert.deepEqual(g.previousPosition, g.position);
    assert.notEqual(g.previousPosition, g.position);
});

test('set until the skater crosses the blue line, then tracking', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    const far = scene(CENTER_X_FT, BLUE_LINE_Y_FT + 10);
    for (let i = 0; i < 30; i += 1) step(g, far, ROOKIE, sequenceRng([]));
    assert.equal(g.mode, 'set');
    step(g, scene(CENTER_X_FT, BLUE_LINE_Y_FT - 1), ROOKIE, sequenceRng([]));
    assert.equal(g.mode, 'tracking');
});

test('tracking shuffles toward the puck side no faster than its lateral speed and stays in its zone', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5)); // angle error 0
    const s = scene(CENTER_X_FT + 20, 40);
    let maxStepFt = 0;
    for (let i = 0; i < 240; i += 1) {
        step(g, s, ROOKIE, sequenceRng([]));
        maxStepFt = Math.max(maxStepFt, Math.hypot(g.position.x - g.previousPosition.x, g.position.y - g.previousPosition.y));
        const fromNet = Math.hypot(g.position.x - CENTER_X_FT, g.position.y - GOAL_LINE_Y_FT);
        assert.ok(fromNet <= CREASE_RADIUS_FT + CREASE_EXIT_MAX_FT + EPS);
        assert.ok(g.position.y >= GOAL_LINE_Y_FT);
    }
    assert.equal(g.mode, 'tracking');
    assert.ok(g.position.x > CENTER_X_FT + 0.5, 'moved toward the puck side');
    assert.ok(maxStepFt <= ROOKIE.params.lateralSpeedFtPerS * FIXED_STEP_S + EPS);
});

test('deke roll: rng >= dekeReadChance bites, slides the wrong way about BITE_SHIFT_FT, freezes, then tracks', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    const s = scene(CENTER_X_FT, 40);
    step(g, s, ROOKIE, sequenceRng([]));
    const startX = g.position.x;
    s.skater.dekeSide = 1; // facing up, side +1 is to the left on screen (smaller x)
    const { events } = step(g, s, ROOKIE, sequenceRng([ROOKIE.params.dekeReadChance]), { didDekeThisStep: true });
    assert.deepEqual(events.map((e) => e.type), ['goalie_bit']);
    assert.equal(g.mode, 'bitten');
    const freezeSteps = Math.ceil(BITE_FREEZE_S / FIXED_STEP_S);
    for (let i = 0; i < freezeSteps - 2; i += 1) step(g, s, ROOKIE, sequenceRng([]));
    assert.equal(g.mode, 'bitten');
    const shift = g.position.x - startX;
    assert.ok(Math.abs(Math.abs(shift) - BITE_SHIFT_FT) < 0.05, `shift ${shift}`);
    assert.ok(shift > 0, 'went right while the skater deked left');
    for (let i = 0; i < 3; i += 1) step(g, s, ROOKIE, sequenceRng([]));
    assert.equal(g.mode, 'tracking');
});

test('deke roll: rng < dekeReadChance reads it and keeps tracking', () => {
    const g = createGoalie(PRO, constantRng(0.5));
    const s = scene(CENTER_X_FT, 40);
    step(g, s, PRO, sequenceRng([]));
    const { events } = step(g, s, PRO, sequenceRng([PRO.params.dekeReadChance - 0.01]), { didDekeThisStep: true });
    assert.deepEqual(events.map((e) => e.type), ['goalie_read']);
    assert.equal(g.mode, 'tracking');
});

test('no deke roll while set (sequenceRng([]) throws on any draw)', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    const { events } = step(g, scene(CENTER_X_FT, 95), ROOKIE, sequenceRng([]), { didDekeThisStep: true });
    assert.deepEqual(events, []);
});

test('poke: one roll on entering range, success lunges and emits poke within POKE_DURATION_S', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    step(g, scene(CENTER_X_FT, 40), ROOKIE, sequenceRng([]));
    const near = scene(g.position.x, g.position.y + 4);
    let poked = false;
    const rng = countingRng(constantRng(0));
    for (let i = 0; i < Math.ceil(POKE_DURATION_S / FIXED_STEP_S) && !poked; i += 1) {
        poked = step(g, near, ROOKIE, rng).events.some((e) => e.type === 'poke');
    }
    assert.ok(poked);
    assert.equal(rng.calls, 1);
    assert.equal(g.mode, 'recovering');
});

test('poke: a failed roll waits POKE_CHECK_INTERVAL_S before rolling again', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    step(g, scene(CENTER_X_FT, 40), ROOKIE, sequenceRng([]));
    const near = scene(g.position.x, g.position.y + 4);
    const rng = countingRng(constantRng(0.99));
    const steps = Math.round((2 * POKE_CHECK_INTERVAL_S) / FIXED_STEP_S);
    for (let i = 0; i < steps; i += 1) step(g, near, ROOKIE, rng);
    assert.equal(rng.calls, 2);
});

test('no poke roll for a puck out of range or not carried', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    step(g, scene(CENTER_X_FT, 40), ROOKIE, sequenceRng([]));
    for (let i = 0; i < 120; i += 1) step(g, scene(CENTER_X_FT, g.position.y + ROOKIE.params.pokeRangeFt + 4), ROOKIE, sequenceRng([]));
    const loose = scene(g.position.x, g.position.y + 3, { puckMode: 'loose' });
    for (let i = 0; i < 120; i += 1) step(g, loose, ROOKIE, sequenceRng([]));
    assert.equal(g.mode, 'tracking');
});

test('a shot: waits the reaction delay, then moves toward where the shot crosses its line', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    const s = scene(CENTER_X_FT, 30, { puckMode: 'shot', velocity: { x: 1.2, y: -40 } });
    s.skater.hasPuck = false;
    step(g, s, ROOKIE, sequenceRng([]), { isShotThisStep: true });
    assert.equal(g.mode, 'reacting');
    const startX = g.position.x;
    const delaySteps = Math.floor(ROOKIE.params.reactionDelayMs / 1000 / FIXED_STEP_S) - 1;
    for (let i = 0; i < delaySteps; i += 1) { flyPuck(s.puck); step(g, s, ROOKIE, sequenceRng([])); }
    assert.equal(g.position.x, startX, 'still during the reaction delay');
    for (let i = 0; i < 10; i += 1) { flyPuck(s.puck); step(g, s, ROOKIE, sequenceRng([])); }
    assert.ok(g.position.x > startX, 'moved toward the crossing point');
});

test('a wide-angle shot within dive reach starts a dive; reach grows; recovers after the shot ends', () => {
    const tier = PRO;
    const g = createGoalie(tier, constantRng(0.5));
    // Crossing point 1 ft past the goalie's reach (plus the puck radius), arriving just after the
    // reaction delay, so the goalie can't shuffle there in time and has to dive.
    const s = scene(CENTER_X_FT, 40, { puckMode: 'shot' });
    const gapFt = tier.params.saveReachFt + 0.5 + 1;
    const travelY = s.puck.position.y - g.position.y;
    const speedY = travelY / (tier.params.reactionDelayMs / 1000 + 0.02);
    s.puck.velocity = { x: (gapFt / travelY) * speedY, y: -speedY };
    s.skater.hasPuck = false;
    step(g, s, tier, sequenceRng([]), { isShotThisStep: true });
    let sawDive = false;
    for (let i = 0; i < 60 && !sawDive; i += 1) {
        flyPuck(s.puck);
        step(g, s, tier, sequenceRng([]));
        sawDive = g.mode === 'diving';
    }
    assert.ok(sawDive, 'dived');
    assert.equal(g.diveSide, 1);
    for (let i = 0; i < 30; i += 1) step(g, s, tier, sequenceRng([]));
    assert.ok(Math.abs(g.reachFt - tier.params.diveReachFt) < EPS);
    const capsule = getGoalieCapsule(g, s.puck.position);
    assert.ok(capsule.b.x - g.position.x > tier.params.saveReachFt - GOALIE_BODY_RADIUS_FT, 'extends on the dive side');
    s.puck.mode = 'absorbed';
    step(g, s, tier, sequenceRng([]));
    assert.equal(g.mode, 'recovering');
    const recoverSteps = Math.ceil(tier.params.diveRecoveryMs / 1000 / FIXED_STEP_S) + 1;
    const heldX = g.position.x;
    for (let i = 0; i < recoverSteps - 2; i += 1) step(g, s, tier, sequenceRng([]));
    assert.equal(g.position.x, heldX, 'does not move while recovering');
    for (let i = 0; i < 3; i += 1) step(g, s, tier, sequenceRng([]));
    assert.equal(g.mode, 'tracking');
    assert.equal(g.reachFt, tier.params.saveReachFt);
});

test('capsule: perpendicular to the puck→net line, half-length reach minus body radius', () => {
    const g = createGoalie(ROOKIE, constantRng(0.5));
    const straight = getGoalieCapsule(g, { x: CENTER_X_FT, y: 40 });
    const half = ROOKIE.params.saveReachFt - GOALIE_BODY_RADIUS_FT;
    assert.ok(Math.abs(straight.a.y - straight.b.y) < EPS, 'flat for a puck straight ahead');
    assert.ok(Math.abs(straight.b.x - straight.a.x - 2 * half) < EPS);
    assert.ok(straight.a.x < straight.b.x);
    assert.equal(straight.radiusFt, GOALIE_BODY_RADIUS_FT);
    const angled = getGoalieCapsule(g, { x: CENTER_X_FT + 20, y: 31 });
    const along = { x: angled.b.x - angled.a.x, y: angled.b.y - angled.a.y };
    const toNet = { x: -20, y: GOAL_LINE_Y_FT - 31 };
    assert.ok(Math.abs(along.x * toNet.x + along.y * toNet.y) < EPS, 'perpendicular');
});

test('same seed, same inputs: identical goalie paths (no hidden randomness)', () => {
    const run = () => {
        let value = 0.123;
        const rng = () => { value = (value * 9301 + 49297) % 233280 / 233280; return value; };
        const g = createGoalie(ROOKIE, rng);
        const path = [];
        for (let i = 0; i < 200; i += 1) {
            const s = scene(CENTER_X_FT + Math.sin(i / 20) * 15, 60 - i * 0.2);
            s.puck.previousPosition = { x: CENTER_X_FT + Math.sin((i - 1) / 20) * 15, y: s.puck.position.y };
            step(g, s, ROOKIE, rng, { didDekeThisStep: i % 50 === 0 });
            path.push(g.position.x, g.position.y, g.mode);
        }
        return path;
    };
    assert.deepEqual(run(), run());
});
