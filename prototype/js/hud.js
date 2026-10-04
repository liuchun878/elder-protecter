/**
 * hud.js —— 长者端面板（R 线）：机器人的「脸和嘴」
 *
 * 契约：契约-接口.md §1（hud 可 import store 只读 + 命令接口）、§5 文案红线、§6 空态、§9 适老化
 *
 * 硬规则：
 *   - 文字只能是「已取走 / 已记录 / 未确认」——**出现「已服下」即判不通过**
 *   - 一次只要求一个动作；无广告、无诱导按钮
 *   - 不在 3D 里渲染文字，所有文字都在这一层（对比度/字号在这里对账）
 *   - 防重复取药：已确认的事件，确认按钮禁用
 */

import { store } from './store.js';
import * as machine from './machine.js';
import { todaySummary } from './schedule.js';
import { stateText } from './log.js';
import { audio } from './audio.js';

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 只念医嘱原文，不加任何解释与建议 */
function speechText(slotTime, plan) {
  if (!plan) return `${slotTime}，该取药了`;
  const parts = [slotTime, plan.name, plan.doseText];
  if (plan.notes) parts.push(plan.notes);
  return parts.join('，');
}

export function mountHud(root) {
  if (!root) return { render() {} };
  root.innerHTML = '';

  // 右上：时钟 + 语音开关（语音阅读可开关，契约 §9）
  const meta = h('div', 'hud__meta');
  const clockBox = h('div', 'hud__clockbox');
  const clockText = h('div', 'hud__clocktext', '--:--');
  const clockSub = h('div', 'hud__clocksub', '演示时钟');
  clockBox.appendChild(clockText);
  clockBox.appendChild(clockSub);
  meta.appendChild(clockBox);

  const voiceToggle = h('button', 'hud__toggle', audio.isEnabled() ? '语音朗读：开' : '语音朗读：关');
  voiceToggle.addEventListener('click', () => {
    audio.setEnabled(!audio.isEnabled());
    voiceToggle.textContent = audio.isEnabled() ? '语音朗读：开' : '语音朗读：关';
  });
  meta.appendChild(voiceToggle);
  root.appendChild(meta);

  // 左上：主卡片（内容按 state 重建）
  const card = h('div', 'hud__card hud__card--idle');
  root.appendChild(card);

  let renderKey = '';
  let spokenAttemptKey = '';
  let lastAttemptCount = 0;

  function buildEmptyState() {
    card.className = 'hud__card';
    const row = h('div', 'hud__row');
    row.appendChild(h('span', 'hud__chip', '—'));
    row.appendChild(h('span', 'hud__greet', '今日'));
    card.appendChild(row);
    card.appendChild(h('p', 'hud__headline', '今天还没有服药计划'));
    card.appendChild(h('p', 'hud__hint', '请联系家属录入用药计划'));
  }

  function buildIdle(summary, next, confirmedCount) {
    card.className = 'hud__card hud__card--idle';
    const row = h('div', 'hud__row');
    const nowTime = String(store.getState().clock.demo || '').slice(11, 16) || '--:--';
    row.appendChild(h('span', 'hud__chip', nowTime));
    row.appendChild(h('span', 'hud__greet', '王阿姨，今天已完成'));
    card.appendChild(row);

    const total = summary.length;
    card.appendChild(h('p', 'hud__headline', `${confirmedCount} / ${total} 次`));
    if (next) {
      card.appendChild(h('p', 'hud__detail', `下一次 ${next.event.slotTime}　${next.plan ? `${next.plan.name}　${next.plan.doseText}` : ''}`));
    } else {
      card.appendChild(h('p', 'hud__detail', '今日无待服药'));
    }
    card.appendChild(h('p', 'hud__hint', '到点机器人会把药盒送到您身边'));
  }

  function buildNotifying(active) {
    const { event, plan } = active;
    card.className = 'hud__card hud__card--pulse';
    const row = h('div', 'hud__row');
    row.appendChild(h('span', 'hud__chip', event.slotTime));
    row.appendChild(h('span', 'hud__greet', '王阿姨，该取药了'));
    card.appendChild(row);

    card.appendChild(h('p', 'hud__headline', '药盒已放在托盘上'));
    card.appendChild(
      h('p', 'hud__detail', plan ? `${plan.name}　${plan.doseText}${plan.notes ? `　${plan.notes}` : ''}` : '医嘱原文缺失'),
    );
    card.appendChild(h('p', 'hud__hint', '请从机器人托盘取走'));

    const actions = h('div', 'hud__actions');
    const confirm = h('button', 'hud__button hud__button--primary', '已取走');
    confirm.addEventListener('click', () => {
      machine.confirm(event.id, 'tray_taken');
    });
    actions.appendChild(confirm);
    const later = h('button', 'hud__button hud__button--ghost', '稍后再说');
    later.addEventListener('click', () => machine.snooze(event.id, 30));
    actions.appendChild(later);
    card.appendChild(actions);
    return { attempts: event.attempts.length, event, plan };
  }

  function buildMissed(latest) {
    const { event, plan } = latest;
    card.className = 'hud__card hud__card--warn';
    const row = h('div', 'hud__row');
    row.appendChild(h('span', 'hud__chip', event.slotTime));
    row.appendChild(h('span', 'hud__greet', '这一时段没有确认'));
    card.appendChild(row);
    card.appendChild(h('p', 'hud__headline', '未确认'));
    card.appendChild(
      h('p', 'hud__detail', plan ? `${plan.name}　${plan.doseText}` : ''),
    );
    card.appendChild(h('p', 'hud__hint', '已按升级链路通知家属，记录已写入本机'));
    const actions = h('div', 'hud__actions');
    const confirm = h('button', 'hud__button hud__button--primary', '我已取走');
    confirm.addEventListener('click', () => machine.confirm(event.id, 'tray_taken'));
    actions.appendChild(confirm);
    card.appendChild(actions);
    return { attempts: 0, event, plan };
  }

  function buildConfirmed(event, plan, confirmedCount, total, next) {
    card.className = 'hud__card';
    const row = h('div', 'hud__row');
    row.appendChild(h('span', 'hud__chip', event.slotTime));
    row.appendChild(h('span', 'hud__greet', '已取走'));
    card.appendChild(row);
    card.appendChild(h('p', 'hud__headline', `已记录 ${String(event.confirmedAt || '').slice(11, 16) || ''}`));
    card.appendChild(h('p', 'hud__detail', plan ? `${plan.name}　${plan.doseText}` : ''));
    if (confirmedCount >= total) card.appendChild(h('p', 'hud__status', '今天已完成'));
    if (next) card.appendChild(h('p', 'hud__hint', `下一次 ${next.event.slotTime}　${next.plan ? next.plan.name : ''}`));
    return { attempts: 0, event, plan };
  }

  function buildLamps(summary) {
    const grid = h('div', 'hud__grid');
    for (const row of summary) {
      const lamp = h('span', 'hud__lamp');
      let dotClass = 'hud__dot';
      if (row.state === 'confirmed') dotClass += ' hud__dot--done';
      else if (row.state === 'notifying') dotClass += ' hud__dot--now';
      else if (row.state === 'missed') dotClass += ' hud__dot--missed';
      lamp.appendChild(h('span', dotClass));
      // 状态不仅用颜色：同时给出文字
      lamp.appendChild(h('span', null, `${row.time} ${stateText(row.state)}`));
      grid.appendChild(lamp);
    }
    return grid;
  }

  function render(state) {
    clockText.textContent = String(state.clock.demo || '').slice(11, 16) || '--:--';
    clockSub.textContent = `演示时钟 · ${state.clock.acceleration}×`;

    const summary = todaySummary(state);
    const confirmedCount = summary.filter((row) => row.state === 'confirmed').length;
    const active = state.activeEventId ? state.events.find((e) => e.id === state.activeEventId) : null;
    const activePlan = active ? state.plans.find((p) => p.id === active.planId) : null;
    const lastConfirmed = summary.filter((row) => row.state === 'confirmed').slice(-1)[0] || null;
    const missed = summary.filter((row) => row.state === 'missed').slice(-1)[0] || null;
    const next = state.events
      .filter((e) => e.dateISO === String(state.clock.demo || '').slice(0, 10) && (e.state === 'scheduled' || e.state === 'deferred'))
      .sort((a, b) => String(a.slotTime).localeCompare(String(b.slotTime)))[0];
    const nextInfo = next ? { event: next, plan: state.plans.find((p) => p.id === next.planId) || null } : null;

    const key = JSON.stringify([
      state.plans.length,
      state.activeEventId,
      active ? active.state : null,
      active ? active.attempts.length : 0,
      confirmedCount,
      summary.length,
      lastConfirmed ? lastConfirmed.event.id : null,
      missed ? missed.event.id : null,
      next ? next.id : null,
    ]);
    if (key === renderKey) return;
    renderKey = key;

    card.innerHTML = '';
    let spoken = null;

    if (!state.plans.length) {
      buildEmptyState();
      card.appendChild(buildLamps(summary));
      return;
    }

    if (active && active.state === 'notifying') {
      spoken = buildNotifying({ event: active, plan: activePlan });
    } else if (missed) {
      spoken = buildMissed({ event: missed.event, plan: missed.plan });
    } else if (lastConfirmed) {
      spoken = buildConfirmed(lastConfirmed.event, lastConfirmed.plan, confirmedCount, summary.length, nextInfo);
    } else {
      buildIdle(summary, nextInfo, confirmedCount);
    }

    if (summary.length) card.appendChild(buildLamps(summary));

    // 语音 + 低频音：与屏幕同步，且**换通道时不原样重推**（换措辞由 escalate 决定）
    if (spoken && spoken.event) {
      const event = spoken.event;
      const attempt = event.attempts[event.attempts.length - 1];
      const attemptKey = `${event.id}|${event.attempts.length}`;
      if (attempt && attemptKey !== spokenAttemptKey) {
        spokenAttemptKey = attemptKey;
        const isRenotify = event.attempts.length > lastAttemptCount && lastAttemptCount > 0;
        // v1.11：到点提醒与再次提醒都用**童声**（用户口径：「机器人走到奶奶身边督促吃药，声音是童声」）
        // v1.14：**到点这一句改播用户录的童声 `p1`**（"该吃药啦……"）。原先它走合成语音，
        //        页面在被点过之前会被浏览器自动播放策略掐掉 → 用户实测"到吃药时间没有声音"。
        //        再次提醒换的是措辞，故不带 clip。
        audio.speak(
          isRenotify
            ? `提醒${event.attempts.length === 2 ? '第二' : '第三'}次，${speechText(event.slotTime, spoken.plan)}，还没有取走`
            : speechText(event.slotTime, spoken.plan),
          { force: true, style: 'child', clip: isRenotify ? null : 'p1' },
        );
        audio.chime(attempt.channel);
        lastAttemptCount = event.attempts.length;
      }
      if (event.state === 'confirmed') lastAttemptCount = 0;
    } else {
      lastAttemptCount = 0;
    }
  }

  return { render };
}

export const hud = { mountHud };
