/* =============================================================================
 * export-glb.mjs — 无头 Edge 里跑一页，把程序化生成的老奶奶导成标准 GLB
 *
 *   node tools/export-glb.mjs [输出目录]
 *   默认输出 <项目>/assets/grandma.glb 与 grandma-robot.glb
 *
 * 需要一个正在运行的本地静态服务（tools/serve.mjs）以及可用的无头浏览器：
 * 沙箱会挡掉 GUI 程序，所以这条命令需要在完整权限下运行。
 * ========================================================================== */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'assets');
const URLBASE = process.env.EXPORT_URL || 'http://127.0.0.1:5173/export.html';
const PORT = 9345;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) throw new Error('找不到 Edge');

const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });
const PROFILE = path.join(ROOT, '_probe', 'edge-profile-export');
fs.mkdirSync(PROFILE, { recursive: true });

const child = spawn(EDGE, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--window-size=800,600', 'about:blank'
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const page = list.find(t => t.type === 'page');
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch (e) { /* 等待 */ }
  if (!wsUrl) await sleep(300);
}
if (!wsUrl) { child.kill(); throw new Error('调试端口没起来'); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0;
const waiters = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) {
    const w = waiters.get(m.id); waiters.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  }
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((res, rej) => {
    waiters.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); rej(new Error('timeout ' + method)); } }, 120000);
  });
}
async function ev(expr, awaitPromise) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URLBASE });
await sleep(3500);

const ready = await ev('typeof window.exportGLB === "function" && typeof window.grandmaRoot === "object"');
if (!ready) throw new Error('导出页没准备就绪');
console.log('页面自检: ' + JSON.stringify(await ev('window.GRANDMA_STATS')));

const jobs = [
  { file: 'grandma.glb', js: 'window.exportGLB(window.grandmaRoot, { name: "老奶奶" })' },
  { file: 'grandma-robot.glb', js: 'window.exportGLB(window.robotRoot, { name: "送药机器人" })' },
  { file: 'room.glb', js: 'window.exportGLB(window.roomRoot, { name: "客厅场景" })' }
];

for (const job of jobs) {
  await ev('window.__b64 = ' + job.js + '; window.__i = 0; window.__len = window.__b64.length; window.__len');
  const len = await ev('window.__len');
  let b64 = '';
  const CHUNK = 200000;
  while (true) {
    const part = await ev(`(function(){var s=window.__b64.substr(window.__i, ${CHUNK}); window.__i+=${CHUNK}; return s;})()`);
    if (!part) break;
    b64 += part;
    if (b64.length >= len) break;
  }
  const buf = Buffer.from(b64, 'base64');
  const out = path.join(OUTDIR, job.file);
  fs.writeFileSync(out, buf);
  console.log(job.file + '  ' + (buf.length / 1024).toFixed(1) + ' KB  -> ' + path.relative(ROOT, out));
  await ev('window.__b64 = null');
}

await send('Browser.close').catch(() => {});
child.kill();
process.exit(0);
