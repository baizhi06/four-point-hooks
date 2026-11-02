import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, gate, context, clean, beforeSend, afterSend, onIncoming, stateKey, table, tableMd, reset,
  setEnabled, isEnabled, applySwitches, switches, summary, POINTS, pointLabel, DEPRECATED_POINTS } from '../src/hooks.js';

test('四个孔就是四个：incoming / gate / context / outbound', () => {
  assert.deepEqual(POINTS, ['incoming', 'gate', 'context', 'outbound']);
  assert.equal(POINTS.length, 4);
});

test('一个扩展都不注册 = 原版行为一字不差（透传）', () => {
  reset();
  // 闸门：没人拦 → 放行
  assert.deepEqual(gate({ key: 'g:1' }), { allow: true });
  // 上下文：没人给块 → 空数组
  assert.deepEqual(context('g:1'), []);
  // 出口前半步：没人改 → 原文原样返回（连空白都不动）
  assert.equal(beforeSend('g:1', '  原样  '), '  原样  ');
  assert.equal(clean('g:1', '  原样  '), '  原样  ');
  // 后半步 / 接入层：没人挂 → 不抛错
  assert.doesNotThrow(() => afterSend({ key: 'g:1', text: 'x' }));
  assert.doesNotThrow(() => onIncoming({ key: 'g:1' }));
  // 缓存指纹 / 登记表：空
  assert.equal(stateKey(), '');
  assert.deepEqual(table(), []);
  assert.deepEqual(switches(), {});
});

test('旧名字兼容有期限：DEPRECATED_POINTS 写明了截止版本', () => {
  assert.equal(DEPRECATED_POINTS.clean, '0.3.0');
  assert.equal(DEPRECATED_POINTS.afterSend, '0.3.0');
});

test('outbound 的两阶段互不串：before 改正文，after 只记账', () => {
  reset();
  const seen = [];
  add('outbound', 'trim', (t) => { seen.push('before'); return t.trim(); }, { phase: 'before' });
  add('outbound', 'log', (c) => { seen.push('after'); }, { phase: 'after' });
  assert.equal(beforeSend('k', '  hi  '), 'hi');
  assert.deepEqual(seen, ['before']);          // 发送前不跑记账
  afterSend({ key: 'k', text: 'hi' });
  assert.deepEqual(seen, ['before', 'after']);
});

test('旧名字兼容：clean 等价 beforeSend，注册后落在 outbound', () => {
  reset();
  add('clean', 'trim', (t) => t.trim());
  assert.equal(clean('k', '  x '), 'x');
  assert.equal(beforeSend('k', '  x '), 'x');
  const row = table()[0];
  assert.equal(row.point, 'outbound');
  assert.equal(row.phase, 'before');
  assert.equal(pointLabel(row), 'outbound·前');
});

test('gate：第一个否决生效，其余不再调用', () => {
  reset();
  const called = [];
  add('gate', 'a', () => { called.push('a'); return { allow: false, reason: '静音' }; }, { order: 1 });
  add('gate', 'b', () => { called.push('b'); return { allow: true }; }, { order: 2 });
  const r = gate({ key: 'g:1' });
  assert.equal(r.allow, false);
  assert.equal(r.id, 'a');
  assert.deepEqual(called, ['a']);
});

test('gate：没人否决就放行', () => {
  reset();
  assert.deepEqual(gate({}), { allow: true });
});

test('context：按 order 拼，空块跳过', () => {
  reset();
  add('context', 'later', () => 'B', { order: 20 });
  add('context', 'first', () => ['A'], { order: 10 });
  add('context', 'empty', () => '', { order: 15 });
  assert.deepEqual(context('k'), ['A', 'B']);
});

test('clean：链式改写', () => {
  reset();
  add('clean', 'trim', (t) => t.trim(), { order: 10 });
  add('clean', 'cut', (t) => t.slice(0, 5), { order: 20 });
  assert.equal(clean('k', '   你好世界再见   '), '你好世界再');
});

