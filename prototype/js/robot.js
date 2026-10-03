/**
 * robot.js —— 机器人本体 + 行为动画（R 线）
 *
 * 契约：契约-接口.md §1.1（机器人行为必须是 StateSnapshot 的**纯函数**，不许自己再写业务状态机）
 *       §3.1 场景 API
 *
 * 它只做四件事：走到 presence.location、药盘抬升、提示时发光、空闲回充电座。
 * 「到点该不该送」「送完算不算确认」全部由 H 的 machine.js 决定——本文件不判断业务。
 *
 * ── 造型依据：真实样机 UNNC-AGV（CAD 实测，非臆造）────────────────────
 * 参考 `unnc-sophicar/UNNC-AGV-P-1.STEP`（SolidWorks 装配体导出）。把装配体逐级放置矩阵
 * 展开后量出的真实尺寸（已把地面归零、水平居中，单位米）：
 *
 *   总体      442(X) × 402(Z) × 807(Y)      地面到顶板 0.800
 *   顶板      400 × 400 × 3      y = 0.800   中板 400×400×3  y = 0.160
 *   底板      400 × 400 × 3      y = 0.047
 *   立柱 ×4   20×20 型材 长 750   y 0.049..0.799，位于 (±0.1345, ±0.1345)
 *   驱动轮 ×2 Ø154 厚 46         x = ±0.198，轮轴 y = 0.077（离地）
 *   电机 ×2   MD36LP27 Ø37 长135 x = ±0.0955，与轮同轴，经联轴器驱动
 *   联轴器 ×2 Ø52 长 26          x = ±0.1615
 *   万向轮 ×2 Ø38                (0, ·, ±0.183)，轮底 y ≈ 0.008
 *   电池      P761S 165×43×177   座在中板上，y 0.162..0.205
 *   角件 ×12  LBSB6 26×21×26     底板/中板/顶板 三层各四角
 *
 * **只借结构，不借资产**：下面全部是 Box / Cylinder / Sphere / Torus 拼出来的，
 * 仓库里不落任何 CAD 文件、网格或贴图（红线：断网可用、无外部模型资产）。
 *
 * 与 CAD 有意不同的两点（都不是结构，是交互）：
 *   1. 前端显示屏（脸）：真机是开口框架，没有屏。仿真需要给老人一个「看哪里」的落点，
 *      所以把屏挂在顶板前缘——真机的电子舱也在这个位置。
 *   2. 升降药盘：CAD 里四根立柱上有线性滑块（LBSB6），但从几何判不出具体升降机构，
 *      仿真继续沿用「托盘抬升」这个抽象（契约里的表现，不是业务）。
 */

import * as THREE from 'three';

const ALU = 0x9aa4ad; // 2020 型材
const PLATE = 0xe8eaec; // 铝板
const TIRE = 0x2b2f33; // 轮胎
const HUB = 0xb9c0c6; // 轮毂 / 联轴器
const MOTOR = 0x3d434a; // 电机
const BODY_WHITE = 0xf7f7f4;
const BODY_DARK = 0x24343d; // 显示屏底
const TEAL = 0x6fd3d9;
const ORANGE = 0xe8863c;
const BATTERY = 0x2f6fb4; // P761S 锂电池组

const SPEED = 1.2; // m/s（预置路径动画，不宣称导航能力）
const TRAY_LIFT = 0.34; // 药盘抬升高度
const TRAY_TIME = 0.6; // 药盘抬升耗时（秒）

/* ── CAD 实测尺寸 ─────────────────────────────────────────────────── */
const R = {
  deck: 0.4, // 400×400 铝板
  deckT: 0.008,
  yBottom: 0.047,
  yMiddle: 0.16,
  yTop: 0.8,

  post: 0.027, // 20 型材（含角件外皮）
  postH: 0.75,
  postXZ: 0.1345,

  wheelR: 0.077, // Ø154 驱动轮
  wheelW: 0.046,
  wheelX: 0.198,
  axleY: 0.077,

  motorR: 0.0185, // MD36LP27
  motorL: 0.135,
  motorX: 0.0955,
  coupR: 0.026,
  coupL: 0.026,
  coupX: 0.1615,

  casterR: 0.019, // 万向轮
  casterZ: 0.183,
  casterY: 0.027,

  battX: 0.165,
  battY: 0.043,
  battZ: 0.177,
  battCY: 0.1835,
};

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

