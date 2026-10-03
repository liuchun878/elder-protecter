/* =============================================================================
 * grandma.js — 程序化老奶奶角色（参考照片：银发发髻 · 金丝眼镜 · 藏青上衣 · 灰裤 · 手表）
 *
 * 设计要点
 *   1) 纯 Three.js 核心几何体拼装，不依赖任何外部模型文件，离线可用。
 *   2) 骨架用嵌套 Object3D 关节实现（髋-膝-踝、肩-肘-腕、脊柱两节、颈、下颌），
 *      动画按正弦曲线程序化生成走 / 站 两套姿态并做交叉淡化。
 *   3) 用正向运动学实时算出两只脚的最低点，再把整体抬到刚好不穿地 ——
 *      这样"脚不滑、不陷"不靠手调数字，改任何比例都自动成立。
 *
 * 朝向约定：模型面朝本地 -Z，与 Three.js 相机默认朝向一致。
 * 单位：米。成人老者身高约 1.53 m。
 * ========================================================================== */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  if (!THREE) throw new Error('grandma.js 需要先加载 three.min.js');

  /* ---------------------------------------------------------------- 工具 */

  // 胶囊体：沿 Y 轴生长，scale[1] 用来把它拉伸到需要的高度
  function capsule(r, len, mat) {
    const g = new THREE.CapsuleGeometry(r, len, 5, 18);
    return new THREE.Mesh(g, mat);
  }

  // 椭球
  function ellipsoid(r, mat, sx, sy, sz, ws, hs) {
    const g = new THREE.SphereGeometry(r, ws || 24, hs || 18);
    const m = new THREE.Mesh(g, mat);
    m.scale.set(sx, sy, sz);
    return m;
  }

  // 圆柱（y0..y1 为本地 Y 区间）
  function tube(rTop, rBot, y0, y1, mat, seg) {
    const h = Math.abs(y1 - y0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 18), mat);
    m.position.y = (y0 + y1) / 2;
    return m;
  }

  // 圆角"方盒"：球体做非均匀缩放，用来做鞋子、托盘、柜体等圆润体块
  function blob(r, mat, sx, sy, sz) {
    return ellipsoid(r, mat, sx, sy, sz, 20, 14);
  }

  // 圆环（眼镜框、发圈、轮子）
  function ring(R, r, mat, arc) {
    return new THREE.Mesh(
      new THREE.TorusGeometry(R, r, 8, 28, arc === undefined ? Math.PI * 2 : arc),
      mat
    );
  }

  /* ------------------------------------------------------------ 材质表 */
  /* 颜色取自参考照片：银发 #d6d4cf、藏青 #3b4a66、深灰裤 #4c5059、金丝镜架 */

  const M = {
    skin:    new THREE.MeshStandardMaterial({ color: 0xf0c3a2, roughness: 0.70, metalness: 0.0 }),
    skinDk:  new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.76 }),
    hair:    new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.55, metalness: 0.0 }),
    hairDk:  new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.60 }),
    blouse:  new THREE.MeshStandardMaterial({ color: 0x46577a, roughness: 0.88, metalness: 0.0 }),
    blouseD: new THREE.MeshStandardMaterial({ color: 0x3b4a68, roughness: 0.90 }),
    pants:   new THREE.MeshStandardMaterial({ color: 0x5a5f68, roughness: 0.90 }),
    shoe:    new THREE.MeshStandardMaterial({ color: 0x453c35, roughness: 0.70 }),
    sole:    new THREE.MeshStandardMaterial({ color: 0x2b2724, roughness: 0.9 }),
    eyeW:    new THREE.MeshStandardMaterial({ color: 0xf6f2ec, roughness: 0.32 }),
    eyeD:    new THREE.MeshStandardMaterial({ color: 0x40301f, roughness: 0.38 }),
    mouth:   new THREE.MeshStandardMaterial({ color: 0xa86058, roughness: 0.58 }),
    metal:   new THREE.MeshStandardMaterial({ color: 0xd0aa3a, roughness: 0.28, metalness: 0.9 }),
    steel:   new THREE.MeshStandardMaterial({ color: 0xc6cad0, roughness: 0.30, metalness: 0.85 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x554236, roughness: 0.58 })
  };

  /* 细长件（镜框、镜腿）投阴影会出现噪点，统一关掉 */
  function noCast(root) {
    root.traverse(function (o) { if (o.isMesh) o.castShadow = false; });
    return root;
  }

  /* ------------------------------------------------------------ 单条腿 */

  function buildLeg(ob, side) {
    const hip = new THREE.Object3D();
    // 髋关节离地高度：腿长 0.40 + 0.31，脚底约 0.055 → 0.795 正好让脚踩在地上
    hip.position.set(0.066 * side, 0.795, 0);

    const thigh = capsule(0.064, 0.272, M.pants);
    thigh.scale.set(0.78, 1.0, 1.05);            // 0.400 m（髋→膝）
    thigh.position.y = -0.200;
    hip.add(thigh);

    const knee = new THREE.Object3D();
    knee.position.y = -0.400;
    hip.add(knee);

    const shin = capsule(0.055, 0.20, M.pants);
    shin.scale.set(0.90, 1.0, 1.02);             // 0.310 m（膝→踝）
    shin.position.y = -0.155;
    knee.add(shin);

    const kneeBall = ellipsoid(0.058, M.pants, 0.98, 0.90, 1.02, 18, 14);
    knee.add(kneeBall);

    const ankle = new THREE.Object3D();
    ankle.position.y = -0.310;
    knee.add(ankle);

    const foot = blob(0.075, M.shoe, 0.55, 0.44, 1.42);
    foot.position.set(0, -0.032, -0.052);
    ankle.add(foot);

    const sole = blob(0.075, M.sole, 0.57, 0.17, 1.44);
    sole.position.set(0, -0.055, -0.052);
    ankle.add(sole);

    ob.root.add(hip);
    return { hip: hip, knee: knee, ankle: ankle, side: side };
  }

  /* ------------------------------------------------------------ 单条臂 */

  function buildArm(ob, side) {
    const shoulder = new THREE.Object3D();
    // 肩关节挂在 root 下 → 坐标就是绝对高度。1.105 m 略低于上胸顶端（1.165）
    shoulder.position.set(0.162 * side, 1.105, 0);

    const upper = capsule(0.054, 0.139, M.blouse);
    upper.scale.set(0.92, 1.0, 0.96);             // 0.247 m（肩→肘）
    upper.position.y = -0.1235;
    shoulder.add(upper);

    const elbow = new THREE.Object3D();
    elbow.position.y = -0.247;
    shoulder.add(elbow);

    const fore = capsule(0.045, 0.134, M.blouse);
    fore.scale.set(0.95, 0.9753, 1.0);            // 0.224 m（肘→腕）
    fore.position.y = -0.112;
    elbow.add(fore);

    const wrist = new THREE.Object3D();
    wrist.position.y = -0.224;
    elbow.add(wrist);

    const hand = blob(0.052, M.skin, 0.82, 1.12, 0.58);
    hand.position.y = -0.048;
    wrist.add(hand);

    // 侧腕表（照片里老奶奶左手戴表）—— 只装在 +1 侧
    if (side > 0) {
      const strap = tube(0.047, 0.047, -0.020, 0.020, M.leather, 14);
      strap.position.y = -0.012;
      wrist.add(strap);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.010, 18), M.steel);
      face.rotation.z = Math.PI / 2;
      face.position.set(0.044, -0.012, 0);
      wrist.add(face);
    }
    wrist.add(noCast(ring(0.010, 0.0035, M.metal)).translateX(0.038 * side).translateY(-0.078)); // 戒指细节

    ob.root.add(shoulder);
    return { shoulder: shoulder, elbow: elbow, wrist: wrist, hand: hand, side: side };
  }

  /* ---------------------------------------------------- 头部（含五官） */

  function buildHead(ob) {
    const neck = new THREE.Object3D();
    // root 的子节点 → 坐标即绝对高度。颈根 1.130 m，正好在上胸顶端
    neck.position.y = 1.130;
    neck.add(tube(0.052, 0.064, -0.090, 0.030, M.skin));
    ob.root.add(neck);

    const head = new THREE.Object3D();
    head.position.y = 0.075;
    neck.add(head);

    // 头部整体用一个组包起来：以后调头身比只要改这一处
    const HS = 1.16;
    const skullGroup = new THREE.Object3D();
    skullGroup.scale.setScalar(HS);
    skullGroup.position.y = 0.06;      // 让头略高于颈根，拉出"脖子"的观感
    head.add(skullGroup);

    const HR = 0.104;                              // 头颅基准半径（未放大）

    // 颅骨：略呈前后长、下巴略窄
    const skull = ellipsoid(HR, M.skin, 0.97, 1.06, 0.99);
    skullGroup.add(skull);

    // 下颌/面颊过渡，让脸型不那么"球"
    const jaw = ellipsoid(HR * 0.72, M.skin, 0.94, 0.86, 0.92);
    jaw.position.set(0, -0.052, -0.012);
    skullGroup.add(jaw);

    // 银色头发：从头皮往下包到眉线，正面留出手指宽的额头
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(HR * 1.05, 28, 20, 0, Math.PI * 2, 0.66, Math.PI * 0.62),
      M.hair
    );
    cap.position.y = 0.004;
    cap.scale.set(1.0, 1.05, 1.0);
    skullGroup.add(cap);

    // 后脑与两侧的散发（包住耳朵，只留前面空着）
    const back = new THREE.Mesh(
      new THREE.SphereGeometry(HR * 1.04, 26, 18, Math.PI * 0.24, Math.PI * 1.52, 0.30, Math.PI * 0.62),
      M.hair
    );
    back.position.y = 0.004;
    skullGroup.add(back);

    // 两侧耳前的银发
    [-1, 1].forEach(function (s) {
      const side = ellipsoid(HR * 0.42, M.hairDk, 0.55, 1.5, 0.8, 16, 12);
      side.position.set(0.088 * s, -0.015, -0.010);
      skullGroup.add(side);
    });

    // 发髻（盘在脑后上方）
    const bun = ellipsoid(0.056, M.hair, 1.05, 0.95, 1.0, 22, 16);
    bun.position.set(0, 0.052, 0.090);
    skullGroup.add(bun);
    const bunWrap = noCast(ring(0.050, 0.007, M.hairDk));
    bunWrap.position.set(0, 0.048, 0.086);
    bunWrap.rotation.x = 0.35;
    skullGroup.add(bunWrap);

    // 耳朵
    [-1, 1].forEach(function (s) {
      const ear = ellipsoid(0.028, M.skinDk, 0.38, 1.0, 0.72, 12, 10);
      ear.position.set(0.095 * s, -0.012, 0.004);
      skullGroup.add(ear);
    });

    // 鼻子
    const nose = ellipsoid(0.026, M.skin, 0.80, 1.05, 1.15, 14, 12);
    nose.position.set(0, -0.014, -0.098);
    skullGroup.add(nose);

    // 眼睛（眼白 + 虹膜），略微眯眼更接近老人神态
    const eyes = [];
    [-1, 1].forEach(function (s) {
      const w = ellipsoid(0.019, M.eyeW, 1.05, 0.72, 0.55, 14, 10);
      w.position.set(0.040 * s, 0.012, -0.093);
      skullGroup.add(w);
      const p = ellipsoid(0.0105, M.eyeD, 1.0, 1.0, 0.7, 12, 10);
      p.position.set(0.040 * s, 0.011, -0.104);
      skullGroup.add(p);
      eyes.push(w, p);

      // 银白眉毛
      const brow = ellipsoid(0.020, M.hairDk, 1.25, 0.24, 0.35, 12, 8);
      brow.position.set(0.041 * s, 0.043, -0.094);
      brow.rotation.z = -0.16 * s;
      skullGroup.add(brow);
    });

    // 嘴：一段朝下的圆环弧当作微笑唇线
    const mouth = ring(0.024, 0.0035, M.mouth, Math.PI * 0.9);
    mouth.rotation.z = Math.PI + (Math.PI - Math.PI * 0.9) / 2;
    mouth.position.set(0, -0.058, -0.092);
    skullGroup.add(noCast(mouth));

    // 金丝眼镜：两片镜框 + 鼻梁 + 镜腿
    const glasses = new THREE.Object3D();
    [-1, 1].forEach(function (s) {
      const lens = ring(0.0305, 0.0026, M.metal);
      lens.position.set(0.041 * s, 0.010, -0.101);
      lens.rotation.y = -0.12 * s;
      glasses.add(lens);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.115, 8), M.metal);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0.070 * s, 0.014, -0.048);
      glasses.add(arm);
    });
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.030, 8), M.metal);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.016, -0.104);
    glasses.add(bridge);
    skullGroup.add(noCast(glasses));

    ob.head = head;
    ob.neck = neck;
    ob.eyes = eyes;

    // 让"眼睛"能被整体放大缩小（眨眼用 Y 轴压扁实现）
    ob.eyeBaseScale = eyes.map(function (e) { return e.scale.clone(); });
    return head;
  }

  /* ------------------------------------------------------------ 躯干 */

  function buildTorso(ob) {
    // 髋（站立时髋关节离地 0.795 m，腿长 0.40 + 0.31，脚底 0.055 → 头顶约 1.50 m）
    const hips = new THREE.Object3D();
    hips.position.y = 0.795;
    ob.root.add(hips);

    const pelvis = blob(0.115, M.pants, 0.94, 0.80, 0.78);
    pelvis.position.y = -0.030;
    hips.add(pelvis);

    const lower = new THREE.Object3D();          // 腰（hips 的子节点：0.795 + 0.080 = 0.875）
    lower.position.y = 0.080;
    hips.add(lower);

    // 上衣下摆盖住胯部
    const hem = blob(0.135, M.blouse, 1.06, 1.05, 0.88);
    hem.position.y = 0.010;
    lower.add(hem);

    // 躯干做成一个整体：一枚竖长胶囊当主体 + 轻微小腹，
    // 再让下摆和它大幅重叠，避免"分节"的观感
    const chest = capsule(0.128, 0.30, M.blouse);
    chest.scale.set(1.12, 1.18, 0.80);            // 0.556 → 0.66 m 高
    chest.position.y = 0.190;
    lower.add(chest);

    const belly = ellipsoid(0.115, M.blouse, 1.10, 0.62, 0.80, 22, 16);
    belly.position.set(0, 0.030, -0.012);
    lower.add(belly);

    const upper = new THREE.Object3D();          // 上胸（lower 的子节点：0.875 + 0.290 = 1.165）
    upper.position.y = 0.290;
    lower.add(upper);

    // 肩线要压得比头顶低一截，否则头会"埋"进肩膀里
    const shoulders = ellipsoid(0.122, M.blouse, 1.32, 0.44, 0.92, 24, 18);
    shoulders.position.set(0, -0.120, 0.004);
    upper.add(shoulders);

    // 领口 + 门襟扣子
    const collar = noCast(ring(0.052, 0.008, M.blouseD));
    collar.position.set(0, 0.086, -0.036);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1.15, 1.0, 1.0);
    upper.add(collar);

    const placket = blob(0.018, M.blouseD, 0.42, 3.2, 0.55);
    placket.position.set(0, -0.175, -0.098);

    [-0.245, -0.205, -0.165, -0.125].forEach(function (y) {
      const btn = ellipsoid(0.0075, M.metal, 1, 1, 0.6, 10, 8);
      btn.position.set(0, y, -0.108);
      upper.add(btn);
    });
    upper.add(placket);

    ob.hips = hips;
    ob.lower = lower;
    ob.upper = upper;
    return { hips: hips, lower: lower, upper: upper };
  }

  /* ============================================================ 主构建 */

  function build() {
    const ob = { kind: 'grandma' };
    const root = new THREE.Object3D();
    root.name = '老奶奶';
    ob.root = root;

    const torso = buildTorso(ob);
    buildHead(ob);

    ob.legs = [buildLeg(ob, -1), buildLeg(ob, 1)];   // -1 左，+1 右
    ob.arms = [buildArm(ob, -1), buildArm(ob, 1)];

    // 身高标尺（自检用）：脚 0 → 头顶约 1.44
    ob.height = 1.44;

    // 阴影设置
    root.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // 眼镜等细件不投影
    [ob.head].forEach(function (n) {
      n.traverse(function (o) {
        if (o.isMesh && o.material === M.metal && o.geometry.type === 'TorusGeometry') o.castShadow = false;
      });
    });

    /* ---------------------------------------------------- 姿态与动画 */

    const SEG = Math.max(0.03, global.__GRANDMA_STEP || 0.58); // 步幅（米）
    const L_THIGH = 0.400, L_SHIN = 0.310, FOOT_Y = 0.055;

    const pose = {
      speed: 0,        // 实际速度 m/s
      phase: 0,        // 步态相位（弧度）
      armBlend: 1,     // 1 = 走路摆臂，0 = 自然下垂
      lean: 0,         // 前倾
      idleT: 0,
      blink: 0,
      nextBlink: 1.6
    };

    // 0 = 站定，1 = 正常步速
    const SPEED_REF = 0.92;

    function applyLegs(t, v) {
      for (let i = 0; i < 2; i++) {
        const leg = ob.legs[i];
        const ph = pose.phase + (i === 0 ? 0 : Math.PI);   // 右腿相位 +π
        const s = Math.sin(ph);
        const stance = s < 0 ? -s : 0;
        // 髋
        leg.hip.rotation.x = 0.36 * v * s;
        leg.hip.rotation.z = 0.030 * (i === 0 ? -1 : 1) * (1 - 0.4 * v);
        // 膝：摆动期抬起，站立期略微屈膝吸收冲击
        const swing = Math.max(0, Math.sin(ph - 0.9));
        leg.knee.rotation.x = v * (0.72 * swing + 0.10 * stance) + 0.05;
        // 踝：脚跟先着地，脚尖最后离地
        leg.ankle.rotation.x = v * (0.20 - 0.45 * Math.cos(ph));
      }
    }

    function applyArms(t, v) {
      for (let i = 0; i < 2; i++) {
        const arm = ob.arms[i];
        const ph = pose.phase + (i === 0 ? Math.PI : 0);   // 与同侧腿反相
        const s = Math.sin(ph);
        const swingA = 0.30 * v * s;
        // 站定时：双手在身前轻握；走路时：自然摆动
        const idleShoulder = -0.10, idleElbow = -0.75;
        const walkShoulder = 0.05, walkElbow = -0.34;
        const b = pose.armBlend;
        arm.shoulder.rotation.x = swingA + (walkShoulder * b + idleShoulder * (1 - b));
        arm.elbow.rotation.x = (walkElbow * b + idleElbow * (1 - b)) - 0.12 * v * Math.max(0, s);
        // 手臂微微内收，不要穿进躯干
        arm.shoulder.rotation.z = (i === 0 ? 1 : -1) * (0.055 + 0.06 * (1 - b));
        arm.shoulder.rotation.y = (i === 0 ? -1 : 1) * (0.10 * (1 - b));
      }
    }

    // 用正向运动学求脚底最低点，把整体抬高到刚好贴地
    //   注意：返回值是"髋到脚底"的垂直距离（站立时约 0.71 m），
    //   所以只能取它相对站姿基准的**增量**，不能直接叠加到髋高上。
    function footClearance(v) {
      let lowest = Infinity;
      for (let i = 0; i < 2; i++) {
        const leg = ob.legs[i];
        const t1 = leg.hip.rotation.x;
        const t2 = t1 + leg.knee.rotation.x;
        const ankleY = -(L_THIGH * Math.cos(t1) + L_SHIN * Math.cos(t2));
        const footY = Math.min(ankleY, ankleY - FOOT_Y * Math.cos(t2));
        if (footY < lowest) lowest = footY;
      }
      return -(lowest + FOOT_Y);
    }

    // 站姿基准：先按站姿算一次腿的垂直长度，作为"脚落地"的零点
    const restClear = (function () {
      applyLegs(0, 0);
      return footClearance(0);
    })();

    ob.update = function (dt, opts) {
      opts = opts || {};
      const targetSpeed = opts.speed || 0;
      // 速度平滑，避免起步/停步突变
      pose.speed += (targetSpeed - pose.speed) * Math.min(1, dt * 5.5);
      if (pose.speed < 0.004) pose.speed = 0;

      const v = Math.min(1, pose.speed / SPEED_REF);              // 动画强度 0..1
      const distanceRate = pose.speed;
      pose.phase += (distanceRate / SEG) * Math.PI * 2 * dt;      // 相位随位移推进 → 脚不滑
      if (opts.stepExtra) pose.phase += opts.stepExtra;           // 原地转身时的碎步

      // 站/走姿态混合（速度越低越像站着）
      const targetBlend = pose.speed > 0.16 ? Math.min(1, v * 1.5) : 0;
      pose.armBlend += (targetBlend - pose.armBlend) * Math.min(1, dt * 4.0);

      pose.idleT += dt;
      const idle = 1 - pose.armBlend;

      applyLegs(pose.idleT, v);
      applyArms(pose.idleT, v);

      // 髋部上下起伏（每步一次）+ 左右重心转移
      const bob = -0.013 * v * Math.cos(pose.phase * 2);
      const sway = 0.012 * v * Math.sin(pose.phase);
      // clear 是"髋到脚底"的距离；减去站姿基准 restClear 得到抬升增量，
      // 再叠加到固定的髋高上，保证任何速度下脚都不穿地、也不悬空。
      const clear = footClearance(v);
      ob.hips.position.y = 0.795 + (clear - restClear) + bob;

      // 脊柱：老人略微含胸驼背；走路时随步伐轻微起伏
      const breath = 0.010 * Math.sin(pose.idleT * 1.5) * idle;
      ob.lower.rotation.x = 0.035 + 0.012 * v + breath * 0.5;
      ob.lower.rotation.y = -0.055 * v * Math.sin(pose.phase);
      ob.lower.rotation.z = -0.020 * v * Math.sin(pose.phase);
      ob.upper.rotation.x = 0.055 + 0.020 * v + breath;
      ob.upper.rotation.y = -0.030 * v * Math.sin(pose.phase);
      // 侧向摆胯（老奶奶步态的"摇摆"感）
      ob.hips.rotation.z = 0.045 * v * Math.sin(pose.phase);
      ob.hips.rotation.y = 0.070 * v * Math.sin(pose.phase);
      ob.hips.position.x = sway;

      // 头部：抵消躯干转动，视线尽量水平
      ob.neck.rotation.x = -0.11 - 0.02 * v + breath * 0.6;
      ob.neck.rotation.z = -0.030 * v * Math.sin(pose.phase);
      ob.head.rotation.y = (opts.lookYaw || 0) * 0.6 + 0.03 * v * Math.sin(pose.phase);

      // 眨眼
      pose.blink -= dt;
      if (pose.blink < -0.0) {
        pose.nextBlink -= dt;
        if (pose.nextBlink <= 0) { pose.blink = 0.11; pose.nextBlink = 2.2 + Math.random() * 3.4; }
      }
      const closed = pose.blink > 0 ? Math.sin((1 - Math.abs(pose.blink / 0.11 - 0.5) * 2) * Math.PI) : 0;
      for (let i = 0; i < ob.eyes.length; i++) {
        const e = ob.eyes[i], base = ob.eyeBaseScale[i];
        e.scale.set(base.x, base.y * (1 - 0.86 * closed), base.z);
      }

      // 走路时轻微上下点头
      ob.head.rotation.x = 0.02 * v * Math.sin(pose.phase * 2 + 0.6);

      // 让世界矩阵立刻反映本帧姿态（阴影贴图、骨架探针、外部读坐标都依赖它）
      root.updateMatrixWorld(true);

      ob.speed = pose.speed;
      ob.phase = pose.phase;
      return pose.speed;
    };

    // 立即可视化一次站姿
    ob.update(0.016, { speed: 0 });

    /* 骨架探针：返回各关节的世界坐标与整体包围盒（调比例、核验穿地用） */
    ob.rig = function () {
      root.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      function at(o) {
        o.updateWorldMatrix(true, false);
        v.setFromMatrixPosition(o.matrixWorld);
        // 相对 root（根在 y=0 地面上）→ 直接就是离地高度
        return [+(v.x - root.position.x).toFixed(3), +(v.y - root.position.y).toFixed(3), +(v.z - root.position.z).toFixed(3)];
      }
      const box = new THREE.Box3();
      root.traverse(function (o) {
        if (o.isMesh && o !== ob.shadowBlob) box.expandByObject(o);
      });
      const oy = root.position.y;
      return {
        height: +(box.max.y - box.min.y).toFixed(3),
        footY: +(box.min.y - oy).toFixed(3),          // 相对脚底站立面
        crownY: +(box.max.y - oy).toFixed(3),
        width: +(box.max.x - box.min.x).toFixed(3),
        rootY: +oy.toFixed(3),
        hips: at(ob.hips), headCenter: at(ob.head),
        shoulderL: at(ob.arms[0].shoulder), shoulderR: at(ob.arms[1].shoulder),
        elbowL: at(ob.arms[0].elbow), wristL: at(ob.arms[0].wrist),
        hipL: at(ob.legs[0].hip), kneeL: at(ob.legs[0].knee), ankleL: at(ob.legs[0].ankle),
        hipR: at(ob.legs[1].hip), kneeR: at(ob.legs[1].knee), ankleR: at(ob.legs[1].ankle)
      };
    };
    ob.setOpacity = function (a) { /* 预留：需要淡入淡出时用 */ };
    ob.root.userData.grandma = ob;
    return ob;
  }

  global.createGrandma = function () { return build(); };
  global.GRANDMA_MATERIALS = M;
})(window);
