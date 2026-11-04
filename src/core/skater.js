/* =============================================================
   src/core/skater.js
   Skating, turning, charging and dekes (ARCHITECTURE §5 steps 2-3).

   Sections in this file
     1. Small helpers (private)
     2. Creating a skater
     3. One physics step: dekes, charge, speed, facing, bounds
     4. Goalie push-out
     5. Shot power from the charge

   How a step works (updateSkater)
   - Move input is clamped to length 1, so a diagonal (1, 1) is as
     fast as (1, 0) and a half-pushed touch stick is half speed.
   - With input, velocity accelerates toward the target at
     SKATER_ACCEL_FT_PER_S2; without input it glides and slows at
     SKATER_GLIDE_DECEL_FT_PER_S2 until it snaps to exactly 0.
   - A deke is a sideways shove of DEKE_SPEED_FT_PER_S added to the
     position (not to velocity) for DEKE_DURATION_S, so it can't push
     the skater past top speed and it ends cleanly.
   - Facing turns toward the velocity by the shortest arc, at most
     SKATER_TURN_RATE_RAD_PER_S, and only above
     SKATER_TURN_MIN_SPEED_FT_PER_S (no snap when stopping).
   - Bounds: goal-line limit, center-ice limit, then boards with the
     velocity into the wall removed (the skater slides along walls).

   Troubleshooting
   - Skater spins the long way round: wrapAngle() must keep angle
     differences in (-PI, PI].
   - The first frame of an attempt fires a shot: charging only starts
     on a fresh shootPressed edge, never from a held key (Q14).
   - Skater walks through the goalie: game.js must call
     pushOutOfGoalie() after updateSkater() each step.
   ============================================================= */

import {
    CENTER_DOT, START_FACING_RAD, SKATER_MAX_SPEED_FT_PER_S, SKATER_MAX_SPEED_WITH_PUCK_FT_PER_S,
    SKATER_ACCEL_FT_PER_S2, SKATER_GLIDE_DECEL_FT_PER_S2, SKATER_TURN_RATE_RAD_PER_S,
    SKATER_TURN_MIN_SPEED_FT_PER_S, DEKE_SPEED_FT_PER_S, DEKE_DURATION_S, DEKE_COOLDOWN_S,
    CHARGE_FULL_S, MIN_POWER, GOAL_LINE_Y_FT, VISIBLE_MAX_Y_FT, SKATER_RADIUS_FT
} from './constants.js';
import { closestPointOnSegment, reflectVelocity } from './collision.js';
import { collideWithBoards, clampToSkaterZone } from './rink.js';

/** @typedef {import('./types.js').SkaterState} SkaterState */
/** @typedef {import('./types.js').Intent} Intent */
/** @typedef {import('./types.js').ControlScheme} ControlScheme */
/** @typedef {import('./types.js').Vec2} Vec2 */

/** Below this speed (ft/s) a gliding skater snaps to exactly 0, so it never creeps forever. */
const SKATER_STOP_SPEED_FT_PER_S = 1e-3;
/** Timers within this many seconds of 0 count as finished (float rounding over many steps). */
const TIMER_EPS_S = 1e-9;

/* ---------- 1. Small helpers ---------- */

/** Wraps an angle into (-PI, PI]. @param {number} angleRad @returns {number} */
function wrapAngle(angleRad) {
    let a = angleRad % (2 * Math.PI);
    if (a <= -Math.PI) a += 2 * Math.PI;
    else if (a > Math.PI) a -= 2 * Math.PI;
    return a;
}

/** A finite number or 0. @param {number} value @returns {number} */
function finiteOrZero(value) {
    return Number.isFinite(value) ? value : 0;
}

/* ---------- 2. Creating a skater ---------- */

/**
 * A skater at the center dot, standing still, facing up the ice, with the puck.
 * @returns {SkaterState}
 */
export function createSkater() {
    return {
        position: { x: CENTER_DOT.x, y: CENTER_DOT.y },
        previousPosition: { x: CENTER_DOT.x, y: CENTER_DOT.y },
        velocity: { x: 0, y: 0 },
        facingRad: START_FACING_RAD,
        hasPuck: true,
        dekeTimeLeftS: 0,
        dekeCooldownS: 0,
        dekeSide: 1,
        chargeHeldS: 0,
        isCharging: false
    };
}

/* ---------- 3. One physics step ---------- */

