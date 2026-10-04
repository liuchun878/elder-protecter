/**
 * log.js —— 追加式事件记录 + 双时间戳（H 线）
 *
 * 契约：契约-接口.md §3 命令接口、§4.2 DoseEvent、§7 导出
 *
 * 双时间戳是硬要求：
 *   atDemo / occurredAtDemo / createdAtDemo = 演示时钟（可以加速）
 *   atReal / occurredAtReal / createdAtReal = 真实时钟
 * 只记一个会导致时间加速下时间线自相矛盾。
 */

import { store } from './store.js';

/** 演示时钟（ISO 字符串，来自 StateSnapshot.clock） */
export function demoNow() {
  return store.getState().clock.demo;
}

/** 真实时钟（ISO 字符串） */
export function realNow() {
  return new Date().toISOString();
}

/** 双时间戳对 */
export function stampPair() {
  return { demo: demoNow(), real: realNow() };
}

/** 新建一条 DoseEvent（状态 scheduled，见契约 §4.2） */
export function createEvent({ planId, slotTime, dateISO }) {
  const now = stampPair();
  return {
    id: store.nextId('evt'),
    planId,
    slotTime,
    dateISO,
    state: 'scheduled',
    attempts: [],
    occurredAtDemo: now.demo,
    occurredAtReal: now.real,
    confirmedAt: null,
    method: null,
    deferReason: null,
    familyNotifiedAt: null,
  };
}

/** 追加一次提示尝试（换通道 / 换措辞的证据，契约 §4.2） */
export function appendAttempt(eventId, { channel, wording, volume = 0.8 }) {
  const event = store.getEvent(eventId);
  if (!event) return null;
  const now = stampPair();
  const attempts = event.attempts.concat([{ atDemo: now.demo, atReal: now.real, channel, volume, wording }]);
  return store.updateEvent(eventId, { attempts });
}

/** 时间线（家属端「追溯」用）：按演示时间排序的事实清单，不含任何建议 */
export function timeline(state) {
  const plans = new Map(state.plans.map((p) => [p.id, p]));
  return state.events
    .slice()
    .sort((a, b) => String(a.occurredAtDemo).localeCompare(String(b.occurredAtDemo)))
    .map((event) => ({
      id: event.id,
      slotTime: event.slotTime,
      name: plans.get(event.planId)?.name ?? '未知药物',
      state: event.state,
      stateText: stateText(event.state),
      attempts: event.attempts.length,
      channels: event.attempts.map((a) => a.channel),
      confirmedAt: event.confirmedAt,
      method: event.method,
      deferReason: event.deferReason,
      occurredAtDemo: event.occurredAtDemo,
      occurredAtReal: event.occurredAtReal,
    }));
}

/**
 * 状态文案白名单（契约 §5 文案红线）：
 * 只能说「已取走 / 已记录 / 未确认」；界面上不得出现「已服下」。
 */
export function stateText(state) {
  switch (state) {
    case 'scheduled':
      return '待提示';
    case 'due':
      return '到点';
    case 'notifying':
      return '等待取走确认';
    case 'confirmed':
      return '已取走 · 已记录';
    case 'missed':
      return '未确认';
    case 'deferred':
      return '已顺延';
    case 'skipped_known':
      return '已知情未服';
    default:
      return '未确认';
  }
}
