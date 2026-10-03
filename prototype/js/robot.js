/**
 * robot.js —— 机器人本体 + 行为动画（R 线）
 *
 * 契约：契约-接口.md §1.1（机器人行为必须是 StateSnapshot 的**纯函数**，不许自己再写业务状态机）
 *       §3.1 场景 API
 *
 * 它只做四件事：走到 presence.location、**开舱递药**、提示时发光、空闲回充电座。
 * 「到点该不该送」「送完算不算确认」全部由 H 的 machine.js 决定——本文件不判断业务。
 *
 * ── 造型依据（两处，都说清楚）────────────────────────────────────────
 * ① **底盘**照真实样机 UNNC-AGV（`unnc-sophicar/UNNC-AGV-P-1.STEP` 实测）：
 *    总体 442(X)×402(Z)，Ø154 差速驱动轮（x=±0.198，轮轴离地 0.077）由 MD36LP27 电机
 *    经联轴器驱动，前后两个 Ø38 万向轮（z=±0.183），底板 400×400 在 y=0.047，
 *    底盘发光带贴底板四周。
 * ② **机身**照参考片：白色圆润立柱机身 + **正面上半部一整块深色舱门**（两扇对开）+
 *    独立头部（颈部 + 摄像头 + 灯环）+ 右侧木纹饰板 + 中部灯带。
 *    仓库里本来就有 `小车外壳-V1.SLDPRT`，所以「真机底盘 + 外壳」不是臆造。
 *
 * ── 递药动作（本次改的重点）──────────────────────────────────────────
 * 旧版是「顶上一个托盘升起来」。新版是**从身体中间打开、把托盘推出来**：
 *   两扇舱门对开（~106°） → 托盘前伸（0.19 m） → 托盘上是**一杯温水 + 一个药盒**
 *   （盒盖掀开、药片可见）。
 * 姿态仍然是 state 的纯函数：`activeEventId` 有值且已到位 → 开舱；取走后合上。
 *
 * **只借结构，不借资产**：全部是 Box / Cylinder / Sphere / Torus / Extrude 拼的，
 * 仓库里不落任何 CAD 文件、网格或贴图（红线：断网可用、无外部模型资产）。
 */

import * as THREE from 'three';
import { wood, stone } from './textures.js';

const SHELL = 0xf4f4f2; // 机身白
const SHELL_DIM = 0xdfe0dd; // 侧面/收边
const GLASS_DARK = 0x1c2a31; // 舱门玻璃
const INNER = 0x2a3339; // 舱内
const TRIM = 0x8d949a; // 密封条 / 装饰线
const TEAL = 0x4fc7d8; // 灯带
const ORANGE = 0xe8863c; // 指示灯
const TIRE = 0x24282c;
const HUB = 0xb9c0c6;
const MOTOR = 0x3d434a;
const ALU = 0x9aa4ad;

const SPEED = 1.2; // m/s（预置路径动画，不宣称导航能力）
const OPEN_TIME = 0.9; // 开舱全程（门先开、托盘后出），秒
const DOOR_ANGLE = 2.24; // 舱门开合角（rad ≈ 128°）：开到底贴到机身两侧，不挡托盘上的东西
const SHELF_OUT = 0.19; // 托盘前伸距离（m）

/* 关键高度（米）：底盘沿用真机实测，机身按参考片 */
const Y = {
  deck: 0.047,
  bodyBottom: 0.1,
  bodyTop: 1.02,
  shelf: 0.78,
  hatchBottom: 0.55,
  hatchTop: 0.92,
  neck: 1.15,
};

const BODY = { w: 0.4, d: 0.36, r: 0.045 };
const HATCH = { w: 0.3, h: 0.38, leaf: 0.152, t: 0.016, back: 0.12 };

function mat(color, roughness = 0.6, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, ...extra });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(rTop, rBot, h, material, seg = 20, axis = 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  return m;
}

/**
 * XZ 平面上的矩形轮廓，**四个角可以分别给半径**（顺序：-x-z, +x-z, +x+z, -x+z）。
 * 机身正面要开一个方舱口，两侧墙板只有「外侧靠前」那两个角需要跟机身同半径，
 * 内侧靠开口的角必须是直角——所以不能用统一的 roundedSlab。
 */
