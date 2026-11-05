// Sprite assets: when index.html turns sprites on, the manifest and PNGs it names must exist and be big enough.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpriteAssets } from '../helpers/sprite-assets.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = 'assets/sprites/sprites.json';
const SHEET_PX = { 'skater.png': [1024, 128], 'goalie.png': [960, 192], 'puck.png': [48, 48] };

/** A valid sprites.json, shaped like the Blender script's build_manifest() output. */
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

/** The PNG signature plus an IHDR chunk: all the header read looks at. */
function makePngHeader(width, height) {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    header.set([8, 6, 0, 0, 0], 24);
    return header;
}

/** Builds a temp project folder; `change` can alter the manifest, PNG sizes or index.html before it is written. */
function withProject(options, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-sprites-'));
    try {
        const attr = options.attr === undefined ? ` data-sprite-manifest="${MANIFEST_PATH}"` : options.attr;
        fs.writeFileSync(path.join(dir, 'index.html'),
            `<!-- <main id="main" data-sprite-manifest="old.json"> -->\n<main id="main" class="breakaway"${attr}></main>\n`);
        const folder = path.join(dir, 'assets', 'sprites');
        fs.mkdirSync(folder, { recursive: true });
        if (options.manifest !== null) {
            fs.writeFileSync(path.join(folder, 'sprites.json'), JSON.stringify(options.manifest || makeRawManifest()));
        }
        for (const [file, size] of Object.entries(SHEET_PX)) {
            if (options.skipPng === file) continue;
            const bytes = options.pngs?.[file] || makePngHeader(...(options.sizes?.[file] || size));
            fs.writeFileSync(path.join(folder, file), bytes);
        }
        return run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('the real project has working sprite assets whenever index.html turns sprites on', (t) => {
    const result = checkSpriteAssets(REPO_ROOT);
    if (!result.isOn) t.diagnostic('Sprites are off: index.html has no data-sprite-manifest, so there are no assets to check.');
    assert.deepEqual(result.problems, []);
});

test('a complete, correctly sized set of sprite files passes', () => {
    withProject({}, (dir) => {
        const result = checkSpriteAssets(dir);
        assert.equal(result.isOn, true);
        assert.equal(result.manifestPath, MANIFEST_PATH);
        assert.deepEqual(result.problems, []);
    });
});

test('with no data-sprite-manifest attribute, sprites are off and nothing is checked', () => {
    withProject({ attr: '', manifest: null }, (dir) => {
        assert.deepEqual(checkSpriteAssets(dir), { isOn: false, problems: [] });
    });
});

test('a missing manifest, a broken manifest and a manifest that fails validation are each reported', () => {
    withProject({ manifest: null }, (dir) => {
        const result = checkSpriteAssets(dir);
        assert.equal(result.isOn, true);
        assert.match(result.problems.join('\n'), /sprites\.json.*does not exist/);
    });
    withProject({}, (dir) => {
        fs.writeFileSync(path.join(dir, MANIFEST_PATH), '{ not json');
        assert.match(checkSpriteAssets(dir).problems.join('\n'), /sprites\.json is not valid JSON/);
    });
    const invalid = makeRawManifest();
    delete invalid.sheets.puck;
    withProject({ manifest: invalid }, (dir) => {
        assert.match(checkSpriteAssets(dir).problems.join('\n'), /sprites\.json does not pass the sprite manifest rules/);
    });
});

test('a missing PNG, a too-small PNG and a file that is not a PNG are each reported by name', () => {
    withProject({ skipPng: 'puck.png' }, (dir) => {
        assert.match(checkSpriteAssets(dir).problems.join('\n'), /puck\.png.*does not exist/);
    });
    withProject({ sizes: { 'goalie.png': [959, 192], 'skater.png': [1024, 127] } }, (dir) => {
        const problems = checkSpriteAssets(dir).problems;
        assert.equal(problems.length, 2);
        assert.match(problems.join('\n'), /goalie\.png.*too small.*959x192.*960x192/);
        assert.match(problems.join('\n'), /skater\.png.*too small.*1024x127.*1024x128/);
    });
    withProject({ pngs: { 'skater.png': Buffer.from('this is plain text, not an image at all') } }, (dir) => {
        const problems = checkSpriteAssets(dir).problems;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /skater\.png.*not a PNG/);
    });
});

test('a manifest path that is a web address, starts with a slash or escapes the folder is refused', () => {
    for (const bad of ['/assets/sprites/sprites.json', 'https://example.com/sprites.json', '../outside/sprites.json', 'assets/../../sprites.json']) {
        withProject({ attr: ` data-sprite-manifest='${bad}'` }, (dir) => {
            const result = checkSpriteAssets(dir);
            assert.equal(result.isOn, true, bad);
            assert.equal(result.problems.length, 1, bad);
            assert.match(result.problems[0], /data-sprite-manifest/, bad);
        });
    }
});
