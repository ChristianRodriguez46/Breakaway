// Unit tests for src/core/ui-strings.js (AC-6 banners, AC-14 visual equivalents, AC-15 announcements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../../src/core/ui-strings.js';
import { getTierForRound } from '../../src/core/difficulty.js';

const OUTCOMES = ['goal', 'save', 'wide', 'post_out', 'poke', 'time'];
const round = (overrides = {}) => ({
    number: 2, attemptOutcomes: ['goal', 'save', 'goal', 'goal', 'goal'], goals: 4, points: 400,
    tier: getTierForRound('ladder', 2), ...overrides
});

test('each of the six outcomes has a distinct banner and announcement with no raw ids or symbols', () => {
    const banners = OUTCOMES.map((o) => ui.getBannerText(o).title);
    const lines = OUTCOMES.map((o) => ui.getOutcomeAnnouncement(o, round(), 0, 0));
    assert.equal(new Set(banners).size, 6);
    assert.equal(new Set(lines).size, 6);
    for (const text of [...banners, ...lines]) {
        assert.ok(text.length > 0);
        assert.doesNotMatch(text, /_|undefined|NaN|\{|\}/);
    }
});

test('banner copy matches UX_COPY section 6', () => {
    assert.deepEqual(ui.getBannerText('goal'), { title: 'Goal!', detail: '+100' });
    assert.deepEqual(ui.getBannerText('goal', { hasDekeBonus: true }), { title: 'Goal!', detail: '+150 with deke bonus' });
    assert.deepEqual(ui.getBannerText('save'), { title: 'Save', detail: 'The goalie stops it.' });
    assert.deepEqual(ui.getBannerText('wide'), { title: 'Wide', detail: 'Missed the net.' });
    assert.deepEqual(ui.getBannerText('post_out'), { title: 'Post and out', detail: 'So close.' });
    assert.deepEqual(ui.getBannerText('poke'), { title: 'Poke check', detail: 'The goalie took the puck.' });
    assert.deepEqual(ui.getBannerText('time'), { title: 'Time', detail: 'The shot clock ran out.' });
    assert.deepEqual(ui.getBannerText('save', { isReboundExpired: true }), { title: 'Save', detail: 'No rebound shot in time.' });
    assert.deepEqual(ui.getReboundBannerText(), { title: 'Rebound', detail: 'Shoot again, 1.5 seconds.' });
});

test('"No shot" only for wide + isShortOfNet (Q6)', () => {
    assert.deepEqual(ui.getBannerText('wide', { isShortOfNet: true }), { title: 'No shot', detail: 'The puck stopped before the net.' });
    assert.equal(ui.getBannerText('save', { isShortOfNet: true }).title, 'Save');
    assert.equal(ui.getBannerText('post_out', { isShortOfNet: true }).title, 'Post and out');
});

test('announcements match UX_COPY section 10', () => {
    assert.equal(ui.getOutcomeAnnouncement('goal', round(), 1, 1, { points: 100, runScore: 150 }), 'Goal. Plus 100. Score 150.');
    assert.equal(ui.getOutcomeAnnouncement('goal', round(), 1, 1, { points: 150, runScore: 1300 }), 'Goal with deke bonus. Plus 150. Score 1,300.');
    assert.equal(ui.getOutcomeAnnouncement('save', round(), 0, 0), 'Save. No goal.');
    assert.equal(ui.getOutcomeAnnouncement('poke', round(), 0, 0), 'Poke check. The goalie took the puck. No goal.');
    assert.equal(ui.getOutcomeAnnouncement('time', round(), 0, 0), 'Time. The shot clock ran out. No goal.');
    assert.equal(ui.getAttemptStartAnnouncement(1), 'Attempt 2 of 5. 8 seconds.');
    assert.equal(ui.UX_STRINGS.announce.rebound, 'Rebound. Shoot again now.');
    assert.equal(ui.getRoundAnnouncement(round(), true, 'pro'), 'Round 2 cleared. 4 of 5. Next up, Pro goalie.');
    assert.equal(ui.getRoundAnnouncement(round({ number: 3, goals: 1 }), false, null), 'Round 3 failed. 1 of 5. Run over.');
    assert.equal(ui.getGameOverAnnouncement({ round: round(), runScore: 1250, roundsCleared: 2, runGoals: 9 }),
        'Final score 1,250. Rounds cleared 2. Goals 9.');
    assert.equal(ui.getNewBestAnnouncement(1250), 'New best: 1,250.');
});

test('round summary: cleared to a new tier, cleared with the same tier, failed, failed early', () => {
    assert.deepEqual(ui.getRoundSummaryText(round(), true, 'pro'),
        { title: 'Round 2 cleared', detail: '4 of 5. Next up: Pro goalie.', button: 'Start round 3' });
    const r1 = round({ number: 1, goals: 3, tier: getTierForRound('ladder', 1) });
    assert.deepEqual(ui.getRoundSummaryText(r1, true, 'rookie'),
        { title: 'Round 1 cleared', detail: '3 of 5. Same goalie, one more round.', button: 'Start round 2' });
    const failed = round({ number: 3, goals: 1, attemptOutcomes: ['goal', 'save', 'save', 'wide', 'time'] });
    assert.deepEqual(ui.getRoundSummaryText(failed, false, null),
        { title: 'Round 3 failed', detail: '1 of 5. You needed 3.', button: 'See results' });
    const early = round({ number: 3, goals: 0, attemptOutcomes: ['save', 'save', 'wide'] });
    assert.deepEqual(ui.getRoundSummaryText(early, false, null),
        { title: 'Round 3 over', detail: '0 of 3 so far with 2 left. 3 goals are out of reach.', button: 'See results' });
});

