/**
 * asset-loader.js —— 外部 `.glb` 资产的加载、归一化与元数据推导
 *
 * ⚠️ 这是**唯一的**外部资产入口。任何 `.glb` 都必须走这里，不许在别处 `new GLTFLoader()`。
 *
 * 归属：S 线（场景线）。消费方：`robot.js`（R）、`person.js`（H）、`room.js`（S）。
 *
 * ── 为什么需要一个「归一化」层 ──────────────────────────────────────
 * `.glb` 是别人生成了给我的，我不能假设它符合本项目的坐标约定。项目所有几何体用的是
 * **脚底为原点、y 向上、面朝 +z**（见 person.js 头注释与 robot.js 的 Y 表）。而模型可能：
 *   · 以包围盒中心为原点（最常见的导出默认）；
 *   · 朝 −z 或 +x 或任意方向；
 *   · 单位是厘米 / 英寸，或生成时尺寸就没对准。
 * 因此这里做三件事：**接地**（底面对齐 y=0）→ **朝向对齐**（面朝 +z）→ **按真实尺寸缩放**。
 *
 * ── 红线与偏离记录 ────────────────────────────────────────────────
 * 引入外部模型资产**偏离**了 AGENTS.md §6「不引入外部模型资产」。该偏离由项目所有者裁定，
 * 记录在 `THIRD-PARTY.md` 与 `prototype/assets/README.md`。本文件不改变「运行期零外部请求」：
 * `.glb` 是**提交进仓库的本地文件**，由同一个静态服务器提供。
 *
 * 本文件只 import `three` 与 vendored 的 addons —— 不引入任何新依赖。
 * 它**不读 store、不写业务状态**（契约 §1.1）。
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

/** 模型清单：`prototype/assets/manifest.json`。集中描述「有哪些资产、各自怎么归一化」。 */
const DEFAULT_MANIFEST_URL = './assets/manifest.json';

/** 三次元：向量比较用的容差 */
const EPS = 1e-6;

const cache = new Map(); // url → Promise<{ gltf, }>
let manifestCache = null;
let loader = null;

function getLoader() {
  if (!loader) loader = new GLTFLoader();
  return loader;
}

/* ── 基础量算 ─────────────────────────────────────────────────────── */

/** 量一个对象的**世界**包围盒（含已施加的旋转/缩放） */
export function measure(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (box.isEmpty()) return null;
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center, min: box.min.clone(), max: box.max.clone() };
}

/** 统计网格 / 三角形 / 蒙皮 / 动画，用于在 inspector 与自测里核对模型是否真的加载进来 */
export function summarize(object) {
  const info = {
    meshes: 0, triangles: 0, skinnedMeshes: 0, bones: 0, materials: new Set(), textures: new Set(),
  };
  object.traverse((node) => {
    if (node.isBone) info.bones += 1;
    if (!node.isMesh) return;
    info.meshes += 1;
    if (node.isSkinnedMesh) info.skinnedMeshes += 1;
    const geo = node.geometry;
    if (geo) {
      const count = geo.index ? geo.index.count : (geo.attributes.position?.count || 0);
      info.triangles += Math.floor(count / 3);
    }
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of mats) {
      if (!m) continue;
      info.materials.add(m.uuid);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        if (m[key]) info.textures.add(m[key].uuid);
      }
    }
  });
  info.materials = info.materials.size;
  info.textures = info.textures.size;
  return info;
}

/* ── 变换（每一步都立刻回量，保证报告里的数字是真实的）───────────── */

/**
 * 按目标高度缩放：`k = 目标高 / 实测高`。
 * 只对 `fit: 'height'` 生效；`fit: 'none'` 表示"生成时尺寸就是对的，别动我"。
 */
export function scaleToRealSize(object, spec) {
  const m = measure(object);
  if (!m) return { applied: false, reason: 'empty' };
  const fit = spec.fit || 'height';
  if (fit === 'none') return { applied: false, reason: 'fit=none', measured: m.size.clone() };

  const axis = fit === 'footprint' ? null : (spec.fitAxis || 'y');
  let current;
  if (fit === 'height') current = axis === 'x' ? m.size.x : axis === 'z' ? m.size.z : m.size.y;
  // footprint：按占地最长边归一到 realFootprint
  else current = Math.max(m.size.x, m.size.z);
  if (!(current > EPS)) return { applied: false, reason: 'zero-extent' };

  const target = fit === 'height' ? spec.realHeight : spec.realFootprint;
  if (!(target > 0)) return { applied: false, reason: 'no-target' };

  const k = target / current;
  object.scale.multiplyScalar(k);
  return { applied: true, factor: k, axis: fit === 'height' ? axis : 'xz', measured: m.size.clone() };
}

/**
 * 朝向对齐：把模型的「正面」转到世界 **+z**。
 *
 * `forward` 是**模型自身坐标系**里"脸/车头朝哪"的近似方向；它会绕 y 被转到 +z。
 * `flip` 用于解决「朝向轴对了但正负反了」——因为绕 y 的旋转**永远无法**把 −z 变成 +z，
 * 那种情况必须整体转 180°，所以单独给一个开关（`asset-inspector.html` 会把它指出来）。
 */
