# STATUS.md

> **当前进度板。** 任何改变状态或阻塞的改动都必须同步更新本文件（见 [AGENTS.md](AGENTS.md) 第 7 节）。
> 任务级真相在 [plan/tasks.yaml](plan/tasks.yaml)；本文件只记"现在到哪了、谁卡住了"。

**最后更新**：2026-10-03 ｜ **更新人**：H（队长）

---

## 当前里程碑

| | |
|---|---|
| **进行中** | `M1 p1-contract-scene` —— 契约冻结（v1.2）+ 3D 骨架可见 + Three.js 离线验证 |
| **状态** | **本地实现完成并自测通过**；等两件事：① 交叉验证（R↔S↔H，禁止自我验证）② `main` 推送（缺 GitHub 凭据） |
| **下一个** | `M2 p2-happy-path` —— 场景 1 端到端（到点 → 送达 → 提示 → 取走 → 日志） |
| **里程碑全表** | 见 [plan/tasks.yaml](plan/tasks.yaml) `milestones` |

> ⚠️ **M1 尚未打 tag**：DoD 第 ⑥ 条要求三线均已合入 `main`，第 ⑦ 条要求打 annotated tag + push。
> 当前代码在分支 `feat/p1-skeleton`，**未合并、未打 tag、未推送**——避免把一个未交叉验证的状态写成里程碑。

## 三线状态

| 线 | 名字 | 状态 | 当前在做 | 阻塞 |
|---|---|---|---|---|
| **H** | 人线（队长） | 🟢 P1 已交付 | 状态机 / 记录 / 升级 / 家属端 / 契约 v1.2 | 无 |
| **R** | 机器人线 | 🟢 P1 已交付 | `index.html` + 叠层 + 机器人本体 + 长者端面板 + 音频 | 无 |
| **S** | 场景线 | 🟢 P1 已交付 | 场景 / 房间 / 时钟 / 装配 + 调试抽屉 | 无 |

> P1 是一次**单人串行**实现（三线文件由同一执行者按契约写入）。这违反了"一个文件只有一个人改"的并行前提，
> 但**没有违反接口归属**：文件与契约一一对应，队员拿到分支后各自只改自己那条线的文件即可。
> 请 R 与 S 各自 review 自己线的文件（见下方"待交叉验证"）。

## P1 交付物（本地工作树）

