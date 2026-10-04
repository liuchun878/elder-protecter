/**
 * robot.js —— 机器人本体 + 行为动画（R 线）
 *
 * 契约：契约-接口.md §1.1（机器人行为必须是 StateSnapshot 的**纯函数**，不许自己再写业务状态机）
 *       §3.1 场景 API（getDock / getDockFacing / getApproachPoint / findPath）
 *
 * 它只做四件事：走到人的位置、**开舱把药盘推出来递药**、提示时发光、空闲回充电座。
 * 「到点该不该送」「送完算不算确认」全部由 H 的 machine.js 决定 —— 本文件不判断业务。
 *
 * ── 造型依据（v1.10：本体换成用户给的 PR #2 版本；v1.14：与 YuMi-06 版合并）
 * 来源：`liuchun878/elder-protecter` **PR #2** 的 `suite-3d/robot/index.html`
 *       （提交 `6cc1321`「门开到 90°」、`af7def5`「先收托盘·再关门」）；
 *       **v1.14 合并来源：YuMi-06 的 `0000000/index.html`**（该文件与 `111111.00/index.html`
 *       逐字节相同，已合入本地；机器人在它的第 100–262 行，时序在 264–458 行）。
 *       我们本地早先那版把它当成"错误的老版本"——用户裁定：**YuMi-06 那台才是对的**，
 *       于是把它的三个能力补回本文件（见下"v1.14 从 YuMi-06 补回"）。
 * 照搬的结构（**只借结构，不借资产**：全部是 Lathe / Box / Cylinder / Extrude 拼的，
 * 仓库里不落任何 CAD 文件、网格或贴图 —— 红线：断网可用、无外部模型资产）：
 *   ① **蛋形回转体机身**：高 0.500 m、最大半径 0.190 m，一条侧轮廓 `LatheGeometry` 一次成型；
 *   ② **前下方对开门**：左右各一扇，绕各自**外侧竖边**向外摆到 **90°**，带中缝细线、圆把手、
 *      上下铰链活页；门扇半径比机身大 5 mm —— 贴在弧面上，不留缝也不悬空；
 *   ③ 门后**暗腔**（内壁 + 底板 + 舱内导轨 + 隔板 + 药）+ **带伸缩导轨的托盘**：
 *      导轨尾端始终留在舱内，所以拉出去**不脱节**；
 *   ④ **圆角矩形头部**（挤出圆角矩形 + 脖座）+ 一块画布屏幕（眼睛表情 + 指示条）；
 *   ⑤ 托盘上：温水杯、铝塑药袋（两排三列）、掀盖药盒、酒精棉、纱布卷。
 * 我们自己保留的部分（契约要求的那些，一条不少）：藏在机身下的差速轮底座、腰线发光带 /
 *   前发光条 / 肩灯（提示通道三件套）、车尾充电触点、位置感应光锥、
 *   「沿可通行折线走到人跟前 / 回桩充电 / 回桩朝向」的行为。
 *
 * ── v1.14 从 YuMi-06 的 `0000000/index.html` 补回来的三样 ─────────────
 *   ① **注水机构**（该文件 227–230 行）：一道细水流 `stream` 落在杯口正上方；杯里的水
 *      `water.scale.y` 初始 0.001，注水时涨到 0.8 之后停住。水杯尺寸 `CR=0.026 / CH=0.068`、
 *      杯位 `(0.030, 0.007, 0.052)` 与本文件完全一致，故几何一条没改、只补了水流与水位。
 *   ② **注水时序**（该文件 ③「给空杯注水」在 ④「递给老人」**之前**）：机器人**停下来之后先给
 *      空杯注水**（约 2.5 s，`POUR_TIME`），注完关水流、水面停在 0.8，再进入递药。
 *      注水只在「有活跃事件 `state.activeEventId` ＋ 已到位 ＋ 她还没取走」时发生 ——
 *      **业务判据仍然只有 `state.activeEventId` 一个**，没有新增任何业务状态。
 *   ③ **屏幕表情**（该文件 `drawScreen`，180–194 行）：**蓝眼睛 + 一条横线** →「取走后」变成
 *      **绿眼睛 + 笑弧**。本文件据此重写了 `drawScreen`（见那里的注释）。
 *
 * ⚠️ **与 YuMi-06 / PR #2 刻意不同的两处**（红线，不是漏做）：
 *   ① 它们的屏幕在底部写了「请取药 · 药已备好 / 已服药 · 祝您健康」——
 *      本项目 **3D 里一个字都不许渲染**（所有文字走 HTML 叠层），界面也**不得出现「已服下」**
 *      （取药 ≠ 服药）。所以**表情照抄、文字绝对不抄**：屏幕只有眼睛/笑弧 + 一条指示色条，
 *      没有任何 `fillText`。
 *   ② 它们有一段「老人的手」（`handG`）—— 本项目里王阿姨是独立的 `person.js` actor，
 *      且「她拿杯/拿药」由装配层 `main.js` 通过 `robot.setCargo()` 通知，故不引入假手。
 *   ③ 保留我们的差速轮底座与充电触点：这是台会走的机器人，`navgrid` 半径与充电桩都按它有底盘算。
 *
 * ── `setCargo({ cupTaken, pillTaken })`（v1.14 新增给装配层的小接口）──
 *   老人「拿杯 / 拿药」的动作在 `person.js`、装配在 `main.js`。这两个开关**只改可见性**
 *   （取走 → `visible = false`），不参与任何业务判断，也不回写 state。
 */

import * as THREE from 'three';
import { stone, wood } from './textures.js';

