// 干净环境验证 robot.glb：全新 canvas / 全新 renderer，只画 glb 里的东西
// 不依赖 preview.html、不依赖 scene.json
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:8788/'
const OUT = 'D:\\桌面\\机器人\\robot-3d\\shots'
const PORT = 9382
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TMP = 'D:\\桌面\\机器人\\robot-3d\\_glbcheck'
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + '\\prof', { recursive: true }); mkdirSync(OUT, { recursive: true })
// 一个只有 three 的最小宿主页
writeFileSync(TMP + '\\host.html', `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}canvas{display:block}</style></head><body><script src="${BASE}vendor/three.min.js"><\/script></body></html>`)

const browser = spawn(EDGE, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1000,1250', `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}\\prof`, 'about:blank'], { stdio: 'ignore' })
async function dt() { for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return } catch { } await sleep(400) } throw new Error('no devtools') }
let id = 0
function client(ws) {
  const pending = new Map(); const logs = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text))
  })
  return { logs, send: (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) }) }
}
await dt()
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
const c = client(ws)
await c.send('Page.enable'); await c.send('Runtime.enable')
await c.send('Page.navigate', { url: BASE + '_glbcheck.html' })
await sleep(3000)

const script = `(async function(){
  const T = THREE;
  const W = 900, H = 1150;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  document.body.appendChild(cv);
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputColorSpace = 'srgb';
  const gl = renderer.getContext();
  const scene = new T.Scene(); scene.background = new T.Color(0xeae7e1);
  scene.add(new T.HemisphereLight(0xf2f6ff, 0xb0a294, 1.15));
  const d1 = new T.DirectionalLight(0xfff2e0, 2.0); d1.position.set(2.5, 4, 3); scene.add(d1);
  const d2 = new T.DirectionalLight(0xdae6ff, 0.7); d2.position.set(-3, 2, -2); scene.add(d2);

  const res = await fetch(${JSON.stringify(BASE + 'robot.glb')});
  const ab = await res.arrayBuffer();
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off < ab.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(ab, off + 8, len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004E4942) bin = body;
    off += 8 + len;
  }
  const g = json, bdv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  function attr(i, asInt) {
    const a = g.accessors[i], bv = g.bufferViews[a.bufferView], nc = NC[a.type], cs = CS[a.componentType];
    const stride = bv.byteStride || nc * cs, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = asInt ? new Uint32Array(a.count * nc) : new Float32Array(a.count * nc);
    for (let k = 0; k < a.count; k++) for (let j = 0; j < nc; j++) {
      const o = base + k * stride + j * cs;
      out[k * nc + j] = a.componentType === 5126 ? bdv.getFloat32(o, true)
        : a.componentType === 5125 ? bdv.getUint32(o, true)
        : a.componentType === 5123 ? bdv.getUint16(o, true)
        : a.componentType === 5121 ? bdv.getUint8(o) : bdv.getInt16(o, true);
    }
    return out;
  }
  function texOf(ti) {
    const im = g.images[g.textures[ti].source], bv = g.bufferViews[im.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const tex = new T.Texture(); tex.flipY = false; tex.colorSpace = 'srgb';
    const img = new Image(); img.onload = function () { tex.image = img; tex.needsUpdate = true; }; img.src = 'data:' + im.mimeType + ';base64,' + btoa(s);
    return tex;
  }
  const mats = (g.materials || []).map(function (m) {
    const p = m.pbrMetallicRoughness || {};
    const o = { color: new T.Color(1, 1, 1), roughness: p.roughnessFactor !== undefined ? p.roughnessFactor : 1, metalness: p.metallicFactor !== undefined ? p.metallicFactor : 1, side: m.doubleSided ? T.DoubleSide : T.FrontSide };
    if (p.baseColorFactor) o.color.fromArray(p.baseColorFactor);
    if (p.baseColorTexture) o.map = texOf(p.baseColorTexture.index);
    if (m.emissiveFactor && m.emissiveFactor.some(function (v) { return v > 0; })) o.emissive = new T.Color().fromArray(m.emissiveFactor);
    if (m.emissiveTexture) o.emissiveMap = texOf(m.emissiveTexture.index);
    return new T.MeshStandardMaterial(o);
  });
  const meshes = (g.meshes || []).map(function (m) {
    const pr = m.primitives[0], geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(attr(pr.attributes.POSITION), 3));
    if (pr.attributes.NORMAL !== undefined) geo.setAttribute('normal', new T.BufferAttribute(attr(pr.attributes.NORMAL), 3));
    else geo.computeVertexNormals();
    if (pr.attributes.TEXCOORD_0 !== undefined) geo.setAttribute('uv', new T.BufferAttribute(attr(pr.attributes.TEXCOORD_0), 2));
    geo.setIndex(new T.BufferAttribute(attr(pr.indices, true), 1));
    return { geo: geo, mat: pr.material };
  });
  const nodes = (g.nodes || []).map(function (n) {
    const grp = new T.Group(); grp.name = n.name || '';
    if (n.translation) grp.position.fromArray(n.translation);
    if (n.rotation) grp.quaternion.fromArray(n.rotation);
    if (n.scale) grp.scale.fromArray(n.scale);
    if (n.mesh !== undefined) {
      const mm = meshes[n.mesh];
      const me = new T.Mesh(mm.geo, mm.mat !== undefined ? mats[mm.mat] : new T.MeshStandardMaterial({ color: 0xbbbbbb }));
      grp.add(me);
    }
    return grp;
  });
  nodes.forEach(function (grp, i) { (g.nodes[i].children || []).forEach(function (ci) { grp.add(nodes[ci]); }); });
  const root = new T.Group();
  g.scenes[g.scene || 0].nodes.forEach(function (i) { root.add(nodes[i]); });
  scene.add(root);

  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
  let tri = 0, nm = 0; root.traverse(function (o) { if (o.isMesh) { nm++; tri += o.geometry.index.count / 3; } });
  const camera = new T.PerspectiveCamera(30, W / H, 0.01, 100);
  camera.position.set(ctr.x + 0.95, size.y * 0.60, ctr.z + 1.85);
  camera.lookAt(ctr.x, size.y * 0.52, ctr.z);
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);

  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let bg = 0, body = 0, glass = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2], lum = (r + gg + b) / 3;
    if (lum > 238) body++;
    else if (lum < 90) glass++;
    else bg++;
  }
  return JSON.stringify({ size: size.toArray().map(function (v) { return +v.toFixed(3); }),
    min: box.min.toArray().map(function (v) { return +v.toFixed(3); }),
    max: box.max.toArray().map(function (v) { return +v.toFixed(3); }),
    meshes: nm, tri: tri, mats: mats.length, nodes: nodes.length,
    brightPx: body, darkPx: glass, midPx: bg, cam: camera.position.toArray().map(function (v) { return +v.toFixed(2); }) });
})()`
const r = await c.send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails).slice(0, 1200))
console.log('GLB 干净环境渲染:', (r.result && r.result.value) ? r.result.value : JSON.stringify(r.result))
await sleep(700)
const s = await c.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}\\14-GLB独立渲染.png`, Buffer.from(s.data, 'base64'))
console.log('saved 14-GLB独立渲染.png')
console.log('console:', c.logs.slice(0, 10).join(' | '))
ws.close(); browser.kill()
