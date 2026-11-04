/* =============================================================
   src/browser/renderer.js
   Draws one frame of the game on the rink canvas.

   Sections in this file
     1. Tokens and sizing helpers
     2. createRenderer: resize, draw, worldFromClient, destroy
     3. Per-frame drawing: scratches, goalie, puck, skater, aim,
        charge meter, goal lamp

   How it fits: main.js builds one renderer; loop.js calls
   draw(state, alpha) once per animation frame. `alpha` (0..1) is how
   far we are between the previous fixed step and the current one,
   so positions are blended for smooth motion at any refresh rate
   (ARCHITECTURE §4, §9). The static rink is a pre-drawn layer
   (rink-layer.js) blitted first each frame.

   Extra methods beyond CONTRACTS §4 (additive, used by main.js):
     showGoalLamp(), setAimPoint(point), getPixelsPerFt().

   Troubleshooting
   - Blurry rink on a phone: devicePixelRatio is capped at DPR_MAX
     (3); the backing store is CSS size x DPR.
   - Clicks land in the wrong place (aim scheme): worldFromClient
     uses getBoundingClientRect, so a CSS transform on the canvas
     or its parents will throw it off.
   - The lamp flashes with Reduce motion on: getMotion() must
     return 'reduce'; main.js resolves the setting.
   ============================================================= */

import {
    DPR_MAX, SCRATCH_MAX, GOAL_LIGHT_S, CHARGE_FULL_S, CENTER_X_FT, GOAL_LINE_Y_FT,
    VISIBLE_MIN_X_FT, VISIBLE_MAX_X_FT, VISIBLE_MIN_Y_FT, VISIBLE_MAX_Y_FT,
    SKATER_RADIUS_FT, PUCK_COLLISION_RADIUS_FT, GOALIE_BODY_RADIUS_FT
} from '../core/constants.js';
import { createRinkLayer, getWorldOffset, drawCircle } from './rink-layer.js';

/** @typedef {import('../core/types.js').GameState} GameState */
/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('./rink-layer.js').RinkTokens} RinkTokens */

/* ---------- 1. Tokens and sizing helpers ---------- */

const WORLD_W_FT = VISIBLE_MAX_X_FT - VISIBLE_MIN_X_FT;
const WORLD_H_FT = VISIBLE_MAX_Y_FT - VISIBLE_MIN_Y_FT;
/** Lamp housing above the end boards, in feet (mockup). */
const LAMP = { x: CENTER_X_FT - 2.5, y: -5, w: 5, h: 2.5 };
/** Half a flash, in seconds (2 flashes per second, DESIGN_PLAN §5). */
const FLASH_HALF_S = 0.25;
/** Minimum skater travel before a new skate mark is laid down. */
const SCRATCH_STEP_FT = 1.2;
/** A jump longer than this between frames is a new attempt, not skating. */
const SCRATCH_RESET_FT = 10;
/** Goalie pad half-length when the tier reach is not known yet. */
const DEFAULT_REACH_FT = 1.7;
const LAMP_OFF_COLOR = '#3a3f46'; // dark housing, same as the mockup; not UI text
/** Smallest on-screen skater radius (CSS px); players and puck are drawn larger on small screens. */
const MIN_SKATER_RADIUS_PX = 10;
/** Largest drawing enlargement, so players never crowd the net on tiny screens. */
const SPRITE_SCALE_MAX = 2;

/**
 * Reads the rink colors from the --bk-* custom properties on an element.
 * @param {Element} element - Usually the .breakaway root.
 * @returns {RinkTokens}
 */
export function readRinkTokens(element) {
    const style = getComputedStyle(element);
    /** @param {string} name @param {string} fallback @returns {string} */
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
        ice: read('--bk-ice', '#eef3f6'),
        red: read('--bk-red', '#c8102e'),
        blue: read('--bk-blue', '#0b3d91'),
        kick: read('--bk-kick', '#f2c200'),
        arena: read('--bk-arena', '#11161d'),
        board: read('--bk-board', '#d9dfe4'),
        crease: read('--bk-crease', '#a9c7e8'),
        puck: read('--bk-puck', '#0a0c0f'),
        white: read('--bk-white', '#ffffff'),
        scratch: read('--bk-scratch', 'rgb(17 22 29 / 0.06)'),
        panel: read('--bk-panel', '#20252c'),
        line: read('--bk-line', '#42474d')
    };
}

/**
 * Blends two positions.
 * @param {Vec2} from @param {Vec2} to @param {number} t
 * @returns {{ x: number, y: number }}
 */
