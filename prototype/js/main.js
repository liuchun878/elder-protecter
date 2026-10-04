/**
 * main.js —— 只做装配（S 线）
 *
 * 契约：契约-接口.md §3 命令接口、§8 调试抽屉；仿真呈现与开发阶段计划 §2.4 演示时间轴
 * 约束：**不写业务规则**——这里只做：订阅 → 调各 render/update、视图路由、调试抽屉、假数据种子。
 *
 * 依赖方向：main.js 可以 import 全部；H 的功能层永不 import 本文件。
 */

import { store, storageWarning } from './store.js';
import * as plan from './plan.js';
import * as presence from './presence.js';
import * as schedule from './schedule.js';
import * as machine from './machine.js';
import * as escalate from './escalate.js';
import { createClock, ACCELERATIONS, DEFAULT_DEMO_START } from './clock.js';
import { createScene3D } from './scene3d.js';
import { createScene2D } from './scene2d.js';
import { createRobot } from './robot.js';
import { createPerson } from './person.js';
import { mountHud } from './hud.js';
import { mountConsole } from './controls.js';
import { mountFamilyPanel } from './family.js';
import { audio } from './audio.js';
import { createDemoScript } from './demo-script.js';

const BUILD = 'v1.20';
if (typeof console !== 'undefined') console.info(`[medbot] build ${BUILD}`);
const params = new URLSearchParams(window.location.search);
const VIEW = params.get('view') === 'family' ? 'family' : 'main';
/** 拍摄模式：`?film=1` —— 由 scripts/record-promo.mjs 逐帧驱动，用于可复现录屏 */
const FILM_MODE = params.get('film') === '1';

/* ── 假数据种子（P1：假数据种子，契约 §4.1）────────────────────────────
 * 三个时段、四条计划、零冲突。场景 2 的「阿莫西林 08:00」由家属端现场加，
 * 才会出现契约 §6 要求的「时段冲突并列展示」。
 * 全部为虚构数据，剂量一律照「医嘱原文」记录，系统不做任何换算或解释。
 */
function seedDemoData() {
  if (store.getState().plans.length) return;
  /* ⚠️ 必须显式给 `startDate`（= 演示时钟那一天）。
   * 这里跑在 `store.setClock(clock.snapshot())` **之前**，`plan.create` 拿不到演示时钟，
   * 会退回「本机今天」——而演示时钟永远停在 2026-10-03。只要本机日期往前过了 10-03，
   * `plan.startDate > 事件日期`，`schedule.materializeToday()` 就会一条事件都不物化，
   * 于是**到点永远不触发**（2026-10-04 实测复现：events=0、activeEventId=null）。 */
  const startDate = DEFAULT_DEMO_START.slice(0, 10);
  plan.create({ name: '氨氯地平', doseText: '5mg', kind: 'regular', startDate, slots: [{ time: '08:00', label: '晨起' }], notes: '饭后服' });
  plan.create({ name: '二甲双胍', doseText: '0.5g', kind: 'regular', startDate, slots: [{ time: '10:00', label: '上午' }], notes: '随餐' });
  plan.create({ name: '碳酸钙D3', doseText: '1片', kind: 'regular', startDate, slots: [{ time: '12:30', label: '午间' }], notes: '饭后半小时' });
  plan.create({ name: '阿司匹林', doseText: '100mg', kind: 'regular', startDate, slots: [{ time: '16:00', label: '下午' }], notes: '温水送服' });
  plan.create({ name: '阿托伐他汀钙', doseText: '20mg', kind: 'regular', startDate, slots: [{ time: '20:00', label: '晚间' }], notes: '睡前服' });
}

/* ── 顶栏提示（离线 / 存储不可用 / 3D 降级）────────────────────────── */

function mountBanner() {
  const banner = document.getElementById('banner');
  if (!banner) return;
  const storageNote = storageWarning();
  const offlineNote = document.createElement('p');
  offlineNote.className = 'banner__item';
  offlineNote.textContent = '离线中，记录保存在本机（不产生任何网络请求）';
  offlineNote.hidden = true;
  banner.appendChild(offlineNote);

  function refreshOffline() {
    const offline = !navigator.onLine || store.getState().offline;
    offlineNote.hidden = !offline;
    banner.hidden = !offline && !storageNote && voiceNote.hidden;
  }

  /* v1.14：浏览器要求"先有用户手势"才允许出声，而"到吃药时间"是**自动发生**的 ——
   * 没有任何点击时，语音会被自动播放策略掐掉（用户实测："到吃药时间没有声音"）。
   * 这里明示一句，并在首次点击/按键后隐藏；`audio.attachUnlock()` 会把被掐掉的那句补播一次。 */
  const voiceNote = document.createElement('p');
  voiceNote.className = 'banner__item';
  voiceNote.textContent = '点一下页面即可听到语音（浏览器要求先有一次交互）';
  banner.appendChild(voiceNote);
  const hideVoiceNote = () => {
    voiceNote.hidden = true;
    refreshOffline();
  };
  window.addEventListener('pointerdown', hideVoiceNote, { once: true });
  window.addEventListener('keydown', hideVoiceNote, { once: true });

  if (storageNote) {
    const notice = document.createElement('p');
    notice.className = 'banner__item';
    notice.textContent = storageNote;
    banner.appendChild(notice);
    banner.hidden = false;
  }

  window.addEventListener('online', refreshOffline);
  window.addEventListener('offline', refreshOffline);
  store.subscribe(refreshOffline);
  refreshOffline();
}

/* ── 左下角演示控制条（v1.14 · 用户口径「左下角一个按键弹出家属端副屏」+「可切换模式」）──
 * v1.16：**副屏改成页内「手机屏」**（用户口径「家属端副屏可以用一个手机屏幕展示」），
 * 并且**所有小窗口都能点一下收起/展开**（用户口径「所有小窗口都可以点击收起打开」）。 */

/** 页内手机壳（懒创建；`iframe` 同源加载 `?view=family`，零外部请求） */
function ensurePhone() {
  let phone = document.getElementById('phone');
  if (phone) return phone;
  phone = document.createElement('div');
  phone.className = 'phone is-collapsed';
  phone.id = 'phone';
  phone.innerHTML = [
    '<div class="phone__frame">',
    '<div class="phone__notch"></div>',
    '<div class="phone__title">家属端（点右上 ⌄ 展开）</div>',
    // v1.17：手机屏内容 = **队友做的家属端 App**（仓库根 `family-app/`，由禁缓存服务器双根提供）
    '<iframe class="phone__screen" title="家属端（队友做的 App）" src="/family-app/index.html"></iframe>',
    '<div class="phone__tabs">'
    + '<button type="button" class="phone__tab is-on" data-app="family-app/index.html">家属端</button>'
    + '<button type="button" class="phone__tab" data-app="family-app/robot-settings.html">机器人设置</button>'
    + '</div>',
    '</div>',
  ].join('');
  document.body.appendChild(phone);
  // v1.21：屏幕内容可切换（家属端 App / 队友最新那份机器人设置）
  for (const tab of phone.querySelectorAll('.phone__tab')) {
    tab.addEventListener('click', () => {
      const app = tab.dataset.app;
      phone.querySelector('.phone__screen').src = `/${app}`;
      for (const t of phone.querySelectorAll('.phone__tab')) t.classList.toggle('is-on', t === tab);
    });
  }
  return phone;
}

