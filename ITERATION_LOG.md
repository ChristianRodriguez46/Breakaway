# Iteration log

Problems I found while building and testing Breakaway, how I found each one, and how I fixed it. Newest first.

| Date | Problem | How I found it | Cause | Fix | Test |
|---|---|---|---|---|---|
| 2026-11-05 | A faint gray square around every player, and a gray puck, with the first real sprite render | Looking at the real sheets in the game at 375 and 1280 px | The shadow catcher records a very faint shadow far from each character, and the cell edge cuts it off in a straight line. The puck's flat top reflected the overhead sun straight into the overhead camera | `clean_alpha()` makes shadow fainter than `FAINT_SHADOW_ALPHA` transparent and fades each cell border to 0; the puck's Specular IOR Level is 0.1 | The same cleanup applied to the real sheets in a scratch copy: the square is gone at 375 px; a fake-image check of `clean_alpha()` matches it exactly. The second real render confirmed it: every cell border is fully transparent and the puck averages 37/255 instead of 79 |
| 2026-11-05 | Run from Blender's Text Editor, the sprite script would try to write into Blender's install folder and fail with a permission error | Planning how to run the script inside Blender | In the Text Editor, `__file__` is the `.blend` path plus the text's name, not the script's file, so the output folder came from Blender's working folder | `script_file()` reads the path from the Text Editor; without `--out` the sheets go to `assets/sprites` from `tools/blender`, otherwise to `breakaway-sprites` next to the script | A small fake-`bpy` check of the four cases (terminal from the repo, terminal from elsewhere, Text Editor, unsaved text); the real check is a run in Blender 5.2 |
| 2026-11-04 | The release test said the zip didn't hold the tagged `index.html`, though it did | The new release test failed on its first run | `git archive` compresses each file, so searching the zip's raw bytes for text can't find it | The test now reads the zip's directory and unpacks that one file with Node's `zlib` before checking it | `tests/release/package-release.test.js`: the zip holds the tagged contents, not a later edit |
| 2026-10-21 | After I clicked Pause or Mute, Space toggled that button and the arrows stopped skating | Review in the browser | The clicked button kept keyboard focus, and the input code ignored keys coming from buttons | Buttons in the score strip and touch controls no longer block game keys. Space key-up is kept from clicking them | Browser check: Space with Mute focused no longer toggles it |
| 2026-10-21 | Skater, goalie and puck were 3 to 15 px on a phone, hard to see | Review of a screenshot | Players are drawn at their physics size, which is small at 3.8 px per foot | I draw players and the puck up to 2 times larger when the screen is small (drawing only). The puck is drawn on top of the skater | Screenshot at 375 px |
| 2026-10-21 | A hand-edited best score like `1e21` was accepted and could never be beaten | Code review | Saved counts had no upper limit | I reject saved counts above 10,000,000 | `settings.test.js`: impossibly large best score is dropped |
| 2026-10-20 | The goalie stopped almost every shot, even at Rookie | Stats tests | Pads plus body covered more than the 6 ft goal mouth | I recalibrated the Rookie, Pro and All-Star numbers. Rookie concedes about 39%, All-Star about 8% | `tests/stats/shot-outcomes.test.js` |
| 2026-10-20 | The score strip was hidden under the site navigation bar | Browser check | The dark nav is `position: fixed` | I pad the game page by the nav height, as Hangman does | Screenshots at 375 and 1280 |
| 2026-10-20 | Dialogs opened in the top-left corner | Browser check | The site stylesheet resets every margin, including the dialog's centering | I restore centering for game dialogs | Screenshot |

## Known and accepted

- A failed round goes straight to the game-over screen, which says which round failed, instead of showing a separate round summary first.
- Mute comes before Play in the Tab order on the start screen. Tab rests on the page once when I cycle through Settings and the pause dialog. It is minor, so I left it for a later polish pass.
- The Playwright smoke test (`tests/e2e/smoke.spec.js`) is the only end-to-end test so far. The other browser checks ran as scripts during review.
- The sprite-assets test reads only each PNG's header, so a cut-off PNG passes it. The game then shows the shapes, because the image fails to load.
- With stand-in sheets, the goalie's dive sprite starts about a third as wide as the stance and grows as the dive reaches out. I'll tune it with the real Blender renders.
- Real touch feel, audio and screen readers can only be checked on a real device.

## Changelog

- 2026-11-05: Added the gray square and gray puck from the first real sprite render.
- 2026-11-05: Added the sprite script's Text Editor fix, and the known limits of the sprite-assets test and the dive sprite width. Updated the Playwright line now that the smoke test exists.
- 2026-10-21: Rewrote this log in first person.
- 2026-10-20: Added the first fixes after the browser review.