/**
 * scene2d.js —— 降级通道：WebGL 不可用时的 2D 俯视仿真（S 线）
 *
 * 契约：契约-接口.md §6（WebGL 不可用 → 走 scene2d.js，**功能一条不少**）
 * 与 scene3d.js 暴露**同一组场景 API**，所以 main.js / robot.js / person.js 无需感知差异。
 *
 * v1.7：户型换成套房（13.4 × 10.6 m，见 room.js）。这里的房间/家具矩形是 3D 户型的**俯视投影**，
 * 导航网格直接复用 `room.getNavSpec()`（与 3D 同一份墙段/家具占位），
 * 因此 `findPath` 在 2D 下也是绕墙走的 —— 不会出现"3D 不穿墙、2D 穿墙"的降级差异。
 *
 * 注意：2D 画布内同样不写字——所有文字都走 HTML 叠层（适老化数值只能在 HTML/CSS 里对账）。
 */

import { WAYPOINTS, APPROACH_POINTS, DOCK, DOCK_FACING, getNavSpec } from './room.js';
import { createNavGrid } from './navgrid.js';

/** 世界包围盒（与 room.js 的 W/D 一致：中心在原点） */
const BOUNDS = { x0: -6.7, z0: -5.3, x1: 6.7, z1: 5.3 };

/** 房间底块（世界坐标；与 room.js 的 ROOMS 一一对应） */
const ZONES = [
  { x0: -6.70, z0: -5.30, x1: -2.10, z1: -1.00, color: '#cfd6d2' }, // 卧室 A
  { x0: -2.10, z0: -5.30, x1: 0.30, z1: -2.30, color: '#c3cdd0' },  // 卫 A
  { x0: 0.30, z0: -5.30, x1: 2.60, z1: -2.30, color: '#c3cdd0' },   // 卫 B
  { x0: -2.10, z0: -2.30, x1: 2.60, z1: -1.00, color: '#d6d2c8' },  // 北走廊
  { x0: 2.60, z0: -5.30, x1: 6.70, z1: -1.00, color: '#cfd6d2' },   // 卧室 B
  { x0: -6.70, z0: -1.00, x1: -4.40, z1: 1.60, color: '#c3cdd0' },  // 独立卫生间
  { x0: -4.40, z0: -1.00, x1: -1.90, z1: 1.60, color: '#d6d2c8' },  // 西走廊 / 玄关
  { x0: -6.70, z0: 1.60, x1: -1.90, z1: 5.30, color: '#cfd6d2' },   // 卧室 C（演示里的「卧室」）
  { x0: -1.90, z0: 1.60, x1: 0.90, z1: 5.30, color: '#d9d2c4' },    // 书房
  { x0: -1.90, z0: -1.00, x1: 6.70, z1: 1.60, color: '#e2c9a3' },   // 起居 · 餐区（北带）
  { x0: 0.90, z0: 1.60, x1: 6.70, z1: 5.30, color: '#e2c9a3' },     // 起居 · 客厅（南块）
];

