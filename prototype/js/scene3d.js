/**
 * scene3d.js —— 3D 场景骨架 + 场景 API（S 线）
 *
 * 契约：契约-接口.md §3.1 场景 API（addActor / setActorPosition / getWaypoint / render）
 *       + 仿真呈现与开发阶段计划 §2.2 3D 场景规格
 *
 * 硬约束：
 *   - 只读 store.getState()，不改 state
 *   - 不 import hud / family / person
 *   - **3D 里不渲染任何文字**
 *   - 阴影默认关闭（移动端掉帧第一来源）；pixelRatio 上限 2
 *   - WebGL 不可用 → 返回 null，由 main.js 切到 scene2d.js（功能一条不少）
 */

import * as THREE from 'three';
import { buildRoom, WAYPOINTS, APPROACH_POINTS, DOCK } from './room.js';

const BACKGROUND = 0xf3e6d6;

/** WebGL 能力检测（P1 就要做，不能等降级时才想） */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (err) {
    return false;
  }
}

const CAMERA_PRESETS = {
  // 固定等距斜俯视主视角：能看到客厅（沙发 · 王阿姨）、卧室、厨房三个分区与前景的充电座
  wide: { position: [7.1, 6.5, 8.6], lookAt: [0.35, 0.45, 0.25], fov: 42 },
  // 药盘特写机位（陈列时可切换；降级第 1 项会砍掉它）
  tray: { position: [2.35, 1.5, 3.15], lookAt: [1.4, 0.75, 1.0], fov: 34 },
};

/**
 * 创建 3D 场景。WebGL 不可用时返回 null（调用方走 2D 降级）。
 * @param {{container: HTMLElement}} options
 */
export function createScene3D({ container }) {
  if (!isWebGLAvailable()) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = false; // 默认关闭（可选开关）
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('scene-canvas');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  /** 仅视觉状态：相机模式、帧率统计 */
  const view = { mode: 'wide', fps: 0, frames: 0, lastFpsAt: 0 };

  const camera = new THREE.PerspectiveCamera(CAMERA_PRESETS.wide.fov, 1, 0.1, 120);
  applyCameraPreset('wide');

  // 光照：HemisphereLight + DirectionalLight（无阴影贴图）
  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x9c8f83, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(5.5, 8, 4.5);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffe9d2, 0.25);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  scene.add(buildRoom());

  const actors = new Map();

  function applyCameraPreset(mode) {
    const preset = CAMERA_PRESETS[mode] || CAMERA_PRESETS.wide;
    view.mode = CAMERA_PRESETS[mode] ? mode : 'wide';
    camera.fov = preset.fov;
    camera.position.set(...preset.position);
    camera.lookAt(new THREE.Vector3(...preset.lookAt));
    camera.updateProjectionMatrix();
  }

  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  resize();
  window.addEventListener('resize', resize);

  const api = {
    /** 挂载角色（契约 §3.1）——actor: { id, kind, object3D, radius? } */
    addActor(actor) {
      if (!actor || !actor.object3D) return;
      actors.set(actor.id, actor);
      scene.add(actor.object3D);
    },

    removeActor(actorId) {
      const actor = actors.get(actorId);
      if (!actor) return;
      scene.remove(actor.object3D);
      actors.delete(actorId);
    },

    /** 直接把人/机器人放到某个位置（用于强制摆位；日常跟随由各自 update 驱动） */
    setActorPosition(actorId, location) {
      const actor = actors.get(actorId);
      const point = WAYPOINTS[location] || APPROACH_POINTS[location];
      if (!actor || !point) return;
      actor.object3D.position.set(point.x, point.y, point.z);
    },

    /** 取路径点（人的位置） */
    getWaypoint(location) {
      return WAYPOINTS[location] || null;
    },

    /** 取机器人停靠点（新增函数，契约 v1.2） */
    getApproachPoint(location) {
      return APPROACH_POINTS[location] || DOCK;
    },

    getDock() {
      return DOCK;
    },

    setCameraMode(mode) {
      applyCameraPreset(mode);
    },

    getCameraMode() {
      return view.mode;
    },

    setShadows(enabled) {
      renderer.shadowMap.enabled = Boolean(enabled);
      dir.castShadow = Boolean(enabled);
      scene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = Boolean(enabled);
          node.receiveShadow = Boolean(enabled);
        }
      });
      if (enabled) {
        dir.shadow.mapSize.set(1024, 1024);
        dir.shadow.camera.left = -8;
        dir.shadow.camera.right = 8;
        dir.shadow.camera.top = 8;
        dir.shadow.camera.bottom = -8;
      }
    },

    /** 每帧由 main.js 调用（契约 §3.1：render(state)）。scene 只读 state。 */
    render() {
      renderer.render(scene, camera);
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
      window.removeEventListener('resize', resize);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },

    /** 供调试抽屉显示 WebGL 信息 */
    info() {
      return renderer.info;
    },

    kind: '3d',
    scene,
    camera,
    renderer,
  };

  return api;
}

export const scene3d = { createScene3D, isWebGLAvailable, WAYPOINTS, APPROACH_POINTS, DOCK };
