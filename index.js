// Official integration surface: https://docs.sillytavern.app/for-contributors/writing-extensions/
import { receipt, readHistory } from './core.js';
import { createAutoEngine, normalizeAuto, loadAuto, HISTORY_KEY, SETTINGS_KEY } from './auto.js';
import { createFloatingWindow } from './floating-window.js';
const CHANNEL = 'fate-dice-tray-v1';
const panelURL = new URL('./panel.html?embedded=1', import.meta.url);
let container, frame, floating, observer, readyHandler, context, previousFocus;
const abort = new AbortController();
let memoryHistory = [], memorySettings = loadAuto(), latestAuto, historyStorageBroken = false, settingsStorageBroken = false;
function getHistory() { if (!historyStorageBroken) try { memoryHistory = readHistory(localStorage.getItem(HISTORY_KEY)); } catch { historyStorageBroken = true; } return memoryHistory; }
function saveHistory(items) { memoryHistory = items; try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); historyStorageBroken = false; } catch { historyStorageBroken = true; } }
function getSettings() { if (!settingsStorageBroken) try { memorySettings = loadAuto(localStorage.getItem(SETTINGS_KEY)); } catch { settingsStorageBroken = true; } return memorySettings; }
function openPanel(focus = true) {
    if (!container) {
        floating = createFloatingWindow(panelURL, { signal: abort.signal, onVisibility: updateDock });
        container = floating.element; frame = floating.frame;
        floating.updateResult(getHistory()[0] ?? latestAuto?.result);
    }
    if (focus) previousFocus = document.activeElement;
    floating.open(focus);
}
function closePanel() { floating?.hide(); previousFocus?.focus?.(); }
function updateDock() {
    const expanded = !!container && !container.hidden && floating?.mode !== 'minimized';
    for (const id of ['fate-dice-tray-open', 'fate-dice-tray-input-open']) document.getElementById(id)?.setAttribute('aria-expanded', String(expanded));
}
function mount() {
    if (abort.signal.aborted) return;
    const menu = document.getElementById('extensionsMenu');
    const settings = document.getElementById('extensions_settings2');
    const sendForm = document.getElementById('send_form') ?? document.getElementById('send_textarea')?.closest('form');
    if (sendForm?.parentElement) {
        let dock = document.getElementById('fate-dice-tray-input-dock');
        if (!dock) {
            dock = document.createElement('div'); dock.id = 'fate-dice-tray-input-dock'; dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', '命运骰台快捷入口');
            const button = document.createElement('button'); button.id = 'fate-dice-tray-input-open'; button.type = 'button'; button.className = 'menu_button';
            button.setAttribute('aria-controls', 'fate-dice-tray-window'); button.setAttribute('aria-expanded', 'false'); button.title = '打开或展开命运骰台';
            const icon = document.createElement('i'); icon.className = 'fa-solid fa-dice'; icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span'); label.textContent = '命运骰台'; button.append(icon, label);
            button.addEventListener('click', openPanel, { signal: abort.signal }); dock.append(button);
        }
        if (dock.parentElement !== sendForm.parentElement || dock.nextElementSibling !== sendForm) sendForm.before(dock);
    }
    if (menu && !document.getElementById('fate-dice-tray-open')) {
        const button = document.createElement('button');
        button.id = 'fate-dice-tray-open';
        button.type = 'button'; button.setAttribute('aria-controls', 'fate-dice-tray-window');
        button.className = 'list-group-item flex-container flexGap5';
        const icon = document.createElement('i'); icon.className = 'fa-solid fa-dice'; icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = '命运骰台';
        button.append(icon, label);
        button.addEventListener('click', openPanel, { signal: abort.signal });
        (document.getElementById('dice_wand_container') ?? menu).append(button);
    }
    if (settings && !document.getElementById('fate-dice-tray-settings')) {
        const section = document.createElement('div'); section.id = 'fate-dice-tray-settings';
        const button = document.createElement('button'); button.className = 'menu_button'; button.textContent = '打开命运骰台';
        button.addEventListener('click', openPanel, { signal: abort.signal });
        const hint = document.createElement('small'); hint.textContent = '生成前自动掷骰 · 悬浮窗口显示 · 无需额外模型';
        section.append(button, hint); settings.append(section);
    }
    updateDock();
}
function reply(data) { frame?.contentWindow?.postMessage({ channel: CHANNEL, ...data }, location.origin); }
window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    const data = event.data;
    if (data.action === 'hello') reply({ action: 'connected', settings: getSettings(), history: getHistory(), latestAuto });
    if (data.action === 'settings') {
        try { memorySettings = normalizeAuto(data.settings); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(memorySettings)); settingsStorageBroken = false; } catch { settingsStorageBroken = true; } reply({ action: 'notice', text: settingsStorageBroken ? '设置临时生效；浏览器无法保存，刷新后会丢失。' : '自动判定设置已更新。' }); }
        catch (error) { reply({ action: 'notice', text: error.message }); }
    }
    if (data.action === 'history') { const history = readHistory(JSON.stringify(data.history)); saveHistory(history); floating.updateResult(history[0]); }
    if (data.action === 'close') closePanel();
    if (data.action === 'minimize') floating.minimize();
    if (data.action === 'maximize') floating.toggleMaximize();
    if (data.action === 'insert') {
        const r = readHistory(JSON.stringify([data.result]))[0];
        const textarea = document.getElementById('send_textarea');
        if (!r || !textarea || textarea.disabled) { reply({ action: 'notice', text: '当前聊天输入框不可用，未写入。' }); return; }
        textarea.value += `${textarea.value.trim() ? '\n\n' : ''}${receipt(r)}`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        reply({ action: 'notice', text: '已加入聊天草稿，尚未发送。' });
    }
    if (data.action === 'drag-start' && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        floating.dragStart(data.x, data.y);
    }
    if (data.action === 'drag-move' && Number.isFinite(data.x) && Number.isFinite(data.y)) floating.dragMove(data.x, data.y);
    if (data.action === 'drag-end') floating.dragEnd();
}, { signal: abort.signal });
export function onDisable() {
    abort.abort(); observer?.disconnect(); container?.remove();
    if (globalThis.fateDiceTrayIntercept === automaticInterceptor) delete globalThis.fateDiceTrayIntercept;
    document.getElementById('fate-dice-tray-open')?.remove(); document.getElementById('fate-dice-tray-settings')?.remove();
    document.getElementById('fate-dice-tray-input-dock')?.remove();
    if (readyHandler) context?.eventSource?.removeListener?.(context.eventTypes?.APP_READY ?? context.event_types?.APP_READY, readyHandler);
}
const automaticInterceptor = createAutoEngine({
    getContext: () => SillyTavern.getContext(), getSettings, getHistory, saveHistory,
    publish: data => {
        latestAuto = { ...data, memoryOnly: historyStorageBroken };
        if (data.showWindow && (!floating || (!container.hidden && floating.mode !== 'minimized'))) openPanel(false);
        if (data.result) floating?.updateResult(data.result);
        reply({ action: 'automatic', ...latestAuto, history: getHistory() });
        if (data.error) globalThis.toastr?.error?.(data.text, '命运骰台');
    },
});
function initialize() {
    if (!globalThis.SillyTavern?.getContext) { console.warn('[命运骰台] 缺少 SillyTavern.getContext，未初始化。'); return; }
    context = SillyTavern.getContext();
    globalThis.fateDiceTrayIntercept = automaticInterceptor;
    // APP_READY is the documented async initialization point. DOM observation also covers late loading.
    readyHandler = () => { setTimeout(mount, 0); };
    const event = context.eventTypes?.APP_READY ?? context.event_types?.APP_READY;
    if (event) context.eventSource?.on(event, readyHandler);
    observer = new MutationObserver(mount); observer.observe(document.body, { childList: true, subtree: true }); mount();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true, signal: abort.signal }); else initialize();
