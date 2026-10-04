/**
 * textures.js —— 程序化贴图与环境光照（零外部资产）
 *
 * 为什么要有这个文件：项目要「写实一点的场景」，但红线是**断网可用、不引入任何外部模型/贴图资产**。
 * 两者并不矛盾——贴图在运行时用 Canvas 画出来就行：木地板、墙面、布纹、大理石、天空，
 * 每个都是几十行确定性噪声，不落任何文件、不发任何请求。
 *
 * 三条硬要求：
 *   1. **确定性**：全部用自带的 LCG 伪随机 + 固定 seed。同一份代码每次渲染出的贴图完全一样，
 *      演示片才能逐帧复现（`?film=1` 的可复现性是这支片子敢被追问的前提）。
 *   2. **不写文字**：Canvas 上只画纹理，不画字（3D 里不渲染文字这条红线同样适用于贴图）。
 *   3. **尺寸可控**：默认 256–512，够近景用又不至于让 SwiftShader 卡死。
 *
 * 用法：
 *   const tex = textures.woodFloor({ repeat: [4, 3] });
 *   new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
 *
 * 归属：S（场景资源）。供 `room.js` / `scene3d.js` / `robot.js` / `person.js` 共用。
 */

import * as THREE from 'three';

/* ── 确定性伪随机 ─────────────────────────────────────────────────── */

/** 线性同余发生器：同一 seed 永远给出同一串随机数（`suite-textures.js` 也用同一个） */
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

/* ── 噪声 ─────────────────────────────────────────────────────────── */

/** 在 cells×cells 的格点上取随机值，双线性插值成平滑噪声 */
function noiseGrid(cells, rand) {
  const n = cells + 1;
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i += 1) g[i] = rand();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx); // smoothstep
    const sy = fy * fy * (3 - 2 * fy);
    const i00 = (y0 % cells) * n + (x0 % cells);
    const i10 = (y0 % cells) * n + ((x0 + 1) % cells);
    const i01 = ((y0 + 1) % cells) * n + (x0 % cells);
    const i11 = ((y0 + 1) % cells) * n + ((x0 + 1) % cells);
    const a = g[i00] + (g[i10] - g[i00]) * sx;
    const b = g[i01] + (g[i11] - g[i01]) * sx;
    return a + (b - a) * sy;
  };
}

/** 多倍频叠加，得到更自然的纹理 */
function fbm(cells, octaves, rand) {
  const layers = [];
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    layers.push({ f: noiseGrid(cells * (2 ** o), rand), amp });
    total += amp;
    amp *= 0.5;
  }
  return (u, v) => {
    let sum = 0;
    for (const l of layers) sum += l.f(u, v) * l.amp;
    return sum / total;
  };
}

function rgb(r, g, b) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/**
 * 按系数调亮/调暗一个 sRGB 颜色，返回**sRGB 字节**。
 * ⚠️ 不能用 THREE.Color：开启色彩管理后它会把 hex 当 sRGB 解到线性空间，
 * 直接拿 c.r*255 写进 canvas 等于把线性值当 sRGB 用 —— 结果整体偏暗、偏饱和。
 */
function shade(hex, k) {
  return [((hex >> 16) & 255) * k, ((hex >> 8) & 255) * k, (hex & 255) * k];
}