/**
 * 给任意窗口加一颗「收起 / 展开」圆片（用户口径：所有小窗口都可以点击收起打开）。
 * 只是加一个 class + 同步 `aria-expanded`，不改任何布局逻辑与点击目标。
 */
function addCollapseToggle({ target, className, label, bodyClass = null, onToggle = null }) {
  if (!target) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `collapse-toggle ${className}`;
  b.textContent = '▾';
  b.title = `${label}：收起 / 展开`;
  b.setAttribute('aria-label', `${label} 收起或展开`);
  b.setAttribute('aria-expanded', 'true');
  b.addEventListener('click', () => {
    const collapsed = target.classList.toggle('is-collapsed');
    if (bodyClass) document.body.classList.toggle(bodyClass, collapsed);
    b.textContent = collapsed ? '▸' : '▾';
    b.setAttribute('aria-expanded', String(!collapsed));
    if (onToggle) onToggle(collapsed);
  });
  document.body.appendChild(b);
  return b;
}


/* ── v1.19：固定演示的「播放器」（用户口径：做成一段可以像视频一样播放的片子，
 * 并且**随时可以暂停**方便讲解）──────────────────────────────────────────
 * 它只转调剧本执行器的命令（play/pause/restart/jump），不写任何业务规则。
 * 拍摄模式（?film=1）下不挂载 —— 录屏时要的是干净画面。 */
function mountPlayer({ script, onSpeak }) {
  const root = document.getElementById('player');
  if (!root) return null;
  root.hidden = false;
  root.innerHTML = [
    '<span class="player__brand">保卫老人</span>',
    '<button type="button" class="player__btn" data-act="prev" title="上一场">⟨</button>',
    '<button type="button" class="player__btn player__btn--play" data-act="toggle" title="播放 / 暂停（空格）">▶</button>',
    '<button type="button" class="player__btn" data-act="next" title="下一场">⟩</button>',
    '<button type="button" class="player__btn" data-act="restart" title="重播">↻</button>',
    '<div class="player__mid"><div class="player__chapter"></div>',
    '<div class="player__track"><i></i></div></div>',
    '<div class="player__count"></div>',
  ].join('');

  const btn = (act) => root.querySelector(`[data-act="${act}"]`);
  const glyph = () => {
    const st = script.status();
    btn('toggle').textContent = st.paused ? '▶' : '❚❚';
  };

  btn('toggle').addEventListener('click', () => { script.toggle(); glyph(); });
  btn('restart').addEventListener('click', () => { script.restart(); glyph(); });
  btn('prev').addEventListener('click', () => {
    const st = script.status();
    script.jump(Math.max(0, (st.index < 0 ? 0 : st.index) - 1));
    glyph();
  });
  btn('next').addEventListener('click', () => {
    const st = script.status();
    script.jump(Math.min(st.total - 1, (st.index < 0 ? 0 : st.index) + 1));
    glyph();
  });

  let lastSpoken = -1;
  return {
    /** 剧本拍子变化时刷新播放器与字幕（由 demo-script 的 onBeat 回调驱动） */
    update(st) {
      const { index = -1, total = 1, beat = null, paused = false } = st || {};
      root.querySelector('.player__chapter').textContent = beat ? beat.label : '（待开始）';
      root.querySelector('.player__count').textContent = `${Math.max(1, index + 1)} / ${total}`;
      const pct = total > 1 ? (Math.max(0, index) / (total - 1)) * 100 : 0;
      root.querySelector('.player__track > i').style.width = `${pct}%`;
      glyph();
      document.body.classList.toggle('is-paused', Boolean(paused));
      if (beat && index !== lastSpoken) {
        lastSpoken = index;
        // v1.21：换场先"静场"——把上一场还没说完的队列清掉，再念这一场的台词（用户口径：语音不要重叠）
        audio.hush();
        if (onSpeak) window.setTimeout(() => onSpeak(beat), 600);
      }
    },
  };
}

/** 字幕条：旁白（斜体小字）+ 小护台词 + 老人台词（用户剧本里的三种文本） */
function mountCaptions() {
  const el = document.createElement('div');
  el.id = 'caption';
  el.className = 'caption';
  el.innerHTML = [
    '<p class="caption__narration"></p>',
    '<p class="caption__line caption__line--robot"></p>',
    '<p class="caption__line caption__line--elder"></p>',
  ].join('');
  document.body.appendChild(el);
  return {
    update(beat) {
      const n = el.querySelector('.caption__narration');
      const r = el.querySelector('.caption__line--robot');
      const e = el.querySelector('.caption__line--elder');
      n.textContent = beat && beat.narration ? beat.narration : '';
      r.textContent = beat && beat.robot ? `小护：${beat.robot}` : '';
      e.textContent = beat && beat.elder ? `奶奶：${beat.elder}` : '';
      el.classList.toggle('on', Boolean(beat));
    },
  };
}

