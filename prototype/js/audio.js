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

/** 浏览器要求先有用户手势才能出声；在首次点击/按键时解锁一次 */
export function attachUnlock() {
  const unlock = () => {
    unlocked = true;
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function setEnabled(flag) {
  enabled = Boolean(flag);
  if (!enabled && hasTTS()) window.speechSynthesis.cancel();
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

/**
 * 语音播报（与屏幕同步；同一句话 3 秒内不重复念，避免「原样重推」）
 * @param {string} text 只传医嘱原文拼出的句子
 */
export function speak(text, { force = false } = {}) {
  if (!enabled || !text) return;
  const now = Date.now();
  if (!force && text === lastSpoken && now - lastSpokenAt < 3000) return;
  lastSpoken = text;
  lastSpokenAt = now;

  if (!hasTTS()) return; // 静默降级：大字 + 低频音，不弹错误窗
  try {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.85; // 适老化：放慢语速
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    // 静默降级
  }
}

/** 提示通道切换：屏幕大字 + 低频音 + 灯效三者同步（不得只靠颜色） */
export function playChannel(channel) {
  chime(channel);
}

export const audio = { attachUnlock, setEnabled, isEnabled, hasTTS, speak, chime: playChannel };
