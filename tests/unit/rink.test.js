// Unit tests for src/core/rink.js (AC-3 walls/corners/goal line, AC-6 goal mouth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getGoalMouth, isInsideBoards, collideWithBoards, clampToSkaterZone, getSquareUpPoint
} from '../../src/core/rink.js';
import {
    RINK_WIDTH_FT, CORNER_RADIUS_FT, GOAL_LINE_Y_FT, VISIBLE_MAX_Y_FT, SKATER_RADIUS_FT, LEFT_POST,
    RIGHT_POST, POST_RADIUS_FT, CENTER_X_FT, PUCK_COLLISION_RADIUS_FT, BOARD_RESTITUTION,
    CREASE_RADIUS_FT, CREASE_EXIT_MAX_FT
} from '../../src/core/constants.js';

const near = (actual, expected, tol = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const R = PUCK_COLLISION_RADIUS_FT;

test('goal mouth uses the inner post edges and the goal line', () => {
    const mouth = getGoalMouth();
    near(mouth.leftInnerX, LEFT_POST.x + POST_RADIUS_FT);
    near(mouth.rightInnerX, RIGHT_POST.x - POST_RADIUS_FT);
    assert.equal(mouth.lineY, GOAL_LINE_Y_FT);
    assert.ok(mouth.leftInnerX < CENTER_X_FT && CENTER_X_FT < mouth.rightInnerX);
});

test('isInsideBoards: straight walls inclusive at touching, corners use the arc', () => {
    assert.ok(isInsideBoards({ x: 42.5, y: 50 }, R));
    assert.ok(isInsideBoards({ x: R, y: 50 }, R), 'touching the left wall is inside');
    assert.ok(!isInsideBoards({ x: R - 1e-6, y: 50 }, R));
    assert.ok(!isInsideBoards({ x: RINK_WIDTH_FT - R + 1e-6, y: 50 }, R));
    assert.ok(isInsideBoards({ x: 42.5, y: R }, R));
    assert.ok(!isInsideBoards({ x: 42.5, y: R - 1e-6 }, R));
    // The square corner of the bounding box is outside the rounded corner.
    assert.ok(!isInsideBoards({ x: 2, y: 2 }, R));
    assert.ok(!isInsideBoards({ x: RINK_WIDTH_FT - 2, y: 2 }, R));
    // On the arc at 45 degrees, inset by the radius.
    const d = (CORNER_RADIUS_FT - R) / Math.SQRT2;
    assert.ok(isInsideBoards({ x: CORNER_RADIUS_FT - d, y: CORNER_RADIUS_FT - d }, R));
    // The open center-ice side has no board.
    assert.ok(isInsideBoards({ x: 42.5, y: 200 }, R));
});

test('collideWithBoards: straight walls clamp and bounce with restitution, tangent kept', () => {
    const left = collideWithBoards({ x: -0.2, y: 50 }, { x: -10, y: 4 }, R, BOARD_RESTITUTION);
    assert.ok(left.didHit);
    near(left.position.x, R);
    near(left.velocity.x, 10 * BOARD_RESTITUTION);
    near(left.velocity.y, 4);
    const right = collideWithBoards({ x: 90, y: 50 }, { x: 10, y: -4 }, R, 0);
    near(right.position.x, RINK_WIDTH_FT - R);
    near(right.velocity.x, 0);
    near(right.velocity.y, -4);
    const end = collideWithBoards({ x: 42.5, y: -1 }, { x: 3, y: -20 }, R, BOARD_RESTITUTION);
    near(end.position.y, R);
    near(end.velocity.y, 20 * BOARD_RESTITUTION);
    near(end.velocity.x, 3);
    const none = collideWithBoards({ x: 42.5, y: 50 }, { x: 3, y: -20 }, R, BOARD_RESTITUTION);
    assert.equal(none.didHit, false);
    assert.deepEqual(none.velocity, { x: 3, y: -20 });
});

test('collideWithBoards: corners push back onto the arc and bounce along its normal', () => {
    for (const [px, cx] of [[1, CORNER_RADIUS_FT], [RINK_WIDTH_FT - 1, RINK_WIDTH_FT - CORNER_RADIUS_FT]]) {
        const out = collideWithBoards({ x: px, y: 1 }, { x: px < 40 ? -10 : 10, y: -10 }, R, BOARD_RESTITUTION);
        assert.ok(out.didHit);
        near(Math.hypot(out.position.x - cx, out.position.y - CORNER_RADIUS_FT), CORNER_RADIUS_FT - R, 1e-9);
        assert.ok(isInsideBoards(out.position, R));
        // Velocity now points back in (toward the corner center), slower.
        const nx = cx - out.position.x;
        const ny = CORNER_RADIUS_FT - out.position.y;
        assert.ok(out.velocity.x * nx + out.velocity.y * ny > 0);
        assert.ok(Math.hypot(out.velocity.x, out.velocity.y) < Math.hypot(10, 10));
    }
});

test('collideWithBoards does not change its inputs', () => {
    const p = { x: -1, y: 50 };
    const v = { x: -5, y: 0 };
    collideWithBoards(p, v, R, 0.6);
    assert.deepEqual(p, { x: -1, y: 50 });
    assert.deepEqual(v, { x: -5, y: 0 });
});

test('clampToSkaterZone: no going behind the goal line, at the mouth, posts and far corners', () => {
    const minY = GOAL_LINE_Y_FT + SKATER_RADIUS_FT;
    for (const x of [CENTER_X_FT, LEFT_POST.x, RIGHT_POST.x, 20, 65]) {
        const p = clampToSkaterZone({ x, y: 2 });
        assert.ok(p.y >= minY - 1e-9, `x=${x} y=${p.y}`);
        assert.ok(isInsideBoards(p, SKATER_RADIUS_FT));
    }
    // Far corners of the goal line, where the corner arc meets the goal-line limit.
    for (const x of [0, RINK_WIDTH_FT]) {
        const p = clampToSkaterZone({ x, y: 0 });
        assert.ok(p.y >= minY - 1e-9);
        assert.ok(isInsideBoards(p, SKATER_RADIUS_FT));
    }
    near(clampToSkaterZone({ x: 42.5, y: 500 }).y, VISIBLE_MAX_Y_FT);
    assert.deepEqual(clampToSkaterZone({ x: 42.5, y: 50 }), { x: 42.5, y: 50 });
    near(clampToSkaterZone({ x: -4, y: 50 }).x, SKATER_RADIUS_FT);
});

test('getSquareUpPoint: on the puck-to-net line at depth, straight out for a centered puck', () => {
    const straight = getSquareUpPoint({ x: CENTER_X_FT, y: 40 }, 3, 0);
    near(straight.x, CENTER_X_FT);
    near(straight.y, GOAL_LINE_Y_FT + 3);
    const angled = getSquareUpPoint({ x: CENTER_X_FT + 20, y: GOAL_LINE_Y_FT + 20 }, 4, 0);
    near(angled.x - CENTER_X_FT, 4 / Math.SQRT2);
    near(angled.y - GOAL_LINE_Y_FT, 4 / Math.SQRT2);
    const onNet = getSquareUpPoint({ x: CENTER_X_FT, y: GOAL_LINE_Y_FT }, 2.5, 0);
    assert.deepEqual(onNet, { x: CENTER_X_FT, y: GOAL_LINE_Y_FT + 2.5 });
});

test('getSquareUpPoint: angle error shifts sideways, never behind the line, capped out of the crease', () => {
    const perfect = getSquareUpPoint({ x: CENTER_X_FT, y: 40 }, 3, 0);
    const off = getSquareUpPoint({ x: CENTER_X_FT, y: 40 }, 3, 1.2);
    assert.notEqual(off.x, perfect.x);
    near(Math.hypot(off.x - CENTER_X_FT, off.y - GOAL_LINE_Y_FT), 3);
    const behind = getSquareUpPoint({ x: 5, y: 2 }, 3, 0);
    assert.ok(behind.y >= GOAL_LINE_Y_FT);
    const far = getSquareUpPoint({ x: CENTER_X_FT, y: 60 }, 50, 0);
    near(far.y - GOAL_LINE_Y_FT, CREASE_RADIUS_FT + CREASE_EXIT_MAX_FT);
});
