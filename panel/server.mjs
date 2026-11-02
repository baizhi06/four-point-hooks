// panel/server.mjs —— 给四点钩子配一个单页面板（零依赖，只读登记表）
//
// 两种用法：
//   ① 挂进你自己的进程（推荐，能看到实时计数）：
//        import * as kit from '../src/hooks.js';
//        import { createPanel } from './panel/server.mjs';
//        createPanel({ kit, title: '我的插件', configPath: './hooks.switches.json' }).listen(3131);
//   ② 单独跑起来看效果：
//        node panel/server.mjs --demo            # 默认 127.0.0.1:3131
//        node panel/server.mjs --demo --port 8080
//
// 面板只做三件事：看登记表、拨开关、看缓存指纹。不读源码、不改配置正文。
// 开关只写一个白名单键（switches），改完立刻生效，不用重启；缓存指纹会跟着变。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{kit:any, title?:string, configPath?:string, host?:string, onSave?:(s:any)=>void}} opts
 * @returns {http.Server}
 */
export function createPanel(opts = {}) {
  const { kit, title = '四点钩子', configPath = '', host = '127.0.0.1', onSave } = opts;
  if (!kit || typeof kit.table !== 'function') throw new Error('createPanel 需要 hooks 模块（含 table/setEnabled）');

  // 启动时把上次的开关读回来
  if (configPath) {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (saved && saved.switches) kit.applySwitches(saved.switches);
    } catch { /* 第一次没有配置文件 */ }
  }

  function save() {
    if (!configPath) return;
    const data = { switches: kit.switches(), savedAt: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(path.resolve(configPath)), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
      onSave?.(data);
    } catch (err) {
      console.error(`[panel] 写配置失败 ${configPath}: ${err?.message || err}`);
    }
  }

  const state = () => ({
    title,
    now: new Date().toISOString(),
    summary: kit.summary(),
    stateKey: kit.stateKey(''),
    table: kit.table(),
    configPath,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || host}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, 'text/html; charset=utf-8', PAGE);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state()));
      }
      if (req.method === 'GET' && url.pathname === '/api/hooks.md') {
        return send(res, 200, 'text/markdown; charset=utf-8', kit.tableMd());
      }
      if (req.method === 'POST' && url.pathname === '/api/toggle') {
        const body = await readJson(req);
        const key = String(body?.key || '');
        const known = Object.keys(kit.switches());
        if (!known.includes(key)) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: `未知开关 ${key}` }));
        const [point, id] = known.includes(key) && key.includes('/') ? key.split('/') : [key, key];
        kit.setEnabled(id, !!body.enabled, key.includes('/') ? point : '');
        save();
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, state: state() }));
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
      }
      return send(res, 404, 'application/json', JSON.stringify({ ok: false, error: 'not found' }));
    } catch (err) {
      return send(res, 500, 'application/json', JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  });

  server.on('listening', () => {
    const a = server.address();
    console.log(`[panel] http://${host}:${a.port}/  （${title}）`);
  });
  return server;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new Error('请求过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (err) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

// ── 单页前端（内联，不引任何框架） ──────────────────────────────────────
const PAGE = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>四点钩子</title>
<style>
:root{--bg:#151a21;--fg:#e6edf3;--dim:#8b98a5;--line:#242c36;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--card:#1b222b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0 12px 0 0;font-weight:600}
.pill{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 10px;color:var(--dim)}
.pill b{color:var(--fg);font-weight:600}
.pill.ok b{color:var(--ok)} .pill.warn b{color:var(--warn)} .pill.bad b{color:var(--bad)}
main{padding:14px 18px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--dim);font-weight:500;font-size:12px}
tr:hover td{background:#1d2530}
td.mono,.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dim)}
.tag{display:inline-block;padding:1px 7px;border-radius:5px;background:#243040;color:#9db3c9;font-size:11px}
.tag.write{background:#3a2b1a;color:#e3b341}
.sw{position:relative;width:38px;height:20px;border-radius:999px;background:#39424e;cursor:pointer;transition:.15s}
.sw.on{background:var(--ok)}
.sw:after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.sw.on:after{left:20px}
footer{padding:12px 18px;color:var(--dim);border-top:1px solid var(--line);margin-top:18px}
code{background:#0f141a;padding:1px 5px;border-radius:4px}
.err{color:var(--bad)}
.empty{padding:26px;color:var(--dim);text-align:center;border:1px dashed var(--line);border-radius:8px}
</style></head>
<body>
<header>
  <h1 id="title">四点钩子</h1>
  <span class="pill">装配点 <b id="s-total">0</b></span>
  <span class="pill ok">开启 <b id="s-on">0</b></span>
  <span class="pill warn">关闭 <b id="s-off">0</b></span>
  <span class="pill">调用 <b id="s-calls">0</b></span>
  <span class="pill bad" id="p-err">错误 <b id="s-errors">0</b></span>
  <span class="pill">缓存指纹 <b id="s-key" class="mono">-</b></span>
  <span style="flex:1"></span>
  <span class="pill" id="s-time">-</span>
</header>
<main>
  <table>
    <thead><tr><th style="width:88px">装配点</th><th>注册者</th><th style="width:70px">读写</th><th style="width:80px">缓存</th><th style="width:56px">顺序</th><th>说明</th><th style="width:120px">调用/错误</th><th style="width:52px">开关</th></tr></thead>
    <tbody id="rows"><tr><td colspan="8"><div class="empty">加载中…</div></td></tr></tbody>
  </table>
  <p class="mono" id="cfg" style="margin-top:14px"></p>
</main>
<footer>点开关立刻生效，不用重启；缓存指纹会跟着变。登记表在 <code>/api/hooks.md</code>，机器读的是 <code>/api/state</code>。</footer>
<script>
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let busy=false;
async function load(){
  const r=await fetch('/api/state'); const d=await r.json();
  $('#title').textContent=d.title;
  $('#s-total').textContent=d.summary.total;
  $('#s-on').textContent=d.summary.on;
  $('#s-off').textContent=d.summary.off;
  $('#s-calls').textContent=d.summary.calls;
  $('#s-errors').textContent=d.summary.errors;
  $('#p-err').className='pill '+(d.summary.errors?'bad':'');
  $('#s-key').textContent=d.stateKey||'（无缓存块）';
  $('#s-time').textContent='刷新 '+new Date(d.now).toLocaleTimeString();
  $('#cfg').textContent=d.configPath?('开关文件：'+d.configPath):'开关只在内存里（没配 configPath，重启会回到默认）';
  const rows=d.table.slice().sort((a,b)=>a.point.localeCompare(b.point)||a.order-b.order);
  $('#rows').innerHTML=rows.length?rows.map(r=>{
    const key=r.point+'/'+r.id;
    const st=r.stats||{calls:0,errors:0};
    return '<tr><td><span class="tag">'+esc(r.point)+'</span></td>'
      +'<td class="mono">'+esc(r.id)+'</td>'
      +'<td><span class="tag '+(r.access==='write'?'write':'')+'">'+(r.access==='write'?'改写':'只读')+'</span></td>'
      +'<td>'+(r.cache?'是':'否')+'</td>'
      +'<td class="mono">'+r.order+'</td>'
      +'<td>'+esc(r.note||'')+(r.stats&&r.stats.lastError?'<div class="err mono">'+esc(r.stats.lastError)+'</div>':'')+'</td>'
      +'<td class="mono">'+st.calls+' / '+(st.errors?'<span class="err">'+st.errors+'</span>':'0')+'</td>'
      +'<td><div class="sw'+(r.enabled?' on':'')+'" data-key="'+esc(key)+'"></div></td></tr>';
  }).join(''):'<tr><td colspan="8"><div class="empty">还没有注册任何扩展。用 kit.add(point, id, fn, meta) 挂一个。</div></td></tr>';
}
document.addEventListener('click',async e=>{
  const sw=e.target.closest('.sw'); if(!sw||busy) return;
  busy=true; sw.style.opacity=.5;
  try{
    await fetch('/api/toggle',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:sw.dataset.key,enabled:!sw.classList.contains('on')})});
    await load();
  } finally { busy=false; sw.style.opacity=1; }
});
load(); setInterval(load,5000);
</script>
</body></html>`;

// ── 直接运行时：起一个演示面板 ─────────────────────────────────────────
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) || 3131 : 3131;
  const kit = await import(new URL('../src/hooks.js', import.meta.url));
  const ext = await import(new URL('../examples/extensions.mjs', import.meta.url));
  if (typeof ext.registerAll === 'function') ext.registerAll(kit);
  else if (typeof ext.default === 'function') ext.default(kit);
  createPanel({ kit, title: '四点钩子 · 演示', configPath: path.join(HERE, '..', '.panel-switches.json') })
    .listen(port, '127.0.0.1');
  void fs; void HERE;
}
