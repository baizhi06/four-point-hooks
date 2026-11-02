// examples/extensions.mjs —— 四个典型扩展：闸门 / 上下文 / 出口前半步 / 出口后半步
//
// 每个扩展就是一次 add(...)：功能全在自己的文件里，主干不动。
// 想加开关？meta 里什么都不用写——每个扩展天生就有 enabled，面板能拨。
//
// 注意第四个孔 outbound 分两个阶段：
//   phase:'before'  发送前改正文（清理、截断、脱敏）
//   phase:'after'   发送成功后记账（流水、待办、限额）
// 这两个阶段共用「发出去」这一个孔，不是额外两个孔。
//
// 单独挂：registerQuiet('./quiet.json')
// 一次挂全（演示 / 面板用）：registerAll(kit)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as kitDefault from '../src/hooks.js';

// ① gate：命中静音表就不唤醒（只读、不影响缓存）
export function registerQuiet(stateFile, kit = kitDefault) {
  return kit.add('gate', 'quiet', (ctx) => {
    try {
      const quiet = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!Array.isArray(quiet)) return { allow: true };
      return quiet.includes(ctx.key) ? { allow: false, reason: '静音中' } : { allow: true };
    } catch { return { allow: true }; }
  }, { order: 10, access: 'read', group: '安全', note: '静音表命中就不唤醒' });
}

// ② context：读文件注入提示词，所以必须声明 cache + stateKey（否则缓存一直读到旧的）
export function registerMemory(memoryFile, kit = kitDefault) {
  const stamp = () => { try { const s = fs.statSync(memoryFile); return `${s.mtimeMs}:${s.size}`; } catch { return '0'; } };
  return kit.add('context', 'memory', () => {
    try { return fs.readFileSync(memoryFile, 'utf8').trim(); } catch { return ''; }
  }, { order: 10, access: 'read', cache: true, group: '记忆', stateKey: () => stamp(), note: '记忆块（读文件，缓存要感知变化）' });
}

// ③ outbound·前：发送前清理正文（去首尾空白、压连续空行）
export function registerTrim(kit = kitDefault) {
  return kit.add('outbound', 'trim', (text) => String(text ?? '')
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    .replace(/\n{3,}/g, '\n\n'), {
    phase: 'before', order: 10, access: 'write', group: '出口', note: '去首尾空白、压空行',
  });
}

// ④ outbound·后：发送成功后记一行流水（key + 长度），便于对账
export function registerSendLog(stateDir, kit = kitDefault) {
  return kit.add('outbound', 'send-log', (ctx) => {
    try {
      fs.appendFileSync(path.join(stateDir, 'send-log.jsonl'),
        JSON.stringify({ t: new Date().toISOString(), key: ctx?.key ?? '', len: String(ctx?.text ?? '').length }) + '\n');
    } catch { /* 记账失败不影响发送 */ }
  }, { phase: 'after', order: 10, access: 'write', group: '记账', note: '发送流水（key + 长度）' });
}

// 一次挂全：面板演示、冒烟测试用。目录默认走临时目录，不碰你的项目。
export function registerAll(kit = kitDefault, opts = {}) {
  const dir = opts.dir || path.join(os.tmpdir(), 'four-point-hooks-demo');
  fs.mkdirSync(dir, { recursive: true });
  const quietFile = path.join(dir, 'quiet.json');
  const memoryFile = path.join(dir, 'memory.md');
  if (!fs.existsSync(quietFile)) fs.writeFileSync(quietFile, '[]', 'utf8');
  if (!fs.existsSync(memoryFile)) fs.writeFileSync(memoryFile, '（示例记忆块：这里放从记忆文件读出来的文本）', 'utf8');
  registerQuiet(quietFile, kit);
  registerMemory(memoryFile, kit);
  registerTrim(kit);
  registerSendLog(dir, kit);
  return { dir, quietFile, memoryFile };
}
