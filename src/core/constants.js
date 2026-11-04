/* =============================================================
   src/core/constants.js
   Every tunable number in Breakaway, in one place.

   Units: feet (FT), seconds (S), milliseconds (MS), radians (RAD),
   degrees (DEG). The unit is always in the name.

   Coordinates: origin at the top-left of the rink's bounding box.
   x runs across the rink (0 to 85 ft). y runs from the end boards
   (0) toward center ice (100). The skater attacks toward smaller y.

   Sections in this file
     1. Loop timing
     2. Rules and scoring
     3. Rink geometry (real NHL measurements)
     4. Bodies (playability sizes, larger than real)
     5. Skater
     6. Shots and puck
     7. Goalie tiers and difficulty
     8. Storage and settings
     9. Rendering and audio

   Troubleshooting
   - The game feels too easy or too hard: change the goalie tier
     table in section 7. The stats tests check that tiers stay in
     order (Rookie easiest), not exact rates.
   - A test fails after a tuning change: tests import these values,
     so a failure means behavior changed, not that a number is copied.
   - A frozen-object error ("Cannot assign to read only property"):
     these objects are frozen on purpose; copy before changing.
   ============================================================= */

/**
 * Deep-freezes a plain object or array so shared constants can't be changed at run time.
 * @template T
 * @param {T} value - Object or array to freeze (nested objects included).
 * @returns {Readonly<T>} The same value, frozen.
 */
function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

/* ---------- 1. Loop timing ---------- */

/** One physics step: 120 per second (docs/decisions.md). */
export const FIXED_STEP_S = 1 / 120;
/** Longest frame the loop will account for; longer gaps are dropped, not simulated. */
export const MAX_FRAME_DT_S = 0.1;
/** Most physics steps run in one frame (spiral-of-death guard). */
export const MAX_STEPS_PER_FRAME = 12;

/* ---------- 2. Rules and scoring ---------- */

export const SHOT_CLOCK_S = 8;
export const REBOUND_WINDOW_S = 1.5;
export const BANNER_S = 1.2;
export const GOAL_LIGHT_S = 1.5;
export const ATTEMPTS_PER_ROUND = 5;
export const GOALS_TO_ADVANCE = 3;
export const POINTS_PER_GOAL = 100;
export const DEKE_BONUS_POINTS = 50;

/* ---------- 3. Rink geometry (feet, real NHL) ---------- */

export const RINK_WIDTH_FT = 85;
export const CORNER_RADIUS_FT = 28;
export const GOAL_LINE_Y_FT = 11;
export const BLUE_LINE_Y_FT = 75;
export const CENTER_LINE_Y_FT = 100;
export const CENTER_X_FT = RINK_WIDTH_FT / 2;
/** Distance between the two post centers. */
export const GOAL_MOUTH_FT = 6;
/** Net depth behind the goal line (40 in), toward the end boards. */
export const NET_DEPTH_FT = 40 / 12;
export const CREASE_RADIUS_FT = 6;
export const FACEOFF_CIRCLE_RADIUS_FT = 15;
export const FACEOFF_DOT_OFFSET_X_FT = 22;
export const FACEOFF_DOT_Y_FT = GOAL_LINE_Y_FT + 20;
export const CENTER_DOT = deepFreeze({ x: CENTER_X_FT, y: CENTER_LINE_Y_FT });
export const LEFT_POST = deepFreeze({ x: CENTER_X_FT - GOAL_MOUTH_FT / 2, y: GOAL_LINE_Y_FT });
export const RIGHT_POST = deepFreeze({ x: CENTER_X_FT + GOAL_MOUTH_FT / 2, y: GOAL_LINE_Y_FT });
/** Visible world box: 6 ft above the boards for the goal light, 4 ft past center for the start dot. */
export const VISIBLE_MIN_X_FT = -3;
export const VISIBLE_MAX_X_FT = 88;
export const VISIBLE_MIN_Y_FT = -6;
export const VISIBLE_MAX_Y_FT = 104;

/* ---------- 4. Bodies (playability sizes; docs/decisions.md) ---------- */

/** Real puck radius is 0.125 ft; 0.5 ft so it reads on a phone and hits posts often enough. */
export const PUCK_COLLISION_RADIUS_FT = 0.5;
/** Real post radius is about 0.1 ft. */
export const POST_RADIUS_FT = 0.25;
export const SKATER_RADIUS_FT = 1.5;
export const GOALIE_BODY_RADIUS_FT = 1.0;

/* ---------- 5. Skater ---------- */

export const SKATER_MAX_SPEED_FT_PER_S = 28;
export const SKATER_MAX_SPEED_WITH_PUCK_FT_PER_S = 26;
export const SKATER_ACCEL_FT_PER_S2 = 40;
export const SKATER_GLIDE_DECEL_FT_PER_S2 = 8;
export const SKATER_TURN_RATE_RAD_PER_S = 7;
/** Below this speed the skater keeps its facing instead of turning to its velocity. */
export const SKATER_TURN_MIN_SPEED_FT_PER_S = 1;
export const PUCK_CARRY_OFFSET_FT = 2.0;
export const DEKE_SPEED_FT_PER_S = 11;
export const DEKE_DURATION_S = 0.18;
export const DEKE_COOLDOWN_S = 0.8;
/** Facing at the start of each attempt: straight up the ice, toward the net. */
export const START_FACING_RAD = -Math.PI / 2;

