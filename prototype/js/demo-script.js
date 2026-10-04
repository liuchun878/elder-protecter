/**
 * demo-script.js —— 「固定演示模式」的剧本执行器（S 线 · v1.14）
 *
 * 用户口径：**主演示做成可切换的平台 —— 自主点击模式 / 已固定演示模式**，
 * 固定演示的内容是「早晨 6:30 老人从床上起床 → 在餐桌吃饭 → 8:00 机器人来送药 → 老人吃药」。
 *
 * 设计：剧本是一个**声明式的时间轴**（`DEMO_BEATS`），每拍只做两件事：
 *   ① `at`   —— 把演示时钟设到该时刻（只调 clock 命令，不碰业务状态）
 *   ② `run`  —— 调**契约里已有的命令**（`presence.setLocation` 等），或什么都不做
 * 然后等 `until(state, deps)` 为真（或 `hold` 秒兜底）再进下一拍。
 * **本文件不写任何业务规则**：到点该不该送药仍然由 `machine.js` 决定，这里只是"按剧本拨表 + 换位置"。
 *
 * ⚠️ 用户说"一会儿给剧本" —— 正式剧本到了只改 `DEMO_BEATS`，执行器不用动。
 */

const DEMO_DATE = '2026-10-03';

/** 把 `HH:MM` 变成演示时钟要的 ISO 串 */
const at = (hhmm) => `${DEMO_DATE}T${hhmm}:00`;

/**
 * 剧本（占位版：按用户口述的四拍写）
 * 每拍：`{ id, label, at, run(deps), until(state, deps), hold }`
 *   `hold` 是该拍的最长等待秒数（真实时间），到点就算没等到也往下走，避免演示卡死。
 */
export const DEMO_BEATS = [
  {
    id: 'wake',
    label: '06:30 王阿姨起床（卧室）',
    at: at('06:30'),
    run: ({ presence }) => presence.setLocation('bedroom'),
    until: (state) => state.presence.location === 'bedroom',
    hold: 8,
  },
  {
    id: 'breakfast',
    label: '06:50 到餐桌吃早饭（餐区）',
    at: at('06:50'),
    run: ({ presence }) => presence.setLocation('kitchen'),
    until: (state) => state.presence.location === 'kitchen',
    hold: 10,
  },
  {
    id: 'deliver',
    label: '08:00 机器人来送药（到点 → 走到她跟前 → 注水 → 递药）',
    at: at('08:00'),
    run: () => {},
    // 等到"她开始取药"为止 —— 那一刻机器人已经到位、水也注好了
    until: (state, { person }) => Boolean(person && person.getAction && person.getAction().active),
    hold: 45,
  },
  {
    id: 'take',
    label: '老人端起杯子喝水、拿药吃（镜头给到她和机器人）',
    at: null, // 不拨表：这一刻是上一拍的延续
    run: () => {},
    until: (state, { person }) => {
      const a = person && person.getAction ? person.getAction() : null;
      return !a || !a.active; // 动作链走完（回 idle）
    },
    hold: 20,
  },
];

/**
 * 创建剧本执行器
 * @param {{clock:object, presence:object, store:object, person:object, scene:object, onBeat?:Function}} deps
 */
export function createDemoScript(deps) {
  const { clock, store, onBeat = null } = deps;
  let running = false;
  let cancelled = false;
  let index = -1;
  let beatLabel = '';

  const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

  /** 推进一拍：拨表 → 执行 → 等条件（或超时） */
  async function runBeat(beat, i) {
    index = i;
    beatLabel = beat.label;
    if (onBeat) onBeat({ id: beat.id, label: beat.label, index: i, total: DEMO_BEATS.length });
    if (beat.at) clock.set(beat.at);
    if (beat.run) beat.run(deps);
    const deadline = Date.now() + (beat.hold || 10) * 1000;
    while (!cancelled) {
      if (beat.until && beat.until(store.getState(), deps)) return true;
      if (Date.now() > deadline) return false; // 超时也继续，别把演示卡死
      await sleep(120);
    }
    return false;
  }

  async function run() {
    for (let i = 0; i < DEMO_BEATS.length; i += 1) {
      if (cancelled) return;
      await runBeat(DEMO_BEATS[i], i);
    }
    running = false;
    beatLabel = '演示结束';
    if (onBeat) onBeat({ id: 'end', label: beatLabel, index: DEMO_BEATS.length, total: DEMO_BEATS.length });
  }

  return {
    /** 从头开始播（重复调用会重启） */
    start() {
      cancelled = false;
      running = true;
      run();
      return this.status();
    },
    stop() {
      cancelled = true;
      running = false;
    },
    status() {
      return { running, index, label: beatLabel, total: DEMO_BEATS.length };
    },
  };
}

export const demoScript = { createDemoScript, DEMO_BEATS };
