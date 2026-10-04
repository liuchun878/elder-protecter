/**
 * family.js —— 家属端（副屏，H 线）
 *
 * 契约：契约-接口.md §3 命令接口（plan.* / escalate.resolve）、§6 空态、§7 导出
 * 约束：
 *   - 只读 store + 只调契约命令；不 import scene*，不写业务状态
 *   - **不给用药建议**：不推补服 / 剂量 / 停用结论；不推依从性评分、排名、连续天数
 *   - 通知只展示事实（文案由 escalate.js 生成）
 *
 * 打开方式：同一页面加 ?view=family（副屏），由 main.js 装配。
 */

import { store } from './store.js';
import * as plan from './plan.js';
import * as escalate from './escalate.js';
import { timeline, stateText } from './log.js';

const RESOLUTION_LABEL = {
  known_out: '她出门了',
  call: '已电话确认',
  ignore: '忽略本次',
};

let root = null;
let els = {};

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function build() {
  root.innerHTML = '';
  root.classList.add('family');

  const header = h('header', 'family__header');
  header.appendChild(h('h1', 'family__title', '家属端'));
  const offline = h('p', 'family__offline', '离线中，记录保存在本机');
  offline.hidden = true;
  header.appendChild(offline);
  root.appendChild(header);

  // 新增计划
  const form = h('form', 'family__card family__form');
  form.appendChild(h('h2', 'family__h2', '新增服药计划'));
  const grid = h('div', 'family__grid');
  const fields = [
    ['name', '药名', 'text', '氨氯地平'],
    ['doseText', '剂量（照医嘱原文填写）', 'text', '5mg'],
    ['time', '时段', 'time', '08:00'],
    ['endDate', '临时用药结束日期', 'date', ''],
    ['notes', '备注（原样显示给老人）', 'text', '饭后服'],
  ];
  const inputs = {};
  for (const [key, label, type, placeholder] of fields) {
    const wrap = h('label', 'family__field');
    wrap.appendChild(h('span', 'family__label', label));
    const input = h('input', 'family__input');
    input.type = type;
    input.placeholder = placeholder;
    inputs[key] = input;
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }
  const kindWrap = h('label', 'family__field');
  kindWrap.appendChild(h('span', 'family__label', '类型'));
  const kind = h('select', 'family__input');
  for (const [value, label] of [['regular', '常规'], ['temporary', '临时（到期自动失效）']]) {
    const option = h('option', null, label);
    option.value = value;
    kind.appendChild(option);
  }
  kindWrap.appendChild(kind);
  grid.appendChild(kindWrap);
  form.appendChild(grid);

  const submit = h('button', 'family__button', '保存计划');
  submit.type = 'submit';
  form.appendChild(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = inputs.name.value.trim();
    const doseText = inputs.doseText.value.trim();
    const time = inputs.time.value || '08:00';
    if (!name || !doseText) return;
    plan.create({
      name,
      doseText,
      kind: kind.value,
      slots: [{ time, label: '' }],
      endDate: inputs.endDate.value || null,
      notes: inputs.notes.value.trim(),
    });
    inputs.name.value = '';
    inputs.doseText.value = '';
    inputs.notes.value = '';
    inputs.endDate.value = '';
  });
  root.appendChild(form);

  // 通知
  const notifyCard = h('section', 'family__card');
  notifyCard.appendChild(h('h2', 'family__h2', '待处置通知'));
  els.notifications = h('div', 'family__list');
  notifyCard.appendChild(els.notifications);
  root.appendChild(notifyCard);

  // 计划列表
  const planCard = h('section', 'family__card');
  planCard.appendChild(h('h2', 'family__h2', '服药计划'));
  els.plans = h('div', 'family__list');
  planCard.appendChild(els.plans);
  root.appendChild(planCard);

  // 时间线
  const timelineCard = h('section', 'family__card');
  timelineCard.appendChild(h('h2', 'family__h2', '取药时间线（只记事实）'));
  els.timeline = h('div', 'family__list');
  timelineCard.appendChild(els.timeline);
  const exportButton = h('button', 'family__button family__button--ghost', '导出记录 JSON');
  exportButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'medbot-log.json';
    link.click();
    URL.revokeObjectURL(url);
  });
  timelineCard.appendChild(exportButton);
  root.appendChild(timelineCard);
}

/* ── 渲染 ───────────────────────────────────────────────────────────── */

