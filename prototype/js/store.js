/**
 * store.js —— 唯一状态源（H 线，队长）
 *
 * 契约：契约-接口.md §1 模块边界、§2 StateSnapshot、§3 命令接口、§7 存储键
 * 硬约束：
 *   - 不 import 任何其他业务模块（本文件是依赖图的最底层）
 *   - 表现层只能通过 store.getState() / store.subscribe() / 命令函数访问
 *   - getState() 返回只读快照（深度冻结），表现层不得持有引用后改它
 *
 * 本文件是**第一个同步点**（H0）：R 与 S 依赖它才能并行开工。
 */

/** 状态存储键（契约 §7） */
const STATE_KEY = 'medbot.state.v1';
/** 升级策略存储键（契约 §7） */
const POLICY_KEY = 'medbot.policy.v1';

/** 默认升级策略（契约 §4.4）。autoCall 恒为 false —— 红线。 */
export const DEFAULT_POLICY = Object.freeze({
  renotifyAfterSec: 60,
  maxRenotify: 2,
  notifyFamilyAfterSec: 180,
  confirmWindowMin: 45,
  quietHours: ['22:30', '06:30'],
  channels: ['voice', 'screen', 'light'],
  autoCall: false,
});

/** 演示初始快照。时钟为 null，由 S 线的 clock.js 在启动时写入。 */
function emptyState() {
  return {
    clock: { demo: null, real: null, acceleration: 60, running: false },
    presence: { home: true, location: 'living_room', seat: null },
    offline: false,
    plans: [],
    events: [],
    notifications: [],
    privacy: { familyCanSee: ['confirmedStatus', 'missedStatus', 'timeline'] },
    activeEventId: null,
  };
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** 本地存储是否可用（不可用时降级为纯内存，见契约 §6） */
let storageAvailable = (() => {
  try {
    const probe = '__medbot_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (err) {
    return false;
  }
})();

let state = emptyState();
let policy = { ...DEFAULT_POLICY };
let listeners = new Set();
let notifyScheduled = false;
let idCounters = { plan: 0, evt: 0, ntf: 0, chg: 0 };

/* ── 持久化 ─────────────────────────────────────────────────────────── */

function load() {
  if (!storageAvailable) return;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.plans = Array.isArray(saved.plans) ? saved.plans : [];
      state.events = Array.isArray(saved.events) ? saved.events : [];
      state.notifications = Array.isArray(saved.notifications) ? saved.notifications : [];
      state.activeEventId = saved.activeEventId ?? null;
    }
    const rawPolicy = window.localStorage.getItem(POLICY_KEY);
    if (rawPolicy) policy = { ...DEFAULT_POLICY, ...JSON.parse(rawPolicy), autoCall: false };
  } catch (err) {
    // 存储损坏：降级为内存态，不弹错误窗（契约 §6）
    storageAvailable = false;
  }
  idCounters = {
    plan: maxSuffix(state.plans, 'plan-'),
    evt: maxSuffix(state.events, 'evt-'),
    ntf: maxSuffix(state.notifications, 'ntf-'),
    chg: maxSuffix(state.plans, 'chg-'),
  };
}

function maxSuffix(list, prefix) {
  let max = 0;
  for (const item of list) {
    const id = String(item && item.id);
    if (!id.startsWith(prefix)) continue;
    const n = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function persist() {
  if (!storageAvailable) return;
  try {
    window.localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        plans: state.plans,
        events: state.events,
        notifications: state.notifications,
        activeEventId: state.activeEventId,
      }),
    );
  } catch (err) {
    storageAvailable = false;
  }
}

function persistPolicy() {
  if (!storageAvailable) return;
  try {
    window.localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
  } catch (err) {
    storageAvailable = false;
  }
}

/* ── 通知 ───────────────────────────────────────────────────────────── */

function emit() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  const flush = () => {
    notifyScheduled = false;
    const snapshot = store.getState();
    for (const fn of Array.from(listeners)) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[store] 订阅回调抛错（已隔离，不影响其他订阅者）', err);
      }
    }
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(flush);
  else Promise.resolve().then(flush);
}

