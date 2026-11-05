# Game loop notes

My notes on real-time game programming. The big new thing in Breakaway is code that runs about 60 times a second, not once per click or request. These notes are my glossary and my comparison to what I already know. Snippets marked "sketch" are generic. The real code is in `src/browser/loop.js` and `src/core/`.

## What I learned

- The game updates physics in fixed steps, even when the screen refreshes at 60, 120 or 144 Hz. An accumulator holds the time I haven't simulated yet.
- Velocity, acceleration, friction and a normalized direction turn key presses into skating that feels the same on every screen.
- Detecting a collision ("are they touching?") is a separate job from the response ("what happens next?"). A fast puck can tunnel through a thin post if I only check once per step.
- The goalie is a state machine. The difficulty levels are the same code with different numbers. A seeded random function makes tests repeatable.
- The pure logic (tested with `node --test`) is kept apart from the browser layer: drawing, input, sound, saved data and screen-reader text.

## The mental model

```
 keyboard / mouse / touch events
          |  events only record "what is held right now"
          v
     input state  <------------------------------------------+
          |                                                   |
          | sampled once at the start of every step           |
          v                                                   |
 requestAnimationFrame --> loop adds elapsed time             |
                           to the accumulator                 |
                                      |                       |
                                      | while time >= 1 step  |
                                      v                       |
              +----- FIXED-STEP UPDATE (pure logic) -----+    |
              | skater -> shot -> puck -> goalie ->      |    |
              | rules (score, attempt and round states)  |    |
              +------------------+-----------------------+    |
                                 | new game state              |
                                 v                            |
               RENDER: canvas drawing (interpolated)          |
               + HTML score strip, overlays, aria-live text   |
                                 | ask for the next frame ------+
                                 v
                         (back to the top)

 localStorage: read once at startup, written when a setting changes
 or a run ends. Never inside the loop.
```

Things to remember:

- Events never change the game. They only note which keys, buttons or touches are active.
- Each step reads that note, so input is applied at a steady rhythm.
- Drawing only reads the state. It never changes it.
- The menus (start, pause, game over) are ordinary HTML buttons and handlers, like Hangman. The loop only reads their result, such as "paused".

## Vocabulary

### Time and the loop

- **Game loop**: code that repeats while the game runs: read input, update the world, draw it.
- **Frame**: one pass that ends with a new picture. 60 fps means 60 pictures a second.
- **requestAnimationFrame (rAF)**: asks the browser to call my function just before the next repaint, with a timestamp in milliseconds. It pauses in hidden tabs. I have to ask again every frame.

```js
function frame(nowMs) {
  // ...update and draw...
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- **Delta time (dt)**: time since the last frame or step. Multiplying by dt keeps speed in feet per second, not feet per frame.

```js
x += speedFtPerS * dtS;  // right: same speed on any screen
x += 0.5;                // wrong: twice as fast at 120 Hz as at 60 Hz
```

- **Fixed timestep**: the update always moves the world by the same amount, no matter how long the frame took. Same inputs give the same results, so physics is stable and tests are repeatable. Mine is `FIXED_STEP_S = 1/120`.
- **Accumulator**: a jar of unspent time. Each frame pours in the elapsed time. Each update drinks one step. The leftover, less than one step, stays for the next frame.
- **Interpolation**: drawing between the previous and current state with `alpha` (0 to 1), so motion looks smooth even though updates are 1/120 s apart.

```js
const drawX = prevX + (currX - prevX) * alpha;
```

Watch out for: a long frame (a hidden tab, a breakpoint). The loop caps the time one frame can add (`MAX_FRAME_DT_S = 0.1`) and the steps per frame (`MAX_STEPS_PER_FRAME = 12`). Without that the loop tries to catch up and freezes the page. This is called the spiral of death.

### Vectors and motion

- **Vector**: a pair `(x, y)` for a position, or a direction and amount of movement. `src/core/vector.js` has `add`, `scale`, `normalize`, `dot` and more.

```js
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
const normalize = (v) => {            // same direction, length 1
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : scale(v, 1 / len);
};
const dot = (a, b) => a.x * b.x + a.y * b.y;
```

- **Dot product**: for two unit vectors it is 1 when they point the same way, 0 when perpendicular, -1 when opposite. It answers "is the puck heading toward the net?" and it powers bounces.
- **Velocity, acceleration, friction**: velocity is position change per second. Acceleration is velocity change per second (what input does). Friction shrinks velocity so the skater glides to a stop.

```js
vel = add(vel, scale(inputDir, accelFtPerS2 * dtS)); // acceleration
vel = scale(vel, Math.max(0, 1 - frictionPerS * dtS)); // friction
pos = add(pos, scale(vel, dtS));                     // velocity
```

Watch out for: holding Right and Up gives `{ x: 1, y: -1 }`, which is about 41% faster than Right alone. I normalize first.

### Collisions

- **Detection**: are these touching? **Response**: what happens because they touched (bounce, stop, save).
- **Restitution**: bounciness, from 0 (dead stop) to 1 (perfect bounce).

```js
// detection: two circles touch when their centers are closer than the radii added up
const isTouching = Math.hypot(puck.x - post.x, puck.y - post.y) <= puck.radiusFt + post.radiusFt;

