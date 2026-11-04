# Rules and scoring

This covers the rules of a run, the one-step game function, scoring, and the data the game saves. The code is in `rules.js`, `game.js`, `scoring.js` and `settings.js` in `src/core/`, plus `src/browser/storage.js` for the part that touches `localStorage`.

## What it does

A run is a series of rounds. A round is 5 attempts, and I need 3 goals to advance. Every attempt starts with me at the center-ice dot holding the puck and the goalie in the crease, like a shootout. The run ends as soon as 3 goals are out of reach, so 0 goals after 3 attempts ends it.

Each attempt ends in one of these outcomes:

| Outcome | What happened |
|---|---|
| Goal | The whole puck crossed the line between the posts |
| Save | The goalie stopped it and there was no rebound (or the rebound ran out) |
| Wide | The shot missed the net, or left the view. If the puck stopped before reaching the net, the banner says "No shot" |
| Post and out | It hit a post this attempt and then missed |
| Poke check | The goalie took the puck from me |
| Time | The 8 second shot clock ran out (also what happens if I never shoot) |

Some saves leave a rebound: the puck is loose in front and I have 1.5 seconds to collect it and shoot once more. Only one rebound per attempt, and the chance depends on the goalie tier.

## How it works

### The phases

`rules.js` is a state machine over `state.phase`:

- `start`, then `startRun()`, then `playing`.
- `playing` and `rebound_window` go to `result_banner` when an attempt ends (`finishAttempt()`).
- After the banner, `advanceAfterBanner()` goes to the next attempt, to `round_summary` after attempt 5 of a cleared round, or to `game_over` when `isRoundLost(goals, attemptsPlayed)` says 3 goals are out of reach.
- `startNextRound()` moves from the summary to attempt 1 of the next round with the tier from the schedule.
- `pauseGame()` and `resumeGame()` work from any live phase and remember where I was in `resumePhase`.

`createGameState({ scheme, startingLevel, rng })` builds the whole state as plain data. It throws a `TypeError` for an unknown scheme or level, because that is a programming mistake and not player input.

### One step

`stepGame(state, intent, rng)` in `game.js` is the only function the loop calls 120 times a second. In `playing` and `rebound_window` it runs, in order: skater, shot, skater pushed out of the goalie, puck, goalie, rules. During `result_banner` it only counts the banner down. Other phases do nothing.

### Who wins ties

`resolveStepOutcome(state, contacts, flags)` picks the outcome in this order: the earliest decisive contact (goalie means save, goal means goal), then a poke, then a wide crossing or a stopped puck (post and out if a post was hit this attempt), then the rebound window expiring, then the shot clock. Timers tick last, so physics beats Time. A goal on the same step the clock hits 0 is still a goal. A goalie touch at the same instant as the crossing is a save.

### Scoring

`scoring.js`:

- `getGoalPoints(didGoalieBite)` gives 100 points per goal, or 150 if the goalie bit on a deke earlier in the same attempt. The bonus carries into a rebound goal in that attempt.
- `isNewBest(runScore, existing)` is true only if the score is strictly greater than the stored best and greater than 0. A tie keeps the old best.

### Saved settings and best scores

`settings.js` is pure. It never touches `localStorage`.

- `validateSettings(raw)` checks each field on its own: `control_scheme` (hold_charge, aim_mouse, one_button), `is_sound_on` (a real boolean), `motion_preference` (system, reduce, full), `starting_level` (ladder, pro, all_star), plus `schema_version`. A bad field falls back to its default and the good fields stay.
- `getBestScoreSlotKey(scheme, startingLevel)` gives keys like `hold_charge:ladder`. There are 9 slots, so I only compare runs with the same controls and starting level.
- `validateBestScores(raw)` keeps a slot only if its numbers are whole, not negative and not above 10,000,000, and `achieved_at` is a date string. `withBestScore()` returns a new object with one slot replaced.

`storage.js` is the browser side. `createStore()` has `load`, `save`, `recordBestIfBeaten` and `resetAll`. Every `getItem`, `setItem`, `removeItem` and `JSON.parse` is in a try/catch, because private windows, full disks and blocked storage throw. If a write fails, the UI shows a notice and the game keeps running. Reset only removes keys starting with `breakaway.`.

## Privacy

The game saves exactly two `localStorage` keys, on the player's own device:

- `breakaway.settings` for the control scheme, sound, motion preference and starting level.
- `breakaway.best_scores` for the best score per control scheme and starting level.

Nothing is sent anywhere. The game page has no analytics, no cookies, no fonts or scripts from other sites, and no network calls. A site test (`tests/site/no-third-party.test.js`) fails if the shipped files contain an outside URL or `fetch`, `XMLHttpRequest`, `sendBeacon` or WebSocket. The Settings screen has a "Reset saved data" button that clears both keys.

## Tuning numbers

| What | Constant | Value |
|---|---|---|
| Attempts per round | `ATTEMPTS_PER_ROUND` | 5 |
| Goals to advance | `GOALS_TO_ADVANCE` | 3 |
| Shot clock | `SHOT_CLOCK_S` | 8 s |
| Rebound window | `REBOUND_WINDOW_S` | 1.5 s |
| Result banner | `BANNER_S` | 1.2 s |
| Goal light | `GOAL_LIGHT_S` | 1.5 s |
| Points per goal | `POINTS_PER_GOAL` | 100 |
| Deke bonus | `DEKE_BONUS_POINTS` | 50 |
| Keys | `SETTINGS_KEY`, `BEST_SCORES_KEY` | `breakaway.settings`, `breakaway.best_scores` |
| Largest saved count | `MAX_SAVED_COUNT` in `settings.js` | 10,000,000 |

## Tests

`tests/unit/rules.test.js`, `scoring.test.js` and `settings.test.js` cover each function. `tests/integration/game.test.js` plays scripted attempts through `stepGame()` with a seeded random.

## Changelog

- 2026-10-21: Wrote this page from the current code. Added the privacy section.
- 2026-10-21: Saved best scores above 10,000,000 are rejected. A hand-edited value like `1e21` could never be beaten.
- 2026-10-20: A failed round goes straight to the game-over screen, which says which round failed.
- 2026-10-19: Added the phases, outcomes, scoring and validated saved data.
