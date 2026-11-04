// Unit tests for src/core/puck.js (AC-3 carry, AC-4 shot velocity, AC-6 contacts and outcomes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPuck, carryPuck, createShotVelocity, updatePuck, setRebound } from '../../src/core/puck.js';
import { createSkater } from '../../src/core/skater.js';
import { getGoalMouth, isInsideBoards } from '../../src/core/rink.js';
import { createRng } from '../../src/core/random.js';
import { constantRng, countingRng, sequenceRng } from '../helpers/rng.js';
import {
    FIXED_STEP_S, PUCK_COLLISION_RADIUS_FT, POST_RADIUS_FT, LEFT_POST, RIGHT_POST, GOAL_LINE_Y_FT,
    NET_DEPTH_FT, CENTER_X_FT, RINK_WIDTH_FT, PUCK_CARRY_OFFSET_FT, PUCK_FRICTION_DECEL_FT_PER_S2,
    PUCK_STOP_SPEED_FT_PER_S, POST_RESTITUTION, BOARD_RESTITUTION, MAX_BOUNCES_PER_STEP,
    REBOUND_SPEED_FT_PER_S, REBOUND_MAX_ANGLE_DEG, GOALIE_BODY_RADIUS_FT, SHOT_SPEED_MIN_FT_PER_S,
    SHOT_SPEED_MAX_FT_PER_S, SPREAD_MAX_DEG, AIM_SHOT_SPEED_FT_PER_S, AIM_SPREAD_DEG,
    ONE_BUTTON_SHOT_SPEED_FT_PER_S, ONE_BUTTON_SPREAD_DEG, MIN_POWER, VISIBLE_MAX_Y_FT, START_FACING_RAD
} from '../../src/core/constants.js';

const DT = FIXED_STEP_S;
const R = PUCK_COLLISION_RADIUS_FT;
const DEG = Math.PI / 180;
const near = (actual, expected, tol = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const speedOf = (v) => Math.hypot(v.x, v.y);
const MOUTH = getGoalMouth();

function shotPuck(x, y, vx, vy, mode = 'shot') {
    return { position: { x, y }, previousPosition: { x, y }, velocity: { x: vx, y: vy }, mode, hasHitPost: false };
}
/** Steps until a predicate on the result is true or `steps` run out; returns all contacts. */
function runPuck(puck, steps, capsule = null) {
    const kinds = [];
    let last = null;
    for (let i = 0; i < steps; i++) {
        last = updatePuck(puck, DT, capsule);
        for (const c of last.contacts) kinds.push(c.kind);
        assert.ok(Number.isFinite(puck.position.x) && Number.isFinite(puck.position.y));
        if (last.didStop || last.didLeaveView) break;
    }
    return { kinds, last };
}

/* ---------- carry ---------- */

test('createPuck / carryPuck: on the stick in front of the facing, moving with the skater', () => {
    const s = createSkater();
    const puck = createPuck(s);
    assert.equal(puck.mode, 'carried');
    assert.equal(puck.hasHitPost, false);
    near(puck.position.x, s.position.x + Math.cos(START_FACING_RAD) * PUCK_CARRY_OFFSET_FT);
    near(puck.position.y, s.position.y + Math.sin(START_FACING_RAD) * PUCK_CARRY_OFFSET_FT);
    s.facingRad = 0;
    s.velocity = { x: 5, y: -2 };
    carryPuck(puck, s);
    near(puck.position.x, s.position.x + PUCK_CARRY_OFFSET_FT);
    near(puck.position.y, s.position.y);
    assert.deepEqual(puck.velocity, { x: 5, y: -2 });
    assert.notEqual(puck.velocity, s.velocity, 'copied, not shared');
});

test('carried puck is clamped inside the boards (wall and corner) and never behind the goal line', () => {
    const s = createSkater();
    const puck = createPuck(s);
    s.position = { x: 1.5, y: 50 };
    s.facingRad = Math.PI; // facing the left wall
    carryPuck(puck, s);
    assert.ok(isInsideBoards(puck.position, R));
    s.position = { x: 8, y: 14 };
    s.facingRad = -3 * Math.PI / 4; // into the corner arc
    carryPuck(puck, s);
    assert.ok(isInsideBoards(puck.position, R));
    s.position = { x: CENTER_X_FT, y: GOAL_LINE_Y_FT + 1.5 };
    s.facingRad = -Math.PI / 2;
    carryPuck(puck, s);
    assert.ok(puck.position.y >= GOAL_LINE_Y_FT);
});

test('carried and absorbed pucks do not move in updatePuck', () => {
    for (const mode of ['carried', 'absorbed']) {
        const puck = shotPuck(40, 40, 50, 0, mode);
        const out = updatePuck(puck, DT, null);
        assert.deepEqual(puck.position, { x: 40, y: 40 });
        assert.deepEqual(out, { contacts: [], didStop: false, didLeaveView: false });
    }
});

/* ---------- shot velocity ---------- */

test('hold_charge: speed rises with power from SHOT_SPEED_MIN to SHOT_SPEED_MAX; rng 0.5 is dead on facing', () => {
    let prev = 0;
    for (const power of [0, 0.25, 0.5, 0.75, 1]) {
        const v = createShotVelocity({ scheme: 'hold_charge', facingRad: -Math.PI / 2, origin: { x: 0, y: 0 },
            aimPoint: null, power, rng: constantRng(0.5) });
        const speed = speedOf(v);
        assert.ok(speed > prev);
        prev = speed;
        near(Math.atan2(v.y, v.x), -Math.PI / 2);
    }
    near(speedOf(createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power: 0,
        rng: constantRng(0.5) })), SHOT_SPEED_MIN_FT_PER_S);
    near(speedOf(createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power: 1,
        rng: constantRng(0.5) })), SHOT_SPEED_MAX_FT_PER_S);
    near(speedOf(createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power: 7,
        rng: constantRng(0.5) })), SHOT_SPEED_MAX_FT_PER_S, 1e-9);
    const tap = createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null,
        power: MIN_POWER, rng: constantRng(0.5) });
    assert.ok(speedOf(tap) > 0 && Number.isFinite(speedOf(tap)));
});

