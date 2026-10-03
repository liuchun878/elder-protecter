#!/usr/bin/env node
/**
 * record-promo.mjs —— 用**真实原型**渲染 15 秒演示片（S 线）
 *
 * 为什么不用屏幕录制：`?film=1` 让原型进入拍摄模式——不自动走表、动画与运镜由本脚本**逐帧驱动**，
 * 因此同一份代码每次渲染出的每一帧都一致：可重跑、可 diff，不受机器快慢影响。
 *
 * 用法：
 *   cd prototype && python3 -m http.server 8000        # 另开一个终端
 *   node scripts/record-promo.mjs --no-sandbox
 *
 * 依赖：① 本地静态服务器（ES module 必须走 http）② 无头 Chrome ③ ffmpeg（编码 + 混音）
 * ffmpeg 可用 FFMPEG=/path/to/ffmpeg 指定。本仓库**不引入任何 npm 依赖**，本脚本只用 Node 内置模块。
 *
 * 音轨是**合成**的（低频铺底 + 三声提示音），不引入任何外部音频资产——与「断网可用」红线一致。
 *
 * ⚠️ 内容红线（改分镜/字幕时请一并守住）：
 *   - 不出现「已服下」「服药完成」：**取药 ≠ 服药**；面板灯只代表「已取走 · 已记录」
 *   - 不出现摄像头监测 / 感知老人位置 / 验证她真的吃了
 *   - 不出现补服、剂量、相互作用建议；不出现依从性评分或排名
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const FPS = Number(flag('fps', 24));
const WIDTH = Number(flag('width', 1600));
const HEIGHT = Number(flag('height', 900));
const PORT = Number(flag('port', 9333));
const URL_BASE = flag('url', 'http://127.0.0.1:8000/');
const CHROME = flag('chrome', process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const FFMPEG = flag('ffmpeg', process.env.FFMPEG || 'ffmpeg');
const OUT = flag('out', path.resolve('recordings/promo-15s.mp4'));
const WORK = flag('work', fs.mkdtempSync(path.join(os.tmpdir(), 'medbot-film-')));
const KEEP_FRAMES = has('keep-frames');
const NO_AUDIO = has('no-audio');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lerp = (a, b, k) => a + (b - a) * k;

/* ── 分镜（15.0 秒 = 360 帧 @ 24fps）─────────────────────────────────────
 * 机位全部是「以机器人当前位置与朝向为基准」的跟随机位，所以机器人走到哪都框得住。
 * 第 7 段切到家属端（?view=family）——这是豆包那类纯生成视频没有的一环：闭环真的有人接。
 */
const SUBTITLE_STYLE = [
  'position:fixed', 'left:50%', 'bottom:5%', 'transform:translateX(-50%)',
  'max-width:84%', 'padding:15px 30px', 'border-radius:16px',
  'background:rgba(24,30,36,0.86)', 'color:#ffffff',
  'font:600 31px/1.45 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif',
  'letter-spacing:.5px', 'text-align:center', 'z-index:99', 'pointer-events:none',
].join(';');

const END_CARD_HTML = `
<div style="position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:30px;background:rgba(18,24,30,0.95);color:#fff;text-align:center;padding:0 8%;
            font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif;">
  <div style="font-size:58px;font-weight:800;letter-spacing:2px;">送药机器人 · 居家仿真演示</div>
  <div style="font-size:31px;color:#8fd3d9;font-weight:600;">到点 → 送达 → 取走确认 → 记录 → 没确认就通知家属</div>
  <div style="font-size:25px;line-height:1.9;color:#d8e2e8;">
    取药 ≠ 服药　｜　不采集摄像头画面　｜　不自动呼叫急救　｜　不给补服建议<br />
    移动与到场是<b>预置路径动画</b>（仿真）；老人在哪是<b>开关模拟</b>——不宣称感知能力<br />
    全部逻辑与数据在本机：断网可用 · 无 CDN · 无外部模型<br />
    <span style="color:#9fb0bb;">王阿姨为虚构人物 ｜ 非医疗用途</span>
  </div>
</div>`;

