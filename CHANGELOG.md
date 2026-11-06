# Changelog

All notable changes to Breakaway are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Blender script `tools/blender/make_sprites.py`: builds a top-down skater, goalie and puck from simple
  shapes and renders them as sprite sheets (8 skating frames, 5 goalie poses, the puck) with a
  `sprites.json` that describes them. Run it with
  `blender -b --factory-startup -P tools/blender/make_sprites.py -- --out assets/sprites`.
  It also runs from Blender's Text Editor (Scripting tab, Run Script). Written for Blender 5.2 LTS. After each
  render it clears the faint shadow left around each cell, so no gray square shows around a player, and the
  puck renders black instead of gray.
- Sprite drawing for V2: the game can draw the skater, goalie and puck from those sprite sheets
  (`src/browser/sprites.js` loads them, `src/core/sprites.js` checks `sprites.json` and picks the frame and
  pose), with the V1 shapes as the fallback when the sheets are missing or broken. `?sprites=off` keeps the
  shapes. 11 new tests (`tests/unit/sprites.test.js`).
- Sprites switched on: the sheets I rendered in Blender 5.2 LTS are in `assets/sprites/`, and `index.html`
  sets `data-sprite-manifest="assets/sprites/sprites.json"`. `?sprites=off` still shows the shapes.
- A test for switching sprites on (`tests/unit/sprite-assets.test.js`, 6 tests): when `index.html` sets
  `data-sprite-manifest`, the manifest must exist and pass `validateSpriteManifest()`, and every PNG must exist
  and be at least `columns` x `cell_size_px` wide and `rows` x `cell_size_px` tall.
- The first Playwright browser test, `tests/e2e/smoke.spec.js` (`npm run test:smoke`, not part of `npm test`):
  the page loads, Play starts an attempt and a shot resolves, with no console errors.
- Docs: `docs/sprites.md` for the sprite feature, my study notes on the Blender script
  (`docs/learning/blender-sprites-notes.md`), and feature branches in `docs/releases.md`.

## [1.0.0] - 2026-11-04

