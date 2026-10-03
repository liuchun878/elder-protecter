/**
 * room.js —— 房间与分区（S 线）
 *
 * 契约：仿真呈现与开发阶段计划 §2.2 3D 场景规格
 *   - 单层简化平面约 8m × 6m，三个功能区：客厅（沙发）/ 卧室（床）/ 餐桌 · 厨房台面
 *   - 纯几何体（Box / Cylinder / Plane），**不引入任何外部 3D 模型资产**
 *   - **3D 里不渲染任何文字**（文字全部走 HTML 叠层）
 *
 * 坐标约定：y 向上，地面 y=0；x ∈ [-4, 4]，z ∈ [-3, 3]。
 * 本文件同时是**路径点真相**：机器人停在哪、人在哪，都由这里导出。
 */

import * as THREE from 'three';

/** 人在哪（person.js 用） */
export const WAYPOINTS = {
  living_room: { x: 3.02, y: 0, z: 1.4 },
  bedroom: { x: -2.75, y: 0, z: -1.6 },
  kitchen: { x: 2.6, y: 0, z: -0.72 },
  away: null,
};

/** 机器人停在哪（robot.js 用；契约 §3.1 场景 API 的 getApproachPoint） */
export const APPROACH_POINTS = {
  living_room: { x: 1.9, y: 0, z: 1.35 },
  bedroom: { x: -1.5, y: 0, z: -0.95 },
  kitchen: { x: 1.5, y: 0, z: -1.1 },
  away: { x: 1.0, y: 0, z: 0.4 },
};

/** 机器人充电座（空闲时的家）——放在前景中央，保证固定机位下始终可见（不被 HUD 挡住） */
export const DOCK = { x: -0.45, y: 0, z: 2.42 };

const C = {
  floor: 0xd7b489,
  floorAlt: 0xcdd3cf,
  wall: 0xf1e0cd,
  wallSide: 0xe8d5bf,
  rug: 0x8fc6c9,
  sofa: 0x7fb3c8,
  sofaCushion: 0xf3e4d4,
  wood: 0xb98a5f,
  woodDark: 0x8f6740,
  bed: 0xf4f1ee,
  blanket: 0x9fc4d8,
  counter: 0xe3d3c0,
  metal: 0xb9c0c6,
  greenery: 0x8fbf8f,
  clockRim: 0xb98a5f,
  clockFace: 0xfaf6f0,
  frame: 0xe9e2d8,
  frameArt: 0x9fc9a4,
};

function mat(color, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03 });
}

function box(w, h, d, color, roughness) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, roughness));
}

function addAt(group, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function buildFloor(group) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 6), mat(C.floor));
  addAt(group, floor, 0, -0.06, 0);

  // 三个功能区的地面色块（分区可辨识，不需要真实房型）
  const living = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.02, 2.9), mat(C.floor, 1));
  addAt(group, living, 2.05, 0.01, 1.5);

  const bedroom = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.02, 2.8), mat(C.floorAlt, 1));
  addAt(group, bedroom, -2.6, 0.01, -1.55);

  const kitchen = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 2.8), mat(C.floorAlt, 1));
  addAt(group, kitchen, 2.2, 0.01, -1.6);
}

function buildWalls(group) {
  // 后墙（z = -3）与左墙（x = -4）；右墙与前侧留空，保证固定机位不被遮挡
  const back = box(8, 2.7, 0.12, C.wall);
  addAt(group, back, 0, 1.35, -3.06);

  const left = box(0.12, 2.7, 6, C.wallSide);
  addAt(group, left, -4.06, 1.35, 0);

  // 后墙踢脚线
  const skirt = box(8, 0.12, 0.06, C.woodDark);
  addAt(group, skirt, 0, 0.06, -2.97);
}