test('spread uses exactly one rng draw, is capped, and grows with power', () => {
    const counter = countingRng(constantRng(0.5));
    createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power: 1, rng: counter });
    assert.equal(counter.calls, 1);
    const edge = createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power: 1,
        rng: sequenceRng([0]) });
    near(Math.atan2(edge.y, edge.x), -SPREAD_MAX_DEG * DEG);

    const stats = (power) => {
        const rng = createRng(42);
        let sum = 0;
        let sumSq = 0;
        let maxAbs = 0;
        const n = 1000;
        for (let i = 0; i < n; i++) {
            const v = createShotVelocity({ scheme: 'hold_charge', facingRad: 0, origin: null, aimPoint: null, power, rng });
            const e = Math.atan2(v.y, v.x);
            sum += e;
            sumSq += e * e;
            maxAbs = Math.max(maxAbs, Math.abs(e));
        }
        const mean = sum / n;
        return { mean, sd: Math.sqrt(sumSq / n - mean * mean), maxAbs, n };
    };
    const low = stats(0.25);
    const high = stats(1);
    assert.ok(high.sd > low.sd);
    assert.ok(high.maxAbs <= SPREAD_MAX_DEG * DEG + 1e-12);
    assert.ok(Math.abs(high.mean) < 4 * high.sd / Math.sqrt(high.n), 'unbiased');
});

test('aim_mouse: toward the aim point at a fixed speed near or far; falls back to facing', () => {
    const origin = { x: 40, y: 40 };
    for (const aimPoint of [{ x: 43, y: 36 }, { x: 70, y: -0 }, { x: 10, y: 90 }, { x: -50, y: 300 }]) {
        const v = createShotVelocity({ scheme: 'aim_mouse', facingRad: 0, origin, aimPoint, power: 0, rng: constantRng(0.5) });
        near(speedOf(v), AIM_SHOT_SPEED_FT_PER_S);
        near(Math.atan2(v.y, v.x), Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x));
    }
    for (const aimPoint of [null, { x: 40, y: 40 }]) {
        const v = createShotVelocity({ scheme: 'aim_mouse', facingRad: 1, origin, aimPoint, power: 0, rng: constantRng(0.5) });
        near(Math.atan2(v.y, v.x), 1);
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
    }
    const wide = createShotVelocity({ scheme: 'aim_mouse', facingRad: 0, origin, aimPoint: { x: 50, y: 40 }, power: 0,
        rng: constantRng(0) });
    near(Math.atan2(wide.y, wide.x), -AIM_SPREAD_DEG * DEG);
    assert.ok(AIM_SPREAD_DEG < SPREAD_MAX_DEG);
});

