/**
 * suite-textures.js —— 套房场景的程序化贴图工厂（S 线）
 *
 * 来源：`suite-3d/index.html`（参考 `套房.skp` 重建的那一套户型）。
 * 这一版**按本仓库的红线改过**：
 *   ① 随机数全部走**固定 seed**（原版用 `Math.random()`，同一份代码每次刷新纹理都不同，
 *      录屏逐帧可复现就无从谈起）；
 *   ② 只产出 **Canvas**，不在这里建 THREE 贴图 —— 由 `room.js` 统一按材质的 repeat / 各向异性包装，
 *      免得两处各写一套 wrap 规则；
 *   ③ 零外部资产：没有一张图片、没有字体、没有网络请求。
 *
 * 画布尺寸沿用原版：木地板 / 石材 1024²，卫浴深色石材 512²，布纹 256²，灰泥 512²，天空 1024×512。
 */

import { makeRng } from './textures.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 逐像素加噪（原版用 Math.random，这里换成同一 seed 的序列） */
function noise(ctx, w, h, amt, rand) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** 木地板：浅橡木，竖向直纹 + 板缝 */
export function woodCanvas(seed = 20261) {
  const rand = makeRng(seed);
  const w = 1024;
  const h = 1024;
  const c = cv(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#b98a5e';
  x.fillRect(0, 0, w, h);
  const planks = 8;
  const pw = w / planks;
  for (let i = 0; i < planks; i += 1) {
    const base = 176 + rand() * 26;
    x.fillStyle = `rgb(${Math.round(base + 14)},${Math.round(base - 24)},${Math.round(base - 62)})`;
    x.fillRect(i * pw, 0, pw - 1.5, h);
    for (let g = 0; g < 150; g += 1) {
      x.strokeStyle = `rgba(${Math.round(90 + rand() * 70)},${Math.round(54 + rand() * 40)},${Math.round(24 + rand() * 30)},${0.03 + rand() * 0.09})`;
      x.lineWidth = 0.6 + rand() * 1.7;
      const gx = i * pw + rand() * pw;
      x.beginPath();
      x.moveTo(gx, 0);
      x.bezierCurveTo(
        gx + (rand() - 0.5) * 9, h * 0.33,
        gx + (rand() - 0.5) * 9, h * 0.66,
        gx + (rand() - 0.5) * 5, h,
      );
      x.stroke();
    }
    x.fillStyle = 'rgba(60,38,20,.30)';
    x.fillRect(i * pw + pw - 1.6, 0, 1.6, h);
  }
  for (let i = 0; i < 26; i += 1) {
    x.fillStyle = 'rgba(60,38,20,.22)';
    x.fillRect(Math.floor(rand() * planks) * pw, rand() * h, pw, 1.4);
  }
  noise(x, w, h, 10, rand);
  return c;
}

/** 石材／水泥地毯：米灰底 + 淡纹 */
export function stoneCanvas(seed = 20262) {
  const rand = makeRng(seed);
  const w = 1024;
  const h = 1024;
  const c = cv(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d8cfc2');
  g.addColorStop(0.5, '#cfc5b6');
  g.addColorStop(1, '#dcd4c8');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i += 1) {
    x.strokeStyle = `rgba(150,138,122,${0.05 + rand() * 0.13})`;
    x.lineWidth = 1 + rand() * 4;
    x.beginPath();
    let px = rand() * w;
    let py = rand() * h;
    x.moveTo(px, py);
    for (let s = 0; s < 5; s += 1) {
      px += (rand() - 0.5) * 320;
      py += (rand() - 0.5) * 320;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  for (let i = 0; i < 900; i += 1) {
    x.fillStyle = `rgba(${Math.round(120 + rand() * 90)},${Math.round(112 + rand() * 84)},${Math.round(100 + rand() * 76)},${0.05 + rand() * 0.12})`;
    x.beginPath();
    x.arc(rand() * w, rand() * h, 1 + rand() * 5, 0, 7);
    x.fill();
  }
  noise(x, w, h, 12, rand);
  return c;
}

/** 卫浴深色石材 */
export function slateCanvas(seed = 20263) {
  const rand = makeRng(seed);
  const w = 512;
  const h = 512;
  const c = cv(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#3c4044';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i += 1) {
    x.strokeStyle = `rgba(255,255,255,${0.015 + rand() * 0.05})`;
    x.lineWidth = 0.7 + rand() * 2;
    x.beginPath();
    let px = rand() * w;
    let py = rand() * h;
    x.moveTo(px, py);
    for (let s = 0; s < 4; s += 1) {
      px += (rand() - 0.5) * 180;
      py += (rand() - 0.5) * 180;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  noise(x, w, h, 14, rand);
  return c;
}

/** 织物（沙发／床品）：给定底色 + 斜纹 */
export function linenCanvas(r0, g0, b0, seed = 20264) {
  const rand = makeRng(seed);
  const w = 256;
  const h = 256;
  const c = cv(w, h);
  const x = c.getContext('2d');
  x.fillStyle = `rgb(${r0},${g0},${b0})`;
  x.fillRect(0, 0, w, h);
  for (let i = -h; i < w; i += 3) {
    x.strokeStyle = 'rgba(255,255,255,.055)';
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i + h, h);
    x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.045)';
    x.beginPath();
    x.moveTo(i + 1.4, 0);
    x.lineTo(i + 1.4, h);
    x.stroke();
  }
  noise(x, w, h, 12, rand);
  return c;
}

/** 墙面：白灰泥，极淡的斑驳 */
export function plasterCanvas(seed = 20265) {
  const rand = makeRng(seed);
  const w = 512;
  const h = 512;
  const c = cv(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#edeae4';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 150; i += 1) {
    x.fillStyle = `rgba(${Math.round(196 + rand() * 44)},${Math.round(194 + rand() * 42)},${Math.round(188 + rand() * 40)},.09)`;
    x.beginPath();
    x.arc(rand() * w, rand() * h, 8 + rand() * 34, 0, 7);
    x.fill();
  }
  noise(x, w, h, 5, rand);
  return c;
}

/**
 * 天空渐变（同时作为环境反射 IBL）
 * @param {number} seed 固定 seed
 * @param {'day'|'night'} mode 白天 / 夜空（v1.11：夜晚要换一张，否则白墙会被白天的天光整体提亮）
 */
export function skyCanvas(seed = 20266, mode = 'day') {
  const rand = makeRng(seed);
  const w = 1024;
  const h = 512;
  const c = cv(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h);
  if (mode === 'night') {
    g.addColorStop(0.0, '#0b1220');
    g.addColorStop(0.42, '#141d2e');
    g.addColorStop(0.52, '#1d2637');
    g.addColorStop(1.0, '#2a2b33');
  } else {
    g.addColorStop(0.0, '#eaf2fb');
    g.addColorStop(0.42, '#f3f1ec');
    g.addColorStop(0.52, '#cfc9bf');
    g.addColorStop(1.0, '#9d968c');
  }
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const s = x.createRadialGradient(w * 0.76, h * 0.18, 8, w * 0.76, h * 0.18, h * 0.55);
  if (mode === 'night') {
    s.addColorStop(0, 'rgba(206,222,255,.55)'); // 月亮
    s.addColorStop(0.35, 'rgba(150,175,220,.14)');
    s.addColorStop(1, 'rgba(150,175,220,0)');
  } else {
    s.addColorStop(0, 'rgba(255,244,222,.95)');
    s.addColorStop(1, 'rgba(255,244,222,0)');
  }
  x.fillStyle = s;
  x.fillRect(0, 0, w, h);
  rand(); // 保持与其他画布一致的取数节奏（这个画布本身不需要随机，但别让它变成例外）
  return c;
}

/** 带图案的大地毯（照着原模型里那张红调花纹毯做的） */
export function patternCanvas(seed = 20267) {
  const rand = makeRng(seed);
  const size = 512;
  const c = cv(size, size);
  const x = c.getContext('2d');
  x.fillStyle = '#cbb99c';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      x.strokeStyle = 'rgba(150,70,50,.55)';
      x.lineWidth = 3;
      x.strokeRect(20 + i * 82, 20 + j * 82, 62, 62);
      if ((i + j) % 2 === 0) {
        x.fillStyle = 'rgba(176,92,63,.32)';
        x.fillRect(26 + i * 82, 26 + j * 82, 50, 50);
      }
    }
  }
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      x.fillStyle = 'rgba(232,222,204,.55)';
      x.beginPath();
      x.arc(61 + i * 82, 61 + j * 82, 13, 0, 7);
      x.fill();
    }
  }
  x.strokeStyle = 'rgba(120,60,44,.75)';
  x.lineWidth = 11;
  x.strokeRect(5, 5, size - 10, size - 10);
  noise(x, size, size, 10, rand);
  return c;
}

export const suiteTextures = {
  woodCanvas, stoneCanvas, slateCanvas, linenCanvas, plasterCanvas, skyCanvas, patternCanvas,
};
