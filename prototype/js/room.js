/**
 * room.js —— 户型：套房（S 线）
 *
 * 来源：`suite-3d/`（仓库 main 分支上的「套房 · 3D 场景」，参考 `套房.skp` 重建）。
 * 本文件把那一套**搬进送药机器人原型**，并按本仓库的红线做了删改：
 *   - 去掉它自己的 UI 面板 / 漫游 / 剖切 / 网格 / 房间标注精灵 —— **3D 里不渲染任何文字**；
 *   - 去掉可注入的 GLB 底座模型（不引入任何外部模型资产）；
 *   - 贴图随机数改为**固定 seed**（原版 46 处 `Math.random()`，每次刷新纹理都不同，录屏无法复现）；
 *   - **内门不画门扇**：门扇半开会挡住门洞，机器人要过去就会穿模；剖切表现下"门都开着"也更合理；
 *   - 顺手修掉原版几处确定性的小毛病（见 §文件末尾「与原版的差异」）；
 *   - 新增：坐具元数据（点哪坐哪）、导航用墙段/家具占位（机器人不穿墙）、客厅充电桩。
 *
 * 坐标约定（与原版一致）：
 *   **平面坐标** X 向东、Z 向南、原点在户型西北角，单位米；外轮廓 13.4 × 10.6，层高 2.85。
 *   **世界坐标** = 平面坐标 − (W/2, D/2)，即屋子中心落在世界原点：x ∈ [-6.7, 6.7]，z ∈ [-5.3, 5.3]。
 *   本文件里 `x/z` 参数一律是**平面坐标**，`SEAT_*` / `WAYPOINTS` / `DOCK` 一律是**世界坐标**。
 *
 * 户型（平面坐标）：
 *   北排：卧室A(0,0–4.6,4.3) | 卫A(4.6,0–7,3) | 卫B(7,0–9.3,3) | 北走廊(4.6,3–9.3,4.3) | 卧室B(9.3,0–13.4,4.3)
 *   中排：卫生间(0,4.3–2.3,6.9) | 西走廊(2.3,4.3–4.8,6.9) | 起居·餐区(4.8,4.3–13.4,10.6，L 形)
 *   南排：卧室C(0,6.9–4.8,10.6) | 书房(4.8,6.9–7.6,10.6)
 *
 * 送药闭环只用三个位置：**起居（客厅沙发）/ 卧室C / 餐区**，其余房间作为户型真实感保留。
 */

import * as THREE from 'three';
import {
  woodCanvas, stoneCanvas, slateCanvas, linenCanvas, plasterCanvas, patternCanvas,
} from './suite-textures.js';

/* ── 平面参数 ─────────────────────────────────────────────────────── */

const W = 13.4;   // 外轮廓（东西）
const D = 10.6;   // 外轮廓（南北）
const WH = 2.85;  // 层高
const EXT = 0.24; // 外墙厚
const INT = 0.15; // 内墙厚
const OX = -W / 2;
const OZ = -D / 2;

/** 平面坐标 → 世界坐标 */
const wx = (x) => x + OX;
const wz = (z) => z + OZ;

const room = (x1, z1, x2, z2) => ({
  x1, z1, x2, z2, cx: (x1 + x2) / 2, cz: (z1 + z2) / 2,
});

export const ROOMS = {
  bedA: room(0.00, 0.00, 4.60, 4.30),   // 西侧卧室（主卧）
  bathA: room(4.60, 0.00, 7.00, 3.00),  // 卫 A（淋浴）
  bathB: room(7.00, 0.00, 9.30, 3.00),  // 卫 B
  hallN: room(4.60, 3.00, 9.30, 4.30),  // 北走廊
  bedB: room(9.30, 0.00, 13.40, 4.30),  // 东北卧室
  wcC: room(0.00, 4.30, 2.30, 6.90),    // 独立卫生间
  hallW: room(2.30, 4.30, 4.80, 6.90),  // 西走廊 / 玄关
  bedC: room(0.00, 6.90, 4.80, 10.60),  // 西南卧室（＝演示里的「卧室」）
  study: room(4.80, 6.90, 7.60, 10.60), // 书房
  living: room(4.80, 4.30, 13.40, 10.60), // 起居 + 餐区（L 形）
};

/* ── 贴图包装（repeat / 各向异性由材质决定）───────────────────────── */

function tex(canvas, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8; // 地板斜看不再糊
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ── 材质库 ───────────────────────────────────────────────────────── */

let M;

function buildMaterials() {
  M = {
    wall: new THREE.MeshStandardMaterial({ map: tex(plasterCanvas(), 6, 3), color: 0xf7f2e9, roughness: 0.95, metalness: 0, envMapIntensity: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ map: tex(woodCanvas(), 1.4, 1.4), roughness: 0.58, metalness: 0, envMapIntensity: 0.5 }),
    slate: new THREE.MeshStandardMaterial({ map: tex(slateCanvas(), 2, 2), roughness: 0.42, metalness: 0.04, envMapIntensity: 0.7 }),
    stone: new THREE.MeshStandardMaterial({ map: tex(stoneCanvas(), 1, 1), roughness: 0.88, metalness: 0, envMapIntensity: 0.45 }),
    oak: new THREE.MeshStandardMaterial({ color: 0xc08d5a, roughness: 0.52, metalness: 0, envMapIntensity: 0.5 }),
    walnut: new THREE.MeshStandardMaterial({ color: 0x6f4e34, roughness: 0.45, metalness: 0, envMapIntensity: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33352f, roughness: 0.52, metalness: 0.06, envMapIntensity: 0.5 }),
    sofa: new THREE.MeshStandardMaterial({ map: tex(linenCanvas(178, 172, 162, 20264), 2, 2), color: 0xefe6d8, roughness: 0.97, metalness: 0, envMapIntensity: 0.4 }),
    bed: new THREE.MeshStandardMaterial({ map: tex(linenCanvas(242, 240, 235, 20268), 2, 2), color: 0xfaf6ee, roughness: 0.92, metalness: 0, envMapIntensity: 0.4 }),
    rug: new THREE.MeshStandardMaterial({ map: tex(stoneCanvas(), 1, 1), color: 0xd9c6a7, roughness: 0.97, metalness: 0, envMapIntensity: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.38, metalness: 0.72, envMapIntensity: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd7d9da, roughness: 0.22, metalness: 0.9, envMapIntensity: 1.1 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.18, metalness: 0.02, envMapIntensity: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.06, metalness: 0.02, transparent: true, opacity: 0.22, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    leafA: new THREE.MeshStandardMaterial({ color: 0x51704a, roughness: 0.85, metalness: 0 }),
    leafB: new THREE.MeshStandardMaterial({ color: 0x6b8a5c, roughness: 0.85, metalness: 0 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.9 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfdf3e0, roughness: 0.5, emissive: 0xffd9a0, emissiveIntensity: 0.38 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.34, metalness: 0.88, envMapIntensity: 1.0 }),
    terra: new THREE.MeshStandardMaterial({ color: 0xb2603f, roughness: 0.9, metalness: 0 }),
    mustard: new THREE.MeshStandardMaterial({ color: 0xc99a3f, roughness: 0.92, metalness: 0 }),
    sage: new THREE.MeshStandardMaterial({ color: 0x8d9b83, roughness: 0.93, metalness: 0 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xefe7d9, roughness: 0.95, metalness: 0 }),
    wood2: new THREE.MeshStandardMaterial({ color: 0x9a6c46, roughness: 0.5, metalness: 0 }),
    art: new THREE.MeshStandardMaterial({ color: 0xdcd2c2, roughness: 0.86, metalness: 0 }),
    blanket: new THREE.MeshStandardMaterial({ color: 0xc3aa8d, roughness: 0.98, metalness: 0 }),
    pattern: new THREE.MeshStandardMaterial({ map: tex(patternCanvas(), 1, 1), roughness: 0.97, metalness: 0, envMapIntensity: 0.28 }),
    skirt: new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 0.7 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xcfcac3, roughness: 0.9 }),
    // 充电桩
    charge: new THREE.MeshStandardMaterial({ color: 0x9ff2c9, emissive: 0x2fe08a, emissiveIntensity: 1.2, roughness: 0.38 }),
    warn: new THREE.MeshStandardMaterial({ color: 0xffcf8a, emissive: 0xffa63c, emissiveIntensity: 1.0, roughness: 0.42 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xd8a13c, roughness: 0.82, metalness: 0.02 }),
    matBoot: new THREE.MeshStandardMaterial({ color: 0x565f63, roughness: 0.92 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.22, metalness: 0.3, emissive: 0x0b1016, emissiveIntensity: 0.6 }),
  };
}

/* ── 几何工具 ─────────────────────────────────────────────────────── */

const GEO = new Map();
function boxGeo(w, h, d) {
  const k = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let g = GEO.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    GEO.set(k, g);
  }
  return g;
}