function buildRobot() {
  const group = new THREE.Group();
  group.name = 'robot';

  const M = {
    alu: mat(ALU, 0.5, { metalness: 0.18 }),
    plate: mat(PLATE, 0.55, { metalness: 0.12 }),
    tire: mat(TIRE, 0.92),
    hub: mat(HUB, 0.4, { metalness: 0.35 }),
    motor: mat(MOTOR, 0.55, { metalness: 0.25 }),
    battery: mat(BATTERY, 0.6),
    white: mat(BODY_WHITE, 0.5),
    dark: mat(BODY_DARK, 0.35),
  };

  /* ── 底板 / 中板（中板托着电池，是电气舱）───────────────────────── */
  group.add(box(R.deck, R.deckT, R.deck, M.plate, 0, R.yBottom, 0));
  group.add(box(R.deck, R.deckT, R.deck, M.plate, 0, R.yMiddle, 0));
  group.add(box(R.deck, R.deckT, R.deck, M.plate, 0, R.yTop, 0));

  const battery = box(R.battX, R.battY, R.battZ, M.battery, 0.0095, R.battCY, 0);
  group.add(battery);
  // 电池两端的极柱，让「这是一块电池」在 1.4 m 机位下也读得出来
  for (const z of [-R.battZ / 2 + 0.02, R.battZ / 2 - 0.02]) {
    for (const x of [0.075, -0.056]) {
      const post = cyl(0.011, 0.011, 0.02, M.hub, 12, 'y');
      post.position.set(x, R.battCY + 0.03, z);
      group.add(post);
    }
  }

  // 驱动器 / 控制盒（真机电气舱里还有驱动板，这里给个体块，避免中板空一块）
  group.add(box(0.14, 0.055, 0.05, M.dark, 0, 0.195, -0.128));
  for (const x of [-0.05, 0, 0.05]) {
    const fin = box(0.008, 0.062, 0.052, M.alu, x, 0.195, -0.128);
    group.add(fin);
  }

  /* ── 四根 2020 立柱 + 三成角件 ──────────────────────────────────── */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * R.postXZ;
      const z = sz * R.postXZ;
      group.add(box(R.post, R.postH, R.post, M.alu, x, (0.049 + 0.799) / 2, z));
      for (const y of [0.0585, 0.1495, 0.7895]) {
        group.add(box(0.03, 0.021, 0.03, M.alu, x, y, z));
      }
    }
  }

  /* ── 驱动轮 + 电机 + 联轴器（差速驱动，同轴）────────────────────── */
  for (const s of [-1, 1]) {
    const wheel = cyl(R.wheelR, R.wheelR, R.wheelW, M.tire, 26, 'x');
    wheel.position.set(s * R.wheelX, R.axleY, 0);
    group.add(wheel);
    const hub = cyl(0.034, 0.034, R.wheelW + 0.006, M.hub, 16, 'x');
    hub.position.set(s * R.wheelX, R.axleY, 0);
    group.add(hub);

    const motor = cyl(R.motorR, R.motorR, R.motorL, M.motor, 16, 'x');
    motor.position.set(s * R.motorX, R.axleY, 0);
    group.add(motor);
    // 电机尾部的编码器/接线座
    group.add(box(0.026, 0.03, 0.03, M.dark, s * (R.motorX - R.motorL / 2 + 0.01), R.axleY + 0.02, 0));

    const coup = cyl(R.coupR, R.coupR, R.coupL, M.hub, 14, 'x');
    coup.position.set(s * R.coupX, R.axleY, 0);
    group.add(coup);

    // 电机支架：把电机吊在中板下方
    group.add(box(0.04, 0.05, 0.042, M.alu, s * (R.motorX - 0.03), R.axleY + 0.03, 0));
  }

  /* ── 两个万向轮（前后各一，装在中板下）──────────────────────────── */
  for (const s of [-1, 1]) {
    const z = s * R.casterZ;
    group.add(box(0.036, 0.03, 0.03, M.alu, 0, R.yMiddle - 0.03, z)); // 转盘
    group.add(box(0.02, 0.05, 0.03, M.alu, 0, 0.055, z - s * 0.014)); // 叉架
    const w = cyl(R.casterR, R.casterR, 0.03, M.tire, 14, 'z');
    w.position.set(0, R.casterY, z - s * 0.014);
    group.add(w);
  }

  /* ── 前保险杠 ───────────────────────────────────────────────────── */
  group.add(box(0.30, 0.024, 0.018, M.alu, 0, 0.105, R.deck / 2 + 0.012));
  for (const x of [-0.10, 0.10]) {
    group.add(box(0.018, 0.018, 0.05, M.alu, x, 0.105, R.deck / 2 - 0.014));
  }

  /* ── 底部发光带（契约里的「发光环」）：贴底板四周一圈 ───────────── */
  const ringMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 0.9, roughness: 0.4,
  });
  const ring = new THREE.Group();
  const bandY = R.yBottom - R.deckT / 2 - 0.006;
  const half = R.deck / 2 + 0.004;
  ring.add(box(R.deck + 0.016, 0.012, 0.01, ringMat, 0, bandY, half));
  ring.add(box(R.deck + 0.016, 0.012, 0.01, ringMat, 0, bandY, -half));
  ring.add(box(0.01, 0.012, R.deck + 0.016, ringMat, half, bandY, 0));
  ring.add(box(0.01, 0.012, R.deck + 0.016, ringMat, -half, bandY, 0));
  group.add(ring);

  /* ── 前端显示屏（仿真专用：老人看到「机器人脸」的落点）─────────── */
  const faceGroup = new THREE.Group();
  faceGroup.position.set(0, R.yTop - 0.105, R.deck / 2 - 0.008);
  faceGroup.rotation.x = -0.12;
  group.add(faceGroup);

  faceGroup.add(box(0.30, 0.175, 0.028, M.white, 0, 0, -0.004));
  faceGroup.add(box(0.285, 0.16, 0.02, M.dark, 0, 0, 0.012));
  faceGroup.add(box(0.25, 0.128, 0.008, mat(0x16232b, 0.3), 0, 0, 0.024));
  // 支架：把屏吊在顶板前缘
  for (const s of [-1, 1]) {
    faceGroup.add(box(0.014, 0.03, 0.055, M.alu, s * 0.12, 0.1, -0.022));
  }

  const eyeMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 0.7, roughness: 0.3,
  });
  for (const dx of [-0.062, 0.062]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 14, 12), eyeMat);
    eye.position.set(dx, 0.019, 0.03);
    faceGroup.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.0085, 8, 18, Math.PI), eyeMat);
  smile.position.set(0, -0.02, 0.03);
  smile.rotation.z = Math.PI;
  faceGroup.add(smile);

  // 橙色指示灯：屏下方（提示时脉冲，与 HUD 换大字同步）
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 14, 12),
    new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  beacon.position.set(0, -0.112, 0.02);
  faceGroup.add(beacon);

  /* ── 顶板 + 升降药盘（顶板固定在 0.800；药盘由升降柱托起）───────── */
  const trayGroup = new THREE.Group();
  trayGroup.position.y = R.yTop + R.deckT / 2;
  group.add(trayGroup);

  // 升降柱：几何底面锚在 y=0，用 scale.y 直接当「当前柱高」
  // 方形升降立柱：底座法兰 + 固定套筒 + 伸缩柱（scale.y 就是当前柱高）+ 顶托
  const MZ = -0.062; // 立柱后移：正面机位下柱子落在托盘之后
  trayGroup.add(box(0.15, 0.012, 0.13, M.alu, 0, 0.006, MZ));
  trayGroup.add(box(0.078, 0.095, 0.07, M.alu, 0, 0.0595, MZ));
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.046, 1, 0.04), M.plate);
  mast.geometry.translate(0, 0.5, 0);
  mast.position.z = MZ;
  trayGroup.add(mast);
  const mastTop = box(0.115, 0.014, 0.095, M.alu);

  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 30), M.white);
  trayGroup.add(tray);
  // 药盘边缘一圈防滑挡边
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.009, 8, 30), mat(0xdfe3e6, 0.6));
  rim.rotation.x = Math.PI / 2;
  trayGroup.add(rim);

  const pillbox = box(0.24, 0.085, 0.17, mat(ORANGE, 0.7));
  trayGroup.add(pillbox);

  // 温水杯（纯几何体，无外部资产）：递药时与药盒一起放在托盘上
  const cup = cyl(0.042, 0.037, 0.105, new THREE.MeshStandardMaterial({
    color: 0xeaf6f8, roughness: 0.25, metalness: 0.05,
  }), 18);
  trayGroup.add(cup);
  const water = cyl(0.052, 0.052, 0.008, mat(0xdfeef1, 0.45), 18); // 杯垫：别让水杯看起来悬在盘边
  trayGroup.add(water);

  return { group, ring, trayGroup, mast, mastTop, tray, beacon, pillbox, cup, water, mastZ: MZ };
}

