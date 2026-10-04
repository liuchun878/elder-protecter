/**
 * plan.js —— 服药计划（H 线）
 *
 * 契约：契约-接口.md §3 命令接口（plan.create / update / pause / resume）、§4.1 MedicationPlan
 *
 * 红线：
 *   - doseText 只存医嘱原文，系统不生成、不换算、不解释
 *   - notes 原样复读
 *   - 暂停 / 到期**不删除**记录（审计链保留，换药 = 旧药 paused）
 *   - 时段冲突只**并列展示**两条原始医嘱，绝不替用户取舍顺序
 */

import { store } from './store.js';

function todayISO(demoISO) {
  return String(demoISO || new Date().toISOString()).slice(0, 10);
}

/**
 * 建立计划（契约 §3：plan.create）
 * @param {object} input { name, doseText, kind, slots, startDate, endDate, notes }
 * @returns {string} id
 */
export function create(input) {
  const now = store.getState().clock.demo || new Date().toISOString();
  const kind = input.kind === 'temporary' ? 'temporary' : 'regular';
  const plan = {
    id: store.nextId('plan'),
    name: String(input.name || '').trim(),
    doseText: String(input.doseText || '').trim(),
    kind,
    // slots 只接受 { time: "HH:MM", label } 原始录入值
    slots: (input.slots || []).map((slot) => ({
      time: String(slot.time).slice(0, 5),
      label: slot.label || '',
    })),
    startDate: input.startDate || todayISO(now),
    // temporary 必须有 endDate（契约 §4.1）
    endDate: kind === 'temporary' ? input.endDate || null : input.endDate || null,
    status: 'active',
    notes: input.notes || '',
  };
  store.insertPlan(plan);
  return plan.id;
}

/** 修改计划（契约 §3：plan.update；不含 status） */
export function update(id, patch) {
  const { status, id: _ignoredId, ...safe } = patch || {};
  store.updatePlan(id, safe);
}

/** 停用（不删除） */
export function pause(id) {
  store.updatePlan(id, { status: 'paused' });
}

/** 恢复 */
export function resume(id) {
  store.updatePlan(id, { status: 'active' });
}

/** 是否在有效期内 */
export function isInDateRange(plan, dateISO) {
  if (plan.startDate && dateISO < plan.startDate) return false;
  if (plan.endDate && dateISO > plan.endDate) return false;
  return true;
}

/**
 * 临时用药到期自动失效：转 paused 而非删除（契约 §3.1 验收）。
 * 每次到点判定前调用；返回本次失效的计划 id 列表（供界面提示「变更记录」）。
 */
export function expireTemporary(dateISO) {
  const expired = [];
  for (const plan of store.getState().plans) {
    if (plan.status !== 'active') continue;
    if (plan.kind !== 'temporary') continue;
    if (plan.endDate && dateISO > plan.endDate) {
      store.updatePlan(plan.id, { status: 'paused', expiredAt: dateISO });
      expired.push(plan.id);
    }
  }
  return expired;
}

/**
 * 时段冲突检测：同一 slotTime 有两条及以上 active 计划时返回冲突组。
 * **只检测、不排序、不建议**——界面并列展示两条原始医嘱（契约 §6）。
 */
export function slotConflicts(plans, dateISO) {
  const buckets = new Map();
  for (const plan of plans) {
    if (plan.status !== 'active') continue;
    if (!isInDateRange(plan, dateISO)) continue;
    for (const slot of plan.slots) {
      const key = slot.time;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ plan, slot });
    }
  }
  return Array.from(buckets.entries())
    .filter(([, list]) => list.length > 1)
    .map(([time, list]) => ({ time, items: list }));
}

/** 今日仍在生效的计划（含 pending 状态由 schedule 计算） */
export function activePlansToday(dateISO) {
  return store
    .getState()
    .plans.filter((plan) => plan.status === 'active' && isInDateRange(plan, dateISO));
}

export const plan = { create, update, pause, resume };
