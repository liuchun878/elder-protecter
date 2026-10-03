/**
 * person.js —— 王阿姨：3D 人形 + 位置与姿态跟随 state（H 线）
 *
 * 契约：契约-接口.md §1（person.js 可 import store.js 只读 + §3.1 场景 API）
 * 约束：
 *   - 不写业务状态；只把 state.presence 映射成位置与姿态
 *   - 不直接操作 renderer / scene；一律走 S 提供的场景 API
 *   - 王阿姨是**虚构人物**，不得写入任何真实老人信息
 *
 * 视觉规格：纯几何体拼装，不引入任何外部 3D 模型资产（仿真计划 §2.2）。
 */

import * as THREE from 'three';

const SKIN = 0xf2c9a8;
const HAIR = 0xd9d9de;
const CARDIGAN = 0xd08b8b;
const BLOUSE = 0xf7efe3;
const TROUSER = 0x9aa4b2;
const GLASSES = 0x3c3c46;

/** 每个位置的姿态：sit（沙发/餐椅）、lie（床）、stand；y 是「脚底原点」的世界高度 */
const POSE_BY_LOCATION = {
  living_room: { pose: 'sit', y: 0.04, facing: -Math.PI / 2 },
  bedroom: { pose: 'lie', y: 0.62, facing: 0 },
  kitchen: { pose: 'sit', y: 0.02, facing: Math.PI },
  away: { pose: 'stand', y: 0, facing: 0 },
};

function mat(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  return mesh;
}

/** 拼一个「银发 + 圆眼镜 + 粉开衫」的简化人形 */
function buildFigure() {
  const group = new THREE.Group();
  group.name = 'wang-ayi';

  const skin = mat(SKIN, 0.75);
  const hair = mat(HAIR, 0.9);
  const cardigan = mat(CARDIGAN, 0.9);
  const blouse = mat(BLOUSE, 0.9);
  const trouser = mat(TROUSER, 0.9);

  // 躯干
  const torso = box(0.46, 0.52, 0.3, cardigan);
  torso.position.y = 0.82;
  group.add(torso);

  const chest = box(0.26, 0.44, 0.06, blouse);
  chest.position.set(0, 0.82, 0.17);
  group.add(chest);

  // 头 + 银发 + 发髻
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), skin);
  head.position.y = 1.22;
  group.add(head);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.178, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  hairCap.position.y = 1.235;
  group.add(hairCap);

  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), hair);
  bun.position.set(0, 1.33, -0.13);
  group.add(bun);

  // 圆眼镜（两条镜框 + 鼻梁），不用文字
  const frameMat = new THREE.MeshStandardMaterial({ color: GLASSES, roughness: 0.4, metalness: 0.3 });
  for (const dx of [-0.062, 0.062]) {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 20), frameMat);
    lens.position.set(dx, 1.225, 0.16);
    group.add(lens);
  }
  const bridge = box(0.04, 0.008, 0.008, frameMat);
  bridge.position.set(0, 1.225, 0.16);
  group.add(bridge);

  // 手臂（可摆动）
  const arms = new THREE.Group();
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 6, 12), cardigan);
    upper.position.y = -0.16;
    arm.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), skin);
    hand.position.y = -0.34;
    arm.add(hand);
    arm.position.set(side * 0.27, 1.02, 0);
    arms.add(arm);
  }
  group.add(arms);

  // 腿：髋 + 膝关节两段。坐姿要真坐得下去，必须能把小腿单独折下来
  const legs = new THREE.Group();
  const knees = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 6, 12), trouser);
    thigh.position.y = -0.17;
    leg.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.36;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.3, 6, 12), trouser);
    shin.position.y = -0.17;
    knee.add(shin);
    const shoe = box(0.11, 0.07, 0.22, mat(0x5b5b66, 0.9));
    shoe.position.set(0, -0.36, 0.07);
    knee.add(shoe);
    leg.add(knee);

    leg.position.set(side * 0.12, 0.62, 0);
    legs.add(leg);
    knees.push(knee);
  }
  group.add(legs);

  // 裙摆，遮住坐姿时大腿与躯干的接缝
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.26, 18), cardigan);
  skirt.position.y = 0.56;
  group.add(skirt);

  return { group, arms, legs, knees, head };
}

export function createPerson(sceneApi) {
  const { group, arms, legs, knees, head } = buildFigure();
  /** 仅视觉状态：当前姿态与面向（不是业务状态） */
  const view = { pose: 'sit', facing: -Math.PI / 2, walkPhase: 0, moving: false };

  function applyPose(pose) {
    if (view.pose === pose) return;
    view.pose = pose;
    if (pose === 'lie') {
      group.rotation.set(-Math.PI / 2, 0, 0);
      legs.children.forEach((leg, i) => {
        leg.rotation.x = 0.12;
        knees[i].rotation.x = 0.18;
      });
      arms.rotation.set(0.5, 0, 0);
    } else if (pose === 'sit') {
      group.rotation.set(0, view.facing, 0);
      // 大腿放平、小腿垂下：髋 -1.5 rad，膝 +1.45 rad
      legs.children.forEach((leg, i) => {
        leg.rotation.x = -1.5;
        knees[i].rotation.x = 1.45;
      });
      arms.rotation.set(0.4, 0, 0);
    } else {
      group.rotation.set(0, view.facing, 0);
      legs.children.forEach((leg, i) => {
        leg.rotation.x = 0;
        knees[i].rotation.x = 0;
      });
      arms.rotation.set(0, 0, 0);
    }
  }

  applyPose('sit');
  sceneApi.addActor({ id: 'wang-ayi', kind: 'person', object3D: group, radius: 0.32 });

  /**
   * 位置与姿态跟随 state（纯视觉，不改 state）
   * @param {object} state StateSnapshot
   * @param {number} dt 秒
   */
  function update(state, dt) {
    const presence = state.presence;
    if (!presence.home) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const target = sceneApi.getWaypoint(presence.location);
    if (!target) return;
    const poseConf = POSE_BY_LOCATION[presence.location] || POSE_BY_LOCATION.living_room;
    applyPose(poseConf.pose);

    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = 1.05; // 与机器人同速量级
    view.moving = distance > 0.02;
    if (view.moving) {
      const step = Math.min(distance, speed * Math.max(dt, 0));
      group.position.x += (dx / distance) * step;
      group.position.z += (dz / distance) * step;
      view.facing = Math.atan2(dx, dz);
      view.walkPhase += step * 6;
      if (view.pose === 'stand') {
        legs.children.forEach((leg, i) => {
          leg.rotation.x = Math.sin(view.walkPhase + i * Math.PI) * 0.35;
          knees[i].rotation.x = Math.max(0, Math.sin(view.walkPhase + i * Math.PI) * 0.5);
        });
      }
    } else {
      if (view.pose === 'stand') {
        legs.children.forEach((leg, i) => {
          leg.rotation.x = 0;
          knees[i].rotation.x = 0;
        });
      }
      // 到位后按位置朝向：坐沙发面向房间，坐餐桌面向桌子（不是朝着墙）
      view.facing = poseConf.facing ?? view.facing;
    }

    group.position.y = poseConf.y;
    if (view.pose !== 'lie') {
      const turn = ((view.facing - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      group.rotation.y += turn * Math.min(1, dt * 6);
    }
    if (view.pose === 'stand' && view.moving) group.position.y = poseConf.y + Math.abs(Math.sin(view.walkPhase)) * 0.02;
    head.rotation.y = view.pose === 'sit' ? -0.22 : 0;
  }

  return { group, update, id: 'wang-ayi' };
}

export const person = { createPerson };
