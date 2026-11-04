/* =============================================================
   src/browser/touch-controls.js
   On-screen stick, Shoot and Deke buttons for phones and tablets.

   Sections in this file
     1. Helpers
     2. createTouchControls: stick, buttons, scheme changes

   How it fits: this module only reports what the thumbs do, through
   onIntentChange(event). input.js turns those reports into the
   per-step Intent, alongside the keyboard (ARCHITECTURE §8).
   Event types: 'move' (stick x/y, -1..1), 'shoot_down', 'shoot_up',
   'shoot_cancel' (pointercancel: drop the charge, no shot, Q17),
   'deke'.

   Pointer capture keeps a press tied to its button even when the
   thumb slides off it, so a hold-to-charge release still lands.

   Troubleshooting
   - The page scrolls while dragging the stick: touch-action: none
     must be on .bk-touch and the stick (style.css section 3).
   - A long press opens the text-selection callout on iOS:
     -webkit-touch-callout: none on the round buttons.
   - The Shoot button does nothing with a screen reader: activation
     without a pointer press is handled as a quick press + release.
   ============================================================= */

/** @typedef {import('../core/types.js').ControlScheme} ControlScheme */
/** @typedef {import('./input.js').TouchEvent} TouchReport */

/* ---------- 1. Helpers ---------- */

/** Dead zone so a resting thumb does not drift the skater. */
const STICK_DEAD_ZONE = 0.12;

/**
 * Finds a required element inside the root.
 * @param {ParentNode} root @param {string} selector
 * @returns {HTMLElement}
 */
function find(root, selector) {
    const element = root.querySelector(selector);
    if (!(element instanceof HTMLElement)) throw new TypeError(`createTouchControls: missing ${selector}`);
    return element;
}

/* ---------- 2. createTouchControls ---------- */

/**
 * Wires the touch controls inside `root` (the [data-testid="touch-controls"] element).
 * @param {{ root: HTMLElement, scheme: ControlScheme, onIntentChange: (event: TouchReport) => void }} options
 * @returns {{ setScheme(scheme: ControlScheme): void,
 *   getState(): { moveX: number, moveY: number, isShootHeld: boolean }, destroy(): void }}
 */