/** 当前正在构建的组（buildRoom 里设一次） */
let SHELL = null;
let FURN = null;

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || FURN).add(m);
  return m;
}

/** 圆角感的软体（两段盒子 + 收边）——原版做法，保留 */
function softBox(w, h, d, mat, x, y, z, parent, r = 0.06) {
  const g = new THREE.Group();
  box(w, h - r, d, mat, 0, -(r / 2), 0, g);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w - r * 2, r, d - r * 2), mat);
  top.position.y = (h - r) / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  g.position.set(x, y, z);
  (parent || FURN).add(g);
  return g;
}

/* ── 坐具元数据（点哪坐哪；全部是**世界坐标**）────────────────────── */

/**
 * 挂在可坐表面的 mesh 上。射线打中它时 scene3d 会把落点吸附到"这个人真的坐得下"的位置。
 * 字段 `{ surfaceY, facing, kind, lockX?, lockZ?, clampX?, clampZ? }` 全是纯数据
 * （`presence.seat` 会被 `structuredClone`，放函数会抛）。
 */
function markSeatDeep(group, spec) {
  group.traverse((n) => {
    if (n.isMesh) n.userData.seat = spec;
  });
  return group;
}

/** 客厅沙发：座垫顶 0.50，人坐坐垫前部，朝向 +x（面向茶几与电视墙） */
const SEAT_SOFA = { surfaceY: 0.50, facing: Math.PI / 2, kind: 'sofa', lockX: 2.40, clampZ: [2.55, 4.55] };
/** 餐椅：座面顶 0.47，坐正中 */
const seatChair = (x, z, facing) => ({ surfaceY: 0.47, facing, kind: 'chair', lockX: x, lockZ: z });
/** 扶手椅：座垫顶 0.47 */
const seatArmchair = (x, z, facing) => ({ surfaceY: 0.47, facing, kind: 'chair', lockX: x, lockZ: z });
/** 床尾长凳：座面顶 0.48，朝向＝长边法向 */
const seatBench = (x, z, facing) => ({ surfaceY: 0.48, facing, kind: 'bench', lockX: x, lockZ: z });
/** 床沿坐：床面 0.56，坐床沿、脚落地 */
const seatBedEdge = (lockX, facing, clampZ) => ({ surfaceY: 0.56, facing, kind: 'bed', lockX, clampZ });

/* ── 楼板 / 地面 ──────────────────────────────────────────────────── */

function floorPlate(r, mat) {
  const g = box(r.x2 - r.x1, 0.10, r.z2 - r.z1, mat, wx(r.cx), -0.05, wz(r.cz), SHELL);
  g.castShadow = false;
  return g;
}

/* ── 墙体：中心线 + 洞口（a/b 沿墙起点的距离，sill/head 洞口上下沿）──
 * 同时收集「导航墙段」：只有**门 / 敞口**（下沿 ≤0.35 m）可通行，
 * 窗（下沿 0.45 m 以上）不可通行 —— 机器人不会从窗户爬出去。
 */
const NAV_WALLS = [];

/** 导航规格缓存：`buildRoom()` 算一次，2D 降级直接用同一份（保证两条通道不漂移） */
let NAV_SPEC = null;

function wall(x1, z1, x2, z2, t, holes, opt = {}) {
  const horiz = Math.abs(z2 - z1) < 1e-6;
  const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  const sx = horiz ? Math.sign(x2 - x1) || 1 : 0;
  const sz = horiz ? 0 : Math.sign(z2 - z1) || 1;
  const pieces = [];
  const hs = (holes || []).slice().sort((a, b) => a.a - b.a);
  let cur = 0;
  hs.forEach((h) => {
    if (h.a > cur) pieces.push([cur, h.a, 0, WH]);
    cur = Math.max(cur, h.b);
  });
  if (cur < len) pieces.push([cur, len, 0, WH]);
  hs.forEach((h) => {
    const sill = h.sill || 0;
    const head = h.head === undefined ? 2.1 : h.head;
    if (sill > 0) pieces.push([h.a, h.b, 0, sill]);
    if (head < WH) pieces.push([h.a, h.b, head, WH]);
  });

  const wallG = opt.parent;
  pieces.forEach((p) => {
    const l = p[1] - p[0];
    const h = p[3] - p[2];
    if (l <= 0.001 || h <= 0.001) return;
    const mid = (p[0] + p[1]) / 2;
    const m = new THREE.Mesh(boxGeo(horiz ? l : t, h, horiz ? t : l), opt.mat || M.wall);
    m.position.set(horiz ? wx(x1 + sx * mid) : wx(x1), p[2] + h / 2, horiz ? wz(z1) : wz(z1 + sz * mid));
    m.castShadow = true;
    m.receiveShadow = true;
    wallG.add(m);
  });

  // 外墙的门不算通行口（入户门关着，机器人不出门）
  const pass = opt.outer ? [] : hs.filter((h) => (h.sill || 0) <= 0.35).map((h) => [h.a, h.b]);
  NAV_WALLS.push({ x1: wx(x1), z1: wz(z1), x2: wx(x2), z2: wz(z2), t, pass });

  return { horiz, sx, sz, len };
}

