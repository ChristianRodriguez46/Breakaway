// Test random functions (TEST_PLAN §3.1). The real seeded generator lives in src/core/random.js.

/** Returns the same value forever. @param {number} value @returns {() => number} */
export function constantRng(value) {
    return () => value;
}

/**
 * Returns the listed values in order and throws when they run out, so an unexpected extra draw fails loudly.
 * @param {number[]} values @returns {() => number}
 */
export function sequenceRng(values) {
    let index = 0;
    return () => {
        if (index >= values.length) throw new Error(`sequenceRng exhausted after ${values.length} draws`);
        return values[index++];
    };
}

/** Wraps a random function and counts calls in `.calls`. @param {() => number} inner */
export function countingRng(inner) {
    const wrapped = () => { wrapped.calls += 1; return inner(); };
    wrapped.calls = 0;
    return wrapped;
}

export const SEED_A = 1;
export const SEED_B = 2;
export const SEED_C = 3;
