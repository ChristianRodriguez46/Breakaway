// Generated lab pages must be untouched compared with `main` (AC-17.6).
// Skips with a clear message when git or the `main` branch is not available.
// Troubleshooting: a failure lists the changed files. Generated pages come from build_lab_pages.py,
// which lives outside this repo; edit the generator, not the output. Coursework/index.html is
// hand-written and is allowed to change.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, GENERATOR_META, git, toPosix, relative } from './site-helpers.js';

const BASE = 'main';
const ALLOWED_CHANGES = new Set(['Coursework/index.html']);

const hasGit = git(['rev-parse', '--git-dir']).ok;
const hasBase = hasGit && git(['rev-parse', '--verify', '--quiet', `${BASE}^{commit}`]).ok;
const skipReason = !hasGit
    ? 'skipped: git is not available or this folder is not a git checkout'
    : !hasBase
        ? `skipped: branch "${BASE}" is not available here (fetch it with: git fetch origin ${BASE}:${BASE})`
        : false;

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

describe('generated lab pages', { skip: skipReason }, () => {
    it('no file under Coursework changed against main except the hand-written index', () => {
        const changed = git(['diff', '--name-only', BASE, '--', 'Coursework']).out.split('\n').filter(Boolean);
        const unexpected = changed.filter((f) => !ALLOWED_CHANGES.has(f));
        assert.deepEqual(unexpected, [], 'generated pages differ from main');
    });

    it('no new untracked file appears under Coursework', () => {
        const status = git(['status', '--porcelain', '--untracked-files=all', '--', 'Coursework']).out.split('\n').filter(Boolean);
        const added = status.filter((line) => line.startsWith('??') || line.startsWith('A '));
        assert.deepEqual(added, [], 'new files under Coursework');
    });

    it('the set of pages carrying the generator meta is the same as on main', () => {
        const onMain = git(['grep', '-l', GENERATOR_META, BASE, '--', 'Coursework']).out
            .split('\n').filter(Boolean).map((line) => line.replace(`${BASE}:`, '')).sort();
        const now = walk(join(REPO_ROOT, 'Coursework'))
            .filter((f) => f.endsWith('.html') && readFileSync(f, 'utf8').includes(GENERATOR_META))
            .map((f) => toPosix(relative(REPO_ROOT, f))).sort();
        assert.ok(onMain.length > 0, 'found no generated pages on main; the meta tag may have changed');
        assert.deepEqual(now, onMain);
    });

    it('Coursework/index.html is hand-written, so editing it is legitimate', () => {
        assert.ok(!readFileSync(join(REPO_ROOT, 'Coursework/index.html'), 'utf8').includes(GENERATOR_META));
    });

    it('Hangman gameplay files are unchanged against main', () => {
        const changed = git(['diff', '--name-only', BASE, '--', 'Projects/Hangman/hangman_word_bank.js', 'Projects/Hangman/style.css']).out.trim();
        assert.equal(changed, '', 'Hangman word bank or stylesheet changed');
    });
});

if (skipReason) {
    // Make the reason visible even in a quiet reporter.
    console.log(`# generated-pages: ${skipReason}`);
}
