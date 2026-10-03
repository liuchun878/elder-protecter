/**
 * controls.js —— 交互控制台（演示操作台）
 *
 * 契约：契约-接口.md §3（命令接口）、§3.1（场景 API）、§8（调试抽屉）、§9（适老化硬数值）
 *
 * 它只做一件事：**把契约里已经存在的命令接到按钮上**，不自己造任何业务规则。
 * 所有按钮都转调：
 *   时钟   → `clock.advance / clock.set / clock.reset`
 *   位置   → `presence.setLocation`（开关模拟，不是传感器）
 *   机位   → `scene.setCameraMode / scene.enableOrbit / scene.resetCamera`
 *   场景   → `scene.setShadows / scene.setTimeOfDay`
 *   闭环   → `machine.confirm(activeEventId, 'tray_taken')` —— 与长者端按钮**同一条命令**
 *
 * 红线（本文件同样适用）：
 *   - 不出现「已服下」：取药 ≠ 服药，文案只能是「已取走 / 已记录 / 未确认」
 *   - 不出现补服 / 剂量 / 相互作用建议，不出现依从性评分或排名
 *   - 不宣称感知能力：位置一律标注「开关模拟」
 *
 * ⚠️ 拍摄模式（`?film=1`）下**不挂载本控制台**：它会进入画面，也会破坏逐帧可复现。
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * @param {HTMLElement} root 挂载点（index.html 里的 #console）
 * @param {{scene:object, clock:object, presence:object, machine:object, store:object}} ctx
 */
