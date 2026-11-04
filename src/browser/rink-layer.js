/* =============================================================
   src/browser/rink-layer.js
   The static rink (ice, painted lines, crease, net, posts, boards
   and kick plate), drawn once to an offscreen canvas.

   Sections in this file
     1. Types and small drawing helpers
     2. drawRinkLayer: paints the rink in world feet
     3. createRinkLayer: offscreen canvas at a given size

   Coordinates: the caller sets a transform so 1 unit = 1 foot,
   with the origin at the rink's top-left corner (ARCHITECTURE §3).
   drawRinkLayer only draws in feet; it never reads the canvas size.

   Ported from the agreed mockup (.studio/design/mockup.html,
   drawRink), minus the players, which renderer.js draws per frame.

   Troubleshooting
   - The rink colors are wrong: tokens come from the --bk-* custom
     properties, read once by renderer.js. Change style.css section 1
     and resize the window so the layer is rebuilt.
   - Lines look blurry: the layer must be built at backing-store size
     (CSS size x devicePixelRatio), not CSS size.
   - The goal lamp never lights: the lamp is NOT part of this layer;
     renderer.js draws it every frame on top.
   ============================================================= */

import {
    RINK_WIDTH_FT, CORNER_RADIUS_FT, GOAL_LINE_Y_FT, BLUE_LINE_Y_FT, CENTER_LINE_Y_FT,
    CENTER_X_FT, GOAL_MOUTH_FT, NET_DEPTH_FT, CREASE_RADIUS_FT, FACEOFF_CIRCLE_RADIUS_FT,
    FACEOFF_DOT_OFFSET_X_FT, FACEOFF_DOT_Y_FT, POST_RADIUS_FT,
    VISIBLE_MIN_X_FT, VISIBLE_MAX_X_FT, VISIBLE_MIN_Y_FT, VISIBLE_MAX_Y_FT
} from '../core/constants.js';

/* ---------- 1. Types and small drawing helpers ---------- */

/**
 * Colors read once from the --bk-* tokens (style.css section 1).
 * @typedef {{ ice: string, red: string, blue: string, kick: string, arena: string,
 *   board: string, crease: string, puck: string, white: string, scratch: string,
 *   panel: string, line: string }} RinkTokens
 */

/** @typedef {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} Ctx2D */

/** Painted line width: 2 inches. */
const THIN_LINE_FT = 2 / 12;
/** Blue and red lines: 12 inches. */
const THICK_LINE_FT = 1;
/** Neutral-zone lip drawn past the center line (matches VISIBLE_MAX_Y_FT). */
const LIP_FT = VISIBLE_MAX_Y_FT - CENTER_LINE_Y_FT;
/** Net mesh: the arena color at 12% over the ice (mockup value). */
const NET_MESH_ALPHA = 0.12;

/**
 * Traces the open rink outline: left boards, top corners, end boards, right boards.
 * The bottom is open because the view stops just past center ice.
 * @param {Ctx2D} ctx
 * @returns {void}
 */
function traceBoards(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, CENTER_LINE_Y_FT + LIP_FT);
    ctx.lineTo(0, CORNER_RADIUS_FT);
    ctx.arc(CORNER_RADIUS_FT, CORNER_RADIUS_FT, CORNER_RADIUS_FT, Math.PI, 1.5 * Math.PI);
    ctx.lineTo(RINK_WIDTH_FT - CORNER_RADIUS_FT, 0);
    ctx.arc(RINK_WIDTH_FT - CORNER_RADIUS_FT, CORNER_RADIUS_FT, CORNER_RADIUS_FT, 1.5 * Math.PI, 2 * Math.PI);
    ctx.lineTo(RINK_WIDTH_FT, CENTER_LINE_Y_FT + LIP_FT);
}

/**
 * Draws a circle, filled and/or stroked.
 * @param {Ctx2D} ctx
 * @param {number} xFt @param {number} yFt @param {number} radiusFt
 * @param {string|null} fill @param {string|null} [stroke] @param {number} [widthFt]
 * @returns {void}
 */