test('one_button: fixed speed and spread, power ignored; unknown scheme is a TypeError', () => {
    for (const power of [0, 1]) {
        const v = createShotVelocity({ scheme: 'one_button', facingRad: 2, origin: null, aimPoint: null, power, rng: constantRng(0.5) });
        near(speedOf(v), ONE_BUTTON_SHOT_SPEED_FT_PER_S);
        near(Math.atan2(v.y, v.x), 2);
    }
    const edge = createShotVelocity({ scheme: 'one_button', facingRad: 0, origin: null, aimPoint: null, power: 0, rng: constantRng(0) });
    near(Math.atan2(edge.y, edge.x), -ONE_BUTTON_SPREAD_DEG * DEG);
    assert.throws(() => createShotVelocity({ scheme: 'nope', facingRad: 0, origin: null, aimPoint: null, power: 0,
        rng: constantRng(0.5) }), TypeError);
});

/* ---------- friction, stop, leaving the view ---------- */

test('friction slows a loose puck by the decel per step; below the stop speed it stops', () => {
    const puck = shotPuck(42.5, 60, 0, 10, 'loose');
    const out = updatePuck(puck, DT, null);
    near(puck.velocity.y, 10 - PUCK_FRICTION_DECEL_FT_PER_S2 * DT);
    assert.equal(out.didStop, false);
    assert.ok(puck.position.y > 60);
    const slow = shotPuck(42.5, 60, 0, PUCK_STOP_SPEED_FT_PER_S + 0.01, 'loose');
    let steps = 0;
    let result;
    do {
        result = updatePuck(slow, DT, null);
        steps += 1;
    } while (!result.didStop && steps < 10);
    assert.equal(result.didStop, true);
    assert.deepEqual(slow.velocity, { x: 0, y: 0 });
});

test('a puck past the visible box reports didLeaveView', () => {
    const puck = shotPuck(42.5, VISIBLE_MAX_Y_FT - 0.1, 0, 60);
    const out = updatePuck(puck, DT, null);
    assert.equal(out.didLeaveView, true);
});

/* ---------- goal line ---------- */

test('goal: whole puck across between the posts, one goal contact, then stays in the net', () => {
    const puck = shotPuck(CENTER_X_FT, 30, 0, -80);
    const { kinds } = runPuck(puck, 60);
    assert.deepEqual(kinds, ['goal']);
    assert.equal(puck.mode, 'in_net');
    for (let i = 0; i < 60; i++) {
        const out = updatePuck(puck, DT, null);
        assert.equal(out.contacts.length, 0);
        assert.ok(puck.position.y >= GOAL_LINE_Y_FT - NET_DEPTH_FT + R - 1e-9);
        assert.ok(puck.position.y <= GOAL_LINE_Y_FT - R + 1e-9);
        assert.ok(puck.position.x > MOUTH.leftInnerX && puck.position.x < MOUTH.rightInnerX);
    }
});

test('goal contact tStep is when the trailing edge clears the line', () => {
    const lineY = GOAL_LINE_Y_FT - R;
    const puck = shotPuck(CENTER_X_FT, lineY + 0.25, 0, -60);
    const out = updatePuck(puck, DT, null);
    assert.equal(out.contacts[0].kind, 'goal');
    const travel = 0.25;
    const stepFt = (60 - PUCK_FRICTION_DECEL_FT_PER_S2 * DT) * DT;
    near(out.contacts[0].tStep, travel / stepFt, 1e-9);
});

test('no goal with the trailing edge exactly on the line (stopped there)', () => {
    const puck = shotPuck(CENTER_X_FT, GOAL_LINE_Y_FT - R, 0, 0);
    const out = updatePuck(puck, DT, null);
    assert.equal(out.contacts.length, 0);
    assert.equal(out.didStop, true);
    assert.notEqual(puck.mode, 'in_net');
    const onLine = shotPuck(CENTER_X_FT, GOAL_LINE_Y_FT, 0, 0, 'loose');
    assert.equal(updatePuck(onLine, DT, null).contacts.length, 0);
});

test('entry beside a post: just clear is a clean goal, just inside touches the post', () => {
    const clearX = MOUTH.leftInnerX + R + 1e-6;
    const clean = shotPuck(clearX, 20, 0, -80);
    const a = runPuck(clean, 30);
    assert.deepEqual(a.kinds, ['goal']);
    assert.equal(clean.hasHitPost, false);
    const touch = shotPuck(MOUTH.leftInnerX + R - 1e-6, 20, 0, -80);
    const b = runPuck(touch, 30);
    assert.equal(b.kinds[0], 'post');
    assert.equal(touch.hasHitPost, true);
});