export function mountConsole(root, ctx) {
  if (!root) return null;
  const { scene, clock, presence, machine, store } = ctx;
  const state = () => store.getState();

  root.textContent = '';
  root.hidden = false;

  /* ── 折叠头 ─────────────────────────────────────────────────────── */
  const head = el('div', 'console__head');
  const title = el('p', 'console__title', '演示控制台');
  const toggle = el('button', 'console__toggle', '收起');
  toggle.type = 'button';
  head.append(title, toggle);
  root.appendChild(head);

  const body = el('div', 'console__body');
  root.appendChild(body);

  toggle.addEventListener('click', () => {
    const collapsed = body.hidden;
    body.hidden = !collapsed;
    root.classList.toggle('console--collapsed', !collapsed);
    toggle.textContent = collapsed ? '收起' : '展开';
  });

  const section = (label) => {
    const sec = el('section', 'console__section');
    sec.appendChild(el('h3', 'console__label', label));
    const row = el('div', 'console__row');
    sec.appendChild(row);
    body.appendChild(sec);
    return { sec, row };
  };

  const button = (parent, label, onClick, { primary = false, title: tip } = {}) => {
    const b = el('button', `console__button${primary ? ' console__button--primary' : ''}`, label);
    b.type = 'button';
    if (tip) b.title = tip;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  /* ── ① 演示时钟 ─────────────────────────────────────────────────── */
  const t = section('演示时钟');
  button(t.row, '推进到 08:00', () => {
    // 与演示者拨表等价：把时钟拨到 08:00（已经过了就顺延到明天 08:00）
    const now = state().clock.demo;
    const day = now.slice(0, 10);
    const [hh, mm, ss] = now.slice(11, 19).split(':').map(Number);
    const elapsed = hh * 3600 + mm * 60 + ss;
    if (elapsed < 8 * 3600) clock.set(`${day}T08:00:00`);
    else clock.advance(86400 - elapsed + 8 * 3600);
  }, { primary: true, title: '把演示时钟拨到今天 08:00，触发到点' });
  button(t.row, '+10 分钟', () => clock.advance(600));
  button(t.row, '+1 小时', () => clock.advance(3600));
  button(t.row, '复位', () => ctx.debug.reset());

  /* ── ② 王阿姨的位置（开关模拟）───────────────────────────────────── */
  const p = section('王阿姨的位置 · 开关模拟');
  p.row.classList.add('console__row--tight');
  p.sec.appendChild(el('p', 'console__note', '这是开关切换，不是传感器；不采集任何画面'));
  const posButtons = new Map();
  for (const option of presence.locationOptions()) {
    const b = button(p.row, option.label, () => presence.setLocation(option.value));
    posButtons.set(option.value, b);
  }

  /* ── ③ 点击落座 · 模拟位置感应（v1.6）────────────────────────────── */
  const seatSec = section('点击落座 · 模拟位置感应');
  seatSec.sec.appendChild(el('p', 'console__note',
    '在画面上点任意位置：王阿姨走过去坐下，机器人随后感应到她的位置并移动过去。'
    + '点沙发/餐椅会坐到坐具上，点地板就席地而坐。'));
  seatSec.sec.appendChild(el('p', 'console__note',
    '⚠️ 这是开关 / 点击输入，不是传感器：不采集摄像头画面、不做识别，也不宣称感知能力。'));
  const seatRow2 = el('div', 'console__row');
  seatSec.sec.appendChild(seatRow2);
  const backBtn = button(seatRow2, '让机器人回充电桩', () => {
    presence.clearSeat();
  }, { title: '清除落座点：机器人回充电桩待命，王阿姨回到该房间的预设落位' });

  /* ── ④ 机位 ─────────────────────────────────────────────────────── */
  const c = section('机位');
  const CAMS = [
    ['wide', '全景'], ['living', '客厅'], ['bedroom', '卧室'],
    ['kitchen', '餐厨'], ['dock', '充电桩'], ['tray', '药盘特写'],
  ];
  const camButtons = new Map();
  for (const [mode, label] of CAMS) {
    const b = button(c.row, label, () => {
      scene.setCameraMode(mode);
      setOrbit(false);
    });
    camButtons.set(mode, b);
  }
  const cRow2 = el('div', 'console__row');
  c.sec.appendChild(cRow2);
  const orbitBtn = button(cRow2, '自由视角：关', () => setOrbit(!scene.isOrbitEnabled()), {
    title: '开启后：在画面上按住左键拖动旋转，滚轮缩放',
  });
  button(cRow2, '复位机位', () => scene.resetCamera());

  function setOrbit(on) {
    scene.enableOrbit(on);
    orbitBtn.textContent = on ? '自由视角：开' : '自由视角：关';
    orbitBtn.classList.toggle('console__button--on', on);
  }

  /* ── ⑤ 场景 ─────────────────────────────────────────────────────── */
  const sc = section('场景');
  sc.row.classList.add('console__row--wide');
  let shadowsOn = true;
  const shadowBtn = button(sc.row, '软阴影：开', (event) => {
    shadowsOn = !shadowsOn;
    scene.setShadows(shadowsOn);
    event.currentTarget.textContent = shadowsOn ? '软阴影：开' : '软阴影：关';
  }, { title: '关掉可换帧率（降级表里的那一项）' });
  let dusk = false;
  const timeBtn = button(sc.row, '光照：正午', (event) => {
    dusk = !dusk;
    scene.setTimeOfDay(dusk ? 'dusk' : 'day');
    event.currentTarget.textContent = dusk ? '光照：黄昏' : '光照：正午';
  });

  /* ── ⑥ 闭环命令 ─────────────────────────────────────────────────── */
  const f = section('闭环');
  const confirmBtn = button(f.row, '替她点「已取走」', () => {
    const id = state().activeEventId;
    if (id) machine.confirm(id, 'tray_taken');
  }, { primary: true, title: '与长者端「已取走」按钮是同一条命令' });
  f.sec.appendChild(el('p', 'console__note', '取药 ≠ 服药；面板只表示「已取走 · 已记录」'));

  // 状态回显放在最上面：面板内容比一屏长时，操作者至少要能一直看到「现在是什么局面」
  const status = el('p', 'console__status', '');
  const robotStatus = el('p', 'console__status console__status--sub', '');
  body.insertBefore(robotStatus, body.firstChild);
  body.insertBefore(status, body.firstChild);

  /* ── 状态回显：让操作者知道现在是什么局面 ───────────────────────── */
  function refresh() {
    const s = state();
    const demo = String(s.clock.demo).slice(11, 16);
    const active = s.activeEventId
      ? s.events.find((e) => e.id === s.activeEventId)
      : null;
    status.textContent = `${demo} · ${s.clock.acceleration}× · ${
      active ? `提示中：${(active.planName ?? active.name ?? '')} ${active.slotTime ?? ''}`.trim() : '当前无进行中的提示'}`;

    // 机器人视角的回显：它"知道"她在哪、还差多远（只读场景与 state，不做任何业务判断）
    const seat = s.presence.seat;
    const me = scene.getActorPosition && scene.getActorPosition('robot');
    const her = seat || (scene.getWaypoint ? scene.getWaypoint(s.presence.location) : null);
    if (me && her && s.presence.home) {
      const dist = Math.hypot(me.x - her.x, me.z - her.z);
      let phase = '回充电桩';
      if (s.activeEventId) phase = dist > 0.2 ? '送药中 · 前往阿姨' : '送药中 · 已到身边';
      else if (seat) phase = dist > 0.2 ? '已收到位置 · 前往阿姨' : '已到阿姨身边待命';
      else if (dist < 0.4) phase = '充电中（已回桩）';
      robotStatus.textContent = `机器人：${phase} · 距王阿姨 ${dist.toFixed(1)} m · ${
        seat ? `落座点 (${seat.x.toFixed(1)}, ${seat.z.toFixed(1)})` : '无落座点'}`;
    } else {
      robotStatus.textContent = `机器人：${me ? '待命' : '未挂载'} · ${seat ? '有落座点' : '无落座点'}`;
    }

    for (const [value, b] of posButtons) {
      b.classList.toggle('console__button--on', s.presence.location === value && !seat);
    }
    for (const [mode, b] of camButtons) {
      b.classList.toggle('console__button--on', scene.getCameraMode() === mode);
    }
    confirmBtn.disabled = !s.activeEventId;
    backBtn.disabled = !seat;
  }

  refresh();
  store.subscribe(refresh);
  window.setInterval(refresh, 500);
  setOrbit(false);

  return { refresh, root };
}

export const controls = { mountConsole };
