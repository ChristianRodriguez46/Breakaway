/* =============================================================
   src/core/sprites.js
   Rules for the Blender sprite sheets: checking sprites.json and
   choosing which cell to draw, at what angle and size.

   The sheets come from tools/blender/make_sprites.py. Nothing here
   loads an image (src/browser/sprites.js does) or draws (the
   renderer does), so every rule can be tested in Node.

   Sections in this file
     1. Small checks
     2. validateSpriteManifest: sprites.json in, a checked manifest or null out
     3. Choosing a cell: skater frame, goalie pose, side and size
     4. isSpritesParamOff: ?sprites=off

   Troubleshooting
   - The game still draws circles: sprites.json failed a check here
     (schema_version, a file name with a folder in it, an index past
     the end of a sheet, a hand point for every frame) or a PNG
     didn't load. Compare with ?sprites=off.
   - The legs move too fast or too slow for the skating speed:
     stride_length_ft in sprites.json (STRIDE_LENGTH_FT in the script).
   - The goalie dives the wrong way: side_pose_y must say which way
     the dive and lean poses point in the sheet (+1 is canvas +y).
   ============================================================= */

import {
    SPRITE_SCHEMA_VERSION, SPRITE_GLIDE_BELOW_FT_PER_S, SPRITE_CELL_PX_MAX, SPRITE_CELL_FT_MAX,
    SPRITE_GRID_MAX, GOALIE_SPRITE_POSES, CENTER_X_FT, GOAL_LINE_Y_FT
} from './constants.js';
import { vec, scale, dot } from './vector.js';
import { padsDirection } from './goalie.js';

/** @typedef {import('./types.js').Vec2} Vec2 */
/** @typedef {import('./types.js').GoalieMode} GoalieMode */
/** @typedef {import('./types.js').GoaliePose} GoaliePose */
/** @typedef {import('./types.js').SpriteSheet} SpriteSheet */
/** @typedef {import('./types.js').SkaterSheet} SkaterSheet */
/** @typedef {import('./types.js').GoalieSheet} GoalieSheet */
/** @typedef {import('./types.js').SpriteManifest} SpriteManifest */

/** File names only: no folders, no "..", no other file types. */
const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*\.png$/;
const STRIDE_LENGTH_FT_MAX = 100;

/** @type {Readonly<Record<GoalieMode, GoaliePose>>} */
const POSE_FOR_MODE = Object.freeze({
    set: 'stance',
    tracking: 'stance',
    reacting: 'stance',
    diving: 'dive',
    poking: 'poke',
    bitten: 'lean',
    recovering: 'butterfly'
});

/* ---------- 1. Small checks ---------- */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is number} */
function isIntegerIn(value, min, max) {
    return Number.isInteger(value) && /** @type {number} */ (value) >= min && /** @type {number} */ (value) <= max;
}

/** @param {unknown} value @param {number} max @returns {value is number} */
function isPositiveUpTo(value, max) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
}

/** @param {unknown} value @param {number} limit @returns {value is number} */
function isFiniteWithin(value, limit) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/* ---------- 2. validateSpriteManifest ---------- */

/**
 * The fields every sheet has.
 * @param {unknown} raw
 * @returns {SpriteSheet|null}
 */
function readSheet(raw) {
    if (!isRecord(raw)) return null;
    const { file, cell_size_ft: cellSizeFt, cell_size_px: cellSizePx, columns, rows } = raw;
    if (typeof file !== 'string' || !FILE_NAME_PATTERN.test(file)) return null;
    if (!isPositiveUpTo(cellSizeFt, SPRITE_CELL_FT_MAX) || !isIntegerIn(cellSizePx, 8, SPRITE_CELL_PX_MAX)) return null;
    if (!isIntegerIn(columns, 1, SPRITE_GRID_MAX) || !isIntegerIn(rows, 1, SPRITE_GRID_MAX)) return null;
    return { file, cellSizeFt, cellSizePx, columns, rows };
}

/**
 * @param {unknown} raw
 * @returns {SkaterSheet|null}
 */
function readSkaterSheet(raw) {
    const sheet = readSheet(raw);
    if (!sheet || !isRecord(raw)) return null;
    const { frame_count: frameCount, stride_length_ft: strideLengthFt, hand_ft: handFt } = raw;
    if (!isIntegerIn(frameCount, 1, sheet.columns * sheet.rows)) return null;
    if (!isPositiveUpTo(strideLengthFt, STRIDE_LENGTH_FT_MAX)) return null;
    if (!Array.isArray(handFt) || handFt.length !== frameCount) return null;
    const limit = sheet.cellSizeFt;
    const hands = handFt.map((point) => (isRecord(point) && isFiniteWithin(point.x, limit) && isFiniteWithin(point.y, limit)
        ? vec(point.x, point.y)
        : null));
    if (hands.includes(null)) return null;
    return { ...sheet, frameCount, strideLengthFt, handFt: /** @type {Vec2[]} */ (hands) };
}

/**
 * @param {unknown} raw
 * @returns {GoalieSheet|null}
 */
