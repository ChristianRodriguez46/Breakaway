// Release packaging (scripts/package-release.mjs): naming, changelog notes, "latest", and a real zip
// built from a throwaway git repo. See docs/releases.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    parseVersionTag, getDownloadName, getReleaseTitle, extractChangelogSection, isNewestVersion,
    selectPlayPaths, sha256Line, packageRelease, PLAY_PATHS
} from '../../scripts/package-release.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-12-01

### Added
- Sprites.

## [1.0.0] - 2026-11-04

V1, vector.

### Added
- The game.

[Unreleased]: https://example.com/compare/v2.0.0...HEAD
[2.0.0]: https://example.com/releases/tag/v2.0.0
`;

/**
 * Entries in a zip, read from its central directory (no unzip tool needed).
 * @param {Buffer} zip
 * @returns {{ name: string, read: () => string }[]} `read()` unpacks that entry's text.
 */
function readZipEntries(zip) {
    const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(endOffset + 10);
    let offset = zip.readUInt32LE(endOffset + 16);
    const entries = [];
    for (let i = 0; i < count; i += 1) {
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
        const read = () => {
            const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
            const data = zip.subarray(dataStart, dataStart + compressedSize);
            return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
        };
        entries.push({ name, read });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

test('parseVersionTag reads v<major>.<minor>.<patch> and rejects anything else', () => {
    assert.deepEqual(parseVersionTag('v1.0.0'), { tag: 'v1.0.0', version: '1.0.0', major: 1, minor: 0, patch: 0 });
    assert.equal(parseVersionTag('v12.3.45').version, '12.3.45');
    for (const bad of ['1.0.0', 'v1.0', 'v1.0.0-beta', 'v01.0.0', 'v1.0.0; rm -rf /', '', 'main']) {
        assert.throws(() => parseVersionTag(bad), /isn't a version tag/, bad);
    }
});

test('getDownloadName joins the major version and the edition, and needs package.json to match the tag', () => {
    const v1 = parseVersionTag('v1.0.0');
    assert.equal(getDownloadName(v1, { version: '1.0.0', edition: 'vector' }), 'breakaway-v1-vector');
    assert.equal(getDownloadName(parseVersionTag('v1.0.3'), { version: '1.0.3', edition: 'vector' }), 'breakaway-v1-vector');
    assert.equal(getDownloadName(parseVersionTag('v3.0.0'), { version: '3.0.0', edition: 'three-d' }), 'breakaway-v3-three-d');
    assert.throws(() => getDownloadName(v1, { version: '0.1.0', edition: 'vector' }), /says version 0\.1\.0/);
    assert.throws(() => getDownloadName(v1, { version: '1.0.0' }), /needs an "edition"/);
    assert.throws(() => getDownloadName(v1, { version: '1.0.0', edition: 'Vector Art' }), /needs an "edition"/);
});

test('getReleaseTitle names the tag, the major version and the edition', () => {
    assert.equal(getReleaseTitle(parseVersionTag('v2.1.0'), 'sprites'), 'Breakaway v2.1.0 (V2, sprites)');
});

test('extractChangelogSection returns one version\'s notes and stops at the next version or the link list', () => {
    assert.equal(extractChangelogSection(CHANGELOG, '2.0.0'), '### Added\n- Sprites.');
    assert.equal(extractChangelogSection(CHANGELOG, '1.0.0'), 'V1, vector.\n\n### Added\n- The game.');
    assert.throws(() => extractChangelogSection(CHANGELOG, '9.9.9'), /no section for 9\.9\.9/);
    assert.throws(() => extractChangelogSection('## [1.0.0] - 2026-11-04\n\n## [0.9.0]\n- x', '1.0.0'), /is empty/);
});

test('isNewestVersion compares numbers, not text, and a fix to an older version is not the newest', () => {
    const tags = ['v1.0.0', 'v1.9.0', 'v1.10.0', 'v2.0.0', 'not-a-version'];
    assert.equal(isNewestVersion('v2.0.0', tags), true);
    assert.equal(isNewestVersion('v1.10.0', tags), false);
    assert.equal(isNewestVersion('v1.10.0', ['v1.9.0', 'v1.10.0']), true);
    assert.equal(isNewestVersion('v1.0.1', [...tags, 'v1.0.1']), false);
});

test('selectPlayPaths keeps the play files that exist, adds assets only when present, and needs the required ones', () => {
    const v1Files = new Set(['index.html', 'style.css', 'src', 'LICENSE', 'PLAY.md', 'tests', 'docs']);
    assert.deepEqual(selectPlayPaths((path) => v1Files.has(path)), ['index.html', 'style.css', 'src', 'LICENSE', 'PLAY.md']);
    const v2Files = new Set([...v1Files, 'assets']);
    assert.deepEqual(selectPlayPaths((path) => v2Files.has(path)), [...PLAY_PATHS]);
    assert.throws(() => selectPlayPaths((path) => path !== 'PLAY.md'), /missing PLAY\.md/);
});

test('sha256Line writes the "<hash>  <file>" line that sha256sum -c checks', () => {
    const line = sha256Line(Buffer.from('abc'), 'x.zip');
    assert.equal(line, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  x.zip\n');
});

test('packageRelease builds the zip from the tag: play files only, committed contents, checksum and notes', () => {
    const root = mkdtempSync(join(tmpdir(), 'breakaway-release-'));
    const repo = join(root, 'repo');
    const outDir = join(root, 'dist');
    const run = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
        '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: repo, stdio: 'pipe' });
    try {
        mkdirSync(join(repo, 'src', 'core'), { recursive: true });
        mkdirSync(join(repo, 'tests'));
        writeFileSync(join(repo, 'index.html'), '<!doctype html><title>Tagged</title>\n');
        writeFileSync(join(repo, 'style.css'), 'body { margin: 0; }\n');
        writeFileSync(join(repo, 'src', 'core', 'game.js'), 'export {};\n');
        writeFileSync(join(repo, 'LICENSE'), 'MIT\n');
        writeFileSync(join(repo, 'PLAY.md'), '# Playing this download\n');
        writeFileSync(join(repo, 'tests', 'game.test.js'), '// not for players\n');
        writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '1.0.0', edition: 'vector' }));
        writeFileSync(join(repo, 'CHANGELOG.md'), CHANGELOG);
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
        run('add', '-A');
        run('commit', '-q', '-m', 'Added the game');
        run('tag', '-a', 'v1.0.0', '-m', 'Breakaway V1, vector');
        writeFileSync(join(repo, 'index.html'), '<!doctype html><title>Not committed</title>\n');

        const result = packageRelease({ tag: 'v1.0.0', repoDir: repo, outDir });

        assert.equal(result.name, 'breakaway-v1-vector');
        assert.equal(result.title, 'Breakaway v1.0.0 (V1, vector)');
        assert.equal(result.isLatest, true);
        const zip = readFileSync(result.zipPath);
        const entries = readZipEntries(zip).filter((entry) => !entry.name.endsWith('/'));
        assert.deepEqual(entries.map((entry) => entry.name).sort(), [
            'breakaway-v1-vector/LICENSE', 'breakaway-v1-vector/PLAY.md', 'breakaway-v1-vector/index.html',
            'breakaway-v1-vector/src/core/game.js', 'breakaway-v1-vector/style.css'
        ]);
        const indexHtml = entries.find((entry) => entry.name === 'breakaway-v1-vector/index.html');
        assert.match(indexHtml?.read() ?? '', /<title>Tagged<\/title>/, 'the zip holds the tagged index.html, not the edited one');
        const hash = createHash('sha256').update(zip).digest('hex');
        assert.equal(readFileSync(result.checksumPath, 'utf8'), `${hash}  breakaway-v1-vector.zip\n`);
        assert.equal(readFileSync(result.notesPath, 'utf8'), 'V1, vector.\n\n### Added\n- The game.\n');

        assert.throws(() => packageRelease({ tag: 'v1.0.1', repoDir: repo, outDir }), /doesn't exist here/);
        run('tag', '-a', 'v2.0.0', '-m', 'wrong version in package.json');
        assert.throws(() => packageRelease({ tag: 'v2.0.0', repoDir: repo, outDir }), /says version 1\.0\.0/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
