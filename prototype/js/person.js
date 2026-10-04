/**
 * person.js —— 王阿姨：3D 人形 + 位置与姿态跟随 state（H 线）
 *
 * 契约：契约-接口.md §1（person.js 可 import store.js 只读 + §3.1 场景 API）
 * 约束：
 *   - 不写业务状态；只把 state.presence 映射成位置与姿态
 *   - 不直接操作 renderer / scene；一律走 S 提供的场景 API
 *   - 王阿姨是**虚构人物**，不得写入任何真实老人信息
 *
 * 视觉规格：纯几何体拼装（Lathe / Cylinder / Sphere / Torus / Box），
 * **不引入任何外部 3D 模型资产、贴图或 CDN**（仿真计划 §2.2 + 断网红线）。
 *
 * ── 建模要点 ────────────────────────────────────────────────────────
 * 1. **真实比例**：站高 1.56 m（76 岁女性），约 7.2 头身；颈、肩、腰、胯有真实起伏，
 *    不再是「方盒躯干」。
 * 2. **分节骨骼**：pelvis → spine → neck → head；肩→肘→腕→手；胯→膝→踝→足。
 *    每个关节处都有球体填充，任何角度都不露缝；姿态是**关节角度的纯函数**。
 * 3. **坐姿是反解出来的**：由座面高度解出大腿/膝/踝角度，保证「屁股落在座面上」
 *    与「双脚踩到地面」同时成立；手落在自己大腿上（按臂长反解，不是估角度）。
 * 4. **可辨认的五官**：眼（眼白 + 虹膜）、眉、鼻、嘴、耳 + 圆眼镜（镜框沿面部球面
 *    压低、镜腿按 `atan2` 连到耳侧）；银发（发帽 + 后脑发量 + 鬓角 + 刘海 + 发髻）。
 * 5. **姿态过渡是插值的**：起坐、躺下都是角度插值，不再瞬间跳变。
 * 6. **任意落座点（v1.6）**：`presence.seat` 存在时，位置与朝向直接来自落座点；
 *    坐姿由落座点的 `surfaceY` 反解（家具表面）或走 `FLOOR_SIT`（点地板 → 席地而坐）。
 *    本文件仍然**不判断业务**：落座点从哪来（点击/开关）与它无关。
 * 7. **「取药 · 喝水 · 吃药」动作链（v1.10）**：`beginTake(eventId)` 触发一次可见动作 ——
 *    伸手 → 端杯 → 举到嘴边喝一口 → 放下 → 拿药 → 送到嘴边 → 回自然姿态。
 *    实现方式是**在 state 决定的基线姿态上叠加关节偏移**（偏移归零 = 与从前逐位相同），
 *    所以走位/坐姿/躺姿/席地而坐全不受影响；它只是动作进度，不是业务状态机。
 */

import * as THREE from 'three';
import { fabric } from './textures.js';

/* ── 配色（王阿姨：银发 · 圆眼镜 · 粉开衫）────────────────────────── */

/** 开衫/衬衫/裤子给一层程序化布纹：纯色在写实光照下会「塑料感」很重 */
const knit = (tone, repeat) => new THREE.MeshStandardMaterial({
  map: fabric({ tone, repeat, seed: 3 }),
  roughness: 0.94,
  metalness: 0.0,
});

const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf0cbab, roughness: 0.6, metalness: 0.0 }),
  hair: new THREE.MeshStandardMaterial({ color: 0xc6c2bb, roughness: 0.72, metalness: 0.02 }),
  hairDeep: new THREE.MeshStandardMaterial({ color: 0xafaaa3, roughness: 0.76, metalness: 0.02, side: THREE.DoubleSide }),
  brow: new THREE.MeshStandardMaterial({ color: 0x8e8880, roughness: 0.8, metalness: 0.0 }),
  cardigan: knit(0xbe8f92, [3, 4]),
  cardiganDark: new THREE.MeshStandardMaterial({ color: 0xac757c, roughness: 0.94, metalness: 0.0 }),
  // 开衫是「开襟外壳」，正反面都要可见
  cardiganShell: Object.assign(knit(0xbe8f92, [3, 4]), { side: THREE.DoubleSide }),
  blouse: knit(0xf7f0e5, [4, 5]),
  trouser: knit(0x8e99a8, [3, 3]),
  shoe: new THREE.MeshStandardMaterial({ color: 0x585560, roughness: 0.6, metalness: 0.03 }),
  sole: new THREE.MeshStandardMaterial({ color: 0x3d3b42, roughness: 0.82, metalness: 0.0 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.34, metalness: 0.38 }),
  sclera: new THREE.MeshStandardMaterial({ color: 0xf2ece4, roughness: 0.4, metalness: 0.0 }),
  iris: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.3, metalness: 0.0 }),
  mouth: new THREE.MeshStandardMaterial({ color: 0xa8827f, roughness: 0.68, metalness: 0.0 }),
  button: new THREE.MeshStandardMaterial({ color: 0xe7dfd2, roughness: 0.45, metalness: 0.05 }),
};

/* ── 人体尺寸（米）：局部坐标系「脚底为原点、y 向上、面朝 +z」──────── */

const D = {
  height: 1.56,
  hip: 0.86, // 髋关节高度
  hipOffset: 0.02, // 髋关节略低于骨盆枢轴
  hipSpan: 0.082, // 左右髋关节间距的一半
  thigh: 0.4, // 髋 → 膝
  shin: 0.4, // 膝 → 踝
  shoulderY: 0.352, // 相对骨盆枢轴
  shoulderSpan: 0.142,
  upperArm: 0.255, // 肩 → 肘
  forearm: 0.235, // 肘 → 腕
  handReach: 0.05, // 腕 → 掌心
  neckY: 0.4,
  headPivotY: 0.062,
};

/* ── 几何小工具 ─────────────────────────────────────────────────── */

const SEG = 13;

function ball(r, material, seg = SEG) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(7, seg - 4)), material);
}

function ellipsoid(rx, ry, rz, material, seg = SEG) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.max(7, seg - 4)), material);
  mesh.scale.set(rx, ry, rz);
  return mesh;
}

/**
 * 一段肢体：**上粗下细的圆柱 + 两端球体**。
 * 两端球体是关键——关节转到任何角度都不会露出断面。局部原点在近端关节，沿 -y 延伸。
 */
function segment(parent, { r0, r1, length, material, seg = 12 }) {
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, length, seg, 1, true), material);
  shaft.position.y = -length / 2;
  parent.add(shaft);
  parent.add(ball(r0, material, seg));
  const bottom = ball(r1, material, seg);
  bottom.position.y = -length;
  parent.add(bottom);
  return shaft;
}

