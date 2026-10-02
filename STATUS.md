# STATUS.md

> **当前进度板。** 任何改变状态或阻塞的改动都必须同步更新本文件（见 [AGENTS.md](AGENTS.md) 第 7 节）。
> 任务级真相在 [plan/tasks.yaml](plan/tasks.yaml)；本文件只记"现在到哪了、谁卡住了"。

**最后更新**：2026-10-02 ｜ **更新人**：H（队长）

---

## 当前里程碑

| | |
|---|---|
| **进行中** | `M0.5 p0.5-parallel-ready` —— 契约冻结 + 三线归属 + agent 可读文档 + 仓库设置 |
| **下一个** | `M1 p1-contract-scene`（D1 09:30–13:00）：契约冻结 + 3D 骨架可见 + Three.js 离线验证 |
| **里程碑全表** | 见 [plan/tasks.yaml](plan/tasks.yaml) `milestones` |

## 三线状态

| 线 | 名字 | 状态 | 当前在做 | 阻塞 |
|---|---|---|---|---|
| **H** | 人线（队长） | 🟡 准备中 | 契约 v1.1 已冻结候选；等待 M1 开工 | 无 |
| **R** | 机器人线 | ⬜ 未开工 | — | **等 H0（命令接口空实现）** |
| **S** | 场景线 | ⬜ 未开工 | — | **等 H0** |

> **M1 开工的第一件事**：H 提交 `store.js` 的命令接口空实现（任务 `H0`）。R 与 S 依赖它才能并行，**不要等 H 把业务逻辑写完**。

## 仓库设置状态（队长）

| 事项 | 状态 |
|---|---|
| 本地 git 仓库 + `p0-baseline` / `p0.5-parallel-ready` 提交与 tag | ✅ 完成 |
| `origin` 指向 `https://github.com/liuchun878/elder-protecter.git` | ✅ 已完成配置 |
| **远端主仓已创建** | ✅ `liuchun878/elder-protecter`，**public**，默认分支 `main`，**体积 0 KB（空仓，未被 README 初始化）** —— 推送不会有历史冲突 |
| **本机 GitHub 凭据** | ❌ **无** —— 实测 `git credential fill` 失败：`credential.helper=osxkeychain` 已配置但 keychain 无条目；且无 `gh` CLI、无 SSH key。**这是当前唯一硬阻塞** |
| 推送 `main` + tags | ⬜ 待做 —— 只差凭据 |
| 邀请两位队员（Write 权限） | ⬜ 待做（推送后立刻做） |
| 替换 `CODEOWNERS` 里的 `@TODO-R` / `@TODO-S` | ⬜ 待做（**邀请后立刻做**） |
| 保护 `main`（PR + 1 approval） | ⬜ 推荐 |

**一条命令完成推送**（仓库已存在，脚本会跳过建仓直接推）：

```bash
cd "/Users/liuchun/Downloads/机器人"
GITHUB_TOKEN=<你的PAT> bash scripts/publish.sh
```

## 阻塞与风险

| # | 事项 | 影响 | 处置 |
|---|---|---|---|
| 1 | **本机无 GitHub 凭据**（远端仓库已建好，是唯一剩下的阻塞） | 内容推不上去；**队员无法 clone，也就无法基于主仓开工** | 提供一次 PAT：`GITHUB_TOKEN=<PAT> bash scripts/publish.sh`，或把 PAT 放进 `.tools/github-token`（已 gitignore）由 H 执行 |
| 2 | 两条线的 GitHub 用户名未知 | `CODEOWNERS` 不生效，PR 不会自动请求 reviewer | 邀请队员后替换占位 handle |
| 3 | R 与 S 在 `H0` 之前无法真正开工 | 并行会被推到下午 | `H0` 必须在 D1 上午最前面完成；若延后，R/S 先写接入代码 + 假数据自测，**不空等** |
| 4 | 工作量超预算（明细 ≈69.5 人时 vs 两天可用 ≈44 人时） | 里程碑可能压线 | 由每人的「最先砍」清单释放（见 tasks.yaml 的 `cut_first`），**不靠加班** |

## 最近决定（decision log）

| 日期 | 决定 | 理由 |
|---|---|---|
| 2026-10-02 | 呈现形态 = 3D 仿真场景（Three.js，vendored） | 用户选定；离线优先要求本地 vendor |
| 2026-10-02 | 仿真层与功能层解耦，3D 可整体降级为 2D | 两天内敢用 3D 的前提；保功能不失 |
| 2026-10-02 | 分工按**产出**切为 R 机器人 / S 场景 / H 人 | 用户选定；每条线对应演示里的一个角色 |
| 2026-10-02 | 闭环**按环节**落到三条线（11 个环节全部有主责） | 防止"按角色切"导致没人拥有闭环（报告第 08 章警告的失败模式） |
| 2026-10-02 | 业务状态机只由 H 写；机器人行为是 state 的纯函数 | 两套状态机必然漂移 |
| 2026-10-02 | 合并顺序 H → R → S；门禁 S；契约变更由 H 发起 | 依赖单向，装配层最后；职责分开避免自验 |

## 下一步（按顺序）

1. **队长：发布主仓**（这是当前唯一的硬阻塞，队员在它完成前无法 clone）：
   ```bash
   cd "/Users/liuchun/Downloads/机器人"
   GITHUB_TOKEN=<你的PAT> bash scripts/publish.sh
   ```
   成功后到 **Settings → Collaborators** 邀请两位队员（Write 权限），并把 [CODEOWNERS](CODEOWNERS) 的 `@TODO-R` / `@TODO-S` 换成真实用户名。
2. 三人一起 review [契约-接口.md](契约-接口.md)，Day 1 11:00 正式冻结
3. M1 开工：**H 先交 `H0`（命令接口空实现）**，R 与 S 立即并行
