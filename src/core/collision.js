/* =============================================================
   src/core/collision.js
   Swept collision tests so fast pucks can't tunnel.

   A "sweep" moves a circle in a straight line from `start` to `end`
   during one physics step and asks: at what fraction t of that move
   (0 = start, 1 = end) does it first touch something? Checking the
   whole path, not just the end position, is what stops a 105 ft/s
   puck (almost 0.9 ft per step) from skipping through a 0.25 ft post.

   Sections in this file
     1. Small helpers (private)
     2. Swept tests: circle vs circle, circle vs capsule, line crossing
     3. Closest point and bounce response

   Rules every sweep follows
   - Touching counts as contact (inclusive): distance <= sum of radii.
   - A circle that already overlaps at the start and is moving in (or
     not moving) reports t = 0. One that overlaps but is moving away
     reports null, so a puck that just bounced doesn't bounce again.
   - Results are in [0, 1] or null; inputs are never changed.

   Troubleshooting
   - The puck passes through a post at high speed: check the caller
     sweeps previousPosition -> position, not position -> position.
   - A puck sticks to a post and buzzes: the caller must reflect the
     velocity at the contact; a separating puck is ignored here.
   - Contacts at exactly touching are missed: CONTACT_EPS_FT2 below
     absorbs float rounding; don't remove it.
   ============================================================= */

/** @typedef {import('./types.js').Vec2} Vec2 */

/** Float tolerance on squared distances (ft²) so exact touching counts despite rounding. */
const CONTACT_EPS_FT2 = 1e-9;

/* ---------- 1. Small helpers ---------- */

/**
 * Earliest t in [0, 1] where the point start + t·d is within `radiusFt` of `center`.
 * @param {Vec2} start @param {number} dx @param {number} dy @param {Vec2} center @param {number} radiusFt
 * @returns {number|null}
 */
function sweepPointVsCircle(start, dx, dy, center, radiusFt) {
    const fx = start.x - center.x;
    const fy = start.y - center.y;
    const c = fx * fx + fy * fy - radiusFt * radiusFt;
    const b = fx * dx + fy * dy; // half of the usual b
    if (c <= CONTACT_EPS_FT2) {
        // Already touching or overlapping: contact now unless moving apart.
        return b <= 0 ? 0 : null;
    }
    const a = dx * dx + dy * dy;
    if (a === 0 || b >= 0) return null; // not moving, or moving away
    const disc = b * b - a * c;
    if (disc < -CONTACT_EPS_FT2) return null;
    const t = (-b - Math.sqrt(Math.max(0, disc))) / a;
    return t >= 0 && t <= 1 ? t : null;
}

/* ---------- 2. Swept tests ---------- */

/**
 * Earliest time a moving circle touches a still circle during one move.
 * @param {Vec2} start - Moving circle center at the start of the step (ft).
 * @param {Vec2} end - Moving circle center at the end of the step (ft).
 * @param {number} movingRadiusFt - Radius of the moving circle.
 * @param {Vec2} center - Still circle center.
 * @param {number} staticRadiusFt - Still circle radius.
 * @returns {number|null} t in [0, 1] (inclusive at touching), or null for no contact.
 */
export function sweepCircleVsCircle(start, end, movingRadiusFt, center, staticRadiusFt) {
    return sweepPointVsCircle(start, end.x - start.x, end.y - start.y, center, movingRadiusFt + staticRadiusFt);
}

/**
 * Earliest time a moving circle touches a capsule (segment A–B grown by a radius), e.g. the goalie.
 * @param {Vec2} start - Moving circle center at the start of the step (ft).
 * @param {Vec2} end - Moving circle center at the end of the step (ft).
 * @param {number} movingRadiusFt - Radius of the moving circle.
 * @param {Vec2} segmentA - One end of the capsule's core segment.
 * @param {Vec2} segmentB - The other end.
 * @param {number} capsuleRadiusFt - Capsule radius around the segment.
 * @returns {number|null} t in [0, 1] (inclusive at touching), or null for no contact.
 */