test('post: dead-center hit reflects along the normal with POST_RESTITUTION; one contact', () => {
    const puck = shotPuck(LEFT_POST.x, 12, 0, -60);
    const out = updatePuck(puck, DT, null);
    assert.deepEqual(out.contacts.map((c) => c.kind), ['post']);
    const vIn = 60 - PUCK_FRICTION_DECEL_FT_PER_S2 * DT;
    near(puck.velocity.y, vIn * POST_RESTITUTION, 1e-9);
    near(puck.velocity.x, 0, 1e-9);
    assert.ok(Math.hypot(puck.position.x - LEFT_POST.x, puck.position.y - LEFT_POST.y) >= R + POST_RADIUS_FT - 1e-9,
        'never inside the post; the rest of the step continues after the bounce');
    assert.equal(updatePuck(puck, DT, null).contacts.length, 0, 'no second contact while moving away');
});

test('post and in: a glancing hit from inside the posts deflects into the net', () => {
    const puck = shotPuck(MOUTH.leftInnerX + R - 0.1, 20, 0, -80);
    const { kinds } = runPuck(puck, 60);
    assert.deepEqual(kinds, ['post', 'goal']);
    assert.equal(puck.mode, 'in_net');
});

test('wide: crossing the goal line outside the posts is not a goal', () => {
    const puck = shotPuck(LEFT_POST.x - POST_RADIUS_FT - R - 0.01, 20, 0, -80);
    const { kinds } = runPuck(puck, 400);
    assert.ok(!kinds.includes('goal') && !kinds.includes('post'));
    assert.notEqual(puck.mode, 'in_net');
});

/* ---------- goalie ---------- */

const capsuleAt = (y, half = 2) => ({ a: { x: CENTER_X_FT - half, y }, b: { x: CENTER_X_FT + half, y }, radiusFt: GOALIE_BODY_RADIUS_FT });

test('goalie contact stops the puck on the pads (absorbed) before the line', () => {
    const puck = shotPuck(CENTER_X_FT, 30, 0, -100);
    const { kinds } = runPuck(puck, 60, capsuleAt(14));
    assert.deepEqual(kinds, ['goalie']);
    assert.equal(puck.mode, 'absorbed');
    assert.deepEqual(puck.velocity, { x: 0, y: 0 });
    assert.ok(puck.position.y >= 14 + GOALIE_BODY_RADIUS_FT + R - 1e-6);
});

test('goalie and full crossing in the same step: earlier wins; a tie is a save (Q15)', () => {
    const lineY = GOAL_LINE_Y_FT - R;
    // Goalie touch exactly when the trailing edge clears the line.
    const tie = shotPuck(CENTER_X_FT, lineY + 0.5, 0, -100);
    const out = updatePuck(tie, DT, capsuleAt(lineY - GOALIE_BODY_RADIUS_FT - R));
    assert.equal(out.contacts[0].kind, 'goalie');
    // Goalie deeper in the net than the crossing: the goal comes first.
    const goal = shotPuck(CENTER_X_FT, lineY + 0.2, 0, -100);
    const out2 = updatePuck(goal, DT, capsuleAt(lineY - GOALIE_BODY_RADIUS_FT - R - 0.3));
    assert.equal(out2.contacts[0].kind, 'goal');
});

/* ---------- boards, corners, bounces, tunneling ---------- */

test('side board bounce keeps the tangent and scales the normal by BOARD_RESTITUTION', () => {
    const puck = shotPuck(0.8, 60, -60, -10);
    const out = updatePuck(puck, DT, null);
    assert.deepEqual(out.contacts.map((c) => c.kind), ['board']);
    const k = (Math.hypot(60, 10) - PUCK_FRICTION_DECEL_FT_PER_S2 * DT) / Math.hypot(60, 10);
    near(puck.velocity.x, 60 * k * BOARD_RESTITUTION, 1e-9);
    near(puck.velocity.y, -10 * k, 1e-9);
    assert.ok(puck.position.x >= R - 1e-9);
});

test('corner bounce: stays inside the arc every step and comes back out of the corner', () => {
    const puck = shotPuck(20, 30, -60, -60);
    const { kinds } = runPuck(puck, 120);
    assert.ok(kinds.includes('board'));
    const again = shotPuck(20, 30, -60, -60);
    for (let i = 0; i < 120; i++) {
        updatePuck(again, DT, null);
        assert.ok(isInsideBoards(again.position, R) || again.mode === 'in_net', `step ${i}`);
    }
    const right = shotPuck(RINK_WIDTH_FT - 20, 30, 60, -60);
    for (let i = 0; i < 120; i++) {
        updatePuck(right, DT, null);
        assert.ok(isInsideBoards(right.position, R), `right step ${i}`);
    }
});

