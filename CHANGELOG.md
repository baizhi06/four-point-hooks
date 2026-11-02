# 变更记录

本文件记录每一次改动：改了什么、为什么、影响面、怎么回滚。
格式固定四条，时间倒序。只改文档也要记一行。

## 0.2.2 —— 2026-11-02

**改了什么**
- 旧装配点名（`clean` / `afterSend`）加了**截止版本**：`DEPRECATED_POINTS = { clean: '0.3.0', afterSend: '0.3.0' }`，用旧名字会打一次警告，0.3.0 直接移除，不留影子孔。
- 新增验收测试「一个扩展都不注册 = 原版行为一字不差」：`gate` 放行、`context` 空数组、`beforeSend` 原文原样返回（**连空白都不动**）、`afterSend` / `onIncoming` 不抛错、`stateKey` 空、`table` 空、`switches` 空。
- 新增测试「旧名字有截止版本」，防止兼容层无限期留着。
- 单测 16 → **18 项**，全过。

**为什么**
- 兼容层没有截止日期，等于永久背着两个影子孔：账面四孔、实际能注册六个名字。
- 「零注册 = 原样透传」是这套东西能被安全插进别人主干的**唯一前提**：装了不生效，跟没装一样，才敢装。

**影响面**
- 用旧名字注册的代码会在控制台看到一次警告，行为不变；0.3.0 会直接报错。
- 用新名字（`outbound` + `phase`）的代码零影响。

**怎么回滚**
- 若要提前移除兼容：删 `src/hooks.js` 里的 `LEGACY` 与 `warnLegacy`，同时把调用方改成新名字。
- 若要延长：改 `DEPRECATED_POINTS` 里的版本号，并在本文件补一行说明。

## 0.2.1 —— 2026-11-02

**改了什么**
- 真正收成**四个**装配点：`incoming` / `gate` / `context` / `outbound`。`POINTS` 从五个变四个。
- `clean` 与 `afterSend` 不再是独立孔位，改为 `outbound` 的两个阶段（`phase: 'before' | 'after'`）；新增 `beforeSend(key, text)` 作正名，`clean` 保留为等价别名。
- 登记表新增 `phase` 字段与 `pointLabel()`：面板与 Markdown 里显示成 `outbound·前` / `outbound·后`。
- README / docs 增加三块：**六处 → 四处的合并账**（删了哪些、并进哪、没删功能）、**同步/异步的坑**、**验收线**（主干 `git diff` 只许多一个调用点，不许改判断逻辑）。
- 单测从 13 项加到 16 项：四孔断言、`outbound` 两阶段互不串、旧名字兼容落点。

**为什么**
- 上一版对外说「四个孔」，但 `POINTS` 里其实是五个，`clean` 单占一孔——被指出「说四做五」，这是硬伤。
- 「发送前清理」和「发送后记账」永远成对出现在同一个发送位置，拆成两个入口只会让人多记一个名字。

**影响面**
- 破坏性：`switches()` 里 `clean/trim` 变成 `outbound/trim`；用旧名字注册仍可用，但落点是 `outbound`。
- 不影响：`incoming` / `gate` / `context` 的行为与签名不变；`add('clean', ...)` 继续兼容。

**怎么回滚**
- 回到 0.2.0：`git revert` 该提交；核心改动只有 `src/hooks.js`、`examples/extensions.mjs`、`test/`、`verify.mjs` 的文档生成段。
- 只想退回旧写法：把扩展注册从 `outbound + phase` 改回 `add('clean', ...)` / `add('afterSend', ...)`，行为一致。

## 0.2.0 —— 2026-11-02

**改了什么**
- 装配点从五个收成四个（`clean` 与 `afterSend` 合并到「发出去」这一个位置调用），README 与文档按四层重写。
- 新增 `panel/server.mjs`：零依赖单页面板，能看登记表、拨开关、看实时计数与缓存指纹；附带 `docs/PANEL.md`。
- `src/hooks.js` 每个扩展带 `enabled` / `stats` / `group`；新增 `setEnabled` / `isEnabled` / `applySwitches` / `switches` / `summary` / `reset`。
- `stateKey()` 只统计「开着且声明 cache」的扩展：关掉一个块，缓存指纹随之变化。
- `verify.mjs` 新增 `--save-base` / `--compare`（基线快照与漂移检查）；`--write-doc` 改为生成接口契约。
- 单测从 9 项加到 13 项（开关、往返、汇总、错误只记到本扩展）。

**为什么**
- 五个装配点里，`clean` 与 `afterSend` 永远成对出现在同一个发送位置，拆成两个入口只会让人多记一个名字。
- 没有开关的面板等于日志；没有基线的回归等于靠记忆。

**影响面**
- 破坏性：`add()` 的 `meta` 现在支持 `cache` / `stateKey` / `group`；旧的五个入口名里 `transform` 已不存在（见 0.1.0）。
- 不影响：`POINTS` 常量与四个函数签名保持不变。

**怎么回滚**
- 回退此版本：`git revert` 该提交；核心文件只有 `src/hooks.js`、`panel/server.mjs`、`verify.mjs` 三个。
- 只想关掉面板：不引 `panel/server.mjs` 即可，核心零影响。

## 0.1.0 —— 2026-11-01

**改了什么**
- 首个版本：五个装配点（`incoming` / `gate` / `context` / `transform` / `afterSend`）、登记表、缓存指纹、失败隔离。

**为什么**
- 把散在主干里的十几处内联插点收成固定接口，让功能能独立进出。

**影响面**
- 新包，无兼容负担。

**怎么回滚**
- 删除仓库即可，无外部依赖。
