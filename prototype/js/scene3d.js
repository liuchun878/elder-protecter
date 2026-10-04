/**
 * scene3d.js —— 3D 场景 + 场景 API（S 线）
 *
 * 契约：契约-接口.md §3.1 场景 API（addActor / setActorPosition / getWaypoint /
 *       getApproachPoint / getDock / findPath / pick / render）
 *       + 仿真呈现与开发阶段计划 §2.2 3D 场景规格
 *
 * v1.7（套房）：户型换成 `suite-3d` 的 13.4 × 10.6 m 套房（见 room.js）。因此多了三件事：
 *   ① **导航网格**（navgrid.js）：多房间有墙，机器人/人不能两点一线，`findPath` 走可通行网格；
 *   ② **光照换成套房那一套**（半球 + 环境 + 太阳 + 冷补光 + 室内暖光），日光/黄昏两档；
 *   ③ **拾取仍然有效**：落点必须落在可走区域里，且按家具/坐具元数据吸附。
 *
 * 硬约束（不变）：
 *   - 只读 store.getState()，不改 state
 *   - 不 import hud / family / person
 *   - **3D 里不渲染任何文字**
 *   - 阴影默认开启（软阴影），`setShadows()` 可一键关掉换帧率
 *   - WebGL 不可用 → 返回 null，由 main.js 切到 scene2d.js（功能一条不少）
 */

import * as THREE from 'three';
import {
  buildRoom, WAYPOINTS, APPROACH_POINTS, DOCK, DOCK_FACING,
} from './room.js';
import { createNavGrid } from './navgrid.js';
import { skyCanvas } from './suite-textures.js';

/** WebGL 能力检测（P1 就要做，不能等降级时才想） */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (err) {
    return false;
  }
}

/**
 * 机位预设（世界坐标；屋子中心在原点，x ∈ [−6.7, 6.7]，z ∈ [−5.3, 5.3]）
 *   wide    全景：整户斜俯视
 *   living  客厅（沙发 + 茶几 + 电视墙 + 充电桩）
 *   bedroom 卧室 C（床）
 *   kitchen 餐区（餐桌 + 吊灯）
 *   dock    客厅东北角的充电桩
 *   tray    药盘特写（按"机器人在沙发前停靠点"标定）
 */
const CAMERA_PRESETS = {
  // ⚠️ 机位必须落在**室内**：世界 z > 5.18 或 x > 6.58 就已经在墙外了（会隔着墙看）。
  wide: { position: [10.6, 12.4, 14.2], lookAt: [0.0, 0.9, 0.6], fov: 40 },
  living: { position: [1.15, 2.05, 4.35], lookAt: [3.60, 0.80, 2.55], fov: 54 },
  bedroom: { position: [3.00, 1.95, -1.30], lookAt: [5.55, 0.72, -3.45], fov: 50 },
  kitchen: { position: [3.05, 2.35, 2.95], lookAt: [0.10, 0.72, -0.10], fov: 48 },
  dock: { position: [4.35, 1.85, 2.45], lookAt: [5.80, 0.52, 1.10], fov: 42 },
  tray: { position: [0.30, 1.05, 3.80], lookAt: [1.55, 0.62, 3.55], fov: 36 },
};

/**
 * 一天里的光（v1.11 起三档：日光 / 黄昏 / **夜晚**）。
 * 黄昏：太阳压低、色温转暖，室内暖光组打开。
 * 夜晚：天空压暗、太阳几乎只剩一点冷月光，**室内暖光成为主光**（每间房一盏，见下方 warm()），
 *       曝光再压一档 —— 这样窗洞是深蓝夜色、屋里是暖黄灯，一眼能看出"天黑了、家里开着灯"。
 */
const TIME_OF_DAY = {
  day: { sun: 0xfff0d8, sunI: 2.35, sunPos: [-9, 13, -11], hemi: 0.72, fill: 0.42, amb: 0.24, exposure: 1.06, bg: 0xd9d6d1, interior: 1.0, interiorOn: false, moon: 0 },
  dusk: { sun: 0xffc07a, sunI: 2.30, sunPos: [-15, 4.5, -3], hemi: 0.40, fill: 0.30, amb: 0.22, exposure: 1.04, bg: 0xcfc3b4, interior: 0.8, interiorOn: true, moon: 0 },
  night: { sun: 0xaec4e6, sunI: 0.30, sunPos: [-7, 11, -9], hemi: 0.20, fill: 0.10, amb: 0.13, exposure: 0.88, bg: 0x1a2130, interior: 1.75, interiorOn: true, moon: 1 },
};