function changed({ persist: shouldPersist = false } = {}) {
  if (shouldPersist) persist();
  emit();
}

/* ── 对外接口 ───────────────────────────────────────────────────────── */

export const store = {
  /** 只读快照（契约 §3：取快照） */
  getState() {
    return deepFreeze(clone(state));
  },

  /** 订阅（契约 §3：订阅）。返回 unsubscribe。 */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('store.subscribe 需要一个函数');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** 清空 plans/events/notifications（契约 §3：清状态） */
  reset() {
    state.plans = [];
    state.events = [];
    state.notifications = [];
    state.activeEventId = null;
    changed({ persist: true });
  },

  /** 底层写入：演示时钟（由 S 线 clock.js 调用；clock.set / setAcceleration 是契约 §3 命令） */
  setClock(patch) {
    state.clock = { ...state.clock, ...patch };
    changed();
  },

  /** 底层写入：人的状态（由 H 线 presence.js 调用，业务规则在 presence.js） */
  setPresence(patch) {
    state.presence = { ...state.presence, ...patch };
    changed();
  },

  /** 底层写入：离线提示位（仅影响界面提示，不得产生网络请求） */
  setOffline(flag) {
    state.offline = Boolean(flag);
    changed();
  },

  /** 底层写入：当前提示事件 */
  setActiveEventId(eventId) {
    state.activeEventId = eventId ?? null;
    changed();
  },

  /* 计划 */
  insertPlan(plan) {
    state.plans.push(clone(plan));
    changed({ persist: true });
    return plan;
  },
  getPlan(id) {
    return state.plans.find((p) => p.id === id) || null;
  },
  updatePlan(id, patch) {
    const plan = state.plans.find((p) => p.id === id);
    if (!plan) return null;
    Object.assign(plan, clone(patch));
    changed({ persist: true });
    return plan;
  },
  listPlans() {
    return state.plans;
  },

  /* 事件 */
  insertEvent(event) {
    state.events.push(clone(event));
    changed({ persist: true });
    return event;
  },
  getEvent(id) {
    return state.events.find((e) => e.id === id) || null;
  },
  updateEvent(id, patch) {
    const event = state.events.find((e) => e.id === id);
    if (!event) return null;
    Object.assign(event, clone(patch));
    changed({ persist: true });
    return event;
  },
  listEvents() {
    return state.events;
  },

  /* 通知 */
  insertNotification(notification) {
    state.notifications.push(clone(notification));
    changed({ persist: true });
    return notification;
  },
  getNotification(id) {
    return state.notifications.find((n) => n.id === id) || null;
  },
  updateNotification(id, patch) {
    const notification = state.notifications.find((n) => n.id === id);
    if (!notification) return null;
    Object.assign(notification, clone(patch));
    changed({ persist: true });
    return notification;
  },
  listNotifications() {
    return state.notifications;
  },
  removeNotification(id) {
    const index = state.notifications.findIndex((n) => n.id === id);
    if (index === -1) return false;
    state.notifications.splice(index, 1);
    changed({ persist: true });
    return true;
  },

  /* 策略 */
  getPolicy() {
    return deepFreeze(clone(policy));
  },
  setPolicy(patch) {
    policy = { ...policy, ...clone(patch), autoCall: false };
    persistPolicy();
    changed();
    return store.getPolicy();
  },

  /* 工具 */
  nextId(kind) {
    const prefix = { plan: 'plan-', evt: 'evt-', ntf: 'ntf-', chg: 'chg-' }[kind];
    idCounters[kind] = (idCounters[kind] || 0) + 1;
    return prefix + String(idCounters[kind]).padStart(3, '0');
  },

  isStorageAvailable() {
    return storageAvailable;
  },

  /** 导出 JSON（契约 §7，家属端「追溯」用） */
  exportJSON() {
    const snapshot = store.getState();
    return {
      exportedAtReal: new Date().toISOString(),
      events: snapshot.events,
      notifications: snapshot.notifications,
    };
  },
};

load();

/** 供 main.js/调试抽屉判断降级提示用 */
export function storageWarning() {
  return storageAvailable ? null : '存储不可用，记录只保存在本页内存中';
}
