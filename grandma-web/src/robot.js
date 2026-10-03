/* =============================================================================
 * robot.js — 送药机器人伙伴（沿用参考照片的款式：
 *              白色圆角壳体 · 正面黑色玻璃屏 · 侧面橡木饰板 · 屏幕蓝光取药波纹
 *              · 抽出的灰色托盘上放着药盒与水杯）
 *
 * 它是一个"伙伴"：会转过来看老奶奶，也可以在跟随模式下跟在她身后。
 * ========================================================================== */
(function (global) {
  'use strict';
  const THREE = global.THREE;

  /* 屏幕画面：等待（三条竖杠）/ 取药（蓝色波纹）/ 完成（绿眼微笑）/ 熄屏 */
  function screenTexture(mode) {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S; c.height = S * 0.62;
    const x = c.getContext('2d');
    const W = c.width, H = c.height;
    x.fillStyle = '#05070c'; x.fillRect(0, 0, W, H);

    if (mode === 'logo') {
      x.fillStyle = 'rgba(120,170,255,.85)';
      for (let i = 0; i < 3; i++) x.fillRect(W / 2 - 30 + i * 26, H / 2 - 26, 14, 52);
    } else if (mode === 'ask') {
      // 蓝色同心波纹（照片里屏幕上的取药提示）
      x.strokeStyle = 'rgba(90,160,255,.95)';
      for (let i = 0; i < 3; i++) {
        x.lineWidth = 7 - i * 1.6;
        x.beginPath();
        x.arc(W / 2, H / 2 + 26, 18 + i * 22, -Math.PI * 0.78, -Math.PI * 0.22);
        x.stroke();
      }
      x.fillStyle = 'rgba(150,200,255,.9)';
      x.beginPath(); x.arc(W / 2, H / 2 + 48, 9, 0, Math.PI * 2); x.fill();
    } else if (mode === 'ok') {
      x.fillStyle = '#6ee7a8';
      x.beginPath(); x.arc(W * 0.33, H * 0.42, 15, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(W * 0.67, H * 0.42, 15, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#6ee7a8'; x.lineWidth = 7; x.lineCap = 'round';
      x.beginPath(); x.arc(W / 2, H * 0.48, 30, Math.PI * 0.18, Math.PI * 0.82); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function build() {
    const root = new THREE.Group();
    root.name = '送药机器人';

    const MAT = {
      shell: new THREE.MeshStandardMaterial({ color: 0xecedee, roughness: 0.34, metalness: 0.03 }),
      shell2: new THREE.MeshStandardMaterial({ color: 0xf7f8f9, roughness: 0.18, metalness: 0.04 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.08, metalness: 0.4 }),
      wood: new THREE.MeshStandardMaterial({ color: 0xc39a67, roughness: 0.52 }),
      gray: new THREE.MeshStandardMaterial({ color: 0xb6bcc2, roughness: 0.42, metalness: 0.25 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 }),
      white: new THREE.MeshStandardMaterial({ color: 0xfbfcfd, roughness: 0.35 }),
      water: new THREE.MeshPhysicalMaterial({ color: 0xdfeef7, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.6 }),
      pillA: new THREE.MeshStandardMaterial({ color: 0xf6f7f9, roughness: 0.4 }),
      pillB: new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4 }),
      pillC: new THREE.MeshStandardMaterial({ color: 0x7fb2e5, roughness: 0.4 })
    };

    function add(geo, mat, x, y, z, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      (parent || root).add(m);
      return m;
    }

    /* 底座 + 万向轮 */
    const base = add(new THREE.CylinderGeometry(0.235, 0.245, 0.10, 32), MAT.dark, 0, 0.075, 0);
    add(new THREE.CylinderGeometry(0.252, 0.252, 0.045, 32), MAT.rubber, 0, 0.026, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      add(new THREE.SphereGeometry(0.045, 14, 10), MAT.rubber, Math.cos(a) * 0.16, 0.038, Math.sin(a) * 0.16);
    }

    /* 躯干：圆角柱体，侧面嵌橡木饰板 */
    const bodyH = 0.78;
    const body = add(new THREE.CylinderGeometry(0.245, 0.235, bodyH, 40, 1), MAT.shell, 0, 0.125 + bodyH / 2, 0);
    [-1, 1].forEach(function (s) {
      const panel = add(new THREE.BoxGeometry(0.035, 0.44, 0.30), MAT.wood, s * 0.238, 0.60, 0);
      panel.rotation.z = 0;
    });
    add(new THREE.CylinderGeometry(0.248, 0.248, 0.03, 40), MAT.shell2, 0, 0.125 + bodyH, 0);   // 顶面

    /* 正面屏幕：黑色玻璃 + 发光画面 */
    const screenGroup = new THREE.Group();
    screenGroup.position.set(0, 0.86, -0.20);
    root.add(screenGroup);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.10), MAT.glass);
    bezel.castShadow = true;
    screenGroup.add(bezel);
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.30, 0.19),
      new THREE.MeshBasicMaterial({ map: screenTexture('ask'), toneMapped: false })
    );
    scr.position.z = -0.052;
    scr.rotation.y = Math.PI;
    screenGroup.add(scr);

    // 屏幕辉光（夜里会照亮前方地面）
    const glow = new THREE.PointLight(0x63a8ff, 1.5, 2.4, 2.0);
    glow.position.set(0, 0.86, -0.32);
    root.add(glow);

    /* 顶部感知小塔 */
    add(new THREE.CylinderGeometry(0.10, 0.115, 0.05, 24), MAT.shell2, 0, 1.13, 0);
    add(new THREE.CylinderGeometry(0.062, 0.062, 0.07, 24), MAT.gray, 0, 1.18, 0);
    const cam = add(new THREE.CylinderGeometry(0.040, 0.040, 0.03, 20), MAT.glass, 0, 1.22, -0.02);
    cam.rotation.x = Math.PI / 2;

    /* 托盘（抽出的送药盘） */
    const tray = new THREE.Group();
    tray.position.set(0, 0.70, -0.30);
    root.add(tray);
    const trayTop = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.028, 0.30), MAT.gray);
    trayTop.castShadow = true; trayTop.receiveShadow = true;
    tray.add(trayTop);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.025, 0.012), MAT.gray);
        lip.position.set(0, 0.026, sz * 0.15); tray.add(lip);
      });
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.30), MAT.gray);
      lip.position.set(sx * 0.22, 0.026, 0); tray.add(lip);
    });

    // 药盒 + 药片（照片里托盘上的白色分格药盒）
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.135), MAT.pillA);
    box.position.set(-0.085, 0.032, 0.03);
    box.castShadow = true; tray.add(box);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.009, 14), (i + j) % 2 ? MAT.pillB : MAT.pillC);
        p.position.set(-0.085 - 0.070 + i * 0.046, 0.054, 0.03 - 0.033 + j * 0.066);
        tray.add(p);
      }
    }
    // 开启的盒盖
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.010, 0.135), MAT.pillA);
    lid.position.set(-0.085, 0.055, 0.115);
    lid.rotation.x = -1.15;
    tray.add(lid);
    // 水杯（半杯水）
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.105, 22, 1, true), MAT.pillA);
    cup.position.set(0.125, 0.068, -0.01); tray.add(cup);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.034, 0.065, 22), MAT.water);
    water.position.set(0.125, 0.048, -0.01); tray.add(water);

    /* 接口/散热细节 */
    add(new THREE.BoxGeometry(0.12, 0.02, 0.02), MAT.dark, 0, 0.22, 0.238);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(0.16, 0.012, 0.012), MAT.dark, 0, 0.30 + i * 0.035, 0.242);
    }

    /* 状态灯环 */
    const ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.20, 0.008, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x8fd0ff, toneMapped: false })
    );
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.135;
    root.add(ringMesh);

    root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    return {
      root: root,
      screen: scr,
      glow: glow,
      ring: ringMesh,
      setScreen: function (mode) {
        scr.material.map = screenTexture(mode);
        scr.material.needsUpdate = true;
        this.mode = mode;
      },
      mode: 'ask',
      height: 1.24,
      radius: 0.34
    };
  }

  global.createRobot = function () { return build(); };
})(window);
