# Exercises

Two snippets copied from the real code. For each one I write my own answers first, in my own words, two to four sentences per question. Then I open [solutions.md](./solutions.md) and compare. A mismatch is useful information, not a failed test.

## Exercise: the swept circle test

File: `src/core/collision.js`. `sweepCircleVsCircle()` calls this with the two radii added together. It is how a fast puck is tested against a post.

```js
function sweepPointVsCircle(start, dx, dy, center, radiusFt) {
    const fx = start.x - center.x;
    const fy = start.y - center.y;
    const c = fx * fx + fy * fy - radiusFt * radiusFt;
    const b = fx * dx + fy * dy; // half of the usual b
    if (c <= CONTACT_EPS_FT2) {
        // Already touching or overlapping: contact now unless moving apart.
        return b <= 0 ? 0 : null;
    }
    const a = dx * dx + dy * dy;
    if (a === 0 || b >= 0) return null; // not moving, or moving away
    const disc = b * b - a * c;
    if (disc < -CONTACT_EPS_FT2) return null;
    const t = (-b - Math.sqrt(Math.max(0, disc))) / a;
    return t >= 0 && t <= 1 ? t : null;
}
```

`start` is where the puck's center was at the start of the step. `(dx, dy)` is how far it moves in this step. `center` and `radiusFt` describe the post, with the puck's radius already added in. The result is a fraction `t` from 0 to 1, or `null`.

Questions:

1. What do `c` and `b` measure, and what does it mean when `c` is zero or negative?
2. Why does the code return `null` when `b >= 0`, and why does the first `if` return `0` or `null` instead of going on to the maths?
3. This is a quadratic equation. What is being solved, why is the answer the minus root, and what does `disc` decide?

## Exercise: the goalie's deke read or bite

File: `src/core/goalie.js`. This runs once per step while the goalie is in the `tracking` mode.

```js
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
```

`rng` is the injected random function. `params` are the numbers for the current tier. At Rookie, `dekeReadChance` is 0.25. At All-Star, it is 0.7.

Questions:

1. What does `rng() >= params.dekeReadChance` mean in plain words? How often does a Rookie goalie bite, and an All-Star goalie?
2. Which way does the goalie slide, and why does `signOr` need a fallback?
3. Why does the bite branch end with `return` while the read branch falls through? What does the same seed guarantee about this code?