/** 在回转体侧面轮廓上按高度插值半径（把纽扣/配饰贴到曲面上） */
function profileRadius(profile, y) {
  for (let i = 1; i < profile.length; i += 1) {
    const [r0, y0] = profile[i - 1];
    const [r1, y1] = profile[i];
    if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0 || 1));
  }
  return profile[profile.length - 1][0];
}

/**
 * 变量开口回转体：每层轮廓可以有不同的开口半角。
 * 用多段 Lathe 拼「V 领」会在接缝处留下法线突变（一条横贯胸口的阴影线）；
 * 这里自己生成顶点，让开口沿高度连续变化，再统一算法线。
 */
function variableLathe(profile, gaps, segments, material) {
  const rows = profile.length;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    for (let j = 0; j < rows; j += 1) {
      const gap = gaps[j];
      const phi = gap + t * (Math.PI * 2 - gap * 2);
      positions.push(profile[j][0] * Math.sin(phi), profile[j][1], profile[j][0] * Math.cos(phi));
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < rows - 1; j += 1) {
      const a = i * rows + j;
      const b = a + rows;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function lathe(profile, segments, material, phiStart, phiLength) {
  return new THREE.Mesh(
    new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments, phiStart, phiLength),
    material,
  );
}

/* ── 躯干轮廓：一个 Lathe 搞定「胯 → 腰 → 胸 → 肩」的真实起伏 ───────── */

const TORSO_PROFILE = [
  [0.024, -0.112],
  [0.096, -0.104],
  [0.141, -0.078],
  [0.157, -0.030],
  [0.152, 0.012],
  [0.138, 0.058], // 腰
  [0.141, 0.104],
  [0.152, 0.168],
  [0.158, 0.212], // 胸
  [0.156, 0.262],
  [0.146, 0.312],
  [0.126, 0.352],
  [0.094, 0.388],
  [0.056, 0.412],
  [0.028, 0.430], // 颈根
];

/** 开衫外壳：比躯干大一圈。**开口分三档收窄**——胸前是 V，到腰下几乎合上 */
const CARDIGAN_PROFILE = TORSO_PROFILE.map(([r, y]) => [r + 0.013, y]);
/** 门襟开口：腰以下几乎合上，往上逐渐张开成 V 领（与 CARDIGAN_PROFILE 逐点对应） */
const CARDIGAN_GAPS = [
  0.05, 0.05, 0.055, 0.06, 0.07, 0.09, 0.12, 0.16, 0.2, 0.25, 0.3, 0.34, 0.36, 0.36, 0.34,
];

/* ── 头部：**一个回转体**，没有球体拼接缝 ──────────────────────────
 * 用多个球叠出来的头会在交界处留下一圈阴影（看着像胡子/接缝）。
 * 这里用一条侧面轮廓绕 y 轴旋转成形，再用 scale.z 把前后拉长 —— 蛋形颅骨、
 * 下颌收窄、颅顶收圆，一次成型。五官按同一条轮廓计算贴合深度。
 */
const FACE_DEPTH = 1.05;

const HEAD_PROFILE = [
  [0.030, -0.006],
  [0.050, 0.006],
  [0.066, 0.028], // 下颌
  [0.078, 0.052],
  [0.086, 0.078],
  [0.092, 0.106], // 颧骨最宽
  [0.091, 0.134],
  [0.089, 0.148],
  [0.086, 0.166], // 发际线
  [0.07, 0.186],
  [0.046, 0.204],
  [0.012, 0.2145], // 颅顶
];

/** 头部在高度 y 处的水平半径 */
function headRadius(y) {
  return profileRadius(HEAD_PROFILE, y);
}

/** 脸部曲面在 (x, y) 处的 z（五官据此贴合，不会浮在脸前） */
function faceZ(x, y) {
  const r = headRadius(y);
  const k = Math.min(1, Math.abs(x) / Math.max(r, 0.001));
  return FACE_DEPTH * r * Math.sqrt(Math.max(0, 1 - k * k));
}

/* ── 拼装人形 ───────────────────────────────────────────────────── */

function buildFigure() {
  const root = new THREE.Group();
  root.name = 'wang-ayi';

  /** body 只在「躺下」时翻转；root.rotation.y 仍留给朝向 */
  const body = new THREE.Group();
  body.name = 'wang-ayi-body';
  root.add(body);

  const pelvis = new THREE.Group();
  pelvis.position.y = D.hip;
  pelvis.name = 'wang-ayi-pelvis';
  body.add(pelvis);

  const spine = new THREE.Group();
  spine.name = 'wang-ayi-spine';
  pelvis.add(spine);

  /* 躯干（衬衫，完整回转体） */
  const torso = lathe(TORSO_PROFILE, 24, M.blouse);
  torso.scale.z = 0.7;
  spine.add(torso);

  /* 开衫外壳：一个网格，开口沿高度从门襟缝渐变到 V 领 */
  const shell = variableLathe(CARDIGAN_PROFILE, CARDIGAN_GAPS, 26, M.cardiganShell);
  shell.scale.z = 0.72;
  spine.add(shell);

  /* 翻领：贴在最上面那一档的 V 形开口两边 */
  for (const s of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.16, 0.008), M.cardiganDark);
    lapel.position.set(s * 0.044, 0.337, 0.086);
    lapel.rotation.z = s * 0.21;
    lapel.rotation.y = s * 0.42;
    spine.add(lapel);
  }

  /* 领口：颈根一圈，遮住衬衫与开衫的接缝 */
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.013, 8, 22), M.cardigan);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.402;
  collar.scale.z = 0.8;
  spine.add(collar);

  /* 衬衫纽扣：贴在回转体正面，落在门襟缝里 */
  for (const y of [0.05, 0.12, 0.19]) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 10), M.button);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, y, profileRadius(TORSO_PROFILE, y) * 0.7 + 0.004);
    spine.add(btn);
  }

  /* 颈 + 头 */
  const neck = new THREE.Group();
  neck.position.y = D.neckY;
  neck.name = 'wang-ayi-neck';
  spine.add(neck);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.047, 0.11, 14), M.skin);
  neckMesh.position.y = 0.028;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = D.headPivotY;
  head.name = 'wang-ayi-head';
  neck.add(head);
  buildHead(head);

  /* 手臂（关节组都带名字：录制/无头探针要按名字取世界坐标做断言） */
  const arms = [];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'l' : 'r';
    const shoulder = new THREE.Group();
    shoulder.name = `wang-ayi-shoulder-${side}`;
    shoulder.position.set(s * D.shoulderSpan, D.shoulderY, 0.002);
    spine.add(shoulder);

    const deltoid = ellipsoid(0.047, 0.047, 0.047, M.cardigan, 13);
    deltoid.position.set(s * 0.004, -0.002, 0);
    shoulder.add(deltoid);

    segment(shoulder, { r0: 0.044, r1: 0.038, length: D.upperArm, material: M.cardigan });

    const elbow = new THREE.Group();
    elbow.name = `wang-ayi-elbow-${side}`;
    elbow.position.y = -D.upperArm;
    shoulder.add(elbow);
    elbow.add(ball(0.038, M.cardigan, 11));

    segment(elbow, { r0: 0.036, r1: 0.029, length: D.forearm, material: M.skin });

    // 袖口：开衫袖子到前臂中段
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.039, 0.032, 12, 1, true), M.cardiganDark);
    cuff.position.y = -0.05;
    elbow.add(cuff);

    const wrist = new THREE.Group();
    wrist.name = `wang-ayi-wrist-${side}`;
    wrist.position.y = -D.forearm;
    elbow.add(wrist);
    wrist.add(ball(0.027, M.skin, 10));
    buildHand(wrist, s);

    arms.push({ shoulder, elbow, wrist });
  }

  /* 腿（挂在 pelvis 上：躯干前倾不会带着腿跑） */
  const legs = [];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'l' : 'r';
    const hip = new THREE.Group();
    hip.name = `wang-ayi-hip-${side}`;
    hip.position.set(s * D.hipSpan, -D.hipOffset, 0);
    pelvis.add(hip);
    hip.add(ellipsoid(0.069, 0.066, 0.068, M.trouser, 13));

    segment(hip, { r0: 0.065, r1: 0.051, length: D.thigh, material: M.trouser });

    const knee = new THREE.Group();
    knee.name = `wang-ayi-knee-${side}`;
    knee.position.y = -D.thigh;
    hip.add(knee);
    knee.add(ball(0.048, M.trouser, 11));

    segment(knee, { r0: 0.049, r1: 0.033, length: D.shin, material: M.trouser });

    const ankle = new THREE.Group();
    ankle.name = `wang-ayi-ankle-${side}`;
    ankle.position.y = -D.shin;
    knee.add(ankle);
    ankle.add(ball(0.031, M.trouser, 10));
    buildShoe(ankle);

    legs.push({ hip, knee, ankle });
  }

  /* 胯部填充：坐姿时大腿与骨盆之间不能露出空腔 */
  const seat = ellipsoid(0.126, 0.086, 0.098, M.trouser, 14);
  seat.position.set(0, -0.064, 0.004);
  pelvis.add(seat);

  return { root, body, pelvis, spine, neck, head, arms, legs };
}

