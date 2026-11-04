/* =============================================================
   src/core/game.js
   One fixed step of the whole game.

   stepGame() is the only thing the loop calls 120 times a second.
   It runs the physics order from ARCHITECTURE §5 and hands the
   result to the rules (rules.js):

     1. skater moves (and maybe dekes, picks up a loose rebound)
     2. the shot leaves the stick on this scheme's shoot edge
     3. skater is pushed out of the goalie
     4. puck: carried, or swept against posts, goalie, goal, boards
     5. goalie reacts (after the puck, so it sees this step's shot)
     6. rules: contacts → outcome; rebound roll on a save; the
        rebound window and shot clock tick last (physics beats Time)

   Sections in this file
     1. Helpers (shoot edge, wide crossing, loose-puck pickup)
     2. stepGame
     3. The live step (playing and rebound_window)

   Troubleshooting
   - Nothing happens when stepping: stepGame only acts in 'playing',
     'rebound_window' and 'result_banner'. 'start' needs startRun(),
     'paused' needs resumeGame(), 'round_summary' needs startNextRound().
   - A charged shot never fires: hold_charge fires on shootReleased
     only after a fresh shootPressed started a charge this attempt.
   - Replays differ with the same seed: something drew from rng
     outside this file's order, or used Math.random. Every draw goes
     through the rng passed to stepGame.
   ============================================================= */

import {
    FIXED_STEP_S, GOAL_LINE_Y_FT, REBOUND_WINDOW_S, PUCK_CARRY_OFFSET_FT, PUCK_COLLISION_RADIUS_FT,
    SKATER_TURN_MIN_SPEED_FT_PER_S, STICKHANDLE_SOUNDS_PER_S_MAX
} from './constants.js';
import { lengthOf, distanceBetween } from './vector.js';
import { getGoalMouth } from './rink.js';
import { updateSkater, pushOutOfGoalie, getChargePower } from './skater.js';
import { carryPuck, createShotVelocity, updatePuck, setRebound } from './puck.js';
import { getGoalieCapsule, updateGoalie } from './goalie.js';
import { resolveStepOutcome, finishAttempt, advanceAfterBanner } from './rules.js';

/** @typedef {import('./types.js').GameState} GameState */
/** @typedef {import('./types.js').Intent} Intent */
/** @typedef {import('./types.js').RandomFn} RandomFn */
/** @typedef {import('./types.js').StepResult} StepResult */
/** @typedef {import('./types.js').GameEvent} GameEvent */
/** @typedef {import('./types.js').PuckState} PuckState */

/* ---------- 1. Helpers ---------- */

/** A loose puck this close to the skater's center is picked up. */
const PICKUP_DISTANCE_FT = PUCK_CARRY_OFFSET_FT + PUCK_COLLISION_RADIUS_FT;
/** Steps between stickhandle events while skating with the puck. */
const STICKHANDLE_EVERY_STEPS = Math.ceil(1 / (STICKHANDLE_SOUNDS_PER_S_MAX * FIXED_STEP_S));

/**
 * Whether this step's intent fires a shot in the given scheme.
 * @param {GameState} state @param {Intent} intent @param {boolean} wasCharging - Charging before the skater step.
 * @returns {{ isShot: boolean, power: number }}
 */
function readShootEdge(state, intent, wasCharging) {
    const { scheme, skater } = state;
    if (!skater.hasPuck || state.puck.mode !== 'carried') return { isShot: false, power: 0 };
    if (scheme === 'hold_charge') {
        const isShot = intent.shootReleased && (wasCharging || intent.shootPressed);
        return { isShot, power: isShot ? getChargePower(skater.chargeHeldS) : 0 };
    }
    if (scheme === 'aim_mouse') return { isShot: intent.shootPressed && intent.aimPoint !== null, power: 1 };
    return { isShot: intent.shootPressed, power: 1 };
}

/**
 * Whether the puck's center crossed the goal line this step outside the goal mouth.
 * @param {PuckState} puck @returns {boolean}
 */
function didCrossGoalLineWide(puck) {
    const from = puck.previousPosition;
    const to = puck.position;
    if (!(from.y >= GOAL_LINE_Y_FT && to.y < GOAL_LINE_Y_FT)) return false;
    const t = (from.y - GOAL_LINE_Y_FT) / (from.y - to.y);
    const crossX = from.x + (to.x - from.x) * t;
    const mouth = getGoalMouth();
    return crossX <= mouth.leftInnerX || crossX >= mouth.rightInnerX;
}

/* ---------- 2. stepGame ---------- */

/**
 * Runs one FIXED_STEP_S step. *Mutates and returns* the same state object.
 * Acts only in 'playing', 'rebound_window' and 'result_banner'; elsewhere returns no events.
 * @param {GameState} state
 * @param {Intent} intent - This step's input (edge flags already consumed for this step).
 * @param {RandomFn} rng - Every random draw this step comes from here.
 * @returns {StepResult}
 */
export function stepGame(state, intent, rng) {
    if (state.phase === 'result_banner') {
        state.stepCount += 1;
        state.bannerLeftS -= FIXED_STEP_S;
        const events = state.bannerLeftS <= 1e-9 ? advanceAfterBanner(state, rng) : [];
        return { state, events };
    }
    if (state.phase !== 'playing' && state.phase !== 'rebound_window') return { state, events: [] };
    state.stepCount += 1;
    return { state, events: stepLive(state, intent, rng) };
}

/* ---------- 3. The live step ---------- */

