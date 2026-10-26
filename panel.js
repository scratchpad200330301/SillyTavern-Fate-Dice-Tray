import { createRoll, normalizeConfig, formula, receipt, readHistory, KINDS, OUTCOMES } from './core.js';
import { loadAuto, normalizeAuto, classifyInput, HISTORY_KEY, SETTINGS_KEY } from './auto.js';
const $ = id => document.getElementById(id);
const CHANNEL = 'fate-dice-tray-v1';
const STORAGE = HISTORY_KEY;
const embedded = new URLSearchParams(location.search).get('embedded') === '1' && window.parent !== window;
let connected = false, kind = 'action', current, busy = false, memoryOnly = false, history = [];
let autoSettings = loadAuto(), queuedAutomatic;
try { history = readHistory(localStorage.getItem(STORAGE)); } catch { memoryOnly = true; }
try { autoSettings = loadAuto(localStorage.getItem(SETTINGS_KEY)); } catch { /* Use defaults. */ }
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function send(action, data = {}) { if (embedded && location.origin !== 'null') parent.postMessage({ channel: CHANNEL, action, ...data }, location.origin); }
function config() {
    return normalizeConfig({ kind, note: $('note').value, mode: $('mode').value, modifier: $(kind === 'free' ? 'free-mod' : 'action-mod').value, sides: $('sides').value, count: $('count').value, target: $(kind === 'event' ? 'chance' : 'dc').value });
}
function updateForm() {
    for (const pane of document.querySelectorAll('[role=tabpanel]')) {
        pane.hidden = pane.id !== `pane-${kind}`;
        for (const input of pane.querySelectorAll('input,select')) input.disabled = pane.hidden || busy;
    }
    try {
        const c = config();
        $('roll-tag').textContent = `D${c.sides}`;
        if (!current) $('result-formula').textContent = `${c.count}d${c.sides}${kind === 'action' ? ` · DC ${c.target}` : kind === 'event' ? ` · ${c.target}%` : ''}`;
    } catch { /* Native form validation handles temporarily empty fields. */ }
}
function chooseTab(next) {
    if (busy) return;
    kind = next;
    for (const tab of document.querySelectorAll('[role=tab]')) { const selected = tab.dataset.kind === kind; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
    updateForm();
}
for (const tab of document.querySelectorAll('[role=tab]')) {
    tab.addEventListener('click', () => chooseTab(tab.dataset.kind));
    tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
        event.preventDefault();
        const tabs = [...document.querySelectorAll('[role=tab]')]; const i = tabs.indexOf(tab);
        const n = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        chooseTab(tabs[n].dataset.kind); tabs[n].focus();
    });
}
$('roll-form').addEventListener('input', updateForm);
function showResult(r) {
    current = r;
    $('result').dataset.outcome = r.outcome;
    $('result-label').textContent = `${KINDS[r.config.kind]} · 已记录`;
    $('result-formula').textContent = formula(r) + (r.config.kind === 'action' ? ` · DC ${r.config.target}` : r.config.kind === 'event' ? ` · ${r.config.target}%` : '');
    $('result-value').textContent = r.total;
    $('result-outcome').textContent = OUTCOMES[r.outcome];
    const modeText = r.config.mode === 'advantage' ? `；取高 ${r.kept}` : r.config.mode === 'disadvantage' ? `；取低 ${r.kept}` : '';
    const natural = r.config.kind === 'action' && [1, 20].includes(r.kept) ? ` · 自然 ${r.kept}` : '';
    $('result-detail').textContent = `原始点数 ${r.rolls.join('、')}${modeText} · 修正 ${r.config.modifier >= 0 ? '+' : ''}${r.config.modifier}${natural}`;
    $('copy').disabled = false; $('insert').disabled = !connected;
}
function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(history)); memoryOnly = false; } catch { memoryOnly = true; }
    if (connected) send('history', { history });
}
function formatTime(iso) { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
function renderHistory() {
    $('history-count').textContent = history.length;
    $('export').disabled = $('clear').disabled = !history.length || busy;
    if (!history.length) {
        $('history').replaceChildren();
        const empty = document.createElement('div'); empty.className = 'empty-history';
        const icon = document.createElement('span'); icon.textContent = '◇';
        const p = document.createElement('p'); p.textContent = '每一次未知，都有迹可循。';
        const small = document.createElement('small'); small.textContent = memoryOnly ? '当前环境无法保存，记录仅保留到页面关闭。' : '最近 100 次结果保存在当前浏览器。';
        empty.append(icon, p, small); $('history').append(empty); return;
    }
    const list = document.createElement('div'); list.className = 'history-list';
    for (const r of history) {
        const row = document.createElement('div'); row.className = 'history-row';
        const number = document.createElement('div'); number.className = 'history-number'; number.textContent = r.total;
        const body = document.createElement('div'); body.className = 'history-body';
        const title = document.createElement('div'); title.className = 'history-title'; title.textContent = r.config.note || KINDS[r.config.kind]; title.title = title.textContent;
        const meta = document.createElement('div'); meta.className = 'history-meta'; meta.textContent = `${r.auto ? '自动 · ' : ''}${formatTime(r.timestamp)} · ${formula(r)} · ${OUTCOMES[r.outcome]}`;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '查看'; button.title = `查看记录 ${r.id}`;
        button.disabled = busy;
        button.addEventListener('click', () => { if (busy) return; showResult(r); status('正在查看历史结果；下次掷骰使用上方当前设定。'); $('result').scrollIntoView({ block: 'nearest' }); });
        body.append(title, meta); row.append(number, body, button); list.append(row);
    }
    $('history').replaceChildren(list);
}
async function performRoll(input, autoReason) {
    if (busy) return;
    let r;
    try { r = createRoll(input); if (autoReason) r = Object.freeze({ ...r, auto: Object.freeze({ turnKey: `preview:${r.id}`, reason: autoReason }) }); } catch (error) { status(error.message, true); return; }
    // Resolve once before animation. Animation never rolls or changes the result.
    busy = true;
    $('test-auto').disabled = true;
    $('roll-button').disabled = true; $('copy').disabled = $('insert').disabled = true;
    $('note').disabled = true;
    for (const tab of document.querySelectorAll('[role=tab]')) tab.disabled = true;
    updateForm(); renderHistory();
    $('result').classList.add('rolling'); $('result').setAttribute('aria-busy', 'true'); $('result-value').textContent = '·';
    $('roll-button').querySelector('span').textContent = '正在掷骰…';
    await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480));
    if (!memoryOnly) try { history = readHistory(localStorage.getItem(STORAGE)); } catch { memoryOnly = true; }
    history.unshift(r); history = history.slice(0, 100); persist();
    busy = false; $('note').disabled = false; $('roll-button').disabled = false;
    $('test-auto').disabled = false;
    for (const tab of document.querySelectorAll('[role=tab]')) tab.disabled = false;
    $('result').classList.remove('rolling'); $('result').setAttribute('aria-busy', 'false');
    $('roll-button').querySelector('span').textContent = '掷骰判定';
    showResult(r); updateForm(); renderHistory();
    status(`${OUTCOMES[r.outcome]}，合计 ${r.total}。${memoryOnly ? '无法本地保存，请导出记录；关闭页面后会丢失。' : '结果已记录。'}${connected ? '可写入聊天草稿。' : '可复制后交给模型。'}`);
    if (autoReason) status(`输入试验：${autoReason}。${OUTCOMES[r.outcome]}，合计 ${r.total}；仅本地试掷，未发送。${memoryOnly ? '请导出以保存记录。' : ''}`);
    if (queuedAutomatic) { applyAutomatic(queuedAutomatic); queuedAutomatic = undefined; }
}
$('roll-form').addEventListener('submit', async event => {
    event.preventDefault(); try { await performRoll(config()); } catch (error) { status(error.message, true); }
});
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
        const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(area); area.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch { /* Show explicit failure below. */ } area.remove(); return ok;
    }
}
$('copy').addEventListener('click', async () => { if (current) status(await copyText(receipt(current)) ? '已复制判定记录。' : '浏览器禁止复制，请使用导出功能。'); });
$('insert').addEventListener('click', () => { if (current && connected) send('insert', { result: current }); });
$('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `命运骰台_${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('已请求下载掷骰记录。');
});
$('clear').addEventListener('click', () => {
    if (busy || !confirm('清空当前浏览器的骰子历史？此操作不能撤销；刷新页面后会失去已清空轮次的复用缓存。建议先导出。')) return;
    history = []; current = undefined; persist(); renderHistory();
    $('result-value').textContent = '—'; $('result-label').textContent = '等待第一次掷骰'; $('result-outcome').textContent = '意图不是结果'; $('result-detail').textContent = '设定条件，让随机结果留下记录。'; delete $('result').dataset.outcome;
    $('copy').disabled = $('insert').disabled = true; updateForm(); status('骰子记录已清空。');
});
function reflectSettings() {
    $('auto-enabled').checked = autoSettings.enabled; $('auto-dc').value = autoSettings.dc; $('auto-mod').value = autoSettings.modifier; $('auto-chance').value = autoSettings.chance;
    $('auto-fallback').checked = autoSettings.fallbackEvent; $('auto-show').checked = autoSettings.showWindow;
    $('auto-actions').value = autoSettings.actionWords; $('auto-rest').value = autoSettings.restWords;
    $('auto-state').textContent = autoSettings.enabled ? '已开启' : '已关闭';
}
function settingsFromForm() {
    return normalizeAuto({ enabled: $('auto-enabled').checked, dc: $('auto-dc').value, modifier: $('auto-mod').value, chance: $('auto-chance').value, fallbackEvent: $('auto-fallback').checked, showWindow: $('auto-show').checked, actionWords: $('auto-actions').value, restWords: $('auto-rest').value });
}
$('save-auto').addEventListener('click', () => {
    try {
        autoSettings = settingsFromForm(); let saved = true;
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(autoSettings)); } catch { saved = false; }
        if (connected) send('settings', { settings: autoSettings }); reflectSettings();
        status(saved ? '自动规则已保存；已判定的同一轮继续沿用原点数及原难度。' : '当前环境无法保存设置，关闭页面后会恢复默认值。');
    } catch (error) { status(error.message, true); }
});
$('test-auto').addEventListener('click', async () => {
    try { const decision = classifyInput($('test-input').value, settingsFromForm()); if (!decision) { status('该输入被跳过或没有命中规则，没有掷骰。'); return; } await performRoll(decision.config, decision.reason); }
    catch (error) { status(error.message, true); }
});
function applyAutomatic(data) {
    if (busy) { queuedAutomatic = data; return; }
    if (data.history) { history = readHistory(JSON.stringify(data.history)); renderHistory(); }
    if (data.result) { const r = readHistory(JSON.stringify([data.result]))[0]; if (r) showResult(r); }
    if (data.text) status(data.text + (data.memoryOnly ? ' · 当前记录无法保存，请导出。' : ''), data.error);
}
window.addEventListener('storage', event => {
    if (event.key === STORAGE) { history = readHistory(event.newValue); renderHistory(); }
    if (event.key === SETTINGS_KEY) { autoSettings = loadAuto(event.newValue); reflectSettings(); }
});
if (embedded) {
    document.body.classList.add('embedded'); $('window-actions').hidden = false;
    window.addEventListener('message', event => {
        if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
        if (event.data.action === 'connected') { connected = true; $('connection').textContent = '已连接酒馆 · 生成前自动判定'; $('insert').disabled = !current || busy; autoSettings = loadAuto(JSON.stringify(event.data.settings)); reflectSettings(); if (event.data.history) { history = readHistory(JSON.stringify(event.data.history)); renderHistory(); if (history[0]) showResult(history[0]); } if (event.data.latestAuto) applyAutomatic(event.data.latestAuto); }
        if (event.data.action === 'automatic') applyAutomatic(event.data);
        if (event.data.action === 'notice') status(String(event.data.text).slice(0, 300));
    });
    send('hello');
    for (const button of document.querySelectorAll('[data-host]')) button.addEventListener('click', () => send(button.dataset.host));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') send('close'); });
    const handle = $('window-handle'); let dragging = false;
    handle.addEventListener('pointerdown', event => { if (event.target.closest('button') || event.button !== 0) return; dragging = true; handle.setPointerCapture(event.pointerId); send('drag-start', { x: event.screenX, y: event.screenY }); });
    handle.addEventListener('pointermove', event => { if (dragging) send('drag-move', { x: event.screenX, y: event.screenY }); });
    const stop = () => { dragging = false; send('drag-end'); }; handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
}
updateForm(); renderHistory(); reflectSettings();
if (history[0]) showResult(history[0]);
if (memoryOnly) status('当前环境无法本地保存；请在关闭页面前导出结果。');
if (!embedded) { $('insert').title = '安装为酒馆扩展后可用；独立页面请复制结果。'; $('connection').textContent = '独立页面 · 可复制结果'; }