/* ── 头：回转体颅骨 + 五官 + 圆眼镜 + 银发 ───────────────────────── */

function buildHead(head) {
  const skull = lathe(HEAD_PROFILE, 26, M.skin);
  skull.scale.z = FACE_DEPTH;
  head.add(skull);

  for (const s of [-1, 1]) {
    const ear = ellipsoid(0.012, 0.026, 0.019, M.skin, 11);
    ear.position.set(s * 0.085, 0.1, -0.004);
    ear.rotation.y = -s * 0.25;
    head.add(ear);
  }

  // 鼻：鼻尖 + 鼻梁（比单个圆锥柔和），贴合深度取自 faceZ
  const noseTip = ellipsoid(0.014, 0.0115, 0.016, M.skin, 12);
  noseTip.position.set(0, 0.095, faceZ(0, 0.095) - 0.006);
  head.add(noseTip);
  const noseBridge = ellipsoid(0.0085, 0.026, 0.012, M.skin, 10);
  noseBridge.position.set(0, 0.116, faceZ(0, 0.116) - 0.011);
  head.add(noseBridge);

  // 眉：外端略低（老人眉形）
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.009), M.brow);
    brow.position.set(s * 0.034, 0.142, faceZ(0.034, 0.142));
    brow.rotation.z = -s * 0.13;
    brow.rotation.y = s * 0.34;
    head.add(brow);
  }

  // 眼：眼白 + 虹膜。只用深色椭球会在镜框里「糊成一团」
  for (const s of [-1, 1]) {
    const zEye = faceZ(0.033, 0.112);
    const white = ellipsoid(0.0135, 0.0078, 0.0068, M.sclera, 12);
    white.position.set(s * 0.033, 0.112, zEye - 0.005);
    white.rotation.y = s * 0.3;
    head.add(white);

    const iris = ellipsoid(0.0054, 0.0054, 0.0046, M.iris, 10);
    iris.position.set(s * 0.033, 0.112, zEye - 0.0005);
    head.add(iris);
  }

  // 嘴：克制的一条唇线
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.0045, 0.007), M.mouth);
  mouth.position.set(0, 0.064, faceZ(0, 0.064) - 0.0015);
  head.add(mouth);

  buildGlasses(head);
  buildHair(head);
}

/** 圆眼镜：镜框沿面部曲面压低，镜腿用 atan2 连到耳侧 */
function buildGlasses(head) {
  const g = new THREE.Group();
  g.position.set(0, 0.112, faceZ(0, 0.112) - 0.006);
  head.add(g);

  const RIM = 0.027;
  const OPEN = 0.6;

  for (const s of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM, 0.0036, 8, 22), M.frame);
    rim.position.set(s * 0.033, 0, 0.002);
    rim.rotation.y = s * OPEN; // 贴合颧骨弧度
    g.add(rim);

    // 镜腿：从镜框外缘连到耳侧（方向用 atan2 求，不靠手调）
    const hx = s * (0.033 + RIM * Math.cos(OPEN));
    const hz = 0.002 - RIM * Math.sin(OPEN);
    const ex = s * 0.082;
    const ez = -0.06;
    const dx = ex - hx;
    const dz = ez - hz;
    const len = Math.hypot(dx, dz);
    const temple = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.005, len), M.frame);
    temple.position.set((hx + ex) / 2, 0.003, (hz + ez) / 2);
    temple.rotation.y = Math.atan2(dx, dz);
    g.add(temple);

    // 鼻托：把眼镜「架」在鼻梁上，不然镜框像浮在脸前
    const pad = ellipsoid(0.0038, 0.0075, 0.0055, M.frame, 8);
    pad.position.set(s * 0.013, -0.008, -0.009);
    g.add(pad);
  }

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.004, 0.004), M.frame);
  bridge.position.set(0, 0.004, 0.004);
  g.add(bridge);
}

/**
 * 银发：与颅骨**同一条轮廓**、整体放大一圈。
 * 前额留口（LatheGeometry 的 phi=0 正指向 +z）→ 自然形成发际线，
 * 不会像整圈球壳那样变成「头盔」。
 */
