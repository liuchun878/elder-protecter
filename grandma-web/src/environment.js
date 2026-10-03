/* =============================================================================
 * environment.js — 居家客厅场景（参考照片：浅木地板 · 布艺沙发 · 大叶绿植 ·
 *                  落地窗外黄昏城市 · 暖光斜照）
 *
 * 除了好看，它还要给"点击走到"提供三样东西：
 *   walkArea  —— 可走范围（房间矩形 + 地毯）
 *   obstacles —— 圆柱体碰撞（沙发/茶几/柜子/绿植…），角色绕行
 *   lights    —— 三档光照（黄昏 / 白天 / 夜晚）
 * ========================================================================== */
(function (global) {
  'use strict';
  const THREE = global.THREE;

  /* ------------------------------------------------------------ 随机数 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------- 画布纹理 */
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c: c, x: c.getContext('2d') };
  }

  function tex(c, repX, repY, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repX || 1, repY || 1);
    t.anisotropy = 8;
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 木地板：横向长条 + 木纹 + 拼缝 */
  function woodFloorTexture() {
    const { c, x } = canvas(1024, 1024);
    const rnd = mulberry32(7);
    x.fillStyle = '#c9a276'; x.fillRect(0, 0, 1024, 1024);
    const rows = 8, rh = 1024 / rows;
    for (let r = 0; r < rows; r++) {
      // 每一行错缝拼接
      let px = -Math.floor(rnd() * 260);
      while (px < 1024) {
        const w = 220 + Math.floor(rnd() * 260);
        const base = 196 + Math.floor(rnd() * 26);
        x.fillStyle = 'rgb(' + base + ',' + Math.round(base * 0.80) + ',' + Math.round(base * 0.56) + ')';
        x.fillRect(px, r * rh, w, rh);
        // 木纹
        for (let g = 0; g < 26; g++) {
          const gy = r * rh + rnd() * rh;
          x.strokeStyle = 'rgba(120,84,50,' + (0.03 + rnd() * 0.07).toFixed(3) + ')';
          x.lineWidth = 0.6 + rnd() * 1.6;
          x.beginPath();
          x.moveTo(px, gy);
          x.bezierCurveTo(px + w * 0.3, gy + (rnd() - 0.5) * 9, px + w * 0.7, gy + (rnd() - 0.5) * 9, px + w, gy + (rnd() - 0.5) * 6);
          x.stroke();
        }
        // 拼缝
        x.strokeStyle = 'rgba(90,60,34,.35)'; x.lineWidth = 2;
        x.strokeRect(px, r * rh, w, rh);
        px += w;
      }
    }
    // 整体压一点光泽不均
    const g2 = x.createLinearGradient(0, 0, 1024, 1024);
    g2.addColorStop(0, 'rgba(255,236,200,.16)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0)');
    g2.addColorStop(1, 'rgba(120,90,60,.10)');
    x.fillStyle = g2; x.fillRect(0, 0, 1024, 1024);
    return c;
  }

  /* 地毯：暖灰底 + 细纹 + 边框 */
  function rugTexture() {
    const { c, x } = canvas(512, 512);
    const rnd = mulberry32(21);
    x.fillStyle = '#d9d2c6'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = 'rgba(' + (150 + Math.floor(rnd() * 60)) + ',' + (142 + Math.floor(rnd() * 54)) + ',' + (128 + Math.floor(rnd() * 50)) + ',.35)';
      x.fillRect(rnd() * 512, rnd() * 512, 2, 2);
    }
    x.strokeStyle = 'rgba(120,104,84,.45)'; x.lineWidth = 8;
    x.strokeRect(26, 26, 460, 460);
    x.strokeStyle = 'rgba(120,104,84,.25)'; x.lineWidth = 3;
    x.strokeRect(42, 42, 428, 428);
    return c;
  }

  /* 窗帘布纹 */
  function curtainTexture() {
    const { c, x } = canvas(256, 512);
    x.fillStyle = '#efe6d8'; x.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 256; i += 16) {
      const g = x.createLinearGradient(i, 0, i + 16, 0);
      g.addColorStop(0, 'rgba(255,255,255,.55)');
      g.addColorStop(0.5, 'rgba(210,196,175,.35)');
      g.addColorStop(1, 'rgba(255,255,255,.5)');
      x.fillStyle = g; x.fillRect(i, 0, 16, 512);
    }
    return c;
  }

  /* 窗外：黄昏天空 + 太阳 + 城市天际线（含窗内亮灯点） */
  function cityTexture() {
    const W = 2048, H = 1024;
    const { c, x } = canvas(W, H);
    const rnd = mulberry32(99);
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.00, '#3f4d78');
    sky.addColorStop(0.30, '#7d6d92');
    sky.addColorStop(0.52, '#d99a76');
    sky.addColorStop(0.68, '#f0b878');
    sky.addColorStop(0.80, '#f7d9a8');
    sky.addColorStop(1.00, '#f3c98d');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);

    // 云带
    for (let i = 0; i < 46; i++) {
      const cy = 120 + rnd() * 460, cw = 200 + rnd() * 700, ch = 10 + rnd() * 26;
      x.fillStyle = 'rgba(255,' + (222 + Math.floor(rnd() * 24)) + ',' + (196 + Math.floor(rnd() * 40)) + ',' + (0.08 + rnd() * 0.18).toFixed(2) + ')';
      x.beginPath(); x.ellipse(rnd() * W, cy, cw, ch, 0, 0, Math.PI * 2); x.fill();
    }
    // 太阳
    const sunX = W * 0.63, sunY = H * 0.70;
    const glow = x.createRadialGradient(sunX, sunY, 6, sunX, sunY, 420);
    glow.addColorStop(0, 'rgba(255,246,214,.98)');
    glow.addColorStop(0.12, 'rgba(255,228,168,.72)');
    glow.addColorStop(0.45, 'rgba(255,196,128,.24)');
    glow.addColorStop(1, 'rgba(255,180,120,0)');
    x.fillStyle = glow; x.beginPath(); x.arc(sunX, sunY, 420, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,252,238,.95)'; x.beginPath(); x.arc(sunX, sunY, 46, 0, Math.PI * 2); x.fill();

    // 远近两排楼
    function skyline(baseY, minH, maxH, color, count, alpha) {
      x.globalAlpha = alpha;
      for (let i = 0; i < count; i++) {
        const bw = 40 + rnd() * 130;
        const bh = minH + rnd() * (maxH - minH);
        const bx = rnd() * (W + 200) - 100;
        x.fillStyle = color;
        x.fillRect(bx, baseY - bh, bw, bh + 200);
        // 窗
        for (let wy = baseY - bh + 12; wy < baseY - 8; wy += 16) {
          for (let wx = bx + 8; wx < bx + bw - 8; wx += 14) {
            if (rnd() > 0.55) {
              const warm = rnd();
              x.fillStyle = warm > 0.5 ? 'rgba(255,214,150,.85)' : 'rgba(210,228,255,.6)';
              x.fillRect(wx, wy, 6, 8);
            }
          }
        }
        x.fillStyle = color;
      }
      x.globalAlpha = 1;
    }
    skyline(H * 0.86, 120, 430, '#8f8296', 26, 0.55);   // 远山/远楼（带雾）
    skyline(H * 0.92, 180, 520, '#5d5566', 22, 0.85);   // 近楼
    skyline(H, 90, 240, '#413c4a', 30, 1.0);            // 最前排

    // 地面雾
    const fog = x.createLinearGradient(0, H * 0.80, 0, H);
    fog.addColorStop(0, 'rgba(255,206,158,0)');
    fog.addColorStop(1, 'rgba(255,196,140,.55)');
    x.fillStyle = fog; x.fillRect(0, H * 0.80, W, H * 0.20);
    return c;
  }

  /* 布艺（沙发/靠垫） */
  function fabricTexture(hex, seed) {
    const { c, x } = canvas(256, 256);
    const rnd = mulberry32(seed);
    x.fillStyle = hex; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 14000; i++) {
      x.fillStyle = 'rgba(255,255,255,' + (rnd() * 0.10).toFixed(3) + ')';
      x.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
      x.fillStyle = 'rgba(0,0,0,' + (rnd() * 0.08).toFixed(3) + ')';
      x.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    return c;
  }

  /* 叶面（绿植） */
  function leafTexture() {
    const { c, x } = canvas(128, 256);
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#3f7a3a'); g.addColorStop(0.5, '#2f6630'); g.addColorStop(1, '#245227');
    x.fillStyle = g; x.fillRect(0, 0, 128, 256);
    x.strokeStyle = 'rgba(190,225,170,.5)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 256); x.stroke();
    for (let i = 0; i < 16; i++) {
      const y = 12 + i * 15;
      x.strokeStyle = 'rgba(200,232,180,.30)'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(64, y); x.lineTo(8, y + 16); x.stroke();
      x.beginPath(); x.moveTo(64, y); x.lineTo(120, y + 16); x.stroke();
    }
    return c;
  }

  /* 墙面：极淡的涂料颗粒 */
  function wallTexture() {
    const { c, x } = canvas(256, 256);
    const rnd = mulberry32(5);
    x.fillStyle = '#efe7db'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = 'rgba(190,178,160,' + (rnd() * 0.16).toFixed(3) + ')';
      x.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    }
    return c;
  }

  /* ------------------------------------------------------------ 构建体 */

  function build(scene) {
    const env = { obstacles: [], walkArea: null, lights: {}, anim: [] };
    const R = { minX: -3.5, maxX: 3.5, minZ: -3.0, maxZ: 3.0, h: 2.85 };
    env.walkArea = R;

    const T = {
      floor: tex(woodFloorTexture(), 3.5, 3.0),
      rug: tex(rugTexture(), 1, 1),
      wall: tex(wallTexture(), 3, 2),
      curtain: tex(curtainTexture(), 1, 1),
      city: tex(cityTexture(), 1, 1),
      leaf: tex(leafTexture(), 1, 1),
      sofa: tex(fabricTexture('#b9b3a6', 11), 4, 4),
      cushion: tex(fabricTexture('#c9c2b2', 13), 3, 3),
      woodDark: tex(woodFloorTexture(), 1, 1)
    };

    const MAT = {
      floor: new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.55, metalness: 0.0 }),
      rug: new THREE.MeshStandardMaterial({ map: T.rug, roughness: 0.95 }),
      wall: new THREE.MeshStandardMaterial({ map: T.wall, roughness: 0.94, color: 0xffffff }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 1.0 }),
      sofa: new THREE.MeshStandardMaterial({ map: T.sofa, roughness: 0.92 }),
      cushion: new THREE.MeshStandardMaterial({ map: T.cushion, roughness: 0.94 }),
      wood: new THREE.MeshStandardMaterial({ map: T.woodDark, color: 0xc79a63, roughness: 0.62 }),
      woodLt: new THREE.MeshStandardMaterial({ color: 0xd8b384, roughness: 0.6 }),
      frame: new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.14 }),
      city: new THREE.MeshBasicMaterial({ map: T.city }),
      plant: new THREE.MeshStandardMaterial({ map: T.leaf, roughness: 0.72, side: THREE.DoubleSide }),
      pot: new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.85 }),
      potIn: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1.0 }),
      curtain: new THREE.MeshStandardMaterial({ map: T.curtain, roughness: 0.95, side: THREE.DoubleSide }),
      shade: new THREE.MeshStandardMaterial({ color: 0xfbf1dc, roughness: 0.9, emissive: 0xffcf9a, emissiveIntensity: 0.25 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.7 }),
      screenOff: new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.2, metalness: 0.3 })
    };

    const root = new THREE.Group();
    root.name = '环境';
    scene.add(root);

    function mesh(geo, mat, cast, receive) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast !== false;
      m.receiveShadow = receive !== false;
      root.add(m);
      return m;
    }

    /* -------------------------------------------------------- 房间壳 */
    const floor = mesh(new THREE.PlaneGeometry(R.maxX - R.minX, R.maxZ - R.minZ), MAT.floor, false, true);
    floor.rotation.x = -Math.PI / 2;
    floor.name = '地板';

    const ceiling = mesh(new THREE.PlaneGeometry(R.maxX - R.minX, R.maxZ - R.minZ), MAT.ceiling, false, true);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = R.h;

    // 墙：只建三面（+Z 面留给落地窗），朝内
    const wallH = R.h, wt = 0.12;
    const wallBack = mesh(new THREE.BoxGeometry(R.maxX - R.minX + wt * 2, wallH, wt), MAT.wall, false, true);
    wallBack.position.set(0, wallH / 2, R.minZ - wt / 2);
    const wallL = mesh(new THREE.BoxGeometry(wt, wallH, R.maxZ - R.minZ), MAT.wall, false, true);
    wallL.position.set(R.minX - wt / 2, wallH / 2, 0);
    const wallR = wallL.clone(); wallR.position.x = R.maxX + wt / 2; root.add(wallR);

    // 踢脚线
    const skirtMat = MAT.frame;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(R.maxX - R.minX, 0.09, 0.02), skirtMat);
    skirt.position.set(0, 0.045, R.minZ + 0.011); root.add(skirt);
    const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, R.maxZ - R.minZ), skirtMat);
    skirtL.position.set(R.minX + 0.011, 0.045, 0); root.add(skirtL);
    const skirtR = skirtL.clone(); skirtR.position.x = R.maxX - 0.011; root.add(skirtR);

    /* ---------------------------------------------------- 落地窗 (+Z) */
    const winW = 4.7, winH = 2.35, sillY = 0.32;
    const winCx = -0.5;
    // 窗洞四周的墙
    const wallFront = new THREE.Group(); root.add(wallFront);
    function frontSlab(w, h, x, y) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, wt), MAT.wall);
      m.position.set(x, y, R.maxZ + wt / 2);
      m.receiveShadow = true;
      wallFront.add(m);
    }
    frontSlab((R.maxX - R.minX - winW) / 2 + 0.4, wallH, (R.minX + winCx - winW / 2) / 2 - 0.1, wallH / 2);
    frontSlab((R.maxX - R.minX - winW) / 2 + 0.4, wallH, (R.maxX + winCx + winW / 2) / 2 + 0.1, wallH / 2);
    frontSlab(winW, sillY, winCx, sillY / 2);
    frontSlab(winW, R.h - (sillY + winH), winCx, sillY + winH + (R.h - sillY - winH) / 2);

    // 玻璃 + 窗框
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), MAT.glass);
    glass.position.set(winCx, sillY + winH / 2, R.maxZ + 0.03);
    root.add(glass);
    const frameMat = MAT.frame;
    const fT = 0.07;
    [[0, winH / 2 + 0.01], [0, -winH / 2 - 0.01]].forEach(function (p) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(winW + fT * 2, fT, 0.10), frameMat);
      b.position.set(winCx, sillY + winH / 2 + p[1], R.maxZ + 0.02); root.add(b);
    });
    [-winW / 2, 0, winW / 2].forEach(function (dx) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(fT, winH, 0.10), frameMat);
      b.position.set(winCx + dx, sillY + winH / 2, R.maxZ + 0.02); root.add(b);
    });
    // 窗台板
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.3, 0.06, 0.30), MAT.woodLt);
    sill.position.set(winCx, sillY - 0.01, R.maxZ - 0.12);
    sill.castShadow = true; sill.receiveShadow = true; root.add(sill);

    // 窗外：城市背景板（放得远一点，营造纵深）
    const city = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), MAT.city);
    city.position.set(winCx * 0.5, 5.0, R.maxZ + 5.4);
    city.rotation.y = Math.PI;
    root.add(city);

    // 窗帘（左右各一幅 + 帘杆）
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, winW + 1.5, 12), MAT.metal);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(winCx, sillY + winH + 0.22, R.maxZ - 0.10);
    root.add(rod);
    [-1, 1].forEach(function (s) {
      const curt = new THREE.Mesh(new THREE.PlaneGeometry(0.95, winH + 1.05, 12, 1), MAT.curtain);
      const px = winCx + s * (winW / 2 + 0.30);
      curt.position.set(px, (winH + 1.05) / 2 + 0.10, R.maxZ - 0.16);
      curt.rotation.y = Math.PI;
      // 用手风琴式褶皱让布看起来有体积
      const pos = curt.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        pos.setZ(i, Math.sin(u * 11) * 0.045);
      }
      pos.needsUpdate = true;
      curt.geometry.computeVertexNormals();
      curt.castShadow = true;
      root.add(curt);
    });

    /* ------------------------------------------------------------ 地毯 */
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2), MAT.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.35, 0.006, 0.55);
    rug.receiveShadow = true;
    rug.name = '地毯';
    root.add(rug);

    /* ------------------------------------------------------------ 沙发 */
    // 参考照片：浅灰布艺三人沙发，靠 -Z 墙，面向窗
    const sofa = new THREE.Group();
    sofa.position.set(-1.35, 0, -2.05);
    root.add(sofa);
    function sofaPart(geo, mat, x, y, z) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      sofa.add(m);
      return m;
    }
    sofaPart(new THREE.BoxGeometry(2.62, 0.28, 0.92), MAT.sofa, 0, 0.22, 0);      // 底座
    sofaPart(new THREE.BoxGeometry(2.62, 0.52, 0.20), MAT.sofa, 0, 0.66, 0.36);   // 靠背
    sofaPart(new THREE.BoxGeometry(0.22, 0.40, 0.92), MAT.sofa, -1.31, 0.48, 0);  // 扶手
    sofaPart(new THREE.BoxGeometry(0.22, 0.40, 0.92), MAT.sofa, 1.31, 0.48, 0);
    [-0.86, 0, 0.86].forEach(function (x) {                                       // 坐垫
      sofaPart(new THREE.BoxGeometry(0.84, 0.17, 0.82), MAT.cushion, x, 0.44, -0.02);
    });
    [-0.78, 0.78].forEach(function (x) {                                          // 靠垫
      const c = sofaPart(new THREE.BoxGeometry(0.52, 0.46, 0.16), MAT.cushion, x, 0.70, 0.22);
      c.rotation.x = -0.18; c.rotation.z = x > 0 ? 0.06 : -0.06;
    });
    [-2.55, 2.55].forEach(function (x) {                                          // 脚
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.13, 10), MAT.wood);
      leg.position.set(x / 2 * 0.86, 0.065, 0.3); sofa.add(leg);
      const leg2 = leg.clone(); leg2.position.z = -0.3; sofa.add(leg2);
    });
    env.obstacles.push({ x: sofa.position.x, z: sofa.position.z, r: 1.55, name: '沙发' });
    env.sofa = sofa;

    /* ------------------------------------------------------------ 茶几 */
    const table = new THREE.Group();
    table.position.set(-0.55, 0, 0.62);
    root.add(table);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.06, 36), MAT.woodLt);
    top.position.y = 0.40; top.castShadow = true; top.receiveShadow = true; table.add(top);
    const topEdge = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.028, 8, 40), MAT.wood);
    topEdge.rotation.x = Math.PI / 2; topEdge.position.y = 0.40; table.add(topEdge);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.40, 10), MAT.wood);
      leg.position.set(Math.cos(a) * 0.40, 0.20, Math.sin(a) * 0.40);
      leg.rotation.z = -Math.cos(a) * 0.10; leg.rotation.x = Math.sin(a) * 0.10;
      leg.castShadow = true; table.add(leg);
    }
    env.obstacles.push({ x: table.position.x, z: table.position.z, r: 0.66, name: '茶几' });

    // 茶几上的东西：水杯 + 药盒（呼应"送药"主题）
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xeaf1f5, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.55 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.037, 0.11, 20, 1, true), cupMat);
    cup.position.set(-0.18, 0.485, 0.10); table.add(cup);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.035, 0.07, 20), new THREE.MeshPhysicalMaterial({ color: 0xdfeef7, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.6 }));
    water.position.set(-0.18, 0.465, 0.10); table.add(water);
    const pill = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.035, 0.115), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35 }));
    pill.position.set(0.22, 0.455, -0.04); pill.castShadow = true; table.add(pill);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.008, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf2c14e : 0x7fb2e5, roughness: 0.4 }));
        p.position.set(0.22 - 0.068 + i * 0.045, 0.474, -0.075 + j * 0.07);
        table.add(p);
      }
    }

    /* -------------------------------------------------- 大叶绿植（照片右侧） */
    function makePlant(x, z, scale, seed) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.scale.setScalar(scale);
      root.add(g);
      const rnd = mulberry32(seed || 3);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.36, 24), MAT.pot);
      pot.position.y = 0.18; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
      const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.03, 24), MAT.potIn);
      soil.position.y = 0.355; g.add(soil);
      // 主干
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.042, 0.95, 10), new THREE.MeshStandardMaterial({ color: 0x6d5540, roughness: 0.9 }));
      trunk.position.y = 0.80; trunk.castShadow = true; g.add(trunk);
      // 大叶片：椭圆面片绕主干分层排布
      const leafGeo = new THREE.PlaneGeometry(0.21, 0.38, 1, 4);
      const p = leafGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {              // 让叶片微微内凹
        const u = p.getX(i) / 0.105, v = (p.getY(i) + 0.19) / 0.38;
        p.setX(i, u * (0.55 + 0.45 * Math.sin(v * Math.PI)));
      }
      p.needsUpdate = true; leafGeo.computeVertexNormals();
      for (let i = 0; i < 24; i++) {
        const leaf = new THREE.Mesh(leafGeo, MAT.plant);
        const a = rnd() * Math.PI * 2;
        const h = 0.70 + rnd() * 0.95;
        const tilt = -0.80 + rnd() * 0.5;
        leaf.position.set(Math.cos(a) * 0.06, h, Math.sin(a) * 0.06);
        leaf.rotation.set(tilt, -a + Math.PI / 2, 0, 'YXZ');
        leaf.scale.setScalar(0.78 + rnd() * 0.5);
        leaf.castShadow = true;
        g.add(leaf);
      }
      env.obstacles.push({ x: x, z: z, r: 0.40 * scale, name: '绿植' });
      return g;
    }
    makePlant(3.00, 2.62, 0.95, 3);        // 照片里窗边那棵（贴窗角，不挡取景线）
    makePlant(-3.05, -1.85, 0.72, 8);      // 角落里一棵小的

    /* ---------------------------------------------------------- 边几 + 落地灯 */
    const sideT = new THREE.Group();
    sideT.position.set(1.95, 0, -2.15);
    root.add(sideT);
    const sideTop = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.05, 28), MAT.woodLt);
    sideTop.position.y = 0.54; sideTop.castShadow = true; sideTop.receiveShadow = true; sideT.add(sideTop);
    const sidePost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.52, 12), MAT.wood);
    sidePost.position.y = 0.27; sideT.add(sidePost);
    const sideBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.04, 24), MAT.wood);
    sideBase.position.y = 0.02; sideT.add(sideBase);
    // 台灯
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 18), MAT.metal);
    lampBase.position.y = 0.585; sideT.add(lampBase);
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.30, 10), MAT.metal);
    lampPole.position.y = 0.75; sideT.add(lampPole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.16, 0.20, 24, 1, true), MAT.shade);
    shade.position.y = 0.96; shade.castShadow = true; sideT.add(shade);
    const bulb = new THREE.PointLight(0xffcf96, 6.0, 6.0, 2.0);
    bulb.position.set(1.95, 0.92, -2.15);
    root.add(bulb);
    env.lights.lamp = bulb;
    env.obstacles.push({ x: 1.95, z: -2.15, r: 0.42, name: '边几' });

    /* ---------------------------------------------------------- 电视柜 + 屏幕 */
    const tv = new THREE.Group();
    tv.position.set(-3.42, 0, 0.30);
    root.add(tv);
    const tvBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.72, 0.03), MAT.dark);
    tvBody.position.set(0, 1.02, 0);
    tvBody.rotation.y = Math.PI / 2;
    tvBody.castShadow = true; tv.add(tvBody);
    const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.40), MAT.screenOff);
    tvScreen.position.set(0.02, 1.02, 0);
    tvScreen.rotation.y = Math.PI / 2;
    tv.add(tvScreen);
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 1.70), MAT.wood);
    cabinet.position.set(0, 0.21, 0); cabinet.castShadow = true; cabinet.receiveShadow = true; tv.add(cabinet);
    env.obstacles.push({ x: -3.30, z: 0.30, r: 0.62, name: '电视柜' });

    /* ---------------------------------------------------------- 书架 (+X 墙) */
    const shelf = new THREE.Group();
    shelf.position.set(3.32, 0, -0.55);
    root.add(shelf);
    const shBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.85, 1.30), MAT.woodLt);
    shBody.position.y = 0.93; shBody.castShadow = true; shBody.receiveShadow = true; shelf.add(shBody);
    for (let i = 0; i < 4; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.03, 1.26), MAT.wood);
      board.position.set(-0.02, 0.35 + i * 0.45, 0); shelf.add(board);
      // 书
      let z = -0.55;
      const rnd = mulberry32(40 + i);
      while (z < 0.5) {
        const bw = 0.03 + rnd() * 0.035, bh = 0.22 + rnd() * 0.09;
        const col = new THREE.Color().setHSL(0.05 + rnd() * 0.16, 0.35 + rnd() * 0.3, 0.32 + rnd() * 0.3);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, bh, bw), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
        b.position.set(-0.02, 0.365 + i * 0.45 + bh / 2, z + bw / 2);
        b.castShadow = true; shelf.add(b);
        z += bw + 0.004;
      }
    }
    env.obstacles.push({ x: 3.28, z: -0.55, r: 0.78, name: '书架' });

    /* ------------------------------------------------------- 门（-X 墙近窗侧） */
    const door = new THREE.Group();
    door.position.set(R.minX + 0.02, 0, 2.05);
    root.add(door);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.10, 0.88), new THREE.MeshStandardMaterial({ color: 0xdad2c4, roughness: 0.7 }));
    doorPanel.position.y = 1.05; door.castShadow = true; door.add(doorPanel);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.20, 1.00), MAT.frame);
    doorFrame.position.set(-0.02, 1.10, 0); door.add(doorFrame);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), MAT.metal);
    knob.position.set(0.08, 1.02, -0.34); door.add(knob);

    /* ------------------------------------------------------------ 挂画 */
    const art = new THREE.Group();
    art.position.set(-0.6, 1.72, R.minZ + 0.03);
    root.add(art);
    const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.62, 0.04), MAT.wood);
    art.add(artFrame);
    const artCanvas = document.createElement('canvas'); artCanvas.width = 256; artCanvas.height = 180;
    const ax = artCanvas.getContext('2d');
    const ag = ax.createLinearGradient(0, 0, 256, 180);
    ag.addColorStop(0, '#dfe6df'); ag.addColorStop(0.5, '#b9c8bd'); ag.addColorStop(1, '#8fa79b');
    ax.fillStyle = ag; ax.fillRect(0, 0, 256, 180);
    ax.fillStyle = 'rgba(80,96,88,.55)';
    ax.beginPath(); ax.moveTo(0, 150); ax.lineTo(70, 92); ax.lineTo(120, 132); ax.lineTo(180, 78); ax.lineTo(256, 140); ax.lineTo(256, 180); ax.lineTo(0, 180); ax.fill();
    ax.fillStyle = 'rgba(255,255,255,.5)'; ax.beginPath(); ax.arc(196, 46, 22, 0, Math.PI * 2); ax.fill();
    artCanvas.className = 'art';
    const artTex = new THREE.CanvasTexture(artCanvas);
    artTex.colorSpace = THREE.SRGBColorSpace;
    const artPic = new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.56), new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.9 }));
    artPic.position.z = 0.025; art.add(artPic);

    /* ------------------------------------------------------------ 灯光 */
    const hemi = new THREE.HemisphereLight(0xbcd2f0, 0xc9a97e, 0.55);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffc98a, 2.6);
    sun.position.set(-1.0, 3.6, 9.0);
    sun.target.position.set(-0.6, 0.7, -1.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 26;
    sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.022;
    scene.add(sun); scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.22);
    fill.position.set(-4, 3.2, -5); scene.add(fill);

    const roomLight = new THREE.PointLight(0xffe6c4, 3.0, 11, 2.0);
    roomLight.position.set(0.4, 2.5, 0.4);
    scene.add(roomLight);

    env.lights = { hemi: hemi, sun: sun, fill: fill, room: roomLight, lamp: bulb };

    const presets = {
      dusk: { hemi: 0.55, sun: 2.6, sunColor: 0xffc98a, fill: 0.22, room: 3.0, roomColor: 0xffe6c4, lamp: 6.0, bg: 0x1b2436, fog: 0.16 },
      day:  { hemi: 1.05, sun: 2.1, sunColor: 0xfff4e0, fill: 0.5,  room: 1.2, roomColor: 0xfff4e4, lamp: 0.0, bg: 0x2a3a52, fog: 0.06 },
      night:{ hemi: 0.20, sun: 0.25, sunColor: 0x9fb6d8, fill: 0.10, room: 3.4, roomColor: 0xffcf96, lamp: 9.0, bg: 0x0a1020, fog: 0.30 }
    };
    env.setLighting = function (key) {
      const p = presets[key] || presets.dusk;
      hemi.intensity = p.hemi;
      sun.intensity = p.sun;
      sun.color.setHex(p.sunColor);
      fill.intensity = p.fill;
      roomLight.intensity = p.room;
      roomLight.color.setHex(p.roomColor);
      bulb.intensity = p.lamp;
      MAT.shade.emissiveIntensity = key === 'night' ? 0.85 : 0.25;
      env.currentLighting = key;
      scene.fog = new THREE.Fog(p.bg, 12, 34);
      env.background = p.bg;
    };
    env.setLighting('dusk');

    env.root = root;
    env.materials = MAT;

    // 可走范围（留出贴墙的安全距离）
    env.clampToWalkable = function (v) {
      const pad = 0.45;
      v.x = Math.min(R.maxX - pad, Math.max(R.minX + pad, v.x));
      v.z = Math.min(R.maxZ - pad, Math.max(R.minZ + pad, v.z));
      return v;
    };

    // 圆障碍：把点推到障碍外圈
    env.resolveObstacles = function (v, radius) {
      const rr = radius || 0.30;
      for (let i = 0; i < env.obstacles.length; i++) {
        const o = env.obstacles[i];
        const dx = v.x - o.x, dz = v.z - o.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const need = o.r + rr;
        if (d < need) {
          if (d < 1e-4) { v.x = o.x + need; }
          else { v.x = o.x + (dx / d) * need; v.z = o.z + (dz / d) * need; }
        }
      }
      return v;
    };

    return env;
  }

  global.createEnvironment = function (scene) { return build(scene); };
})(window);
