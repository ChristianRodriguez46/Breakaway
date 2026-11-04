/* =============================================================
   src/core/goalie.js
   Goalie state machine: square up, react, dive, poke, bite, recover.

   The goalie is a capsule (a line segment with a radius): its pads
   and blocker. The segment is centered on the goalie and turned to
   face the puck, so the puck has to beat its ends. ARCHITECTURE §6
   has the state table this file follows.

   How the tier numbers are read (decided in slice B; see
   .studio/reports/builder-b.md)
   - saveReachFt / diveReachFt run from the goalie's center to the
     outer edge of the pads, so the segment half-length is
     reach - GOALIE_BODY_RADIUS_FT (the body radius is part of it).
   - angleErrorFt is the sideways misread at the goalie's stance.
     getSquareUpPoint shifts the perceived puck, so the offset is
     scaled by (puck distance / stance depth) before it is passed in.
   - A poke roll needs both the carried puck and the skater within
     pokeRangeFt, so a skater standing off at range isn't stripped.

   Sections in this file
     1. Helpers (where the goalie may stand, sides, moving)
     2. createGoalie
     3. getGoalieCapsule (the shape the puck collides with)
     4. updateGoalie, one mode at a time:
          set → tracking → (reacting → diving) | poking | bitten
          diving / missed poke → recovering → tracking

   Random draws (all through the injected rng, never Math.random):
     - createGoalie: 1 draw (angle error for this attempt)
     - puck changes sides of center: 1 draw (fresh angle error)
     - each deke while tracking: 1 draw (bite or read)
     - each poke roll: 1 draw, at most once per POKE_CHECK_INTERVAL_S
   Nothing draws once per step, so a fixed seed replays exactly.

   Troubleshooting
   - The goalie never leaves the crease top: the skater has not
     crossed the blue line (y < BLUE_LINE_Y_FT), so it is still 'set'.
   - The goalie ignores a deke: dekes are only rolled while
     'tracking' and the skater has the puck.
   - Poke checks feel too frequent: one roll per POKE_CHECK_INTERVAL_S
     while the carried puck is within pokeRangeFt; tune pokeChance
     in constants.js rather than this file.
   - The goalie stands still after a shot: it waits reactionDelayMs
     (tier) before moving. Bitten and recovering goalies can't react
     until their timer ends.
   ============================================================= */

import {
    CENTER_X_FT, GOAL_LINE_Y_FT, BLUE_LINE_Y_FT, CREASE_RADIUS_FT, CREASE_EXIT_MAX_FT,
    DIVE_EXTEND_S, POKE_DURATION_S, POKE_CHECK_INTERVAL_S, BITE_SHIFT_FT, BITE_FREEZE_S,
    REACT_SPEED_MULTIPLIER, GOALIE_BODY_RADIUS_FT, PUCK_COLLISION_RADIUS_FT
} from './constants.js';
import { vec, add, subtract, scale, normalize, perpendicular, distanceBetween, fromAngle, copyInto } from './vector.js';
import { getSquareUpPoint } from './rink.js';

/** @typedef {import('./types.js').Vec2} Vec2 */
/** @typedef {import('./types.js').GoalieState} GoalieState */
/** @typedef {import('./types.js').GoalieMode} GoalieMode */
/** @typedef {import('./types.js').TierForRound} TierForRound */
/** @typedef {import('./types.js').RandomFn} RandomFn */
/** @typedef {import('./types.js').PuckState} PuckState */
/** @typedef {import('./types.js').SkaterState} SkaterState */
/** @typedef {import('./types.js').GameEvent} GameEvent */

/**
 * @typedef {object} GoalieContext
 * @property {PuckState} puck
 * @property {SkaterState} skater
 * @property {boolean} isShotThisStep - The puck left the stick this step.
 * @property {boolean} didDekeThisStep - The skater started a deke this step.
 */

/* ---------- 1. Helpers ---------- */

/** Center of the goal mouth on the goal line. */
const NET_CENTER = Object.freeze({ x: CENTER_X_FT, y: GOAL_LINE_Y_FT });
/** Farthest the goalie's center may be from the net center. */
const MAX_OUT_FT = CREASE_RADIUS_FT + CREASE_EXIT_MAX_FT;
/** Part of BITE_FREEZE_S spent sliding the wrong way; the rest is a frozen stance. */
const BITE_SLIDE_S = BITE_FREEZE_S / 3;
/** Reach is measured to the pad edge; a puck touches when its center is within reach plus its radius. */
const CONTACT_PAD_FT = PUCK_COLLISION_RADIUS_FT;

