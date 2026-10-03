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
  { x: 3.35, z: 1.4, w: 0.9, d: 2.0, color: '#7fb3c8', radius: 0.1 }, // 沙发
  { x: 0.15, z: 1.35, w: 1.0, d: 0.62, color: '#b98a5f', radius: 0.08 }, // 茶几
  { x: -2.75, z: -1.6, w: 1.6, d: 1.95, color: '#f4f1ee', radius: 0.12 }, // 床
  { x: 2.6, z: -2.7, w: 2.4, d: 0.6, color: '#e3d3c0', radius: 0.06 }, // 台面
  { x: 2.6, z: -1.45, w: 1.24, d: 1.24, color: '#b98a5f', radius: 0.6 }, // 餐桌
  { x: -2.5, z: 0.9, w: 0.62, d: 0.5, color: '#b98a5f', radius: 0.06 }, // 边几
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
    getApproachPoint(location) {
      return APPROACH_POINTS[location] || DOCK;
    },
    getDock() {
      return DOCK;
    },
    setCameraMode(mode) {
      view.mode = mode;
    },
    getCameraMode() {
      return view.mode;
    },
    setShadows() {
      /* 2D 降级下无阴影概念 */
    },
    render() {
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
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
    kind: '2d',
  };
}

export const scene2d = { createScene2D };
