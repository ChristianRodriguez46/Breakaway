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

## Publishing a release

1. `--prefix=breakaway-v1-vector/` puts every file inside one folder, so unzipping makes a single `breakaway-v1-vector` folder instead of scattering files. `tag` (for example `v1.0.0`) is where the files come from: the tagged commit. `--` ends the options, so the paths after it can never be read as options. Building from the tag means the zip holds exactly what was committed, tested and tagged. Zipping my folder could include an edit I hadn't committed, and two builds could differ. From the tag, the same tag always gives the same zip.
2. `${{ }}` is replaced with text before the shell runs the line. If a title contained a quote or `$(...)`, it would become part of the command. With `env:`, the shell gets the value as a variable, and `"$TITLE"` in double quotes is always one plain argument. It's GitHub's recommended way to handle values in workflows.
3. `--verify-tag` stops the release if the tag isn't on GitHub, instead of `gh` quietly creating a new tag on the current branch. `--latest="$IS_LATEST"` stops a fix to an old version (v1.0.1 after v2.0.0) from becoming the "Latest" release; `isNewestVersion()` decides it by comparing version numbers.
