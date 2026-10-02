# CHANGELOG

按开发阶段记录，与 git tag 一一对应。

格式：`## <tag> — <日期> — <验收声明>`

---

## p0-baseline — 2026-10-02 — 仓库骨架与流程就位，尚无原型代码

- 初始化仓库：`README.md`、`CHANGELOG.md`、`.gitignore`、`scripts/push-stage.sh`
- 入库文档：
  - `仿真呈现与开发阶段计划.md`（任务梳理 WBS、仿真呈现规格、5 分钟演示时间轴、阶段 P0–P6、GitHub 规范）
  - `两天开发计划.md`（两天交付与验收基线；本轮修订技术栈与排期指向）
- 入库调研产物：`送药机器人调研报告.html`（v2）、`核验报告_法规与设计规范_子代理角度.md`、`verify_adherence_evidence.md`、`调研证据/`

### 本阶段作出并锁定的决定

- 呈现形态：**3D 居家仿真场景**（Three.js），主屏场景 + HTML 适老化叠层 + 副屏家属端
- 架构前提：**仿真层与功能层解耦**，3D 可随时降级为 2D 俯视仿真而功能不减
- 依赖：Three.js 全量 vendored（约 2.12 MB，两个文件），**无 CDN、零构建**；因只有 ES module，运行必须走静态服务器
- 仓库：`liuchun878/medbot-sim`（public），`main` + 阶段分支，每阶段一个 annotated tag

### 尚未包含

- 任何原型代码（P1 起）
- `契约-接口.md`（P1 冻结）
- `LICENSE` / `THIRD-PARTY.md`（P1 vendor 时加入）
