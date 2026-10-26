// Official integration surface: https://docs.sillytavern.app/for-contributors/writing-extensions/
import { receipt, readHistory } from './core.js';
import { createAutoEngine, normalizeAuto, loadAuto, HISTORY_KEY, SETTINGS_KEY } from './auto.js';
const CHANNEL = 'fate-dice-tray-v1';
const panelURL = new URL('./panel.html?embedded=1', import.meta.url);
let container, frame, observer, readyHandler, context, previousFocus, drag;
const abort = new AbortController();
let memoryHistory = [], memorySettings = loadAuto(), latestAuto, historyStorageBroken = false, settingsStorageBroken = false;
function getHistory() { if (!historyStorageBroken) try { memoryHistory = readHistory(localStorage.getItem(HISTORY_KEY)); } catch { historyStorageBroken = true; } return memoryHistory; }
function saveHistory(items) { memoryHistory = items; try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); historyStorageBroken = false; } catch { historyStorageBroken = true; } }
function getSettings() { if (!settingsStorageBroken) try { memorySettings = loadAuto(localStorage.getItem(SETTINGS_KEY)); } catch { settingsStorageBroken = true; } return memorySettings; }
function openPanel(focus = true) {
    if (!container) {
        container = document.createElement('section');
        container.id = 'fate-dice-tray-window';
        container.setAttribute('aria-label', '命运骰台');
        frame = document.createElement('iframe');
        frame.src = panelURL.href;
        frame.title = '命运骰台独立面板';
        container.append(frame);
        document.body.append(container);
    }
    if (focus) previousFocus = document.activeElement;
    container.hidden = false;
    if (focus) frame.focus();
}
function closePanel() { if (container) container.hidden = true; previousFocus?.focus?.(); }
function mount() {
    if (abort.signal.aborted) return;
    const menu = document.getElementById('extensionsMenu');
    const settings = document.getElementById('extensions_settings2');
    if (menu && !document.getElementById('fate-dice-tray-open')) {
        const button = document.createElement('button');
        button.id = 'fate-dice-tray-open';
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
    if (menu && settings) { observer?.disconnect(); observer = undefined; }
}
function reply(data) { frame?.contentWindow?.postMessage({ channel: CHANNEL, ...data }, location.origin); }
function clampWindow() {
    if (!container || container.classList.contains('fdt-max') || innerWidth <= 600) return;
    const r = container.getBoundingClientRect();
    container.style.left = `${Math.max(10, Math.min(r.left, innerWidth - Math.min(r.width, innerWidth - 20) - 10))}px`;
    container.style.top = `${Math.max(10, Math.min(r.top, innerHeight - Math.min(r.height, innerHeight - 20) - 10))}px`;
    container.style.right = 'auto';
}
window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    const data = event.data;
    if (data.action === 'hello') reply({ action: 'connected', settings: getSettings(), history: getHistory(), latestAuto });
    if (data.action === 'settings') {
        try { memorySettings = normalizeAuto(data.settings); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(memorySettings)); settingsStorageBroken = false; } catch { settingsStorageBroken = true; } reply({ action: 'notice', text: settingsStorageBroken ? '设置临时生效；浏览器无法保存，刷新后会丢失。' : '自动判定设置已更新。' }); }
        catch (error) { reply({ action: 'notice', text: error.message }); }
    }
    if (data.action === 'history') saveHistory(readHistory(JSON.stringify(data.history)));
    if (data.action === 'close') closePanel();
    if (data.action === 'maximize') { container.classList.toggle('fdt-max'); clampWindow(); }
    if (data.action === 'insert') {
        const r = readHistory(JSON.stringify([data.result]))[0];
        const textarea = document.getElementById('send_textarea');
        if (!r || !textarea || textarea.disabled) { reply({ action: 'notice', text: '当前聊天输入框不可用，未写入。' }); return; }
        textarea.value += `${textarea.value.trim() ? '\n\n' : ''}${receipt(r)}`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        reply({ action: 'notice', text: '已加入聊天草稿，尚未发送。' });
    }
    if (data.action === 'drag-start' && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        const r = container.getBoundingClientRect(); drag = { x: data.x, y: data.y, left: r.left, top: r.top };
    }
    if (data.action === 'drag-move' && drag && !container.classList.contains('fdt-max') && innerWidth > 600 && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        container.style.left = `${drag.left + data.x - drag.x}px`; container.style.top = `${drag.top + data.y - drag.y}px`; container.style.right = 'auto'; clampWindow();
    }
    if (data.action === 'drag-end') drag = undefined;
}, { signal: abort.signal });
window.addEventListener('resize', clampWindow, { signal: abort.signal });
export function onDisable() {
    abort.abort(); observer?.disconnect(); container?.remove();
    if (globalThis.fateDiceTrayIntercept === automaticInterceptor) delete globalThis.fateDiceTrayIntercept;
    document.getElementById('fate-dice-tray-open')?.remove(); document.getElementById('fate-dice-tray-settings')?.remove();
    if (readyHandler) context?.eventSource?.removeListener?.(context.eventTypes?.APP_READY ?? context.event_types?.APP_READY, readyHandler);
}
const automaticInterceptor = createAutoEngine({
    getContext: () => SillyTavern.getContext(), getSettings, getHistory, saveHistory,
    publish: data => {
        latestAuto = { ...data, memoryOnly: historyStorageBroken };
        if (data.showWindow) openPanel(false);
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
