/**
 * schedule.js —— 到点判定（H 线）
 *
 * 契约：契约-接口.md §5 转移表、§4.2 DoseEvent
 * 输入：计划 × 时钟（S 的 clock.js）× 在场（presence.js）× 安静时段
 * 输出：把「今天该吃几次」物化成 DoseEvent（状态 scheduled），交由 machine.js 做状态转移。
 *
 * 分工：本文件只**判定与物化**，不做状态转移（那是 machine.js 的职责）。
 */

import { store } from './store.js';
import * as plan from './plan.js';
import * as machine from './machine.js';
import { createEvent } from './log.js';

function dateOf(iso) {
  return String(iso).slice(0, 10);
}
function hhmm(iso) {
  return String(iso).slice(11, 16);
}

/** 该事件对应的计划是否仍然有效（暂停 / 不在有效期 → 不再提示，但记录保留） */
export function planActiveForEvent(state, event) {
  const p = state.plans.find((x) => x.id === event.planId);
  if (!p) return false;
  if (p.status !== 'active') return false;
  return plan.isInDateRange(p, event.dateISO);
}

/** 把「今天」的计划时段物化为 DoseEvent（无重复） */
export function materializeToday() {
  const state = store.getState();
  const now = state.clock.demo;
  if (!now) return;
  const today = dateOf(now);

  const existing = new Set(state.events.map((e) => `${e.planId}|${e.dateISO}|${e.slotTime}`));

  for (const p of state.plans) {
    if (p.status !== 'active') continue;
    if (!plan.isInDateRange(p, today)) continue;
    for (const slot of p.slots) {
      const key = `${p.id}|${today}|${slot.time}`;
      if (existing.has(key)) continue;
      existing.add(key);
      store.insertEvent(createEvent({ planId: p.id, slotTime: slot.time, dateISO: today }));
    }
  }
}

/** 跨天时，把过去几天仍挂在 scheduled / notifying 的事件收口为 missed（不删除，保留审计） */
export function closeStaleDays() {
  const state = store.getState();
  const today = dateOf(state.clock.demo);
  for (const event of state.events) {
    if (event.dateISO >= today) continue;
    if (event.state === 'scheduled' || event.state === 'notifying') {
      store.updateEvent(event.id, { state: 'missed' });
    }
  }
}

/**
 * 启动对账（契约 §5.1）：演示时钟「仅内存、刷新即复位」，所以刷新后必须把**今天尚未了结**的
 * 事件退回 `scheduled`，否则会出现「时钟回到 07:50、却还挂着昨天那轮的未确认」这种自相矛盾。
 * 已确认（confirmed）与已知情未服（skipped_known）是真实历史，一律保留。
 */
export function reconcileOnBoot() {
  const state = store.getState();
  const now = state.clock.demo;
  if (!now) return;
  const today = dateOf(now);

  for (const event of state.events) {
    if (event.dateISO !== today) continue;
    if (event.state === 'confirmed' || event.state === 'skipped_known') continue;
    store.updateEvent(event.id, {
      state: 'scheduled',
      attempts: [],
      deferReason: null,
      confirmedAt: null,
      method: null,
      familyNotifiedAt: null,
      snoozedUntil: null,
      resolution: null,
    });
  }

  // 未处置的通知属于上一轮演示，清掉，避免副屏出现「对不上号」的待处置项
  for (const notification of state.notifications) {
    if (notification.resolvedAt) continue;
    const event = state.events.find((e) => e.id === notification.eventId);
    if (!event || event.dateISO !== today) continue;
    store.removeNotification(notification.id);
  }

  store.setActiveEventId(null);
}

/** 每个演示时钟推进调用一次（由 main.js 装配，不在 H 内部自转） */
export function tick() {
  const state = store.getState();
  if (!state.clock.demo) return;

  closeStaleDays();
  plan.expireTemporary(dateOf(state.clock.demo));
  materializeToday();
  machine.evaluateDue();
  machine.tick();
}

/** 今日概览（长者端与家属端都读它，只读、纯派生） */
export function todaySummary(state) {
  const today = dateOf(state.clock.demo || '');
  const events = state.events
    .filter((e) => e.dateISO === today)
    .sort((a, b) => String(a.slotTime).localeCompare(String(b.slotTime)));
  const plansById = new Map(state.plans.map((p) => [p.id, p]));
  return events.map((event) => ({
    event,
    plan: plansById.get(event.planId) || null,
    time: event.slotTime,
    state: event.state,
  }));
}

export { hhmm, dateOf };