function blend(from, to, t) {
    if (!from) return { x: to.x, y: to.y };
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/* ---------- 2. createRenderer ---------- */

/**
 * Creates the canvas renderer.
 * @param {{ canvas: HTMLCanvasElement, container: HTMLElement, tokens: RinkTokens,
 *   getMotion: () => 'reduce'|'full', nowMs?: () => number }} options
 * @returns {{ resize(): void, draw(state: GameState|null, alpha: number): void,
 *   worldFromClient(clientX: number, clientY: number): Vec2, destroy(): void,
 *   showGoalLamp(): void, setAimPoint(point: Vec2|null): void, getPixelsPerFt(): number }}
 */
export function createRenderer({ canvas, container, tokens, getMotion, nowMs = () => performance.now() }) {
    const ctx = canvas.getContext('2d');
    let dpr = 1;
    let cssW = 0;
    let cssH = 0;
    let ppfCss = 1;
    let spriteScale = 1;
    /** @type {CanvasImageSource|null} */
    let rinkLayer = null;
    let lampUntilMs = 0;
    let lampStartMs = 0;
    /** @type {Vec2|null} */
    let aimPoint = null;
    /** @type {GameState|null} */
    let lastState = null;
    let lastAlpha = 1;

    // Skate marks: fixed ring buffer of segments [x1, y1, x2, y2], no allocation per frame.
    const scratches = new Float32Array(SCRATCH_MAX * 4);
    let scratchCount = 0;
    let scratchHead = 0;
    let lastMarkX = NaN;
    let lastMarkY = NaN;

    /**
     * Matches the backing store to the canvas's CSS size and rebuilds the rink layer.
     * @returns {void}
     */
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const nextW = Math.max(1, Math.round(rect.width));
        const nextH = Math.max(1, Math.round(rect.height));
        const nextDpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
        if (nextW === cssW && nextH === cssH && nextDpr === dpr && rinkLayer) return;
        cssW = nextW;
        cssH = nextH;
        dpr = nextDpr;
        ppfCss = Math.min(cssW / WORLD_W_FT, cssH / WORLD_H_FT);
        // Drawing only: physics sizes stay the same (docs/decisions.md keeps markings true, players readable).
        spriteScale = Math.min(SPRITE_SCALE_MAX, Math.max(1, MIN_SKATER_RADIUS_PX / (SKATER_RADIUS_FT * ppfCss)));
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        rinkLayer = createRinkLayer(canvas.width, canvas.height, ppfCss * dpr, tokens);
        draw(lastState, lastAlpha);
    }

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
    if (observer) {
        observer.observe(container);
        observer.observe(canvas);
    }
    window.addEventListener('resize', resize);

    /**
     * Converts a pointer position to world feet.
     * @param {number} clientX @param {number} clientY
     * @returns {Vec2}
     */
    function worldFromClient(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const { offsetX, offsetY } = getWorldOffset(rect.width, rect.height, ppfCss);
        return {
            x: (clientX - rect.left - offsetX) / ppfCss,
            y: (clientY - rect.top - offsetY) / ppfCss
        };
    }

    /**
     * Turns the goal lamp on for GOAL_LIGHT_S.
     * @returns {void}
     */
    function showGoalLamp() {
        lampStartMs = nowMs();
        lampUntilMs = lampStartMs + GOAL_LIGHT_S * 1000;
    }

    /**
     * Sets (or clears) the aim target drawn in the aim scheme.
     * @param {Vec2|null} point - World feet.
     * @returns {void}
     */
    function setAimPoint(point) {
        aimPoint = point;
    }

    /**
     * Records a skate mark when the skater has moved far enough.
     * @param {Vec2} at
     * @returns {void}
     */
    function trackScratch(at) {
        if (Number.isNaN(lastMarkX)) { lastMarkX = at.x; lastMarkY = at.y; return; }
        const dx = at.x - lastMarkX;
        const dy = at.y - lastMarkY;
        const distance = Math.hypot(dx, dy);
        if (distance > SCRATCH_RESET_FT) {
            scratchCount = 0;
            scratchHead = 0;
            lastMarkX = at.x;
            lastMarkY = at.y;
            return;
        }
        if (distance < SCRATCH_STEP_FT) return;
        const i = scratchHead * 4;
        scratches[i] = lastMarkX;
        scratches[i + 1] = lastMarkY;
        scratches[i + 2] = at.x;
        scratches[i + 3] = at.y;
        scratchHead = (scratchHead + 1) % SCRATCH_MAX;
        scratchCount = Math.min(scratchCount + 1, SCRATCH_MAX);
        lastMarkX = at.x;
        lastMarkY = at.y;
    }

    /**
     * Draws one frame. With no state (menus before the first run) it draws the empty rink.
     * @param {GameState|null} state
     * @param {number} alpha - 0..1 blend between previous and current step.
     * @returns {void}
     */
    function draw(state, alpha) {
        lastState = state;
        lastAlpha = alpha;
        if (!ctx || !rinkLayer) return;
        const t = Math.min(1, Math.max(0, alpha));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(rinkLayer, 0, 0);
        const ppf = ppfCss * dpr;
        const { offsetX, offsetY } = getWorldOffset(canvas.width, canvas.height, ppf);
        ctx.setTransform(ppf, 0, 0, ppf, offsetX, offsetY);

        drawLamp(ctx);
        if (state && state.skater && state.puck && state.goalie) {
            const skaterAt = blend(state.skater.previousPosition, state.skater.position, t);
            const puckAt = blend(state.puck.previousPosition, state.puck.position, t);
            const goalieAt = blend(state.goalie.previousPosition, state.goalie.position, t);
            trackScratch(skaterAt);
            drawScratches(ctx);
            drawGoalie(ctx, goalieAt, puckAt, state.goalie.reachFt);
            drawSkater(ctx, skaterAt, state.skater.facingRad, state.skater.hasPuck, puckAt);
            // Puck on top: with the larger drawn players on phones, a carried puck would hide under the skater.
            drawPuck(ctx, puckAt, state.puck.mode);
            if (state.scheme === 'aim_mouse' && aimPoint && state.skater.hasPuck) drawAim(ctx, puckAt, aimPoint);
            if (state.scheme === 'hold_charge' && state.skater.isCharging) {
                drawCharge(ctx, skaterAt, Math.min(1, state.skater.chargeHeldS / CHARGE_FULL_S));
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ---------- 3. Per-frame drawing ---------- */

    /**
     * Goal lamp: dark housing, or red with a glow. Full motion blinks at 2/s; reduced holds steady.
     * @param {CanvasRenderingContext2D} c
     * @returns {void}
     */
    function drawLamp(c) {
        const now = nowMs();
        const isLit = now < lampUntilMs;
        let isBright = isLit;
        if (isLit && getMotion() !== 'reduce') {
            const halfIndex = Math.floor((now - lampStartMs) / (FLASH_HALF_S * 1000));
            isBright = halfIndex % 2 === 0 || halfIndex >= 6;
        }
        if (isLit) {
            const glow = c.createRadialGradient(CENTER_X_FT, 2, 1, CENTER_X_FT, 2, 16);
            glow.addColorStop(0, isBright ? 'rgb(200 16 46 / 0.35)' : 'rgb(200 16 46 / 0.15)');
            glow.addColorStop(1, 'rgb(200 16 46 / 0)');
            c.fillStyle = glow;
            c.fillRect(CENTER_X_FT - 18, 0, 36, 20);
            c.shadowColor = tokens.red;
            c.shadowBlur = isBright ? 40 * dpr : 12 * dpr;
        }
        c.fillStyle = isLit ? tokens.red : LAMP_OFF_COLOR;
        c.fillRect(LAMP.x, LAMP.y, LAMP.w, LAMP.h);
        c.shadowBlur = 0;
    }

    /**
     * Faint skate marks from the ring buffer.
     * @param {CanvasRenderingContext2D} c
     * @returns {void}
     */
    function drawScratches(c) {
        if (scratchCount === 0) return;
        c.strokeStyle = tokens.scratch;
        c.lineWidth = 0.3 * spriteScale;
        c.lineCap = 'round';
        c.beginPath();
        for (let n = 0; n < scratchCount; n += 1) {
            const i = n * 4;
            c.moveTo(scratches[i], scratches[i + 1]);
            c.lineTo(scratches[i + 2], scratches[i + 3]);
        }
        c.stroke();
    }

    /**
     * Goalie: pads as a capsule across the puck line, helmet on top.
     * @param {CanvasRenderingContext2D} c
     * @param {Vec2} at @param {Vec2} puckAt @param {number} reachFt
     * @returns {void}
     */
    function drawGoalie(c, at, puckAt, reachFt) {
        let dx = puckAt.x - CENTER_X_FT;
        let dy = puckAt.y - GOAL_LINE_Y_FT;
        const length = Math.hypot(dx, dy) || 1;
        dx /= length;
        dy /= length;
        const half = (Number.isFinite(reachFt) && reachFt > 0 ? reachFt : DEFAULT_REACH_FT) * Math.sqrt(spriteScale);
        const px = -dy * half;
        const py = dx * half;
        c.lineCap = 'round';
        c.strokeStyle = tokens.arena;
        c.lineWidth = GOALIE_BODY_RADIUS_FT * 2 * spriteScale;
        c.beginPath();
        c.moveTo(at.x - px, at.y - py);
        c.lineTo(at.x + px, at.y + py);
        c.stroke();
        c.strokeStyle = tokens.ice;
        c.lineWidth = 0.25;
        c.stroke();
        drawCircle(c, at.x, at.y - 0.2, 0.75 * spriteScale, tokens.red, tokens.arena, 0.15);
    }

    /**
     * Puck with a small shadow. Hidden only when the goalie has absorbed it (covered up).
     * @param {CanvasRenderingContext2D} c
     * @param {Vec2} at @param {string} mode
     * @returns {void}
     */
    function drawPuck(c, at, mode) {
        if (mode === 'absorbed') return;
        const radiusFt = PUCK_COLLISION_RADIUS_FT * spriteScale;
        drawCircle(c, at.x + 0.12, at.y + 0.12, radiusFt, 'rgb(17 22 29 / 0.18)');
        drawCircle(c, at.x, at.y, radiusFt, tokens.puck);
    }

    /**
     * Skater: jersey circle, helmet, stick toward the puck (or forward when shooting).
     * @param {CanvasRenderingContext2D} c
     * @param {Vec2} at @param {number} facingRad @param {boolean} hasPuck @param {Vec2} puckAt
     * @returns {void}
     */
    function drawSkater(c, at, facingRad, hasPuck, puckAt) {
        const fx = Math.cos(facingRad);
        const fy = Math.sin(facingRad);
        const handX = at.x + fx * 0.6 - fy * 0.8;
        const handY = at.y + fy * 0.6 + fx * 0.8;
        c.strokeStyle = tokens.arena;
        c.lineWidth = 0.3 * spriteScale;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(handX, handY);
        if (hasPuck) c.lineTo(puckAt.x - fx * 0.4, puckAt.y - fy * 0.4);
        else c.lineTo(at.x + fx * 2.2 - fy * 0.9, at.y + fy * 2.2 + fx * 0.9);
        c.stroke();
        drawCircle(c, at.x, at.y, SKATER_RADIUS_FT * spriteScale, tokens.blue, tokens.ice, 0.25);
        drawCircle(c, at.x + fx * 0.1, at.y + fy * 0.1, 0.6 * spriteScale, tokens.ice);
    }

    /**
     * Dashed aim line from the puck to the aim point (aim scheme).
     * @param {CanvasRenderingContext2D} c
     * @param {Vec2} from @param {Vec2} to
     * @returns {void}
     */
    function drawAim(c, from, to) {
        c.setLineDash([0.8, 0.8]);
        c.strokeStyle = 'rgb(17 22 29 / 0.45)';
        c.lineWidth = 0.18;
        c.beginPath();
        c.moveTo(from.x, from.y);
        c.lineTo(to.x, to.y);
        c.stroke();
        c.setLineDash([]);
        drawCircle(c, to.x, to.y, 0.7, null, tokens.arena, 0.18);
    }

    /**
     * Charge meter beside the skater (hold scheme): track plus kick-yellow fill.
     * @param {CanvasRenderingContext2D} c
     * @param {Vec2} at @param {number} power - 0..1
     * @returns {void}
     */
    function drawCharge(c, at, power) {
        c.fillStyle = 'rgb(17 22 29 / 0.2)';
        c.fillRect(at.x + 2.4, at.y - 3, 0.7, 4);
        c.fillStyle = tokens.kick;
        c.fillRect(at.x + 2.4, at.y + 1 - 4 * power, 0.7, 4 * power);
        c.strokeStyle = tokens.arena;
        c.lineWidth = 0.1;
        c.strokeRect(at.x + 2.4, at.y - 3, 0.7, 4);
    }

    /**
     * Stops observing size changes.
     * @returns {void}
     */
    function destroy() {
        if (observer) observer.disconnect();
        window.removeEventListener('resize', resize);
    }

    resize();
    return {
        resize, draw, worldFromClient, destroy, showGoalLamp, setAimPoint,
        getPixelsPerFt: () => ppfCss
    };
}
