/**
 * room.js —— 房间与分区（S 线）
 *
 * 契约：仿真呈现与开发阶段计划 §2.2 3D 场景规格
 *   - 单层 8m × 6m 现代公寓：客厅 / 卧室 / 餐厨 + 后墙整面落地大窗
 *   - 纯几何体（Box / Cylinder / Plane / Circle），**不引入任何外部 3D 模型资产**
 *   - 所有贴图来自 `textures.js` 的程序化 Canvas 贴图（零外部资产、确定性）
 *   - **3D 里不渲染任何文字**（文字全部走 HTML 叠层）
 *
 * 坐标约定：y 向上，地面 y=0；x ∈ [-4, 4]，z ∈ [-3, 3]。
 * 后墙 z=-3、左墙 x=-4 保留；右墙 / 前墙留空给固定机位。
 * 本文件同时是**路径点真相**：机器人停在哪、人在哪，都由这里导出。
 *
 * 与 person.js 的隐含配合（不要随手改家具高度）：
 *   - 沙发座面顶 = 0.49 m   → SIT_SOFA 由 solveSit(0.49) 反解
 *   - 餐椅座面顶 = 0.47 m   → SIT_CHAIR 由 solveSit(0.47) 反解
 *   - 床垫上表面 ≈ 0.56 m   → 躺姿骨盆中心落在 y=0.68
 *
 * 三角形量级：约 9.5k（远低于 8 万预算）。大量复用 geometry 与 material 实例。
 */

import * as THREE from 'three';
import {
  woodFloor, wallPaint, fabric, rug, wood, stone, cityView, leaf,
  normalFromTexture, roughnessFromTexture, lightShaft, contactShadow,
} from './textures.js';

/* ── 契约：路径点（一字不改） ─────────────────────────────────────── */

/** 人在哪（person.js 用） */
export const WAYPOINTS = {
  living_room: { x: 3.02, y: 0, z: 1.4 },
  bedroom: { x: -2.75, y: 0, z: -1.6 },
  kitchen: { x: 2.6, y: 0, z: -0.72 },
  away: null,
};

/** 机器人停在哪（robot.js 用；契约 §3.1 场景 API 的 getApproachPoint） */
export const APPROACH_POINTS = {
  living_room: { x: 1.9, y: 0, z: 1.35 },
  bedroom: { x: -1.5, y: 0, z: -0.95 },
  kitchen: { x: 1.5, y: 0, z: -1.1 },
  away: { x: 1.0, y: 0, z: 0.4 },
};

/** 机器人充电座（空闲时的家）——放在前景中央，保证固定机位下始终可见（不被 HUD 挡住） */
export const DOCK = { x: 0.92, y: 0, z: 2.36 }; // 客厅里、地毯前缘（充电桩柱在它 +z 侧）

/**
 * 家具占位（XZ 平面 AABB，米）——**给 scene3d 选机器人站位用**：
 * 人坐下的位置千变万化，机器人不能傻站在"人的正前方 0.95 m"那个点，
 * 那里很可能是茶几/餐桌。scene3d 会绕着她试几个方向，挑一个不在这些方块里的。
 * 与 room.js 的家具坐标同源（3D 与 2D 一致），改家具要同步改这里。
 */
export const FURNITURE_BLOCK = [
  { x0: 2.86, x1: 3.94, z0: 0.28, z1: 2.52 }, // 沙发
  { x0: -0.33, x1: 0.63, z0: 1.06, z1: 1.64 }, // 茶几
  { x0: -3.82, x1: -2.08, z0: -2.64, z1: -0.48 }, // 床
  { x0: -2.08, x1: -1.56, z0: -2.58, z1: -2.08 }, // 床头柜
  { x0: -4.02, x1: -3.50, z0: -0.44, z1: 1.00 }, // 五斗柜
  { x0: 2.28, x1: 4.02, z0: -3.00, z1: -2.34 }, // 厨房台面（贴后墙）
  { x0: 3.30, x1: 4.02, z0: -2.42, z1: -0.84 }, // 厨房台面（转角）
  { x0: 1.93, x1: 3.17, z0: -2.00, z1: -0.76 }, // 餐桌
  { x0: 3.17, x1: 3.74, z0: -0.34, z1: 0.24 }, // 沙发边几
  { x0: -4.02, x1: -3.30, z0: 0.52, z1: 2.38 }, // 电视柜 + 电视
  { x0: 3.32, x1: 3.94, z0: 2.32, z1: 2.94 }, // 客厅绿植
  { x0: -3.68, x1: -3.12, z0: -0.08, z1: 0.48 }, // 卧室绿植
  { x0: 0.52, x1: 1.34, z0: 2.02, z1: 2.72 }, // 充电桩
];

/* ── 几何 / 材质：全部实例复用 ────────────────────────────────────── */

const GEO_CACHE = new Map();

function cached(key, make) {
  let g = GEO_CACHE.get(key);
  if (!g) {
    g = make();
    GEO_CACHE.set(key, g);
  }
  return g;
}

/**
 * 把 BoxGeometry 六个面的 UV 按**世界尺寸**缩放。
 * 这样同一张贴图（repeat 固定 1×1）在 4m 的墙和 3cm 的抽屉缝上比例一致，
 * 不会出现「小方块上塞进 3×3 个循环」的摩尔纹。
 */
