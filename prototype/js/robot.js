/**
 * robot.js —— 机器人本体 + 行为动画（R 线）
 *
 * 契约：契约-接口.md §1.1（机器人行为必须是 StateSnapshot 的**纯函数**，不许自己再写业务状态机）
 *       §3.1 场景 API；仿真呈现与开发阶段计划 §2.2（圆柱底盘 + 方盒机身 + 顶部药盘 + 发光环）
 *
 * 它只做四件事：走到 presence.location、药盘抬升、提示时发光、空闲回充电座。
 * 「到点该不该送」「送完算不算确认」全部由 H 的 machine.js 决定——本文件不判断业务。
 */

import * as THREE from 'three';

const BODY_WHITE = 0xf7f7f4;
const BODY_DARK = 0x24343d;
const TEAL = 0x6fd3d9;
const ORANGE = 0xe8863c;
const GREY = 0x8b939b;

const SPEED = 1.2; // m/s（预置路径动画，不宣称导航能力）
const TRAY_LIFT = 0.34; // 药盘抬升高度
const TRAY_TIME = 0.6; // 药盘抬升耗时（秒）

function mat(color, roughness = 0.6, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, ...extra });
}

function buildRobot() {
  const group = new THREE.Group();
  group.name = 'robot';

  // 底盘 + 轮子
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.23, 0.12, 28), mat(GREY, 0.7));
  base.position.y = 0.1;
  group.add(base);

  for (const dx of [-0.17, 0.17]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), mat(0x2f3438, 0.9));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(dx, 0.06, 0.02);
    group.add(wheel);
  }

  // 发光环
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.022, 10, 40),
    new THREE.MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.19;
  group.add(ring);

  // 机身
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.38), mat(BODY_WHITE, 0.5));
  body.position.y = 0.45;
  group.add(body);

  // 脸（深色屏幕 + 两只眼睛 + 微笑），3D 里不出现任何文字
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.04), mat(BODY_DARK, 0.35));
  face.position.set(0, 0.52, 0.2);
  group.add(face);

  const eyeMat = new THREE.MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.7, roughness: 0.3 });
  for (const dx of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), eyeMat);
    eye.position.set(dx, 0.56, 0.22);
    group.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 18, Math.PI), eyeMat);
  smile.position.set(0, 0.49, 0.22);
  smile.rotation.z = Math.PI;
  group.add(smile);

  // 机身下方的橙色指示灯（提示时用）
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 14, 12),
    new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  beacon.position.set(0, 0.3, 0.205);
  group.add(beacon);

  // 药盘：立柱 + 托盘 + 药盒
  const trayGroup = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 12), mat(BODY_WHITE, 0.5));
  post.position.y = 0.17;
  trayGroup.add(post);
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 30), mat(0xeef1f2, 0.5));
  tray.position.y = 0.36;
  trayGroup.add(tray);
  const pillbox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.18), mat(ORANGE, 0.7));
  pillbox.position.y = 0.43;
  trayGroup.add(pillbox);

  // 温水杯（纯几何体，无外部资产）：递药时与药盒一起放在托盘上
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.04, 0.11, 18),
    new THREE.MeshStandardMaterial({ color: 0xeaf6f8, roughness: 0.25, metalness: 0.05 }),
  );
  cup.position.set(0.17, 0.44, 0.1); // 放在药盒靠前一侧：镜头从正面 3/4 角度能同时看到药盒与温水
  trayGroup.add(cup);
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.06), mat(0xdfeef1, 0.4));
  water.position.set(0.17, 0.418, 0.1);
  trayGroup.add(water);

  trayGroup.position.y = 0.52;
  group.add(trayGroup);

  return { group, ring, trayGroup, beacon, pillbox, cup };
}

export function createRobot(sceneApi) {
  const { group, ring, trayGroup, beacon, pillbox, cup } = buildRobot();

  /** 仅视觉状态（不是业务状态）：位置积分、朝向、药盘动画进度 */
  const view = {
    trayY: 0,
    trayTarget: 0,
    facing: 0,
    pulse: 0,
  };

  const dock = sceneApi.getDock();
  group.position.set(dock.x, 0, dock.z);
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
    trayGroup.position.y = 0.52 + view.trayY;

    // 药盒与温水杯只在「有提示事件」时出现在托盘上；取走后（activeEventId 清空）消失
    pillbox.visible = carrying;
    cup.visible = carrying;

    // 提示时的发光脉冲（灯效与通道切换同步，不只靠颜色：HUD 同步换大字）
    view.pulse += dt;
    const attempts = state.activeEventId
      ? state.events.find((event) => event.id === state.activeEventId)?.attempts.length ?? 0
      : 0;
    const base = carrying ? 0.75 + 0.35 * Math.sin(view.pulse * (attempts > 1 ? 9 : 4)) : 0.25;
    ring.material.emissiveIntensity = base;
    beacon.material.emissiveIntensity = carrying ? 0.9 : 0.25;
  }

  return { group, update, id: 'robot' };
}

export const robot = { createRobot };