function buildHair(head) {
  const HAIR = HEAD_PROFILE.map(([r, y]) => [r + 0.008, y]);
  HAIR.push([0.014, 0.2155], [0.003, 0.2175]); // 封顶，否则颅顶会露出一个头皮小孔
  const HAIRLINE = 8; // HEAD_PROFILE 里 y=0.166 那一点（发际线）

  /**
   * 后脑 + 两鬓 + 后颈：开口**沿高度渐变**（发际线处几乎合拢，到后颈只剩后脑）。
   * 固定开口只有两种结果——开口小 = 锅盖头罩住下颌，开口大 = 像戴了顶帽子。
   */
  const HAIR_GAPS = [1.55, 1.5, 1.42, 1.3, 1.18, 1.06, 0.9, 0.75, 0.55];
  const back = variableLathe(HAIR.slice(0, HAIRLINE + 1), HAIR_GAPS, 26, M.hairDeep);
  back.scale.z = FACE_DEPTH + 0.012;
  head.add(back);

  // 头顶：整圈，下沿正好停在发际线
  const cap = lathe(HAIR.slice(HAIRLINE), 26, M.hair);
  cap.scale.z = FACE_DEPTH + 0.004;
  head.add(cap);

  // 发髻：老年女性的低盘发
  const bun = ellipsoid(0.045, 0.04, 0.04, M.hairDeep, 14);
  bun.position.set(0, 0.1, -0.105);
  head.add(bun);
  const bunCore = ellipsoid(0.03, 0.026, 0.024, M.hair, 10);
  bunCore.position.set(0, 0.108, -0.089);
  head.add(bunCore);
}

/* ── 手：掌 + 四指并拢 + 拇指 ───────────────────────────────────── */

function buildHand(parent, s) {
  const side = s < 0 ? 'l' : 'r';
  const hand = new THREE.Group();
  hand.name = `wang-ayi-hand-${side}`;
  hand.position.y = -0.012;
  parent.add(hand);

  // 掌 + 四指做成一整块（分成两块会看成「两个球粘一起」）
  const palm = ellipsoid(0.021, 0.058, 0.028, M.skin, 12);
  palm.name = `wang-ayi-palm-${side}`;
  palm.position.set(0, -0.046, 0.002);
  hand.add(palm);

  const knuckle = ellipsoid(0.0195, 0.014, 0.026, M.skin, 11);
  knuckle.position.set(0, -0.086, 0.004);
  hand.add(knuckle);

  const thumb = ellipsoid(0.0105, 0.019, 0.012, M.skin, 9);
  thumb.position.set(-s * 0.019, -0.036, 0.012);
  thumb.rotation.z = s * 0.55;
  hand.add(thumb);
}

/* ── 鞋：鞋底 + 鞋面 + 圆头 + 后跟 ──────────────────────────────── */

function buildShoe(ankle) {
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.022, 0.212), M.sole);
  sole.position.set(0, -0.029, 0.05);
  ankle.add(sole);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.05, 0.182), M.shoe);
  upper.position.set(0, -0.001, 0.04);
  ankle.add(upper);

  const toe = ellipsoid(0.041, 0.027, 0.038, M.shoe, 12);
  toe.position.set(0, -0.006, 0.116);
  ankle.add(toe);

  const heel = ellipsoid(0.035, 0.03, 0.033, M.shoe, 11);
  heel.position.set(0, 0.008, -0.03);
  ankle.add(heel);
}

/* ── 姿态：全部是关节角度的纯函数 ───────────────────────────────── */

/**
 * 坐姿由座面高度**反解**，不是拍脑袋给的角度：
 *   髋高 H = 座面 + 骨盆半厚(0.07)；大腿长 0.40、小腿长 0.40、踝高 0.075。
 *   取膝高 0.44（与站姿膝高一致）→ 大腿下倾、小腿后倾，脚正好踩到地面。
 */
function solveSit(seatTop) {
  const H = seatTop + 0.07;
  const ankleY = 0.075;
  const sinT = (H - 0.44) / D.thigh;
  const thigh = -Math.acos(Math.min(1, Math.max(-1, sinT))); // 负 = 向前
  const cosS = (0.44 - ankleY) / D.shin;
  const shinAbs = Math.acos(Math.min(1, Math.max(-1, cosS))); // 小腿相对竖直的后倾角
  return { y: H - D.hip, thigh, knee: shinAbs - thigh, ankle: -shinAbs };
}

const SIT_SOFA = solveSit(0.49); // 沙发座面（room.js：座面顶 0.49）
const SIT_CHAIR = solveSit(0.47); // 餐椅座面（room.js：座面顶 0.47）

/**
 * 坐姿手臂：按**臂长反解**，让掌心落在自己大腿上。
 * 肩高已知 → 掌心目标（大腿前 0.30 m 处的上表面）→ 余弦定理解出肩/肘角度。
 */
function solveSitArms(sit) {
  const hipY = D.hip + sit.y; // 髋关节世界高度
  const shoulderY = hipY + D.shoulderY;
  const fwd = 0.3; // 掌心落在大腿前 0.30 m 处
  const kneeY = hipY - Math.cos(Math.abs(sit.thigh)) * D.thigh; // 髋→膝的下降量（大腿与竖直方向的夹角余弦）
  const centerY = hipY + (kneeY - hipY) * (fwd / D.thigh); // 该处大腿中心高度
  const targetY = centerY + 0.062 + 0.02; // 大腿半径 + 掌心半厚

  const a = D.upperArm;
  const b = D.forearm + D.handReach;
  const dy = targetY - shoulderY;
  const d = Math.hypot(fwd, dy);
  const cosElbow = Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b)));
  const elbowInterior = Math.acos(cosElbow);
  const bend = Math.PI - elbowInterior; // 肘部弯曲量
  const sinB = Math.min(1, Math.max(-1, (b * Math.sin(elbowInterior)) / d));
  const beta = Math.asin(sinB);
  const lineAngle = Math.atan2(fwd, -dy); // 肩→掌心连线相对竖直向前的角
  return { armX: -(lineAngle - beta), elbowX: -bend };
}

const ARM_SIT_SOFA = solveSitArms(SIT_SOFA);
const ARM_SIT_CHAIR = solveSitArms(SIT_CHAIR);

/**
 * 席地而坐（v1.6：点到地板时用）。
 * 座面高 0 塞进 solveSit 会解出「膝盖反折 180°」的畸形姿态，所以低座面单独给一组角度：
 * 腿向前伸（大腿几乎水平）、膝盖只微微弯，脚正好落在地板上。
 * 骨盆中心取 0.15 m —— 再低，胯部那个填充椭球会穿到地板下面去。
 */
const FLOOR_SIT = {
  seat: { y: 0.15 - D.hip, thigh: -1.48, knee: 0.04, ankle: -0.06 },
  arms: { armX: -0.46, elbowX: -0.66 },
};

