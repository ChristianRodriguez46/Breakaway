/* =============================================================
   src/core/types.js
   Shared JSDoc types for Breakaway. No runtime code.

   VS Code and `tsc -p jsconfig.json` read these comments to check
   the JavaScript, the way a C++ header declares types. Import a type
   in a comment with:
       /** @typedef {import('./types.js').GameState} GameState *\/

   Units: feet, seconds and radians unless the name says otherwise.
   ============================================================= */

/** @typedef {{ x: number, y: number }} Vec2 Feet, or feet per second for velocities. */
/** @typedef {'hold_charge'|'aim_mouse'|'one_button'} ControlScheme */
/** @typedef {'ladder'|'pro'|'all_star'} StartingLevel Ladder is the Rookie start. */
/** @typedef {'rookie'|'pro'|'all_star'} TierName */
/** @typedef {'system'|'reduce'|'full'} MotionPreference */
/** @typedef {'goal'|'save'|'wide'|'post_out'|'poke'|'time'} Outcome */
/** @typedef {'start'|'playing'|'rebound_window'|'result_banner'|'round_summary'|'paused'|'game_over'} Phase */
/** @typedef {'goal'|'miss'|'current'|'pending'} MarkerState */
/** @typedef {() => number} RandomFn Returns a number in [0, 1). */

/**
 * What the player is asking for during one fixed step. Edge flags are true for one step only.
 * @typedef {object} Intent
 * @property {number} moveX - -1 to 1, normalized with moveY when diagonal.
 * @property {number} moveY - -1 to 1 (negative = up the ice, toward the net).
 * @property {boolean} isShootHeld
 * @property {boolean} shootPressed
 * @property {boolean} shootReleased
 * @property {Vec2|null} aimPoint - World feet; Aim with mouse only, set on the shoot edge.
 * @property {boolean} dekePressed
 * @property {-1|0|1} dekeSide - Side held when the deke was pressed; 0 = none.
 */

/**
 * @typedef {object} TierParams
 * @property {number} reactionDelayMs
 * @property {number} lateralSpeedFtPerS
 * @property {number} angleErrorFt
 * @property {number} depthFt
 * @property {number} saveReachFt
 * @property {number} diveReachFt
 * @property {number} diveRecoveryMs
 * @property {number} pokeRangeFt
 * @property {number} pokeChance
 * @property {number} dekeReadChance
 * @property {number} reboundChance
 */
/** @typedef {{ tierName: TierName, improvement: number, params: TierParams }} TierForRound */

/**
 * @typedef {object} SkaterState
 * @property {Vec2} position
 * @property {Vec2} previousPosition
 * @property {Vec2} velocity
 * @property {number} facingRad
 * @property {boolean} hasPuck
 * @property {number} dekeTimeLeftS
 * @property {number} dekeCooldownS
 * @property {-1|1} dekeSide
 * @property {number} chargeHeldS
 * @property {boolean} isCharging
 */

/** @typedef {'carried'|'shot'|'loose'|'absorbed'|'in_net'} PuckMode */
/**
 * @typedef {object} PuckState
 * @property {Vec2} position
 * @property {Vec2} previousPosition
 * @property {Vec2} velocity
 * @property {PuckMode} mode
 * @property {boolean} hasHitPost
 */

/** @typedef {'set'|'tracking'|'reacting'|'diving'|'poking'|'bitten'|'recovering'} GoalieMode */
/**
 * @typedef {object} GoalieState
 * @property {Vec2} position
 * @property {Vec2} previousPosition
 * @property {GoalieMode} mode
 * @property {number} modeTimeS - Time spent in the current mode.
 * @property {number} reachFt - Current capsule half-length (grows during a dive).
 * @property {-1|0|1} diveSide
 * @property {number} angleOffsetFt - Per-attempt misread of the puck's position.
 * @property {number} pokeRollCooldownS
 * @property {number} reactionLeftS
 */

/**
 * @typedef {object} RoundState
 * @property {number} number - 1-based round number.
 * @property {Outcome[]} attemptOutcomes
 * @property {number} goals
 * @property {number} points
 * @property {TierForRound} tier
 */

/**
 * @typedef {object} GameState
 * @property {Phase} phase
 * @property {Phase|null} resumePhase
 * @property {ControlScheme} scheme
 * @property {StartingLevel} startingLevel
 * @property {RoundState} round
 * @property {number} attemptIndex - 0-based within the round.
 * @property {number} shotClockS
 * @property {number} bannerLeftS
 * @property {number} reboundLeftS
 * @property {boolean} hasUsedRebound
 * @property {boolean} didGoalieBiteThisAttempt
 * @property {Outcome|null} lastOutcome
 * @property {boolean} wasLastShotShort - The last `wide` was a puck that stopped short ("No shot").
 * @property {number} runScore
 * @property {number} runGoals
 * @property {number} roundsCleared
 * @property {SkaterState} skater
 * @property {PuckState} puck
 * @property {GoalieState} goalie
 * @property {number} stepCount
 */

/**
 * @typedef {object} GameEvent
 * @property {'attempt_started'|'stickhandle'|'shot'|'deke'|'goalie_bit'|'goalie_read'|'post'|'save'|
 *   'rebound'|'poke'|'goal'|'wide'|'time'|'outcome'|'round_cleared'|'round_failed'|'run_over'|
 *   'paused'|'resumed'} type
 * @property {Outcome} [outcome]
 * @property {number} [points]
 * @property {boolean} [isShortOfNet]
 */
/** @typedef {{ state: GameState, events: GameEvent[] }} StepResult */

/**
 * @typedef {object} Settings
 * @property {1} schema_version
 * @property {ControlScheme} control_scheme
 * @property {boolean} is_sound_on
 * @property {MotionPreference} motion_preference
 * @property {StartingLevel} starting_level
 */
/** @typedef {{ score: number, rounds_cleared: number, goals: number, achieved_at: string }} BestScore */
/** @typedef {{ schema_version: 1, scores: Record<string, BestScore> }} BestScores Keys are "<scheme>:<level>". */

export {};
