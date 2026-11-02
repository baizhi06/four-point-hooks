// verify.mjs —— 语法检查 + 单测 + 面板冒烟 + 打印登记表 + 基线对比
//
// 用法：
//   node verify.mjs                 自检
//   node verify.mjs --write-doc     重写 docs/HOOKS.md（接口契约 + 登记表）
//   node verify.mjs --save-base     存一份基线快照（.hooks-baseline.json）
//   node verify.mjs --compare       与基线对比（删了扩展 / 缓存指纹变了 都算失败）
//   node verify.mjs --compare --loose  只报告不失败（看个热闹）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = (p) => pathToFileURL(path.join(HERE, p)).href;
const BASE_FILE = path.join(HERE, '.hooks-baseline.json');
let failed = 0;

// ── 1. 语法 ───────────────────────────────────────────────────────────────
for (const f of ['src/hooks.js', 'examples/extensions.mjs', 'panel/server.mjs']) {
  const r = spawnSync(process.execPath, ['--check', path.join(HERE, f)], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error('语法失败:', f, r.stderr?.slice(0, 300)); }
  else console.log('语法 OK:', f);
}

// ── 2. 单测 ───────────────────────────────────────────────────────────────
const tests = fs.readdirSync(path.join(HERE, 'test')).filter((f) => f.endsWith('.test.mjs'));
const t = spawnSync(process.execPath, ['--test', ...tests.map((f) => path.join(HERE, 'test', f))], { encoding: 'utf8' });
process.stdout.write(t.stdout || '');
process.stderr.write(t.stderr || '');
if (t.status !== 0) { failed++; console.error('单测失败'); }

// ── 3. 拿登记表（用临时目录跑示例扩展，不碰真实状态） ────────────────────
const kit = await import(url('src/hooks.js'));
const os = await import('node:os');
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'four-point-'));
const ext = await import(url('examples/extensions.mjs'));
try {
  ext.registerAll(kit, { dir: tmp });
} catch (e) {
  failed++;
  console.error('示例扩展注册失败:', e.message);
}
const md = kit.tableMd();
console.log('\n登记表：\n' + md);

const snapshot = () => ({
  savedAt: new Date().toISOString(),
  points: kit.POINTS,
  stateKey: kit.stateKey(),
  summary: kit.summary(),
  entries: kit.table().map(({ point, id, order, access, cache, note }) => ({ point, id, order, access, cache, note })),
});

// ── 4. 面板冒烟 ───────────────────────────────────────────────────────────
try {
  const { createPanel } = await import(url('panel/server.mjs'));
  const server = createPanel({ kit, title: 'verify', configPath: path.join(tmp, 'switches.json') });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const st = await (await fetch(`${base}/api/state`)).json();
  if (!st.summary || st.summary.total < 1) throw new Error('面板读到 0 条登记');
  const key = Object.keys(kit.switches())[0];
  const tg = await (await fetch(`${base}/api/toggle`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, enabled: false }),
  })).json();
  if (!tg.ok || tg.state.summary.off < 1) throw new Error('开关没生效');
  await (await fetch(`${base}/api/toggle`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, enabled: true }),
  })).json();
  const md2 = await (await fetch(`${base}/api/hooks.md`)).text();
  if (!md2.includes('装配点')) throw new Error('登记表接口异常');
  console.log(`面板 OK：${st.summary.total} 条登记，开关可拨，登记表可读`);
  server.close();
} catch (e) {
  failed++;
  console.error('面板冒烟失败:', e.message);
}

// ── 5. 基线：存 / 比 ─────────────────────────────────────────────────────
if (process.argv.includes('--save-base')) {
  fs.writeFileSync(BASE_FILE, JSON.stringify(snapshot(), null, 2) + '\n', 'utf8');
  console.log(`基线已存：.hooks-baseline.json（${kit.table().length} 条登记）`);
}

