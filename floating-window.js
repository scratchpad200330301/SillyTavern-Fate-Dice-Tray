const clamp = (n, low, high) => Math.max(low, Math.min(n, high));
function bounds(viewport, minimum = { width: 320, height: 260 }) {
    const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height);
    const margin = Math.min(10, Math.floor(Math.min(width, height) / 4));
    return { width, height, margin, maxW: width - margin * 2, maxH: height - margin * 2,
        minW: Math.min(minimum.width, width - margin * 2), minH: Math.min(minimum.height, height - margin * 2) };
}
export function fitRect(rect, viewport, minimum) {
    const b = bounds(viewport, minimum);
    const width = clamp(rect.width, b.minW, b.maxW), height = clamp(rect.height, b.minH, b.maxH);
    return { left: clamp(rect.left, b.margin, b.width - b.margin - width), top: clamp(rect.top, b.margin, b.height - b.margin - height), width, height };
}
export function moveRect(rect, dx, dy, viewport, minimum) {
    return fitRect({ ...rect, left: rect.left + dx, top: rect.top + dy }, viewport, minimum);
}
export function resizeRect(rect, direction, dx, dy, viewport) {
    const b = bounds(viewport), r = fitRect(rect, viewport);
    let left = r.left, top = r.top, right = left + r.width, bottom = top + r.height;
    if (direction.includes('w')) left = clamp(left + dx, b.margin, right - b.minW);
    if (direction.includes('e')) right = clamp(right + dx, left + b.minW, b.width - b.margin);
    if (direction.includes('n')) top = clamp(top + dy, b.margin, bottom - b.minH);
    if (direction.includes('s')) bottom = clamp(bottom + dy, top + b.minH, b.height - b.margin);
    return { left, top, width: right - left, height: bottom - top };
}
export function createFloatingWindow(panelURL, { signal, onVisibility = () => {} } = {}) {
    const controller = new AbortController(), options = { signal: controller.signal };
    const viewport = () => ({ width: innerWidth, height: innerHeight });
    const minimumMini = { width: 180, height: 44 };
    let normal = fitRect({ left: innerWidth * .96 - 600, top: innerHeight * .06, width: 600, height: 820 }, viewport());
    let mini = { ...normal, width: 238, height: 44 }, mode = 'normal', restoreMode = 'normal', gesture;
    const element = document.createElement('section'); element.id = 'fate-dice-tray-window'; element.hidden = true; element.setAttribute('aria-label', '命运骰台');
    const frame = document.createElement('iframe'); frame.src = panelURL.href; frame.title = '命运骰台独立面板';
    const miniBar = document.createElement('div'); miniBar.id = 'fate-dice-tray-mini'; miniBar.hidden = true;
    const miniGrip = document.createElement('span'); miniGrip.className = 'fdt-mini-grip'; miniGrip.textContent = '⠿'; miniGrip.setAttribute('aria-hidden', 'true');
    const miniLabel = document.createElement('span'); miniLabel.className = 'fdt-mini-label'; miniLabel.textContent = '命运骰台';
    const result = document.createElement('span'); result.id = 'fate-dice-tray-mini-result'; result.textContent = '待掷骰';
    const expand = document.createElement('button'); expand.type = 'button'; expand.textContent = '展开'; expand.title = '展开命运骰台'; expand.setAttribute('aria-label', '展开命运骰台');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.title = '隐藏命运骰台'; close.setAttribute('aria-label', '隐藏命运骰台');
    miniBar.append(miniGrip, miniLabel, result, expand, close); element.append(frame, miniBar);
    const directions = { n: '上边缘', s: '下边缘', w: '左边缘', e: '右边缘', nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' };
    for (const [direction, label] of Object.entries(directions)) {
        const handle = document.createElement('div'); handle.className = `fdt-resize fdt-resize-${direction}`; handle.dataset.direction = direction;
        handle.tabIndex = 0; handle.setAttribute('role', 'button'); handle.setAttribute('aria-label', `拖动调整窗口${label}`); handle.title = `拖动${label}调整大小；方向键也可调整`;
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || mode !== 'normal') return;
            event.preventDefault();
            gesture = { kind: 'resize', direction, x: event.clientX, y: event.clientY, start: { ...normal }, pointerId: event.pointerId, target: handle };
            element.classList.add('fdt-interacting', 'fdt-resizing'); handle.setPointerCapture(event.pointerId);
        }, options);
        handle.addEventListener('pointermove', event => {
            if (gesture?.kind !== 'resize' || gesture.pointerId !== event.pointerId) return;
            normal = resizeRect(gesture.start, direction, event.clientX - gesture.x, event.clientY - gesture.y, viewport()); render();
        }, options);
        handle.addEventListener('keydown', event => {
            if (mode !== 'normal' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); const step = event.shiftKey ? 1 : 10;
            normal = resizeRect(normal, direction, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, viewport()); render();
        }, options);
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, endGesture, options);
        element.append(handle);
    }
    function render() {
        const small = mode === 'minimized';
        const r = small ? (mini = fitRect(mini, viewport(), minimumMini)) : mode === 'maximized'
            ? fitRect({ left: 0, top: 0, width: innerWidth, height: innerHeight }, viewport()) : (normal = fitRect(normal, viewport()));
        Object.assign(element.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, right: 'auto' });
        element.classList.toggle('fdt-minimized', small); element.classList.toggle('fdt-max', mode === 'maximized');
        frame.hidden = small; miniBar.hidden = !small; frame.tabIndex = small ? -1 : 0;
        onVisibility({ hidden: element.hidden, mode });
    }
    function endGesture() {
        const previous = gesture; gesture = undefined; element.classList.remove('fdt-interacting', 'fdt-resizing');
        if (previous?.target?.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
    }
    function open(focus = true) {
        if (mode === 'minimized') { mode = restoreMode; if (mode === 'normal') normal = fitRect({ ...normal, left: mini.left, top: mini.top }, viewport()); }
        element.hidden = false; render(); if (focus) frame.focus();
    }
    function hide() { endGesture(); element.hidden = true; render(); }
    function minimize() {
        if (mode === 'minimized') return;
        endGesture(); const r = element.getBoundingClientRect(); restoreMode = mode;
        mini = fitRect({ left: r.left, top: r.top, width: 238, height: 44 }, viewport(), minimumMini); mode = 'minimized'; render(); expand.focus();
    }
    function toggleMaximize() { endGesture(); if (mode === 'minimized') open(false); mode = mode === 'maximized' ? 'normal' : 'maximized'; render(); }
    function dragStart(x, y) {
        if (mode === 'maximized') return;
        endGesture(); gesture = { kind: 'drag', x, y, start: { ...(mode === 'minimized' ? mini : normal) } }; element.classList.add('fdt-interacting');
    }
    function dragMove(x, y) {
        if (gesture?.kind !== 'drag') return;
        const r = moveRect(gesture.start, x - gesture.x, y - gesture.y, viewport(), mode === 'minimized' ? minimumMini : undefined);
        if (mode === 'minimized') mini = r; else normal = r; render();
    }
    miniBar.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        event.preventDefault(); dragStart(event.clientX, event.clientY); gesture.pointerId = event.pointerId; gesture.target = miniBar; miniBar.setPointerCapture(event.pointerId);
    }, options);
    miniBar.addEventListener('pointermove', event => { if (gesture?.pointerId === event.pointerId) dragMove(event.clientX, event.clientY); }, options);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) miniBar.addEventListener(name, endGesture, options);
    miniBar.addEventListener('dblclick', event => { if (!event.target.closest('button')) open(); }, options);
    expand.addEventListener('click', () => open(), options); close.addEventListener('click', hide, options);
    window.addEventListener('resize', () => { endGesture(); render(); }, options);
    window.addEventListener('blur', endGesture, options);
    function destroy() { endGesture(); controller.abort(); element.remove(); }
    if (signal?.aborted) destroy(); else { document.body.append(element); signal?.addEventListener('abort', destroy, { once: true }); render(); }
    return { element, frame, open, hide, minimize, toggleMaximize, dragStart, dragMove, dragEnd: endGesture, destroy,
        updateResult(r) { result.textContent = r ? `${r.config.kind === 'event' ? 'D100' : r.config.kind === 'action' ? 'D20' : '合计'} ${r.total}` : '待掷骰'; result.title = r?.config.note ?? ''; },
        get mode() { return mode; } };
}