/* ── 家具与洁具 ───────────────────────────────────────────────────── */

function rug(x, z, w, d, y, parent, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, d), mat || M.rug);
  m.position.set(wx(x), (y || 0.012) + 0.011, wz(z));
  m.receiveShadow = true;
  m.castShadow = false;
  (parent || FURN).add(m);
  return m;
}

/** 床：床架 + 床垫 + 被子 + 枕头 + 床头板；rot = 0 床头朝西(−X) */
function bed(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  const L = 2.10;
  const Wd = 1.80;
  const base = 0.30;
  box(Wd, base, L, M.oak, 0, base / 2, 0, g);
  softBox(Wd - 0.06, 0.26, L - 0.06, M.bed, 0, base + 0.13, 0, g, 0.07);
  box(Wd - 0.06, 0.10, L * 0.58, M.bed, 0, base + 0.30, L * 0.16, g);
  const p1 = softBox(0.62, 0.17, 0.38, M.bed, -0.42, base + 0.34, -L / 2 + 0.30, g, 0.06);
  const p2 = softBox(0.62, 0.17, 0.38, M.bed, 0.42, base + 0.34, -L / 2 + 0.30, g, 0.06);
  p1.rotation.x = -0.12;
  p2.rotation.x = -0.12;
  box(0.09, 1.05, Wd + 0.12, M.walnut, -L / 2 + 0.02, 0.52, 0, g);
  const thr = box(Wd + 0.02, 0.07, 0.58, M.blanket, 0, base + 0.345, L / 2 - 0.44, g);
  thr.rotation.x = 0.015;
  const dc = softBox(0.42, 0.13, 0.42, M.mustard, -0.33, base + 0.40, L / 2 - 0.82, g, 0.04);
  dc.rotation.z = 0.10;
  const dc2 = softBox(0.36, 0.12, 0.36, M.terra, 0.34, base + 0.39, L / 2 - 0.98, g, 0.04);
  dc2.rotation.z = -0.12;
  return g;
}

function nightstand(x, z) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  FURN.add(g);
  box(0.46, 0.46, 0.40, M.walnut, 0, 0.23, 0, g);
  box(0.40, 0.015, 0.34, M.dark, 0, 0.472, 0, g);
  box(0.06, 0.16, 0.06, M.metal, 0, 0.55, 0, g);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.17, 18, 1, true), M.lamp);
  shade.position.set(0, 0.70, 0);
  shade.castShadow = true;
  g.add(shade);
  return g;
}

function wardrobe(x, z, w, d, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(w, 2.35, d, M.walnut, 0, 1.175, 0, g);
  const n = Math.max(2, Math.round(w / 0.55));
  for (let i = 0; i < n; i += 1) {
    const dx = -w / 2 + (w * (i + 0.5)) / n;
    const p = box(w / n - 0.02, 2.24, 0.02, M.oak, dx, 1.175, d / 2 + 0.012, g);
    p.castShadow = false;
    const h = box(0.02, 0.30, 0.02, M.chrome, dx + w / n / 2 - 0.06, 1.22, d / 2 + 0.03, g);
    h.castShadow = false;
  }
  return g;
}

function sofa(x, z, rot, len) {
  const L = len || 2.20;
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  const d = 0.92;
  box(L, 0.34, d, M.sofa, 0, 0.17, 0, g);
  box(L, 0.62, 0.22, M.sofa, 0, 0.48, -d / 2 + 0.11, g);
  box(0.22, 0.56, d, M.sofa, -L / 2 + 0.11, 0.45, 0, g);
  box(0.22, 0.56, d, M.sofa, L / 2 - 0.11, 0.45, 0, g);
  const n = Math.round(L / 0.75);
  for (let i = 0; i < n; i += 1) {
    const cx = -L / 2 + (L * (i + 0.5)) / n;
    softBox(L / n - 0.06, 0.16, d - 0.26, M.sofa, cx, 0.42, 0.06, g, 0.05);
    const bc = softBox(L / n - 0.10, 0.40, 0.18, M.sofa, cx, 0.68, -d / 2 + 0.18, g, 0.05);
    bc.rotation.x = -0.10;
  }
  [[-L / 2 + 0.42, 0x8d7f6b], [L / 2 - 0.42, 0x6f7a6a]].forEach((p) => {
    const mat = new THREE.MeshStandardMaterial({ color: p[1], roughness: 0.95 });
    const pil = softBox(0.42, 0.42, 0.14, mat, p[0], 0.58, -0.14, g, 0.05);
    pil.rotation.z = 0.12;
    pil.rotation.x = -0.28;
  });
  return g;
}

function armchair(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  const w = 0.78;
  const d = 0.80;
  box(w, 0.34, d, M.sofa, 0, 0.17, 0, g);
  box(w, 0.52, 0.18, M.sofa, 0, 0.50, -d / 2 + 0.09, g);
  box(0.14, 0.46, d, M.sofa, -w / 2 + 0.07, 0.42, 0, g);
  box(0.14, 0.46, d, M.sofa, w / 2 - 0.07, 0.42, 0, g);
  softBox(w - 0.18, 0.14, d - 0.24, M.sofa, 0, 0.40, 0.04, g, 0.05);
  markSeatDeep(g, seatArmchair(wx(x), wz(z), rot || 0));
  return g;
}

function coffeeTable(x, z) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  FURN.add(g);
  box(1.15, 0.06, 0.62, M.walnut, 0, 0.40, 0, g);
  box(1.02, 0.04, 0.50, M.dark, 0, 0.12, 0, g);
  [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]].forEach((p) => box(0.05, 0.40, 0.05, M.metal, p[0], 0.20, p[1], g));
  box(0.22, 0.035, 0.16, M.paper, -0.22, 0.445, 0, g);
  box(0.14, 0.10, 0.14, new THREE.MeshStandardMaterial({ color: 0x7d3f3a, roughness: 0.6 }), 0.18, 0.47, 0.04, g);
  return g;
}

/**
 * 电视墙。**原版的朝向与自身柜体不一致**：柜体长边在局部 X，电视屏却是 1.62 宽在局部 Z
 * （两者差 90°），于是柜子横着穿出东墙、屏幕朝北。这里统一成"局部 +z = 电视朝向"：
 * 柜体 1.90 沿局部 x、电视 1.62 沿局部 x、屏面法线在局部 z。这样 `rot = −π/2` 就等于
 * "贴东墙、面朝西（室内）"。
 */
function tvWall(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(1.90, 0.42, 0.42, M.walnut, 0, 0.21, 0, g);      // 电视柜（长边沿墙）
  box(1.50, 0.06, 0.06, M.metal, 0, 0.44, 0, g);       // 柜面压条
  box(1.62, 0.92, 0.035, M.dark, 0, 1.32, 0.12, g);    // 电视（薄板，法线朝房间）
  box(1.56, 0.86, 0.020, M.screen, 0, 1.32, 0.138, g); // 屏
  box(0.16, 0.30, 0.16, new THREE.MeshStandardMaterial({ color: 0x9a8f7e, roughness: 0.8 }), -0.72, 0.57, 0, g);
  return g;
}

