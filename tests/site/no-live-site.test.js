// Browser tests may only ever talk to the local server (TEST_PLAN section 3, rule 6).
// Troubleshooting: remove the live-site host name from the named file. Tests use the
// baseURL from playwright.config.js (127.0.0.1:4120) and nothing else.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, listFiles, toPosix, relative } from './site-helpers.js';

const LIVE_HOST = /github\.io/i;
const FOLDERS = ['tests/e2e', 'tests/helpers', 'tests/fixtures'];

describe('e2e isolation from the live site', () => {
    it('no test, helper or fixture file mentions the live GitHub Pages host', () => {
        const offenders = [];
        for (const folder of FOLDERS) {
            const dir = join(GAME_DIR, folder);
            if (!existsSync(dir)) continue;
            for (const file of listFiles(dir)) {
                if (LIVE_HOST.test(readFileSync(file, 'utf8'))) offenders.push(toPosix(relative(GAME_DIR, file)));
            }
        }
        assert.deepEqual(offenders, []);
    });

    it('the Playwright config only serves and targets 127.0.0.1', () => {
        const config = readFileSync(join(GAME_DIR, 'playwright.config.js'), 'utf8');
        assert.doesNotMatch(config, LIVE_HOST);
        const urls = config.match(/https?:\/\/[^\s'"`]+/g) ?? [];
        for (const url of urls) assert.match(url, /^http:\/\/127\.0\.0\.1:\d+/, `config targets ${url}`);
    });
});
