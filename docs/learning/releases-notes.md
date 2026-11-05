# Release notes (how I ship versions)

My notes on turning a finished version into a download, the way most open-source projects do it. The real files are `scripts/package-release.mjs`, `.github/workflows/release.yml` and `PLAY.md`. The step-by-step checklist is in [docs/releases.md](../releases.md); these notes are the why.

## What I learned

- A **branch** moves every time I commit; a **tag** is a name stuck to one commit forever. Versions are tags, work in progress is branches.
- An **annotated tag** (`git tag -a v1.0.0 -m "..."`) is a real object with my name, the date and a message. A lightweight tag (`git tag v1.0.0`) is only a pointer. Releases use annotated tags.
- **Semantic Versioning**: `major.minor.patch`. Patch = fixes, minor = new features that don't break anything, major = a big change. For Breakaway, major = edition (V1 vector, V2 sprites, V3 3D).
- A **GitHub Release** is a page attached to a tag, with notes and uploaded files ("assets"). GitHub also adds a "Source code" zip of the whole repo, which I can't rename or remove.
- **Build from the tag, not from my folder.** `git archive <tag>` writes exactly what was committed and tagged. Zipping my working folder could sneak in half-finished edits.
- **Reproducible build**: the same tag gives a zip with the same bytes every time, because `git archive` stamps files with the commit's time, not the time I run it.
- A **checksum** (SHA-256) is a fingerprint of the file. Publishing it next to the zip lets anyone prove their download is the file that was built: `sha256sum -c file.zip.sha256` prints `OK`.
- **CI on tags**: a workflow can run on `push: tags:`. Mine tests, builds and publishes, so releasing is one `git push origin v1.0.0`.
- **Least privilege**: the workflow's `GITHUB_TOKEN` gets only `contents: write`, the one permission creating a release needs.
- **Injection guard**: in a workflow, `${{ }}` pastes text into the shell command before it runs. Passing values through `env:` and using `"$NAME"` keeps them as plain data.
- `$GITHUB_OUTPUT` is how one step hands values (the zip path, the title) to the next step.
- **Releasing and deploying are different steps.** Releasing = "this version exists" (tag + download). Deploying = "this version is live" (merge into `main`, and my site updates).
- **A release branch** holds a version's release preparation, kept apart from day-to-day work on `dev`. Preparing a release isn't developing, so it gets its own branch.
- **Maintenance policy**: every project with versions decides which old versions still get changes. Mine: frozen by default, with an occasional fix on the old version's own branch.
- `git worktree add ../Breakaway-v1 release/v1` checks out another branch in a second folder that shares the same repository. It's how I change V1 while V3 is in progress without touching my V3 folder, not even uncommitted work.
- `git cherry-pick <commit>` copies one commit's edits onto another branch. It's how a fix travels between versions, and it gets harder the more the versions' files have drifted apart.

## Branches and the release flow

```
dev:         ── work ── work ─────────────── merge main ── V2 work ──→
                         \                  ↗
release/v1:               (release prep) ── v1.0.0 ── … later only an occasional v1.0.1
                                          \
main:        ─────────────────────────────── merge ──→ (my site shows it)
```

- Work happens on `dev`. When it's ready to publish, it goes into the version's release branch (`release/v1`), where I set the version, the changelog and the README table, then tag it.
- `main` only moves by merging a release branch, so my site always runs a released version.
- After a release, `main` goes back into `dev`, so the next work starts from the release.
- A new major version gets a new branch (`release/v2`, cut from `dev`). The old branch stays for showing and playing that version, and for a rare fix.

The models I compared: GitHub Flow (only `main` and short feature branches; no version step), trunk-based with tags (everything on `main`, releases are tags on it; common with strong CI), and Git Flow (`develop`, `release/*`, `hotfix/*`, `main`). Mine is a small Git Flow. For a side project where I don't need the extra step, tags on `main` alone would be enough.

## Maintenance: why frozen by default

These are portfolio projects. I want every version playable to show how a project grew, but nobody depends on old versions. Updating all of them (say, a new color scheme everywhere) means a cherry-pick per branch, and each one can conflict, because each version's files have changed in their own way. So old versions stay as they were, unless I choose to fix one now and then. That change stays on its own branch and never goes into `main`.

Bigger projects choose differently. Some only support the newest version, like me. Some keep long-term support (LTS) versions that get fixes for a set period (Node.js does). Some backport only security fixes.

## Files in reading order