/** 边柜（原版叫 console；改个不起冲突的名字） */
function sideboard(w, x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(w, 0.12, 0.42, M.walnut, 0, 0.52, 0, g);
  [[-w / 2 + 0.08, 0], [w / 2 - 0.08, 0]].forEach((p) => box(0.06, 0.52, 0.36, M.metal, p[0], 0.26, p[1], g));
  box(0.26, 0.03, 0.20, M.paper, -0.3, 0.60, 0, g);
  return g;
}

function diningSet(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  const w = 1.70;
  const d = 0.95;
  box(w, 0.055, d, M.oak, 0, 0.74, 0, g);
  [[-w / 2 + 0.12, -d / 2 + 0.12], [w / 2 - 0.12, -d / 2 + 0.12], [-w / 2 + 0.12, d / 2 - 0.12], [w / 2 - 0.12, d / 2 - 0.12]]
    .forEach((p) => box(0.07, 0.72, 0.07, M.walnut, p[0], 0.36, p[1], g));
  const chair = (cx, cz, r) => {
    const c = new THREE.Group();
    c.position.set(cx, 0, cz);
    c.rotation.y = r;
    g.add(c);
    box(0.46, 0.06, 0.46, M.sofa, 0, 0.44, 0, c);
    box(0.46, 0.52, 0.07, M.sofa, 0, 0.70, -0.20, c);
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach((p) => box(0.045, 0.44, 0.045, M.walnut, p[0], 0.22, p[1], c));
    // 世界落点：把椅子局部坐标按桌子旋转/位置换算过去（点椅子就坐正中间）
    const cw = Math.cos(rot || 0);
    const sw = Math.sin(rot || 0);
    markSeatDeep(c, seatChair(wx(x) + (cx * cw + cz * sw), wz(z) + (-cx * sw + cz * cw), (rot || 0) + r));
    return c;
  };
  chair(-0.45, -d / 2 - 0.32, 0);
  chair(0.45, -d / 2 - 0.32, 0);
  chair(-0.45, d / 2 + 0.32, Math.PI);
  chair(0.45, d / 2 + 0.32, Math.PI);
  [-0.42, 0.42].forEach((dx) => {
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.018, 22), M.ceramic);
    pl.position.set(dx, 0.78, -0.22);
    pl.castShadow = true;
    g.add(pl);
    const pl2 = pl.clone();
    pl2.position.z = 0.22;
    g.add(pl2);
  });
  return g;
}

function desk(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(1.55, 0.05, 0.70, M.oak, 0, 0.74, 0, g);
  box(0.05, 0.72, 0.66, M.metal, -0.72, 0.36, 0, g);
  box(0.05, 0.72, 0.66, M.metal, 0.72, 0.36, 0, g);
  box(0.30, 0.02, 0.22, M.metal, -0.30, 0.77, 0.02, g);
  const scr = box(0.30, 0.20, 0.015, M.dark, -0.30, 0.87, -0.08, g);
  scr.rotation.x = -0.26;
  box(0.22, 0.16, 0.06, M.paper, 0.38, 0.82, 0.02, g);
  const ch = new THREE.Group();
  ch.position.set(0, 0, 0.78);
  ch.rotation.y = Math.PI;
  g.add(ch);
  box(0.46, 0.07, 0.46, M.sofa, 0, 0.45, 0, ch);
  box(0.44, 0.48, 0.06, M.sofa, 0, 0.70, -0.19, ch);
  box(0.06, 0.45, 0.06, M.metal, 0, 0.22, 0, ch);
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.04, 18), M.metal);
  st.position.set(0, 0.03, 0);
  st.castShadow = true;
  ch.add(st);
  // 书桌椅：座面顶 0.485
  markSeatDeep(ch, { surfaceY: 0.485, facing: (rot || 0) + Math.PI, kind: 'chair', lockX: wx(x), lockZ: wz(z + 0.78) });
  return g;
}

function shelf(x, z, rot, w) {
  const wd = w || 1.4;
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(wd, 1.90, 0.30, M.walnut, 0, 0.95, 0, g);
  box(wd - 0.10, 1.78, 0.26, M.oak, 0, 0.96, 0.02, g);
  for (let i = 0; i < 4; i += 1) {
    box(wd - 0.16, 0.025, 0.28, M.walnut, 0, 0.30 + i * 0.40, 0.01, g);
    for (let b = 0; b < 6; b += 1) {
      const h = 0.20 + ((b * 7 + i * 3) % 10) * 0.008; // 原版是 Math.random，这里改成确定性的
      box(0.05, h, 0.18, new THREE.MeshStandardMaterial({
        color: [0x8c6a4c, 0x5d6b63, 0x8a4a3f, 0xa98f66, 0x40484f, 0x6b7a86][b % 6], roughness: 0.85,
      }), -(wd - 0.3) / 2 + (b * (wd - 0.3)) / 5, 0.31 + i * 0.40 + h / 2, -0.02, g);
    }
  }
  return g;
}

/** 盆栽：**注意坐标是世界坐标**（原版这里漏加 OX/OZ，8 盆全飘到屋外，本版已修） */
function plant(x, z, y, parent, s) {
  const sc = s || 1;
  const g = new THREE.Group();
  g.position.set(x, y || 0, z);
  g.scale.setScalar(sc);
  (parent || FURN).add(g);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 20), M.ceramic);
  pot.position.y = 0.13;
  pot.castShadow = true;
  pot.receiveShadow = true;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.02, 20), M.soil);
  soil.position.y = 0.26;
  g.add(soil);
  for (let i = 0; i < 16; i += 1) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.10 + ((i * 13) % 7) * 0.01, 10, 8), i % 2 ? M.leafA : M.leafB);
    const a = i * 2.399;
    const r = 0.05 + ((i * 17) % 5) * 0.034;
    leaf.position.set(Math.cos(a) * r, 0.34 + ((i * 11) % 9) * 0.064, Math.sin(a) * r);
    leaf.scale.set(1, 0.62, 1.35);
    leaf.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    leaf.castShadow = true;
    g.add(leaf);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.55, 8), M.walnut);
  stem.position.y = 0.5;
  g.add(stem);
  return g;
}

function bench(x, z, rot, len) {
  const L = len || 1.30;
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  softBox(0.42, 0.12, L, M.sofa, 0, 0.42, 0, g, 0.04);
  [[-0.13, -L / 2 + 0.1], [0.13, -L / 2 + 0.1], [-0.13, L / 2 - 0.1], [0.13, L / 2 - 0.1]]
    .forEach((p) => box(0.05, 0.38, 0.05, M.walnut, p[0], 0.19, p[1], g));
  markSeatDeep(g, seatBench(wx(x), wz(z), (rot || 0) + Math.PI / 2));
  return g;
}