/** 座面高度 → 坐姿（按厘米缓存：拖动点击时不必每次重解余弦定理） */
const SEAT_CACHE = new Map();
function seatPoseFor(surfaceY) {
  const key = Math.round(Math.max(0, surfaceY) * 100) / 100;
  let pose = SEAT_CACHE.get(key);
  if (!pose) {
    if (key < 0.3) {
      pose = FLOOR_SIT;
    } else {
      const seat = solveSit(key);
      pose = { seat, arms: solveSitArms(seat) };
    }
    SEAT_CACHE.set(key, pose);
  }
  return pose;
}

/** v1.6：点击落座点 → 与 POSE_BY_LOCATION 同结构的配置（shift 恒 0，落点就是最终位置） */
function seatConfig(seat) {
  const { seat: sit, arms } = seatPoseFor(seat.surfaceY);
  return { pose: 'sit', seat: sit, arms, facing: seat.facing, shift: 0 };
}

/** 每个位置的落位：姿态 + 朝向 + 沿朝向前移量（米） */
const POSE_BY_LOCATION = {
  living_room: { pose: 'sit', seat: SIT_SOFA, arms: ARM_SIT_SOFA, facing: Math.PI / 2, shift: 0.04 },
  // 餐椅：room.js 里椅背在座位 -z 侧，人应朝 +z 坐（朝 -z 会被椅背穿过大腿）
  kitchen: { pose: 'sit', seat: SIT_CHAIR, arms: ARM_SIT_CHAIR, facing: 0, shift: 0 },
  // 床：枕头在后墙侧，躺下时头朝 -z；group.z 后移 0.71 让头正好落到枕头上
  bedroom: { pose: 'lie', standY: 0.68, facing: 0, shift: 0.71 },
  away: { pose: 'stand', standY: 0, facing: 0, shift: 0 },
};

/** 站姿 / 坐姿 / 躺姿的基准关节角度 */
const BASE_POSE = {
  stand: {
    y: 0, bodyX: 0, spineX: 0.022, neckX: -0.012, headY: 0,
    thigh: -0.03, knee: 0.05, ankle: -0.02,
    armX: 0, armZ: 0.1, elbowX: -0.16,
  },
  sit: {
    y: 0, bodyX: 0, spineX: 0.05, neckX: 0.03, headY: 0.15,
    armZ: 0.07,
  },
  lie: {
    y: 0.68, bodyX: -Math.PI / 2, spineX: 0.02, neckX: 0, headY: 0,
    thigh: -0.08, knee: 0.2, ankle: 0.04,
    armX: -0.05, armZ: 0.22, elbowX: -0.24,
  },
};

function targetFor(conf, { moving, walkPhase }) {
  /**
   * 走路时**一律用站姿骨架 + 步态**：目标位置的姿态（坐/躺）要等人**到了**再切。
   * 否则去卧室的路上就会开始「平躺」，去沙发的路上就开始「坐着」。
   */
  const walking = Boolean(moving);
  const base = BASE_POSE[walking ? 'stand' : conf.pose] || BASE_POSE.stand;
  const target = {
    y: base.y,
    bodyX: base.bodyX || 0,
    spineX: base.spineX,
    neckX: base.neckX,
    headY: base.headY,
    armX: [base.armX || 0, base.armX || 0],
    armZ: [base.armZ, base.armZ],
    elbowX: [base.elbowX || 0, base.elbowX || 0],
    thigh: [base.thigh || 0, base.thigh || 0],
    knee: [base.knee || 0, base.knee || 0],
    ankle: [base.ankle || 0, base.ankle || 0],
  };

  if (!walking && conf.pose === 'sit') {
    target.y = conf.seat.y;
    for (let i = 0; i < 2; i += 1) {
      target.thigh[i] = conf.seat.thigh;
      target.knee[i] = conf.seat.knee;
      target.ankle[i] = conf.seat.ankle;
      target.armX[i] = conf.arms.armX;
      target.elbowX[i] = conf.arms.elbowX;
    }
  }

  if (walking) {
    for (let i = 0; i < 2; i += 1) {
      const p = walkPhase + i * Math.PI;
      target.thigh[i] = -Math.sin(p) * 0.42;
      target.knee[i] = Math.max(0, Math.sin(p - 0.7)) * 0.8;
      target.ankle[i] = -target.thigh[i] * 0.25;
      target.armX[i] = Math.sin(p) * 0.3; // 与腿反相
    }
    target.y = Math.abs(Math.sin(walkPhase)) * 0.016;
  }

  return target;
}

/* ── 「取药 · 喝水 · 吃药」动作链（**表现层的动作进度**，不是业务状态机）──
 *
 * 谁触发：装配层在「机器人已到位、把药与水递到她跟前」时调一次 `beginTake(eventId)`。
 * 本文件**不判断她该不该吃药**——该不该是 `machine.js` 的业务判定（契约 §1）；
 * 这里只是一个「动作播到第几帧」的进度，跟 `robot.js` 的门/托盘动画同一性质。
 *
 * 为什么用「加法偏移」而不是再写一套姿态：
 *   基线姿态（坐/躺/走/站）永远由 `state` 决定，动作只在它上面**加**一组关节偏移。
 *   偏移全为 0 时，`apply()` 写进去的角度与改动前**逐位相同** —— 动作结束即精确回到原姿态，
 *   走位、坐姿、躺姿、席地而坐、`presence.seat` 反解都不受影响。
 *
 * 角度哪来的：按王阿姨的臂长做了离线反解（2 骨余弦定理 + 局部搜索），
 * 把**掌心**分别送到「机器人托盘位置」「嘴边」，不是拍脑袋试出来的数字。
 * 托盘侧掌心 ≈ (0.18, 0.70, 0.40) m；嘴边掌心 ≈ (0.11, 1.02, 0.18) m（局部坐标，脚底原点）。
 */

/** 五个相位与时长（秒）：reach 伸手 → cup 端杯 → drink 喝一口 → pill 拿药吃 → done 回位 */
const TAKE_PHASES = [
  { phase: 'reach', dur: 0.7 },
  { phase: 'cup', dur: 0.5 },
  { phase: 'drink', dur: 1.3 },
  { phase: 'pill', dur: 1.1 },
  { phase: 'done', dur: 0.6 },
];
const TAKE_TOTAL = TAKE_PHASES.reduce((sum, p) => sum + p.dur, 0); // 4.2 s
const TAKE_PHASE_DUR = Object.fromEntries(TAKE_PHASES.map((p) => [p.phase, p.dur]));
const TAKE_NEXT = {
  reach: 'cup', cup: 'drink', drink: 'pill', pill: 'done', done: 'idle',
};

