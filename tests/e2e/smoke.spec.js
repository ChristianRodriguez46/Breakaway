/**
 * Smoke test (@smoke): the page loads cleanly, Play starts an attempt, and one shot resolves.
 *
 * Run it (from the Breakaway folder; run `npx playwright install chromium` once after `npm install`):
 *     npx playwright test --grep @smoke
 *
 * Outcome (goal, save, miss) is random, so the test only checks that the attempt resolved:
 * the first attempt marker leaves its "current" state. Anything in the console other than the
 * site files that 404 when the game runs without the portfolio site around it fails the test.
 */
import { test, expect } from '@playwright/test';

/** Site files index.html links as ../../ paths; they don't exist when the game runs on its own. */
const EXPECTED_MISSING = [
    '/style/main.css',
    '/js/main.js',
    '/images/logo.svg',
    '/images/logo.png',
    '/images/apple-touch-icon.png'
];

/**
 * @param {string} url
 * @returns {boolean} true for a site file that is expected to be missing
 */
function isExpectedMissing(url) {
    const { pathname } = new URL(url);
    return EXPECTED_MISSING.includes(pathname);
}

test.describe('Breakaway smoke @smoke', () => {
    test('loads, starts an attempt and resolves a shot', async ({ page, isMobile }) => {
        /** @type {string[]} */
        const problems = [];

        page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
        page.on('requestfailed', (request) => {
            if (!isExpectedMissing(request.url())) problems.push(`request failed: ${request.url()}`);
        });
        page.on('response', (response) => {
            if (response.status() >= 400 && !isExpectedMissing(response.url())) {
                problems.push(`HTTP ${response.status()}: ${response.url()}`);
            }
        });
        page.on('console', (message) => {
            if (message.type() !== 'error' && message.type() !== 'warning') return;
            const url = message.location().url;
            // The browser's own "Failed to load resource" line for an expected 404
            if (url && isExpectedMissing(url)) return;
            problems.push(`console ${message.type()}: ${message.text()}`);
        });

        // (a) Loads on the start screen
        // './' keeps the game's folder in the URL when it runs inside my site (/Projects/Breakaway/)
        await page.goto('./');
        const main = page.locator('main#main');
        await expect(main).toBeVisible();
        await expect(main).toHaveAttribute('data-screen', 'start');

        // (b) Play starts an attempt
        await page.getByTestId('play-button').click();
        await expect(main).toHaveAttribute('data-screen', 'playing', { timeout: 15_000 });
        const box = await page.getByTestId('rink-canvas').boundingBox();
        expect(box).not.toBeNull();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);

        const firstMarker = page.getByTestId('attempt-marker').first();
        await expect(firstMarker).toHaveAttribute('data-state', 'current');

        // (c) Shoot with the default scheme (hold to charge): hold, then release
        if (isMobile) {
            const shoot = page.getByTestId('shoot-button');
            await expect(shoot).toBeVisible();
            await shoot.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 });
            await page.waitForTimeout(400);
            await shoot.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 });
        } else {
            await page.keyboard.down('Space');
            await page.waitForTimeout(400);
            await page.keyboard.up('Space');
        }

        // The attempt resolved when its marker is no longer the current one (goal, save or miss)
        await expect(firstMarker).not.toHaveAttribute('data-state', /^(current|pending)$/, { timeout: 15_000 });

        // (d) Nothing unexpected reached the console
        expect(problems).toEqual([]);
    });
});
