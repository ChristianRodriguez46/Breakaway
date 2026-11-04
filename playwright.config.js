// Browser tests (TEST_PLAN §1).
// Inside my site (Projects/Breakaway as a submodule) it serves the site root, so
// ../../style/main.css resolves like on GitHub Pages. On its own it serves this folder,
// where the game runs and the page hides the site's nav (html.no-site).
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const IN_SITE = existsSync(new URL('../../style/main.css', import.meta.url))
    && existsSync(new URL('../../Projects/index.html', import.meta.url));
const BASE_URL = IN_SITE ? 'http://127.0.0.1:4120/Projects/Breakaway/' : 'http://127.0.0.1:4120/';

export default defineConfig({
    testDir: 'tests/e2e',
    retries: 0,
    fullyParallel: true,
    reporter: [['list']],
    use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
    webServer: {
        command: 'python3 -m http.server 4120 --bind 127.0.0.1',
        cwd: IN_SITE ? '../..' : '.',
        url: BASE_URL,
        reuseExistingServer: true
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
        { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
        { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } }
    ]
});
