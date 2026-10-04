/**
 * demo-script.js —— 「固定演示」剧本执行器（S 线 · v1.19）
 *
 * 剧本来源：用户给的 **《老人的一天》——智能服药陪伴机器人纪实**（5 场 + 结尾，
 * 时长 2–3 分钟，早/中/晚 + 上下午共 5 个服药时段）。
 *
 * 设计：剧本是**声明式时间轴**（`DEMO_BEATS`），每拍只做三类事情 ——
 *   ① 拨表 / 换位置 / 换光照（`at` / `place` / `timeOfDay`）→ 调**契约里已有的命令**
 *   ② 等一个**场景条件**（`until`：她开始取药 / 动作做完 / 机器到位）
 *   ③ 显示与朗读这一段字幕（`narration` 旁白 / `robot` 小护台词 / `elder` 老人台词）
 * **本文件不写任何业务规则**：到点该不该送药仍然由 `machine.js` 决定，这里只是"按剧本拨表 + 换位置"。
 *
 * 播放器语义（用户口径「可以制作成一个视频来展示，然后我可以随时暂停，方便我讲解」）：
 *   `start()` / `pause()` / `resume()` / `toggle()` / `restart()` / `jump(i)`
 *   暂停时**同时冻结演示时钟**（`clock.stop()`），场景真的停住 —— 讲解完再按播放继续。
 */

const DEMO_DATE = '2026-10-03';
const at = (hhmm) => `${DEMO_DATE}T${hhmm}:00`;

/**
 * 剧本（《老人的一天》）
 *
 * 字段：
 *   `label`      章节标题（播放器上显示）
 *   `at`         把演示时钟拨到该时刻（`null` = 不拨表，接上一拍）
 *   `place`      她要去的房间（`presence.setLocation`；`null` = 不动）
 *   `timeOfDay`  光照档（`scene.setTimeOfDay`：day / dusk / night；`null` = 不变）
 *   `narration`  旁白字幕（温柔治愈风，与剧本一致）
 *   `robot`      小护台词（会**朗读**出来 + 字幕）
 *   `elder`      老人台词（只做字幕，我们没有人声）
 *   `until`      等待条件：`'take'`=她开始取药 ｜ `'done'`=动作链走完 ｜ `'set'`=位置生效
 *   `hold`       这一拍最长等多少**真实秒**（到点就往下走，避免演示卡死）
 */
