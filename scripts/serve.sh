#!/bin/sh
# Local web server for playing Breakaway while I work (npm run serve).
#
# Sections
#   1. Find where this copy of the game lives
#   2. Pick what to serve (three cases below)
#   3. Start python3's web server on localhost only
#
# The three cases
#   Paths are worked out from this script's place in the repo, so it works wherever the repos are
#   cloned. It relies only on the folder names Breakaway and ChristianRodriguez46.github.io.
#   a. In ChristianRodriguez46.github.io/Projects/Breakaway (the copy inside my portfolio, so
#      ../../style/main.css exists): serves ChristianRodriguez46.github.io, exactly like GitHub
#      Pages. Open /Projects/Breakaway/
#   b. In Breakaway, with ChristianRodriguez46.github.io cloned next to it (side by side): builds a
#      temporary preview folder of links, with the site's files around THIS copy of the game, so my
#      work in progress shows with the real nav and fonts. Nothing in
#      ChristianRodriguez46.github.io changes. Open /Projects/Breakaway/
#      ChristianRodriguez46.github.io somewhere else: SITE=/path/to/ChristianRodriguez46.github.io npm run serve
#   c. In Breakaway, with nothing next to it: serves Breakaway. The game looks and plays the same;
#      the page hides my site's nav because its links lead to site pages that aren't here. Open /
#
# Troubleshooting
#   - "Address already in use": another server is on 4101. Run PORT=4102 npm run serve
#   - Windows can't open localhost:4101: try http://127.0.0.1:4101/, or run wsl --shutdown in PowerShell
#   - Case b shows an old site page: the preview uses whatever is checked out in ChristianRodriguez46.github.io; git pull there

set -e

# 1. This script is in Breakaway/scripts/, so the Breakaway folder is one level up.
cd "$(dirname "$0")/.."
GAME_DIR="$(pwd)"
PORT="${PORT:-4101}"
SITE="${SITE:-../ChristianRodriguez46.github.io}"

# 2a. Inside my site
if [ -f ../../style/main.css ] && [ -f ../../Projects/index.html ]; then
    cd ../..
    echo "Inside my site: open http://localhost:$PORT/Projects/Breakaway/"
    echo "Ctrl+C stops the server."
    exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi

# 2b. On its own, with my site cloned next to it
if [ -f "$SITE/style/main.css" ] && [ -f "$SITE/Projects/index.html" ]; then
    SITE_DIR="$(cd "$SITE" && pwd)"
    PREVIEW="$(mktemp -d)"
    # rm -rf removes the links, never the files they point to
    trap 'rm -rf "$PREVIEW"' EXIT
    trap 'exit 0' INT TERM
    for entry in "$SITE_DIR"/*; do
        [ "$(basename "$entry")" = "Projects" ] || ln -s "$entry" "$PREVIEW/"
    done
    mkdir "$PREVIEW/Projects"
    for entry in "$SITE_DIR"/Projects/*; do
        [ "$(basename "$entry")" = "Breakaway" ] || ln -s "$entry" "$PREVIEW/Projects/"
    done
    ln -s "$GAME_DIR" "$PREVIEW/Projects/Breakaway"
    echo "Preview with my site around this copy ($SITE_DIR):"
    echo "open http://localhost:$PORT/Projects/Breakaway/"
    echo "Ctrl+C stops the server."
    cd "$PREVIEW"
    python3 -m http.server "$PORT" --bind 127.0.0.1
    exit 0
fi

# 2c. On its own, no site next to it
echo "On its own: open http://localhost:$PORT/ (no site next to it, so the site nav is hidden)"
echo "Ctrl+C stops the server."
# 3. --bind 127.0.0.1 keeps the server off the network; WSL2 still forwards localhost to Windows.
exec python3 -m http.server "$PORT" --bind 127.0.0.1