function readGoalieSheet(raw) {
    const sheet = readSheet(raw);
    if (!sheet || !isRecord(raw) || !isRecord(raw.poses)) return null;
    const sidePoseY = raw.side_pose_y;
    if (sidePoseY !== 1 && sidePoseY !== -1) return null;
    const cellCount = sheet.columns * sheet.rows;
    /** @type {Partial<Record<GoaliePose, { index: number, reachFt: number }>>} */
    const poses = {};
    for (const name of GOALIE_SPRITE_POSES) {
        const pose = raw.poses[name];
        if (!isRecord(pose) || !isIntegerIn(pose.index, 0, cellCount - 1)) return null;
        if (!isPositiveUpTo(pose.reach_ft, sheet.cellSizeFt)) return null;
        poses[/** @type {GoaliePose} */ (name)] = { index: pose.index, reachFt: pose.reach_ft };
    }
    return { ...sheet, sidePoseY, poses: /** @type {Record<GoaliePose, { index: number, reachFt: number }>} */ (poses) };
}

/**
 * Checks parsed sprites.json field by field. Never throws.
 * @param {unknown} raw - The parsed JSON (anything).
 * @returns {SpriteManifest|null} The manifest with camelCase names, or null if anything is wrong.
 */
export function validateSpriteManifest(raw) {
    if (!isRecord(raw) || raw.schema_version !== SPRITE_SCHEMA_VERSION || !isRecord(raw.sheets)) return null;
    const skater = readSkaterSheet(raw.sheets.skater);
    const goalie = readGoalieSheet(raw.sheets.goalie);
    const puck = readSheet(raw.sheets.puck);
    if (!skater || !goalie || !puck) return null;
    return { schemaVersion: SPRITE_SCHEMA_VERSION, skater, goalie, puck };
}

/* ---------- 3. Choosing a cell ---------- */

/**
 * Pixel rectangle of one cell in its sheet.
 * @param {SpriteSheet} sheet @param {number} index
 * @returns {{ sx: number, sy: number, size: number }}
 */
export function getCellRect(sheet, index) {
    const column = index % sheet.columns;
    const row = Math.floor(index / sheet.columns);
    return { sx: column * sheet.cellSizePx, sy: row * sheet.cellSizePx, size: sheet.cellSizePx };
}

/**
 * Stride frame from the distance skated, so the legs keep pace with the skater.
 * Slow or stopped skaters get frame 0, the glide pose.
 * @param {SkaterSheet} sheet
 * @param {number} distanceFt - Distance skated since the attempt started.
 * @param {number} speedFtPerS
 * @returns {number} 0 to frameCount - 1
 */
export function getSkaterFrame(sheet, distanceFt, speedFtPerS) {
    if (!(speedFtPerS >= SPRITE_GLIDE_BELOW_FT_PER_S) || !Number.isFinite(distanceFt)) return 0;
    const cycles = Math.abs(distanceFt) / sheet.strideLengthFt;
    const frame = Math.floor((cycles - Math.floor(cycles)) * sheet.frameCount);
    return Math.min(sheet.frameCount - 1, frame);
}

/**
 * @param {GoalieMode} mode
 * @returns {GoaliePose}
 */
export function getGoaliePose(mode) {
    return POSE_FOR_MODE[mode] ?? 'stance';
}

/**
 * Angle the goalie sprite is drawn at: facing out from the net toward the puck.
 * @param {Vec2} puckAt
 * @returns {number} Radians, canvas convention (0 = +x, positive turns toward +y).
 */
export function getGoalieFacingRad(puckAt) {
    const dx = puckAt.x - CENTER_X_FT;
    const dy = puckAt.y - GOAL_LINE_Y_FT;
    return dx === 0 && dy === 0 ? Math.PI / 2 : Math.atan2(dy, dx);
}

/**
 * Whether to mirror the goalie sprite across its facing line, so a dive points where the
 * physics capsule reaches and a lean points where the goalie slid.
 * @param {{ mode: GoalieMode, diveSide: -1|0|1 }} goalie
 * @param {Vec2} puckAt
 * @param {-1|1} sidePoseY - Which way the sheet's dive and lean poses point.
 * @returns {-1|1} 1 to draw as is, -1 to mirror.
 */
export function getGoalieMirror(goalie, puckAt, sidePoseY) {
    const pose = getGoaliePose(goalie.mode);
    if ((pose !== 'dive' && pose !== 'lean') || goalie.diveSide === 0) return 1;
    const toward = pose === 'dive' ? scale(padsDirection(puckAt), goalie.diveSide) : vec(goalie.diveSide, 0);
    const facingRad = getGoalieFacingRad(puckAt);
    const spriteY = vec(-Math.sin(facingRad), Math.cos(facingRad));
    const isAlongSpriteY = dot(toward, spriteY) >= 0;
    return /** @type {-1|1} */ ((isAlongSpriteY ? 1 : -1) * sidePoseY);
}

/**
 * Goalie drawing scale. Across the pads it matches the vector drawing (reach × √spriteScale),
 * so the drawn pads are the save wall; along the facing line it grows by the square root of
 * the same stretch, so a wide goalie doesn't look squashed.
 * @param {GoalieSheet} sheet @param {GoaliePose} pose
 * @param {number} reachFt - The goalie's current reach (grows during a dive).
 * @param {number} spriteScale - The renderer's small-screen enlargement (1 to 2).
 * @returns {{ along: number, across: number }}
 */
export function getGoalieSpriteScale(sheet, pose, reachFt, spriteScale) {
    const stretch = reachFt / sheet.poses[pose].reachFt;
    const base = Math.sqrt(spriteScale);
    return { along: base * Math.sqrt(stretch), across: base * stretch };
}

/* ---------- 4. isSpritesParamOff ---------- */

/**
 * True when the page URL asks for the vector drawing (?sprites=off).
 * @param {string} search - The `location.search` string (may be empty).
 * @returns {boolean}
 */
export function isSpritesParamOff(search) {
    return new URLSearchParams(search).get('sprites') === 'off';
}