/**
 * Advances the skater one step: deke, charge, acceleration or glide, facing, and bounds
 * (boards, goal-line limit, center-ice limit). *Mutates* `skater`. Does not push out of the goalie.
 *
 * Charge (hold_charge only): a fresh `shootPressed` with the puck starts charging from 0; holding
 * adds time; on `shootReleased` charging stops but `chargeHeldS` is kept so the caller can read it
 * with getChargePower() and fire. Losing the puck clears the charge. A deke keeps the charge (Q13).
 * @param {SkaterState} skater - Skater to update.
 * @param {Intent} intent - This step's input.
 * @param {ControlScheme} scheme - Active control scheme (one_button has no deke or charge).
 * @param {number} dtS - Step length in seconds (FIXED_STEP_S normally).
 * @returns {{ skater: SkaterState, didDeke: boolean }} The same skater object, and whether a deke started.
 */
export function updateSkater(skater, intent, scheme, dtS) {
    if (!skater || typeof skater !== 'object') throw new TypeError('updateSkater: skater must be a SkaterState');
    if (!intent || typeof intent !== 'object') throw new TypeError('updateSkater: intent must be an Intent');
    if (!(dtS >= 0) || !Number.isFinite(dtS)) throw new TypeError('updateSkater: dtS must be a finite number >= 0');

    skater.previousPosition.x = skater.position.x;
    skater.previousPosition.y = skater.position.y;

    // Timers.
    skater.dekeCooldownS = Math.max(0, skater.dekeCooldownS - dtS);

    // Deke: only with the puck, in a scheme that has one, when the cooldown is ready (Q13).
    let didDeke = false;
    const hasDeke = scheme !== 'one_button';
    if (intent.dekePressed && hasDeke && skater.hasPuck && skater.dekeCooldownS <= TIMER_EPS_S) {
        const side = intent.dekeSide === 1 || intent.dekeSide === -1 ? intent.dekeSide : /** @type {-1|1} */ (-skater.dekeSide);
        skater.dekeSide = side;
        skater.dekeTimeLeftS = DEKE_DURATION_S;
        skater.dekeCooldownS = DEKE_COOLDOWN_S;
        didDeke = true;
    }

    // Charge.
    if (scheme !== 'hold_charge' || !skater.hasPuck) {
        skater.isCharging = false;
        skater.chargeHeldS = 0;
    } else {
        if (intent.shootPressed) {
            skater.isCharging = true;
            skater.chargeHeldS = 0;
        } else if (skater.isCharging && intent.isShootHeld) {
            skater.chargeHeldS += dtS;
        }
        if (intent.shootReleased || !intent.isShootHeld) skater.isCharging = false;
    }

    // Speed: accelerate toward the target, or glide.
    let moveX = finiteOrZero(intent.moveX);
    let moveY = finiteOrZero(intent.moveY);
    const moveLength = Math.hypot(moveX, moveY);
    if (moveLength > 1) {
        moveX /= moveLength;
        moveY /= moveLength;
    }
    const v = skater.velocity;
    if (moveLength > 0) {
        const maxSpeed = skater.hasPuck ? SKATER_MAX_SPEED_WITH_PUCK_FT_PER_S : SKATER_MAX_SPEED_FT_PER_S;
        const dvx = moveX * maxSpeed - v.x;
        const dvy = moveY * maxSpeed - v.y;
        const dvLength = Math.hypot(dvx, dvy);
        const maxDv = SKATER_ACCEL_FT_PER_S2 * dtS;
        const k = dvLength > maxDv ? maxDv / dvLength : 1;
        v.x += dvx * k;
        v.y += dvy * k;
    } else {
        const speed = Math.hypot(v.x, v.y);
        const newSpeed = speed - SKATER_GLIDE_DECEL_FT_PER_S2 * dtS;
        if (newSpeed <= SKATER_STOP_SPEED_FT_PER_S) {
            v.x = 0;
            v.y = 0;
        } else {
            v.x *= newSpeed / speed;
            v.y *= newSpeed / speed;
        }
    }

    // Facing: shortest arc toward the velocity, rate-limited, only while moving.
    const speed = Math.hypot(v.x, v.y);
    if (speed > SKATER_TURN_MIN_SPEED_FT_PER_S) {
        const diff = wrapAngle(Math.atan2(v.y, v.x) - skater.facingRad);
        const maxTurn = SKATER_TURN_RATE_RAD_PER_S * dtS;
        skater.facingRad = wrapAngle(skater.facingRad + Math.max(-maxTurn, Math.min(maxTurn, diff)));
    }

    // Move, with the deke shove on top (perpendicular to facing; +1 = skater's right on screen).
    let x = skater.position.x + v.x * dtS;
    let y = skater.position.y + v.y * dtS;
    if (skater.dekeTimeLeftS > TIMER_EPS_S) {
        const dekeDt = Math.min(dtS, skater.dekeTimeLeftS);
        const sideAngle = skater.facingRad + skater.dekeSide * (Math.PI / 2);
        x += Math.cos(sideAngle) * DEKE_SPEED_FT_PER_S * dekeDt;
        y += Math.sin(sideAngle) * DEKE_SPEED_FT_PER_S * dekeDt;
        skater.dekeTimeLeftS = Math.max(0, skater.dekeTimeLeftS - dekeDt);
    } else {
        skater.dekeTimeLeftS = 0;
    }

    // Bounds: goal line and center ice, then boards (velocity into the wall removed).
    const minY = GOAL_LINE_Y_FT + SKATER_RADIUS_FT;
    if (y < minY) {
        y = minY;
        if (v.y < 0) v.y = 0;
    } else if (y > VISIBLE_MAX_Y_FT) {
        y = VISIBLE_MAX_Y_FT;
        if (v.y > 0) v.y = 0;
    }
    const walled = collideWithBoards({ x, y }, v, SKATER_RADIUS_FT, 0);
    skater.position.x = walled.position.x;
    skater.position.y = walled.position.y;
    v.x = walled.velocity.x;
    v.y = walled.velocity.y;
    return { skater, didDeke };
}

