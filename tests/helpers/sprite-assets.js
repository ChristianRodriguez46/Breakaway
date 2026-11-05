// Checks that the sprite switch in index.html points at a manifest and PNGs the game can actually load.
import fs from 'node:fs';
import path from 'node:path';
import { validateSpriteManifest } from '../../src/core/sprites.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Finds data-sprite-manifest on the element with id="main" (HTML comments are ignored).
 * @param {string} html
 * @returns {string|null} the attribute value, or null when it is absent
 */
function findManifestAttribute(html) {
    const visible = html.replace(/<!--[\s\S]*?-->/g, '');
    const tags = visible.match(/<[a-zA-Z][^>]*>/g) || [];
    const attrPattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (const tag of tags) {
        const attrs = {};
        const inner = tag.slice(1).replace(/^[^\s>\/]+/, '');
        for (const match of inner.matchAll(attrPattern)) {
            attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
        }
        if (attrs.id === 'main' && 'data-sprite-manifest' in attrs) return attrs['data-sprite-manifest'];
    }
    return null;
}

/**
 * Checks one PNG header against the size its sheet needs.
 * @param {string} filePath
 * @param {string} label name used in messages
 * @param {{ columns: number, rows: number, cellSizePx: number }} sheet
 * @param {string[]} problems
 */
function checkPng(filePath, label, sheet, problems) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        problems.push(`${label} is named by the manifest but the file does not exist.`);
        return;
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        problems.push(`${label} is not a PNG image (it does not start with the PNG signature).`);
        return;
    }
    if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') {
        problems.push(`${label} is damaged: the first PNG chunk is not the IHDR header.`);
        return;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const needW = sheet.columns * sheet.cellSizePx;
    const needH = sheet.rows * sheet.cellSizePx;
    if (width < needW || height < needH) {
        problems.push(`${label} is too small: it is ${width}x${height} px but the manifest needs at least ${needW}x${needH} px `
            + `(${sheet.columns} columns x ${sheet.rows} rows of ${sheet.cellSizePx} px cells).`);
    }
}

/**
 * Checks the sprite switch in rootDir/index.html and, when it is on, the manifest and sheet PNGs it points to.
 * @param {string} rootDir folder holding index.html
 * @returns {{ isOn: boolean, manifestPath?: string, problems: string[] }}
 */
export function checkSpriteAssets(rootDir) {
    const problems = [];
    const indexPath = path.join(rootDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        return { isOn: false, problems: ['index.html does not exist in the folder being checked.'] };
    }
    const value = findManifestAttribute(fs.readFileSync(indexPath, 'utf8'));
    if (value === null) return { isOn: false, problems: [] };

    const result = { isOn: true, manifestPath: value, problems };
    const trimmed = value.trim();
    if (trimmed === '') {
        problems.push('data-sprite-manifest on the game root is empty.');
        return result;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/') || trimmed.includes('\\')) {
        problems.push(`data-sprite-manifest "${value}" must be a relative path inside the project (no web address, leading slash or backslash).`);
        return result;
    }
    const root = path.resolve(rootDir);
    const manifestFile = path.resolve(root, trimmed);
    if (path.relative(root, manifestFile).split(path.sep)[0] === '..') {
        problems.push(`data-sprite-manifest "${value}" leaves the project folder.`);
        return result;
    }
    if (!fs.existsSync(manifestFile) || !fs.statSync(manifestFile).isFile()) {
        problems.push(`${trimmed} is named by data-sprite-manifest but the file does not exist.`);
        return result;
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
        problems.push(`${trimmed} is not valid JSON (${error.message}).`);
        return result;
    }
    const manifest = validateSpriteManifest(raw);
    if (!manifest) {
        problems.push(`${trimmed} does not pass the sprite manifest rules in src/core/sprites.js.`);
        return result;
    }
    for (const name of ['skater', 'goalie', 'puck']) {
        const sheet = manifest[name];
        const pngPath = path.resolve(path.dirname(manifestFile), sheet.file);
        const rel = path.relative(path.dirname(manifestFile), pngPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            problems.push(`${sheet.file} (the ${name} sheet) must sit next to ${path.basename(manifestFile)}.`);
            continue;
        }
        checkPng(pngPath, `${sheet.file} (the ${name} sheet)`, sheet, problems);
    }
    return result;
}
