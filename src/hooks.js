// src/hooks.js —— 四点钩子（复制进你自己的插件，不当依赖引）
//
// 只解决一个问题：插件的装配接口太多。装配接口越多，加功能要动主干，升级上游要手工合并。
//
// 所以只留四个孔（不是五个、不是六个）：
//   ① incoming  消息进来（群/私聊都走这里，ctx.kind 区分）
//   ② gate      要不要醒 / 要不要回（返回 { allow:false } 就拦下）
//   ③ context   拼提示词（返回字符串数组，按 order 拼；影响缓存的要声明 cache:true）
//   ④ outbound  发出去（这一个孔里两个阶段：phase:'before' 清理正文，phase:'after' 发送后记账）
//
// 「发送前清理」和「发送后回调」不是第五、第六个孔，它们是第四个孔里的前半步和后半步。
// 六个孔合并到四个的对应关系写在 README「从六处合并到四处」那一节。
//
// 功能接口不受限：任何能力都在自己的文件里 add(...) 一行挂上去，主干不动。
// 登记表跟着注册走：谁注册的、只读还是改写、影不影响缓存，改代码就得改那一行。
//
// 同步设计：本库所有函数都是同步的。如果你的主干是 async，把返回值 await 一下即可
// （`const out = clean(key, text)` 无需 await；`await` 一个非 Promise 值也没问题）。
//
// 每个扩展自带开关与计数，面板（panel/server.mjs）只读登记表，不读源码。

const TABLE = [];

/** 四个装配点。顺序固定，别加第五个。 */
export const POINTS = ['incoming', 'gate', 'context', 'outbound'];

/** 第四个孔里的两个阶段。 */
export const PHASES = ['before', 'after'];

// 旧名字 → 新孔位（兼容早期写法，也顺便说明它们本来属于哪儿）
// 兼容是有期限的：0.3.0 起移除，见 SUNSET。用旧名字会打一次警告。
const LEGACY = {
  clean: { point: 'outbound', phase: 'before' },
  afterSend: { point: 'outbound', phase: 'after' },
};

/** 旧装配点名的支持截止版本。到版本就删，不留影子孔。 */
export const DEPRECATED_POINTS = { clean: '0.3.0', afterSend: '0.3.0' };

const warned = new Set();
function warnLegacy(point) {
  if (warned.has(point)) return;
  warned.add(point);
  const until = DEPRECATED_POINTS[point] || '下一个版本';
  console.warn(`[hooks] 装配点名 "${point}" 已废弃，${until} 起移除；请改用 add('outbound', id, fn, { phase: '${point === 'clean' ? 'before' : 'after'}' })`);
}

/**
 * 注册一个扩展。
 * @param {'incoming'|'gate'|'context'|'outbound'|'clean'|'afterSend'} point 装配点（后两个是兼容别名）
 * @param {string} id 唯一名字（日志和登记表里用）
 * @param {Function} fn 处理函数
 * @param {{order?:number, access?:'read'|'write', cache?:boolean, note?:string,
 *          stateKey?:Function, enabled?:boolean, group?:string, phase?:'before'|'after'}} meta
 */
export function add(point, id, fn, meta = {}) {
  const mapped = LEGACY[point] || { point, phase: meta.phase };
  if (LEGACY[point]) warnLegacy(point);
  if (!POINTS.includes(mapped.point)) {
    throw new Error(`未知装配点 ${point}；只有四个：${POINTS.join(' / ')}`);
  }
  const phase = mapped.point === 'outbound' ? (mapped.phase === 'after' ? 'after' : 'before') : '';
  if (TABLE.some((e) => e.id === id && e.point === mapped.point)) {
    throw new Error(`扩展 ${mapped.point}/${id} 已注册过`);
  }
  const entry = {
    id,
    point: mapped.point,
    phase,
    fn,
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 50,
    access: meta.access === 'write' ? 'write' : 'read',
    cache: meta.cache === true,
    note: String(meta.note || ''),
    group: String(meta.group || ''),          // 归属（面板按组显示，例如「记忆」「安全」「出口」）
    enabled: meta.enabled !== false,
    stateKey: typeof meta.stateKey === 'function' ? meta.stateKey : null,
    stats: { calls: 0, errors: 0, lastError: '', lastAt: 0, ms: 0 },
  };
  TABLE.push(entry);
  return entry;
}

// ── 四个孔（主干只调这四个函数） ────────────────────────────────────────
/** ① 消息进来。观察用，不返回值，不能改消息内容。 */
export function onIncoming(ctx) {
  for (const e of pick('incoming')) call(e, () => e.fn(ctx));
}

/** ② 要不要醒。返回 { allow:false, reason } 就拦下；第一个否决生效。 */
export function gate(ctx) {
  for (const e of pick('gate')) {
    const r = call(e, () => e.fn(ctx));
    if (r && r.allow === false) return { allow: false, reason: r.reason || '', id: e.id };
  }
  return { allow: true };
}

