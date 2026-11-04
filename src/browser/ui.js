/* =============================================================
   src/browser/ui.js
   The HTML side of the game: screens, score strip, banner,
   dialogs, live announcements and the goal-light strip flash.

   Sections in this file
     1. Small DOM helpers
     2. createUi: screens and focus
     3. Score strip and banner
     4. Panels: start, how to play, settings, summary, game over
     5. Dialogs, announcer, motion, goal moment
     6. bind: button and input wiring

   How it fits (ARCHITECTURE §10): main.js owns the game state and
   calls these methods; this file never changes game state itself.
   All text comes from core/ui-strings.js (passed in as `strings`),
   and every node is filled with textContent, never innerHTML.

   Extra methods beyond CONTRACTS §4 (additive, used by main.js):
     renderStart, renderHelp, renderSettings, renderSummary,
     renderGameOver, setPauseText, showLeaveConfirm, hideLeaveConfirm,
     setMuted, setCanvasLabel, setTouchVisible, setPauseEnabled,
     setResetStatus, isDialogOpen

   Troubleshooting
   - Focus lands on <body> after closing a dialog: the opener was
     hidden; closeDialog then falls back to the game root.
   - The strip keeps flashing with Reduce motion: <html> must carry
     data-motion="reduce" (setMotion); style.css section 6 stops it.
   - Screen readers repeat the clock: only the 5, 3 and 1 second
     marks change its label; the number itself is aria-hidden.
   ============================================================= */

import { GOAL_LIGHT_S, ATTEMPTS_PER_ROUND } from '../core/constants.js';

/** @typedef {import('../core/types.js').GameState} GameState */
/** @typedef {import('../core/types.js').RoundState} RoundState */
/** @typedef {import('../core/types.js').Outcome} Outcome */
/** @typedef {import('../core/types.js').ControlScheme} ControlScheme */
/** @typedef {import('../core/types.js').StartingLevel} StartingLevel */
/** @typedef {import('../core/types.js').Settings} Settings */
/** @typedef {import('../core/types.js').BestScore} BestScore */
/** @typedef {import('../core/types.js').MarkerState} MarkerState */
/** @typedef {import('../core/types.js').TierName} TierName */
/** @typedef {typeof import('../core/ui-strings.js')} Strings */
/** @typedef {'start'|'howto'|'settings'|'playing'|'paused'|'summary'|'gameover'} ScreenName */

/**
 * Handlers main.js passes to bind(); any can be left out.
 * @typedef {{ onPlay?: () => void, onHowTo?: () => void, onSettings?: () => void, onBackToStart?: () => void,
 *   onLevelChange?: (level: StartingLevel) => void, onSchemeChange?: (scheme: ControlScheme) => void,
 *   onSoundChange?: (isOn: boolean) => void, onMotionChange?: (pref: Settings['motion_preference']) => void,
 *   onReset?: (opener: HTMLElement) => void, onResetConfirm?: () => void, onResetCancel?: () => void,
 *   onPause?: (opener: HTMLElement) => void, onMute?: () => void, onResume?: () => void,
 *   onRestart?: () => void, onQuit?: () => void, onLeaveConfirm?: () => void, onLeaveCancel?: () => void,
 *   onNextRound?: () => void, onPlayAgain?: () => void, onPauseDialogCancel?: () => void }} UiHandlers
 */

/* ---------- 1. Small DOM helpers ---------- */

/** Accessible names for the marker states (UX_COPY §5). */
const MARKER_WORDS = Object.freeze({ goal: 'goal', miss: 'no goal', current: 'now', pending: 'not played yet' });

/** Clock marks where the accessible label is refreshed. */
const CLOCK_MARKS = [5, 3, 1];

/**
 * Finds an element by id inside the root, or throws a clear error for a missing hook.
 * @param {ParentNode} root @param {string} id
 * @returns {HTMLElement}
 */
function byId(root, id) {
    const element = root.querySelector(`#${id}`);
    if (!(element instanceof HTMLElement)) throw new TypeError(`createUi: missing #${id}`);
    return element;
}

/**
 * Sets text only when it changed (keeps layout and screen readers calm).
 * @param {HTMLElement} element @param {string} text
 * @returns {void}
 */
function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
}

/**
 * Replaces an element's children with `children`.
 * @param {HTMLElement} element @param {Node[]} children
 * @returns {void}
 */
function replaceChildren(element, children) {
    element.replaceChildren(...children);
}

