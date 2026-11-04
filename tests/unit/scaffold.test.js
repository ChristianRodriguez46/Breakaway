// Scaffold checks: constants load and are frozen, and src/core stays pure (docs/decisions.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as constants from '../../src/core/constants.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/core');

test('constants use real NHL rink geometry in feet', () => {
    assert.equal(constants.GOAL_LINE_Y_FT, 11);
    assert.equal(constants.BLUE_LINE_Y_FT, 75);
    assert.equal(constants.RINK_WIDTH_FT, 85);
    assert.equal(constants.RIGHT_POST.x - constants.LEFT_POST.x, constants.GOAL_MOUTH_FT);
});

test('shared constant objects are frozen', () => {
    assert.ok(Object.isFrozen(constants.TIER_PARAMS));
    assert.ok(Object.isFrozen(constants.TIER_PARAMS.rookie));
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS));
    assert.throws(() => { 'use strict'; constants.TIER_PARAMS.rookie.saveReachFt = 99; });
});

test('goalie tiers get harder from Rookie to All-Star', () => {
    const { rookie, pro, all_star: allStar } = constants.TIER_PARAMS;
    assert.ok(rookie.reactionDelayMs > pro.reactionDelayMs && pro.reactionDelayMs > allStar.reactionDelayMs);
    assert.ok(rookie.dekeReadChance < pro.dekeReadChance && pro.dekeReadChance < allStar.dekeReadChance);
});

test('core modules never touch the DOM, clocks or Math.random', () => {
    const forbidden = /\b(Math\.random|Date\.now|performance\.now|window\.|document\.|localStorage|requestAnimationFrame|setTimeout|setInterval)\b/;
    for (const file of readdirSync(CORE_DIR).filter((name) => name.endsWith('.js'))) {
        const code = readFileSync(join(CORE_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.doesNotMatch(code, forbidden, `${file} uses a forbidden global`);
    }
});
