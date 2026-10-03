/* =============================================================================
 * main.js — 应用主程序
 *
 *   · 场景 / 渲染器 / 相机（自写轨道控制，无需 OrbitControls）
 *   · 点击地面 → 老奶奶走过去（射线拾取 + 转向 + 加减速 + 障碍绕行）
 *   · 目标点标记、目的地播报、步态音效、语音
 *   · 无障碍大字号 UI、快捷目的地、视角预设、光照档位
 *
 * 对外暴露 window.APP，便于自动化截图核验（只读，不参与玩法）。
 * ========================================================================== */
(function (global) {
  'use strict';
  const THREE = global.THREE;
  const doc = document;
  const QS = new URLSearchParams(global.location.search);
  const LOWSPEC = QS.has('low');          // ?low=1 → 关阴影降分辨率（老机器 / 无头软件渲染核验用）

  /* ============================================================ 基础三件套 */

  const canvasEl = doc.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: !LOWSPEC, powerPreference: 'high-performance' });
  renderer.setPixelRatio(LOWSPEC ? 1 : Math.min(global.devicePixelRatio || 1, 2));
  renderer.setSize(global.innerWidth, global.innerHeight, false);
  renderer.shadowMap.enabled = !LOWSPEC;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2436);

  const camera = new THREE.PerspectiveCamera(46, global.innerWidth / global.innerHeight, 0.05, 120);

  /* 环境光照渐变（天空）用雾来帮忙收敛远景 */
  const env = global.createEnvironment(scene);
  const grandma = global.createGrandma();
  scene.add(grandma.root);
  const robot = global.createRobot();
  scene.add(robot.root);

  /* 角色脚下的软阴影（补充 shadowMap，让人更"贴地"） */
  (function contactShadow() {
    const c = doc.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,.24)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.86),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = 2;
    grandma.root.add(m);
    grandma.root.traverse(function (o) { if (o.isMesh) o.castShadow = false; });
    // 只让主体投影，避免细件噪点
    grandma.root.traverse(function (o) {
      if (o.isMesh && o.geometry.type === 'CapsuleGeometry') o.castShadow = true;
    });
    grandma.shadowBlob = m;
  })();

  /* ============================================================ 状态 */

  const S = {
    pos: new THREE.Vector3(0.9, 0, 1.5),
    vel: 0,
    yaw: 0,                  // 初始面向房间内侧（-Z），镜头从身后看
    target: null,            // {x,z}
    targetName: '',
    maxSpeed: 0.92,
    arrivedAt: null,
    follow: true,
    voice: false,
    muted: false,
    bigText: false,
    moving: false,
    hold: false,             // 调试用：忽略目标、保持给定速度（截图核验走路姿态）
    totalDistance: 0,
    robotPos: new THREE.Vector3(1.9, 0, 1.9),
    robotYaw: Math.PI,
    robotVel: 0,
    robotCooldown: 0,
    stepPhase: 0
  };

  const HOME = { x: 0.9, z: 1.5 };

  /* 目的地：可点按钮，也用于"到了哪里"播报
     坐标都要落在"障碍圈之外"，否则会被推到附近、播报会张冠李戴 */
  const DESTINATIONS = [
    { key: 'sofa',   name: '沙发',   x: -1.35, z: -0.35, note: '坐下歇会儿' },
    { key: 'table',  name: '茶几',   x: 0.10,  z: 1.15,  note: '喝水吃药' },
    { key: 'plant',  name: '绿植',   x: 1.95,  z: 2.25,  note: '看看窗外' },
    { key: 'window', name: '窗边',   x: -0.90, z: 2.20,  note: '晒晒太阳' },
    { key: 'robot',  name: '取药机器人', x: 0.85, z: 2.45, note: '拿药' },
    { key: 'door',   name: '门口',   x: -2.75, z: 2.15,  note: '准备出门' },
    { key: 'home',   name: '屋子中间', x: 0.9, z: 1.5,   note: '回到中间' }
  ];

  /* ============================================================ 目标标记 */

  const marker = new THREE.Group();
  marker.visible = false;
  scene.add(marker);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.20, 0.26, 40),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false })
  );
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.position.y = 0.015;
  marker.add(markerRing);
  const markerRipple = markerRing.clone();
  markerRipple.material = markerRing.material.clone();
  markerRipple.material.opacity = 0.5;
  markerRipple.position.y = 0.014;
  marker.add(markerRipple);
  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0cf, transparent: true, opacity: 0.95, toneMapped: false })
  );
  markerDot.rotation.x = -Math.PI / 2;
  markerDot.position.y = 0.016;
  marker.add(markerDot);

  let markerT = 0;
  function showMarker(x, z) {
    marker.position.set(x, 0, z);
    marker.visible = true;
    markerT = 0;
  }

  /* ============================================================ 相机控制 */

  const cam = {
    yaw: Math.PI * 0.14,
    pitch: 0.34,
    dist: 4.3,
    target: new THREE.Vector3(S.pos.x, 1.0, S.pos.z),
    goalYaw: Math.PI * 0.14,
    goalPitch: 0.34,
    goalDist: 4.3,
    mode: 'follow'
  };

  const VIEWS = {
    follow: { yaw: Math.PI * 0.14, pitch: 0.34, dist: 4.3, mode: 'follow' },
    close:  { yaw: Math.PI * 0.14, pitch: 0.26, dist: 2.2, mode: 'follow' },
    top:    { yaw: Math.PI * 0.1, pitch: 1.05, dist: 6.2, mode: 'follow' },
    window: { yaw: 0.02, pitch: 0.24, dist: 4.4, mode: 'follow' },
    room:   { yaw: Math.PI * 0.30, pitch: 0.42, dist: 8.0, mode: 'overview' }
  };

  function setView(key) {
    const v = VIEWS[key] || VIEWS.follow;
    cam.goalYaw = v.yaw; cam.goalPitch = v.pitch; cam.goalDist = v.dist;
    cam.mode = v.mode;
    if (v.mode === 'room') { cam.target.set(0.1, 1.0, 1.0); }
    else if (v.mode === 'overview') { cam.target.set(S.pos.x, 0.95, S.pos.z); }
    else { cam.target.set(S.pos.x, 1.02, S.pos.z); }
  }

  /* ============================================================ 拾取 */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  const pickables = [];
  env.root.traverse(function (o) {
    if (o.isMesh && (o.name === '地板' || o.name === '地毯')) pickables.push(o);
  });
  if (!pickables.length) {
    env.root.traverse(function (o) { if (o.isMesh && o.name !== '环境') pickables.push(o); });
  }

  function pickGround(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (hits.length) return { x: hits[0].point.x, z: hits[0].point.z };
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) return { x: hitPoint.x, z: hitPoint.z };
    return null;
  }

  function nameNear(x, z) {
    let best = null, bestD = 1e9;
    for (const d of DESTINATIONS) {
      const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return bestD < 1.2 * 1.2 ? best : null;
  }

  /* ============================================================ 音效 */

  let audio = null;
  function ensureAudio() {
    if (!audio) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (AC) audio = new AC();
    }
    if (audio && audio.state === 'suspended') audio.resume();
    return audio;
  }

  function footstep() {
    if (S.muted || !audio) return;
    const t = audio.currentTime;
    const len = 0.14;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 3.2);
    }
    const src = audio.createBufferSource(); src.buffer = buf;
    const lp = audio.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 780;
    const g = audio.createGain(); g.gain.value = 0.16;
    src.connect(lp); lp.connect(g); g.connect(audio.destination);
    src.start(t);
  }

  function chime(up) {
    if (S.muted) return;
    const ac = ensureAudio(); if (!ac) return;
    const t = ac.currentTime;
    [0, 1].forEach(function (i) {
      const o = ac.createOscillator(); o.type = 'sine';
      const f = up ? (620 + i * 260) : (520 - i * 160);
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.10, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.34);
      o.connect(g); g.connect(ac.destination);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.36);
    });
  }

  /* ============================================================ 语音 */

  let voiceReady = false;
  function speak(text) {
    if (!S.voice || !text) return;
    const syn = global.speechSynthesis;
    if (!syn) return;
    try {
      syn.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 0.92; u.pitch = 1.0;
      const vs = syn.getVoices();
      const zh = vs.find(function (v) { return /zh|Chinese/i.test(v.lang + v.name); });
      if (zh) u.voice = zh;
      syn.speak(u);
      voiceReady = true;
    } catch (e) { /* 静默失败即可 */ }
  }

  /* ============================================================ UI */

  const ui = {};

  function buildUI() {
    const panel = doc.getElementById('panel');

    panel.innerHTML = [
      '<div class="panel-head">',
      '  <div class="ttl">控制台</div>',
      '  <button class="fold" id="fold" title="收起/展开">收起</button>',
      '</div>',

      '<div class="cap">去哪里走走？点一下就行</div>',
      '<div class="btns dest" id="destinations"></div>',

      '<div class="cap">视角</div>',
      '<div class="btns" id="views">',
      '  <button data-view="follow" class="on">跟随</button>',
      '  <button data-view="close">近看</button>',
      '  <button data-view="window">朝窗</button>',
      '  <button data-view="top">俯视</button>',
      '  <button data-view="room">看全景</button>',
      '  <button id="btnReset">复位</button>',
      '</div>',

      '<div class="cap">机器人</div>',
      '<div class="btns">',
      '  <button id="btnDeliver">送药过来</button>',
      '  <button id="btnFollow" class="on">跟在她身后</button>',
      '</div>',

      '<div class="cap">显示与朗读</div>',
      '<div class="btns">',
      '  <button id="btnBig">大字模式</button>',
      '  <button id="btnVoice">语音播报</button>',
      '  <button id="btnMute">脚步声</button>',
      '  <button id="btnHelp">怎么玩</button>',
      '</div>',

      '<div class="cap">光线</div>',
      '<div class="btns three" id="lights">',
      '  <button data-light="dusk" class="on">黄昏</button>',
      '  <button data-light="day">白天</button>',
      '  <button data-light="night">夜晚</button>',
      '</div>',

      '<div class="stat" id="stat"></div>'
    ].join('');

    // 目的地按钮
    const dbox = doc.getElementById('destinations');
    DESTINATIONS.forEach(function (d) {
      const b = doc.createElement('button');
      b.className = 'dest-btn';
      b.dataset.key = d.key;
      b.innerHTML = '<b>' + d.name + '</b><i>' + d.note + '</i>';
      b.addEventListener('click', function () { walkTo(d.x, d.z, d); });
      dbox.appendChild(b);
    });

    // 视角
    doc.getElementById('views').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'btnReset') { walkTo(HOME.x, HOME.z, DESTINATIONS[6]); setView('follow'); return; }
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      setView(b.dataset.view);
    });

    // 光照
    doc.getElementById('lights').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      applyLighting(b.dataset.light);
    });

    doc.getElementById('btnFollow').addEventListener('click', function () {
      S.follow = !S.follow;
      this.classList.toggle('on', S.follow);
      toast(S.follow ? '机器人会跟在她身后' : '机器人留在原地等她');
    });

    doc.getElementById('btnDeliver').addEventListener('click', deliver);
    doc.getElementById('btnBig').addEventListener('click', function () {
      S.bigText = !S.bigText;
      doc.body.classList.toggle('big', S.bigText);
      this.classList.toggle('on', S.bigText);
    });
    doc.getElementById('btnVoice').addEventListener('click', function () {
      S.voice = !S.voice;
      this.classList.toggle('on', S.voice);
      if (S.voice) { ensureAudio(); speak('语音播报已打开'); }
      toast(S.voice ? '语音播报：开' : '语音播报：关');
    });
    doc.getElementById('btnMute').addEventListener('click', function () {
      S.muted = !S.muted;
      this.classList.toggle('on', !S.muted);
      if (!S.muted) ensureAudio();
      toast(S.muted ? '脚步声：关' : '脚步声：开');
    });
    doc.getElementById('btnHelp').addEventListener('click', showWelcome);
    doc.getElementById('fold').addEventListener('click', function () {
      panel.classList.toggle('folded');
      this.textContent = panel.classList.contains('folded') ? '展开' : '收起';
    });

    ui.stat = doc.getElementById('stat');
    ui.panel = panel;
    doc.getElementById('btnMute').classList.add('on');
  }

  let toastTimer = null;
  function toast(text) {
    const el = doc.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function showWelcome() {
    doc.getElementById('welcome').classList.add('show');
  }
  function hideWelcome() {
    doc.getElementById('welcome').classList.remove('show');
  }

  /* ============================================================ 光照切换 */

  const cityTextures = {};
  function applyLighting(key) {
    env.setLighting(key);
    if (env.background !== undefined) scene.background = new THREE.Color(env.background);
    const sun = env.lights.sun;
    if (key === 'dusk') { sun.position.set(-1.0, 3.2, 9.0); }
    else if (key === 'day') { sun.position.set(0.5, 8.5, 8.0); }
    else { sun.position.set(-2.0, 2.4, 6.0); }
    // 窗外天色跟着变
    const mat = env.materials.city;
    if (!cityTextures[key]) {
      const c = doc.createElement('canvas');
      c.width = 8; c.height = 512;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 512);
      const cols = key === 'dusk' ? ['#28304e', '#8a6f8e', '#e8a877', '#f7d9a8']
        : key === 'day' ? ['#5b8fd6', '#8fc0ea', '#cfe4f5', '#e9f2f8']
          : ['#04070f', '#0a1226', '#16233d', '#1d2b45'];
      cols.forEach(function (col, i) { g.addColorStop(i / (cols.length - 1), col); });
      x.fillStyle = g; x.fillRect(0, 0, 8, 512);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      cityTextures[key] = t;
    }
    if (mat.__baseMap === undefined) mat.__baseMap = mat.map;
    mat.map = cityTextures[key];
    mat.needsUpdate = true;
    const cityMesh = scene.getObjectByName('环境');
    if (cityMesh) {
      cityMesh.traverse(function (o) {
        if (o.isMesh && o.material === mat) o.material = new THREE.MeshBasicMaterial({ map: cityTextures[key], color: key === 'night' ? 0x6a7a9a : 0xffffff });
      });
    }
  }

  /* ============================================================ 走动逻辑 */

  function walkTo(x, z, dest) {
    // 先看这个点能不能站：被家具推开太远说明就点在沙发上/柜子上
    const clamped = new THREE.Vector3(x, 0, z);
    env.clampToWalkable(clamped);
    const wallShift = Math.hypot(clamped.x - x, clamped.z - z);
    const resolved = clamped.clone();
    env.resolveObstacles(resolved, 0.32);
    const blocked = Math.hypot(resolved.x - clamped.x, resolved.z - clamped.z) > 0.35;
    const farOutside = Math.abs(x) > 4.6 || Math.abs(z) > 4.2;

    if (blocked || farOutside) {
      toast('那里有家具，老奶奶走不过去');
      speak('那边过不去');
      chime(false);
      return false;
    }

    S.target = { x: resolved.x, z: resolved.z };
    S.targetName = dest ? dest.name : '';
    showMarker(resolved.x, resolved.z);
    ensureAudio();
    const near = dest || nameNear(resolved.x, resolved.z);
    if (near) S.targetName = near.name;
    chime(true);
    if (wallShift > 0.30) toast('贴墙了，就在这儿停下');
    else if (S.targetName) speak('好的，我去' + S.targetName);
    return true;
  }

  function stopWalking(announce) {
    S.target = null;
    if (announce) toast('好，就站这儿');
  }

  function updateWalk(dt) {
    // ---- 目标与转向
    let desiredYaw = S.yaw;
    let speedTarget = 0;

    if (S.target) {
      const dx = S.target.x - S.pos.x;
      const dz = S.target.z - S.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.16) {
        S.target = null;
        S.arrivedAt = { t: performance.now(), name: S.targetName };
        onArrive();
      } else {
        // 前视点转向：朝"再往前一点的位置"而不是朝终点本身转，
        // 否则近处目标会产生方向不断变化的绕圈（实测会以 0.2 m/s 打转很久）
        const LEAD = 0.85;
        const ux = dx / d, uz = dz / d;
        const ahead = Math.min(d, LEAD);
        const lx = S.pos.x + ux * ahead, lz = S.pos.z + uz * ahead;
        desiredYaw = Math.atan2(-(lx - S.pos.x), -(lz - S.pos.z));
        const angle = wrap(desiredYaw - S.yaw);
        const maxTurn = 2.8 * dt;
        S.yaw += Math.max(-maxTurn, Math.min(maxTurn, angle));

        // 两段式：先转身（原地碎步），转过来再迈步；转身也计入步态相位
        if (Math.abs(angle) > 0.60) {
          speedTarget = 0;
          S.shuffleRate = Math.abs(Math.max(-maxTurn, Math.min(maxTurn, angle))) * 2.6;
        } else {
          speedTarget = S.maxSpeed;
        }
        if (d < 0.55) speedTarget *= Math.max(0.22, d / 0.55);   // 快到点自然减速
      }
    }

    S.vel += (speedTarget - S.vel) * Math.min(1, dt * 3.6);
    if (S.hold) S.vel = S.maxSpeed;                   // 调试用：保持走路姿态
    if (S.vel < 0.004) S.vel = 0;
    S.moving = S.vel > 0.05;

    // ---- 位移 + 碰撞
    if (S.vel > 0) {
      const dirX = -Math.sin(S.yaw), dirZ = -Math.cos(S.yaw);
      const nx = S.pos.x + dirX * S.vel * dt;
      const nz = S.pos.z + dirZ * S.vel * dt;
      S.totalDistance += Math.hypot(nx - S.pos.x, nz - S.pos.z);
      S.pos.x = nx; S.pos.z = nz;

      const before = { x: S.pos.x, z: S.pos.z };
      env.clampToWalkable(S.pos);
      env.resolveObstacles(S.pos, 0.30);
      // 撞墙/撞家具时把速度压下来，不要"贴脸磨蹭"
      if (Math.hypot(S.pos.x - before.x, S.pos.z - before.z) > 0.004) S.vel *= 0.55;
    }

    grandma.root.position.set(S.pos.x, 0, S.pos.z);
    S.yaw = wrap(S.yaw);                 // 归一化朝向，别让它无限增大
    grandma.root.rotation.y = S.yaw;
    // 落地脚步：步态相位每跨过 π 响一次（用相位差计数，低帧率也不会丢步）
    grandma.update(dt, { speed: S.vel, stepExtra: S.shuffleRate ? S.shuffleRate * dt : 0 });
    S.shuffleRate = 0;
    const ph = grandma.phase;
    if (S.moving) {
      const crossed = Math.floor(ph / Math.PI) - Math.floor(S.lastPhase / Math.PI);
      if (crossed > 0) { footstep(); S.stepPhase += crossed; }
    }
    S.lastPhase = ph;

    // 影子随速度微微缩小
    if (grandma.shadowBlob) {
      const k = 1 - 0.10 * Math.min(1, S.vel / S.maxSpeed);
      grandma.shadowBlob.scale.setScalar(k);
    }
  }

  function onArrive() {
    chime(false);
    const n = S.arrivedAt && S.arrivedAt.name;
    if (n) { toast('到' + n + '了'); speak('到了，' + n); }
    else { toast('到了'); speak('到了'); }
    if (robot && robot.setScreen) {
      robot.setScreen('ok');
      clearTimeout(onArrive._t);
      onArrive._t = setTimeout(function () { robot.setScreen('ask'); }, 2600);
    }
  }

  function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* ------------------------------------------------------ 机器人行为 */

  function updateRobot(dt) {
    const rp = S.robotPos;
    let tx = rp.x, tz = rp.z;
    let want = 0;

    if (S.robotCooldown > 0) {
      // 送药动画期间原地不动
      S.robotCooldown -= dt;
      robot.root.position.y = 0.012 * Math.sin(performance.now() / 260) * 0.0;
    } else if (S.follow) {
      const back = 1.45, side = 0.55;   // 跟在她斜后方，别挡住镜头
      tx = S.pos.x + Math.sin(S.yaw) * back - Math.cos(S.yaw) * side;
      tz = S.pos.z + Math.cos(S.yaw) * back + Math.sin(S.yaw) * side;
      const p = new THREE.Vector3(tx, 0, tz);
      env.clampToWalkable(p);
      env.resolveObstacles(p, 0.34);
      tx = p.x; tz = p.z;
      const d = Math.hypot(tx - rp.x, tz - rp.z);
      if (d < 0.06) want = 0;
      else if (d > 3.2) { rp.x = tx; rp.z = tz; }  // 被甩太远就"瞬移"归位，避免长距离追赶
      else want = Math.min(0.80, 0.20 + d * 0.55);
    }

    // 朝向：有位移朝运动方向，站定则面向老奶奶
    const dx = tx - rp.x, dz = tz - rp.z;
    const dist = Math.hypot(dx, dz);
    let gy;
    if (dist > 0.10) gy = Math.atan2(-dx, -dz);
    else gy = Math.atan2(-(S.pos.x - rp.x), -(S.pos.z - rp.z));
    S.robotYaw += wrap(gy - S.robotYaw) * Math.min(1, dt * 2.6);

    S.robotVel += (want - S.robotVel) * Math.min(1, dt * 2.8);
    if (S.robotVel < 0.01) S.robotVel = 0;
    if (S.robotVel > 0) {
      const ux = -Math.sin(S.robotYaw), uz = -Math.cos(S.robotYaw);
      rp.x += ux * S.robotVel * dt;
      rp.z += uz * S.robotVel * dt;
      env.clampToWalkable(rp);
      env.resolveObstacles(rp, 0.36);
    }
    // 不要和主人重叠
    const ddx = rp.x - S.pos.x, ddz = rp.z - S.pos.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd < 0.85) {
      if (dd < 1e-3) { rp.x += 0.9; }
      else { rp.x = S.pos.x + (ddx / dd) * 0.85; rp.z = S.pos.z + (ddz / dd) * 0.85; }
    }

    robot.root.position.set(rp.x, 0, rp.z);
    robot.root.rotation.y = S.robotYaw;
    if (robot.ring) {
      const t = performance.now() / 1000;
      const c = S.robotVel > 0.05 ? 0x8fd0ff : 0x6ee7a8;
      robot.ring.material.color.setHex(c);
      robot.ring.scale.setScalar(1 + 0.045 * Math.sin(t * 3.1));
      robot.ring.material.opacity = 0.6 + 0.35 * Math.sin(t * 3.1);
    }
    if (robot.glow) robot.glow.intensity = 1.2 + 0.5 * Math.sin(performance.now() / 700);
  }

  /* 送药：机器人开到老奶奶面前，递上托盘，屏幕转绿 */
  function deliver() {
    const px = S.pos.x + Math.sin(S.yaw) * -1.0;
    const pz = S.pos.z + Math.cos(S.yaw) * -1.0;
    const p = new THREE.Vector3(px, 0, pz);
    env.clampToWalkable(p); env.resolveObstacles(p, 0.34);
    S.robotCooldown = 2.6;
    S.follow = false;
    const btn = doc.getElementById('btnFollow');
    if (btn) btn.classList.remove('on');
    robot.setScreen('ok');
    ensureAudio(); chime(true);
    toast('机器人送药过来了');
    speak('药送来了，记得喝口水');

    const from = S.robotPos.clone();
    const t0 = performance.now(), dur = 1500;
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      S.robotPos.x = from.x + (p.x - from.x) * e;
      S.robotPos.z = from.z + (p.z - from.z) * e;
      const gy = Math.atan2(-(S.pos.x - S.robotPos.x), -(S.pos.z - S.robotPos.z));
      S.robotYaw = gy;
      if (k < 1) requestAnimationFrame(step);
      else {
        setTimeout(function () { robot.setScreen('ask'); }, 4200);
        setTimeout(function () { S.follow = true; if (btn) btn.classList.add('on'); }, 5200);
      }
    })();
  }

  /* ============================================================ 指针交互 */

  const canvasRect = function () { return renderer.domElement.getBoundingClientRect(); };

  let pointer = { down: false, id: null, x: 0, y: 0, moved: 0, time: 0, button: 0 };

  canvasEl.addEventListener('pointerdown', function (e) {
    if (e.button === 2) return;
    pointer.down = true; pointer.id = e.pointerId;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.moved = 0; pointer.time = performance.now();
    canvasEl.setPointerCapture(e.pointerId);
  });

  canvasEl.addEventListener('pointermove', function (e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer.moved += Math.abs(dx) + Math.abs(dy);
    if (pointer.moved > 6) {
      cam.goalYaw -= dx * 0.006;
      cam.goalPitch = Math.max(-0.15, Math.min(1.25, cam.goalPitch + dy * 0.005));
      cam.mode = cam.mode === 'room' ? 'room' : 'free';
      cam.userTurned = performance.now();
    }
    pointer.x = e.clientX; pointer.y = e.clientY;
  });

  function endPointer(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    pointer.down = false;
    const quick = performance.now() - pointer.time < 600;
    const still = pointer.moved < 8;
    var clicked = quick && still && e.type === 'pointerup';
    if (clicked) {
      const hit = pickGround(e.clientX, e.clientY);
      if (hit) {
        hideWelcome();
        walkTo(hit.x, hit.z, nameNear(hit.x, hit.z));
      }
    }
  }
  canvasEl.addEventListener('pointerup', endPointer);
  canvasEl.addEventListener('pointercancel', function (e) {
    if (e.pointerId === pointer.id) pointer.down = false;
  });
  canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvasEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    cam.goalDist = Math.max(1.6, Math.min(11, cam.goalDist * (1 + Math.sign(e.deltaY) * 0.10)));
  }, { passive: false });

  /* 双指缩放（触屏） */
  const touches = new Map();
  canvasEl.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      touches.set('d', Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    }
  }, { passive: true });
  canvasEl.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && touches.has('d')) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      cam.goalDist = Math.max(1.6, Math.min(11, cam.goalDist * (touches.get('d') / Math.max(1, d))));
      touches.set('d', d);
      pointer.moved = 999;
    }
  }, { passive: true });

  /* 键盘辅助 */
  global.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { stopWalking(true); }
    else if (e.key === '1') setView('follow');
    else if (e.key === '2') setView('front');
    else if (e.key === '3') setView('top');
    else if (e.key === '4') setView('room');
    else if (e.key === 'h' || e.key === 'H') showWelcome();
  });

  /* ============================================================ 相机更新 */

  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  /* 弹簧臂：从注视点向外逐步试探，遇到家具/墙体就把机位收近，避免相机穿进绿植或柜子 */
  const probe = new THREE.Vector3();
  function armLength(dirX, dirY, dirZ, want) {
    // 先把"房间边界"折算成允许的最大臂长（不能用事后夹取，否则相机会被夹到人身上）
    const L = env.walkArea;
    let maxByRoom = want;
    const padX = 0.30, padZ = 0.30;
    if (dirX > 1e-4) maxByRoom = Math.min(maxByRoom, (L.maxX - padX - cam.target.x) / dirX);
    if (dirX < -1e-4) maxByRoom = Math.min(maxByRoom, (L.minX + padX - cam.target.x) / dirX);
    if (dirZ > 1e-4) maxByRoom = Math.min(maxByRoom, (L.maxZ + 1.1 - cam.target.z) / dirZ);
    if (dirZ < -1e-4) maxByRoom = Math.min(maxByRoom, (L.minZ + padZ - cam.target.z) / dirZ);
    if (dirY > 1e-4) maxByRoom = Math.min(maxByRoom, (L.h - 0.12 - cam.target.y) / dirY);
    if (dirY < -1e-4) maxByRoom = Math.min(maxByRoom, (0.34 - cam.target.y) / dirY);
    let usable = Math.max(0.28, Math.min(want, maxByRoom * 0.96));

    const step = 0.14, pad = 0.26;
    for (let d = step; d <= usable; d += step) {
      probe.set(cam.target.x + dirX * d, cam.target.y + dirY * d, cam.target.z + dirZ * d);
      let hit = probe.y < 0.30;
      if (!hit) {
        for (let i = 0; i < env.obstacles.length; i++) {
          const o = env.obstacles[i];
          const dx = probe.x - o.x, dz = probe.z - o.z;
          if (dx * dx + dz * dz < (o.r + pad) * (o.r + pad) && probe.y < 1.8) { hit = true; break; }
        }
      }
      if (hit) { usable = Math.max(0.28, d - step); break; }
    }
    return usable;
  }

  /* 定点机位（如"看全景"）：按人物位置自动取一个过肩远景，保证人一定在画面里 */
  function fixedCamAt(px, py, pz, tx, ty, tz, dt) {
    const p = new THREE.Vector3(px, py, pz);
    env.clampToWalkable(p);
    for (let i = 0; i < env.obstacles.length; i++) {
      const o = env.obstacles[i];
      const dx = p.x - o.x, dz = p.z - o.z;
      const need = o.r + 0.34;
      if (dx * dx + dz * dz < need * need) p.y = Math.max(p.y, 1.95);
    }
    cam.yaw += wrap(Math.atan2(p.x - tx, p.z - tz) - cam.yaw) * Math.min(1, dt * 4.0);
    cam.pitch += (Math.atan2(p.y - ty, Math.hypot(p.x - tx, p.z - tz)) - cam.pitch) * Math.min(1, dt * 4.0);
    cam.target.x += (tx - cam.target.x) * Math.min(1, dt * 2.2);
    cam.target.y += (ty - cam.target.y) * Math.min(1, dt * 2.2);
    cam.target.z += (tz - cam.target.z) * Math.min(1, dt * 2.2);
    camPos.copy(p);
    camera.position.lerp(camPos, Math.min(1, dt * 5.0));
    camLook.copy(cam.target);
    camera.lookAt(camLook);
  }

  /* "看全景"：从当前朝向的后上方退开，机位与注视点都跟着人物走 */
  function updateOverview(dt) {
    const back = 5.0, up = 2.45;
    const bx = S.pos.x + Math.sin(S.yaw) * back;
    const bz = S.pos.z + Math.cos(S.yaw) * back;
    const look = new THREE.Vector3(S.pos.x, 0.95, S.pos.z);
    fixedCamAt(bx, up, bz, look.x, look.y, look.z, dt);
  }

  function updateCamera(dt) {
    if (cam.mode === 'manual') { camera.lookAt(camLook); return; }
    if (cam.mode === 'overview') {
      updateOverview(dt);
      return;
    }

    // 目标点：跟随模式锁在老奶奶身上（平滑），全景模式看房间中心
    let tx, ty, tz;
    if (cam.mode === 'room') { tx = 0.1; ty = 1.0; tz = 1.0; }
    else { tx = S.pos.x; ty = 1.02; tz = S.pos.z; }
    const k = cam.mode === 'room' ? 2.0 : 3.0;
    cam.target.x += (tx - cam.target.x) * Math.min(1, dt * k);
    cam.target.y += (ty - cam.target.y) * Math.min(1, dt * k);
    cam.target.z += (tz - cam.target.z) * Math.min(1, dt * k);

    cam.yaw += wrap(cam.goalYaw - cam.yaw) * Math.min(1, dt * 6.0);
    cam.pitch += (cam.goalPitch - cam.pitch) * Math.min(1, dt * 6.0);
    cam.dist += (cam.goalDist - cam.dist) * Math.min(1, dt * 5.0);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const dirX = Math.sin(cam.yaw) * cp;
    const dirZ = Math.cos(cam.yaw) * cp;
    const dirY = sp + 0.05;
    const d = armLength(dirX, dirY, dirZ, cam.dist);

    const x = cam.target.x + dirX * d;
    const z = cam.target.z + dirZ * d;
    const y = cam.target.y + dirY * d;

    camPos.set(x, y, z);
    camera.position.lerp(camPos, Math.min(1, dt * 8.5));
    // 兜底：任何情况下都不让相机待在绿植/柜子的碰撞圈里
    const guard = camera.position.clone();
    guard.y = 0;
    const before = { x: guard.x, z: guard.z };
    env.resolveObstacles(guard, 0.30);
    if (Math.abs(guard.x - before.x) + Math.abs(guard.z - before.z) > 1e-4) {
      const push = new THREE.Vector3(guard.x - before.x, 0, guard.z - before.z);
      camera.position.add(push);
    }
    camLook.copy(cam.target);
    camera.lookAt(camLook);
  }

  /* ============================================================ 主循环 */

  let last = performance.now();
  let statT = 0;

  function frame(now) {
    const raw = (now - last) / 1000;
    last = now;
    // 低帧率（老电脑、无独立显卡）时用子步进补足时间，避免"走得比时钟慢"
    let remaining = Math.min(0.30, raw);
    let guard = 0;
    while (remaining > 1e-4 && guard++ < 8) {
      const dt = Math.min(1 / 60, remaining);
      updateWalk(dt);
      updateRobot(dt);
      remaining -= dt;
    }
    updateCamera(Math.min(0.05, raw));

    // 目标标记动画：脉冲 + 扩散波纹，2.5 秒后淡出
    if (marker.visible) {
      markerT += Math.min(0.05, raw);
      const p = (markerT * 0.9) % 1;
      markerRipple.scale.setScalar(1 + p * 2.6);
      markerRipple.material.opacity = Math.max(0, 0.55 * (1 - p));
      markerRing.scale.setScalar(1 + 0.06 * Math.sin(markerT * 6.5));
      const fade = markerT > 2.0 ? Math.max(0, 1 - (markerT - 2.0) / 0.6) : 1;
      markerRing.material.opacity = 0.95 * fade;
      markerDot.material.opacity = 0.95 * fade;
      marker.visible = fade > 0.01;
    }

    // 机器人屏幕蓝光随画面呼吸
    renderer.render(scene, camera);

    // 状态面板（每 0.2 s 更新一次，别让它抖）
    statT += Math.min(0.05, raw);
    if (statT > 0.2 && ui.stat) {
      statT = 0;
      const near = nameNear(S.pos.x, S.pos.z);
      const where = near ? near.name + '附近' : '客厅里';
      ui.stat.innerHTML =
        '<div>位置：<b>' + where + '</b></div>' +
        '<div>状态：<b>' + (S.moving ? '正在走 · ' + (S.targetName || '新位置') : '站着休息') + '</b></div>' +
        '<div>已走：<b>' + S.totalDistance.toFixed(1) + ' 米</b></div>' +
        '<div>朝向：<b>' + Math.round(((S.yaw * 180 / Math.PI) % 360 + 360) % 360) + '°</b></div>';
    }
    requestAnimationFrame(frame);
  }

  /* ============================================================ 启动 */

  function resize() {
    const w = global.innerWidth, h = global.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  global.addEventListener('resize', resize);

  buildUI();
  applyLighting('dusk');
  grandma.root.position.set(S.pos.x, 0, S.pos.z);
  grandma.root.rotation.y = S.yaw;
  S.robotPos.set(S.pos.x + 1.35, 0, S.pos.z + 0.75);
  robot.root.position.copy(S.robotPos);
  setView('follow');
  resize();
  showWelcome();

  // 开场：老奶奶先自己走到窗边，让访客一眼看懂"点哪走哪"
  setTimeout(function () {
    if (!S.moved) walkTo(-0.55, 2.10, null);
  }, 1200);

  requestAnimationFrame(function (t) { last = t; frame(t); });

  /* 调试 / 自动化核验接口（只读或直接驱动状态，不影响正常玩法） */
  global.APP = {
    THREE: THREE, scene: scene, camera: camera, renderer: renderer,
    S: S, env: env, grandma: grandma, robot: robot,
    walkTo: function (x, z) { S.moved = true; walkTo(x, z, null); },
    setView: setView,
    stop: function () { stopWalking(false); },
    setLighting: applyLighting,
    /** 直接设定状态（截图用）：把角色放到某处、给定速度和朝向；速度>0 时锁定走路姿态 */
    pose: function (x, z, yaw, speed) {
      S.moved = true;
      S.target = null;
      S.pos.set(x, 0, z);
      S.yaw = yaw;
      S.hold = !!(speed && speed > 0);
      S.vel = speed || 0;
      grandma.root.position.set(x, 0, z);
      grandma.root.rotation.y = yaw;
      grandma.root.updateMatrixWorld(true);
      for (let i = 0; i < 20; i++) grandma.update(1 / 60, { speed: speed || 0 });
      return APP.info();
    },
    /** 骨架探针：各关节世界坐标 + 包围盒（核验比例/穿地） */
    rig: function () { return grandma.rig(); },
    /** 把关键关节投影成屏幕坐标（核验朝向/取景用） */
    screen: function () {
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      camera.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      function px(o) {
        o.updateWorldMatrix(true, false);
        v.setFromMatrixPosition(o.matrixWorld).project(camera);
        return [Math.round((v.x * 0.5 + 0.5) * w), Math.round((-v.y * 0.5 + 0.5) * h)];
      }
      const g = grandma;
      const nose = g.head.children.filter(function (c) {
        return c.geometry && c.geometry.type === 'SphereGeometry' && c.position.z < -0.08 && c.position.y < 0;
      })[0] || g.head;
      return {
        canvas: [w, h],
        nose: px(nose), head: px(g.head), neck: px(g.neck), hips: px(g.hips),
        footL: px(g.legs[0].ankle), footR: px(g.legs[1].ankle),
        wristL: px(g.arms[0].wrist), wristR: px(g.arms[1].wrist),
        shoulderL: px(g.arms[0].shoulder), shoulderR: px(g.arms[1].shoulder),
        eyeL: px(g.eyes[0]), eyeR: px(g.eyes[g.eyes.length - 1]),
        camPos: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)]
      };
    },
    setHold: function (on) { S.hold = !!on; if (!on) { S.target = null; S.vel = 0; } return S.hold; },
    /** 可达性自检：目的地与实际落点是否一致（会被家具推开就是不一致） */
    reachTest: function () {
      const out = [];
      for (let i = 0; i < DESTINATIONS.length; i++) {
        const d = DESTINATIONS[i];
        walkTo(d.x, d.z, d);
        const dx = S.target ? S.target.x - d.x : 99;
        const dz = S.target ? S.target.z - d.z : 99;
        out.push({ name: d.name, want: [d.x, d.z], got: S.target ? [+S.target.x.toFixed(3), +S.target.z.toFixed(3)] : null, shift: +Math.hypot(dx, dz).toFixed(3) });
      }
      stopWalking(false);
      return out;
    },
    /** 用画布坐标直接算一次拾取（等价于在该点点击地面），便于自动化核验 */
    rayAt: function (clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      const hit = pickGround(r.left + clientX, r.top + clientY);
      return hit ? { x: +hit.x.toFixed(3), z: +hit.z.toFixed(3), name: (nameNear(hit.x, hit.z) || {}).name || null } : null;
    },
    /** 把相机手动摆到某个位置（截图用） */
    look: function (px, py, pz, tx, ty, tz) {
      camera.position.set(px, py, pz);
      cam.target.set(tx, ty, tz);
      camLook.set(tx, ty, tz);
      cam.mode = 'manual';
      camera.lookAt(camLook);
      camera.updateMatrixWorld(true);      // 立刻生效，便于同帧内做投影核验
      return [px, py, pz, tx, ty, tz];
    },
    info: function () {
      return {
        pos: { x: S.pos.x, z: S.pos.z }, yaw: S.yaw, speed: S.vel,
        target: S.target, moving: S.moving, distance: S.totalDistance,
        lighting: env.currentLighting, robot: { x: S.robotPos.x, z: S.robotPos.z }
      };
    },
    /** 相机可观测性：机位、臂长、是否落在家具圈里 */
    camInfo: function () {
      const CP = camera.position;
      let inside = null;
      for (let i = 0; i < env.obstacles.length; i++) {
        const o = env.obstacles[i];
        const dx = CP.x - o.x, dz = CP.z - o.z;
        if (dx * dx + dz * dz < (o.r + 0.26) * (o.r + 0.26)) inside = o.name;
      }
      const cp = Math.cos(cam.pitch);
      return {
        camPos: [+CP.x.toFixed(2), +CP.y.toFixed(2), +CP.z.toFixed(2)],
        mode: cam.mode, dist: +cam.dist.toFixed(2), goalDist: +cam.goalDist.toFixed(2),
        yaw: +cam.yaw.toFixed(2), goalYaw: +cam.goalYaw.toFixed(2), pitch: +cam.pitch.toFixed(2),
        target: [+cam.target.x.toFixed(2), +cam.target.y.toFixed(2), +cam.target.z.toFixed(2)],
        arm: +armLength(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch) + 0.05, Math.cos(cam.yaw) * cp, cam.dist).toFixed(2),
        insideObstacle: inside,
        obstacles: env.obstacles.map(function (o) { return o.name + '(' + o.x.toFixed(2) + ',' + o.z.toFixed(2) + ',r' + o.r.toFixed(2) + ')'; })
      };
    }
  };
})(window);
