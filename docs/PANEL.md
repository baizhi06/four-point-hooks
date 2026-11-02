# PANEL —— 开关看得见

> 装配点不该只活在日志里。一个单页面板：零依赖、零构建、默认只绑本机。

## 挂进去

```js
import * as kit from '../src/hooks.js';
import { createPanel } from './panel/server.mjs';

// 和你的机器人同一个进程（推荐：能看到实时计数）
const panel = createPanel({
  kit,                                  // hooks 模块
  title: '我的插件',
  configPath: './hooks.switches.json',  // 开关存这里；不传就只在内存里
});
panel.listen(3131, '127.0.0.1');
```

单独看效果：

```bash
node panel/server.mjs --demo            # 127.0.0.1:3131，挂四个示例扩展
node panel/server.mjs --demo --port 8080
```

## 一页看到什么

| 列 | 含义 |
| --- | --- |
| 装配点 / 注册者 | 例如 `context / memory` |
| 读写 | 只读 = 只观察；改写 = 会改提示词或消息正文 |
| 缓存 | `cache:true` 的块改了必须让提示词缓存失效 |
| 顺序 | `order`，同值按注册先后 |
| 说明 | 注册时写的 `note` |
| 调用 / 错误 | 实时计数；红字是该扩展最后一次的错误 |
| 开关 | 点一下立刻生效，写进 `configPath` |

顶栏：总扩展数、开启 / 关闭、调用总数、错误总数、**缓存指纹**（`stateKey()` 的当前值）、刷新时间。

## 为什么开关值得做

- 出问题先关掉一个扩展，不用改代码、不用重启、不用回滚版本；
- 关掉 `cache:true` 的块时，`stateKey()` 自动变化 → 提示词缓存失效 → 不会读到旧的提示词；
- 每个扩展独立计数和错误，面板上直接看出是哪个扩展坏了。

## 三个接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/state` | 登记表 + 计数 + 缓存指纹（JSON） |
| `GET /api/hooks.md` | 同一张表的 Markdown，可直接贴进文档 |
| `POST /api/toggle` | `{"key":"clean/trim","enabled":false}` |

`key` 形如 `装配点/注册者`。只认登记表里已经存在的键，别的返回 400。

## 安全边界

默认实现只做三件事，也**只做**这三件事：

1. 只绑 `127.0.0.1`（要对外请自己套反代 + 鉴权）；
2. POST 只写开关文件里的 `switches` 一个键，**不提供**改配置正文、改代码、执行命令的接口；
3. 请求体上限 16 KB，JSON 解析失败直接 400。

如果你的面板要给你以外的人看，自己在前面加一层登录——这个包不替你做鉴权。
