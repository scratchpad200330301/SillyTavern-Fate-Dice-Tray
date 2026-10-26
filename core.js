export const SIDES = Object.freeze([4, 6, 8, 10, 12, 20, 100]);
export function integer(value, min, max, label) {
    if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
        throw new Error(`${label}须为 ${min}～${max} 的整数。`);
    }
    return Number(value);
}
// Rejection sampling removes the modulo bias of a raw uint32 % sides.
export function randomDie(sides, source = array => globalThis.crypto.getRandomValues(array)) {
    integer(sides, 2, 100, '骰面');
    const limit = Math.floor(4294967296 / sides) * sides;
    const buffer = new Uint32Array(1);
    for (let attempts = 0; attempts < 1024; attempts++) {
        source(buffer);
        if (buffer[0] < limit) return buffer[0] % sides + 1;
    }
    throw new Error('随机源未能返回有效点数，请检查浏览器。');
}
export function normalizeConfig(input) {
    if (!input || !['action', 'event', 'free'].includes(input.kind)) throw new Error('未知判定类型。');
    const kind = input.kind;
    const note = String(input.note ?? '').trim().slice(0, 240);
    const modifier = kind === 'event' ? 0 : integer(input.modifier, -100, 100, '修正值');
    const mode = kind === 'action' ? input.mode : 'normal';
    if (!['normal', 'advantage', 'disadvantage'].includes(mode)) throw new Error('未知掷骰方式。');
    const sides = kind === 'event' ? 100 : kind === 'action' ? 20 : integer(input.sides, 4, 100, '骰面');
    if (!SIDES.includes(sides)) throw new Error('不支持该骰面。');
    const count = kind === 'free' ? integer(input.count, 1, 20, '骰子数量') : mode === 'normal' ? 1 : 2;
    const target = kind === 'event' ? integer(input.target, 0, 100, '触发概率') : kind === 'action' ? integer(input.target, 1, 200, '难度') : null;
    return Object.freeze({ kind, note, modifier, mode, sides, count, target });
}
export function resolveRoll(config, rolls) {
    const c = normalizeConfig(config);
    if (!Array.isArray(rolls) || rolls.length !== c.count) throw new Error('点数数量不符。');
    const values = rolls.map(n => integer(n, 1, c.sides, '点数'));
    const kept = c.mode === 'advantage' ? Math.max(...values) : c.mode === 'disadvantage' ? Math.min(...values) : values.reduce((a, b) => a + b, 0);
    const total = kept + c.modifier;
    const outcome = c.kind === 'free' ? 'rolled' : c.kind === 'event' ? (total <= c.target ? 'triggered' : 'quiet') : (total >= c.target ? 'success' : 'failure');
    return { config: c, rolls: Object.freeze(values), kept, total, outcome };
}
export function createRoll(input, roll = randomDie) {
    const c = normalizeConfig(input);
    const result = resolveRoll(c, Array.from({ length: c.count }, () => roll(c.sides)));
    // getRandomValues also works on HTTP LAN installs where randomUUID is unavailable.
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return Object.freeze({ schema: 1, id, timestamp: new Date().toISOString(), ...result });
}
export const OUTCOMES = Object.freeze({ success: '检定成功', failure: '检定失败', triggered: '事件触发', quiet: '未触发事件', rolled: '掷骰完成' });
export const KINDS = Object.freeze({ action: '行动检定', event: '事件触发', free: '自由掷骰' });
export function formula(result) {
    const c = result.config;
    const mod = c.modifier === 0 ? '' : c.modifier > 0 ? ` + ${c.modifier}` : ` − ${Math.abs(c.modifier)}`;
    return `${c.count}d${c.sides}${c.mode === 'advantage' ? ' 取高' : c.mode === 'disadvantage' ? ' 取低' : ''}${mod}`;
}
export function receipt(r) {
    const c = r.config;
    return [`【命运骰台｜${KINDS[c.kind]}】`, c.note ? `判定事项：${c.note}` : '', `掷骰：${formula(r)}；原始点数：${r.rolls.join('、')}；合计：${r.total}`, c.kind === 'action' ? `难度 DC ${c.target}；${OUTCOMES[r.outcome]}` : c.kind === 'event' ? `触发率 ${c.target}%；d100 ≤ ${c.target} 时触发；${OUTCOMES[r.outcome]}` : '', `记录编号：${r.id}`, '裁定约束：按已确认的能力、位置、时机和防护解释结果；失败不等于必死，触发不等于凭空安排敌人。'].filter(Boolean).join('\n');
}
export function readHistory(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.slice(0, 100).flatMap(r => {
            try {
                if (r.schema !== 1 || typeof r.id !== 'string' || r.id.length > 80 || !Number.isFinite(Date.parse(r.timestamp))) return [];
                const result = resolveRoll(r.config, r.rolls);
                if (result.total !== r.total || result.outcome !== r.outcome || result.kept !== r.kept) return [];
                const auto = r.auto && typeof r.auto.turnKey === 'string' && r.auto.turnKey.length <= 80 && typeof r.auto.reason === 'string' ? Object.freeze({ turnKey: r.auto.turnKey, reason: r.auto.reason.slice(0, 120) }) : undefined;
                return [Object.freeze({ schema: 1, id: r.id, timestamp: r.timestamp, ...result, ...(auto ? { auto } : {}) })];
            } catch { return []; }
        });
    } catch { return []; }
}
