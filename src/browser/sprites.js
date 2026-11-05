/* =============================================================
   src/browser/sprites.js
   Loads the Blender sprite sheets: sprites.json, then its PNGs.

   How it fits: main.js calls loadSprites() after the game starts
   and hands the result to renderer.setSprites(). Until then, and
   whenever anything fails, the renderer keeps its vector drawing,
   so a missing or broken sheet never blanks the rink.

   Troubleshooting
   - Sprites never appear: open DevTools > Network and check that
     assets/sprites/sprites.json and the three PNGs load (200). Run
     tools/blender/make_sprites.py if they're missing.
   - They load but the game still draws circles: sprites.json failed
     validateSpriteManifest() (src/core/sprites.js), or a PNG is
     smaller than columns x cell_size_px.
   ============================================================= */

import { validateSpriteManifest } from '../core/sprites.js';

/** @typedef {import('../core/types.js').SpriteManifest} SpriteManifest */
/** @typedef {import('../core/types.js').SpriteSheet} SpriteSheet */
/**
 * @typedef {object} LoadedSprites
 * @property {SpriteManifest} manifest
 * @property {{ skater: HTMLImageElement, goalie: HTMLImageElement, puck: HTMLImageElement }} images
 */

/** @type {readonly ('skater'|'goalie'|'puck')[]} */
const SHEET_NAMES = Object.freeze(['skater', 'goalie', 'puck']);

/**
 * Fetches and parses JSON from the same site.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`sprites.json: HTTP ${response.status}`);
    return response.json();
}

/**
 * Loads one image.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${url}`));
        image.src = url;
    });
}

/**
 * True when the image holds the whole grid the manifest describes.
 * @param {HTMLImageElement} image @param {SpriteSheet} sheet
 * @returns {boolean}
 */
function isBigEnough(image, sheet) {
    return image.naturalWidth >= sheet.columns * sheet.cellSizePx &&
        image.naturalHeight >= sheet.rows * sheet.cellSizePx;
}

/**
 * Loads the manifest and every sheet it names. Never throws.
 * @param {{ manifestUrl: string,
 *   fetchJsonFn?: (url: string) => Promise<unknown>,
 *   loadImageFn?: (url: string) => Promise<HTMLImageElement> }} options
 * @returns {Promise<LoadedSprites|null>} null when anything is missing or wrong.
 */
export async function loadSprites({ manifestUrl, fetchJsonFn = fetchJson, loadImageFn = loadImage }) {
    try {
        const manifest = validateSpriteManifest(await fetchJsonFn(manifestUrl));
        if (!manifest) return null;
        const images = await Promise.all(
            SHEET_NAMES.map((name) => loadImageFn(new URL(manifest[name].file, manifestUrl).href))
        );
        if (!SHEET_NAMES.every((name, i) => isBigEnough(images[i], manifest[name]))) return null;
        return { manifest, images: { skater: images[0], goalie: images[1], puck: images[2] } };
    } catch {
        return null;
    }
}
