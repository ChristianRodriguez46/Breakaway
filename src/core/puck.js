/* =============================================================
   src/core/puck.js
   Carrying, shot velocity, friction and bounces (ARCHITECTURE §5 step 4).

   Sections in this file
     1. Small helpers (private): board sweep, net box
     2. Creating and carrying the puck
     3. Shot velocity per control scheme
     4. One physics step: friction, swept contacts, bounces, stop
     5. Rebounds

   How a step works (updatePuck), for a shot or loose puck
   - Friction first (PUCK_FRICTION_DECEL_FT_PER_S2), then the move.
   - The move from the old to the new position is swept against the
     two posts, the goalie capsule, the goal-line crossing and the
     boards. The earliest contact wins (ties: post, goalie, goal,
     board, so a goalie touch at the same instant as the crossing is
     a save, Q15). After a post or board bounce the rest of the move
     continues, at most MAX_BOUNCES_PER_STEP times; anything left
     after that is dropped for this step so nothing can tunnel.
   - Goal: the whole puck is across (center past GOAL_LINE_Y_FT minus
     the puck radius) with the center strictly between the inner post
     edges. The puck then becomes 'in_net' and stays in the net box.
   - Goalie contact: the puck stops on the pads ('absorbed'); the
     goalie/rules code calls setRebound() if the save rolls a rebound.
   - Below PUCK_STOP_SPEED_FT_PER_S the puck stops (didStop); past the
     visible box it has left the view (didLeaveView). Both end the shot.

   Troubleshooting
   - The puck goes through a post or the goalie: check the caller
     passes the goalie capsule for this step and dt is FIXED_STEP_S.
   - Two Goal events for one shot: after the goal the puck is 'in_net'
     and never reports contacts again; check the caller doesn't reset
     the mode.
   - A shot never ends: friction is slow (6 ft/s²); the rules should
     also end the attempt on didLeaveView and on the shot clock.
   ============================================================= */

import {
    PUCK_COLLISION_RADIUS_FT, POST_RADIUS_FT, LEFT_POST, RIGHT_POST, GOAL_LINE_Y_FT, NET_DEPTH_FT,
    RINK_WIDTH_FT, CORNER_RADIUS_FT, PUCK_CARRY_OFFSET_FT, PUCK_FRICTION_DECEL_FT_PER_S2,
    PUCK_STOP_SPEED_FT_PER_S, POST_RESTITUTION, BOARD_RESTITUTION, MAX_BOUNCES_PER_STEP,
    REBOUND_SPEED_FT_PER_S, REBOUND_MAX_ANGLE_DEG, GOALIE_BODY_RADIUS_FT,
    SHOT_SPEED_MIN_FT_PER_S, SHOT_SPEED_MAX_FT_PER_S, SPREAD_MIN_DEG, SPREAD_MAX_DEG,
    AIM_SHOT_SPEED_FT_PER_S, AIM_SPREAD_DEG, ONE_BUTTON_SHOT_SPEED_FT_PER_S, ONE_BUTTON_SPREAD_DEG,
    VISIBLE_MIN_X_FT, VISIBLE_MAX_X_FT, VISIBLE_MIN_Y_FT, VISIBLE_MAX_Y_FT
} from './constants.js';
import { sweepCircleVsCircle, sweepCircleVsCapsule, sweepCrossesY, reflectVelocity } from './collision.js';
import { collideWithBoards, getGoalMouth } from './rink.js';

/** @typedef {import('./types.js').Vec2} Vec2 */
/** @typedef {import('./types.js').PuckState} PuckState */
/** @typedef {import('./types.js').SkaterState} SkaterState */
/** @typedef {import('./types.js').ControlScheme} ControlScheme */
/** @typedef {import('./types.js').RandomFn} RandomFn */
/** @typedef {{ kind: 'post'|'goalie'|'goal'|'board', tStep: number }} PuckContact */
/** @typedef {{ a: Vec2, b: Vec2, radiusFt: number }} GoalieCapsule */