/* ---------- 6. Shots and puck ---------- */

export const CHARGE_FULL_S = 1.0;
/** Power used when Space is released with no charge (TEST_PLAN Q2). */
export const MIN_POWER = 0.25;
export const SHOT_SPEED_MIN_FT_PER_S = 55;
export const SHOT_SPEED_MAX_FT_PER_S = 105;
export const SPREAD_MIN_DEG = 1;
export const SPREAD_MAX_DEG = 4;
export const AIM_SHOT_SPEED_FT_PER_S = 85;
export const AIM_SPREAD_DEG = 1.5;
export const ONE_BUTTON_SHOT_SPEED_FT_PER_S = 80;
export const ONE_BUTTON_SPREAD_DEG = 2;
export const PUCK_FRICTION_DECEL_FT_PER_S2 = 6;
export const PUCK_STOP_SPEED_FT_PER_S = 2;
export const POST_RESTITUTION = 0.5;
export const BOARD_RESTITUTION = 0.6;
export const MAX_BOUNCES_PER_STEP = 2;
export const REBOUND_SPEED_FT_PER_S = 14;
export const REBOUND_MAX_ANGLE_DEG = 35;

/* ---------- 7. Goalie tiers and difficulty ---------- */

/**
 * Goalie behavior per tier (ARCHITECTURE §6). Calibrated 2026-10-20 against the scripted-shot
 * stats tests: a settled goalie must leave the corners open. Rookie concedes about 39% of the
 * scripted shots, Pro about 20%, All-Star about 8%. saveReachFt runs from the goalie's center to
 * the pad edge.
 * @type {Readonly<Record<import('./types.js').TierName, import('./types.js').TierParams>>}
 */
export const TIER_PARAMS = deepFreeze({
    rookie: {
        reactionDelayMs: 155, lateralSpeedFtPerS: 10.5, angleErrorFt: 4.1, depthFt: 2.75,
        saveReachFt: 1.1, diveReachFt: 3.3, diveRecoveryMs: 900,
        pokeRangeFt: 5, pokeChance: 0.15, dekeReadChance: 0.25, reboundChance: 0.45
    },
    pro: {
        reactionDelayMs: 130, lateralSpeedFtPerS: 11, angleErrorFt: 2.3, depthFt: 3.4,
        saveReachFt: 1.35, diveReachFt: 3.8, diveRecoveryMs: 700,
        pokeRangeFt: 6, pokeChance: 0.3, dekeReadChance: 0.5, reboundChance: 0.3
    },
    all_star: {
        reactionDelayMs: 100, lateralSpeedFtPerS: 12.5, angleErrorFt: 1.85, depthFt: 3.95,
        saveReachFt: 1.55, diveReachFt: 4.3, diveRecoveryMs: 550,
        pokeRangeFt: 7, pokeChance: 0.45, dekeReadChance: 0.7, reboundChance: 0.2
    }
});
/** How far the goalie may come out past the top of the crease. */
export const CREASE_EXIT_MAX_FT = 3;
export const DIVE_EXTEND_S = 0.12;
export const POKE_DURATION_S = 0.25;
export const POKE_CHECK_INTERVAL_S = 0.5;
export const BITE_SHIFT_FT = 2.5;
export const BITE_FREEZE_S = 0.45;
/** Reacting goalies move this much faster than their tracking speed. */
export const REACT_SPEED_MULTIPLIER = 1.5;
/** All-Star gets this much better per round past its first, up to the cap. */
export const ALL_STAR_STEP = 0.04;
export const ALL_STAR_IMPROVEMENT_CAP = 0.2;
/** Highest any per-roll chance can reach after improvement. */
export const CHANCE_MAX = 0.95;
/** Schedule index where each starting level begins (index 0–1 Rookie, 2–3 Pro, 4+ All-Star). */
export const STARTING_LEVEL_OFFSETS = deepFreeze({ ladder: 0, pro: 2, all_star: 4 });
export const PRO_FIRST_INDEX = 2;
export const ALL_STAR_FIRST_INDEX = 4;

/* ---------- 8. Storage and settings ---------- */

export const STORAGE_PREFIX = 'breakaway.';
export const SETTINGS_KEY = 'breakaway.settings';
export const BEST_SCORES_KEY = 'breakaway.best_scores';
export const SCHEMA_VERSION = 1;
export const CONTROL_SCHEMES = deepFreeze(['hold_charge', 'aim_mouse', 'one_button']);
export const STARTING_LEVELS = deepFreeze(['ladder', 'pro', 'all_star']);
export const MOTION_PREFERENCES = deepFreeze(['system', 'reduce', 'full']);
/** @type {Readonly<import('./types.js').Settings>} */
export const DEFAULT_SETTINGS = deepFreeze({
    schema_version: SCHEMA_VERSION,
    control_scheme: 'hold_charge',
    is_sound_on: true,
    motion_preference: 'system',
    starting_level: 'ladder'
});

/* ---------- 9. Rendering and audio ---------- */

export const DPR_MAX = 3;
export const SCRATCH_MAX = 120;
export const STICKHANDLE_SOUNDS_PER_S_MAX = 6;
