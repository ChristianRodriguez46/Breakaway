// Unit tests for src/core/settings.js (AC-12: saved settings and best scores never break the game).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateSettings, validateBestScores, getBestScoreSlotKey, withBestScore
} from '../../src/core/settings.js';
import { DEFAULT_SETTINGS, CONTROL_SCHEMES, STARTING_LEVELS } from '../../src/core/constants.js';

const GOOD_BEST = Object.freeze({ score: 1250, rounds_cleared: 2, goals: 9, achieved_at: '2026-10-01T12:00:00.000Z' });

test('validateSettings returns the defaults for anything that is not an object, without throwing', () => {
    for (const raw of [undefined, null, 0, 42, 'hello', true, [], [1, 2], () => 1, NaN]) {
        assert.deepEqual(validateSettings(raw), { ...DEFAULT_SETTINGS }, `raw = ${String(raw)}`);
    }
});

test('validateSettings keeps every valid field', () => {
    const raw = { schema_version: 1, control_scheme: 'one_button', is_sound_on: false, motion_preference: 'reduce', starting_level: 'all_star' };
    assert.deepEqual(validateSettings(raw), raw);
});

test('validateSettings defaults each bad field on its own and keeps the good ones', () => {
    const result = validateSettings({
        schema_version: 99, control_scheme: 'joystick', is_sound_on: 'true', motion_preference: 'reduce', starting_level: 7
    });
    assert.deepEqual(result, {
        schema_version: 1,
        control_scheme: DEFAULT_SETTINGS.control_scheme,
        is_sound_on: DEFAULT_SETTINGS.is_sound_on,
        motion_preference: 'reduce',
        starting_level: DEFAULT_SETTINGS.starting_level
    });
});

test('validateSettings ignores extra fields and returns a new object', () => {
    const raw = { control_scheme: 'aim_mouse', evil: '<script>' };
    const result = validateSettings(raw);
    assert.equal('evil' in result, false);
    assert.equal(result.control_scheme, 'aim_mouse');
    assert.notEqual(result, raw);
});

test('getBestScoreSlotKey builds "<scheme>:<level>", 9 distinct slots, Ladder is the Rookie slot', () => {
    assert.equal(getBestScoreSlotKey('hold_charge', 'ladder'), 'hold_charge:ladder');
    const keys = new Set(CONTROL_SCHEMES.flatMap((s) => STARTING_LEVELS.map((l) => getBestScoreSlotKey(s, l))));
    assert.equal(keys.size, 9);
});

test('validateBestScores returns an empty set for garbage, without throwing', () => {
    for (const raw of [undefined, null, 5, 'x', [], { scores: [] }, { scores: null }, { scores: 'x' }]) {
        assert.deepEqual(validateBestScores(raw), { schema_version: 1, scores: {} });
    }
});

test('validateBestScores keeps valid slots and drops bad ones one by one', () => {
    const raw = {
        schema_version: 1,
        scores: {
            'hold_charge:ladder': GOOD_BEST,
            'aim_mouse:pro': { ...GOOD_BEST, score: -5 },
            'one_button:all_star': { ...GOOD_BEST, goals: 2.5 },
            'one_button:pro': { ...GOOD_BEST, achieved_at: 'yesterday' },
            'one_button:ladder': { ...GOOD_BEST, achieved_at: '2026-13-45T99:99:99Z' },
            'aim_mouse:ladder': { ...GOOD_BEST, rounds_cleared: '2' },
            'aim_mouse:all_star': { ...GOOD_BEST, score: Infinity },
            'hold_charge:rookie': GOOD_BEST,
            'not a key': GOOD_BEST,
            'hold_charge:pro': null
        }
    };
    const result = validateBestScores(raw);
    assert.deepEqual(Object.keys(result.scores), ['hold_charge:ladder']);
    assert.deepEqual(result.scores['hold_charge:ladder'], GOOD_BEST);
});

test('validateBestScores accepts a score of 0 and drops extra fields inside a slot', () => {
    const result = validateBestScores({ scores: { 'hold_charge:pro': { ...GOOD_BEST, score: 0, extra: 1 } } });
    assert.deepEqual(result.scores['hold_charge:pro'], { ...GOOD_BEST, score: 0 });
});

test('withBestScore returns a new object and leaves the input unchanged', () => {
    const before = validateBestScores({ scores: { 'hold_charge:ladder': GOOD_BEST } });
    const snapshot = JSON.parse(JSON.stringify(before));
    const after = withBestScore(before, 'aim_mouse:pro', { ...GOOD_BEST, score: 300 });
    assert.deepEqual(before, snapshot);
    assert.notEqual(after, before);
    assert.equal(after.scores['aim_mouse:pro'].score, 300);
    assert.equal(after.scores['hold_charge:ladder'].score, 1250);
    assert.equal(after.schema_version, 1);
});

test('a hand-edited, impossibly large best score is dropped instead of saved', async () => {
    const { validateBestScores } = await import('../../src/core/settings.js');
    const result = validateBestScores({
        schema_version: 1,
        scores: { 'hold_charge:ladder': { score: 1e21, rounds_cleared: 1, goals: 3, achieved_at: '2026-01-02T03:04:05.000Z' } }
    });
    assert.equal(result.scores['hold_charge:ladder'], undefined);
});
