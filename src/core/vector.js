/* =============================================================
   src/core/vector.js
   2D vector math on plain { x, y } objects (feet, or feet/second).

   Sections in this file
     1. Building and combining vectors (return new objects)
     2. Measuring vectors
     3. Turning vectors
     4. In-place helpers for hot paths (names end in "Into")

   Most functions return a new object so callers can't change each
   other's vectors by accident. The "Into" helpers write into an
   existing object instead, for per-step code that shouldn't allocate.

   Angles are in radians, measured the way the canvas draws them:
   0 points right (+x) and angles grow clockwise on screen, because
   y grows downward. "Up the ice" (toward the net) is -PI / 2.

   Troubleshooting
   - NaN appears in positions: something divided by a zero length.
     normalize() returns { x: 0, y: 0 } for a zero vector on purpose;
     check code that divides by lengthOf() directly.
   - A rotation goes the wrong way: positive angles turn clockwise on
     screen (y is down), not counter-clockwise as in math class.
   ============================================================= */

/** @typedef {import('./types.js').Vec2} Vec2 */

/* ---------- 1. Building and combining vectors ---------- */

/** Creates a vector. @param {number} x @param {number} y @returns {Vec2} */
export function vec(x, y) {
    return { x, y };
}

/** Adds two vectors. @param {Vec2} a @param {Vec2} b @returns {Vec2} */
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}

/** Subtracts b from a (the vector from b to a). @param {Vec2} a @param {Vec2} b @returns {Vec2} */
export function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}

/** Multiplies a vector by a number. @param {Vec2} v @param {number} factor @returns {Vec2} */
export function scale(v, factor) {
    return { x: v.x * factor, y: v.y * factor };
}

/**
 * Point between a and b: t = 0 gives a, t = 1 gives b. Used for render interpolation.
 * @param {Vec2} a @param {Vec2} b @param {number} t @returns {Vec2}
 */
export function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Vector of a given length pointing at an angle. @param {number} angleRad @param {number} length @returns {Vec2} */
export function fromAngle(angleRad, length) {
    return { x: Math.cos(angleRad) * length, y: Math.sin(angleRad) * length };
}

/* ---------- 2. Measuring vectors ---------- */

/**
 * Dot product: positive when a and b point the same general way, 0 when perpendicular.
 * @param {Vec2} a @param {Vec2} b @returns {number}
 */
export function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}

/** Length (magnitude). @param {Vec2} v @returns {number} */
export function lengthOf(v) {
    return Math.hypot(v.x, v.y);
}

/** Distance between two points. @param {Vec2} a @param {Vec2} b @returns {number} */
export function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle of a vector in radians (screen convention, see the header). @param {Vec2} v @returns {number} */
export function angleOf(v) {
    return Math.atan2(v.y, v.x);
}

/**
 * Same direction, length 1. A zero vector stays zero instead of becoming NaN.
 * @param {Vec2} v @returns {Vec2}
 */
export function normalize(v) {
    const length = lengthOf(v);
    if (length === 0) return { x: 0, y: 0 };
    return { x: v.x / length, y: v.y / length };
}

/**
 * Shortens a vector to maxLength if it's longer; shorter vectors are returned unchanged (copied).
 * @param {Vec2} v @param {number} maxLength - Must be >= 0. @returns {Vec2}
 */
export function clampLength(v, maxLength) {
    const length = lengthOf(v);
    if (length <= maxLength || length === 0) return { x: v.x, y: v.y };
    const factor = maxLength / length;
    return { x: v.x * factor, y: v.y * factor };
}

/* ---------- 3. Turning vectors ---------- */

/** Rotates a vector by an angle (clockwise on screen for positive angles). @param {Vec2} v @param {number} angleRad @returns {Vec2} */
export function rotate(v, angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * The vector turned 90 degrees counter-clockwise on screen: (x, y) → (y, -x).
 * For a skater facing up (0, -1) this points left (-1, 0).
 * @param {Vec2} v @returns {Vec2}
 */
export function perpendicular(v) {
    return { x: v.y, y: -v.x };
}

/* ---------- 4. In-place helpers ---------- */

/** Copies source's components into target. @param {Vec2} target @param {Vec2} source @returns {Vec2} target */
export function copyInto(target, source) {
    target.x = source.x;
    target.y = source.y;
    return target;
}

/** Sets target's components. @param {Vec2} target @param {number} x @param {number} y @returns {Vec2} target */
export function setInto(target, x, y) {
    target.x = x;
    target.y = y;
    return target;
}