function scaleFaceUV(geo, w, h, d, u) {
  const uv = geo.attributes.uv;
  const per = uv.count / 6;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f += 1) {
    const a = dims[f][0] * u;
    const b = dims[f][1] * u;
    for (let i = f * per; i < (f + 1) * per; i += 1) {
      uv.setXY(i, uv.getX(i) * a, uv.getY(i) * b);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** 直角薄板（墙面、门板、台面、抽屉缝…） */
function slab(w, h, d, u = 1) {
  return cached(`s${w}|${h}|${d}|${u}`, () => scaleFaceUV(new THREE.BoxGeometry(w, h, d), w, h, d, u));
}

/**
 * 圆角盒：把 BoxGeometry 的顶点夹到内盒再沿法向外推 r，同时写出解析法线
 * （等价的 RoundedBoxGeometry，但 vendored 的 three 核心没有这个 addon）。
 */
function rbox(w, h, d, r = 0.02, u = 1, seg = 2) {
  return cached(`r${w}|${h}|${d}|${r}|${u}|${seg}`, () => {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const hx = Math.max(0, w / 2 - r);
    const hy = Math.max(0, h / 2 - r);
    const hz = Math.max(0, d / 2 - r);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const cx = Math.min(hx, Math.max(-hx, x));
      const cy = Math.min(hy, Math.max(-hy, y));
      const cz = Math.min(hz, Math.max(-hz, z));
      let dx = x - cx;
      let dy = y - cy;
      let dz = z - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        dx /= len; dy /= len; dz /= len;
        pos.setXYZ(i, cx + dx * r, cy + dy * r, cz + dz * r);
        nrm.setXYZ(i, dx, dy, dz);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    scaleFaceUV(g, w, h, d, u);
    g.computeBoundingSphere();
    return g;
  });
}

function cyl(rt, rb, h, seg = 12) {
  return cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

function put(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/* ── 程序化贴图（repeat 统一 1×1，靠 UV 缩放控制密度） ─────────────── */

const TEX = {
  floor: woodFloor({ size: 512, planks: 8, repeat: [1, 1], seed: 11, tone: 0xc2a47f }),
  wall: wallPaint({ size: 256, repeat: [1, 1], seed: 23, tone: 0xf3ede4 }),
  sofa: fabric({ size: 256, repeat: [1, 1], seed: 31, tone: 0x9299a0, weave: 3 }),
  sofaLit: fabric({ size: 256, repeat: [1, 1], seed: 33, tone: 0xa0a6ac, weave: 3 }),
  linen: fabric({ size: 256, repeat: [1, 1], seed: 41, tone: 0xd9d0bd, weave: 3 }),
  cotton: fabric({ size: 256, repeat: [1, 1], seed: 43, tone: 0xeceae3, weave: 2 }),
  rug: rug({ size: 256, repeat: [1, 1], seed: 47, tone: 0xc6c2b7 }),
  oak: wood({ size: 256, repeat: [1, 1], seed: 59, tone: 0x9d7f5d, rings: 26 }),
  walnut: wood({ size: 256, repeat: [1, 1], seed: 61, tone: 0x7a6249, rings: 22 }),
  stone: stone({ size: 256, repeat: [1, 1], seed: 71, tone: 0xeae6df, veins: 14 }),
  city: cityView({ w: 512, h: 256, seed: 97 }),
  leaf: leaf({ size: 128, seed: 113, tone: 0x6d9a58 }),
};

/**
 * 每种材质的贴图密度（1/米），让纹理比例在整间屋子里一致。
 * 木纹特意取高密度：`wood()` 的年轮对比本来就强，放大成大色块会变成斑马纹，
 * 缩到 6–7 mm 一条才像真实木料。
 */
const U = { floor: 0.70, wall: 0.30, wood: 5.0, fabric: 3.0, rug: 1.55, stone: 0.95 };

const NM = {
  floor: normalFromTexture(TEX.floor, 2.6),
  wall: normalFromTexture(TEX.wall, 1.1),
  oak: normalFromTexture(TEX.oak, 1.6),
  walnut: normalFromTexture(TEX.walnut, 1.6),
  stone: normalFromTexture(TEX.stone, 1.2),
  sofa: normalFromTexture(TEX.sofa, 2.2),
  linen: normalFromTexture(TEX.linen, 2.0),
  rug: normalFromTexture(TEX.rug, 2.4),
};

/**
 * 粗糙度贴图（v1.6）：接了它以后材质的 `roughness` 必须设成 **1**，
 * 因为 three 的公式是 `roughness = material.roughness × roughnessMap.g`——
 * 值由贴图给绝对值，材质只当乘数。地板/石材取「越暗越糙」（缝里更糙），
 * 布纹反过来（绒面凸起处更亮更光）。
 */
const RM = {
  floor: roughnessFromTexture(TEX.floor, { base: 0.52, amount: 0.5 }),
  wall: roughnessFromTexture(TEX.wall, { base: 0.94, amount: 0.12 }),
  oak: roughnessFromTexture(TEX.oak, { base: 0.58, amount: 0.3 }),
  walnut: roughnessFromTexture(TEX.walnut, { base: 0.55, amount: 0.3 }),
  stone: roughnessFromTexture(TEX.stone, { base: 0.24, amount: 0.28 }),
  sofa: roughnessFromTexture(TEX.sofa, { base: 0.9, amount: 0.16, invert: true }),
  linen: roughnessFromTexture(TEX.linen, { base: 0.93, amount: 0.14, invert: true }),
  rug: roughnessFromTexture(TEX.rug, { base: 0.96, amount: 0.1, invert: true }),
};

/** 布料的「绒面反光」：织物的真实感几乎全来自掠射角那层柔光 */
function fabricMat(map, normalMap, { roughnessMap, normalScale = 0.45, sheen = 0.55, sheenRoughness = 0.85 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    sheen,
    sheenRoughness,
    sheenColor: new THREE.Color(0xffffff),
  });
}

const M = {
  floor: new THREE.MeshStandardMaterial({ map: TEX.floor, normalMap: NM.floor, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: RM.floor, roughness: 1.0, metalness: 0.02 }),
  wall: new THREE.MeshStandardMaterial({ map: TEX.wall, normalMap: NM.wall, normalScale: new THREE.Vector2(0.22, 0.22), roughnessMap: RM.wall, roughness: 1.0, metalness: 0.0 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf7f3ec, roughness: 0.95, metalness: 0.0 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xded6c7, roughness: 0.62, metalness: 0.02 }),
  oak: new THREE.MeshStandardMaterial({ map: TEX.oak, normalMap: NM.oak, roughnessMap: RM.oak, roughness: 1.0, metalness: 0.02 }),
  walnut: new THREE.MeshStandardMaterial({ map: TEX.walnut, normalMap: NM.walnut, roughnessMap: RM.walnut, roughness: 1.0, metalness: 0.02 }),
  stone: new THREE.MeshStandardMaterial({ map: TEX.stone, normalMap: NM.stone, roughnessMap: RM.stone, roughness: 1.0, metalness: 0.03 }),
  sofa: fabricMat(TEX.sofa, NM.sofa, { roughnessMap: RM.sofa, normalScale: 0.5, sheen: 0.7 }),
  sofaLit: new THREE.MeshStandardMaterial({ map: TEX.sofaLit, roughness: 0.96, metalness: 0.0 }),
  linen: fabricMat(TEX.linen, NM.linen, { roughnessMap: RM.linen, normalScale: 0.45, sheen: 0.6 }),
  cotton: new THREE.MeshStandardMaterial({ map: TEX.cotton, roughness: 0.97, metalness: 0.0 }),
  rug: fabricMat(TEX.rug, NM.rug, { roughnessMap: RM.rug, normalScale: 0.6, sheen: 0.5, sheenRoughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d959b, roughness: 0.26, metalness: 0.85 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xa8b0b6, roughness: 0.18, metalness: 0.95 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x93a8b6, roughness: 0.48, metalness: 0.16 }),
  city: new THREE.MeshBasicMaterial({ map: TEX.city }),
  sheer: new THREE.MeshStandardMaterial({
    color: 0xfff4e6,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  leaf: new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.72, side: THREE.DoubleSide }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.15 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.14, metalness: 0.42 }),
  glow: new THREE.MeshStandardMaterial({
    color: 0xfff6e8,
    emissive: 0xffe6bd,
    emissiveIntensity: 1.15,
    roughness: 0.5,
  }),
  // 充电桩状态灯（v1.5 里误用了不存在的 M.warn，three 会静默退回默认白色材质）
  warn: new THREE.MeshStandardMaterial({
    color: 0xffcf8a,
    emissive: 0xffa63c,
    emissiveIntensity: 1.0,
    roughness: 0.42,
  }),
  // 充电桩充电灯（回桩时由 scene3d 呼吸）
  charge: new THREE.MeshStandardMaterial({
    color: 0x9ff2c9,
    emissive: 0x2fe08a,
    emissiveIntensity: 1.2,
    roughness: 0.38,
  }),
  shade: new THREE.MeshStandardMaterial({ color: 0xf3e6d2, roughness: 0.85, side: THREE.DoubleSide }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.4, metalness: 0.03 }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0xb9a08b, roughness: 0.8 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 1.0 }),
  art1: new THREE.MeshStandardMaterial({ color: 0xc08a6a, roughness: 0.9 }),
  art2: new THREE.MeshStandardMaterial({ color: 0x4d6d72, roughness: 0.9 }),
  art3: new THREE.MeshStandardMaterial({ color: 0xe6ddc9, roughness: 0.9 }),
  mat: new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.85 }),
  // 拐杖 / 拖鞋 / 钟壳 / 遥控器
  cane: new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.42, metalness: 0.06 }),
  felt: new THREE.MeshStandardMaterial({ color: 0x7d6f79, roughness: 0.95 }),
  // 充电桩地垫：中性深灰（原来用 M.felt 偏紫，看着像块地毯）
  matBoot: new THREE.MeshStandardMaterial({ color: 0x565f63, roughness: 0.92 }),
  clockCase: new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.55 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xd9cfbe, roughness: 0.9 }),
  // 停车地垫四角的对位标（不发光，别用 M.warn）
  hazard: new THREE.MeshStandardMaterial({ color: 0xd8a13c, roughness: 0.82, metalness: 0.02 }),
};
// 纱帘不投影：shadowSide=FrontSide 让它在阴影 pass 里被背面剔除（否则地板上一整条黑带）
M.sheer.shadowSide = THREE.FrontSide;