/** 主要家具（俯视矩形；世界坐标 x/z 为中心，w/d 为宽深） */
const FURNITURE = [
  // 卧室 A
  { x: -5.15, z: -3.25, w: 1.80, d: 2.10, color: '#f4f1ee', radius: 0.12 }, // 床
  { x: -3.75, z: -3.25, w: 0.42, d: 1.35, color: '#cbb99c', radius: 0.05 }, // 床尾长凳
  { x: -6.30, z: -4.25, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 }, // 床头柜
  { x: -6.30, z: -2.25, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 },
  { x: -2.50, z: -3.75, w: 1.70, d: 0.58, color: '#7a6249', radius: 0.05 }, // 衣柜
  // 卫 A / 卫 B / 卫 C
  { x: -1.15, z: -3.40, w: 1.60, d: 1.20, color: '#8b939a', radius: 0.08 }, // 淋浴
  { x: -0.07, z: -4.88, w: 1.30, d: 0.50, color: '#e9e4da', radius: 0.05 }, // 台盆
  { x: -0.07, z: -2.95, w: 0.45, d: 0.60, color: '#f7f7f4', radius: 0.20 }, // 坐便
  { x: 1.85, z: -4.25, w: 1.30, d: 1.15, color: '#8b939a', radius: 0.08 },
  { x: 2.00, z: -4.88, w: 1.20, d: 0.50, color: '#e9e4da', radius: 0.05 },
  { x: 1.35, z: -2.90, w: 0.45, d: 0.60, color: '#f7f7f4', radius: 0.20 },
  { x: -5.65, z: 0.05, w: 0.45, d: 0.60, color: '#f7f7f4', radius: 0.20 },
  { x: -5.55, z: 1.25, w: 1.15, d: 0.50, color: '#e9e4da', radius: 0.05 },
  // 卧室 B
  { x: 5.15, z: -3.25, w: 1.80, d: 2.10, color: '#f4f1ee', radius: 0.12 },
  { x: 3.75, z: -3.25, w: 0.42, d: 1.35, color: '#cbb99c', radius: 0.05 },
  { x: 6.30, z: -4.25, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 },
  { x: 6.30, z: -2.25, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 },
  { x: 5.00, z: -1.35, w: 1.60, d: 0.58, color: '#7a6249', radius: 0.05 },
  // 卧室 C（演示里的卧室）
  { x: -5.10, z: 3.55, w: 1.80, d: 2.10, color: '#f4f1ee', radius: 0.12 },
  { x: -3.70, z: 3.55, w: 0.42, d: 1.35, color: '#cbb99c', radius: 0.05 },
  { x: -6.30, z: 2.55, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 },
  { x: -6.30, z: 4.55, w: 0.46, d: 0.40, color: '#9d7f5d', radius: 0.05 },
  { x: -2.75, z: 1.95, w: 1.40, d: 0.58, color: '#7a6249', radius: 0.05 },
  // 书房
  { x: -0.50, z: 3.65, w: 1.55, d: 0.70, color: '#9d7f5d', radius: 0.05 },
  { x: -0.50, z: 4.43, w: 0.46, d: 0.46, color: '#8f6740', radius: 0.04 },
  { x: -0.50, z: 1.95, w: 1.45, d: 0.30, color: '#7a6249', radius: 0.04 },
  // 起居 · 餐区
  { x: 0.40, z: 0.05, w: 1.70, d: 0.95, color: '#b98a5f', radius: 0.06 },   // 餐桌
  { x: -0.05, z: -0.745, w: 0.46, d: 0.46, color: '#8f6740', radius: 0.04 }, // 餐椅（北侧两把）
  { x: 0.85, z: -0.745, w: 0.46, d: 0.46, color: '#8f6740', radius: 0.04 },
  { x: -0.05, z: 0.845, w: 0.46, d: 0.46, color: '#8f6740', radius: 0.04 },  // 餐椅（南侧两把）
  { x: 0.85, z: 0.845, w: 0.46, d: 0.46, color: '#8f6740', radius: 0.04 },
  { x: 3.55, z: -0.95, w: 2.00, d: 0.42, color: '#7a6249', radius: 0.05 },   // 北墙边柜
  { x: 1.40, z: -0.88, w: 0.90, d: 0.42, color: '#7a6249', radius: 0.05 },   // 走廊尽头边柜
  // 起居 · 客厅
  { x: 2.25, z: 3.55, w: 0.92, d: 2.30, color: '#8d97a1', radius: 0.10 },    // 沙发
  { x: 3.65, z: 3.55, w: 1.15, d: 0.62, color: '#b98a5f', radius: 0.06 },    // 茶几
  { x: 4.60, z: 2.15, w: 0.78, d: 0.80, color: '#9aa3ad', radius: 0.08 },    // 扶手椅 ×2
  { x: 4.60, z: 4.95, w: 0.78, d: 0.80, color: '#9aa3ad', radius: 0.08 },
  { x: 6.35, z: 3.10, w: 0.42, d: 1.90, color: '#6f4e34', radius: 0.06 },    // 电视柜（贴东墙）
  { x: 4.35, z: 1.00, w: 0.36, d: 0.36, color: '#2b2b2b', radius: 0.18 },    // 落地灯
  { x: 2.35, z: 4.85, w: 0.36, d: 0.36, color: '#2b2b2b', radius: 0.18 },
  { x: 4.85, z: -0.55, w: 0.50, d: 0.50, color: '#8fbf8f', radius: 0.25 },   // 绿植
  { x: 6.00, z: 4.85, w: 0.50, d: 0.50, color: '#8fbf8f', radius: 0.25 },
  { x: 2.55, z: -0.60, w: 0.50, d: 0.50, color: '#8fbf8f', radius: 0.25 },   // 北墙边柜东侧
];

/**
 * 2D 下的可坐具：矩形命中 → 吸附到坐位（与 room.js 的 `userData.seat` 同一批坐标）。
 * 契约 v1.6：2D 也必须能"点任意位置落座"，否则就不是功能一条不少。
 */