function rectShape(w, d, radii) {
  const [r00, r10, r11, r01] = radii;
  const hw = w / 2;
  const hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + r00, -hd);
  s.lineTo(hw - r10, -hd);
  if (r10) s.quadraticCurveTo(hw, -hd, hw, -hd + r10); else s.lineTo(hw, -hd);
  s.lineTo(hw, hd - r11);
  if (r11) s.quadraticCurveTo(hw, hd, hw - r11, hd); else s.lineTo(hw, hd);
  s.lineTo(-hw + r01, hd);
  if (r01) s.quadraticCurveTo(-hw, hd, -hw, hd - r01); else s.lineTo(-hw, hd);
  s.lineTo(-hw, -hd + r00);
  if (r00) s.quadraticCurveTo(-hw, -hd, -hw + r00, -hd); else s.lineTo(-hw, -hd);
  return s;
}

/** 把轮廓沿 y 挤出成板，局部原点在**底面中心** */
function extrudeSlab(shape, h, curveSegments = 6, bevel = 0.012) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h - bevel * 4),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  geo.rotateX(-Math.PI / 2); // 挤出方向 +z → +y
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // 底面贴 y=0
  return geo;
}

/** 带圆角的方板（四角同半径） */
function roundedSlab(w, d, h, r, curveSegments = 6, bevel = 0.012) {
  return extrudeSlab(rectShape(w, d, [r, r, r, r]), h, curveSegments, bevel);
}

