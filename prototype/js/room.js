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
export const DOCK = { x: -0.45, y: 0, z: 2.42 };

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

const M = {
  floor: new THREE.MeshStandardMaterial({ map: TEX.floor, roughness: 0.55, metalness: 0.02 }),
  wall: new THREE.MeshStandardMaterial({ map: TEX.wall, roughness: 0.95, metalness: 0.0 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf7f3ec, roughness: 1.0, metalness: 0.0 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xded6c7, roughness: 0.62, metalness: 0.02 }),
  oak: new THREE.MeshStandardMaterial({ map: TEX.oak, roughness: 0.62, metalness: 0.02 }),
  walnut: new THREE.MeshStandardMaterial({ map: TEX.walnut, roughness: 0.58, metalness: 0.02 }),
  stone: new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.26, metalness: 0.03 }),
  sofa: new THREE.MeshStandardMaterial({ map: TEX.sofa, roughness: 0.96, metalness: 0.0 }),
  sofaLit: new THREE.MeshStandardMaterial({ map: TEX.sofaLit, roughness: 0.96, metalness: 0.0 }),
  linen: new THREE.MeshStandardMaterial({ map: TEX.linen, roughness: 0.97, metalness: 0.0 }),
  cotton: new THREE.MeshStandardMaterial({ map: TEX.cotton, roughness: 0.97, metalness: 0.0 }),
  rug: new THREE.MeshStandardMaterial({ map: TEX.rug, roughness: 1.0, metalness: 0.0 }),
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
  shade: new THREE.MeshStandardMaterial({ color: 0xf3e6d2, roughness: 0.85, side: THREE.DoubleSide }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.4, metalness: 0.03 }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0xb9a08b, roughness: 0.8 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 1.0 }),
  art1: new THREE.MeshStandardMaterial({ color: 0xc08a6a, roughness: 0.9 }),
  art2: new THREE.MeshStandardMaterial({ color: 0x4d6d72, roughness: 0.9 }),
  art3: new THREE.MeshStandardMaterial({ color: 0xe6ddc9, roughness: 0.9 }),
  mat: new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.85 }),
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
  put(st, cyl(0.24, 0.24, 0.04, 20), M.oak, 0, 0.50, 0);
  put(st, cyl(0.035, 0.045, 0.48, 12), M.walnut, 0, 0.25, 0);
  put(st, cyl(0.18, 0.18, 0.03, 16), M.walnut, 0, 0.015, 0);
  put(st, cyl(0.07, 0.09, 0.16, 12), M.ceramic, 0, 0.60, 0);
  put(st, cyl(0.11, 0.14, 0.17, 14), M.shade, 0, 0.75, 0);
  put(st, cyl(0.06, 0.06, 0.01, 10), M.glow, 0, 0.70, 0);
  g.add(st);

  buildPlant(g);
}

function buildSofa(g) {
  // 面向 -x（王阿姨坐在 x≈2.98 的座面上，座面顶必须 = 0.49）
  const zc = 1.40;
  put(g, rbox(0.84, 0.30, 2.04, 0.03), M.sofa, 3.38, 0.23, zc); // 底架
  for (const z of [zc - 0.92, zc + 0.92]) {
    for (const x of [3.06, 3.70]) put(g, cyl(0.022, 0.022, 0.09, 10), M.walnut, x, 0.045, z);
  }
  for (const s of [-1, 1]) {
    const c = put(g, rbox(0.90, 0.17, 0.96, 0.06), M.sofaLit, 3.30, 0.405, zc + s * 0.50);
    c.rotation.z = -0.012 * s;
  }
  put(g, rbox(0.22, 0.60, 2.10, 0.05), M.sofa, 3.80, 0.62, zc); // 靠背
  for (const s of [-1, 1]) {
    const b = put(g, rbox(0.18, 0.44, 0.94, 0.05), M.sofa, 3.60, 0.615, zc + s * 0.50);
    b.rotation.z = 0.05;
  }
  for (const s of [-1, 1]) {
    put(g, rbox(0.94, 0.30, 0.20, 0.06), M.sofa, 3.35, 0.47, zc + s * 1.05); // 扶手
  }
  // 两个抱枕（靠在靠背垫上，别悬空）
  const p1 = put(g, rbox(0.34, 0.34, 0.13, 0.06), M.linen, 3.50, 0.66, zc - 0.70);
  p1.rotation.set(0.06, 0.30, 0.16);
  const p2 = put(g, rbox(0.32, 0.32, 0.13, 0.06), M.cotton, 3.50, 0.65, zc + 0.70);
  p2.rotation.set(-0.06, -0.30, -0.16);
  // 搭在扶手上的薄毯
  const throwB = put(g, rbox(0.44, 0.06, 0.50, 0.03), M.linen, 3.34, 0.64, zc + 1.05);
  throwB.rotation.z = 0.06;
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
  // 茶杯 + 一本书
  put(t, cyl(0.042, 0.036, 0.095, 14), M.ceramic, 0.26, 0.41, 0.02);
  const book = put(t, slab(0.24, 0.028, 0.17, U.fabric), M.art2, -0.24, 0.376, -0.02);
  book.rotation.y = 0.24;
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
  g.add(bed);

  // 床头柜 + 小台灯（在床的 +x 侧）
  const ns = new THREE.Group();
  ns.position.set(-1.83, 0, -2.34);
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

function buildDock(g) {
  const d = new THREE.Group();
  d.position.set(DOCK.x, 0, DOCK.z);
  put(d, rbox(0.66, 0.035, 0.66, 0.03), M.mat, 0, 0.018, 0);
  put(d, slab(0.40, 0.012, 0.05), M.steel, 0, 0.042, -0.20);
  put(d, slab(0.40, 0.012, 0.05), M.steel, 0, 0.042, 0.20);
  put(d, rbox(0.30, 0.10, 0.06, 0.02), M.dark, 0, 0.06, 0.30);
  g.add(d);
}

/* ── 构建整个房间 ─────────────────────────────────────────────────── */

/** 构建整个房间，返回 THREE.Group */
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
  buildDock(group);
  return group;
}

export const room = { buildRoom, WAYPOINTS, APPROACH_POINTS, DOCK };