/* ── 1. 地面 ──────────────────────────────────────────────────────── */

function buildFloor(g) {
  put(g, slab(8, 0.14, 6, U.floor), M.floor, 0, -0.07, 0);
}

/* ── 2. 墙体 / 天花板 ─────────────────────────────────────────────── */

const WIN = { x0: -2.2, x1: 2.2, y0: 0.15, y1: 2.35, z: -3.0 };
const WALL_H = 2.7;

function buildShell(g) {
  const t = 0.12;
  const zc = WIN.z - t / 2;

  // 后墙：让出 x∈[-2.2,2.2] × y∈[0.15,2.35] 的整面落地窗洞
  put(g, slab(4 + WIN.x0, WALL_H, t, U.wall), M.wall, (-4 + WIN.x0) / 2, WALL_H / 2, zc); // 左段
  put(g, slab(4 - WIN.x1, WALL_H, t, U.wall), M.wall, (4 + WIN.x1) / 2, WALL_H / 2, zc); // 右段
  put(g, slab(WIN.x1 - WIN.x0, WIN.y0, t, U.wall), M.wall, 0, WIN.y0 / 2, zc); // 窗下
  put(g, slab(WIN.x1 - WIN.x0, WALL_H - WIN.y1, t, U.wall), M.wall, 0, (WALL_H + WIN.y1) / 2, zc); // 窗上
  // 左墙
  put(g, slab(t, WALL_H, 6, U.wall), M.wall, -4 - t / 2, WALL_H / 2, 0);

  // 踢脚线
  put(g, slab(8, 0.09, 0.03, U.wood), M.trim, 0, 0.045, WIN.z + 0.015);
  put(g, slab(0.03, 0.09, 6, U.wood), M.trim, -4 + 0.015, 0.045, 0);

  // 天花板：只做后墙 / 左墙一侧的薄板，不挡俯视机位
  put(g, slab(8, 0.09, 0.5, U.wall), M.ceiling, 0, 2.62, -2.75);
  put(g, slab(0.5, 0.09, 5.5, U.wall), M.ceiling, -3.75, 2.62, -0.25);

  // 吸顶灯（后墙顶板下两盏，纯几何、无文字）
  for (const x of [-2.4, 1.6]) {
    put(g, cyl(0.14, 0.15, 0.05, 16), M.ceiling, x, 2.55, -2.72);
    put(g, cyl(0.11, 0.11, 0.012, 16), M.glow, x, 2.522, -2.72);
  }
}

/* ── 3. 落地大窗 + 窗外城市 + 纱帘 ────────────────────────────────── */