function floorLamp(x, z) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  FURN.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 18), M.metal);
  base.position.y = 0.015;
  base.castShadow = true;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 10), M.metal);
  pole.position.y = 0.73;
  pole.castShadow = true;
  g.add(pole);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.24, 22, 1, true), M.lamp);
  shade.position.y = 1.5;
  shade.castShadow = true;
  g.add(shade);
  return g;
}

function toilet(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.16, 0.40, 22), M.ceramic);
  bowl.scale.z = 1.35;
  bowl.position.set(0, 0.20, 0.04);
  bowl.castShadow = true;
  g.add(bowl);
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 22), M.ceramic);
  seat.scale.z = 1.32;
  seat.position.set(0, 0.42, 0.04);
  seat.castShadow = true;
  g.add(seat);
  box(0.44, 0.52, 0.19, M.ceramic, 0, 0.42, -0.32, g);
  return g;
}

/** 台盆（原版签名 `(w,x,z,rot)`，其中 wcC 那次参数错位，本版已修） */
function basin(w, x, z, rot) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(w, 0.12, 0.50, M.walnut, 0, 0.82, 0, g);
  box(w - 0.10, 0.70, 0.44, M.walnut, 0, 0.41, -0.02, g);
  const n = Math.max(1, Math.round(w / 0.95));
  for (let i = 0; i < n; i += 1) {
    const dx = -w / 2 + (w * (i + 0.5)) / n;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.13, 22), M.ceramic);
    b.position.set(dx, 0.94, 0.02);
    b.castShadow = true;
    g.add(b);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 10), M.chrome);
    tap.position.set(dx, 1.01, -0.16);
    g.add(tap);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 10), M.chrome);
    sp.rotation.x = Math.PI / 2;
    sp.position.set(dx, 1.12, -0.10);
    g.add(sp);
  }
  const mirror = box(w - 0.18, 0.95, 0.02, new THREE.MeshStandardMaterial({ color: 0xd6dde0, roughness: 0.05, metalness: 0.55, envMapIntensity: 1.3 }), 0, 1.62, -0.26, g);
  mirror.castShadow = false;
  return g;
}

function shower(x, z, w, d) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  FURN.add(g);
  box(w, 0.06, d, M.slate, 0, 0.03, 0, g);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.0), M.glass);
  gl.position.set(0, 1.05, d / 2);
  g.add(gl);
  const gl2 = new THREE.Mesh(new THREE.PlaneGeometry(d, 2.0), M.glass);
  gl2.rotation.y = Math.PI / 2;
  gl2.position.set(-w / 2, 1.05, 0);
  g.add(gl2);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8), M.chrome);
  sh.position.set(w / 2 - 0.16, 1.55, -d / 2 + 0.16);
  sh.rotation.z = 0.5;
  g.add(sh);
  return g;
}

function wallArt(x, z, rot, w, h) {
  const wd = w || 0.9;
  const ht = h || 0.62;
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  g.rotation.y = rot || 0;
  FURN.add(g);
  box(wd + 0.07, ht + 0.07, 0.035, M.wood2, 0, 1.52, 0, g);
  box(wd, ht, 0.022, M.art, 0, 1.52, 0.014, g);
  box(wd * 0.42, ht * 0.30, 0.012, M.terra, -wd * 0.22, 1.42, 0.026, g);
  box(wd * 0.22, ht * 0.46, 0.012, M.sage, wd * 0.26, 1.58, 0.026, g);
  box(wd * 0.30, ht * 0.16, 0.012, M.mustard, wd * 0.06, 1.70, 0.026, g);
  return g;
}

function curtain(x, z, rot, w, y0, h) {
  const ht = h || 2.32;
  const geo = new THREE.PlaneGeometry(w, ht, 34, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) pos.setZ(i, Math.sin(pos.getX(i) * 6.2) * 0.038);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe7e0d3, roughness: 0.96, side: THREE.DoubleSide }));
  m.position.set(wx(x), (y0 === undefined ? 0.34 : y0) + ht / 2, wz(z));
  m.rotation.y = rot || 0;
  m.castShadow = true;
  m.receiveShadow = true;
  FURN.add(m);
  return m;
}

function pendant(x, z, y, parent) {
  const g = new THREE.Group();
  g.position.set(wx(x), 0, wz(z));
  (parent || FURN).add(g);
  const top = y || 2.4;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, top - 2.05, 8), M.metal);
  rod.position.y = 2.05 + (top - 2.05) / 2;
  g.add(rod);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.16, 22, 1, true), M.lamp);
  shade.position.y = top - 0.08;
  shade.castShadow = true;
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff0d4, emissive: 0xffcf8a, emissiveIntensity: 0.9, roughness: 1 }));
  bulb.position.y = top - 0.16;
  g.add(bulb);
  return g;
}

/* ── 充电桩（客厅东北角）────────────────────────────────────────────
 * 契约 §3.1：机器人空闲时的家。回桩时车尾对桩、正面朝南（房间内侧）。
 * 位置：平面 (12.55, 5.10) → 世界 (5.85, −0.20)，紧挨起居北墙内侧，不挡沙发/餐桌。
 */
export const DOCK = { x: wx(12.42), y: 0, z: wz(6.75) };
/**
 * 回桩后机器人朝向：0 = +z（南）——正面朝起居室、车尾对着桩。
 * 桩位在**客厅电视柜北侧、同一条东墙线**上：世界 (5.72, 1.45)。
 * 从起居室看：机器人停在电视柜旁边靠墙待命，桩柱在它身后（北侧）。
 */
export const DOCK_FACING = 0;

function buildDock(parent) {
  const d = new THREE.Group();
  d.position.set(DOCK.x, 0, DOCK.z);
  d.rotation.y = Math.PI; // 桩身整体转到机器人的 +z 侧
  d.userData.noNav = true; // 桩位不算家具占位，否则机器人连自己的家都进不去
  parent.add(d);

  box(0.72, 0.014, 0.66, M.matBoot, 0, 0.008, 0.02, d);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(0.09, 0.006, 0.02, M.hazard, sx * 0.30, 0.017, sz * 0.28, d);
  }
  box(0.62, 0.035, 0.52, M.matBoot, 0, 0.030, 0, d);
  for (const sx of [-1, 1]) box(0.30, 0.010, 0.045, M.chrome, sx * 0.09, 0.052, -0.17, d);
  box(0.62, 0.012, 0.03, M.brass, 0, 0.048, -0.255, d);

  // 桩柱 0.62 m 高：机器人是 0.71 m 的蛋形机身，桩比它矮一点，
  // 站在它身后刚好露出一截（屏幕/指示灯看得见），也不至于像根柱子。
  const colZ = 0.36;
  const shell = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.42, metalness: 0.05 });
  box(0.24, 0.62, 0.11, shell, 0, 0.37, colZ, d);
  box(0.20, 0.11, 0.02, M.dark, 0, 0.55, colZ - 0.058, d);
  const chargeBar = box(0.17, 0.016, 0.014, M.charge, 0, 0.49, colZ - 0.060, d);
  box(0.17, 0.016, 0.012, M.warn, 0, 0.44, colZ - 0.060, d);
  // 铜排触点对齐机器人尾部的触点高度（y ≈ 0.15）
  for (const sx of [-1, 1]) box(0.028, 0.075, 0.012, M.chrome, sx * 0.055, 0.15, colZ - 0.062, d);
  box(0.27, 0.035, 0.14, shell, 0, 0.70, colZ, d);
  box(0.017, 0.09, 0.017, M.metal, 0.10, 0.62, colZ - 0.05, d);
  const cable = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 18, Math.PI * 1.3), M.dark);
  cable.position.set(0.085, 0.55, colZ - 0.03);
  cable.rotation.y = Math.PI / 2;
  d.add(cable);
  const stub = box(0.014, 0.10, 0.014, M.dark, -0.075, 0.05, colZ + 0.04, d);
  stub.rotation.x = 0.22;
  return { chargeBar, leds: [chargeBar] };
}

