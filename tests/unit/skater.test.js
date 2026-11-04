// Unit tests for src/core/skater.js (AC-3 skating, AC-4 charge, AC-5 deke rules, Q11, Q13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkater, updateSkater, pushOutOfGoalie, getChargePower } from '../../src/core/skater.js';
import { isInsideBoards } from '../../src/core/rink.js';
import { createRng } from '../../src/core/random.js';
import {
    FIXED_STEP_S, MAX_FRAME_DT_S, CENTER_DOT, START_FACING_RAD, SKATER_MAX_SPEED_FT_PER_S,
    SKATER_MAX_SPEED_WITH_PUCK_FT_PER_S, SKATER_ACCEL_FT_PER_S2, SKATER_GLIDE_DECEL_FT_PER_S2,
    SKATER_RADIUS_FT, GOAL_LINE_Y_FT, VISIBLE_MAX_Y_FT, RINK_WIDTH_FT, CENTER_X_FT, LEFT_POST, RIGHT_POST,
    DEKE_SPEED_FT_PER_S, DEKE_DURATION_S, DEKE_COOLDOWN_S, CHARGE_FULL_S, MIN_POWER, GOALIE_BODY_RADIUS_FT,
    SKATER_TURN_RATE_RAD_PER_S
} from '../../src/core/constants.js';