function buildWindow(group) {
  // 后墙上的窗（纯几何：窗框 + 绿色远山色块 + 十字窗棂）；放在床位与台面之间的空档，固定机位可见
  const g = new THREE.Group();
  const frame = box(1.9, 1.34, 0.1, C.frame);
  g.add(frame);
  const glass = box(1.7, 1.14, 0.04, 0xdfeef1);
  glass.position.z = 0.06;
  g.add(glass);
  const hill = box(1.6, 0.44, 0.02, C.greenery);
  hill.position.set(0, -0.3, 0.09);
  g.add(hill);
  const barV = box(0.07, 1.14, 0.06, C.frame);
  barV.position.z = 0.08;
  g.add(barV);
  const barH = box(1.7, 0.07, 0.06, C.frame);
  barH.position.z = 0.08;
  g.add(barH);
  g.position.set(-0.5, 1.42, -2.98);
  group.add(g);
}

function buildWallDecor(group) {
  // 相框（后墙，纯色块山景）
  const frame = box(0.7, 0.55, 0.06, C.frame);
  addAt(group, frame, -2.2, 1.62, -2.96);
  const art = box(0.54, 0.4, 0.02, 0xdfe9dd);
  addAt(group, art, -2.2, 1.62, -2.92);
  const hill = box(0.34, 0.16, 0.02, C.frameArt);
  addAt(group, hill, -2.2, 1.54, -2.9);

  // 挂钟（后墙）：几何指针，不渲染数字/文字
  const clock = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 28), mat(C.clockRim));
  rim.rotation.x = Math.PI / 2;
  clock.add(rim);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28), mat(C.clockFace, 0.6));
  face.rotation.x = Math.PI / 2;
  face.position.z = 0.01;
  clock.add(face);
  const handH = box(0.02, 0.11, 0.01, 0x4a4a52);
  handH.position.set(0, 0.05, 0.05);
  clock.add(handH);
  const handM = box(0.09, 0.02, 0.01, 0x4a4a52);
  handM.position.set(-0.045, 0, 0.05);
  clock.add(handM);
  clock.position.set(1.5, 2.05, -2.95);
  group.add(clock);
}

function buildLivingRoom(group) {
  // 圆形地毯（俯视识别度：机器人停靠区）
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.03, 40), mat(C.rug, 1));
  addAt(group, rug, 1.4, 0.02, 1.4);

  // 沙发：靠右摆放，面向 -x（王阿姨坐在这里）
  const sofa = new THREE.Group();
  const seat = box(0.9, 0.34, 2.0, C.sofa);
  seat.position.set(0, 0.32, 0);
  sofa.add(seat);
  const backRest = box(0.24, 0.62, 2.0, C.sofa);
  backRest.position.set(0.42, 0.62, 0);
  sofa.add(backRest);
  for (const dz of [-0.78, 0.78]) {
    const arm = box(0.86, 0.2, 0.24, C.sofa);
    arm.position.set(0.02, 0.52, dz);
    sofa.add(arm);
  }
  const cushion = box(0.5, 0.12, 0.5, C.sofaCushion);
  cushion.position.set(-0.12, 0.55, 0);
  sofa.add(cushion);
  sofa.position.set(3.35, 0, 1.4);
  group.add(sofa);

  // 茶几 + 台面上的水杯与纸巾（对应示意里的边几物件）
  const table = new THREE.Group();
  const top = box(1.0, 0.07, 0.62, C.wood);
  top.position.y = 0.44;
  table.add(top);
  for (const dx of [-0.42, 0.42]) {
    for (const dz of [-0.24, 0.24]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.44, 10), mat(C.woodDark));
      leg.position.set(dx, 0.22, dz);
      table.add(leg);
    }
  }
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), mat(0xffffff, 0.5));
  cup.position.set(0.24, 0.53, 0.06);
  table.add(cup);
  const napkin = box(0.2, 0.02, 0.14, mat(0xe9f2f4, 0.9));
  napkin.position.set(-0.24, 0.49, 0);
  table.add(napkin);
  table.position.set(0.15, 0, 1.35);
  group.add(table);
}