/* ── 布置家具（平面坐标，与原套房一致）────────────────────────────── */

function placeFurniture() {
  // 卧室 A（西北，床头靠西墙）
  rug(2.30, 2.05, 3.00, 2.70);
  bed(1.55, 2.05, 0);
  bench(2.95, 2.05, 0, 1.35);
  nightstand(0.40, 1.05);
  nightstand(0.40, 3.05);
  wardrobe(4.20, 1.55, 1.70, 0.58, -Math.PI / 2);
  sideboard(1.30, 2.30, 0.42, 0);
  plant(wx(4.20), wz(0.55), 0, FURN, 0.9);

  // 卫 A / 卫 B（台盆贴北墙，镜子朝里）
  shower(5.55, 1.90, 1.60, 1.20);
  basin(1.30, 6.30, 0.42, 0);
  toilet(6.63, 2.35, Math.PI);
  shower(8.55, 1.05, 1.30, 1.15);
  basin(1.20, 8.70, 0.42, 0);
  toilet(8.05, 2.40, Math.PI);

  // 卧室 B（东北，床头靠东墙）
  rug(11.10, 2.05, 2.85, 2.65);
  bed(11.85, 2.05, Math.PI);
  bench(10.45, 2.05, 0, 1.35);
  nightstand(13.00, 1.05);
  nightstand(13.00, 3.05);
  wardrobe(11.70, 3.95, 1.60, 0.58, Math.PI);
  sideboard(1.30, 11.10, 0.42, 0);
  plant(wx(9.70), wz(0.55), 0, FURN, 0.85);

  // 独立卫生间（台盆贴南墙）
  toilet(1.05, 5.35, 0);
  basin(1.15, 1.15, 6.55, Math.PI);
  plant(wx(0.35), wz(6.55), 0, FURN, 0.6);

  // 卧室 C（西南，床头靠西墙）—— 演示里的「卧室」
  rug(2.35, 8.85, 2.95, 2.70);
  bed(1.60, 8.85, 0);
  bench(3.00, 8.85, 0, 1.35);
  nightstand(0.40, 7.85);
  nightstand(0.40, 9.85);
  // 这个衣柜原来在 (3.95, 7.25)：正好堵在「西走廊 → 卧室C」的门洞（plan x 3.40~4.30）后面，
  // 卧室C 因此进不去。挪到东墙侧（不压门洞）。
  wardrobe(4.45, 9.20, 1.40, 0.58, -Math.PI / 2);
  plant(wx(4.35), wz(10.15), 0, FURN, 0.8);

  // 书房
  rug(6.20, 9.05, 2.10, 1.80);
  desk(6.20, 8.95, 0);
  shelf(6.20, 7.25, 0, 1.45);
  plant(wx(5.20), wz(7.35), 0, FURN, 0.7);

  // 起居 + 餐区（东侧 L 形）—— 演示里的「客厅」与「餐区」
  rug(10.30, 8.85, 4.30, 3.40, 0.012, null, M.pattern);
  rug(6.60, 5.30, 2.60, 1.90);
  const livingSofa = sofa(8.95, 8.85, Math.PI / 2, 2.30);
  markSeatDeep(livingSofa, SEAT_SOFA);
  armchair(11.30, 7.45, Math.PI * 1.72);
  armchair(11.30, 10.25, Math.PI * 1.28);
  coffeeTable(10.35, 8.85);
  tvWall(13.05, 8.40, -Math.PI / 2); // 贴东墙、面朝西（室内）
  diningSet(7.10, 5.35, 0);
  // 这个边柜原来在 (10.25, 4.35)：正压在「起居 → 卧室B」的门洞（10.60~11.50）上，
  // 把户型仅有的第二个出口堵死。西移 1 m 让开门洞。
  sideboard(2.00, 9.20, 4.35, 0);
  floorLamp(9.05, 10.15);
  floorLamp(11.05, 6.30);
  plant(wx(12.70), wz(10.15), 0, FURN, 1.05);
  // 这盆原来在 (12.75, 6.95)：正好占住『电视旁边』要给充电桩的位置，挪到北墙门洞东侧
  plant(wx(11.55), wz(4.75), 0, FURN, 0.95);
  // 这盆原来在 (5.30, 4.65)：正好堵在『起居 ←→ 北走廊』的敞口上（配一把餐椅把 1.7 m 的口挤到 0.3 m），
  // 机器人过不去 → A* 无解 → 退回直线就会穿墙。挪到北墙边柜东侧，让这条主通道保持通畅。
  plant(wx(9.25), wz(4.70), 0, FURN, 0.85);
  sideboard(0.90, 8.10, 4.42, 0);

  // 窗帘
  curtain(0.92, 0.32, 0, 1.05);
  curtain(3.38, 0.32, 0, 1.05);
  curtain(10.12, 0.32, 0, 1.05);
  curtain(12.68, 0.32, 0, 1.05);
  curtain(0.92, D - 0.32, Math.PI, 1.05);
  curtain(3.68, D - 0.32, Math.PI, 1.05);
  curtain(8.50, D - 0.32, Math.PI, 1.30);
  curtain(12.78, D - 0.32, Math.PI, 1.30);
  curtain(W - 0.32, 7.52, Math.PI / 2, 1.30);
  curtain(W - 0.32, 9.98, Math.PI / 2, 1.30);

  // 挂画
  wallArt(0.26, 2.05, Math.PI / 2, 1.00, 0.68);
  wallArt(0.26, 8.85, Math.PI / 2, 1.00, 0.68);
  wallArt(13.14, 2.05, -Math.PI / 2, 1.00, 0.68);
  wallArt(6.20, 10.44, Math.PI, 0.80, 0.58);
  wallArt(11.40, 4.46, 0, 1.10, 0.72);
  wallArt(13.16, 8.40, -Math.PI / 2, 0.90, 0.62);

  // 三张床：床沿可坐（被褥把床面垫高了，坐床面会把脚踩进床里）
  markBedSeats();
}