/** Gap (ft) between the goalie's body and a rebound puck, so it starts clear of the pads. */
const REBOUND_CLEARANCE_FT = 0.1;
/** Speed (ft/s) the puck keeps, as a fraction, when it hits the back or side of the net. */
const NET_RESTITUTION = 0;
/** Tie order when two contacts happen at the same instant (lower first). */
const CONTACT_PRIORITY = Object.freeze({ post: 0, goalie: 1, goal: 2, board: 3 });
const DEG_TO_RAD = Math.PI / 180;
const POSTS = Object.freeze([LEFT_POST, RIGHT_POST]);
const SHOT_SCHEMES = Object.freeze(['hold_charge', 'aim_mouse', 'one_button']);

/* ---------- 1. Small helpers ---------- */

/**
 * Earliest time a moving circle hits the boards from inside, with the inward wall normal.
 * Only motion toward a wall counts, so a puck resting on a wall after a bounce isn't hit again.
 * @param {Vec2} start @param {Vec2} end @param {number} r
 * @returns {{ t: number, normal: Vec2 }|null}
 */
function sweepBoards(start, end, r) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    /** @type {{ t: number, normal: Vec2 }|null} */
    let best = null;
    const keep = (/** @type {number} */ t, /** @type {Vec2} */ normal) => {
        if (t >= 0 && t <= 1 && (best === null || t < best.t)) best = { t, normal };
    };
    const lineHit = (/** @type {number} */ s, /** @type {number} */ ds, /** @type {number} */ limit) =>
        Math.max(0, (limit - s) / ds);

    // Straight side boards (only where they are straight: y >= corner radius).
    if (dx < 0) {
        const t = lineHit(start.x, dx, r);
        if (start.y + dy * t >= CORNER_RADIUS_FT) keep(t, { x: 1, y: 0 });
    } else if (dx > 0) {
        const t = lineHit(start.x, dx, RINK_WIDTH_FT - r);
        if (start.y + dy * t >= CORNER_RADIUS_FT) keep(t, { x: -1, y: 0 });
    }
    // Straight end boards, between the corners.
    if (dy < 0) {
        const t = lineHit(start.y, dy, r);
        const hx = start.x + dx * t;
        if (hx >= CORNER_RADIUS_FT && hx <= RINK_WIDTH_FT - CORNER_RADIUS_FT) keep(t, { x: 0, y: 1 });
    }
    // Corner arcs: leaving a circle of radius (corner radius - r) inside its quadrant.
    const limit = CORNER_RADIUS_FT - r;
    for (const cx of [CORNER_RADIUS_FT, RINK_WIDTH_FT - CORNER_RADIUS_FT]) {
        const isLeft = cx < RINK_WIDTH_FT / 2;
        const inQuadrant = (/** @type {number} */ x, /** @type {number} */ y) =>
            y <= CORNER_RADIUS_FT && (isLeft ? x <= cx : x >= cx);
        const fx = start.x - cx;
        const fy = start.y - CORNER_RADIUS_FT;
        const a = dx * dx + dy * dy;
        const b = fx * dx + fy * dy;
        const c = fx * fx + fy * fy - limit * limit;
        if (a === 0) continue;
        if (c >= 0 && b > 0 && inQuadrant(start.x, start.y)) {
            keep(0, { x: -fx, y: -fy }); // already on or past the arc, moving out
            continue;
        }
        const disc = b * b - a * c;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / a; // the exit root
        const hx = start.x + dx * t;
        const hy = start.y + dy * t;
        if (inQuadrant(hx, hy)) keep(t, { x: cx - hx, y: CORNER_RADIUS_FT - hy });
    }
    return best;
}

/**
 * Keeps an in-net puck inside the net box (between the inner post edges, in front of the back).
 * *Mutates* `puck`.
 * @param {PuckState} puck
 */
function clampIntoNet(puck) {
    const mouth = getGoalMouth();
    const r = PUCK_COLLISION_RADIUS_FT;
    const p = puck.position;
    const v = puck.velocity;
    const minX = Math.min(mouth.leftInnerX + r, mouth.rightInnerX - r);
    const maxX = Math.max(mouth.leftInnerX + r, mouth.rightInnerX - r);
    const backY = GOAL_LINE_Y_FT - NET_DEPTH_FT + r;
    if (p.x < minX) { p.x = minX; if (v.x < 0) v.x = -v.x * NET_RESTITUTION; }
    if (p.x > maxX) { p.x = maxX; if (v.x > 0) v.x = -v.x * NET_RESTITUTION; }
    if (p.y < backY) { p.y = backY; if (v.y < 0) v.y = -v.y * NET_RESTITUTION; }
    if (p.y > GOAL_LINE_Y_FT - r) { p.y = GOAL_LINE_Y_FT - r; if (v.y > 0) v.y = 0; }
}

