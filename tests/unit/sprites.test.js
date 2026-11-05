// Sprite sheet rules (src/core/sprites.js): checking sprites.json and choosing the cell to draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateSpriteManifest, getCellRect, getSkaterFrame, getGoaliePose, getGoalieFacingRad,
    getGoalieMirror, getGoalieSpriteScale, isSpritesParamOff
} from '../../src/core/sprites.js';
import { CENTER_X_FT, GOAL_LINE_Y_FT, SPRITE_GLIDE_BELOW_FT_PER_S } from '../../src/core/constants.js';

/** A valid sprites.json, shaped like the Blender script's output. */
function makeRawManifest() {
    return {
        schema_version: 1,
        sheets: {
            skater: {
                file: 'skater.png', cell_size_ft: 5, cell_size_px: 128, columns: 8, rows: 1,
                frame_count: 8, stride_length_ft: 7,
                hand_ft: Array.from({ length: 8 }, (_, i) => ({ x: 1.05, y: 0.7 + i * 0.01 }))
            },
            goalie: {
                file: 'goalie.png', cell_size_ft: 8, cell_size_px: 192, columns: 5, rows: 1, side_pose_y: 1,
                poses: {
                    stance: { index: 0, reach_ft: 1.8 }, butterfly: { index: 1, reach_ft: 2.3 },
                    poke: { index: 2, reach_ft: 1.8 }, lean: { index: 3, reach_ft: 1.8 }, dive: { index: 4, reach_ft: 3.6 }
                }
            },
            puck: { file: 'puck.png', cell_size_ft: 1.5, cell_size_px: 48, columns: 1, rows: 1 }
        }
    };
}

test('validateSpriteManifest accepts the Blender script\'s output and returns camelCase names', () => {
    const manifest = validateSpriteManifest(makeRawManifest());
    assert.ok(manifest);
    assert.equal(manifest.skater.cellSizePx, 128);
    assert.equal(manifest.skater.frameCount, 8);
    assert.deepEqual(manifest.skater.handFt[0], { x: 1.05, y: 0.7 });
    assert.deepEqual(manifest.goalie.poses.dive, { index: 4, reachFt: 3.6 });
    assert.equal(manifest.goalie.sidePoseY, 1);
    assert.equal(manifest.puck.file, 'puck.png');
});

test('validateSpriteManifest returns null for anything that isn\'t a manifest, without throwing', () => {
    for (const junk of [null, undefined, 42, 'sprites', [], {}, { schema_version: 2, sheets: {} }]) {
        assert.equal(validateSpriteManifest(junk), null);
    }
});

test('validateSpriteManifest rejects file names with folders, other file types or uppercase', () => {
    for (const file of ['../skater.png', 'sprites/skater.png', 'skater.svg', 'Skater.png', 'https://x.example/s.png', '']) {
        const raw = makeRawManifest();
        raw.sheets.skater.file = file;
        assert.equal(validateSpriteManifest(raw), null, file);
    }
});

test('validateSpriteManifest rejects out-of-range sizes, indexes and hand points', () => {
    /** @type {((raw: any) => void)[]} */
    const breakers = [
        (raw) => { raw.sheets.skater.cell_size_px = 4096; },
        (raw) => { raw.sheets.skater.cell_size_ft = 0; },
        (raw) => { raw.sheets.skater.columns = 0; },
        (raw) => { raw.sheets.skater.frame_count = 9; },
        (raw) => { raw.sheets.skater.hand_ft.pop(); },
        (raw) => { raw.sheets.skater.hand_ft[3] = { x: Number.NaN, y: 0 }; },
        (raw) => { raw.sheets.skater.stride_length_ft = -1; },
        (raw) => { raw.sheets.goalie.poses.dive.index = 5; },
        (raw) => { delete raw.sheets.goalie.poses.lean; },
        (raw) => { raw.sheets.goalie.poses.stance.reach_ft = 9; },
        (raw) => { raw.sheets.goalie.side_pose_y = 0; },
        (raw) => { delete raw.sheets.puck; }
    ];
    breakers.forEach((breakIt, i) => {
        const raw = makeRawManifest();
        breakIt(raw);
        assert.equal(validateSpriteManifest(raw), null, `breaker ${i}`);
    });
});

test('getCellRect walks the grid left to right, then down', () => {
    const sheet = { file: 'a.png', cellSizeFt: 5, cellSizePx: 128, columns: 4, rows: 2 };
    assert.deepEqual(getCellRect(sheet, 0), { sx: 0, sy: 0, size: 128 });
    assert.deepEqual(getCellRect(sheet, 3), { sx: 384, sy: 0, size: 128 });
    assert.deepEqual(getCellRect(sheet, 5), { sx: 128, sy: 128, size: 128 });
});

