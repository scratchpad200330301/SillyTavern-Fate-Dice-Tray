import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomDie, resolveRoll, createRoll, readHistory, receipt, normalizeConfig } from '../core.js';
const base = { kind: 'action', mode: 'normal', modifier: 0, target: 12 };
test('RNG rejects biased tail rather than applying modulo', () => {
    const values = [4294967295, 19]; let calls = 0;
    assert.equal(randomDie(20, a => { a[0] = values[calls++]; }), 20);
    assert.equal(calls, 2);
    assert.equal(randomDie(4, a => { a[0] = 4294967295; }), 4);
    assert.equal(randomDie(100, a => { a[0] = 0; }), 1);
    assert.throws(() => randomDie(20, a => { a[0] = 4294967295; }), /随机源/);
});
test('DC equality passes; negative modifiers and natural 20 obey configured DC', () => {
    assert.equal(resolveRoll(base, [12]).outcome, 'success');
    assert.equal(resolveRoll(base, [11]).outcome, 'failure');
    assert.equal(resolveRoll({ ...base, modifier: -2 }, [13]).total, 11);
    assert.equal(resolveRoll({ ...base, target: 25 }, [20]).outcome, 'failure');
});
test('advantage/disadvantage keep exactly one die, then apply modifier once', () => {
    assert.equal(resolveRoll({ ...base, mode: 'advantage', modifier: 3 }, [2, 17]).total, 20);
    assert.equal(resolveRoll({ ...base, mode: 'disadvantage', modifier: 3 }, [2, 17]).total, 5);
    assert.throws(() => resolveRoll({ ...base, mode: 'advantage' }, [12]), /数量/);
});
test('event probability includes threshold and handles 0% and 100%', () => {
    const c = { kind: 'event', target: 20 };
    assert.equal(resolveRoll(c, [20]).outcome, 'triggered');
    assert.equal(resolveRoll(c, [21]).outcome, 'quiet');
    assert.equal(resolveRoll({ ...c, target: 0 }, [1]).outcome, 'quiet');
    assert.equal(resolveRoll({ ...c, target: 100 }, [100]).outcome, 'triggered');
});
test('free dice sum all dice without success/failure', () => {
    const r = resolveRoll({ kind: 'free', sides: 6, count: 3, modifier: -2 }, [1, 6, 3]);
    assert.equal(r.total, 8); assert.equal(r.outcome, 'rolled');
});
test('invalid configs and forged records cannot enter history', () => {
    for (const input of [{ ...base, target: '' }, { ...base, modifier: 1.5 }, { ...base, mode: 'cheat' }, { kind: 'free', sides: 7, count: 1, modifier: 0 }, { kind: 'free', sides: 6, count: 10000, modifier: 0 }]) assert.throws(() => normalizeConfig(input));
    assert.throws(() => resolveRoll(base, [21]));
    const r = createRoll(base, () => 15);
    assert.deepEqual(readHistory(JSON.stringify([{ ...r, total: 99 }, r, { ...r, config: null }])), [r]);
    assert.deepEqual(readHistory('broken'), []);
    assert.deepEqual(readHistory('{}'), []);
    assert.equal(readHistory(JSON.stringify(Array(120).fill(r))).length, 100);
});
test('roll config is a frozen snapshot, receipt retains all original dice', () => {
    const input = { ...base, note: '跳跃躲避', mode: 'advantage' }; let i = 0;
    const r = createRoll(input, () => [3, 18][i++]); input.target = 100;
    assert.equal(i, 2); assert.equal(r.config.target, 12);
    assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.config)); assert.ok(Object.isFrozen(r.rolls));
    assert.match(receipt(r), /3、18/); assert.match(receipt(r), /取高/); assert.match(receipt(r), /难度 DC 12/);
    assert.notEqual(r.id, createRoll(base, () => 12).id);
});
