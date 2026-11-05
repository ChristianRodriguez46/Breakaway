# Playing this download

This folder is one version of Breakaway, my top-down hockey shootout against an AI goalie. The folder's name says which version it is. For example, `breakaway-v1-vector` is V1, drawn with Canvas 2D shapes. The [README on GitHub](https://github.com/ChristianRodriguez46/Breakaway#versions) lists every version.

The game is a static web page, but it still needs a local web server: browsers won't load its JavaScript modules from a file opened by double-clicking `index.html`.

## With VS Code and Live Server

1. Unzip the download. You get a folder named like `breakaway-v1-vector`.
2. In VS Code, choose **File > Open Folder** and open that folder.
3. In the Extensions view, install **Live Server** by Ritwick Dey (extension ID `ritwickdey.LiveServer`).
4. Right-click `index.html` in the Explorer and choose **Open with Live Server**, or click **Go Live** in the status bar.

The game opens in your browser, usually at http://127.0.0.1:5500/index.html (5500 is Live Server's default port).

## With Python instead

```bash
cd breakaway-v1-vector
python3 -m http.server 4101
```

Then open http://localhost:4101/. On Windows without WSL the command may be `python` instead of `python3`. Stop the server with Ctrl+C.

## What to expect

- The game runs on its own here, so the nav bar from my site is hidden.
- The browser's developer tools show "not found" errors for my site's stylesheet, script and icon (`../../style/main.css`, `../../js/main.js`, `../../images/logo.svg`). That's expected: those files belong to my site, and the page hides the nav when they're missing.
- Settings and best scores are saved in this browser for this local address only, separate from the live site.