/**
 * One step of play. *Mutates* state.
 * @param {GameState} state @param {Intent} intent @param {RandomFn} rng @returns {GameEvent[]}
 */
function stepLive(state, intent, rng) {
    const dtS = FIXED_STEP_S;
    const { skater, puck } = state;
    const tier = state.round.tier;
    const isReboundPhase = state.phase === 'rebound_window';
    /** @type {GameEvent[]} */
    const events = [];

    // 1. Skater.
    const wasCharging = skater.isCharging;
    const { didDeke } = updateSkater(skater, intent, state.scheme, dtS);
    if (didDeke) events.push({ type: 'deke' });
    if (isReboundPhase && puck.mode === 'loose' && distanceBetween(skater.position, puck.position) <= PICKUP_DISTANCE_FT) {
        skater.hasPuck = true;
        puck.mode = 'carried';
    }

    // 2. Shot.
    const { isShot, power } = readShootEdge(state, intent, wasCharging);
    if (isShot) {
        carryPuck(puck, skater);
        puck.velocity = createShotVelocity({
            scheme: state.scheme, facingRad: skater.facingRad, origin: { ...puck.position },
            aimPoint: intent.aimPoint, power, rng
        });
        puck.mode = 'shot';
        skater.hasPuck = false;
        skater.isCharging = false;
        events.push({ type: 'shot' });
        if (isReboundPhase) {
            state.phase = 'playing';
            state.reboundLeftS = 0;
        }
    }

    // 3. Skater vs goalie.
    const skaterCapsule = getGoalieCapsule(state.goalie, puck.position);
    pushOutOfGoalie(skater, skaterCapsule.a, skaterCapsule.b, skaterCapsule.radiusFt);

    // 4. Puck.
    /** @type {Array<{ kind: 'post'|'goalie'|'goal'|'board', tStep: number }>} */
    let contacts = [];
    let didStop = false;
    let didLeaveView = false;
    let crossedWide = false;
    if (puck.mode === 'carried') {
        carryPuck(puck, skater);
        if (lengthOf(skater.velocity) > SKATER_TURN_MIN_SPEED_FT_PER_S && state.stepCount % STICKHANDLE_EVERY_STEPS === 0) {
            events.push({ type: 'stickhandle' });
        }
    } else if (puck.mode === 'shot' || puck.mode === 'loose') {
        const result = updatePuck(puck, dtS, getGoalieCapsule(state.goalie, puck.position));
        contacts = result.contacts;
        didStop = result.didStop;
        didLeaveView = result.didLeaveView;
        crossedWide = didCrossGoalLineWide(puck);
        for (const contact of contacts) {
            if (contact.kind === 'post') {
                puck.hasHitPost = true;
                events.push({ type: 'post' });
            }
        }
    }

    // 5. Goalie (after the puck).
    const goalieResult = updateGoalie(state.goalie, {
        puck, skater, isShotThisStep: isShot, didDekeThisStep: didDeke
    }, tier, rng, dtS);
    let didPoke = false;
    for (const event of goalieResult.events) {
        events.push(event);
        if (event.type === 'goalie_bit') state.didGoalieBiteThisAttempt = true;
        if (event.type === 'poke') didPoke = true;
    }
    if (didPoke) {
        skater.hasPuck = false;
        puck.mode = 'loose';
        puck.velocity = { x: 0, y: 0 };
    }

    // 6. Rules. A loose rebound waiting to be picked up doesn't end the attempt by stopping.
    const isWaitingRebound = state.phase === 'rebound_window' && puck.mode !== 'shot';
    const physicsFlags = {
        didPoke,
        didCrossGoalLineWide: !isWaitingRebound && crossedWide,
        didStop: !isWaitingRebound && didStop,
        didLeaveView: !isWaitingRebound && didLeaveView
    };
    if (isWaitingRebound && (didStop || didLeaveView)) puck.velocity = { x: 0, y: 0 };
    let outcome = resolveStepOutcome(state, contacts, physicsFlags);

    if (outcome === 'save') {
        events.push({ type: 'save' });
        if (!state.hasUsedRebound && rng() < tier.params.reboundChance) {
            setRebound(puck, state.goalie.position, rng);
            puck.mode = 'loose';
            state.hasUsedRebound = true;
            state.phase = 'rebound_window';
            state.reboundLeftS = REBOUND_WINDOW_S;
            events.push({ type: 'rebound' });
            outcome = null;
        } else {
            puck.mode = 'absorbed';
            puck.velocity = { x: 0, y: 0 };
        }
    } else if (outcome === 'goal') {
        puck.mode = 'in_net';
    }

    // Timers tick last, so a physics outcome this step beats them (Q4).
    const didReboundJustStart = events.some((event) => event.type === 'rebound');
    state.shotClockS = Math.max(0, state.shotClockS - dtS);
    if (state.phase === 'rebound_window' && !didReboundJustStart) {
        state.reboundLeftS = Math.max(0, state.reboundLeftS - dtS);
    }
    if (outcome === null && !didReboundJustStart) {
        outcome = resolveStepOutcome(state, [], {
            isReboundExpired: state.phase === 'rebound_window' && state.reboundLeftS <= 1e-9,
            isClockExpired: state.shotClockS <= 1e-9
        });
    } else if (outcome === null && state.shotClockS <= 1e-9) {
        outcome = 'time';
    }

    if (outcome !== null) {
        const isShortOfNet = outcome === 'wide' && !crossedWide;
        for (const event of finishAttempt(state, outcome, { isShortOfNet })) events.push(event);
    }
    return events;
}