export function sweepCircleVsCapsule(start, end, movingRadiusFt, segmentA, segmentB, capsuleRadiusFt) {
    const radiusFt = movingRadiusFt + capsuleRadiusFt;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ux0 = segmentB.x - segmentA.x;
    const uy0 = segmentB.y - segmentA.y;
    const lengthFt = Math.hypot(ux0, uy0);
    if (lengthFt === 0) return sweepPointVsCircle(start, dx, dy, segmentA, radiusFt);

    // Already touching at the start?
    const closest = closestPointOnSegment(start, segmentA, segmentB);
    const fx = start.x - closest.x;
    const fy = start.y - closest.y;
    if (fx * fx + fy * fy - radiusFt * radiusFt <= CONTACT_EPS_FT2) {
        return fx * dx + fy * dy <= 0 ? 0 : null;
    }

    // The capsule is a rectangle plus two end discs; first entry is the earliest of their entries.
    let best = /** @type {number|null} */ (null);
    const keep = (/** @type {number|null} */ t) => {
        if (t !== null && (best === null || t < best)) best = t;
    };
    keep(sweepPointVsCircle(start, dx, dy, segmentA, radiusFt));
    keep(sweepPointVsCircle(start, dx, dy, segmentB, radiusFt));

    const ux = ux0 / lengthFt;
    const uy = uy0 / lengthFt;
    const nx = -uy;
    const ny = ux;
    const side0 = (start.x - segmentA.x) * nx + (start.y - segmentA.y) * ny;
    const sideRate = dx * nx + dy * ny;
    let tSide = null;
    if (side0 > radiusFt && sideRate < 0) tSide = (radiusFt - side0) / sideRate;
    else if (side0 < -radiusFt && sideRate > 0) tSide = (-radiusFt - side0) / sideRate;
    if (tSide !== null && tSide >= 0 && tSide <= 1) {
        const along = (start.x + dx * tSide - segmentA.x) * ux + (start.y + dy * tSide - segmentA.y) * uy;
        if (along >= 0 && along <= lengthFt) keep(tSide);
    }
    return best;
}

/**
 * Time a point crosses the horizontal line y = lineY while moving toward smaller y (up the ice).
 * The end must be strictly past the line (end.y < lineY); a start on the line counts as t = 0.
 * @param {Vec2} start - Position at the start of the step.
 * @param {Vec2} end - Position at the end of the step.
 * @param {number} lineY - The line's y (ft).
 * @returns {number|null} t in [0, 1], or null when it doesn't cross upward this step.
 */
export function sweepCrossesY(start, end, lineY) {
    if (!(start.y >= lineY && end.y < lineY)) return null;
    return (start.y - lineY) / (start.y - end.y);
}

/* ---------- 3. Closest point and bounce response ---------- */

/**
 * Closest point to `point` on segment A–B (A itself when A and B are the same point).
 * @param {Vec2} point @param {Vec2} a @param {Vec2} b
 * @returns {Vec2} New vector on the segment.
 */
export function closestPointOnSegment(point, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    if (lengthSq === 0) return { x: a.x, y: a.y };
    let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Bounces a velocity off a surface. Only the part going into the surface is flipped and scaled by
 * `restitution`; the sliding part is kept. A velocity already moving away is returned unchanged.
 * @param {Vec2} velocity - Incoming velocity (ft/s).
 * @param {Vec2} normal - Surface normal pointing out of the surface (any length; zero → no change).
 * @param {number} restitution - 0 (dead stop into the surface) to 1 (perfect bounce).
 * @returns {Vec2} New velocity.
 */
export function reflectVelocity(velocity, normal, restitution) {
    const length = Math.hypot(normal.x, normal.y);
    if (length === 0) return { x: velocity.x, y: velocity.y };
    const nx = normal.x / length;
    const ny = normal.y / length;
    const into = velocity.x * nx + velocity.y * ny;
    if (into >= 0) return { x: velocity.x, y: velocity.y };
    const k = (1 + restitution) * into;
    return { x: velocity.x - k * nx, y: velocity.y - k * ny };
}
