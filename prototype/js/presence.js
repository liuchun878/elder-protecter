/**
 * presence.js —— 人的状态：在家 / 客厅 / 卧室 / 餐桌 / 任意点击落座点（H 线）
 *
 * 契约：契约-接口.md §2（presence.location / presence.seat 取值）、
 *       §3（presence.setLocation / setSeat / clearSeat）、§5 转移表 2/3
 *
 * 说明：这**不是传感器**。位置只有两个来源——控制台的开关、以及场景里点一下。
 * 我们不宣称任何感知/识别能力（答辩口径，见仿真计划 §8.3 与契约 §3.1.1）。
 */

import { store } from './store.js';

/** 合法位置（契约 §2）：away 等价于 home:false */
export const LOCATIONS = ['living_room', 'bedroom', 'kitchen', 'bathroom', 'away'];

export const LOCATION_LABEL = {
  living_room: '客厅',
  bedroom: '卧室',
  kitchen: '餐区 · 餐桌',
  bathroom: '卫生间',
  away: '出门',
};

/**
 * 房间分区（套房户型，世界坐标；与 room.js 的 ROOMS 一致，改户型要同步这里）。
 * 用途只有一个：**点击落座后把 location 归到某个分区**，好让到点判定 / 安静时段 /
 * 升级链路继续读 `location`，不必知道 `seat` 的存在。
 *
 * 套房 13.4×10.6 m，世界坐标 x ∈ [−6.7, 6.7]、z ∈ [−5.3, 5.3]：
 *   三间卧室（A 西北 / B 东北 / C 西南）→ bedroom；
 *   起居·餐区的**北带**（含餐桌）→ kitchen（演示里的「餐区」）；
 *   起居·客厅（沙发/电视）以及书房、卫生间、走廊 → living_room。
 */
const ZONES = [
  // 餐区先判：它是起居室北带，比"客厅"更具体
  { location: 'kitchen', x0: -1.90, x1: 6.70, z0: -1.00, z1: 1.60 },
  // 三间卧室
  { location: 'bedroom', x0: -6.70, x1: -2.10, z0: -5.30, z1: -1.00 }, // 卧室 A
  { location: 'bedroom', x0: 2.60, x1: 6.70, z0: -5.30, z1: -1.00 },   // 卧室 B
  { location: 'bedroom', x0: -6.70, x1: -1.90, z0: 1.60, z1: 5.30 },   // 卧室 C
];

/** 世界坐标 → 房间分区（契约 §2：location 必须是四个枚举之一） */
export function zoneAt(x, z) {
  const px = Number(x);
  const pz = Number(z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return 'living_room';
  for (const zone of ZONES) {
    if (px >= zone.x0 && px <= zone.x1 && pz >= zone.z0 && pz <= zone.z1) return zone.location;
  }
  return 'living_room';
}

/** 位置列表（调试抽屉与家属端共用） */
export function locationOptions() {
  return LOCATIONS.map((value) => ({ value, label: LOCATION_LABEL[value] }));
}

/** 设置位置（契约 §3 命令）。同时清掉落座点：预设位置与点击落座互斥。 */
export function setLocation(location) {
  if (!LOCATIONS.includes(location)) {
    console.warn('[presence] 未知位置，已忽略：', location);
    return;
  }
  store.setPresence({ location, home: location !== 'away', seat: null });
}

/**
 * 点击落座（契约 §3 命令，v1.6 新增）。
 * `seat` 必须是纯数据：{ x, z, surfaceY, facing, kind }（store 的 clone() 走 structuredClone，放函数会抛）。
 * 落点非法（缺 x/z）直接忽略，不写半截状态。
 */
export function setSeat(seat) {
  if (!seat || !Number.isFinite(Number(seat.x)) || !Number.isFinite(Number(seat.z))) {
    console.warn('[presence] 落座点非法，已忽略：', seat);
    return;
  }
  const x = Number(seat.x);
  const z = Number(seat.z);
  store.setPresence({
    home: true,
    location: zoneAt(x, z),
    seat: {
      x,
      z,
      surfaceY: Math.max(0, Number(seat.surfaceY) || 0),
      facing: Number.isFinite(Number(seat.facing)) ? Number(seat.facing) : 0,
      kind: typeof seat.kind === 'string' ? seat.kind : 'surface',
    },
  });
}

/** 清除落座点（契约 §3 命令，v1.6 新增）：人回到 location 的预设落位 */
export function clearSeat() {
  if (!store.getState().presence.seat) return;
  store.setPresence({ seat: null });
}

/** 当前落座点（只读，给表现层用） */
export function currentSeat() {
  return store.getState().presence.seat || null;
}

/** 只切「在家 / 不在家」，保留上一条具体位置 */
export function setHome(home) {
  const current = store.getState().presence;
  if (home) {
    store.setPresence({ home: true, location: current.location === 'away' ? 'living_room' : current.location });
  } else {
    store.setPresence({ home: false, location: 'away', seat: null });
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
