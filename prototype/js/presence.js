/**
 * presence.js —— 人的状态：在家 / 客厅 / 卧室 / 餐桌（H 线）
 *
 * 契约：契约-接口.md §2（presence.location 取值）、§3（presence.setLocation）、§5 转移表 2/3
 *
 * 说明：这是「开关模拟」，不是真实传感器。我们不宣称感知能力（答辩口径，见仿真计划 §8.3）。
 */

import { store } from './store.js';

/** 合法位置（契约 §2）：away 等价于 home:false */
export const LOCATIONS = ['living_room', 'bedroom', 'kitchen', 'away'];

export const LOCATION_LABEL = {
  living_room: '客厅',
  bedroom: '卧室',
  kitchen: '餐桌 · 厨房',
  away: '出门',
};

/** 位置列表（调试抽屉与家属端共用） */
export function locationOptions() {
  return LOCATIONS.map((value) => ({ value, label: LOCATION_LABEL[value] }));
}

/** 设置位置（契约 §3 命令） */
export function setLocation(location) {
  if (!LOCATIONS.includes(location)) {
    console.warn('[presence] 未知位置，已忽略：', location);
    return;
  }
  store.setPresence({ location, home: location !== 'away' });
}

/** 只切「在家 / 不在家」，保留上一条具体位置 */
export function setHome(home) {
  const current = store.getState().presence;
  if (home) {
    store.setPresence({ home: true, location: current.location === 'away' ? 'living_room' : current.location });
  } else {
    store.setPresence({ home: false, location: 'away' });
  }
}

/** "HH:MM" → 分钟数 */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 是否命中安静时段（可能跨零点，如 ["22:30","06:30"]） */
export function isQuietHours(hhmm, ranges) {
  const policy = ranges || store.getPolicy().quietHours;
  if (!policy || policy.length < 2) return false;
  const [start, end] = policy;
  const now = toMinutes(hhmm);
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from <= to) return now >= from && now < to;
  return now >= from || now < to; // 跨零点
}

/** 当前快照里人的状态（表现层只读用） */
export function current() {
  return store.getState().presence;
}