function buildRobot() {
  const group = new THREE.Group();
  group.name = 'robot';

  const M = {
    shell: mat(SHELL, 0.42, { metalness: 0.04 }),
    shellDim: mat(SHELL_DIM, 0.5),
    glass: mat(GLASS_DARK, 0.18, { metalness: 0.25 }),
    inner: mat(INNER, 0.85),
    trim: mat(TRIM, 0.4, { metalness: 0.4 }),
    tire: mat(TIRE, 0.92),
    hub: mat(HUB, 0.4, { metalness: 0.35 }),
    motor: mat(MOTOR, 0.55, { metalness: 0.25 }),
    alu: mat(ALU, 0.5, { metalness: 0.18 }),
    wood: new THREE.MeshStandardMaterial({ map: wood({ tone: 0xb98a5c, seed: 5 }), roughness: 0.55 }),
    tray: new THREE.MeshStandardMaterial({ map: stone({ tone: 0xf0eeea, seed: 91 }), roughness: 0.35 }),
  };

  /* ══ ① 底盘：真机 UNNC-AGV 的行走部分（保留可见）══════════════════ */
  group.add(box(0.4, 0.008, 0.4, M.alu, 0, Y.deck, 0)); // 底板

  for (const s of [-1, 1]) {
    const wheel = cyl(0.077, 0.077, 0.046, M.tire, 26, 'x');
    wheel.position.set(s * 0.198, 0.077, 0);
    group.add(wheel);
    const hub = cyl(0.034, 0.034, 0.052, M.hub, 16, 'x');
    hub.position.set(s * 0.198, 0.077, 0);
    group.add(hub);

    const motor = cyl(0.0185, 0.0185, 0.135, M.motor, 16, 'x');
    motor.position.set(s * 0.0955, 0.077, 0);
    group.add(motor);
    const coup = cyl(0.026, 0.026, 0.026, M.hub, 14, 'x');
    coup.position.set(s * 0.1615, 0.077, 0);
    group.add(coup);
    group.add(box(0.04, 0.05, 0.042, M.alu, s * 0.0655, 0.107, 0));
  }

  for (const s of [-1, 1]) {
    const z = s * 0.183;
    group.add(box(0.036, 0.03, 0.03, M.alu, 0, 0.09, z));
    group.add(box(0.02, 0.05, 0.03, M.alu, 0, 0.055, z - s * 0.014));
    const w = cyl(0.019, 0.019, 0.03, M.tire, 14, 'z');
    w.position.set(0, 0.027, z - s * 0.014);
    group.add(w);
  }

  // 底盘发光带（契约里的「发光环」）
  const ringMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 0.9, roughness: 0.4,
  });
  const ring = new THREE.Group();
  ring.name = 'robot-ring';
  const bandY = Y.deck - 0.01;
  const half = 0.204;
  ring.add(box(0.416, 0.012, 0.01, ringMat, 0, bandY, half));
  ring.add(box(0.416, 0.012, 0.01, ringMat, 0, bandY, -half));
  ring.add(box(0.01, 0.012, 0.416, ringMat, half, bandY, 0));
  ring.add(box(0.01, 0.012, 0.416, ringMat, -half, bandY, 0));
  group.add(ring);

  /* ══ ② 机身外壳：白色圆润立柱，**正面真的开了一个方舱口** ═════════
   * 不能只把一块深色盒子塞进实心机身里——那是看不见的。机身必须切成
   * 上段 + 下段 + 舱口两侧墙板 + 后壁，中间才是真正的空腔。
   */
  const hatchMid = (Y.hatchBottom + Y.hatchTop) / 2;
  const faceZ = BODY.d / 2;

  const lower = new THREE.Mesh(roundedSlab(BODY.w, BODY.d, Y.hatchBottom - Y.bodyBottom, BODY.r), M.shell);
  lower.position.y = Y.bodyBottom;
  group.add(lower);

  const upper = new THREE.Mesh(roundedSlab(BODY.w, BODY.d, Y.bodyTop - Y.hatchTop, BODY.r), M.shell);
  upper.position.y = Y.hatchTop;
  group.add(upper);

  // 舱口两侧的墙板：外侧两个角跟机身同半径，靠开口的两个角是直角
  const sideW = (BODY.w - HATCH.w) / 2;
  for (const s of [-1, 1]) {
    const radii = s < 0
      ? [BODY.r, 0, 0, BODY.r] // 左墙：外(= -x) 前后角圆
      : [0, BODY.r, BODY.r, 0]; // 右墙：外(= +x) 前后角圆
    const panel = new THREE.Mesh(extrudeSlab(rectShape(sideW, BODY.d, radii), HATCH.h), M.shell);
    panel.position.set(s * (HATCH.w / 2 + sideW / 2), Y.hatchBottom, 0);
    group.add(panel);
  }

  // 舱口后壁
  const backPanel = new THREE.Mesh(extrudeSlab(rectShape(HATCH.w, 0.08, [0, 0, 0, 0]), HATCH.h, 2, 0), M.shell);
  backPanel.position.set(0, Y.hatchBottom, -BODY.d / 2 + 0.04);
  group.add(backPanel);

  // 舱内衬（深色）：背 / 左右 / 上 / 下 五片，开门后能看见里面的黑腔
  const cavBackZ = -BODY.d / 2 + HATCH.back;
  const cavDepth = faceZ - cavBackZ;
  const cavMidZ = (cavBackZ + faceZ) / 2;
  group.add(box(HATCH.w, HATCH.h, 0.008, M.inner, 0, hatchMid, cavBackZ + 0.004));
  for (const s of [-1, 1]) {
    group.add(box(0.008, HATCH.h, cavDepth, M.inner, s * (HATCH.w / 2 - 0.004), hatchMid, cavMidZ));
  }
  group.add(box(HATCH.w, 0.008, cavDepth, M.inner, 0, Y.hatchBottom + 0.004, cavMidZ));
  group.add(box(HATCH.w, 0.008, cavDepth, M.inner, 0, Y.hatchTop - 0.004, cavMidZ));

  // 底座收边（比机身略宽一圈，像参考片里的底环）
  const skirt = new THREE.Mesh(roundedSlab(BODY.w + 0.03, BODY.d + 0.03, 0.055, BODY.r + 0.012, 6, 0.008), M.shellDim);
  skirt.position.y = Y.bodyBottom - 0.02;
  group.add(skirt);

  /* ── 开口四周的密封条 ──────────────────────────────────────────── */
  group.add(box(HATCH.w + 0.03, 0.012, 0.024, M.trim, 0, Y.hatchTop + 0.006, faceZ - 0.008));
  group.add(box(HATCH.w + 0.03, 0.012, 0.024, M.trim, 0, Y.hatchBottom - 0.006, faceZ - 0.008));
  for (const s of [-1, 1]) {
    group.add(box(0.012, HATCH.h + 0.02, 0.024, M.trim, s * (HATCH.w / 2 + 0.006), hatchMid, faceZ - 0.008));
  }

  /* ── 两扇对开舱门（铰链在左右两侧）────────────────────────────── */
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * (HATCH.w / 2), hatchMid, faceZ - 0.002);
    group.add(hinge);

    const leafZ = 0.008;
    hinge.add(box(HATCH.leaf, HATCH.h, HATCH.t, M.glass, -s * HATCH.leaf / 2, 0, leafZ));
    // 门上的白色边框，避免整块黑
    const fw = 0.014;
    hinge.add(box(fw, HATCH.h, HATCH.t + 0.004, M.shell, -s * fw / 2, 0, leafZ));
    hinge.add(box(HATCH.leaf, fw, HATCH.t + 0.004, M.shell, -s * HATCH.leaf / 2, HATCH.h / 2 - fw / 2, leafZ));
    hinge.add(box(HATCH.leaf, fw, HATCH.t + 0.004, M.shell, -s * HATCH.leaf / 2, -HATCH.h / 2 + fw / 2, leafZ));
    // 门把手
    const knob = cyl(0.006, 0.006, 0.03, M.trim, 10, 'y');
    knob.position.set(-s * (HATCH.leaf - 0.026), 0, 0.02);
    hinge.add(knob);

    doors.push({ hinge, side: s });
  }

  /* ── 托盘：盘面 + 挡边 + 导轨 ═══════════════════════════════════ */
  const shelf = new THREE.Group();
  shelf.name = 'robot-shelf';
  group.add(shelf);

  shelf.add(box(0.27, 0.014, 0.20, M.tray, 0, 0, 0));
  shelf.add(box(0.29, 0.016, 0.016, M.trim, 0, 0.011, -0.092));
  for (const s of [-1, 1]) {
    shelf.add(box(0.014, 0.016, 0.20, M.trim, s * 0.138, 0.011, 0));
    shelf.add(box(0.018, 0.016, 0.28, M.alu, s * 0.09, -0.014, -0.03));
  }

  // 温水杯：杯壁 + 水体 + 杯垫
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.03, metalness: 0.0,
    transparent: true, opacity: 0.16, depthWrite: false,
    side: THREE.DoubleSide, envMapIntensity: 2.2,
  });
  const g = cyl(0.034, 0.029, 0.098, glassMat, 20);
  g.position.set(-0.072, 0.056, 0.012);
  shelf.add(g);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x8ec6dd, roughness: 0.04, metalness: 0.0,
    transparent: true, opacity: 0.86, envMapIntensity: 1.5,
  });
  const w = cyl(0.0305, 0.027, 0.066, waterMat, 20);
  w.position.set(-0.072, 0.042, 0.012);
  shelf.add(w);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0335, 0.0026, 8, 22), glassMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-0.072, 0.105, 0.012);
  shelf.add(rim);
  const coaster = cyl(0.046, 0.046, 0.006, M.trim, 18);
  coaster.position.set(-0.072, 0.01, 0.012);
  shelf.add(coaster);

  // 药盒：盒体 + 掀开的盒盖 + 里面的药片
  const pillMat = mat(0xf2f3f1, 0.5);
  const pillBody = box(0.105, 0.034, 0.085, pillMat, 0.072, 0.024, 0.0);
  shelf.add(pillBody);
  shelf.add(box(0.09, 0.006, 0.07, mat(0xd8d3c8, 0.7), 0.072, 0.038, 0.0));
  const lid = box(0.105, 0.008, 0.085, pillMat);
  lid.geometry.translate(0, 0, -0.0425);
  lid.position.set(0.072, 0.03, 0.043);
  lid.rotation.x = -2.0; // 掀开
  shelf.add(lid);
  const pillMats = [mat(0xf7f4ea, 0.4), mat(0xe9d9a8, 0.45), mat(0xdce8ef, 0.4)];
  for (let i = 0; i < 5; i += 1) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 8), pillMats[i % 3]);
    p.scale.y = 0.52;
    p.position.set(0.045 + (i % 3) * 0.024, 0.044, -0.015 + Math.floor(i / 3) * 0.026);
    shelf.add(p);
  }

  /* ── 右侧木纹饰板 + 中部灯带 ───────────────────────────────────── */
  group.add(box(0.014, 0.3, 0.16, M.wood, BODY.w / 2 - 0.002, 0.86, 0.02));
  group.add(box(0.012, 0.3, 0.02, M.trim, BODY.w / 2 - 0.008, 0.86, -0.062));

  const stripMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 1.0, roughness: 0.35,
  });
  const strip = box(0.2, 0.013, 0.008, stripMat, 0, Y.hatchTop + 0.045, faceZ + 0.002);
  group.add(strip);

  // 下沿的进气格栅 + 传感器窗
  for (const y of [0.24, 0.29]) {
    group.add(box(0.2, 0.012, 0.008, M.inner, 0, y, faceZ + 0.001));
  }
  group.add(box(0.07, 0.03, 0.01, M.glass, 0, 0.19, faceZ + 0.002));

  /* ── 头部：颈部 + 摄像头 + 灯环 ═════════════════════════════════ */
  const neck = cyl(0.03, 0.036, 0.12, M.trim, 16);
  neck.position.y = (Y.bodyTop + Y.neck) / 2 - 0.01;
  group.add(neck);

  const head = new THREE.Mesh(roundedSlab(0.215, 0.165, 0.125, 0.056, 8, 0.01), M.shell);
  head.position.y = Y.neck - 0.01;
  group.add(head);

  const headFace = Y.neck + 0.045;
  group.add(box(0.115, 0.065, 0.02, M.inner, -0.024, headFace, 0.078));
  const lens = cyl(0.023, 0.023, 0.02, M.glass, 18, 'z');
  lens.position.set(-0.024, headFace, 0.088);
  group.add(lens);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.0055, 8, 22), stripMat);
  lensRing.position.set(-0.024, headFace, 0.089);
  group.add(lensRing);
  for (const s of [-1, 1]) {
    group.add(box(0.006, 0.045, 0.11, M.inner, s * 0.107, headFace, -0.005));
  }

  /* ── 橙色状态灯（提示时脉冲）────────────────────────────────────── */
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 14, 12),
    new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  beacon.position.set(0.13, 0.53, faceZ + 0.004);
  group.add(beacon);

  return { group, ring, doors, shelf, beacon, strip, cargo: [g, w, coaster, pillBody, lid] };
}