export function alignForward(object, spec) {
  const f = spec.forward || [0, 0, 1];
  const v = new THREE.Vector3(f[0] || 0, f[1] || 0, f[2] || 0);
  if (!spec.forward) return { applied: false, reason: 'forward 未指定（默认就是 +z，视为已对齐）' };

  const flat = new THREE.Vector3(v.x, 0, v.z);
  if (flat.length() < 1e-3) flat.set(0, 0, 1);
  flat.normalize();

  // 绕 y 把 flat 转到 (0,0,1)
  const angle = Math.atan2(flat.x, flat.z);
  object.rotation.y += -angle;

  let flipped = false;
  if (spec.flip) {
    object.rotation.y += Math.PI;
    flipped = true;
  }
  // 绕 y 的旋转不改变几何，不需要重新接地；但世界包围盒会变，交给调用方回量
  return { applied: Math.abs(angle) > 1e-4 || flipped, angle, flipped };
}

/** 接地：底面对齐 y=0（导出默认多是"以质心为原点"，直接放场景会陷进地板） */
export function groundToFloor(object) {
  const m = measure(object);
  if (!m) return { applied: false, reason: 'empty' };
  const dy = -m.min.y;
  if (Math.abs(dy) < 1e-4) return { applied: false, dy: 0 };
  object.position.y += dy;
  return { applied: true, dy };
}

/**
 * 归一化主流程：接地 → 朝向 → 缩放 → 再接地。
 * **每步都回量并写进 report**，因为这两件事会互相影响（旋转后包围盒变了，接地要重做）。
 */
export function normalize(object, spec = {}) {
  const report = { steps: {}, before: null, after: null };
  report.before = (() => { const m = measure(object); return m ? { size: m.size.toArray(), minY: m.min.y } : null; })();

  // ① 先朝向：旋转会改变包围盒，先做省得反复接地
  report.steps.forward = alignForward(object, spec);
  // ② 再缩放
  report.steps.scale = scaleToRealSize(object, spec);
  // ③ 最后接地（缩放过底面也会动）
  report.steps.ground = groundToFloor(object);

  report.after = (() => { const m = measure(object); return m ? { size: m.size.toArray(), minY: m.min.y } : null; })();
  return report;
}

/* ── 座面 / 碰撞盒推导 ────────────────────────────────────────────── */

/**
 * 从家具元数据推导**落座点**（契约 §3.1 的落座判据用的就是这套几何量）。
 *
 * 输入 `seatY`（座面高度）是**必要的**——`.glb` 不会告诉你哪块面是"能坐的"，
 * 从几何猜座面高度就是猜业务含义。所以这里要求显式给，推导的只是**世界坐标**：
 * 把模型内的局部座面点换算到场景坐标 + 应用朝向。
 *
 * @returns {null | {x, z, surfaceY, kind, yaw}}
 */
export function deriveSeat(object, entry) {
  const seat = entry && entry.seat;
  if (!seat) return null;
  const p = seat.local || [0, 0, 0];
  const world = object.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));
  return {
    x: world.x,
    z: world.z,
    surfaceY: seat.surfaceY,
    kind: seat.kind || 'surface',
    yaw: seat.yaw || 0,
  };
}

/**
 * 碰撞盒推导（给 `navgrid.js` 的家具占位用）。
 *
 * ⚠️ **诚实的边界**：这只能给"一个轴对齐的占位盒"，它**不是**精确碰撞体。
 * 对沙发/茶几/电视柜这种一件一盒的家具够用；对**整个房间硬装**（墙 + 门洞 + 敞口）
 * 远远不够——墙要的是墙段与门洞，不是一个大盒子。房间的碰撞体必须单独给
 * （见 `assets/README.md` 与 STATUS.md 的已知风险）。`mode: 'none'` 可显式关掉。
 *
 * @returns {null | {minX, maxX, minZ, maxZ, height}}
 */
export function deriveBlock(object, entry = {}) {
  const cfg = entry.collider || {};
  if (cfg.mode === 'none') return null;
  const m = measure(object);
  if (!m) return null;
  const expand = cfg.expand || 0; // 外扩（比如沙发坐垫比扶手窄）
  return {
    minX: m.min.x - expand, maxX: m.max.x + expand,
    minZ: m.min.z - expand, maxZ: m.max.z + expand,
    height: m.size.y,
  };
}

/* ── 材质修补 ─────────────────────────────────────────────────────── */

/**
 * 外部模型的材质常有两个问题，不修会在本项目的 ACES + 软阴影下很难看：
 *   ① 导出成 MeshBasicMaterial / 缺 metalness-roughness（当成无光照）；
 *   ② 标了 `castShadow=false`，落地没有影子，看着像贴纸。
 * 这里只**补齐缺失项**，不改作者给的颜色与贴图。
 */