/**
 * Slows a velocity by a constant deceleration, never reversing it. *Mutates* `v`.
 * @param {Vec2} v @param {number} decel @param {number} dtS
 */
function applyFriction(v, decel, dtS) {
    const speed = Math.hypot(v.x, v.y);
    if (speed === 0) return;
    const k = Math.max(0, speed - decel * dtS) / speed;
    v.x *= k;
    v.y *= k;
}

/* ---------- 2. Creating and carrying ---------- */

/**
 * A carried puck on the skater's stick.
 * @param {SkaterState} skater - The skater carrying it.
 * @returns {PuckState}
 */
export function createPuck(skater) {
    /** @type {PuckState} */
    const puck = {
        position: { x: 0, y: 0 },
        previousPosition: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        mode: 'carried',
        hasHitPost: false
    };
    carryPuck(puck, skater);
    puck.previousPosition.x = puck.position.x;
    puck.previousPosition.y = puck.position.y;
    return puck;
}

/**
 * Puts the puck on the stick: PUCK_CARRY_OFFSET_FT in front of the skater along its facing, kept
 * inside the boards and never behind the goal line, moving with the skater. *Mutates* `puck`.
 * @param {PuckState} puck - Puck to place.
 * @param {SkaterState} skater - Skater carrying it.
 * @returns {void}
 */
export function carryPuck(puck, skater) {
    puck.previousPosition.x = puck.position.x;
    puck.previousPosition.y = puck.position.y;
    const x = skater.position.x + Math.cos(skater.facingRad) * PUCK_CARRY_OFFSET_FT;
    const y = Math.max(GOAL_LINE_Y_FT, skater.position.y + Math.sin(skater.facingRad) * PUCK_CARRY_OFFSET_FT);
    const inside = collideWithBoards({ x, y }, skater.velocity, PUCK_COLLISION_RADIUS_FT, 0).position;
    puck.position.x = inside.x;
    puck.position.y = inside.y;
    puck.velocity.x = skater.velocity.x;
    puck.velocity.y = skater.velocity.y;
    puck.mode = 'carried';
}

/* ---------- 3. Shot velocity ---------- */

/**
 * The puck's velocity as it leaves the stick. Direction is the facing (or, for aim_mouse, toward
 * `aimPoint`; facing when there is none or it sits on the origin), turned by a spread angle of
 * (rng() * 2 - 1) × spread. Exactly one rng draw.
 * - hold_charge: speed and spread grow linearly with `power` (0…1) from the MIN to the MAX values.
 * - aim_mouse: AIM_SHOT_SPEED_FT_PER_S, AIM_SPREAD_DEG, whatever the distance to the aim point.
 * - one_button: ONE_BUTTON_SHOT_SPEED_FT_PER_S, ONE_BUTTON_SPREAD_DEG.
 * @param {{ scheme: ControlScheme, facingRad: number, origin: Vec2, aimPoint: Vec2|null,
 *   power: number, rng: RandomFn }} shot - Shot inputs; `power` matters only for hold_charge.
 * @returns {Vec2} Velocity in ft/s.
 */