| 线 | 文件 | 行数 | 说明 |
|---|---|---|---|
| R | `prototype/index.html` | 46 | 挂载点 `#scene` / `#hud` / `#family` / `#debug` / `#banner` + import map；内联 data URI favicon（避免 `/favicon.ico` 404） |
| R | `prototype/css/hud.css` | 610 | 适老化硬数值落地：正文 14.6:1、主色 4.8:1、最大字号 44px、点击目标 ≥60×60、行距 1.45 |
| R | `prototype/js/robot.js` | 164 | 圆柱底盘 + 方盒机身 + 药盘 + 发光环 + 屏幕脸；`update(state, dt)` 是 state 的纯函数 |
| R | `prototype/js/hud.js` | 243 | 长者端大字面板、药格灯（颜色 + 文字双编码）、一键确认、防重复 |
| R | `prototype/js/audio.js` | 108 | `speechSynthesis`（zh-CN，rate 0.85）+ 静默降级 + **520 Hz 低频提示音**（WebAudio 合成，无音频资产） |
| S | `prototype/js/scene3d.js` | 193 | 渲染循环 / 固定等距斜俯视 + 药盘特写两机位 / 光照 / WebGL 检测 / 场景 API；阴影默认关、pixelRatio ≤2 |
| S | `prototype/js/room.js` | 308 | 8m×6m 三个功能区 + 家具几何体；**路径点真相**（`WAYPOINTS` / `APPROACH_POINTS` / `DOCK`） |
| S | `prototype/js/scene2d.js` | 166 | 0 级降级：2D 俯视仿真，**与 3D 同一组场景 API** |
| S | `prototype/js/clock.js` | 103 | 演示时钟 1/60×/600×、直接设时钟、推进、复位；**不 import 任何模块**，仅内存 |
| S | `prototype/js/main.js` | 297 | 只做装配：订阅 → 各 `render/update`；视图路由 `?view=family`；调试抽屉（`` ` `` / Ctrl+Shift+D）；假数据种子；启动对账 |
| H | `prototype/js/store.js` | 316 | 唯一状态源：深度冻结快照、订阅、本地持久化、策略；`getState/subscribe/reset` 为 R/S 的开工入口 |
| H | `prototype/js/plan.js` | 114 | 计划录入 / 变更 / 有效期 / 暂停不删 / 时段冲突检测（只并列，不取舍） |
| H | `prototype/js/presence.js` | 66 | 在家 / 客厅 / 卧室 / 餐桌 / 出门 + 安静时段（含跨零点） |
| H | `prototype/js/schedule.js` | 128 | 到点判定与事件物化 + 跨天收口 + **启动对账** |
| H | `prototype/js/machine.js` | 188 | **唯一业务状态机**：转移表 1/2/3/4/7/8/10 + `activeEventId` 维护 + 防重复确认 |
| H | `prototype/js/log.js` | 102 | 追加式记录 + **双时间戳** + 时间线 + JSON 导出 |
| H | `prototype/js/escalate.js` | 144 | T+60s 换通道换措辞 → T+180s 通知家属（level 2）→ 冷却去重 → 三选项 → `skipped_known` |
| H | `prototype/js/family.js` | 245 | 家属端：计划录入/停用恢复、待处置通知三选项、时间线（只记事实）、导出 |
| H | `prototype/js/person.js` | 225 | 王阿姨：髋膝两段腿的坐/躺/站三态 + 位置跟随 state |
| S | `prototype/vendor/three/**` | 2.12 MB | three@0.186.1（`three.module.js` + `three.core.js` + LICENSE）；哈希见 [THIRD-PARTY.md](THIRD-PARTY.md) |
| 公共 | `LICENSE` / `THIRD-PARTY.md` | — | MIT 与第三方许可核查（P1 加入，与计划附录 A/C 一致） |

**合计**：19 个源文件 · 3,766 行（不含 vendored 依赖）。

## 自测记录（跑了什么、看到什么）

方法与工具：静态服务器 `python3 -m http.server 8000` + 无头 Chrome（CDP 驱动）自动走查；两个脚本：主链路走查 `walkthrough.mjs`、降级走查 `fallback.mjs`（均通过 CDP 逐条断言，非人工目测）。

| # | 验收点 | 结果 |
|---|---|---|
| 1 | 页面渲染出房间 / 机器人 / 王阿姨 / HUD | ✅ 截图见 CHANGELOG 的描述；无控制台异常 |
| 2 | Network 面板**零外部请求** | ✅ 全部请求只指向 `127.0.0.1:8000`（含 vendored three 两个文件） |
| 3 | 到点 → `notifying` + 置 `activeEventId` + `voice/v1` | ✅ |
| 4 | HUD 文案「药盒已放在托盘上」且**无补服/剂量/「已服下」** | ✅ 正则扫描通过 |
| 5 | 双时间戳（`occurredAtDemo` / `occurredAtReal`）齐备 | ✅ |
| 6 | 点「已取走」→ `confirmed` + `method` + `confirmedAt` + 清 `activeEventId` | ✅ |
| 7 | 重复取药被拦截（`already_confirmed`，`attempts` 不变） | ✅ |
| 8 | T+60s：换通道 + 换措辞（`voice/v1 → screen/v2`，非原样重推） | ✅ |
| 9 | T+180s：家属端收到 level 2 通知「20:00 的 华法林 未确认，已提醒 2 次」 | ✅ |
| 10 | 通知文本零补服/剂量/依从性内容 | ✅ |
| 11 | 家属端渲染（计划表单、三选项、时间线） | ✅ |
| 12 | **断网后仍可交互并落库**（CDP 模拟 offline，点「她出门了」→ `skipped_known`） | ✅ |
| 13 | 断网时家属端提示「离线中，记录保存在本机」 | ✅ |
| 14 | 运行期异常 / 控制台 error | ✅ **零** |
| 15 | **0 级降级**：屏蔽 WebGL 后自动切 2D 俯视，闭环（到点 → 提示 → 取走 → 已记录）照常，且顶栏明示降级 | ✅ |
| 16 | 适配对比度实测：正文 14.76:1、次要 7.89:1、主色 4.67:1、主按钮 4.67:1、警示 5.59:1、药格灯描边 4.56:1 | ✅ 全部达标 |
| 17 | `plan/tasks.yaml` 可解析（27 任务 / 8 里程碑） | ✅ |

**关于"断网刷新"的口径**：本项目用 `localhost` 静态服务器，DevTools 的 Offline 会连本地请求一并掐断，因此
"刷新仍可用"在**这台服务器的语义下**不成立；成立的是更实质的两条：**运行期零外部请求** + **加载完成后断网仍可交互与落库**。
演示时请**先加载页面再断网**；若需要"完全离线可打开"，把 `prototype/` 拷到本地用任意静态服务器起即可（无任何外部依赖）。

## 已知限制（M1 范围之外，已在 tasks.yaml 标注）

| 项 | 现状 | 归属阶段 |
|---|---|---|
| 路径仍是直线趋近 + 到点转向 | 未做 waypoint 折线拐点与缓动 | M2（`R3`） |
| `machine.js` 转移表 5/6 的措辞与间隔细化 | 已按 `EscalationPolicy` 实现，待逐条重放验证 | M2/M3（`H5`/`H7`） |
| 预录音频兜底 | 仅 `speechSynthesis` + 静默降级 | M3（`R5`） |
| 时间线**回放** | 现为日志列表 + JSON 导出（契约 §3.4 降级第 5 项） | M4/P5（`H8`） |
| 临时加药第 8 天自动失效 | `plan.expireTemporary` 已实现，未做界面演示动作 | M4（`H8`） |
| 多人同时在线调试 | 单机演示、无后端（红线：零网络请求） | 不做 |
| 相机为固定机位 | 等距主视角 + 药盘特写两档；无 OrbitControls | 计划内（降级第 1 项） |

## 阻塞与风险

| # | 事项 | 影响 | 处置 |
|---|---|---|---|
| 1 | **本机无 GitHub 凭据**（远端空仓 `liuchun878/elder-protecter` 已建好） | 代码推不上去；队员无法 clone，也就无法基于主仓开工 | 提供一次 PAT：`GITHUB_TOKEN=<PAT> bash scripts/publish.sh`，或放进 `.tools/github-token`（已 gitignore）由 H 执行 |
| 2 | 两条线的 GitHub 用户名未知 | `CODEOWNERS` 不生效，PR 不会自动请求 reviewer | 邀请队员后替换 `@TODO-R` / `@TODO-S` |
| 3 | **交叉验证环未执行**（禁止自我验证） | M1 的 DoD 第 ①、⑥ 条还不成立 | 见下方"待交叉验证"；三人各自 review 后合并到 `main` |
| 4 | P1 为单人串行实现 | 并行纪律未真正演练 | 从 M2 起按 H→R→S 顺序在各自分支上做，先跑一次真实合并 |
| 5 | 工作量仍超预算（≈69.5 人时 vs ≈44 人时） | 里程碑可能压线 | 按 tasks.yaml 的 `cut_first` 释放，**不靠加班** |

### 待交叉验证（M1 的验收口径）

| 验证人 | 对象 | 具体验什么 |
|---|---|---|
| **R** | S 的产物 | 离线加载：Network 面板零外部请求；`vendor/three` 两文件齐全、版本 0.186.1 |
| **S** | R 的产物 | 叠层对比度 ≥4.5:1、点击目标 ≥60×60、200% 缩放不裁切、界面**无「已服下」** |
| **H** | 契约 | 实现与 [契约-接口.md](契约-接口.md) v1.2 逐条自洽（命令签名、快照字段、转移表、空态） |
| **门禁** | 全员 | 由 **S** 执行：DoD 7 条逐条勾，再合 `main` + `git tag -a p1-contract-scene` |

## 本地怎么看

```bash
cd "/Users/liuchun/Downloads/机器人/prototype"
python3 -m http.server 8000
# 主屏（长者端 + 3D）：   http://localhost:8000/
# 副屏（家属端）：        http://localhost:8000/?view=family
# 调试抽屉：页面内按 ` 或 Ctrl/Cmd+Shift+D（默认隐藏）
```

演示初始态：演示时钟 `2026-10-03 07:50`，加速 60×（1 分钟 = 1 小时），王阿姨在客厅，机器人停在充电座；
假数据种子是 4 条计划 / 3 个时段（08:00 氨氯地平 5mg 饭后服、12:00 二甲双胍 0.5g 随餐、20:00 华法林 3mg、20:30 阿托伐他汀钙 20mg 睡前服）。

## 最近决定（decision log）

| 日期 | 决定 | 理由 |
|---|---|---|
| 2026-10-03 | 锁定 `three@0.186.1` 两文件 vendored，并记 sha256 | 只有 ES module 构建（`three.min.js` 404）；哈希可复核，避免"拿到的是不是同一份"说不清 |
| 2026-10-03 | 契约升 **v1.2**，**只加函数不改语义** | 冻结期规则；实测发现「人的位置」与「机器人停靠点」不是同一个点，必须分开成 `getWaypoint` / `getApproachPoint` |
| 2026-10-03 | 新增 **§5.1 启动对账** | 演示时钟仅内存、事件持久化，两者不对账会出现"时钟回到 07:50 却挂着上一轮未确认" |
| 2026-10-03 | 机器人停靠点从墙角挪到前景中央 | 固定机位下原位置被 HUD 面板完全遮挡，观众看不到"机器人在待命" |
| 2026-10-03 | 2D 降级不写字、也不承担对比度责任 | 适老化硬数值只能在 HTML/CSS 里逐条核验 |

## 下一步（按顺序）

1. **队长：发布主仓**（唯一硬阻塞）：`GITHUB_TOKEN=<PAT> bash scripts/publish.sh` → 邀请队员（Write）→ 替换 `CODEOWNERS` 占位。
2. **两线各 review 自己线**：R 验离线加载、S 验叠层适老化、H 验契约自洽（见上表）。
3. **合并 `feat/p1-skeleton` → `main`**，打 `p1-contract-scene` annotated tag，补 CHANGELOG（已预写，标注"未打 tag"需改为正式段）。
4. **M2 开工**：`R3` 路径折线 + `H5` 转移表细化 + `S5` 已就绪（装配已通），场景 1 端到端按验收脚本 5 步重放。