test('getSkaterFrame follows the distance skated and shows the glide frame when slow', () => {
    const sheet = /** @type {any} */ (validateSpriteManifest(makeRawManifest())).skater;
    const fast = SPRITE_GLIDE_BELOW_FT_PER_S + 10;
    assert.equal(getSkaterFrame(sheet, 0, fast), 0);
    assert.equal(getSkaterFrame(sheet, 7 / 8, fast), 1);
    assert.equal(getSkaterFrame(sheet, 7 * 0.99, fast), 7);
    assert.equal(getSkaterFrame(sheet, 7 * 3 + 7 / 2, fast), 4, 'wraps every stride');
    assert.equal(getSkaterFrame(sheet, 3.5, SPRITE_GLIDE_BELOW_FT_PER_S - 0.1), 0, 'glide below the threshold');
    assert.equal(getSkaterFrame(sheet, Number.NaN, fast), 0);
    assert.equal(getSkaterFrame(sheet, 3.5, Number.NaN), 0);
});

test('getGoaliePose maps every goalie mode to a pose, with stance as the fallback', () => {
    assert.equal(getGoaliePose('set'), 'stance');
    assert.equal(getGoaliePose('tracking'), 'stance');
    assert.equal(getGoaliePose('reacting'), 'stance');
    assert.equal(getGoaliePose('diving'), 'dive');
    assert.equal(getGoaliePose('poking'), 'poke');
    assert.equal(getGoaliePose('bitten'), 'lean');
    assert.equal(getGoaliePose('recovering'), 'butterfly');
    assert.equal(getGoaliePose(/** @type {any} */ ('unknown')), 'stance');
});

test('getGoalieFacingRad points from the net toward the puck', () => {
    assert.equal(getGoalieFacingRad({ x: CENTER_X_FT, y: GOAL_LINE_Y_FT + 30 }), Math.PI / 2);
    assert.equal(getGoalieFacingRad({ x: CENTER_X_FT + 10, y: GOAL_LINE_Y_FT }), 0);
    assert.equal(getGoalieFacingRad({ x: CENTER_X_FT, y: GOAL_LINE_Y_FT }), Math.PI / 2, 'puck on the net center');
});

test('getGoalieMirror flips dives and leans to the side they go, and never flips other poses', () => {
    const straightOut = { x: CENTER_X_FT, y: GOAL_LINE_Y_FT + 30 };
    // Facing straight down the ice (canvas +y), the sprite's +y side is world -x.
    assert.equal(getGoalieMirror({ mode: 'bitten', diveSide: -1 }, straightOut, 1), 1, 'slide to -x: as drawn');
    assert.equal(getGoalieMirror({ mode: 'bitten', diveSide: 1 }, straightOut, 1), -1, 'slide to +x: mirrored');
    assert.equal(getGoalieMirror({ mode: 'diving', diveSide: 1 }, straightOut, 1), -1, 'pads reach toward +x');
    assert.equal(getGoalieMirror({ mode: 'diving', diveSide: -1 }, straightOut, 1), 1);
    assert.equal(getGoalieMirror({ mode: 'diving', diveSide: 1 }, straightOut, -1), 1, 'a sheet drawn the other way');
    assert.equal(getGoalieMirror({ mode: 'tracking', diveSide: 1 }, straightOut, 1), 1);
    assert.equal(getGoalieMirror({ mode: 'diving', diveSide: 0 }, straightOut, 1), 1);
});

test('getGoalieSpriteScale makes the drawn pads as wide as the vector goalie\'s', () => {
    const sheet = /** @type {any} */ (validateSpriteManifest(makeRawManifest())).goalie;
    assert.deepEqual(getGoalieSpriteScale(sheet, 'stance', 1.8, 1), { along: 1, across: 1 });
    const { along, across } = getGoalieSpriteScale(sheet, 'stance', 2.3, 1.69);
    assert.ok(Math.abs(across * 1.8 - 2.3 * Math.sqrt(1.69)) < 1e-9, 'pad half-width = reach × √spriteScale');
    assert.ok(along > Math.sqrt(1.69) && along < across, 'less stretch along the facing line');
});

test('isSpritesParamOff reads ?sprites=off only', () => {
    assert.equal(isSpritesParamOff('?sprites=off'), true);
    assert.equal(isSpritesParamOff('?seed=4&sprites=off'), true);
    assert.equal(isSpritesParamOff(''), false);
    assert.equal(isSpritesParamOff('?sprites=on'), false);
});
