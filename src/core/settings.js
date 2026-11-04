/* =============================================================
   src/core/settings.js
   Defaults and validation for saved settings and best scores.

   Saved data comes from localStorage, which the player (or an old
   version of the game, or a browser extension) can change. Nothing
   here trusts it: every field is checked on its own, and a bad field
   falls back to its default without throwing away the good ones.

   Sections in this file
     1. Small type checks
     2. Settings
     3. Best scores (9 slots: 3 control schemes x 3 starting levels)

   Troubleshooting
   - A setting keeps resetting to its default: the saved value is not
     one of the allowed values in constants.js (CONTROL_SCHEMES,
     STARTING_LEVELS, MOTION_PREFERENCES), or is the wrong type
     (is_sound_on must be true or false, not "true").
   - A best score disappears after reload: its slot key is not
     "<scheme>:<level>", or one of its numbers is negative, not an
     integer, or achieved_at is not an ISO date string.
   - Nothing here touches localStorage; see src/browser/storage.js.
   ============================================================= */

import {
    CONTROL_SCHEMES as SCHEME_LIST, STARTING_LEVELS as LEVEL_LIST, MOTION_PREFERENCES as MOTION_LIST,
    DEFAULT_SETTINGS, SCHEMA_VERSION
} from './constants.js';

/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').BestScore} BestScore */
/** @typedef {import('./types.js').BestScores} BestScores */
/** @typedef {import('./types.js').ControlScheme} ControlScheme */
/** @typedef {import('./types.js').StartingLevel} StartingLevel */

/** @typedef {import('./types.js').MotionPreference} MotionPreference */

/* ---------- 1. Small type checks ---------- */

const CONTROL_SCHEMES = /** @type {readonly ControlScheme[]} */ (SCHEME_LIST);
const STARTING_LEVELS = /** @type {readonly StartingLevel[]} */ (LEVEL_LIST);
const MOTION_PREFERENCES = /** @type {readonly MotionPreference[]} */ (MOTION_LIST);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Highest value any saved count may hold. Far above any real run (a goal is 150 points at most), so
 * a hand-edited value like 1e21 is rejected instead of becoming a best nobody can ever beat.
 */
const MAX_SAVED_COUNT = 10_000_000;

/** @param {unknown} value @returns {boolean} */
function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SAVED_COUNT;
}

/** Strict ISO 8601 (the shape Date#toISOString writes) that also parses to a real date. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** @param {unknown} value @returns {boolean} */
function isIsoDateString(value) {
    return typeof value === 'string' && ISO_DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Picks `value` when it is one of `allowed`, else `fallback`.
 * @template T @param {unknown} value @param {readonly T[]} allowed @param {T} fallback @returns {T}
 */
function pickEnum(value, allowed, fallback) {
    return allowed.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
}

/* ---------- 2. Settings ---------- */

/**
 * Turns parsed JSON (or anything else) into valid Settings. Never throws.
 * Each bad or missing field gets its default from DEFAULT_SETTINGS; good fields are kept.
 * @param {unknown} raw - Usually `JSON.parse` of the saved string; may be null, a number, an array…
 * @returns {Settings} A new, complete settings object with `schema_version: 1`.
 */
export function validateSettings(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return {
        schema_version: SCHEMA_VERSION,
        control_scheme: pickEnum(source.control_scheme, CONTROL_SCHEMES, DEFAULT_SETTINGS.control_scheme),
        is_sound_on: typeof source.is_sound_on === 'boolean' ? source.is_sound_on : DEFAULT_SETTINGS.is_sound_on,
        motion_preference: pickEnum(source.motion_preference, MOTION_PREFERENCES, DEFAULT_SETTINGS.motion_preference),
        starting_level: pickEnum(source.starting_level, STARTING_LEVELS, DEFAULT_SETTINGS.starting_level)
    };
}

/* ---------- 3. Best scores ---------- */

/**
 * Builds the best-score slot key for a control scheme and starting level.
 * @param {ControlScheme} scheme
 * @param {StartingLevel} startingLevel - 'ladder' is the Rookie start.
 * @returns {string} For example "hold_charge:ladder".
 */
export function getBestScoreSlotKey(scheme, startingLevel) {
    return `${scheme}:${startingLevel}`;
}

/** All 9 valid slot keys. */
const VALID_SLOT_KEYS = new Set(
    CONTROL_SCHEMES.flatMap((scheme) => STARTING_LEVELS.map((level) => getBestScoreSlotKey(scheme, level)))
);

/**
 * Checks one saved best score.
 * @param {unknown} raw @returns {BestScore|null} A clean copy, or null when any field is bad.
 */
function validateBestScore(raw) {
    if (!isPlainObject(raw)) return null;
    const { score, rounds_cleared: roundsCleared, goals, achieved_at: achievedAt } = raw;
    if (!isNonNegativeInteger(score) || !isNonNegativeInteger(roundsCleared) || !isNonNegativeInteger(goals)) {
        return null;
    }
    if (!isIsoDateString(achievedAt)) return null;
    return {
        score: /** @type {number} */ (score),
        rounds_cleared: /** @type {number} */ (roundsCleared),
        goals: /** @type {number} */ (goals),
        achieved_at: /** @type {string} */ (achievedAt)
    };
}

/**
 * Turns parsed JSON into valid BestScores. Never throws. Keeps each valid slot,
 * drops unknown keys and slots with any bad field.
 * @param {unknown} raw - Usually `JSON.parse` of the saved string.
 * @returns {BestScores} A new object with `schema_version: 1`.
 */
export function validateBestScores(raw) {
    /** @type {Record<string, BestScore>} */
    const scores = {};
    const source = isPlainObject(raw) && isPlainObject(raw.scores) ? raw.scores : {};
    for (const key of Object.keys(source)) {
        if (!VALID_SLOT_KEYS.has(key)) continue;
        const best = validateBestScore(source[key]);
        if (best) scores[key] = best;
    }
    return { schema_version: SCHEMA_VERSION, scores };
}

/**
 * Returns a copy of `bestScores` with one slot replaced. The input is not changed.
 * @param {BestScores} bestScores
 * @param {string} slotKey - From getBestScoreSlotKey.
 * @param {BestScore} best
 * @returns {BestScores}
 */
export function withBestScore(bestScores, slotKey, best) {
    return {
        schema_version: SCHEMA_VERSION,
        scores: { ...(bestScores ? bestScores.scores : {}), [slotKey]: { ...best } }
    };
}