export function drawCircle(ctx, xFt, yFt, radiusFt, fill, stroke = null, widthFt = 0.2) {
    ctx.beginPath();
    ctx.arc(xFt, yFt, radiusFt, 0, 2 * Math.PI);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = widthFt; ctx.stroke(); }
}

/* ---------- 2. drawRinkLayer ---------- */

/**
 * Paints the static rink in world feet. The caller has already set a transform of
 * `pixelsPerFt` (times DPR) with the origin at the rink's top-left corner.
 * @param {Ctx2D} ctx
 * @param {number} pixelsPerFt - Used only to keep hairlines at least one device pixel wide.
 * @param {RinkTokens} tokens
 * @returns {void}
 */
export function drawRinkLayer(ctx, pixelsPerFt, tokens) {
    const minLineFt = pixelsPerFt > 0 ? 1 / pixelsPerFt : THIN_LINE_FT;
    const thin = Math.max(THIN_LINE_FT, minLineFt);
    const halfMouth = GOAL_MOUTH_FT / 2;

    // Arena around the ice
    ctx.fillStyle = tokens.arena;
    ctx.fillRect(VISIBLE_MIN_X_FT - 50, VISIBLE_MIN_Y_FT - 50,
        VISIBLE_MAX_X_FT - VISIBLE_MIN_X_FT + 100, VISIBLE_MAX_Y_FT - VISIBLE_MIN_Y_FT + 100);

    // Ice
    traceBoards(ctx);
    ctx.closePath();
    ctx.fillStyle = tokens.ice;
    ctx.fill();

    ctx.save();
    traceBoards(ctx);
    ctx.closePath();
    ctx.clip();

    // Goal line: only between the points where it meets the corner curves
    const cornerInset = CORNER_RADIUS_FT - GOAL_LINE_Y_FT;
    const goalLineStartX = CORNER_RADIUS_FT - Math.sqrt(CORNER_RADIUS_FT * CORNER_RADIUS_FT - cornerInset * cornerInset);
    ctx.fillStyle = tokens.red;
    ctx.fillRect(goalLineStartX, GOAL_LINE_Y_FT - thin / 2, RINK_WIDTH_FT - 2 * goalLineStartX, thin);
    ctx.fillStyle = tokens.blue;
    ctx.fillRect(0, BLUE_LINE_Y_FT - THICK_LINE_FT / 2, RINK_WIDTH_FT, THICK_LINE_FT);
    ctx.fillStyle = tokens.red;
    ctx.fillRect(0, CENTER_LINE_Y_FT - THICK_LINE_FT / 2, RINK_WIDTH_FT, THICK_LINE_FT);

    // Goalie trapezoid behind the net
    ctx.strokeStyle = tokens.red;
    ctx.lineWidth = thin;
    ctx.beginPath();
    ctx.moveTo(CENTER_X_FT - 11, GOAL_LINE_Y_FT); ctx.lineTo(CENTER_X_FT - 14, 0);
    ctx.moveTo(CENTER_X_FT + 11, GOAL_LINE_Y_FT); ctx.lineTo(CENTER_X_FT + 14, 0);
    ctx.stroke();

    // Faceoff circles, their dots, and the neutral-zone dots
    for (const sign of [-1, 1]) {
        const x = CENTER_X_FT + sign * FACEOFF_DOT_OFFSET_X_FT;
        drawCircle(ctx, x, FACEOFF_DOT_Y_FT, FACEOFF_CIRCLE_RADIUS_FT, null, tokens.red, thin);
        drawCircle(ctx, x, FACEOFF_DOT_Y_FT, 1, tokens.red);
        drawCircle(ctx, x, BLUE_LINE_Y_FT + 5, 1, tokens.red);
    }
    drawCircle(ctx, CENTER_X_FT, CENTER_LINE_Y_FT, FACEOFF_CIRCLE_RADIUS_FT, null, tokens.blue, thin);
    drawCircle(ctx, CENTER_X_FT, CENTER_LINE_Y_FT, 0.5, tokens.blue);

    // Crease
    ctx.beginPath();
    ctx.moveTo(CENTER_X_FT - CREASE_RADIUS_FT, GOAL_LINE_Y_FT);
    ctx.arc(CENTER_X_FT, GOAL_LINE_Y_FT, CREASE_RADIUS_FT, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = tokens.crease;
    ctx.fill();
    ctx.strokeStyle = tokens.red;
    ctx.lineWidth = thin;
    ctx.stroke();
    ctx.restore();

    // Boards and the yellow kick plate
    traceBoards(ctx);
    ctx.strokeStyle = tokens.board;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    traceBoards(ctx);
    ctx.strokeStyle = tokens.kick;
    ctx.lineWidth = 0.35;
    ctx.stroke();

    // Net (mesh tint, red frame) and posts
    const netTop = GOAL_LINE_Y_FT - NET_DEPTH_FT;
    ctx.strokeStyle = tokens.red;
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(CENTER_X_FT - halfMouth, GOAL_LINE_Y_FT);
    ctx.lineTo(CENTER_X_FT - halfMouth, GOAL_LINE_Y_FT - 2.3);
    ctx.quadraticCurveTo(CENTER_X_FT - halfMouth, netTop, CENTER_X_FT, netTop);
    ctx.quadraticCurveTo(CENTER_X_FT + halfMouth, netTop, CENTER_X_FT + halfMouth, GOAL_LINE_Y_FT - 2.3);
    ctx.lineTo(CENTER_X_FT + halfMouth, GOAL_LINE_Y_FT);
    ctx.fillStyle = tokens.arena;
    ctx.globalAlpha = NET_MESH_ALPHA;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    drawCircle(ctx, CENTER_X_FT - halfMouth, GOAL_LINE_Y_FT, POST_RADIUS_FT, tokens.red);
    drawCircle(ctx, CENTER_X_FT + halfMouth, GOAL_LINE_Y_FT, POST_RADIUS_FT, tokens.red);
}

/* ---------- 3. createRinkLayer ---------- */

/**
 * Builds the rink layer at backing-store size. `pixelsPerFt` already includes DPR.
 * The world box (VISIBLE_* constants) is centered in the layer.
 * @param {number} widthPx - Backing-store width in device pixels.
 * @param {number} heightPx - Backing-store height in device pixels.
 * @param {number} pixelsPerFt - Device pixels per foot.
 * @param {RinkTokens} tokens
 * @returns {CanvasImageSource} An OffscreenCanvas where supported, else a detached canvas.
 */
export function createRinkLayer(widthPx, heightPx, pixelsPerFt, tokens) {
    const width = Math.max(1, Math.round(widthPx));
    const height = Math.max(1, Math.round(heightPx));
    /** @type {OffscreenCanvas|HTMLCanvasElement} */
    let layer;
    if (typeof OffscreenCanvas === 'function') {
        layer = new OffscreenCanvas(width, height);
    } else {
        layer = document.createElement('canvas');
        layer.width = width;
        layer.height = height;
    }
    const ctx = /** @type {Ctx2D|null} */ (layer.getContext('2d'));
    if (!ctx) return layer;
    const { offsetX, offsetY } = getWorldOffset(width, height, pixelsPerFt);
    ctx.setTransform(pixelsPerFt, 0, 0, pixelsPerFt, offsetX, offsetY);
    drawRinkLayer(ctx, pixelsPerFt, tokens);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return layer;
}

/**
 * Pixel offset of world (0, 0) so the visible world box is centered in a surface.
 * Shared with renderer.js so the layer and the players line up exactly.
 * @param {number} widthPx @param {number} heightPx @param {number} pixelsPerFt
 * @returns {{ offsetX: number, offsetY: number }}
 */
export function getWorldOffset(widthPx, heightPx, pixelsPerFt) {
    const worldW = VISIBLE_MAX_X_FT - VISIBLE_MIN_X_FT;
    const worldH = VISIBLE_MAX_Y_FT - VISIBLE_MIN_Y_FT;
    return {
        offsetX: (widthPx - worldW * pixelsPerFt) / 2 - VISIBLE_MIN_X_FT * pixelsPerFt,
        offsetY: (heightPx - worldH * pixelsPerFt) / 2 - VISIBLE_MIN_Y_FT * pixelsPerFt
    };
}