// response: n points out of the surface, toward the puck
const speedIntoWall = dot(vel, n);   // negative while moving into the surface
if (speedIntoWall < 0) vel = add(vel, scale(n, -(1 + restitution) * speedIntoWall));
```

- **Tunneling and swept tests**: if something moves farther in one step than the thickness of what it should hit, a per-step overlap check never sees them touching. A swept test checks the whole path from the old to the new position. More in [physics-notes.md](./physics-notes.md).

### Behavior

- **State machine**: something is in exactly one named state at a time, with rules for moving between states. The goalie, an attempt and the screens all work this way. More in [goalie-ai-notes.md](./goalie-ai-notes.md).
- **Seeded random generator**: a "random" function that returns the same sequence every time it starts from the same seed. The core takes a random function as a parameter, so tests pass a seeded one. The real one is `createRng()` in `src/core/random.js` (mulberry32).

```js
const a = createRng(42);
const b = createRng(42);
console.log(a() === b(), a() === a());   // true false
```

### Drawing and the browser

- **World-to-screen transform**: the game thinks in feet and the canvas counts pixels. One transform converts, so the drawing code can speak in feet.

```js
ctx.setTransform(pxPerFt, 0, 0, pxPerFt, offsetXPx, offsetYPx); // pixel = feet * pxPerFt + offset
```

- **devicePixelRatio**: physical pixels per CSS pixel, often 2. A canvas sized only in CSS pixels looks blurry, so the backing store is made larger.

```js
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(cssWidthPx * dpr);
canvas.height = Math.round(cssHeightPx * dpr);
canvas.style.width = `${cssWidthPx}px`;
```

- **Offscreen canvas**: a canvas that isn't on the page. The rink never changes, so I draw it once there and copy it each frame (`rink-layer.js`).

```js
const rinkLayer = document.createElement('canvas'); // never added to the page
// ...draw lines and circles into rinkLayer once...
ctx.drawImage(rinkLayer, 0, 0);                     // each frame: one cheap copy
```

- **Web Audio**: builds sound from connected nodes (oscillator, gain, speakers). I synthesize every sound, so there are no audio files. Browsers only start audio after a click or key press.

```js
const audio = new AudioContext();      // create inside the Play click handler
const osc = audio.createOscillator();
osc.connect(audio.destination);
osc.start();
osc.stop(audio.currentTime + 0.1);     // a 0.1 s beep
```

- **aria-live**: a region whose text changes are announced by screen readers. A canvas is invisible to them, so results are also written as text.

```html
<p id="announcer" aria-live="polite"></p>
```

## Comparing to what I know

### Hangman (event-driven) and Breakaway (frame-driven)

| | Hangman | Breakaway |
|---|---|---|
| What runs code | A click on a letter | The browser's frame callback, about 60 times a second |
| Input | The handler uses it immediately | The handler records it. The update reads it each step |
| State changes | Inside the event handler | Only inside the update step |
| Screen changes | The browser repaints after I change the DOM | I redraw the whole canvas every frame |
| Idle | Nothing runs between clicks | The loop runs even if the player does nothing |

Hangman, from `Projects/Hangman/index.html`:

```js
lettersDiv.addEventListener('change', e => {
  wrong++;                                                   // state changes right here
  svg.querySelector(`.step${wrong}`).classList.add('visible'); // browser repaints
});
```

Sketch of the Breakaway way:

```js
const keysHeld = new Set();
window.addEventListener('keydown', (e) => keysHeld.add(e.code));    // only records
window.addEventListener('keyup', (e) => keysHeld.delete(e.code));

