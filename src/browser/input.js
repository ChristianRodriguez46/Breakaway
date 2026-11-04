/* =============================================================
   src/browser/input.js
   Keyboard, mouse and touch turned into one Intent per fixed step.

   Sections in this file
     1. Key map and helpers
     2. createInput: listeners, edge queue, readIntent

   How it fits (ARCHITECTURE §8): browser events arrive whenever the
   browser likes; the game steps at 120 Hz. Held state (which keys
   are down) is read fresh each step. Edges (shoot pressed, shoot
   released, deke) are queued between frames and handed out once,
   to the first step that calls readIntent(), so a tap shorter than
   a frame still lands.

   Extra methods beyond CONTRACTS §4 (additive, used by main.js):
     applyTouch(event)   edges and stick values from touch-controls.js
     getAimPreview()     where the mouse is over the rink (aim line)
     setEnabled(bool)    ignore game keys while menus are open

   Troubleshooting
   - Space presses a button instead of shooting: focus is on that
     button. Game keys are ignored on buttons, inputs and links on
     purpose so menus stay usable; main.js moves focus to the game
     root when an attempt starts.
   - A shot fires the moment a new attempt starts: resetForAttempt
     must run; it makes a key held across attempts need a fresh press.
   - Right-click opens the browser menu: contextmenu is prevented on
     the canvas only.
   ============================================================= */

/** @typedef {import('../core/types.js').Intent} Intent */
/** @typedef {import('../core/types.js').ControlScheme} ControlScheme */
/** @typedef {import('../core/types.js').Vec2} Vec2 */

/**
 * What touch-controls.js reports.
 * @typedef {{ type: 'move', moveX: number, moveY: number }
 *   | { type: 'shoot_down' } | { type: 'shoot_up' } | { type: 'shoot_cancel' }
 *   | { type: 'deke' }} TouchEvent
 */

/* ---------- 1. Key map and helpers ---------- */

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const SHOOT_KEYS = new Set(['Space']);
const DEKE_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS, ...SHOOT_KEYS, ...DEKE_KEYS]);

/** In-play buttons (Pause, Mute, touch controls) have their own shortcuts, so game keys stay with the game. */
const IN_PLAY_CONTROLS = '.bk-strip, .bk-touch';

/**
 * True when a key event comes from a control that needs its own keys (buttons, fields, links).
 * Buttons in the score strip and touch controls don't count: after a player clicks Pause or
 * Mute, arrows and Space must still skate and shoot instead of pressing that button again.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isFromControl(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(IN_PLAY_CONTROLS) && !target.closest('dialog')) return false;
    return Boolean(target.closest('button, input, select, textarea, a[href], [contenteditable="true"], dialog'));
}

/**
 * Clamps a move vector to length 1 (diagonals normalized).
 * @param {number} x @param {number} y
 * @returns {{ x: number, y: number }}
 */
function clampMove(x, y) {
    const length = Math.hypot(x, y);
    if (length <= 1) return { x, y };
    return { x: x / length, y: y / length };
}

/* ---------- 2. createInput ---------- */

/**
 * Creates the input reader.
 * @param {{ target: Window|HTMLElement, canvas: HTMLCanvasElement, scheme: ControlScheme,
 *   worldFromClient: (clientX: number, clientY: number) => Vec2 }} options
 * @returns {{ readIntent(): Intent, setScheme(scheme: ControlScheme): void, resetForAttempt(): void,
 *   destroy(): void, applyTouch(event: TouchEvent): void, getAimPreview(): Vec2|null,
 *   setEnabled(isEnabled: boolean): void }}
 */
