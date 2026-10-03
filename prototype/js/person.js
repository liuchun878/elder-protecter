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
 */

import * as THREE from 'three';

/* ── 配色（王阿姨：银发 · 圆眼镜 · 粉开衫）────────────────────────── */

const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf0cbab, roughness: 0.6, metalness: 0.0 }),
  hair: new THREE.MeshStandardMaterial({ color: 0xd4d1cb, roughness: 0.68, metalness: 0.02 }),
  hairDeep: new THREE.MeshStandardMaterial({ color: 0xbfbbb4, roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide }),
  brow: new THREE.MeshStandardMaterial({ color: 0x8e8880, roughness: 0.8, metalness: 0.0 }),
  cardigan: new THREE.MeshStandardMaterial({ color: 0xc5888c, roughness: 0.94, metalness: 0.0 }),
  cardiganDark: new THREE.MeshStandardMaterial({ color: 0xac757c, roughness: 0.94, metalness: 0.0 }),
  // 开衫是「开襟外壳」，正反面都要可见
  cardiganShell: new THREE.MeshStandardMaterial({ color: 0xc5888c, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide }),
  blouse: new THREE.MeshStandardMaterial({ color: 0xf7f0e5, roughness: 0.92, metalness: 0.0 }),
  trouser: new THREE.MeshStandardMaterial({ color: 0x8e99a8, roughness: 0.9, metalness: 0.0 }),
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
  body.add(pelvis);

  const spine = new THREE.Group();
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
  spine.add(neck);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.047, 0.11, 14), M.skin);
  neckMesh.position.y = 0.028;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = D.headPivotY;
  neck.add(head);
  buildHead(head);

  /* 手臂 */
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * D.shoulderSpan, D.shoulderY, 0.002);
    spine.add(shoulder);

    const deltoid = ellipsoid(0.047, 0.047, 0.047, M.cardigan, 13);
    deltoid.position.set(s * 0.004, -0.002, 0);
    shoulder.add(deltoid);

    segment(shoulder, { r0: 0.044, r1: 0.038, length: D.upperArm, material: M.cardigan });

    const elbow = new THREE.Group();
    elbow.position.y = -D.upperArm;
    shoulder.add(elbow);
    elbow.add(ball(0.038, M.cardigan, 11));

    segment(elbow, { r0: 0.036, r1: 0.029, length: D.forearm, material: M.skin });

    // 袖口：开衫袖子到前臂中段
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.039, 0.032, 12, 1, true), M.cardiganDark);
    cuff.position.y = -0.05;
    elbow.add(cuff);

    const wrist = new THREE.Group();
    wrist.position.y = -D.forearm;
    elbow.add(wrist);
    wrist.add(ball(0.027, M.skin, 10));
    buildHand(wrist, s);

    arms.push({ shoulder, elbow, wrist });
  }

  /* 腿（挂在 pelvis 上：躯干前倾不会带着腿跑） */
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * D.hipSpan, -D.hipOffset, 0);
    pelvis.add(hip);
    hip.add(ellipsoid(0.069, 0.066, 0.068, M.trouser, 13));

    segment(hip, { r0: 0.065, r1: 0.051, length: D.thigh, material: M.trouser });

    const knee = new THREE.Group();
    knee.position.y = -D.thigh;
    hip.add(knee);
    knee.add(ball(0.048, M.trouser, 11));

    segment(knee, { r0: 0.049, r1: 0.033, length: D.shin, material: M.trouser });

    const ankle = new THREE.Group();
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
  const hand = new THREE.Group();
  hand.position.y = -0.012;
  parent.add(hand);

  // 掌 + 四指做成一整块（分成两块会看成「两个球粘一起」）
  const palm = ellipsoid(0.021, 0.058, 0.028, M.skin, 12);
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

/** 每个位置的落位：姿态 + 朝向 + 沿朝向前移量（米） */
const POSE_BY_LOCATION = {
  living_room: { pose: 'sit', seat: SIT_SOFA, arms: ARM_SIT_SOFA, facing: -Math.PI / 2, shift: 0.04 },
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
    facing: -Math.PI / 2,
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
  };

  function apply() {
    spine.rotation.x = view.spineX;
    neck.rotation.x = view.neckX;
    head.rotation.y = view.headY + Math.sin(view.time * 0.55) * 0.05;
    head.rotation.x = view.pose === 'sit' && !view.walking ? 0.04 : 0;
    body.rotation.x = view.bodyX;
    root.position.y = view.y;
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      legs[i].hip.rotation.x = view.thigh[i];
      legs[i].knee.rotation.x = view.knee[i];
      legs[i].ankle.rotation.x = view.ankle[i];
      arms[i].shoulder.rotation.x = view.armX[i];
      arms[i].shoulder.rotation.z = side * view.armZ[i];
      arms[i].elbow.rotation.x = view.elbowX[i];
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

    if (!presence.home) {
      root.visible = false;
      view.moving = false;
      view.walking = false;
      return;
    }
    root.visible = true;

    const point = sceneApi.getWaypoint(presence.location);
    if (!point) return;

    const conf = POSE_BY_LOCATION[presence.location] || POSE_BY_LOCATION.living_room;
    const fx = Math.sin(conf.facing);
    const fz = Math.cos(conf.facing);
    const destX = point.x + fx * conf.shift;
    const destZ = point.z + fz * conf.shift;

    const dx = destX - root.position.x;
    const dz = destZ - root.position.z;
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

    // 关节角度插值：起坐/躺下都是连续动作，不是瞬间跳变
    const target = targetFor(conf, view);
    const rate = view.moving ? 16 : 9;
    const k = 1 - Math.exp(-step * rate);
    view.pose = conf.pose;
    view.walking = view.moving;
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

  return { group: root, update, id: 'wang-ayi' };
}

export const person = { createPerson };