/** 三张床的床沿坐位：床头在哪侧，人就从对面床沿坐下、脚落在地上 */
function markBedSeats() {
  const specs = [
    { x: 1.55, z: 2.05, head: -1 },   // 卧室 A：床头朝西
    { x: 11.85, z: 2.05, head: 1 },   // 卧室 B：床头朝东
    { x: 1.60, z: 8.85, head: -1 },   // 卧室 C：床头朝西
  ];
  for (const s of specs) {
    const lockX = wx(s.x) - s.head * (0.9 - 0.23);
    const facing = s.head < 0 ? Math.PI / 2 : -Math.PI / 2;
    const spec = seatBedEdge(lockX, facing, [wz(s.z - 0.95), wz(s.z + 0.95)]);
    const g = findBedGroup(wx(s.x), wz(s.z));
    if (g) markSeatDeep(g, spec);
  }
}

/** 按世界位置找那张床的组（床组的 position 就是床心） */
function findBedGroup(x, z) {
  let found = null;
  FURN.traverse((n) => {
    if (found || n.type !== 'Group' || n.children.length < 6) return;
    if (Math.abs(n.position.x - x) < 0.02 && Math.abs(n.position.z - z) < 0.02) found = n;
  });
  return found;
}

/* ── 路径点 / 停靠点（世界坐标，契约 §3.1）────────────────────────── */

/** 人在哪：客厅＝沙发坐垫；卧室＝卧室C 的床（躺）；餐厨＝餐区北侧那把椅子 */
export const WAYPOINTS = {
  living_room: { x: 2.40, y: 0, z: 3.55 },   // 客厅沙发上（坐；沙发已转 180°，坐垫靠 +x 一侧）
  bedroom: { x: 5.15, y: 0, z: -3.25 },      // 卧室B 床上（躺；床头朝东）
  kitchen: { x: -0.05, y: 0, z: -0.745 },    // 餐区北侧椅子（坐）
  bathroom: { x: 1.15, y: 0, z: 5.60 },      // v1.18：独立卫生间（卫 C）里
  away: null,
};

/** 机器人停在人的哪一侧（人坐/躺在床上，机器人不能贴着人站） */
export const APPROACH_POINTS = {
  // ⚠️ 沙发转 180° 后，"正前方"变成 +x 一侧 —— 但那一侧紧邻茶几，0.5 m 的缝塞不进机器人，
  //    所以停靠点放在沙发**南端外侧**（照旧由 getApproachPoint 的 nearestWalkable 兜底）。
  living_room: { x: 2.55, y: 0, z: 5.05 },   // 沙发南端外侧
  bedroom: { x: 4.20, y: 0, z: -1.70 },      // 卧室B 门内、床脚下
  kitchen: { x: -0.90, y: 0, z: -0.745 },    // 餐椅西侧
  // v1.18：卫生间 —— 机器人停在**门外**的走廊侧，不进入私人区域（门口递药）
  bathroom: { x: 2.70, y: 0, z: 5.60 },
  away: { x: 0.40, y: 0, z: 0.05 },          // 餐区中间（她出门了也不堵门）
};

/* ── 导航（给 navgrid 用）────────────────────────────────────────── */

/**
 * 家具占位：遍历家具组取世界 AABB。
 * 滤掉太矮的（地毯 / 踢脚）与太高的（吊灯 / 挂画）—— 它们不该挡住机器人。
 */
function collectFurnitureBoxes(group) {
  const b = new THREE.Box3();
  const out = [];
  // ⚠️ 必须先刷新世界矩阵：`Box3.setFromObject` 只按**当前**的 matrixWorld 求包围盒，
  //    而这些组刚建出来还没渲染过，matrixWorld 还是单位阵 —— 不刷新的话，
  //    所有家具的包围盒会挤在原点附近，导航网格等于没做避障（这个坑原版也有）。
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.userData && p.userData.noNav) return; // 充电桩不算
    b.setFromObject(o);
    if (!Number.isFinite(b.min.x)) return;
    if (b.max.y < 0.22 || b.min.y > 1.95) return; // 地毯/踢脚不挡路；吊灯/挂画也不挡
    out.push({
      x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z,
    });
  });
  return out;
}

/* ── 构建整个户型 ─────────────────────────────────────────────────── */

/**
 * 取导航规格（墙段 / 家具占位 / 边界）。
 * 3D 通道由 `buildRoom()` 顺带算好；2D 降级通道（WebGL 不可用、不会建 3D 房间）
 * 需要自己拿一份 —— 这里按需构建一次并缓存，**两条通道共用同一份几何真相**。
 */
export function getNavSpec() {
  if (!NAV_SPEC) buildRoom();
  return NAV_SPEC;
}

/**
 * 构建套房场景。
 * @returns {THREE.Group} 户型组；`userData.dock` 带充电灯引用、`userData.nav` 带导航数据
 */