function pleated(width, height, folds) {
  const geo = new THREE.PlaneGeometry(width, height, folds * 4, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const u = (p.getX(i) + width / 2) / width;
    const v = (p.getY(i) + height / 2) / height;
    p.setZ(i, Math.sin(u * Math.PI * 2 * folds) * 0.045 + Math.sin(v * 4.1) * 0.006);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildWindow(g) {
  const cz = WIN.z - 0.02;
  // 窗外城市（贴图自带天空渐变 + 远景楼群，不加 repeat）
  // 高度必须压在后墙 2.7 m 以内，否则从俯视机位能看到天幕从墙顶冒出来
  const cityPane = put(g, new THREE.PlaneGeometry(6.8, 2.9, 1, 1), M.city, 0, 1.20, WIN.z - 0.45);
  // ⚠️ 窗外天幕**必须不投影**：它是自发光面，让它投影等于把窗光整片挡死，室内永远没有光斑
  cityPane.userData.noShadow = true;

  // 天蓝灰细框
  const barW = 0.06;
  const fz = cz + 0.03;
  put(g, slab(WIN.x1 - WIN.x0, 0.07, barW, U.wood), M.frame, 0, WIN.y0 + 0.035, fz); // 下框
  put(g, slab(WIN.x1 - WIN.x0, 0.05, barW, U.wood), M.frame, 0, WIN.y1 - 0.025, fz); // 上框
  for (const x of [WIN.x0 + 0.03, WIN.x1 - 0.03]) {
    put(g, slab(0.05, WIN.y1 - WIN.y0, barW, U.wood), M.frame, x, (WIN.y0 + WIN.y1) / 2, fz);
  }
  // 竖向分格
  for (const x of [-1.1, 0, 1.1]) {
    put(g, slab(0.045, WIN.y1 - WIN.y0 - 0.06, barW * 0.8, U.wood), M.frame, x, (WIN.y0 + WIN.y1) / 2, fz);
  }
  // 台面下沿一点点石材窗台
  put(g, slab(WIN.x1 - WIN.x0, 0.03, 0.14, U.stone), M.stone, 0, WIN.y0 - 0.01, WIN.z + 0.08);

  // 窗帘杆
  put(g, cyl(0.017, 0.017, 5.0, 10), M.frame, 0, 2.47, WIN.z + 0.19).rotation.z = Math.PI / 2;
  for (const x of [-2.5, 2.5]) put(g, new THREE.SphereGeometry(0.028, 10, 8), M.frame, x, 2.47, WIN.z + 0.19);

  // 两侧薄纱窗帘（半透明，正弦褶皱；shadowSide 已设，不投影）
  const sheer = pleated(1.06, 2.34, 6);
  const sheerL = put(g, sheer, M.sheer, -2.24, 1.28, WIN.z + 0.19);
  const sheerR = put(g, sheer, M.sheer, 2.24, 1.28, WIN.z + 0.19);
  sheerL.userData.noShadow = true; // 半透明纱不该投影，否则窗光被糊掉
  sheerR.userData.noShadow = true;
}

/**
 * ── 落座元数据（v1.6，契约 §3.1 `scene.pick` 用）────────────────────
 * 挂在**可坐表面**的 mesh 上。射线打中它时，scene3d 会把落点吸附到
 * 「这个人真的坐得下」的位置（沙发垫中间、椅子正中、床边），而不是命中点在哪就坐哪——
 * 否则点到扶手会坐扶手、点到椅背会坐椅背。
 *
 * 字段：`{ surfaceY, facing, kind, lockX?, lockZ?, clampX?, clampZ? }`（全是纯数据）
 */
function markSeat(mesh, spec) {
  mesh.userData.seat = spec;
  return mesh;
}

/** 整组挂同一条坐具信息：点沙发任意一处 = 坐到沙发垫上，而不是"点到哪坐哪" */
function markSeatDeep(group, spec) {
  group.traverse((node) => {
    if (node.isMesh) node.userData.seat = spec;
  });
  return group;
}

/** 沙发：坐垫顶 0.49，人坐 x≈2.99（坐垫前缘），朝向 -x（房间内侧） */
const SEAT_SOFA = { surfaceY: 0.49, facing: -Math.PI / 2, kind: 'sofa', lockX: 2.99, clampZ: [0.66, 2.14] };
/** 餐椅：座面顶 0.47，坐正中间，朝向该椅子的正前方（由每把椅子的 rotation.y 填 facing） */
const seatChair = (x, z, facing) => ({ surfaceY: 0.47, facing, kind: 'chair', lockX: x, lockZ: z });
/** 床：被褥把床面垫到 0.7 以上，硬把人按 0.54 塞进去会陷进被子里；
 *  所以点床 = 坐在**床边地板**上（lockX 在床沿外 0.2 m），朝向房间内侧 +x */
const SEAT_BEDSIDE = { surfaceY: 0, facing: Math.PI / 2, kind: 'floor', lockX: -2.02, clampZ: [-2.22, -0.95] };

/* ── 4. 客厅 ──────────────────────────────────────────────────────── */

function buildLiving(g) {
  // 圆形地毯（低饱和灰米色，圈绒）
  const carpet = put(g, new THREE.CircleGeometry(1.55, 40), M.rug, 1.5, 0.012, 1.32);
  carpet.rotation.x = -Math.PI / 2;

  buildSofa(g);
  buildCoffeeTable(g);

  // 沙发旁圆边几 + 小台灯
  const st = new THREE.Group();
  st.position.set(3.45, 0, -0.05);
  contact(g, 3.45, -0.05, 0.62, 0.62, 0.5);
  put(st, cyl(0.24, 0.24, 0.04, 20), M.oak, 0, 0.50, 0);
  put(st, cyl(0.035, 0.045, 0.48, 12), M.walnut, 0, 0.25, 0);
  put(st, cyl(0.18, 0.18, 0.03, 16), M.walnut, 0, 0.015, 0);
  put(st, cyl(0.07, 0.09, 0.16, 12), M.ceramic, 0, 0.60, 0);
  put(st, cyl(0.11, 0.14, 0.17, 14), M.shade, 0, 0.75, 0);
  put(st, cyl(0.06, 0.06, 0.01, 10), M.glow, 0, 0.70, 0);
  g.add(st);

  buildPlant(g);
  buildCane(g);
  buildSlippers(g);
}

/* ── 4.1 生活痕迹（v1.6）：拐杖 / 拖鞋 ────────────────────────────
 * 写实感的一半来自「这里住着一个人」：只加了几十个三角形，但一眼就能看出来。
 */
function buildCane(g) {
  const cane = new THREE.Group();
  cane.position.set(3.24, 0, 2.52);
  cane.rotation.z = -0.16;
  cane.rotation.x = 0.10;
  // 杖身：上段深胡桃木、下段铝合金 + 橡胶脚垫
  put(cane, cyl(0.0115, 0.0125, 0.72, 10), M.cane, 0, 0.42, 0);
  put(cane, cyl(0.0105, 0.0105, 0.16, 10), M.chrome, 0, 0.0, 0);
  put(cane, cyl(0.019, 0.022, 0.022, 12), M.dark, 0, -0.085, 0);
  // 弯把手：四分之一圆环 + 收口球
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.0125, 8, 18, Math.PI * 0.62), M.cane);
  handle.position.set(0.055, 0.78, 0);
  handle.rotation.z = Math.PI * 0.19;
  cane.add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), M.cane);
  knob.position.set(0.016, 0.828, 0);
  cane.add(knob);
  g.add(cane);
  contact(g, 3.24, 2.52, 0.28, 0.28, 0.45);
}

function buildSlippers(g) {
  for (const [x, z, rot] of [[2.72, 2.16, 0.24], [2.62, 2.42, -0.34]]) {
    const s = new THREE.Group();
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    put(s, rbox(0.09, 0.026, 0.24, 0.03), M.felt, 0, 0.014, 0);
    put(s, rbox(0.086, 0.055, 0.11, 0.028), M.felt, 0, 0.048, -0.05);
    g.add(s);
  }
  contact(g, 2.67, 2.29, 0.5, 0.5, 0.4);
}