export function createRobot(sceneApi) {
  const { group, ring, trayGroup, mast, mastTop, tray, beacon, pillbox, cup, water, mastZ } = buildRobot();

  /** 仅视觉状态（不是业务状态）：位置积分、朝向、药盘动画进度 */
  const view = {
    trayY: 0,
    trayTarget: 0,
    facing: 0,
    pulse: 0,
  };

  /** 「柱高 → 托盘/药盒/水杯跟着走」的全部摆放都收敛到这里 */
  function layoutTray() {
    // 静止时柱高 0.055（收起），抬升到位 0.055 + TRAY_LIFT
    const h = 0.05 + view.trayY;
    mast.scale.y = h;
    mastTop.position.y = h + 0.007;
    mastTop.position.z = mastZ;
    tray.position.set(0, h + 0.021, mastZ * 0.55);
    pillbox.position.set(0, h + 0.0755, mastZ * 0.55);
    cup.position.set(0.086, h + 0.0955, mastZ * 0.55 + 0.055);
    water.position.set(0.086, h + 0.033, mastZ * 0.55 + 0.055);
  }

  const dock = sceneApi.getDock();
  group.position.set(dock.x, 0, dock.z);
  layoutTray();
  sceneApi.addActor({ id: 'robot', kind: 'robot', object3D: group, radius: 0.3 });

  function stepTowards(target, dt) {
    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.012) return true;
    const step = Math.min(distance, SPEED * Math.max(dt, 0));
    group.position.x += (dx / distance) * step;
    group.position.z += (dz / distance) * step;
    // 到点转向：目标方向
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

    // 药盘抬升：只在「有提示事件且已到位」时抬升，0.6s 到位
    view.trayTarget = carrying && arrived ? TRAY_LIFT : 0;
    const trayStep = (TRAY_LIFT / TRAY_TIME) * dt;
    view.trayY += Math.max(-trayStep, Math.min(trayStep, view.trayTarget - view.trayY));
    layoutTray();

    // 药盒与温水杯只在「有提示事件」时出现在托盘上；取走后（activeEventId 清空）消失
    pillbox.visible = carrying;
    cup.visible = carrying;
    water.visible = carrying;

    // 提示时的发光脉冲（灯效与通道切换同步，不只靠颜色：HUD 同步换大字）
    view.pulse += dt;
    const attempts = state.activeEventId
      ? state.events.find((event) => event.id === state.activeEventId)?.attempts.length ?? 0
      : 0;
    const base = carrying ? 0.75 + 0.35 * Math.sin(view.pulse * (attempts > 1 ? 9 : 4)) : 0.25;
    ring.traverse((node) => {
      if (node.isMesh) node.material.emissiveIntensity = base;
    });
    beacon.material.emissiveIntensity = carrying ? 0.9 : 0.25;
  }

  return { group, update, id: 'robot' };
}

export const robot = { createRobot };
