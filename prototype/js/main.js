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
import { mountFamilyPanel } from './family.js';
import { audio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const VIEW = params.get('view') === 'family' ? 'family' : 'main';

/* ── 假数据种子（P1：假数据种子，契约 §4.1）────────────────────────────
 * 三个时段、四条计划、零冲突。场景 2 的「阿莫西林 08:00」由家属端现场加，
 * 才会出现契约 §6 要求的「时段冲突并列展示」。
 * 全部为虚构数据，剂量一律照「医嘱原文」记录，系统不做任何换算或解释。
 */
function seedDemoData() {
  if (store.getState().plans.length) return;
  plan.create({ name: '氨氯地平', doseText: '5mg', kind: 'regular', slots: [{ time: '08:00', label: '早' }], notes: '饭后服' });
  plan.create({ name: '二甲双胍', doseText: '0.5g', kind: 'regular', slots: [{ time: '12:00', label: '午' }], notes: '随餐' });
  plan.create({ name: '华法林', doseText: '3mg', kind: 'regular', slots: [{ time: '20:00', label: '晚' }], notes: '' });
  plan.create({ name: '阿托伐他汀钙', doseText: '20mg', kind: 'regular', slots: [{ time: '20:30', label: '睡前' }], notes: '睡前服' });
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
    banner.hidden = !offline && !storageNote;
  }

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

  // 场景与离线
  const sceneSection = section('场景 / 网络');
  const sceneRow = document.createElement('div');
  sceneRow.className = 'debug__row';
  sceneSection.appendChild(sceneRow);
  button(sceneRow, '主视角', () => scene.setCameraMode('wide'));
  button(sceneRow, '药盘特写', () => scene.setCameraMode('tray'));
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
  /** 回到演示初始态：清事件与通知 + 重新种入假数据 + 时钟复位 */
  reset() {
    store.reset();
    seedDemoData();
    clock.reset();
  },
  state: () => store.getState(),
};

let clock;

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

  clock = createClock({
    demoStart: DEFAULT_DEMO_START,
    acceleration: 60,
    onTick: (tick) => {
      store.setClock(tick);
      schedule.tick();
    },
  });

  mountDebugDrawer({ scene, clock });
  // 演示时钟「仅内存、刷新即复位」——先把今天尚未了结的事件退回 scheduled，再开始走表
  store.setClock(clock.snapshot());
  schedule.reconcileOnBoot();
  clock.start();

  // 最新快照缓存：每帧给表现层用（避免每帧深拷贝 state）
  let latest = store.getState();
  store.subscribe((state) => {
    latest = state;
    if (hud && hud.render) hud.render(state);
  });
  hud.render(latest);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    robot.update(latest, dt);
    person.update(latest, dt);
    scene.render(latest, dt);
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  audio.attachUnlock();
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
  window.medbot = { store, plan, presence, schedule, machine, escalate, debug: debugApi, getClock: () => clock };
  // 假数据种子在两种视图下都执行（幂等）：先开副屏也不会是空列表
  seedDemoData();
  if (VIEW === 'family') {
    document.body.classList.add('view-family');
    startFamilyView();
    return;
  }
  mountBanner();
  startMainView();
  window.debug = debugApi;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
