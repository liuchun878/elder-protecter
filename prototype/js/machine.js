/**
 * machine.js —— 唯一业务状态机（H 线）
 *
 * 契约：契约-接口.md §5 状态机与转移表（S0 scheduled → S1 due → S2 notifying → S3 confirmed，
 *       异常分支 deferred / missed / skipped_known）
 *
 * 只有本文件写业务状态转移。R 线的 robot.js 必须是 state 的纯函数，不许再写一套状态机。
 * 文案红线：一律「已取走 / 已记录 / 未确认」，界面不得出现「已服下」。
 */

import { store } from './store.js';
import { appendAttempt, stateText } from './log.js';
import * as escalate from './escalate.js';
import { current as presenceState, isQuietHours } from './presence.js';

/* ── 时间工具 ───────────────────────────────────────────────────────── */

function hhmm(iso) {
  return String(iso).slice(11, 16);
}
function dateOf(iso) {
  return String(iso).slice(0, 10);
}
function secondsBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  return (new Date(toISO).getTime() - new Date(fromISO).getTime()) / 1000;
}

/* ── activeEventId 维护（表现层靠它决定「机器人去哪」「叠层显示什么」）── */

function refreshActiveEvent() {
  const state = store.getState();
  const notifying = state.events
    .filter((e) => e.state === 'notifying')
    .sort((a, b) => String(a.slotTime).localeCompare(String(b.slotTime)));
  const next = notifying.length ? notifying[0].id : null;
  if (state.activeEventId !== next) store.setActiveEventId(next);
}

/* ── 转移：到点（转移表 1 / 2 / 3）───────────────────────────────────── */

/** 对到点且尚未处理的 scheduled 事件做转移 */
export function evaluateDue() {
  const state = store.getState();
  const now = state.clock.demo;
  if (!now) return;
  const today = dateOf(now);
  const nowHHMM = hhmm(now);
  const presence = presenceState();

  for (const event of state.events) {
    if (event.state !== 'scheduled') continue;
    if (event.dateISO !== today) continue;
    if (event.slotTime > nowHHMM) continue;

    if (!presence.home) {
      // 转移表 2：不在家 → deferred(not_home)
      store.updateEvent(event.id, {
        state: 'deferred',
        deferReason: 'not_home',
        occurredAtDemo: now,
        occurredAtReal: new Date().toISOString(),
      });
      continue;
    }
    if (isQuietHours(nowHHMM)) {
      // 转移表 3：安静时段 → deferred(quiet_hours)
      store.updateEvent(event.id, {
        state: 'deferred',
        deferReason: 'quiet_hours',
        occurredAtDemo: now,
        occurredAtReal: new Date().toISOString(),
      });
      continue;
    }

    // 转移表 1：到点 && 在家 → notifying，并播第 1 次
    const nowReal = new Date().toISOString();
    store.updateEvent(event.id, {
      state: 'notifying',
      deferReason: null,
      occurredAtDemo: now,
      occurredAtReal: nowReal,
    });
    appendAttempt(event.id, { channel: 'voice', wording: 'v1', volume: 0.8 });
  }

  refreshActiveEvent();
}

/* ── 转移：确认 / 稍后再说（转移表 4 / 8）────────────────────────────── */

/**
 * 确认取走（契约 §3：machine.confirm）
 * @param {string} eventId
 * @param {'tray_taken'|'voice_ack'|'family'} method
 */
export function confirm(eventId, method = 'tray_taken') {
  const event = store.getEvent(eventId);
  if (!event) return { ok: false, reason: 'not_found' };

  // 防重复：已确认的事件再次确认是空操作（验收脚本「重复取药被拦截」）
  if (event.state === 'confirmed') return { ok: false, reason: 'already_confirmed' };

  const state = store.getState();
  store.updateEvent(eventId, {
    state: 'confirmed',
    method,
    confirmedAt: state.clock.demo,
    occurredAtDemo: state.clock.demo,
    occurredAtReal: new Date().toISOString(),
    deferReason: null,
  });
  refreshActiveEvent();
  return { ok: true };
}

/**
 * 稍后再说（契约 §3：machine.snooze）——暂停当晚后续升级
 */
export function snooze(eventId, minutes = 30) {
  const state = store.getState();
  const event = store.getEvent(eventId);
  if (!event) return;
  const until = new Date(new Date(state.clock.demo).getTime() + minutes * 60000).toISOString().slice(0, 19);
  store.updateEvent(eventId, {
    state: 'deferred',
    deferReason: 'user_snooze',
    snoozedUntil: until,
  });
  refreshActiveEvent();
}

/* ── 每个时钟推进调用：超时与升级 ───────────────────────────────────── */

export function tick() {
  const state = store.getState();
  const now = state.clock.demo;
  if (!now) return;
  const policy = store.getPolicy();

  // 转移表 7：超过确认窗口 → missed（文案是「未确认」，绝不是「未服用」）
  for (const event of state.events) {
    if (event.state !== 'notifying') continue;
    const first = event.attempts[0];
    if (!first) continue;
    if (event.snoozedUntil && now < event.snoozedUntil) continue;
    if (secondsBetween(first.atDemo, now) >= policy.confirmWindowMin * 60) {
      store.updateEvent(event.id, { state: 'missed' });
    }
  }

  escalate.tick();
  refreshActiveEvent();
}

/* ── 只读派生（表现层用，不做状态转移）─────────────────────────────── */

/** 当前需要表现的提示事件（含药名等原文） */
export function activeEvent(state) {
  if (!state.activeEventId) return null;
  const event = state.events.find((e) => e.id === state.activeEventId) || null;
  if (!event) return null;
  const plan = state.plans.find((p) => p.id === event.planId) || null;
  return { event, plan, stateText: stateText(event.state) };
}

/** 今天的下一个待提示时段（HUD 空闲态显示用） */
export function nextPending(state) {
  const now = state.clock.demo;
  if (!now) return null;
  const today = dateOf(now);
  const pending = state.events
    .filter((e) => e.dateISO === today && (e.state === 'scheduled' || e.state === 'deferred'))
    .sort((a, b) => String(a.slotTime).localeCompare(String(b.slotTime)));
  if (!pending.length) return null;
  const event = pending[0];
  const plan = state.plans.find((p) => p.id === event.planId) || null;
  return { event, plan };
}

/** 今天已确认的条数（「今天已完成」用） */
export function todayConfirmed(state) {
  const today = dateOf(state.clock.demo || '');
  return state.events.filter((e) => e.dateISO === today && e.state === 'confirmed').length;
}

export const machine = { confirm, snooze, tick, evaluateDue };