export function createInput({ target, canvas, scheme, worldFromClient }) {
    let currentScheme = scheme;
    let isEnabled = false;
    /** @type {Set<string>} */
    const keysDown = new Set();
    let isSpaceDown = false;
    let isSpaceBlocked = false; // held across an attempt reset: needs a fresh press
    let isTouchShootDown = false;
    let touchMoveX = 0;
    let touchMoveY = 0;
    /** @type {Vec2|null} */
    let aimPreview = null;

    // Edge queue (consumed by the next readIntent)
    let queuedShootPressed = false;
    let queuedShootReleased = false;
    let queuedDekePressed = false;
    /** @type {Vec2|null} */
    let queuedAimPoint = null;

    /** @param {KeyboardEvent} event @returns {void} */
    function onKeyDown(event) {
        if (!isEnabled || !GAME_KEYS.has(event.code) || isFromControl(event.target)) return;
        event.preventDefault();
        if (event.repeat) return;
        keysDown.add(event.code);
        if (SHOOT_KEYS.has(event.code) && currentScheme !== 'aim_mouse') {
            isSpaceDown = true;
            isSpaceBlocked = false;
            queuedShootPressed = true;
        }
        if (DEKE_KEYS.has(event.code) && currentScheme !== 'one_button') queuedDekePressed = true;
    }

    /** @param {KeyboardEvent} event @returns {void} */
    function onKeyUp(event) {
        if (!GAME_KEYS.has(event.code)) return;
        // Space on a focused in-play button would "click" it on key up; the game owns Space here.
        if (isEnabled && !isFromControl(event.target)) event.preventDefault();
        keysDown.delete(event.code);
        if (SHOOT_KEYS.has(event.code) && isSpaceDown) {
            isSpaceDown = false;
            if (!isSpaceBlocked && isEnabled) queuedShootReleased = true;
            isSpaceBlocked = false;
        }
    }

    /** Clears held keys when the window loses focus (keyup will never arrive). @returns {void} */
    function onBlur() {
        keysDown.clear();
        isSpaceDown = false;
        isTouchShootDown = false;
        touchMoveX = 0;
        touchMoveY = 0;
    }

    /** @param {PointerEvent} event @returns {void} */
    function onPointerDown(event) {
        if (!isEnabled || currentScheme !== 'aim_mouse') return;
        if (event.button === 2) {
            queuedDekePressed = true;
            event.preventDefault();
            return;
        }
        if (event.button !== 0) return;
        event.preventDefault();
        queuedAimPoint = worldFromClient(event.clientX, event.clientY);
        aimPreview = queuedAimPoint;
        queuedShootPressed = true;
    }

    /** @param {PointerEvent} event @returns {void} */
    function onPointerMove(event) {
        if (currentScheme !== 'aim_mouse' || event.pointerType === 'touch') return;
        aimPreview = worldFromClient(event.clientX, event.clientY);
    }

    /** @returns {void} */
    function onPointerLeave() {
        aimPreview = null;
    }

    /** @param {Event} event @returns {void} */
    function onContextMenu(event) {
        event.preventDefault();
    }

    target.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
    target.addEventListener('keyup', /** @type {EventListener} */ (onKeyUp));
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('contextmenu', onContextMenu);

    /**
     * Applies one report from the touch controls.
     * @param {TouchEvent} event
     * @returns {void}
     */
    function applyTouch(event) {
        if (event.type === 'move') {
            touchMoveX = event.moveX;
            touchMoveY = event.moveY;
            return;
        }
        if (!isEnabled) return;
        if (event.type === 'shoot_down') {
            isTouchShootDown = true;
            queuedShootPressed = true;
        } else if (event.type === 'shoot_up') {
            if (isTouchShootDown) queuedShootReleased = true;
            isTouchShootDown = false;
        } else if (event.type === 'shoot_cancel') {
            // pointercancel (Q17): the charge is dropped without a shot
            isTouchShootDown = false;
            queuedShootPressed = false;
        } else if (event.type === 'deke' && currentScheme !== 'one_button') {
            queuedDekePressed = true;
        }
    }

    /**
     * Builds the Intent for one fixed step and consumes the queued edges.
     * @returns {Intent}
     */
    function readIntent() {
        let x = 0;
        let y = 0;
        for (const code of keysDown) {
            if (LEFT_KEYS.has(code)) x -= 1;
            if (RIGHT_KEYS.has(code)) x += 1;
            if (UP_KEYS.has(code)) y -= 1;
            if (DOWN_KEYS.has(code)) y += 1;
        }
        x = Math.max(-1, Math.min(1, x)) + touchMoveX;
        y = Math.max(-1, Math.min(1, y)) + touchMoveY;
        const move = clampMove(x, y);
        const isHeld = currentScheme !== 'aim_mouse' &&
            ((isSpaceDown && !isSpaceBlocked) || isTouchShootDown);
        /** @type {-1|0|1} */
        const dekeSide = move.x < -0.2 ? -1 : move.x > 0.2 ? 1 : 0;
        /** @type {Intent} */
        const intent = {
            moveX: move.x,
            moveY: move.y,
            isShootHeld: isHeld,
            shootPressed: queuedShootPressed,
            shootReleased: queuedShootReleased,
            aimPoint: currentScheme === 'aim_mouse' ? queuedAimPoint : null,
            dekePressed: currentScheme !== 'one_button' && queuedDekePressed,
            dekeSide
        };
        queuedShootPressed = false;
        queuedShootReleased = false;
        queuedDekePressed = false;
        queuedAimPoint = null;
        return intent;
    }

    /**
     * Changes the control scheme and clears anything in flight.
     * @param {ControlScheme} nextScheme
     * @returns {void}
     */
    function setScheme(nextScheme) {
        currentScheme = nextScheme;
        aimPreview = null;
        resetForAttempt();
    }

    /**
     * Clears queued edges at the start of an attempt; a shoot key held across the reset
     * needs to be let go and pressed again (Q14).
     * @returns {void}
     */
    function resetForAttempt() {
        queuedShootPressed = false;
        queuedShootReleased = false;
        queuedDekePressed = false;
        queuedAimPoint = null;
        if (isSpaceDown) isSpaceBlocked = true;
        isTouchShootDown = false;
    }

    /**
     * Turns game-key handling on (playing) or off (menus, pause).
     * @param {boolean} nextIsEnabled
     * @returns {void}
     */
    function setEnabled(nextIsEnabled) {
        isEnabled = nextIsEnabled;
        if (!isEnabled) {
            queuedShootPressed = false;
            queuedShootReleased = false;
            queuedDekePressed = false;
            queuedAimPoint = null;
            if (isSpaceDown) isSpaceBlocked = true;
            isTouchShootDown = false;
        }
    }

    /**
     * Removes every listener.
     * @returns {void}
     */
    function destroy() {
        target.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
        target.removeEventListener('keyup', /** @type {EventListener} */ (onKeyUp));
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('contextmenu', onContextMenu);
    }

    return {
        readIntent, setScheme, resetForAttempt, destroy, applyTouch, setEnabled,
        getAimPreview: () => aimPreview
    };
}