if (process.argv.includes('--compare')) {
  const loose = process.argv.includes('--loose');
  if (!fs.existsSync(BASE_FILE)) {
    failed++;
    console.error('没有基线文件，先跑一次 --save-base');
  } else {
    const oldBase = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
    const now = snapshot();
    const keyOf = (e) => `${e.point}/${e.id}`;
    const oldMap = new Map(oldBase.entries.map((e) => [keyOf(e), e]));
    const newMap = new Map(now.entries.map((e) => [keyOf(e), e]));
    const removed = [...oldMap.keys()].filter((k) => !newMap.has(k));
    const added = [...newMap.keys()].filter((k) => !oldMap.has(k));
    const changed = [];
    for (const [k, a] of oldMap) {
      const b = newMap.get(k);
      if (!b) continue;
      for (const f of ['order', 'access', 'cache', 'note']) {
        if (a[f] !== b[f]) changed.push(`${k}.${f}: ${a[f]} → ${b[f]}`);
      }
    }
    const stateKeyChanged = (oldBase.stateKey || '') !== (now.stateKey || '');

    console.log('\n与基线对比（基线时间 ' + (oldBase.savedAt || '?') + '）');
    console.log('  新增：' + (added.length ? added.join(', ') : '无'));
    console.log('  删除：' + (removed.length ? removed.join(', ') : '无'));
    console.log('  字段变化：' + (changed.length ? '\n    ' + changed.join('\n    ') : '无'));
    console.log('  缓存指纹：' + (stateKeyChanged ? `变了（${oldBase.stateKey || '空'} → ${now.stateKey || '空'}）` : '一致'));

    // 失败口径：删了扩展 = 硬失败；缓存指纹/字段变化属于正常演进，只提示。
    // 想连指纹也管死，加 --strict。
    const strict = process.argv.includes('--strict');
    const hardDrift = removed.length > 0 || (strict && (stateKeyChanged || changed.length > 0));
    if (hardDrift && !loose) {
      failed++;
      console.error(strict
        ? '基线不一致（--strict）：有扩展被删，或缓存指纹/字段变了。确认是有意的就重跑 --save-base。'
        : '基线不一致：有扩展被删。确认是有意的就重跑 --save-base。');
    } else if (added.length || changed.length || stateKeyChanged) {
      console.log('  （新增/字段/指纹变化不算失败；要管死加 --strict）');
    } else {
      console.log('  与基线完全一致');
    }
  }
}

