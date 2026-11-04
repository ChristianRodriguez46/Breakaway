# Solutions

Model answers for [exercises.md](./exercises.md). I read these only after I have written my own answers.

## Swept circle test

1. `c` is the squared distance from the start to the post's center, minus the squared sum of the radii. If `c` is zero or negative, the puck and the post already touch or overlap at the start of the step. `b` is the dot product of the offset (start minus center) and the motion. It is negative when the puck is moving toward the post, positive when it is moving away. It is half of the usual quadratic `b`, which is why the later formulas have no 2s and no 4s.
2. When `b >= 0` and the puck starts outside, it is moving away or sliding past, so it can never touch the post later in this step. The first `if` handles a puck that already overlaps: if it is moving in (or not at all, `b <= 0`) the contact is now, `t = 0`. If it is moving apart it returns `null`, so a puck that just bounced off the post isn't bounced again on the next step. That is the "touching counts, moving away doesn't" rule from the file header.
3. The point on the path is `start + t * d`. I want the `t` where its distance to the center equals the radius. Squaring gives `a*t*t + 2*b*t + c = 0` with `a = d.d`. The roots are `(-b +- sqrt(b*b - a*c)) / a`. The smaller root is where the puck first enters the post's circle, so it uses the minus sign. The larger root is where it would leave. `disc` is `b*b - a*c`. If it is negative, the path never gets as close as the radius, so there is no contact. The tiny negative allowance and `Math.max(0, disc)` stop a graze from being missed because of rounding. Last, `t` has to be between 0 and 1, because the move only lasts this one step.

## Goalie deke

1. The goalie reads the deke when the random number is below `dekeReadChance`, and bites when it is at or above it. So a Rookie bites about 75% of the time (1 - 0.25) and an All-Star about 30% (1 - 0.7). "Lower read chance means more bites" is the part that is easy to flip by mistake.
2. It slides opposite my deke. The code takes the direction I dekeed, perpendicular to my facing and flipped by `dekeSide`, negates its x, and stores the sign in `diveSide`. `signOr` never returns 0. If the x part is exactly 0 (for example when I am facing straight sideways), the fallback picks a side from `dekeSide` so the goalie still commits somewhere. With a 0 the slide would have no direction.
3. A bite changes the goalie's mode to `bitten`, so it should do nothing else this step: no poke roll and no shuffle toward the square-up point. That is why it returns. A read pushes a `goalie_read` event and then carries on, so the goalie can still poke check or move. The roll is one draw from `rng` for each deke, and nothing draws every step, so the same seed gives the same bite or read every time. That is why `deke-bite.test.js` can count bites over many seeded dekes and compare tiers.
