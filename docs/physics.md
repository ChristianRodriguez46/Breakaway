# Physics

This covers how the skater, the puck, the rink and collisions work in Breakaway. All of it lives in `src/core/` as plain functions with no browser code, so I can test it in Node. Every number below is in `src/core/constants.js`, in feet and seconds.

## What it does

- The skater accelerates, glides, turns, dekes and charges a shot.
- The puck is carried, shot, bounces off the boards and posts, slows with friction, and counts as a goal only when it fully crosses the line between the posts.
- A fast puck can't pass through a post or the goalie between two steps, because I test the whole path of each step, not just where the puck ends up.

The loop calls `stepGame()` in `game.js` 120 times a second (`FIXED_STEP_S = 1/120`). The order inside one step is: skater, shot, skater pushed out of the goalie, puck, goalie, rules.

## How it works

### Rink (`rink.js`)

The playable area is the attacking end of a real rink: straight side boards at `x = 0` and `x = 85`, the end boards at `y = 0`, and two quarter-circle corners of 28 ft. The bottom of the view (center ice) is open.

- `getGoalMouth()` gives the posts and goal line.
- `isInsideBoards(position, radiusFt)` is a yes/no test.
- `collideWithBoards(position, velocity, radiusFt, restitution)` pushes a circle back inside and reflects its velocity. Skaters pass restitution 0 so they slide along the boards. Pucks pass 0.6.
- `clampToSkaterZone(position)` keeps the skater inside the boards, in front of the goal line (no wraparounds), and above `VISIBLE_MAX_Y_FT`.

### Skater (`skater.js`)

`updateSkater(skater, intent, scheme, dtS)` does one step:

1. Clamp the move input to length 1, so a diagonal is not faster than straight. A half-pushed touch stick is half speed.
2. With input, accelerate toward the target velocity. Without input, glide: slow down at the glide deceleration until it snaps to exactly 0.
3. Turn facing toward the velocity by the shortest arc (`wrapAngle`), limited by the turn rate, and only above a minimum speed so it doesn't snap while stopping.
4. A deke is a sideways shove added to the position (not the velocity) for a short time, so it can't push me past top speed and it ends cleanly.
5. Clamp into the skater zone and remove the velocity going into the wall.

`pushOutOfGoalie()` moves the skater out of the goalie's capsule. `getChargePower(chargeHeldS)` turns hold time into power from `MIN_POWER` to 1.

### Puck (`puck.js`)

- `carryPuck()` keeps the puck `PUCK_CARRY_OFFSET_FT` in front of the skater.
- `createShotVelocity()` makes the shot velocity for the control scheme. It uses exactly one random draw for the spread.
- `updatePuck(puck, dtS, goalieCapsule)` applies friction, then sweeps the move from the old position to the new one against the two posts, the goalie, the goal line and the boards. The earliest contact wins. If a post or board is hit, the rest of the move continues from the bounce, at most `MAX_BOUNCES_PER_STEP` times. A tie goes to post, then goalie, then goal, then board, so a goalie touch at the same instant as the crossing is a save.
- A goal needs the whole puck across the line (center past `GOAL_LINE_Y_FT` minus the puck radius) and the center strictly between the inner post edges. The puck then becomes `in_net` and never reports contacts again, so one shot can't score twice.
- `setRebound()` kicks a saved puck back toward center ice at `REBOUND_SPEED_FT_PER_S`, turned by up to `REBOUND_MAX_ANGLE_DEG`.

### Collision (`collision.js`)

A sweep asks: at what fraction t of this step (0 is the start, 1 is the end) does the moving circle first touch something?

- `sweepCircleVsCircle()` is for posts. It solves a quadratic for the point where the path gets within the sum of the radii of the post center.
- `sweepCircleVsCapsule()` is for the goalie, a segment with a radius. A capsule is a rectangle plus two end circles, so the first touch is the earliest of three simple tests.
- `sweepCrossesY()` finds when the puck crosses the goal line going up the ice.
- `closestPointOnSegment()` and `reflectVelocity(velocity, normal, restitution)` do the geometry and the bounce. Only the part of the velocity going into the surface is flipped and scaled. A puck already moving away is left alone, so it doesn't bounce twice.
- Touching counts as contact. A small tolerance (`CONTACT_EPS_FT2`) absorbs rounding so an exact touch isn't missed.

## Tuning numbers

| What | Constant | Value |
|---|---|---|
| Step | `FIXED_STEP_S` | 1/120 s |
| Skater top speed | `SKATER_MAX_SPEED_FT_PER_S` | 28 ft/s (26 with the puck) |
| Skater acceleration | `SKATER_ACCEL_FT_PER_S2` | 40 ft/s squared |
| Glide slow-down | `SKATER_GLIDE_DECEL_FT_PER_S2` | 8 ft/s squared |
| Turn rate | `SKATER_TURN_RATE_RAD_PER_S` | 7 rad/s |
| Deke | `DEKE_SPEED_FT_PER_S`, `DEKE_DURATION_S`, `DEKE_COOLDOWN_S` | 11 ft/s, 0.18 s, 0.8 s |
| Full charge | `CHARGE_FULL_S` | 1.0 s; a tap gives `MIN_POWER` 0.25 |
| Charged shot speed | `SHOT_SPEED_MIN` to `MAX` | 55 to 105 ft/s |
| Charged shot spread | `SPREAD_MIN_DEG` to `MAX` | 1 to 4 degrees |
| Aim shot | `AIM_SHOT_SPEED_FT_PER_S`, `AIM_SPREAD_DEG` | 85 ft/s, 1.5 degrees |
| One-button shot | `ONE_BUTTON_SHOT_SPEED_FT_PER_S`, `ONE_BUTTON_SPREAD_DEG` | 80 ft/s, 2 degrees |
| Puck friction | `PUCK_FRICTION_DECEL_FT_PER_S2` | 6 ft/s squared; stops below 2 ft/s |
| Bounciness | `BOARD_RESTITUTION`, `POST_RESTITUTION` | 0.6, 0.5 |
| Rebound | `REBOUND_SPEED_FT_PER_S`, `REBOUND_MAX_ANGLE_DEG` | 14 ft/s, 35 degrees |
| Sizes | puck, post, skater, goalie body radius | 0.5, 0.25, 1.5, 1.0 ft |
| Rink | width, corner radius, goal line, blue line | 85, 28, 11, 75 ft |
| Goal mouth, crease | `GOAL_MOUTH_FT`, `CREASE_RADIUS_FT` | 6 ft, 6 ft |

The sizes of the puck, posts and players are larger than real on purpose so the game reads on a phone. The decision is in [decisions.md](./decisions.md).

## Tests

`tests/unit/collision.test.js`, `rink.test.js`, `skater.test.js` and `puck.test.js` cover the geometry. `tests/stats/shot-outcomes.test.js` fires scripted shots and checks how often each goalie tier gives up a goal.

## Changelog

- 2026-10-21: Wrote this page from the current code and constants.
- 2026-10-20: Players and puck are drawn larger on small screens. This changes drawing only, not the physics sizes above.
- 2026-10-19: Added swept collision tests, board and corner bounces, post bounces, friction and the goal-line rule.