function renderNotifications(state) {
  const list = state.notifications
    .slice()
    .sort((a, b) => String(b.createdAtDemo).localeCompare(String(a.createdAtDemo)));
  els.notifications.innerHTML = '';
  if (!list.length) {
    els.notifications.appendChild(h('p', 'family__empty', '暂无通知'));
    return;
  }
  for (const notification of list) {
    const item = h('article', 'family__item');
    item.appendChild(h('p', 'family__text', notification.text));
    item.appendChild(h('p', 'family__meta', `演示时间 ${String(notification.createdAtDemo).slice(11, 16)}`));
    if (notification.resolvedAt) {
      item.appendChild(h('p', 'family__meta', `已处置：${RESOLUTION_LABEL[notification.resolution] || '已处置'}`));
    } else {
      const actions = h('div', 'family__actions');
      for (const [resolution, label] of Object.entries(RESOLUTION_LABEL)) {
        const button = h('button', 'family__button family__button--small', label);
        button.addEventListener('click', () => escalate.resolve(notification.eventId, resolution));
        actions.appendChild(button);
      }
      item.appendChild(actions);
    }
    els.notifications.appendChild(item);
  }
}

function renderPlans(state) {
  els.plans.innerHTML = '';
  if (!state.plans.length) {
    els.plans.appendChild(h('p', 'family__empty', '还没有服药计划，请在上方录入。'));
    return;
  }
  for (const p of state.plans) {
    const item = h('article', 'family__item');
    const title = h('p', 'family__text', `${p.name}　${p.doseText}`);
    item.appendChild(title);
    const slotText = p.slots.map((s) => s.time).join(' / ') || '未设置时段';
    item.appendChild(
      h(
        'p',
        'family__meta',
        `${p.kind === 'temporary' ? '临时用药' : '常规用药'}　${slotText}${p.endDate ? `　至 ${p.endDate}` : ''}　${p.status === 'active' ? '生效中' : '已暂停（记录保留）'}`,
      ),
    );
    if (p.notes) item.appendChild(h('p', 'family__meta', `备注原文：${p.notes}`));
    const actions = h('div', 'family__actions');
    const toggle = h('button', 'family__button family__button--small', p.status === 'active' ? '停用（不删除）' : '恢复');
    toggle.addEventListener('click', () => (p.status === 'active' ? plan.pause(p.id) : plan.resume(p.id)));
    actions.appendChild(toggle);
    item.appendChild(actions);
    els.plans.appendChild(item);
  }
}

function renderTimeline(state) {
  const rows = timeline(state);
  els.timeline.innerHTML = '';
  if (!rows.length) {
    els.timeline.appendChild(h('p', 'family__empty', '今天还没有记录。'));
    return;
  }
  for (const row of rows.reverse()) {
    const item = h('article', 'family__item');
    item.appendChild(h('p', 'family__text', `${row.slotTime}　${row.name}　${stateText(row.state)}`));
    const channels = row.channels.length ? row.channels.map(channelLabel).join(' → ') : '未提示';
    item.appendChild(h('p', 'family__meta', `提醒 ${row.attempts} 次　通道：${channels}`));
    if (row.confirmedAt) item.appendChild(h('p', 'family__meta', `确认时间 ${String(row.confirmedAt).slice(11, 16)}　方式 ${row.method}`));
    if (row.deferReason) item.appendChild(h('p', 'family__meta', `顺延原因 ${deferReasonLabel(row.deferReason)}`));
    item.appendChild(h('p', 'family__meta', `演示 ${row.occurredAtDemo} ｜ 真实 ${row.occurredAtReal}`));
    els.timeline.appendChild(item);
  }
}

function channelLabel(channel) {
  return { voice: '语音', screen: '屏幕大字', light: '灯光' }[channel] || channel;
}

function deferReasonLabel(reason) {
  return { not_home: '不在家', quiet_hours: '安静时段', user_snooze: '稍后再说', busy: '使用中' }[reason] || reason;
}

export function mountFamilyPanel(element) {
  root = element;
  build();
  const offlineEl = root.querySelector('.family__offline');
  const refreshOffline = (state) => {
    // 契约 §6：离线时提示「离线中，记录保存在本机」；真实离线与调试开关任一成立都显示
    offlineEl.hidden = !(state.offline || !navigator.onLine);
  };
  window.addEventListener('online', () => refreshOffline(store.getState()));
  window.addEventListener('offline', () => refreshOffline(store.getState()));
  const unsubscribe = store.subscribe((state) => {
    refreshOffline(state);
    renderNotifications(state);
    renderPlans(state);
    renderTimeline(state);
  });
  const state = store.getState();
  refreshOffline(state);
  renderNotifications(state);
  renderPlans(state);
  renderTimeline(state);
  return { unsubscribe };
}

export const family = { mountFamilyPanel, timeline };