function mountDock({ getMode, setMode, onFamily, onMissed }) {
  const root = document.getElementById('dock');
  if (!root) return { setHint() {}, refresh() {} };
  const seg = document.createElement('div');
  seg.className = 'dock__seg';
  root.appendChild(seg);
  const buttons = {};
  for (const [mode, label] of [['interactive', '✋ 自主点击'], ['scripted', '▶ 固定演示']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dock__button';
    b.textContent = label;
    b.addEventListener('click', () => setMode(mode));
    seg.appendChild(b);
    buttons[mode] = b;
  }
  const hint = document.createElement('span');
  hint.className = 'dock__hint';
  root.appendChild(hint);
  // v1.16：版本角标 —— 演示/答辩时一眼确认浏览器拿到的是**新版**（缓存排查用）
  const version = document.createElement('span');
  version.className = 'dock__version';
  version.textContent = 'v1.20';
  version.title = '当前构建：v1.19（2026-10-04）· 若这里不是 v1.19，请 Cmd+Shift+R 强刷';
  root.appendChild(version);
  const family = document.createElement('button');
  family.type = 'button';
  family.className = 'dock__button dock__button--family';
  family.textContent = '家属端手机屏';
  family.addEventListener('click', onFamily);
  root.appendChild(family);
  // v1.21（用户口径）：新增「她没吃药」演示模块 —— 老人在卫生间 / 出门，机器人每 2 分钟督促、
  // 10 分钟后收回托盘、家属端弹出未吃药提示。两个入口对应两种情景。
  if (onMissed) {
    const missed = document.createElement('span');
    missed.className = 'dock__seg dock__seg--missed';
    root.appendChild(missed);
    for (const [where, label] of [['bathroom', '卫生间没吃'], ['away', '出门没吃']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dock__button';
      b.textContent = label;
      b.addEventListener('click', () => onMissed(where));
      missed.appendChild(b);
    }
  }

  return {
    setHint(text) { hint.textContent = text || ''; },
    refresh() {
      const mode = getMode();
      for (const key of Object.keys(buttons)) buttons[key].setAttribute('aria-pressed', String(key === mode));
    },
  };
}

/* ── 调试抽屉（默认隐藏，契约 §8）────────────────────────────────── */

function mountDebugDrawer({ scene, clock }) {
  const root = document.getElementById('debug');
  if (!root) return;

  const section = (title) => {
    const wrap = document.createElement('section');
    wrap.className = 'debug__section';
    const h = document.createElement('h3');
    h.className = 'debug__title';
    h.textContent = title;
    wrap.appendChild(h);
    root.appendChild(wrap);
    return wrap;
  };

  const button = (parent, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'debug__button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  // 时间
  const timeSection = section('时间');
  const speedRow = document.createElement('div');
  speedRow.className = 'debug__row';
  timeSection.appendChild(speedRow);
  for (const value of ACCELERATIONS) {
    const b = button(speedRow, `${value}×`, () => clock.setAcceleration(value));
    b.dataset.speed = String(value);
  }
  const jumpRow = document.createElement('div');
  jumpRow.className = 'debug__row';
  timeSection.appendChild(jumpRow);
  for (const [label, seconds] of [['+5 分钟', 300], ['+1 小时', 3600], ['+1 天', 86400]]) {
    button(jumpRow, label, () => clock.advance(seconds));
  }
  const timeInputRow = document.createElement('div');
  timeInputRow.className = 'debug__row';
  timeSection.appendChild(timeInputRow);
  const timeInput = document.createElement('input');
  timeInput.type = 'datetime-local';
  timeInput.step = '1';
  timeInput.value = DEFAULT_DEMO_START;
  timeInput.className = 'debug__input';
  button(timeInputRow, '设为该时刻', () => clock.set(timeInput.value.length === 16 ? `${timeInput.value}:00` : timeInput.value));
  timeInputRow.insertBefore(timeInput, timeInputRow.firstChild);

  // 人的位置
  const presenceSection = section('王阿姨的位置（模拟开关）');
  const presenceRow = document.createElement('div');
  presenceRow.className = 'debug__row';
  presenceSection.appendChild(presenceRow);
  for (const option of presence.locationOptions()) {
    button(presenceRow, option.label, () => presence.setLocation(option.value));
  }

  // 点击落座（v1.6）：与在画面上点那一点等价
  const seatSection = section('落座点（模拟位置输入）');
  const seatRow = document.createElement('div');
  seatRow.className = 'debug__row';
  seatSection.appendChild(seatRow);
  button(seatRow, '她回预设落位', () => presence.clearSeat());
  // 坐标是 v1.7 套房户型的**世界坐标**（见 room.js 的 WAYPOINTS / SEAT_*）
  button(seatRow, '坐沙发', () => presence.setSeat({ x: 2.40, z: 3.55, surfaceY: 0.50, facing: Math.PI / 2, kind: 'sofa' }));
  button(seatRow, '坐餐椅', () => presence.setSeat({ x: -0.05, z: -0.745, surfaceY: 0.47, facing: 0, kind: 'chair' }));
  button(seatRow, '客厅地板', () => presence.setSeat({ x: 0.60, z: 3.60, surfaceY: 0, facing: 0.4, kind: 'floor' }));

  // 场景与离线
  const sceneSection = section('场景 / 网络');
  const sceneRow = document.createElement('div');
  sceneRow.className = 'debug__row';
  sceneSection.appendChild(sceneRow);
  button(sceneRow, '主视角', () => scene.setCameraMode('wide'));
  button(sceneRow, '药盘特写', () => scene.setCameraMode('tray'));
  let navOn = false;
  button(sceneRow, '导航网格', (event) => {
    navOn = !navOn;
    if (scene.showNavGrid) scene.showNavGrid(navOn);
    event.currentTarget.textContent = navOn ? '网格：开' : '导航网格';
  });
  let shadows = false;
  button(sceneRow, '阴影开关', (event) => {
    shadows = !shadows;
    scene.setShadows(shadows);
    event.currentTarget.textContent = shadows ? '阴影：开' : '阴影：关';
  });
  const offlineRow = document.createElement('div');
  offlineRow.className = 'debug__row';
  sceneSection.appendChild(offlineRow);
  let offlineFlag = false;
  button(offlineRow, '模拟离线', (event) => {
    offlineFlag = !offlineFlag;
    store.setOffline(offlineFlag);
    event.currentTarget.textContent = offlineFlag ? '离线：开' : '模拟离线';
  });

  // 复位
  const resetSection = section('演示');
  const resetRow = document.createElement('div');
  resetRow.className = 'debug__row';
  resetSection.appendChild(resetRow);
  button(resetRow, '回到初始态', () => debugApi.reset());

  const status = document.createElement('p');
  status.className = 'debug__status';
  resetSection.appendChild(status);
  window.setInterval(() => {
    const state = store.getState();
    status.textContent =
      `场景 ${scene.kind.toUpperCase()}　FPS ${scene.getFps()}　` +
      `加速 ${state.clock.acceleration}×　演示 ${String(state.clock.demo).slice(0, 19).replace('T', ' ')}`;
  }, 500);

  // 唤出：` 或 Ctrl/Cmd + Shift + D（契约 §8）
  function toggle() {
    root.hidden = !root.hidden;
  }
  window.addEventListener('keydown', (event) => {
    const isBackquote = event.key === '`' || event.key === '~';
    const isShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd';
    if (isBackquote || isShortcut) {
      event.preventDefault();
      toggle();
    }
    if (event.key === 'Escape') root.hidden = true;
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'debug__close';
  close.textContent = '收起（`）';
  close.addEventListener('click', toggle);
  root.insertBefore(close, root.firstChild);
}

/* ── 调试命令（契约 §3 的 debug.*，S 线归属）────────────────────────── */

const debugApi = {
  setPresence: (location) => presence.setLocation(location),
  setOffline: (flag) => store.setOffline(Boolean(flag)),
  setClock: (iso) => clock.set(iso),
  setAcceleration: (n) => clock.setAcceleration(n),
  /** v1.6：点击落座的程序化入口（测试与拍摄脚本用，等价于在画面上点那一点） */
  setSeat: (seat) => presence.setSeat(seat),
  clearSeat: () => presence.clearSeat(),
  /** 回到演示初始态：清事件与通知 + 重新种入假数据 + 时钟复位 + 人回客厅预设落位 */
  reset() {
    store.reset();
    seedDemoData();
    clock.reset();
    takenSaid.clear(); // v1.13：复位后"吃药 / 吃完药"两句话可以再说一遍
    // 演示初始态是「王阿姨在客厅、机器人停在充电座」：落座点也要一起清掉，
    // 否则点过场景之后按复位，人会留在那个角落（这一条 v1.6 才成立）
    presence.setLocation('living_room');
  },
  state: () => store.getState(),
};

let clock;
/** v1.13：本轮已说过的话（`事件 id|p2` / `|p3`）——复位时清空，保证下一轮还能说 */
const takenSaid = new Set();

/** v1.14：模式（`?mode=scripted` 开固定演示；默认自主点击） */
const MODE = params.get('mode') === 'scripted' ? 'scripted' : 'interactive';
/** v1.20：录制用的倍速（1 = 实时；3 = 三倍速，用于把 ~5 分钟的片子压到 ~1.5 分钟） */
const SPEED = Math.max(0.25, Math.min(6, Number(params.get('speed') || 1) || 1));
/** v1.20：录制模式 —— 隐藏所有按钮/面板，只留 3D 画面与字幕（录视频用） */
const RECORD = params.get('record') === '1';

/** v1.20：按倍速换算这一帧的 dt（并对单帧上限做保护，避免大 dt 穿墙/跳过判据） */
function scaledDt(seconds) {
  return Math.min(seconds * SPEED, 0.25);
}

/* ── 启动 ───────────────────────────────────────────────────────────── */

function startMainView() {
  const container = document.getElementById('scene');
  let scene = createScene3D({ container });
  if (!scene) {
    // 0 级降级：WebGL 不可用 → 2D 俯视仿真，功能一条不少（契约 §6）
    scene = createScene2D({ container });
    const banner = document.getElementById('banner');
    if (banner) {
      const notice = document.createElement('p');
      notice.className = 'banner__item';
      notice.textContent = '当前设备不支持 3D，已降级为 2D 俯视仿真，功能一条不少';
      banner.appendChild(notice);
      banner.hidden = false;
    }
  }

  const robot = createRobot(scene);
  const person = createPerson(scene);
  const hud = mountHud(document.getElementById('hud'));
  // v1.14：自动化走查（无头 Chrome 的 CDP 脚本）要直接读"她取药到哪一步了 / 托盘上的水杯还在不在"。
  // 与既有的 `window.medbot.scene` 同性质：**只读**，不放宽任何权限。
  if (window.medbot) {
    window.medbot.robot = robot;
    window.medbot.person = person;
  }

  clock = createClock({
    demoStart: DEFAULT_DEMO_START,
    acceleration: 60,
    // 拍摄模式：时钟只走脚本给的步长，录屏逐帧可复现
    manual: FILM_MODE,
    onTick: (tick) => {
      store.setClock(tick);
      schedule.tick();
    },
  });

  mountDebugDrawer({ scene, clock });

  /* ── v1.14：可切换模式的平台（自主点击 / 固定演示）+ 左下角控制条 + 家属端副屏 ── */
  let mode = MODE;
  let prevCamMode = null;

  /* v1.16：页内「手机屏」家属端 + 所有小窗口的收起/展开圆片（拍摄模式下不挂，免得进画面） */
  let phone = null;
  let phoneToggle = null;
  function togglePhone(force) {
    if (!phone) return null;
    const next = typeof force === 'boolean' ? force : phone.classList.contains('is-collapsed'); // 收起→展开
    phone.classList.toggle('is-collapsed', !next);
    if (phoneToggle) {
      phoneToggle.textContent = next ? '▾' : '▸';
      phoneToggle.setAttribute('aria-expanded', String(next));
    }
    return next;
  }
  if (RECORD) {
    // 录制模式：把所有 UI 面板/按钮藏起来，画面只留 3D + 字幕（用户要的是"能看的视频"）
    document.body.classList.add('is-record');
    // 软渲染（无 GPU）下阴影极贵：录视频时关掉，帧率大约能翻好几倍，画面依然完整
    if (typeof scene.setShadows === 'function') scene.setShadows(false);
  }
  if (!FILM_MODE && !RECORD) {
    phone = ensurePhone();
    phoneToggle = addCollapseToggle({ target: phone, className: 'collapse-toggle--phone', label: '家属端副屏' });
    phoneToggle.textContent = '▸';
    phoneToggle.setAttribute('aria-expanded', 'false');
    addCollapseToggle({
      target: document.getElementById('hud'), className: 'collapse-toggle--hud', label: '长者端大字卡', bodyClass: 'is-hud-collapsed',
    });
    addCollapseToggle({
      target: document.getElementById('console'), className: 'collapse-toggle--console', label: '演示控制台', bodyClass: 'is-console-collapsed',
    });
  }

  /* ── v1.18：家属端「手机推送」 ───────────────────────────────────────
   * 用户口径：**「当吃药时间到，但老人由于在卫生间或者出门了导致未吃药，
   * 需要在手机端设置一个消息弹出提示家属」**。
   * 数据来源是**已有的业务状态** `state.notifications`（escalate.js 在「一直未确认」时
   * 产生的 level 2 家属通知）—— 这里只把它**显示成手机上的推送**，不新增任何业务判据。
   * 触发原因（卫生间 / 出门 / 一直没取走）由 `state.presence.location` 决定，属于表现层措辞。 */
  const seenNtf = new Set();
  let pushTimer = null;
  function setFamilyBadge(on) {
    const famBtn = document.querySelector('.dock__button--family');
    if (famBtn) famBtn.classList.toggle('has-badge', Boolean(on));
  }
  function hidePhonePush() {
    const box = phone ? phone.querySelector('.phone__push') : null;
    if (box) box.classList.remove('on');
    setFamilyBadge(false);
  }
  function showPhonePush(ntf) {
    if (!phone) return;
    let box = phone.querySelector('.phone__push');
    if (!box) {
      box = document.createElement('div');
      box.className = 'phone__push';
      box.innerHTML = [
        '<div class="phone__push-head"><span class="phone__push-app">家属端</span>'
        + '<span class="phone__push-time"></span></div>',
        '<div class="phone__push-title"></div>',
        '<div class="phone__push-body"></div>',
        '<div class="phone__push-actions">'
        + '<button type="button" class="phone__push-ok">知道了</button></div>',
      ].join('');
      phone.querySelector('.phone__frame').appendChild(box);
      box.querySelector('.phone__push-ok').addEventListener('click', hidePhonePush);
    }
    const loc = latest.presence.location;
    const why = loc === 'bathroom'
      ? '她现在在卫生间，机器人没有进入私人区域，暂时无法送达'
      : (loc === 'away' ? '她出门在外，机器人无法送达' : '机器人已提醒多次，一直没有取走');
    box.querySelector('.phone__push-title').textContent = '用药提醒未确认';
    box.querySelector('.phone__push-body').textContent = `${ntf.text}。${why}。`;
    box.querySelector('.phone__push-time').textContent = String(ntf.createdAtDemo || '').slice(11, 16);
    box.classList.add('on');
    // 手机屏收着时：固定演示模式自动弹开给观众看，其它模式在按钮上留红点
    if (phone.classList.contains('is-collapsed') && mode === 'scripted') togglePhone(true);
    setFamilyBadge(!phone.classList.contains('is-collapsed') ? false : true);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(hidePhonePush, 15000);
  }
  function watchFamilyNotifications() {
    const list = latest.notifications || [];
    if (!list.length) { seenNtf.clear(); setFamilyBadge(false); return; }
    for (const n of list) {
      if (seenNtf.has(n.id)) continue;
      seenNtf.add(n.id);
      if (n.to === 'family') showPhonePush(n);
    }
  }

  /* v1.21：**「她没吃药」情景**（用户口径）——
   * 老人出门 / 在卫生间 → 机器人**每 2 分钟**督促一次、**10 分钟后**把托盘收回（事件转 missed）、
   * 家属端**弹出未吃药提示**。实现方式：用 `store.setPolicy` 把三段时限按这两个数字设置，
   * 其余（何时提醒、何时通知家属、什么时候算超时）**全部交给已有的升级链路**，不新增业务规则。
   * 离开这个情景时把策略恢复默认。 */
  // 9 分钟通知家属、10 分钟收托盘（若两者都设 600s，事件会先转 missed，家属通知就发不出去了）
  const MISSED_POLICY = { renotifyAfterSec: 120, maxRenotify: 6, notifyFamilyAfterSec: 540, confirmWindowMin: 10 };
  let missedScenario = null;      // null = 不在该情景；否则记着默认策略以便恢复
  let missedAttempts = 0;
  function startMissedScenario(where) {
    if (!missedScenario) missedScenario = store.getPolicy();  // 备份默认策略
    if (typeof script !== 'undefined' && script && typeof script.stop === 'function') script.stop();
    if (mode === 'scripted') applyMode('interactive');
    store.setPolicy(MISSED_POLICY);
    debugApi.reset();                       // 清事件、时钟复位、她回客厅
    presence.setLocation(where);            // 她进卫生间 / 出门
    store.setPolicy(MISSED_POLICY);         // reset 之后再设一次（reset 不改策略，保险）
    missedAttempts = 0;
    clock.setAcceleration(60);              // 60× → 2 分钟 = 2 秒，10 分钟 = 10 秒，现场节奏正好
    clock.set(`${DEFAULT_DEMO_START.slice(0, 10)}T07:59:50`);
    dock.setHint(where === 'away' ? '情景：她出门了没吃药' : '情景：她在卫生间没吃药');
    window.setTimeout(() => dock.setHint(''), 6000);
  }
  /** 每次「再次提醒」时说的话（用户口径：机器人会播报「奶奶，您需要吃药了」） */
  function watchMissedScenario() {
    if (!missedScenario) return;
    const id = latest.activeEventId;
    const ev = id ? latest.events.find((e) => e.id === id) : null;
    const n = ev ? ev.attempts.length : 0;
    if (n > missedAttempts) {
      missedAttempts = n;
      audio.speak('奶奶，您需要吃药了。药就放在托盘上，请及时取走。', { force: true, style: 'child' });
    }
    if (!id && missedAttempts > 0) { // 事件收口（10 分钟到 → missed）→ 情景结束，恢复默认策略
      missedAttempts = 0;
      store.setPolicy(missedScenario);
      missedScenario = null;
      dock.setHint('托盘已收回，家属端已收到未确认通知');
      window.setTimeout(() => dock.setHint(''), 8000);
    }
  }

  const dock = mountDock({
    getMode: () => mode,
    setMode: (next) => applyMode(next),
    onMissed: (where) => startMissedScenario(where),
    onFamily: () => {
      const open = togglePhone();
      // 打开手机屏时把右下控制台收起来：两块面板都在右侧，会互相压住
      if (open) {
        const consoleEl = document.getElementById('console');
        if (consoleEl && !consoleEl.classList.contains('is-collapsed')) {
          const t = document.querySelector('.collapse-toggle--console');
          if (t) t.click();
        }
      }
    },
  });
  if (!FILM_MODE) {
    addCollapseToggle({
      target: document.getElementById('dock'), className: 'collapse-toggle--dock', label: '演示控制条', bodyClass: 'is-dock-collapsed',
    });
  }
  let captions = null;
  let player = null;
  /* v1.20：录视频时的**逐帧驱动总线** —— film.step() 每推进一帧就放行一次剧本的等待，
   * 于是"视频帧率"与"渲染速度"解耦（软渲染只有 2–3 fps，实时录只能出幻灯片）。 */
  const stepBus = { cbs: [], seconds: 0, register(cb) { this.cbs.push(cb); }, fire() { const c = this.cbs; this.cbs = []; c.forEach((f) => f()); } };
  const script = createDemoScript({
    clock, presence, store, person, scene, robot,
    nextStep: FILM_MODE && MODE === 'scripted' ? stepBus : null,
    onBeat: (st) => {
      dock.setHint(st.beat ? st.beat.label : '');
      if (captions) captions.update(st.beat);
      if (player) player.update(st);
    },
  });
  if (!FILM_MODE || RECORD) {
    captions = mountCaptions(); // 录制时要字幕进画面；纯拍摄模式(?film=1)保持干净
  }
  if (!FILM_MODE && !RECORD) {
    player = mountPlayer({
      script,
      // 小护的台词：朗读出来（童声），同时字幕已在 captions 里显示
      onSpeak: (beat) => { if (beat.robot) audio.speak(beat.robot, { force: true, style: 'child' }); },
    });
    // 空格 = 播放 / 暂停（讲解时最顺手的一个键）
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && mode === 'scripted' && !/INPUT|TEXTAREA/.test(ev.target.tagName)) {
        ev.preventDefault();
        script.toggle();
        if (player) player.update(script.status());
      }
    });
  }
  let applyMode = function applyMode(next) {
    mode = next === 'scripted' ? 'scripted' : 'interactive';
    document.body.classList.toggle('is-scripted', mode === 'scripted');
    const card = document.querySelector('.hud__card');
    if (card) card.classList.toggle('hud__card--compact', mode === 'scripted');
    const consoleEl = document.getElementById('console');
    if (consoleEl) consoleEl.classList.toggle('console--compact', mode === 'scripted');
    const playerEl = document.getElementById('player');
    if (playerEl) playerEl.hidden = mode !== 'scripted'; // 播放器只在固定演示里出现
    if (mode === 'scripted') {
      debugApi.reset(); // 回到演示初始态：清事件、时钟复位、她回客厅，然后按剧本从头走
      // v1.21：固定演示按**真实时间**走（1×）。原先沿用 60×，于是"10:00 的事件"会在第一场
      // 还没演完时就触发 —— 语音重复、家属推送乱弹。剧本本来就会逐场拨表，不需要快进。
      clock.setAcceleration(1);
      if (script && typeof script.start === 'function') script.start();
    } else {
      if (script && typeof script.stop === 'function') script.stop();
      clock.setAcceleration(60); // 回到交互演示的 60×
      audio.hush();
      dock.setHint('');
    }
    dock.refresh();
    return mode;
  };
  window.demoMode = { get: () => mode, set: applyMode, script: () => script.status() };
  dock.refresh();

  /* v1.20：**智能切模式** ——
   *   ① 切到哪个模式就写进地址栏（`?mode=scripted` / 去掉它），刷新后还是这个模式；
   *   ② 固定演示播放时，只要观众/演示者在 3D 画面上按一下（想自己看/自己点），
   *      就**自动切回自主点击**并在控制条上提示一句 —— 不用先去找那个按钮。
   */
  function syncUrl() {
    try {
      const u = new URL(window.location.href);
      if (mode === 'scripted') u.searchParams.set('mode', 'scripted');
      else u.searchParams.delete('mode');
      window.history.replaceState(null, '', u.toString());
    } catch (err) { /* 忽略 */ }
  }
  const applyModeRaw = applyMode;
  applyMode = function smartApplyMode(next) {
    const out = applyModeRaw(next);
    syncUrl();
    return out;
  };
  // 交互控制台：拍摄模式下不挂载（会进画面，也会破坏逐帧可复现）
  if (!FILM_MODE) {
    mountConsole(document.getElementById('console'), {
      scene, clock, presence, machine, store, debug: debugApi,
    });
    // 交互模式才开自由视角；拍摄模式每帧由脚本复写机位，必须保持关闭
    scene.enableOrbit(true);
    /**
     * 点击落座（契约 §3.1.1，v1.6）：
     * 在画面里点任意位置 → `scene.pick` 把屏幕坐标投成落座点 → 写进 `presence.setSeat`。
     * 之后**机器人不需要额外通知**：它每帧只读 `state.presence.seat` 就知道该去哪。
     * 这是"位置输入"，不是传感器：不采集画面、不做识别（文案里也必须这么写）。
     */
    scene.enablePick((seat) => {
      // v1.20：固定演示播放中，观众在画面上点一下 → 自动切回自主点击（"我想自己看/自己点"）
      if (mode === 'scripted') {
        applyMode('interactive');
        dock.setHint('已切回自主点击（点画面即可自己看）');
        window.setTimeout(() => dock.setHint(''), 4000);
      }
      presence.setSeat(seat);
      scene.showPickMarker(seat);
    });
  }
  // 演示时钟「仅内存、刷新即复位」——先把今天尚未了结的事件退回 scheduled，再开始走表
  store.setClock(clock.snapshot());
  schedule.reconcileOnBoot();
  // 拍摄模式没有 clock.start() 的首次 onTick，这里补一次「物化今日计划」
  if (FILM_MODE) schedule.tick();

  // 最新快照缓存：每帧给表现层用（避免每帧深拷贝 state）
  let latest = store.getState();
  store.subscribe((state) => {
    latest = state;
    if (hud && hud.render) hud.render(state);
  });
  hud.render(latest);

  /**
   * 「机器人走到奶奶身边**督促**吃药」（v1.11 新增场景 · 童声）
   *
   * 判据全部来自 state 与场景读数，**不新增任何业务规则**：
   *   ① 有未确认的提示事件（`state.activeEventId` 且该事件还没确认）
   *   ② 机器人**已经到她跟前**（≤1.15 m，用 `scene.getActorPosition('robot')` 量）
   *   ③ 同一轮（同一个事件 + 第几次尝试）只督促一次 —— 换通道时机器会再督促一遍
   * 措辞只含**医嘱原文 + 请取走**：不说「服药 / 已服下」，也不给任何剂量建议（红线）。
   * 声音走童声（`style:'child'`）；想听用户录的那三段 mp3 见 `audio.js` 的 `?voiceclip=1`。
   */
  const urgedKeys = new Set();
  function urgeAtSide() {
    const id = latest.activeEventId;
    if (!id) return;
    const event = latest.events.find((e) => e.id === id);
    if (!event || event.state === 'confirmed') return;
    const me = scene.getActorPosition('robot');
    if (!me) return;
    // 「到身边」= 到了**场景给的停靠点**（人坐/躺时机器人本来就不能贴着她站）：
    // 预设落位下沙发正面被茶几占住，机器人只能停南侧 —— 那也是"到了"。
    const stand = scene.getApproachPoint(latest.presence.location, latest.presence.seat || null);
    if (!stand) return;
    const atSide = Math.hypot(me.x - stand.x, me.z - stand.z) <= 0.25;
    const attempts = event.attempts ? event.attempts.length : 0;
    const key = `${id}|${attempts}`;
    if (urgedKeys.has(key)) return;
    urgedKeys.add(key);
    const plan = latest.plans.find((p) => p.id === event.planId) || null;
    const parts = [event.slotTime, plan ? plan.name : '', plan ? plan.doseText : ''].filter(Boolean);
    // v1.14：**到点那一句**已经由 HUD 播了用户录的 `p1`（"该吃药啦…"）；
    // 走到她身边这句是"换一个通道再督促一次"，用合成童声说合规措辞，**不再重复播同一段录音**。
    audio.speak(`奶奶，药已经放在托盘上了。${parts.join('，')}，请取走`, {
      force: true, style: 'child',
    });
  }

  /**
   * 「到点吃药」的动作链（v1.13 · 用户口径：吃药时间到，老人会拿起杯子喝水和拿药吃）
   *
   * 判据与 `urgeAtSide` 完全同一套，**不新增任何业务规则**：
   *   ① 有未确认的提示事件（`state.activeEventId` 且事件不是 confirmed）
   *   ② 机器人**已经到停靠点**（同一个"到身边"的口径）
   *   → 这才调用 `person.beginTake(eventId)`：她伸手 → 端杯 → 喝水 → 拿药 → 吃完 → 回位。
   * 动作相位推进时接两句话（用户口径「吃药和吃完药的时候会说剩下两段话」）：
   *   phase→cup  播 **p2**（开始吃药）　phase→done 播 **p3**（吃完药 · 记录已同步）
   * `audio.speak` 自带队列，所以这两句先后触发时**不会互相打断**（YuMi-06 在 `0000000/` 修的就是这个）。
   * 杯子和药从托盘上"被拿走"也只是可见性，由 `robot.setCargo` 处理，不参与业务判断。
   */
  const TAKE_PHASES = ['idle', 'reach', 'cup', 'drink', 'pill', 'done'];
  let pendingConfirm = null; // 固定演示：动作走完后要自动确认的事件 id

  /**
   * 把托盘上的杯子**交到她手里**（v1.14 · 用户口径「端杯子喝水」）。
   * 纯表现：`attach` 到右手掌心节点（世界变换自动重算），并把落点摆进掌心；
   * `returnCupToTray()` 用记录下来的父节点 + 局部变换**逐位还原**，托盘一侧的状态一点不改。
   */
  let cupRig = null;
  function holdCup() {
    if (cupRig) return;
    if (typeof person.getHandAnchor !== 'function' || typeof robot.getCargoNodes !== 'function') return;
    const hand = person.getHandAnchor();
    const nodes = robot.getCargoNodes();
    if (!hand || !nodes) return;
    const list = [nodes.cup, nodes.cupBottom, nodes.water].filter(Boolean);
    if (!list.length) return;
    cupRig = list.map((node) => {
      const rec = {
        node, parent: node.parent, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
      };
      hand.attach(node);
      node.visible = true;
      node.position.set(0, -0.052, 0.022); // 落在掌心里（掌心节点在腕下 ~0.05 m）
      node.quaternion.identity();
      return rec;
    });
  }
  function returnCupToTray() {
    if (!cupRig) return;
    for (const rec of cupRig) {
      if (!rec.parent) continue;
      rec.parent.attach(rec.node);
      rec.node.position.copy(rec.position);
      rec.node.quaternion.copy(rec.quaternion);
      rec.node.scale.copy(rec.scale);
      rec.node.visible = true;
    }
    cupRig = null;
  }

  /** v1.20：递药特写什么时候结束 —— 机器人回到充电桩（或事件被复位） */
  function settleShot() {
    if (!document.body.classList.contains('shot-delivery')) return;
    if (latest.activeEventId) return; // 还在递药/待确认，继续跟
    const rp = scene.getActorPosition('robot');
    const dock = scene.getDock ? scene.getDock() : null;
    const atDock = rp && dock && Math.hypot(rp.x - dock.x, rp.z - dock.z) < 0.18;
    if (!atDock) return;
    document.body.classList.remove('shot-delivery');
    if (prevCamMode && typeof scene.setCameraMode === 'function') scene.setCameraMode(prevCamMode);
    prevCamMode = null;
    if (stepBus) stepBus.shotActive = false;
  }

  function syncTake() {
    if (typeof person.getAction !== 'function' || typeof person.beginTake !== 'function') return;
    let action = person.getAction();
    const id = latest.activeEventId;
    const event = id ? latest.events.find((e) => e.id === id) : null;

    if (id && event && event.state !== 'confirmed' && !action.active) {
      const me = scene.getActorPosition('robot');
      const stand = scene.getApproachPoint(latest.presence.location, latest.presence.seat || null);
      const atSide = me && stand && Math.hypot(me.x - stand.x, me.z - stand.z) <= 0.25;
      // ⚠️ 时序：机器人**先把水注好**，她再端杯 —— 否则"她拿走杯子"会把注水打断（水面只涨到 0.22）。
      // 这只是表现层的先后次序，不是业务判据。
      const poured = typeof robot.isPoured !== 'function' || robot.isPoured();
      // v1.21：她在卫生间 / 出门时不触发"递药到手"（人不在跟前，机器人只在门口等）
      const reachable = latest.presence.location !== 'bathroom' && latest.presence.location !== 'away';
      if (atSide && poured && reachable) {
        // 把**托盘的真实世界位置**告诉她：她要"上前一步、伸手够到托盘"（纯表现位移，不改 presence）
        if (typeof person.setTakeTarget === 'function' && typeof robot.getCargoNodes === 'function') {
          const nodes = robot.getCargoNodes();
          const tray = nodes && nodes.tray;
          if (tray) {
            const wp = tray.getWorldPosition(tray.position.clone());
            person.setTakeTarget({ x: wp.x, y: wp.y, z: wp.z });
          }
        }
        person.beginTake(id);
        action = person.getAction(); // ⚠️ 刚启动：必须重读，否则下面会当成"已结束"立刻清掉目标
        /* v1.14（用户口径「吃药时把镜头移到老人与机器人，让观众看清递药，不要有遮挡」）：
         * 递药这一刻把**她 + 机器人**一起框进画面（`scene.focusPair` 会挑一个"视线不隔墙、
         * 不陷在家具里"的侧面机位；找不到就保持原机位，不硬凑）。
         * 同时给 body 加 `shot-delivery`：右下角控制台压暗，别挡着观众看取药。 */
        if (typeof scene.focusPair === 'function') {
          const her = latest.presence.seat || scene.getWaypoint(latest.presence.location);
          const rp = scene.getActorPosition('robot');
          prevCamMode = typeof scene.getCameraMode === 'function' ? scene.getCameraMode() : 'wide';
          if (her && rp && scene.focusPair(her, rp, { duration: 2.4 })) {
            // v1.20：推近放慢到 2.4 s（用户口径「推近可以慢一点，主要想展示送药/递药/吃药/收托盘/回桩」）
            document.body.classList.add('shot-delivery');
            stepBus.shotStartFrame = stepBus.frame || 0;
            stepBus.shotActive = true;
          }
        }
      }
    }

    if (!action.active) {
      if (typeof person.setTakeTarget === 'function') person.setTakeTarget(null);
      returnCupToTray();
      // v1.20：动作结束后**不立刻切走** —— 特写一直保持到机器人**收好托盘、回到充电桩**
      // （用户口径：要把"收托盘 + 回桩"也演给观众看），由下面的 film/主循环统一收尾。
      // 动作收尾：**本轮事件还没收口**就别把杯子/药放回托盘（她刚拿走的东西不该又冒出来），
      // 等事件结束（activeEventId 清空 → 托盘回舱）再复位，准备下一轮。
      if (!id && typeof robot.setCargo === 'function') robot.setCargo({ cupTaken: false, pillTaken: false });
      return;
    }

    const step = TAKE_PHASES.indexOf(action.phase);
    const holdingCup = step >= TAKE_PHASES.indexOf('cup') && action.phase !== 'done';
    if (holdingCup) holdCup(); else returnCupToTray();
    if (step >= TAKE_PHASES.indexOf('cup') && !takenSaid.has(`${action.eventId}|p2`)) {
      takenSaid.add(`${action.eventId}|p2`);
      audio.speak('奶奶真棒，慢慢喝口水，把药吃下去', { force: true, style: 'child', clip: 'p2' });
    }
    if (action.phase === 'done' && !takenSaid.has(`${action.eventId}|p3`)) {
      takenSaid.add(`${action.eventId}|p3`);
      audio.speak('吃药的记录，我已经发到您家人的手机上啦', { force: true, style: 'child', clip: 'p3' });
      // v1.21（用户口径）：**老人拿走药物就自动确认**，不再需要人工点左上角「已取走」——
      // 机器人的摄像头/传感器判定「药已取走」在演示里由这一拍代替（取药 ≠ 服药，文案仍是「已取走」）。
      if (action.eventId) pendingConfirm = action.eventId;
    }
    // 固定演示：动作走完就替她把「已取走」确认掉（只调契约里已有的命令，不加业务规则）
    if (pendingConfirm && latest.activeEventId === pendingConfirm) {
      machine.confirm(pendingConfirm, 'tray_taken');
      pendingConfirm = null;
    }
    if (typeof robot.setCargo === 'function') {
      robot.setCargo({
        cupTaken: step >= TAKE_PHASES.indexOf('cup'),
        pillTaken: step >= TAKE_PHASES.indexOf('pill'),
      });
    }
  }

  /**
   * 拍摄模式（`?film=1`）：不自动走表，动画由外部逐帧驱动，录屏因此完全可复现。
   * 用法见 scripts/record-promo.mjs；正常演示不受任何影响。
   */
  if (FILM_MODE) {
    const paint = () => {
      scene.render(latest, 0); // 只重绘、不推进：保证合成器随时有最新画面
      window.requestAnimationFrame(paint);
    };
    window.requestAnimationFrame(paint);
    window.film = {
      /** 推进一帧（默认 1/24 秒）并重绘；`?mode=scripted` 时同时放行剧本的下一步 */
      step(dt = 1 / 24) {
        const sdt = scaledDt(dt);
        robot.update(latest, sdt);
        person.update(latest, sdt);
        urgeAtSide(); // 走到她身边就督促（童声）
        syncTake(); // 到点吃药：她端杯喝水 + 拿药吃，机器人说剩下两段话
        settleShot(); // v1.20：机器人回桩后才结束特写
    watchMissedScenario(); // v1.21：没吃药情景——每 2 分钟督促 / 10 分钟收托盘
        watchMissedScenario(); // v1.21：没吃药情景——每 2 分钟督促 / 10 分钟收托盘
        watchFamilyNotifications(); // v1.18：未确认 → 家属手机弹出推送
        // v1.20：录制时的自动运镜 —— 没有递药近景时，每秒把机位重算到"看得见她"的位置
        // （机器人就在旁边时把两个人一起框；复用 focusSeat/focusPair 的可见性判据）
        if (MODE === 'scripted') {
          const shot = document.body.classList.contains('shot-delivery');
          const sinceShot = (stepBus.frame || 0) - (stepBus.shotStartFrame || 0);
          // 慢推近那 2.4 s（≈29 帧）**不要抢镜**，让 flyTo 自己飞完；之后每 4 帧轻跟一次
          if (!shot || sinceShot > 29) {
            const every = shot ? 4 : 12;
            if ((stepBus.frame || 0) % every === 0) {
              const her = latest.presence.seat || scene.getWaypoint(latest.presence.location);
              const rp = scene.getActorPosition('robot');
              const near = her && rp && Math.hypot(her.x - rp.x, her.z - rp.z) <= 2.6;
              if (near && typeof scene.focusPair === 'function') {
                scene.focusPair(her, rp, { animate: false });
              } else if (shot && rp && typeof scene.focusPair === 'function') {
                scene.focusPair(rp, rp, { animate: false }); // 机器人往回走 → 镜头跟着它回桩
              } else if (her && typeof scene.focusSeat === 'function') {
                scene.focusSeat({ x: her.x, z: her.z, facing: 0, kind: 'floor' }, { animate: false });
              }
            }
          }
        }
        scene.render(latest, sdt);
        stepBus.frame = (stepBus.frame || 0) + 1;
        stepBus.seconds = sdt;
        stepBus.fire(); // 放行剧本的下一步（逐帧驱动）
      },
      /** 推进演示时钟（秒）——会触发到点判定，等同演示者拨表 */
      advanceDemo(seconds) {
        clock.advance(seconds);
      },
      setPresence(location) {
        presence.setLocation(location);
      },
      /** v1.6：直接落座到某个点（录屏脚本用；等价于在画面上点那里） */
      setSeat(seat) {
        presence.setSeat(seat);
        scene.showPickMarker(seat);
      },
      clearSeat() {
        presence.clearSeat();
      },
      camera(mode) {
        scene.setCameraMode(mode);
      },
      /**
       * 运镜：以**机器人当前位置与朝向**为基准的跟随机位（拍摄模式专用）。
       * angleDeg 是相对机器人正面的水平偏角；distance 米；aimLead 沿机器人正面方向的前视偏移。
       */
      followCam({ distance = 2.4, height = 1.2, angleDeg = 35, aimHeight = 0.6, aimLead = 0, fov = 40 } = {}) {
        const p = robot.group.position;
        const facing = robot.group.rotation.y;
        const angle = facing + (angleDeg * Math.PI) / 180;
        scene.setCameraLook({
          position: { x: p.x + Math.sin(angle) * distance, y: height, z: p.z + Math.cos(angle) * distance },
          lookAt: {
            x: p.x + Math.sin(facing) * aimLead,
            y: aimHeight,
            z: p.z + Math.cos(facing) * aimLead,
          },
          fov,
        });
      },
      /** 点「已取走」：与长者端按钮同一条命令 */
      confirmActive() {
        const id = latest.activeEventId;
        if (id) machine.confirm(id, 'tray_taken');
        return id;
      },
      state: () => latest,
      sceneKind: scene.kind,
    };
    audio.attachUnlock();
    // 自动化走查 / 录屏脚本要直接读场景（投影、角色位置），与交互模式同一条口子
    if (window.medbot) window.medbot.scene = scene;
    // v1.20：`?film=1&mode=scripted` —— 剧本由 film.step() 逐帧驱动
    if (MODE === 'scripted') {
      window.film.script = () => script.status();
      /** v1.20：**一步 + 抓帧**（返回 JPEG dataURL）—— 录制脚本用它，比 CDP 截图快一个数量级 */
      window.film.grab = (dt = 1 / 12) => {
        window.film.step(dt);
        const cv = document.querySelector('#scene canvas');
        return cv && cv.toDataURL ? cv.toDataURL('image/jpeg', 0.86) : null;
      };
      window.film.scriptStart = (i = 0) => script.start(i);
      script.start(0);
    }
    return { scene, robot, person, hud, film: true };
  }

  /* v1.18：演示快捷入口 —— `?demo=bathroom-push`
   * 直接把她放进**卫生间**、并把演示时钟拨到 **07:59:55**：
   * 于是打开页面约 3 秒后就会看到「未确认 → 家属手机弹出推送」这一条闭环。
   * 只是把控制台里本来就有的两个动作（切位置 / 设时刻）合成一个书签，**不新增业务规则**。 */
  if (params.get('demo') === 'bathroom-push') {
    presence.setLocation('bathroom');
    clock.set(`${DEFAULT_DEMO_START.slice(0, 10)}T07:59:55`);
  }

  clock.start();
  // 固定演示：从初始态开始按剧本走（`?mode=scripted` 或左下角按钮切的）
  if (mode === 'scripted') applyMode('scripted');
  let last = performance.now();
  function frame(now) {
    // v1.21：单帧上限 0.1 → 0.2 s。软渲染只有 2–5 fps 时，0.1 s 的上限会把仿真**饿死**
    // （机器人实际只走 30% 速度，还没到老人跟前，确认窗口就到期了 → 事件转 missed、取药根本没发生）。
    const dt = scaledDt(Math.min((now - last) / 1000, 0.2));
    last = now;
    robot.update(latest, dt);
    person.update(latest, dt);
    urgeAtSide(); // 走到她身边就督促（童声）
    syncTake(); // 到点吃药：她端杯喝水 + 拿药吃，机器人说剩下两段话
    settleShot(); // v1.20：机器人回桩后才结束特写
    watchMissedScenario(); // v1.21：没吃药情景——每 2 分钟督促 / 10 分钟收托盘
    watchFamilyNotifications(); // v1.18：未确认 → 家属手机弹出推送
    scene.render(latest, dt);
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  audio.attachUnlock();
  // v1.11 童声：优先用系统里的童声（没有就男声抬高音调），并在音色列表变化时重选
  audio.pickChildVoice();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => audio.pickChildVoice();
  }
  // 自动化走查（无头 Chrome 的 CDP 脚本）需要直接调场景 API 做投影/断言；
  // 与 `window.debug` 同性质：只读 + 契约里已有的命令，不额外放宽任何东西。
  if (window.medbot) window.medbot.scene = scene;
  return { scene, robot, person, hud };
}

function startFamilyView() {
  const familyRoot = document.getElementById('family');
  const main = document.getElementById('main-view');
  if (main) main.hidden = true;
  if (familyRoot) familyRoot.hidden = false;
  mountFamilyPanel(familyRoot);
}

function boot() {
  window.medbot = { store, plan, presence, schedule, machine, escalate, debug: debugApi, getClock: () => clock };  // 假数据种子在两种视图下都执行（幂等）：先开副屏也不会是空列表
  seedDemoData();
  if (VIEW === 'family') {
    document.body.classList.add('view-family');
    startFamilyView();
    return;
  }
  // 拍摄模式下不挂顶栏：录屏画面里不出现调试/离线提示条
  if (!FILM_MODE) mountBanner();
  startMainView();
  window.debug = debugApi;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
