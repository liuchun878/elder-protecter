// 用无头 Edge 给 robot-3d 查看器批量截图（CDP，无依赖）
// usage: node shot_robot.mjs <url> <outDir>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://127.0.0.1:8788/'
const OUT = process.argv[3] || 'D:\\桌面\\机器人\\robot-3d\\shots'
const PORT = 9377
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = OUT + '\\edge-profile'

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = spawn(EDGE, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1200,1400', '--force-device-scale-factor=1',
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
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text))
    }
  })
  return {
    logs,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id; pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  }
}

const info = await devtools()
console.log('browser:', info.Browser)
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const c = client(ws)
await c.send('Page.enable'); await c.send('Runtime.enable')

await c.send('Page.navigate', { url: URL_ })
await sleep(7000)
const ready = await c.send('Runtime.evaluate', {
  expression: `JSON.stringify({ ready: !!window.ROBOT, tri: window.ROBOT && window.ROBOT.tri, size: window.ROBOT && window.ROBOT.size, err: window.__err || null })`,
  returnByValue: true
})
console.log('ready:', ready.result.value)

async function shot(name, setup) {
  await c.send('Runtime.evaluate', { expression: setup, awaitPromise: false, returnByValue: true })
  await sleep(1800)
  const s = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}\\${name}`, Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}

// 面板会挡视线：截图时把它藏起来
await c.send('Runtime.evaluate', { expression: `document.querySelector('.panel').style.display='none'; document.querySelector('.tag').style.display='none';` })

const shots = [
  ['01-正面.png', `ROBOT.setView('front')`],
  ['02-正面3q.png', `ROBOT.setView('hero')`],
  ['03-侧面.png', `ROBOT.setView('side')`],
  ['04-背面.png', `ROBOT.setView('back')`],
  ['05-俯视.png', `ROBOT.setView('top')`],
  ['06-低角度.png', `ROBOT.setView('low')`],
  ['07-屏幕特写.png', `ROBOT.view({th:0.18, ph:1.24, r:0.92, ty:0.60})`],
  ['08-顶部镜头.png', `ROBOT.view({th:0.30, ph:1.02, r:1.05, ty:0.94})`],
  ['09-木拉手.png', `ROBOT.view({th:0.30, ph:0.78, r:1.15, ty:0.86})`],
  ['10-底部轮子.png', `ROBOT.view({th:0.30, ph:1.72, r:1.05, ty:0.22})`],
  ['11-分解.png', `ROBOT.setView('hero'); ROBOT.explode(0.75)`],
  ['12-绿屏.png', `ROBOT.explode(0); ROBOT.setView('hero'); ROBOT.screen('green')`],
  ['13-侧面标尺.png', `ROBOT.screen('logo'); ROBOT.setView('side'); ROBOT.dims(true)`]
]
for (const [n, s] of shots) await shot(n, s)

console.log('--- console ---')
console.log(c.logs.slice(0, 30).join('\n'))
ws.close(); browser.kill()
console.log('done')
