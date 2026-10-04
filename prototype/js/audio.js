/**
 * audio.js —— 语音 + 低频提示音 + 灯效（R 线）
 *
 * 契约：契约-接口.md §9（提示音走**低频**，不用 3100 Hz 等级高频；语音必须与屏幕同步；语音阅读可开关）、
 *       §6（TTS 不可用 → 静默降级为大字 + 低频提示音，**不弹错误窗**）
 *
 * 只念**医嘱原文**（药名 + 剂量原文 + 备注原文），不加任何解释、建议、剂量换算。
 */

const TONE_HZ = 520; // 低频方波量级（调研：520 Hz 方波对老年人可听度更好；绝不使用 3100 Hz 高频）
const TONE_MS = 700;

let enabled = true;
let audioContext = null;
let unlocked = false;
let lastSpoken = '';
let lastSpokenAt = 0;

/** 中文 TTS 是否可用（不可用就静默降级，不弹窗） */
export function hasTTS() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function ensureContext() {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch (err) {
    audioContext = null;
  }
  return audioContext;
}

/** 浏览器要求先有用户手势才能出声；在首次点击/按键时解锁一次，并**补播被掐掉的那句** */
export function attachUnlock() {
  const unlock = () => {
    const wasLocked = !unlocked;
    unlocked = true;
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (wasLocked && pendingUnlock) {
      const p = pendingUnlock;
      pendingUnlock = null;
      window.setTimeout(() => speak(p.text, { ...p.opts, force: true }), 80);
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/** 是否已经拿到用户手势（装配层用来提示"点一下才出声"） */
export function isUnlocked() {
  return unlocked;
}

export function setEnabled(flag) {
  enabled = Boolean(flag);
  if (!enabled) {
    voiceQueue.length = 0;
    playing = false;
    clearTimeout(gapTimer);
    if (clipAudio) { try { clipAudio.pause(); } catch (err) { /* 忽略 */ } clipAudio = null; }
    if (hasTTS()) window.speechSynthesis.cancel();
  }
}

export function isEnabled() {
  return enabled;
}

/**
 * 低频提示音（WebAudio 合成，无任何外部音频资产）
 * @param {'voice'|'screen'|'light'} channel 换通道时给出**不同的**声光反馈
 */
export function chime(channel = 'voice') {
  if (!enabled) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = channel === 'light' ? 'square' : 'sine';
  osc.frequency.value = channel === 'screen' ? TONE_HZ * 0.75 : TONE_HZ;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (channel === 'light' ? 1.1 : TONE_MS / 1000));
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 1.2);
}

/* ── 童声（v1.11）──────────────────────────────────────────────────────
 * 用户口径：「机器人走到奶奶身边督促吃药，**声音是童声**」，并指了他仓库里的
 * `suite-3d/robot/voice/p1..p3.mp3`（三个提交：吃药提醒 / 鼓励 / 留言给子女手机，**男孩童声**）。
 * 因此这里照搬他仓库 HEAD 版 `suite-3d/robot/index.html` 的做法：
 *   ① 优先播**预录童声 mp3**（`prototype/assets/voice/*.mp3`，本地文件、零网络请求）；
 *   ② 播不了（文件缺失 / 解码失败 / 无手势）→ 退回 **TTS 抬高音调**（pitch 1.70）兜底；
 *   ③ 音色优先级同样照搬：系统童声 > 男声（抬高音调即男童）> 女声 > 任意中文。
 * 仍然是「断网可用」：mp3 是提交进仓库的本地文件，没有任何外链。
 */
const VOICE_PRIORITY = [
  /yaoyao|瑶瑶|童|child|kid/i, // 系统里的童声
  /kangkang|康康|yunxi|云希|yunyang|云扬|male|男/i, // 男声 → 抬高音调即男童（孙子）
  /xiaoxiao|xiaoyi|晓晓|晓伊|female|女/i,
  /zh[-_]CN|Chinese|普通话|中文/i,
];
/** 预录童声片段（键 → 用途，供文档与自测核对）
 *  v1.13：三段的用法（用户口径「吃药和吃完药的时候会说剩下两段话」）——
 *    p1 机器人到位督促（「…请取走」那一句）；p2 她**开始吃药**时；p3 **吃完药**（记录已同步）时。 */
export const CHILD_CLIPS = {
  p1: '吃药提醒（机器人到身边督促）',
  p2: '开始吃药（她端起杯子取药时）',
  p3: '吃完药（记录已同步给家属）',
};
const CLIP_BASE = './assets/voice/';
// v1.13（用户口径）：**默认播用户录的那三段童声**（`prototype/assets/voice/p1..p3.mp3`，本地文件、零网络请求）。
//   ⚠️ 与项目红线的显式冲突（用户裁定，已记入 CHANGELOG）：
//      p1 里有固定粒数「这三粒药」（本项目不做剂量），p2 是「药都吃完啦」（= 已服下，红线）。
//      合规兜底：网址后面加 `?voiceclip=0` → 一律走**童声 TTS + 合规措辞**（「请取走 / 已取走 · 已记录」）。
const CLIP_PARAM = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('voiceclip')
  : null;
const USE_CLIPS = CLIP_PARAM !== '0';

let zhVoice = null;
let clipAudio = null;
/** v1.13：语音队列 —— 正在播的话**绝不打断**，新的排到后面（照搬 YuMi-06 `0000000/index.html` 的修复） */
const voiceQueue = [];
let playing = false;
/** v1.21：两句之间**强制留白**（用户口径「语音不要重叠播放」）——
 * 队列里下一句不会紧接着上一句开口，中间静 0.9 秒，听着才不乱。 */
const SPEECH_GAP_MS = 900;
let gapTimer = null;
/**
 * v1.14：**被浏览器自动播放策略掐掉的那一句**。
 * 页面还没有任何用户手势时，`new Audio().play()` 与 `speechSynthesis.speak()` 都可能被拒，
 * 而"到吃药时间"是**自动发生**的（没人点过页面）——于是用户什么也听不到。
 * 这里把它记下来，首次点击/按键时补播一次。
 */
let pendingUnlock = null;

/** 选一个最像童声的中文音色（TTS 兜底用） */
export function pickChildVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = (window.speechSynthesis.getVoices() || [])
    .filter((v) => /zh|Chinese/i.test(`${v.lang} ${v.name}`));
  if (!voices.length) return null;
  for (const re of VOICE_PRIORITY) {
    const hit = voices.find((v) => re.test(v.name));
    if (hit) { zhVoice = hit; return zhVoice; }
  }
  zhVoice = zhVoice || voices[0];
  return zhVoice;
}

