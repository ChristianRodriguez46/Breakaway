// "Projects" links in the shared navigation and footer must reach the Projects page (AC-17.5).
// Troubleshooting: a failure names the page and the href. A link that resolves to
// /Projects/Hangman/ is the old behavior; the Projects page lives at /Projects/.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HAND_WRITTEN_PAGES, readRepoFile, getAnchors, resolveHref, targetExists } from './site-helpers.js';

const PAGES = [...HAND_WRITTEN_PAGES, 'Projects/Breakaway/index.html'];

describe('shared navigation "Projects" links', () => {
    for (const page of PAGES) {
        it(`${page} has Projects links that resolve to an existing file`, () => {
            const links = getAnchors(readRepoFile(page)).filter((a) => a.text === 'Projects');
            assert.ok(links.length >= 1, `${page} has no anchor labeled "Projects"`);
            for (const link of links) {
                assert.ok(link.href, `${page}: Projects anchor has no href`);
                const target = resolveHref(page, link.href);
                assert.notEqual(target, null, `${page}: Projects link ${link.href} should be relative`);
                assert.ok(targetExists(target), `${page}: Projects link ${link.href} resolves to missing ${target}`);
            }
        });

        it(`${page} sends every Projects link to the Projects page, not to one game`, () => {
            const links = getAnchors(readRepoFile(page)).filter((a) => a.text === 'Projects');
            for (const link of links) {
                const target = resolveHref(page, link.href);
                const normalized = target.replace(/\/index\.html$/, '').replace(/\/$/, '');
                assert.equal(normalized, 'Projects', `${page}: Projects link ${link.href} -> ${target}`);
            }
        });
    }

    it('hand-written pages carry a Projects link in both the header navigation and the footer where a footer exists', () => {
        for (const page of ['index.html', 'Coursework/index.html']) {
            const html = readRepoFile(page);
            const count = getAnchors(html).filter((a) => a.text === 'Projects').length;
            assert.ok(count >= 2, `${page} should link Projects from the nav and the footer (found ${count})`);
        }
    });
});