test('afterSend / onIncoming：只调用不返回', () => {
  reset();
  const hits = [];
  add('afterSend', 'log', (c) => hits.push('send:' + c.key));
  add('incoming', 'obs', (c) => hits.push('in:' + c.key));
  onIncoming({ key: 'g:1' });
  afterSend({ key: 'g:1' });
  assert.deepEqual(hits, ['in:g:1', 'send:g:1']);
});

test('失败隔离：一个扩展抛错不影响其它', () => {
  reset();
  const hits = [];
  add('context', 'bad', () => { throw new Error('boom'); }, { order: 10 });
  add('context', 'good', () => 'ok', { order: 20 });
  const out = context('k');
  assert.deepEqual(out, ['ok']);
});

test('stateKey：只有 cache:true 且给了 stateKey 的参与', () => {
  reset();
  add('context', 'mem', () => 'M', { cache: true, stateKey: () => 'v1' });
  add('context', 'no', () => 'N');
  assert.equal(stateKey(), 'v1');
});

test('登记表：包含读写与缓存声明', () => {
  reset();
  add('context', 'mem', () => 'M', { cache: true, note: '记忆卡' });
  add('clean', 'trim', (t) => t, { access: 'write', note: '去空白' });
  const rows = table();
  assert.equal(rows.length, 2);
  const md = tableMd();
  assert.match(md, /记忆卡/);
  assert.match(md, /改写/);
});

test('注册校验：未知装配点 / 重复 id 直接报错', () => {
  reset();
  assert.throws(() => add('nope', 'x', () => {}), /未知装配点/);
  add('gate', 'x', () => ({}));
  assert.throws(() => add('gate', 'x', () => ({})), /已注册过/);
});

test('开关：关掉的扩展不参与调用，缓存指纹也不再算它', () => {
  reset();
  const hits = [];
  add('context', 'mem', () => { hits.push('m'); return 'M'; }, { cache: true, stateKey: () => 'v1' });
  assert.deepEqual(context('k'), ['M']);
  assert.equal(stateKey(), 'v1');
  assert.equal(setEnabled('mem', false, 'context'), true);
  assert.equal(isEnabled('mem', 'context'), false);
  assert.deepEqual(context('k'), []);
  assert.equal(stateKey(), '');
  assert.deepEqual(hits, ['m']);            // 只在开启时被调用过一次
});

test('批量开关：applySwitches 认 "point/id"，switches() 能导回去', () => {
  reset();
  add('gate', 'quiet', () => ({ allow: true }));
  add('clean', 'trim', (t) => t);
  assert.equal(applySwitches({ 'gate/quiet': false, trim: false }), 2);
  assert.deepEqual(switches(), { 'gate/quiet': false, 'outbound/trim': false });
  assert.equal(applySwitches(switches()), 2);   // 幂等
});

test('统计：summary 汇总开启数、调用数与错误数', () => {
  reset();
  add('context', 'ok', () => 'A');
  add('context', 'bad', () => { throw new Error('boom'); });
  context('k');
  const s = summary();
  assert.equal(s.total, 2);
  assert.equal(s.on, 2);
  assert.equal(s.calls, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.slowest.id !== undefined, true);
});

test('失败只记进该扩展的 stats，不影响别的扩展的计数', () => {
  reset();
  add('context', 'bad', () => { throw new Error('boom'); }, { order: 10 });
  add('context', 'good', () => 'ok', { order: 20 });
  context('k');
  const rows = table();
  const bad = rows.find((r) => r.id === 'bad');
  const good = rows.find((r) => r.id === 'good');
  assert.equal(bad.stats.errors, 1);
  assert.match(bad.stats.lastError, /boom/);
  assert.equal(good.stats.errors, 0);
  assert.equal(good.stats.calls, 1);
});