export function createShotVelocity({ scheme, facingRad, origin, aimPoint, power, rng }) {
    if (!SHOT_SCHEMES.includes(scheme)) throw new TypeError(`createShotVelocity: unknown scheme ${scheme}`);
    if (typeof rng !== 'function') throw new TypeError('createShotVelocity: rng must be a function');
    let angleRad = Number.isFinite(facingRad) ? facingRad : 0;
    let speed;
    let spreadDeg;
    if (scheme === 'hold_charge') {
        const p = Number.isFinite(power) ? Math.max(0, Math.min(1, power)) : 0;
        speed = SHOT_SPEED_MIN_FT_PER_S + (SHOT_SPEED_MAX_FT_PER_S - SHOT_SPEED_MIN_FT_PER_S) * p;
        spreadDeg = SPREAD_MIN_DEG + (SPREAD_MAX_DEG - SPREAD_MIN_DEG) * p;
    } else if (scheme === 'aim_mouse') {
        speed = AIM_SHOT_SPEED_FT_PER_S;
        spreadDeg = AIM_SPREAD_DEG;
        if (aimPoint && origin) {
            const dx = aimPoint.x - origin.x;
            const dy = aimPoint.y - origin.y;
            if ((dx !== 0 || dy !== 0) && Number.isFinite(dx) && Number.isFinite(dy)) angleRad = Math.atan2(dy, dx);
        }
    } else {
        speed = ONE_BUTTON_SHOT_SPEED_FT_PER_S;
        spreadDeg = ONE_BUTTON_SPREAD_DEG;
    }
    angleRad += (rng() * 2 - 1) * spreadDeg * DEG_TO_RAD;
    return { x: Math.cos(angleRad) * speed, y: Math.sin(angleRad) * speed };
}

/* ---------- 4. One physics step ---------- */

/**
 * Advances a shot, loose or in-net puck one step. *Mutates* `puck`. Carried and absorbed pucks
 * don't move here (carryPuck() places a carried one).
 * @param {PuckState} puck - Puck to update.
 * @param {number} dtS - Step length in seconds.
 * @param {GoalieCapsule|null} goalieCapsule - Goalie body this step, or null for an empty net.
 * @returns {{ contacts: PuckContact[], didStop: boolean, didLeaveView: boolean }} Contacts in time
 *   order; `tStep` is the fraction of this step (0…1) when each happened.
 */
export function updatePuck(puck, dtS, goalieCapsule) {
    if (!puck || typeof puck !== 'object') throw new TypeError('updatePuck: puck must be a PuckState');
    if (!(dtS >= 0) || !Number.isFinite(dtS)) throw new TypeError('updatePuck: dtS must be a finite number >= 0');
    /** @type {PuckContact[]} */
    const contacts = [];
    const p = puck.position;
    const v = puck.velocity;
    puck.previousPosition.x = p.x;
    puck.previousPosition.y = p.y;

    if (puck.mode === 'carried' || puck.mode === 'absorbed') return { contacts, didStop: false, didLeaveView: false };

    applyFriction(v, PUCK_FRICTION_DECEL_FT_PER_S2, dtS);

    if (puck.mode === 'in_net') {
        p.x += v.x * dtS;
        p.y += v.y * dtS;
        clampIntoNet(puck);
        return { contacts, didStop: false, didLeaveView: false };
    }

    const r = PUCK_COLLISION_RADIUS_FT;
    const mouth = getGoalMouth();
    const goalLineY = mouth.lineY - r;
    let remaining = 1;
    let elapsed = 0;
    let bounces = 0;
    /** @type {unknown} */
    let lastHit = null;

    for (;;) {
        const start = { x: p.x, y: p.y };
        const end = { x: p.x + v.x * dtS * remaining, y: p.y + v.y * dtS * remaining };
        /** @type {{ t: number, kind: PuckContact['kind'], normal: Vec2|null, id: unknown }|null} */
        let hit = null;
        const consider = (/** @type {number|null} */ t, /** @type {PuckContact['kind']} */ kind,
            /** @type {Vec2|null} */ normal, /** @type {unknown} */ id) => {
            if (t === null || (t === 0 && id === lastHit)) return;
            if (hit === null || t < hit.t || (t === hit.t && CONTACT_PRIORITY[kind] < CONTACT_PRIORITY[hit.kind])) {
                hit = { t, kind, normal, id };
            }
        };

        for (const post of POSTS) {
            const t = sweepCircleVsCircle(start, end, r, post, POST_RADIUS_FT);
            if (t !== null) {
                const cx = start.x + (end.x - start.x) * t;
                const cy = start.y + (end.y - start.y) * t;
                consider(t, 'post', { x: cx - post.x, y: cy - post.y }, post);
            }
        }
        if (goalieCapsule) {
            consider(sweepCircleVsCapsule(start, end, r, goalieCapsule.a, goalieCapsule.b, goalieCapsule.radiusFt),
                'goalie', null, goalieCapsule);
        }
        const tLine = sweepCrossesY(start, end, goalLineY);
        if (tLine !== null) {
            const x = start.x + (end.x - start.x) * tLine;
            if (x > mouth.leftInnerX && x < mouth.rightInnerX) consider(tLine, 'goal', null, 'goal');
        }
        const board = sweepBoards(start, end, r);
        if (board) consider(board.t, 'board', board.normal, 'board');

        if (hit === null) {
            p.x = end.x;
            p.y = end.y;
            break;
        }
        const h = /** @type {{ t: number, kind: PuckContact['kind'], normal: Vec2|null, id: unknown }} */ (hit);
        p.x = start.x + (end.x - start.x) * h.t;
        p.y = start.y + (end.y - start.y) * h.t;
        contacts.push({ kind: h.kind, tStep: elapsed + h.t * remaining });
        elapsed += h.t * remaining;
        remaining *= 1 - h.t;

        if (h.kind === 'goal') {
            puck.mode = 'in_net';
            p.x += v.x * dtS * remaining;
            p.y += v.y * dtS * remaining;
            clampIntoNet(puck);
            return { contacts, didStop: false, didLeaveView: false };
        }
        if (h.kind === 'goalie') {
            puck.mode = 'absorbed';
            v.x = 0;
            v.y = 0;
            return { contacts, didStop: false, didLeaveView: false };
        }
        const bounced = reflectVelocity(v, /** @type {Vec2} */ (h.normal),
            h.kind === 'post' ? POST_RESTITUTION : BOARD_RESTITUTION);
        v.x = bounced.x;
        v.y = bounced.y;
        if (h.kind === 'post') puck.hasHitPost = true;
        lastHit = h.id;
        bounces += 1;
        if (bounces >= MAX_BOUNCES_PER_STEP) break; // drop the rest of this step's move
    }

    // Last-resort clamp (float rounding); the sweep above normally keeps it inside.
    const inside = collideWithBoards(p, v, r, BOARD_RESTITUTION);
    p.x = inside.position.x;
    p.y = inside.position.y;
    v.x = inside.velocity.x;
    v.y = inside.velocity.y;

    let didStop = false;
    if (Math.hypot(v.x, v.y) < PUCK_STOP_SPEED_FT_PER_S) {
        v.x = 0;
        v.y = 0;
        didStop = true;
    }
    const didLeaveView = p.x < VISIBLE_MIN_X_FT || p.x > VISIBLE_MAX_X_FT || p.y < VISIBLE_MIN_Y_FT || p.y > VISIBLE_MAX_Y_FT;
    return { contacts, didStop, didLeaveView };
}