/* ── 尺寸（米；脚底 y = 0，正面 +z）——数字全部来自 PR #2 ────────────── */
const BODY_H = 0.500; // 机身总高
const BODY_R = 0.190; // 机身最大半径
const DOOR = { y0: 0.170, y1: 0.300, az: 0.42 }; // 门的上下沿 + 单侧张角(rad)
// v1.12：头部/屏幕比例借自 robot-3d（那台是 0.314×0.316 的近方大屏）——从 0.310×0.170 改成 0.300×0.240
const HEAD = { y: 0.598, w: 0.300, h: 0.240, d: 0.062, r: 0.046 };
const TRAY = { y: (DOOR.y0 + DOOR.y1) / 2 - 0.004, z0: 0.030, out: 0.200 };
const BAND_Y = 0.315; // 腰线发光带高度

/** 机身侧轮廓：`[高度, 半径]`（最鼓处 0.190 在 0.175~0.230 m） */
const PROFILE = [
  [0.000, 0.042], [0.015, 0.085], [0.045, 0.130], [0.105, 0.170], [0.175, 0.190],
  [0.230, 0.190], [0.270, 0.188], [0.320, 0.185], [0.380, 0.176], [0.430, 0.155],
  [0.465, 0.115], [0.487, 0.072], [0.500, 0.046],
];
/** 门扇轮廓：半径比机身外表面大 5 mm，贴弧面 */
const DOOR_PROFILE = [[DOOR.y0, 0.1952], [0.235, 0.1950], [DOOR.y1, 0.1912]];

const SPEED = 1.2; // m/s（预置路径动画，不宣称导航能力）
const OPEN_TIME = 0.9; // 从"收好"到"递到位"的全程时间，秒
// v1.14（YuMi-06 `0000000/index.html` 第 227–230、394–397 行）：注水约 2.5 s，
// 水面从 0.001 涨到 0.8 就停住（`water.scale.y` 是视觉量，不是业务量）。
const POUR_TIME = 2.5;
const WATER_TOP = 0.8;
const TEAL = 0x4fc7d8; // 待命青蓝
const ORANGE = 0xe8863c; // 有提示转琥珀
const DOCK_GREEN = 0x53e0a6; // 回桩充电青绿
const WARM = 0xffb066; // 夜晚的暖光（屏幕不打白光，免得不刺眼）

/* ── 小工具 ───────────────────────────────────────────────────────── */

function mat(color, roughness = 0.5, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, ...extra });
}

/** `[高度, 半径]` → LatheGeometry 的 Vector2（绕 y 轴回转） */
function lathe(pairs, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = pairs.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0005), y));
  const geo = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  geo.computeVertexNormals();
  return geo;
}

/** 机身在某高度处的半径（把发光带 / 触点 / 灯珠贴到曲面上用） */
function bodyRadius(y) {
  for (let i = 1; i < PROFILE.length; i += 1) {
    const [y0, r0] = PROFILE[i - 1];
    const [y1, r1] = PROFILE[i];
    if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / ((y1 - y0) || 1));
  }
  return PROFILE[PROFILE.length - 1][1];
}

/** 圆角矩形挤出（头部 / 托盘挡边用） */
function roundedBox(w, h, d, r) {
  const sh = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  sh.moveTo(x0 + r, y0);
  sh.lineTo(x0 + w - r, y0); sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  sh.lineTo(x0 + w, y0 + h - r); sh.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  sh.lineTo(x0 + r, y0 + h); sh.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: d, bevelEnabled: true, bevelSize: 0.007, bevelThickness: 0.007, bevelSegments: 3, curveSegments: 12,
  });
  geo.translate(0, 0, -d / 2);
  return geo;
}

