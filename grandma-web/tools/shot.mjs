/* =============================================================================
 * shot.mjs — 无头 Edge 批量截图 + 页面状态采集（零依赖，只用 node 内置能力）
 *
 *   node tools/shot.mjs <shots.json>
 *
 * shots.json:
 *   {
 *     "url": "http://127.0.0.1:5173/",
 *     "out": "shots",
 *     "viewport": [1600, 900],
 *     "dismissWelcome": true,
 *     "settle": 900,               // 每张截图前的稳定时间(ms)
 *     "shots": [
 *        { "name": "01-hero", "js": "APP.setView('follow')" },
 *        { "name": "02-walk", "js": "...", "wait": 1500 },
 *        { "name": "03-cam",  "look": [x,y,z, tx,ty,tz], "pose": [x,z,yaw,speed] }
 *     ]
 *   }
 *
 * 每张截图额外会抓一次 APP.info()，汇总写到 <out>/_report.json，便于核验逻辑。
 * ========================================================================== */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Edge');
}

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('用法: node tools/shot.mjs <shots.json>'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const OUT = path.resolve(ROOT, cfg.out || 'shots');
fs.mkdirSync(OUT, { recursive: true });
const [VW, VH] = cfg.viewport || [1600, 900];
const PORT = cfg.debugPort || 9333;
const PROFILE = path.join(ROOT, '_probe', 'edge-profile-shot');
fs.mkdirSync(PROFILE, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url);
  return await res.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.waiters.has(msg.id)) {
        const { res, rej } = c.waiters.get(msg.id);
        c.waiters.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        c.events.push(msg);
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiters.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiters.has(id)) { this.waiters.delete(id); rej(new Error('timeout ' + method)); }
      }, 60000);
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, userGesture: true
    });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
}

const edge = findEdge();
const child = spawn(edge, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars', '--mute-audio',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--window-size=' + VW + ',' + VH,
  'about:blank'
], { stdio: 'ignore', detached: false });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  try {
    const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
    const page = list.find(t => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch (e) { /* 还没起来 */ }
  await sleep(300);
}
if (!wsUrl) { child.kill(); throw new Error('Edge 调试端口没起来'); }

const cdp = await CDP.connect(wsUrl);
const report = { url: cfg.url, viewport: [VW, VH], shots: [], errors: [] };

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: VW, height: VH, deviceScaleFactor: 1, mobile: false
});

await cdp.send('Page.navigate', { url: cfg.url });
await sleep(cfg.loadWait || 2600);

// 页面报错采集
const logs = cdp.events.filter(e => e.method === 'Log.entryAdded').map(e => e.params.entry);
logs.forEach(l => { if (l.level === 'error') report.errors.push(l.text); });
cdp.events.length = 0;

if (cfg.dismissWelcome) {
  await cdp.eval("(function(){var w=document.getElementById('welcome'); if(w) w.classList.remove('show'); if(window.APP) APP.S.moved=true; return true;})()");
  await sleep(300);
}

for (const shot of cfg.shots) {
  if (shot.pose) {
    const [x, z, yaw, sp] = shot.pose;
    await cdp.eval(`APP.pose(${x},${z},${yaw},${sp === undefined ? 0 : sp})`);
  }
  if (shot.look) {
    const l = shot.look;
    await cdp.eval(`APP.look(${l.join(',')})`);
  }
  if (shot.lighting) await cdp.eval(`APP.setLighting(${JSON.stringify(shot.lighting)})`);
  if (shot.js) {
    const r = await cdp.eval('(function(){' + shot.js + '})()');
    if (r !== undefined && r !== null) shot._ret = r;
  }
  await sleep(shot.wait === undefined ? (cfg.settle || 900) : shot.wait);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, shot.name + '.png');
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  let info = null;
  try { info = await cdp.eval('APP.info()'); } catch (e) { info = { error: String(e) }; }
  report.shots.push({ name: shot.name, file: path.relative(ROOT, file), info, ret: shot._ret ?? null });
  console.log('shot ' + shot.name + '  ' + JSON.stringify(info));
  if (shot._ret !== undefined && shot._ret !== null) console.log('    ret: ' + JSON.stringify(shot._ret));
}

const tail = cdp.events.filter(e => e.method === 'Log.entryAdded').map(e => e.params.entry);
tail.forEach(l => { if (l.level === 'error') report.errors.push(l.text); });

fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
console.log('errors: ' + (report.errors.length ? JSON.stringify(report.errors) : 'none'));

await cdp.send('Browser.close').catch(() => {});
child.kill();
process.exit(0);