export function fixMaterials(object, { shadows = true } = {}) {
  let converted = 0; let textured = 0;
  object.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    const next = mats.map((m) => {
      if (!m) return m;
      if (m.isMeshBasicMaterial || (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial)) {
        converted += 1;
        const std = new THREE.MeshStandardMaterial({
          color: m.color ? m.color.clone() : 0xffffff,
          map: m.map || null,
          transparent: m.transparent,
          opacity: m.opacity,
          side: m.side,
          roughness: 0.62,
          metalness: 0.0,
        });
        std.name = m.name;
        return std;
      }
      if (m.roughness === undefined) m.roughness = 0.6;
      return m;
    });
    node.material = Array.isArray(node.material) ? next : next[0];

    // 贴图的色彩空间：glTF 规定 baseColor 是 sRGB，法线/粗糙度是线性。
    // 某些导出器不写这个标记，颜色会整体发灰。
    const handle = (tex, srgb) => {
      if (tex && tex.isTexture && tex.colorSpace !== (srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace)) {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        textured += 1;
      }
    };
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!m) continue;
      handle(m.map, true);
      handle(m.emissiveMap, true);
      handle(m.normalMap, false);
      handle(m.roughnessMap, false);
      handle(m.metalnessMap, false);
      handle(m.aoMap, false);
    }

    if (shadows) { node.castShadow = true; node.receiveShadow = true; }
    node.frustumCulled = false; // 蒙皮模型按原始包围盒剔除会闪掉，交给上层显式控制
  });
  return { converted, textured };
}

/* ── 清单 ─────────────────────────────────────────────────────────── */

export function parseManifest(json) {
  const models = (json && json.models) || {};
  const out = new Map();
  for (const [id, entry] of Object.entries(models)) {
    if (!entry || !entry.file) continue;
    out.set(id, { id, ...entry, url: `./assets/${entry.file}` });
  }
  return { version: (json && json.version) || 1, models: out };
}

export async function loadManifest(url = DEFAULT_MANIFEST_URL) {
  if (manifestCache) return manifestCache;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest 读取失败：HTTP ${res.status}（${url}）`);
  manifestCache = parseManifest(await res.json());
  return manifestCache;
}

/** 列出清单里所有模型（供 `asset-inspector.html` 与调试抽屉用） */
export async function listAssets() {
  const m = await loadManifest();
  return [...m.models.values()];
}

/* ── 加载 ─────────────────────────────────────────────────────────── */

/**
 * 按 id 从清单加载一个模型，归一化后返回。
 *
 * @param {string} id
 * @param {{manifest?: string}} [opts]
 * @returns {Promise<{
 *   id: string, object: THREE.Object3D, animations: AnimationClip[],
 *   report: object, info: object, entry: object,
 *   realSize: {x,y,z} | null, seat: object|null, block: object|null,
 * }>}
 */
export async function loadAsset(id, opts = {}) {
  const manifest = await loadManifest(opts.manifest || DEFAULT_MANIFEST_URL);
  const entry = manifest.models.get(id);
  if (!entry) throw new Error(`清单里没有资产「${id}」（见 assets/manifest.json）`);

  if (!cache.has(entry.url)) {
    cache.set(entry.url, getLoader().loadAsync(entry.url).then((gltf) => ({ gltf, url: entry.url })));
  }
  const { gltf } = await cache.get(entry.url);

  // 每次都从"干净的一份"开始：同一资产可能被多处请求（主演示 + 预览台），
  // 共享同一个 Object3D 会被两边的 transform 互相踩。
  const object = gltf.scene.clone(true);
  object.name = entry.name || id;

  const materials = fixMaterials(object, { shadows: entry.shadows !== false });
  const report = normalize(object, entry);

  const info = summarize(object);
  const measured = measure(object);
  const target = entry.fit === 'height' ? entry.realHeight : null;
  const actual = measured ? (entry.fitAxis === 'z' ? measured.size.z : measured.size.y) : null;

  // 偏差告警：归一化后实测高度与声明高度差超过 2% 就说不通，说明清单写错了
  const mismatch = target && actual ? Math.abs(actual - target) / target : 0;
  if (mismatch > 0.02) {
    console.warn(`[asset-loader] 「${id}」归一化后高度 ${actual?.toFixed(3)} m，与清单声明的 ${target} m 相差 ${(mismatch * 100).toFixed(1)}%`);
  }

  return {
    id,
    object,
    animations: gltf.animations ? gltf.animations.slice() : [],
    entry,
    report,
    materials,
    info,
    realSize: measured ? { x: measured.size.x, y: measured.size.y, z: measured.size.z } : null,
    seat: deriveSeat(object, entry),
    block: deriveBlock(object, entry),
  };
}

/** 清掉缓存（改完 .glb 或 manifest 后，自测脚本用） */
export function resetAssetCache() {
  cache.clear();
  manifestCache = null;
}

/** 给 `sceneApi.addActor` 用的碰撞半径：优先用清单声明的，否则由占地推 */
export function actorRadius(asset, entry = {}) {
  if (entry.radius) return entry.radius;
  const b = asset && asset.block;
  if (!b) return 0.3;
  return Math.max(0.16, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2);
}