/**
 * Keeps a point in the goalie's zone: not behind the goal line, within the crease plus the exit allowance.
 * @param {Vec2} point @returns {Vec2}
 */
function clampToGoalieZone(point) {
    let x = point.x;
    let y = Math.max(point.y, GOAL_LINE_Y_FT);
    const dx = x - NET_CENTER.x;
    const dy = y - NET_CENTER.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_OUT_FT) {
        x = NET_CENTER.x + (dx / dist) * MAX_OUT_FT;
        y = NET_CENTER.y + (dy / dist) * MAX_OUT_FT;
    }
    return { x, y };
}

/** Which side of center a point is on: -1 left, 1 right (center counts as right). @param {Vec2} p */
function sideOf(p) {
    return p.x < CENTER_X_FT ? -1 : 1;
}

/** Sign helper that never returns 0. @param {number} value @param {-1|1} fallback @returns {-1|1} */
function signOr(value, fallback) {
    if (value > 0) return 1;
    if (value < 0) return -1;
    return fallback;
}

/**
 * Unit vector along the goalie's pads, perpendicular to the puck→net line, pointing to larger x.
 * @param {Vec2} puckPosition @returns {Vec2}
 */
function padsDirection(puckPosition) {
    const toNet = normalize(subtract(NET_CENTER, puckPosition));
    if (toNet.x === 0 && toNet.y === 0) return vec(1, 0);
    const across = perpendicular(toNet);
    return across.x < 0 || (across.x === 0 && across.y < 0) ? scale(across, -1) : across;
}

/**
 * Moves the goalie toward a target at up to `speed`, then clamps it into its zone.
 * @param {GoalieState} goalie @param {Vec2} target @param {number} speedFtPerS @param {number} dtS
 */
function moveToward(goalie, target, speedFtPerS, dtS) {
    const goal = clampToGoalieZone(target);
    const gap = subtract(goal, goalie.position);
    const dist = Math.hypot(gap.x, gap.y);
    const maxStep = speedFtPerS * dtS;
    const next = dist <= maxStep ? goal : add(goalie.position, scale(gap, maxStep / dist));
    copyInto(goalie.position, clampToGoalieZone(next));
}

/** The square-up target for the current puck, with this attempt's angle error. */
function squareUpTarget(goalie, puck, tier) {
    // angleOffsetFt is the sideways error at the goalie's stance. getSquareUpPoint shifts the
    // perceived puck instead, so scale it up by the puck's distance over the stance depth.
    const depthFt = Math.max(tier.params.depthFt, 0.5);
    const puckDistanceFt = Math.max(distanceBetween(puck.position, NET_CENTER), depthFt);
    return getSquareUpPoint(puck.position, tier.params.depthFt, goalie.angleOffsetFt * (puckDistanceFt / depthFt));
}

/**
 * Half-length of the capsule's segment for a reach: reach is measured from the goalie's center to
 * the outer edge of the pads, so the body radius is already part of it.
 * @param {number} reachFt @returns {number}
 */
function segmentHalfLength(reachFt) {
    return Math.max(0, reachFt - GOALIE_BODY_RADIUS_FT);
}

/** Switches mode and resets the mode timer. @param {GoalieState} goalie @param {GoalieMode} mode */
function enter(goalie, mode) {
    goalie.mode = mode;
    goalie.modeTimeS = 0;
}

/** Fresh per-attempt angle error. @param {TierForRound} tier @param {RandomFn} rng */
function rollAngleOffset(tier, rng) {
    return (rng() * 2 - 1) * tier.params.angleErrorFt;
}

/**
 * Where the shot will cross the horizontal line through the goalie, or null when the puck
 * isn't heading toward the goal line.
 * @param {GoalieState} goalie @param {PuckState} puck
 * @returns {{ x: number, timeS: number }|null}
 */
function predictCrossing(goalie, puck) {
    const vy = puck.velocity.y;
    if (vy >= 0) return null;
    const timeS = (goalie.position.y - puck.position.y) / vy;
    if (timeS < 0) return null;
    return { x: puck.position.x + puck.velocity.x * timeS, timeS };
}

/* ---------- 2. createGoalie ---------- */

/**
 * A goalie in the 'set' stance at its standing depth in front of the net.
 * @param {TierForRound} tier
 * @param {RandomFn} rng - One draw: this attempt's angle error.
 * @returns {GoalieState}
 */