function buildSofa(g) {
  // 面向 -x（王阿姨坐在 x≈2.98 的座面上，座面顶必须 = 0.49）
  const zc = 1.40;
  const sofa = new THREE.Group();
  put(sofa, rbox(0.84, 0.30, 2.04, 0.03), M.sofa, 3.38, 0.23, zc); // 底架
  for (const z of [zc - 0.92, zc + 0.92]) {
    for (const x of [3.06, 3.70]) put(sofa, cyl(0.022, 0.022, 0.09, 10), M.walnut, x, 0.045, z);
  }
  for (const s of [-1, 1]) {
    const c = put(sofa, rbox(0.90, 0.17, 0.96, 0.06), M.sofaLit, 3.30, 0.405, zc + s * 0.50);
    c.rotation.z = -0.012 * s;
  }
  put(sofa, rbox(0.22, 0.60, 2.10, 0.05), M.sofa, 3.80, 0.62, zc); // 靠背
  for (const s of [-1, 1]) {
    const b = put(sofa, rbox(0.18, 0.44, 0.94, 0.05), M.sofa, 3.60, 0.615, zc + s * 0.50);
    b.rotation.z = 0.05;
  }
  for (const s of [-1, 1]) {
    put(sofa, rbox(0.94, 0.30, 0.20, 0.06), M.sofa, 3.35, 0.47, zc + s * 1.05); // 扶手
  }
  // 两个抱枕（靠在靠背垫上，别悬空）
  const p1 = put(sofa, rbox(0.34, 0.34, 0.13, 0.06), M.linen, 3.50, 0.66, zc - 0.70);
  p1.rotation.set(0.06, 0.30, 0.16);
  const p2 = put(sofa, rbox(0.32, 0.32, 0.13, 0.06), M.cotton, 3.50, 0.65, zc + 0.70);
  p2.rotation.set(-0.06, -0.30, -0.16);
  // 搭在扶手上的薄毯
  const throwB = put(sofa, rbox(0.44, 0.06, 0.50, 0.03), M.linen, 3.34, 0.64, zc + 1.05);
  throwB.rotation.z = 0.06;
  // 遥控器（老人常放在扶手上）
  const remote = put(sofa, rbox(0.05, 0.018, 0.16, 0.008), M.dark, 3.30, 0.625, zc - 1.02);
  remote.rotation.y = 0.18;

  markSeatDeep(sofa, SEAT_SOFA); // 点沙发任意一处都坐到坐垫上
  g.add(sofa);
}

function buildCoffeeTable(g) {
  // 矮木茶几（圆角）——原来就在 (0.15, 1.35)，保留但压低到 0.36 m
  const t = new THREE.Group();
  t.position.set(0.15, 0, 1.35);
  put(t, rbox(0.92, 0.055, 0.54, 0.025, U.wood), M.oak, 0, 0.335, 0);
  for (const x of [-0.38, 0.38]) {
    for (const z of [-0.19, 0.19]) put(t, cyl(0.021, 0.021, 0.31, 10), M.walnut, x, 0.155, z);
  }
  put(t, rbox(0.72, 0.03, 0.40, 0.012, U.wood), M.oak, 0, 0.19, 0); // 下层板
  // 茶杯 + 一摞书 + 一板药盒（只有几何，没有任何文字——契约红线）
  put(t, cyl(0.042, 0.036, 0.095, 14), M.ceramic, 0.26, 0.41, 0.02);
  const book = put(t, slab(0.24, 0.028, 0.17, U.fabric), M.art2, -0.24, 0.376, -0.02);
  book.rotation.y = 0.24;
  const book2 = put(t, slab(0.22, 0.024, 0.16, U.fabric), M.art1, -0.25, 0.402, -0.01);
  book2.rotation.y = 0.30;
  const book3 = put(t, slab(0.20, 0.020, 0.145, U.fabric), M.paper, -0.26, 0.424, 0.0);
  book3.rotation.y = 0.19;
  const pillBox = put(t, rbox(0.16, 0.028, 0.09, 0.01), M.ceramic, 0.10, 0.377, -0.16);
  pillBox.rotation.y = -0.12;
  put(t, slab(0.14, 0.004, 0.07), M.glow, 0.10, 0.393, -0.16).rotation.y = -0.12;
  g.add(t);
}

function buildPlant(g) {
  // 琴叶榕：细树干 + 9 片朝不同方向的椭圆叶片（叶长约 26 cm，接近真株比例）
  const p = new THREE.Group();
  p.position.set(3.62, 0, 2.62);
  put(p, cyl(0.21, 0.16, 0.34, 16), M.terracotta, 0, 0.17, 0);
  put(p, cyl(0.19, 0.19, 0.02, 16), M.soil, 0, 0.335, 0);
  const trunk = put(p, cyl(0.022, 0.032, 1.28, 10), M.walnut, 0.02, 0.96, 0);
  trunk.rotation.z = 0.035;

  const leafGeo = new THREE.CircleGeometry(0.5, 12);
  leafGeo.translate(0, 0.5, 0);
  for (let i = 0; i < 9; i += 1) {
    const a = i * 2.399 + 0.5;
    const y = 0.72 + (i % 3) * 0.235 + (i > 6 ? 0.09 : 0);
    const r = 0.075 + (i % 3) * 0.05;
    const holder = new THREE.Group();
    holder.position.set(0.02 + Math.cos(a) * r, y, Math.sin(a) * r);
    holder.rotation.y = -a;
    const pet = new THREE.Mesh(cyl(0.007, 0.007, 0.14, 6), M.leaf);
    pet.rotation.z = -Math.PI / 2;
    pet.position.set(0.065, 0.005, 0);
    holder.add(pet);
    const lf = new THREE.Mesh(leafGeo, M.leaf);
    lf.scale.set(0.19, 0.28, 1);
    lf.rotation.z = -0.95 - (i % 3) * 0.19;
    lf.rotation.y = 0.3 * ((i % 2) ? 1 : -1);
    lf.position.set(0.13, -0.01, 0);
    holder.add(lf);
    p.add(holder);
  }
  g.add(p);
}

/* ── 5. 卧室（左墙一侧） ──────────────────────────────────────────── */

