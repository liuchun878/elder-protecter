/**
 * scene2d.js —— 降级通道：WebGL 不可用时的 2D 俯视仿真（S 线）
 *
 * 契约：契约-接口.md §6（WebGL 不可用 → 走 scene2d.js，**功能一条不少**）
 * 与 scene3d.js 暴露**同一组场景 API**，所以 main.js / robot.js / person.js 无需感知差异。
 *
 * 注意：2D 画布内同样不写字——所有文字都走 HTML 叠层（适老化数值只能在 HTML/CSS 里对账）。
 * 本文件的桌椅坐标与 room.js 保持一致；两处若改动需同步（同一人拥有这两个文件）。
 */

import { WAYPOINTS, APPROACH_POINTS, DOCK } from './room.js';

const ZONES = [
  { x: 2.05, z: 1.5, w: 3.8, d: 2.9, color: '#e2c9a3' }, // 客厅
  { x: -2.6, z: -1.55, w: 2.8, d: 2.8, color: '#cfd6d2' }, // 卧室
  { x: 2.2, z: -1.6, w: 3.6, d: 2.8, color: '#cfd6d2' }, // 厨房
];

const FURNITURE = [
  // ⚠️ 这些坐标必须与 room.js 保持一致（同一人拥有这两个文件，改一处要同步另一处）
  { x: 3.38, z: 1.4, w: 0.84, d: 2.04, color: '#8d97a1', radius: 0.1 }, // 沙发
  { x: 0.15, z: 1.35, w: 0.92, d: 0.54, color: '#b98a5f', radius: 0.08 }, // 茶几
  { x: -2.95, z: -1.55, w: 1.62, d: 2.02, color: '#f4f1ee', radius: 0.12 }, // 床
  { x: -2.95, z: -2.4, w: 1.54, d: 0.12, color: '#9d7148', radius: 0.04 }, // 床头板
  { x: -1.83, z: -2.34, w: 0.46, d: 0.44, color: '#b98a5f', radius: 0.05 }, // 床头柜
  { x: -3.76, z: 0.28, w: 0.44, d: 1.34, color: '#b98a5f', radius: 0.05 }, // 五斗柜
  { x: 3.13, z: -2.68, w: 1.63, d: 0.6, color: '#e3d3c0', radius: 0.06 }, // 厨房台面（主）
  { x: 3.64, z: -1.65, w: 0.58, d: 1.44, color: '#e3d3c0', radius: 0.06 }, // 厨房台面（转角）
  { x: 2.55, z: -1.38, w: 1.16, d: 1.16, color: '#b98a5f', radius: 0.6 }, // 餐桌
  { x: 2.6, z: -0.72, w: 0.42, d: 0.42, color: '#8f6740', radius: 0.04 }, // 餐椅（person.js 落位）
  { x: 1.94, z: -1.92, w: 0.42, d: 0.42, color: '#8f6740', radius: 0.04 },
  { x: 2.58, z: -2.06, w: 0.42, d: 0.42, color: '#8f6740', radius: 0.04 },
  { x: 3.45, z: -0.05, w: 0.48, d: 0.48, color: '#b98a5f', radius: 0.04 }, // 边几
  { x: -3.55, z: 0.9, w: 1.7, d: 0.44, color: '#8f6740', radius: 0.04 }, // 电视柜
  { x: 3.62, z: 2.62, w: 0.5, d: 0.5, color: '#8fbf8f', radius: 0.25 }, // 绿植
  { x: -3.4, z: 0.2, w: 0.5, d: 0.5, color: '#8fbf8f', radius: 0.25 }, // 绿植
];

/**
 * 2D 降级下的可坐具（与 room.js 的 `userData.seat` 一一对应，改一处要同步另一处）。
 * 契约 v1.6：2D 也必须能「点任意位置落座」，否则功能就不是一条不少。
 */
const SEATS_2D = [
  { x0: 2.86, x1: 3.92, z0: 0.34, z1: 2.46, kind: 'sofa', surfaceY: 0.49, facing: -Math.PI / 2, lockX: 2.99, clampZ: [0.66, 2.14] },
  { x0: 2.39, x1: 2.81, z0: -0.93, z1: -0.51, kind: 'chair', surfaceY: 0.47, facing: 0, lockX: 2.60, lockZ: -0.72 },
  { x0: 1.73, x1: 2.15, z0: -2.13, z1: -1.71, kind: 'chair', surfaceY: 0.47, facing: 0.94, lockX: 1.94, lockZ: -1.92 },
  { x0: 2.37, x1: 2.79, z0: -2.27, z1: -1.85, kind: 'chair', surfaceY: 0.47, facing: 0, lockX: 2.58, lockZ: -2.06 },
  { x0: -3.80, x1: -2.10, z0: -2.60, z1: -0.50, kind: 'floor', surfaceY: 0, facing: Math.PI / 2, lockX: -2.02, clampZ: [-2.22, -0.95] },
];