const SEGMENTS = [
  {
    frames: 30,
    say: '王阿姨 76 岁，独居｜每天固定时段要吃好几种药',
    cam: (k) => ({ followCam: { distance: lerp(4.8, 4.1, k), height: lerp(2.0, 1.75, k), angleDeg: lerp(-34, -22, k), aimHeight: 0.55, fov: 40 } }),
  },
  {
    frames: 84,
    say: '08:00 到点：机器人从充电座出发，把药送到人身边',
    cam: (k) => ({ followCam: { distance: lerp(3.0, 2.3, k), height: lerp(1.4, 1.2, k), angleDeg: lerp(98, 44, k), aimHeight: 0.6, aimLead: 0.45, fov: 42 } }),
  },
  {
    frames: 20,
    say: '不催、不反复喊 —— 一次只要求一个动作',
    cam: (k) => ({ followCam: { distance: lerp(2.2, 1.95, k), height: 1.18, angleDeg: lerp(38, 30, k), aimHeight: 0.76, fov: 40 } }),
  },
  {
    frames: 56,
    say: '药盒与温水放在托盘上：大字屏 + 语音念医嘱原文',
    cam: (k) => ({ followCam: { distance: lerp(1.95, 1.78, k), height: lerp(1.22, 1.14, k), angleDeg: lerp(34, 29, k), aimHeight: lerp(0.82, 0.84, k), aimLead: 0.03, fov: 38 } }),
  },
  {
    frames: 18,
    say: '取走即确认（点一下，或托盘传感器事件）',
    cam: () => ({ followCam: { distance: 1.78, height: 1.14, angleDeg: 29, aimHeight: 0.84, aimLead: 0.03, fov: 38 } }),
  },
  {
    frames: 58,
    say: '重复取药会被拦住；记录写在本机，双时间戳可追溯',
    cam: (k) => ({ followCam: { distance: lerp(1.7, 3.4, k), height: lerp(1.05, 1.5, k), angleDeg: lerp(28, 88, k), aimHeight: lerp(0.8, 0.55, k), fov: 42 } }),
  },
  {
    frames: 54,
    family: true,
    say: '家属端只推事实：几点没确认、提醒了几次 —— 不给补服建议',
  },
  { frames: 40, endCard: true, hold: true, say: '' },
];

/** 关键帧动作：帧号 → 做什么 */
const CUES = {
  30: [['advanceDemo', 600]], // 07:50 → 08:00，到点触发
  190: [['confirmActive']], // 王阿姨取走
  266: [['escalateTo2000'], ['navigateFamily']], // 跳到 20:00 触发升级链路，然后切家属端
};

/* ── 合成音轨（不引入任何外部音频资产）───────────────────────────────
 * 低频铺底（110/165 Hz 正弦 + 缓慢颤音）+ 三声提示音，符合「提示音走低频」的既有决定。
 */
function buildWav(durationSec, sampleRate = 44100) {
  const total = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(total);

  const add = (fn) => {
    for (let i = 0; i < total; i += 1) data[i] += fn(i / sampleRate, i);
  };
  const chime = (at, freq, amp, decay) => {
    const start = Math.floor(at * sampleRate);
    const len = Math.floor(decay * sampleRate);
    for (let i = 0; i < len; i += 1) {
      const idx = start + i;
      if (idx >= total) break;
      const t = i / sampleRate;
      const env = Math.exp(-4.2 * (t / decay));
      data[idx] += amp * env * Math.sin(2 * Math.PI * freq * t);
    }
  };

  // 铺底：两个低频正弦 + 缓慢颤音，首尾淡入淡出
  add((t) => {
    const tremolo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.22 * t);
    const fadeIn = Math.min(1, t / 0.8);
    const fadeOut = Math.min(1, Math.max(0, (durationSec - t) / 1.2));
    const env = fadeIn * fadeOut * tremolo;
    return env * (0.15 * Math.sin(2 * Math.PI * 110 * t) + 0.095 * Math.sin(2 * Math.PI * 164.81 * t));
  });

  chime(1.25, 523.25, 0.3, 0.9); // 出发
  chime(7.92, 659.25, 0.34, 1.1); // 取走确认
  chime(11.08, 587.33, 0.28, 1.2); // 切家属端
  chime(14.1, 392.0, 0.28, 1.4); // 收尾

  // 16-bit PCM 立体声 WAV
  const bytes = Buffer.alloc(44 + total * 2 * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + total * 2 * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2 * 2, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(total * 2 * 2, 40);
  let offset = 44;
  for (let i = 0; i < total; i += 1) {
    const v = Math.max(-1, Math.min(1, data[i]));
    const s = Math.round(v * 32767);
    bytes.writeInt16LE(s, offset);
    bytes.writeInt16LE(s, offset + 2);
    offset += 4;
  }
  return bytes;
}

/* ── CDP 最小客户端 ─────────────────────────────────────────────────── */

async function connect(port) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (err) { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('连不上 Chrome 调试端口，请检查 Chrome 是否启动');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const problems = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(msg.params.entry.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, problems };
}