const DT = FIXED_STEP_S;
const near = (actual, expected, tol = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const speedOf = (s) => Math.hypot(s.velocity.x, s.velocity.y);

/** @returns {import('../../src/core/types.js').Intent} */
function intent(overrides = {}) {
    return {
        moveX: 0, moveY: 0, isShootHeld: false, shootPressed: false, shootReleased: false,
        aimPoint: null, dekePressed: false, dekeSide: 0, ...overrides
    };
}
function run(skater, input, steps, scheme = 'hold_charge', dt = DT) {
    for (let i = 0; i < steps; i++) updateSkater(skater, input, scheme, dt);
    return skater;
}
function freeSkater(x = 42.5, y = 60) {
    const s = createSkater();
    s.position.x = x;
    s.position.y = y;
    s.hasPuck = false;
    return s;
}

test('createSkater: center dot, still, facing up, with the puck, no charge', () => {
    const s = createSkater();
    assert.deepEqual(s.position, { x: CENTER_DOT.x, y: CENTER_DOT.y });
    assert.deepEqual(s.velocity, { x: 0, y: 0 });
    assert.equal(s.facingRad, START_FACING_RAD);
    assert.equal(s.hasPuck, true);
    assert.equal(s.chargeHeldS, 0);
    assert.equal(s.isCharging, false);
    assert.notEqual(createSkater().position, s.position, 'fresh objects each time');
});

test('zero input at rest stays exactly still for 120 steps', () => {
    const s = createSkater();
    run(s, intent(), 120);
    assert.deepEqual(s.position, { x: CENTER_DOT.x, y: CENTER_DOT.y });
    assert.deepEqual(s.velocity, { x: 0, y: 0 });
    assert.equal(s.facingRad, START_FACING_RAD);
});

test('acceleration: rises each step, never over max, reaches max on time', () => {
    const s = freeSkater(10, 60);
    const expectedSteps = Math.ceil(SKATER_MAX_SPEED_FT_PER_S / (SKATER_ACCEL_FT_PER_S2 * DT));
    let previous = 0;
    let reachedAt = -1;
    for (let i = 1; i <= expectedSteps + 5; i++) {
        updateSkater(s, intent({ moveX: 1 }), 'hold_charge', DT);
        const v = speedOf(s);
        assert.ok(v <= SKATER_MAX_SPEED_FT_PER_S + 1e-9);
        assert.ok(v >= previous - 1e-12);
        if (reachedAt < 0 && Math.abs(v - SKATER_MAX_SPEED_FT_PER_S) < 1e-9) reachedAt = i;
        previous = v;
    }
    assert.ok(Math.abs(reachedAt - expectedSteps) <= 1, `reached at ${reachedAt}, expected ${expectedSteps}`);
});

test('carrying the puck caps speed lower', () => {
    const s = createSkater();
    run(s, intent({ moveY: -1 }), 120);
    near(speedOf(s), SKATER_MAX_SPEED_WITH_PUCK_FT_PER_S);
});

test('glide: speed decays linearly to exactly 0, never reverses, travels forward', () => {
    const s = freeSkater(10, 60);
    run(s, intent({ moveX: 1 }), 120);
    const v0 = speedOf(s);
    const x0 = s.position.x;
    run(s, intent(), 60);
    near(speedOf(s), v0 - SKATER_GLIDE_DECEL_FT_PER_S2 * 0.5, 1e-6);
    assert.ok(s.position.x > x0);
    let previous = speedOf(s);
    for (let i = 0; i < 600; i++) {
        updateSkater(s, intent(), 'hold_charge', DT);
        assert.ok(s.velocity.x >= 0, 'never reverses');
        assert.ok(speedOf(s) <= previous);
        previous = speedOf(s);
    }
    assert.deepEqual(s.velocity, { x: 0, y: 0 });
});

test('diagonal input is normalized in all four directions; partial deflection scales; >1 is clamped', () => {
    for (const [mx, my] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const s = freeSkater(42.5, 60);
        run(s, intent({ moveX: mx, moveY: my }), 100);
        near(speedOf(s), SKATER_MAX_SPEED_FT_PER_S);
    }
    const half = freeSkater();
    run(half, intent({ moveX: 0.5 }), 120);
    near(speedOf(half), SKATER_MAX_SPEED_FT_PER_S / 2);
    const over = freeSkater();
    run(over, intent({ moveX: 3 }), 120);
    near(speedOf(over), SKATER_MAX_SPEED_FT_PER_S);
    const cancel = freeSkater();
    run(cancel, intent({ moveX: 0, moveY: 0 }), 10);
    assert.deepEqual(cancel.velocity, { x: 0, y: 0 });
});

test('facing: turns toward motion by the shortest arc at the turn rate; holds while stopped', () => {
    const s = freeSkater();
    s.facingRad = 0;
    run(s, intent({ moveX: 1 }), 30);
    near(s.facingRad, 0);
    // Reverse: facing must pass through +-PI/2 (short way), never jump by more than the turn rate.
    const maxTurn = SKATER_TURN_RATE_RAD_PER_S * DT + 1e-9;
    let prev = s.facingRad;
    for (let i = 0; i < 120; i++) {
        updateSkater(s, intent({ moveX: -1, moveY: -0.01 }), 'hold_charge', DT);
        let d = Math.abs(s.facingRad - prev);
        if (d > Math.PI) d = 2 * Math.PI - d;
        assert.ok(d <= maxTurn, `turned ${d}`);
        prev = s.facingRad;
    }
    assert.ok(Math.abs(Math.abs(s.facingRad) - Math.PI) < 0.05);
    run(s, intent(), 600);
    const stopped = s.facingRad;
    run(s, intent(), 60);
    assert.equal(s.facingRad, stopped, 'no snap when stopped');
});

test('facing stays finite and in (-PI, PI] over 10,000 random inputs', () => {
    const rng = createRng(7);
    const s = createSkater();
    for (let i = 0; i < 10000; i++) {
        updateSkater(s, intent({ moveX: rng() * 2 - 1, moveY: rng() * 2 - 1, dekePressed: rng() < 0.05 }), 'hold_charge', DT);
        assert.ok(Number.isFinite(s.facingRad) && s.facingRad > -Math.PI - 1e-12 && s.facingRad <= Math.PI + 1e-12);
        assert.ok(Number.isFinite(s.position.x) && Number.isFinite(s.position.y));
    }
});

test('boards: clamps at the wall, removes the velocity into it, keeps the slide', () => {
    const left = freeSkater(5, 60);
    run(left, intent({ moveX: -1, moveY: 0.5 }), 120);
    near(left.position.x, SKATER_RADIUS_FT);
    near(left.velocity.x, 0);
    assert.ok(left.velocity.y > 0);
    const right = freeSkater(80, 60);
    run(right, intent({ moveX: 1, moveY: -0.3 }), 60);
    near(right.position.x, RINK_WIDTH_FT - SKATER_RADIUS_FT);
    near(right.velocity.x, 0);
    const back = freeSkater(42.5, 100);
    run(back, intent({ moveY: 1 }), 120);
    near(back.position.y, VISIBLE_MAX_Y_FT);
    near(back.velocity.y, 0);
});

test('goal line: cannot get behind it at the mouth, the posts, or the far corners', () => {
    const minY = GOAL_LINE_Y_FT + SKATER_RADIUS_FT;
    for (const x of [CENTER_X_FT, LEFT_POST.x, RIGHT_POST.x, 8, RINK_WIDTH_FT - 8]) {
        const s = freeSkater(x, 25);
        run(s, intent({ moveY: -1 }), 360);
        assert.ok(s.position.y >= minY - 1e-9, `x=${x}: y=${s.position.y}`);
        assert.ok(isInsideBoards(s.position, SKATER_RADIUS_FT));
    }
});

test('pinned in each corner for 10 s: inside, settles without jitter, then escapes', () => {
    const cases = [[-1, -1, 10, 20], [1, -1, 75, 20], [-1, 1, 10, 95], [1, 1, 75, 95]];
    for (const [mx, my, sx, sy] of cases) {
        const s = freeSkater(sx, sy);
        let atNine = null;
        for (let i = 0; i < 1200; i++) {
            updateSkater(s, intent({ moveX: mx, moveY: my }), 'hold_charge', DT);
            assert.ok(isInsideBoards(s.position, SKATER_RADIUS_FT));
            assert.ok(s.position.y >= GOAL_LINE_Y_FT + SKATER_RADIUS_FT - 1e-9 && s.position.y <= VISIBLE_MAX_Y_FT);
            if (i === 1079) atNine = { ...s.position };
        }
        assert.ok(Math.hypot(s.position.x - atNine.x, s.position.y - atNine.y) < 0.01);
        const pinned = { ...s.position };
        run(s, intent({ moveX: -mx, moveY: -my }), 60);
        assert.ok(Math.hypot(s.position.x - pinned.x, s.position.y - pinned.y) > 1, 'moves out within 0.5 s');
    }
});

test('large step (MAX_FRAME_DT_S) at full speed into a wall stays inside', () => {
    const s = freeSkater(2, 60);
    s.velocity.x = -SKATER_MAX_SPEED_FT_PER_S;
    updateSkater(s, intent({ moveX: -1 }), 'hold_charge', MAX_FRAME_DT_S);
    assert.ok(isInsideBoards(s.position, SKATER_RADIUS_FT));
});

test('deke: sideways shove of DEKE_SPEED for DEKE_DURATION, toward the held side', () => {
    const s = createSkater(); // facing up, has the puck
    s.position.y = 60;
    const { didDeke } = updateSkater(s, intent({ dekePressed: true, dekeSide: 1 }), 'hold_charge', DT);
    assert.equal(didDeke, true);
    run(s, intent(), Math.ceil(DEKE_DURATION_S / DT) + 5);
    near(s.position.x - CENTER_X_FT, DEKE_SPEED_FT_PER_S * DEKE_DURATION_S, 1e-9);
    near(s.position.y, 60, 1e-9);
    assert.equal(s.dekeTimeLeftS, 0);
    assert.deepEqual(s.velocity, { x: 0, y: 0 }, 'deke does not add lasting speed');
    const left = createSkater();
    left.position.y = 60;
    updateSkater(left, intent({ dekePressed: true, dekeSide: -1 }), 'hold_charge', DT);
    run(left, intent(), 40);
    assert.ok(left.position.x < CENTER_X_FT);
});

test('deke: alternates sides with no side held; cooldown blocks until it expires', () => {
    const s = createSkater();
    s.position.y = 60;
    updateSkater(s, intent({ dekePressed: true }), 'hold_charge', DT);
    const firstSide = s.dekeSide;
    const cooldownSteps = Math.round(DEKE_COOLDOWN_S / DT);
    for (let i = 1; i < cooldownSteps; i++) {
        assert.equal(updateSkater(s, intent({ dekePressed: true }), 'hold_charge', DT).didDeke, false, `step ${i}`);
    }
    assert.equal(updateSkater(s, intent({ dekePressed: true }), 'hold_charge', DT).didDeke, true);
    assert.equal(s.dekeSide, -firstSide);
});

test('deke: ignored without the puck and in one_button; keeps a charge (Q13)', () => {
    const noPuck = freeSkater();
    assert.equal(updateSkater(noPuck, intent({ dekePressed: true, dekeSide: 1 }), 'hold_charge', DT).didDeke, false);
    assert.equal(noPuck.dekeTimeLeftS, 0);
    const oneButton = createSkater();
    assert.equal(updateSkater(oneButton, intent({ dekePressed: true, dekeSide: 1 }), 'one_button', DT).didDeke, false);
    assert.equal(updateSkater(createSkater(), intent({ dekePressed: true }), 'aim_mouse', DT).didDeke, true);

    const s = createSkater();
    updateSkater(s, intent({ isShootHeld: true, shootPressed: true }), 'hold_charge', DT);
    run(s, intent({ isShootHeld: true }), 30);
    const before = s.chargeHeldS;
    updateSkater(s, intent({ isShootHeld: true, dekePressed: true, dekeSide: 1 }), 'hold_charge', DT);
    assert.equal(s.isCharging, true);
    near(s.chargeHeldS, before + DT);
    const power = getChargePower(s.chargeHeldS);
    assert.ok(power >= 0 && power <= 1 && Number.isFinite(power));
});

test('charge: needs a fresh press, grows while held, kept on release, cleared without the puck', () => {
    const held = createSkater();
    run(held, intent({ isShootHeld: true }), 60);
    assert.equal(held.isCharging, false, 'a key held from before the attempt does not charge (Q14)');
    assert.equal(held.chargeHeldS, 0);

    const s = createSkater();
    updateSkater(s, intent({ isShootHeld: true, shootPressed: true }), 'hold_charge', DT);
    assert.equal(s.isCharging, true);
    run(s, intent({ isShootHeld: true }), 60);
    near(s.chargeHeldS, 60 * DT, 1e-9);
    updateSkater(s, intent({ shootReleased: true }), 'hold_charge', DT);
    assert.equal(s.isCharging, false);
    near(s.chargeHeldS, 60 * DT, 1e-9, 'kept for the caller to fire');
    s.hasPuck = false;
    updateSkater(s, intent(), 'hold_charge', DT);
    assert.equal(s.chargeHeldS, 0);

    const tap = createSkater();
    updateSkater(tap, intent({ shootPressed: true, shootReleased: true }), 'hold_charge', DT);
    assert.equal(tap.isCharging, false);
    assert.equal(getChargePower(tap.chargeHeldS), MIN_POWER);

    const other = createSkater();
    updateSkater(other, intent({ isShootHeld: true, shootPressed: true }), 'one_button', DT);
    assert.equal(other.isCharging, false);
});

test('getChargePower: linear, MIN_POWER floor, exactly 1 at and past full, finite on junk', () => {
    assert.equal(getChargePower(0), MIN_POWER);
    near(getChargePower(CHARGE_FULL_S / 2), 0.5);
    assert.equal(getChargePower(CHARGE_FULL_S), 1);
    assert.equal(getChargePower(5), 1);
    assert.equal(getChargePower(NaN), MIN_POWER);
    assert.equal(getChargePower(-1), MIN_POWER);
    let prev = 0;
    for (let t = 0; t <= 1.5; t += 0.05) {
        const p = getChargePower(t);
        assert.ok(p >= prev);
        prev = p;
    }
});

test('pushOutOfGoalie: pushed to the capsule surface, velocity into it removed, never through', () => {
    const a = { x: CENTER_X_FT - 2, y: 15 };
    const b = { x: CENTER_X_FT + 2, y: 15 };
    const minDist = GOALIE_BODY_RADIUS_FT + SKATER_RADIUS_FT;
    const s = freeSkater(CENTER_X_FT, 16);
    s.previousPosition = { x: CENTER_X_FT, y: 18 };
    s.velocity = { x: 3, y: -20 };
    pushOutOfGoalie(s, a, b, GOALIE_BODY_RADIUS_FT);
    near(s.position.y, 15 + minDist);
    near(s.velocity.y, 0);
    near(s.velocity.x, 3);
    // Center crossed the segment this step: goes back to the side it came from.
    const crossed = freeSkater(CENTER_X_FT, 14.9);
    crossed.previousPosition = { x: CENTER_X_FT, y: 15.5 };
    pushOutOfGoalie(crossed, a, b, GOALIE_BODY_RADIUS_FT);
    assert.ok(crossed.position.y > 15);
    // Outside: untouched.
    const clear = freeSkater(CENTER_X_FT, 30);
    clear.previousPosition = { x: CENTER_X_FT, y: 30 };
    pushOutOfGoalie(clear, a, b, GOALIE_BODY_RADIUS_FT);
    assert.deepEqual(clear.position, { x: CENTER_X_FT, y: 30 });
});

test('skating into the goalie every step for 3 s never passes through', () => {
    const a = { x: CENTER_X_FT - 2, y: 15 };
    const b = { x: CENTER_X_FT + 2, y: 15 };
    const s = freeSkater(CENTER_X_FT + 0.3, 40);
    for (let i = 0; i < 360; i++) {
        updateSkater(s, intent({ moveY: -1 }), 'hold_charge', DT);
        pushOutOfGoalie(s, a, b, GOALIE_BODY_RADIUS_FT);
        assert.ok(s.position.y > 15, `step ${i}`);
    }
});

test('throws TypeError on programmer errors', () => {
    assert.throws(() => updateSkater(null, intent(), 'hold_charge', DT), TypeError);
    assert.throws(() => updateSkater(createSkater(), null, 'hold_charge', DT), TypeError);
    assert.throws(() => updateSkater(createSkater(), intent(), 'hold_charge', NaN), TypeError);
});