export const DEMO_BEATS = [
  {
    id: 'morning',
    label: '第一场 · 清晨 08:00 · 卧室 → 客厅',
    at: at('08:00'),
    place: 'living_room',
    timeOfDay: 'day',
    narration: '清晨的阳光透进卧室。王阿姨缓缓起床，倒了一杯温水，坐在沙发上翻看儿女发来的消息 —— 完全忘了晨起服药这件事。',
    robot: '奶奶早上好！现在是早上八点，到了您服用降压药的时间啦，今日晨起药物已为您备好，请按时服药哦。',
    elder: '哎呀！我这记性，刚起床就把吃药的事忘得一干二净，多亏有你提醒。',
    until: 'settled',
    hold: 90,
  },
  {
    id: 'forenoon',
    label: '第二场 · 上午 10:00 · 客厅窗边',
    at: at('10:00'),
    place: 'living_room',
    timeOfDay: 'day',
    narration: '阳光正好，阿姨在窗边浇花晒太阳，回客厅看起了电视，彻底忘了上午的调理药物。',
    robot: '奶奶您好，现在是上午十点，您的调理药物服用时间到啦，请及时服药，不要遗漏哦。',
    elder: '好好好，我马上吃！人老了脑子不好使，没有你盯着，我天天都得忘药。',
    until: 'settled',
    hold: 90,
  },
  {
    id: 'noon',
    label: '第三场 · 中午 12:30 · 餐区 · 正要出门',
    at: at('12:30'),
    place: 'kitchen',
    timeOfDay: 'day',
    narration: '午饭吃完、碗筷收拾好，她拿起帽子钥匙正要出门散步买菜 —— 午间的药又忘了。',
    robot: '奶奶稍等哦！午饭后半小时是服药最佳时间，还没吃药呢，吃完药再出门散步更安心。',
    elder: '对对对！差点就出门了，万一漏吃药，身体该不舒服了，谢谢你呀小护。',
    until: 'settled',
    hold: 90,
  },
  {
    id: 'afternoon',
    label: '第四场 · 下午 16:00 · 客厅 · 买菜归来',
    at: at('16:00'),
    place: 'living_room',
    timeOfDay: 'dusk',
    narration: '买菜归来，她坐在沙发上休息、剥水果吃，早已忘了下午的专项药物。',
    robot: '奶奶下午好！现在是下午四点，请按时服用今日下午药物，本次药物需温水送服，服用后可适当休息。',
    elder: '（点点头，接过水杯）',
    until: 'settled',
    hold: 90,
  },
  {
    id: 'night',
    label: '第五场 · 晚上 20:00 · 客厅 · 夜晚收尾',
    at: at('20:00'),
    place: 'living_room',
    timeOfDay: 'night',
    narration: '天色渐暗，室内灯光柔和温暖。看完晚间新闻，她起身收拾客厅准备休息 —— 忘了晚间最后一次服药。',
    robot: '奶奶晚上好！今日最后一次服药时间到啦，完成服药就可以安心休息啦。',
    elder: '以前儿女不在家，我总是三天两头忘吃药、吃错药。现在有了你，早中晚按时提醒，一天都不会漏，真是我的专属健康小管家啊。',
    until: 'settled',
    hold: 90,
  },
  {
    id: 'ending',
    label: '结尾 · 全景 · 机器人回充电座',
    at: null,
    place: null,
    timeOfDay: null,
    narration: '夜色温柔，小护安静返回充电座待机，客厅温馨静谧 —— 岁月无声，陪伴有心。',
    robot: '守护奶奶健康，陪伴奶奶每一天，是我的使命呀！今日所有服药任务已全部完成，祝您晚安，今夜安心休憩！',
    elder: '',
    until: null,
    hold: 12,
  },
];

/** 等待条件的判据（全部只读 state / 表现层进度，不含业务规则） */
function waitSatisfied(kind, state, deps) {
  if (kind === 'set') return true;
  if (!kind) return false; // 纯时长拍（比如结尾定格）：交给 `hold` 到点再走
  const person = deps.person;
  const action = person && person.getAction ? person.getAction() : null;
  const acting = Boolean(action && action.active);
  if (kind === 'take') {
    if (acting) deps._seenTake = true;
    return acting;
  }
  if (kind === 'settled') {
    // v1.20（用户口径）：把"**送药 → 递药 → 吃药 → 机器人收回托盘 → 回充电桩**"整条演完再进下一场
    const rp = deps.scene && deps.scene.getActorPosition ? deps.scene.getActorPosition('robot') : null;
    const dock = deps.scene && deps.scene.getDock ? deps.scene.getDock() : null;
    const atDock = Boolean(rp && dock && Math.hypot(rp.x - dock.x, rp.z - dock.z) < 0.18);
    if (acting) { deps._seenTake = true; return false; }
    if (deps._seenTake && atDock) { deps._seenTake = false; return true; }
    return false;
  }
  if (kind === 'done') {
    // 先等她真的开始取药，再等动作链走完回 idle —— 不能只看"当前没在动"，
    // 否则一进这一拍（动作还没开始）就立刻放行，等于没演（v1.19 实测踩到过）
    if (acting) { deps._seenTake = true; return false; }
    if (deps._seenTake) { deps._seenTake = false; return true; }
    return false;
  }
  return true;
}

/**
 * 创建剧本执行器
 * @param {{clock:object, presence:object, store:object, person:object, scene:object,
 *          onBeat?:Function, onState?:Function}} deps
 */
