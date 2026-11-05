# Releases

How a finished version of Breakaway becomes a download that anyone can play without cloning the repo.

## What it does

Every version I release gets three things:

- a **git tag** such as `v1.0.0`, which marks the exact commit forever;
- a **GitHub Release** for that tag, with notes copied from [CHANGELOG.md](../CHANGELOG.md);
- a **download** named for what it is, such as `breakaway-v1-vector.zip`, plus its SHA-256 checksum.

The download holds only what playing needs. Someone unzips it, opens the folder in VS Code and runs it with Live Server (the steps are in [PLAY.md](../PLAY.md), which is inside every zip, and in the README's "Versions" section).

## How it works

### Version numbers

I follow [Semantic Versioning](https://semver.org/): `major.minor.patch`. The major number is the edition of the game:

| Version | Edition | `package.json` | Download |
|---|---|---|---|
| V1 | vector (Canvas 2D shapes) | `"version": "1.x.y"`, `"edition": "vector"` | `breakaway-v1-vector.zip` |
| V2 | sprites (Blender renders) | `"version": "2.x.y"`, `"edition": "sprites"` | `breakaway-v2-sprites.zip` |
| V3 | 3D | `"version": "3.x.y"`, `"edition"` chosen then | `breakaway-v3-<edition>.zip` |

A new feature inside an edition raises the minor number (`v1.1.0`); a fix raises the patch number (`v1.0.1`). The download's name only carries the major number, so every V1 release is `breakaway-v1-vector.zip`, and the release title says the exact version.

The tag is always `v` plus the version in `package.json` at that commit. The script refuses to build when they differ, so a typo in either place stops the release instead of publishing the wrong thing.

### What goes in a download

`PLAY_PATHS` in `scripts/package-release.mjs`: `index.html`, `style.css`, `src/`, `assets/` (from V2 on, when it exists), `LICENSE` and `PLAY.md`. The zip unzips into one folder with the download's name.

Left out on purpose: tests, docs, scripts, workflows, `package.json` and `about.html`. A player doesn't need them, and the About page's links only work inside my site. Anyone who wants the full source clones the repo or uses the "Source code" zip GitHub adds to every release.

### Building it: `scripts/package-release.mjs`

`npm run package -- v1.0.0` runs `packageRelease()`:

1. `parseVersionTag()` checks the tag is `v<major>.<minor>.<patch>` (plain numbers, no leading zeros, no suffix) and that the tag exists.
2. `getDownloadName()` reads `package.json` **at the tag** (`git show v1.0.0:package.json`), checks its version matches, and builds `breakaway-v<major>-<edition>`.
3. `extractChangelogSection()` reads `CHANGELOG.md` at the tag and keeps the body of the `## [1.0.0]` section, stopping at the next version or the link list at the end.
4. `selectPlayPaths()` keeps the play paths that exist at the tag, and fails if a required one is missing.
5. `git archive` writes the zip straight from the tag, with every file under `breakaway-v1-vector/`. Because it reads the tag and not my working folder, uncommitted changes never get in. Files are stamped with the commit's time, so building the same tag twice gives the same bytes.
6. `sha256Line()` writes `dist/breakaway-v1-vector.zip.sha256` in the format `sha256sum -c` checks, and the notes go to `dist/release-notes.md`.
7. `isNewestVersion()` decides whether this release becomes GitHub's "Latest": only when its version is the highest tag. A V1 fix released after V2 exists stays a normal release, and V2 stays "Latest".

Git runs through `execFileSync` without a shell, so nothing in a tag name can turn into a command. On GitHub the script also writes its results to `$GITHUB_OUTPUT` for the next workflow step.

### Publishing it: `.github/workflows/release.yml`

It runs when a tag matching `v*.*.*` is pushed:

1. Checks out the repo with every tag (`fetch-depth: 0`), so the script can compare versions.
2. Runs `npm test` with Node 24. A failing test stops the release.
3. Runs `node scripts/package-release.mjs <tag>`.
4. Runs `gh release create` with the zip and checksum, the title, the notes file, `--verify-tag` (the tag must already be on GitHub) and `--latest` from step 7 above.

The workflow asks only for `contents: write`, the one permission creating a release needs. Values go to the shell as environment variables instead of being pasted into the command with `${{ }}`, so a tag or a title can't change what the command does. A tag push also runs `tests.yml` (it runs on every push), but it never runs `notify-portfolio`, which only reacts to `main`. Releasing never changes my site.

## Branches, tags and what gets updated

| Name | Kind | What it holds | Pushing it |
|---|---|---|---|
| `dev` | Branch | Day-to-day work on the current version | Runs the tests |
| `release/v1`, `release/v2`, `release/v3` | Branch, one per major version | That version's releases: the version number, changelog and README table for each one | Runs the tests |
| `main` | Branch | The version my site shows | Runs the tests, then updates my site |
| `v1.0.0`, `v1.1.0`, `v2.0.0`, … | Annotated tag on a `release/vN` commit | One exact release, forever | Runs the `release` workflow, which publishes the download |

Work flows one way: `dev` → `release/vN` → `main`, and then `main` back into `dev`. `main` only moves through a release branch, so my site always runs a released version.

**Old versions are frozen by default.** Day-to-day work goes into the newest version. When V(N+1) ships, `release/vN` stays as it is: its branch, tags and downloads are kept so I can always show and play that version. Now and then I may still fix a bug or make a small change in an old version (see "Changing an older version" below). Once V2 work starts on `dev`, `dev` is never merged into `release/v1` again, because that would bring V2 into V1.

## Releasing a version

Before any release, on the release branch:

1. `package.json`: set `"version"` (for example `1.0.0`) and `"edition"` (for example `vector`).
2. `CHANGELOG.md`: move everything under `## [Unreleased]` into a new `## [1.0.0] - <the day I tag it>` section, leave an empty `## [Unreleased]` above it, and update the links at the bottom.
3. README "Versions" table: link the new download (`https://github.com/ChristianRodriguez46/Breakaway/releases/download/v1.0.0/breakaway-v1-vector.zip`), the tag and the branch.

### The first release of a major version

The release branch starts where the finished version is: `main` for V1 (it was already live), `dev` for V2 and V3.

```bash
cd Breakaway
git switch main && git pull
git switch -c release/v1
```

`git switch -c` creates the branch and moves onto it. For V2 it's `git switch dev && git pull && git switch -c release/v2`. Then I make the three changes above, test, commit and publish the branch:

```bash
cd Breakaway
npm test
git add -A && git commit -m "Revised the version and changelog for 1.0.0"
git push -u origin release/v1
```

`-u` links my local branch to the one on GitHub, so later `git push` and `git pull` on it need no names. Then I tag, check the download, and send everything on:

```bash
cd Breakaway
git tag -a v1.0.0 -m "Breakaway V1, vector"
npm run package -- v1.0.0
git switch main && git merge release/v1 && git push
git push origin v1.0.0
git switch dev && git pull && git merge main && git push
```

- `git tag -a` makes an annotated tag: it records who tagged it, when, and a message. It's the usual kind for releases.
- `npm run package` builds the download into `dist/` from the tag, so I can unzip it and play it before anything is public.
- Merging into `main` and pushing updates my site. When `main` hasn't moved since the release branch started, git just moves it forward ("Fast-forward").
- Pushing the tag starts the `release` workflow. In the **Actions** tab it shows as `release`; when it's green, the **Releases** page has the new release with its zip and checksum.
- Merging `main` into `dev` gives `dev` the release changes, so the next work starts from them.

### An update to the current version

While V1 is current, an update to the game is a new minor or patch version on the same branch:

```bash
cd Breakaway
git switch release/v1 && git pull
git merge dev
```

Then the three changes above with the new number (`1.1.0`), and the same commit, push, tag, package, merge-into-`main`, push-tag and merge-into-`dev` steps. A docs-only change goes through the same branches without a new tag.

A pushed tag never moves. If a release is wrong, I fix it in a new patch version (`v1.0.1`) instead of re-tagging.

### Changing an older version

For the occasional bug fix or small change in a version that's no longer the newest, for example V1 while I'm working on V3. The change happens on that version's own branch, in a second folder, so my current work isn't touched. It never goes into `main` or `dev`, because those are the newest version and `main` is what my site shows.

```bash
cd Breakaway
git fetch
git worktree add ../Breakaway-v1 release/v1
```

`git fetch` gets the latest branches and tags from GitHub without changing my folder. `git worktree add` checks out `release/v1` into a second folder next to my clone, `Breakaway-v1`. Both folders share one repository, so a commit made in either one is in the same history, but each folder has its own branch checked out. My V3 work in `Breakaway`, even uncommitted changes, stays exactly as it is.

In the `Breakaway-v1` folder:

1. Fix or change it, and test. Live Server on this folder plays V1.
2. `package.json` to the next number (`1.0.1` for a fix, `1.1.0` for a small feature), and a matching section in this branch's `CHANGELOG.md`.
3. Commit, tag, check and publish:

```bash
cd Breakaway-v1
npm test
git add -A && git commit -m "Fixed <what> in V1"
git tag -a v1.0.1 -m "Breakaway V1, vector: <what>"
npm run package -- v1.0.1
git push && git push origin v1.0.1
```

Then remove the second folder; the branch and its commits stay:

```bash
cd Breakaway
git worktree remove ../Breakaway-v1
```

What happens to each part:

- `release/v1` gets the fix and the `v1.0.1` tag. The release workflow publishes a new `breakaway-v1-vector.zip` for it.
- `main`, `dev` and my site don't change. `isNewestVersion()` sees that V3 is higher, so V3 stays the "Latest" release.
- The tag is built with the release workflow and script as they were on `release/v1`. If GitHub ever changes something and that old workflow stops working, I cherry-pick the newer workflow fix onto `release/v1` first.

Two follow-ups on `dev`, which reach `main` with my next update:

- The README's Versions table links V1's newest download (`.../releases/download/v1.0.1/breakaway-v1-vector.zip`).
- If the newer versions have the same bug, `git cherry-pick <commit>` copies the fix onto `dev` (and onto `release/v2` if I want V2 fixed too). It copies that one commit's edits; when a newer version's file has changed around those lines, git stops with a conflict and I finish the merge by hand.

### Playing an old version from my clone

```bash
cd Breakaway
git switch --detach v1.0.0
npm run serve
```

`--detach` puts the folder at exactly that tag without being on a branch, so nothing I do there can change a branch by accident. `git switch dev` brings me back.

## Settings

| Setting | Where | Value |
|---|---|---|
| Tag format | `TAG_PATTERN` | `v<major>.<minor>.<patch>`, plain numbers |
| Play files | `PLAY_PATHS` | `index.html`, `style.css`, `src`, `assets`, `LICENSE`, `PLAY.md` |
| Required play files | `REQUIRED_PLAY_PATHS` | the same without `assets` |
| Edition name | `package.json` `"edition"` | lowercase letters, digits and dashes |
| Download name | `getDownloadName()` | `breakaway-v<major>-<edition>` |
| Release title | `getReleaseTitle()` | `Breakaway v1.0.0 (V1, vector)` |
| Tags that publish | `release.yml` `on.push.tags` | `v*.*.*` |

## How it's tested

| Check | Tests | What it checks |
|---|---|---|
| `tests/release/package-release.test.js` | 8 | Tag rules (rejects `1.0.0`, `v1.0`, `v1.0.0-beta`, leading zeros, shell characters); the download name and the version match with `package.json`; the release title; the changelog section, stopping at the next version and at the link list; "Latest" compares numbers (`v1.10.0` is newer than `v1.9.0`) and a fix to an older version isn't the newest; required play files; the checksum line; and a real run that builds a zip from a throwaway git repo and checks it holds only the play files, with the tagged contents and not a later edit |
| By hand, 2026-11-04 | | On a copy of the repo: tagged `v1.0.0`, ran `npm run package -- v1.0.0`, `sha256sum -c` printed `OK`, the zip held 32 files and only the play paths, and building it twice gave the same bytes. Then I unzipped it, served the folder alone, and played it in Chromium: no JavaScript errors, the site nav hidden, and the only failed requests were my site's `main.css`, `main.js` and `logo.svg` |

Not covered: the workflow itself only runs on GitHub, so its first real run is the first tag I push. If it fails, the Actions log says which step, and nothing is published until it passes.

Run the release tests:

```bash
cd Breakaway
npm run test:release
```

Expected output: a ✔ line for each test, then

```
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms …
```

## Changelog

- 2026-11-04: Added versioned releases: tags, the `release` workflow, `scripts/package-release.mjs`, `PLAY.md` and the release tests.
- 2026-11-04: Releases are prepared on one branch per major version (`release/v1`), and `main` only moves through a release branch. Old versions are frozen by default; an occasional fix goes on that version's branch as a new patch release. Added how to play an old version from a clone, and changing an old version in a second folder with `git worktree`.
