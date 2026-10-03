// 逐步隐藏部件，出对照图，定位跨在镜头上的银色横条
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://127.0.0.1:8788/preview.html'
const OUT = 'D:\\桌面\\机器人\\robot-3d\\_probe\\iso'
const PORT = 9379
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = OUT + '\\edge-profile'
rmSync(PROFILE, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })
const browser = spawn(EDGE, ['--headless=new', '--no-first-run', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=900,1100', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
async function dt() { for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return } catch { } await sleep(400) } throw new Error('no devtools') }
let id = 0
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } })
  return { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
}
await dt()
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
const c = client(ws)
await c.send('Page.enable'); await c.send('Runtime.enable')
await c.send('Page.navigate', { url: URL_ }); await sleep(6500)
await c.send('Runtime.evaluate', { expression: `document.querySelector('.panel').style.display='none';document.querySelector('.tag').style.display='none';document.querySelector('.scale').style.display='none';` })

// 先列出所有部件名
const names = await c.send('Runtime.evaluate', { expression: `JSON.stringify(Array.from(new Set(Array.from(ROBOT.root.children).flatMap(g=>{const a=[];g.traverse(o=>{if(o.name)a.push(o.name)});return a}))))`, returnByValue: true })
console.log('部件名:', names.result.value)

async function shot(name, hideList) {
  const expr = `ROBOT.reset(); ROBOT.setView('front'); ROBOT.view({th:0.0, ph:1.30, r:0.72, ty:0.86});` +
    hideList.map(n => `ROBOT.hide(${JSON.stringify(n)}, false);`).join('')
  await c.send('Runtime.evaluate', { expression: expr })
  await sleep(1500)
  const s = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}\\${name}`, Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}
await shot('00-原样.png', [])
for (const n of ['外壳腰线', '镜头环', '立柱', '立柱底座', '状态灯', '镜头高光', '外壳后端盖']) {
  await shot(`hide-${n}.png`, [n])
}
ws.close(); browser.kill()