export function createGoalie(tier, rng) {
    const position = clampToGoalieZone(vec(CENTER_X_FT, GOAL_LINE_Y_FT + tier.params.depthFt));
    return {
        position,
        previousPosition: { ...position },
        mode: 'set',
        modeTimeS: 0,
        reachFt: tier.params.saveReachFt,
        diveSide: 0,
        angleOffsetFt: rollAngleOffset(tier, rng),
        pokeRollCooldownS: 0,
        reactionLeftS: 0
    };
}

/* ---------- 3. getGoalieCapsule ---------- */

/**
 * The goalie's collision shape: a segment across the puck's line to the net, plus a radius.
 * While diving, the segment runs from the body out to `reachFt` on the dive side only.
 * @param {GoalieState} goalie
 * @param {Vec2} puckPosition
 * @returns {{ a: Vec2, b: Vec2, radiusFt: number }} `a` is the lower-x end.
 */
export function getGoalieCapsule(goalie, puckPosition) {
    const across = padsDirection(puckPosition);
    const center = goalie.position;
    if (goalie.mode === 'diving' && goalie.diveSide !== 0) {
        const tip = add(center, scale(across, segmentHalfLength(goalie.reachFt) * goalie.diveSide));
        const a = goalie.diveSide < 0 ? tip : { ...center };
        const b = goalie.diveSide < 0 ? { ...center } : tip;
        return { a, b, radiusFt: GOALIE_BODY_RADIUS_FT };
    }
    return {
        a: add(center, scale(across, -segmentHalfLength(goalie.reachFt))),
        b: add(center, scale(across, segmentHalfLength(goalie.reachFt))),
        radiusFt: GOALIE_BODY_RADIUS_FT
    };
}

/* ---------- 4. updateGoalie ---------- */

/**
 * One fixed step of the goalie. *Mutates* `goalie`.
 * Runs after the puck moves, so it reacts to a shot taken this step.
 * @param {GoalieState} goalie
 * @param {GoalieContext} context
 * @param {TierForRound} tier
 * @param {RandomFn} rng
 * @param {number} dtS
 * @returns {{ goalie: GoalieState, events: GameEvent[] }} Events: 'goalie_bit', 'goalie_read', 'poke'.
 */
export function updateGoalie(goalie, context, tier, rng, dtS) {
    const { puck, skater, isShotThisStep, didDekeThisStep } = context;
    const params = tier.params;
    /** @type {GameEvent[]} */
    const events = [];

    copyInto(goalie.previousPosition, goalie.position);
    goalie.modeTimeS += dtS;
    goalie.pokeRollCooldownS = Math.max(0, goalie.pokeRollCooldownS - dtS);

    // A fresh read of the angle each time the puck crosses center (1 draw).
    if (sideOf(puck.previousPosition) !== sideOf(puck.position)) {
        goalie.angleOffsetFt = rollAngleOffset(tier, rng);
    }

    const isFreeToReact = goalie.mode === 'set' || goalie.mode === 'tracking';
    if (isShotThisStep && isFreeToReact) {
        enter(goalie, 'reacting');
        goalie.reactionLeftS = params.reactionDelayMs / 1000;
    }

    switch (goalie.mode) {
        case 'set':
            if (skater.position.y < BLUE_LINE_Y_FT) enter(goalie, 'tracking');
            break;
        case 'tracking':
            updateTracking(goalie, context, tier, rng, dtS, events);
            break;
        case 'reacting':
            updateReacting(goalie, puck, tier, dtS);
            break;
        case 'diving':
            goalie.reachFt = Math.min(
                params.diveReachFt,
                params.saveReachFt + (params.diveReachFt - params.saveReachFt) * (goalie.modeTimeS / DIVE_EXTEND_S)
            );
            if (puck.mode !== 'shot') enter(goalie, 'recovering');
            break;
        case 'poking':
            updatePoking(goalie, puck, tier, dtS, events);
            break;
        case 'bitten':
            if (goalie.modeTimeS - dtS < BITE_SLIDE_S) {
                const slide = Math.min(dtS, Math.max(0, BITE_SLIDE_S - (goalie.modeTimeS - dtS)));
                const shift = (BITE_SHIFT_FT / BITE_SLIDE_S) * slide * goalie.diveSide;
                copyInto(goalie.position, clampToGoalieZone(vec(goalie.position.x + shift, goalie.position.y)));
            }
            if (goalie.modeTimeS >= BITE_FREEZE_S) finishTimedMode(goalie, puck, tier);
            break;
        case 'recovering':
            goalie.reachFt = params.saveReachFt;
            if (goalie.modeTimeS >= params.diveRecoveryMs / 1000) finishTimedMode(goalie, puck, tier);
            break;
        default:
            break;
    }
    return { goalie, events };
}

