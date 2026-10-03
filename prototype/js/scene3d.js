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
import { buildEnvironmentScene } from './textures.js';

/**
 * 写实化取向（v2）：
 *   - **色调映射**：ACESFilmic。不开的话白墙一片死白、金属没有高光层次。
 *   - **软阴影**：PCFSoft。写实的「家具落在地上」几乎全靠接触阴影；
 *     代价是移动端掉帧，所以 `setShadows()` 开关保留（契约里的降级阶梯没变）。
 *   - **环境光照（IBL）**：用 textures.buildEnvironmentScene() 造一个渐变天空 + 一块「太阳」，
 *     经 PMREMGenerator 变成 envMap。没有它，PBR 的 metalness/roughness 就没有参照。
 *   - **背景**：一个内表面渐变穹顶（不是纯色），窗外的天光才有来处。
 */
const BACKGROUND = 0xdcd5ca;

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
  // 按「机器人在客厅停靠点」标定：能同时看到机器人正面、抬起的药盘与沙发上的王阿姨
  tray: { position: [3.5, 1.1, -0.6], lookAt: [1.2, 0.52, 1.35], fov: 36 },
};

/**
 * 创建 3D 场景。WebGL 不可用时返回 null（调用方走 2D 降级）。
 * @param {{container: HTMLElement}} options
 */
export function createScene3D({ container }) {
  if (!isWebGLAvailable()) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true; // 写实化后默认开启；setShadows() 仍可关掉换帧率
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('scene-canvas');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  /** 仅视觉状态：相机模式、帧率统计 */
  const view = { mode: 'wide', fps: 0, frames: 0, lastFpsAt: 0 };

  const camera = new THREE.PerspectiveCamera(CAMERA_PRESETS.wide.fov, 1, 0.1, 120);
  applyCameraPreset('wide');

  /* ── 环境光照：程序化天空 → PMREM ────────────────────────────────── */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = buildEnvironmentScene();
  const envRT = pmrem.fromScene(envScene, 0.03);
  scene.environment = envRT.texture;
  envScene.traverse((node) => {
    if (node.isMesh) {
      node.geometry.dispose();
      if (node.material.map) node.material.map.dispose();
      node.material.dispose();
    }
  });

  /* ── 背景穹顶：柔和渐变，比纯色背景更像「窗外天光」─────────────── */
  const backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = 8;
  backdropCanvas.height = 256;
  {
    const c = backdropCanvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, '#a9c0d4');
    g.addColorStop(0.46, '#d3d6d3');
    g.addColorStop(0.58, '#ded3c2');
    g.addColorStop(1.0, '#b3a795');
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 256);
  }
  const backdropTex = new THREE.CanvasTexture(backdropCanvas);
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(46, 32, 20),
    new THREE.MeshBasicMaterial({ map: backdropTex, side: THREE.BackSide, depthWrite: false }),
  );
  backdrop.name = 'backdrop';
  scene.add(backdrop);

  /* ── 光照：窗外太阳 + 天光 + 逆向补光 ───────────────────────────── */
  const hemi = new THREE.HemisphereLight(0xd8e6f2, 0x7b6a58, 0.24);
  scene.add(hemi);

  // 主光：从窗外（-z / -x 方向）斜射进来，暖色，负责全部接触阴影
  const sun = new THREE.DirectionalLight(0xffe0b4, 2.75);
  sun.position.set(-4.6, 5.4, -7.2);
  sun.target.position.set(-0.2, 0.5, 0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -6.4;
  sun.shadow.camera.right = 6.4;
  sun.shadow.camera.top = 6.4;
  sun.shadow.camera.bottom = -6.4;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 26;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 2.2;
  scene.add(sun);
  scene.add(sun.target);

  // 补光：从相机一侧压一点冷光，避免暗部死黑
  const fill = new THREE.DirectionalLight(0xbdd2e6, 0.18);
  fill.position.set(6.5, 4.2, 6.0);
  scene.add(fill);

  // 窗口内的地面反射光（很弱，只是让木地板有一点点「透亮」）
  const bounce = new THREE.DirectionalLight(0xffd9ac, 0.14);
  bounce.position.set(-3.2, -2.0, -2.6);
  scene.add(bounce);

  scene.add(buildRoom());
  applyShadowFlags();

  const actors = new Map();

  /** 新加入场景的物体（房间/角色）都要有阴影标记 */
  function applyShadowFlags() {
    const on = renderer.shadowMap.enabled;
    scene.traverse((node) => {
      if (!node.isMesh) return;
      // 背景穹顶、窗外天空片这类「自发光平面」不参与阴影：
      // 让它们投影会把窗外的阳光整片挡掉，室内就永远没有光斑。
      if (node.name === 'backdrop' || node.userData.noShadow) return;
      node.castShadow = on;
      node.receiveShadow = on;
    });
  }

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
      applyShadowFlags();
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

    /** 任意机位（拍摄模式/陈列用）：{ position:{x,y,z}, lookAt:{x,y,z}, fov? } */
    setCameraLook({ position, lookAt, fov } = {}) {
      if (position) camera.position.set(position.x, position.y, position.z);
      if (lookAt) camera.lookAt(new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z));
      if (fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },

    getCameraMode() {
      return view.mode;
    },

    setShadows(enabled) {
      const on = Boolean(enabled);
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = on;
          node.receiveShadow = on;
        }
      });
      // 每次重绘都要重编材质（阴影开关会改变 shader）
      scene.traverse((node) => {
        if (node.isMesh && node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
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
