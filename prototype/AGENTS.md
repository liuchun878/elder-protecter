# prototype/AGENTS.md

> 进入 `prototype/` 目录时自动生效的更具体规则。**与根 [AGENTS.md](../AGENTS.md) 冲突时以本文件为准**；与 [契约-接口.md](../契约-接口.md) 冲突时**以契约为准**。

这里是 3D 仿真原型的全部代码。**零构建、零依赖、离线优先。**

---

## 1 · 模块清单与归属

**一个文件只有一条线能改。** 不要动不属于你的文件。

| 文件 | 线 | 职责 | 可 import |
|---|---|---|---|
| `store.js` | **H** | 状态容器 + `subscribe/getState/reset`；**唯一状态源** | 无 |
| `plan.js` | **H** | 服药计划（录入/变更/有效期/暂停不删） | `store.js` |
| `presence.js` | **H** | 人的状态：在家/客厅/卧室/出门/安静时段 + **`seat` 落座点**（v1.6：`setSeat/clearSeat/zoneAt`） | `store.js` |
| `schedule.js` | **H** | 到点判定：计划 × 时钟 × 在场 × 安静时段 | `store.js` |
| `machine.js` | **H** | **唯一业务状态机**（S0–S3 + 异常分支） | `store.js` |
| `log.js` | **H** | 追加式事件日志 + **双时间戳** + 导出 | `store.js` |
| `escalate.js` | **H** | 升级链路：T+60s 换通道、T+180s 通知家属、冷却去重、三选项 | `store.js` |
| `family.js` | **H** | 家属端视图（副屏） | `store.js` + 命令 |
| `person.js` | **H** | 王阿姨：3D 人形 + 位置姿态跟随 state；**v1.6：任意落座点（家具按 `surfaceY` 反解坐姿，地板走 `FLOOR_SIT`）** | `store.js` + 场景 API + `textures.js` |
| `robot.js` | **R** | 机器人本体 + 行为动画（**state 的纯函数**）：**v1.8 按参考图重做**（回转体蛋形机身 0.71 m + 顶部前倾平板屏 + **正面抽屉式药盘**）；有 `presence.seat` 就感应前往（光锥）；回桩充电呼吸 | `store.js`（只读）+ `textures.js` |
| `hud.js` | **R** | 长者端面板（大字 + 药格灯 + 一键确认 + 防重复） | `store.js`（只读）+ 命令 |
| `audio.js` | **R** | 语音 `speechSynthesis` + 预录音频兜底 + 低频提示音 + 灯效 | 无 |
| `scene3d.js` | **S** | 场景、相机、光照（ACES + 软阴影 + IBL）、渲染循环、场景 API；**v1.7：导航网格与 `findPath`、`pick/enablePick`、室内暖光两档、机位改到套房** | `store.js`（只读）+ `textures.js` + `suite-textures.js` + `room.js` + `navgrid.js` |
| `textures.js` | **S** | **程序化贴图**（木地板/墙面/布纹/石材/窗外城市）+ **法线贴图 + 粗糙度贴图 + 光柱贴图** + 环境光照场景；零外部资产、确定性 | 只有 `three` |
| `room.js` | **S** | **suite-3d 套房户型**（13.4×10.6 m / 10 房间 / 墙体+门窗洞口 / 家具布置 / 坐具元数据 / 导航墙段与家具占位 / 客厅电视旁的充电桩）+ 路径点真相（`WAYPOINTS`/`APPROACH_POINTS`/`DOCK`） | `suite-textures.js` |
| `suite-textures.js` | **S** | 套房用的**程序化贴图**（木地板/石材/卫浴深色石材/布纹/灰泥/天空/花纹毯），固定 seed、零外部资产 | 只有 `three` |
| `navgrid.js` | **S** | **可通行网格 + A***：墙段（含门洞）× 家具占位各外扩机身半径，8 邻域 + 禁止切角 + 拉直 | 无（纯数学，不 import three） |
| `scene2d.js` | **S** | **降级通道**：WebGL 不可用时的 2D 俯视仿真（**v1.6：同样支持点击落座**） | `store.js`（只读） |
| `clock.js` | **S** | 演示时钟（1 / 60× / 600×、设时钟、复位） | 无 |
| `controls.js` | **S** | **交互控制台**：把契约里已有的命令接到可见按钮上（时钟/位置/**点击落座**/机位/光照/闭环）+ 机器人视角回显；**不新增业务规则**；拍摄模式下不挂载 | 命令接口 + 场景 API |
| `suite.html` | **S** | **室内预览台**（独立页面，不进演示主链路）：自由视角 / 机位预设 / 日光·黄昏 / 导航网格开关 / 点哪坐哪；与主演示同一份模块 | 与 `main.js` 同级（只装配） |
| `main.js` | **S** | **只做装配**：订阅 → 调各 `render(state)` | 以上全部 |