/**
 * 创建 3D 场景。WebGL 不可用时返回 null（调用方走 2D 降级）。
 * @param {{container: HTMLElement}} options
 */
export function createScene3D({ container }) {
  if (!isWebGLAvailable()) return null;

  // v1.20：录制模式（?record=1）打开 preserveDrawingBuffer —— 页内 canvas.toDataURL() 才抓得到画面，
// 免走 CDP 截图管线（实测那条路 5 s/帧，页内抓帧约 0.5 s/帧）
  const RECORDING = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('record') === '1';
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: RECORDING, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TIME_OF_DAY.day.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('scene-canvas');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(TIME_OF_DAY.day.bg);

  /** 仅视觉状态：相机模式、帧率统计 */
  const view = { mode: 'wide', fps: 0, frames: 0, lastFpsAt: 0 };

  /**
   * 自由视角（球坐标绕目标点转）。
   * ⚠️ **只在交互模式开启**：拍摄模式（?film=1）每帧都用 `setCameraLook` 复写机位。
   */
  const orbit = {
    enabled: false,
    dragging: false,
    target: new THREE.Vector3(0, 0.5, 0),
    radius: 12,
    azimuth: 0.7,
    polar: 0.85,
    lastX: 0,
    lastY: 0,
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);

  /* ── 环境光照：程序化天空 → PMREM（与套房一致的做法）─────────────── */
  const skyTex = new THREE.CanvasTexture(skyCanvas());
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(skyTex);
  scene.environment = envRT.texture;
  // v1.11：夜晚用**另一张**夜空环境贴图。只压阳光/曝光是不够的 ——
  // 白墙会被白天的天光（IBL）整体提亮，画面依旧是"白天关灯"而不是"夜里开灯"。
  const nightSkyTex = new THREE.CanvasTexture(skyCanvas(20266, 'night'));
  nightSkyTex.colorSpace = THREE.SRGBColorSpace;
  nightSkyTex.mapping = THREE.EquirectangularReflectionMapping;
  const nightEnvRT = pmrem.fromEquirectangular(nightSkyTex);
  pmrem.dispose();

  /* ── 光照：半球 + 环境 + 窗外太阳（投影）+ 冷补光 + 室内暖光 ─────── */
  const hemi = new THREE.HemisphereLight(0xe9f0f7, 0xb59a7c, TIME_OF_DAY.day.hemi);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xfff2e2, TIME_OF_DAY.day.amb);
  scene.add(amb);

  const sun = new THREE.DirectionalLight(TIME_OF_DAY.day.sun, TIME_OF_DAY.day.sunI);
  sun.position.set(...TIME_OF_DAY.day.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 55;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.028;
  sun.shadow.radius = 2.2;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xdce8f5, TIME_OF_DAY.day.fill);
  fill.position.set(10, 7, 9);
  scene.add(fill);

  // 室内暖光（黄昏才开）：点光源按房间名各一盏，位置与吊灯一致
  const interior = new THREE.Group();
  interior.visible = TIME_OF_DAY.day.interiorOn;
  scene.add(interior);
  const interiorLights = [];
  function warm(x, y, z, intensity, dist) {
    const l = new THREE.PointLight(0xffd9a6, intensity, dist || 7, 2);
    l.position.set(x, y, z);
    l.userData.base = intensity;
    interior.add(l);
    interiorLights.push(l);
    return l;
  }
  warm(0.40, 2.35, 0.05, 6, 7);      // 餐区吊灯
  warm(-4.40, 2.30, -3.25, 4, 6);    // 卧室 A
  warm(4.40, 2.30, -3.25, 4, 6);     // 卧室 B
  warm(-4.35, 2.30, 3.55, 4, 6);     // 卧室 C
  warm(-0.50, 2.30, 4.65, 3.5, 5);   // 书房
  warm(3.65, 2.30, 3.55, 4.5, 6.5);  // 起居

  let timeOfDay = 'day';

  /* ── 地面 / 楼板 / 接触阴影 ───────────────────────────────────────── */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshStandardMaterial({ color: 0xcdc8c1, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.45;
  ground.receiveShadow = true;
  ground.userData.noPick = true;
  scene.add(ground);
  const contactPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.20 }),
  );
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.y = -0.44;
  contactPlane.receiveShadow = true;
  contactPlane.userData.noShadow = true;
  contactPlane.userData.noPick = true;
  scene.add(contactPlane);

  /* ── 户型 ─────────────────────────────────────────────────────────── */
  const room = buildRoom();
  scene.add(room);

  /** 导航网格：多房间有墙，机器人/人一律走它给的可通行折线 */
  const nav = createNavGrid({
    bounds: room.userData.nav.bounds,
    walls: room.userData.nav.walls,
    boxes: room.userData.nav.boxes,
    cell: 0.1,
  radius: 0.22,
  });

  /** 导航网格可视化（调试抽屉用；默认关） */
  const navOverlay = (() => {
    const { cols, rows } = nav;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const free = nav.walkable[r * cols + c];
        const i = (r * cols + c) * 4;
        img.data[i] = free ? 60 : 220;
        img.data[i + 1] = free ? 200 : 90;
        img.data[i + 2] = free ? 160 : 80;
        img.data[i + 3] = free ? 40 : 150;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const b = nav.bounds;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((b.x0 + b.x1) / 2, 0.03, (b.z0 + b.z1) / 2);
    m.visible = false;
    m.userData.noShadow = true;
    m.userData.noPick = true;
    m.renderOrder = 5;
    scene.add(m);
    return m;
  })();

  /** 充电桩上的灯（room.js 交回来的引用）——充电呼吸由本文件驱动 */
  const dockLights = (room.userData.dock && room.userData.dock.leds) || [];
  let pulse = 0;

  function applyShadowFlags() {
    const on = renderer.shadowMap.enabled;
    scene.traverse((node) => {
      if (!node.isMesh) return;
      if (node.userData.noShadow || node === navOverlay || node === ground) return;
      node.castShadow = on;
      node.receiveShadow = on;
    });
    ground.receiveShadow = true;
    contactPlane.receiveShadow = true;
  }
  applyShadowFlags();

  function applyTimeOfDay(mode) {
    const t = TIME_OF_DAY[mode] || TIME_OF_DAY.day;
    timeOfDay = TIME_OF_DAY[mode] ? mode : 'day';
    sun.color.setHex(t.sun);
    sun.intensity = t.sunI;
    sun.position.set(...t.sunPos);
    hemi.intensity = t.hemi;
    fill.intensity = t.fill;
    // 夜晚的补光改成冷月光（白天的补光是窗外的天光）
    fill.color.setHex(t.moon ? 0x9fb6d8 : 0xdce8f5);
    amb.intensity = t.amb;
    amb.color.setHex(t.moon ? 0xc9d6ee : 0xfff2e2);
    renderer.toneMappingExposure = t.exposure;
    scene.background.setHex(t.bg);
    scene.environment = t.moon ? nightEnvRT.texture : envRT.texture; // 夜里换夜空 IBL
    interior.visible = t.interiorOn;
    for (const l of interiorLights) l.intensity = l.userData.base * t.interior;
  }

  const actors = new Map();

  /* ── 可拾取物 / 单击落座（契约 §3.1）──────────────────────────────
   * 规则（顺序很重要）：
   *   ① 命中带 `userData.seat` 的坐具 → 吸附到 spec 给的落点（沙发垫 / 椅子正中 / 床沿）；
   *   ② 命中**朝上的面**且高度在 [0.08, 0.62] → 坐到该表面上；
   *   ③ 其余（墙、竖直面、太高的家具）→ 沿水平法线推开一点，**坐到地板上**；
   *   ④ 落点必须落在**可通行区域**内，否则忽略这次点击（点墙外/屋外不该让人穿墙坐）。
   * 不拾取：透明面（玻璃/窗）、自发光面、导航贴图、地面板、相机标记。
   */
  const SEAT_MAX_Y = 0.62;
  const SEAT_MIN_Y = 0.08;
  const pickables = [];

  function refreshPickables() {
    pickables.length = 0;
    room.traverse((node) => {
      if (!node.isMesh || node === marker) return;
      if (node.userData.noShadow || node.userData.noPick) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      if (mats.some((m) => m && m.transparent && m.opacity < 0.9)) return;
      pickables.push(node);
    });
  }

  function facingTowardsRoom(x, z) {
    return Math.atan2(-x, -z); // 朝向户型中心
  }

  function seatFromHit(hit) {
    // ① 坐具元数据（向上找最近的一层）
    for (let node = hit.object; node && node !== room; node = node.parent) {
      const spec = node.userData && node.userData.seat;
      if (!spec) continue;
      let x = spec.lockX !== undefined ? spec.lockX : hit.point.x;
      let z = spec.lockZ !== undefined ? spec.lockZ : hit.point.z;
      if (spec.clampX) x = clamp(x, spec.clampX[0], spec.clampX[1]);
      if (spec.clampZ) z = clamp(z, spec.clampZ[0], spec.clampZ[1]);
      return { x, z, surfaceY: spec.surfaceY, facing: spec.facing, kind: spec.kind };
    }

    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 1, 0);
    const y = hit.point.y;

    // ② 朝上的面：直接坐上去
    if (Math.abs(normal.y) > 0.6 && y >= SEAT_MIN_Y && y <= SEAT_MAX_Y) {
      return {
        x: hit.point.x, z: hit.point.z, surfaceY: y, facing: facingTowardsRoom(hit.point.x, hit.point.z), kind: 'surface',
      };
    }

    // ③ 墙面 / 太高的家具：沿水平法线推开，坐地板
    const len = Math.hypot(normal.x, normal.z) || 1;
    const x = hit.point.x + (normal.x / len) * 0.34;
    const z = hit.point.z + (normal.z / len) * 0.34;
    return { x, z, surfaceY: 0, facing: facingTowardsRoom(x, z), kind: 'floor' };
  }

  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();

  function pickAt(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const seat = seatFromHit(hits[0]);
    // ④ 地板落点必须真的落在地板上（可通行区内）——否则点到屋外/墙里就会让人穿墙坐。
    //    坐具/家具表面的落点是元数据给定的（本来就在家具上），不能用"可站"去卡它。
    if (seat.kind === 'floor'
      && !nav.isWalkable(seat.x, seat.z)
      && nav.nearestWalkable(seat.x, seat.z, 0.6) === null) return null;
    return seat;
  }

  /* ── 点击落座标记：一圈扩散淡出的环（纯视觉反馈）───────────────── */
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.20, 0.28, 40),
    new THREE.MeshBasicMaterial({
      color: 0x53c9c0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  marker.name = 'pick-marker';
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.02;
  marker.visible = false;
  marker.userData.noShadow = true;
  marker.renderOrder = 6;
  scene.add(marker);
  let markerAge = Infinity;
  refreshPickables();

  /* ── 寻路（契约 §3.1：findPath）────────────────────────────────── */
  const pathCache = new Map();
  function findPath(from, to) {
    if (!from || !to) return null;
    const k = `${from.x.toFixed(1)},${from.z.toFixed(1)}>${to.x.toFixed(1)},${to.z.toFixed(1)}`;
    const hit = pathCache.get(k);
    if (hit) return hit.map((p) => ({ ...p }));
    const path = nav.findPath(from, to);
    if (pathCache.size > 200) pathCache.clear();
    pathCache.set(k, path);
    return path ? path.map((p) => ({ ...p })) : null;
  }

  /** 机器人站在人的正前方多远（米）——递药与"跟到身边"用同一个距离 */
  const STANDOFF = 0.95;

  /**
   * 落座点 → 机器人站位：先试"人的正前方"，被家具/墙占了就绕着她左右各偏 35°/70°/105°…
   * 只做**站位选择**，不是路径规划（路径由 findPath 给）。
   */
  function approachForSeat(seat) {
    const facing = Number(seat.facing) || 0;
    const sx = Number(seat.x);
    const sz = Number(seat.z);
    for (const offsetDeg of [0, 35, -35, 70, -70, 105, -105, 150, -150, 180]) {
      const a = facing + (offsetDeg * Math.PI) / 180;
      const x = sx + Math.sin(a) * STANDOFF;
      const z = sz + Math.cos(a) * STANDOFF;
      if (nav.isWalkable(x, z)) return { x, y: 0, z };
    }
    const near = nav.nearestWalkable(sx + Math.sin(facing) * STANDOFF, sz + Math.cos(facing) * STANDOFF, 1.4);
    return near ? { x: near.x, y: 0, z: near.z } : { x: sx, y: 0, z: sz };
  }

  /* ── 点击后自动取景（v1.9）：把相机搬到"看得见落座点"的位置 ──────────
   * 为什么需要：`living` 机位的 lookAt 是**电视墙**，而沙发被自身扶手 + 茶几 + 边柜
   * 围在凹槽里 —— 对着电视墙看，根本看不见沙发上的人。用户点完沙发的感受就是
   * "点了没反应"。**取景不是场景缺陷，但看不见就等于没反馈**。
   * 做法（纯几何，不猜业务）：从落座点**正面**往外找机位（正面 → 左右 35°/70°/105°/
   * 145°/180°），取第一个同时满足 ①在户型内 ②与落座点之间不隔墙（门洞放行）
   * ③不陷在家具里 的位置。找不到就返回 null，**保留原机位，不硬凑**。
   */
  const FRAME_CAND = {
    dists: [2.4, 3.0, 3.6, 1.9],
    offsets: [0, 35, -35, 70, -70, 105, -105, 145, -145, 180],
    height: 1.30,
    look: 0.62,
    fov: 46,
  };
  /** v1.14：「她 + 机器人」同框的候选（侧面为主，稍远稍高，看得清托盘上的手） */
  const PAIR_CAND = {
    dists: [2.2, 2.7, 3.3, 1.8, 3.9],
    offsets: [-30, 30, 0, -60, 60, -100, 100, 150, -150],
    height: 1.35,
    look: 0.72,
    fov: 44,
  };
  const navWalls = room.userData.nav.walls;
  const navBoxes = room.userData.nav.boxes;
  const navBounds = room.userData.nav.bounds;

  function insideSuite(x, z, margin = 0.40) {
    return x > navBounds.x0 + margin && x < navBounds.x1 - margin
      && z > navBounds.z0 + margin && z < navBounds.z1 - margin;
  }

  function insideFurniture(x, z, pad = 0.16) {
    return navBoxes.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
  }

  /** 视线是否被墙挡住：与墙中心线求交；交点在门洞区间内 → 放行（能透过门看见） */
  function wallBlocksView(ax, az, bx, bz) {
    const d1x = bx - ax;
    const d1z = bz - az;
    for (const w of navWalls) {
      const d2x = w.x2 - w.x1;
      const d2z = w.z2 - w.z1;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((w.x1 - ax) * d2z - (w.z1 - az) * d2x) / den;
      const u = ((w.x1 - ax) * d1z - (w.z1 - az) * d1x) / den;
      if (t <= 0.04 || t >= 0.96 || u < -0.02 || u > 1.02) continue; // 只算严格夹在中间的墙
      const along = u * (Math.hypot(d2x, d2z) || 1);
      const inDoor = (w.pass || []).some(([a, b]) => along > a - 0.05 && along < b + 0.05);
      if (!inDoor) return true;
    }
    return false;
  }

  function seatCameraPose(seat) {
    const facing = Number(seat.facing) || 0;
    const sx = Number(seat.x);
    const sz = Number(seat.z);
    for (const dist of FRAME_CAND.dists) {
      for (const off of FRAME_CAND.offsets) {
        const a = facing + (off * Math.PI) / 180;
        const x = sx + Math.sin(a) * dist;
        const z = sz + Math.cos(a) * dist;
        if (!insideSuite(x, z)) continue;
        if (insideFurniture(x, z)) continue;
        if (wallBlocksView(x, z, sx, sz)) continue;
        return {
          position: { x, y: FRAME_CAND.height, z },
          lookAt: { x: sx, y: FRAME_CAND.look, z: sz },
          fov: FRAME_CAND.fov,
        };
      }
    }
    return null;
  }

  /** 相机平滑搬运：不让画面"啪"一下跳过去（拖拽/切机位会立刻接管） */
  const camFly = {
    active: false, t: 0, dur: 0.85,
    fromP: new THREE.Vector3(), fromT: new THREE.Vector3(),
    toP: new THREE.Vector3(), toT: new THREE.Vector3(),
    fromFov: 40, toFov: 40,
  };
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2);
  let lastFocusPose = null;

  function flyTo(pose, instant = false) {
    if (!pose) return;
    camFly.fromP.copy(camera.position);
    camFly.fromT.copy(orbit.target);
    camFly.toP.set(pose.position.x, pose.position.y, pose.position.z);
    camFly.toT.set(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    camFly.fromFov = camera.fov;
    camFly.toFov = pose.fov || camera.fov;
    lastFocusPose = {
      position: { ...pose.position }, lookAt: { ...pose.lookAt }, fov: camFly.toFov,
    };
    if (instant) {
      camera.position.copy(camFly.toP);
      orbit.target.copy(camFly.toT);
      camera.fov = camFly.toFov;
      camera.updateProjectionMatrix();
      camera.lookAt(orbit.target);
      syncOrbitFromCamera();
      camFly.active = false;
      return;
    }
    camFly.active = true;
    camFly.t = 0;
  }

  /** 取景到落座点：算机位 → 平滑搬过去（找不到机位就什么都不做） */
  function focusSeat(seat, { animate = true, duration = 0.85 } = {}) {
    const pose = seat ? seatCameraPose(seat) : null;
    if (!pose) return null;
    view.mode = 'seat'; // 不再对应任何预设按钮（面板上不该有为它高亮的按钮）
    camFly.dur = duration; // v1.20：推近速度可调（递药特写要"慢一点、跟得上讲解"）
    flyTo(pose, !animate);
    return pose;
  }

  /**
   * v1.14（用户口径：「吃药时把镜头移到老人与机器人，让观众看清递药，不要有遮挡」）
   *
   * 把**两个目标**（她 + 机器人）一起框进画面：取两点中点为 `lookAt`，沿「她 → 机器人」这条轴的
   * **侧面**找机位（侧面看递药最清楚，正对着会被人挡人）。逐个候选做三重排除，与 `seatCameraPose`
   * 同一套判据：① 在户型内 ② 不陷在家具里 ③ 到**两个目标**的视线都不隔墙（门洞放行）。
   * 另外要求机位离她至少 max(1.1, 轴长×0.75) m —— 不然相机贴脸，画面里只剩一个人。
   * 找不到返回 `null`：**保留原机位，不硬凑**（宁可少一个镜头，不要一个糊在柜面上的镜头）。
   */
  function pairCameraPose(a, b) {
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    const axis = Math.atan2(b.x - a.x, b.z - a.z);
    const minFromHer = Math.max(1.1, span * 0.75);
    for (const dist of PAIR_CAND.dists) {
      for (const off of PAIR_CAND.offsets) {
        const ang = axis + Math.PI / 2 + (off * Math.PI) / 180;
        const x = mx + Math.sin(ang) * dist;
        const z = mz + Math.cos(ang) * dist;
        if (!insideSuite(x, z)) continue;
        if (insideFurniture(x, z, 0.10)) continue;
        if (Math.hypot(x - a.x, z - a.z) < minFromHer) continue;
        if (wallBlocksView(x, z, a.x, a.z)) continue;
        if (wallBlocksView(x, z, b.x, b.z)) continue;
        return {
          position: { x, y: PAIR_CAND.height, z },
          lookAt: { x: mx, y: PAIR_CAND.look, z: mz },
          fov: PAIR_CAND.fov,
        };
      }
    }
    // 保底：侧面全被家具/墙挡死时，沿「她 → 机器人」这条轴退到后面拍**过肩镜头** ——
    // 她在前景、机器人与托盘在中景，递药动作照样看得清（比"什么都不做"强，也比隔着墙强）。
    for (const dist of [1.35, 1.7, 2.1]) {
      for (const dir of [-1, 1]) {
        const x = mx - Math.sin(axis) * dist * dir;
        const z = mz - Math.cos(axis) * dist * dir;
        if (!insideSuite(x, z)) continue;
        if (insideFurniture(x, z, 0.05)) continue;
        if (wallBlocksView(x, z, a.x, a.z)) continue;
        if (wallBlocksView(x, z, b.x, b.z)) continue;
        return {
          position: { x, y: 1.45, z },
          lookAt: { x: mx, y: 0.72, z: mz },
          fov: 48,
        };
      }
    }
    return null;
  }

  /** 把「她 + 机器人」一起取景（递药那一刻用）；找不到机位就返回 null，保持原样 */
  function focusPair(a, b, { animate = true, duration = 0.85 } = {}) {
    const pose = a && b ? pairCameraPose(a, b) : null;
    if (!pose) return null;
    view.mode = 'pair';
    camFly.dur = duration;
    flyTo(pose, !animate);
    return pose;
  }

  /* ── 相机 ─────────────────────────────────────────────────────────── */
  function syncOrbitFromCamera() {
    const off = camera.position.clone().sub(orbit.target);
    orbit.radius = Math.max(0.8, off.length());
    orbit.azimuth = Math.atan2(off.x, off.z);
    orbit.polar = Math.acos(Math.min(1, Math.max(-1, off.y / orbit.radius)));
  }

  function applyOrbit() {
    const sp = Math.sin(orbit.polar);
    camera.position.set(
      orbit.target.x + orbit.radius * sp * Math.sin(orbit.azimuth),
      orbit.target.y + orbit.radius * Math.cos(orbit.polar),
      orbit.target.z + orbit.radius * sp * Math.cos(orbit.azimuth),
    );
    camera.lookAt(orbit.target);
  }

  function applyCameraPreset(mode) {
    const preset = CAMERA_PRESETS[mode] || CAMERA_PRESETS.wide;
    view.mode = CAMERA_PRESETS[mode] ? mode : 'wide';
    camFly.active = false; // 切机位/复位立刻接管，别被"飞过去"的动画盖掉
    camera.fov = preset.fov;
    orbit.target.set(...preset.lookAt);
    camera.position.set(...preset.position);
    camera.lookAt(orbit.target);
    camera.updateProjectionMatrix();
    syncOrbitFromCamera();
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

  /* ── 拖拽旋转 / 滚轮缩放（自由视角）──────────────────────────────── */
  const dom = renderer.domElement;

  /** 单击落座回调：只有"按下 → 抬起"位移很小才算点击，否则是拖拽旋转视角 */
  let pickHandler = null;
  /** 点画面后是否自动取景（默认**关**：主演示的固定构图不受影响，预览台自己开） */
  let autoFrame = false;
  const tap = { x: 0, y: 0, at: 0 };

  function onPointerDown(event) {
    tap.x = event.clientX;
    tap.y = event.clientY;
    tap.at = performance.now();
    camFly.active = false; // 用户一上手就交还控制权
    if (!orbit.enabled || event.button !== 0) return;
    orbit.dragging = true;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    dom.classList.add('is-dragging');
    try { dom.setPointerCapture(event.pointerId); } catch (err) { /* 某些环境不支持 */ }
  }
  function onPointerMove(event) {
    if (!orbit.enabled || !orbit.dragging) return;
    const dx = event.clientX - orbit.lastX;
    const dy = event.clientY - orbit.lastY;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    orbit.azimuth -= dx * 0.0062;
    orbit.polar = clamp(orbit.polar - dy * 0.0055, 0.16, 1.45);
    applyOrbit();
  }
  function onPointerUp(event) {
    if (pickHandler && event.button === 0) {
      // 判定"点击"还是"拖拽"：**只看位移**（< 8 px 就是点击）。
      // 不设时间窗：重场景下（多房间套房 + 软阴影）一帧可能就要 1 s 以上，
      // 自动化脚本的"按下 → 抬起"之间也会隔很久，卡时间窗会把真点击判掉。
      const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      if (moved < 8) {
        const seat = pickAt(event.clientX, event.clientY);
        if (seat) {
          pickHandler(seat);
          if (autoFrame) focusSeat(seat);
        }
      }
    }
    if (!orbit.dragging) return;
    orbit.dragging = false;
    dom.classList.remove('is-dragging');
    try { dom.releasePointerCapture(event.pointerId); } catch (err) { /* 忽略 */ }
  }
  function onWheel(event) {
    if (!orbit.enabled) return;
    event.preventDefault();
    orbit.radius = clamp(orbit.radius * Math.exp(event.deltaY * 0.0011), 1.5, 34);
    applyOrbit();
  }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => { if (orbit.enabled) e.preventDefault(); });

  applyCameraPreset('wide');

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

    setActorPosition(actorId, location) {
      const actor = actors.get(actorId);
      const point = WAYPOINTS[location] || APPROACH_POINTS[location];
      if (!actor || !point) return;
      actor.object3D.position.set(point.x, point.y, point.z);
    },

    getWaypoint(location) {
      return WAYPOINTS[location] || null;
    },

    /**
     * 取机器人停靠点（契约 v1.2 / v1.6）
     * @param {string} location 预设位置
     * @param {object} [seat] 点击落座点（§2 presence.seat）——给了它就按落座点反算
     */
    getApproachPoint(location, seat) {
      if (seat && Number.isFinite(Number(seat.x)) && Number.isFinite(Number(seat.z))) {
        return approachForSeat(seat);
      }
      const preset = APPROACH_POINTS[location] || DOCK;
      if (nav.isWalkable(preset.x, preset.z)) return preset;
      const near = nav.nearestWalkable(preset.x, preset.z, 1.2);
      return near ? { x: near.x, y: 0, z: near.z } : preset;
    },

    getApproachFor(seat) {
      return seat ? approachForSeat(seat) : DOCK;
    },

    getDock() {
      return DOCK;
    },

    /** 回桩后的朝向（契约 v1.7）——机器人不 import 户型文件也能对齐充电桩 */
    getDockFacing() {
      return DOCK_FACING;
    },

    /** 寻路（契约 v1.7）：世界坐标折线，含起点与终点；不可达返回 null */
    findPath(from, to) {
      return findPath(from, to);
    },

    /** 某点是否可走（表现层只读用：落座合法性、站位选择） */
    isWalkable(x, z) {
      return nav.isWalkable(x, z);
    },

    /** 屏幕坐标 → 落座点（契约 v1.6 §3.1） */
    pick(clientX, clientY) {
      return pickAt(clientX, clientY);
    },

    enablePick(fn) {
      pickHandler = typeof fn === 'function' ? fn : null;
      dom.style.cursor = pickHandler ? 'crosshair' : '';
    },

    showPickMarker(seat) {
      if (!seat) return;
      marker.position.set(seat.x, 0.02, seat.z);
      marker.visible = true;
      markerAge = 0;
    },

    getActorPosition(actorId) {
      const actor = actors.get(actorId);
      if (!actor) return null;
      const p = actor.object3D.position;
      return { x: p.x, y: p.y, z: p.z };
    },

    setCameraMode(mode) {
      applyCameraPreset(mode);
    },

    /** 点击落座后把相机搬到"看得见落座点"的机位（契约 v1.9 §3.1）；找不到返回 null */
    focusSeat(seat, { animate = true, duration = 0.85 } = {}) {
      return focusSeat(seat, { animate, duration });
    },

    /**
     * v1.14：把**她 + 机器人**一起框进画面（递药那一刻用）。
     * @param {{x:number,z:number}} a 她　@param {{x:number,z:number}} b 机器人
     * @returns {object|null} 机位；找不到合适位置返回 null（保持原机位）
     */
    focusPair(a, b, { animate = true, duration = 0.85 } = {}) {
      return focusPair(a, b, { animate, duration });
    },

    /** 自测用：最近一次自动取景用的机位 */
    getFocusPose() {
      return lastFocusPose;
    },

    /** 自测用：相机是否还在"飞" */
    isCameraMoving() {
      return camFly.active;
    },

    /** 点画面后是否自动取景（默认关） */
    setAutoFrame(on) {
      autoFrame = Boolean(on);
      return autoFrame;
    },

    isAutoFrame() {
      return autoFrame;
    },

    setCameraLook({ position, lookAt, fov } = {}) {
      camFly.active = false;
      if (position) camera.position.set(position.x, position.y, position.z);
      if (lookAt) {
        orbit.target.set(lookAt.x, lookAt.y, lookAt.z);
        camera.lookAt(orbit.target);
      }
      if (fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      syncOrbitFromCamera();
    },

    enableOrbit(enabled) {
      orbit.enabled = Boolean(enabled);
      if (orbit.enabled) syncOrbitFromCamera();
      dom.classList.toggle('is-orbiting', orbit.enabled);
    },

    isOrbitEnabled() {
      return orbit.enabled;
    },

    resetCamera() {
      applyCameraPreset(view.mode);
    },

    getCameraMode() {
      return view.mode;
    },

    setTimeOfDay(mode) {
      applyTimeOfDay(mode);
      return timeOfDay;
    },

    getTimeOfDay() {
      return timeOfDay;
    },

    /** 导航网格可视化（调试抽屉用） */
    showNavGrid(on) {
      navOverlay.visible = Boolean(on);
      return navOverlay.visible;
    },

    setShadows(enabled) {
      const on = Boolean(enabled);
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((node) => {
        if (!node.isMesh) return;
        if (node.userData.noShadow || node === navOverlay || node === ground) return;
        node.castShadow = on;
        node.receiveShadow = on;
      });
      scene.traverse((node) => {
        if (node.isMesh && node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
    },

    /** 每帧由 main.js 调用（契约 §3.1：render(state, dt)）。scene 只读 state。 */
    render(state, dt = 0) {
      // ⓪ 自动取景：把相机平滑搬到落座点机位（用户一拖拽 / 一切机位立刻接管）
      if (camFly.active) {
        camFly.t = Math.min(camFly.dur, camFly.t + Math.max(0, dt));
        const k = easeInOut(camFly.dur > 0 ? camFly.t / camFly.dur : 1);
        camera.position.lerpVectors(camFly.fromP, camFly.toP, k);
        orbit.target.lerpVectors(camFly.fromT, camFly.toT, k);
        camera.fov = camFly.fromFov + (camFly.toFov - camFly.fromFov) * k;
        camera.updateProjectionMatrix();
        camera.lookAt(orbit.target);
        syncOrbitFromCamera();
        if (camFly.t >= camFly.dur) camFly.active = false;
      }

      // ① 点击落座标记：0.9 秒内扩散淡出
      if (marker.visible) {
        markerAge += Math.max(0, dt);
        const k = Math.min(1, markerAge / 0.9);
        const s = 1 + k * 1.5;
        marker.scale.set(s, s, 1);
        marker.material.opacity = 0.85 * (1 - k);
        if (k >= 1) marker.visible = false;
      }

      // ② 充电呼吸：机器人真的停在桩上、也没有提示事件时，桩上的充电灯才呼吸
      pulse += Math.max(0, dt);
      const robot = actors.get('robot');
      const docked = Boolean(
        robot
        && !state?.activeEventId
        && !state?.presence?.seat
        && Math.hypot(robot.object3D.position.x - DOCK.x, robot.object3D.position.z - DOCK.z) < 0.4,
      );
      for (const led of dockLights) {
        led.material.emissiveIntensity = docked ? 0.75 + 0.85 * Math.abs(Math.sin(pulse * 1.8)) : 0.14;
      }

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
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },

    info() {
      return renderer.info;
    },

    /** 自测用：导航统计 */
    navStats() {
      return nav.stats();
    },

    kind: '3d',
    scene,
    camera,
    renderer,
    nav,
  };

  return api;
}

export const scene3d = {
  createScene3D, isWebGLAvailable, WAYPOINTS, APPROACH_POINTS, DOCK,
};
