// In-memory stand-ins for window.localStorage (TEST_PLAN §3.4).

/** A Map-backed Storage. @param {Record<string, string>} [initial] */
export function createFakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: (key) => { map.delete(key); },
        key: (index) => [...map.keys()][index] ?? null,
        get length() { return map.size; },
        clear: () => map.clear(),
        dump: () => Object.fromEntries(map)
    };
}

/** A Storage whose chosen methods throw, like private mode or a full quota. */
export function createThrowingStorage({ onGet = false, onSet = false, onRemove = false } = {}) {
    const inner = createFakeStorage();
    const fail = () => { throw new Error('SecurityError: storage blocked'); };
    return {
        ...inner,
        getItem: onGet ? fail : inner.getItem,
        setItem: onSet ? fail : inner.setItem,
        removeItem: onRemove ? fail : inner.removeItem,
        get length() { return inner.length; }
    };
}