export function createTouchControls({ root, scheme, onIntentChange }) {
    const stickArea = find(root, '.bk-stick');
    const stickBase = find(root, '.bk-stick__base');
    const knob = find(root, '.bk-stick__knob');
    const shootButton = find(root, '[data-testid="shoot-button"]');
    const dekeButton = find(root, '[data-testid="deke-button"]');
    const tapHint = root.querySelector('#touch-tap-hint');
    const shootHint = root.querySelector('#shoot-hint');

    /** @type {number|null} */
    let stickPointerId = null;
    let moveX = 0;
    let moveY = 0;
    let isShootHeld = false;
    let wasShootPointer = false;
    let wasDekePointer = false;

    /**
     * Moves the knob and reports the stick value.
     * @param {number} clientX @param {number} clientY
     * @returns {void}
     */
    function updateStick(clientX, clientY) {
        const rect = stickBase.getBoundingClientRect();
        const radius = rect.width / 2 || 1;
        let dx = (clientX - (rect.left + radius)) / radius;
        let dy = (clientY - (rect.top + radius)) / radius;
        const length = Math.hypot(dx, dy);
        if (length > 1) { dx /= length; dy /= length; }
        const isDead = Math.hypot(dx, dy) < STICK_DEAD_ZONE;
        moveX = isDead ? 0 : dx;
        moveY = isDead ? 0 : dy;
        knob.style.transform = `translate(${(dx * radius * 0.6).toFixed(1)}px, ${(dy * radius * 0.6).toFixed(1)}px)`;
        onIntentChange({ type: 'move', moveX, moveY });
    }

    /** Centers the knob and stops moving. @returns {void} */
    function releaseStick() {
        stickPointerId = null;
        moveX = 0;
        moveY = 0;
        knob.style.transform = '';
        onIntentChange({ type: 'move', moveX: 0, moveY: 0 });
    }

    /** @param {PointerEvent} event @returns {void} */
    function onStickDown(event) {
        if (stickPointerId !== null) return;
        event.preventDefault();
        stickPointerId = event.pointerId;
        try { stickArea.setPointerCapture(event.pointerId); } catch { /* old browsers */ }
        updateStick(event.clientX, event.clientY);
    }

    /** @param {PointerEvent} event @returns {void} */
    function onStickMove(event) {
        if (event.pointerId !== stickPointerId) return;
        updateStick(event.clientX, event.clientY);
    }

    /** @param {PointerEvent} event @returns {void} */
    function onStickUp(event) {
        if (event.pointerId !== stickPointerId) return;
        releaseStick();
    }

    /** @param {PointerEvent} event @returns {void} */
    function onShootDown(event) {
        event.preventDefault();
        wasShootPointer = true;
        try { shootButton.setPointerCapture(event.pointerId); } catch { /* old browsers */ }
        isShootHeld = true;
        shootButton.classList.add('is-active');
        onIntentChange({ type: 'shoot_down' });
    }

    /** @returns {void} */
    function onShootUp() {
        if (!isShootHeld) return;
        isShootHeld = false;
        shootButton.classList.remove('is-active');
        onIntentChange({ type: 'shoot_up' });
    }

    /** @returns {void} */
    function onShootCancel() {
        if (!isShootHeld) return;
        isShootHeld = false;
        shootButton.classList.remove('is-active');
        onIntentChange({ type: 'shoot_cancel' });
    }

    /**
     * Click without a pointer press (keyboard or screen reader): a quick press and release.
     * @returns {void}
     */
    function onShootClick() {
        if (wasShootPointer) { wasShootPointer = false; return; }
        onIntentChange({ type: 'shoot_down' });
        onIntentChange({ type: 'shoot_up' });
    }

    /** @param {PointerEvent} event @returns {void} */
    function onDekeDown(event) {
        event.preventDefault();
        wasDekePointer = true;
        dekeButton.classList.add('is-active');
        onIntentChange({ type: 'deke' });
    }

    /** @returns {void} */
    function onDekeUp() {
        dekeButton.classList.remove('is-active');
    }

    /** @returns {void} */
    function onDekeClick() {
        if (wasDekePointer) { wasDekePointer = false; return; }
        onIntentChange({ type: 'deke' });
    }

    /** @param {Event} event @returns {void} */
    function preventMenu(event) {
        event.preventDefault();
    }

    stickArea.addEventListener('pointerdown', onStickDown);
    stickArea.addEventListener('pointermove', onStickMove);
    stickArea.addEventListener('pointerup', onStickUp);
    stickArea.addEventListener('pointercancel', onStickUp);
    shootButton.addEventListener('pointerdown', onShootDown);
    shootButton.addEventListener('pointerup', onShootUp);
    shootButton.addEventListener('pointercancel', onShootCancel);
    shootButton.addEventListener('click', onShootClick);
    dekeButton.addEventListener('pointerdown', onDekeDown);
    dekeButton.addEventListener('pointerup', onDekeUp);
    dekeButton.addEventListener('pointercancel', onDekeUp);
    dekeButton.addEventListener('click', onDekeClick);
    root.addEventListener('contextmenu', preventMenu);

    /**
     * Shows the buttons the scheme uses: no Deke in One button; the aim scheme shoots by
     * tapping the rink, so Shoot is replaced by a hint.
     * @param {ControlScheme} nextScheme
     * @returns {void}
     */
    function setScheme(nextScheme) {
        dekeButton.hidden = nextScheme === 'one_button';
        shootButton.hidden = nextScheme === 'aim_mouse';
        if (tapHint instanceof HTMLElement) tapHint.hidden = nextScheme !== 'aim_mouse';
        if (shootHint instanceof HTMLElement) shootHint.hidden = nextScheme !== 'hold_charge';
        onShootCancel();
        releaseStick();
    }

    /**
     * Current held values.
     * @returns {{ moveX: number, moveY: number, isShootHeld: boolean }}
     */
    function getState() {
        return { moveX, moveY, isShootHeld };
    }

    /**
     * Removes every listener.
     * @returns {void}
     */
    function destroy() {
        stickArea.removeEventListener('pointerdown', onStickDown);
        stickArea.removeEventListener('pointermove', onStickMove);
        stickArea.removeEventListener('pointerup', onStickUp);
        stickArea.removeEventListener('pointercancel', onStickUp);
        shootButton.removeEventListener('pointerdown', onShootDown);
        shootButton.removeEventListener('pointerup', onShootUp);
        shootButton.removeEventListener('pointercancel', onShootCancel);
        shootButton.removeEventListener('click', onShootClick);
        dekeButton.removeEventListener('pointerdown', onDekeDown);
        dekeButton.removeEventListener('pointerup', onDekeUp);
        dekeButton.removeEventListener('pointercancel', onDekeUp);
        dekeButton.removeEventListener('click', onDekeClick);
        root.removeEventListener('contextmenu', preventMenu);
    }

    setScheme(scheme);
    return { setScheme, getState, destroy };
}