export function buildRoom() {
  buildMaterials();
  NAV_WALLS.length = 0;

  const group = new THREE.Group();
  group.name = 'suite';
  SHELL = new THREE.Group();
  SHELL.name = 'suite-shell';
  FURN = new THREE.Group();
  FURN.name = 'suite-furniture';
  group.add(SHELL);
  group.add(FURN);

  /* 地面（study 在 forEach 里已经铺过，别再铺第二遍 —— 原版在这里共面重了一次）*/
  Object.keys(ROOMS).forEach((k) => {
    if (k === 'living') return; // L 形单独处理
    const bath = k === 'bathA' || k === 'bathB' || k === 'wcC';
    floorPlate(ROOMS[k], bath ? M.slate : M.wood);
  });
  floorPlate(room(ROOMS.living.x1, ROOMS.living.z1, ROOMS.living.x2, 6.90), M.wood);
  floorPlate(room(7.60, 6.90, ROOMS.living.x2, ROOMS.living.z2), M.wood);

  // 楼板：把屋子"托"起来，投影更实
  const slab = box(W + 0.55, 0.34, D + 0.55, M.slab, 0, -0.27, 0, SHELL);
  slab.castShadow = false;

  /* 墙体 */
  const wallG = new THREE.Group();
  SHELL.add(wallG);
  const WIN = (a, b, sill, head) => ({ a, b, sill: sill === undefined ? 0.45 : sill, head: head === undefined ? 2.35 : head, kind: 'win' });
  const DOOR = (a, b, head) => ({ a, b, sill: 0, head: head === undefined ? 2.10 : head, kind: 'door' });
  const OPEN = (a, b, head) => ({ a, b, sill: 0, head: head === undefined ? 2.25 : head, kind: 'open' });

  const outer = { parent: wallG, outer: true };
  const inner = { parent: wallG };
  const wallList = [];
  const rec = (x1, z1, x2, z2, t, holes, opt) => wallList.push({ x1, z1, x2, z2, t, holes, opt });

  // 外墙（含窗；入户门不算通行口 —— 机器人不出门）
  rec(0, 0, W, 0, EXT, [WIN(1.00, 3.30), WIN(5.10, 6.50, 1.70, 2.35), WIN(7.40, 8.80, 1.70, 2.35), WIN(10.20, 12.60)], outer);
  rec(0, D, W, D, EXT, [WIN(1.00, 3.60), WIN(5.20, 7.10), WIN(8.60, 12.70, 0.15, 2.40)], outer);
  rec(0, 0, 0, D, EXT, [WIN(1.00, 2.90), WIN(7.90, 9.70)], outer);
  rec(W, 0, W, D, EXT, [WIN(1.20, 3.40), DOOR(4.90, 6.70, 2.30), WIN(7.60, 9.90, 0.15, 2.40)], outer);
  // 内墙
  rec(4.60, 0, 4.60, 4.30, INT, [DOOR(3.35, 4.20)], inner);
  rec(4.60, 3.00, 9.30, 3.00, INT, [DOOR(0.55, 1.45), DOOR(2.95, 3.85)], inner);
  rec(7.00, 0, 7.00, 3.00, INT, [], inner);
  rec(9.30, 0, 9.30, 4.30, INT, [DOOR(3.35, 4.20)], inner);
  rec(0, 4.30, W, 4.30, INT, [OPEN(4.90, 6.60), DOOR(10.60, 11.50)], inner);
  rec(2.30, 4.30, 2.30, 6.90, INT, [DOOR(1.30, 2.20)], inner);
  rec(0, 6.90, 4.80, 6.90, INT, [DOOR(3.40, 4.30)], inner);
  rec(4.80, 4.30, 4.80, 6.90, INT, [OPEN(0.35, 2.25)], inner);
  rec(4.80, 6.90, 4.80, D, INT, [], inner);
  rec(4.80, 6.90, 7.60, 6.90, INT, [], inner);
  rec(7.60, 6.90, 7.60, D, INT, [DOOR(0.55, 2.05, 2.20)], inner);
  wallList.forEach((w) => wall(w.x1, w.z1, w.x2, w.z2, w.t, w.holes, w.opt));

  /* 门窗框 + 玻璃（内门不画门扇：半开的门扇会挡门洞，机器人过去就穿模） */
  wallList.forEach((wl) => {
    const horiz = Math.abs(wl.z2 - wl.z1) < 1e-6;
    const sx = horiz ? (Math.sign(wl.x2 - wl.x1) || 1) : 0;
    const sz = horiz ? 0 : (Math.sign(wl.z2 - wl.z1) || 1);
    (wl.holes || []).forEach((o) => {
      const mid = (o.a + o.b) / 2;
      const cx = horiz ? wl.x1 + sx * mid : wl.x1;
      const cz = horiz ? wl.z1 : wl.z1 + sz * mid;
      const len = o.b - o.a;
      const sill = o.sill || 0;
      const head = o.head === undefined ? 2.1 : o.head;
      const hgt = head - sill;
      const g = new THREE.Group();
      g.position.set(wx(cx), 0, wz(cz));
      if (!horiz) g.rotation.y = Math.PI / 2;
      wallG.add(g);
      const fw = 0.055;
      const fd = wl.t + 0.03;
      const mk = (w, h, y, x) => {
        const m = new THREE.Mesh(boxGeo(w, h, fd), M.brass);
        m.position.set(x, y, 0);
        m.castShadow = true;
        g.add(m);
      };
      mk(len, fw, sill + fw / 2, 0);
      mk(len, fw, head - fw / 2, 0);
      mk(fw, hgt, sill + hgt / 2, -len / 2 + fw / 2);
      mk(fw, hgt, sill + hgt / 2, len / 2 - fw / 2);
      if (o.kind === 'win') {
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(len - fw * 2, hgt - fw * 2), M.glass);
        gl.position.set(0, sill + hgt / 2, 0);
        g.add(gl);
        const vbar = new THREE.Mesh(boxGeo(fw * 0.7, hgt - fw * 2, fd * 0.7), M.brass);
        vbar.position.set(0, sill + hgt / 2, 0);
        g.add(vbar);
        const sillM = new THREE.Mesh(boxGeo(len + 0.12, 0.04, wl.t + 0.22), M.wall);
        sillM.position.set(0, sill - 0.02, 0);
        sillM.castShadow = true;
        sillM.receiveShadow = true;
        g.add(sillM);
      }
    });
  });

  /* 踢脚线 */
  (function buildSkirting() {
    const h = 0.075;
    const t = 0.018;
    const add = (w, d, x, z) => {
      const b = box(w, h, d, M.skirt, x, h / 2, z, SHELL);
      b.castShadow = false;
    };
    const skirt = (r) => {
      add(r.x2 - r.x1, t, wx(r.cx), wz(r.z1) + t / 2);
      add(r.x2 - r.x1, t, wx(r.cx), wz(r.z2) - t / 2);
      add(t, r.z2 - r.z1, wx(r.x1) + t / 2, wz(r.cz));
      add(t, r.z2 - r.z1, wx(r.x2) - t / 2, wz(r.cz));
    };
    Object.keys(ROOMS).forEach((k) => {
      if (k !== 'living') skirt(ROOMS[k]);
    });
    skirt(room(ROOMS.living.x1, ROOMS.living.z1, ROOMS.living.x2, 6.90));
    skirt(room(7.60, 6.90, ROOMS.living.x2, ROOMS.living.z2));
  }());

  /* 家具 + 吊灯 */
  placeFurniture();
  pendant(7.10, 5.35, 2.35, FURN);
  pendant(10.35, 8.85, 2.45, FURN);

  /* 充电桩（客厅） */
  const dock = buildDock(group);

  group.userData.dock = dock;
  group.userData.nav = {
    walls: NAV_WALLS.slice(),
    boxes: collectFurnitureBoxes(FURN),
    bounds: {
      x0: wx(0) + EXT / 2, z0: wz(0) + EXT / 2, x1: wx(W) - EXT / 2, z1: wz(D) - EXT / 2,
    },
  };
  NAV_SPEC = group.userData.nav;
  SHELL = null;
  FURN = null;
  return group;
}

/* ── 与原版的差异（可复核）──────────────────────────────────────────
 * 1. `Math.random()` → 固定 seed（贴图 / 书架 / 盆栽叶片），录屏逐帧可复现；
 * 2. 房间标注精灵 `label()` 整块删除 —— 3D 里不渲染任何文字（红线）；
 * 3. UI 面板 / 漫游 / 剖切 / 网格 / GLB 载入整块删除（不属于本原型的职责）；
 * 4. 内门门扇不画（只留门框）：半开的门扇会挡住门洞，机器人要过去就会穿模；
 * 5. 8 处顶层盆栽漏加 OX/OZ → 全部偏移 (+6.7, +5.3) m，本版按世界坐标传入；
 * 6. 卫生间 C 的台盆参数错位（落到了卫 A 里）→ 改为贴卫 C 南墙；卫 A/卫 B 台盆朝向改为朝室内；
 * 7. 书房地面重复铺一次（共面 z-fighting）→ 去掉重复；
 * 8. 新增：坐具元数据、导航墙段 / 家具占位、客厅充电桩、路径点与停靠点。
 */