const ROOM_ANCHOR = { x: 0.8, z: 0.6 };

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

  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 世界 x ∈ [-4.4, 4.4]，z ∈ [-3.4, 3.4] 等比铺满
    scale = Math.min(width / 9.2, height / 7.2);
    offsetX = width / 2;
    offsetY = height / 2;
  }

  function toScreen(x, z) {
    return [offsetX + x * scale, offsetY + z * scale];
  }

  function drawZone(zone) {
    const [cx, cy] = toScreen(zone.x, zone.z);
    ctx.fillStyle = zone.color;
    ctx.fillRect(cx - (zone.w * scale) / 2, cy - (zone.d * scale) / 2, zone.w * scale, zone.d * scale);
  }

  function drawFurniture(item) {
    const [cx, cy] = toScreen(item.x, item.z);
    ctx.fillStyle = item.color;
    if (item.radius >= 0.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, item.w * scale * 0.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.roundRect(cx - (item.w * scale) / 2, cy - (item.d * scale) / 2, item.w * scale, item.d * scale, Math.max(2, item.radius * scale));
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

  /* ── 点击落座（v1.6，契约 §3.1）：2D 也必须支持，否则"功能一条不少"不成立 ── */
  const clampRoomX = (x) => Math.min(3.55, Math.max(-3.55, x));
  const clampRoomZ = (z) => Math.min(2.5, Math.max(-2.55, z));
  const facingTowardsRoom = (x, z) => Math.atan2(ROOM_ANCHOR.x - x, ROOM_ANCHOR.z - z);

  function seatFromWorld(x, z) {
    for (const s of SEATS_2D) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      let sx = s.lockX !== undefined ? s.lockX : x;
      let sz = s.lockZ !== undefined ? s.lockZ : z;
      if (s.clampZ) sz = Math.min(s.clampZ[1], Math.max(s.clampZ[0], sz));
      return { x: sx, z: sz, surfaceY: s.surfaceY, facing: s.facing, kind: s.kind };
    }
    const fx = clampRoomX(x);
    const fz = clampRoomZ(z);
    return { x: fx, z: fz, surfaceY: 0, facing: facingTowardsRoom(fx, fz), kind: 'floor' };
  }

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // 画布内的 CSS 像素 → 世界坐标（俯视图，等比）
    const x = (clientX - rect.left - offsetX) / scale;
    const z = (clientY - rect.top - offsetY) / scale;
    if (x < -4.4 || x > 4.4 || z < -3.4 || z > 3.4) return null;
    return seatFromWorld(x, z);
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
        return {
          x: clampRoomX(Number(seat.x) + Math.sin(Number(seat.facing) || 0) * 0.95),
          y: 0,
          z: clampRoomZ(Number(seat.z) + Math.cos(Number(seat.facing) || 0) * 0.95),
        };
      }
      return APPROACH_POINTS[location] || DOCK;
    },
    getApproachFor(seat) {
      return seat ? this.getApproachPoint(null, seat) : DOCK;
    },
    getDock() {
      return DOCK;
    },
    /* v1.6 新增的场景 API：2D 降级必须实现同一组函数（契约 §3.1） */
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
    /* 下面这组是 v1.5 新增的场景 API：2D 降级必须实现同一组函数（契约 §3.1） */
    enableOrbit() {
      /* 2D 俯视没有自由视角 */
    },
    isOrbitEnabled() {
      return false;
    },
    resetCamera() {
      /* 2D 俯视没有机位概念 */
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
    render(state, dt = 0) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#e8dccb';
      ctx.fillRect(0, 0, width, height);

      for (const zone of ZONES) drawZone(zone);
      for (const item of FURNITURE) drawFurniture(item);

      const [dx, dy] = toScreen(DOCK.x, DOCK.z);
      ctx.strokeStyle = '#8d99a6';
      ctx.lineWidth = Math.max(2, 0.04 * scale);
      ctx.strokeRect(dx - 0.4 * scale, dy - 0.4 * scale, 0.8 * scale, 0.8 * scale);

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
