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

### 未使用的第三方

- 无字体外链（只用系统字体栈）
- 无外部 3D 模型 / 贴图资产（场景全部由 Three.js 内置几何体拼装）
- 无音频资产（提示音由 WebAudio 实时合成，语音走浏览器 `speechSynthesis`）
- 无 npm 依赖、无打包器、无构建步骤

## 本项目

- 代码：MIT，见 [LICENSE](LICENSE)