function buildBedroom(g) {
  const bx = -2.95;
  const bz = -1.55;
  const bed = new THREE.Group();
  bed.position.set(bx, 0, bz);
  contact(g, bx, bz, 2.1, 2.4, 0.85);

  put(bed, rbox(1.62, 0.26, 2.02, 0.03, U.wood), M.oak, 0, 0.13, 0); // 床架
  put(bed, rbox(1.50, 0.28, 1.90, 0.05, U.fabric), M.cotton, 0, 0.40, 0); // 厚床垫
  // 米色被子：三块略微错位的圆角盒叠出厚度与褶皱，再加两道浅褶
  put(bed, rbox(1.56, 0.16, 1.34, 0.07, U.fabric), M.linen, 0, 0.60, 0.30);
  const top2 = put(bed, rbox(1.44, 0.12, 1.08, 0.06, U.fabric), M.linen, 0.03, 0.69, 0.34);
  top2.rotation.y = 0.025;
  put(bed, rbox(0.62, 0.07, 0.34, 0.035, U.fabric), M.linen, 0.42, 0.735, 0.02);
  put(bed, rbox(0.54, 0.06, 0.30, 0.03, U.fabric), M.linen, -0.38, 0.735, 0.58);
  const fold = put(bed, rbox(1.52, 0.11, 0.36, 0.045, U.fabric), M.linen, 0, 0.625, -0.34);
  fold.rotation.x = 0.05;
  // 两个枕头
  for (const s of [-1, 1]) {
    const pil = put(bed, rbox(0.64, 0.17, 0.40, 0.075, U.fabric), M.cotton, s * 0.36, 0.625, -0.80);
    pil.rotation.z = s * 0.05;
  }
  // 床头板
  put(bed, rbox(1.54, 0.96, 0.09, 0.03, U.wood), M.oak, 0, 0.62, -1.06);
  markSeatDeep(bed, SEAT_BEDSIDE); // 点床 = 坐到床沿前的地板上（被褥太高，坐上去会陷进去）
  g.add(bed);

  // 床头柜 + 小台灯（在床的 +x 侧）
  const ns = new THREE.Group();
  ns.position.set(-1.83, 0, -2.34);
  contact(g, -1.83, -2.34, 0.85, 0.8, 0.6);
  put(ns, rbox(0.46, 0.44, 0.44, 0.02, U.wood), M.oak, 0, 0.24, 0);
  put(ns, slab(0.40, 0.03, 0.02, U.wood), M.walnut, 0, 0.30, 0.223);
  put(ns, slab(0.10, 0.014, 0.014), M.walnut, 0, 0.30, 0.236);
  put(ns, cyl(0.055, 0.075, 0.22, 12), M.ceramic, 0, 0.57, 0);
  put(ns, cyl(0.09, 0.115, 0.15, 14), M.shade, 0, 0.74, 0);
  put(ns, cyl(0.05, 0.05, 0.01, 10), M.glow, 0, 0.70, 0);
  g.add(ns);

  // 五斗柜（左墙，床尾外侧）：柜体 + 三条抽屉缝 + 拉手
  const dr = new THREE.Group();
  dr.position.set(-3.76, 0, 0.28);
  contact(g, -3.72, 0.28, 0.95, 1.7, 0.7);
  put(dr, rbox(0.44, 0.86, 1.34, 0.02, U.wood), M.oak, 0, 0.43, 0);
  put(dr, slab(0.46, 0.03, 1.40, U.wood), M.oak, 0, 0.875, 0);
  for (let i = 0; i < 3; i += 1) {
    const y = 0.20 + i * 0.235;
    put(dr, slab(0.02, 0.205, 1.22, U.wood), M.oak, 0.225, y, 0);
    put(dr, slab(0.02, 0.014, 0.42), M.walnut, 0.24, y, 0);
  }
  for (const z of [-0.56, 0.56]) put(dr, cyl(0.02, 0.02, 0.08, 8), M.walnut, 0, 0.02, z);
  g.add(dr);
}

/* ── 6. 餐厨（右后角） ────────────────────────────────────────────── */

function buildKitchen(g) {
  const topY = 0.885;

  // 一字型长边（贴后墙，让开大窗：x 从 2.28 起）
  put(g, rbox(1.63, 0.86, 0.60, 0.015, U.wood), M.oak, 3.135, 0.43, -2.68);
  put(g, slab(1.72, 0.05, 0.66, U.stone), M.stone, 3.14, topY, -2.67);
  // 柜门（有缝）+ 细长拉手
  for (const x of [2.62, 3.15, 3.68]) {
    put(g, slab(0.49, 0.76, 0.02, U.wood), M.oak, x, 0.47, -2.368);
    put(g, slab(0.014, 0.30, 0.014), M.steel, x + 0.205, 0.60, -2.350);
  }

  // 转角短边（贴右侧）
  put(g, rbox(0.58, 0.86, 1.44, 0.015, U.wood), M.oak, 3.64, 0.43, -1.65);
  put(g, slab(0.68, 0.05, 1.46, U.stone), M.stone, 3.64, topY, -1.61);
  for (const z of [-1.26, -2.04]) {
    put(g, slab(0.02, 0.76, 0.66, U.wood), M.oak, 3.352, 0.47, z);
    put(g, slab(0.014, 0.30, 0.014), M.steel, 3.334, 0.60, z + 0.26);
  }

  // 水槽：不锈钢盆（四壁 + 盆底，可俯视看到凹槽）+ 细圆柱弯管龙头
  const sx = 2.75;
  const sz = -2.65;
  put(g, slab(0.54, 0.02, 0.34), M.steel, sx, 0.945, sz);
  put(g, slab(0.60, 0.15, 0.025), M.steel, sx, 0.985, sz - 0.195);
  put(g, slab(0.60, 0.15, 0.025), M.steel, sx, 0.985, sz + 0.195);
  put(g, slab(0.025, 0.15, 0.42), M.steel, sx - 0.2875, 0.985, sz);
  put(g, slab(0.025, 0.15, 0.42), M.steel, sx + 0.2875, 0.985, sz);
  put(g, cyl(0.014, 0.016, 0.30, 10), M.chrome, sx, 1.06, -2.875);
  const arm = put(g, cyl(0.012, 0.012, 0.24, 10), M.chrome, sx, 1.20, -2.765);
  arm.rotation.x = Math.PI / 2;
  put(g, cyl(0.011, 0.011, 0.09, 8), M.chrome, sx, 1.165, -2.65);

  // 上柜（在大窗右侧）
  put(g, rbox(1.62, 0.70, 0.35, 0.015, U.wood), M.oak, 3.14, 1.94, -2.80);
  for (const x of [2.75, 3.55]) {
    put(g, slab(0.76, 0.66, 0.02, U.wood), M.oak, x, 1.94, -2.612);
    put(g, slab(0.30, 0.014, 0.014), M.steel, x, 1.665, -2.596);
  }

  buildDining(g);
}

function buildDining(g) {
  const cx = 2.55;
  const cz = -1.38;
  const table = new THREE.Group();
  table.position.set(cx, 0, cz);
  contact(g, cx, cz, 1.6, 1.6, 0.7);
  put(table, cyl(0.58, 0.58, 0.055, 28), M.oak, 0, 0.715, 0);
  put(table, cyl(0.055, 0.075, 0.69, 12), M.walnut, 0, 0.345, 0);
  put(table, cyl(0.28, 0.30, 0.035, 20), M.walnut, 0, 0.018, 0);
  put(table, cyl(0.09, 0.075, 0.10, 14), M.ceramic, 0, 0.79, 0); // 桌上小碗
  g.add(table);

  // 三把木椅：座面顶 = 0.47（person.js kitchen 落位就在 (2.6,-0.72)，椅背必须在 -z 侧）
  const chairs = [
    [2.60, -0.72, 0],
    [1.94, -1.92, 0.94],
    [2.58, -2.06, 0],
  ];
  for (const [x, z, rot] of chairs) {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    put(c, rbox(0.42, 0.05, 0.42, 0.02, U.wood), M.walnut, 0, 0.445, 0);
    for (const lx of [-0.17, 0.17]) {
      for (const lz of [-0.17, 0.17]) put(c, cyl(0.019, 0.016, 0.42, 8), M.walnut, lx, 0.21, lz);
      put(c, cyl(0.017, 0.017, 0.46, 8), M.walnut, lx, 0.66, -0.185); // 椅背立柱
    }
    put(c, rbox(0.40, 0.34, 0.035, 0.015, U.wood), M.walnut, 0, 0.72, -0.185);
    put(c, rbox(0.36, 0.05, 0.03, 0.012, U.wood), M.walnut, 0, 0.56, -0.185);
    // 椅背上的坐垫，顺带给"点椅子 → 坐正中间"的落座信息（坐面顶 = 0.47）
    const pad = put(c, rbox(0.36, 0.03, 0.36, 0.02), M.linen, 0, 0.455, 0);
    pad.userData.pad = true;
    markSeatDeep(c, seatChair(x, z, rot));
    g.add(c);
  }

  // 餐桌吊灯
  put(g, cyl(0.006, 0.006, 0.66, 6), M.dark, cx, 2.32, cz);
  put(g, cyl(0.13, 0.19, 0.20, 18), M.shade, cx, 1.90, cz);
  put(g, cyl(0.10, 0.10, 0.012, 14), M.glow, cx, 1.815, cz);
}

