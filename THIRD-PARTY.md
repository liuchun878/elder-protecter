# THIRD-PARTY.md · 第三方依赖与许可

> 本项目**零构建、零 npm 包、零 CDN**。唯一的第三方代码是本地 vendored 的 Three.js；
> **离线可用是红线**，因此所有依赖都必须落在仓库里，运行期不得发起任何外部请求。

核查时间 2026-10-03 ｜ 取数方式：unpkg 实测下载（HTTP 200）

## three.js

| 项 | 值 |
|---|---|
| 版本 | **0.186.1**（锁定，与 [仿真呈现与开发阶段计划.md](仿真呈现与开发阶段计划.md) 附录 C 的核查记录一致） |
| 许可 | MIT（`prototype/vendor/three/LICENSE`，`Copyright © 2010-2026 three.js authors`） |
| 入口文件 | `prototype/vendor/three/three.module.js`（662,772 B） |
| 依赖文件 | `prototype/vendor/three/three.core.js`（1,458,113 B）——`three.module.js` 内部 `from './three.core.js'`，同目录相对解析，**无需 import map 映射** |
| 来源 | `https://unpkg.com/three@0.186.1/build/three.module.js`、`.../build/three.core.js`、`.../LICENSE` |

### 校验值（sha256）

```
9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea  three.module.js
9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6  three.core.js
```

复核命令：

```bash
cd prototype/vendor/three && shasum -a 256 three.module.js three.core.js
```

### 为什么必须两个文件、且必须走静态服务器

- Three.js 自 r150+ **只有 ES module 构建**，实测 `build/three.min.js`（UMD）在 0.186.1 上返回 **HTTP 404**；
- `three.module.js` 只做再导出，实体在 `three.core.js`，缺一个就白屏；
- ES module 在 `file://` 下会被 CORS 拦截 → **必须** `python3 -m http.server 8000`（见 [README.md](README.md)）。

## three.js addons（2026-10-03 新增）

为接入用户从 Tripo Studio 本地生成的 `.glb` 资产，vendored 了 GLTFLoader 及其两个工具依赖。
**它们是同一份 three@0.186.1 的一部分**（`examples/jsm/`），不是新增的第三方项目，许可同为 MIT。

| 文件 | 字节 | 作用 |
|---|---|---|
| `prototype/vendor/three/addons/loaders/GLTFLoader.js` | 117,570 | glTF 2.0 / GLB 解析 |
| `prototype/vendor/three/addons/utils/BufferGeometryUtils.js` | 37,712 | GLTFLoader 依赖（`toTrianglesDrawMode`） |
| `prototype/vendor/three/addons/utils/SkeletonUtils.js` | 11,535 | GLTFLoader 依赖（蒙皮 `clone`），Tripo 带骨骼/动画的模型会用到 |

来源：`https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/{loaders/GLTFLoader.js,utils/BufferGeometryUtils.js,utils/SkeletonUtils.js}`

**目录层级不能压平**：`GLTFLoader.js` 用 `../utils/BufferGeometryUtils.js`、`../utils/SkeletonUtils.js`
相对引用，压平会 404。三个文件都只 import 裸模块 `three`（由页面 importmap 解析到 vendored 核心），
因此**运行期依然零外部请求** —— 已实测（见 [STATUS.md](STATUS.md) 自测记录）。

### 校验值（sha256）

```
131c0f78c01d19368ae495caa65b3adaa10487810a36a05bb5901b769a35ac16  addons/loaders/GLTFLoader.js
9fb63427ce6641fa14fd0baff9cc4d1b5f9c3d85fd084bf2e90e803c44ec1797  addons/utils/BufferGeometryUtils.js
b1632a703206c3d830de9fcbe515696770d04b71a15ee6b50afa6d2c3298c86f  addons/utils/SkeletonUtils.js
```

复核命令：

```bash
cd prototype/vendor/three && shasum -a 256 addons/loaders/GLTFLoader.js addons/utils/*.js
```

> ⚠️ **偏离记录**：本文件下方「未使用的第三方」原写着"无外部 3D 模型资产"。
> 接入 `.glb` 后该表述只剩**贴图**部分成立（贴图仍全部程序化生成）。
> 这是一次**显式的红线偏离**，已由项目所有者裁定；模型来源与许可证必须逐件登记在
> [prototype/assets/README.md](prototype/assets/README.md)。

### 未使用的第三方

- 无字体外链（只用系统字体栈）
- **无外部贴图资产**（贴图仍全部由 `textures.js` / `suite-textures.js` 运行时用 Canvas 程序化生成）
- 无音频资产（提示音由 WebAudio 实时合成，语音走浏览器 `speechSynthesis`）
- 无 npm 依赖、无打包器、无构建步骤（`vendor/**` 是**提交进仓库的源码快照**，不是安装的依赖）
- ⚠️ **有外部 3D 模型资产**：`prototype/assets/*.glb`（2026-10-03 起，用户裁定的显式偏离）

## 本项目

- 代码：MIT，见 [LICENSE](LICENSE)

---

## 童声语音片段（项目自有资产，v1.11）

| 项 | 内容 |
|---|---|
| 文件 | `prototype/assets/voice/p1.mp3`、`p2.mp3`、`p3.mp3` |
| 用途 | 机器人到点**童声督促**取药（用户口径：「声音是童声」） |
| 来源 | **本项目仓库自己的提交**（`liuchun878/elder-protecter`）：`42c7dabe` 吃药提醒 / `b9a6f7f8` 鼓励 / `551ff9ca` 留言给子女手机，说明均为 **boy child** |
| 许可 | 本项目 MIT（项目所有者提供；非第三方素材） |
| 运行时 | **本地文件**，零网络请求；默认不播（`?voiceclip=1` 才播） |

### 校验值（sha256）

```
f1e49d133aa7dfddec6ed7c61daee0b830ffeb1c73309f6ba4ff41cfb7b0c23b  p1.mp3
886cd6b2f165a9e9af038f2693ab9732da9e0e1be7548c7c86bfa167d840ceda  p2.mp3
851088e3910ab6c598e32bd42a0ae57fcb2dbdcaaf062b09d2c682a9e7159a4b  p3.mp3
```

> ⚠️ **默认不播这三段的理由见 `prototype/assets/README.md`**：`p2` 的原话是「药都吃完啦」
> （= 已服下，本项目最硬的红线）；`p1` 里写死了「三粒」。默认走**童声 TTS + 合规措辞**。