test('game over text and best lines', () => {
    const run = { round: round({ number: 3, goals: 1 }), runScore: 1250, roundsCleared: 2, runGoals: 9 };
    const text = ui.getGameOverText(run);
    assert.equal(text.title, 'Run over');
    assert.equal(text.detail, 'Round 3 failed. 1 of 5.');
    assert.deepEqual(text.rows.map((r) => r.value), ['1,250', '2', '9']);
    assert.equal(ui.getGameOverBestText(1250, null, true, 'hold_charge', 'ladder'), 'Your best for Hold to charge, Ladder.');
    const stored = { score: 1600, rounds_cleared: 3, goals: 12, achieved_at: '2026-10-01T00:00:00.000Z' };
    assert.equal(ui.getGameOverBestText(1250, stored, false, 'hold_charge', 'ladder'), 'Best 1,600. 350 to go.');
});

test('start best text: empty slot, and a saved best with its scheme and level', () => {
    assert.equal(ui.getStartBestText(null, 'hold_charge', 'ladder'), 'No best yet for this setup. Play a run to set one.');
    const stored = { score: 1250, rounds_cleared: 3, goals: 9, achieved_at: '2026-10-01T00:00:00.000Z' };
    const line = ui.getStartBestText(stored, 'aim_mouse', 'all_star');
    assert.match(line, /Aim with mouse, All-Star/);
    assert.match(line, /1,250/);
    assert.match(line, /round 4/);
});

test('formatShotClock: one decimal, never negative', () => {
    assert.equal(ui.formatShotClock(8), '8.0');
    assert.equal(ui.formatShotClock(6.4), '6.4');
    assert.equal(ui.formatShotClock(6.4 - 1e-12), '6.4');
    assert.equal(ui.formatShotClock(6.46), '6.4');
    assert.equal(ui.formatShotClock(0.04), '0.0');
    assert.equal(ui.formatShotClock(-3), '0.0');
    assert.equal(ui.formatShotClock(NaN), '0.0');
});

test('formatScore uses a thousands separator', () => {
    assert.equal(ui.formatScore(0), '0');
    assert.equal(ui.formatScore(1250), '1,250');
    assert.equal(ui.formatScore(1234567), '1,234,567');
});

test('scheme help: names and rows for each scheme; One button has no deke', () => {
    for (const scheme of ['hold_charge', 'aim_mouse', 'one_button']) {
        const help = ui.getSchemeHelp(scheme);
        assert.equal(help.name, ui.SCHEME_NAMES[scheme]);
        assert.deepEqual(help.rows.map((r) => r.action), ['Skate', 'Shoot', 'Deke', 'Pause', 'Sound on or off']);
    }
    assert.equal(ui.getSchemeHelp('one_button').rows[2].keys, 'Not in this scheme');
    assert.equal(ui.getSchemeHelp('aim_mouse').rows[2].keys, 'Shift or right-click');
});

test('canvas label at attempt start and after a result', () => {
    const state = { phase: 'playing', round: { ...round(), number: 2 }, attemptIndex: 2, lastOutcome: null };
    state.round.tier = getTierForRound('ladder', 2);
    assert.match(ui.getCanvasLabel(state), /Round 2, attempt 3 of 5\. .*The Rookie goalie is in the crease\. Shot clock 8 seconds\./);
    const after = { ...state, phase: 'result_banner', lastOutcome: 'save' };
    assert.match(ui.getCanvasLabel(after), /Save\. The skater is back at center ice for attempt 4\./);
    assert.match(ui.getCanvasLabel({ ...state, phase: 'start' }), /^Top-down view of a hockey rink/);
});

test('every sound event has a non-empty visual equivalent (AC-14)', () => {
    for (const key of ['stickhandle', 'shot', 'post', 'save', 'goal', 'poke']) {
        assert.ok(typeof ui.VISUAL_EQUIVALENTS[key] === 'string' && ui.VISUAL_EQUIVALENTS[key].length > 0, key);
    }
    assert.ok(Object.isFrozen(ui.VISUAL_EQUIVALENTS));
});

test('UX_STRINGS holds the fixed copy (spot checks) and is frozen', () => {
    assert.equal(ui.UX_STRINGS.page.title, 'Breakaway | Christian Rodriguez');
    assert.equal(ui.UX_STRINGS.settings.resetCancelButton, 'Keep my data');
    assert.equal(ui.UX_STRINGS.howTo.rules.length, 5);
    assert.ok(Object.isFrozen(ui.UX_STRINGS.start));
    assert.equal(ui.getPausedText(6.4), 'Shot clock stopped at 6.4 seconds.');
    assert.equal(ui.getPausedText(6.4, true), 'Paused because you left the game. Shot clock stopped at 6.4 seconds.');
    assert.equal(ui.getLeaveRunConfirmText('restart', 850), "Restart this run? Your score of 850 won't be saved.");
});
