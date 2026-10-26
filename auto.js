import { integer, createRoll, receipt, readHistory } from './core.js';
export const HISTORY_KEY = 'fate-dice-tray.history.v1';
export const SETTINGS_KEY = 'fate-dice-tray.auto.v1';
export const DEFAULT_AUTO = Object.freeze({ enabled: true, dc: 12, modifier: 0, chance: 20, fallbackEvent: true, showWindow: true,
    actionWords: '攻击,挥砍,斩击,刺击,射击,开枪,闪避,躲避,躲开,格挡,招架,跳跃,翻越,突围,逃跑,逃离,潜入,偷袭,反击,冲刺,攀爬,施法,投影,释放宝具',
    restWords: '睡觉,睡到,睡了,入睡,睡去,休息,等到,等待,直到,过夜,第二天,次日' });
export function normalizeAuto(input = {}) {
    const r = { ...DEFAULT_AUTO, ...input };
    return Object.freeze({ enabled: r.enabled === true, dc: integer(r.dc, 1, 200, '自动检定难度'), modifier: integer(r.modifier, -100, 100, '自动修正值'), chance: integer(r.chance, 0, 100, '自动事件概率'), fallbackEvent: r.fallbackEvent === true, showWindow: r.showWindow === true,
        actionWords: String(r.actionWords).slice(0, 1200), restWords: String(r.restWords).slice(0, 1200) });
}
export function loadAuto(raw) { try { return normalizeAuto(JSON.parse(raw) ?? {}); } catch { return normalizeAuto(); } }
function findWord(text, csv) {
    const words = csv.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
    for (const word of words) {
        let index = text.indexOf(word);
        while (index !== -1) {
            const before = text.slice(Math.max(0, index - 8), index);
            if (!/(?:不|没|没有|不要|不能|不会|并未|无需|无须|不用)(?:再|去|尝试)?$/.test(before)) return word;
            index = text.indexOf(word, index + word.length);
        }
    }
    return null;
}
export function classifyInput(raw, settings = DEFAULT_AUTO) {
    const s = normalizeAuto(settings); const input = String(raw ?? '').trim();
    if (!s.enabled || !input || input.startsWith('/') || /【不掷骰】|【命运骰台｜/.test(input) || /^(?:[（(]\s*)?(?:OOC\b|题外话|场外指令)/i.test(input)) return null;
    // Simple, inspectable local rules. This does not claim semantic scene understanding.
    const text = input.replace(/```[\s\S]*?```/g, '').replace(/「[^」]*」|“[^”]*”|"[^"\n]*"/g, '');
    const action = findWord(text, s.actionWords);
    const rest = findWord(text, s.restWords);
    if (input.includes('【行动检定】') || action) return { config: { kind: 'action', mode: 'normal', modifier: s.modifier, target: s.dc, note: input.slice(0, 240) }, reason: action ? `行动词：${action}` : '手动指定行动检定' };
    if (input.includes('【事件检定】') || rest || s.fallbackEvent) return { config: { kind: 'event', target: s.chance, note: input.slice(0, 240) }, reason: rest ? `休息 / 时间跳跃词：${rest}` : input.includes('【事件检定】') ? '手动指定事件检定' : '每轮背景事件检定' };
    return null;
}
// A deterministic cache key, not a security signature. No full chat text is stored in the key.
export function turnKey(scope, index, message) {
    const raw = JSON.stringify([scope, index, message.send_date ?? '', message.mes]);
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < raw.length; i++) { a = Math.imul(a ^ raw.charCodeAt(i), 16777619); b = Math.imul(b ^ raw.charCodeAt(i), 3266489909); }
    return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${raw.length}`;
}
export function autoPrompt(r) {
    return ['<命运骰台自动裁定>', receipt(r), `触发依据：${r.auto.reason}。难度与概率来自用户预设的本地规则，不是对场景强弱的自动推断。`,
        '这是本轮生成前由程序实际掷出的结果。沿用该点数，不要自行编造、修改或重掷；用户描述的行动和时间终点视为尝试，不能仅因用户写成完成式就保证成功。',
        r.config.kind === 'action' ? '先审查行动是否符合既有能力、距离、反应速度及场景。可行时按检定成功或失败展开后果；不可能的行动不能被高点数变成可能，必然可行的普通动作无需强加失败。失败可造成受阻、受伤或代价，不能凭空提升敌人能力或强制死亡。' : '这是候选背景事件的触发检定。仅当既有剧情支持动机、情报、位置与抵达时间时，才可采用介入、夜袭、事故等候选事件；没有合理候选时明确按无可用事件处理，不得为兑现点数凭空刷敌。未触发时不得再以同一检定强制制造打断。',
        '如用户休息、等待或要求跳到未来，只在合理打断发生时停在该时刻；没有合理打断再推进到目标时间。以当前剧情日期与时间为基准，不改写旧事件日期，不凭空将数天前称为昨天。',
        '正文自然呈现后果；不要让角色谈论“模型”“检定工具”“型月世界”等场外机制。', '</命运骰台自动裁定>'].join('\n');
}
export function createAutoEngine({ getContext, getSettings, getHistory, saveHistory, publish = () => {}, makeRoll = createRoll }) {
    const cache = new Map();
    return function intercept(chat, _contextSize, abort, type) {
        if (![undefined, '', 'normal', 'regenerate', 'swipe', 'continue'].includes(type) || !Array.isArray(chat)) return;
        const settings = getSettings(); if (!settings.enabled) return;
        const ctx = getContext();
        const source = ctx.chat;
        if (!Array.isArray(source)) return;
        let index = source.length - 1; while (index >= 0 && (!source[index]?.is_user || source[index]?.is_system)) index--;
        if (index < 0 || typeof source[index].mes !== 'string') return;
        const message = source[index];
        const chatId = ctx.getCurrentChatId?.() ?? ctx.chatId;
        if (chatId == null || chatId === '') { publish({ text: '无法确认聊天身份，本轮未自动掷骰。' }); return; }
        const scope = JSON.stringify([ctx.groupId != null ? `group:${ctx.groupId}` : `character:${ctx.characterId}`, chatId]);
        const key = turnKey(scope, index, message);
        let target = chat.length - 1; while (target >= 0 && !chat[target]?.is_user) target--;
        if (target < 0) { publish({ text: '请求中没有用户消息，未自动掷骰。' }); return; }
        let r = cache.get(key) ?? getHistory().find(item => item.auto?.turnKey === key);
        let fresh = false;
        if (!r) {
            if (type === 'continue') return;
            const decision = classifyInput(message.mes, settings); if (!decision) { publish({ text: '本轮输入未命中自动判定规则。' }); return; }
            try {
                r = Object.freeze({ ...makeRoll(decision.config), auto: Object.freeze({ turnKey: key, reason: decision.reason }) });
            } catch (error) {
                abort?.(true); publish({ error: true, text: `随机判定失败，已阻止本次生成：${error.message}` }); return;
            }
            fresh = true;
            saveHistory([r, ...getHistory()].slice(0, 100));
        }
        cache.set(key, r); if (cache.size > 200) cache.delete(cache.keys().next().value);
        const original = chat[target];
        const base = String(original.mes ?? '').replace(/\n\n<命运骰台自动裁定>[\s\S]*?<\/命运骰台自动裁定>/g, '');
        // Replace with a clone; do not mutate the user's saved message object or ctx.chat.
        chat[target] = { ...structuredClone(original), mes: `${base}\n\n${autoPrompt(r)}` };
        publish({ result: r, fresh, text: `${fresh ? '已自动掷骰' : '沿用本轮原始点数'} · ${r.auto.reason}`, showWindow: fresh && settings.showWindow });
    };
}
