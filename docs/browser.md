# Browser layer

Everything that touches the browser lives in `src/browser/`. It is a thin shell around the pure core: it feeds in input, advances the game, and draws and announces the result. The core never touches the page (see [decisions.md](./decisions.md)).

## What it does

It runs the loop, draws the rink and players on a canvas, turns keyboard, mouse and touch into one input per step, plays synthesized sound, saves settings and best scores, shows the menus, and announces results to screen readers.

## How it works

### Wiring (`main.js`)

`main.js` is the only file that holds the game state. It reads `?seed=` with `parseSeedParam()`, builds the store, renderer, input, touch controls, audio, loop and UI, and passes them to each other. It also moves the state between screens, turns game events into sound, banners and announcements, and handles shortcuts: P or Escape pauses, M mutes. The game auto-pauses when the tab is hidden or the window loses focus.

### Loop (`loop.js`)

`createLoop({ step, render, requestFrame, cancelFrame, nowMs, isLive })` returns `start`, `stop` and `isRunning`. Each animation frame adds the elapsed time to an accumulator, capped at `MAX_FRAME_DT_S` (0.1 s). It runs one `step()` for every `FIXED_STEP_S` (1/120 s) in the accumulator, at most `MAX_STEPS_PER_FRAME` (12) times, then calls `render(alpha)` once, where `alpha` is how far I am into the next step. It stops asking for frames when `isLive()` is false (paused, hidden, menus). Everything it uses is passed in, so I can test it with a fake clock.

### Renderer (`renderer.js`, `rink-layer.js`)

- The static rink (ice, lines, crease, net, boards) is drawn once to an offscreen canvas by `createRinkLayer()` and copied each frame. The goal lamp is not part of it, because it flashes.
- `createRenderer()` returns `draw(state, alpha)`, `worldFromClient()` and a resize handler. One transform converts feet to pixels. The backing store is sized by `devicePixelRatio`, capped at `DPR_MAX` (3), so lines stay sharp.
- Positions are blended between the previous and current step with `alpha`, so motion is smooth at any refresh rate.
- On small screens, players and the puck are drawn up to 2 times larger. This is drawing only; physics sizes don't change.
- Skate scratches are kept in a fixed `Float32Array` ring of `SCRATCH_MAX` (120) entries, so nothing is allocated per frame.
- Colors come from the `--bk-*` custom properties in `style.css`, read once.
- **Sprites (V2).** `renderer.setSprites()` switches the skater, goalie and puck from shapes to sprite sheets rendered in Blender, and `main.js` loads them only when the game root has a `data-sprite-manifest` attribute. If the files are missing or fail a check, the shapes stay. How it works, the settings and how to make the sheets are in [sprites.md](./sprites.md).

### Input and touch (`input.js`, `touch-controls.js`)

Events only record what is held. `createInput()` keeps the held keys, and queues short "edges" (shoot pressed, shoot released, deke) so a tap shorter than a frame still lands. `readIntent()` hands out one input per step, and each edge goes to exactly one step. Game keys are ignored when focus is on a button, input or link, so menus stay usable. A key held across attempts needs a fresh press, so a new attempt can't fire a shot by itself.

Touch has a virtual stick (with a dead zone of 0.12), a Shoot button and a Deke button. Pointer capture keeps a press tied to its button when my thumb slides off, so a hold-to-charge release still lands. A cancelled touch drops the charge without a shot. The touch target minimum is 44 px.

Controls by scheme:

| Action | Hold to charge | Aim with mouse | One button |
|---|---|---|---|
| Skate | Arrows or WASD | Arrows or WASD | Arrows or WASD |
| Shoot | Hold Space, release to shoot | Click toward the pointer | Tap Space |
| Deke | Shift | Shift or right mouse button | none |
| Touch | Stick, hold and release Shoot, Deke | Stick, tap the rink to shoot, Deke | Stick, Shoot |

### Audio (`audio.js`)

Every sound is synthesized with the Web Audio API: an oscillator through a gain envelope. There are no sound files. Browsers only allow audio after a gesture, so `unlock()` creates the `AudioContext` inside the Play click. Master gain is 0.35, and stickhandle ticks are limited to `STICKHANDLE_SOUNDS_PER_S_MAX` (6) per second. Muting loses no information, because every sound has a visual equivalent.

### Storage (`storage.js`)

A try/catch wrapper around `localStorage` with `load`, `save`, `recordBestIfBeaten` and `resetAll`. The rules for what is saved are in [rules-and-scoring.md](./rules-and-scoring.md). Validation is in the core, in `settings.js`.

### UI (`ui.js`)

The menus are ordinary HTML: start, how to play, settings, pause, round summary and game over, plus the score strip with attempt markers, the shot clock and the result banner. `ui.js` never changes game state. All text comes from `core/ui-strings.js`, and every node is filled with `textContent`, never `innerHTML`.