export function createDemoScript(deps) {
  const { clock, store, presence, scene, onBeat = null } = deps;
  let running = false;
  let paused = false;
  let index = -1;
  let cancelled = false;
  let dbg = {}; // 只读诊断（status() 带出去）

  /* 两种驱动方式：
   *   交互演示 → 定时器（真实时间）
   *   录视频   → **逐帧**（`deps.nextStep`）：帧率与渲染速度解耦，画面才平滑（实测软渲染只有 2–3 fps） */
  const stepDriver = deps.nextStep || null;
  const stepSeconds = (stepDriver && stepDriver.seconds) || (1 / 12);
  const waitNext = () => {
    if (stepDriver) return new Promise((resolve) => stepDriver.register(resolve));
    return new Promise((resolve) => { window.setTimeout(resolve, 120); });
  };
  /** 把"最长等 N 秒"换算成"最多等 N 步"（逐帧模式下按仿真秒计） */
  const holdSteps = (beat) => Math.max(1, Math.round(((beat.hold || 15) / (stepDriver ? stepSeconds : 0.12))));

  function notify() {
    if (onBeat) {
      onBeat({
        index, total: DEMO_BEATS.length, beat: DEMO_BEATS[index] || null, paused, running,
      });
    }
  }

  function applyBeat(beat) {
    if (beat.timeOfDay && scene.setTimeOfDay) scene.setTimeOfDay(beat.timeOfDay);
    if (beat.place) presence.setLocation(beat.place);
    if (beat.at) clock.set(beat.at);
  }

  async function runBeat(beat, i) {
    index = i;
    deps._seenTake = false;
    notify();
    applyBeat(beat);
    const budget = holdSteps(beat);
    let used = 0;
    while (!cancelled) {
      if (paused) { dbg = { kind: beat.until, used, budget, paused: true }; await waitNext(); continue; }
      const ok = waitSatisfied(beat.until, store.getState(), deps);
      const act = deps.person && deps.person.getAction ? deps.person.getAction() : null;
      dbg = { kind: beat.until, used, budget, ok, acting: Boolean(act && act.active), seen: deps._seenTake, paused: false };
      if (ok) return true;
      if (used >= budget) return false; // 超时也继续，别把演示卡死
      used += 1;
      await waitNext();
    }
    return false;
  }

  async function run(from) {
    running = true;
    for (let i = from; i < DEMO_BEATS.length; i += 1) {
      if (cancelled) return;
      await runBeat(DEMO_BEATS[i], i);
    }
    running = false;
    index = DEMO_BEATS.length - 1;
    notify();
  }

  return {
    /** 从头（或指定拍）开始播 */
    start(from = 0) {
      cancelled = false;
      paused = false;
      run(from);
      return this.status();
    },
    pause() {
      paused = true;
      if (!stepDriver) clock.stop(); // 交互演示：连演示时钟一起停，场景真的定住（录制的逐帧模式没有计时器）
      notify();
      return this.status();
    },
    resume() {
      if (!running) return this.start(index < 0 ? 0 : index);
      paused = false;
      if (!stepDriver) clock.start();
      notify();
      return this.status();
    },
    toggle() {
      return paused ? this.resume() : this.pause();
    },
    restart() {
      cancelled = true;
      running = false;
      paused = false;
      index = -1;
      return window.setTimeout(() => this.start(0), 30);
    },
    /** 跳到第 i 拍（讲解时想直接切某一场） */
    jump(i) {
      const to = Math.max(0, Math.min(DEMO_BEATS.length - 1, Number(i) || 0));
      cancelled = true;
      running = false;
      paused = false;
      return window.setTimeout(() => { cancelled = false; run(to); }, 30);
    },
    beats: () => DEMO_BEATS,
    status() {
      return {
        running, paused, index, total: DEMO_BEATS.length, beat: DEMO_BEATS[index] || null, dbg,
      };
    },
  };
}

export const demoScript = { createDemoScript, DEMO_BEATS };
