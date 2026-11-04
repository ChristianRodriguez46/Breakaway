#!/bin/sh
# Local web server for playing Breakaway while I work (npm run serve).
#
# Sections
#   1. Find where this copy of the game lives
#   2. Pick what to serve (three cases below)
#   3. Start python3's web server on localhost only
#
# The three cases
#   a. Inside my site (~/REPO/ChristianRodriguez46.github.io/Projects/Breakaway, the submodule):
#      serves the site root, exactly like GitHub Pages. Open /Projects/Breakaway/
#   b. On its own, with my site cloned next to it (~/REPO/Breakaway and
#      ~/REPO/ChristianRodriguez46.github.io): builds a temporary preview folder of links, with the
#      site's files around THIS copy of the game, so my work in progress shows with the real nav and
#      fonts. Nothing in the site repo changes. Open /Projects/Breakaway/
#      Another location for the site: SITE=/path/to/site npm run serve
#   c. On its own, no site next to it: serves this folder. The game plays, but the nav bar and the
#      site font are missing because they live in my site's repo. Open /
#
# Troubleshooting
#   - "Address already in use": another server is on 4101. Run PORT=4102 npm run serve
#   - Windows can't open localhost:4101: try http://127.0.0.1:4101/, or run wsl --shutdown in PowerShell
#   - Case b shows an old site page: the preview uses whatever is checked out in the site clone; git pull there

set -e

# 1. This script is in scripts/, so the game folder is one level up.
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
echo "On its own: open http://localhost:$PORT/ (no site next to it, so the nav and site font are missing)"
echo "Ctrl+C stops the server."
# 3. --bind 127.0.0.1 keeps the server off the network; WSL2 still forwards localhost to Windows.
exec python3 -m http.server "$PORT" --bind 127.0.0.1