### Accessibility

- A canvas is invisible to screen readers, so results are also written to an `aria-live` region ("Goal. Score 100."). The shot clock only changes its label at the 5, 3 and 1 second marks, so it doesn't repeat every tenth.
- Dialogs move focus in and return it to where I was. If the opener is hidden, focus goes to the game root.
- Settings has a motion preference (system, reduce, full). With reduce, the goal-light flash is replaced by a static change. `<html>` carries `data-motion`.
- The aim-with-mouse scheme needs a pointer, and How to play says so for keyboard-only players.
- I checked the screens in a browser during review. Touch feel, audio and screen readers can only be checked on a real device, and I haven't done that yet.

## Tuning numbers

| What | Constant | Value |
|---|---|---|
| Fixed step | `FIXED_STEP_S` | 1/120 s |
| Longest frame counted | `MAX_FRAME_DT_S` | 0.1 s |
| Steps per frame | `MAX_STEPS_PER_FRAME` | 12 |
| Device pixel ratio cap | `DPR_MAX` | 3 |
| Skate scratches kept | `SCRATCH_MAX` | 120 |
| Stick sounds per second | `STICKHANDLE_SOUNDS_PER_S_MAX` | 6 |
| Touch stick dead zone | `STICK_DEAD_ZONE` in `touch-controls.js` | 0.12 |

## How it's tested

The browser layer is the part with the least automated testing, and that's on purpose: it's kept thin so the rules it drives can be tested in Node. What is checked:

| Check | Tests | What it checks |
|---|---|---|
| `tests/unit/ui-strings.test.js` | 13 | Every banner, announcement and menu text, the shot clock and score formats, the help for each control scheme, and that every sound has a visual equivalent |
| `tests/unit/sprites.test.js` | 11 | `sprites.json` checks, choosing the skating frame, goalie pose, mirroring and size, and `?sprites=off` (details in [sprites.md](./sprites.md)) |
| `tests/unit/scaffold.test.js` | 4 | The core modules never touch the page, clocks or `Math.random` (this keeps the core and shell split honest), plus the shared constants |
| `tests/unit/sprite-assets.test.js` | 6 | The sprite files match `index.html` (details in [sprites.md](./sprites.md)) |
| `tests/e2e/smoke.spec.js`, `npm run test:smoke` | 1, run in 3 projects | In a real browser at 1280 px, 375 px with touch, and 320 px: the page loads on the start screen, Play starts an attempt, one shot resolves (the attempt marker leaves "current"), and there are no console errors, page errors or failed requests, except the site files that 404 when the game runs on its own |
| Site checks, `npm run test:site` | 36 | Run from the copy inside my portfolio. The game page loads nothing from other sites and makes no network calls, imports use the exact letter case GitHub Pages needs, and the nav links resolve |
| By hand | | Every screen checked in a browser at phone and laptop sizes with screenshots. On 2026-11-04 I compared the page inside my site (nav shown) and on its own (nav hidden); inside the site it was pixel-for-pixel the same before and after the change |

Not covered: the loop, renderer, input, touch and audio have no unit tests, and the one Playwright test only plays a single shot. Touch feel, audio and screen readers still need a real device.

Run the browser-side tests:

```bash
cd Breakaway
npm run test:browser
```

Expected output: a ✔ line for each test, then

```
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms …
```

Run the browser smoke test (needs `npm install`, and `npx playwright install chromium` once):

```bash
cd Breakaway
npm run test:smoke
```

Expected output ends with `3 passed`.

## Changelog

- 2026-11-05: Added the first Playwright test, `tests/e2e/smoke.spec.js` (`npm run test:smoke`), and `tests/unit/sprite-assets.test.js`; `test:browser` now runs 34 tests. Playwright always starts its own server on port 4120 (`reuseExistingServer: false`), so a leftover server can't make it test another folder.
- 2026-11-05: Moved the sprite description and its settings to [sprites.md](./sprites.md); this page keeps a short pointer and the sprite test row.
- 2026-11-05: Added sprite drawing for V2 (`setSprites()`, `src/browser/sprites.js`, `src/core/sprites.js`) with the shapes as the fallback, its settings, and its tests.
- 2026-11-04: On its own, the game page hides the site's nav (`index.html` marks the page `no-site` when the site's stylesheet doesn't load). Added "How it's tested", with what is and isn't covered.
- 2026-10-21: Wrote this page from the current code.
- 2026-10-21: Space and the arrow keys keep working after clicking Pause or Mute. Players and puck are drawn larger on phones.
- 2026-10-20: Padded the page under the site's fixed navigation bar, and restored dialog centering that the site stylesheet reset.
- 2026-10-19: Added the loop, renderer, input, touch controls, audio, storage and UI.
