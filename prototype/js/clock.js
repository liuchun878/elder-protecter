/**
 * clock.js —— 演示时钟（S 线）
 *
 * 契约：契约-接口.md §2 StateSnapshot.clock、§3 命令（clock.set / clock.setAcceleration）、§7（演示时钟仅内存）
 *
 * 设计：本模块**不 import 任何模块**（保证 S 的时钟可以被任何人驱动，也不反向依赖 store）。
 *       每个 tick 通过 onTick 回调把 { demo, real, acceleration, running } 交给装配层（main.js），
 *       由 main.js 写入 store 并触发 H 的到点判定。
 *
 * 默认档：1 分钟 = 1 小时（acceleration = 60）。刷新即复位，避免演示间状态串味。
 */

export const DEFAULT_DEMO_START = '2026-10-03T07:50:00';
export const ACCELERATIONS = [1, 60, 600];

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/** 本地时间 → "YYYY-MM-DDTHH:MM:SS"（不带时区，避免演示时间线出现 Z 造成歧义） */
export function toLocalISO(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function createClock({ demoStart = DEFAULT_DEMO_START, acceleration = 60, onTick, intervalMs = 200, manual = false } = {}) {
  let baseDemoMs = new Date(demoStart).getTime();
  let baseRealMs = Date.now();
  let acc = acceleration;
  let running = false;
  let timer = null;
  /**
   * manual = true：时钟**只走脚本给的步长**，不掺入真实时间。
   * 用于拍摄模式录屏——同一份分镜每次渲染出的每一帧都一致（可复现），不受机器快慢影响。
   */
  let manualMode = manual;

  function demoMs() {
    if (manualMode) return baseDemoMs;
    return baseDemoMs + (Date.now() - baseRealMs) * acc;
  }

  function snapshot() {
    return {
      demo: toLocalISO(new Date(demoMs())),
      real: new Date().toISOString(),
      acceleration: acc,
      running,
    };
  }

  function emit() {
    if (typeof onTick === 'function') onTick(snapshot());
  }

  /** 把当前演示时刻重新锚定为新的起点（切换倍速 / 直接设时钟时调用） */
  function rebase(nextDemoMs) {
    baseDemoMs = nextDemoMs;
    baseRealMs = Date.now();
  }

  return {
    start() {
      if (timer) return;
      running = true;
      timer = window.setInterval(() => emit(), intervalMs);
      emit();
    },
    stop() {
      running = false;
      if (timer) window.clearInterval(timer);
      timer = null;
    },
    isRunning() {
      return running;
    },
    /** 调试：直接设时钟（契约 §3 clock.set） */
    set(isoString) {
      rebase(new Date(isoString).getTime());
      emit();
    },
    /** 调试：倍速（契约 §3 clock.setAcceleration，1 / 60 / 600） */
    setAcceleration(next) {
      const value = ACCELERATIONS.includes(next) ? next : acc;
      rebase(demoMs());
      acc = value;
      emit();
    },
    getAcceleration() {
      return acc;
    },
    /** 推进演示时间（调试抽屉的「+15 分钟」按钮用；不放宽任何业务规则） */
    advance(seconds) {
      rebase(demoMs() + seconds * 1000);
      emit();
    },
    setManual(flag) {
      rebase(demoMs());
      manualMode = Boolean(flag);
      emit();
    },
    isManual() {
      return manualMode;
    },
    reset() {
      rebase(new Date(demoStart).getTime());
      acc = acceleration;
      emit();
    },
    snapshot,
    demoStart,
  };
}

export const clock = { createClock, DEFAULT_DEMO_START, ACCELERATIONS, toLocalISO };
