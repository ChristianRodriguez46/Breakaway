# Decisions

These are the four decisions that shaped Breakaway. I wrote each one down before building on it, so I could explain later why the code looks the way it does. This file replaces the separate decision records I kept at first.

## Index

- [Stack: plain JavaScript and Canvas on GitHub Pages](#stack-plain-javascript-and-canvas-on-github-pages)
- [Game loop: fixed timestep](#game-loop-fixed-timestep)
- [Structure: pure core and a thin browser shell](#structure-pure-core-and-a-thin-browser-shell)
- [Units: the rink in feet](#units-the-rink-in-feet)
- [Repository: its own repo, joined to my site as a submodule](#repository-its-own-repo-joined-to-my-site-as-a-submodule)
- [Changelog](#changelog)

I rate each option on complexity (how much I have to build and learn), cost (money), and fit with what I already know. "Fit with what I know" means my own background: HTML, CSS and JavaScript from my site and Hangman, PHP/MySQL, and C++ from coursework.

## Stack: plain JavaScript and Canvas on GitHub Pages

Decided 2026-10-19.

### Context

Breakaway is a 2D arcade hockey game. You skate in on an AI goalie and try to score, in rounds that get harder. It is a portfolio piece, so it has to play from a link on my GitHub Pages site.

- GitHub Pages serves static files only. There is no server code, no database, and I can't set custom HTTP headers.
- I chose not to use Docker or AWS. A static game doesn't need either.
- The rest of my site has no build step. Publishing is edit, commit, push, and I want to keep it that way.
- I work in WSL2 Ubuntu with VS Code on a Windows laptop.
- My learning goal for this project is real-time game programming: a game loop, vector math, collision detection and simple AI. I want that to be the one big new thing, not three.

### Options considered

| Option | Complexity | Cost | Fit with what I know | Pros | Cons |
|---|---|---|---|---|---|
| Plain JS modules + Canvas 2D | Low | Free | Strong: same stack as my site and Hangman | No build step; matches the site; every line is mine; small download; logic can be tested in Node | I write the loop, physics and drawing by hand; no engine or editor tooling |
| TypeScript + Vite | Medium | Free | Close | Types catch bugs early | Adds a build step the rest of the site doesn't have; I'd commit built files or move the whole site to a GitHub Actions deploy; a second new thing next to game programming |
| C++ with raylib, compiled to WebAssembly | High | Free | Medium: I know C++, not Emscripten | Reuses my C++ coursework; teaches WebAssembly | New toolchain on top of new game concepts; browser text, input and accessibility are harder from WASM; harder to unit test the same way |
| Godot 4 with web export | Medium | Free | Weak: new engine, language and editor | Full engine with physics and an editor; can also export to desktop | Everything new at once; Pages can't send the headers multithreaded web builds need, so I'd use the single-threaded export; several MB of engine download; the engine does the physics, so less of the core is mine |

### What I chose and why

Plain JavaScript ES modules drawn on a `<canvas>` with the Canvas 2D API. No runtime dependencies and no build step. It is served from `Projects/Breakaway/` on my site and published like the rest of it. Since 2026-11-04 the code lives in its own repo (see [Repository](#repository-its-own-repo-joined-to-my-site-as-a-submodule)).

I picked it because it keeps the new part small and focused. I already know the language and the deploy flow, so my effort goes into the game loop, vectors, collisions and AI.

Supporting choices:

- Game logic stays separate from the browser (see the structure decision below).
- Tests use Node's built-in runner (`node --test`). Node is a development tool only; players never download anything from npm.
- Development-only tools (linter, type checking of JSDoc comments, Playwright) are `devDependencies`. `node_modules/` is never committed.
- Saved data uses `localStorage` on the player's device. Nothing is sent anywhere.
- No third-party requests from the game page: no web fonts, no CDN scripts, no analytics, no embeds.

### Consequences

- Easier: publishing (push and it's live), explaining every file in an interview, unit testing the rules, keeping the download small, matching the site's look.
- Harder: I wrote everything an engine would give for free: the loop, collision math, drawing and audio. That is the point of the project, but it took time.
- Ruled out on Pages: a global leaderboard, accounts, cloud saves and online multiplayer. All need a server and database. Adding them later would be a large change (back end, accounts, privacy work, anti-cheat), so they are out of scope. Two players on one keyboard needs no server and stays possible.
- Docker and AWS: not needed now or later for this game.

### When I'd revisit

- The game needs online features. That would be a separate project with its own back end.
- The code outgrows plain modules. TypeScript is the natural next step, and the core would port file by file.
- I want a desktop build. Then I'd look at Godot or a wrapper like Tauri.

## Game loop: fixed timestep

Decided 2026-10-19.

### Context

Screens refresh at 60, 90, 120 or 144 Hz, and a hidden tab or a slow phone can skip frames. If I moved things by "however much time passed since the last frame", the physics would differ by device. Friction, bounces and the goalie's reaction time would all change with the frame rate. A long frame could also push a 105 ft/s puck straight through a post. My tests also need the same inputs and seed to give the same result every time.

### Options considered

| Option | Complexity | Cost | Fit with what I know | Pros | Cons |
|---|---|---|---|---|---|
| Variable step (dt is the frame time) | Low | Free | Strong: most tutorials do this | Simplest loop | Results depend on frame rate; tunneling on long frames; can't reproduce a run in a test |
| Fixed step of 1/120 s with an accumulator | Medium | Free | New, and it is the learning goal | Same physics on every device; reproducible; short sweeps for collisions | A bit more code; needs interpolation when drawing |
| Fixed step of 1/60 s | Medium | Free | New | Half the steps per second | A 105 ft/s puck moves 1.75 ft per step, so sweeps are longer and goalie timing is coarser |
| `setInterval` timer | Low | Free | Medium | Independent of drawing | Drifts, keeps running in hidden tabs, fights the display refresh |

### What I chose and why

`requestAnimationFrame` for timing and drawing, and a fixed step of `FIXED_STEP_S = 1/120` with an accumulator. Each frame adds the elapsed time (clamped to `MAX_FRAME_DT_S = 0.1`), runs whole steps (at most `MAX_STEPS_PER_FRAME = 12`), then draws once, interpolating between the last two steps. The loop stops while the game is paused, hidden or on a menu.

I chose 1/120 over 1/60 because the fastest shot is 105 ft/s. At 120 steps per second that is under 0.9 ft per step, which keeps the swept tests short and the goalie's 100 to 155 ms reaction delays from being rounded to coarse steps.

### Consequences

- Easier: identical results on every device; deterministic Node tests that advance by whole steps; explaining the loop.
- Harder: positions keep a previous value for interpolation, and the loop is more than a one-liner.

### When I'd revisit

- Profiling shows the step cost matters on low-end phones. Then I'd try 1/90.
- A feature needs precision inside a single step.

## Structure: pure core and a thin browser shell

Decided 2026-10-19.

### Context

Breakaway has a lot of logic worth testing: puck physics, goal and post detection, goalie behavior by tier, round rules, scoring, and validation of saved data. Hangman keeps its logic in the page's inline script, which is fine for a small game but can't be tested without a browser. The goalie also makes random choices, and random choices make tests flaky unless I control them.

### Options considered

| Option | Complexity | Cost | Fit with what I know | Pros | Cons |
|---|---|---|---|---|---|
| Logic in the page script, like Hangman | Low | Free | Strong | Fewest files | Can't be tested without a browser; random and time make tests flaky |
| Pure core modules + thin browser shell, with random, clock and storage passed in | Medium | Free | Medium: I already use ES modules | Core runs in Node with `node --test`; a seeded random makes tests repeatable; browser code stays small | More files; dependencies passed in by hand |
| Classes that touch the DOM | Medium | Free | Medium: it is the OOP style from my C++ classes | Familiar shape | Classes still reach for globals; harder to test and to snapshot state |

### What I chose and why

`src/core/` holds every rule as functions over plain objects. It never touches `window`, `document`, canvas, storage, timers, `Math.random`, `Date.now` or `performance.now`. Randomness comes from an injected `random()` (a seeded mulberry32 generator). Time comes from the fixed step. Storage is an injected object. `src/browser/` owns the loop, input, drawing, audio, storage and HTML, and calls the core.

A lint rule and a test helper that makes those globals throw keep the core honest. A `?seed=` URL parameter seeds the game so browser tests are repeatable.

I chose this because the same split lets me test the goalie with a thousand scripted shots in under a second, and that is how I tuned the difficulty tiers.

### Consequences

- Easier: fast, deterministic unit and integration tests; replaying a scripted attempt; reasoning about one step at a time; tuning numbers in one constants file.
- Harder: wiring dependencies by hand in `main.js`, and keeping state as plain data with no hidden fields.

### When I'd revisit

- I move to TypeScript. The core would port file by file.
- I add a back end. The same core could run on a server to check scores.

## Units: the rink in feet

Decided 2026-10-19.

### Context

The game needs one coordinate system for physics, the goalie and drawing. Working in screen pixels would tie the rules to the canvas size, so a phone and a laptop would play differently. The look I want is a broadcast rink with real markings, and a hockey fan notices a wrong crease or blue line.

### Options considered

| Option | Complexity | Cost | Fit with what I know | Pros | Cons |
|---|---|---|---|---|---|
| Screen pixels | Low | Free | Strong | No conversion | Rules change with screen size; resizing breaks state |
| Normalized 0 to 1 units | Low | Free | Medium | Independent of screen size | The numbers mean nothing to read; speeds and distances are hard to tune |
| Feet and seconds with real NHL measurements | Low | Free | Strong: familiar units | Independent of screen size; constants read like a rulebook (goal line 11 ft, blue line 75 ft); speeds in ft/s are easy to reason about | One world-to-screen transform in the renderer |

### What I chose and why

Every core value is in feet and seconds, with the unit in the name (`GOAL_LINE_Y_FT`, `SHOT_SPEED_MAX_FT_PER_S`). The origin is the top-left of the rink's bounding box. `y` runs from the end boards (0) toward center ice (100). The renderer applies one scale and offset.

Markings use real NHL measurements. The puck, posts and players use larger collision and drawing sizes so the game is playable: the puck radius is 0.5 ft instead of 0.125 ft. I wrote that exception down in `constants.js` so I don't "fix" one into the other later.

### Consequences

- Easier: the same game on every screen; tests written in rink terms; tuning by real-world feel.
- Harder: the playability sizes are a deliberate deviation that I have to keep documenting.

### When I'd revisit

- I add a full-rink or side view. The units still hold; only the visible box changes.

## Repository: its own repo, joined to my site as a submodule

Decided 2026-11-04.

### Context

Breakaway started as a folder in my portfolio repo, `Projects/Breakaway/`. I'm reworking the game now, and I want to change it freely without breaking the live site. The site should only get the new version once an update is finished.

- The game page borrows the site's nav bar through relative links (`../../style/main.css`, `../../js/main.js`), so it has to keep the same place on the site.
- GitHub Pages publishes one branch of the site repo and has no build step.
- My other projects will get their own repos too, and the portfolio links to them.

### Options considered

| Option | Complexity | Cost | Fit with what I know | Pros | Cons |
|---|---|---|---|---|---|
| Keep the folder in the portfolio repo | Low | Free | Strong: what I did before | Nothing to learn; one repo | Every push of half-done game work goes live; game and site history are mixed |
| Own repo with its own GitHub Pages (`/Breakaway/`) | Low | Free | Strong | No nesting at all | Every push to the game goes live; the `../../` nav links break, so I'd rewrite them to site-root links that only work online |
| Own repo, joined as a git submodule at `Projects/Breakaway` | Medium | Free | Close: plain git, one new concept | The site stays on a fixed commit until I move it; same address and same relative links; Pages supports public submodules | Cloning the site needs `--recurse-submodules`; updating the site is an extra commit; the nav is unstyled when the game runs on its own |
| Own repo, copied in with `git subtree` | Medium | Free | Close | Normal files in the site repo, so clones need no flags | Long commands; easy to commit a fix to the wrong repo; the files exist twice |
| One repo with a branch per project | Medium | Free | Weak: not what branches are for | None that the others don't have | Pages publishes one branch, so a project branch never goes live; every branch still carries the whole site |

### What I chose and why

Its own repo, joined to my site as a git submodule at `Projects/Breakaway`. The site repo stores a pointer to one commit of Breakaway's `main`, so nothing I push to the game reaches the site until I move that pointer. The game keeps its address and its relative links to the site's styles.

Inside the game repo, `dev` is work in progress and `main` is finished work. Moving the pointer means taking the latest `main`, so only finished work can reach the site.

### Consequences

- Easier: reworking the game without risk to the live site; a game history that is only about the game; rolling the site back by moving the pointer.
- Harder: two repos to keep in step; cloning the site needs `--recurse-submodules`; the site checks in `tests/site/` need the site around the game, so they run from the submodule copy and in the site repo's workflow, while `npm test` covers the game alone.
- The game page still depends on the site's `style/main.css` and `js/main.js` for the nav. On its own, the page notices that `main.css` didn't load and hides the nav, since its links lead to site pages that aren't there.

### When I'd revisit

- The game stops using the site's nav. Then it could have its own GitHub Pages and drop the submodule.
- I get my own server or a build step for the site. Then the site could pull in released versions of each project instead.

## Changelog

- 2026-11-04: On its own, the game page hides the site's nav instead of showing it unstyled.
- 2026-11-04: Added the repository decision (its own repo, joined to my site as a submodule) and updated where the stack decision says the game lives.
- 2026-10-21: Merged the four separate decision records into this one file. Switched the options tables to the columns Option, Complexity, Cost, Fit with what I know, Pros and Cons. Rewrote everything in first person.
- 2026-10-19: Wrote the original decisions for the stack, the fixed-timestep loop, the pure core and the units.
