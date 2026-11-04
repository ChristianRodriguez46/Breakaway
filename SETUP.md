# Setup

How I run, test and edit Breakaway on Windows with WSL2 (Ubuntu) and VS Code.

Breakaway is a static web game, so the browser runs everything. I only need Node.js for the tests and development tools, and a small local web server to play it while I work.

## Prerequisites

I run every command in my WSL (Ubuntu) terminal, not PowerShell.

| Tool | Version | Install (official source) | Verify |
|---|---|---|---|
| WSL2 with Ubuntu | WSL 2 | Already installed. Guide: [learn.microsoft.com/windows/wsl/install](https://learn.microsoft.com/windows/wsl/install) | In PowerShell, `wsl -l -v` shows `VERSION 2` |
| Git | any recent | `sudo apt update && sudo apt install git` ([git-scm.com](https://git-scm.com/downloads)) | `git --version` |
| Node.js | 24 LTS | nvm, below ([nodejs.org](https://nodejs.org)) | `node -v` prints `v24.x` |
| npm | comes with Node | none | `npm -v` |
| Python 3 | any 3.x | Comes with Ubuntu, or `sudo apt install python3` | `python3 --version` |
| VS Code with the WSL extension | current | [code.visualstudio.com](https://code.visualstudio.com) on Windows, then the **WSL** extension by Microsoft | `code --version` from the WSL terminal |

### Install Node.js with nvm

nvm (Node Version Manager) installs Node in my home folder. No `sudo`, and I can switch versions per project. The command below is from the official [nvm README](https://github.com/nvm-sh/nvm#install--update-script). I check it for a newer version first.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
# Close and reopen the terminal, then:
nvm install 24
nvm alias default 24
node -v   # v24.x.x
```

I use 24 because it is the Long-Term Support line I started with. The game itself doesn't run on Node, so a newer LTS works too.

### Where the files live

I keep my repos inside the Linux file system, in `~/REPO/`, not under `/mnt/c/...`. Linux tools are much faster there, and file watching works.

- `~/REPO/Breakaway` is the game's own repo. I do my work here, on the `dev` branch.
- `~/REPO/ChristianRodriguez46.github.io` is my site. It includes the game at `Projects/Breakaway` as a git submodule: a pointer to one commit of Breakaway's `main`.

```bash
cd ~/REPO/Breakaway
pwd                 # should start with /home/<me>, not /mnt/c
git remote -v       # should show ChristianRodriguez46/Breakaway
```

If a clone ever ends up on the C: drive, I clone a fresh copy into `~/REPO` and work there.

## Get the code

I clone both repositories, or pull if I already have them:

```bash
mkdir -p ~/REPO && cd ~/REPO
git clone https://github.com/ChristianRodriguez46/Breakaway.git
git clone --recurse-submodules https://github.com/ChristianRodriguez46/ChristianRodriguez46.github.io.git
cd Breakaway && git pull    # if I already had it
```

If I cloned my site without `--recurse-submodules`, `Projects/Breakaway` is an empty folder. `git submodule update --init` fills it.

## Install dependencies

The game has no runtime dependencies. This installs the development tools only:

```bash
cd ~/REPO/Breakaway
npm install         # installs dev tools into node_modules/ (never committed)
```

## Configuration

There is nothing to configure. No secrets, environment variables or API keys.

## Saved data

There is no database. The game saves the best score and settings in the browser's `localStorage`, on the player's device. To clear it while testing, I use the game's "Reset saved data" button. Or in the browser I press F12, then Application, Local Storage, `http://localhost:4101`, and delete the `breakaway.*` keys.

## Run it

`npm run serve` starts a small web server and prints the address to open. While I work, I run it from the game's repo:

```bash
cd ~/REPO/Breakaway
npm run serve       # open http://localhost:4101/Projects/Breakaway/
```

The game page borrows the nav bar, fonts and logo from my site (`../../style/main.css`, `../../js/main.js`, `../../images/`). So when my site is cloned next to the game, `npm run serve` builds a temporary folder of links with the site's files around this copy of the game, and serves that. I see my work in progress exactly as it will look on the site, and nothing in the site repo changes. Ctrl+C deletes the temporary folder. If my site is somewhere else: `SITE=/path/to/site npm run serve`.

Without the site next to it, `npm run serve` serves the game folder at http://localhost:4101/. The game looks and plays the same, but without my site's nav bar. Its links go to site pages that aren't there, so when `../../style/main.css` doesn't load, `index.html` marks the page `no-site` and `style.css` hides the nav (section 2 of `style.css`).

From the copy inside my site, the same command serves the site root the way GitHub Pages does:

```bash
cd ~/REPO/ChristianRodriguez46.github.io/Projects/Breakaway
npm run serve       # open http://localhost:4101/Projects/Breakaway/
```

I open the address in Chrome or Edge on Windows. WSL2 forwards `localhost` to Windows. Ctrl+C stops the server.

Why a server: browsers refuse to load ES modules from `file://` paths, so double-clicking `index.html` shows a blank page with a CORS error in the console.

## Run the tests

```bash
cd ~/REPO/Breakaway
npm test            # the game: unit, integration and stats tests (node --test)
```

A pass is a summary ending in `# fail 0`. Type checking is `npm run check`.

The site checks in `tests/site/` read my site's pages (nav links, the Projects page, the homepage tile), so they only run from the copy inside my site:

```bash
cd ~/REPO/ChristianRodriguez46.github.io/Projects/Breakaway
npm run test:site
```

## Open it in my editor

```bash
cd ~/REPO/Breakaway
code .
```

VS Code opens connected to WSL (the bottom-left corner says **WSL: Ubuntu**). Recommended extensions are in `.vscode/extensions.json`.

For debugging, I open the game in Chrome or Edge, press F12, and use the Sources tab to set breakpoints in the game's modules.

## Troubleshooting on WSL2

| Problem | Fix |
|---|---|
| `nvm: command not found` right after installing | Close and reopen the terminal, or run `source ~/.bashrc` |
| `node -v` shows an old version | `nvm use 24`, and `nvm alias default 24` so it sticks |
| Blank game page, console says CORS or "Failed to load module script" | I opened the file directly. Run `npm run serve` and use the address it prints |
| The site nav is missing | Expected when the game runs on its own. To see it, clone my site to `~/REPO/ChristianRodriguez46.github.io` (or run `SITE=/path/to/site npm run serve`) and open `/Projects/Breakaway/` |
| The site nav shows as plain unstyled links | `../../style/main.css` loaded but is the wrong file, or the page was saved from somewhere else. Check the path and that `npm run serve` printed the address I opened |
| `Projects/Breakaway` is empty in my site | I cloned without `--recurse-submodules`. Run `git submodule update --init` in the site repo |
| `npm run test:site` says the site checks need my portfolio | I ran it from `~/REPO/Breakaway`. Run it from `Projects/Breakaway` inside my site |
| `notify-portfolio` fails with 401 "Bad credentials" | The `PORTFOLIO_DISPATCH_TOKEN` token expired or the secret is missing. Make a new fine-grained token (portfolio repo only, Contents: Read and write) and update the secret in Breakaway's Settings → Secrets and variables → Actions |
| `notify-portfolio` is green but the site didn't change | Open `update-submodules` in my site's Actions tab. A red run there means the site checks failed, so the site kept its old version |
| Pushing Breakaway says `Permission denied (publickey)` | The clone uses an SSH address and this machine has no SSH key on GitHub. Switch to HTTPS: `git remote set-url origin https://github.com/ChristianRodriguez46/Breakaway.git` |
| `localhost:4101` doesn't open on Windows | Check the server is still running. Try `http://127.0.0.1:4101/`. Run `wsl --shutdown` in PowerShell if forwarding stopped |
| Address already in use | Another server is on that port. Use `python3 -m http.server 4102` |
| Git shows every file as changed | Line endings. `git config --global core.autocrlf input`, and don't edit the repo from `/mnt/c` |
| `code .` not found | Install VS Code on Windows with "Add to PATH" ticked, then reopen the WSL terminal |

## Deploying

I work on `dev`. Pushing `dev` never changes my site. When an update is finished:

```bash
cd ~/REPO/Breakaway
npm test
git switch main && git merge dev && git push && git switch dev
```

Pushing `main` starts the automatic update: the `tests` workflow, then `notify-portfolio`, then my site's `update-submodules` workflow, which moves the submodule, runs the site checks, commits, pushes and asks Pages to rebuild. The README's "Updating my site" section explains each step and how to do it by hand.

Afterwards, my local copy of the site is one commit behind GitHub, so I run `git pull` there before changing anything in it.

GitHub Pages then publishes the site, usually within a minute or two, at **https://christianrodriguez46.github.io/Projects/Breakaway/**. Pages builds the submodule because the Breakaway repo is public and the submodule uses an `https://` address.

## Changelog

- 2026-11-04: Deploying is automatic after pushing `main`; added the token troubleshooting rows.
- 2026-11-04: Breakaway moved to its own repo. Updated where the files live, getting the code, running it, the tests and deploying for the submodule setup.
- 2026-10-21: Rewrote this guide in first person and removed the numbered headings.
- 2026-10-20: Added the troubleshooting table for WSL2.
- 2026-10-19: First version.
