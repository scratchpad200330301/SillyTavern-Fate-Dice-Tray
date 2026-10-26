import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitRect, resizeRect, moveRect } from '../floating-window.js';
const viewport = { width: 1200, height: 900 };
const original = { left: 300, top: 200, width: 500, height: 400 };
test('four edges resize the intended side and anchor the opposite side', () => {
    assert.deepEqual(resizeRect(original, 'e', 50, 70, viewport), { ...original, width: 550 });
    assert.deepEqual(resizeRect(original, 'w', -50, 70, viewport), { ...original, left: 250, width: 550 });
    assert.deepEqual(resizeRect(original, 'n', 50, -30, viewport), { ...original, top: 170, height: 430 });
    assert.deepEqual(resizeRect(original, 's', 50, 30, viewport), { ...original, height: 430 });
});
test('four corners change both axes without moving the opposite corner', () => {
    for (const direction of ['nw', 'ne', 'sw', 'se']) {
        const dx = direction.includes('w') ? -40 : 40, dy = direction.includes('n') ? -30 : 30;
        const r = resizeRect(original, direction, dx, dy, viewport);
        assert.equal(r.width, 540); assert.equal(r.height, 430);
        assert.equal(r.left, direction.includes('w') ? 260 : 300); assert.equal(r.top, direction.includes('n') ? 170 : 200);
    }
});
test('resize cannot invert or cross the viewport; minimum size keeps opposite edge fixed', () => {
    const narrow = resizeRect(original, 'nw', 10000, 10000, viewport);
    assert.equal(narrow.width, 320); assert.equal(narrow.height, 260);
    assert.equal(narrow.left + narrow.width, 800); assert.equal(narrow.top + narrow.height, 600);
    const expanded = resizeRect(original, 'se', 10000, 10000, viewport);
    assert.equal(expanded.left + expanded.width, 1190); assert.equal(expanded.top + expanded.height, 890);
});
test('small screens shrink below desktop minimum while keeping all controls reachable', () => {
    const r = fitRect(original, { width: 300, height: 230 });
    assert.deepEqual(r, { left: 10, top: 10, width: 280, height: 210 });
    const shrunk = resizeRect(r, 'nw', 500, 500, { width: 300, height: 230 });
    assert.deepEqual(shrunk, r);
});
test('move clamps full windows and mini bars using their own minimum sizes', () => {
    const r = moveRect(original, -1000, 1000, viewport);
    assert.equal(r.left, 10); assert.equal(r.top, 490);
    const mini = fitRect({ left: 1190, top: 890, width: 238, height: 44 }, viewport, { width: 180, height: 44 });
    assert.deepEqual(mini, { left: 952, top: 846, width: 238, height: 44 });
});