export function createRobot(sceneApi) {
  const { group, ring, doors, shelf, beacon, strip, cargo } = buildRobot();

  /** 仅视觉状态（不是业务状态）：位置积分、朝向、开舱进度 */
  const view = {
    open: 0, // 0 关 → 1 全开（门 + 托盘）
    openTarget: 0,
    facing: 0,
    pulse: 0,
  };

  /** 把 0→1 的开舱进度分配成「门先开、托盘后出」 */
  function layout() {
    const p = view.open;
    const ease = (t) => 1 - ((1 - t) ** 3);
    const doorK = ease(Math.min(1, p / 0.55));
    const shelfK = ease(Math.max(0, Math.min(1, (p - 0.3) / 0.7)));

    for (const { hinge, side } of doors) {
      hinge.rotation.y = side * DOOR_ANGLE * doorK; // 往外开（往舱内转会穿过舱壁）
    }
    shelf.position.set(0, Y.shelf, 0.05 + SHELF_OUT * shelfK);
  }

  const dock = sceneApi.getDock();
  group.position.set(dock.x, 0, dock.z);
  layout();
  sceneApi.addActor({ id: 'robot', kind: 'robot', object3D: group, radius: 0.3 });

  function stepTowards(target, dt) {
    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.012) return true;
    const step = Math.min(distance, SPEED * Math.max(dt, 0));
    group.position.x += (dx / distance) * step;
    group.position.z += (dz / distance) * step;
    view.facing = Math.atan2(dx, dz);
    return false;
  }

  /**
   * state 的纯函数（除视觉插值外不持有任何业务状态）
   * @param {object} state StateSnapshot
   * @param {number} dt 秒
   */
  function update(state, dt) {
    const carrying = Boolean(state.activeEventId);
    const location = state.presence.location;
    const target = carrying ? sceneApi.getApproachPoint(location) : dock;

    const arrived = stepTowards(target, dt);

    // 到位后转身面对人（送货时），而不是继续朝着行进方向——否则永远是背影对着老人
    if (arrived && carrying) {
      const person = sceneApi.getWaypoint(location);
      if (person) {
        view.facing = Math.atan2(person.x - group.position.x, person.z - group.position.z);
      }
    }

    // 平滑转向（视觉缓冲，避免瞬间转头）
    const delta = ((view.facing - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    group.rotation.y += delta * Math.min(1, dt * 8);

    // 开舱：只在「有提示事件且已到位」时打开，OPEN_TIME 秒走完全程
    view.openTarget = carrying && arrived ? 1 : 0;
    const step = Math.max(0, dt) / OPEN_TIME;
    view.open += Math.max(-step, Math.min(step, view.openTarget - view.open));
    layout();

    // 杯与药盒只在「有提示事件」时出现在托盘上；取走后（activeEventId 清空）消失
    for (const node of cargo) node.visible = carrying;

    // 提示时的发光脉冲（灯效与通道切换同步，不只靠颜色：HUD 同步换大字）
    view.pulse += dt;
    const attempts = state.activeEventId
      ? state.events.find((event) => event.id === state.activeEventId)?.attempts.length ?? 0
      : 0;
    const base = carrying ? 0.85 + 0.45 * Math.sin(view.pulse * (attempts > 1 ? 9 : 4)) : 0.35;
    ring.traverse((node) => {
      if (node.isMesh) node.material.emissiveIntensity = base;
    });
    strip.material.emissiveIntensity = carrying ? 0.9 + 0.4 * Math.sin(view.pulse * 3) : 0.55;
    beacon.material.emissiveIntensity = carrying ? 0.9 : 0.25;
  }

  return { group, update, id: 'robot' };
}

export const robot = { createRobot };
