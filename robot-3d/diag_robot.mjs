// 诊断：在真实渲染里把每个部件投影到屏幕坐标，输出 min/max 与可见性
// usage: node diag_robot.mjs <url>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://127.0.0.1:8788/preview.html'
const OUT = 'D:\\桌面\\机器人\\robot-3d\\_probe'
const PORT = 9378
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = OUT + '\\edge-profile'
rmSync(PROFILE, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })

const browser = spawn(EDGE, ['--headless=new', '--no-first-run', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=900,1200', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'],
  { stdio: 'ignore' })

async function devtools() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json() } catch { }
    await sleep(400)
  }
  throw new Error('no devtools')
}
let id = 0
function client(ws) {
  const pending = new Map(); const logs = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text))
  })
  return { logs, send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
}
await devtools()
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const c = client(ws)
await c.send('Page.enable'); await c.send('Runtime.enable')
await c.send('Page.navigate', { url: URL_ })
await sleep(7000)

const expr = `(function(){
  const T = THREE;
  ROBOT.reset();
  const out = {};
  const views = ['front','side','hero'];
  views.forEach(function(v){
    ROBOT.setView(v);
    ROBOT.camera.updateMatrixWorld(true);
    ROBOT.scene.updateMatrixWorld(true);
    const rows = [];
    ROBOT.scene.traverse(function(o){
      if (!o.isMesh) return;
      if (o.userData.matName === undefined) return;
      const bb = new T.Box3().setFromObject(o);
      // 8 个角点投影
      let minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
      const pts=[];
      for (let i=0;i<8;i++){
        const p = new T.Vector3(i&1?bb.max.x:bb.min.x, i&2?bb.max.y:bb.min.y, i&4?bb.max.z:bb.min.z);
        const s = p.clone().project(ROBOT.camera);
        pts.push([+(s.x).toFixed(3), +(s.y).toFixed(3), +(s.z).toFixed(3)]);
        minx=Math.min(minx,s.x); maxx=Math.max(maxx,s.x); miny=Math.min(miny,s.y); maxy=Math.max(maxy,s.y);
      }
      // 找到节点名
      let p = o, chain=[];
      while (p && p !== ROBOT.root) { if (p.name) chain.unshift(p.name); p = p.parent; }
      const ctr = bb.getCenter(new T.Vector3());
      rows.push({ node: chain.join('/'), mat: o.userData.matName,
        x:[+minx.toFixed(3), +maxx.toFixed(3)], y:[+miny.toFixed(3), +maxy.toFixed(3)],
        worldY:[+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)],
        worldX:[+bb.min.x.toFixed(3), +bb.max.x.toFixed(3)],
        worldZ:[+bb.min.z.toFixed(3), +bb.max.z.toFixed(3)],
        screenY: +(1-(bb.getCenter(new T.Vector3()).clone().project(ROBOT.camera).y)).toFixed(3) });
    });
    out[v] = rows;
  });
  out.box = (function(){ const b = new T.Box3().setFromObject(ROBOT.root); return {min:b.min.toArray().map(x=>+x.toFixed(3)), max:b.max.toArray().map(x=>+x.toFixed(3))}; })();
  out.cam = { pos: ROBOT.camera.position.toArray().map(x=>+x.toFixed(3)), th:+ROBOT.cam.th.toFixed(3), ph:+ROBOT.cam.ph.toFixed(3), r:+ROBOT.cam.r.toFixed(3) };
  // 直接验证"摄像头外壳"的顶点世界坐标（排除包围盒/分解的干扰）
  out.head = (function(){
    let res = null;
    ROBOT.root.traverse(function(o){
      if (res || !o.isMesh) return;
      let p = o, chain = [];
      while (p && p !== ROBOT.root) { if (p.name) chain.unshift(p.name); p = p.parent; }
      if (chain.join('/').indexOf('摄像头外壳') < 0) return;
      const pos = o.geometry.attributes.position;
      const v = new T.Vector3(); const acc = [];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); acc.push(v.clone()); }
      const bb = new T.Box3().setFromPoints(acc);
      res = { chain: chain.join('/'), rot: o.parent.rotation.toArray().slice(0,3).map(x=>+(x*180/Math.PI).toFixed(1)),
              worldMin: bb.min.toArray().map(x=>+x.toFixed(3)), worldMax: bb.max.toArray().map(x=>+x.toFixed(3)),
              firstVerts: acc.slice(0,3).map(q=>q.toArray().map(x=>+x.toFixed(3))) };
    });
    return res;
  })();
  return JSON.stringify(out);
})()`
const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true })
writeFileSync(OUT + '\\diag.json', r.result.value || '{}')
const d = JSON.parse(r.result.value || '{}')
console.log('整体包围盒', JSON.stringify(d.box), 'camera', JSON.stringify(d.cam))
console.log('摄像头外壳实测', JSON.stringify(d.head))
for (const v of ['front', 'side']) {
  console.log('\n=== ' + v + ' ===')
  ;(d[v] || []).sort((a, b) => b.worldY[1] - a.worldY[1]).forEach(x => {
    console.log((x.node + '                              ').slice(0, 30),
      '| mat', (x.mat + '        ').slice(0, 8),
      '| worldY', x.worldY.join('..'), '| worldX', x.worldX.join('..'), '| worldZ', x.worldZ.join('..'),
      '| NDCy', x.y.join('..'))
  })
}
console.log('\nconsole:', c.logs.slice(0, 10).join(' | '))
ws.close(); browser.kill()