test('bank shot: off the side board and in; slightly off is wide', () => {
    // Pre-bounce direction chosen so the post-bounce path from (0.5, 30) heads at the net center.
    const make = (aimX) => {
        const post = { x: aimX - R, y: -19 };
        const dir = { x: -(aimX - R) / BOARD_RESTITUTION, y: -19 };
        const len = Math.hypot(dir.x, dir.y);
        const start = { x: R - dir.x * 0.4, y: 30 - dir.y * 0.4 };
        void post;
        return shotPuck(start.x, start.y, (dir.x / len) * 100, (dir.y / len) * 100);
    };
    const inPuck = make(CENTER_X_FT);
    const a = runPuck(inPuck, 300);
    assert.deepEqual(a.kinds.slice(0, 2), ['board', 'goal']);
    const widePuck = make(CENTER_X_FT + 12);
    const b = runPuck(widePuck, 300);
    assert.equal(b.kinds[0], 'board');
    assert.ok(!b.kinds.includes('goal'));
});

test('at most MAX_BOUNCES_PER_STEP bounces in one step, and still inside', () => {
    const puck = shotPuck(42.5, 50, 400, 0);
    const out = updatePuck(puck, 1, null);
    assert.ok(out.contacts.length <= MAX_BOUNCES_PER_STEP);
    assert.equal(out.contacts.length, MAX_BOUNCES_PER_STEP);
    assert.ok(isInsideBoards(puck.position, R));
    for (let i = 1; i < out.contacts.length; i++) assert.ok(out.contacts[i].tStep >= out.contacts[i - 1].tStep);
});

test('no tunneling at 2x max shot speed: posts, goalie and boards all catch the puck', () => {
    const fast = 2 * SHOT_SPEED_MAX_FT_PER_S;
    const atPost = shotPuck(RIGHT_POST.x, 13, 0, -fast);
    assert.ok(runPuck(atPost, 10).kinds.includes('post'));
    const atGoalie = shotPuck(CENTER_X_FT + 1, 25, 0, -fast);
    assert.deepEqual(runPuck(atGoalie, 30, { a: { x: 41, y: 14 }, b: { x: 44, y: 14 }, radiusFt: 0.1 }).kinds, ['goalie']);
    for (const angle of [Math.PI, 0, -Math.PI / 2, -3 * Math.PI / 4, -Math.PI / 4]) {
        const p = shotPuck(42.5, 40, Math.cos(angle) * fast, Math.sin(angle) * fast);
        for (let i = 0; i < 240; i++) {
            updatePuck(p, DT, null);
            assert.ok(isInsideBoards(p.position, R) || p.mode === 'in_net' || p.position.y > 100, `angle ${angle} step ${i}`);
        }
    }
});

test('updatePuck throws TypeError on programmer errors', () => {
    assert.throws(() => updatePuck(null, DT, null), TypeError);
    assert.throws(() => updatePuck(shotPuck(1, 1, 0, 0), NaN, null), TypeError);
});

/* ---------- rebounds ---------- */

test('setRebound: loose, REBOUND_SPEED out into the slot within the max angle, one draw, clear of the goalie', () => {
    const goalie = { x: CENTER_X_FT, y: 14 };
    const counter = countingRng(constantRng(0.5));
    const puck = shotPuck(CENTER_X_FT, 15, 0, 0, 'absorbed');
    setRebound(puck, goalie, counter);
    assert.equal(counter.calls, 1);
    assert.equal(puck.mode, 'loose');
    near(speedOf(puck.velocity), REBOUND_SPEED_FT_PER_S);
    near(puck.velocity.x, 0, 1e-9);
    assert.ok(puck.velocity.y > 0, 'out toward center ice');
    assert.ok(Math.hypot(puck.position.x - goalie.x, puck.position.y - goalie.y) > GOALIE_BODY_RADIUS_FT + R);
    assert.deepEqual(puck.previousPosition, puck.position);
    for (const [value, sign] of [[0, -1], [0.999999, 1]]) {
        const p = shotPuck(0, 0, 0, 0, 'absorbed');
        setRebound(p, goalie, constantRng(value));
        const off = Math.atan2(p.velocity.y, p.velocity.x) - Math.PI / 2;
        near(off, sign * REBOUND_MAX_ANGLE_DEG * DEG, 1e-5);
    }
});