/* ---------- 5. Rebounds ---------- */

/**
 * Knocks a saved puck back into the slot: straight out from the net (toward center ice) turned by
 * up to ±REBOUND_MAX_ANGLE_DEG ((rng() * 2 - 1) × max, one draw), at REBOUND_SPEED_FT_PER_S,
 * starting just clear of the goalie's body. The puck becomes 'loose'. *Mutates* `puck`.
 * @param {PuckState} puck - The saved puck.
 * @param {Vec2} goaliePosition - Goalie center.
 * @param {RandomFn} rng - Random source.
 * @returns {void}
 */
export function setRebound(puck, goaliePosition, rng) {
    if (typeof rng !== 'function') throw new TypeError('setRebound: rng must be a function');
    const angleRad = Math.PI / 2 + (rng() * 2 - 1) * REBOUND_MAX_ANGLE_DEG * DEG_TO_RAD;
    const ux = Math.cos(angleRad);
    const uy = Math.sin(angleRad);
    const gap = GOALIE_BODY_RADIUS_FT + PUCK_COLLISION_RADIUS_FT + REBOUND_CLEARANCE_FT;
    const placed = collideWithBoards({ x: goaliePosition.x + ux * gap, y: goaliePosition.y + uy * gap },
        { x: 0, y: 0 }, PUCK_COLLISION_RADIUS_FT, 0).position;
    puck.position.x = placed.x;
    puck.position.y = placed.y;
    puck.previousPosition.x = placed.x;
    puck.previousPosition.y = placed.y;
    puck.velocity.x = ux * REBOUND_SPEED_FT_PER_S;
    puck.velocity.y = uy * REBOUND_SPEED_FT_PER_S;
    puck.mode = 'loose';
}
