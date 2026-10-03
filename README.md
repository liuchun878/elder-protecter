# elder-protecter

老年友好型居家送药机器人项目。

## 目录

| 路径 | 内容 |
| --- | --- |
| `unnc-sophicar/` | 机器人结构设计原始文件（SolidWorks） |
| `suite-3d/` | 套房 3D 交互预览（浏览器打开 `suite-3d/index.html`） |
| `family-app/` | **子女端提示 App** —— 子女手机端交互原型（浏览器打开 `family-app/index.html`） |

## unnc-sophicar 说明

移动底盘总装与零件模型，SolidWorks 2022 及以上版本打开。

### 总装文件

| 文件 | 说明 |
| --- | --- |
| `Final.SLDASM` | 最终总装 |
| `UNNC-AGV-P-1.SLDASM` | AGV 底盘总装（含零件） |
| `UNNC-AGV-P.SLDASM` | AGV 底盘总装（轻量） |
| `UNNC-AGV-P-1.STEP` | AGV 总装 STEP 通用格式（供非 SolidWorks 环境使用） |
| `UNNC-AGV-P.step` | AGV 总装 STEP 通用格式 |

### 主要零件

- 底盘结构件：`LBSB6-2020_b*.SLDPRT`（2020 型材支架）、`LCFB6-2020-50*.SLDPRT`
- 外壳与面板：`小车外壳-V1.SLDPRT`、`TOP.SLDPRT`、`Middle.SLDPRT`
- 运动部件：`万向轮 v1.SLDPRT`、`联轴器 v1.SLDPRT`、`直流电机-MD36LP27（霍尔）1.SLDPRT`、`电机支架_MD36支架.SLDPRT`
- 其他：`P761S×酸铁锂电池.SLDPRT`（电池）、`STP-23L模块.dwg*.SLDASM/.SLDPRT`（模块）

> 注：部分零件文件名（如 `P761SÁ×ËáÌúï®µç³Ø.SLDPRT`）是 SolidWorks 导出时 GBK 文件名被错误解码所致，**已按原始压缩包原样保留**，未作重命名。其真实含义供参考：
>
> | 文件名中的乱码段 | 实际含义 |
> | --- | --- |
> | `P761SÁ×ËáÌúï®µç³Ø` | P761S 磷酸铁锂电池 |
> | `STP-23LÄ£¿é.dwg` | STP-23L 模块.dwg |
> | `µç»úÖ§¼Ü_MD36Ö§¼Ü` | 电机支架_MD36 支架 |
> | `Ö±Á÷µç»ú-MD36LP27£¨»ô¶û£©1` | 直流电机-MD36LP27（霍尔）1 |

## 使用说明

- 文件名不区分大小写，`.step` / `.STEP` 为同类文件的不同导出批次。
- 大文件（STEP/SLDASM）体积较大，克隆仓库时请耐心等待；如只需查看几何，建议优先下载 STEP 文件。

## 如何推送到本仓库

国内直连 GitHub 会被重置，**必须走代理**。仓库根目录提供了 `推送脚本.bat`，双击即可（脚本会先检测 `127.0.0.1:7890` 是否有代理在监听）。

如代理端口不同，二选一：

```bat
:: 方式一：改脚本里的 PROXY 变量后双击运行

:: 方式二：手动指定代理推送
git config http.proxy http://127.0.0.1:你的端口
git config https.proxy http://127.0.0.1:你的端口
git push -u origin main
```
