// Unit tests for src/core/collision.js (AC-6 contact rules, tunneling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sweepCircleVsCircle, sweepCircleVsCapsule, sweepCrossesY, closestPointOnSegment, reflectVelocity
} from '../../src/core/collision.js';
import {
    PUCK_COLLISION_RADIUS_FT, POST_RADIUS_FT, LEFT_POST, SHOT_SPEED_MAX_FT_PER_S, FIXED_STEP_S,
    GOALIE_BODY_RADIUS_FT
} from '../../src/core/constants.js';

const EPS = 1e-9;
const near = (actual, expected, tol = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const SUM = PUCK_COLLISION_RADIUS_FT + POST_RADIUS_FT;

test('circle vs circle: head-on contact time is where the gap closes', () => {
    const t = sweepCircleVsCircle({ x: 0, y: 10 }, { x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, 0.25);
    near(t, (10 - 0.75) / 10);
});

test('circle vs circle: inclusive at touching, exclusive just outside', () => {
    const post = LEFT_POST;
    // Passing sideways: closest approach equals the radii sum exactly.
    const touching = sweepCircleVsCircle({ x: post.x - 5, y: post.y + SUM }, { x: post.x + 5, y: post.y + SUM },
        PUCK_COLLISION_RADIUS_FT, post, POST_RADIUS_FT);
    assert.notEqual(touching, null);
    near(touching, 0.5, 1e-6);
    const inside = sweepCircleVsCircle({ x: post.x - 5, y: post.y + SUM - 1e-6 }, { x: post.x + 5, y: post.y + SUM - 1e-6 },
        PUCK_COLLISION_RADIUS_FT, post, POST_RADIUS_FT);
    assert.notEqual(inside, null);
    const outside = sweepCircleVsCircle({ x: post.x - 5, y: post.y + SUM + 1e-6 }, { x: post.x + 5, y: post.y + SUM + 1e-6 },
        PUCK_COLLISION_RADIUS_FT, post, POST_RADIUS_FT);
    assert.equal(outside, null);
});

test('circle vs circle: ending exactly at touching gives t = 1; stopping short gives null', () => {
    near(sweepCircleVsCircle({ x: 0, y: 5 }, { x: 0, y: 0.75 }, 0.5, { x: 0, y: 0 }, 0.25), 1);
    assert.equal(sweepCircleVsCircle({ x: 0, y: 5 }, { x: 0, y: 0.75 + EPS * 10 }, 0.5, { x: 0, y: 0 }, 0.25), null);
});

test('circle vs circle: overlapping start is t = 0 when moving in, null when moving away', () => {
    assert.equal(sweepCircleVsCircle({ x: 0, y: 0.5 }, { x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, 0.25), 0);
    assert.equal(sweepCircleVsCircle({ x: 0, y: 0.5 }, { x: 0, y: 0.5 }, 0.5, { x: 0, y: 0 }, 0.25), 0);
    assert.equal(sweepCircleVsCircle({ x: 0, y: 0.5 }, { x: 0, y: 2 }, 0.5, { x: 0, y: 0 }, 0.25), null);
});

test('circle vs circle: moving away or missing entirely gives null; zero move outside gives null', () => {
    assert.equal(sweepCircleVsCircle({ x: 0, y: 2 }, { x: 0, y: 5 }, 0.5, { x: 0, y: 0 }, 0.25), null);
    assert.equal(sweepCircleVsCircle({ x: 5, y: 5 }, { x: 6, y: -5 }, 0.5, { x: 0, y: 0 }, 0.25), null);
    assert.equal(sweepCircleVsCircle({ x: 0, y: 2 }, { x: 0, y: 2 }, 0.5, { x: 0, y: 0 }, 0.25), null);
});

test('no tunneling: a puck at 2x max shot speed is caught by a post in one step', () => {
    const stepFt = 2 * SHOT_SPEED_MAX_FT_PER_S * FIXED_STEP_S; // ~1.75 ft, more than the 0.75 ft contact width
    const start = { x: LEFT_POST.x, y: LEFT_POST.y + stepFt / 2 + 0.01 };
    const end = { x: LEFT_POST.x, y: LEFT_POST.y - stepFt / 2 + 0.01 };
    // Neither end overlaps the post if the post were tested only at end points.
    assert.ok(Math.hypot(start.x - LEFT_POST.x, start.y - LEFT_POST.y) > SUM);
    assert.ok(Math.hypot(end.x - LEFT_POST.x, end.y - LEFT_POST.y) > SUM);
    const t = sweepCircleVsCircle(start, end, PUCK_COLLISION_RADIUS_FT, LEFT_POST, POST_RADIUS_FT);
    assert.notEqual(t, null);
    assert.ok(t > 0 && t < 1);
});

test('circle vs capsule: hits the long side, the end caps, and misses past the ends', () => {
    const a = { x: -2, y: 0 };
    const b = { x: 2, y: 0 };
    const r = GOALIE_BODY_RADIUS_FT;
    // Straight down onto the middle of the side.
    near(sweepCircleVsCapsule({ x: 0, y: 10 }, { x: 0, y: 0 }, 0.5, a, b, r), (10 - 1.5) / 10);
    // From the other side.
    near(sweepCircleVsCapsule({ x: 1, y: -10 }, { x: 1, y: 0 }, 0.5, a, b, r), (10 - 1.5) / 10);
    // Onto the rounded end cap past segment B.
    near(sweepCircleVsCapsule({ x: 3, y: 10 }, { x: 3, y: 0 }, 0.5, a, b, r),
        (10 - Math.sqrt(1.5 * 1.5 - 1)) / 10);
    // Head-on into the end cap along the axis.
    near(sweepCircleVsCapsule({ x: 10, y: 0 }, { x: 0, y: 0 }, 0.5, a, b, r), (10 - 3.5) / 10);
    // Past the end by more than the radius sum.
    assert.equal(sweepCircleVsCapsule({ x: 3.6, y: 10 }, { x: 3.6, y: -10 }, 0.5, a, b, r), null);
});

test('circle vs capsule: inclusive at touching the side; tilted capsule works', () => {
    const a = { x: -2, y: 0 };
    const b = { x: 2, y: 0 };
    // Grazing along the side at exactly the radii sum: first touch is the A end cap at x = -2.
    near(sweepCircleVsCapsule({ x: -5, y: 1.5 }, { x: 5, y: 1.5 }, 0.5, a, b, 1), 0.3, 1e-6);
    assert.equal(sweepCircleVsCapsule({ x: -5, y: 1.5 + 1e-6 }, { x: 5, y: 1.5 + 1e-6 }, 0.5, a, b, 1), null);
    const ta = { x: 0, y: 0 };
    const tb = { x: 3, y: 3 };
    // Path x + y = 5 crosses the diagonal capsule's axis at (2.5, 2.5), inside the segment.
    const t = sweepCircleVsCapsule({ x: 0, y: 5 }, { x: 5, y: 0 }, 0.5, ta, tb, 1);
    assert.notEqual(t, null);
    const hit = { x: 5 * t, y: 5 - 5 * t };
    const q = closestPointOnSegment(hit, ta, tb);
    near(Math.hypot(hit.x - q.x, hit.y - q.y), 1.5, 1e-6);
});

test('circle vs capsule: overlapping start, degenerate segment, and no tunneling at 2x max speed', () => {
    const a = { x: -2, y: 0 };
    const b = { x: 2, y: 0 };
    assert.equal(sweepCircleVsCapsule({ x: 0, y: 1 }, { x: 0, y: 0 }, 0.5, a, b, 1), 0);
    assert.equal(sweepCircleVsCapsule({ x: 0, y: 1 }, { x: 0, y: 3 }, 0.5, a, b, 1), null);
    assert.equal(sweepCircleVsCapsule({ x: 0, y: 10 }, { x: 0, y: 0 }, 0.5, a, a, 1), null, 'zero-length capsule is a circle');
    assert.notEqual(sweepCircleVsCapsule({ x: -2, y: 10 }, { x: -2, y: 0 }, 0.5, a, a, 1), null);
    const stepFt = 2 * SHOT_SPEED_MAX_FT_PER_S * FIXED_STEP_S;
    const thin = 0.1;
    const t = sweepCircleVsCapsule({ x: 0, y: stepFt / 2 }, { x: 0, y: -stepFt / 2 }, 0.1, a, b, thin);
    assert.notEqual(t, null);
});

test('sweepCrossesY: upward crossings only, end strictly past the line', () => {
    near(sweepCrossesY({ x: 0, y: 12 }, { x: 0, y: 10 }, 11), 0.5);
    assert.equal(sweepCrossesY({ x: 0, y: 12 }, { x: 0, y: 11 }, 11), null, 'ending on the line is not across');
    assert.equal(sweepCrossesY({ x: 0, y: 11 }, { x: 0, y: 10 }, 11), 0);
    assert.equal(sweepCrossesY({ x: 0, y: 10 }, { x: 0, y: 12 }, 11), null, 'moving down the ice');
    assert.equal(sweepCrossesY({ x: 0, y: 10 }, { x: 0, y: 9 }, 11), null, 'already past');
});

test('closestPointOnSegment clamps to the ends and handles a zero-length segment', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };
    assert.deepEqual(closestPointOnSegment({ x: 2, y: 3 }, a, b), { x: 2, y: 0 });
    assert.deepEqual(closestPointOnSegment({ x: -3, y: 3 }, a, b), { x: 0, y: 0 });
    assert.deepEqual(closestPointOnSegment({ x: 9, y: -1 }, a, b), { x: 4, y: 0 });
    assert.deepEqual(closestPointOnSegment({ x: 9, y: -1 }, a, a), { x: 0, y: 0 });
});

test('reflectVelocity flips only the inward part, scaled by restitution', () => {
    const v = reflectVelocity({ x: 3, y: -10 }, { x: 0, y: 1 }, 0.5);
    near(v.x, 3);
    near(v.y, 5);
    const full = reflectVelocity({ x: 0, y: -10 }, { x: 0, y: 2 }, 1);
    near(full.y, 10);
    assert.deepEqual(reflectVelocity({ x: 1, y: 4 }, { x: 0, y: 1 }, 0.5), { x: 1, y: 4 }, 'moving away: unchanged');
    assert.deepEqual(reflectVelocity({ x: 1, y: 4 }, { x: 0, y: 0 }, 0.5), { x: 1, y: 4 }, 'zero normal: unchanged');
    const input = { x: 3, y: -10 };
    reflectVelocity(input, { x: 0, y: 1 }, 0.5);
    assert.deepEqual(input, { x: 3, y: -10 }, 'input not changed');
});