/* ── 7. 墙面装饰 / 门套 ───────────────────────────────────────────── */

function buildDecor(g) {
  // 左墙：电视柜 + 壁挂深色电视屏（纯薄板，无文字）
  put(g, rbox(0.44, 0.40, 1.56, 0.02, U.wood), M.oak, -3.77, 0.20, 1.55);
  for (const z of [-0.60, 0.60]) put(g, cyl(0.018, 0.018, 0.14, 8), M.steel, -3.77, 0.07, 1.55 + z);
  put(g, slab(0.36, 0.03, 1.46, U.wood), M.oak, -3.77, 0.415, 1.55);
  put(g, slab(0.06, 0.10, 0.16, U.wood), M.dark, -3.90, 0.98, 1.55); // 挂架
  put(g, slab(0.05, 0.70, 1.20), M.screen, -3.86, 1.05, 1.55);

  // 左墙两幅画（几何色块，无文字）
  buildArt(g, -3.955, 1.78, -1.30, 0.58, 0.78, 0);
  buildArt(g, -3.955, 1.72, 0.10, 0.92, 0.60, 1);

  // 左墙前段的门套 + 门（保持关闭）
  const dz = 2.50;
  put(g, slab(0.05, 2.10, 0.07, U.wood), M.trim, -3.955, 1.05, dz - 0.47);
  put(g, slab(0.05, 2.10, 0.07, U.wood), M.trim, -3.955, 1.05, dz + 0.47);
  put(g, slab(0.05, 0.08, 1.01, U.wood), M.trim, -3.955, 2.06, dz);
  put(g, slab(0.04, 2.02, 0.86, U.wood), M.oak, -3.975, 1.01, dz);
  put(g, slab(0.04, 0.02, 0.60, U.wood), M.walnut, -3.985, 0.44, dz);
  put(g, cyl(0.016, 0.016, 0.10, 8), M.steel, -3.94, 1.02, dz + 0.33).rotation.x = Math.PI / 2;

  buildClock(g);
  buildCounterProps(g);
}

/* ── 7.1 挂钟（v1.6）──────────────────────────────────────────────
 * 12 个刻度 + 两根指针，**一个数字都不写**（3D 里不渲染任何文字，契约红线）。
 * 指针停在 10:10——钟表业的经典构图，也让「这是一只真在走的钟」一眼可辨。
 */
function buildClock(g) {
  const R = 0.155;
  const clk = new THREE.Group();
  clk.position.set(-3.925, 1.98, 1.15);

  clk.add(new THREE.Mesh(cyl(R, R, 0.05, 26, 'x'), M.clockCase));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.011, 8, 28), M.frame);
  rim.rotation.y = Math.PI / 2;
  rim.position.x = 0.022;
  clk.add(rim);
  const face = new THREE.Mesh(cyl(R - 0.012, R - 0.012, 0.008, 26, 'x'), M.paper);
  face.position.x = 0.028;
  clk.add(face);

  for (let i = 0; i < 12; i += 1) {
    const a = (i * Math.PI) / 6;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.006, i % 3 === 0 ? 0.03 : 0.017, 0.008), M.dark);
    const r = R - 0.036;
    tick.position.set(0.036, Math.cos(a) * r, Math.sin(a) * r);
    tick.rotation.x = a;
    clk.add(tick);
  }
  const hand = (length, width) => {
    const geo = new THREE.BoxGeometry(0.005, length, width);
    geo.translate(0, length / 2, 0);
    return new THREE.Mesh(geo, M.dark);
  };
  const hourHand = hand(0.082, 0.010);
  hourHand.position.x = 0.038;
  hourHand.rotation.x = ((10 + 10 / 60) / 12) * Math.PI * 2;
  clk.add(hourHand);
  const minuteHand = hand(0.115, 0.007);
  minuteHand.position.x = 0.040;
  minuteHand.rotation.x = (10 / 60) * Math.PI * 2;
  clk.add(minuteHand);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), M.frame);
  pin.position.x = 0.042;
  clk.add(pin);
  g.add(clk);
}

/* ── 7.2 厨房台面上的生活用品（v1.6）──────────────────────────────── */
function buildCounterProps(g) {
  const topY = 0.885 + 0.025;
  // 电热水壶：壶身 + 壶盖 + 手柄 + 底座
  const kettle = new THREE.Group();
  kettle.position.set(3.28, topY, -2.42);
  put(kettle, cyl(0.068, 0.078, 0.16, 18), M.steel, 0, 0.08, 0);
  put(kettle, cyl(0.070, 0.062, 0.03, 18), M.dark, 0, 0.172, 0);
  put(kettle, cyl(0.062, 0.062, 0.012, 18), M.chrome, 0, 0.008, 0);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 18, Math.PI), M.dark);
  loop.position.set(0.085, 0.095, 0);
  loop.rotation.z = -Math.PI / 2;
  kettle.add(loop);
  g.add(kettle);
  // 调料罐两只（封口用木盖，避免整排白罐子）
  for (const [x, h] of [[2.42, 0.13], [2.28, 0.10]]) {
    put(g, cyl(0.032, 0.034, h, 14), M.ceramic, x, topY + h / 2, -2.52);
    put(g, cyl(0.034, 0.034, 0.012, 14), M.walnut, x, topY + h + 0.006, -2.52);
  }
  contact(g, 2.35, -2.52, 0.42, 0.30, 0.4, 0.913);
}