/**
 * Creates an element with optional text and class.
 * @param {string} tag @param {string} [text] @param {string} [className]
 * @returns {HTMLElement}
 */
function make(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

/* ---------- 2. createUi ---------- */

/**
 * Creates the UI controller.
 * @param {{ root: HTMLElement, strings: Strings }} options
 */
export function createUi({ root, strings }) {
    const html = document.documentElement;
    const strip = byId(root, 'strip');
    const markerItems = /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll('#strip-markers [data-testid="attempt-marker"]')));
    const markerList = byId(root, 'strip-markers');
    const roundText = byId(root, 'strip-round');
    const tierText = byId(root, 'strip-tier');
    const goalsText = byId(root, 'strip-goals');
    const scoreText = byId(root, 'strip-score');
    const bestText = byId(root, 'strip-best');
    const clockText = byId(root, 'shot-clock');
    const clockCell = byId(root, 'shot-clock-cell');
    const banner = byId(root, 'banner');
    const bannerTitle = byId(root, 'banner-title');
    const bannerDetail = byId(root, 'banner-detail');
    const liveRegion = byId(root, 'live-region');
    const canvas = byId(root, 'rink');
    const canvasDescription = byId(root, 'rink-description');
    const touchRoot = byId(root, 'touch-controls');
    const pauseButton = /** @type {HTMLButtonElement} */ (byId(root, 'pause-button'));
    const muteButton = byId(root, 'mute-button');
    /** @type {Record<string, HTMLElement>} */
    const panels = {};
    for (const panel of root.querySelectorAll('[data-panel]')) {
        if (panel instanceof HTMLElement && panel.dataset.panel) panels[panel.dataset.panel] = panel;
    }
    const overlay = root.querySelector('#overlay');
    /** @type {Map<string, HTMLElement|null>} */
    const dialogOpeners = new Map();
    let lastClockMark = Infinity;
    let goalTimer = 0;
    let announceTimer = 0;

    /**
     * Shows one screen. Panels other than `name` are hidden. Focus moves to `focusTarget`, or the
     * panel heading, unless `isQuiet` (first load: don't steal focus from the skip link).
     * @param {ScreenName} name
     * @param {{ focusTarget?: HTMLElement|null, isQuiet?: boolean }} [options]
     * @returns {void}
     */
    function showScreen(name, { focusTarget = null, isQuiet = false } = {}) {
        root.dataset.screen = name;
        for (const [panelName, panel] of Object.entries(panels)) panel.hidden = panelName !== name;
        if (isQuiet) return;
        // The nav is sticky: show the game from its top and focus without the browser's own
        // scroll, which would tuck the strip or a panel heading under the nav.
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        if (overlay) overlay.scrollTop = 0;
        if (focusTarget && !focusTarget.hidden) { focusTarget.focus({ preventScroll: true }); return; }
        if (name === 'playing') { root.focus({ preventScroll: true }); return; }
        const panel = panels[name];
        if (!panel) return;
        const heading = panel.querySelector('h1, h2');
        if (heading instanceof HTMLElement) {
            if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    }

    /* ---------- 3. Score strip and banner ---------- */

    /**
     * Refreshes the strip from the state. Cheap to call every frame: text only changes when the
     * value does (so the clock updates at most every 0.1 s).
     * @param {GameState} state
     * @param {BestScore|null} [best]
     * @returns {void}
     */
    function updateStrip(state, best = null) {
        const round = state.round;
        setText(roundText, `Round ${round.number}`);
        setText(tierText, `${strings.TIER_NAMES[round.tier.tierName]} goalie`);
        setText(goalsText, String(round.goals));
        setText(scoreText, strings.formatScore(state.runScore));
        updateBest(best);
        updateMarkers(markerItems, markerList, getMarkers(state));
        setText(clockText, strings.formatShotClock(state.shotClockS));
        // Accessible label: changes only when the clock enters a new bucket (above 5, then 5, 3, 1).
        const clock = Math.max(0, state.shotClockS);
        const bucket = CLOCK_MARKS.slice().reverse().find((m) => clock <= m) ?? Infinity;
        if (bucket !== lastClockMark) {
            lastClockMark = bucket;
            const seconds = bucket === Infinity ? Math.ceil(clock) : bucket;
            clockCell.setAttribute('aria-label', `Shot clock, ${seconds} seconds left`);
        }
    }

    /**
     * The five marker states for the strip. Like rules.getMarkerStates, but no "current"
     * marker while the result banner shows (that attempt is already decided).
     * @param {GameState} state @returns {MarkerState[]}
     */
    function getMarkers(state) {
        const outcomes = state.round.attemptOutcomes;
        /** @type {MarkerState[]} */
        const result = [];
        const isLive = state.phase === 'playing' || state.phase === 'rebound_window' ||
            (state.phase === 'paused' && state.resumePhase !== 'result_banner');
        for (let i = 0; i < ATTEMPTS_PER_ROUND; i += 1) {
            const outcome = outcomes[i];
            if (outcome) result.push(outcome === 'goal' ? 'goal' : 'miss');
            else if (i === state.attemptIndex && (isLive || state.phase === 'start')) result.push('current');
            else result.push('pending');
        }
        return result;
    }

    /**
     * Writes marker states, shapes come from CSS by data-state; text gives the accessible name.
     * @param {HTMLElement[]} items @param {HTMLElement|null} list @param {MarkerState[]} states
     * @returns {void}
     */
    function updateMarkers(items, list, states) {
        let goals = 0;
        let misses = 0;
        states.forEach((value, i) => {
            const item = items[i];
            if (!item) return;
            if (value === 'goal') goals += 1;
            if (value === 'miss') misses += 1;
            if (item.dataset.state !== value) {
                item.dataset.state = value;
                const label = item.firstElementChild instanceof HTMLElement ? item.firstElementChild : item;
                label.textContent = `Attempt ${i + 1}: ${MARKER_WORDS[value]}`;
            }
        });
        if (list) {
            const left = states.length - goals - misses;
            const label = `Attempts: ${goals} ${goals === 1 ? 'goal' : 'goals'}, ${misses} ${misses === 1 ? 'miss' : 'misses'}, ${left} left`;
            if (list.getAttribute('aria-label') !== label) list.setAttribute('aria-label', label);
        }
    }

    /**
     * Strip best: the number, or a dash with "No best yet" for screen readers.
     * @param {BestScore|null} best @returns {void}
     */
    function updateBest(best) {
        const key = best ? String(best.score) : '';
        if (bestText.dataset.value === key) return;
        bestText.dataset.value = key;
        if (best) {
            bestText.textContent = strings.formatScore(best.score);
        } else {
            const dash = make('span', '—');
            dash.setAttribute('aria-hidden', 'true');
            replaceChildren(bestText, [dash, make('span', strings.UX_STRINGS.strip.bestEmptyAccessible, 'bk-visually-hidden')]);
        }
    }

    /**
     * Shows the result banner. `outcome` may also be 'rebound' for the rebound chance.
     * @param {Outcome|'rebound'} outcome
     * @param {{ isShortOfNet?: boolean, hasDekeBonus?: boolean, isReboundExpired?: boolean, points?: number }} [options]
     * @returns {void}
     */
    function showBanner(outcome, options = {}) {
        const text = outcome === 'rebound' ? strings.getReboundBannerText() : strings.getBannerText(outcome, options);
        setText(bannerTitle, text.title);
        setText(bannerDetail, text.detail);
        bannerDetail.hidden = !text.detail;
        banner.classList.toggle('bk-banner--goal', outcome === 'goal');
        banner.classList.toggle('bk-banner--rebound', outcome === 'rebound');
        banner.dataset.outcome = outcome === 'wide' && options.isShortOfNet ? 'no_shot' : outcome;
        banner.hidden = false;
    }

    /** Hides the banner. @returns {void} */
    function hideBanner() {
        banner.hidden = true;
        delete banner.dataset.outcome;
    }

    /* ---------- 4. Panels ---------- */

    /**
     * Fills the start screen.
     * @param {{ scheme: ControlScheme, level: StartingLevel, best: BestScore|null, isStorageBlocked: boolean }} data
     * @returns {void}
     */
    function renderStart({ scheme, level, best, isStorageBlocked }) {
        setText(byId(root, 'start-scheme'), strings.SCHEME_NAMES[scheme]);
        for (const input of root.querySelectorAll('input[name="level"]')) {
            if (input instanceof HTMLInputElement) input.checked = input.value === level;
        }
        const label = byId(root, 'start-best-label');
        const value = byId(root, 'start-best-value');
        const detail = byId(root, 'start-best-detail');
        setText(label, `Best for ${strings.SCHEME_NAMES[scheme]}, ${strings.LEVEL_NAMES[level]}`);
        if (best) {
            setText(value, strings.formatScore(best.score));
            value.hidden = false;
            const goalsWord = best.goals === 1 ? 'goal' : 'goals';
            setText(detail, `Reached round ${best.rounds_cleared + 1}, ${best.goals} ${goalsWord}`);
        } else {
            value.hidden = true;
            setText(detail, strings.UX_STRINGS.start.emptyBest);
        }
        byId(root, 'start-storage-note').hidden = !isStorageBlocked;
    }

    /**
     * Fills the laptop help card and the How to play table for a scheme.
     * @param {ControlScheme} scheme @returns {void}
     */
    function renderHelp(scheme) {
        const help = strings.getSchemeHelp(scheme);
        setText(byId(root, 'help-scheme'), help.name);
        const rows = [];
        for (const row of help.rows) {
            rows.push(make('dt', row.action), make('dd', row.keys));
        }
        replaceChildren(byId(root, 'help-rows'), rows);

        setText(byId(root, 'howto-controls-title'), `Controls: ${help.name}`);
        setText(byId(root, 'howto-keys-head'), scheme === 'aim_mouse' ? 'Mouse and keyboard' : 'Keyboard');
        const tableRows = help.rows.map((row) => {
            const tr = make('tr');
            tr.append(make('td', row.action), make('td', row.keys), make('td', row.touch));
            return tr;
        });
        replaceChildren(byId(root, 'howto-rows'), tableRows);
        byId(root, 'howto-aim-note').hidden = scheme !== 'aim_mouse';
        const shootHint = root.querySelector('#shoot-hint');
        if (shootHint instanceof HTMLElement) shootHint.hidden = scheme !== 'hold_charge';
    }

    /**
     * Reflects settings in the Settings form.
     * @param {Settings} settings @param {boolean} isSystemReduced
     * @returns {void}
     */
    function renderSettings(settings, isSystemReduced) {
        for (const input of root.querySelectorAll('input[name="scheme"]')) {
            if (input instanceof HTMLInputElement) input.checked = input.value === settings.control_scheme;
        }
        for (const input of root.querySelectorAll('input[name="motion"]')) {
            if (input instanceof HTMLInputElement) input.checked = input.value === settings.motion_preference;
        }
        const sound = root.querySelector('#sound-toggle');
        if (sound instanceof HTMLInputElement) sound.checked = settings.is_sound_on;
        setText(byId(root, 'motion-system-hint'),
            `Your device is set to ${isSystemReduced ? 'reduce motion' : 'full motion'}.`);
    }

    /**
     * Fills the round summary.
     * @param {RoundState} round @param {boolean} isCleared @param {TierName|null} nextTierName @param {number} runScore
     * @returns {void}
     */
    function renderSummary(round, isCleared, nextTierName, runScore) {
        const text = strings.getRoundSummaryText(round, isCleared, nextTierName);
        setText(byId(root, 'summary-title'), text.title);
        setText(byId(root, 'summary-detail'), text.detail);
        setText(byId(root, 'next-round-button'), text.button);
        setText(byId(root, 'summary-round-score'), `+${strings.formatScore(round.points)}`);
        setText(byId(root, 'summary-run-score'), strings.formatScore(runScore));
        const list = byId(root, 'summary-markers');
        const items = [];
        for (let i = 0; i < ATTEMPTS_PER_ROUND; i += 1) {
            const outcome = round.attemptOutcomes[i];
            /** @type {MarkerState} */
            const value = outcome ? (outcome === 'goal' ? 'goal' : 'miss') : 'pending';
            const li = make('li');
            li.dataset.state = value;
            li.append(make('span', `Attempt ${i + 1}: ${MARKER_WORDS[value]}`, 'bk-visually-hidden'));
            items.push(li);
        }
        replaceChildren(list, items);
    }

    /**
     * Fills the game-over screen.
     * @param {{ state: GameState, best: BestScore|null, isNewBest: boolean, isStorageBlocked: boolean }} data
     * @returns {void}
     */
    function renderGameOver({ state, best, isNewBest, isStorageBlocked }) {
        const text = strings.getGameOverText(state);
        setText(byId(root, 'gameover-title'), text.title);
        setText(byId(root, 'gameover-detail'), text.detail);
        setText(byId(root, 'gameover-score'), strings.formatScore(state.runScore));
        setText(byId(root, 'gameover-rounds'), String(state.roundsCleared));
        setText(byId(root, 'gameover-goals'), String(state.runGoals));
        setText(byId(root, 'gameover-best'), best ? strings.formatScore(best.score) : '—');
        byId(root, 'gameover-new-best').hidden = !isNewBest;
        const line = byId(root, 'gameover-new-best-line');
        const toGo = byId(root, 'gameover-to-go');
        const bestLine = strings.getGameOverBestText(state.runScore, best, isNewBest, state.scheme, state.startingLevel);
        line.hidden = !isNewBest;
        toGo.hidden = isNewBest || !best;
        if (isNewBest) setText(line, bestLine);
        else if (best) setText(toGo, bestLine);
        byId(root, 'gameover-storage-note').hidden = !isStorageBlocked;
    }

    /* ---------- 5. Dialogs, announcer, motion, goal moment ---------- */

    /**
     * Opens a modal dialog and remembers who opened it.
     * @param {string} id @param {HTMLElement|null} opener
     * @returns {void}
     */
    function openDialog(id, opener) {
        const dialog = byId(root, id);
        if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
        dialogOpeners.set(id, opener);
        dialog.showModal();
    }

    /**
     * Closes a dialog and returns focus to its opener (or the game root).
     * @param {string} id @param {{ focusTarget?: HTMLElement|null }} [options]
     * @returns {void}
     */
    function closeDialog(id, { focusTarget } = {}) {
        const dialog = byId(root, id);
        if (!(dialog instanceof HTMLDialogElement)) return;
        if (dialog.open) dialog.close();
        const opener = focusTarget !== undefined ? focusTarget : dialogOpeners.get(id);
        dialogOpeners.delete(id);
        if (opener && opener.isConnected && opener.offsetParent !== null && !(opener instanceof HTMLButtonElement && opener.disabled)) {
            opener.focus();
        } else {
            root.focus({ preventScroll: true });
        }
    }

    /**
     * Whether a dialog is open.
     * @param {string} id @returns {boolean}
     */
    function isDialogOpen(id) {
        const dialog = root.querySelector(`#${id}`);
        return dialog instanceof HTMLDialogElement && dialog.open;
    }

    /**
     * Speaks one line through the polite live region (text replaced, not appended).
     * @param {string} text @returns {void}
     */
    function announce(text) {
        if (!text) return;
        window.clearTimeout(announceTimer);
        // Clear then set, so the same line twice in a row is still read.
        liveRegion.textContent = '';
        announceTimer = window.setTimeout(() => { liveRegion.textContent = text; }, 30);
    }

    /**
     * Applies the resolved motion mode to <html data-motion>.
     * @param {'reduce'|'full'} mode @returns {void}
     */
    function setMotion(mode) {
        html.dataset.motion = mode;
    }

    /**
     * Goal moment on the strip: flash 2/s for GOAL_LIGHT_S (steady red with reduced motion, by CSS).
     * @returns {void}
     */
    function showGoalMoment() {
        window.clearTimeout(goalTimer);
        strip.classList.remove('is-flashing');
        void strip.offsetWidth; // restart the CSS animation
        strip.classList.add('is-flashing', 'is-lit');
        goalTimer = window.setTimeout(() => strip.classList.remove('is-flashing', 'is-lit'), GOAL_LIGHT_S * 1000);
    }

    /**
     * Pause dialog line.
     * @param {string} text @returns {void}
     */
    function setPauseText(text) {
        setText(byId(root, 'pause-detail'), text);
    }

    /**
     * Shows the inline "your score won't be saved" confirm inside the pause dialog.
     * @param {'restart'|'quit'} action @param {string} text
     * @returns {void}
     */
    function showLeaveConfirm(action, text) {
        byId(root, 'pause-actions').hidden = true;
        const box = byId(root, 'pause-confirm');
        box.hidden = false;
        box.dataset.action = action;
        setText(byId(root, 'pause-confirm-text'), text);
        const yes = byId(root, 'pause-confirm-yes');
        setText(yes, action === 'restart' ? strings.UX_STRINGS.pause.restartButton : strings.UX_STRINGS.pause.quitRunButton);
        byId(root, 'pause-confirm-no').focus();
    }

    /**
     * Hides the inline confirm and shows the pause buttons again.
     * @param {boolean} [isFocusing] - Focus the button that opened the confirm.
     * @returns {void}
     */
    function hideLeaveConfirm(isFocusing = false) {
        const box = byId(root, 'pause-confirm');
        const action = box.dataset.action;
        box.hidden = true;
        byId(root, 'pause-actions').hidden = false;
        if (isFocusing) byId(root, action === 'quit' ? 'quit-button' : 'restart-button').focus();
    }

    /**
     * Mute button state: pressed means muted.
     * @param {boolean} isMuted @returns {void}
     */
    function setMuted(isMuted) {
        muteButton.setAttribute('aria-pressed', String(isMuted));
    }

    /**
     * Canvas description (updated at attempt start and end, not per frame).
     * @param {string} text @returns {void}
     */
    function setCanvasLabel(text) {
        setText(canvasDescription, text);
        void canvas;
    }

    /**
     * Shows or hides the touch controls (and marks the root for the CSS layout).
     * @param {boolean} isVisible @returns {void}
     */
    function setTouchVisible(isVisible) {
        touchRoot.hidden = !isVisible;
        root.dataset.touch = String(isVisible);
    }

    /**
     * Pause only works during play.
     * @param {boolean} isEnabled @returns {void}
     */
    function setPauseEnabled(isEnabled) {
        pauseButton.disabled = !isEnabled;
    }

    /**
     * Shows or hides "Saved data cleared." in Settings.
     * @param {boolean} isVisible @returns {void}
     */
    function setResetStatus(isVisible) {
        byId(root, 'reset-status').hidden = !isVisible;
    }

    /* ---------- 6. bind ---------- */

    /**
     * Wires buttons and inputs to handlers.
     * @param {UiHandlers} handlers @returns {void}
     */
    function bind(handlers) {
        /** @param {string} id @param {(button: HTMLElement) => void} [fn] */
        const onClick = (id, fn) => {
            const button = byId(root, id);
            button.addEventListener('click', () => { if (fn) fn(button); });
        };
        onClick('play-button', () => handlers.onPlay?.());
        onClick('howto-play-button', () => handlers.onPlay?.());
        onClick('howto-button', () => handlers.onHowTo?.());
        onClick('settings-button', () => handlers.onSettings?.());
        onClick('start-change-controls', () => handlers.onSettings?.());
        onClick('howto-change-controls', () => handlers.onSettings?.());
        onClick('howto-back-button', () => handlers.onBackToStart?.());
        onClick('settings-back-button', () => handlers.onBackToStart?.());
        onClick('back-to-start-button', () => handlers.onBackToStart?.());
        onClick('reset-button', (button) => handlers.onReset?.(button));
        onClick('reset-confirm', () => handlers.onResetConfirm?.());
        onClick('reset-cancel', () => handlers.onResetCancel?.());
        onClick('pause-button', (button) => handlers.onPause?.(button));
        onClick('mute-button', () => handlers.onMute?.());
        onClick('resume-button', () => handlers.onResume?.());
        onClick('restart-button', () => handlers.onRestart?.());
        onClick('quit-button', () => handlers.onQuit?.());
        onClick('pause-confirm-yes', () => handlers.onLeaveConfirm?.());
        onClick('pause-confirm-no', () => handlers.onLeaveCancel?.());
        onClick('next-round-button', () => handlers.onNextRound?.());
        onClick('play-again-button', () => handlers.onPlayAgain?.());

        root.addEventListener('change', (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) return;
            if (input.name === 'level' && input.checked) handlers.onLevelChange?.(/** @type {StartingLevel} */ (input.value));
            if (input.name === 'scheme' && input.checked) handlers.onSchemeChange?.(/** @type {ControlScheme} */ (input.value));
            if (input.name === 'motion' && input.checked) handlers.onMotionChange?.(/** @type {Settings['motion_preference']} */ (input.value));
            if (input.id === 'sound-toggle') handlers.onSoundChange?.(input.checked);
        });

        // Esc on a native dialog fires "cancel": treat it as Resume / Keep my data.
        byId(root, 'pause-dialog').addEventListener('cancel', (event) => {
            event.preventDefault();
            handlers.onPauseDialogCancel?.();
        });
        byId(root, 'reset-dialog').addEventListener('cancel', (event) => {
            event.preventDefault();
            handlers.onResetCancel?.();
        });
    }

    return {
        showScreen, updateStrip, showBanner, hideBanner, announce, openDialog, closeDialog, setMotion,
        showGoalMoment, bind, renderStart, renderHelp, renderSettings, renderSummary, renderGameOver,
        setPauseText, showLeaveConfirm, hideLeaveConfirm, setMuted, setCanvasLabel, setTouchVisible,
        setPauseEnabled, setResetStatus, isDialogOpen
    };
}