function update(dtS) {                                              // the loop reads it
  const dirX = (keysHeld.has('ArrowRight') ? 1 : 0) - (keysHeld.has('ArrowLeft') ? 1 : 0);
  skater.x += dirX * SKATE_SPEED_FT_PER_S * dtS;
}
```

### A PHP request and one frame

| | PHP request | One frame |
|---|---|---|
| Start | A request arrives | The browser calls my frame function |
| Input | `$_POST` or `$_GET`, then validate | Keys, mouse, touch state, then clamp and normalize |
| State lives in | MySQL or a session. PHP forgets everything after the response | Ordinary variables that survive from frame to frame |
| Output | HTML sent to the client | Pixels on the canvas |
| Time budget | Hundreds of ms is fine | About 16.7 ms for everything |
| Persistence | A database | `localStorage`: small, strings only, so I `JSON.parse` and validate it like `$_POST` |

```php
$guess = $_POST['letter'] ?? '';        // request in
$game = applyGuess(loadGame($pdo, $id), $guess);
saveGame($pdo, $id, $game);
echo render($game);                     // respond; PHP then forgets all of it
```

### A C++ vector and a small JS vector module

```cpp
struct Vec2 { float x, y; };
Vec2 operator+(Vec2 a, Vec2 b) { return {a.x + b.x, a.y + b.y}; }
```

```js
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
```

| | C++ | JavaScript |
|---|---|---|
| Add two vectors | `a + b` (operator overloading) | `add(a, b)`. JS has no operator overloading |
| Passing | Struct copied by value | Object passed by reference. Changing it changes the caller's copy |
| Types | `float x, y` enforced by the compiler | A convention, described with a JSDoc `@typedef`. Every number is a 64-bit double |
| Layout | Header and source file | One `export` per function, `import { add } from './vector.js'` |

Watch out for: the mutation point. Some of my functions return new objects and some change one in place. I write "Mutates" in the doc comment of the ones that change their argument.

## My toolchain

I run every command in the WSL Ubuntu terminal, in the `Breakaway` folder, wherever I cloned it. My site includes the game at `Projects/Breakaway` (see `SETUP.md`).

| Tool | What it does here | Commands |
|---|---|---|
| Node 24 and `node --test` | Runs unit tests of the pure logic with no browser | `node -v` (expect `v24.x`). In the `Breakaway` folder, `npm test` |
| `python3 -m http.server` | Serves the files over `http://` | `npm run serve` starts it and prints the address to open, usually `http://localhost:4101/Projects/Breakaway/` |
| Chrome or Edge DevTools | Debug, measure, look at saved data | F12 |
| VS Code with the WSL extension | Editor running inside Linux | `code .` from the repo. The bottom-left corner says **WSL: Ubuntu** |

Why ES modules need a server: the browser loads each `import` as a separate request with cross-origin rules applied. A page opened from disk (`file://`) has no valid origin, so the request is blocked and I get a blank page with a CORS error. I serve the repo root, not the game folder, so `../../style/main.css` resolves like it does on GitHub Pages.

DevTools tabs I use:

- **Sources**: Ctrl+P opens a module, a click on a line number sets a breakpoint, F10 steps over, F8 resumes. A breakpoint freezes the loop, so the next frame sees a huge dt. The cap in the loop is what prevents a jump.
- **Performance**: record a few seconds of play. Each frame should finish in about 16.7 ms. Red marks are long tasks.
- **Application**: Local Storage, then `http://localhost:4101`, lists the `breakaway.*` keys. I edit one to garbage and reload to see if the game recovers.
- **Rendering drawer**: an FPS meter, and "Emulate CSS media feature prefers-reduced-motion".
- After edits, hard refresh with Ctrl+Shift+R.

## Official resources

All official documentation except the last one.

- [Canvas tutorial (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial)
- [Window.requestAnimationFrame() (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [JavaScript modules (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [Window.devicePixelRatio (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) and [OffscreenCanvas (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Window.localStorage (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [ARIA live regions (MDN)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- [prefers-reduced-motion (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Analyze runtime performance (Chrome DevTools)](https://developer.chrome.com/docs/devtools/performance)
- The one classic that is not official: Glenn Fiedler, [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/). It is where the accumulator and interpolation pattern comes from.

## Warm-up I explain in my own words

A generic version of the loop (the real one uses 1/120 s and a 0.1 s cap). `update(dtS)` advances the world and `draw(alpha)` paints it.

```js
const STEP_MS = 1000 / 60;
let accumulatorMs = 0;
let lastMs = null;

function frame(nowMs) {
  if (lastMs !== null) accumulatorMs += Math.min(nowMs - lastMs, 250);
  lastMs = nowMs;
  while (accumulatorMs >= STEP_MS) {
    update(STEP_MS / 1000);
    accumulatorMs -= STEP_MS;
  }
  draw(accumulatorMs / STEP_MS);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

My answers:

- When `draw` is called, `accumulatorMs` holds time that has arrived but isn't simulated yet, between 0 and one step. Dividing by `STEP_MS` gives `alpha`, how far I am between the last update and the next.
- On a 144 Hz screen a frame arrives about every 6.9 ms, so `update` runs 0 or 1 times per frame and about 60 times a second. Game speed matches a 60 Hz screen.
- `Math.min(..., 250)` caps what one frame can add. After 5 hidden seconds without it, `update` would run about 300 times in one frame.

## Check myself

- Friction written as `vel = scale(vel, 0.9)` once per drawn frame, with no dt. On a 144 Hz screen the skater stops sooner, because it runs 144 times a second, not 60. Fix: apply friction in the fixed step, or scale it by dt.
- A puck at 90 ft/s with 60 steps a second moves 1.5 ft per step. A post plus puck is about 0.42 ft thick. A per-step overlap check can miss the hit. Fixes: a swept test, or smaller sub-steps.
- Diagonal input `{ x: 1, y: -1 }` has length 1.414. Normalize it first.
- Same seed, same sequence. That is why a test can say "the goalie bites more at Rookie than at All-Star" and pass or fail for a reason, never by luck.

## Changelog

- 2026-10-21: Rewrote my first primer as these notes. Updated the numbers to the real step (1/120 s) and cap (0.1 s), replaced the generic random function with the real `createRng()`, and fixed the repo path.
- 2026-10-19: First version, written before the first slice.