function buildArt(g, x, y, z, w, h, kind) {
  // 左墙上的画：x 方向是「离墙厚度」，y 高度，z 沿墙宽度（不要旋转）
  put(g, slab(0.045, h + 0.06, w + 0.06, U.wood), M.walnut, x, y, z);
  put(g, slab(0.02, h, w, U.fabric), M.art3, x + 0.025, y, z);
  if (kind === 0) {
    put(g, slab(0.016, h * 0.34, w * 0.72), M.art1, x + 0.035, y + h * 0.20, z);
    put(g, slab(0.016, h * 0.30, w * 0.44), M.art2, x + 0.035, y - h * 0.24, z - w * 0.10);
  } else {
    put(g, slab(0.016, h * 0.44, w * 0.40), M.art2, x + 0.035, y + h * 0.06, z + w * 0.22);
    put(g, slab(0.016, h * 0.62, w * 0.26), M.art1, x + 0.035, y - h * 0.02, z - w * 0.22);
  }
}

/* ── 8. 充电座（前景中央，机器人空闲时的家） ─────────────────────── */

const SHADOW_TEX = contactShadow();

/** 在物件底下贴一张径向渐变，补上真实阴影给不了的那圈环境光遮蔽 */
function contact(g, x, z, w, d, opacity = 0.85, y = 0.016) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: SHADOW_TEX, transparent: true, opacity, depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.userData.noShadow = true; // 它本身就是阴影，不能再投影
  g.add(m);
  return m;
}

/* ── 充电桩（客厅）────────────────────────────────────────────────
 * 机器人停在 DOCK 上、**车尾对着桩**，桩柱在 DOCK 的 +z 侧。
 * 桩身：地垫 + 底座（带停车对位条）+ 立柱 + 铜排触点 + 充电灯 + 状态灯 + 绕线钩 + 进墙电缆。
 *
 * v1.6 增强：① 加一块停车地垫（黄黑对位角）；② 充电灯改成 M.charge 并**交回给 scene3d**——
 * 机器人真的停回桩上时它会呼吸（充电中），出车时熄灭。判定用「机器人位置离桩多近 + 有没有提示事件」，
 * 全是只读推算，不新增任何业务状态。
 */
function buildDock(g) {
  const d = new THREE.Group();
  d.position.set(DOCK.x, 0, DOCK.z);

  // 停车地垫：机器人停在这上面，四角对位标
  put(d, rbox(0.72, 0.014, 0.66, 0.05), M.matBoot, 0, 0.008, 0.02);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(d, slab(0.09, 0.006, 0.02), M.hazard, sx * 0.30, 0.017, sz * 0.28);
    }
  }
  // 底座：前缘做倒角，两边各一条不锈钢对位条
  put(d, rbox(0.62, 0.035, 0.52, 0.03), M.mat, 0, 0.030, 0);
  for (const sx of [-1, 1]) {
    put(d, slab(0.30, 0.010, 0.045), M.steel, sx * 0.09, 0.052, -0.17);
  }
  put(d, slab(0.62, 0.012, 0.03, U.wood), M.frame, 0, 0.048, -0.255);

  // 立柱（在机器人尾巴后面）：白壳 + 深色屏 + 铜排触点
  const colZ = 0.36;
  const shell = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.42, metalness: 0.05 });
  put(d, rbox(0.24, 0.52, 0.11, 0.035), shell, 0, 0.31, colZ);
  put(d, rbox(0.20, 0.11, 0.02, 0.012), M.dark, 0, 0.47, colZ - 0.058); // 小屏
  const chargeBar = put(d, slab(0.17, 0.016, 0.014), M.charge, 0, 0.365, colZ - 0.060); // 充电指示灯
  put(d, slab(0.17, 0.016, 0.012), M.warn, 0, 0.325, colZ - 0.060);     // 状态灯（琥珀）
  for (const sx of [-1, 1]) {
    put(d, slab(0.028, 0.075, 0.012), M.chrome, sx * 0.055, 0.125, colZ - 0.062); // 铜排触点
  }
  // 顶盖 + 绕线钩；进墙电缆只留一小段探进地板（拉一根长黑管过去，在这个尺度下像根棍子）
  put(d, rbox(0.27, 0.035, 0.14, 0.016), shell, 0, 0.585, colZ);
  put(d, cyl(0.017, 0.017, 0.09, 10), M.steel, 0.10, 0.53, colZ - 0.05);
  const cable = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 18, Math.PI * 1.3), M.dark);
  cable.position.set(0.085, 0.44, colZ - 0.03);
  cable.rotation.y = Math.PI / 2;
  d.add(cable);
  const stub = put(d, cyl(0.007, 0.007, 0.10, 8), M.dark, -0.075, 0.05, colZ + 0.04);
  stub.rotation.x = 0.22;

  g.add(d);
  contact(g, DOCK.x, DOCK.z + 0.12, 1.05, 1.05, 0.62, 0.019);
  return { chargeBar, leds: [chargeBar] };
}

/* ── 8.1 窗光光柱（v1.6）────────────────────────────────────────────
 * 斜射进来的阳光在空气里是有形的。做法很土但很有效：一张沿光线方向铺开的加法混合贴片。
 * 硬约束：**不投影、不写深度**，否则它会把整片窗光挡掉（地板就再也没有光斑了）。
 */
function buildLightShaft(g) {
  // 主光方向（与 scene3d 的 sun 一致）：从窗外左上方斜射到室内
  const dir = new THREE.Vector3(5.0, -3.05, 8.8).normalize();
  const normal = new THREE.Vector3(0, 0.944, 0.329).normalize(); // 垂直于 dir，又大致朝向主相机
  const yAxis = dir.clone();
  const zAxis = normal.clone();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();

  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 5.2),
    new THREE.MeshBasicMaterial({
      map: lightShaft({ w: 128, h: 128 }),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shaft.name = 'light-shaft';
  shaft.userData.noShadow = true;
  shaft.renderOrder = 3;
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  shaft.quaternion.setFromRotationMatrix(basis);
  shaft.position.set(0.2, 1.15, -0.55);
  g.add(shaft);

  // 贴地那一片更亮的光斑边缘（补一层很淡的暖光，让地板"被晒到"）
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4.6),
    new THREE.MeshBasicMaterial({
      map: lightShaft({ w: 128, h: 128 }),
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.rotation.z = 0.42;
  patch.position.set(1.1, 0.022, -0.2);
  patch.userData.noShadow = true;
  patch.renderOrder = 3;
  g.add(patch);
}

/* ── 构建整个房间 ─────────────────────────────────────────────────── */

/** 构建整个房间，返回 THREE.Group（`userData.dock` 里带着充电灯的引用，供 scene3d 做充电呼吸） */
export function buildRoom() {
  const group = new THREE.Group();
  group.name = 'room';
  buildFloor(group);
  buildShell(group);
  buildWindow(group);
  buildLiving(group);
  buildBedroom(group);
  buildKitchen(group);
  buildDecor(group);
  const dock = buildDock(group);
  buildLightShaft(group);
  group.userData.dock = dock;
  return group;
}

export const room = { buildRoom, WAYPOINTS, APPROACH_POINTS, DOCK };
