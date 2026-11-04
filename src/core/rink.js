/* =============================================================
   src/core/rink.js
   Rink boundaries, posts, goal mouth and the skater zone.

   The playable shape is the attacking end of a real rink: two
   straight side boards (x = 0 and x = 85), the end boards (y = 0)
   and two 28 ft quarter-circle corners joining them. The bottom of
   the view (center ice) is open: pucks can leave there, skaters are
   stopped at VISIBLE_MAX_Y_FT.

   Sections in this file
     1. Geometry helpers (private)
     2. Goal mouth
     3. Boards: inside test and bounce
     4. Skater zone clamp
     5. Goalie square-up point

   Troubleshooting
   - Something ends up outside the rink after a fast move: callers
     must clamp with collideWithBoards() after moving; for pucks,
     puck.js sweeps the boards first and clamps as a last resort.
   - A body jitters in a corner: the corner push goes toward the
     corner circle's center, which only increases x/y, so it can't
     fight the goal-line clamp. Check the caller zeroes the velocity
     into the wall (restitution 0 for skaters).
   - The goalie stands in the wrong place: getSquareUpPoint() works
     from where the goalie *thinks* the puck is (angleOffsetFt).
   ============================================================= */

import {
    RINK_WIDTH_FT, CORNER_RADIUS_FT, GOAL_LINE_Y_FT, VISIBLE_MAX_Y_FT, SKATER_RADIUS_FT,
    LEFT_POST, RIGHT_POST, POST_RADIUS_FT, CENTER_X_FT, CREASE_RADIUS_FT, CREASE_EXIT_MAX_FT
} from './constants.js';
import { reflectVelocity } from './collision.js';

/** @typedef {import('./types.js').Vec2} Vec2 */

/** Centers of the two end-board corner arcs (ft). */
const LEFT_CORNER_CENTER = Object.freeze({ x: CORNER_RADIUS_FT, y: CORNER_RADIUS_FT });
const RIGHT_CORNER_CENTER = Object.freeze({ x: RINK_WIDTH_FT - CORNER_RADIUS_FT, y: CORNER_RADIUS_FT });
/** Net center on the goal line: the point the goalie squares up to. */
const NET_CENTER = Object.freeze({ x: CENTER_X_FT, y: GOAL_LINE_Y_FT });

/* ---------- 1. Geometry helpers ---------- */

/**
 * The corner arc whose quadrant holds this point, or null on the straight parts.
 * @param {Vec2} position @returns {Readonly<Vec2>|null}
 */
function cornerFor(position) {
    if (position.y >= CORNER_RADIUS_FT) return null;
    if (position.x < LEFT_CORNER_CENTER.x) return LEFT_CORNER_CENTER;
    if (position.x > RIGHT_CORNER_CENTER.x) return RIGHT_CORNER_CENTER;
    return null;
}

/* ---------- 2. Goal mouth ---------- */

/**
 * The goal opening used by the goal test: inner post edges and the goal line.
 * @returns {{ leftInnerX: number, rightInnerX: number, lineY: number }} Feet.
 */
export function getGoalMouth() {
    return {
        leftInnerX: LEFT_POST.x + POST_RADIUS_FT,
        rightInnerX: RIGHT_POST.x - POST_RADIUS_FT,
        lineY: GOAL_LINE_Y_FT
    };
}

/* ---------- 3. Boards ---------- */

/**
 * Whether a circle fits inside the boards (touching counts as inside). The open center-ice side
 * has no limit here.
 * @param {Vec2} position - Circle center (ft).
 * @param {number} radiusFt - Circle radius.
 * @returns {boolean}
 */
export function isInsideBoards(position, radiusFt) {
    if (position.x < radiusFt || position.x > RINK_WIDTH_FT - radiusFt || position.y < radiusFt) return false;
    const corner = cornerFor(position);
    if (!corner) return true;
    const limit = CORNER_RADIUS_FT - radiusFt;
    const dx = position.x - corner.x;
    const dy = position.y - corner.y;
    return dx * dx + dy * dy <= limit * limit + 1e-9;
}