/**
 * Leaves 'bitten' or 'recovering': straight into a reaction if a shot is already on the way.
 * @param {GoalieState} goalie @param {PuckState} puck @param {TierForRound} tier
 */
function finishTimedMode(goalie, puck, tier) {
    goalie.diveSide = 0;
    goalie.reachFt = tier.params.saveReachFt;
    if (puck.mode === 'shot') {
        enter(goalie, 'reacting');
        goalie.reactionLeftS = tier.params.reactionDelayMs / 1000;
    } else {
        enter(goalie, 'tracking');
    }
}

/**
 * 'tracking': deke roll, poke roll, then shuffle toward the square-up point.
 * @param {GoalieState} goalie @param {GoalieContext} context @param {TierForRound} tier
 * @param {RandomFn} rng @param {number} dtS @param {GameEvent[]} events
 */
function updateTracking(goalie, context, tier, rng, dtS, events) {
    const { puck, skater, didDekeThisStep } = context;
    const params = tier.params;

    if (didDekeThisStep && skater.hasPuck) {
        if (rng() >= params.dekeReadChance) {
            // Bite: slide the wrong way, opposite the skater's deke direction.
            const dekeDirection = scale(perpendicular(fromAngle(skater.facingRad, 1)), skater.dekeSide);
            goalie.diveSide = signOr(-dekeDirection.x, skater.dekeSide === 1 ? -1 : 1);
            enter(goalie, 'bitten');
            events.push({ type: 'goalie_bit' });
            return;
        }
        events.push({ type: 'goalie_read' });
    }

    // Poke roll: the carried puck and the skater carrying it are both within reach of the stick.
    if (puck.mode === 'carried' && goalie.pokeRollCooldownS <= 0 &&
        distanceBetween(goalie.position, puck.position) <= params.pokeRangeFt &&
        distanceBetween(goalie.position, skater.position) <= params.pokeRangeFt) {
        goalie.pokeRollCooldownS = POKE_CHECK_INTERVAL_S;
        if (rng() < params.pokeChance) {
            enter(goalie, 'poking');
            updatePoking(goalie, puck, tier, dtS, events);
            return;
        }
    }

    moveToward(goalie, squareUpTarget(goalie, puck, tier), params.lateralSpeedFtPerS, dtS);
}

/**
 * 'reacting': wait out the reaction delay, then go to where the shot will cross; dive if needed.
 * @param {GoalieState} goalie @param {PuckState} puck @param {TierForRound} tier @param {number} dtS
 */
function updateReacting(goalie, puck, tier, dtS) {
    const params = tier.params;
    if (puck.mode !== 'shot') {
        enter(goalie, 'tracking');
        return;
    }
    if (goalie.reactionLeftS > 0) {
        goalie.reactionLeftS = Math.max(0, goalie.reactionLeftS - dtS);
        return;
    }
    const speed = params.lateralSpeedFtPerS * REACT_SPEED_MULTIPLIER;
    const crossing = predictCrossing(goalie, puck);
    if (!crossing) return;
    const gapX = crossing.x - goalie.position.x;
    const movable = speed * crossing.timeS;
    const needFt = Math.abs(gapX) - movable - CONTACT_PAD_FT;
    if (needFt > params.saveReachFt && needFt <= params.diveReachFt) {
        goalie.diveSide = signOr(gapX, 1);
        enter(goalie, 'diving');
    }
    moveToward(goalie, vec(crossing.x, goalie.position.y), speed, dtS);
}

/**
 * 'poking': lunge at the carried puck; contact ends the attempt with a 'poke' event.
 * @param {GoalieState} goalie @param {PuckState} puck @param {TierForRound} tier
 * @param {number} dtS @param {GameEvent[]} events
 */
function updatePoking(goalie, puck, tier, dtS, events) {
    const params = tier.params;
    if (puck.mode === 'carried') {
        const lungeSpeed = params.pokeRangeFt / POKE_DURATION_S;
        moveToward(goalie, puck.position, lungeSpeed, dtS);
        if (distanceBetween(goalie.position, puck.position) <= params.saveReachFt + CONTACT_PAD_FT) {
            events.push({ type: 'poke' });
            enter(goalie, 'recovering');
            return;
        }
    }
    if (goalie.modeTimeS >= POKE_DURATION_S) enter(goalie, 'recovering');
}