1. [docs/releases.md](../releases.md): the branch table and the release steps, to see the whole flow first.
2. `package.json`: `"version"` and `"edition"`. They decide the tag and the download's name.
3. `CHANGELOG.md`: each version's section becomes its release notes.
4. `scripts/package-release.mjs`: section 2 (the pure rules), then section 4 (`packageRelease`).
5. `.github/workflows/release.yml`: the four steps on GitHub.
6. `tests/release/package-release.test.js`: what the rules promise, as tests.

## The key lines

The whole build is one git command. Everything before it is checking:

```js
git(repoDir, ['archive', '--format=zip', `--prefix=${name}/`, '-o', zipPath, tag, '--', ...paths]);
```

- `--prefix=breakaway-v1-vector/` puts every file inside one folder, so unzipping never spills files into the Downloads folder.
- `tag` is the source: the tagged commit, not the working folder.
- `--` ends the options; after it come only paths, so a path can never be read as an option.

Publishing is one `gh` command, with every value coming from `env:`:

```yaml
run: gh release create "$TAG" "$ZIP" "$CHECKSUM" --verify-tag --title "$TITLE" --notes-file "$NOTES" --latest="$IS_LATEST"
```

## Why this way, and the alternative

The simplest alternative is uploading a zip by hand on the Releases page. It works, but I'd build the zip from my folder each time, and one day it wouldn't match the tag. With the workflow, the tag is the single source: same tag, same zip, tested first. More options are in [decisions.md](../decisions.md#versions-tags-and-github-releases-with-named-downloads).

## Comparing to what I know

- **Coursework submissions**: I zipped a folder by hand and uploaded it. That's the "upload by hand" option, and it's how a wrong file gets submitted. Here the zip comes from a tagged commit and a script.
- **My PHP projects**: "deploying" meant copying files to a server, and the only record of what was live was the server itself. A tag is a permanent record of exactly what each version was.
- **Hangman**: one version, always the latest. Breakaway keeps every version reachable.

## Run it and try one thing

```bash
cd Breakaway
git tag -a v1.0.0 -m "Breakaway V1, vector"
npm run package -- v1.0.0
```

Experiment: after tagging, add a line to `index.html` without committing, run `npm run package -- v1.0.0` again, unzip, and look: the line isn't there, and `sha256sum` gives the same hash as before. Then undo the edit with `git restore index.html`. Only make the tag when the version is really ready, or delete a local, unpushed tag with `git tag -d v1.0.0`.

## Watch-outs

- Never move or delete a tag after pushing it. Other people (and the release) point at it. Fix forward with `v1.0.1`.
- The version in `package.json` and the tag must match; the script stops if they don't.
- Deleting a release on GitHub doesn't delete its tag, and deleting a tag doesn't delete the release's notes page. Clean up both if I ever really need to.
- Set the changelog date to the day I tag, not the day I start the release prep.
- Once V2 work is on `dev`, never merge `dev` into `release/v1`: it would bring V2 into V1. Only cherry-pick single commits.
- A change to an old version never goes into `main`; `main` is the newest version.

## Reusing this in another project

1. Decide the branches (tags on `main`, or release branches like here) and the maintenance policy, and write both down in `docs/decisions.md`.
2. Copy `scripts/package-release.mjs`, `tests/release/` and `.github/workflows/release.yml`.
3. In the script, change `PLAY_PATHS` (what a user needs), the `breakaway-` name prefix in `getDownloadName()` and the title in `getReleaseTitle()`.
4. Add `"edition"` to `package.json` (or drop editions and use only the version), plus the `package` and `test:release` scripts and `dist/` in `.gitignore`.
5. Keep a Keep a Changelog `CHANGELOG.md` with a section per version.
6. Write a `PLAY.md` (or `INSTALL.md`) that ships inside the zip.

## Check myself

1. Why does the zip come from `git archive v1.0.0` instead of zipping the folder?
2. What does `--verify-tag` protect against?
3. If I release `v1.0.1` after `v2.0.0`, which one does GitHub show as "Latest", and which function decides it?
4. What would happen if the workflow pasted `${{ steps.package.outputs.title }}` straight into the `run:` line, and the title contained a quote?
5. Why does `main` only move through a release branch? What would my site show if I merged `dev` straight into `main`?
6. I find a bug while playing V1 while I'm working on V3. Which branch and which folder do I fix it in, what's the new tag, what happens to `main`, `dev` and my site, and how does the fix reach V3 if V3 has the same bug?

## Changelog

- 2026-11-04: Added release branches, releasing vs deploying, the branching models I compared, and my maintenance policy (frozen by default, an occasional fix on the old version's branch).
- 2026-11-04: First version, written while setting up the V1 release.