/** ③ 拼提示词。返回字符串数组，调用方按顺序拼接。 */
export function context(key, extra = {}) {
  const out = [];
  for (const e of pick('context')) {
    const r = call(e, () => e.fn({ key, ...extra }));
    if (Array.isArray(r)) out.push(...r.filter(Boolean));
    else if (typeof r === 'string' && r.trim()) out.push(r);
  }
  return out;
}

/** ④-outbound 前半步：发送前清理（截断、去重、脱敏），返回改写后的文本。 */
export function beforeSend(key, text) {
  let cur = text;
  for (const e of pick('outbound', 'before')) {
    const r = call(e, () => e.fn(cur, { key }));
    if (typeof r === 'string') cur = r;
  }
  return cur;
}

/** ④-outbound 后半步：发送成功后回调（记账、捕获待办、写流水）。 */
export function afterSend(ctx) {
  for (const e of pick('outbound', 'after')) call(e, () => e.fn(ctx));
}

/** 兼容别名：等价于 beforeSend（早期版本叫 clean）。 */
export const clean = beforeSend;

// ── 开关（面板用） ──────────────────────────────────────────────────────
/** 打开/关闭一个扩展。返回是否找到。point 可省（id 全局唯一时）。 */
export function setEnabled(id, on, point = '') {
  const e = TABLE.find((x) => x.id === id && (!point || x.point === point));
  if (!e) return false;
  e.enabled = !!on;
  return true;
}

export function isEnabled(id, point = '') {
  const e = TABLE.find((x) => x.id === id && (!point || x.point === point));
  return !!e && e.enabled;
}

/** 批量应用开关状态（面板启动时读配置用）。返回生效条数。 */
export function applySwitches(map = {}) {
  let n = 0;
  for (const [key, on] of Object.entries(map)) {
    // key 形如 "gate/quiet" 或 "quiet"
    const [a, b] = String(key).split('/');
    const point = b ? a : '';
    const id = b || a;
    if (setEnabled(id, !!on, point)) n += 1;
  }
  return n;
}

/** 当前开关状态（写配置用）。 */
export function switches() {
  const out = {};
  for (const e of TABLE) out[`${e.point}/${e.id}`] = e.enabled;
  return out;
}

// ── 登记表与缓存指纹 ────────────────────────────────────────────────────
/** 缓存指纹：cache:true 的扩展各给一个值，拼进你自己的提示词缓存键。 */
export function stateKey(extra = '') {
  const parts = [];
  for (const e of TABLE) {
    if (!e.enabled || !e.cache || !e.stateKey) continue;
    try { parts.push(String(e.stateKey(extra) ?? '')); } catch { parts.push(''); }
  }
  return parts.join('|');
}

/** 登记表（JSON）。outbound 的两条会带 phase 字段。 */
export function table() {
  return TABLE.map(({ id, point, phase, order, access, cache, note, group, enabled, stats }) => ({
    id, point, phase, order, access, cache, note, group, enabled,
    stats: { ...stats },
  }));
}

/** 统计汇总（面板顶栏用）。 */
export function summary() {
  const total = TABLE.length;
  const on = TABLE.filter((e) => e.enabled).length;
  const calls = TABLE.reduce((s, e) => s + e.stats.calls, 0);
  const errors = TABLE.reduce((s, e) => s + e.stats.errors, 0);
  const slow = TABLE.slice().sort((a, b) => b.stats.ms - a.stats.ms)[0];
  return { total, on, off: total - on, calls, errors, slowest: slow ? { id: slow.id, ms: slow.stats.ms } : null };
}

/** 装配点的展示名：outbound 要标出是前半步还是后半步。 */
export function pointLabel(entry) {
  if (entry.point !== 'outbound') return entry.point;
  return entry.phase === 'after' ? 'outbound·后' : 'outbound·前';
}

/** 登记表（Markdown，贴文档用）。 */
export function tableMd() {
  const rows = table().sort((a, b) => a.point.localeCompare(b.point) || a.order - b.order);
  const head = '| 装配点 | 注册者 | 读写 | 影响缓存 | 顺序 | 说明 |\n| --- | --- | --- | --- | --- | --- |';
  return [head, ...rows.map((r) => `| ${pointLabel(r)} | ${r.id} | ${r.access === 'write' ? '改写' : '只读'} | ${r.cache ? '是' : '否'} | ${r.order} | ${r.note} |`)].join('\n');
}

/** 清空（测试用）。 */
export function reset() { TABLE.length = 0; }

// ── 内部 ───────────────────────────────────────────────────────────────
function pick(point, phase = '') {
  return TABLE
    .filter((e) => e.point === point && (!phase || e.phase === phase) && e.enabled)
    .sort((a, b) => a.order - b.order);
}

function call(entry, fn) {
  const t0 = Date.now();
  try {
    entry.stats.calls += 1;
    const r = fn();
    entry.stats.ms = Date.now() - t0;
    entry.stats.lastAt = Date.now();
    return r;
  } catch (err) {
    // 一个扩展坏了不能拖垮主流程
    const msg = String(err?.message || err).slice(0, 200);
    entry.stats.errors += 1;
    entry.stats.lastError = msg;
    entry.stats.lastAt = Date.now();
    console.error(`[hooks:${entry.id}] ${msg}`);
    return undefined;
  }
}