function buildRobot() {
  const group = new THREE.Group();
  group.name = 'robot';

  const M = {
    shell: new THREE.MeshPhysicalMaterial({
      color: 0xf7f8f9, roughness: 0.30, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.28,
    }),
    shellDim: mat(0xe9ebee, 0.42),
    cavity: mat(0x3a3d42, 0.82, { side: THREE.DoubleSide }),
    cavBack: mat(0xeceef0, 0.5, { side: THREE.BackSide }),
    dark: mat(0x101216, 0.14, { metalness: 0.45 }),
    alu: mat(0xa8aeb4, 0.34, { metalness: 0.7 }),
    tire: mat(0x24282c, 0.92),
    hub: mat(0xb9c0c6, 0.4, { metalness: 0.35 }),
    tray: new THREE.MeshStandardMaterial({ map: stone({ tone: 0xf0eeea, seed: 91 }), roughness: 0.35 }),
    pill: mat(0xefe6d4, 0.66),
    foil: mat(0xd2d8dd, 0.24, { metalness: 0.5 }),
    pad: mat(0xf3f6f8, 0.74),
    cup: new THREE.MeshPhysicalMaterial({
      color: 0xeaf4f8, roughness: 0.06, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, envMapIntensity: 1.5,
    }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x9fd0e8, roughness: 0.04, transparent: true, opacity: 0.75 }),
    // 借 robot-3d 的「木拉手」：木色圆棒 + 铝支架
    wood: new THREE.MeshStandardMaterial({ map: wood({ tone: 0xc9a26a, seed: 12 }), roughness: 0.62 }),
  };

  const put = (geo, material, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || group).add(m);
    return m;
  };
  const box = (w, h, d, material, x, y, z, parent) => put(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
  const cyl = (rt, rb, h, material, x, y, z, parent, seg = 20) => put(
    new THREE.CylinderGeometry(rt, rb, h, seg), material, x, y, z, parent,
  );

  /* ══ ① 底盘：四轮 —— 左右两个**驱动轮** + 前方两个**万向轮**，各带支架，都会滚 ══
   * 数字照搬用户仓库 HEAD 版 `suite-3d/robot/index.html`（那里也是四轮 + 支架 + 滚动）。
   * 碰撞零影响：最外的驱动轮 x=±0.126、半径 0.032 → 横向 0.316 m，
   * 远小于 `scene.addActor` 用的碰撞直径 0.48 m（radius 0.24）。
   */
  const wheels = [];
  function addWheel(x, z, r, w, caster) {
    const g = new THREE.Group();
    g.position.set(x, r, z);
    g.name = 'robot-wheel';
    group.add(g);
    const spin = new THREE.Group(); // 滚动只转这个子组（支架不跟着转）
    g.add(spin);
    const tire = cyl(r, r, w, M.tire, 0, 0, 0, spin, 24);
    tire.rotation.z = Math.PI / 2;
    const hub = cyl(r * 0.42, r * 0.42, w + 0.006, M.hub, 0, 0, 0, spin, 16);
    hub.rotation.z = Math.PI / 2;
    for (const sgn of [-1, 1]) {
      const disc = cyl(r * 0.40, r * 0.40, 0.004, M.shellDim, sgn * (w / 2 + 0.004), 0, 0, spin, 14);
      disc.rotation.z = Math.PI / 2;
    }
    // 轮轴：穿过轮心的一根细轴（借 robot-3d 的「轮轴」）
    const axle = cyl(0.0045, 0.0045, w + 0.012, M.alu, 0, 0, 0, spin, 10);
    axle.rotation.z = Math.PI / 2;
    // 轮辋：轮缘一圈细环（借 robot-3d 的「轮辋」）
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, 0.0028, 6, 20), M.hub);
    rim.rotation.y = Math.PI / 2;
    spin.add(rim);
    const fork = box(0.018, r + 0.030, 0.022, M.alu, 0, r * 0.5 + 0.015, 0, g);
    fork.castShadow = true;
    if (caster) {
      // 万向轮：立柱 + 叉架 + 轮架板（借 robot-3d 的「立柱/叉架/轮架板」）
      cyl(0.009, 0.009, 0.030, M.alu, 0, r * 0.5 + 0.008, 0, g, 12);
      box(0.040, 0.008, 0.034, M.shellDim, 0, r + 0.030, 0, g);
    }
    g.userData.spin = spin;
    wheels.push(g);
    return g;
  }
  addWheel(-0.126, -0.016, 0.032, 0.028, false); // 左驱动轮
  addWheel(0.126, -0.016, 0.032, 0.028, false); // 右驱动轮
  addWheel(-0.090, 0.100, 0.024, 0.022, true); // 左前万向轮
  addWheel(0.090, 0.100, 0.024, 0.022, true); // 右前万向轮
  box(0.190, 0.018, 0.150, M.shellDim, 0, 0.028, -0.010, group); // 底盘托板（轮子挂在它上面）

  /* ══ ② 蛋形机身（一条轮廓回转成型，没有拼接缝）════════════════════ */
  const body = new THREE.Mesh(lathe(PROFILE, 72), M.shell);
  body.name = 'robot-body';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  /* ══ ③ 门后暗腔：内壁 + 底板 + 舱内导轨 + 隔板 + 药 ════════════════ */
  const nicheW = 2 * 0.1948 * Math.sin(DOOR.az) * 0.98;
  const cavWall = box(nicheW, DOOR.y1 - DOOR.y0 - 0.004, 0.010, M.cavity, 0, (DOOR.y0 + DOOR.y1) / 2, 0.186);
  cavWall.name = 'robot-cavity';
  const cavFloor = box(nicheW, 0.006, 0.070, M.shellDim, 0, DOOR.y0 + 0.004, 0.156);
  cavFloor.receiveShadow = true;
  box(0.052, 0.008, 0.130, M.alu, 0, DOOR.y0 + 0.008, 0.100); // 舱内导轨
  box(Math.min(nicheW - 0.012, 0.130), 0.008, 0.058, M.shellDim, 0, DOOR.y0 + 0.086, 0.134); // 隔板
  [[-0.052, 0.055, 0.050], [0.000, 0.046, 0.046], [0.052, 0.050, 0.044]].forEach((q) => (
    box(q[2], q[1], 0.048, M.pill, q[0], DOOR.y0 + 0.095 + q[1] / 2, 0.132)
  ));

  /* ══ ④ 前下方对开门：绕外侧竖边向外摆到 90° ═══════════════════════ */
  const HR = 0.1948; // 铰链所在半径
  function makeDoorLeaf(sign) {
    const az0 = sign < 0 ? -DOOR.az : 0; // 左扇 [-az, 0]、右扇 [0, +az]
    const hingeAz = sign < 0 ? -DOOR.az : DOOR.az;
    const hx = Math.sin(hingeAz) * HR;
    const hz = Math.cos(hingeAz) * HR;
    const g = new THREE.Group();
    g.name = sign < 0 ? 'robot-door-l' : 'robot-door-r';
    g.position.set(hx, 0, hz);
    group.add(g);
    const outer = lathe(DOOR_PROFILE, 22, az0, DOOR.az);
    outer.translate(-hx, 0, -hz);
    const mo = new THREE.Mesh(outer, M.shell);
    mo.castShadow = true;
    mo.receiveShadow = true;
    g.add(mo);
    const inner = lathe(DOOR_PROFILE.map(([y, r]) => [y, r - 0.0035]), 22, az0, DOOR.az);
    inner.translate(-hx, 0, -hz);
    g.add(new THREE.Mesh(inner, M.cavBack));
    // 中缝细线：让"对开"一眼可辨
    const sa = sign * 0.010;
    const seam = box(0.0035, DOOR.y1 - DOOR.y0 - 0.006, 0.005, M.shellDim,
      Math.sin(sa) * 0.1966 - hx, (DOOR.y0 + DOOR.y1) / 2, Math.cos(sa) * 0.1966 - hz, g);
    seam.rotation.y = -sa + Math.PI / 2;
    // 圆形把手（靠中缝、贴门面）
    const ha = sign * 0.090;
    const hd = cyl(0.0085, 0.0085, 0.013, M.alu,
      Math.sin(ha) * 0.1995 - hx, (DOOR.y0 + DOOR.y1) / 2, Math.cos(ha) * 0.1995 - hz, g, 16);
    hd.rotation.x = Math.PI / 2;
    // 上下铰链活页（贴在铰链竖线上，说明门是连在机身上的）
    [DOOR.y0 + 0.014, DOOR.y1 - 0.014].forEach((hy) => cyl(0.0055, 0.0055, 0.018, M.alu, 0, hy, 0, g, 12));
    return g;
  }
  const doorL = makeDoorLeaf(-1);
  const doorR = makeDoorLeaf(1);

  /* ══ ⑤ 头部：圆角矩形 + 画布屏幕（**只有眼睛与指示条，没有文字**）═══ */
  cyl(0.044, 0.052, 0.042, M.shell, 0, 0.513, 0, group, 28); // 脖座
  const head = new THREE.Mesh(roundedBox(HEAD.w, HEAD.h, HEAD.d, HEAD.r), M.shell);
  head.name = 'robot-head';
  head.position.set(0, HEAD.y, 0.010);
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  const SCR = { w: 512, h: 288 };
  const scrCv = document.createElement('canvas');
  scrCv.width = SCR.w;
  scrCv.height = SCR.h;
  const scrCtx = scrCv.getContext('2d');
  const scrTex = new THREE.CanvasTexture(scrCv);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false, transparent: true });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(HEAD.w - 0.032, HEAD.h - 0.032), screenMat);
  screen.name = 'robot-screen';
  screen.position.set(0, HEAD.y, 0.056);
  screen.userData.noShadow = true;
  group.add(screen);
  // 屏下压条 + 右上角小琥珀状态块（借 robot-3d 的「屏幕压条 / 小琥珀色块」）
  const trimBar = box(HEAD.w - 0.026, 0.006, 0.006, M.shellDim, 0, HEAD.y - HEAD.h / 2 + 0.010, 0.058, group);
  trimBar.userData.noShadow = true;
  const scrLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.0055, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8a33c, emissive: 0xe8a33c, emissiveIntensity: 1.1, roughness: 0.4 }),
  );
  scrLed.position.set(HEAD.w / 2 - 0.016, HEAD.y + HEAD.h / 2 - 0.014, 0.058);
  scrLed.userData.noShadow = true;
  scrLed.name = 'robot-screen-led';
  group.add(scrLed);

  // 头部与机身之间的托座（不然头像浮在空气里）
  box(0.140, 0.104, 0.050, M.shell, 0, HEAD.y - 0.096, -0.006);

  /* 屏幕：**三个状态**（表情照抄 YuMi-06 `0000000/index.html` 的 `drawScreen`，180–194 行）
   *   waiting 默认 / 递药中 —— **蓝眼睛（两枚实心竖椭圆）+ 一条横线**，取自该文件 `g<=0.5` 分支
   *   taken   她已取走（托盘正在收）—— **绿眼睛（两道下弯眉弧）+ 一道笑弧**，取自 `g>0.5` 分支
   *   off     夜晚待命 —— 整块黑（连指示条都不亮）
   * ⚠️ 红线（与 YuMi-06 唯一的差别）：该文件在这套表情下还用 `fillText` 写了
   *   「请取药 · 药已备好 / 已服药 · 祝您健康」——本项目 **3D 里不许渲染任何文字**
   *   （所有文字走 HTML 叠层），界面也不得出现「已服下」（取药 ≠ 服药）。
   *   所以：**表情照抄，文字一个字都不抄** —— 本函数里没有 `fillText`/`strokeText`。 */
  let scrKey = '';
  function drawScreen(kind, hex) {
    const key = `${kind}|${hex}`;
    if (key === scrKey) return;
    scrKey = key;
    const W = SCR.w;
    const H = SCR.h;
    const css = (v) => `#${v.toString(16).padStart(6, '0')}`;
    const gr = scrCtx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#141c25');
    gr.addColorStop(1, '#070a0d');
    scrCtx.fillStyle = gr;
    scrCtx.fillRect(0, 0, W, H);
    if (kind === 'off') { scrTex.needsUpdate = true; return; }
    const look = kind === 'taken'; // 绿眼睛 + 笑弧
    const col = look ? '#39e08f' : (kind === 'waiting' ? '#7fd4ff' : css(hex));
    scrCtx.shadowColor = col;
    scrCtx.shadowBlur = 26;
    scrCtx.strokeStyle = col;
    scrCtx.fillStyle = col;
    scrCtx.lineCap = 'round';

    // 眼睛：待命＝实心竖椭圆（蓝）；取走后＝下弯眉弧（绿）
    [-1, 1].forEach((sg) => {
      const ex = W / 2 + sg * 76;
      const ey = 104;
      scrCtx.beginPath();
      if (look) {
        scrCtx.lineWidth = 13;
        scrCtx.arc(ex, ey + 6, 26, Math.PI * 1.12, Math.PI * 1.88);
        scrCtx.stroke();
      } else {
        scrCtx.ellipse(ex, ey, 25, 29, 0, 0, Math.PI * 2);
        scrCtx.fill();
      }
    });
    // 嘴：待命＝一条横线（平嘴，安静地等着）；取走后＝一道笑弧
    scrCtx.beginPath();
    scrCtx.lineWidth = 11;
    if (look) scrCtx.arc(W / 2, 166, 40, Math.PI * 0.20, Math.PI * 0.80);
    else { scrCtx.moveTo(W / 2 - 32, 176); scrCtx.lineTo(W / 2 + 32, 176); }
    scrCtx.stroke();

    // 底部指示条：颜色即状态（青蓝＝待命/递药中 / 青绿＝已取走·已记录）
    scrCtx.shadowBlur = 0;
    scrCtx.fillStyle = 'rgba(255,255,255,.10)';
    scrCtx.fillRect(22, H - 46, W - 44, 28);
    scrCtx.fillStyle = col;
    scrCtx.fillRect(22, H - 46, (W - 44) * (look ? 1 : 0.34), 28);
    scrTex.needsUpdate = true;
  }
  drawScreen('waiting', TEAL);

  /* ══ ⑥ 托盘组（含伸缩导轨：尾端始终留在舱内 → 拉出去不脱节）═══════ */
  const tray = new THREE.Group();
  tray.name = 'robot-tray';
  tray.position.set(0, TRAY.y, TRAY.z0);
  group.add(tray);
  box(0.200, 0.012, 0.140, M.tray, 0, 0, 0.045, tray); // 盘面
  box(0.205, 0.014, 0.012, M.tray, 0, 0.008, 0.112, tray); // 前沿挡边
  box(0.046, 0.010, 0.240, M.alu, 0, -0.010, -0.020, tray); // 伸缩导轨
  box(0.030, 0.008, 0.260, M.shellDim, 0, -0.018, -0.040, tray);

  // 温水杯（**空杯** → 机器人停下来之后由本文件给它注水，YuMi-06 版时序）
  const CR = 0.026;
  const CH = 0.068;
  const cupGeo = new THREE.CylinderGeometry(CR, CR * 0.88, CH, 26, 1, true);
  cupGeo.translate(0, CH / 2, 0);
  const cup = put(cupGeo, M.cup, 0.030, 0.007, 0.052, tray);
  cup.name = 'robot-tray-cup';
  const cupBottom = put(new THREE.CircleGeometry(CR * 0.88, 26), M.cup, 0.030, 0.0075, 0.052, tray);
  cupBottom.rotation.x = -Math.PI / 2;
  const waterGeo = new THREE.CylinderGeometry(CR * 0.93, CR * 0.82, CH * 0.80, 26);
  waterGeo.translate(0, CH * 0.40, 0);
  const water = put(waterGeo, M.water, 0.030, 0.009, 0.052, tray);
  water.name = 'robot-tray-water'; // 自测脚本按名字取它看 scale.y（0.001 → 0.8）
  water.scale.y = 0.001; // YuMi-06 第 208 行：**一开始是空杯**（水位收到看不见）

  // 独立包装药（铝塑小袋，两排三列）—— 6 片一套，装进一个组，`setCargo({pillTaken:true})` 一起收走
  const pills = new THREE.Group();
  pills.name = 'robot-pills';
  tray.add(pills);
  for (let r = 0; r < 2; r += 1) {
    for (let i = 0; i < 3; i += 1) {
      const px = -0.034 + i * 0.034;
      const pz = 0.016 + r * 0.048;
      box(0.028, 0.006, 0.040, M.pill, px, 0.010, pz, pills);
      box(0.030, 0.003, 0.042, M.foil, px, 0.0145, pz, pills);
    }
  }
  // 小药盒（圆盒，掀盖半开）—— 它就是「托盘上的药」这个名字的代表件（自测脚本按名字取它）
  const pillBox = new THREE.Group();
  pillBox.name = 'robot-tray-pill';
  pillBox.position.set(-0.034, 0.007, 0.086);
  tray.add(pillBox);
  cyl(0.033, 0.033, 0.024, M.pill, 0, 0.012, 0, pillBox, 22);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    cyl(0.006, 0.006, 0.004, M.pill, Math.cos(a) * 0.016, 0.028, Math.sin(a) * 0.016, pillBox, 10);
  }
  cyl(0.035, 0.035, 0.006, M.pill, 0.030, 0.040, 0.018, pillBox, 22).rotation.set(-0.85, 0, -0.45);
  // 少量医疗用品：两片酒精棉 + 一小卷纱布
  box(0.024, 0.004, 0.024, M.pad, -0.020, 0.010, 0.110, tray);
  box(0.024, 0.004, 0.024, M.pad, 0.006, 0.010, 0.106, tray);
  cyl(0.014, 0.014, 0.026, M.pad, 0.040, 0.021, 0.100, tray, 18).rotation.z = Math.PI / 2;

  /* ══ ⑥a 注水水流（v1.14 · 照搬 YuMi-06 `0000000/index.html` 第 227–230 行）══
   * 一道细水流，落在杯口正上方；注水时 `visible = true`，注满即关。
   * 它挂在机身（不是托盘）上，z=0.272 是杯子推到最外时杯口的位置。
   */
  const streamGeo = new THREE.CylinderGeometry(0.0030, 0.0042, 0.080, 10);
  streamGeo.translate(0, -0.040, 0);
  const streamMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe3f2, roughness: 0.05, transparent: true, opacity: 0.85,
  });
  const stream = put(streamGeo, streamMat, 0.030, TRAY.y + 0.118, 0.272, group);
  stream.name = 'robot-water-stream';
  stream.visible = false;

  /* ══ ⑥b 木拉手（借 robot-3d 的「木拉手/木棒」）：背面两根木色圆棒 + 铝支架 ══
   * 位置贴在机身背面曲面上（y=0.44 处机身半径约 0.148） */
  const handleR = bodyRadius(0.44);
  for (const hz of [-0.028, 0.028]) {
    const rod = cyl(0.015, 0.015, 0.190, M.wood, 0, 0.44, -(handleR + 0.030) + hz * 0, group, 14);
    rod.name = 'robot-handle';
    rod.rotation.z = Math.PI / 2;
    rod.position.z = -(handleR + 0.032);
    for (const sx of [-1, 1]) {
      const br = box(0.016, 0.030, 0.030, M.alu, sx * 0.078, 0.44 + hz * 0, -(handleR + 0.016), group);
      br.rotation.x = 0;
      if (hz > 0) br.position.y += 0.052; else br.position.y -= 0.052;
      const rodY = 0.44 + (hz > 0 ? 0.052 : -0.052);
      // 同高的一根木棒（两根上下排开，像实拍照片里的双拉手）
      const r2 = cyl(0.015, 0.015, 0.190, M.wood, 0, rodY, -(handleR + 0.032), group, 14);
      r2.name = 'robot-handle';
      r2.rotation.z = Math.PI / 2;
    }
  }

  /* ══ ⑥c 底盘腰线 / 下缘（借 robot-3d 的「底盘腰线 + 底盘下缘」）══════ */
  const waistMat = mat(0x6f767c, 0.55, { metalness: 0.25 });
  const waist = new THREE.Mesh(new THREE.TorusGeometry(bodyRadius(0.085) + 0.003, 0.0032, 6, 56), waistMat);
  waist.name = 'robot-waist';
  waist.rotation.x = Math.PI / 2;
  waist.position.y = 0.085;
  waist.userData.noShadow = true;
  group.add(waist);

  /* ══ ⑦ 提示通道：腰线发光带 + 前发光条 + 肩灯 ═════════════════════ */
  const ringMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 0.9, roughness: 0.4,
  });
  const ring = new THREE.Group();
  ring.name = 'robot-ring';
  const bandR = bodyRadius(BAND_Y) + 0.004;
  const bandMesh = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.0052, 8, 56), ringMat);
  bandMesh.rotation.x = Math.PI / 2;
  bandMesh.position.y = BAND_Y;
  bandMesh.userData.noShadow = true;
  ring.add(bandMesh);
  group.add(ring);

  const stripMat = new THREE.MeshStandardMaterial({
    color: TEAL, emissive: TEAL, emissiveIntensity: 1.0, roughness: 0.35,
  });
  const strip = box(0.055, 0.008, 0.008, stripMat, 0, BAND_Y + 0.002, bodyRadius(BAND_Y) + 0.004);
  strip.userData.noShadow = true;

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.0105, 14, 12),
    new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  beacon.position.set(Math.sin(0.6) * bodyRadius(0.44) * 1.02, 0.44, Math.cos(0.6) * bodyRadius(0.44) * 1.02);
  beacon.userData.noShadow = true;
  group.add(beacon);

  /* ══ ⑧ 充电触点（车尾）：两道铜排，贴在机身背面曲面上 ══════════════ */
  const contactZ = -(bodyRadius(0.15) + 0.002);
  for (const s of [-1, 1]) box(0.018, 0.048, 0.008, M.hub, s * 0.042, 0.150, contactZ);

  /* ══ ⑨ 位置感应光束（"跟到阿姨身边"时才亮）═════════════════════════
   * 契约 §3.1.1：这是**位置输入的可视化**，不是摄像头 / 识别。
   */
  const beamMat = new THREE.MeshBasicMaterial({
    color: TEAL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.ConeGeometry(0.05, 1, 14, 1, true);
  beamGeo.translate(0, -0.5, 0);
  beamGeo.rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'robot-sense-beam';
  beam.position.set(0, HEAD.y + 0.06, 0.09);
  beam.visible = false;
  beam.userData.noShadow = true;
  group.add(beam);

  return {
    group, ring, strip, beacon, beam, doorL, doorR, tray, screen, screenMat, drawScreen, wheels, scrLed,
    stream, water, cup, cupBottom, pills, pillBox,   // v1.14：注水与「取走后收走」的货
    // 托盘上会随托盘一起"搬进搬出"的东西（不含杯子/药：它们由 setCargo 单独管可见性）
    cargo: [cup, cupBottom, water, pills, pillBox, stream],
  };
}

export function createRobot(sceneApi) {
  const {
    group, ring, strip, beacon, beam, doorL, doorR, tray, screen, screenMat, drawScreen, wheels, scrLed,
    stream, water, cup, cupBottom, pills, pillBox,
  } = buildRobot();

  /** 仅视觉状态（不是业务状态）：位置积分、朝向、**开门 / 出盘 / 注水三个进度**、感应强度、路径 */
  const view = {
    door: 0, // 门开度 0..1（→ 0..90°）
    tray: 0, // 托盘伸出量 0..1
    pour: 0, // 注水进度 0..1（0.001 → 0.8 的水面高度，YuMi-06 时序）
    filled: false, // 本轮的注水是否已经完成（注满就停住；只在下一轮事件开始时复位）
    facing: 0,
    pulse: 0,
    sensing: 0,
    path: null,
    pathTarget: { x: 0, z: 0 },
    roll: 0, // 轮子滚过的弧度（纯视觉）
  };

  /** 装配层通知「她已把杯子 / 药拿走」——**只改可见性**，不参与任何业务判断 */
  const taken = { cup: false, pills: false };
  function setCargo({ cupTaken = false, pillTaken = false } = {}) {
    taken.cup = Boolean(cupTaken);
    taken.pills = Boolean(pillTaken);
    // 杯子被取走 → 本轮注水作废（水流关掉，水位复位成空杯，供下一轮重新注水）——纯视觉
    if (taken.cup) { view.pour = 0; view.filled = false; }
    applyCargo();
    return { cupTaken: taken.cup, pillTaken: taken.pills };
  }

  /** 把「托盘是否在舱外」「杯子/药有没有被拿走」落到可见性上 */
  function applyCargo() {
    const out = view.tray > 0.02;
    const showCup = out && !taken.cup;
    cup.visible = showCup;
    cupBottom.visible = showCup;
    water.visible = showCup && water.scale.y > 0.006;
    pills.visible = out && !taken.pills;
    pillBox.visible = out && !taken.pills;
    stream.visible = out && !taken.cup && view.pour > 0.001 && !view.filled;
  }

  /** 把进度摆到机构上（对开门绕外侧竖边摆开 + 托盘沿导轨前伸 + 水位） */
  function layout() {
    const ease = (t) => 1 - ((1 - t) ** 3);
    const swing = ease(view.door) * (Math.PI / 2); // 门开到 90°（PR #2 提交 6cc1321）
    doorL.rotation.y = -swing;
    doorR.rotation.y = swing;
    tray.position.z = TRAY.z0 + TRAY.out * ease(view.tray);
    // 水面：0.001（空杯）→ 0.8（注满），照搬 YuMi-06 第 397 行的 `water.scale.y = fill * 0.8`
    const level = view.filled ? WATER_TOP : Math.max(0.001, view.pour * WATER_TOP);
    water.scale.y = level;
    applyCargo();
    // 轮子滚动：驱动轮与万向轮一起转（万向轮实际是随动的，这里跟着滚，只为"看起来在走"）
    for (const w of wheels) if (w.userData.spin) w.userData.spin.rotation.x = view.roll;
  }

  /** 回桩朝向：由场景提供（不同户型桩位朝向不同），拿不到就退回 0 */
  const dockFacing = typeof sceneApi.getDockFacing === 'function' ? sceneApi.getDockFacing() : 0;

  const dock = sceneApi.getDock();
  group.position.set(dock.x, 0, dock.z);
  layout();
  sceneApi.addActor({ id: 'robot', kind: 'robot', object3D: group, radius: 0.24 });

  /**
   * 朝目标走一步。**走的是可通行折线，不是直线**（套房有墙）：
   * 目标一变就重算路径（`sceneApi.findPath`），之后沿折线逐个节点走。
   * @returns {boolean} 是否已到位
   */
  function stepTowards(target, dt) {
    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.012) return true;

    const moved = Math.hypot(target.x - view.pathTarget.x, target.z - view.pathTarget.z) > 0.12;
    const needPath = !view.path || view.path.length === 0 || moved;
    if (needPath && typeof sceneApi.findPath === 'function') {
      const p = sceneApi.findPath({ x: group.position.x, z: group.position.z }, { x: target.x, z: target.z });
      view.path = p && p.length > 1 ? p.slice(1) : null;
      view.pathTarget = { x: target.x, z: target.z };
    }

    const node = (view.path && view.path[0]) || target;
    let ndx = node.x - group.position.x;
    let ndz = node.z - group.position.z;
    let nd = Math.hypot(ndx, ndz);
    if (view.path && nd < 0.05 && view.path.length > 1) {
      view.path.shift();
      const nn = view.path[0];
      ndx = nn.x - group.position.x;
      ndz = nn.z - group.position.z;
      nd = Math.hypot(ndx, ndz) || 1;
    }
    if (nd < 1e-4) return true;

    const step = Math.min(nd, SPEED * Math.max(dt, 0));
    group.position.x += (ndx / nd) * step;
    group.position.z += (ndz / nd) * step;
    view.facing = Math.atan2(ndx, ndz);
    view.roll += step / 0.032; // 驱动轮半径 0.032 m → 走多远滚多少弧度
    return false;
  }

  /**
   * state 的纯函数（除视觉插值外不持有任何业务状态）
   *
   * 去哪，只由 state 决定（契约 §3.1）：
   *   ① 有提示事件            → 开到人的跟前递药（**对开门开到 90° + 托盘推出**）
   *   ② 没有提示但有落座点     → **感应到阿姨位置，开到她跟前待命**（光锥）
   *   ③ 都没有                → 回充电座
   * 机器人自己**不判断**"她该不该吃药"、"要不要跟过去"——那些都在 state 里。
   *
   * 递药动作的时序（PR #2 提交 af7def5 的规矩）：**出药时"先开门、后出盘"；
   * 收药时"先收托盘、再关门"** —— 托盘没回到舱内之前，门不许合上。
   * 这里只用两个 0..1 的视觉进度表示，业务判据仍然只有 `state.activeEventId` 一个。
   */
  function update(state, dt) {
    const carrying = Boolean(state.activeEventId);
    const location = state.presence.location;
    const seat = state.presence.seat || null;
    const attending = Boolean(seat);
    const nearby = carrying || attending;

    const target = nearby ? sceneApi.getApproachPoint(location, seat) : dock;

    const arrived = stepTowards(target, dt);

    if (arrived && nearby) {
      const person = seat || sceneApi.getWaypoint(location);
      if (person) {
        view.facing = Math.atan2(person.x - group.position.x, person.z - group.position.z);
      }
    } else if (arrived) {
      view.facing = dockFacing;
    }

    const delta = ((view.facing - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    group.rotation.y += delta * Math.min(1, dt * 8);

    // 递药：只在「有提示事件且已到位」时动作；OPEN_TIME 秒走完一个进度
    const wantDeliver = carrying && arrived;
    const step = Math.max(0, dt) / OPEN_TIME;
    if (wantDeliver) {
      view.door += Math.min(step, 1 - view.door); // 先开门
      view.tray += Math.min(step, 1 - view.tray); // 后出盘（同时进行，门先到位）
    } else {
      view.tray -= Math.min(step * 1.6, view.tray); // 先收托盘
      if (view.tray <= 0.02) view.door -= Math.min(step * 1.2, view.door); // 托盘进舱才关门
    }

    /* 注水（v1.14 · YuMi-06 `0000000/index.html` 的时序：**机器人停下来、杯口到位之后先注水，
     * 再进入递药**；注水约 2.5 s，注完关水流、水面停在 0.8。
     * 触发条件只有三个，全部来自 state 或纯视觉进度，**没有新增任何业务判据**：
     *   ① `carrying` = Boolean(state.activeEventId)  ② `arrived` ③ 她还没把杯子取走（setCargo 的可见性开关）
     * 水面"注满就停住"用 `view.filled` 记住（纯视觉量），只在**下一轮事件开始时**复位。 */
    if (carrying && !taken.cup) {
      // 杯口一到位（托盘基本出完）就开始注水 —— 即"机器人停下来之后先注水"
      if (view.tray > 0.9 && view.pour <= 0 && !view.filled) view.pour = 0.001;
      if (view.pour > 0) {
        view.pour += Math.max(0, dt) / POUR_TIME;
        if (view.pour >= 1) { view.pour = 1; view.filled = true; } // 注满 → 关水流，水面停在 0.8
      }
    } else if (!carrying && view.tray <= 0.02) {
      // 这一轮结束了（她已取走 / 事件收口，托盘已回舱）→ 视觉复位，准备下一轮空杯
      view.pour = 0;
      view.filled = false;
    }
    layout();

    // 感应光锥：只在"知道她的位置、过去待命"时亮（递药时不开，免得抢戏）
    const sensingTarget = attending && !carrying ? 1 : 0;
    const rate = Math.max(0, dt) / 0.45;
    view.sensing += Math.max(-rate, Math.min(rate, sensingTarget - view.sensing));
    if (view.sensing > 0.01) {
      const person = seat || sceneApi.getWaypoint(location);
      const dx = person ? person.x - group.position.x : 0;
      const dz = person ? person.z - group.position.z : 0;
      const dist = Math.hypot(dx, dz);
      beam.visible = true;
      beam.scale.set(1, 1, Math.max(0.35, dist));
      beam.rotation.y = Math.atan2(dx, dz) - group.rotation.y;
      beam.material.opacity = (0.028 + 0.03 * Math.abs(Math.sin(view.pulse * 2.6))) * view.sensing;
    } else {
      beam.visible = false;
      beam.material.opacity = 0;
    }

    /* 提示通道：腰线发光带 + 屏幕 + 肩灯（三条通道同一份 state）*/
    view.pulse += dt;
    const attempts = state.activeEventId
      ? state.events.find((event) => event.id === state.activeEventId)?.attempts.length ?? 0
      : 0;
    const docked = !nearby && arrived;
    // 一天里的光（v1.11）：**夜里不刺眼** —— 待命时把屏幕关掉，只留一点微光；
    // 有提示事件时屏幕转**暖光**（琥珀偏暖）并把亮度压到白天的六成左右。
    const night = typeof sceneApi.getTimeOfDay === 'function' && sceneApi.getTimeOfDay() === 'night';
    const dim = night ? 0.55 : 1; // 夜里所有发光通道统一压暗
    let base;
    if (carrying) base = (0.85 + 0.45 * Math.sin(view.pulse * (attempts > 1 ? 9 : 4))) * dim;
    else if (docked) base = (0.55 + 0.45 * Math.abs(Math.sin(view.pulse * 1.8))) * dim;
    else base = (0.7 + 0.25 * Math.sin(view.pulse * 3.2)) * dim;
    const tone = docked ? DOCK_GREEN : TEAL;
    ring.traverse((node) => {
      if (!node.isMesh) return;
      node.material.emissiveIntensity = base;
      node.material.color.setHex(tone);
      node.material.emissive.setHex(tone);
    });
    strip.material.emissiveIntensity = (carrying ? 0.9 + 0.4 * Math.sin(view.pulse * 3) : 0.55) * dim;
    strip.material.color.setHex(tone);
    strip.material.emissive.setHex(tone);
    // 屏幕表情（v1.14 照抄 YuMi-06 的 drawScreen）：**蓝眼睛+横线** →「取走后」**绿眼睛+笑弧**
    //   waiting 待命 / 递药中（含注水中）—— 青蓝（夜里递药走 WARM 暖光）
    //   taken   她已取走（`setCargo({cupTaken:true})`）或托盘正在收 —— 绿
    //   off     夜晚待命 —— 熄灭
    // ⚠️ 只画表情与指示条；**一个字的文案都没有**（不出现「已服下 / 已服药」）。
    let kind = 'waiting';
    let screenTone = tone;
    if (carrying) {
      kind = 'waiting';
      screenTone = night ? WARM : ORANGE;
    } else if (taken.cup || view.tray > 0.02) {
      kind = 'taken'; // 她刚把杯子取走 / 托盘正在收回 ——「已取走 · 已记录」，不是「已服下」
      screenTone = DOCK_GREEN;
    }
    if (night && !carrying && view.tray <= 0.02) kind = 'off';
    screen.visible = kind !== 'off';
    if (screen.visible) {
      drawScreen(kind, screenTone);
      screenMat.opacity = night
        ? (carrying ? 0.58 + 0.05 * Math.abs(Math.sin(view.pulse * 4)) : 0.9)
        : (carrying ? 0.96 + 0.04 * Math.abs(Math.sin(view.pulse * 4)) : 0.92);
    }
    // 屏右上角小琥珀灯（借 robot-3d 的那颗）：有提示事件才亮
    scrLed.material.emissiveIntensity = (carrying ? 1.4 : 0.35) * dim;
    beacon.material.emissiveIntensity = (carrying ? 0.9 : 0.25) * dim;
  }

  /** v1.14：水注好了没有（**只读**）——装配层用它把关"注完水再让她拿杯子"。
   * 只是把 `view.filled` 读出去，不参与任何业务判断。 */
  function isPoured() {
    return view.filled;
  }

  return { group, update, setCargo, isPoured, id: 'robot' };
}

export const robot = { createRobot };
