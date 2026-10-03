// 快速诊断：加载 index.html，跑几段表达式并打印结果（不出图）
// usage: node probe.mjs <htmlPath> [expr1] [expr2] ...
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const HTML = process.argv[2]
const EXPRS = process.argv.slice(3)
const PORT = 9378
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = 'D:\\桌面\\机器人\\suite-interactive\\shots\\edge-probe'
rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

const browser = spawn(EDGE, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=800,600', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'
], { stdio: 'ignore' })

async function devtools() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json() } catch { }
    await sleep(400)
  }
  throw new Error('devtools never came up')
}
let id = 0
function client(ws) {
  const pending = new Map(); const logs = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text))
    else if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
  })
  return { logs, send: (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })) }) }
}
await devtools()
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const c = client(ws)
await c.send('Page.enable'); await c.send('Runtime.enable')
await c.send('Page.navigate', { url: pathToFileURL(HTML).href })
await sleep(7000)
for (const e of EXPRS) {
  const r = await c.send('Runtime.evaluate', { expression: `JSON.stringify((function(){ return (${e}) })())`, returnByValue: true })
  console.log('>>', e, '\n  ', r.result && r.result.value, r.exceptionDetails ? JSON.stringify(r.exceptionDetails.exception) : '')
}
if (c.logs.length) console.log('--- logs ---\n' + c.logs.slice(0, 30).join('\n'))
ws.close(); browser.kill()