function finish(canvas, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ── 木地板：条形拼接 + 木纹 + 板缝 ───────────────────────────────── */

export function woodFloor({ size = 512, planks = 6, repeat = [3, 2.4], seed = 11, tone = 0xbe9469, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const grain = fbm(6, 4, rand);
  const rowH = size / planks;

  for (let p = 0; p < planks; p += 1) {
    const k = 0.82 + rand() * 0.34;
    const [r, g, b] = shade(tone, k);
    ctx.fillStyle = rgb(r, g, b);
    ctx.fillRect(0, p * rowH, size, rowH);

    // 木纹：沿板长的细线
    for (let i = 0; i < 90; i += 1) {
      const y = p * rowH + rand() * rowH;
      const w = 0.5 + rand() * 1.6;
      const dark = 0.72 + rand() * 0.22;
      ctx.strokeStyle = `rgba(${Math.round(r * dark)},${Math.round(g * dark)},${Math.round(b * dark)},0.5)`;
      ctx.lineWidth = w;
      ctx.beginPath();
      const x0 = rand() * size;
      const len = size * (0.25 + rand() * 0.75);
      ctx.moveTo(x0, y);
      for (let x = 0; x <= len; x += 16) {
        ctx.lineTo(x0 + x, y + Math.sin((x + i * 7) * 0.05) * (0.6 + rand() * 1.4));
      }
      ctx.stroke();
    }

    // 大尺度色斑，避免整块板一个色
    for (let x = 0; x < size; x += 4) {
      for (let y = p * rowH; y < (p + 1) * rowH; y += 4) {
        const n = grain(x / size, y / size) - 0.5;
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, n) * 0.16})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // 板缝
    ctx.fillStyle = 'rgba(40,26,16,0.42)';
    ctx.fillRect(0, p * rowH, size, 1.5);
    // 端头接缝（每条板随机一处）
    const seam = Math.floor(rand() * planks) * 0 + rand() * size;
    ctx.fillStyle = 'rgba(40,26,16,0.30)';
    ctx.fillRect(seam, p * rowH, 1.5, rowH);
  }
  return finish(canvas, { repeat, aniso });
}

/* ── 墙面：极淡的抹灰颗粒 ─────────────────────────────────────────── */

export function wallPaint({ size = 256, repeat = [3, 2], seed = 23, tone = 0xf2ece3, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const n = fbm(4, 3, rand);
  const [r, g, b] = shade(tone, 1);
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const k = 0.965 + (n(x / size, y / size) - 0.5) * 0.07;
      ctx.fillStyle = rgb(r * k, g * k, b * k);
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return finish(canvas, { repeat, aniso });
}

/* ── 布纹：沙发 / 床品 / 抱枕 ─────────────────────────────────────── */

export function fabric({ size = 256, repeat = [3, 3], seed = 31, tone = 0x9aa3ad, weave = 3, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const [r, g, b] = shade(tone, 1);
  ctx.fillStyle = rgb(r, g, b);
  ctx.fillRect(0, 0, size, size);
  // 经纬线
  for (let i = 0; i < size; i += weave) {
    const k1 = 0.9 + rand() * 0.14;
    ctx.fillStyle = `rgba(${Math.round(r * k1)},${Math.round(g * k1)},${Math.round(b * k1)},0.85)`;
    ctx.fillRect(i, 0, weave - 1, size);
    const k2 = 0.88 + rand() * 0.14;
    ctx.fillStyle = `rgba(${Math.round(r * k2)},${Math.round(g * k2)},${Math.round(b * k2)},0.6)`;
    ctx.fillRect(0, i, size, weave - 1);
  }
  // 绒毛噪点
  for (let i = 0; i < size * 12; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * 0.09;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  return finish(canvas, { repeat, aniso });
}

/* ── 地毯：圈绒 ───────────────────────────────────────────────────── */

export function rug({ size = 256, repeat = [1, 1], seed = 47, tone = 0xc6c2b7, border = true, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const cloud = fbm(4, 3, rand);
  const [r, g, b] = shade(tone, 1);

  // 底色：低频明暗（绒面被踩出来的深浅），不是密集小圆点
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const k = 0.9 + (cloud(x / size, y / size) - 0.5) * 0.26;
      const i = (y * size + x) * 4;
      img.data[i] = r * k;
      img.data[i + 1] = g * k;
      img.data[i + 2] = b * k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 织纹：45° 细斜纹（一深一浅成对，才有「织」的感觉）
  for (let i = -size; i < size * 2; i += 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(i + 2, 0); ctx.lineTo(i + 2 + size, size); ctx.stroke();
  }

  // 绒面：稀疏、极低对比
  for (let i = 0; i < size * 4; i += 1) {
    const a = rand() * 0.05;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(rand() * size, rand() * size, 1.6, 1.6);
  }

  // 包边：真实地毯都有一圈收边
  if (border) {
    const w = Math.max(4, Math.round(size * 0.035));
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = w;
    ctx.strokeRect(w / 2, w / 2, size - w, size - w);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(w + 2, w + 2, size - w * 2 - 4, size - w * 2 - 4);
  }

  return finish(canvas, { repeat, aniso });
}

/* ── 木家具：细密木纹 ─────────────────────────────────────────────── */

export function wood({ size = 256, repeat = [1, 1], seed = 59, tone = 0x9a6f47, rings = 26, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const warp = fbm(3, 3, rand);
  const [r, g, b] = shade(tone, 1);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const wobble = (warp(u, v) - 0.5) * 0.35;
      const t = Math.sin((v * rings + wobble * 6) * Math.PI * 2) * 0.5 + 0.5;
      const k = 0.84 + t * 0.24;
      ctx.fillStyle = rgb(r * k, g * k, b * k);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return finish(canvas, { repeat, aniso });
}

/* ── 台面：水磨石 / 大理石 ────────────────────────────────────────── */

export function stone({ size = 256, repeat = [2, 2], seed = 71, tone = 0xe6e3dd, veins = 16, aniso = 8 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const [r, g, b] = shade(tone, 1);
  ctx.fillStyle = rgb(r, g, b);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < veins; i += 1) {
    ctx.strokeStyle = `rgba(120,118,112,${0.06 + rand() * 0.14})`;
    ctx.lineWidth = 0.6 + rand() * 2.2;
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 26; s += 1) {
      x += (rand() - 0.5) * 34;
      y += (rand() - 0.5) * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < size * 6; i += 1) {
    const k = 0.9 + rand() * 0.14;
    ctx.fillStyle = `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},0.5)`;
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }
  return finish(canvas, { repeat, aniso });
}

/* ── 窗外天空：日落渐变 + 远景城市剪影 ────────────────────────────── */

export function cityView({ w = 512, h = 256, seed = 97 } = {}) {
  const { canvas, ctx } = makeCanvas(w, h);
  const rand = makeRng(seed);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#7fb3d9');
  sky.addColorStop(0.45, '#cfdfe9');
  sky.addColorStop(0.72, '#f2d9b6');
  sky.addColorStop(1, '#e8c79b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 云：几团很淡的横向条带
  for (let i = 0; i < 26; i += 1) {
    const y = h * (0.08 + rand() * 0.42);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(rand() * w, y, 30 + rand() * 120, 5 + rand() * 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 两排远景楼：越远越淡，制造空气透视
  for (const [baseY, tone, alpha, hMin, hMax] of [
    [h * 0.80, '#9fb0bd', 0.55, 26, 74],
    [h * 0.88, '#7b8c9b', 0.75, 34, 104],
  ]) {
    for (let x = -20; x < w + 20;) {
      const bw = 14 + rand() * 34;
      const bh = hMin + rand() * (hMax - hMin);
      ctx.fillStyle = tone;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, baseY - bh, bw, bh);
      // 窗格
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = '#f6e4c4';
      for (let wy = baseY - bh + 6; wy < baseY - 4; wy += 9) {
        for (let wx = x + 3; wx < x + bw - 3; wx += 7) {
          if (rand() > 0.55) ctx.fillRect(wx, wy, 3, 4);
        }
      }
      ctx.globalAlpha = 1;
      x += bw + 2 + rand() * 8;
    }
  }
  // 地平线雾
  const haze = ctx.createLinearGradient(0, h * 0.72, 0, h);
  haze.addColorStop(0, 'rgba(240,225,205,0)');
  haze.addColorStop(1, 'rgba(240,225,205,0.85)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ── 叶片：脉络 ───────────────────────────────────────────────────── */

export function leaf({ size = 128, seed = 113, tone = 0x4f7f4a } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = makeRng(seed);
  const [r, g, b] = shade(tone, 1);
  ctx.fillStyle = rgb(r, g, b);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.stroke();
  for (let i = 0; i < 22; i += 1) {
    const y = rand() * size;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, y);
    ctx.lineTo(rand() > 0.5 ? size : 0, y + (rand() - 0.5) * 26);
    ctx.stroke();
  }
  return finish(canvas, { repeat: [1, 1] });
}


/* ── 法线贴图：由亮度当高度做 Sobel ────────────────────────────────
 * 写实感有一大半来自「光打上去有细微凹凸」。没有法线贴图时，木地板、墙面、
 * 布纹在斜射阳光下都是平的。这里直接拿已有的程序化贴图当高度场，
 * 用中心差分求梯度再编码成切线空间法线 —— 依然零外部资产。
 */
export function normalFromTexture(map, strength = 2.0) {
  const src = map.image;
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const { canvas, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);

  const lum = (x, y) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.copy(map.repeat);
  tex.colorSpace = THREE.NoColorSpace; // 法线贴图必须是线性数据，不能当 sRGB 解
  tex.anisotropy = map.anisotropy || 4;
  tex.needsUpdate = true;
  return tex;
}

/* ── 粗糙度贴图（v1.6）：把已有贴图的亮度当粗糙度起伏 ────────────────
 * 真实材质没有一块是「均匀粗糙」的：地板的板缝更糙、漆面里的填充更亮更光。
 * three 里 `roughness = material.roughness × roughnessMap.g`——所以接了这张图，
 * 材质的 `roughness` 要设成 1，由贴图给出**绝对值**。
 * ⚠️ 与法线贴图一样是线性数据：`colorSpace` 必须是 NoColorSpace。
 */
export function roughnessFromTexture(map, { base = 0.7, amount = 0.3, invert = false } = {}) {
  const src = map.image;
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const { canvas, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const dir = invert ? -1 : 1;

  for (let i = 0; i < w * h; i += 1) {
    const j = i * 4;
    const lum = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255;
    const value = Math.min(1, Math.max(0, base + (lum - 0.5) * 2 * amount * dir));
    out.data[j] = value * 255;
    out.data[j + 1] = value * 255;
    out.data[j + 2] = value * 255;
    out.data[j + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.copy(map.repeat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = map.anisotropy || 4;
  tex.needsUpdate = true;
  return tex;
}

/* ── 窗光光柱（v1.6）：给斜射进来的阳光一点空气感 ─────────────────
 * 不是体积光，就是一张两端渐隐、四周羽化的加法混合贴片。零资产、零开销。
 */
export function lightShaft({ w = 128, h = 128 } = {}) {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      // 横向：中间亮、两边羽化；纵向：靠近窗户那端最亮，远端淡出
      // 四边都要羽化到 0：任何一条边留一点不透明度，落在地板上就是一道直溜溜的硬边
      const lateral = Math.pow(Math.sin(u * Math.PI), 1.6);
      const along = Math.pow(Math.sin(v * Math.PI), 1.1);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 244;
      img.data[i + 2] = 224;
      img.data[i + 3] = Math.round(255 * lateral * along * 0.55);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ── 接触阴影贴片：家具与地面之间那圈「脏」────────────────────────
 * 真实阴影贴图给的是投影，给不了家具正下方那圈环境光遮蔽（AO）。
 * 用一张径向渐变的透明贴片贴在物件底下，是廉价但非常有效的补法。
 */
export function contactShadow({ size = 128 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
  g.addColorStop(0.0, 'rgba(30,24,18,0.55)');
  g.addColorStop(0.45, 'rgba(30,24,18,0.28)');
  g.addColorStop(0.78, 'rgba(30,24,18,0.07)');
  g.addColorStop(1.0, 'rgba(30,24,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ── 环境贴图用的天空盒场景 ───────────────────────────────────────── */

/**
 * 给 PMREMGenerator 用的极简环境：一个内表面渐变球 + 一块「太阳」。
 * 没有它，PBR 材质的金属/粗糙度就没有参照，白墙会一片死白。
 * 注意返回的是 Scene，由 scene3d.js 交给 PMREMGenerator 处理。
 */
export function buildEnvironmentScene() {
  const scene = new THREE.Scene();
  const { canvas, ctx } = makeCanvas(64, 256);
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0.0, '#cfe2f2');
  sky.addColorStop(0.42, '#eef2f5');
  sky.addColorStop(0.55, '#f6efe4');
  sky.addColorStop(1.0, '#8d7f6d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 64, 256);
  const grad = new THREE.CanvasTexture(canvas);
  grad.colorSpace = THREE.SRGBColorSpace;
  grad.needsUpdate = true;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(12, 24, 16),
    new THREE.MeshBasicMaterial({ map: grad, side: THREE.BackSide }),
  );
  scene.add(dome);

  // 太阳：一盏很亮的圆盘，给高光一个来源
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff3dc }),
  );
  sun.position.set(-5.2, 4.6, -6.4);
  sun.lookAt(0, 0, 0);
  scene.add(sun);

  const warm = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe6c4, transparent: true, opacity: 0.35 }),
  );
  warm.position.set(-5.0, 4.4, -6.2);
  warm.lookAt(0, 0, 0);
  scene.add(warm);

  return scene;
}

export const textures = {
  woodFloor, wallPaint, fabric, rug, wood, stone, cityView, leaf,
  normalFromTexture, roughnessFromTexture, lightShaft, contactShadow, buildEnvironmentScene,
};
