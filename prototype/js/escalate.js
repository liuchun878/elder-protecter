/**
 * escalate.js —— 升级链路（H 线）
 *
 * 契约：契约-接口.md §4.3 Notification、§4.4 EscalationPolicy、§5 转移表 5/6/8/9
 *
 * 红线（任何一行都不得违反）：
 *   - 通知 text **只推事实**，模板固定：`{slotTime} 的 {name} 未确认，已提醒 {n} 次`
 *   - 不得出现补服 / 剂量 / 停用建议；不得出现依从性评分、排名、连续天数
 *   - autoCall 恒为 false：不自动呼叫急救、不自动通知医生
 *   - 第 1 档只对本人：**换通道 + 换措辞 + 拉长间隔**，绝不原样重推
 *   - 冷却期去重：同一 eventId 在窗口内只通知家属一次
 */

import { store } from './store.js';
import { appendAttempt } from './log.js';

function secondsBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  return (new Date(toISO).getTime() - new Date(fromISO).getTime()) / 1000;
}

function planName(state, planId) {
  return state.plans.find((p) => p.id === planId)?.name || '该药';
}

/** 措辞版本：v1 首推 → v2 换措辞 → v3 再换措辞（契约 §4.2 wording） */
const WORDING = ['v1', 'v2', 'v3'];

/**
 * 第 1 档：换通道 + 换措辞（契约 §5 转移表 5）。
 * @returns {boolean} 是否真的推了一次
 */
export function renotify(eventId) {
  const state = store.getState();
  const event = state.events.find((e) => e.id === eventId);
  if (!event || event.state !== 'notifying') return false;

  const policy = statePolicy();
  if (event.attempts.length - 1 >= policy.maxRenotify) return false;

  const nextIndex = event.attempts.length;
  const channel = policy.channels[nextIndex % policy.channels.length];
  appendAttempt(eventId, {
    channel,
    wording: WORDING[Math.min(nextIndex, WORDING.length - 1)],
    volume: 0.9,
  });
  return true;
}

/**
 * 第 2 档：通知家属（契约 §5 转移表 6 + §4.3）。
 * 冷却期去重：同一 eventId 只创建一条 level 2 通知。
 */
export function notifyFamily(eventId) {
  const state = store.getState();
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return null;
  if (event.familyNotifiedAt) return null;

  const existing = state.notifications.find((n) => n.eventId === eventId && n.level === 2);
  if (existing) {
    store.updateEvent(eventId, { familyNotifiedAt: existing.createdAtDemo });
    return existing;
  }

  const renotifyCount = Math.max(event.attempts.length - 1, 0);
  const notification = {
    id: store.nextId('ntf'),
    eventId,
    level: 2,
    to: 'family',
    // 模板固定，只推事实。不得追加任何建议。
    text: `${event.slotTime} 的 ${planName(state, event.planId)} 未确认，已提醒 ${renotifyCount} 次`,
    createdAtDemo: state.clock.demo,
    createdAtReal: new Date().toISOString(),
    resolvedAt: null,
    resolution: null,
  };
  store.insertNotification(notification);
  store.updateEvent(eventId, { familyNotifiedAt: notification.createdAtDemo });
  return notification;
}

function statePolicy() {
  return store.getPolicy();
}

/**
 * 每个演示时钟推进时调用：判断是否该换通道 / 是否该通知家属。
 * 阈值基于**演示时钟**（加速档下等价于真实加速）。
 */
export function tick() {
  const state = store.getState();
  const now = state.clock.demo;
  if (!now) return;
  const policy = statePolicy();

  for (const event of state.events) {
    if (event.state !== 'notifying') continue;
    const firstAttempt = event.attempts[0];
    if (!firstAttempt) continue;
    const elapsed = secondsBetween(firstAttempt.atDemo, now);

    if (elapsed >= policy.renotifyAfterSec && event.attempts.length < 2) {
      renotify(event.id);
      continue;
    }
    if (elapsed >= policy.notifyFamilyAfterSec && event.attempts.length < 3) {
      renotify(event.id);
      notifyFamily(event.id);
    }
  }
}

/**
 * 家属处置（契约 §3：escalate.resolve）
 * @param {'known_out'|'call'|'ignore'} resolution
 */
export function resolve(eventId, resolution) {
  const event = store.getEvent(eventId);
  if (!event) return;

  if (resolution === 'known_out') {
    // 已知情未服：不计入依从失败（契约 §5 转移表 9）
    store.updateEvent(eventId, { state: 'skipped_known', resolution, deferReason: null });
  } else {
    store.updateEvent(eventId, { resolution });
  }

  const state = store.getState();
  for (const notification of state.notifications) {
    if (notification.eventId !== eventId) continue;
    if (notification.resolvedAt) continue;
    store.updateNotification(notification.id, {
      resolvedAt: state.clock.demo,
      resolution,
    });
  }

  if (store.getState().activeEventId === eventId) store.setActiveEventId(null);
}

export const escalate = { tick, renotify, notifyFamily, resolve };
