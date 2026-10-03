# elder-protecter

老年友好型居家送药机器人项目。

## 目录

| 路径 | 内容 |
| --- | --- |
| `unnc-sophicar/` | 机器人结构设计原始文件（SolidWorks） |

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

> 注：部分零件文件名为 SolidWorks 内部导出时的编码，可能与实际名称有出入，以模型内容为准。

## 使用说明

- 文件名不区分大小写，`.step` / `.STEP` 为同类文件的不同导出批次。
- 大文件（STEP/SLDASM）体积较大，克隆仓库时请耐心等待；如只需查看几何，建议优先下载 STEP 文件。
