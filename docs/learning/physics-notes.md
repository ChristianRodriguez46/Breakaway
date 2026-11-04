# Physics notes

What I learned writing the skater, puck and collisions for Breakaway. Code is in `src/core/`. Facts and tuning numbers are in [../physics.md](../physics.md). This file is what I had to figure out.

## What I learned

- A game "step" should do the same thing no matter the frame rate. So I use a fixed step of 1/120 s. Speeds are in feet per second and I multiply by dt.
- A diagonal key press must not be faster. I clamp the input vector to length 1.
- Friction and glide are just velocity changes. No special case needed. When speed gets tiny I snap it to exactly 0 so the skater doesn't drift forever.
- Checking only where the puck ends up is not enough. At 105 ft/s the puck moves almost 0.9 ft per step. A post is 0.25 ft in radius. It can jump right over it.
- Detection and response are separate. The sweep tells me when. The bounce says what happens.

## Sweeping a circle

The puck moves from `start` to `end` in one step. I want the first fraction `t` where it touches something.

- The point on the path is `start + t * d`, where `d = end - start`.
- Touching means its distance to the post's center is at most `puckRadius + postRadius`. So I add the radii and treat the puck as a point.
- Squaring the distance gives a quadratic in `t`. The smaller root is where it enters.

```js
const t = (-b - Math.sqrt(Math.max(0, disc))) / a;
return t >= 0 && t <= 1 ? t : null;
```

Watch out for:

- Already overlapping at the start. If it is moving in, `t = 0`. If it is moving away, `null`. Without the second rule a puck that just bounced bounces again.
- Rounding. A puck that touches exactly can be missed. `CONTACT_EPS_FT2` absorbs that.
- The caller must sweep `previousPosition` to `position`. Sweeping `position` to `position` finds nothing.

## The goalie is a capsule

A goalie's pads aren't a circle. I use a capsule: a line segment plus a radius. A capsule is a rectangle with a half circle on each end. So I can test it as three simple things and take the earliest hit: the two end circles and the flat side.

- The segment turns to face the puck (`padsDirection`), so the puck has to beat the ends.
- This is the same idea as the post test. I reused `sweepPointVsCircle` for the ends.

## Bounces

```js
const into = velocity.x * nx + velocity.y * ny;   // dot with the normal
if (into >= 0) return { ...velocity };            // already moving away
const k = (1 + restitution) * into;
return { x: velocity.x - k * nx, y: velocity.y - k * ny };
```

- Only the part going into the wall is flipped and shrunk. The sliding part stays.
- Restitution 0.6 for boards, 0.5 for posts. 0 for skaters, so they slide along the boards.
- After a bounce the rest of the step continues, up to `MAX_BOUNCES_PER_STEP`. Anything left is dropped. That is how I stop a puck from getting stuck in a corner forever in one step.

## A goal is the whole puck over the line

The easy rule is "center crosses the line", but a puck half over the line isn't in. The rule I use is the center past `GOAL_LINE_Y_FT` minus the puck radius, with the center strictly between the inner post edges. After that the puck is `in_net` and never reports contacts, so one shot can't score twice.

## Units in feet

Everything is in feet. The goal line is 11 ft, the blue line 75 ft. Constants read like a rulebook. One transform in the renderer maps feet to pixels. The only cheat is size: the puck is 0.5 ft in radius instead of 0.125 ft so it reads on a phone. I wrote that in `constants.js` so I don't "fix" it later.

## Compared to what I know

- In C++ I'd write a `Vec2` struct and overload `+`. In JS I write `add(a, b)`. Objects are passed by reference, so I write "Mutates" in the doc comment when a function changes its argument.
- Hangman only reacted to clicks. Here I have dt everywhere.
- A PHP request has no state between requests. The puck and skater are plain objects that live between steps.

## Questions I still have

- Would a 1/60 step be enough if I only swept? Probably, but goalie timing gets coarser. I chose 1/120.
- Is a capsule good enough for the goalie diving? It looks right. I haven't tested a real player's feel on a touch device.

## Changelog

- 2026-10-21: Wrote these notes after finishing the physics code and the tier calibration.
