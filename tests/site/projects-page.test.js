// The Projects page and the homepage tile (AC-17.3, AC-17.4).
// Troubleshooting: Projects/index.html is owned by the site slice; if it is missing these fail first.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, readRepoFile, getAnchors, getTitle, resolveHref, targetExists, stripComments } from './site-helpers.js';

const PROJECTS = 'Projects/index.html';
// Breakaway has its own repo; Hangman still lives in the portfolio repo.
const CODE_LINKS = Object.freeze({
    Breakaway: 'https://github.com/ChristianRodriguez46/Breakaway',
    Hangman: 'https://github.com/ChristianRodriguez46/ChristianRodriguez46.github.io/tree/main/Projects/Hangman'
});

describe('Projects index page', () => {
    it('exists', () => {
        assert.ok(existsSync(join(REPO_ROOT, PROJECTS)), `${PROJECTS} is missing`);
    });

    it('links to ./Breakaway/ and ./Hangman/ and both resolve', () => {
        const hrefs = getAnchors(readRepoFile(PROJECTS)).map((a) => a.href);
        for (const wanted of ['./Breakaway/', './Hangman/']) {
            assert.ok(hrefs.includes(wanted), `Projects page has no link to ${wanted}; has ${JSON.stringify(hrefs)}`);
            assert.ok(targetExists(resolveHref(PROJECTS, wanted)), `${wanted} does not resolve`);
        }
    });

    it('offers a code link for each game on GitHub, without fetching it', () => {
        const hrefs = getAnchors(readRepoFile(PROJECTS)).map((a) => a.href);
        for (const [game, url] of Object.entries(CODE_LINKS)) {
            assert.ok(hrefs.includes(url), `no code link for ${game} (expected ${url})`);
        }
    });

    it('has a language, one h1, a unique title and the shared stylesheet', () => {
        const html = readRepoFile(PROJECTS);
        assert.match(html, /<html[^>]*\blang="en"/i);
        assert.equal((html.match(/<h1\b/gi) ?? []).length, 1, 'expected exactly one h1');
        const title = getTitle(html);
        assert.ok(title && title.length > 0, 'missing <title>');
        for (const other of ['index.html', 'Coursework/index.html', 'Projects/Hangman/index.html', 'Projects/Breakaway/index.html']) {
            assert.notEqual(getTitle(readRepoFile(other)), title, `title duplicates ${other}`);
        }
        assert.match(html, /href="\.\.\/style\/main\.css"/, 'does not load ../style/main.css');
    });

    it('lists exactly two games', () => {
        const playLinks = getAnchors(readRepoFile(PROJECTS)).filter((a) => a.href === './Breakaway/' || a.href === './Hangman/');
        const unique = new Set(playLinks.map((a) => a.href));
        assert.equal(unique.size, 2);
        const tiles = (readRepoFile(PROJECTS).match(/<article\b/gi) ?? []).length;
        assert.equal(tiles, 2, `expected 2 <article> tiles, found ${tiles}`);
    });

    it('loads nothing from third-party origins (links to github.com are navigation only)', () => {
        const code = stripComments(readRepoFile(PROJECTS), 'html');
        const loads = [...code.matchAll(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*"(https?:[^"]*)"/gi)].map((m) => m[1]);
        assert.deepEqual(loads, [], 'Projects page loads external resources');
        assert.doesNotMatch(code, /@import|fonts\.googleapis|cdnjs/i);
    });
});

describe('homepage Breakaway tile', () => {
    it('has a Play link to ./Projects/Breakaway/ and a code link to the Breakaway repo', () => {
        const hrefs = getAnchors(readRepoFile('index.html')).map((a) => a.href);
        assert.ok(hrefs.includes('./Projects/Breakaway/'), 'no Play link to ./Projects/Breakaway/');
        assert.ok(hrefs.includes(CODE_LINKS.Breakaway), `no View code link to ${CODE_LINKS.Breakaway}`);
        assert.ok(targetExists('Projects/Breakaway/index.html'));
    });

    it('labels the tile with an h2 referenced by aria-labelledby="tile-breakaway"', () => {
        const html = readRepoFile('index.html');
        assert.match(html, /aria-labelledby="tile-breakaway"/);
        assert.match(html, /<h2\b[^>]*\bid="tile-breakaway"/);
    });

    it('keeps the Hangman tile', () => {
        const hrefs = getAnchors(readRepoFile('index.html')).map((a) => a.href);
        assert.ok(hrefs.includes('./Projects/Hangman/'));
    });
});