/* ---------- 4. Goalie push-out ---------- */

/**
 * Pushes the skater out of the goalie's capsule so it can never pass through (Q11). Also removes
 * the velocity into the goalie and keeps the skater in the skating zone. *Mutates* `skater`.
 * If the skater's center crossed the goalie's core segment this step, it goes back to the side it
 * came from.
 * @param {SkaterState} skater - Skater to fix up (after updateSkater).
 * @param {Vec2} goalieSegmentA - One end of the goalie's core segment.
 * @param {Vec2} goalieSegmentB - The other end.
 * @param {number} goalieRadiusFt - Goalie capsule radius.
 * @returns {void}
 */
export function pushOutOfGoalie(skater, goalieSegmentA, goalieSegmentB, goalieRadiusFt) {
    const minDist = goalieRadiusFt + SKATER_RADIUS_FT;
    const p = skater.position;
    const q = closestPointOnSegment(p, goalieSegmentA, goalieSegmentB);
    let nx = p.x - q.x;
    let ny = p.y - q.y;
    const dist = Math.hypot(nx, ny);
    if (dist >= minDist) return;

    // Which side of the segment line was the skater on last step?
    const sx = goalieSegmentB.x - goalieSegmentA.x;
    const sy = goalieSegmentB.y - goalieSegmentA.y;
    const sideOf = (/** @type {Vec2} */ point) => sx * (point.y - goalieSegmentA.y) - sy * (point.x - goalieSegmentA.x);
    const sideNow = sideOf(p);
    const sidePrev = sideOf(skater.previousPosition);
    const segLength = Math.hypot(sx, sy);
    if (segLength > 0 && sidePrev !== 0 && (sideNow === 0 || Math.sign(sideNow) !== Math.sign(sidePrev) || dist === 0)) {
        // Normal of the segment on the previous side.
        const s = Math.sign(sidePrev);
        nx = (-sy / segLength) * s;
        ny = (sx / segLength) * s;
    } else if (dist > 0) {
        nx /= dist;
        ny /= dist;
    } else {
        nx = 0;
        ny = 1; // dead center with no history: out toward center ice
    }
    const pushed = clampToSkaterZone({ x: q.x + nx * minDist, y: q.y + ny * minDist });
    p.x = pushed.x;
    p.y = pushed.y;
    const v = reflectVelocity(skater.velocity, { x: nx, y: ny }, 0);
    skater.velocity.x = v.x;
    skater.velocity.y = v.y;
}

/* ---------- 5. Shot power ---------- */

/**
 * Shot power for a release after holding the charge: held time / CHARGE_FULL_S, capped at 1,
 * with a MIN_POWER floor so a tap still shoots (Q2).
 * @param {number} chargeHeldS - Seconds the shoot input was held.
 * @returns {number} Power in [MIN_POWER, 1].
 */
export function getChargePower(chargeHeldS) {
    const raw = Number.isFinite(chargeHeldS) && chargeHeldS > 0 ? chargeHeldS / CHARGE_FULL_S : 0;
    return Math.max(MIN_POWER, Math.min(1, raw));
}
