import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInput, DEFAULT_AUTO, createAutoEngine, normalizeAuto } from '../auto.js';
import { createRoll, readHistory } from '../core.js';
const selective = { ...DEFAULT_AUTO, fallbackEvent: false };
test('user examples select action vs rest; transparent fallback and opt-out', () => {
    assert.equal(classifyInput('织田跳跃躲开了斩击。').config.kind, 'action');
    assert.equal(classifyInput('织田在床上睡觉，睡到了第二天早上六点。').config.kind, 'event');
    assert.equal(classifyInput('我问她今天过得怎么样？').reason, '每轮背景事件检定');
    assert.equal(classifyInput('我问她今天过得怎么样？', selective), null);
    assert.equal(classifyInput('我没有攻击，也不逃跑。', selective), null);
    assert.equal(classifyInput('「你要躲避攻击吗？」', selective), null);
    for (const text of ['【不掷骰】我跳跃', 'OOC: 修改设定', '/roll 1d20', '', '【命运骰台｜行动检定】掷骰结果']) assert.equal(classifyInput(text), null);
    assert.equal(classifyInput('我跳跃', { ...DEFAULT_AUTO, enabled: false }), null);
    assert.throws(() => normalizeAuto({ dc: 0 }));
});
function fixture() {
    const user = { is_user: true, is_system: false, name: '织田', mes: '织田跳跃躲开了斩击。', send_date: '2026-10-26T12:00:00Z', extra: { private: 1 } };
    const ctx = { chat: [user], characterId: 2, groupId: null, chatId: 'fate-1' };
    let history = [], settings = { ...DEFAULT_AUTO }, calls = 0;
    const published = [];
    const deps = { getContext: () => ctx, getSettings: () => settings, getHistory: () => history, saveHistory: h => history = h, publish: x => published.push(x), makeRoll: c => { calls++; return createRoll(c, () => 9); } };
    return { ctx, user, deps, published, get history() { return history; }, set history(v) { history = v; }, get calls() { return calls; }, set settings(v) { settings = v; } };
}
test('interceptor injects before generation without changing saved message', () => {
    const f = fixture(), engine = createAutoEngine(f.deps); const core = [...f.ctx.chat];
    engine(core, 10000, () => assert.fail('must not abort'), undefined);
    assert.equal(f.calls, 1); assert.equal(f.history.length, 1);
    assert.notEqual(core[0], f.user); assert.equal(f.user.mes, '织田跳跃躲开了斩击。');
    assert.match(core[0].mes, /<命运骰台自动裁定>/); assert.match(core[0].mes, /检定失败/); assert.match(core[0].mes, /原始点数：9/);
    assert.deepEqual(f.user.extra, { private: 1 }); assert.equal(f.published.at(-1).fresh, true);
});
test('same turn reuse across normal, regenerate, swipe, continue and page reload', () => {
    const f = fixture(); let engine = createAutoEngine(f.deps); const core = [...f.ctx.chat];
    engine(core, 100, null, 'normal'); const id = f.history[0].id;
    f.settings = { ...DEFAULT_AUTO, dc: 99 };
    for (const type of ['normal', 'regenerate', 'swipe', 'continue']) engine(core, 100, null, type);
    assert.equal(f.calls, 1); assert.equal(core[0].mes.match(/<命运骰台自动裁定>/g).length, 1); assert.match(core[0].mes, /难度 DC 12/);
    f.history = readHistory(JSON.stringify(f.history)); engine = createAutoEngine(f.deps); engine([...f.ctx.chat], 100, null, 'swipe');
    assert.equal(f.calls, 1); assert.equal(f.history[0].id, id); assert.equal(f.published.at(-1).fresh, false);
});
test('quiet, impersonate, unknown and disabled do not roll; continue cannot create a roll', () => {
    const f = fixture(), engine = createAutoEngine(f.deps);
    for (const type of ['quiet', 'impersonate', 'other', 'continue']) engine([...f.ctx.chat], 100, null, type);
    f.settings = { ...DEFAULT_AUTO, enabled: false }; engine([...f.ctx.chat], 100, null, 'normal');
    assert.equal(f.calls, 0);
});
test('group members share one roll but edits and separate chats do not', () => {
    const f = fixture(), engine = createAutoEngine(f.deps); f.ctx.groupId = 5;
    engine([...f.ctx.chat], 100, null, 'normal');
    f.ctx.characterId = 8; engine([...f.ctx.chat], 100, null, 'normal'); assert.equal(f.calls, 1);
    f.ctx.chatId = 'fate-2'; engine([...f.ctx.chat], 100, null, 'normal'); assert.equal(f.calls, 2);
    f.user.mes += '并反击'; engine([...f.ctx.chat], 100, null, 'normal'); assert.equal(f.calls, 3);
});
test('background generation without identity or user message is skipped', () => {
    const f = fixture(), engine = createAutoEngine(f.deps);
    engine([{ is_user: false, mes: '工具' }], 100, null, 'normal');
    f.ctx.chatId = ''; engine([...f.ctx.chat], 100, null, 'normal'); assert.equal(f.calls, 0);
});
test('RNG failure blocks generation rather than fabricating a result', () => {
    const f = fixture(); let aborted;
    const engine = createAutoEngine({ ...f.deps, makeRoll: () => { throw Error('RNG unavailable'); } });
    const core = [...f.ctx.chat]; engine(core, 100, value => aborted = value, 'normal');
    assert.equal(aborted, true); assert.equal(f.history.length, 0); assert.equal(core[0], f.user);
    assert.equal(f.published.at(-1).error, true);
});
