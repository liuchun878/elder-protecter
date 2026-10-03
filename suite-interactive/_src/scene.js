  /* ======================================================================
     交互层（suite-interactive 新增）
     ----------------------------------------------------------------------
     · 王阿姨：带骨骼分组的可动角色（站立 / 行走 / 坐下）
     · 送药机器人：蛋形机身 + 顶部平板屏（发光条＝通道指示，无文字）
       + 前下方对开门 + 可推出药盘 + 充电桩
     · 点击地面 → 寻路走过去（点到座位则坐下）；机器人随后感应并过去送药
     坐标系沿用场景：Y 向上，平面坐标为米，世界坐标 = 平面 + (OX, OZ)
     ====================================================================== */

  /* ------------------------------------------------------------ 小工具 */
  const clampN = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const lerpN = (a, b, k) => a + (b - a) * k;
  const dampN = (a, b, k, dt) => a + (b - a) * Math.min(1, (dt || .016) * k);
  const wrapPI = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const WX = x => x + OX, WZ = z => z + OZ;
  // 导航网格一律用"平面坐标"（米，原点在户型西北角）；世界坐标 = 平面 + (OX, OZ)
  const PW = p => [p[0] + OX, p[1] + OZ];
  const toWorldPath = p => p.map(PW);

  /* ============================================================ 1. 王阿姨 */
  const GR = { hipY: 0.83, thigh: 0.42, shin: 0.38, walk: 0.92, turn: 6.0 };

  function buildGranny() {
    const mSkin = new T.MeshStandardMaterial({ color: 0xe9c7a9, roughness: .78 });
    const mHair = new T.MeshStandardMaterial({ color: 0xdfdbd5, roughness: .9 });
    const mKnit = new T.MeshStandardMaterial({ color: 0xdda2a6, roughness: .95 });     // 藕荷粉开衫
    const mCard = new T.MeshStandardMaterial({ color: 0xdda2a6, roughness: .95, side: T.DoubleSide });
    const mSkirt = new T.MeshStandardMaterial({ color: 0x5a6371, roughness: .92 });
    const mBlouse = new T.MeshStandardMaterial({ color: 0xf5f0e7, roughness: .9 });
    const mShoe = new T.MeshStandardMaterial({ color: 0x46433f, roughness: .82 });
    const mFrame = new T.MeshStandardMaterial({ color: 0x3d3934, roughness: .42, metalness: .35 });
    const mWood = new T.MeshStandardMaterial({ color: 0x8a6a45, roughness: .55 });
    const mk = (par, geo, mat, x, y, z, rx, ry, rz) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true; m.receiveShadow = true;
      par.add(m); return m;
    };
    const root = new T.Group();
    const hip = new T.Group(); hip.position.y = GR.hipY; root.add(hip);
    // 腿（大腿 / 小腿 + 鞋）
    const legs = [];
    [-1, 1].forEach(s => {
      const thigh = new T.Group(); thigh.position.set(s * .076, -.015, 0); hip.add(thigh);
      mk(thigh, new T.CylinderGeometry(.070, .058, GR.thigh, 14), mSkirt, 0, -GR.thigh / 2, 0);
      const shin = new T.Group(); shin.position.y = -GR.thigh; thigh.add(shin);
      mk(shin, new T.CapsuleGeometry(.042, GR.shin - .10, 6, 12), mSkin, 0, -.19, 0);
      mk(shin, new T.BoxGeometry(.078, .048, .172), mShoe, 0, -.358, .034);
      legs.push({ thigh, shin });
    });
    // 躯干（含胸微前倾）
    const torso = new T.Group(); torso.rotation.x = .085; hip.add(torso);
    mk(torso, new T.CylinderGeometry(.126, .142, .22, 18), mSkirt, 0, .055, 0);
    mk(torso, new T.CylinderGeometry(.118, .136, .34, 18), mBlouse, 0, .29, 0);
    mk(torso, new T.CylinderGeometry(.130, .148, .36, 18, 1, true), mCard, 0, .29, .004);
    mk(torso, new T.SphereGeometry(.143, 18, 12), mKnit, 0, .445, 0);
    mk(torso, new T.CylinderGeometry(.038, .042, .08, 12), mSkin, 0, .500, .012);
    // 手臂（略外张，露在开衫外侧）
    const arms = [];
    [-1, 1].forEach(s => {
      const arm = new T.Group(); arm.position.set(s * .164, .425, 0); arm.rotation.z = -s * .13; torso.add(arm);
      mk(arm, new T.CylinderGeometry(.041, .045, .26, 12), mKnit, 0, -.13, 0);
      const fore = new T.Group(); fore.position.y = -.26; arm.add(fore);
      mk(fore, new T.CylinderGeometry(.031, .036, .21, 12), mSkin, 0, -.105, 0);
      mk(fore, new T.SphereGeometry(.036, 12, 10), mSkin, 0, -.222, 0);
      arms.push({ arm, fore });
    });
    // 头 + 花白盘发 + 老花镜
    const head = new T.Group(); head.position.set(0, .552, .012); head.rotation.x = .06; torso.add(head);
    mk(head, new T.SphereGeometry(.094, 20, 16), mSkin, 0, .012, 0).scale.set(1, 1.1, 1.03);
    const hb = mk(head, new T.SphereGeometry(.100, 20, 14), mHair, 0, .040, -.012); hb.scale.set(1.02, .96, 1.0);
    mk(head, new T.SphereGeometry(.045, 14, 12), mHair, 0, .030, -.097);
    [-1, 1].forEach(s => mk(head, new T.TorusGeometry(.031, .0045, 8, 18), mFrame, s * .041, .020, .085));
    mk(head, new T.BoxGeometry(.022, .005, .006), mFrame, 0, .026, .089);
    // 拐杖：挂在右手上，随手摆动
    const cane = new T.Group(); cane.position.set(0, -.20, .015); arms[1].fore.add(cane);
    mk(cane, new T.CylinderGeometry(.010, .012, .74, 10), mWood, 0, -.37, .012);
    const hd = mk(cane, new T.TorusGeometry(.040, .010, 8, 14, Math.PI), mWood, 0, 0, .012);
    hd.rotation.set(Math.PI / 2, 0, 0);
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { root, hip, torso, head, legs, arms, cane };
  }

  const grRig = buildGranny();
  scene.add(grRig.root);

  const POSE_IDLE = { hipY: GR.hipY, lean: .085, headX: .06, thighL: -.02, thighR: .02, shinL: .02, shinR: .02, armL: .04, armR: -.04, foreL: -.16, foreR: -.16 };
  function walkPose(ph, spd) {
    const a = clampN(spd / 1.05, 0, 1), s = Math.sin(ph);
    return {
      hipY: GR.hipY - .026 * (1 - Math.abs(Math.cos(ph))) - .004,
      lean: .105 + .022 * Math.abs(s), headX: .05,
      thighL: -s * .44 * a, thighR: s * .44 * a,
      shinL: Math.max(0, Math.sin(ph + 2.0)) * .80 * a,
      shinR: Math.max(0, Math.sin(ph + 2.0 + Math.PI)) * .80 * a,
      armL: s * .28 * a, armR: -s * .28 * a, foreL: -.22, foreR: -.22
    };
  }
  function sitPose(top) {
    return { hipY: top + .035, lean: .02, headX: .02, thighL: -1.34, thighR: -1.34, shinL: 1.34, shinR: 1.34, armL: -.34, armR: -.34, foreL: -.30, foreR: -.30 };
  }
  const grPose = Object.assign({}, POSE_IDLE);
  function applyGrPose(p) {
    grRig.hip.position.y = p.hipY;
    grRig.torso.rotation.x = p.lean;
    grRig.head.rotation.x = p.headX;
    grRig.legs[0].thigh.rotation.x = p.thighL; grRig.legs[1].thigh.rotation.x = p.thighR;
    grRig.legs[0].shin.rotation.x = p.shinL; grRig.legs[1].shin.rotation.x = p.shinR;
    grRig.arms[0].arm.rotation.x = p.armL; grRig.arms[1].arm.rotation.x = p.armR;
    grRig.arms[0].fore.rotation.x = p.foreL; grRig.arms[1].fore.rotation.x = p.foreR;
  }

  /* ======================================================== 2. 座位与地点 */
  // 座位：x/z 为平面上"坐下后髋部"的位置；rot 为坐下朝向；top 为座面高
  const SEATS = [
    { name: '客厅沙发', x: 9.02, z: 8.85, rot: Math.PI / 2, top: .50, stand: [9.60, 8.20] },
    { name: '餐桌（南侧）', x: 6.65, z: 6.22, rot: Math.PI, top: .47, stand: [6.65, 6.60] },
    { name: '卧室 A 床边', x: 1.62, z: 2.94, rot: 0, top: .44, stand: [1.62, 3.52] },
    { name: '客厅扶手椅', x: 11.32, z: 7.62, rot: Math.PI * .72, top: .45, stand: [10.62, 7.95] }
  ];
  const SEAT_BOX = SEATS.map(s => new T.Box3(
    new T.Vector3(WX(s.x) - .42, 0, WZ(s.z) - .42),
    new T.Vector3(WX(s.x) + .42, .95, WZ(s.z) + .42)
  ));
  // 模拟输入地点：座位 / 站位
  const PLACES = {
    '客厅': { seat: 0, label: '客厅' },
    '卧室': { seat: 2, label: '卧室 A' },
    '餐区·餐桌': { seat: 1, label: '餐区 · 餐桌' },
    '出门': { stand: [12.42, 5.80], rot: Math.PI / 2, label: '出门（玄关）' }
  };

  /* ==================================================== 3. 送药机器人 */
  const RB = { S: 1.35, baseY: 0.062, trayOut: .205 };
  function buildRobot() {
    const mShell = new T.MeshStandardMaterial({ color: 0xf8f9fa, roughness: .22, metalness: .04, envMapIntensity: 1.0 });
    const mShell2 = new T.MeshStandardMaterial({ color: 0xe8eaee, roughness: .38, metalness: .05 });
    const mCav = new T.MeshStandardMaterial({ color: 0x3a3d42, roughness: .8, side: T.DoubleSide });
    const mDark = new T.MeshStandardMaterial({ color: 0x0f1116, roughness: .12, metalness: .45, envMapIntensity: 1.3 });
    const mAlu = new T.MeshStandardMaterial({ color: 0xa8aeb4, roughness: .34, metalness: .8 });
    const mTray = new T.MeshStandardMaterial({ color: 0xe6eaee, roughness: .40 });
    const mPill = new T.MeshStandardMaterial({ color: 0xefe6d4, roughness: .68 });
    const mFoil = new T.MeshStandardMaterial({ color: 0xd2d8dd, roughness: .22, metalness: .55 });
    const mCup = new T.MeshPhysicalMaterial({ color: 0xeaf4f8, roughness: .06, transparent: true, opacity: .32, envMapIntensity: 1.5, side: T.DoubleSide });
    const mWater = new T.MeshPhysicalMaterial({ color: 0xa8d6ec, roughness: .04, transparent: true, opacity: .72, envMapIntensity: 1.2 });

    const root = new T.Group();
    // —— 底盘（低矮白裙 + 深色腰线 + 三个隐藏万向轮）
    const mk = (par, geo, mat, x, y, z, rx, ry, rz) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true; m.receiveShadow = true;
      par.add(m); return m;
    };
    mk(root, new T.CylinderGeometry(.225, .238, .062, 40), mShell, 0, .031, 0);
    mk(root, new T.CylinderGeometry(.240, .240, .012, 40), mShell2, 0, .006, 0);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + .5;
      mk(root, new T.SphereGeometry(.030, 12, 10), new T.MeshStandardMaterial({ color: 0x2a2d31, roughness: .85 }),
        Math.cos(a) * .135, .014, Math.sin(a) * .135);
    }
    // —— 蛋形机身（原始单位建模后整体缩放）
    const egg = new T.Group(); egg.scale.setScalar(RB.S); egg.position.y = RB.baseY - .012; root.add(egg);
    const R0 = .190;
    const DOOR = { y0: .170, y1: .300, az: .42 };
    const prof = [[0.000, 0.042], [0.015, 0.085], [0.045, 0.130], [0.105, 0.170], [0.175, 0.190], [0.230, 0.190],
                  [0.270, 0.188], [0.320, 0.185], [0.380, 0.176], [0.430, 0.155], [0.465, 0.115], [0.487, 0.072], [0.500, 0.046]];
    const V2 = a => a.map(p => new T.Vector2(p[1], p[0]));
    const bd = [[DOOR.y0, .1952], [.235, .1950], [DOOR.y1, .1912]];
    const body = new T.Mesh(new T.LatheGeometry(V2(prof), 64), mShell);
    body.castShadow = body.receiveShadow = true; egg.add(body);
    // 储物腔 + 隔板 + 舱内药品
    const nicheW = 2 * .1948 * Math.sin(DOOR.az / 2) * .94;
    mk(egg, new T.BoxGeometry(nicheW, DOOR.y1 - DOOR.y0 - .004, .010), mCav, 0, (DOOR.y0 + DOOR.y1) / 2, .190);
    mk(egg, new T.BoxGeometry(nicheW, .006, .052), mShell2, 0, DOOR.y0 + .004, .176);
    mk(egg, new T.BoxGeometry(.052, .008, .150), mAlu, 0, DOOR.y0 + .008, .100);
    mk(egg, new T.BoxGeometry(.110, .008, .060), mShell2, 0, DOOR.y0 + .086, .140);
    [[-.075, .075, .055], [.010, .062, .050], [.080, .070, .048]].forEach(q =>
      mk(egg, new T.BoxGeometry(q[2], q[1], .055), mPill, q[0], DOOR.y0 + .095 + q[1] / 2, -.070));
    mk(egg, new T.CylinderGeometry(.026, .026, .100, 20), mPill, .075, DOOR.y0 + .145, -.070);
    // —— 前下方对开门
    function makeLeaf(sign) {
      const FY = 0;
      const az0 = sign < 0 ? FY - DOOR.az : FY;
      const hingeAz = sign < 0 ? FY - DOOR.az : FY + DOOR.az;
      const HR = .1948, hx = Math.sin(hingeAz) * HR, hz = Math.cos(hingeAz) * HR;
      const g = new T.Group(); g.position.set(hx, 0, hz); egg.add(g);
      const geo = new T.LatheGeometry(V2(bd), 20, az0, DOOR.az); geo.translate(-hx, 0, -hz);
      const m = new T.Mesh(geo, mShell); m.castShadow = m.receiveShadow = true; g.add(m);
      const ge = new T.LatheGeometry(V2(bd.map(q => [q[0], q[1] - .0035])), 20, az0, DOOR.az); ge.translate(-hx, 0, -hz);
      g.add(new T.Mesh(ge, new T.MeshStandardMaterial({ color: 0xeceef0, roughness: .5, side: T.BackSide })));
      const sa = FY + sign * .012, sx = Math.sin(sa) * .1972, sz = Math.cos(sa) * .1972;
      const seam = new T.Mesh(new T.BoxGeometry(.0035, DOOR.y1 - DOOR.y0 - .006, .005), mShell2);
      seam.position.set(sx - hx, (DOOR.y0 + DOOR.y1) / 2, sz - hz); seam.rotation.y = -sa + Math.PI / 2; g.add(seam);
      const ha = FY + sign * .090, px = Math.sin(ha) * .1995, pz = Math.cos(ha) * .1995;
      const hd2 = new T.Mesh(new T.CylinderGeometry(.0085, .0085, .013, 16), mAlu);
      hd2.position.set(px - hx, (DOOR.y0 + DOOR.y1) / 2, pz - hz); hd2.rotation.x = Math.PI / 2; g.add(hd2);
      [DOOR.y0 + .014, DOOR.y1 - .014].forEach(hy =>
        mk(g, new T.CylinderGeometry(.0055, .0055, .018, 12), mAlu, 0, hy, 0));
      return g;
    }
    const doorL = makeLeaf(-1), doorR = makeLeaf(1);
    // —— 药盘（含导轨；尾端始终留在舱内）
    const trayG = new T.Group(); egg.add(trayG);
    const trayY = (DOOR.y0 + DOOR.y1) / 2 - .004;
    mk(trayG, new T.BoxGeometry(.200, .012, .140), mTray, 0, 0, .045);
    mk(trayG, new T.BoxGeometry(.205, .014, .012), mTray, 0, .008, .112);
    mk(trayG, new T.BoxGeometry(.046, .010, .240), mAlu, 0, -.010, -.020);
    mk(trayG, new T.BoxGeometry(.030, .008, .260), mShell2, 0, -.018, -.040);
    const CR = .026, CH = .068;
    const cg = new T.CylinderGeometry(CR, CR * .88, CH, 22, 1, true); cg.translate(0, CH / 2, 0);
    mk(trayG, cg, mCup, .030, .007, .052);
    const disc = new T.Mesh(new T.CircleGeometry(CR * .88, 22), mCup);
    disc.rotation.x = -Math.PI / 2; disc.position.set(.030, .0075, .052); trayG.add(disc);
    const wg = new T.CylinderGeometry(CR * .93, CR * .82, CH * .78, 22); wg.translate(0, CH * .39, 0);
    const water = mk(trayG, wg, mWater, .030, .009, .052);
    // 独立包装药品（两排三列）+ 圆药盒 + 棉片 / 纱布
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) {
      const px = -.034 + i * .034, pz = .016 + r * .048;
      mk(trayG, new T.BoxGeometry(.028, .006, .040), mPill, px, .010, pz);
      mk(trayG, new T.BoxGeometry(.030, .003, .042), mFoil, px, .0145, pz);
    }
    const pb = new T.Group(); pb.position.set(-.034, .007, .086); trayG.add(pb);
    mk(pb, new T.CylinderGeometry(.033, .033, .024, 22), mPill, 0, .012, 0);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      mk(pb, new T.CylinderGeometry(.006, .006, .004, 10), mPill, Math.cos(a) * .016, .028, Math.sin(a) * .016);
    }
    const lid = mk(pb, new T.CylinderGeometry(.035, .035, .006, 22), mPill, .030, .040, .018);
    lid.rotation.set(-.85, 0, -.45);
    const mPad = new T.MeshStandardMaterial({ color: 0xf3f6f8, roughness: .75 });
    mk(trayG, new T.BoxGeometry(.024, .004, .024), mPad, -.020, .010, .110);
    const gauze = mk(trayG, new T.CylinderGeometry(.014, .014, .026, 18), mPad, .040, .021, .100);
    gauze.rotation.z = Math.PI / 2;
    // —— 顶部平板屏（发光条＝通道指示，无文字）
    mk(egg, new T.CylinderGeometry(.052, .062, .046, 28), mShell, 0, .516, 0);      // 颈部
    mk(egg, new T.BoxGeometry(.026, .040, .026), mAlu, 0, .556, 0);                  // 支座
    const tab = new T.Group(); tab.position.set(0, .600, .006); tab.rotation.x = -.30; egg.add(tab);
    const rbox = (w, h, d, r) => {
      const sh = new T.Shape(), x0 = -w / 2, y0 = -h / 2;
      sh.moveTo(x0 + r, y0); sh.lineTo(x0 + w - r, y0); sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
      sh.lineTo(x0 + w, y0 + h - r); sh.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
      sh.lineTo(x0 + r, y0 + h); sh.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
      sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
      const g = new T.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 2, curveSegments: 8 });
      g.translate(0, 0, -d / 2); return g;
    };
    mk(tab, rbox(.300, .185, .018, .028), mShell, 0, 0, -.004);
    // 屏幕画面（canvas）：只画发光条，不写文字
    const cvS = cv(384, 240), cxS = cvS.getContext('2d');
    const texS = new T.CanvasTexture(cvS); texS.colorSpace = T.SRGBColorSpace;
    const screen = new T.Mesh(new T.PlaneGeometry(.272, .164),
      new T.MeshBasicMaterial({ map: texS, toneMapped: false, transparent: true }));
    screen.position.set(0, 0, .014); tab.add(screen);
    const scrLight = new T.PointLight(0x9fd0ff, .0, 1.1, 2); scrLight.position.set(0, .02, .16); tab.add(scrLight);
    // 机身正面的发光条（通道指示）
    const ledMat = new T.MeshStandardMaterial({ color: 0x8ad8ff, emissive: 0x4fc3ff, emissiveIntensity: 2.0, roughness: .3 });
    mk(egg, new T.BoxGeometry(.020, .085, .012), ledMat, 0, .360, .193);
    // 药盘 / 门 / 屏 的状态量
    const st = { door: 0, tray: 0, mode: 'dock', t: 0, glow: 0 };
    return { root, egg, doorL, doorR, trayG, trayY, screen, scrLight, ledMat, texS, cxS, cvS, st };
  }
  const rb = buildRobot();
  scene.add(rb.root);

  // 屏幕绘制（无文字，只有通道光条 + 底部电量条）
  function rr(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py); x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }
  function drawScreen(mode, t) {
    const W2 = 384, H2 = 240, x = rb.cxS;
    const col = mode === 'serve' ? '#ffb02e' : mode === 'done' ? '#57e08b'
      : mode === 'transit' ? '#63cdff' : mode === 'charge' ? '#7fd8ff' : '#6fb4ff';
    x.clearRect(0, 0, W2, H2);
    x.fillStyle = '#05070b'; x.fillRect(0, 0, W2, H2);
    const g0 = x.createLinearGradient(0, 0, 0, H2);
    g0.addColorStop(0, 'rgba(255,255,255,.07)'); g0.addColorStop(.45, 'rgba(255,255,255,0)');
    g0.addColorStop(1, 'rgba(255,255,255,.04)');
    x.fillStyle = g0; x.fillRect(0, 0, W2, H2);
    // —— 三条通道指示光条
    const n = 3, bw = 84, gap = 20, x0 = (W2 - (n * bw + (n - 1) * gap)) / 2;
    for (let i = 0; i < n; i++) {
      const px = x0 + i * (bw + gap);
      let a = .16;
      if (mode === 'transit') { const k = (t * 1.5 - i * .26) % 1; a = .20 + .80 * Math.max(0, Math.sin((k + 1) % 1 * Math.PI)); }
      else if (mode === 'serve') { const k = (t * 1.2 - i * .20) % 1; a = .60 + .40 * Math.max(0, Math.sin((k + 1) % 1 * Math.PI)); }
      else if (mode === 'done') { a = .92; }
      else if (mode === 'charge') { a = i === 0 ? .35 + .55 * (.5 + .5 * Math.sin(t * 2.4)) : .14; }
      else { a = [1, 0, 0][i] ? .55 + .35 * (.5 + .5 * Math.sin(t * 1.6)) : .13; }
      x.save();
      x.shadowColor = col; x.shadowBlur = 30 * a;
      x.globalAlpha = a; x.fillStyle = col;
      rr(x, px, 64, bw, 40, 9); x.fill();
      x.restore();
    }
    // —— 底部：药量 / 电量细条
    const bwid = 210, bx = (W2 - bwid) / 2;
    x.globalAlpha = .18; x.fillStyle = col; rr(x, bx, 176, bwid, 12, 6); x.fill();
    const lv = mode === 'charge' ? .30 + .68 * (.5 + .5 * Math.sin(t * 1.8)) : mode === 'serve' ? .78 : .62;
    x.globalAlpha = .85; x.shadowColor = col; x.shadowBlur = 16;
    rr(x, bx, 176, bwid * lv, 12, 6); x.fill();
    x.shadowBlur = 0; x.globalAlpha = 1;
    rb.texS.needsUpdate = true;
  }

  /* ============================================================ 4. 充电桩 */
  const DOCK = { x: 12.78, z: 9.55, rot: -Math.PI / 2 };
  const dockG = new T.Group(); scene.add(dockG);
  (function buildDock() {
    const mMat = new T.MeshStandardMaterial({ color: 0x30343a, roughness: .92 });
    const mTrim = new T.MeshStandardMaterial({ color: 0xd8c489, roughness: .5, metalness: .25 });
    const mShell = new T.MeshStandardMaterial({ color: 0xf2f4f6, roughness: .35, metalness: .05 });
    const mBrass = new T.MeshStandardMaterial({ color: 0xb99a55, roughness: .35, metalness: .85 });
    const mDark = new T.MeshStandardMaterial({ color: 0x1a1d21, roughness: .5 });
    const mGlow = new T.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x52c8ff, emissiveIntensity: 1.8, roughness: .35 });
    const add = (geo, mat, x, y, z, rx, ry, rz) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true; m.receiveShadow = true; dockG.add(m); return m;
    };
    add(new T.BoxGeometry(.70, .010, .60), mTrim, WX(DOCK.x), .006, WZ(DOCK.z));
    add(new T.BoxGeometry(.64, .014, .54), mMat, WX(DOCK.x), .016, WZ(DOCK.z));
    add(new T.BoxGeometry(.30, .012, .10), mTrim, WX(DOCK.x) - .12, .022, WZ(DOCK.z));      // 定位条
    // 靠墙立柱 + 触点
    add(new T.BoxGeometry(.10, .30, .34), mShell, WX(13.02), .15, WZ(DOCK.z));
    add(new T.BoxGeometry(.036, .07, .05), mBrass, WX(12.955), .12, WZ(DOCK.z) - .09);
    add(new T.BoxGeometry(.036, .07, .05), mBrass, WX(12.955), .12, WZ(DOCK.z) + .09);
    add(new T.BoxGeometry(.02, .16, .20), mDark, WX(12.965), .12, WZ(DOCK.z));
    add(new T.SphereGeometry(.016, 12, 10), mGlow, WX(12.95), .248, WZ(DOCK.z));
    add(new T.CylinderGeometry(.016, .016, .38, 10), mDark, WX(13.10), .33, WZ(DOCK.z) + .30, 0, 0, Math.PI / 2.2);
  })();

  /* ============================================================= 5. 导航 */
  const NAV = (function () {
    const CELL = 0.15;
    const PAD = 0.09;                       // 障碍外扩（≈ 半身宽；再大就会把沙发/茶几之间的站位挤没）
    const p0x = -0.30, p0z = -0.30;         // 平面坐标网格原点
    const nx = Math.ceil((W + 0.60) / CELL), nz = Math.ceil((D + 0.60) / CELL);
    const obst = [];
    // —— 墙体（门洞上方的过梁不挡人）
    wallSpecs.forEach(s => {
      if (s.y0 > 1.4) return;
      const hw = s.w / 2, hd = s.d / 2;
      obst.push({ x1: s.x - OX - hw - PAD, z1: s.z - OZ - hd - PAD, x2: s.x - OX + hw + PAD, z2: s.z - OZ + hd + PAD });
    });
    // 家具：高度在 0.26 ~ 1.35 m 之间的实体挡路
    // 关键：必须先刷新一次世界矩阵，否则 setFromObject 拿到的是"局部"包围盒
    scene.updateMatrixWorld(true);
    const bb = new T.Box3();
    furnG.traverse(o => {
      if (!o.isMesh) return;
      bb.setFromObject(o);
      if (bb.max.y < 0.26 || bb.min.y > 1.35) return;
      obst.push({
        x1: bb.min.x - OX - PAD, z1: bb.min.z - OZ - PAD,
        x2: bb.max.x - OX + PAD, z2: bb.max.z - OZ + PAD
      });
    });
    const roomsArr = Object.keys(ROOMS).map(k => ROOMS[k]);
    const inRoom = (x, z) => roomsArr.some(r => x > r.x1 + .10 && x < r.x2 - .10 && z > r.z1 + .10 && z < r.z2 - .10);
    const blocked = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = p0x + (i + .5) * CELL, z = p0z + (j + .5) * CELL;
      let b = !inRoom(x, z);
      if (!b) for (let k = 0; k < obst.length; k++) {
        const o = obst[k];
        if (x > o.x1 && x < o.x2 && z > o.z1 && z < o.z2) { b = 1; break; }
      }
      blocked[i * nz + j] = b;
    }
    const toCell = (x, z) => [clampN(Math.floor((x - p0x) / CELL), 0, nx - 1), clampN(Math.floor((z - p0z) / CELL), 0, nz - 1)];
    const toPlan = (i, j) => [p0x + (i + .5) * CELL, p0z + (j + .5) * CELL];
    const isWalk = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && !blocked[i * nz + j];
    // 最近的可走格（点到家具/墙里时自动吸附）
    function snap(x, z) {
      let [ci, cj] = toCell(x, z);
      if (isWalk(ci, cj)) return toPlan(ci, cj);
      for (let r = 1; r < 40; r++) {
        let best = null, bd = 1e9;
        for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!isWalk(i, j)) continue;
          const p = toPlan(i, j), d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) return best;
      }
      return [x, z];
    }
    // A*
    function findPath(sx, sz, gx, gz) {
      const S = snap(sx, sz), Gs = snap(gx, gz);
      const [si, sj] = toCell(S[0], S[1]), [gi, gj] = toCell(Gs[0], Gs[1]);
      if (si === gi && sj === gj) return [[Gs[0], Gs[1]]];
      const N = nx * nz, g = new Float32Array(N).fill(1e9), f = new Float32Array(N).fill(1e9);
      const prev = new Int32Array(N).fill(-1), open = [si * nz + sj], inOpen = new Uint8Array(N);
      const H = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
      g[si * nz + sj] = 0; f[si * nz + sj] = H(si, sj); inOpen[si * nz + sj] = 1;
      const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
      let guard = 0;
      while (open.length && guard++ < 60000) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
        const cur = open.splice(bi, 1)[0]; inOpen[cur] = 0;
        const ci = Math.floor(cur / nz), cj = cur % nz;
        if (ci === gi && cj === gj) break;
        for (let d = 0; d < 8; d++) {
          const ni = ci + D[d][0], nj = cj + D[d][1];
          if (!isWalk(ni, nj)) continue;
          if (D[d][2] > 1 && (!isWalk(ci + D[d][0], cj) || !isWalk(ci, cj + D[d][1]))) continue;   // 不切角
          const ni2 = ni * nz + nj, ng = g[cur] + D[d][2];
          if (ng < g[ni2]) {
            prev[ni2] = cur; g[ni2] = ng; f[ni2] = ng + H(ni, nj);
            if (!inOpen[ni2]) { open.push(ni2); inOpen[ni2] = 1; }
          }
        }
      }
      if (prev[gi * nz + gj] === -1 && !(si === gi && sj === gj)) return [[Gs[0], Gs[1]]];
      const out = []; let cur = gi * nz + gj;
      while (cur !== -1) { const i = Math.floor(cur / nz), j = cur % nz; out.push(toPlan(i, j)); cur = prev[cur]; }
      out.reverse();
      // 拉直：能直视的点之间的中间点丢掉
      const los = (a, b) => {
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(d / .10));
        for (let k = 1; k < n; k++) {
          const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
          const [i, j] = toCell(x, z);
          if (!isWalk(i, j)) return false;
        }
        return true;
      };
      const sm = [out[0]];
      let a = 0;
      while (a < out.length - 1) {
        let b = out.length - 1;
        while (b > a + 1 && !los(out[a], out[b])) b--;
        sm.push(out[b]); a = b;
      }
      sm[sm.length - 1] = [Gs[0], Gs[1]];
      return sm;
    }
    // 导航网格贴图（调试显示）
    const ncv = cv(nx, nz), nctx = ncv.getContext('2d');
    nctx.clearRect(0, 0, nx, nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (blocked[i * nz + j]) continue;
      nctx.fillStyle = 'rgba(64,214,140,.30)';
      nctx.fillRect(i, j, 1, 1);
      nctx.fillStyle = 'rgba(30,140,90,.55)';
      nctx.fillRect(i, j, 1, 0.12);
    }
    const ntex = new T.CanvasTexture(ncv);
    ntex.magFilter = T.NearestFilter; ntex.minFilter = T.NearestFilter;
    const plane = new T.Mesh(new T.PlaneGeometry(W + .60, D + .60),
      new T.MeshBasicMaterial({ map: ntex, transparent: true, opacity: .85, depthWrite: false, toneMapped: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(-0.30 + OX + (W + .60) / 2, .035, -0.30 + OZ + (D + .60) / 2);
    plane.visible = false;
    scene.add(plane);
    let blockedCount = 0;
    for (let k = 0; k < blocked.length; k++) if (blocked[k]) blockedCount++;
    return {
      findPath, snap, plane, nx, nz,
      stat: { obst: obst.length, nx: nx, nz: nz, cells: nx * nz, blocked: blockedCount, walk: nx * nz - blockedCount },
      at: function (x, z) {
        const i = Math.floor((x - p0x) / CELL), j = Math.floor((z - p0z) / CELL);
        const inb = i >= 0 && j >= 0 && i < nx && j < nz;
        if (!inb) return { inb: false };
        const cx = p0x + (i + .5) * CELL, cz = p0z + (j + .5) * CELL;
        const hits = obst.filter(o => cx > o.x1 && cx < o.x2 && cz > o.z1 && cz < o.z2);
        return { i: i, j: j, center: [+cx.toFixed(2), +cz.toFixed(2)], blocked: !!blocked[i * nz + j], hits: hits.length, box: hits[0] || null };
      }
    };
  })();

  /* ========================================================= 6. 智能体 */
  const gr = {
    pos: new T.Vector3(WX(10.30), 0, WZ(6.60)),
    rot: -.38, path: [], state: 'stand', seat: -1, phase: 0, sitT: 0, moveT: 0,
    pendingSeat: -1, onArrive: null
  };
  grRig.root.position.copy(gr.pos);
  grRig.root.rotation.y = gr.rot;

  const robot = {
    pos: new T.Vector3(WX(DOCK.x), 0, WZ(DOCK.z)),
    rot: DOCK.rot, path: [], state: 'dock', t: 0, spd: .62, mode: 'dock', sitOn: 0
  };
  rb.root.position.copy(robot.pos);
  rb.root.rotation.y = robot.rot;

  const screenState = { mode: 'dock', t: 0 };

  function grannyPlace() {
    const x = gr.pos.x - OX, z = gr.pos.z - OZ;
    const inR = (r) => x > r.x1 && x < r.x2 && z > r.z1 && z < r.z2;
    if (gr.state === 'sit' && gr.seat >= 0) {
      const n = SEATS[gr.seat].name;
      return n.indexOf('沙发') >= 0 ? '客厅' : n.indexOf('餐桌') >= 0 ? '餐区' : n.indexOf('卧室') >= 0 ? '卧室' : n;
    }
    if (inR(ROOMS.living)) return (z < 6.40 && x < 8.40) ? '餐区' : '客厅';
    if (inR(ROOMS.bedA)) return '卧室 A';
    if (inR(ROOMS.bedB)) return '卧室 B';
    if (inR(ROOMS.bedC)) return '卧室 C';
    if (inR(ROOMS.study)) return '书房';
    if (inR(ROOMS.bathA)) return '卫 A';
    if (inR(ROOMS.bathB)) return '卫 B';
    if (inR(ROOMS.wcC)) return '卫生间';
    if (inR(ROOMS.hallN)) return '走廊';
    if (inR(ROOMS.hallW)) return '玄关';
    return '客厅';
  }
  const ROBOT_TXT = { dock: '回充电桩待命', charge: '充电中', transit: '正在过去', serve: '送药中', done: '送药完成', back: '正在返回充电桩' };

  /* 让王阿姨去某处（座位则坐下）—— 入参为世界坐标 */
  function grannyGo(worldX, worldZ, seatIdx) {
    const from = [gr.pos.x - OX, gr.pos.z - OZ];         // → 平面坐标
    let goal, plan;
    if (seatIdx >= 0) {
      const s = SEATS[seatIdx];
      plan = NAV.snap(s.stand[0], s.stand[1]);
      gr.pendingSeat = seatIdx;
    } else {
      plan = NAV.snap(worldX - OX, worldZ - OZ);
      gr.pendingSeat = -1;
    }
    goal = PW(plan);
    const p = NAV.findPath(from[0], from[1], plan[0], plan[1]);
    if (p.length) p[p.length - 1] = plan;
    gr.path = toWorldPath(p);
    gr.state = 'walk';
    gr.sitT = 0;
    robot.wantServe = true;
    robot.serveSeat = seatIdx;
  }

  function updateGranny(dt) {
    let target = POSE_IDLE;
    if (gr.state === 'walk') {
      if (gr.path.length) {
        const wp = gr.path[0];
        const dx = wp[0] - gr.pos.x, dz = wp[1] - gr.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < .10) { gr.path.shift(); }
        else {
          const want = Math.atan2(dx, dz);
          gr.rot += wrapPI(want - gr.rot) * Math.min(1, dt * GR.turn);
          const step = Math.min(d, GR.walk * dt);
          gr.pos.x += dx / d * step; gr.pos.z += dz / d * step;
          gr.phase += dt * 5.6;
          target = walkPose(gr.phase, GR.walk);
        }
      } else {
        gr.state = 'stand';
        if (gr.pendingSeat >= 0) { gr.state = 'sit'; gr.seat = gr.pendingSeat; gr.sitT = 0; gr.pendingSeat = -1; }
      }
    } else if (gr.state === 'sit') {
      gr.sitT += dt;
      const s = SEATS[gr.seat];
      // 走到座位前 → 平滑挪到座面上
      gr.pos.x = lerpN(gr.pos.x, WX(s.x), Math.min(1, dt * 4.6));
      gr.pos.z = lerpN(gr.pos.z, WZ(s.z), Math.min(1, dt * 4.6));
      gr.rot += wrapPI(s.rot - gr.rot) * Math.min(1, dt * 5);
      target = sitPose(s.top);
      // 已就位：机器人随后感应到位置并移动过去
      if (gr.sitT > .7 && robot.wantServe && robot.state === 'dock') startServe();
    } else {
      gr.pos.y = 0;
      if (robot.wantServe && robot.state === 'dock') startServe();
    }
    // 平滑过渡姿态
    for (const k in target) grPose[k] = lerpN(grPose[k] === undefined ? target[k] : grPose[k], target[k], Math.min(1, dt * 7));
    applyGrPose(grPose);
    grRig.root.position.set(gr.pos.x, gr.pos.y, gr.pos.z);
    grRig.root.rotation.y = gr.rot;
  }

  /* 机器人：去王阿姨身边送药 */
  function servicePoint() {
    const fx = Math.sin(gr.rot), fz = Math.cos(gr.rot);
    const px = gr.pos.x - OX + fx * .92, pz = gr.pos.z - OZ + fz * .92;   // 平面坐标
    const s = NAV.snap(px, pz);
    return { p: s, rot: Math.atan2(gr.pos.x - WX(s[0]), gr.pos.z - WZ(s[1])) };
  }
  function startServe() {
    const sv = servicePoint();
    const from = [robot.pos.x - OX, robot.pos.z - OZ];
    const p = NAV.findPath(from[0], from[1], sv.p[0], sv.p[1]);
    if (p.length) p[p.length - 1] = sv.p;
    robot.path = toWorldPath(p);
    robot.goalRot = sv.rot;
    robot.state = 'transit';
    robot.t = 0;
    robot.wantServe = false;
  }
  function robotGoDock() {
    const from = [robot.pos.x - OX, robot.pos.z - OZ];
    robot.path = toWorldPath(NAV.findPath(from[0], from[1], DOCK.x, DOCK.z));
    robot.state = 'back';
    robot.goalRot = DOCK.rot;
    robot.t = 0;
  }
  function updateRobot(dt) {
    const moving = robot.state === 'transit' || robot.state === 'back';
    if (moving) {
      if (robot.path.length) {
        const wp = robot.path[0];
        const dx = wp[0] - robot.pos.x, dz = wp[1] - robot.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < .10) robot.path.shift();
        else {
          const want = Math.atan2(dx, dz);
          robot.rot += wrapPI(want - robot.rot) * Math.min(1, dt * 4.0);
          const step = Math.min(d, robot.spd * dt);
          robot.pos.x += dx / d * step; robot.pos.z += dz / d * step;
        }
      } else {
        if (robot.state === 'transit') { robot.state = 'serve'; robot.t = 0; }
        else { robot.state = 'dock'; robot.rot = DOCK.rot; robot.pos.x = WX(DOCK.x); robot.pos.z = WZ(DOCK.z); }
      }
    }
    // 到位后转正朝向（送药时要面朝王阿姨）
    if (robot.goalRot !== undefined && robot.path.length === 0)
      robot.rot += wrapPI(robot.goalRot - robot.rot) * Math.min(1, dt * 3.4);
    robot.t += dt;
    // —— 动作：开门 / 出盘 / 收回复位
    let door = 0, tray = 0, mode = 'dock';
    if (robot.state === 'dock') { door = 0; tray = 0; mode = 'charge'; }
    else if (robot.state === 'transit' || robot.state === 'back') { door = 0; tray = 0; mode = 'transit'; }
    else if (robot.state === 'serve') {
      const t = robot.t;
      door = clampN((t - .15) / .95, 0, 1);
      tray = clampN((t - 1.05) / .85, 0, 1);
      if (t > 6.6) tray = 1 - clampN((t - 6.6) / .85, 0, 1);
      if (t > 7.25) door = 1 - clampN((t - 7.25) / .70, 0, 1);
      mode = t < 7.6 ? 'serve' : 'done';
      if (t > 8.4) robotGoDock();
    }
    rb.st.door = door; rb.st.tray = tray;
    const eD = door * door * (3 - 2 * door), eT = tray * tray * (3 - 2 * tray);
    const sw = eD * (Math.PI / 2) * .92;
    rb.doorL.rotation.y = -sw; rb.doorR.rotation.y = sw;
    rb.trayG.position.set(0, rb.trayY, .030 + RB.trayOut * eT);
    // 屏幕光色
    const emisCol = mode === 'serve' ? 0xffb02e : mode === 'done' ? 0x57e08b : mode === 'transit' ? 0x63cdff : 0x6fb4ff;
    rb.ledMat.emissive.setHex(mode === 'serve' ? 0xffa421 : 0x4fc3ff);
    rb.scrLight.color.setHex(emisCol);
    rb.scrLight.intensity = dmp(rb.scrLight.intensity, mode === 'serve' ? 1.5 : mode === 'transit' ? .9 : .55, dt);
    screenState.mode = mode; screenState.t += dt;
    drawScreen(mode, screenState.t);
    rb.root.position.set(robot.pos.x, moving ? Math.sin(robot.t * 8) * .004 : 0, robot.pos.z);
    rb.root.rotation.y = robot.rot;
  }
  function dmp(a, b, dt) { return a + (b - a) * Math.min(1, dt * 4); }

  /* ======================================================== 7. 相机与机位 */
  const camCtl = {
    target: new T.Vector3(0, 1.0, .5), dTarget: new T.Vector3(0, 1.0, .5),
    theta: Math.PI * .30, phi: Math.PI * .32, radius: 19.2,
    dTheta: Math.PI * .30, dPhi: Math.PI * .32, dRadius: 19.2,
    eye: null, dEye: null, fov: 42, dFov: 42, auto: false, follow: null
  };
  const VIEWS = {
    '整户': { t: [0, 1.0, .5], r: 19.2, th: Math.PI * .30, ph: Math.PI * .32 },
    '客厅·电视墙': { t: [4.10, .85, 3.50], eye: [1.65, 1.72, .25], fov: 56, room: [4.8, 4.3, 13.4, 10.6] },
    '卧室': { t: [-5.15, .82, -3.10], eye: [-3.05, 1.58, -1.30], fov: 64, room: [0, 0, 4.6, 4.3] },
    '餐区': { t: [.45, .90, .10], eye: [2.35, 1.56, 1.90], fov: 60 },
    '充电桩': { dock: true, fov: 46 },
    '药盘特写': { tray: true, fov: 38 }
  };
  // 室内机位避让
  const blockers = [];
  (function () {
    scene.updateMatrixWorld(true);          // 同上：先刷新世界矩阵再取包围盒
    const b = new T.Box3();
    const scan = o => {
      if (!o.isMesh) return;
      b.setFromObject(o);
      if (b.max.y < .35 || b.min.y > 2.0) return;
      blockers.push({ x1: b.min.x - .34, x2: b.max.x + .34, z1: b.min.z - .34, z2: b.max.z + .34 });
    };
    furnG.traverse(scan);
    // 墙体也要参与避让，否则 freeEye 会把机位挪进墙里（踩过一次）
    wallSpecs.forEach(s => {
      if (s.y0 > 2.2) return;
      const hw = s.w / 2, hd = s.d / 2;
      blockers.push({ x1: s.x - hw - .18, x2: s.x + hw + .18, z1: s.z - hd - .18, z2: s.z + hd + .18 });
    });
  })();
  function freeEye(p, roomPlan) {
    let bx = [-1e9, 1e9, -1e9, 1e9];
    if (roomPlan) bx = [roomPlan[0] + OX + .30, roomPlan[2] + OX - .30, roomPlan[1] + OZ + .30, roomPlan[3] + OZ - .30];
    const inside = (x, z) => x > bx[0] && x < bx[1] && z > bx[2] && z < bx[3];
    const busy = (x, z) => blockers.some(b => x > b.x1 && x < b.x2 && z > b.z1 && z < b.z2);
    if (inside(p[0], p[2]) && !busy(p[0], p[2])) return p.slice();
    for (let r = .3; r <= 3.6; r += .3) for (let a = 0; a < 24; a++) {
      const th = a / 24 * Math.PI * 2, x = p[0] + Math.cos(th) * r, z = p[2] + Math.sin(th) * r;
      if (inside(x, z) && !busy(x, z)) return [x, p[1], z];
    }
    return p.slice();
  }
  let activeView = '整户';
  function flyTo(name) {
    const v = VIEWS[name] || name;
    activeView = typeof name === 'string' ? name : '自定义';
    camCtl.follow = v.tray ? 'tray' : v.dock ? 'dock' : null;
    if (v.tray || v.dock) { camCtl.dFov = v.fov || 45; camCtl.dEye = null; camCtl.eye = null; updateFollow(1); return; }
    camCtl.dTarget.set(v.t[0], v.t[1], v.t[2]);
    camCtl.dFov = v.fov || 42;
    if (v.eye) { const e = freeEye(v.eye, v.room); camCtl.dEye = new T.Vector3(e[0], e[1], e[2]); }
    else {
      camCtl.dEye = null; camCtl.eye = null;
      camCtl.dRadius = v.r; camCtl.dTheta = v.th; camCtl.dPhi = v.ph;
    }
  }
  function updateFollow(k) {
    if (!camCtl.follow) return;
    if (!camCtl.dEye) camCtl.dEye = new T.Vector3();
    const fx = Math.sin(robot.rot), fz = Math.cos(robot.rot);
    const rx = fz, rz = -fx;                                     // 机器人右向
    if (camCtl.follow === 'tray') {
      const ty = .062 + .231 * RB.S;                             // 药盘高度（世界）
      // 机位放在机器人斜上方（客厅沙发与茶几之间没有落脚点，只能俯看）
      camCtl.dTarget.set(robot.pos.x + fx * .30, ty, robot.pos.z + fz * .30);
      // 侧上方俯看药盘（沙发与茶几之间只有头顶是空的）
      camCtl.dEye.set(robot.pos.x - rx * .85 + fx * .22, ty + 1.05, robot.pos.z - rz * .85 + fz * .22);
    } else {
      camCtl.dTarget.set(robot.pos.x, .80, robot.pos.z);
      camCtl.dEye.set(robot.pos.x + fx * 1.40 - rx * .50, 1.10, robot.pos.z + fz * 1.40 - rz * .50);
    }
  }
  function camUpdate(dt) {
    if (camCtl.auto) { camCtl.dEye = null; camCtl.eye = null; camCtl.follow = null; camCtl.dTheta += dt * .12; }
    if (camCtl.follow) updateFollow(1);
    camCtl.theta += (camCtl.dTheta - camCtl.theta) * Math.min(1, dt * 5.5);
    camCtl.phi += (camCtl.dPhi - camCtl.phi) * Math.min(1, dt * 5.5);
    camCtl.radius += (camCtl.dRadius - camCtl.radius) * Math.min(1, dt * 5.0);
    camCtl.target.lerp(camCtl.dTarget, Math.min(1, dt * 5.0));
    if (camCtl.dEye) {
      if (!camCtl.eye) camCtl.eye = camera.position.clone();
      camCtl.eye.lerp(camCtl.dEye, Math.min(1, dt * 3.4));
      camera.position.copy(camCtl.eye);
      camera.lookAt(camCtl.target);
    } else {
      const sp = Math.sin(camCtl.phi), r = camCtl.radius;
      camera.position.set(
        camCtl.target.x + r * sp * Math.sin(camCtl.theta),
        camCtl.target.y + r * Math.cos(camCtl.phi),
        camCtl.target.z + r * sp * Math.cos(camCtl.theta));
      camera.lookAt(camCtl.target);
    }
    if (Math.abs(camera.fov - camCtl.dFov) > .02) {
      camera.fov += (camCtl.dFov - camera.fov) * Math.min(1, dt * 4.2);
      camera.updateProjectionMatrix();
    }
  }

  /* ============================================================ 8. 交互 */
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const planeFloor = new T.Plane(new T.Vector3(0, 1, 0), -0.02);
  let dragging = null, downX = 0, downY = 0, downT = 0, moved = 0;
  const dom = renderer.domElement;
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    dragging = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    downX = e.clientX; downY = e.clientY; downT = performance.now(); moved = 0;
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener('pointerup', e => {
    try { dom.releasePointerCapture(e.pointerId); } catch (x) { }
    const wasDrag = dragging;
    dragging = null;
    if (wasDrag && moved < 6 && performance.now() - downT < 500) pick(e.clientX, e.clientY);
  });
  dom.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    moved += Math.abs(dx) + Math.abs(dy);
    downX = e.clientX; downY = e.clientY;
    if (dragging === 'orbit') {
      camCtl.dEye = null; camCtl.eye = null; camCtl.follow = null;
      camCtl.dTheta -= dx * .006;
      camCtl.dPhi = clampN(camCtl.dPhi - dy * .005, .05, Math.PI * .495);
      camCtl.auto = false;
    } else {
      const s = camCtl.dRadius * .0016;
      const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
      camCtl.dTarget.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    }
  });
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    camCtl.dEye = null; camCtl.eye = null;
    camCtl.dRadius = clampN(camCtl.dRadius * (1 + Math.sign(e.deltaY) * .09), .6, 70);
  }, { passive: false });

  function pick(cx, cy) {
    const r = dom.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // 先看有没有点到座位
    let bestSeat = -1, bestD = 1e9, hit = new T.Vector3();
    SEAT_BOX.forEach((b, i) => {
      const p = ray.ray.intersectBox(b, new T.Vector3());
      if (!p) return;
      const d = p.distanceTo(camera.position);
      if (d < bestD) { bestD = d; bestSeat = i; }
    });
    const fp = new T.Vector3();
    const hitFloor = ray.ray.intersectPlane(planeFloor, fp);
    const floorD = hitFloor ? fp.distanceTo(camera.position) : 1e9;
    if (bestSeat >= 0 && bestD < floorD + 0.6) { grannyGo(0, 0, bestSeat); return; }
    if (hitFloor) {
      const px = fp.x - OX, pz = fp.z - OZ;
      if (px > -.6 && px < W + .6 && pz > -.6 && pz < D + .6) grannyGo(fp.x, fp.z, -1);
    }
  }

  /* ============================================================== 9. UI */
  const uiState = { light: '日光', shadow: true, nav: false };
  const $ = id => document.getElementById(id);
  const placesBar = $('places');
  Object.keys(PLACES).forEach(k => {
    const b = document.createElement('button');
    b.textContent = k;
    b.onclick = () => {
      const p = PLACES[k];
      if (p.seat !== undefined) grannyGo(0, 0, p.seat);
      else { grannyGo(WX(p.stand[0]), WZ(p.stand[1]), -1); gr.pendingRot = p.rot; }
    };
    placesBar.appendChild(b);
  });
  const viewNames = Object.keys(VIEWS);
  [viewNames.slice(0, 3), viewNames.slice(3)].forEach((row, ri) => {
    const bar = $(ri === 0 ? 'views' : 'views2');
    row.forEach(k => {
      const b = document.createElement('button');
      b.textContent = k;
      if (k === '整户') b.classList.add('on');
      b.dataset.view = k;
      b.onclick = () => {
        flyTo(k);
        document.querySelectorAll('[data-view]').forEach(o => o.classList.remove('on'));
        b.classList.add('on');
      };
      bar.appendChild(b);
    });
  });
  const sceneBtns = $('sceneBtns');
  const btnLight = document.createElement('button'), btnShadow = document.createElement('button'),
    btnNav = document.createElement('button'), btnReset = document.createElement('button');
  btnLight.textContent = '光照：日光';
  btnShadow.textContent = '软阴影：开'; btnShadow.classList.add('on');
  btnNav.textContent = '导航网格';
  btnReset.textContent = '复位'; btnReset.classList.add('on');
  [btnLight, btnShadow, btnNav, btnReset].forEach(b => sceneBtns.appendChild(b));
  const LIGHTS = {
    '日光': () => { scene.environment = envRT.texture; sun.intensity = 2.35; sun.color.set(0xfff0d8); sun.position.set(-9, 13, -11); hemi.intensity = .72; renderer.toneMappingExposure = 1.06; interior.visible = false; interiorLights.forEach(l => l.intensity = l.userData.base); scene.background.set(0xd9d6d1); },
    '黄昏': () => { scene.environment = envRT.texture; sun.intensity = 2.30; sun.color.set(0xffc07a); sun.position.set(-15, 4.5, -3); hemi.intensity = .40; renderer.toneMappingExposure = 1.04; interior.visible = true; interiorLights.forEach(l => l.intensity = l.userData.base * .8); scene.background.set(0xcfc3b4); },
    '夜晚': () => { scene.environment = null; sun.intensity = .05; sun.color.set(0x8fa8cc); sun.position.set(-6, 12, -9); hemi.intensity = .06; renderer.toneMappingExposure = 1.12; interior.visible = true; interiorLights.forEach(l => l.intensity = l.userData.base * .5); scene.background.set(0x22262c); }
  };
  btnLight.onclick = () => {
    const ks = Object.keys(LIGHTS);
    uiState.light = ks[(ks.indexOf(uiState.light) + 1) % ks.length];
    LIGHTS[uiState.light]();
    btnLight.textContent = '光照：' + uiState.light;
  };
  btnShadow.onclick = () => {
    uiState.shadow = !uiState.shadow;
    renderer.shadowMap.enabled = uiState.shadow;
    scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    btnShadow.textContent = '软阴影：' + (uiState.shadow ? '开' : '关');
    btnShadow.classList.toggle('on', uiState.shadow);
  };
  btnNav.onclick = () => {
    uiState.nav = !uiState.nav;
    NAV.plane.visible = uiState.nav;
    btnNav.classList.toggle('on', uiState.nav);
  };
  btnReset.onclick = () => {
    gr.path = []; gr.state = 'stand'; gr.seat = -1; gr.pendingSeat = -1;
    gr.pos.set(WX(10.30), 0, WZ(6.60)); gr.rot = -.38;
    robot.wantServe = false; robot.path = []; robot.state = 'dock'; robot.rot = DOCK.rot;
    robot.pos.set(WX(DOCK.x), 0, WZ(DOCK.z)); robot.goalRot = undefined;
    Object.assign(grPose, POSE_IDLE);
    btnReset.classList.add('on');
    setTimeout(() => btnReset.classList.remove('on'), 320);
  };
  const statusEl = $('status'), statusTxt = $('statusTxt');
  function updateStatus() {
    const dx = robot.pos.x - gr.pos.x, dz = robot.pos.z - gr.pos.z;
    const d = Math.hypot(dx, dz);
    const isServe = robot.state === 'serve' || robot.state === 'transit';
    statusTxt.textContent = '王阿姨：' + grannyPlace() + ' · 机器人：' + (ROBOT_TXT[robot.state] || '待命') + ' · 距离 ' + d.toFixed(1) + ' m';
    statusEl.classList.toggle('serve', isServe);
  }

  /* ========================================================== 10. 主循环 */
  LIGHTS['日光']();
  rebuildShell(WH);
  const simClock = new T.Clock();
  let acc = 0;
  function step(dt) {
    updateGranny(dt);
    updateRobot(dt);
    camUpdate(dt);
    acc += dt;
    if (acc > .12) { acc = 0; updateStatus(); }
  }
  function tick() {
    const dt = Math.min(simClock.getDelta(), .05);
    step(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  // 默认取景：客厅（对齐参考图的初始画面）；首帧直接落位，避免从原点飞过去
  flyTo('客厅·电视墙');
  camCtl.target.copy(camCtl.dTarget);
  camCtl.eye = camCtl.dEye.clone();
  camera.position.copy(camCtl.dEye);
  camera.lookAt(camCtl.target);
  camera.fov = camCtl.dFov; camera.updateProjectionMatrix();
  document.querySelectorAll('[data-view]').forEach(o => o.classList.toggle('on', o.dataset.view === '客厅·电视墙'));
  updateStatus();
  step(1 / 60);
  tick();
  setTimeout(() => $('boot').classList.add('off'), 200);

  /* ==================================================== 11. 调试 / 截图接口 */
  window.SUITE = {
    scene: scene, camera: camera, renderer: renderer, robot: rb, granny: grRig,
    flyTo: flyTo, views: Object.keys(VIEWS),
    go: function (k) {
      const p = PLACES[k];
      if (!p) return false;
      if (p.seat !== undefined) grannyGo(0, 0, p.seat);
      else grannyGo(WX(p.stand[0]), WZ(p.stand[1]), -1);
      return true;
    },
    goTo: function (x, z, seat) { grannyGo(WX(x), WZ(z), seat === undefined ? -1 : seat); },
    sit: function (i) { grannyGo(0, 0, i); },
    serve: function () { startServe(); },
    robotState: function (s) {
      if (s === 'dock' || s === 'back') robotGoDock();
      else if (s === 'serve') { robot.state = 'serve'; robot.t = 0; robot.path = []; }
      else if (s === 'transit') startServe();
      return robot.state;
    },
    sim: function (sec) {                      // 确定性推进（截图用）
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
      renderer.render(scene, camera);
      return this.info();
    },
    info: function () {
      return {
        granny: { place: grannyPlace(), state: gr.state, seat: gr.seat, x: +(gr.pos.x - OX).toFixed(2), z: +(gr.pos.z - OZ).toFixed(2), rot: +gr.rot.toFixed(2) },
        robot: { state: robot.state, mode: screenState.mode, x: +(robot.pos.x - OX).toFixed(2), z: +(robot.pos.z - OZ).toFixed(2), trayZ: +rb.trayG.position.z.toFixed(3), door: +rb.st.door.toFixed(2) },
        light: uiState.light,
        camera: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2), view: activeView }
      };
    },
    setLight: function (k) { if (LIGHTS[k]) { uiState.light = k; LIGHTS[k](); btnLight.textContent = '光照：' + k; } return uiState.light; },
    navProbe: function (x, z) {
      const s = NAV.snap(x, z);
      return { ask: [+x.toFixed(2), +z.toFixed(2)], snap: [+s[0].toFixed(2), +s[1].toFixed(2)], moved: +Math.hypot(s[0] - x, s[1] - z).toFixed(2), cell: NAV.at(x, z) };
    },
    navStat: function () { return NAV.stat; },
    navAt: function (x, z) { return NAV.at(x, z); },
    nav: function (v) { uiState.nav = v === undefined ? !uiState.nav : !!v; NAV.plane.visible = uiState.nav; btnNav.classList.toggle('on', uiState.nav); return uiState.nav; }
  };