/**
 * 动作关键帧：t 为动作链内的绝对秒数，与上面的相位边界对齐
 * （reach 收在 0.70、cup 收在 1.20、drink 收在 2.50、pill 收在 3.60、done 收在 4.20）。
 * r / l 是**相对基线姿态的加法偏移** `[肩前后, 肩内外, 肘屈伸]`（弧度）；
 * head 里的 headX 正 = 低头、负 = 仰头，headY 正/负 = 头向左/右转。
 */
const TAKE_KEYS = [
  { t: 0.00, r: [0.00, 0.00, 0.00], l: [0.00, 0.00, 0.00], headX: 0.00, headY: 0.00, neckX: 0.00, spineX: 0.00 },
  // ① reach：右臂前伸到托盘（这一步的位移最大，肉眼一眼能看见）
  { t: 0.70, r: [0.06, -0.02, -0.95], l: [0.00, 0.00, 0.00], headX: 0.34, headY: 0.04, neckX: 0.10, spineX: 0.30 },
  // ② cup：手在托盘上端住杯子（肘略收，像握住杯身）
  { t: 1.20, r: [-0.24, -0.06, -0.52], l: [0.00, 0.00, 0.00], headX: 0.30, headY: 0.04, neckX: 0.09, spineX: 0.32 },
  // ③ drink：举到嘴边（低头就杯）→ 喝一口（再低一点）→ 抬回来
  { t: 1.75, r: [-0.29, -1.50, -1.84], l: [0.00, -0.30, -0.90], headX: 0.17, headY: -0.16, neckX: 0.04, spineX: 0.02 },
  { t: 2.08, r: [-0.36, -1.50, -1.96], l: [0.00, -0.34, -0.95], headX: 0.26, headY: -0.18, neckX: 0.06, spineX: 0.03 },
  { t: 2.34, r: [-0.29, -1.50, -1.82], l: [0.00, -0.30, -0.90], headX: 0.14, headY: -0.16, neckX: 0.03, spineX: 0.02 },
  { t: 2.50, r: [-0.30, -1.50, -1.86], l: [0.00, -0.30, -0.90], headX: 0.18, headY: -0.16, neckX: 0.04, spineX: 0.02 },
  // ④ pill：放下杯子、手回托盘拿药 → 送到嘴边 → 仰头咽下
  { t: 2.95, r: [-0.14, -0.03, -0.72], l: [0.00, 0.00, 0.00], headX: 0.32, headY: 0.02, neckX: 0.10, spineX: 0.30 },
  { t: 3.35, r: [-0.34, -1.50, -1.92], l: [0.00, -0.14, -0.40], headX: 0.12, headY: -0.12, neckX: 0.03, spineX: 0.02 },
  { t: 3.60, r: [-0.36, -1.50, -1.96], l: [0.00, -0.16, -0.44], headX: -0.10, headY: -0.10, neckX: -0.02, spineX: 0.01 },
  // ⑤ done：回自然姿态（偏移归零 → 与动作前逐位相同）
  { t: 4.20, r: [0.00, 0.00, 0.00], l: [0.00, 0.00, 0.00], headX: 0.00, headY: 0.00, neckX: 0.00, spineX: 0.00 },
];

/** 全零偏移（动作不活跃时**共用同一个常量对象**，不每帧新建） */
const NO_GESTURE = Object.freeze({
  armX: Object.freeze([0, 0]),
  armZ: Object.freeze([0, 0]),
  elbowX: Object.freeze([0, 0]),
  headX: 0,
  headY: 0,
  neckX: 0,
  spineX: 0,
});

/** 段内用平滑起停（3u²-2u³）：每段都「起步慢、收尾慢」，看着才像有人在做动作 */
function smoothstep(u) {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** 取动作链在 t 秒处的关节偏移（相位边界处两段共用同一关键帧 → 动作连续不跳变） */
function takeGesture(t) {
  const time = Math.min(Math.max(0, t), TAKE_TOTAL);
  let i = 0;
  while (i < TAKE_KEYS.length - 2 && time > TAKE_KEYS[i + 1].t) i += 1;
  const a = TAKE_KEYS[i];
  const b = TAKE_KEYS[i + 1];
  const k = smoothstep((time - a.t) / ((b.t - a.t) || 1));
  const mix = (p, q) => p + (q - p) * k;
  return {
    // 索引 0 = 左臂、索引 1 = 右臂（与 buildFigure 的 s = -1 / +1 一致）；右臂为主、左臂轻扶
    armX: [mix(a.l[0], b.l[0]), mix(a.r[0], b.r[0])],
    armZ: [mix(a.l[1], b.l[1]), mix(a.r[1], b.r[1])],
    elbowX: [mix(a.l[2], b.l[2]), mix(a.r[2], b.r[2])],
    headX: mix(a.headX, b.headX),
    headY: mix(a.headY, b.headY),
    neckX: mix(a.neckX, b.neckX),
    spineX: mix(a.spineX, b.spineX),
  };
}

/* ── 对外：createPerson ─────────────────────────────────────────── */

function lerp(a, b, k) {
  return a + (b - a) * k;
}

function lerpAngle(a, b, k) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * k;
}