const SEATS_2D = [
  { x0: 1.76, x1: 2.74, z0: 2.36, z1: 4.74, kind: 'sofa', surfaceY: 0.50, facing: -Math.PI / 2, lockX: 2.10, clampZ: [2.55, 4.55] },
  // 餐椅（北侧朝 +z，南侧朝 −z）
  { x0: -0.28, x1: 0.18, z0: -0.975, z1: -0.515, kind: 'chair', surfaceY: 0.47, facing: 0, lockX: -0.05, lockZ: -0.745 },
  { x0: 0.62, x1: 1.08, z0: -0.975, z1: -0.515, kind: 'chair', surfaceY: 0.47, facing: 0, lockX: 0.85, lockZ: -0.745 },
  { x0: -0.28, x1: 0.18, z0: 0.615, z1: 1.075, kind: 'chair', surfaceY: 0.47, facing: Math.PI, lockX: -0.05, lockZ: 0.845 },
  { x0: 0.62, x1: 1.08, z0: 0.615, z1: 1.075, kind: 'chair', surfaceY: 0.47, facing: Math.PI, lockX: 0.85, lockZ: 0.845 },
  // 扶手椅
  { x0: 4.21, x1: 4.99, z0: 1.75, z1: 2.55, kind: 'chair', surfaceY: 0.47, facing: Math.PI * 0.72, lockX: 4.60, lockZ: 2.15 },
  { x0: 4.21, x1: 4.99, z0: 4.55, z1: 5.35, kind: 'chair', surfaceY: 0.47, facing: Math.PI * 0.28, lockX: 4.60, lockZ: 4.95 },
  // 床沿（床头在哪侧，就从对面床沿坐）
  { x0: -6.05, x1: -4.25, z0: -4.30, z1: -2.20, kind: 'bed', surfaceY: 0.56, facing: Math.PI / 2, lockX: -4.48, clampZ: [-4.20, -2.30] },
  { x0: 4.25, x1: 6.05, z0: -4.30, z1: -2.20, kind: 'bed', surfaceY: 0.56, facing: -Math.PI / 2, lockX: 4.48, clampZ: [-4.20, -2.30] },
  { x0: -6.00, x1: -4.20, z0: 2.50, z1: 4.60, kind: 'bed', surfaceY: 0.56, facing: Math.PI / 2, lockX: -4.43, clampZ: [2.60, 4.50] },
  // 床尾长凳
  { x0: -3.96, x1: -3.54, z0: -3.93, z1: -2.58, kind: 'bench', surfaceY: 0.48, facing: Math.PI / 2, lockX: -3.75, lockZ: -3.25 },
  { x0: 3.54, x1: 3.96, z0: -3.93, z1: -2.58, kind: 'bench', surfaceY: 0.48, facing: Math.PI / 2, lockX: 3.75, lockZ: -3.25 },
  { x0: -3.91, x1: -3.49, z0: 2.88, z1: 4.23, kind: 'bench', surfaceY: 0.48, facing: Math.PI / 2, lockX: -3.70, lockZ: 3.55 },
  // 书桌椅
  { x0: -0.73, x1: -0.27, z0: 4.20, z1: 4.66, kind: 'chair', surfaceY: 0.485, facing: Math.PI, lockX: -0.50, lockZ: 4.43 },
];

