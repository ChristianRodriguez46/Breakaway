// Shared helpers for the static site checks (TEST_PLAN layer [S]). Not a test file.
// These checks read my portfolio's own pages, so they only run when this repo sits at
// Projects/Breakaway inside the portfolio (as a git submodule). npm test leaves them out.
// Troubleshooting: if a path is wrong, REPO_ROOT is two folders above GAME_DIR (Projects/Breakaway).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const GAME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_ROOT = resolve(GAME_DIR, '../..');

if (!existsSync(join(REPO_ROOT, 'Projects/index.html')) || !existsSync(join(REPO_ROOT, 'style/main.css'))) {
    throw new Error(
        'The site checks need my portfolio around the game. Run npm run test:site in ' +
        'ChristianRodriguez46.github.io/Projects/Breakaway (the copy inside my portfolio), not in Breakaway on its own.'
    );
}

/** Hand-written pages whose "Projects" nav and footer links must resolve (task list, TEST_PLAN AC-17.5). */
export const HAND_WRITTEN_PAGES = Object.freeze([
    'index.html',
    'Coursework/index.html',
    'Projects/Hangman/index.html',
    'Projects/index.html'
]);

export const GENERATOR_META = '<meta name="generator" content="build_lab_pages.py">';

/** Reads a repo-relative file as text. @param {string} repoPath */
export function readRepoFile(repoPath) {
    return readFileSync(join(REPO_ROOT, repoPath), 'utf8');
}

/** Lists files under a folder (absolute paths), skipping the listed folder names. */
export function listFiles(dir, skipNames = ['node_modules', '.git']) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (skipNames.includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...listFiles(full, skipNames));
        else out.push(full);
    }
    return out;
}

/** Removes comments so a URL or word inside a comment is not counted as code. */
export function stripComments(text, kind) {
    if (kind === 'html') return text.replace(/<!--[\s\S]*?-->/g, '');
    if (kind === 'css') return text.replace(/\/\*[\s\S]*?\*\//g, '');
    // js: block comments, then whole-line and trailing // comments that are not part of a "://" URL
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Returns {href, text, attrs} for every anchor in an HTML string. */
export function getAnchors(html) {
    const anchors = [];
    const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(stripComments(html, 'html'))) !== null) {
        const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(match[1]);
        anchors.push({
            href: hrefMatch ? (hrefMatch[2] ?? hrefMatch[3]) : null,
            text: match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
            attrs: match[1]
        });
    }
    return anchors;
}

/** Page <title> text, or null. */
export function getTitle(html) {
    const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
    return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Resolves a relative href found on a repo page to a repo path (posix, no leading slash).
 * A trailing slash or a folder means that folder's index.html. Returns null for absolute URLs.
 * @param {string} pageRepoPath e.g. "Projects/Hangman/index.html"
 * @param {string} href
 */
export function resolveHref(pageRepoPath, href) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
    const withoutFragment = href.split('#')[0].split('?')[0];
    const pageDir = posix.dirname(pageRepoPath);
    const joined = withoutFragment === '' ? pageRepoPath : posix.normalize(posix.join(pageDir, withoutFragment));
    return joined === '.' ? '' : joined;
}

/** True when a repo path is a file, or a folder holding index.html. */
export function targetExists(repoPath) {
    const full = join(REPO_ROOT, repoPath);
    if (!existsSync(full)) return false;
    if (statSync(full).isDirectory()) return existsSync(join(full, 'index.html'));
    return true;
}

/** Runs git in the repo; returns {ok, out}. Never throws. */
export function git(args) {
    try {
        const out = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, out };
    } catch (error) {
        return { ok: false, out: String(error.stderr || error.message) };
    }
}

export const toPosix = (p) => p.split(sep).join('/');
export { relative, join, existsSync };