/**
 * Pushes a circle back inside the boards and bounces its velocity off the wall it crossed.
 * Handles the straight side and end boards and the two corner arcs. Inputs are not changed.
 * @param {Vec2} position - Circle center (ft).
 * @param {Vec2} velocity - Velocity (ft/s).
 * @param {number} radiusFt - Circle radius.
 * @param {number} restitution - Bounce factor; 0 removes the velocity into the wall (skaters).
 * @returns {{ position: Vec2, velocity: Vec2, didHit: boolean }} New objects.
 */
export function collideWithBoards(position, velocity, radiusFt, restitution) {
    let x = position.x;
    let y = position.y;
    let v = { x: velocity.x, y: velocity.y };
    let didHit = false;

    const corner = cornerFor(position);
    if (corner) {
        const limit = CORNER_RADIUS_FT - radiusFt;
        const dx = x - corner.x;
        const dy = y - corner.y;
        const dist = Math.hypot(dx, dy);
        if (dist > limit) {
            x = corner.x + (dx / dist) * limit;
            y = corner.y + (dy / dist) * limit;
            v = reflectVelocity(v, { x: -dx, y: -dy }, restitution);
            didHit = true;
        }
    } else {
        if (x < radiusFt) {
            x = radiusFt;
            v = reflectVelocity(v, { x: 1, y: 0 }, restitution);
            didHit = true;
        } else if (x > RINK_WIDTH_FT - radiusFt) {
            x = RINK_WIDTH_FT - radiusFt;
            v = reflectVelocity(v, { x: -1, y: 0 }, restitution);
            didHit = true;
        }
        if (y < radiusFt) {
            y = radiusFt;
            v = reflectVelocity(v, { x: 0, y: 1 }, restitution);
            didHit = true;
        }
    }
    return { position: { x, y }, velocity: v, didHit };
}

/* ---------- 4. Skater zone ---------- */

/**
 * Clamps a skater center into the skating zone: inside the boards, in front of the goal line
 * (y >= GOAL_LINE_Y_FT + SKATER_RADIUS_FT, no going behind the net) and y <= VISIBLE_MAX_Y_FT.
 * @param {Vec2} position - Skater center (ft).
 * @returns {Vec2} New, clamped position.
 */
export function clampToSkaterZone(position) {
    const minY = GOAL_LINE_Y_FT + SKATER_RADIUS_FT;
    const y = Math.min(VISIBLE_MAX_Y_FT, Math.max(minY, position.y));
    // The corner push only moves toward the corner center (larger y), so the y limit still holds.
    return collideWithBoards({ x: position.x, y }, { x: 0, y: 0 }, SKATER_RADIUS_FT, 0).position;
}

/* ---------- 5. Goalie square-up point ---------- */

/**
 * Where the goalie wants to stand: on the line from the (perceived) puck to the net center,
 * `depthFt` out from the net center, never behind the goal line and never farther out than the
 * crease plus CREASE_EXIT_MAX_FT. The perceived puck is shifted sideways (perpendicular to the
 * puck-to-net line) by `angleOffsetFt`, which is how the goalie's angle error shows.
 * @param {Vec2} puckPosition - True puck position (ft).
 * @param {number} depthFt - Distance out from the net center (tier depthFt).
 * @param {number} angleOffsetFt - Sideways error of the goalie's read; 0 = perfect.
 * @returns {Vec2} New target point.
 */
export function getSquareUpPoint(puckPosition, depthFt, angleOffsetFt) {
    let dx = puckPosition.x - NET_CENTER.x;
    let dy = puckPosition.y - NET_CENTER.y;
    let dist = Math.hypot(dx, dy);
    if (dist > 0 && angleOffsetFt !== 0) {
        // Shift sideways: perpendicular to the net-to-puck direction.
        const px = -dy / dist;
        const py = dx / dist;
        dx += px * angleOffsetFt;
        dy += py * angleOffsetFt;
        dist = Math.hypot(dx, dy);
    }
    if (dy < 0) dy = 0; // a puck behind the goal line: square up along the line instead
    dist = Math.hypot(dx, dy);
    let ux = 0;
    let uy = 1; // straight out from the net when the puck is on the net center
    if (dist > 0) {
        ux = dx / dist;
        uy = dy / dist;
    }
    const reach = Math.max(0, Math.min(depthFt, CREASE_RADIUS_FT + CREASE_EXIT_MAX_FT));
    return { x: NET_CENTER.x + ux * reach, y: NET_CENTER.y + uy * reach };
}