export function createScene2D({ container }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const actors = new Map();
  const view = { fps: 0, frames: 0, lastFpsAt: 0, mode: 'wide' };
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let pickHandler = null;
  const marker2d = { x: 0, z: 0, age: Infinity };

  /** 导航网格：与 3D 共用同一份墙段/家具占位（room.getNavSpec） */
  let nav = null;
  try {
    const spec = getNavSpec();
    nav = createNavGrid({ bounds: spec.bounds, walls: spec.walls, boxes: spec.boxes, cell: 0.1, radius: 0.22 });
  } catch (err) {
    console.warn('[scene2d] 导航网格不可用，退回直线趋近', err);
  }

  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 世界 x ∈ [−6.7, 6.7]，z ∈ [−5.3, 5.3]，等比铺满并留一圈边
    scale = Math.min(width / 14.6, height / 12.0);
    offsetX = width / 2;
    offsetY = height / 2;
  }

  function toScreen(x, z) {
    return [offsetX + x * scale, offsetY + z * scale];
  }

  function drawRect(x0, z0, x1, z1, color, r = 0) {
    const [ax, ay] = toScreen(x0, z0);
    const [bx, by] = toScreen(x1, z1);
    ctx.fillStyle = color;
    if (r >= 0.5) {
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      const rad = (Math.abs(bx - ax) + Math.abs(by - ay)) / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.roundRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), Math.max(2, r * scale));
    ctx.fill();
  }

  function drawActor(actor) {
    const pos = actor.object3D.position;
    if (actor.object3D.visible === false) return;
    const [cx, cy] = toScreen(pos.x, pos.z);
    const isRobot = actor.kind === 'robot';
    ctx.beginPath();
    ctx.arc(cx, cy, (isRobot ? 0.3 : 0.32) * scale, 0, Math.PI * 2);
    ctx.fillStyle = isRobot ? '#2f7f86' : '#d08b8b';
    ctx.fill();
    ctx.lineWidth = Math.max(2, 0.03 * scale);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  function resizeListener() {
    resize();
  }
  window.addEventListener('resize', resizeListener);
  resize();

  /* ── 点击落座（契约 §3.1）：2D 也必须支持 ─────────────────────────── */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const facingTowardsRoom = (x, z) => Math.atan2(-x, -z);

  function seatFromWorld(x, z) {
    if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return null;
    for (const s of SEATS_2D) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      let sx = s.lockX !== undefined ? s.lockX : x;
      let sz = s.lockZ !== undefined ? s.lockZ : z;
      if (s.clampX) sx = clamp(sx, s.clampX[0], s.clampX[1]);
      if (s.clampZ) sz = clamp(sz, s.clampZ[0], s.clampZ[1]);
      return { x: sx, z: sz, surfaceY: s.surfaceY, facing: s.facing, kind: s.kind };
    }
    return { x, z, surfaceY: 0, facing: facingTowardsRoom(x, z), kind: 'floor' };
  }

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (clientX - rect.left - offsetX) / scale;
    const z = (clientY - rect.top - offsetY) / scale;
    const seat = seatFromWorld(x, z);
    if (!seat) return null;
    // 只有"地板落点"才必须落在可通行区内（坐具落点本来就在家具上）
    if (seat.kind === 'floor' && nav
      && !nav.isWalkable(seat.x, seat.z)
      && nav.nearestWalkable(seat.x, seat.z, 0.6) === null) return null;
    return seat;
  }

  function onClick(event) {
    if (!pickHandler) return;
    const seat = pickAt(event.clientX, event.clientY);
    if (seat) pickHandler(seat);
  }
  canvas.addEventListener('click', onClick);

  return {
    addActor(actor) {
      actors.set(actor.id, actor);
    },
    removeActor(actorId) {
      actors.delete(actorId);
    },
    setActorPosition(actorId, location) {
      const actor = actors.get(actorId);
      const point = WAYPOINTS[location] || APPROACH_POINTS[location];
      if (!actor || !point) return;
      actor.object3D.position.set(point.x, point.y, point.z);
    },
    getWaypoint(location) {
      return WAYPOINTS[location] || null;
    },
    getApproachPoint(location, seat) {
      if (seat && Number.isFinite(Number(seat.x)) && Number.isFinite(Number(seat.z))) {
        return this.getApproachFor(seat);
      }
      const preset = APPROACH_POINTS[location] || DOCK;
      if (!nav || nav.isWalkable(preset.x, preset.z)) return preset;
      const near = nav.nearestWalkable(preset.x, preset.z, 1.2);
      return near ? { x: near.x, y: 0, z: near.z } : preset;
    },
    getApproachFor(seat) {
      if (!seat) return DOCK;
      const facing = Number(seat.facing) || 0;
      for (const d of [0, 35, -35, 70, -70, 105, -105, 150, -150, 180]) {
        const a = facing + (d * Math.PI) / 180;
        const x = Number(seat.x) + Math.sin(a) * 0.95;
        const z = Number(seat.z) + Math.cos(a) * 0.95;
        if (!nav || nav.isWalkable(x, z)) return { x, y: 0, z };
      }
      const near = nav ? nav.nearestWalkable(Number(seat.x) + Math.sin(facing) * 0.95, Number(seat.z) + Math.cos(facing) * 0.95, 1.4) : null;
      return near ? { x: near.x, y: 0, z: near.z } : { x: Number(seat.x), y: 0, z: Number(seat.z) };
    },
    getDock() {
      return DOCK;
    },
    getDockFacing() {
      return DOCK_FACING;
    },
    /** 寻路（契约 v1.7）：与 3D 同一套可通行网格 */
    findPath(from, to) {
      if (!nav || !from || !to) return null;
      return nav.findPath(from, to);
    },
    isWalkable(x, z) {
      return nav ? nav.isWalkable(x, z) : true;
    },
    /* 下面这组是 v1.5/v1.6/v1.7 新增的场景 API：2D 降级必须实现同一组函数（契约 §3.1） */
    pick(clientX, clientY) {
      return pickAt(clientX, clientY);
    },
    enablePick(fn) {
      pickHandler = typeof fn === 'function' ? fn : null;
      canvas.style.cursor = pickHandler ? 'crosshair' : '';
    },
    showPickMarker(seat) {
      if (!seat) return;
      marker2d.x = seat.x;
      marker2d.z = seat.z;
      marker2d.age = 0;
    },
    getActorPosition(actorId) {
      const actor = actors.get(actorId);
      if (!actor) return null;
      const p = actor.object3D.position;
      return { x: p.x, y: p.y, z: p.z };
    },
    setCameraMode(mode) {
      view.mode = mode;
    },
    setCameraLook() {
      /* 2D 俯视没有机位概念 */
    },
    enableOrbit() {
      /* 2D 俯视没有自由视角 */
    },
    isOrbitEnabled() {
      return false;
    },
    resetCamera() {
      /* 2D 俯视没有机位概念 */
    },
    focusSeat() {
      /* v1.9：2D 俯视本来就把整户画在一屏里，"点哪看哪"不需要 —— 恒返回 null */
      return null;
    },
    focusPair() {
      /* v1.14：同理，2D 俯视整户同屏，"给她和机器人取景"不需要 —— 恒返回 null（功能一条不少） */
      return null;
    },
    getFocusPose() {
      return null;
    },
    isCameraMoving() {
      return false;
    },
    setAutoFrame() {
      return false;
    },
    isAutoFrame() {
      return false;
    },
    setTimeOfDay() {
      /* 2D 是平涂色块，没有光照概念 */
    },
    getTimeOfDay() {
      return 'day';
    },
    getCameraMode() {
      return view.mode;
    },
    setShadows() {
      /* 2D 降级下无阴影概念 */
    },
    showNavGrid() {
      return false;
    },
    navStats() {
      return nav ? nav.stats() : null;
    },
    render(state, dt = 0) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#e8dccb';
      ctx.fillRect(0, 0, width, height);

      for (const z of ZONES) drawRect(z.x0, z.z0, z.x1, z.z1, z.color);
      for (const item of FURNITURE) {
        drawRect(item.x - item.w / 2, item.z - item.d / 2, item.x + item.w / 2, item.z + item.d / 2, item.color, item.radius);
      }

      // 充电桩（客厅电视旁）
      drawRect(DOCK.x - 0.36, DOCK.z - 0.33, DOCK.x + 0.36, DOCK.z + 0.33, '#565f63', 0.04);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        drawRect(DOCK.x + dx * 0.28 - 0.06, DOCK.z + dz * 0.26 - 0.02, DOCK.x + dx * 0.28 + 0.06, DOCK.z + dz * 0.26 + 0.02, '#d8a13c', 0.01);
      }

      for (const actor of actors.values()) drawActor(actor);

      // 点击落座标记：扩散淡出，与 3D 同义（纯视觉反馈）
      if (marker2d.age < Infinity) {
        marker2d.age += Math.max(0, dt);
        const k = Math.min(1, marker2d.age / 0.9);
        const [mx, my] = toScreen(marker2d.x, marker2d.z);
        ctx.beginPath();
        ctx.arc(mx, my, (0.22 + k * 0.34) * scale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(47,127,134,${0.9 * (1 - k)})`;
        ctx.lineWidth = Math.max(2, 0.05 * scale);
        ctx.stroke();
        if (k >= 1) marker2d.age = Infinity;
      }

      view.frames += 1;
      const now = performance.now();
      if (now - view.lastFpsAt >= 1000) {
        view.fps = Math.round((view.frames * 1000) / (now - view.lastFpsAt));
        view.frames = 0;
        view.lastFpsAt = now;
      }
    },
    getFps() {
      return view.fps;
    },
    dispose() {
      window.removeEventListener('resize', resizeListener);
      canvas.removeEventListener('click', onClick);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
    kind: '2d',
  };
}

export const scene2d = { createScene2D };