export function getVoiceName() {
  return zhVoice ? zhVoice.name : null;
}

/** `onBlocked`：这句被浏览器自动播放策略掐掉时回调（用于"首次点击后补播"） */
function tts(text, { pitch, rate, onBlocked = null }, done) {
  if (!hasTTS()) { if (done) done(); return; }
  try {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (zhVoice) utterance.voice = zhVoice;
    utterance.onend = () => { if (done) done(); };
    utterance.onerror = () => { if (onBlocked) onBlocked(); if (done) done(); };
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    if (onBlocked) onBlocked();
    if (done) done();
  }
}

/**
 * 真正播一句（队列里的队首）。`done()` 只允许生效一次 ——
 * 否则 `onended` 与保险定时器会各触发一次，把队列里的下一句吞掉。
 */
function playNow(text, opts) {
  const { style = 'elder', clip = null } = opts;
  const child = style === 'child';
  const pitch = child ? 1.70 : 1; // 童声：抬高音调（与用户仓库 HEAD 版一致）
  const rate = child ? 1.0 : 0.85; // 成人向：放慢语速（适老化）

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clipAudio = null;
    const next = voiceQueue.shift();
    if (!next) { playing = false; return; }
    // 下一句前先静一会儿：既不叠字，也给现场讲解留空
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => playNow(next.text, next.opts), SPEECH_GAP_MS);
  };
  const remember = () => { if (!unlocked) pendingUnlock = { text, opts }; };
  const fallback = () => tts(text, { pitch, rate, onBlocked: remember }, done);

  if (!clip || !USE_CLIPS || typeof window === 'undefined' || typeof window.Audio !== 'function') {
    fallback();
    return;
  }
  try {
    if (clipAudio) { try { clipAudio.pause(); } catch (err) { /* 忽略 */ } clipAudio = null; }
    const a = new window.Audio(`${CLIP_BASE}${clip}.mp3`);
    clipAudio = a;
    let guard = setTimeout(done, 25000); // 兜底：25 秒（最长那条约 9 秒，宽裕得多）
    // 拿到真实时长后把保险收紧到「时长 + 2.5 秒」——文件卡住也不会把队列占死
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        clearTimeout(guard);
        guard = setTimeout(done, a.duration * 1000 + 2500);
      }
    };
    a.onended = done;
    a.onerror = () => { clipAudio = null; remember(); fallback(); };
    a.play().catch(() => { clipAudio = null; remember(); fallback(); });
  } catch (err) {
    remember();
    fallback();
  }
}

/**
 * 语音播报（与屏幕同步；同一句话 3 秒内不重复念，避免「原样重推」）
 *
 * v1.13：**加入队列，不打断**。她"开始吃药"与"吃完药"两句话会在几秒内先后触发，
 * 早先的实现是"新的一句直接打断前一句"，第二句永远听不全（YuMi-06 在 `0000000/` 修的就是这个）。
 *
 * @param {string} text 只传医嘱原文拼出的句子
 * @param {{force?: boolean, style?: 'elder'|'child', clip?: string}} opts
 *   style='child' → 童声（督促吃药那几句用它）；clip='p1'..'p3' → 优先播预录童声 mp3
 */
export function speak(text, { force = false, style = 'elder', clip = null } = {}) {
  if (!enabled || !text) return;
  const now = Date.now();
  if (!force && text === lastSpoken && now - lastSpokenAt < 3000) return;
  lastSpoken = text;
  lastSpokenAt = now;

  const opts = { force, style, clip };
  if (playing) { voiceQueue.push({ text, opts }); return; } // 正在播 → 排队，绝不打断
  playing = true;
  playNow(text, opts);
}

/** 队列里还有几句没播（自测与调试用） */
export function pendingSpeeches() {
  return voiceQueue.length + (playing ? 1 : 0);
}

/** v1.21：打断并清空（换场景/停剧本时用，避免上一场的台词拖到下一场） */
export function hush() {
  voiceQueue.length = 0;
  playing = false;
  clearTimeout(gapTimer);
  if (clipAudio) { try { clipAudio.pause(); } catch (err) { /* 忽略 */ } clipAudio = null; }
  if (hasTTS()) window.speechSynthesis.cancel();
}

/** 提示通道切换：屏幕大字 + 低频音 + 灯效三者同步（不得只靠颜色） */
export function playChannel(channel) {
  chime(channel);
}

export const audio = {
  attachUnlock, setEnabled, isEnabled, hasTTS, speak, chime: playChannel, pickChildVoice, getVoiceName,
  pendingSpeeches, isUnlocked, hush,
};