// ── 6. 生成接口契约文档 ──────────────────────────────────────────────────
if (process.argv.includes('--write-doc')) {
  const doc = [
    '# HOOKS —— 接口契约',
    '',
    '> 这份文档两段：上半是**契约**（手写，说明为什么这么规定）；下半的登记表由 `node verify.mjs --write-doc` 生成。',
    '',
    '## 一、四个装配点',
    '',
    '| 装配点 | 签名 | 语义 | 返回 |',
    '| --- | --- | --- | --- |',
    '| `onIncoming` | `(ctx) => void` | 消息进来（观察） | 不返回，不能改内容 |',
    '| `gate` | `(ctx) => { allow, reason? }` | 要不要醒 | `allow:false` 拦下 |',
    '| `context` | `(key, extra?) => string \\| string[]` | 拼提示词 | 字符串或数组 |',
    '| `beforeSend` | `(key, text) => string` | 发出去·前半步：清理正文 | 改写后的文本 |',
    '| `afterSend` | `(ctx) => void` | 发出去·后半步：发送后记账 | 不返回 |',
    '',
    '**第四个孔 `outbound` 里只有这两个阶段，不是第五第六个孔。** 注册时用 `phase: "before" | "after"` 指定。',
    '',
    '## 二、六个旧插口 → 四个孔（删了哪些、并进哪）',
    '',
    '| 旧插口 | 去哪了 |',
    '| --- | --- |',
    '| 群消息 + 私聊消息 | 并进 `incoming`（用 `ctx.kind` 区分，两个入口合一） |',
    '| 唤醒闸门 | 独立成 `gate` |',
    '| 提示词块 + 状态键 | 并进 `context`（同一个扩展的两种能力：返回值 + `stateKey`） |',
    '| 生成后清理（transform） | 并进 `outbound` 前半步（`beforeSend`），和发送前清理合成一处 |',
    '| 发送后回调 | 并进 `outbound` 后半步（`afterSend`） |',
    '',
    '即：**六处入口 → 四处能力，其中「清理」与「记账」是同一个孔的前后半步。** 没有删功能，只有合并位置。',
    '',
    '## 二、四条约定（违反就是 bug）',
    '',
    '1. **顺序**：`order` 小的先跑，同 order 按注册先后；',
    '2. **失败隔离**：每个扩展单独 try/catch，坏一个不拖累其他，错误只进日志与 `stats`；',
    '3. **缓存**：任何读会变的东西（文件 / 数据库 / 时间）的扩展，必须 `cache: true` 并提供 `stateKey`，否则提示词缓存会一直命中旧内容；',
    '4. **保命层不进插口**：限流、审计、去重、凭证脱敏留在主干唯一的发送函数里。',
    '',
    '## 三、每个扩展自带的东西',
    '',
    '- `enabled`：开关，面板可拨，立刻生效，写进开关文件；',
    '- `stats`：`{ calls, errors, lastError, lastAt, ms }`；',
    '- `group`：归属（面板分组显示，例如「记忆」「安全」「出口」）。',
    '',
    '## 四、同步还是异步',
    '',
    '本库所有函数都是**同步**的（返回值直接拿，不用 await）。',
    '如果你的主干是 async，把返回值当作普通值用即可；`await` 一个非 Promise 值也不会出错。',
    '反过来的坑：主干本身是 async 却忘了 await 自己的异步清理函数，闸门会永远拿到 Promise（等于没装，且不报错）。',
    '',
    '## 四、Meta 字段一览',
    '',
    '| 字段 | 类型 | 必填 | 作用 |',
    '| --- | --- | --- | --- |',
    '| `order` | number | 否（默认 50） | 同一装配点内的执行顺序 |',
    '| `access` | `"read"` / `"write"` | 否 | 只读 = 看一眼；改写 = 会改提示词或消息 |',
    '| `cache` | boolean | 否 | 声明影响提示词缓存 |',
    '| `stateKey` | `(ctx?) => string` | `cache:true` 时必填 | 参与缓存指纹 |',
    '| `note` | string | 建议填 | 登记表里那一行说明，给三个月后的自己看 |',
    '| `group` | string | 否 | 面板分组 |',
    '',
    '## 五、新增一个扩展的模板',
    '',
    '```js',
    'add("context", "my-block", (ctx) => {',
    '  return ["【我的块】这里是内容"];',
    '}, {',
    '  order: 20,',
    '  access: "read",',
    '  cache: true,',
    '  stateKey: () => String(fs.statSync(file).mtimeMs),',
    '  note: "一句话说明它干什么",',
    '  group: "上下文",',
    '});',
    '```',
    '',
    '## 六、登记表（由代码生成，不要手改）',
    '',
    md,
    '',
    '## 七、改动纪律',
    '',
    '- 加扩展：只加文件，不改主干；',
    '- 改主干：必须同时跑 `--compare`，缓存指纹或登记项变了要在 PR 里说明；',
    '- 删扩展：先在面板上关一天，没人喊疼再删代码。',
    '',
    '## 八、验收线（接完之后怎么算合规）',
    '',
    '接完线，对主干文件跑一次 `git diff`，只允许出现两类改动：',
    '',
    '| 允许 | 不允许 |',
    '| --- | --- |',
    '| 新增一行调用点（`const v = gate(...)` 这种） | 改动原来的判断逻辑 |',
    '| 新增一个 import | 替换导出、套壳改写函数 |',
    '',
    '做不到这条，就还是「改框架」，不是「只加后端」。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(HERE, 'docs', 'HOOKS.md'), doc, 'utf8');
  console.log('已写入 docs/HOOKS.md');
}

process.exitCode = failed ? 1 : 0;
