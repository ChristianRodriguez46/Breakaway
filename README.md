# Breakaway

Breakaway is a top-down hockey shootout against an AI goalie. I skate in from center ice, deke, shoot, and try to score. Each round is 5 attempts and I need 3 goals to reach the next round, against a goalie that gets sharper. I built it in plain JavaScript modules and Canvas 2D for my portfolio site, and it plays in the browser with no install.

**[Play Breakaway](https://christianrodriguez46.github.io/Projects/Breakaway/)**

| Start screen (phone) | Playing (phone) |
|---|---|
| ![Breakaway start screen on a phone](docs/screenshots/start-phone.png) | ![Breakaway during play on a phone, with the touch stick, Deke and Shoot buttons](docs/screenshots/playing-phone.png) |

| Start screen (laptop) | Playing (laptop) |
|---|---|
| ![Breakaway start screen on a laptop](docs/screenshots/start-laptop.png) | ![Breakaway during play on a laptop, with the controls panel](docs/screenshots/playing-laptop.png) |

## How to play

I pick one of three control schemes in Settings. The default is Hold to charge.

| Action | Hold to charge | Aim with mouse | One button |
|---|---|---|---|
| Skate | Arrows or WASD | Arrows or WASD | Arrows or WASD |
| Shoot | Hold Space, release to shoot where I'm facing. Longer is faster but less accurate | Click to shoot toward the pointer | Tap Space |
| Deke | Shift | Shift or right mouse button | none |
| Touch | Drag the stick, hold and release Shoot, tap Deke | Drag the stick, tap the rink to shoot, tap Deke | Drag the stick, tap Shoot |

P or Escape pauses. M turns sound on or off. I have 8 seconds per attempt. A goal is 100 points, and 50 more if the goalie bit on a deke first. Aim with mouse needs a mouse or a touch screen.

## How I built it

I used plain JavaScript ES modules and the Canvas 2D API. There are no runtime dependencies and no build step. The game has its own repository, and my site includes it at `Projects/Breakaway/` as a git submodule, so GitHub Pages publishes it with the rest of the site. Node is only used for tests and development tools.

The code is split in two. `src/core/` holds every rule (physics, collisions, goalie AI, scoring, round rules, saved-data checks) as plain functions with no browser code, and random numbers come in as a seeded function. `src/browser/` is a thin shell that runs a fixed-step loop (120 steps a second inside `requestAnimationFrame`), reads input, draws the canvas, plays synthesized sound, saves settings and announces results to screen readers. That split lets me test the rules in Node with the same seed every time, and a `?seed=` URL parameter does the same thing in the browser.

More detail:

- [Decisions](docs/decisions.md): the stack, the loop, the core and shell split, and the units, with the options I weighed.
- [Physics](docs/physics.md): skater, puck, rink and swept collisions.
- [Goalie AI](docs/goalie-ai.md): the goalie's modes and the difficulty tier table.
- [Rules and scoring](docs/rules-and-scoring.md): rounds, outcomes, scoring, saved data and privacy.
- [Browser layer](docs/browser.md): loop, renderer, input, touch, audio, storage, UI and accessibility.
- [Learning notes](docs/learning/game-loop-notes.md), [physics notes](docs/learning/physics-notes.md), [goalie AI notes](docs/learning/goalie-ai-notes.md) and [exercises](docs/learning/exercises.md).
- [Changelog](CHANGELOG.md) and [iteration log](ITERATION_LOG.md).

## Run it locally

I use WSL2 Ubuntu. The game needs a web server because browsers won't load ES modules from `file://`.

From the game's own repo:

```bash
mkdir -p ~/REPO && cd ~/REPO
git clone https://github.com/ChristianRodriguez46/Breakaway.git
cd Breakaway
npm run serve
```

`npm run serve` prints the address to open. When my site is cloned next to the game (`~/REPO/ChristianRodriguez46.github.io`), it shows this copy of the game inside my site, with the real nav and fonts, at http://localhost:4101/Projects/Breakaway/. That's how I check work in progress before it reaches the site; nothing in the site repo changes. Without the site next to it, it serves the game folder at http://localhost:4101/: the game looks and plays the same, without my site's nav bar: its links go to site pages that aren't there, so the page hides it when the site's stylesheet doesn't load.

Inside my site, the way GitHub Pages serves it:

```bash
cd ~/REPO
git clone --recurse-submodules https://github.com/ChristianRodriguez46/ChristianRodriguez46.github.io.git
cd ChristianRodriguez46.github.io/Projects/Breakaway
npm run serve
```

Then I open http://localhost:4101/Projects/Breakaway/. `npm run serve` sees that it's inside my site and serves the site root, so the shared styles load. [SETUP.md](SETUP.md) has the full setup.

## Run the tests

```bash
npm install         # once, for the dev tools (lint, type checks, browser tests)
npm test            # the game: unit, integration and stats tests
npm run test:site   # checks on my site's pages; only from the copy inside my site
```

## Updating my site

My site updates itself when I push `main`. I work on the `dev` branch and merge into `main` when an update is finished. Then:

1. The `tests` workflow runs the game tests.
2. If they pass, `notify-portfolio` tells my site's repo that Breakaway's `main` changed.
3. My site's `update-submodules` workflow moves `Projects/Breakaway` to the new `main`, runs the site checks, commits as me, pushes, and asks GitHub Pages to rebuild.

Pushes to `dev` never reach the site. If any step fails, the site keeps the version it had, and GitHub emails me about the failed run.

To update by hand instead, I press **Run workflow** on `update-submodules` in my site's Actions tab, or run:

```bash
cd ~/REPO/ChristianRodriguez46.github.io
git pull
git submodule update --remote Projects/Breakaway   # take the latest Breakaway main
cd Projects/Breakaway && npm run test:site && cd ../..
git add Projects/Breakaway
git commit -m "Update Breakaway"
git push
```

## Project layout

```
Breakaway/
  index.html        the game page
  style.css         the game's styles
  about.html        the About page on my site
  src/core/         pure rules: physics, goalie, scoring, settings, constants
  src/browser/      loop, renderer, input, touch, audio, storage, UI
  tests/            unit, integration, stats and site checks
  docs/             decisions, feature docs, learning notes, screenshots
  scripts/          the local web server (npm run serve)
  SETUP.md  CHANGELOG.md  ITERATION_LOG.md
```

## Privacy

The game saves two `localStorage` keys, `breakaway.settings` and `breakaway.best_scores`, on the player's own device. Nothing is sent anywhere. The page has no analytics, no cookies and no requests to other sites. Settings has a button that clears both keys.

## License

My code is under the MIT license. See the repository's LICENSE file.