function buildBedroom(group) {
  const bed = new THREE.Group();
  const base = box(1.6, 0.32, 1.95, C.wood);
  base.position.y = 0.18;
  bed.add(base);
  const mattress = box(1.5, 0.2, 1.85, C.bed);
  mattress.position.y = 0.44;
  bed.add(mattress);
  const blanket = box(1.52, 0.1, 1.1, C.blanket);
  blanket.position.set(0, 0.56, 0.35);
  bed.add(blanket);
  const pillow = box(0.5, 0.14, 0.3, 0xfbf8f5);
  pillow.position.set(0, 0.6, -0.72);
  bed.add(pillow);
  const headboard = box(1.6, 0.7, 0.1, C.woodDark);
  headboard.position.set(0, 0.55, -1.02);
  bed.add(headboard);
  bed.position.set(-2.75, 0, -1.6);
  group.add(bed);

  const nightstand = box(0.5, 0.45, 0.4, C.wood);
  addAt(group, nightstand, -1.85, 0.22, -2.4);
}

function buildKitchen(group) {
  // 厨房台面（后墙）+ 餐桌 + 两把椅子
  const counter = new THREE.Group();
  const body = box(2.4, 0.86, 0.6, C.counter);
  body.position.y = 0.43;
  counter.add(body);
  const counterTop = box(2.5, 0.06, 0.68, C.metal, 0.5);
  counterTop.position.y = 0.89;
  counter.add(counterTop);
  const sink = box(0.5, 0.04, 0.34, 0xc7ced3, 0.35);
  sink.position.set(-0.6, 0.93, 0);
  counter.add(sink);
  counter.position.set(2.6, 0, -2.7);
  group.add(counter);

  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 28), mat(C.wood));
  top.position.y = 0.72;
  table.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.72, 12), mat(C.woodDark));
  leg.position.y = 0.36;
  table.add(leg);
  table.position.set(2.6, 0, -1.45);
  group.add(table);

  for (const [dx, dz, rot] of [
    [0, 0.72, 0],
    [0, -0.72, Math.PI],
  ]) {
    const chair = new THREE.Group();
    const seat = box(0.42, 0.06, 0.42, C.woodDark);
    seat.position.y = 0.44;
    chair.add(seat);
    const backRest = box(0.42, 0.44, 0.06, C.woodDark);
    backRest.position.set(0, 0.66, -0.18);
    chair.add(backRest);
    for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 8), mat(C.woodDark));
      l.position.set(lx, 0.22, lz);
      chair.add(l);
    }
    chair.position.set(2.6 + dx, 0, -1.45 + dz);
    chair.rotation.y = rot;
    group.add(chair);
  }
}

function buildEntry(group) {
  // 前左：玄关 / 走廊。充电座 + 边几 + 绿植
  const dock = new THREE.Group();
  const pad = box(0.8, 0.05, 0.8, 0x8d99a6, 0.7);
  pad.position.y = 0.03;
  dock.add(pad);
  const strip = box(0.8, 0.02, 0.12, 0x6fd3d9, 0.3);
  strip.position.set(0, 0.07, -0.3);
  dock.add(strip);
  dock.position.set(DOCK.x, 0, DOCK.z);
  group.add(dock);

  const sideTable = new THREE.Group();
  const top = box(0.62, 0.06, 0.5, C.wood);
  top.position.y = 0.5;
  sideTable.add(top);
  for (const [dx, dz] of [[-0.26, -0.2], [0.26, -0.2], [-0.26, 0.2], [0.26, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), mat(C.woodDark));
    leg.position.set(dx, 0.25, dz);
    sideTable.add(leg);
  }
  sideTable.position.set(-2.5, 0, 0.9);
  group.add(sideTable);

  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 16), mat(0xd08b6a));
  addAt(group, pot, -3.5, 0.13, 0.2);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat(C.greenery, 0.95));
  addAt(group, leaves, -3.5, 0.52, 0.2);
}

/** 构建整个房间，返回 THREE.Group */
export function buildRoom() {
  const group = new THREE.Group();
  group.name = 'room';
  buildFloor(group);
  buildWalls(group);
  buildWindow(group);
  buildWallDecor(group);
  buildLivingRoom(group);
  buildBedroom(group);
  buildKitchen(group);
  buildEntry(group);
  return group;
}

export const room = { buildRoom, WAYPOINTS, APPROACH_POINTS, DOCK };
