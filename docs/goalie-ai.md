# Goalie AI

The goalie is a small state machine in `src/core/goalie.js`. The difficulty levels are the same code with different numbers, which live in `constants.js` and are read through `difficulty.js`.

## What it does

The goalie squares up to the puck, waits a short reaction time after a shot, moves to where the shot will cross, and dives if the shot is outside its normal reach. It can poke check a skater who carries the puck too close. When I deke, it either bites (slides the wrong way for a moment) or reads it. After some saves it gives up a rebound.

## How it works

### Shape

`getGoalieCapsule(goalie, puckPosition)` returns the shape the puck collides with: a segment (the pads and blocker) with a radius (`GOALIE_BODY_RADIUS_FT`). The segment is centered on the goalie and turned across the line from the puck to the net, so the puck has to beat its ends. While diving, the segment reaches out to one side only.

### Modes

`updateGoalie(goalie, context, tier, rng, dtS)` runs once per step, after the puck moves, so it sees a shot taken this step.

| Mode | What happens | Leaves when |
|---|---|---|
| `set` | Stands at its depth in front of the net | The skater crosses the blue line, then `tracking` |
| `tracking` | Rolls for a deke read, rolls for a poke, then shuffles to the square-up point | A shot (`reacting`), a bite (`bitten`), a poke roll that hits (`poking`) |
| `reacting` | Waits `reactionDelayMs`, predicts where the shot crosses its line, moves there at 1.5 times its normal speed | If the gap is beyond normal reach but within dive reach, `diving` |
| `diving` | Reach grows from `saveReachFt` to `diveReachFt` in 0.12 s, on one side | The puck stops being a shot, then `recovering` |
| `poking` | Lunges at the carried puck. Contact ends the attempt as a poke check | Contact or 0.25 s, then `recovering` |
| `bitten` | Slides 2.5 ft the wrong way, then freezes, 0.45 s in all | Timer ends, then `tracking` (or `reacting` if a shot is already on its way) |
| `recovering` | Can't react. Lasts `diveRecoveryMs` | Timer ends, then `tracking` |

Key helper functions: `getSquareUpPoint()` in `rink.js` (where it wants to stand), `predictCrossing()` (where the shot will cross), `moveToward()` (moves at a capped speed and stays inside its zone), `clampToGoalieZone()` (never behind the goal line, never more than 3 ft past the top of the crease).

### Angle error

Each attempt the goalie draws a sideways error up to `angleErrorFt`. It redraws it when the puck crosses the center line. The error shifts where the goalie thinks the puck is, so it stands a little off the true line. That is what leaves the corners open.

### Deke: bite or read

When I deke while carrying the puck and the goalie is tracking, it makes one random draw. If the draw is at or above `dekeReadChance`, it bites and slides opposite my deke direction, and the attempt earns the deke bonus if I score. Otherwise it reads the deke and stays square.

### Randomness

All draws go through the injected `rng`. Nothing draws once per step, only on events (a new goalie, the puck crossing center, a deke, a poke roll at most every 0.5 s), so the same seed replays the same game.

## Difficulty and the tier table

`getTierForRound(startingLevel, roundNumber)` gives the tier. The schedule index is the starting level offset plus the round number minus 1: index 0 and 1 are Rookie, 2 and 3 are Pro, 4 and up are All-Star. Offsets: Ladder 0, Pro start 2, All-Star start 4.

All-Star keeps improving after its first round: `improvement = min(0.04 x (index - 4), 0.2)`. `applyImprovement()` then multiplies speeds, reaches and the poke and deke-read chances by `1 + improvement` (chances capped at 0.95), divides reaction delay and dive recovery by it, and multiplies angle error and rebound chance by `1 - improvement`. Depth doesn't change.

| Parameter | Rookie | Pro | All-Star |
|---|---|---|---|
| Reaction delay | 155 ms | 130 ms | 100 ms |
| Lateral speed | 10.5 ft/s | 11 ft/s | 12.5 ft/s |
| Angle error | 4.1 ft | 2.3 ft | 1.85 ft |
| Depth out from the net | 2.75 ft | 3.4 ft | 3.95 ft |
| Save reach | 1.1 ft | 1.35 ft | 1.55 ft |
| Dive reach | 3.3 ft | 3.8 ft | 4.3 ft |
| Dive recovery | 900 ms | 700 ms | 550 ms |
| Poke range | 5 ft | 6 ft | 7 ft |
| Poke chance | 15% | 30% | 45% |
| Deke read chance | 25% | 50% | 70% |
| Rebound chance | 45% | 30% | 20% |

I calibrated the table against scripted shots in `tests/stats/shot-outcomes.test.js`: Rookie gives up about 39% of them, Pro about 20% and All-Star about 8%. `deke-bite.test.js` and `poke-rate.test.js` check the other two behaviors.

Other goalie numbers: bite shift 2.5 ft, bite freeze 0.45 s, poke lasts 0.25 s, dive extends over 0.12 s, reacting speed multiplier 1.5.

## Changelog

- 2026-10-21: Wrote this page from the current code and the tier table.
- 2026-10-20: Recalibrated the tiers. The goalie was stopping almost every shot because pads plus body covered more than the 6 ft goal mouth. Now Rookie concedes about 39%, Pro about 20%, All-Star about 8%.
- 2026-10-19: Added the goalie modes, the difficulty schedule and All-Star improvement.