V1, vector: the first version I release as a download. The skater, goalie and puck are drawn with
Canvas 2D shapes. Download `breakaway-v1-vector.zip` from the
[v1.0.0 release](https://github.com/ChristianRodriguez46/Breakaway/releases/tag/v1.0.0).

### Fixed
- On its own (without my site around it) the game page hides the site's nav instead of showing it
  as plain links to pages that aren't there, and keeps the site's fonts and spacing.
- Space and the arrow keys keep working after clicking Pause or Mute.
- Skater, goalie and puck are drawn larger on phones so they're easy to see.
- Impossibly large saved best scores are rejected.

### Changed
- Docs and messages name the `Breakaway` and `ChristianRodriguez46.github.io` folders instead of a
  fixed `~/REPO` location, so they make sense wherever the repos are cloned (README, SETUP, About
  page, learning notes, `scripts/serve.sh` comments, the site checks' message).
- Every command block in the docs starts with `cd Breakaway` (or `cd ChristianRodriguez46.github.io/Projects/Breakaway`
  for the portfolio's copy), from the folder that holds the clone.
- README covers only this repo; the portfolio comes up once, in a short Publishing section.
- README reorganized: features first, then how to play, running it, how the site updates, and the
  tests last, with the commands and their expected output. Each feature doc in `docs/` now ends
  with "How it's tested".
- Breakaway has its own repository. My site includes it at `Projects/Breakaway/` as a git
  submodule, so the game's address on the site stays the same, and the site only changes when I
  move the submodule to a new commit.
- `npm test` runs the game's unit, integration and stats tests. The site checks
  (`npm run test:site`) read my site's pages, so they run from the copy inside my site and in the
  site repo's workflow.
- `npm run serve` (`scripts/serve.sh`) works from either copy. Inside my site it serves the site
  root. In the game's repo with my site cloned next to it, it serves a temporary preview with the
  site around this copy of the game, so work in progress shows with the real nav and fonts. On its
  own it serves the game folder. It listens on localhost only.
- The browser test config serves the right folder for either copy.
- The README, setup guide and About page link to this repository and explain both ways to run it.
- Goalie levels recalibrated so the corners stay open: in scripted tests Rookie gives up about
  39% of shots, Pro about 20% and All-Star about 8%.

### Added
- Versioned downloads. Pushing a version tag (`v1.0.0`) runs the `release` workflow, which tests the
  game, builds a zip with only what playing needs (`breakaway-v1-vector.zip`) plus its SHA-256
  checksum, and publishes both as a GitHub Release with the notes from this file.
  `npm run package -- <tag>` builds the same files locally; `PLAY.md` inside the zip says how to
  run it with Live Server. Each major version is prepared on its own release branch (`release/v1`),
  and `main` only moves through it. Details: [docs/releases.md](docs/releases.md).
- Release tests: `npm run test:release` (8 tests), part of `npm test`.
- Test scripts per feature: `npm run test:physics` (77 tests), `test:goalie` (86), `test:rules` (48)
  and `test:browser` (17).
- `notify-portfolio` workflow: after the tests pass on a push to `main`, it tells my site's repo,
  whose `update-submodules` workflow moves the Breakaway submodule to the new `main`, runs the site
  checks and republishes the site. Pushes to `dev` never reach the site.
- `.gitignore` for `node_modules/`, test output and editor files. The site repo's `.gitignore`
  used to cover these.
- GitHub Actions workflow in this repo (`.github/workflows/tests.yml`) that runs `npm test` on
  every push and pull request.
- Decision: why Breakaway has its own repo and joins my site as a submodule.
- Documentation and an about page: feature docs for physics, goalie AI, rules and scoring, and the
  browser layer in `docs/`, learning notes and exercises in `docs/learning/`, screenshots, a
  README, and an About page (`about.html`) linked from the Projects page.
- Game rules (`src/core/rules.js`, `game.js`): 5 attempts per round, 3 goals to advance, an
  8-second shot clock, one rebound chance per attempt, the run ends as soon as 3 goals are out of
  reach; every attempt ends as Goal, Save, Wide, No shot, Post and out, Poke check or Time.
- Goalie AI (`src/core/goalie.js`, `difficulty.js`): squares up to the puck, reacts after a delay,
  dives, poke checks, bites on or reads dekes, and gives up rebounds. Rookie, Pro and All-Star
  levels; All-Star keeps improving after round 5, up to 20%.
- Scoring and saved data (`src/core/scoring.js`, `settings.js`): 100 points a goal, +50 after a
  successful deke; a best score per control scheme and starting level; saved settings are checked
  field by field and fall back to defaults if anything is wrong.
- Browser game (`src/browser/`, `index.html`, `style.css`): fixed-step loop, rink drawn in real NHL
  measurements, keyboard and touch controls for all three schemes, synthesized sound with mute,
  start, how-to-play, settings, pause, round summary and game-over screens, and screen-reader
  announcements.
- All text the game shows lives in `src/core/ui-strings.js`.
- Physics (`src/core/collision.js`, `rink.js`, `skater.js`, `puck.js`): skating with acceleration,
  glide and turning; dekes; shots for all three control schemes; puck friction; bounces off the
  boards, corners and posts; swept collision tests so a fast puck can't pass through a post or the
  goalie between steps; a goal counts only when the whole puck crosses the line between the posts.
- Project setup: page shell with the site's navigation bar, design tokens, `package.json` scripts
  for tests (`node --test`), type checking (`tsc` over JSDoc types), linting and browser tests.
- `src/core/constants.js`: every tunable number in one place, with the rink in real NHL feet and
  the Rookie, Pro and All-Star goalie tiers.
- `src/core/types.js`: shared JSDoc types for the game state, input and saved data.
- `src/core/vector.js`: 2D vector math (add, scale, normalize, rotate, dot product, distance).
- `src/core/random.js`: seeded random number generator (mulberry32) and `?seed=` URL support, so
  the same seed always plays the same game.
- GitHub Actions workflow that runs the Node tests on every push that touches the game (in the
  site repo, before the move).
- Decisions: one document, `docs/decisions.md`, covers the stack, the fixed-timestep loop, the pure
  core and browser shell, and world units in feet.
- Setup guide for Windows with WSL2 and VS Code, and learning notes on the game loop.

[Unreleased]: https://github.com/ChristianRodriguez46/Breakaway/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ChristianRodriguez46/Breakaway/releases/tag/v1.0.0