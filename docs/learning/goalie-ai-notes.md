# Goalie AI notes

What I learned building the goalie. Code is in `src/core/goalie.js` and `difficulty.js`. The mode table and tier numbers are in [../goalie-ai.md](../goalie-ai.md).

## What I learned

- A state machine is the simplest way I found to make AI behave. One mode at a time, and rules for leaving it. The goalie has `set`, `tracking`, `reacting`, `diving`, `poking`, `bitten` and `recovering`.
- Difficulty is data, not code. Rookie, Pro and All-Star run the same function with different numbers.
- A goalie that never makes a mistake isn't fun. So the mistakes are built in: a reaction delay, a sideways angle error, a limited speed and a recovery time after a dive.
- Random choices need to be controlled or tests are flaky. The goalie gets an `rng` function passed in.
- Tune with numbers from a test, not by feel. I ran scripted shots and counted goals.

## Reading the shot

When I shoot, the goalie doesn't move right away. It waits `reactionDelayMs`. Then it predicts where the puck will cross its line.

```js
const timeS = (goalie.position.y - puck.position.y) / vy;
return { x: puck.position.x + puck.velocity.x * timeS, timeS };
```

- This is just distance divided by speed, then a straight line.
- If the goalie can walk there in time, it walks. If the gap is more than its normal reach but less than its dive reach, it dives.
- A dive is a bigger capsule on one side. It can't change its mind. It has to recover, so a dive is a gamble.

## Squaring up

The goalie stands on the line from the puck to the center of the net, a bit out from the goal line (its depth). It moves out as I come closer. That is called cutting the angle. The goalie "sees" the puck a little sideways from where it really is. That is the angle error, and it is why the corners stay open.

## The deke: bite or read

- I deke. The goalie rolls once.
- If the roll is under `dekeReadChance`, it reads the deke and stays square.
- Otherwise it bites: it slides the wrong way, freezes for 0.45 s, and I get a clear shot.
- Bites also give 50 bonus points if I score in that attempt.

Easy to get backwards: a lower `dekeReadChance` means more bites. Rookie reads 25%, so it bites 75% of the time.

## Poke checks

If I carry the puck too close, the goalie may lunge. The roll needs both the puck and my skater within `pokeRangeFt`. At most one roll every 0.5 s. The "skater too" part means a skater standing off at range isn't stripped.

## Calibrating the tiers

My first numbers made the goalie stop almost every shot, even at Rookie, because pads plus body covered more than the 6 ft goal mouth. The stats tests showed it. I changed the numbers until scripted shots gave:

| Tier | Goals conceded in the scripted test |
|---|---|
| Rookie | about 39% |
| Pro | about 20% |
| All-Star | about 8% |

All-Star also improves each round after it first appears, up to 20%. It multiplies speeds and chances and divides delays. Depth stays the same.

Watch out for: the stats tests check that the tiers stay in order (Rookie is easiest). They don't check exact numbers. If I change a number and a test fails, behavior changed. The number wasn't copied wrong.

## Randomness

Every random draw goes through `rng`, and only on events: a new goalie, the puck crossing center, a deke, a poke roll. Nothing draws once per step. So the same seed plays the same game, and `?seed=1` in the URL gives me the same attempt in the browser.

## Compared to what I know

- In C++ class I'd have used an `enum` and a `switch`. This is the same thing. JS strings are the enum, and `switch (goalie.mode)` is the switch.
- Hangman's "AI" was just picking a word. Here the AI is a timer plus a few dice rolls.
- A seeded `rng` is like testing a PHP function with fixed inputs, not live user input.

## Changelog

- 2026-10-21: Wrote these notes after the tier calibration.
