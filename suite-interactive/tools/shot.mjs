// 用无头 Edge + CDP 给 suite-interactive/index.html 出核对截图
// usage: node shot.mjs <htmlPath> <outDir>
// 注意：本机沙箱会挡掉 GUI 程序，跑它需要 danger-full-access
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const HTML = process.argv[2]
const OUT = process.argv[3] || 'D:\\dsh_shots'
const PORT = 9377
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = OUT + '\\edge-profile'

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = spawn(EDGE, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1600,1000', '--force-device-scale-factor=1',
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
  const pending = new Map()
  const logs = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
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
await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable')

await c.send('Page.navigate', { url: pathToFileURL(HTML).href })
await sleep(8000)

const ready = await c.send('Runtime.evaluate', {
  expression: `JSON.stringify({ hasSuite: !!window.SUITE, gl: (()=>{try{const cv=document.querySelector('canvas');const g=cv.getContext('webgl2')||cv.getContext('webgl');return g? g.getParameter(g.VERSION):'no-gl'}catch(e){return 'err:'+e.message}})(), info: window.SUITE ? window.SUITE.info() : null })`,
  returnByValue: true
})
console.log('ready:', ready.result.value)

const report = []
async function shot(name, setup) {
  if (setup) {
    const r = await c.send('Runtime.evaluate', { expression: `(function(){ ${setup} })()`, returnByValue: true })
    if (r.exceptionDetails) console.log('SETUP ERROR', name, JSON.stringify(r.exceptionDetails))
  }
  await sleep(300)
  const s = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}\\${name}`, Buffer.from(s.data, 'base64'))
  const v = await c.send('Runtime.evaluate', { expression: 'JSON.stringify(window.SUITE.info())', returnByValue: true })
  report.push({ name, info: v.result.value })
  console.log('saved', name, v.result.value)
}

// 0.2 s 后就开始的时序：走去沙发（约 2 s 坐下）→ 机器人 5 s 后到 → 出盘/琥珀屏约 9 s
await shot('00-导航自检.png', `console.log('NAV', JSON.stringify(window.SUITE.navStat()), JSON.stringify(window.SUITE.navProbe(9.94,8.85)))`)
await shot('01-初始-客厅.png', `window.SUITE.sim(1.5)`)
await shot('02-去沙发-途中.png', `window.SUITE.go('客厅'); window.SUITE.sim(1.2)`)
await shot('03-坐下.png', `window.SUITE.sim(2.2)`)
await shot('04-机器人出发.png', `window.SUITE.sim(1.6)`)
await shot('05-机器人到身边.png', `window.SUITE.sim(4.4)`)
await shot('06-开门出盘.png', `window.SUITE.sim(1.6)`)
await shot('07-送药中-琥珀屏.png', `window.SUITE.sim(1.2)`)
await shot('08-药盘特写.png', `window.SUITE.robotState('serve'); window.SUITE.flyTo('药盘特写'); window.SUITE.sim(3.2)`)
await shot('09-回到充电桩.png', `window.SUITE.sim(9.0); window.SUITE.flyTo('充电桩'); window.SUITE.sim(3.0)`)
await shot('10-整户.png', `window.SUITE.flyTo('整户'); window.SUITE.sim(3.0)`)
await shot('11-餐区就餐.png', `window.SUITE.go('餐区·餐桌'); window.SUITE.sim(9.0); window.SUITE.flyTo('餐区'); window.SUITE.sim(3.0)`)
await shot('12-卧室.png', `window.SUITE.go('卧室'); window.SUITE.sim(16.0); window.SUITE.flyTo('卧室'); window.SUITE.sim(4.0)`)
await shot('13-出门.png', `window.SUITE.go('出门'); window.SUITE.sim(14.0); window.SUITE.flyTo('客厅·电视墙'); window.SUITE.sim(3.0)`)
await shot('14-导航网格.png', `window.SUITE.nav(true); window.SUITE.flyTo('整户'); window.SUITE.sim(3.0)`)
await shot('15-夜晚.png', `window.SUITE.nav(false); window.SUITE.setLight('夜晚'); window.SUITE.sim(2.0)`)

// —— 真实鼠标点击验证：点画面里的地板 → 王阿姨应当开始走过去并坐下
await shot('16-点击前.png', `window.SUITE.setLight('日光'); window.SUITE.flyTo('客厅·电视墙'); window.SUITE.sim(2.5)`)
const before = await c.send('Runtime.evaluate', { expression: 'JSON.stringify(window.SUITE.info().granny)', returnByValue: true })
for (const type of ['mousePressed', 'mouseReleased']) {
  await c.send('Input.dispatchMouseEvent', { type, x: 1210, y: 690, button: 'left', clickCount: 1 })
  await sleep(60)
}
await shot('17-点击后走过去.png', `window.SUITE.sim(1.1)`)
const after = await c.send('Runtime.evaluate', { expression: 'JSON.stringify(window.SUITE.info().granny)', returnByValue: true })
console.log('CLICK TEST  before=' + before.result.value + '\n            after=' + after.result.value)
await shot('18-走过去后坐下.png', `window.SUITE.sim(4.0)`)

writeFileSync(`${OUT}\\_report.json`, JSON.stringify(report, null, 1))
console.log('--- console log ---')
console.log(c.logs.slice(0, 60).join('\n'))
ws.close()
browser.kill()
console.log('done')
