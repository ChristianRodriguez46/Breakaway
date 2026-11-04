/* =============================================================
   src/core/random.js
   Seeded random numbers, so the same seed always plays the same game.

   Sections in this file
     1. createRng: the mulberry32 generator
     2. parseSeedParam: reading ?seed= from the page URL

   Why not Math.random(): it can't be seeded, so a test couldn't
   replay a goalie decision. The core receives one of these functions
   instead (docs/decisions.md). mulberry32 is a small, well-known 32-bit
   generator: fast, good enough for games, not for security.

   Troubleshooting
   - Two runs with the same ?seed= differ: something in the core is
     drawing a different number of random values (for example a
     roll that depends on frame timing). Core code must only draw
     inside fixed steps.
   ============================================================= */

/** Largest seed accepted from the URL (unsigned 32-bit). */
const MAX_SEED = 0xffffffff;
const UINT32_RANGE = 4294967296;

/**
 * Creates a seeded random function that returns numbers in [0, 1).
 * @param {number} seed - Any number; it's converted to an unsigned 32-bit integer.
 * @returns {import('./types.js').RandomFn}
 */
export function createRng(seed) {
    let current = seed >>> 0;
    return function random() {
        // mulberry32: add a constant, then scramble the bits with multiplies and xor-shifts.
        current = (current + 0x6d2b79f5) >>> 0;
        let mixed = current;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
    };
}

/**
 * Reads an integer seed from a URL query string such as "?seed=42".
 * @param {string} search - The `location.search` string (may be empty).
 * @returns {number|null} The seed, or null when it's missing or not a whole number from 0 to 4294967295.
 */
export function parseSeedParam(search) {
    const raw = new URLSearchParams(search).get('seed');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const seed = Number(raw);
    return seed <= MAX_SEED ? seed : null;
}
