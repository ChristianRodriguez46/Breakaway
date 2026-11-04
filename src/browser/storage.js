/* =============================================================
   src/browser/storage.js
   Safe wrapper around localStorage for settings and best scores.

   Sections in this file
     1. Low-level safe read and write
     2. createStore: load, save, record a best, reset

   Every getItem, setItem, removeItem and JSON.parse is wrapped in
   try/catch: private windows, full disks and blocked storage throw,
   and the game must keep running (Q16). A failed write sets
   didLastWriteFail so the UI can show the notice line.
   Validation lives in core/settings.js (pure, tested in Node).

   Troubleshooting
   - "Best scores can't be saved" shows: setItem threw. Check the
     browser's site-data settings or private mode.
   - Reset left a key behind: only keys starting with "breakaway."
     are removed, on purpose (other site data is not ours).
   ============================================================= */

import { SETTINGS_KEY, BEST_SCORES_KEY, STORAGE_PREFIX } from '../core/constants.js';
import { validateSettings, validateBestScores, withBestScore } from '../core/settings.js';
import { isNewBest } from '../core/scoring.js';

/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').BestScores} BestScores */
/** @typedef {import('../core/types.js').BestScore} BestScore */

/* ---------- 1. Low-level safe read and write ---------- */

/**
 * Reads and parses one JSON key. Returns null on any failure.
 * @param {Storage|null} storage @param {string} key
 * @returns {unknown}
 */
function readJson(storage, key) {
    if (!storage) return null;
    try {
        const text = storage.getItem(key);
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Writes one JSON key.
 * @param {Storage|null} storage @param {string} key @param {unknown} value
 * @returns {boolean} False when the write threw or there is no storage.
 */
function writeJson(storage, key, value) {
    if (!storage) return false;
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/* ---------- 2. createStore ---------- */

/**
 * Creates the store. `storage` is usually window.localStorage (may be null when even
 * reading the property throws); `now` returns the current Date (injected for tests).
 * @param {{ storage: Storage|null, now?: () => Date }} options
 * @returns {{ loadSettings(): Settings, saveSettings(settings: Settings): boolean,
 *   loadBestScores(): BestScores,
 *   recordBestIfBeaten(slotKey: string, run: { score: number, roundsCleared: number, goals: number }):
 *     { isNewBest: boolean, best: BestScore|null },
 *   resetAll(): number, readonly didLastWriteFail: boolean }}
 */
export function createStore({ storage, now = () => new Date() }) {
    let didLastWriteFail = false;

    /**
     * Records the result of a write.
     * @param {boolean} isOk @returns {boolean}
     */
    function noteWrite(isOk) {
        didLastWriteFail = !isOk;
        return isOk;
    }

    /**
     * Loads settings, filling defaults for anything missing or bad.
     * @returns {Settings}
     */
    function loadSettings() {
        return validateSettings(readJson(storage, SETTINGS_KEY));
    }

    /**
     * Saves settings after validating them.
     * @param {Settings} settings @returns {boolean} True when written.
     */
    function saveSettings(settings) {
        return noteWrite(writeJson(storage, SETTINGS_KEY, validateSettings(settings)));
    }

    /**
     * Loads all best-score slots, dropping bad ones.
     * @returns {BestScores}
     */
    function loadBestScores() {
        return validateBestScores(readJson(storage, BEST_SCORES_KEY));
    }

    /**
     * Writes a best score for the slot only when the run beats it (strictly, and > 0).
     * @param {string} slotKey - "<scheme>:<level>".
     * @param {{ score: number, roundsCleared: number, goals: number }} run
     * @returns {{ isNewBest: boolean, best: BestScore|null }} `best` is the slot's best afterwards.
     */
    function recordBestIfBeaten(slotKey, run) {
        const all = loadBestScores();
        const existing = all.scores[slotKey] || null;
        if (!isNewBest(run.score, existing)) return { isNewBest: false, best: existing };
        /** @type {BestScore} */
        const best = {
            score: run.score,
            rounds_cleared: run.roundsCleared,
            goals: run.goals,
            achieved_at: now().toISOString()
        };
        noteWrite(writeJson(storage, BEST_SCORES_KEY, withBestScore(all, slotKey, best)));
        return { isNewBest: true, best };
    }

    /**
     * Removes every key that starts with "breakaway.".
     * @returns {number} How many keys were removed.
     */
    function resetAll() {
        if (!storage) return 0;
        let removed = 0;
        try {
            const keys = [];
            for (let i = 0; i < storage.length; i += 1) {
                const key = storage.key(i);
                if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
            }
            for (const key of keys) {
                storage.removeItem(key);
                removed += 1;
            }
            didLastWriteFail = false;
        } catch {
            didLastWriteFail = true;
        }
        return removed;
    }

    return {
        loadSettings, saveSettings, loadBestScores, recordBestIfBeaten, resetAll,
        get didLastWriteFail() { return didLastWriteFail; }
    };
}

/**
 * Returns window.localStorage, or null when even reading the property throws.
 * @returns {Storage|null}
 */
export function getLocalStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}
