# Iteration log

Problems I found while building and testing Breakaway, how I found each one, and how I fixed it. Newest first.

| Date | Problem | How I found it | Cause | Fix | Test |
|---|---|---|---|---|---|
| 2026-10-21 | After I clicked Pause or Mute, Space toggled that button and the arrows stopped skating | Review in the browser | The clicked button kept keyboard focus, and the input code ignored keys coming from buttons | Buttons in the score strip and touch controls no longer block game keys. Space key-up is kept from clicking them | Browser check: Space with Mute focused no longer toggles it |
| 2026-10-21 | Skater, goalie and puck were 3 to 15 px on a phone, hard to see | Review of a screenshot | Players are drawn at their physics size, which is small at 3.8 px per foot | I draw players and the puck up to 2 times larger when the screen is small (drawing only). The puck is drawn on top of the skater | Screenshot at 375 px |
| 2026-10-21 | A hand-edited best score like `1e21` was accepted and could never be beaten | Code review | Saved counts had no upper limit | I reject saved counts above 10,000,000 | `settings.test.js`: impossibly large best score is dropped |
| 2026-10-20 | The goalie stopped almost every shot, even at Rookie | Stats tests | Pads plus body covered more than the 6 ft goal mouth | I recalibrated the Rookie, Pro and All-Star numbers. Rookie concedes about 39%, All-Star about 8% | `tests/stats/shot-outcomes.test.js` |
| 2026-10-20 | The score strip was hidden under the site navigation bar | Browser check | The dark nav is `position: fixed` | I pad the game page by the nav height, as Hangman does | Screenshots at 375 and 1280 |
| 2026-10-20 | Dialogs opened in the top-left corner | Browser check | The site stylesheet resets every margin, including the dialog's centering | I restore centering for game dialogs | Screenshot |

## Known and accepted

- A failed round goes straight to the game-over screen, which says which round failed, instead of showing a separate round summary first.
- Mute comes before Play in the Tab order on the start screen. Tab rests on the page once when I cycle through Settings and the pause dialog. It is minor, so I left it for a later polish pass.
- I did not write browser end-to-end test files for the Playwright test runner. I ran the browser checks as scripts during review instead.
- Real touch feel, audio and screen readers can only be checked on a real device.

## Changelog

- 2026-10-21: Rewrote this log in first person.
- 2026-10-20: Added the first fixes after the browser review.
