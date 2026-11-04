// Unit tests for src/core/vector.js and src/core/random.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../../src/core/vector.js';
import { createRng, parseSeedParam } from '../../src/core/random.js';

const EPS = 1e-9;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < EPS, `${actual} != ${expected}`);

test('add, subtract and scale return new vectors', () => {
    const a = v.vec(1, 2);
    const sum = v.add(a, v.vec(3, 4));
    assert.deepEqual(sum, { x: 4, y: 6 });
    assert.deepEqual(v.subtract(sum, a), { x: 3, y: 4 });
    assert.deepEqual(v.scale(a, 3), { x: 3, y: 6 });
    assert.deepEqual(a, { x: 1, y: 2 }, 'inputs are not changed');
});

test('normalize gives length 1 and leaves a zero vector at zero instead of NaN', () => {
    near(v.lengthOf(v.normalize(v.vec(3, 4))), 1);
    assert.deepEqual(v.normalize(v.vec(0, 0)), { x: 0, y: 0 });
});

test('clampLength shortens only vectors longer than the limit', () => {
    near(v.lengthOf(v.clampLength(v.vec(30, 40), 10)), 10);
    assert.deepEqual(v.clampLength(v.vec(3, 4), 10), { x: 3, y: 4 });
});

test('dot product is zero for perpendicular vectors', () => {
    const up = v.vec(0, -1);
    assert.equal(v.dot(up, v.perpendicular(up)), 0);
    assert.deepEqual(v.perpendicular(up), { x: -1, y: -0 });
});

test('rotate by a quarter turn moves +x to +y (clockwise on screen)', () => {
    const turned = v.rotate(v.vec(1, 0), Math.PI / 2);
    near(turned.x, 0);
    near(turned.y, 1);
});

test('fromAngle and angleOf round-trip', () => {
    near(v.angleOf(v.fromAngle(-Math.PI / 2, 5)), -Math.PI / 2);
    near(v.lengthOf(v.fromAngle(1.2, 5)), 5);
});

test('lerp interpolates between two points', () => {
    assert.deepEqual(v.lerp(v.vec(0, 0), v.vec(10, 20), 0.25), { x: 2.5, y: 5 });
});

test('into-helpers write into the target and return it', () => {
    const target = v.vec(0, 0);
    assert.equal(v.copyInto(target, v.vec(7, 8)), target);
    assert.deepEqual(target, { x: 7, y: 8 });
    v.setInto(target, 1, 2);
    assert.deepEqual(target, { x: 1, y: 2 });
});

test('the same seed always gives the same sequence', () => {
    const first = createRng(42);
    const second = createRng(42);
    for (let i = 0; i < 100; i += 1) assert.equal(first(), second());
});

test('different seeds give different sequences', () => {
    assert.notEqual(createRng(1)(), createRng(2)());
});

test('random values stay in [0, 1) and average near one half', () => {
    const random = createRng(7);
    let total = 0;
    const draws = 10000;
    for (let i = 0; i < draws; i += 1) {
        const value = random();
        assert.ok(value >= 0 && value < 1);
        total += value;
    }
    assert.ok(Math.abs(total / draws - 0.5) < 0.02);
});

test('parseSeedParam accepts whole numbers in range and rejects anything else', () => {
    assert.equal(parseSeedParam('?seed=42'), 42);
    assert.equal(parseSeedParam('?seed=0'), 0);
    assert.equal(parseSeedParam('?seed=4294967295'), 4294967295);
    for (const search of ['', '?seed=', '?seed=-1', '?seed=1.5', '?seed=abc', '?seed=4294967296', '?other=3']) {
        assert.equal(parseSeedParam(search), null, search);
    }
});