---

## 2 · 依赖方向（破坏它就会出问题）

```
        store.js  (H)
            ▲
            │ 只读
   ┌────────┴────────┐
   │                 │
 plan/presence/    robot/hud      scene3d/room/clock
 schedule/machine  (R)           (S)
 log/escalate/family
 person  ────────────────▶ scene.addActor()  (S 提供)
            ▲
            │
        main.js  (S)  装配全部
```

- **H 永不 import R/S 的文件。** 这是「3D 可整体降级为 2D 而功能不减」的前提。
- **R 与 S 只读 `store.getState()`**，不得直接改 state；写操作一律走契约的命令函数。
- **`robot.js` 不许有自己的业务状态机**：`robot.update(state, dt)` 必须是纯函数。

---

## 3 · 命令入口

全部命令签名见 [契约-接口.md](../契约-接口.md) 第 3 节（及其 §3.1 场景 API）。

```js
store.subscribe(state => { hud.render(state); scene.render(state); robot.update(state, dt) })
store.getState()            // 只读快照
machine.confirm(eventId, 'tray_taken')
```

**表现层只能通过这两类接口与功能层通信**——不要自己读别人的内部变量。

---

## 4 · 运行

```bash
cd prototype
python3 -m http.server 8000     # 打开 http://localhost:8000/
```

**必须用静态服务器**：Three.js 只有 ES module 构建（`three.min.js` 已移除），`file://` 双击会被 CORS 拦截。
端口 **8000**，**不要占用 19387**（本机 DSH 界面端口）。

---

## 5 · 禁止事项

- ❌ 从 CDN / 外链引入任何东西（字体、模型、**贴图图片**）——**离线是红线**；
  贴图一律走 `textures.js` 在运行时用 Canvas 画出来（确定性、可复现）
- ❌ 引入 npm 包、打包器、构建步骤
- ❌ 修改 `vendor/three/**` 的内容（vendored 第三方，只读）
- ❌ 在 3D 场景里渲染文字——**所有文字走 HTML 叠层**（对比度/字号的适老化硬数值只能在 HTML/CSS 里核验）
- ❌ 界面出现「已服下」——只能是「已取走 / 已记录 / 未确认」
- ❌ 任何补服 / 剂量 / 相互作用建议；任何依从性评分或排名
- ❌ 摄像头画面；任何网络请求
- ❌ 写自己的业务状态机、绕过 `store` 改状态、改别人的文件
- ❌ 在交互控制台里新增业务规则（它只准转调契约命令）；❌ 在拍摄模式（`?film=1`）下挂载控制台或开启自由视角

## 6 · 降级开关（必须一直可用）

| 降级 | 触发 | 做法 |
|---|---|---|
| 3D → 2D | WebGL 不可用 / 掉帧 | 切到 `scene2d.js`，**功能一条不少** |
| 语音 → 大字 | 无中文 TTS | 静默降级为大字 + 低频音，**不弹错误窗** |
| 写实 → 性能不足 | 开软阴影后掉帧 | 调试抽屉的「阴影开关」直接关；贴图与几何不受影响 |
| 机器人 → 方块 | 时间不够 | 保留药盘抬升与行走，去掉细节 |

**降级不是失败**：表现层可变，功能层不可变。