/* ── 主流程 ─────────────────────────────────────────────────────────── */

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  try {
    const probe = await fetch(URL_BASE);
    if (!probe.ok) throw new Error(String(probe.status));
  } catch (err) {
    console.error(`✗ 打不开 ${URL_BASE} —— 请先在另一个终端运行：cd prototype && python3 -m http.server 8000`);
    process.exit(1);
  }

  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(WORK, 'chrome-profile')}`,
    '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ];
  if (has('no-sandbox')) chromeArgs.unshift('--no-sandbox');
  const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
  const stopChrome = () => { try { chrome.kill('SIGKILL'); } catch (err) { /* 已退出 */ } };
  process.on('exit', stopChrome);

  const client = makeClient(await connect(PORT));
  await new Promise((r) => client.ws.addEventListener('open', r));
  const { send, problems } = client;
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const capture = async (index) => {
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 94, captureBeyondViewport: false });
    fs.writeFileSync(path.join(WORK, `f${String(index).padStart(4, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
  };

  // 进入拍摄模式
  await send('Page.navigate', { url: `${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}film=1` });
  await sleep(1500);
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await sleep(3500);

  // 字幕与收尾卡：**每次导航后自动重注入**（家属端是另一个页面，注入会丢）
  const injectOverlays = (text) => evaluate(`(() => {
    if (typeof window.__filmSay !== 'function') {
      const el = document.createElement('div');
      el.id = 'film-subtitle';
      el.setAttribute('style', ${JSON.stringify(SUBTITLE_STYLE)});
      document.body.appendChild(el);
      window.__filmSay = (t) => { el.textContent = t || ''; el.style.display = t ? 'block' : 'none'; };
      window.__filmEnd = () => { const d = document.createElement('div'); d.innerHTML = ${JSON.stringify(END_CARD_HTML)}; document.body.appendChild(d); };
    }
    window.__filmSay(${JSON.stringify(text)});
    return true;
  })()`);
  const say = (text) => injectOverlays(text);
  const endCard = () => evaluate('window.__filmEnd()');

  await injectOverlays('');

  const total = SEGMENTS.reduce((sum, seg) => sum + seg.frames, 0);
  console.log(`拍摄：${total} 帧 @ ${FPS}fps = ${(total / FPS).toFixed(1)} 秒（${WIDTH}×${HEIGHT}）`);

  let index = 0;
  for (const segment of SEGMENTS) {
    if (segment.say !== undefined) await say(segment.say);

    for (let i = 0; i < segment.frames; i += 1, index += 1) {
      // 关键帧动作
      for (const [action, value] of CUES[index] || []) {
        if (action === 'advanceDemo') await evaluate(`window.film.advanceDemo(${value})`);
        if (action === 'confirmActive') await evaluate('window.film.confirmActive()');
        if (action === 'escalateTo2000') {
          // 12:00 正常取走 → 20:00 无人确认 → T+180s 通知家属（用演示时钟推进，等同演示者拨表）
          await evaluate('window.film.advanceDemo(14400)');
          await sleep(120);
          await evaluate('window.film.confirmActive()');
          await evaluate('window.film.advanceDemo(28800)'); // → 20:00 到点
          await evaluate('window.film.advanceDemo(65)'); // T+60s：换通道 + 换措辞
          await sleep(100);
          await evaluate('window.film.advanceDemo(125)'); // T+180s：通知家属（level 2，只推事实）
          await sleep(250);
        }
        if (action === 'navigateFamily') {
          await send('Page.navigate', { url: `${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}view=family` });
          await sleep(2600);
        }
      }

      if (segment.family) {
        // 家属端：缓慢下移，露出通知三选项与时间线
        const k = segment.frames > 1 ? i / (segment.frames - 1) : 0;
        await evaluate(`window.scrollTo(0, ${Math.round(lerp(0, 205, k))})`);
      } else if (!segment.hold) {
        await evaluate(`window.film.step(${1 / FPS})`);
        if (segment.cam) {
          const camera = segment.cam(segment.frames > 1 ? i / (segment.frames - 1) : 0);
          if (camera.followCam) await evaluate(`window.film.followCam(${JSON.stringify(camera.followCam)})`);
          if (camera.mode) await evaluate(`window.film.camera(${JSON.stringify(camera.mode)})`);
        }
      }

      if (segment.endCard) await endCard();
      await capture(index);
      if ((index + 1) % 60 === 0) process.stdout.write(`\r  已拍 ${index + 1}/${total} 帧`);
    }
  }
  process.stdout.write(`\r  已拍 ${index}/${total} 帧\n`);

  // 音轨
  const wavPath = path.join(WORK, 'audio.wav');
  if (!NO_AUDIO) {
    fs.writeFileSync(wavPath, buildWav(total / FPS));
    console.log(`音轨：${(fs.statSync(wavPath).size / 1024).toFixed(0)} KB（合成，无外部资产）`);
  }

  const ffmpegAvailable = await new Promise((resolve) => {
    const probe = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
  if (!ffmpegAvailable) {
    console.error(`\n✗ 找不到 ffmpeg（${FFMPEG}）。帧已保留在：${WORK}`);
    console.error(`  可直接编码：ffmpeg -framerate ${FPS} -i ${path.join(WORK, 'f%04d.jpg')} -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "${OUT}"`);
    stopChrome();
    process.exit(2);
  }

  const ffArgs = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(WORK, 'f%04d.jpg')];
  if (!NO_AUDIO) ffArgs.push('-i', wavPath);
  ffArgs.push('-vf', 'scale=in_range=full:out_range=tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (!NO_AUDIO) ffArgs.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  ffArgs.push('-movflags', '+faststart', OUT);

  const encode = spawn(FFMPEG, ffArgs, { stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    encode.on('error', reject);
    encode.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });

  console.log(`✓ 输出：${OUT}（${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB）`);
  console.log(problems.length ? `⚠️ 渲染期控制台异常：\n${problems.join('\n')}` : '✓ 渲染期零控制台异常');

  if (KEEP_FRAMES) console.log(`帧目录（--keep-frames）：${WORK}`);
  else fs.rmSync(WORK, { recursive: true, force: true });

  stopChrome();
}

main().catch((err) => {
  console.error('✗ 渲染失败：', err.message);
  process.exit(1);
});