export function createPerson(sceneApi) {
  const { root, body, spine, neck, head, arms, legs } = buildFigure();

  /** 仅视觉状态：当前姿态与朝向（不是业务状态） */
  const view = {
    pose: 'sit',
    facing: Math.PI / 2,
    walkPhase: 0,
    moving: false,
    walking: false,
    time: 0,
    y: 0,
    bodyX: 0,
    spineX: 0.05,
    neckX: 0.03,
    headY: 0.15,
    armX: [0, 0],
    armZ: [0.13, 0.13],
    elbowX: [0, 0],
    thigh: [0, 0],
    knee: [0, 0],
    ankle: [0, 0],
    /** 「取药·喝水·吃药」动作链当前叠加的关节偏移（全零 = 与动作前完全一致） */
    gesture: NO_GESTURE,
  };

  /** 动作链进度（表现层，不是业务状态；`eventId` 只是原样带过来给外部对账） */
  const action = { active: false, eventId: null, phase: 'idle', t: 0, elapsed: 0 };

  /** v1.14：托盘的世界坐标（装配层给）——她"上前一步够托盘"时朝它走；`null` = 不动 */
  let takeTarget = null;
  function setTakeTarget(p) {
    takeTarget = p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null;
    return takeTarget;
  }

  /** 收尾：偏移归零、相位回 idle */
  function endTake() {
    action.active = false;
    action.eventId = null;
    action.phase = 'idle';
    action.t = 0;
    action.elapsed = 0;
  }

  function advanceAction(step) {
    if (!action.active) return;
    action.t += step;
    action.elapsed += step;
    // 一个 dt 可能跨过多个相位；顺序恒定 reach→cup→drink→pill→done→idle
    while (action.active) {
      const dur = TAKE_PHASE_DUR[action.phase] || 0;
      if (action.t < dur) break;
      if (action.phase === 'done') { endTake(); break; }
      action.t -= dur;
      action.phase = TAKE_NEXT[action.phase];
    }
  }

  /**
   * 开始一次「取药 · 喝水 · 吃药」动作（装配层在机器人到位、递上药与水时调一次）。
   * 同一个 eventId 重复调用不会重头播；换 eventId 则重新开始。
   * @param {string|null} eventId 业务事件 id（本文件只原样保存，不做任何判断）
   */
  function beginTake(eventId) {
    const id = eventId == null ? null : String(eventId);
    if (action.active && action.eventId === id) return getAction();
    action.active = true;
    action.eventId = id;
    action.phase = 'reach';
    action.t = 0;
    action.elapsed = 0;
    return getAction();
  }

  /** 动作进度快照（只读）：`t` = 当前相位内已过的秒数 */
  function getAction() {
    return {
      active: action.active,
      eventId: action.eventId,
      phase: action.phase,
      t: action.t,
      elapsed: action.elapsed,
      total: TAKE_TOTAL,
    };
  }

  /**
   * 走位（v1.9）：沿 navgrid 折线走，不再两点一线。
   * 契约：位置仍然**只**来自 `state.presence`；这里只决定"怎么走过去"，
   * 寻路一律问场景 API（`findPath` / `isWalkable`），本文件不放任何业务规则。
   *
   * 为什么终点要拆两段：落座点在家具**内部**（可通行网格里本来就没有它），
   * 直接拿它当寻路终点会被吸附回起点、返回退化折线（这正是之前那次
   * "人走不到坐具上"的根因）。所以：
   *   ① 折线走到坐具外的**入口点**（网格内、离当前位置最近的一圈）
   *   ② 最后一段「落座收尾」（入口点到落座点，通常 ≤0.6 m，大件家具旁可能到 1.6 m）直接挪过去 ——
   *      就是坐下去的那一下
   * 另外：**短距离（≤1.2 m）不走折线**。否则"她已经坐在沙发上、用户又点沙发"
   * 会先被推去入口点再回来，反而多一个起身动作。
   */
  const route = { key: '', path: null, i: 0 };
  const ROUTE_MIN_DIST = 1.2; // 短于它就直接走（收尾动作）

  /** 坐具外的入口点：从最近的一圈开始扫，取离当前位置最近的可走点 */
  function entryPointFor(tx, tz, fromX, fromZ) {
    let best = null;
    for (const r of [0.34, 0.5, 0.68, 0.86, 1.06, 1.3, 1.6]) {
      for (let k = 0; k < 24; k += 1) {
        const a = (k / 24) * Math.PI * 2;
        const x = tx + Math.sin(a) * r;
        const z = tz + Math.cos(a) * r;
        if (typeof sceneApi.isWalkable === 'function' && !sceneApi.isWalkable(x, z)) continue;
        const cost = Math.hypot(x - fromX, z - fromZ);
        if (!best || cost < best.cost) best = { x, z, cost };
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * 规划一次走位：可走的终点直接连折线，不可走的终点（落座点）先到入口点再收尾。
   * ⚠️ `findPath` 会把终点**吸附到最近的可走格**（大件家具旁能差 1 m 以上），
   * 所以只要末节点离目标还有距离就补一段「收尾」，否则会出现"走到一半就停下"。
   */
  function planRoute(key, tx, tz) {
    const from = { x: root.position.x, z: root.position.z };
    route.key = key;
    route.i = 0;
    if (typeof sceneApi.findPath !== 'function') { route.path = [{ x: tx, z: tz }]; return; }
    const goalWalkable = typeof sceneApi.isWalkable !== 'function' ? true : sceneApi.isWalkable(tx, tz);
    const via = goalWalkable ? null : entryPointFor(tx, tz, from.x, from.z);
    const goal = via || { x: tx, z: tz };
    const path = sceneApi.findPath(from, goal);
    route.path = (path && path.length)
      ? path.map((p) => ({ x: p.x, z: p.z }))
      : [{ x: goal.x, z: goal.z }];
    const last = route.path[route.path.length - 1];
    if (Math.hypot(last.x - tx, last.z - tz) > 0.12) route.path.push({ x: tx, z: tz });
  }

  function apply() {
    /** 动作链是**加法偏移**：不活跃时 g 的每一项都是 0，写进去的角度与从前逐位相同 */
    const g = view.gesture;
    spine.rotation.x = view.spineX + g.spineX;
    neck.rotation.x = view.neckX + g.neckX;
    head.rotation.y = view.headY + g.headY + Math.sin(view.time * 0.55) * 0.05;
    head.rotation.x = (view.pose === 'sit' && !view.walking ? 0.04 : 0) + g.headX;
    body.rotation.x = view.bodyX;
    root.position.y = view.y;
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      legs[i].hip.rotation.x = view.thigh[i];
      legs[i].knee.rotation.x = view.knee[i];
      legs[i].ankle.rotation.x = view.ankle[i];
      arms[i].shoulder.rotation.x = view.armX[i] + g.armX[i];
      arms[i].shoulder.rotation.z = side * (view.armZ[i] + g.armZ[i]);
      arms[i].elbow.rotation.x = view.elbowX[i] + g.elbowX[i];
      arms[i].elbow.rotation.z = side * 0.06;
    }
  }

  /** 初始落位：直接摆在客厅沙发上，避免复位时看到人从原点走过来 */
  const home = POSE_BY_LOCATION.living_room;
  const homePoint = sceneApi.getWaypoint('living_room');
  if (homePoint) {
    root.position.set(homePoint.x + Math.sin(home.facing) * home.shift, 0, homePoint.z + Math.cos(home.facing) * home.shift);
  }
  const homeTarget = targetFor(home, { moving: false, walkPhase: 0 });
  view.y = homeTarget.y;
  view.spineX = homeTarget.spineX;
  view.neckX = homeTarget.neckX;
  view.headY = homeTarget.headY;
  for (let i = 0; i < 2; i += 1) {
    view.thigh[i] = homeTarget.thigh[i];
    view.knee[i] = homeTarget.knee[i];
    view.ankle[i] = homeTarget.ankle[i];
    view.armX[i] = homeTarget.armX[i];
    view.armZ[i] = homeTarget.armZ[i];
    view.elbowX[i] = homeTarget.elbowX[i];
  }
  apply();
  sceneApi.addActor({ id: 'wang-ayi', kind: 'person', object3D: root, radius: 0.32 });

  /**
   * 位置与姿态跟随 state（纯视觉，不改 state）
   * @param {object} state StateSnapshot
   * @param {number} dt 秒
   */
  function update(state, dt) {
    const presence = state.presence;
    const step = Math.max(0, dt);
    view.time += step;
    // 动作链按真实 dt 推进（只在场时推进）；相位推进与姿态解算分开，姿态仍只由 state 决定
    advanceAction(step);

    if (!presence.home) {
      root.visible = false;
      view.moving = false;
      view.walking = false;
      // 人不在家，「取药·喝水·吃药」不可能继续：直接收尾（偏移归零）
      if (action.active) endTake();
      view.gesture = NO_GESTURE;
      return;
    }
    root.visible = true;

    // v1.6：有落座点（点了场景里的任意位置）就用落座点，否则用该位置的预设落位
    const seat = presence.seat;
    const conf = seat ? seatConfig(seat) : (POSE_BY_LOCATION[presence.location] || POSE_BY_LOCATION.living_room);
    const point = seat ? { x: seat.x, y: 0, z: seat.z } : sceneApi.getWaypoint(presence.location);
    if (!point) return;
    const fx = Math.sin(conf.facing);
    const fz = Math.cos(conf.facing);
    const destX = point.x + fx * conf.shift;
    const destZ = point.z + fz * conf.shift;

    // 走位：长距离沿 navgrid 折线（不穿墙、不穿家具），短距离直接收尾
    const key = seat
      ? `seat:${destX.toFixed(2)},${destZ.toFixed(2)},${conf.pose}`
      : `loc:${presence.location}`;
    const straight = Math.hypot(destX - root.position.x, destZ - root.position.z);
    const useRoute = straight > ROUTE_MIN_DIST;
    if (!useRoute) {
      route.key = '';
      route.path = null;
    } else if (route.key !== key || !route.path) {
      planRoute(key, destX, destZ);
    }

    let aimX = destX;
    let aimZ = destZ;
    if (useRoute) {
      // 推进到当前要追的节点（到点即换下一个）
      while (route.i < route.path.length - 1
        && Math.hypot(route.path[route.i].x - root.position.x, route.path[route.i].z - root.position.z) <= 0.14) {
        route.i += 1;
      }
      const wp = route.path[Math.min(route.i, route.path.length - 1)];
      aimX = wp.x;
      aimZ = wp.z;
    }

    const dx = aimX - root.position.x;
    const dz = aimZ - root.position.z;
    const distance = Math.hypot(dx, dz);
    view.moving = distance > 0.03;

    if (view.moving) {
      const speed = 1.0; // 与机器人同速量级
      const move = Math.min(distance, speed * step);
      root.position.x += (dx / distance) * move;
      root.position.z += (dz / distance) * move;
      view.facing = lerpAngle(view.facing, Math.atan2(dx, dz), 1 - Math.exp(-step * 6));
      view.walkPhase += move * 5.4;
    } else {
      view.facing = lerpAngle(view.facing, conf.facing, 1 - Math.exp(-step * 5));
    }
    root.rotation.y = view.facing;

    /* v1.14：**上前一步去够托盘**（纯表现层位移，不改 `presence`）。
     * 场景给的停靠点是"绕开家具能站"的位置，她坐/站在沙发那侧时实测离机器人 ~1.26 m，
     * 纯伸手（臂长 ~0.6 m）够不到托盘 —— 用户口径「奶奶需要伸手拿托盘上的药」。
     * 做法：把 `body`（root 内的姿态组，不参与走位积分）朝托盘方向平移一段，
     * 目标是「她到托盘 ≈ 0.45 m」；坐姿时只挪 0.25 m（坐着挪太多会像滑行），站姿最多 0.75 m。
     * 位移随动作链进出平滑（起步从 0 长出来、结束缩回 0），动作一结束就精确回位。 */
    if (action.active && takeTarget) {
      const tx = takeTarget.x - root.position.x;
      const tz = takeTarget.z - root.position.z;
      const td = Math.hypot(tx, tz) || 1;
      const cap = conf.pose === 'sit' ? 0.62 : 0.92;
      const want = Math.min(cap, Math.max(0, td - 0.42));
      const u = Math.min(1, action.elapsed / 0.75) * Math.min(1, (TAKE_TOTAL - action.elapsed) / 0.7);
      const stepLen = want * Math.max(0, u);
      const wx = (tx / td) * stepLen;
      const wz = (tz / td) * stepLen;
      const c = Math.cos(view.facing);
      const s = Math.sin(view.facing);
      body.position.x = wx * c - wz * s; // 世界位移 → root 局部（绕 y 转 -facing）
      body.position.z = wx * s + wz * c;
      view.facing = lerpAngle(view.facing, Math.atan2(tx, tz), 1 - Math.exp(-step * 5));
    } else if (body.position.x !== 0 || body.position.z !== 0) {
      body.position.x = 0;
      body.position.z = 0;
    }

    // 关节角度插值：起坐/躺下都是连续动作，不是瞬间跳变
    const target = targetFor(conf, view);
    const rate = view.moving ? 16 : 9;
    const k = 1 - Math.exp(-step * rate);
    view.pose = conf.pose;
    view.walking = view.moving;
    // 动作偏移：活跃时按动作链取，结束（或未开始）时用全零常量 → 精确回到基础姿态
    view.gesture = action.active ? takeGesture(action.elapsed) : NO_GESTURE;
    view.y = lerp(view.y, target.y, k);
    view.bodyX = lerp(view.bodyX, target.bodyX, k);
    view.spineX = lerp(view.spineX, target.spineX, k);
    view.neckX = lerp(view.neckX, target.neckX, k);
    view.headY = lerp(view.headY, target.headY, k);
    for (let i = 0; i < 2; i += 1) {
      view.thigh[i] = lerp(view.thigh[i], target.thigh[i], k);
      view.knee[i] = lerp(view.knee[i], target.knee[i], k);
      view.ankle[i] = lerp(view.ankle[i], target.ankle[i], k);
      view.armX[i] = lerp(view.armX[i], target.armX[i], k);
      view.armZ[i] = lerp(view.armZ[i], target.armZ[i], k);
      view.elbowX[i] = lerp(view.elbowX[i], target.elbowX[i], k);
    }

    apply();
  }

  /** v1.14：**右手掌心节点**（只读）—— 装配层把机器人托盘上的杯子 `attach` 到这里，
   * 「端杯子喝水」才真的看得见（否则只是手臂在动、杯子原地消失）。 */
  function getHandAnchor() {
    return root.getObjectByName('wang-ayi-hand-r') || null;
  }

  const api = { group: root, update, id: 'wang-ayi', beginTake, getAction, getHandAnchor, setTakeTarget };
  /**
   * 自动化入口（无头探针 / 录屏脚本用）：`object3D.userData.person` 直接拿到同一组 API。
   * 只是把**已经导出**的接口挂到场景图上的角色对象上，不额外放宽任何权限、不新增业务规则。
   */
  root.userData.person = api;
  return api;
}

export const person = { createPerson };
